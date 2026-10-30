import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import type { Snapshot } from "../../shared/domain";

const root = "output/playwright/velvet-verdict/after";
const sizes = [
  [1440, 900],
  [1280, 720],
  [360, 640],
  [390, 844],
  [844, 390],
];

/** Evaluate actual composited DOM colors, including nested/translucent fills. */
async function inspectSurface(page: Page) {
  return page.evaluate(() => {
    type RGB = [number, number, number, number];
    const rgba = (s: string): RGB => {
      const n = s.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
      return [n[0], n[1], n[2], n[3] ?? 1];
    };
    const over = (a: RGB, b: RGB): RGB => [
      a[0] * a[3] + b[0] * (1 - a[3]),
      a[1] * a[3] + b[1] * (1 - a[3]),
      a[2] * a[3] + b[2] * (1 - a[3]),
      1,
    ];
    const luminance = (c: RGB) =>
      c.slice(0, 3).reduce((sum, value, i) => {
        const x = value / 255;
        return (
          sum +
          (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][i]
        );
      }, 0);
    const contrast = (a: RGB, b: RGB) => {
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const background = (el: Element | null): RGB => {
      if (!el) return [255, 255, 255, 1];
      return over(
        rgba(getComputedStyle(el).backgroundColor),
        background(el.parentElement),
      );
    };
    const failures: { text: string; ratio: number; required: number }[] = [];
    let minText = 100;
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const style = getComputedStyle(el),
        rect = el.getBoundingClientRect();
      if (
        !rect.width ||
        !rect.height ||
        style.visibility === "hidden" ||
        el.closest('[aria-hidden="true"], .sr-only, canvas, video, svg')
      )
        continue;
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("")
        .trim();
      if (!text && !el.matches("input")) continue;
      const textStyle =
        el.matches("input[placeholder]") && !(el as HTMLInputElement).value
          ? getComputedStyle(el, "::placeholder")
          : style;
      const bg = background(el),
        color = rgba(textStyle.color);
      color[3] *= Number(textStyle.opacity);
      const fg = over(color, bg);
      const ratio = contrast(fg, bg);
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 &&
          Number(style.fontWeight) >= 700);
      const required = large ? 3 : 4.5;
      minText = Math.min(minText, ratio);
      if (ratio + 0.01 < required)
        failures.push({
          text: (text || "input").slice(0, 70),
          ratio,
          required,
        });
    }
    const smallTargets = [
      ...document.querySelectorAll<HTMLElement>(
        "button, summary, .motion-toggle, a, input:not([type=checkbox]), select",
      ),
    ].flatMap((el) => {
      const r = el.getBoundingClientRect();
      return r.width && r.height && (r.width < 43.9 || r.height < 43.9)
        ? [{ text: el.textContent, w: r.width, h: r.height }]
        : [];
    });
    const indicators = [
      ...document.querySelectorAll<HTMLElement>(
        '.primary:not(:disabled), input:not([type="checkbox"]), :focus-visible',
      ),
    ].flatMap((el) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return [];
      const style = getComputedStyle(el);
      const outer = background(el.parentElement);
      const measured = [];
      if (el.matches('.primary:not(:disabled), input:not([type="checkbox"])'))
        measured.push({
          kind: "control boundary",
          ratio: Math.max(
            contrast(background(el), outer),
            parseFloat(style.borderWidth) > 0
              ? contrast(over(rgba(style.borderColor), outer), outer)
              : 0,
          ),
        });
      if (el.matches(":focus-visible") && parseFloat(style.outlineWidth) > 0)
        measured.push({
          kind: "focus outline",
          ratio: contrast(over(rgba(style.outlineColor), outer), outer),
        });
      return measured.map((m) => ({
        ...m,
        control: el.textContent?.trim().slice(0, 40) || "input",
      }));
    });
    return {
      failures,
      smallTargets,
      indicators,
      minText,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

test("Velvet Verdict state atlas, stable identities and accessible surfaces", async ({
  browser,
  baseURL,
  request,
}, info) => {
  test.skip(
    info.project.name !== "rtc",
    "State atlas uses the shared renderer; transport journeys run in the full matrix.",
  );
  await mkdir(root, { recursive: true });
  await request.post("/__test/reset");
  const ca = await browser.newContext({
    permissions: ["camera", "microphone"],
    reducedMotion: "reduce",
  });
  const cb = await browser.newContext({
    permissions: ["camera", "microphone"],
    reducedMotion: "reduce",
  });
  const a = await ca.newPage(),
    b = await cb.newPage();
  const checks: unknown[] = [];
  const interactionChecks: unknown[] = [];
  let roomCode = "";
  let originalPlayers: Snapshot["players"] = [];
  const capture = async (name: string) => {
    for (const [width, height] of sizes) {
      await a.setViewportSize({ width, height });
      await a.evaluate(() => document.fonts.ready);
      await a.evaluate(() => window.scrollTo(0, 0));
      await a.waitForTimeout(80);
      const check = await inspectSurface(a);
      checks.push({ name, width, height, ...check });
      expect
        .soft(check.failures, `${name} at ${width}: text contrast`)
        .toEqual([]);
      expect
        .soft(check.smallTargets, `${name} at ${width}: touch targets`)
        .toEqual([]);
      expect
        .soft(
          check.indicators.filter((i) => i.ratio < 3),
          `${name} at ${width}: control/focus contrast`,
        )
        .toEqual([]);
      expect
        .soft(check.overflow, `${name} at ${width}: horizontal overflow`)
        .toBe(false);
      if (
        name === "debate" &&
        width === 1440 &&
        process.env.EXPORT_BONK_FALLBACK === "true"
      ) {
        const stage = a.locator(".stage");
        await stage.evaluate((el: HTMLElement) => {
          el.style.cssText =
            "position:fixed;left:0;top:0;width:876px;height:570px;z-index:999;background:var(--canvas)";
        });
        await a.waitForTimeout(250);
        await stage.screenshot({ path: "public/bonk-fallback.png" });
        await stage.evaluate((el) => el.removeAttribute("style"));
        await a.waitForTimeout(100);
      }
      await a.screenshot({
        path: `${root}/${name}-${width}.png`,
        fullPage: true,
      });
    }
  };
  try {
    await a.goto(baseURL!);
    await expect(a.locator(".stage canvas")).toBeVisible();
    await capture("title");
    const primary = a.getByRole("button", { name: "Create room", exact: true });
    const inspectInteraction = async (state: string) => {
      const result = await inspectSurface(a);
      interactionChecks.push({ state, ...result });
      expect(result.failures, state + " text contrast").toEqual([]);
      expect(
        result.indicators.filter((i) => i.ratio < 3),
        state + " indicator contrast",
      ).toEqual([]);
    };
    await expect(primary).toBeDisabled();
    await inspectInteraction("disabled");
    await a.getByLabel("Your name", { exact: true }).fill("Alex");
    await a.keyboard.press("Tab");
    await expect(primary).toBeFocused();
    await inspectInteraction("keyboard focus");
    await primary.hover();
    await inspectInteraction("hover");
    await a.mouse.down();
    await inspectInteraction("pressed");
    await a.mouse.move(0, 0);
    await a.mouse.up();
    await a.getByRole("button", { name: "Join a friend", exact: true }).click();
    await capture("join");
    await a.getByRole("button", { name: "Create your own room" }).click();
    await a.getByLabel("Your name", { exact: true }).fill("Alex");
    await request.post("/__test/provider", { data: { speechDelay: 10000 } });
    await a.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(a.locator(".private-check-label")).toBeVisible();
    await capture("private-setup");
    await request.post("/__test/provider", { data: { speechDelay: 200 } });
    await expect(a.locator(".invite-code span")).toBeVisible();
    const code = (await a.locator(".invite-code span").innerText()).trim();
    await b.goto(baseURL + "/?room=" + code);
    await b.getByLabel("Your name", { exact: true }).fill("Sam");
    await b.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(
      a.getByRole("button", { name: "Ready to argue" }),
    ).toBeEnabled();
    const state = (await (
      await request.post("/__test/state/" + code)
    ).json()) as Snapshot;
    roomCode = code;
    originalPlayers = state.players;
    const [p0, p1] = state.players;
    expect([p0.seat, p1.seat]).toEqual([0, 1]);
    await capture("lobby");
    const topic = {
      proposition: "A hot dog is a sandwich.",
      positions: {
        [p0.id]: "For the proposition",
        [p1.id]: "Against the proposition",
      },
      revision: 1,
      confirmations: [],
    };
    const players = state.players.map((p, i) => ({
      ...p,
      scoreUnits: i ? 26 : 33,
      wins: i ? 0 : 1,
    }));
    const turn = {
      id: "velvet-turn",
      playerId: p0.id,
      kind: "rebuttal" as const,
      durationMs: 30000,
      remainingMs: 23000,
      deadline: Date.now() + 30000,
      pausedReason: null,
      sealing: false,
      inputEpoch: 1,
      inputState: "open" as const,
      targets: { reasoning: 0, rebuttal: 0, impact: 0, wit: 0, clarity: 0 },
    };
    const result = {
      round: 1,
      roundId: "velvet-round",
      winnerId: p0.id,
      scores: { [p0.id]: 33, [p1.id]: 26 },
      reason:
        "Alex answered the bread-hinge distinction with a clear counterexample.",
      tieBreak: null,
    };
    const present = async (patch: Partial<Snapshot>) => {
      await request.post("/__test/present/" + code, {
        data: {
          matchId: "velvet-match",
          roundId: "velvet-round",
          round: 1,
          topic,
          players,
          turn: null,
          judge: null,
          judgePending: false,
          recoveryDeadline: null,
          phaseDeadline: null,
          captions: {},
          results: [],
          ledger: [],
          rematchReady: [],
          winnerId: null,
          headsId: p0.id,
          tailsId: p1.id,
          ...patch,
        },
      });
      await expect(a.locator(".app")).toHaveClass(
        new RegExp("phase-" + patch.phase!.toLowerCase()),
      );
    };
    for (const [name, patch] of [
      ["coin", { phase: "INTRO_COIN", topic: null, round: 0 }],
      [
        "topic",
        {
          phase: "TOPIC_SELECT",
          topic: null,
          round: 0,
          tailsId: p0.id,
          headsId: p1.id,
        },
      ],
      ["agreement", { phase: "TOPIC_CONFIRM", round: 0 }],
      [
        "debate",
        {
          phase: "ROUND",
          turn,
          captions: {
            [p0.id]: {
              text: "A sub keeps its bread hinge and is still a sandwich. The hot dog gets the same deal.",
              final: true,
              at: Date.now(),
            },
          },
        },
      ],
      [
        "judging",
        {
          phase: "ROUND",
          turn: {
            ...turn,
            deadline: null,
            sealing: true,
            pausedReason: "judging",
          },
          judgePending: true,
        },
      ],
      ["round-result", { phase: "ROUND_RESOLVE", results: [result] }],
      [
        "verdict",
        {
          phase: "MATCH_RESULT",
          results: [result],
          winnerId: p0.id,
          players: players.map((p) => ({ ...p, wins: p.id === p0.id ? 2 : 0 })),
        },
      ],
      [
        "rematch",
        {
          phase: "MATCH_RESULT",
          results: [result],
          winnerId: p0.id,
          rematchReady: [p0.id],
        },
      ],
      [
        "recovery",
        {
          phase: "RECOVERING",
          status: "Sam disconnected. Holding their seat and the clock.",
          recoveryDeadline: Date.now() + 60000,
          players: players.map((p) => ({ ...p, connected: p.id === p0.id })),
        },
      ],
      [
        "interrupted",
        {
          phase: "ABORTED",
          status: "Sam left the court. No winner this time.",
          players: [p0],
        },
      ],
    ] as [string, Partial<Snapshot>][]) {
      await present(patch);
      await capture(name);
      if (name === "topic") {
        await a.getByRole("button", { name: "Write your own" }).click();
        await capture("custom-topic");
      }
    }
    for (const winner of [p0, p1]) {
      await present({
        phase: "MATCH_RESULT",
        winnerId: winner.id,
        results: [{ ...result, winnerId: winner.id }],
        players: players
          .map((p) => ({ ...p, wins: p.id === winner.id ? 2 : 0 }))
          .reverse(),
      });
      for (const page of [a, b]) {
        for (const player of [p0, p1]) {
          await expect(
            page.locator(`[data-seat="${player.seat}"]`),
          ).toHaveAttribute("data-player-id", player.id);
          await expect(
            page.locator(`[data-seat="${player.seat}"] .face-heading`),
          ).toHaveCSS(
            "color",
            player.seat === 0 ? "rgb(168, 213, 242)" : "rgb(247, 179, 140)",
          );
        }
        await expect(page.locator(".result-panel h2")).toHaveCSS(
          "color",
          winner.seat === 0 ? "rgb(168, 213, 242)" : "rgb(247, 179, 140)",
        );
      }
    }
    await present({
      phase: "ABORTED",
      status: "Alex left the court. No winner this time.",
      players: [p1],
    });
    for (const page of [a, b])
      await expect(page.locator('[data-seat="1"]')).toHaveAttribute(
        "data-player-id",
        p1.id,
      );
    await a
      .locator(".stage canvas")
      .evaluate((canvas: HTMLCanvasElement) =>
        canvas
          .getContext("webgl2")
          ?.getExtension("WEBGL_lose_context")
          ?.loseContext(),
      );
    await expect(a.locator(".stage-fallback")).toBeVisible();
    await capture("webgl-fallback");
    await a.getByRole("button", { name: "How to play" }).click();
    await capture("rules");
    await a.keyboard.press("Escape");
    await expect(a.getByRole("button", { name: "How to play" })).toBeFocused();
    await a.getByRole("button", { name: "Audio", exact: true }).click();
    await capture("sound");
  } finally {
    await writeFile(
      `${root}/surface-checks.json`,
      JSON.stringify(checks, null, 2),
    );
    await writeFile(
      `${root}/interaction-checks.json`,
      JSON.stringify(interactionChecks, null, 2),
    );
    if (roomCode)
      await request.post("/__test/present/" + roomCode, {
        data: { phase: "ABORTED", players: originalPlayers, turn: null },
      });
    await request.post("/__test/reset");
    await ca.close();
    await cb.close();
  }
});
