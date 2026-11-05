import { test, expect } from "@playwright/test";
import { syntheticMicrophone } from "./synthetic-media";
import { openMedia, clickMedia, closeMedia } from "./media-controls";
import { checkKeyboardViewport } from "./keyboard-viewport";
import type { Snapshot } from "../../shared/domain";

test.beforeEach(async ({ request }) => {
  await request.post("/__test/reset");
});

test("phone layouts: shared card rows and keyboard reachability", async ({
  browser,
  baseURL,
  request,
}, info) => {
  // WebKit mock cameras are process-wide, so each player needs its own browser.
  const secondBrowser = info.project.name.startsWith("webkit")
    ? await browser.browserType().launch({ headless: true })
    : null;
  const contexts = await Promise.all(
    [browser, secondBrowser || browser].map((playerBrowser) =>
      playerBrowser.newContext({
        viewport: { width: 360, height: 640 },
        permissions: ["camera", "microphone"],
      }),
    ),
  );
  if (info.project.name.startsWith("webkit"))
    for (const context of contexts) await syntheticMicrophone(context);
  const [a, b] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  const readyGate = {
    mode: "pass" as "pass" | "hold" | "reject",
    release: undefined as (() => void) | undefined,
  };
  // Keep only the injected repair presentation stable while real health reports continue.
  let heldRepairPlayer: string | null = null;
  await a.routeWebSocket("**/socket/control", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const envelope = JSON.parse(message.toString());
      if (heldRepairPlayer && envelope.snapshot) {
        envelope.snapshot.players = envelope.snapshot.players.map(
          (player: Snapshot["players"][number]) =>
            player.id === heldRepairPlayer
              ? {
                  ...player,
                  mediaReady: false,
                  readiness: { ...player.readiness, blockers: ["microphone"] },
                }
              : player,
        );
        socket.send(JSON.stringify(envelope));
      } else socket.send(message);
    });
    socket.onMessage((message) => {
      const envelope = JSON.parse(message.toString());
      if (envelope.command?.type === "ready") {
        if (readyGate.mode === "hold") {
          readyGate.release = () => server.send(message);
          return;
        }
        if (readyGate.mode === "reject") {
          socket.send(
            JSON.stringify({
              type: "ack",
              commandId: envelope.commandId,
              ok: false,
              error: "Try readying again.",
            }),
          );
          return;
        }
      }
      server.send(message);
    });
  });
  try {
    await a.goto(baseURL!);
    await a.setViewportSize({ width: 390, height: 844 });
    const entryGap = await a.evaluate(() => {
      const hero = document
        .querySelector(".title-world")!
        .getBoundingClientRect();
      const form = document
        .querySelector(".entry-card")!
        .getBoundingClientRect();
      return form.top - hero.bottom;
    });
    expect(
      Math.abs(entryGap - 16),
      "Home hero and form stay grouped",
    ).toBeLessThanOrEqual(1);
    await checkKeyboardViewport(a);
    await a.setViewportSize({ width: 360, height: 640 });
    await a.getByLabel("Your name", { exact: true }).fill("Alex");
    await a.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(a.locator(".invite-code span")).toBeVisible();
    await expect(a.locator(".lobby")).not.toHaveClass(/lobby-action-only/);
    const inviteGap = await a.evaluate(() => {
      const cards = document.querySelector(".players")!.getBoundingClientRect();
      const task = document
        .querySelector(".center-stage")!
        .getBoundingClientRect();
      return task.top - cards.bottom;
    });
    expect(inviteGap).toBeGreaterThanOrEqual(12);
    expect(inviteGap).toBeLessThanOrEqual(16);
    const code = (await a.locator(".invite-code span").innerText()).trim();
    await b.goto(baseURL + "/?room=" + code);
    await b.getByLabel("Your name", { exact: true }).fill("Sam");
    await b.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(
      a.getByRole("button", { name: "Ready to argue", exact: true }),
    ).toBeEnabled();
    await expect(
      b.getByRole("button", { name: "Ready to argue", exact: true }),
    ).toBeEnabled();
    const readyButton = await a
      .getByRole("button", { name: "Ready to argue", exact: true })
      .elementHandle();
    await expect(a.locator(".lobby")).toHaveClass(/lobby-action-only/);
    await a.keyboard.press("Tab");
    await a
      .getByRole("button", { name: "Ready to argue", exact: true })
      .focus();
    expect(
      await a
        .locator(".lobby button")
        .evaluate((node) => getComputedStyle(node).outlineColor),
    ).toBe("rgb(216, 255, 62)");
    readyGate.mode = "reject";
    await a
      .getByRole("button", { name: "Ready to argue", exact: true })
      .click();
    await expect(a.locator(".decision-error")).toHaveText(
      "Try readying again.",
    );
    await expect(a.locator(".lobby")).not.toHaveClass(/lobby-action-only/);
    const errorBox = await a.locator(".decision-error").boundingBox();
    const readyBox = await a.locator(".lobby button.primary").boundingBox();
    expect(errorBox!.y).toBeGreaterThanOrEqual(readyBox!.y + readyBox!.height);
    readyGate.mode = "hold";
    await a
      .getByRole("button", { name: "Ready to argue", exact: true })
      .click();
    await expect(
      a.getByRole("button", { name: "Readying…", exact: true }),
    ).toHaveAttribute("aria-busy", "true");
    await expect(a.locator(".lobby")).toHaveClass(/lobby-action-only/);
    await expect.poll(() => !!readyGate.release).toBe(true);
    await expect(
      a.getByRole("button", { name: "Readying…", exact: true }),
    ).toHaveCSS("background-color", "rgb(229, 255, 145)");
    await expect(
      a
        .getByRole("button", { name: "Readying…", exact: true })
        .locator(".icon"),
    ).toHaveCount(0);
    readyGate.mode = "pass";
    readyGate.release!();
    await expect(
      a.getByRole("button", { name: "Ready", exact: true }),
    ).toBeDisabled();
    await expect(
      a.getByRole("button", { name: "Ready", exact: true }),
    ).toHaveCSS("background-color", "rgb(239, 223, 186)");
    await expect(
      a.getByRole("button", { name: "Ready", exact: true }).locator(".icon"),
    ).toHaveCount(1);
    await expect(a.getByRole("button", { name: /undo/i })).toHaveCount(0);
    await expect(a.locator(".lobby")).toHaveClass(/lobby-action-only/);
    expect(await readyButton!.evaluate((node) => node.isConnected)).toBe(true);
    await clickMedia(a, "Mic on");
    await closeMedia(a);
    await expect(
      a.getByRole("button", { name: "Turn mic on", exact: true }),
    ).toBeVisible();
    await expect(a.locator(".lobby")).not.toHaveClass(/lobby-action-only/);
    await a.getByRole("button", { name: "Turn mic on", exact: true }).click();
    await expect(
      a.getByRole("button", { name: "Ready to argue", exact: true }),
    ).toBeEnabled();
    await expect(a.locator(".lobby")).toHaveClass(/lobby-action-only/);
    await a.screenshot({
      path: `output/playwright/polish/lobby-simple-${info.project.name}.png`,
    });
    const base: Snapshot = await (
      await request.post("/__test/state/" + code)
    ).json();
    const [p0, p1] = base.players;
    const present = async (patch: Partial<Snapshot>) => {
      const response = await request.post("/__test/present/" + code, {
        data: patch,
      });
      expect(response.ok()).toBe(true);
    };
    const videos = await a.locator(".face-picture video").elementHandles();
    const geometry = () =>
      a.locator(".face").evaluateAll((nodes) =>
        nodes.map((node) => {
          const video = node
            .querySelector(".face-picture")!
            .getBoundingClientRect();
          const bottom = node
            .querySelector(".face-bottom")!
            .getBoundingClientRect();
          return {
            top: video.top,
            bottom: video.bottom,
            scoreTop: bottom.top,
            scoreBottom: bottom.bottom,
          };
        }),
      );
    const aligned = async () => {
      await expect
        .poll(async () => {
          const [left, right] = await geometry();
          return Math.max(
            ...Object.keys(left).map((key) =>
              Math.abs(
                left[key as keyof typeof left] -
                  right[key as keyof typeof right],
              ),
            ),
          );
        })
        .toBeLessThanOrEqual(1);
    };
    await present({
      phase: "ROUND",
      round: 1,
      roundId: "polish-round",
      matchId: "polish-match",
      headsId: p1.id,
      tailsId: p0.id,
      topic: {
        proposition: "A hot dog is a sandwich.",
        positions: {
          [p0.id]: "It is a sandwich",
          [p1.id]: "It is not a sandwich",
        },
        revision: 1,
        confirmations: [],
      },
      turn: {
        id: "polish-turn",
        inputEpoch: 1,
        inputState: "open",
        inputGrantedAt: Date.now(),
        playerId: p0.id,
        kind: "case",
        durationMs: 30000,
        remainingMs: 23000,
        deadline: Date.now() + 30000,
        pausedReason: null,
        sealing: false,
        targets: { reasoning: 0, rebuttal: 0, impact: 0, wit: 0, clarity: 0 },
      },
    });
    await expect(a.locator(".app")).toHaveClass(/phase-round/);
    const captured: Snapshot = await (
      await request.post("/__test/state/" + code)
    ).json();
    const {
      seq: _seq,
      phaseVersion: _version,
      serverNow: _clock,
      ...ordinary
    } = captured;
    for (const [width, height] of [
      [360, 640],
      [390, 844],
      [390, 741],
      [700, 844],
      [1024, 768],
    ]) {
      await a.setViewportSize({ width, height });
      const result = {
        round: 1,
        roundId: ordinary.roundId!,
        winnerId: p0.id,
        scores: { [p0.id]: 8, [p1.id]: 4 },
        reason: "A clear case.",
      };
      let phoneVideoSize: number[] | undefined;
      for (const patch of [
        { phase: "LOBBY", round: 0, topic: null, turn: null },
        { phase: "TOPIC_SELECT", round: 0, topic: null, turn: null },
        { phase: "TOPIC_CONFIRM", turn: null },
        { phase: "ROUND" },
        {
          phase: "ROUND",
          turn: {
            ...ordinary.turn!,
            deadline: null,
            inputState: "preparing",
            pausedReason: "Preparing microphone",
          },
        },
        { phase: "ROUND_RESOLVE", turn: null, results: [result] },
        {
          phase: "MATCH_RESULT",
          turn: null,
          results: [result],
          winnerId: p0.id,
        },
      ] as Partial<Snapshot>[]) {
        await present({ ...ordinary, ...patch });
        await expect(a.locator(".app")).toHaveClass(
          new RegExp("phase-" + patch.phase!.toLowerCase()),
        );
        await expect
          .poll(() =>
            a.locator(".primary").evaluateAll((buttons) =>
              buttons.every((button) => {
                const busy = button.getAttribute("aria-busy") === "true";
                const hasCue =
                  !busy &&
                  /Ready|Confirm|I’m done|^Rematch$/.test(
                    button.textContent || "",
                  );
                return (
                  button.querySelectorAll(".icon").length === (hasCue ? 1 : 0)
                );
              }),
            ),
          )
          .toBe(true);
        if (width <= 700) {
          const widths = await a.locator(".face-picture").evaluateAll((nodes) =>
            nodes.map((node) => {
              const card = node.closest(".face")!;
              const style = getComputedStyle(card);
              return Math.abs(
                node.getBoundingClientRect().width -
                  (card.clientWidth -
                    parseFloat(style.paddingLeft) -
                    parseFloat(style.paddingRight)),
              );
            }),
          );
          expect(Math.max(...widths)).toBeLessThanOrEqual(1);
          const dimensions = await a
            .locator(".face-picture")
            .evaluateAll((nodes) =>
              nodes.flatMap((node) => {
                const r = node.getBoundingClientRect();
                return [r.width, r.height];
              }),
            );
          phoneVideoSize ??= dimensions;
          dimensions.forEach((value, i) =>
            expect(
              Math.abs(value - phoneVideoSize![i]),
              "Video dimensions stay fixed across phases",
            ).toBeLessThanOrEqual(1),
          );
          if (height > 740) {
            const heights = await a
              .locator(".face-picture")
              .evaluateAll((nodes) =>
                nodes.map((node) => node.getBoundingClientRect().height),
              );
            expect(
              Math.min(...heights),
              "Ordinary tall-phone states retain useful live faces",
            ).toBeGreaterThanOrEqual(220);
          }
        }
        await expect(a.locator(".app")).toHaveClass(
          new RegExp("phase-" + patch.phase!.toLowerCase()),
        );
        await expect
          .poll(
            () =>
              a.evaluate(() =>
                Math.max(
                  document.documentElement.scrollHeight - innerHeight,
                  ...[
                    ...document.querySelectorAll(
                      ".room-scroll,.court-content,.courtroom",
                    ),
                  ].map((el) => el.scrollHeight - el.clientHeight),
                ),
              ),
            {
              message: `${patch.phase} fits ${width}×${height} without page/court scrolling`,
            },
          )
          .toBeLessThanOrEqual(1);
      }
    }
    // Regressions from review 411 combine content that ordinary phase fixtures missed.
    for (const [width, height] of [
      [360, 640],
      [390, 844],
      [1024, 768],
      [1440, 900],
    ]) {
      await a.setViewportSize({ width, height });
      for (const repair of [false, true]) {
        heldRepairPlayer = repair ? p0.id : null;
        await present({
          ...ordinary,
          phase: "MATCH_RESULT",
          turn: null,
          winnerId: p0.id,
          players: base.players.map((player, i) => ({
            ...player,
            name: i ? "Sam" : "Alexandria Catherine",
            wins: i ? 1 : 2,
            mediaReady: !(!i && repair),
            readiness: {
              ...player.readiness,
              setup: player.readiness?.setup || "passed",
              blockers: !i && repair ? ["microphone"] : [],
            },
          })),
          results: [
            {
              round: 1,
              roundId: ordinary.roundId!,
              winnerId: p0.id,
              scores: { [p0.id]: 8, [p1.id]: 4 },
              reason: "A clear case.",
            },
          ],
          judge: {
            id: "long-review-verdict",
            epoch: 999,
            text: "Every word remains readable. ".repeat(80),
            status: "captions",
            startAt: null,
            expression: "neutral",
            targetPlayerId: p0.id,
          },
        });
        await expect(a.locator(".result-panel")).toBeVisible();
        if (width <= 700) {
          const sizes = await a
            .locator(".face-picture")
            .evaluateAll((nodes) =>
              nodes.map((n) => n.getBoundingClientRect().height),
            );
          for (const value of sizes)
            expect(
              Math.abs(value - (height > 740 ? ((width - 44) * 2) / 3 : 96)),
            ).toBeLessThanOrEqual(1);
          await expect(a.locator(".caption-compact-label")).toHaveText(
            "Bonk · Transcript",
          );
          await expect(a.locator(".caption-zone")).toHaveCSS("height", "44px");
        }
        await aligned();
        await expect
          .poll(() =>
            a.evaluate(() =>
              Math.max(
                document.documentElement.scrollHeight - innerHeight,
                ...[
                  ...document.querySelectorAll(".room-scroll,.court-content"),
                ].map((n) => n.scrollHeight - n.clientHeight),
              ),
            ),
          )
          .toBeLessThanOrEqual(1);
        const action = a.locator(".result-panel button.primary");
        const visible = () =>
          action.evaluate((n) => {
            const panel = n.closest(
              innerWidth <= 700 ? ".court-lower" : ".phase-content",
            );
            if (!n.isConnected || !panel) return false;
            const r = n.getBoundingClientRect(),
              p = panel.getBoundingClientRect();
            return r.top >= p.top - 1 && r.bottom <= p.bottom + 1;
          });
        await expect.poll(visible).toBe(true);
        if (repair) {
          const dimensions = await a
            .locator(".face-picture")
            .evaluateAll((nodes) =>
              nodes.map((n) => n.getBoundingClientRect().height),
            );
          const help = a.locator(".result-panel .device-help summary");
          await help.click();
          await expect.poll(visible).toBe(true);
          for (const name of ["Microphone", "Camera"]) {
            const field = a.getByLabel(new RegExp("^" + name));
            await field.focus();
            expect(
              await field.evaluate((node) => {
                const r = node.getBoundingClientRect(),
                  panel = node
                    .closest(
                      innerWidth <= 700 ? ".court-lower" : ".phase-content",
                    )!
                    .getBoundingClientRect();
                return r.top >= panel.top - 1 && r.bottom <= panel.bottom + 1;
              }),
              "Expanded recovery selectors are keyboard reachable",
            ).toBe(true);
          }
          await help.click();
          await action.focus();
          await expect.poll(visible).toBe(true);
          expect(
            await a
              .locator(".face-picture")
              .evaluateAll((nodes) =>
                nodes.map((n) => n.getBoundingClientRect().height),
              ),
          ).toEqual(dimensions);
        }
      }
      heldRepairPlayer = null;
      await present({
        ...ordinary,
        turn: { ...ordinary.turn!, deadline: Date.now() + 30000 },
      });
      await a.evaluate(() =>
        Object.defineProperty(navigator.clipboard, "writeText", {
          configurable: true,
          value: () => Promise.reject(new Error("Clipboard unavailable")),
        }),
      );
      await a.getByRole("button", { name: /Copy invite link/ }).click();
      await expect(a.locator(".room-notice")).toBeVisible();
      await expect
        .poll(() =>
          a.evaluate(() =>
            Math.max(
              document.documentElement.scrollHeight - innerHeight,
              ...[
                ...document.querySelectorAll(".room-scroll,.court-content"),
              ].map((n) => n.scrollHeight - n.clientHeight),
            ),
          ),
        )
        .toBeLessThanOrEqual(1);
      await expect
        .poll(() =>
          a.evaluate(() => {
            const done = document
              .querySelector(".yield-button")!
              .getBoundingClientRect();
            const notice = document
              .querySelector(".notification-area")!
              .getBoundingClientRect();
            const task = document
              .querySelector(".phase-content")!
              .getBoundingClientRect();
            return (
              done.top >= task.top - 1 &&
              done.bottom <= task.bottom + 1 &&
              done.bottom <= notice.top
            );
          }),
        )
        .toBe(true);
      await a
        .getByRole("button", { name: "Dismiss error", exact: true })
        .click();
    }
    await present(ordinary);
    const captureFacts = () =>
      a.locator(".face-0 video").evaluate((node: HTMLVideoElement) =>
        (node.srcObject as MediaStream).getTracks().map((track) => ({
          id: track.id,
          enabled: track.enabled,
          readyState: track.readyState,
        })),
      );
    const gameFacts = async () => {
      const current: Snapshot = await (
        await request.post("/__test/state/" + code)
      ).json();
      return {
        phase: current.phase,
        turn: {
          id: current.turn?.id,
          deadline: current.turn?.deadline,
          pausedReason: current.turn?.pausedReason,
          inputEpoch: current.turn?.inputEpoch,
          inputState: current.turn?.inputState,
        },
        readiness: current.players.map((player) => ({
          mediaReady: player.mediaReady,
          captureReady: player.captureReady,
          cameraOn: player.cameraOn,
        })),
      };
    };
    const captureBefore = await captureFacts(),
      gameBefore = await gameFacts();
    for (const label of ["Friend audio", "Bonk & effects"]) {
      await clickMedia(a, label + " On");
      await expect(
        a.getByRole("button", { name: label + " Off", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      expect(await captureFacts()).toEqual(captureBefore);
      expect(await gameFacts()).toEqual(gameBefore);
      await clickMedia(a, label + " Off");
    }
    await closeMedia(a);
    for (const names of [
      ["Alex", "Sam"],
      ["Alexandria Catherine", "Sam"],
      ["WWWWWWWWWWWWWWWWWWWW", "Sam"],
      ["Sam", "Alexandria Catherine"],
    ]) {
      await present({
        players: base.players.map((player, i) => ({
          ...player,
          name: names[i],
        })),
      });
      await expect(a.locator(".face-0 h2")).toContainText(names[0]);
      for (const [width, height] of [
        [360, 640],
        [390, 844],
        [700, 900],
        [701, 900],
        [768, 1024],
        [959, 900],
        [960, 768],
        [1024, 768],
        [1440, 900],
      ]) {
        await a.setViewportSize({ width, height });
        await a.evaluate(() => document.fonts.ready);
        await aligned();
        expect(
          await a.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (names[0] === "Alex" && (width === 360 || width === 1024)) {
          const action = await a
            .getByRole("button", { name: "I’m done", exact: true })
            .boundingBox();
          const court = await a.locator(".room-scroll").boundingBox();
          expect(action!.y).toBeGreaterThanOrEqual(court!.y);
          expect(action!.y + action!.height).toBeLessThanOrEqual(
            court!.y + court!.height,
          );
        }
      }
    }
    await a.setViewportSize({ width: 360, height: 640 });
    await aligned();
    await a.screenshot({
      path: `output/playwright/polish/aligned-names-${info.project.name}.png`,
    });
    const before = await geometry();
    const caption = "A bread hinge does not stop a sub being a sandwich.";
    await present({
      captions: { [p0.id]: { text: caption, final: true, at: Date.now() } },
      players: base.players.map((player, i) => ({
        ...player,
        name: i ? "Alexandria Catherine" : "Sam",
        scoreUnits: 32,
      })),
    });
    await expect(a.locator(".score").first()).toContainText("8");
    await expect(a.locator(".player-caption .sr-only")).toHaveText(caption);
    expect(await geometry()).toEqual(before);
    // A taller task may recenter the combined group. Card rows stay fixed
    // relative to their shared wrapper, independently of task content.
    const relativeGeometry = async () => {
      const top = await a
        .locator(".players")
        .evaluate((node) => node.getBoundingClientRect().top);
      return (await geometry()).map((box) =>
        Object.fromEntries(
          Object.entries(box).map(([key, value]) => [key, value - top]),
        ),
      );
    };
    const relativeBefore = await relativeGeometry();
    // A tall task must never participate in the shared card row sizing.
    await a.locator(".turn-context").evaluate((node: HTMLElement) => {
      const content = document.createElement("p");
      content.dataset.longTask = "true";
      content.textContent = "Long accessible turn guidance. ".repeat(80);
      node.append(content);
    });
    expect(await relativeGeometry()).toEqual(relativeBefore);
    expect(
      await a
        .locator(".court-lower")
        .evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true);
    expect(
      await a.evaluate(() =>
        [
          document.documentElement,
          ...document.querySelectorAll(".room-scroll,.courtroom"),
        ].every((node) => node.scrollHeight <= node.clientHeight + 1),
      ),
    ).toBe(true);
    await a.locator("[data-long-task]").evaluate((node) => node.remove());
    await present({
      phase: "TOPIC_SELECT",
      round: 0,
      topic: null,
      turn: null,
      phaseDeadline: Date.now() + 90000,
    });
    await expect(a.getByRole("button", { name: "Write your own" })).toHaveCount(
      0,
    );
    await expect(a.locator(".suggestions button")).toHaveCount(3);
    await a.setViewportSize({ width: 1440, height: 900 });
    await a.locator(".suggestions button").first().click();
    await expect(
      a.locator('.side-options button .icon[aria-hidden="true"]'),
    ).toHaveCount(2);
    expect(
      await a.locator(".topic-proposition").evaluate((node) => {
        const text = document.createRange();
        text.selectNodeContents(node);
        return text.getClientRects().length;
      }),
      "The reviewed proposition fits one line at desktop size",
    ).toBe(1);
    await aligned();
    for (const video of videos)
      expect(await video.evaluate((node) => node.isConnected)).toBe(true);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await secondBrowser?.close();
  }
});

test("home diorama fits responsive containers", async ({
  page,
  baseURL,
}, info) => {
  test.skip(
    info.project.name !== "rtc",
    "Shared presentation across transports",
  );
  await page.goto(baseURL!);
  for (const [width, height] of [
    [360, 640],
    [390, 844],
    [700, 900],
    [701, 900],
    [768, 1024],
    [959, 900],
    [960, 768],
    [1024, 768],
    [1280, 720],
    [1440, 900],
    [844, 390],
    [640, 360], // CSS viewport equivalent of 1280×720 at 200% browser zoom.
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(".stage canvas")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const sizes = await page.evaluate(() => {
      const stage = document
        .querySelector(".title-world .stage")!
        .getBoundingClientRect();
      const form = document
        .querySelector(".entry-card")!
        .getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        stage: stage.toJSON(),
        form: form.toJSON(),
      };
    });
    expect(sizes.overflow).toBe(false);
    expect(sizes.stage.left).toBeGreaterThanOrEqual(0);
    expect(sizes.stage.right).toBeLessThanOrEqual(width);
    if (width < 960)
      expect(sizes.form.top).toBeGreaterThanOrEqual(sizes.stage.bottom);
    await page.screenshot({
      path: `output/playwright/polish/home-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".stage canvas").evaluate((canvas: HTMLCanvasElement) => {
    canvas
      .getContext("webgl2")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
  });
  await expect(page.locator(".stage-fallback img")).toBeVisible();
  await expect(page.getByLabel("Your name", { exact: true })).toBeEditable();
});

test("phone layouts: media disclosure keeps privacy, focus and dock clearance", async ({
  browser,
  baseURL,
}, info) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 },
    permissions: ["camera", "microphone"],
  });
  if (info.project.name.startsWith("webkit"))
    await syntheticMicrophone(context);
  const page = await context.newPage();
  try {
    await page.goto(baseURL!);
    await page.getByLabel("Your name", { exact: true }).fill("Alex");
    await page
      .getByRole("button", { name: "Create room", exact: true })
      .click();
    await expect(page.locator(".controls")).toBeVisible();
    const trigger = page.getByRole("button", {
      name: "Mic & camera",
      exact: true,
    });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Mic on", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await openMedia(page);
    await page.keyboard.press("Shift+Tab");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Friend audio On", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Bonk & effects On", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Leave", exact: true }),
    ).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await clickMedia(page, "Mic on");
    await expect(trigger).toContainText("Mic off");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("button", { name: "Mic off", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await clickMedia(page, "Camera on");
    await expect(trigger).toContainText("Both off");
    await clickMedia(page, "Mic off");
    await expect(trigger).toContainText("Camera off");
    await clickMedia(page, "Camera off");
    await expect(trigger).not.toContainText("off");
    for (const label of ["Friend audio", "Bonk & effects"]) {
      await clickMedia(page, label + " On");
      await expect(
        page.getByRole("button", { name: label + " Off", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await clickMedia(page, label + " Off");
      await expect(
        page.getByRole("button", { name: label + " On", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await openMedia(page);
    await page
      .getByRole("button", { name: "How to play", exact: true })
      .click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMedia(page);
    expect(
      await page
        .locator(".media-popover")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
    for (const [width, height] of [
      [360, 640],
      [390, 844],
      [768, 1024],
      [1024, 768],
      [844, 390],
      [640, 360], // CSS viewport equivalent of 1280×720 at 200% browser zoom.
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(250);
      const geometry = await page.evaluate(() => {
        const content = document
          .querySelector(".room-scroll")!
          .getBoundingClientRect();
        const dock = document
          .querySelector(".control-row")!
          .getBoundingClientRect();
        const menu = document
          .querySelector(".media-popover")!
          .getBoundingClientRect();
        const targets = [...document.querySelectorAll(".controls button")].map(
          (n) => n.getBoundingClientRect(),
        );
        return {
          separate: content.bottom <= dock.top + 1,
          inside:
            menu.top >= 0 &&
            menu.left >= 0 &&
            menu.right <= innerWidth &&
            menu.bottom <= dock.bottom,
          targets: targets.every((r) => r.width >= 44 && r.height >= 44),
        };
      });
      expect(geometry).toEqual({ separate: true, inside: true, targets: true });
      // Keyboard focus must scroll the last control into a short popover.
      await page
        .getByRole("button", { name: "Bonk & effects On", exact: true })
        .focus();
      expect(
        await page
          .getByRole("button", { name: "Bonk & effects On", exact: true })
          .evaluate((node) => {
            const control = node.getBoundingClientRect();
            const menu = node
              .closest(".media-popover")!
              .getBoundingClientRect();
            return control.top >= menu.top && control.bottom <= menu.bottom;
          }),
      ).toBe(true);
      await page.getByRole("button", { name: "Mic on", exact: true }).focus();
      await page.screenshot({
        path: `output/playwright/polish/media-${width}-${info.project.name}.png`,
      });
    }
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Create room", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
