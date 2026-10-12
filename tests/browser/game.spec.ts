import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { Snapshot } from "../../shared/domain";
const root = "output/playwright/upgrade";
async function snapshot(
  request: APIRequestContext,
  code: string,
): Promise<Snapshot> {
  const response = await request.post("/__test/state/" + code);
  return response.json();
}
async function enter(a: Page, b: Page, baseURL: string) {
  await a.goto(baseURL);
  await a.getByLabel("Your name", { exact: true }).fill("Alex");
  await a.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(a.locator(".room-code b")).toBeVisible();
  const code = (await a.locator(".room-code b").innerText()).trim();
  await b.goto(baseURL + "/?room=" + code);
  await b.getByLabel("Your name", { exact: true }).fill("Sam");
  await b.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(a.getByRole("button", { name: "Ready to argue" })).toBeEnabled();
  await expect(b.getByRole("button", { name: "Ready to argue" })).toBeEnabled();
  return code;
}
async function shot(page: Page, name: string) {
  await page.bringToFront();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  // Let the camera resize and the 480ms score tally settle before capturing.
  await page.waitForTimeout(650);
  await page.screenshot({
    path: root + "/" + name + ".png",
    fullPage: true,
    animations: "allow",
  });
}
async function noOverlap(page: Page) {
  const overlap = await page.evaluate(() => {
    const face = [...document.querySelectorAll(".face")].map((n) =>
      n.getBoundingClientRect(),
    );
    const caption = document
      .querySelector(".caption-zone")
      ?.getBoundingClientRect();
    const panel = document
      .querySelector(".phase-content")
      ?.getBoundingClientRect();
    const intersection = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    return (
      face.some(
        (r) =>
          (caption && intersection(r, caption)) ||
          (panel && intersection(r, panel)),
      ) ||
      document.documentElement.scrollWidth > innerWidth ||
      [...document.querySelectorAll("button, .phase-content, .stage")].some(
        (n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
        },
      )
    );
  });
  expect(overlap).toBe(false);
}

test.beforeEach(async ({ request }) => {
  await mkdir(root, { recursive: true });
  await request.post("/__test/reset");
});

test("two players complete a scored match, recover media, and rematch", async ({
  browser,
  baseURL,
  request,
}, info) => {
  const ca = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 1280, height: 720 },
  });
  const cb = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 1280, height: 720 },
  });
  const a = await ca.newPage(),
    b = await cb.newPage();
  const errors: string[] = [];
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
  const code = await enter(a, b, baseURL!);
  await expect
    .poll(async () => (await snapshot(request, code)).mediaMode)
    .toBe(info.project.name === "relay" ? "wss" : "rtc");
  for (const p of [a, b])
    await expect
      .poll(() =>
        p
          .locator('.face[aria-label$=", you"] video')
          .evaluate((v: HTMLVideoElement) => v.videoWidth),
      )
      .toBeGreaterThan(0);
  for (const p of [a, b]) {
    const remote = p.locator('.face:not([aria-label$=", you"])');
    await expect
      .poll(() =>
        remote.evaluate((face, relay) => {
          if (relay) return face.querySelector("canvas")!.width;
          return face.querySelector("video")!.videoWidth;
        }, info.project.name === "relay"),
      )
      .toBeGreaterThan(0);
  }
  const originalVideo = await a
    .locator('.face[aria-label$=", you"] video')
    .elementHandle();
  let manuallyMuted: Page | null = null;
  await a.getByRole("button", { name: "Camera on", exact: true }).click();
  await expect(
    a.getByRole("button", { name: "Camera off", exact: true }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Camera off", exact: true }).click();
  await expect(
    a.getByRole("button", { name: "Camera on", exact: true }),
  ).toBeVisible();
  await shot(a, "live-lobby-" + info.project.name);
  await a.getByRole("button", { name: "Ready to argue" }).click();
  await b.getByRole("button", { name: "Ready to argue" }).click();
  await expect
    .poll(async () => (await snapshot(request, code)).phase)
    .toBe("TOPIC_SELECT");
  const state = await snapshot(request, code);
  const tails =
    state.players.find((p) => p.id === state.tailsId)?.name === "Alex" ? a : b;
  await tails.getByRole("button", { name: "Is a hot dog a sandwich?" }).click();
  await expect(
    a.getByRole("button", { name: "Confirm my side" }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Choose another topic" }).click();
  await tails.getByRole("button", { name: "Write your own" }).click();
  await tails
    .getByLabel("The proposition", { exact: true })
    .fill("A hot dog is a sandwich.");
  await tails.getByLabel("Your side", { exact: true }).fill("It is a sandwich");
  await tails.getByRole("button", { name: "Propose it" }).click();
  await expect(
    a.getByRole("button", { name: "Confirm my side" }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Confirm my side" }).click();
  await b.getByRole("button", { name: "Confirm my side" }).click();
  let opportunities = 0;
  while (opportunities < 18) {
    await expect
      .poll(async () => {
        const s = await snapshot(request, code);
        return (
          s.phase === "MATCH_RESULT" ||
          (s.phase === "ROUND" &&
            !!s.turn &&
            !s.turn.pausedReason &&
            !s.turn.sealing)
        );
      })
      .toBe(true);
    const s = await snapshot(request, code);
    if (s.phase === "MATCH_RESULT") break;
    const speaker =
      s.players.find((p) => p.id === s.turn!.playerId)?.name === "Alex" ? a : b;
    const listener = speaker === a ? b : a;
    if (manuallyMuted === speaker) {
      await expect(
        speaker.getByRole("button", { name: "Mic off", exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          speaker
            .locator('.face[aria-label$=", you"] video')
            .evaluate(
              (v: HTMLVideoElement) =>
                (v.srcObject as MediaStream).getAudioTracks()[0].enabled,
            ),
        )
        .toBe(false);
      await speaker
        .getByRole("button", { name: "Mic off", exact: true })
        .click();
      manuallyMuted = null;
    }
    await expect(
      speaker.getByRole("button", { name: "I’m done", exact: true }),
    ).toBeEnabled();
    await expect(
      listener.getByRole("button", { name: "I’m done", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        listener
          .locator('.face[aria-label$=", you"] video')
          .evaluate(
            (v: HTMLVideoElement) =>
              (v.srcObject as MediaStream)?.getAudioTracks()[0]?.enabled,
          ),
      )
      .toBe(false);
    if (opportunities === 0) {
      await speaker
        .getByRole("button", { name: "Mic on", exact: true })
        .click();
      await expect(
        speaker.getByRole("button", { name: "Mic off", exact: true }),
      ).toBeVisible();
      await speaker
        .getByRole("button", { name: "Mic off", exact: true })
        .click();
      await shot(a, "live-round-" + info.project.name);
    }
    await expect
      .poll(() =>
        speaker
          .locator('.face[aria-label$=", you"] video')
          .evaluate(
            (v: HTMLVideoElement) =>
              (v.srcObject as MediaStream)?.getAudioTracks()[0]?.enabled,
          ),
      )
      .toBe(true);
    if (opportunities === 3) {
      await request.post("/__test/failure/" + code + "/stt");
    }
    if (opportunities >= 3) {
      const typed = speaker.getByLabel(
        "Speech recognition is unavailable. Type your argument.",
      );
      await typed.fill(
        "A connected bread hinge does not stop a sub from being a sandwich.",
      );
      await speaker
        .getByRole("button", { name: "Submit", exact: true })
        .click();
      await expect(typed).toHaveValue("");
    }
    await speaker
      .getByRole("button", { name: "I’m done", exact: true })
      .click();
    if (opportunities === 0) {
      await expect(
        speaker.getByRole("button", { name: "Mic paused", exact: true }),
      ).toBeVisible();
      await speaker
        .getByRole("button", { name: "Mic paused", exact: true })
        .click();
      manuallyMuted = speaker;
    }
    opportunities++;
    await expect
      .poll(async () => {
        const next = await snapshot(request, code);
        return next.phase === "MATCH_RESULT" || next.turn?.id !== s.turn?.id;
      })
      .toBe(true);
    if (opportunities === 4) {
      await b.reload();
      await expect(b.locator(".courtroom")).toBeVisible();
      await expect
        .poll(async () =>
          (await snapshot(request, code)).players.every((p) => p.mediaReady),
        )
        .toBe(true);
    }
  }
  expect([12, 18]).toContain(opportunities);
  expect(await originalVideo!.evaluate((v) => v.isConnected)).toBe(true);
  const result = await snapshot(request, code);
  expect(result.ledger.length).toBeGreaterThan(0);
  expect(result.players.find((p) => p.id === result.winnerId)?.name).toBe(
    "Alex",
  );
  await expect(a.locator(".result-panel h2")).toContainText("Alex");
  await expect(b.locator(".result-panel h2")).toContainText("Alex");
  expect(await a.locator(".score-numbers").allTextContents()).toEqual(
    await b.locator(".score-numbers").allTextContents(),
  );
  await shot(a, "live-result-" + info.project.name);
  await noOverlap(a);
  await a.getByRole("button", { name: "Again. Obviously." }).click();
  await expect(a.getByRole("button", { name: "Rematch ready" })).toBeDisabled();
  await b.getByRole("button", { name: "Again. Obviously." }).click();
  await expect
    .poll(async () => (await snapshot(request, code)).phase)
    .toBe("INTRO_COIN");
  await a.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(
    a.getByRole("button", { name: "Create room", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await ca.close();
  await cb.close();
});

test("visual matrix, accessibility, error and fallback states", async ({
  browser,
  baseURL,
  request,
}, info) => {
  test.skip(
    info.project.name !== "rtc",
    "The same DOM and 3D renderer serve both transports.",
  );
  const ca = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 1440, height: 900 },
  });
  const cb = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 1440, height: 900 },
  });
  const a = await ca.newPage(),
    b = await cb.newPage();
  await a.goto(baseURL!);
  await expect(a.locator(".stage canvas")).toBeVisible();
  await shot(a, "title-1440");
  await a.emulateMedia({ reducedMotion: "reduce" });
  await expect(a.locator(".app")).toHaveClass(/reduced-motion/);
  await a.emulateMedia({ reducedMotion: "no-preference" });
  await expect(a.locator(".app")).not.toHaveClass(/reduced-motion/);
  await a.getByRole("button", { name: "How to play" }).click();
  await expect(a.getByRole("dialog")).toBeVisible();
  await a.keyboard.press("Shift+Tab");
  expect(
    await a.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await a.getByLabel("Reduce motion", { exact: true }).check();
  await a.keyboard.press("Escape");
  await expect(a.getByRole("button", { name: "How to play" })).toBeFocused();
  await expect(a.locator(".app")).toHaveClass(/reduced-motion/);
  const code = await enter(a, b, baseURL!);
  const base = await snapshot(request, code),
    [p0, p1] = base.players;
  const topic = {
    proposition: "A hot dog is a sandwich.",
    positions: { [p0.id]: "It is a sandwich", [p1.id]: "It is not a sandwich" },
    revision: 1,
    confirmations: [],
  };
  const round = {
    matchId: "visual-match",
    round: 1,
    roundId: "visual-round",
    topic,
    headsId: p1.id,
    tailsId: p0.id,
    turnIndex: 0,
    ledger: [],
    results: [],
    captions: {},
    judge: null,
    judgePending: false,
    recoveryDeadline: null,
    degraded: { tts: false, stt: false },
    winnerId: null,
    rematchReady: [],
  };
  const present = async (patch: Partial<Snapshot>) => {
    await request.post("/__test/present/" + code, {
      data: { ...round, phaseDeadline: Date.now() + 45000, ...patch },
    });
    await expect(a.locator(".app")).toHaveClass(
      new RegExp("phase-" + patch.phase!.toLowerCase()),
    );
  };
  const turn = (kind: "case" | "rebuttal" | "closing" = "case") => ({
    id: "visual-turn",
    playerId: p0.id,
    kind,
    durationMs: kind === "closing" ? 15000 : 30000,
    remainingMs: kind === "closing" ? 12000 : 23000,
    deadline: Date.now() + (kind === "closing" ? 12000 : 23000),
    pausedReason: null,
    sealing: false,
    targets: { reasoning: 0, rebuttal: 0, impact: 0, wit: 0, clarity: 0 },
  });
  await shot(a, "lobby-1440");
  await present({ phase: "INTRO_COIN", topic: null, round: 0, turn: null });
  await expect(a.locator(".coin-token")).toHaveAttribute("data-side", "tails");
  await expect(b.locator(".coin-token")).toHaveAttribute("data-side", "heads");
  await shot(a, "coin-1440");
  await present({ phase: "TOPIC_SELECT", topic: null, round: 0, turn: null });
  await shot(a, "topic-1440");
  await a.getByRole("button", { name: "Write your own" }).click();
  await shot(a, "custom-topic-1440");
  await present({ phase: "TOPIC_CONFIRM", turn: null, round: 0 });
  await shot(a, "confirm-1440");
  const ledger = [
    {
      id: "score-1",
      playerId: p0.id,
      roundId: "visual-round",
      turnId: "visual-turn",
      segmentId: "s1",
      criterion: "rebuttal" as const,
      quality: 3,
      deltaUnits: 8,
      reason:
        "Answers the bread-hinge distinction with a clear counterexample.",
      at: Date.now(),
    },
  ];
  const players = base.players.map((p, i) => ({
    ...p,
    scoreUnits: i ? 26 : 33,
    wins: i ? 0 : 1,
  }));
  for (const [width, height] of [
    [1280, 720],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
    [1024, 768],
    [390, 844],
  ]) {
    await a.setViewportSize({ width, height });
    await present({
      phase: "ROUND",
      turn: turn("rebuttal"),
      players,
      ledger,
      captions: {
        [p0.id]: {
          text: "A sub keeps its bread hinge and is still a sandwich. The hot dog gets the same deal.",
          final: true,
          at: Date.now(),
        },
      },
    });
    await noOverlap(a);
    await shot(a, "round-" + width);
  }
  await a.setViewportSize({ width: 1280, height: 720 });
  await present({
    phase: "ROUND",
    turn: { ...turn(), deadline: null, pausedReason: "judge" },
    judge: {
      id: "speech",
      epoch: 300,
      text: "Sam, answer Alex’s point about that bread hinge.",
      status: "speaking",
      expression: "smug",
      targetPlayerId: p1.id,
      startAt: Date.now(),
    },
    degraded: { tts: true, stt: false },
  });
  await shot(a, "judge-1280");
  await expect(a.locator(".turn-label")).toContainText("Clock paused");
  await present({
    phase: "ROUND",
    turn: turn("closing"),
    degraded: { stt: true, tts: false },
  });
  await expect(
    a.getByLabel("Speech recognition is unavailable. Type your argument."),
  ).toBeVisible();
  await shot(a, "typed-recovery-1280");
  await noOverlap(a);
  const results = [
    {
      round: 1,
      roundId: "visual-round",
      winnerId: p0.id,
      scores: { [p0.id]: 33, [p1.id]: 26 },
      reason:
        "Alex answered the key distinction with a precise counterexample.",
      tieBreak: null,
    },
  ];
  await present({ phase: "ROUND_RESOLVE", turn: null, players, results });
  await shot(a, "round-result-1280");
  await present({
    phase: "ROUND_RESOLVE",
    turn: null,
    players: players.map((player) => ({ ...player, scoreUnits: 33 })),
    results: [
      {
        ...results[0],
        scores: { [p0.id]: 33, [p1.id]: 33 },
        reason:
          "Both players made a clear case. Alex answered the central distinction with a specific counterexample, explained why a connected bread hinge does not change the category, and carried that reasoning through the rebuttal. Sam’s closing was clear, but did not resolve that point.",
        tieBreak: "Scores tied. Reasoning breaks the tie.",
      },
    ],
  });
  await noOverlap(a);
  await shot(a, "tie-break-long-reason");
  await present({
    phase: "MATCH_RESULT",
    round: 2,
    turn: null,
    players: players.map((p, i) => ({ ...p, wins: i ? 0 : 2 })),
    results,
    winnerId: p0.id,
  });
  await shot(a, "match-result-1280");
  await present({
    phase: "RECOVERING",
    players: players.map((p, i) => ({ ...p, connected: i === 0 })),
    turn: turn(),
    status: "Sam disconnected. Holding the floor while they reconnect.",
    recoveryDeadline: Date.now() + 60000,
  });
  await shot(a, "reconnecting-1280");
  await present({
    phase: "ABORTED",
    players,
    turn: null,
    status: "The connection could not recover. Start a fresh match together.",
  });
  await shot(a, "aborted-1280");
  await present({
    phase: "ROUND",
    turn: turn(),
    topic: {
      ...topic,
      proposition:
        "Every single hot dog served in a bun should be considered a sandwich, even when the bread remains connected along one side of the bun.",
    },
    players: players.map((p, i) => ({
      ...p,
      name: i ? "Alexandria Longname" : "Bartholomew Friend",
    })),
  });
  await a.evaluate(() => {
    document.documentElement.style.zoom = "1.25";
  });
  await noOverlap(a);
  await shot(a, "zoom-long-content");
  await a.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  await a.locator(".stage canvas").evaluate((c: HTMLCanvasElement) => {
    const gl = c.getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(a.locator(".stage-fallback")).toBeVisible();
  await expect(
    a.getByRole("button", { name: "I’m done", exact: true }),
  ).toBeVisible();
  await shot(a, "webgl-fallback");
  await ca.close();
  await cb.close();
});

test("device permission recovery, camera-optional play, clipboard failure and missing scene", async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    info.project.name !== "rtc",
    "Device UI is shared by both transports.",
  );
  const context = await browser.newContext({
    permissions: ["camera", "microphone"],
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    let permission = false,
      missing = false;
    Object.defineProperty(window, "setTestMicrophoneMissing", {
      value: () => {
        missing = true;
      },
    });
    Object.defineProperty(window, "grantTestMicrophone", {
      value: () => {
        permission = true;
      },
    });
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (missing && !permission)
        return Promise.reject(
          new DOMException("Device not found", "NotFoundError"),
        );
      if (!permission)
        return Promise.reject(
          new DOMException("Permission denied", "NotAllowedError"),
        );
      if (constraints?.video)
        return Promise.reject(
          new DOMException("Camera unavailable", "NotFoundError"),
        );
      return original(constraints);
    };
    Object.defineProperty(navigator.clipboard, "writeText", {
      value: () =>
        Promise.reject(
          new DOMException("Clipboard blocked", "NotAllowedError"),
        ),
    });
  });
  await page.route("**/CourtroomStage-*.js", (route) => route.abort());
  await page.goto(baseURL!);
  await expect(page.locator(".stage-fallback")).toBeVisible();
  await page.getByLabel("Your name", { exact: true }).fill("Casey");
  await page.getByLabel("Your name", { exact: true }).press("Enter");
  await expect(page.locator(".room-notice")).toContainText(
    "Microphone access is needed",
  );
  await expect(
    page.getByRole("button", { name: "Enable mic", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mic on", exact: true }),
  ).toHaveCount(0);
  await shot(page, "permissions-denied");
  await page.evaluate(() =>
    (
      window as unknown as { setTestMicrophoneMissing: () => void }
    ).setTestMicrophoneMissing(),
  );
  await page.getByRole("button", { name: "Enable mic", exact: true }).click();
  await expect(page.locator(".room-notice")).toContainText(
    "No microphone found",
  );
  await shot(page, "microphone-missing");
  await page.evaluate(() =>
    (
      window as unknown as { grantTestMicrophone: () => void }
    ).grantTestMicrophone(),
  );
  await page
    .getByRole("button", { name: "Enable camera & mic", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mic on", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Camera off", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".room-notice")).toHaveCount(0);
  await page.locator(".room-code").click();
  await expect(page.locator(".room-notice")).toContainText(
    "Couldn’t copy the link. Share room code",
  );
  await shot(page, "camera-optional");
  await page.request.post(baseURL + "/__test/reset");
  await page.reload();
  await expect(page.locator(".form-error")).toBeVisible();
  await expect(page.locator(".courtroom")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create room", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("hmo-seat")),
  ).toBeNull();
  await shot(page, "expired-session");
  await context.close();
});
