import { decodeMicrophone } from "../../shared/media";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { points, type Snapshot } from "../../shared/domain";
import { syntheticMicrophone } from "./synthetic-media";
const root = "output/playwright/ready-together/after";
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
  await expect(a.locator(".room-code b, .invite-code span")).toBeVisible();
  const code = (
    await a.locator(".room-code b, .invite-code span").innerText()
  ).trim();
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
  // Let the camera resize and the 400ms score tally settle before capturing.
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
      [...document.querySelectorAll(".score-burst")].some((node) => {
        if (Number(getComputedStyle(node).opacity) <= 0.01) return false;
        const r = node.getBoundingClientRect();
        return (
          (panel && intersection(r, panel)) ||
          (caption && intersection(r, caption))
        );
      }) ||
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

async function controlsInViewport(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const clipped = await page
    .locator(".app-header button, .controls, .controls button, .phase-content")
    .evaluateAll((nodes) =>
      nodes.flatMap((node) => {
        const r = node.getBoundingClientRect();
        return r.width && (r.top < -1 || r.bottom > innerHeight + 1)
          ? [{ label: node.textContent?.trim(), top: r.top, bottom: r.bottom }]
          : [];
      }),
    );
  expect(clipped).toEqual([]);
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
  const phone = /^(phone|webkit)/.test(info.project.name);
  const viewport = phone
    ? { width: 360, height: 640 }
    : { width: 1280, height: 720 };
  const ca = await browser.newContext({
    isMobile: phone,
    hasTouch: phone,
    recordVideo: { dir: root + "/video", size: { width: 1280, height: 720 } },
    permissions: ["camera", "microphone"],
    viewport,
  });
  // WebKit's mock capture devices are process-wide; model the second phone separately.
  const secondBrowser = info.project.name.startsWith("webkit")
    ? await browser.browserType().launch({ headless: true })
    : null;
  const cb = await (secondBrowser || browser).newContext({
    isMobile: phone,
    hasTouch: phone,
    permissions: ["camera", "microphone"],
    viewport,
  });
  if (info.project.name.startsWith("webkit"))
    await Promise.all([syntheticMicrophone(ca), syntheticMicrophone(cb)]);
  const a = await ca.newPage(),
    b = await cb.newPage();
  const errors: string[] = [];
  const latest = new Map<Page, Snapshot>();
  const observations = new Map<Page, unknown>();
  const microphonePackets = new Map<
    Page,
    { packets: number; audible: number; gameplay: number }
  >();
  const videoPackets = new Map<Page, number>();
  for (const p of [a, b]) {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("websocket", (ws) => {
      ws.on("framesent", ({ payload }) => {
        if (typeof payload !== "string") {
          if (ws.url().endsWith("/video"))
            videoPackets.set(p, (videoPackets.get(p) || 0) + 1);
          if (ws.url().endsWith("/audio")) {
            const counts = microphonePackets.get(p) || {
              packets: 0,
              audible: 0,
              gameplay: 0,
            };
            counts.packets++;
            const frame = decodeMicrophone(payload);
            if (frame?.pcm.some((x) => x !== 0)) counts.audible++;
            if (frame?.purpose === "gameplay" && frame.samples)
              counts.gameplay++;
            microphonePackets.set(p, counts);
          }
          return;
        }
        const data = JSON.parse(payload);
        if (data.command?.type === "media_status")
          observations.set(p, data.command);
      });
      ws.on("framereceived", ({ payload }) => {
        if (typeof payload !== "string") return;
        const data = JSON.parse(payload);
        if (data.snapshot) latest.set(p, data.snapshot);
      });
    });
  }
  const code = await enter(a, b, baseURL!);
  await expect
    .poll(async () => (await snapshot(request, code)).mediaMode)
    .toBe(info.project.name.endsWith("relay") ? "wss" : "rtc");
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
        }, info.project.name.endsWith("relay")),
      )
      .toBeGreaterThan(0);
  }
  const originalVideo = await a
    .locator('.face[aria-label$=", you"] video')
    .elementHandle();
  await a.getByRole("button", { name: "Camera on", exact: true }).click();
  await expect(
    a.getByRole("button", { name: "Camera off", exact: true }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Camera off", exact: true }).click();
  await expect(
    a.getByRole("button", { name: "Camera on", exact: true }),
  ).toBeVisible();
  // Exercise ordinary visibility and page restoration independently of reload.
  for (const suspension of ["visibility", "pagehide"] as const) {
    await b.evaluate((kind) => {
      if (kind === "visibility") {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      } else
        window.dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: true }),
        );
    }, suspension);
    // Let already-sent frames reach the observer, then cover a full RTC probe interval.
    await b.waitForTimeout(150);
    const whileSuspended = videoPackets.get(b) || 0;
    await b.waitForTimeout(850);
    expect(videoPackets.get(b) || 0).toBe(whileSuspended);
    await b.evaluate((kind) => {
      if (kind === "visibility") {
        Reflect.deleteProperty(document, "hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      } else
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        );
    }, suspension);
    await expect
      .poll(() => videoPackets.get(b) || 0)
      .toBeGreaterThan(whileSuspended + 1);
  }
  // A canceled navigation keeps the old document and does not fire pageshow.
  // Both relay frames and RTC delivery probes must resume without device repair.
  await b.route(b.url(), (route) => route.abort("aborted"), { times: 1 });
  await expect(b.reload()).rejects.toThrow();
  const afterAbort = videoPackets.get(b) || 0;
  await expect
    .poll(() => videoPackets.get(b) || 0)
    .toBeGreaterThan(afterAbort + 1);
  await shot(a, "live-lobby-" + info.project.name);
  await expect(a.locator(".player-status")).toHaveCount(0);
  await a.getByRole("button", { name: "Ready to argue" }).click();
  await expect(
    a.locator('.face[aria-label="Alex, you"] .player-status'),
  ).toHaveText("Ready");
  await b.getByRole("button", { name: "Ready to argue" }).click();
  await expect
    .poll(async () => (await snapshot(request, code)).phase)
    .toBe("TOPIC_SELECT");
  const state = await snapshot(request, code);
  const tails =
    state.players.find((p) => p.id === state.tailsId)?.name === "Alex" ? a : b;
  await tails.getByRole("button", { name: "Is a hot dog a sandwich?" }).click();
  await tails
    .getByRole("button", { name: "It is a sandwich", exact: true })
    .click();
  await expect(
    a.getByRole("button", { name: "Confirm my side" }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Choose another topic" }).click();
  await tails.getByRole("button", { name: "Write your own" }).click();
  await tails
    .getByLabel("The argument", { exact: true })
    .fill("A hot dog is a sandwich.");
  await tails.getByLabel("Your side", { exact: true }).fill("It is a sandwich");
  await tails.getByRole("button", { name: "Propose it" }).click();
  await expect(
    a.getByRole("button", { name: "Confirm my side" }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Confirm my side" }).click();
  await b.getByRole("button", { name: "Confirm my side" }).click();
  let opportunities = 0;
  const heldKinds = new Set<string>();
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
    await expect(
      speaker.getByRole("button", { name: "I’m done", exact: true }),
    ).toBeEnabled();
    await expect(
      listener.getByRole("button", { name: "I’m done", exact: true }),
    ).toHaveCount(0);
    microphonePackets.delete(listener);
    await expect
      .poll(() => microphonePackets.get(listener)?.packets || 0)
      .toBeGreaterThan(5);
    expect(microphonePackets.get(listener)?.gameplay).toBe(0);
    if (s.mediaMode === "rtc")
      expect(microphonePackets.get(listener)?.audible).toBe(0);
    if (opportunities === 0) {
      await speaker
        .getByRole("button", { name: "Mic on", exact: true })
        .click();
      await expect(
        speaker.getByRole("button", { name: "Mic off", exact: true }),
      ).toBeVisible();
      await expect
        .poll(async () => (await snapshot(request, code)).phase)
        .toBe("RECOVERING");
      const frozen = await snapshot(request, code);
      await speaker
        .getByRole("button", { name: "Mic off", exact: true })
        .click();
      await expect
        .poll(async () => (await snapshot(request, code)).phase)
        .toBe("ROUND");
      expect((await snapshot(request, code)).turn?.id).toBe(frozen.turn?.id);
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
    if (!heldKinds.has(s.turn!.kind)) {
      heldKinds.add(s.turn!.kind);
      expect((await request.post("/__test/judge/" + code + "/hold")).ok()).toBe(
        true,
      );
      await expect
        .poll(async () => (await snapshot(request, code)).judgePending)
        .toBe(true);
      const name = s.players.find((p) => p.id === s.turn!.playerId)!.name;
      for (const page of [speaker, listener]) {
        const label = `${page === speaker ? "Your" : name + "’s"} ${s.turn!.kind}`;
        await expect(page.locator(".turn-label")).toHaveText(label);
        await expect(page.locator(".listening-badge")).toHaveText("Listening");
        await expect(
          page.locator(".turn-label[aria-live], .turn-label[role=status]"),
        ).toHaveCount(0);
        await expect(
          page.locator(".player-status").filter({ hasText: "Chat is on" }),
        ).toHaveCount(0);
        await expect(page.locator('.app > [aria-live="polite"]')).toHaveText(
          `Round ${s.round}. ${label}`,
        );
      }
      const clocks = await Promise.all(
        [a, b].map((p) => p.locator(".timer").innerText()),
      );
      await expect
        .poll(async () => {
          const next = await Promise.all(
            [a, b].map((p) => p.locator(".timer").innerText()),
          );
          return next.every(
            (clock, i) => parseInt(clock) < parseInt(clocks[i]),
          );
        })
        .toBe(true);
      await expect(
        speaker.getByRole("button", { name: "I’m done", exact: true }),
      ).toBeEnabled();
      await expect(
        listener.getByRole("button", { name: "I’m done", exact: true }),
      ).toHaveCount(0);
      expect(
        await speaker
          .locator('.face[aria-label$=", you"] video')
          .evaluate(
            (v: HTMLVideoElement) =>
              (v.srcObject as MediaStream).getAudioTracks()[0].enabled,
          ),
      ).toBe(true);
      await shot(
        speaker,
        `background-judging-${s.turn!.kind}-${info.project.name}`,
      );
      if (opportunities < 3) await controlsInViewport(speaker);
      await request.post("/__test/judge/" + code + "/release");
      await expect
        .poll(async () => !(await snapshot(request, code)).judgePending)
        .toBe(true);
    }
    if (opportunities === 3) {
      const before = await snapshot(request, code);
      await request.post("/__test/failure/" + code + "/speech-check");
      await expect
        .poll(async () => (await snapshot(request, code)).phase)
        .toBe("RECOVERING");
      await speaker
        .getByRole("button", { name: "Check mic & camera", exact: true })
        .click();
      await expect
        .poll(async () => (await snapshot(request, code)).phase)
        .toBe("ROUND");
      expect((await snapshot(request, code)).turn?.id).toBe(before.turn?.id);
      await expect(speaker.locator(".typed-recovery")).toHaveCount(0);
    }
    if (opportunities === 1) {
      await speaker
        .getByRole("button", { name: "Mic on", exact: true })
        .click();
      await listener
        .getByRole("button", { name: "Camera on", exact: true })
        .click();
      await expect
        .poll(async () => (await snapshot(request, code)).phase)
        .toBe("RECOVERING");
      const held = await snapshot(request, code);
      await shot(speaker, "overlapping-recovery-" + info.project.name);
      await controlsInViewport(speaker);
      await speaker
        .getByRole("button", { name: "Mic off", exact: true })
        .click();
      await speaker.waitForTimeout(1300);
      const partial = await snapshot(request, code);
      expect(partial.phase).toBe("RECOVERING");
      expect(partial.turn?.remainingMs).toBe(held.turn?.remainingMs);
      expect(partial.players.map((p) => p.scoreUnits)).toEqual(
        held.players.map((p) => p.scoreUnits),
      );
      await listener
        .getByRole("button", { name: "Camera off", exact: true })
        .click();
      await expect
        .poll(async () => (await snapshot(request, code)).phase)
        .toBe("ROUND");
      expect((await snapshot(request, code)).turn?.id).toBe(held.turn?.id);
    }
    if (opportunities === 5) {
      const oldMic = await listener
        .locator('.face[aria-label$=", you"] video')
        .evaluate(
          (v: HTMLVideoElement) =>
            (v.srcObject as MediaStream).getAudioTracks()[0].id,
        );
      await listener
        .locator('.face[aria-label$=", you"] video')
        .evaluate((v: HTMLVideoElement) => {
          const camera = (v.srcObject as MediaStream).getVideoTracks()[0];
          camera.stop();
          camera.dispatchEvent(new Event("ended"));
        });
      await expect
        .poll(async () => (await snapshot(request, code)).phase)
        .toBe("RECOVERING");
      await listener
        .getByRole("button", { name: "Restart camera", exact: true })
        .click();
      await expect
        .poll(async () => (await snapshot(request, code)).phase)
        .toBe("ROUND");
      expect(
        await listener
          .locator('.face[aria-label$=", you"] video')
          .evaluate(
            (v: HTMLVideoElement) =>
              (v.srcObject as MediaStream).getAudioTracks()[0].id,
          ),
      ).toBe(oldMic);
    }
    await speaker
      .getByRole("button", { name: "I’m done", exact: true })
      .click();
    opportunities++;
    await expect
      .poll(async () => {
        const next = await snapshot(request, code);
        return next.phase === "MATCH_RESULT" || next.turn?.id !== s.turn?.id;
      })
      .toBe(true);
    // Compare the actual values, independent of REST/WebSocket property order.
    const committed = await snapshot(request, code);
    for (const page of [a, b])
      await expect
        .poll(() => {
          const received = latest.get(page);
          return (
            received && {
              current: received.seq >= committed.seq,
              matchId: received.matchId,
              roundId: received.roundId,
              ledger: received.ledger,
              totals: received.players.map((p) => p.scoreUnits),
            }
          );
        })
        .toEqual({
          current: true,
          matchId: committed.matchId,
          roundId: committed.roundId,
          ledger: committed.ledger,
          totals: committed.players.map((p) => p.scoreUnits),
        });
    if (opportunities === 4) {
      microphonePackets.delete(b);
      // Keep the old document alive after beforeunload. WebKit rejects Blob
      // work in this interval even though document.hidden is still false.
      await b.evaluate(() => {
        window.addEventListener(
          "beforeunload",
          () => {
            document.documentElement.dataset.beforeReload = "true";
          },
          { once: true },
        );
      });
      await b.route(
        b.url(),
        async (route) => {
          // Chromium blocks evaluate until navigation completes. Inject this
          // WebKit-specific fault where the old document remains executable.
          if (info.project.name.startsWith("webkit")) {
            expect(
              await b.evaluate(
                () => document.documentElement.dataset.beforeReload,
              ),
            ).toBe("true");
            // A foreground event must not undo pending navigation suspension.
            // This event pair is injected; beforeunload above is native.
            await b.evaluate(() => {
              const hidden = Object.getOwnPropertyDescriptor(
                document,
                "hidden",
              );
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: true,
              });
              document.dispatchEvent(new Event("visibilitychange"));
              if (hidden) Object.defineProperty(document, "hidden", hidden);
              else Reflect.deleteProperty(document, "hidden");
              document.dispatchEvent(new Event("visibilitychange"));
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
          await route.continue();
        },
        { times: 1 },
      );
      await b.reload();
      await expect(b.locator(".courtroom")).toBeVisible();
      // A fresh page repairs devices from a tap, including Safari audio unlock.
      await b
        .getByRole("button", { name: "Check mic & camera", exact: true })
        .click();
      await expect
        .poll(async () =>
          (await snapshot(request, code)).players.every((p) => p.mediaReady),
        )
        .toBe(true)
        .catch(async (error) => {
          const debug = {
            state: await snapshot(request, code),
            observations: [...observations.values()],
            microphonePackets: microphonePackets.get(b),
            setup: await b.locator(".setup-status").allTextContents(),
            capture: await b.evaluate(() => ({
              videos: [...document.querySelectorAll("video")].map((v) =>
                (v.srcObject as MediaStream | null)?.getTracks().map((t) => ({
                  kind: t.kind,
                  enabled: t.enabled,
                  muted: t.muted,
                  state: t.readyState,
                })),
              ),
            })),
          };
          await info.attach("reconnect-state", {
            body: JSON.stringify(debug, null, 2),
            contentType: "application/json",
          });
          console.log("Reconnect diagnostics:", JSON.stringify(debug));
          throw error;
        });
    }
  }
  expect([12, 18]).toContain(opportunities);
  expect([...heldKinds].sort()).toEqual(["case", "closing", "rebuttal"]);
  expect(await originalVideo!.evaluate((v) => v.isConnected)).toBe(true);
  const result = await snapshot(request, code);
  expect(result.ledger.length).toBeGreaterThan(0);
  expect(result.players.find((p) => p.id === result.winnerId)?.name).toBe(
    "Alex",
  );
  await expect(a.locator(".result-panel h2")).toContainText("Alex");
  await expect(b.locator(".result-panel h2")).toContainText("Alex");
  for (const page of [a, b])
    await expect
      .poll(() => page.locator(".score-numbers").allTextContents())
      .toEqual(result.players.map((p) => points(p.scoreUnits)));
  await shot(a, "live-result-" + info.project.name);
  await noOverlap(a);
  await controlsInViewport(a);
  if (phone) {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await a.setViewportSize(viewport);
      await noOverlap(a);
      if (viewport.height > 500) await controlsInViewport(a);
      await shot(a, `phone-result-${viewport.width}-${info.project.name}`);
      expect(
        await a
          .locator(".controls button, .result-panel button")
          .evaluateAll((nodes) =>
            nodes.every((n) => n.getBoundingClientRect().height >= 44),
          ),
      ).toBe(true);
    }
    await a.setViewportSize({ width: 360, height: 640 });
  }
  await a.getByRole("button", { name: "Rematch" }).click();
  await expect(
    a.getByRole("button", { name: "Waiting for Sam", exact: true }),
  ).toBeDisabled();
  await expect(
    a.locator('.face[aria-label="Alex, you"] .player-status'),
  ).toHaveText("Ready");
  await expect(a.locator(".result-panel .support-copy")).toHaveCount(0);
  for (const page of [a, b]) await controlsInViewport(page);
  await shot(a, "live-rematch-ready-" + info.project.name);
  await b.getByRole("button", { name: "Rematch" }).click();
  await expect
    .poll(async () => (await snapshot(request, code)).phase)
    .toBe("INTRO_COIN");
  const rematch = await snapshot(request, code);
  expect(rematch.matchId).not.toBe(result.matchId);
  for (const page of [a, b]) {
    await expect
      .poll(() => {
        const received = latest.get(page);
        return (
          received?.matchId === rematch.matchId &&
          received.ledger.length === 0 &&
          received.players.every((p) => p.scoreUnits === 0 && p.wins === 0)
        );
      })
      .toBe(true);
    await expect(page.locator(".score-burst")).toHaveCount(0);
    await expect(page.locator(".score")).toHaveCount(0);
  }
  await a.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(
    a.getByRole("button", { name: "Create room", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  const video = a.video();
  await ca.close();
  await cb.close();
  await secondBrowser?.close();
  await video?.saveAs(root + "/match-" + info.project.name + ".webm");
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
    degraded: { tts: false },
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
    inputEpoch: 1,
    inputState: "open" as const,
    inputGrantedAt: Date.now(),
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
    if (width >= 1280) await controlsInViewport(a);
    await shot(a, "round-" + width);
    await expect(a.locator(".turn-label")).toHaveText("Your rebuttal");
  }
  const grayscale = await a.addStyleTag({
    content: "html { filter: grayscale(1); }",
  });
  await shot(a, "round-grayscale-390");
  await grayscale.evaluate((node) => node.parentNode?.removeChild(node));
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
    degraded: { tts: true },
  });
  await expect(a.locator(".caption-status")).toHaveCount(0);
  await shot(a, "judge-1280");
  await expect(a.locator(".turn-label")).toContainText("Bonk’s getting ready…");
  await expect(a.locator('.app > [aria-live="polite"]')).toHaveText(
    "Round 1. Bonk’s getting ready…",
  );
  await present({
    phase: "ROUND",
    turn: { ...turn(), deadline: null, pausedReason: "judging", sealing: true },
    judgePending: true,
  });
  await expect(a.locator(".turn-label")).toHaveText("Finishing Alex’s words…");
  await expect(a.locator('.app > [aria-live="polite"]')).toHaveText(
    "Round 1. Finishing Alex’s words…",
  );
  await expect(
    a.getByRole("button", { name: "I’m done", exact: true }),
  ).toHaveCount(0);
  await shot(a, "sealing-1280");
  await expect(a.locator(".turn-label")).toHaveText("Finishing Alex’s words…");
  expect((await snapshot(request, code)).phase).toBe("ROUND");

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
  await controlsInViewport(a);
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
  for (const [width, height] of [
    [1280, 720],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
  ]) {
    await a.setViewportSize({ width, height });
    await present({
      phase: "MATCH_RESULT",
      round: 2,
      turn: null,
      players: players.map((p, i) => ({ ...p, wins: i ? 0 : 2 })),
      results,
      winnerId: p0.id,
    });
    await controlsInViewport(a);
    await present({
      phase: "MATCH_RESULT",
      round: 2,
      turn: null,
      players: players.map((p, i) => ({ ...p, wins: i ? 0 : 2 })),
      results,
      winnerId: p0.id,
      rematchReady: [p0.id],
    });
    await expect(
      a.getByRole("button", { name: "Waiting for Sam", exact: true }),
    ).toBeDisabled();
    await controlsInViewport(a);
    await shot(a, `rematch-ready-${width}`);
  }
  await a.setViewportSize({ width: 1280, height: 720 });
  // A healthy player's rematch screen still names the friend's actual blocker.
  await present({
    phase: "MATCH_RESULT",
    round: 2,
    turn: null,
    players: players.map((p, i) => ({
      ...p,
      wins: i ? 0 : 2,
    })),
    results,
    winnerId: p0.id,
  });
  await b.getByRole("button", { name: "Mic on", exact: true }).click();
  await expect(a.locator(".result-panel .support-copy")).toHaveText(
    "Waiting for Sam’s mic.",
  );
  await expect(a.locator('.app > [aria-live="polite"]')).toHaveText(
    "Waiting for Sam’s mic.",
  );
  await expect(
    a.getByRole("button", { name: "Rematch", exact: true }),
  ).toBeEnabled();
  await expect(
    b.getByRole("button", { name: "Turn mic on", exact: true }),
  ).toBeVisible();
  await shot(a, "rematch-peer-mic-1280");
  await b.getByRole("button", { name: "Turn mic on", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot(request, code)).players.every((p) => p.mediaReady),
    )
    .toBe(true);
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

test("phone layouts preserve full captions, user wording and a single status owner", async ({
  browser,
  baseURL,
  request,
}, info) => {
  const webkit = info.project.name.startsWith("webkit");
  const secondBrowser = webkit
    ? await browser.browserType().launch({ headless: true })
    : null;
  const ca = await browser.newContext({
    permissions: ["camera", "microphone"],
  });
  const cb = await (secondBrowser || browser).newContext({
    permissions: ["camera", "microphone"],
  });
  if (webkit)
    await Promise.all([syntheticMicrophone(ca), syntheticMicrophone(cb)]);
  const a = await ca.newPage(),
    b = await cb.newPage();
  try {
    await a.goto(baseURL!);
    await expect(
      a.getByLabel("Your name", { exact: true }),
    ).not.toHaveAttribute("placeholder");
    await a.getByRole("button", { name: "How to play" }).focus();
    await a.keyboard.press("Enter");
    await expect(a.getByRole("dialog")).toContainText(
      "Chat anytime. Bonk scores whoever has the floor.",
    );
    await a.keyboard.press("Escape");
    await expect(a.getByRole("button", { name: "How to play" })).toBeFocused();
    const code = await enter(a, b, baseURL!);
    const base = await snapshot(request, code),
      [p0, p1] = base.players;
    const topic = {
      proposition: 'My take: "Soup = a drink?!" <ask me why>',
      positions: {
        [p0.id]: "YES!!! (even with a spoon)",
        [p1.id]: "Nope... soup stays soup.",
      },
      revision: 1,
      confirmations: [],
    };
    const turn = {
      id: "copy-turn",
      inputEpoch: 1,
      inputState: "open" as const,
      inputGrantedAt: Date.now(),
      playerId: p0.id,
      kind: "rebuttal" as const,
      durationMs: 30000,
      remainingMs: 30000,
      deadline: Date.now() + 30000,
      pausedReason: null,
      sealing: false,
      targets: { reasoning: 0, rebuttal: 0, impact: 0, wit: 0, clarity: 0 },
    };
    const present = async (patch: Partial<Snapshot>) => {
      const response = await request.post("/__test/present/" + code, {
        data: {
          topic,
          headsId: p0.id,
          tailsId: p1.id,
          round: 1,
          roundId: "copy-round",
          turn: null,
          judge: null,
          judgePending: false,
          captions: {},
          results: [],
          ledger: [],
          winnerId: null,
          rematchReady: [],
          recoveryDeadline: null,
          phaseDeadline: Date.now() + 60000,
          ...patch,
        },
      });
      expect(response.ok()).toBe(true);
      await expect(a.locator(".app")).toHaveClass(
        new RegExp("phase-" + patch.phase!.toLowerCase()),
      );
    };
    await present({ phase: "TOPIC_CONFIRM", round: 0 });
    await expect(a.locator(".arena-heading h1")).toHaveText(topic.proposition);
    await expect(a.locator(".position")).toHaveText(
      Object.values(topic.positions),
    );
    await expect(
      a.locator(".topic-panel h2, .topic-panel > p:not(.decision-clock)"),
    ).toHaveCount(0);
    await expect(
      a.getByRole("button", { name: "Confirm my side" }),
    ).toBeEnabled();
    await shot(a, "simple-confirm-" + info.project.name);
    await present({
      phase: "TOPIC_CONFIRM",
      round: 0,
      topic: { ...topic, confirmations: [p0.id] },
    });
    await expect(a.locator(".topic-panel > p:not(.decision-clock)")).toHaveText(
      "Waiting for Sam to confirm.",
    );
    await expect(a.locator(".player-status")).toHaveText("Confirmed");
    await expect(a.getByRole("button", { name: "Confirmed" })).toBeDisabled();
    await shot(a, "simple-confirmed-" + info.project.name);
    const transcript =
      'FIRST WORDS: I said "soup?!", not SOUP.\n' +
      "A spoon does not settle this. I drink soup from a mug; Sam uses a bowl. ".repeat(
        9,
      ) +
      "\nLAST WORDS: <please keep every word>.";
    for (const [width, height] of [
      [1280, 720],
      [360, 640],
      [390, 844],
      [844, 390],
    ]) {
      await a.setViewportSize({ width, height });
      await present({
        phase: "ROUND",
        turn: { ...turn, deadline: Date.now() + 30000 },
        captions: {
          [p0.id]: { text: transcript, final: true, at: Date.now() },
        },
      });
      // Exact textContent catches deletion, trimming, normalization and inserted copy.
      expect(await a.locator(".player-caption p").textContent()).toBe(
        transcript,
      );
      await expect(a.locator(".turn-label")).toHaveText("Your rebuttal");
      await expect(b.locator(".turn-label")).toHaveText("Alex’s rebuttal");
      await expect(a.locator(".player-status")).toHaveText("Listening");
      await expect(
        a.locator(".turn-label[aria-live], .turn-label[role=status]"),
      ).toHaveCount(0);
      await noOverlap(a);
      const unclipped = await a
        .locator(".player-caption p")
        .evaluate(
          (p) =>
            p.scrollHeight <= p.clientHeight + 1 &&
            getComputedStyle(p).webkitLineClamp === "none",
        );
      expect(unclipped).toBe(true);
      await shot(a, `full-caption-${width}-${info.project.name}`);
      expect(await a.locator(".player-caption p").textContent()).toBe(
        transcript,
      );
    }
    await a.setViewportSize({ width: 390, height: 844 });
    const line =
      'My ruling: "soup remains suspicious." Every last word stays here.';
    const judge = {
      id: "copy-speech",
      epoch: 300,
      text: line,
      status: "buffering" as const,
      expression: "smug" as const,
      targetPlayerId: p1.id,
      startAt: null,
    };
    await present({
      phase: "ROUND",
      turn: { ...turn, deadline: null, pausedReason: "judge" },
      judge,
    });
    await expect(a.locator(".turn-label")).toHaveText("Bonk’s getting ready…");
    await expect(a.locator(".caption-status, .listening-badge")).toHaveCount(0);
    expect(await a.locator(".judge-caption p").textContent()).toBe(line);
    const faceTops = await a
      .locator(".face-picture")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().top + window.scrollY),
      );
    await shot(a, "simple-buffering-" + info.project.name);
    await present({
      phase: "ROUND",
      turn: { ...turn, deadline: null, pausedReason: "judge" },
      judge: { ...judge, status: "captions" },
    });
    await expect(a.locator(".turn-label")).toHaveText("Bonk · captions only");
    await a.emulateMedia({ reducedMotion: "reduce" });
    await expect(a.locator(".app")).toHaveClass(/reduced-motion/);
    await expect(a.locator(".turn-label")).toHaveCSS("animation-name", "none");
    await noOverlap(a);
    await shot(a, "simple-captions-only-" + info.project.name);
    await present({
      phase: "ROUND",
      turn: { ...turn, deadline: Date.now() + 30000 },
    });
    await expect(a.locator(".turn-label")).toHaveText("Your rebuttal");
    expect(
      await a
        .locator(".face-picture")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getBoundingClientRect().top + window.scrollY),
        ),
    ).toEqual(faceTops);
    await expect(a.getByRole("button", { name: "I’m done" })).toBeEnabled();
    await present({
      phase: "INTRO_COIN",
      round: 0,
      topic: null,
      judge: { ...judge, status: "captions" },
    });
    await expect(a.locator(".caption-heading .caption-status")).toHaveText(
      "Captions only",
    );
    await expect(a.locator(".player-status")).toHaveCount(0);
  } finally {
    await ca.close();
    await cb.close();
    await secondBrowser?.close();
  }
});

test("mandatory device setup, retries, cancellation, clipboard failure and missing scene", async ({
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
    const w = window as unknown as {
      deviceMode: string;
      deviceRequests: MediaStreamConstraints[];
    };
    w.deviceMode = "denied";
    w.deviceRequests = [];
    navigator.mediaDevices.getUserMedia = (constraints) => {
      w.deviceRequests.push(constraints || {});
      if (w.deviceMode === "denied")
        return Promise.reject(
          new DOMException("Permission denied", "NotAllowedError"),
        );
      if (w.deviceMode === "missing")
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
  await expect(page.locator(".setup-status")).toContainText(
    "Allow your mic and camera",
  );
  await expect(page.locator(".courtroom")).toHaveCount(0);
  let seat = await page.evaluate(() => sessionStorage.getItem("hmo-seat"));
  await shot(page, "permissions-denied");
  const help = page.locator(".device-help summary");
  await help.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel(/^Microphone/)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel(/^Camera/)).toBeFocused();
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel(/^Microphone/)).toBeHidden();
  await expect(help).toBeFocused();
  await page.evaluate(() => {
    (window as unknown as { deviceMode: string }).deviceMode = "missing";
  });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".setup-status")).toContainText(
    "Connect a microphone and camera",
  );
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { deviceRequests: MediaStreamConstraints[] }
      ).deviceRequests.every((c) => !!c.audio && !!c.video),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem("hmo-seat"))).toBe(
    seat,
  );
  await shot(page, "camera-required");
  const cancelledCode = JSON.parse(seat!).code as string;
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create room", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.post(baseURL + "/__test/state/" + cancelledCode)
          ).json()
        ).players.length,
    )
    .toBe(0);
  await page.evaluate(() => {
    (window as unknown as { deviceMode: string }).deviceMode = "ok";
  });
  await page.request.post(baseURL + "/__test/provider", {
    data: { speechDelay: 2200 },
  });
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(page.locator(".setup-status")).toContainText(
    "Say ‘Bonk, hear me out.’",
  );
  seat = await page.evaluate(() => sessionStorage.getItem("hmo-seat"));
  await expect
    .poll(() =>
      page
        .locator(".setup-preview video")
        .evaluate((v: HTMLVideoElement) => v.videoWidth),
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".private-check-label")).toHaveText(
    "Private mic check",
  );
  await expect(
    page.getByRole("button", { name: "Checking…", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Back", exact: true }),
  ).toBeEnabled();
  await shot(page, "inline-setup");
  await expect(
    page.getByRole("heading", { name: "Invite your friend" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waiting for your friend", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("hmo-seat"))).toBe(
    seat,
  );
  await page.locator(".room-code, .invite-code").click();
  await expect(page.locator(".room-notice")).toContainText(
    "Couldn’t copy the link. Share room code",
  );
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

test("fresh awards animate once, restore silently, and honor reduced motion", async ({
  browser,
  baseURL,
  request,
}, info) => {
  const ca = await browser.newContext({
    permissions: ["camera", "microphone"],
  });
  const cb = await browser.newContext({
    permissions: ["camera", "microphone"],
  });
  const a = await ca.newPage(),
    b = await cb.newPage();
  for (const page of [a, b])
    await page.addInitScript(() => {
      const w = window as unknown as { awards: string[] };
      w.awards = [];
      const seen = new Set<string>();
      new MutationObserver(() => {
        document.querySelectorAll("[data-award-id]").forEach((node) => {
          for (const id of node.getAttribute("data-award-ids")!.split(" "))
            if (!seen.has(id)) {
              seen.add(id);
              w.awards.push(id);
            }
        });
      }).observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-award-ids"],
      });
    });
  const ids = (page: Page) =>
    page.evaluate(() => (window as unknown as { awards: string[] }).awards);
  const code = await enter(a, b, baseURL!);
  await a.getByRole("button", { name: "Ready to argue" }).click();
  await b.getByRole("button", { name: "Ready to argue" }).click();
  await expect
    .poll(async () => (await snapshot(request, code)).phase)
    .toBe("TOPIC_SELECT");
  let state = await snapshot(request, code);
  const chooser =
    state.players.find((p) => p.id === state.tailsId)?.name === "Alex" ? a : b;
  await chooser
    .getByRole("button", { name: "Is a hot dog a sandwich?" })
    .click();
  await chooser
    .getByRole("button", { name: "It is a sandwich", exact: true })
    .click();
  for (const page of [a, b])
    await page.getByRole("button", { name: "Confirm my side" }).click();
  await expect
    .poll(async () => {
      const s = await snapshot(request, code);
      return s.phase === "ROUND" && s.turn && !s.turn.pausedReason;
    })
    .toBeTruthy();
  const award = async (quality: number) => {
    const response = await request.post("/__test/award/" + code, {
      data: { quality },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()) as { ids: string[]; snapshot: Snapshot };
  };
  const first = await award(1);
  expect(first.ids.length).toBeGreaterThan(1);
  for (const page of [a, b]) {
    await expect(page.locator(".bonk-aside")).toHaveText(
      /Bonk · .*Uses a sub as a counterexample/,
    );
    await expect(page.locator(".bonk-aside")).toHaveCount(1);
  }
  await shot(a, "bonk-aside-" + info.project.name);
  for (const page of [a, b])
    await expect.poll(() => ids(page)).toEqual(first.ids);
  await a.screenshot({
    path: root + "/live-awards-" + info.project.name + ".png",
    animations: "allow",
  });
  const second = await award(2);
  for (const page of [a, b]) {
    await expect.poll(() => ids(page)).toEqual([...first.ids, ...second.ids]);
    await expect
      .poll(() => page.locator(".score-numbers").allTextContents())
      .toEqual(second.snapshot.players.map((p) => points(p.scoreUnits)));
    const bounds = await page.locator(".score").first().boundingBox();
    expect(bounds?.width).toBeGreaterThan(100);
  }
  await expect(a.locator(".score-burst")).toHaveCount(0);
  for (const page of [a, b]) {
    await expect(page.locator(".score-note")).toHaveCount(0);
    expect((await snapshot(request, code)).ledger).toEqual(
      second.snapshot.ledger,
    );
  }
  await request.post("/__test/replay/" + code);
  for (const page of [a, b]) {
    await expect(page.locator(".score-burst")).toHaveCount(0);
    expect(await ids(page)).toEqual([...first.ids, ...second.ids]);
    await expect(page.locator(".bonk-aside")).toHaveCount(0);
  }
  await a.emulateMedia({ reducedMotion: "reduce" });
  await a.getByRole("button", { name: "Audio", exact: true }).click();
  await a.getByRole("button", { name: "Bonk & effects On" }).click();
  await a.keyboard.press("Escape");
  const third = await award(3);
  await expect(a.locator(".score-burst").first()).toBeVisible();
  expect(
    await a
      .locator(".score-burst")
      .first()
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  await expect
    .poll(() => a.locator(".score-numbers").allTextContents())
    .toEqual(third.snapshot.players.map((p) => points(p.scoreUnits)));
  await a.emulateMedia({ reducedMotion: "no-preference" });
  const fourth = await award(4);
  await expect(b.locator(".score-burst").first()).toBeVisible();
  await b.reload();
  await expect(b.locator(".courtroom")).toBeVisible();
  await expect(b.locator(".score-burst")).toHaveCount(0);
  expect(await ids(b)).toEqual([]);
  await expect
    .poll(() => b.locator(".score-numbers").allTextContents())
    .toEqual(fourth.snapshot.players.map((p) => points(p.scoreUnits)));
  await request.post("/__test/replay/" + code);
  await expect(b.locator(".score-burst")).toHaveCount(0);
  expect(await ids(b)).toEqual([]);
  await ca.close();
  await cb.close();
});

test("busy scoring combines gains without collisions in either motion setting", async ({
  browser,
  baseURL,
  request,
}, info) => {
  const ca = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: root + "/video", size: { width: 1280, height: 720 } },
  });
  const cb = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 1366, height: 768 },
    reducedMotion: "reduce",
  });
  const a = await ca.newPage(),
    b = await cb.newPage();
  const code = await enter(a, b, baseURL!);
  for (const page of [a, b])
    await page.getByRole("button", { name: "Ready to argue" }).click();
  await expect
    .poll(async () => (await snapshot(request, code)).phase)
    .toBe("TOPIC_SELECT");
  const state = await snapshot(request, code);
  const chooser =
    state.players.find((p) => p.id === state.tailsId)?.name === "Alex" ? a : b;
  await chooser
    .getByRole("button", { name: "Is a hot dog a sandwich?" })
    .click();
  await chooser
    .getByRole("button", { name: "It is a sandwich", exact: true })
    .click();
  for (const page of [a, b])
    await page.getByRole("button", { name: "Confirm my side" }).click();
  await expect
    .poll(async () => {
      const s = await snapshot(request, code);
      return s.phase === "ROUND" && s.turn && !s.turn.pausedReason;
    })
    .toBeTruthy();
  type Audit = {
    frames: number;
    visibleFrames: number;
    maxVisible: number;
    collisions: string[][];
    mounts: string[];
    labels: Record<string, string>;
    lifetimes: number[];
    firstEmpty: number | null;
  };
  const heights = new Map<Page, number[]>();
  for (const page of [a, b]) {
    heights.set(
      page,
      await page
        .locator(".face")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getBoundingClientRect().height),
        ),
    );
    await page.evaluate(() => {
      const audit: Audit = {
        frames: 0,
        visibleFrames: 0,
        maxVisible: 0,
        collisions: [],
        mounts: [],
        labels: {},
        lifetimes: [],
        firstEmpty: null,
      };
      (window as unknown as { awardAudit: Audit }).awardAudit = audit;
      const mounted = new Map<Element, number>();
      const sample = () => {
        audit.frames++;
        const nodes = [
          ...document.querySelectorAll<HTMLElement>(".score-burst"),
        ];
        for (const node of nodes)
          if (!mounted.has(node)) {
            mounted.set(node, performance.now());
            audit.mounts.push(node.dataset.awardId!);
            audit.labels[node.dataset.awardId!] = node.textContent!;
          }
        for (const [node, at] of mounted)
          if (!node.isConnected) {
            audit.lifetimes.push(performance.now() - at);
            mounted.delete(node);
          }
        const visible = nodes.filter(
          (node) => Number(getComputedStyle(node).opacity) > 0.01,
        );
        audit.maxVisible = Math.max(audit.maxVisible, visible.length);
        if (visible.length) audit.visibleFrames++;
        for (let i = 0; i < visible.length; i++)
          for (let j = i + 1; j < visible.length; j++) {
            const r = visible[i].getBoundingClientRect(),
              s = visible[j].getBoundingClientRect();
            if (
              Math.min(r.right, s.right) > Math.max(r.left, s.left) &&
              Math.min(r.bottom, s.bottom) > Math.max(r.top, s.top)
            )
              audit.collisions.push([
                visible[i].dataset.awardId!,
                visible[j].dataset.awardId!,
              ]);
          }
        if (audit.mounts.length && nodes.length === 0)
          audit.firstEmpty ??= performance.now();
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  }
  const ids: string[] = [];
  let final!: Snapshot;
  // No presentation waits between quality updates: fourteen real commits.
  for (const quality of [1, 2, 3, 4]) {
    const response = await request.post("/__test/award/" + code, {
      data: { quality },
    });
    expect(response.ok()).toBe(true);
    const result = (await response.json()) as {
      ids: string[];
      snapshot: Snapshot;
    };
    ids.push(...result.ids);
    final = result.snapshot;
  }
  expect(ids).toHaveLength(14);
  await a.waitForTimeout(260);
  await Promise.all(
    [a, b].map((page, i) =>
      page.screenshot({
        path: `${root}/busy-awards-${i ? "reduced" : "normal"}-${info.project.name}.png`,
        animations: "allow",
      }),
    ),
  );
  for (const page of [a, b]) {
    // The total settles while the single combined award remains visible.
    await expect
      .poll(() => page.locator(".score-numbers").allTextContents())
      .toEqual(final.players.map((p) => points(p.scoreUnits)));
    expect(
      (
        await page.evaluate(
          () => (window as unknown as { awardAudit: Audit }).awardAudit,
        )
      ).mounts.length,
    ).toBeLessThan(14);
    await controlsInViewport(page);
  }
  for (const page of [a, b]) {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { awardAudit: Audit }).awardAudit.firstEmpty,
        ),
      )
      .not.toBeNull();
    const audit = await page.evaluate(
      () => (window as unknown as { awardAudit: Audit }).awardAudit,
    );
    expect(audit.mounts).toEqual([ids[0]]);
    expect(audit.lifetimes).toHaveLength(1);
    expect(Math.min(...audit.lifetimes)).toBeGreaterThan(700);
    expect(audit.maxVisible).toBe(1);
    expect(audit.visibleFrames).toBeGreaterThan(10);
    expect(audit.collisions).toEqual([]);
    expect(audit.labels[ids[0]]).toBe(
      "+" +
        points(final.ledger.reduce((sum, entry) => sum + entry.deltaUnits, 0)),
    );
    expect(
      await page
        .locator(".face")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getBoundingClientRect().height),
        ),
    ).toEqual(heights.get(page));
    await info.attach(
      page === a ? "normal-motion-awards" : "reduced-motion-awards",
      { body: JSON.stringify(audit), contentType: "application/json" },
    );
  }
  await request.post("/__test/replay/" + code);
  for (const page of [a, b]) {
    await expect(page.locator(".score-burst")).toHaveCount(0);
    expect(
      (
        await page.evaluate(
          () => (window as unknown as { awardAudit: Audit }).awardAudit,
        )
      ).mounts,
    ).toEqual([ids[0]]);
  }
  const video = a.video();
  await ca.close();
  await cb.close();
  await video?.saveAs(`${root}/award-queue-${info.project.name}.webm`);
});

test("two players receive decision feedback while a rematch waits for complete playback", async ({
  browser,
  baseURL,
  request,
}, info) => {
  const phone = /^(phone|webkit)/.test(info.project.name);
  const viewport = phone
    ? { width: 360, height: 640 }
    : { width: 1280, height: 720 };
  const second = info.project.name.startsWith("webkit")
    ? await browser.browserType().launch({ headless: true })
    : null;
  const ca = await browser.newContext({
    viewport,
    permissions: ["camera", "microphone"],
    recordVideo: { dir: root + "/video", size: viewport },
  });
  const cb = await (second || browser).newContext({
    viewport,
    permissions: ["camera", "microphone"],
    reducedMotion: "reduce",
  });
  if (second)
    await Promise.all([syntheticMicrophone(ca), syntheticMicrophone(cb)]);
  for (const context of [ca, cb])
    await context.addInitScript(() => {
      const Original = AudioWorkletNode;
      (window as any).__decisionAudio = [];
      window.AudioWorkletNode = class extends Original {
        constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
          super(...args);
          if (args[1] === "judge-playback")
            this.port.addEventListener("message", (event) => {
              if (event.data.type === "drained")
                (window as any).__decisionAudio.push(event.data);
            });
        }
      };
    });
  const a = await ca.newPage(),
    b = await cb.newPage();
  const coins = new Map([
    [a, [] as string[]],
    [b, [] as string[]],
  ]);
  for (const page of [a, b])
    page.on("websocket", (socket) => {
      if (!socket.url().includes("/socket/control")) return;
      socket.on("framereceived", ({ payload }) => {
        const data = JSON.parse(payload.toString());
        if (data.type === "coin_committed") coins.get(page)!.push(data.matchId);
      });
    });
  const announcement = (page: Page) =>
    page.locator('.app > [aria-live="polite"]');
  try {
    const code = await enter(a, b, baseURL!);
    await a.getByRole("button", { name: "Ready to argue" }).click();
    await expect(announcement(a)).toHaveText("Ready. Waiting for Sam.");
    await expect(announcement(b)).toHaveText("Alex is ready. Ready to argue.");
    await a.getByRole("button", { name: "Ready · undo" }).click();
    await expect(announcement(b)).toHaveText("Ready to argue");
    await a.getByRole("button", { name: "Ready to argue" }).click();
    await b.getByRole("button", { name: "Ready to argue" }).click();
    await expect
      .poll(async () => (await snapshot(request, code)).phase)
      .toBe("TOPIC_SELECT");
    const selected = await snapshot(request, code);
    const chooser = selected.players.find((p) => p.id === selected.tailsId)!;
    const tails = chooser.name === "Alex" ? a : b;
    await expect(announcement(tails)).toHaveText("Choose a topic");
    await expect(announcement(tails === a ? b : a)).toHaveText(
      `${chooser.name} is choosing.`,
    );
    await tails
      .getByRole("button", { name: "Is a hot dog a sandwich?" })
      .click();
    await tails
      .getByRole("button", { name: "It is a sandwich", exact: true })
      .click();
    await expect(announcement(a)).toHaveText("Confirm your side.");
    await expect(announcement(b)).toHaveText("Confirm your side.");
    for (const page of [a, b])
      await page.evaluate(() => {
        const node = document.querySelector('.app > [aria-live="polite"]')!;
        (window as any).__decisionAnnouncements = [];
        new MutationObserver(() =>
          (window as any).__decisionAnnouncements.push(node.textContent),
        ).observe(node, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
    await a.getByRole("button", { name: "Confirm my side" }).focus();
    await a.keyboard.press("Enter");
    await expect(announcement(a)).toHaveText(
      "Confirmed. Waiting for Sam to confirm.",
    );
    await expect(announcement(b)).toHaveText(
      "Alex confirmed. Confirm your side.",
    );
    await expect(a.getByRole("button", { name: "Confirmed" })).toBeDisabled();
    // macOS WebKit's default Tab mode skips buttons, including enabled ones.
    // Option-Tab follows all controls without changing the app's focus behavior.
    await a.keyboard.press(
      second && process.platform === "darwin" ? "Alt+Tab" : "Tab",
    );
    await expect(
      a.getByRole("button", { name: "Choose another topic" }),
    ).toBeFocused();
    const clock = await a.locator(".decision-clock").textContent();
    await request.post("/__test/replay/" + code);
    await request.post("/__test/replay/" + code);
    await expect(a.locator(".decision-clock")).not.toHaveText(clock!);
    expect(
      await a.evaluate(() => (window as any).__decisionAnnouncements),
    ).toEqual(["Confirmed. Waiting for Sam to confirm."]);
    expect(
      await b.evaluate(() => (window as any).__decisionAnnouncements),
    ).toEqual(["Alex confirmed. Confirm your side."]);
    await shot(a, "decision-confirmed-" + info.project.name);

    // Jump only to the finished match. Votes, device health, voice delivery and
    // the next match's start then use real commands and server coordination.
    const result = await snapshot(request, code);
    const [p0] = result.players;
    const finished: Partial<Snapshot> = {
      phase: "MATCH_RESULT",
      round: 2,
      turn: null,
      judge: null,
      phaseDeadline: null,
      winnerId: p0.id,
      rematchReady: [],
      players: result.players.map((p, i) => ({ ...p, wins: i ? 0 : 2 })),
      status: "The bread hinge makes your case.",
    };
    expect(
      (await request.post("/__test/present/" + code, { data: finished })).ok(),
    ).toBe(true);
    await a.getByRole("button", { name: "Rematch", exact: true }).click();
    await expect(
      a.getByRole("button", { name: "Waiting for Sam", exact: true }),
    ).toBeDisabled();
    await expect(announcement(b)).toHaveText("Alex is ready for a rematch.");
    await b.getByRole("button", { name: "Mic on", exact: true }).click();
    await expect(
      a.getByRole("button", { name: "Rematch queued", exact: true }),
    ).toBeDisabled();
    await expect(a.locator(".result-panel .support-copy")).toHaveText(
      "Waiting for Sam’s mic.",
    );
    await expect(announcement(a)).toHaveText("Waiting for Sam’s mic.");
    await b.getByRole("button", { name: "Turn mic on", exact: true }).click();
    await expect
      .poll(async () =>
        (await snapshot(request, code)).players.every((p) => p.mediaReady),
      )
      .toBe(true);
    await expect(
      a.getByRole("button", { name: "Waiting for Sam", exact: true }),
    ).toBeDisabled();

    await a.getByRole("button", { name: "Audio", exact: true }).click();
    await a.getByRole("button", { name: /Bonk/ }).click();
    await a.keyboard.press("Escape");
    const voice = await request.post("/__test/voice/" + code);
    expect(voice.ok()).toBe(true);
    const { epoch, samples } = await voice.json();
    await expect(a.locator(".caption-status")).toHaveText("Sound off");
    for (const page of [a, b]) {
      coins.get(page)!.length = 0;
      await page.evaluate(() => ((window as any).__decisionAnnouncements = []));
    }
    await b.getByRole("button", { name: "Rematch", exact: true }).click();
    for (const page of [a, b]) {
      await expect(
        page.getByRole("button", { name: "Rematch queued", exact: true }),
      ).toBeDisabled();
      await expect(announcement(page)).toHaveText(
        "Both ready. Rematch queued.",
      );
      await expect(page.locator(".player-status")).toHaveText([
        "Ready",
        "Ready",
      ]);
      await noOverlap(page);
    }
    // Another room occupies the stage after both rematch votes were accepted.
    const busy = await (
      await request.post("/api/rooms", {
        data: { name: "Other court" },
      })
    ).json();
    const busyCode = busy.session.code;
    expect(
      (
        await request.post("/__test/present/" + busyCode, {
          data: { phase: "TOPIC_SELECT", phaseDeadline: Date.now() + 60000 },
        })
      ).ok(),
    ).toBe(true);
    await request.post("/__test/replay/" + code);
    await shot(a, "decision-queued-" + info.project.name);
    expect((await snapshot(request, code)).phase).toBe("MATCH_RESULT");
    for (const page of [a, b]) {
      expect(coins.get(page)).toEqual([]);
      expect(
        await page.evaluate(() => (window as any).__decisionAnnouncements),
      ).toEqual(["Both ready. Rematch queued."]);
    }
    await expect
      .poll(async () => (await snapshot(request, code)).rematchReady)
      .toEqual([]);
    const denied = await snapshot(request, code);
    expect(denied.matchId).toBe(result.matchId);
    expect(denied.phase).toBe("MATCH_RESULT");
    expect(denied.winnerId).toBe(p0.id);
    for (const page of [a, b]) {
      await expect(page.locator(".room-notice")).toContainText(
        "The demo stage is occupied.",
      );
      await expect(
        page.getByRole("button", { name: "Rematch", exact: true }),
      ).toBeEnabled();
    }
    // Same-match snapshots must keep the explanation until a retry succeeds.
    await request.post("/__test/replay/" + code);
    for (const page of [a, b])
      await expect(page.locator(".room-notice")).toBeVisible();
    await request.post("/__test/failure/" + busyCode + "/abort");
    await a.getByRole("button", { name: "Rematch", exact: true }).click();
    await b.getByRole("button", { name: "Rematch", exact: true }).click();
    await expect
      .poll(async () => (await snapshot(request, code)).matchId, {
        timeout: 20000,
      })
      .not.toBe(result.matchId);
    const next = await snapshot(request, code);
    for (const page of [a, b]) {
      await expect.poll(() => coins.get(page)).toEqual([next.matchId]);
      await expect(page.locator(".room-notice")).toHaveCount(0);
      const rendered = await page.evaluate(
        (epoch) =>
          (window as any).__decisionAudio
            .filter((e: any) => e.epoch === epoch)
            .map((e: any) => e.samples),
        epoch,
      );
      expect(rendered).toEqual([samples]);
    }
    const timeline = await (
      await request.post("/__test/timeline/" + code)
    ).json();
    const complete = timeline.filter(
      (e: any) => e.stage === "render_complete" && e.speechEpoch === epoch,
    );
    expect(complete).toHaveLength(2);
    expect(complete.every((e: any) => e.samples === samples)).toBe(true);
    await info.attach("rematch-playback-timeline", {
      body: Buffer.from(JSON.stringify(timeline)),
      contentType: "application/json",
    });
    await expect
      .poll(async () => (await snapshot(request, code)).phase)
      .toBe("TOPIC_SELECT");
    for (const page of [a, b]) expect(coins.get(page)).toEqual([next.matchId]);
    expect(
      (await request.post("/__test/present/" + code, { data: finished })).ok(),
    ).toBe(true);
    await a.getByRole("button", { name: "Rematch", exact: true }).click();
    await b.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(a.getByRole("button", { name: "Back to menu" })).toBeVisible();
    await expect(announcement(a)).toHaveText(
      "Match complete. Your friend isn’t here.",
    );
    await expect(a.locator(".result-panel h2")).toContainText("Alex");
  } finally {
    const video = a.video();
    await ca.close();
    await cb.close();
    await second?.close();
    await video?.saveAs(`${root}/decision-feedback-${info.project.name}.webm`);
  }
});

test("two players render a long judge line completely through asymmetric delivery and explicit mute", async ({
  browser,
  baseURL,
  request,
}, info) => {
  const phone = /^(phone|webkit)/.test(info.project.name);
  const aContext = await browser.newContext({
    viewport: phone
      ? { width: 390, height: 844 }
      : { width: 1280, height: 720 },
    permissions: ["camera", "microphone"],
  });
  const second = info.project.name.startsWith("webkit")
    ? await browser.browserType().launch({ headless: true })
    : null;
  const bContext = await (second || browser).newContext({
    viewport: phone
      ? { width: 390, height: 844 }
      : { width: 1280, height: 720 },
    permissions: ["camera", "microphone"],
  });
  await Promise.all([
    syntheticMicrophone(aContext, 330),
    syntheticMicrophone(bContext, 550),
  ]);
  for (const context of [aContext, bContext])
    await context.addInitScript(() => {
      const Socket = WebSocket;
      (window as any).__judgeSockets = [];
      const inspectPCM = (raw: unknown) => {
        if (
          !(raw instanceof ArrayBuffer) ||
          raw.byteLength < 31 ||
          new Uint8Array(raw)[0] !== 1
        )
          return;
        const view = new DataView(raw),
          count = view.getUint32(13, true);
        let squares = 0;
        for (let i = 0; i < count; i++)
          squares += (view.getInt16(31 + i * 2, true) / 32768) ** 2;
        return {
          count,
          rms: Math.sqrt(squares / Math.max(1, count)),
          age: Date.now() - view.getFloat64(17, true),
          purpose: view.getUint8(25),
        };
      };
      (window as any).__micFrames = [];
      (window as any).__receivedFrames = [];
      const Peer = RTCPeerConnection;
      (window as any).__peers = [];
      window.RTCPeerConnection = class extends Peer {
        constructor(config?: RTCConfiguration) {
          super(config);
          (window as any).__peers.push(this);
        }
      };
      window.WebSocket = class extends Socket {
        constructor(...args: ConstructorParameters<typeof WebSocket>) {
          super(...args);
          if (String(args[0]).includes("/socket/judge"))
            (window as any).__judgeSockets.push(this);
          this.addEventListener("message", (event) => {
            const sample = inspectPCM(event.data);
            if (sample) {
              const frames = (window as any).__receivedFrames;
              frames.push(sample);
              if (frames.length > 30) frames.shift();
            }
          });
        }
        send(data: Parameters<WebSocket["send"]>[0]) {
          const raw = ArrayBuffer.isView(data)
            ? data.buffer.slice(
                data.byteOffset,
                data.byteOffset + data.byteLength,
              )
            : data;
          const sample = inspectPCM(raw);
          if (sample) {
            const frames = (window as any).__micFrames;
            frames.push(sample);
            if (frames.length > 30) frames.shift();
          }
          super.send(data);
        }
      };
      const createGain = AudioContext.prototype.createGain;
      const gains = new WeakMap<AudioContext, number>();
      AudioContext.prototype.createGain = function () {
        const gain = createGain.call(this),
          index = gains.get(this) || 0;
        gains.set(this, index + 1);
        if (index === 0) {
          const analyser = this.createAnalyser();
          // A ~170 ms speech-energy window spans native Opus concealment at
          // packet boundaries. Sustained mute/routing loss still fails; judge
          // completion is checked separately at exact sample granularity.
          analyser.fftSize = 8192;
          analyser.smoothingTimeConstant = 0;
          gain.connect(analyser);
          const sink = createGain.call(this);
          sink.gain.value = 0;
          analyser.connect(sink).connect(this.destination);
          (window as any).__friendOutput = { analyser, gain, context: this };
        }
        return gain;
      };
      (window as any).__conversation = [];
      (window as any).__judgeActive = false;
      setInterval(() => {
        const output = (window as any).__friendOutput;
        if (!output || !(window as any).__judgeActive) return;
        const pcm = new Float32Array(output.analyser.fftSize);
        output.analyser.getFloatTimeDomainData(pcm);
        let squares = 0;
        for (let i = 0; i < pcm.length; i++) {
          squares += pcm[i] * pcm[i];
        }
        // A short jitter-concealment edge changes zero crossings. The dominant
        // spectral bin identifies the source without assuming phase continuity.
        const spectrum = new Float32Array(output.analyser.frequencyBinCount);
        output.analyser.getFloatFrequencyData(spectrum);
        let peak = 1;
        for (let i = 2; i < spectrum.length; i++)
          if (spectrum[i] > spectrum[peak]) peak = i;
        (window as any).__conversation.push({
          rms: Math.sqrt(squares / pcm.length),
          frequency: (peak * output.context.sampleRate) / pcm.length,
        });
      }, 100);
      const Original = window.AudioWorkletNode;
      (window as any).__judgeRender = [];
      window.AudioWorkletNode = class extends Original {
        constructor(
          context: BaseAudioContext,
          name: string,
          options?: AudioWorkletNodeOptions,
        ) {
          super(context, name, options);
          if (name === "judge-playback")
            this.port.addEventListener("message", (event) => {
              if (event.data.type === "rendering")
                (window as any).__judgeActive = true;
              if (event.data.type === "drained")
                (window as any).__judgeActive = false;
              if (
                ["ready", "buffering", "rendering", "drained"].includes(
                  event.data.type,
                )
              )
                (window as any).__judgeRender.push(event.data);
            });
        }
      };
    });
  const a = await aContext.newPage(),
    b = await bContext.newPage();
  let held = false,
    released = false;
  // Delay an ordered middle burst for one second, preserving message order.
  await b.routeWebSocket("**/socket/judge", (ws) => {
    const server = ws.connectToServer();
    const queue: (string | Buffer)[] = [];
    server.onMessage((message) => {
      const pcm = typeof message !== "string" && message[0] === 2;
      if (!released && pcm && message.readUInt32LE(5) >= 45) {
        queue.push(message);
        if (!held) {
          held = true;
          setTimeout(() => {
            released = true;
            for (const packet of queue) ws.send(packet);
            queue.length = 0;
          }, 1000);
        }
      } else if (held && !released) queue.push(message);
      else ws.send(message);
    });
  });
  try {
    const code = await enter(a, b, baseURL!);
    const response = await request.post("/__test/voice/" + code);
    expect(response.ok()).toBe(true);
    const { epoch, samples } = await response.json();
    await expect(
      a.getByText("Every last syllable gets its day in court. Case closed."),
    ).toBeVisible();
    await expect
      .poll(async () => (await snapshot(request, code)).judge?.status)
      .toBe("speaking");
    await expect(
      a.getByRole("button", { name: "Mic on", exact: true }),
    ).toBeEnabled();
    await expect(
      b.getByRole("button", { name: "Mic on", exact: true }),
    ).toBeEnabled();
    await expect(a.locator(".caption-heading .caption-status")).toHaveText(
      "Speaking",
    );
    await expect(a.locator(".turn-label")).toHaveCount(0);
    await a.getByRole("button", { name: "Audio", exact: true }).click();
    // Bonk mute is gain-only: completion must still account for the full utterance.
    const bonkControl = a.getByRole("button", { name: /Bonk/ });
    await expect(bonkControl).toBeVisible();
    await bonkControl.click();
    await a.keyboard.press("Escape");
    await expect
      .poll(async () => (await snapshot(request, code)).judge?.status, {
        timeout: 20000,
      })
      .toBe("silent");
    for (const page of [a, b]) {
      const events = await page.evaluate(() => (window as any).__judgeRender);
      expect(
        events
          .filter((e: any) => e.epoch === epoch && e.type === "drained")
          .map((e: any) => e.samples),
      ).toEqual([samples]);
    }
    const timeline = await (
      await request.post("/__test/timeline/" + code)
    ).json();
    const complete = timeline.filter(
      (e: any) => e.stage === "render_complete" && e.speechEpoch === epoch,
    );
    expect(complete).toHaveLength(2);
    expect(complete.every((e: any) => e.samples === samples)).toBe(true);
    expect((await snapshot(request, code)).degraded.tts).toBe(false);
    expect(
      await b.evaluate(() =>
        (window as any).__judgeRender.some((e: any) => e.type === "buffering"),
      ),
    ).toBe(true);
    await info.attach("audio-timeline", {
      body: Buffer.from(JSON.stringify(timeline)),
      contentType: "application/json",
    });
    // A separate judge channel repairs without pausing friends or restarting devices.
    const next = await (await request.post("/__test/voice/" + code)).json();
    await expect
      .poll(async () => (await snapshot(request, code)).judge?.status)
      .toBe("speaking");
    await b.waitForTimeout(500);
    await b.evaluate(() => (window as any).__judgeSockets.at(-1).close());
    await expect
      .poll(async () => (await snapshot(request, code)).judge?.epoch)
      .toBeGreaterThan(next.epoch);
    expect((await snapshot(request, code)).phase).toBe("LOBBY");
    await expect
      .poll(async () => (await snapshot(request, code)).judge?.status, {
        timeout: 20000,
      })
      .toBe("silent");
    expect((await snapshot(request, code)).degraded.tts).toBe(false);
    const repaired = await (
      await request.post("/__test/timeline/" + code)
    ).json();
    const completed = repaired.filter(
      (e: any) => e.stage === "render_complete" && e.speechEpoch > next.epoch,
    );
    expect(completed).toHaveLength(2);
    expect(completed.every((e: any) => e.samples === next.samples)).toBe(true);
    for (const [page, expectedFrequency] of [
      [a, 550],
      [b, 330],
    ] as const) {
      const conversation = await page.evaluate(
        () => (window as any).__conversation,
      );
      const diagnostics = await page.evaluate(async () => ({
        microphone: (window as any).__micFrames,
        received: (window as any).__receivedFrames,
        gain: (window as any).__friendOutput.gain.gain.value,
        context: (window as any).__friendOutput.context.state,
        peers: await Promise.all(
          (window as any).__peers.map(async (pc: RTCPeerConnection) => ({
            state: pc.connectionState,
            transceivers: pc.getTransceivers().map((t) => ({
              kind: t.receiver.track.kind,
              mid: t.mid,
              direction: t.currentDirection,
              sending: !!t.sender.track,
            })),
            senders: pc.getSenders().map((s) => ({
              kind: s.track?.kind,
              enabled: s.track?.enabled,
              muted: s.track?.muted,
            })),
            stats: [...(await pc.getStats()).values()].filter(
              (s) => s.kind === "audio",
            ),
          })),
        ),
      }));
      await info.attach(`friend-output-${expectedFrequency}`, {
        body: Buffer.from(JSON.stringify({ conversation, diagnostics })),
        contentType: "application/json",
      });
      expect(conversation.length).toBeGreaterThan(150);
      expect(
        conversation.every((sample: any) => sample.rms > 0.01),
        JSON.stringify({
          zero: conversation.filter((s: any) => s.rms <= 0.01).length,
          samples: conversation.length,
          min: Math.min(...conversation.map((s: any) => s.rms)),
          max: Math.max(...conversation.map((s: any) => s.rms)),
          diagnostics,
        }),
      ).toBe(true);
      expect(
        conversation.every(
          (sample: any) => Math.abs(sample.frequency - expectedFrequency) < 45,
        ),
      ).toBe(true);
    }
  } finally {
    await aContext.close();
    await bContext.close();
    await second?.close();
  }
});
