import {
  test,
  expect,
  type Browser,
  type Page,
  type Route,
  type APIResponse,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { snapshotSchema, type Snapshot } from "../../shared/domain";
import type { ServerMessage } from "../../shared/protocol";

const root = "output/playwright/recovery-ownership/after";
async function players(
  browser: Browser,
  recording: string,
  output = root,
  recordBoth = false,
) {
  const contexts = await Promise.all(
    [0, 1].map((i) =>
      browser.newContext({
        permissions: ["camera", "microphone"],
        viewport: { width: 1280, height: 720 },
        ...(i === 0 || recordBoth
          ? {
              recordVideo: {
                dir: output + "/video",
                size: { width: 1280, height: 720 },
              },
            }
          : {}),
      }),
    ),
  );
  for (const context of contexts)
    await context.addInitScript(() => {
      const sockets: WebSocket[] = [];
      const requests: MediaStreamConstraints[] = [];
      const snapshots: Snapshot[] = [];
      const messages: ServerMessage[] = [];
      const setupStarts: string[] = [];
      const OriginalSocket = WebSocket;
      window.WebSocket = class extends OriginalSocket {
        constructor(...args: ConstructorParameters<typeof WebSocket>) {
          super(...args);
          sockets.push(this);
          this.addEventListener("message", (event) => {
            if (typeof event.data !== "string") return;
            const message = JSON.parse(event.data);
            messages.push(message);
            if (
              message.type === "setup_result" &&
              message.status === "passed" &&
              faults.dropSetupResult
            ) {
              faults.dropSetupResult = false;
              event.stopImmediatePropagation();
              return;
            }
            if (message.snapshot) snapshots.push(message.snapshot);
          });
        }
        send(data: Parameters<WebSocket["send"]>[0]) {
          if (typeof data === "string") {
            const message = JSON.parse(data);
            if (message.command?.type === "setup_start")
              setupStarts.push(message.command.checkId);
          }
          super.send(data);
        }
      };
      const capture = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      const faults = {
        sockets,
        requests,
        snapshots,
        messages,
        setupStarts,
        dropSetupResult: false,
        hold: false,
        failGraph: false,
        release: null as (() => void) | null,
        late: null as MediaStream | null,
        camera: null as MediaStreamTrack | null,
      };
      Object.assign(window, { faults });
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        requests.push(constraints || {});
        const stream = await capture(constraints);
        if (faults.hold)
          return new Promise<MediaStream>((resolve) => {
            faults.late = stream;
            faults.release = () => resolve(stream);
          });
        return stream;
      };
      const Node = AudioWorkletNode;
      window.AudioWorkletNode = class extends Node {
        constructor(
          context: BaseAudioContext,
          name: string,
          options?: AudioWorkletNodeOptions,
        ) {
          if (faults.failGraph && name === "pcm-capture")
            throw new Error("Microphone could not start. Try again.");
          super(context, name, options);
        }
      };
    });
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  pages.forEach((p) => p.on("pageerror", (e) => errors.push(e.message)));
  return {
    contexts,
    pages,
    errors,
    close: async () => {
      await Promise.all(contexts.map((c) => c.close()));
      await pages[0].video()?.saveAs(`${output}/${recording}.webm`);
      if (recordBoth)
        await pages[1].video()?.saveAs(`${output}/${recording}-peer.webm`);
    },
  };
}
type Faults = {
  sockets: WebSocket[];
  requests: MediaStreamConstraints[];
  snapshots: Snapshot[];
  messages: ServerMessage[];
  setupStarts: string[];
  dropSetupResult: boolean;
  hold: boolean;
  failGraph: boolean;
  release: (() => void) | null;
  late: MediaStream | null;
  camera: MediaStreamTrack | null;
};
async function enter(a: Page, b: Page, base: string, reservedCode?: string) {
  if (!reservedCode) {
    await a.goto(base);
    await a.getByLabel("Your name", { exact: true }).fill("Alex");
    await a.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(a.locator(".invite-code span")).toBeVisible();
  }
  const code =
    reservedCode || (await a.locator(".invite-code span").innerText()).trim();
  await b.goto(base + "/?room=" + code);
  await b.getByLabel("Your name", { exact: true }).fill("Sam");
  await b.getByRole("button", { name: "Join room", exact: true }).click();
  const state = async (): Promise<Snapshot> =>
    snapshotSchema.parse(
      await (await a.request.post(base + "/__test/state/" + code)).json(),
    );
  await expect
    .poll(async () => (await state()).players.every((p) => p.mediaReady))
    .toBe(true);
  await a.getByRole("button", { name: "Ready to argue" }).click();
  await b.getByRole("button", { name: "Ready to argue" }).click();
  await expect.poll(async () => (await state()).phase).toBe("TOPIC_SELECT");
  const s = await state(),
    tails = s.players.find((p) => p.id === s.tailsId)?.name === "Alex" ? a : b;
  await tails.getByRole("button", { name: "Is a hot dog a sandwich?" }).click();
  await tails
    .getByRole("button", { name: "It is a sandwich", exact: true })
    .click();
  for (const p of [a, b])
    await p.getByRole("button", { name: "Confirm my side" }).click();
  await expect
    .poll(async () => {
      const s = await state();
      return s.phase === "ROUND" && !s.turn?.pausedReason;
    })
    .toBe(true);
  await a.request.post(base + "/__test/award/" + code, {
    data: { quality: 4 },
  });
  return { state, code };
}
async function shot(page: Page, name: string, output = root) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  const clipped = await page
    .locator(".phase-content, .controls button")
    .evaluateAll((nodes) =>
      nodes.flatMap((n) => {
        const r = n.getBoundingClientRect();
        return r.width &&
          (r.bottom > innerHeight + 1 || r.left < 0 || r.right > innerWidth + 1)
          ? [n.textContent]
          : [];
      }),
    );
  expect(clipped).toEqual([]);
}
test.beforeEach(async ({ request }) => {
  await mkdir(root, { recursive: true });
  await request.post("/__test/reset");
});

const privateOutput = "output/playwright/private-check/after";

test("private mic repair survives the speaker reconnecting without publishing or scoring the check", async ({
  browser,
  baseURL,
}, info) => {
  await mkdir(privateOutput, { recursive: true });
  const f = await players(
      browser,
      "private-reconnect-" + info.project.name,
      privateOutput,
      true,
    ),
    [a, b] = f.pages;
  try {
    const { state, code } = await enter(a, b, baseURL!);
    const initial = await state();
    const speaker =
      initial.players.find((p) => p.id === initial.turn!.playerId)!.name ===
      "Alex"
        ? a
        : b;
    await speaker.evaluate(() => {
      const video = document.querySelector(
        'article[aria-label$=", you"] video',
      ) as HTMLVideoElement;
      (video.srcObject as MediaStream).getAudioTracks()[0].stop();
    });
    await expect.poll(async () => (await state()).phase).toBe("RECOVERING");
    const held = await state();
    await a.request.post(baseURL + "/__test/provider", {
      data: { speechDelay: 4500 },
    });
    await speaker
      .getByRole("button", { name: "Check mic & camera", exact: true })
      .click();
    await expect(speaker.locator(".setup-status")).toHaveText(
      "Say ‘Bonk, hear me out.’",
    );
    const checkId = await speaker.evaluate(() =>
      (window as unknown as { faults: Faults }).faults.setupStarts.at(-1)!,
    );
    await speaker.evaluate(() =>
      (window as unknown as { faults: Faults }).faults.sockets
        .filter((s) => s.readyState === WebSocket.OPEN)
        .forEach((s) => s.close()),
    );
    await expect(speaker.locator(".phase-content")).toContainText(
      "Reconnecting…",
    );
    await expect(speaker.locator(".timer, .yield-button")).toHaveCount(0);
    await expect
      .poll(() =>
        speaker.evaluate(
          (id) =>
            (window as unknown as { faults: Faults }).faults.setupStarts.filter(
              (c) => c === id,
            ).length,
          checkId,
        ),
      )
      .toBeGreaterThan(1);
    await expect(speaker.locator(".setup-status")).toHaveText(
      "Say ‘Bonk, hear me out.’",
    );
    await shot(speaker, "checking-desktop-" + info.project.name, privateOutput);
    await speaker.setViewportSize({ width: 360, height: 640 });
    await speaker.emulateMedia({ reducedMotion: "reduce" });
    await speaker
      .getByRole("button", { name: "Cancel check", exact: true })
      .focus();
    await shot(speaker, "checking-phone-" + info.project.name, privateOutput);
    await expect
      .poll(async () => {
        const s = await state();
        return s.phase === "ROUND" && !s.turn?.pausedReason;
      })
      .toBe(true);
    const restored = await state();
    expect(restored.turn!.id).toBe(held.turn!.id);
    expect(restored.ledger).toEqual(held.ledger);
    for (const page of [a, b]) {
      const snapshots = (
        await page.evaluate(
          () => (window as unknown as { faults: Faults }).faults.snapshots,
        )
      ).map((s) => snapshotSchema.parse(s));
      for (const s of snapshots.filter(
        (s) => s.seq >= held.seq && s.phase === "RECOVERING",
      )) {
        expect(s.turn!.remainingMs).toBe(held.turn!.remainingMs);
        expect(s.turn!.playerId).toBe(held.turn!.playerId);
        expect(s.ledger).toEqual(held.ledger);
      }
      expect(
        snapshots.some((s) =>
          Object.values(s.captions).some((c) => c.text.includes("Bonk, hear")),
        ),
      ).toBe(false);
      const messages = await page.evaluate(
        () => (window as unknown as { faults: Faults }).faults.messages,
      );
      expect(
        messages.some(
          (m) =>
            m.type === "transcript" && m.payload?.text.includes("Bonk, hear"),
        ),
      ).toBe(false);
    }
    expect(
      await speaker.evaluate(
        () => (window as unknown as { faults: Faults }).faults.requests.length,
      ),
    ).toBe(2);
    await speaker.setViewportSize({ width: 390, height: 844 });
    await shot(speaker, "restored-phone-" + info.project.name, privateOutput);
    await speaker
      .getByRole("button", { name: "I’m done", exact: true })
      .click();
    await expect
      .poll(async () => (await state()).turn?.id)
      .not.toBe(held.turn!.id);
    const next = (await state()).turn!;
    const nextPage =
      restored.players.find((p) => p.id === next.playerId)!.name === "Alex"
        ? a
        : b;
    await expect(
      nextPage.getByRole("button", { name: "I’m done", exact: true }),
    ).toBeEnabled();
    // Let the synthetic microphone deliver a short utterance to the adapter.
    await nextPage.waitForTimeout(400);
    await nextPage
      .getByRole("button", { name: "I’m done", exact: true })
      .click();
    await expect
      .poll(async () => (await state()).ledger.length)
      .toBeGreaterThan(held.ledger.length);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("a lost private success is replayed after reconnect without repeating capture or speech", async ({
  browser,
  baseURL,
}, info) => {
  await mkdir(privateOutput, { recursive: true });
  const f = await players(
      browser,
      "lost-success-" + info.project.name,
      privateOutput,
    ),
    [a, b] = f.pages;
  try {
    const { state, code } = await enter(a, b, baseURL!);
    const initial = await state(),
      speaker =
        initial.players.find((p) => p.id === initial.turn!.playerId)!.name ===
        "Alex"
          ? a
          : b;
    await a.request.post(baseURL + "/__test/failure/" + code + "/stt");
    await expect.poll(async () => (await state()).phase).toBe("RECOVERING");
    const held = await state();
    await speaker.evaluate(() => {
      (window as unknown as { faults: Faults }).faults.dropSetupResult = true;
    });
    await speaker
      .getByRole("button", { name: "Check mic & camera", exact: true })
      .click();
    await expect
      .poll(() =>
        speaker.evaluate(
          () =>
            (window as unknown as { faults: Faults }).faults.dropSetupResult,
        ),
      )
      .toBe(false);
    const checkId = await speaker.evaluate(() =>
      (window as unknown as { faults: Faults }).faults.setupStarts.at(-1)!,
    );
    await speaker.evaluate(() =>
      (window as unknown as { faults: Faults }).faults.sockets
        .filter((s) => s.readyState === WebSocket.OPEN)
        .forEach((s) => s.close()),
    );
    await expect
      .poll(() =>
        speaker.evaluate(
          (id) =>
            (window as unknown as { faults: Faults }).faults.messages.filter(
              (m) =>
                m.type === "setup_result" &&
                m.status === "passed" &&
                m.checkId === id,
            ).length,
          checkId,
        ),
      )
      .toBe(2);
    await expect
      .poll(async () => {
        const s = await state();
        return s.phase === "ROUND" && !s.turn?.pausedReason;
      })
      .toBe(true);
    expect((await state()).ledger).toEqual(held.ledger);
    expect((await state()).turn!.id).toBe(held.turn!.id);
    expect(
      await speaker.evaluate(
        () => (window as unknown as { faults: Faults }).faults.requests.length,
      ),
    ).toBe(1);
    await expect(speaker.locator(".setup-status")).toHaveCount(0);
    await expect(
      speaker.getByRole("button", { name: "I’m done", exact: true }),
    ).toBeEnabled();
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("connection recovery hides stale gameplay, retries a lost response, and offers bounded manual repair", async ({
  browser,
  baseURL,
}, info) => {
  const f = await players(browser, "connection-" + info.project.name),
    [a, b] = f.pages;
  const responses: { route: Route; response: APIResponse }[] = [];
  try {
    const { state } = await enter(a, b, baseURL!);
    const original = await state();
    const speaker =
      original.players.find((p) => p.id === original.turn!.playerId)!.name ===
      "Alex"
        ? a
        : b;
    // Accept the resume on the server, but lose its response. Retry must not
    // increment the connection/media epochs a second time.
    await speaker.route("**/api/resume", async (route) => {
      const response = await route.fetch();
      responses.push({ route, response });
    });
    const disconnect = () =>
      speaker.evaluate(() => {
        [...(window as unknown as { faults: Faults }).faults.sockets]
          .reverse()
          .find(
            (s) =>
              s.url.includes("/socket/control") &&
              s.readyState === WebSocket.OPEN,
          )!
          .close(4000, "fixture");
      });
    await disconnect();
    await expect(speaker.locator(".recovery-panel h2")).toHaveText(
      "Reconnecting…",
    );
    await expect(
      speaker.locator(".timer, .yield-button, .room-notice"),
    ).toHaveCount(0);
    await expect(speaker.locator(".app > .sr-only")).toHaveText(
      "Reconnecting…",
    );
    await expect.poll(async () => (await state()).phase).toBe("RECOVERING");
    const held = await state();
    await shot(speaker, "disconnected-speaker-" + info.project.name);
    await speaker.setViewportSize({ width: 360, height: 640 });
    await speaker.emulateMedia({ reducedMotion: "reduce" });
    await shot(speaker, "disconnected-speaker-phone-" + info.project.name);
    await expect.poll(() => responses.length, { timeout: 16000 }).toBe(2);
    const before = await responses[0].response.json(),
      retry = await responses[1].response.json();
    expect(retry.session.connectionEpoch).toBe(before.session.connectionEpoch);
    expect(retry.snapshot.mediaEpoch).toBe(before.snapshot.mediaEpoch);
    const waiting = await state();
    expect(waiting.turn!.remainingMs).toBe(held.turn!.remainingMs);
    expect(waiting.turn!.playerId).toBe(held.turn!.playerId);
    expect(waiting.ledger).toEqual(held.ledger);
    await responses[1].route.fulfill({ response: responses[1].response });
    await expect.poll(async () => (await state()).phase).toBe("ROUND");
    await expect(speaker.locator(".timer")).toBeVisible();
    await responses[0].route
      .fulfill({ response: responses[0].response })
      .catch(() => {});
    await speaker.unroute("**/api/resume");
    responses.length = 0;
    await speaker.setViewportSize({ width: 390, height: 844 });
    await shot(speaker, "reconnected-speaker-phone-" + info.project.name);
    // A second interruption uses the remaining server allowance. The local
    // request loop stops at its own bound when it cannot receive that snapshot.
    const pending: Route[] = [];
    await speaker.route("**/api/resume", (route) => {
      pending.push(route);
    });
    await disconnect();
    await expect(
      speaker.getByRole("heading", {
        name: "Connection lost. Check your network.",
      }),
    ).toBeVisible({ timeout: 65000 });
    await expect(
      speaker.getByRole("button", { name: "Retry connection" }),
    ).toBeEnabled();
    await expect(
      speaker.locator(".timer, .yield-button, .room-notice"),
    ).toHaveCount(0);
    await shot(speaker, "still-offline-phone-" + info.project.name);
    for (const route of pending) await route.abort().catch(() => {});
    await speaker.unroute("**/api/resume");
    await speaker.getByRole("button", { name: "Retry connection" }).focus();
    await speaker.keyboard.press("Enter");
    await expect(
      speaker.getByRole("heading", { name: "Match interrupted" }),
    ).toBeVisible();
    expect((await state()).phase).toBe("ABORTED");
    expect((await state()).ledger).toEqual(held.ledger);
    expect(f.errors).toEqual([]);
  } finally {
    for (const { route } of responses) await route.abort().catch(() => {});
    await f.close();
  }
});

test("capture repair cancellation and failed initialization preserve the healthy camera", async ({
  browser,
  baseURL,
}, info) => {
  const f = await players(browser, "capture-" + info.project.name),
    [a, b] = f.pages;
  try {
    const { state } = await enter(a, b, baseURL!);
    await a.evaluate(() => {
      const f = (window as unknown as { faults: Faults }).faults;
      const stream = (
        document.querySelector(".face-0 video") as HTMLVideoElement
      ).srcObject as MediaStream;
      f.camera = stream.getVideoTracks()[0];
      stream.getAudioTracks()[0].stop();
      f.hold = true;
    });
    await expect.poll(async () => (await state()).phase).toBe("RECOVERING");
    const held = await state();
    await a
      .getByRole("button", { name: "Check mic & camera", exact: true })
      .click();
    await expect
      .poll(() =>
        a.evaluate(
          () => !!(window as unknown as { faults: Faults }).faults.release,
        ),
      )
      .toBe(true);
    await a.getByRole("button", { name: "Cancel check" }).click();
    await a.evaluate(() => {
      const f = (window as unknown as { faults: Faults }).faults;
      f.release!();
      f.hold = false;
      f.failGraph = true;
    });
    await expect
      .poll(() =>
        a.evaluate(() =>
          (window as unknown as { faults: Faults }).faults
            .late!.getTracks()
            .every((t) => t.readyState === "ended"),
        ),
      )
      .toBe(true);
    await a
      .getByRole("button", { name: "Check mic & camera", exact: true })
      .click();
    await expect(a.locator(".setup-status")).toHaveText(
      "Microphone could not start. Try again.",
    );
    expect(
      await a.evaluate(
        () =>
          (window as unknown as { faults: Faults }).faults.camera!.readyState,
      ),
    ).toBe("live");
    const failed = await state();
    expect(failed.phase).toBe("RECOVERING");
    expect(failed.turn!.remainingMs).toBe(held.turn!.remainingMs);
    expect(failed.turn!.playerId).toBe(held.turn!.playerId);
    expect(failed.ledger).toEqual(held.ledger);
    await shot(a, "cancelled-mic-repair-" + info.project.name);
    await a.setViewportSize({ width: 360, height: 640 });
    await a.emulateMedia({ reducedMotion: "reduce" });
    await shot(a, "cancelled-mic-repair-phone-" + info.project.name);
    await a.evaluate(() => {
      (window as unknown as { faults: Faults }).faults.failGraph = false;
    });
    await a.getByRole("button", { name: "Try again", exact: true }).focus();
    await a.keyboard.press("Enter");
    await expect.poll(async () => (await state()).phase).toBe("ROUND");
    expect(
      await a.evaluate(() => {
        const f = (window as unknown as { faults: Faults }).faults;
        const stream = (
          document.querySelector(".face-0 video") as HTMLVideoElement
        ).srcObject as MediaStream;
        return (
          stream.getVideoTracks()[0] === f.camera &&
          f.requests.slice(1).every((r) => !!r.audio && r.video === false)
        );
      }),
    ).toBe(true);
    expect((await state()).ledger).toEqual(held.ledger);
    await a.setViewportSize({ width: 390, height: 844 });
    await shot(a, "microphone-restored-phone-" + info.project.name);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("stalled audio retries and deliberate Leave ends the match for the friend", async ({
  browser,
  baseURL,
}, info) => {
  const output = "output/playwright/departure-audio/after";
  await mkdir(output, { recursive: true });
  const f = await players(
    browser,
    "setup-to-departure-" + info.project.name,
    output,
  );
  const [a, b] = f.pages;
  let requests = 0;
  let held: Route | undefined;
  try {
    // Hold the actual asset download, not just a mocked addModule promise.
    await f.contexts[0].route("**/peer-worklet.js", async (route) => {
      if (++requests === 1) held = route;
      else await route.continue();
    });
    await a.goto(baseURL!);
    await a.getByLabel("Your name", { exact: true }).fill("Alex");
    await a.getByRole("button", { name: "Create room", exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    await expect(a.locator(".setup-status")).toHaveText(
      "Couldn’t load sound. Try again.",
      { timeout: 15000 },
    );
    expect(
      await a.evaluate(
        () => (window as unknown as { faults: Faults }).faults.requests.length,
      ),
    ).toBe(0);
    await shot(a, "audio-timeout-desktop-" + info.project.name, output);
    await a.setViewportSize({ width: 390, height: 844 });
    await a.emulateMedia({ reducedMotion: "reduce" });
    await shot(a, "audio-timeout-phone-" + info.project.name, output);
    await a.getByRole("button", { name: "Try again", exact: true }).focus();
    await a.keyboard.press("Enter");
    await expect.poll(() => requests, { timeout: 5000 }).toBe(2);
    await expect(a.locator(".invite-code span")).toBeVisible();
    const code = (await a.locator(".invite-code span").innerText()).trim();
    // A late result from the obsolete attempt cannot break working playback.
    await held!.continue().catch(() => {});
    held = undefined;
    await a.setViewportSize({ width: 1280, height: 720 });
    const { state } = await enter(a, b, baseURL!, code);
    const before = await state();
    expect(before.players.every((p) => p.mediaReady)).toBe(true);
    expect(before.mediaMode).toBe(
      info.project.name === "relay" ? "wss" : "rtc",
    );
    await shot(b, "before-leave-" + info.project.name, output);
    await a.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(a.getByLabel("Your name", { exact: true })).toBeVisible();
    await expect(
      b.getByRole("heading", { name: "Match interrupted" }),
    ).toBeVisible();
    await expect(b.locator(".recovery-panel")).toContainText(
      "Alex left the court. No winner this time.",
    );
    await expect(b.locator(".app > .sr-only")).toHaveText(
      "Alex left the court. No winner this time.",
    );
    await expect(b.locator(".avatar small")).toHaveText("Left the court");
    await expect(
      b.getByText("Waiting for your friend", { exact: true }),
    ).toHaveCount(0);
    await expect(
      b.locator(
        ".timer, .yield-button, .decision-clock, .recovery-panel .device-check",
      ),
    ).toHaveCount(0);
    const after = await state();
    expect(after.phase).toBe("ABORTED");
    expect(after.turn).toBeNull();
    expect(after.winnerId).toBeNull();
    expect(after.ledger).toEqual(before.ledger);
    await shot(b, "friend-after-leave-desktop-" + info.project.name, output);
    for (const [width, height] of [
      [360, 640],
      [390, 844],
    ]) {
      await b.setViewportSize({ width, height });
      await b.emulateMedia({ reducedMotion: "reduce" });
      await shot(b, `friend-after-leave-${width}-` + info.project.name, output);
    }
    await b.getByRole("button", { name: "Back to menu", exact: true }).focus();
    await b.keyboard.press("Enter");
    await expect(b.getByLabel("Your name", { exact: true })).toBeVisible();
    expect((await state()).players).toHaveLength(0);
    expect(f.errors).toEqual([]);
  } finally {
    await held?.abort().catch(() => {});
    await f.close();
  }
});

test("completed verdict keeps its winner after their seat leaves", async ({
  browser,
  baseURL,
}, info) => {
  const output = "output/playwright/departure-audio/after";
  await mkdir(output, { recursive: true });
  const f = await players(
    browser,
    "completed-departure-" + info.project.name,
    output,
  );
  const [a, b] = f.pages;
  try {
    const { state, code } = await enter(a, b, baseURL!);
    const current = await state();
    const winner = current.players.find((p) => p.name === "Alex")!;
    // A presentation fixture isolates the finished-result exit. The complete
    // match/rematch journeys separately exercise real verdict progression.
    const results = [
      {
        round: current.round,
        roundId: current.roundId!,
        winnerId: winner.id,
        scores: Object.fromEntries(
          current.players.map((p) => [p.id, p.scoreUnits]),
        ),
        reason: "That bread hinge makes your case.",
        tieBreak: null,
      },
    ];
    await a.request.post(baseURL + "/__test/present/" + code, {
      data: {
        phase: "MATCH_RESULT",
        turn: null,
        winnerId: winner.id,
        results,
        players: current.players.map((p) => ({
          ...p,
          wins: p.id === winner.id ? 2 : 0,
        })),
      },
    });
    await expect(b.locator(".result-panel h2")).toHaveText(
      "Alexwins the match!",
    );
    await a.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(
      b.getByRole("button", { name: "Back to menu", exact: true }),
    ).toBeVisible();
    await expect(b.locator(".result-panel h2")).toHaveText(
      "Alexwins the match!",
    );
    await expect(
      b.locator(".result-panel .device-check, .decision-clock"),
    ).toHaveCount(0);
    expect((await state()).results).toEqual(results);
    expect((await state()).winnerId).toBe(winner.id);
    await shot(b, "completed-after-leave-desktop-" + info.project.name, output);
    await b.setViewportSize({ width: 360, height: 640 });
    await b.emulateMedia({ reducedMotion: "reduce" });
    await shot(b, "completed-after-leave-phone-" + info.project.name, output);
    await b.getByRole("button", { name: "Back to menu", exact: true }).focus();
    await b.keyboard.press("Enter");
    await expect(b.getByLabel("Your name", { exact: true })).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

const intentOutput = "output/playwright/intent-ownership/after";
test("device repair preserves privacy choices made during acquisition until explicit re-enabling", async ({
  browser,
  baseURL,
}, info) => {
  await mkdir(intentOutput, { recursive: true });
  const f = await players(
    browser,
    "privacy-repair-" + info.project.name,
    intentOutput,
  );
  const [a, b] = f.pages;
  try {
    const { state } = await enter(a, b, baseURL!);
    for (const repair of ["camera", "microphone"] as const) {
      await a.evaluate((repair) => {
        const f = (window as unknown as { faults: Faults }).faults;
        const stream = (
          document.querySelector(".face-0 video") as HTMLVideoElement
        ).srcObject as MediaStream;
        (repair === "camera"
          ? stream.getVideoTracks()
          : stream.getAudioTracks())[0].stop();
        f.hold = true;
        f.release = null;
      }, repair);
      await expect.poll(async () => (await state()).phase).toBe("RECOVERING");
      const held = await state();
      await a
        .getByRole("button", {
          name: repair === "camera" ? "Restart camera" : "Check mic & camera",
          exact: true,
        })
        .click();
      await expect
        .poll(() =>
          a.evaluate(
            () => !!(window as unknown as { faults: Faults }).faults.release,
          ),
        )
        .toBe(true);
      const privacy = a
        .locator(".device-controls button")
        .nth(repair === "camera" ? 0 : 1);
      await privacy.click();
      await expect(privacy).toHaveAttribute("aria-pressed", "false");
      await a.evaluate(() => {
        const f = (window as unknown as { faults: Faults }).faults;
        f.hold = false;
        f.release!();
      });
      const action = a.getByRole("button", {
        name: repair === "camera" ? "Turn mic on" : "Turn camera on",
        exact: true,
      });
      await expect(action).toBeVisible();
      // Watch beyond readiness's freshness window: a cached healthy sample must
      // never reopen the floor while the player still has a device switched off.
      await a.waitForTimeout(4000);
      for (const page of [a, b]) {
        const observed = await page.evaluate(
          () => (window as unknown as { faults: Faults }).faults.snapshots,
        );
        const sincePause = observed.filter((s) => s.seq >= held.seq);
        expect(sincePause.length).toBeGreaterThan(0);
        for (const s of sincePause) {
          expect(s.phase).toBe("RECOVERING");
          expect(s.turn!.remainingMs).toBe(held.turn!.remainingMs);
          expect(s.turn!.playerId).toBe(held.turn!.playerId);
          expect(s.turn!.id).toBe(held.turn!.id);
          expect(s.ledger).toEqual(held.ledger);
          expect(s.players.map((p) => p.scoreUnits)).toEqual(
            held.players.map((p) => p.scoreUnits),
          );
        }
        await expect(page.locator(".timer, .yield-button")).toHaveCount(0);
      }
      await expect(privacy).toHaveAttribute("aria-pressed", "false");
      expect(
        await a.evaluate((repair) => {
          const stream = (
            document.querySelector(".face-0 video") as HTMLVideoElement
          ).srcObject as MediaStream;
          return (
            repair === "camera"
              ? stream.getAudioTracks()
              : stream.getVideoTracks()
          )[0].enabled;
        }, repair),
      ).toBe(false);
      await expect(a.locator(".setup-status")).toHaveCount(0);
      await expect(a.locator(".app > .sr-only")).toHaveText(
        repair === "camera" ? "Mic off." : "Camera off.",
      );
      await shot(
        a,
        repair + "-privacy-desktop-" + info.project.name,
        intentOutput,
      );
      await a.setViewportSize({ width: 360, height: 640 });
      await a.emulateMedia({ reducedMotion: "reduce" });
      await shot(
        a,
        repair + "-privacy-phone-" + info.project.name,
        intentOutput,
      );
      await action.focus();
      await a.keyboard.press("Enter");
      await expect
        .poll(async () => {
          const s = await state();
          return s.phase === "ROUND" && !s.turn?.pausedReason;
        })
        .toBe(true);
      expect((await state()).ledger).toEqual(held.ledger);
      const requests = await a.evaluate(
        () => (window as unknown as { faults: Faults }).faults.requests,
      );
      expect(requests.length).toBe(repair === "camera" ? 2 : 3);
      expect(
        repair === "camera" ? requests.at(-1)!.audio : requests.at(-1)!.video,
      ).toBe(false);
      await a.setViewportSize({ width: 390, height: 844 });
      await shot(
        a,
        repair + "-restored-phone-" + info.project.name,
        intentOutput,
      );
      await a.setViewportSize({ width: 1280, height: 720 });
    }
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("Leave releases a server-accepted resume while its response is still pending", async ({
  browser,
  baseURL,
}, info) => {
  await mkdir(intentOutput, { recursive: true });
  const f = await players(
    browser,
    "pending-resume-leave-" + info.project.name,
    intentOutput,
  );
  const [a, b] = f.pages;
  let held: { route: Route; response: APIResponse } | undefined;
  try {
    const { state } = await enter(a, b, baseURL!);
    const before = await state();
    const saved = await a.evaluate(() =>
      JSON.parse(sessionStorage.getItem("hmo-seat")!),
    );
    await a.route("**/api/resume", async (route) => {
      held = { route, response: await route.fetch() };
    });
    await a.evaluate(() => {
      (window as unknown as { faults: Faults }).faults.sockets
        .find(
          (s) =>
            s.url.includes("/socket/control") &&
            s.readyState === WebSocket.OPEN,
        )!
        .close(4000, "fixture");
    });
    await expect.poll(() => !!held).toBe(true);
    expect((await held!.response.json()).session.connectionEpoch).toBe(
      saved.connectionEpoch + 1,
    );
    const pending = await a.evaluate(() =>
      JSON.parse(sessionStorage.getItem("hmo-seat")!),
    );
    expect(pending.connectionEpoch).toBe(saved.connectionEpoch);
    expect(pending.resumeId).toBeTruthy();
    const response = a.waitForResponse((r) => r.url().endsWith("/api/leave"));
    await a.getByRole("button", { name: "Leave", exact: true }).focus();
    await a.keyboard.press("Enter");
    const departure = await response;
    expect(departure.status()).toBe(200);
    expect(departure.request().postDataJSON()).toEqual(pending);
    await expect(a.getByLabel("Your name", { exact: true })).toBeVisible();
    await expect(
      b.getByRole("heading", { name: "Match interrupted" }),
    ).toBeVisible();
    await expect(b.locator(".app > .sr-only")).toHaveText(
      "Alex left the court. No winner this time.",
    );
    await expect(
      b.locator(
        ".timer, .yield-button, .decision-clock, .recovery-panel .device-check",
      ),
    ).toHaveCount(0);
    const terminal = await state();
    expect(terminal.phase).toBe("ABORTED");
    expect(terminal.ledger).toEqual(before.ledger);
    expect(terminal.players.map((p) => p.id)).not.toContain(saved.playerId);
    expect(terminal.turn).toBeNull();
    const outcome = (s: Snapshot) => ({
      matchId: s.matchId,
      phase: s.phase,
      phaseVersion: s.phaseVersion,
      status: s.status,
      turn: s.turn,
      players: s.players.map(({ id, name, scoreUnits, wins }) => ({
        id,
        name,
        scoreUnits,
        wins,
      })),
      ledger: s.ledger,
      claims: s.claims,
      results: s.results,
      winnerId: s.winnerId,
      judgePending: s.judgePending,
      rematchReady: s.rematchReady,
    });
    const departedSocketCount = await a.evaluate(
      () => (window as unknown as { faults: Faults }).faults.sockets.length,
    );
    await held!.route.fulfill({ response: held!.response }).catch(() => {});
    held = undefined;
    // Health updates still have legitimate room sequences after departure.
    // They must not change the outcome or revive the departed connection.
    await b.getByRole("button", { name: /^Mic (on|paused)$/ }).click();
    await expect
      .poll(async () =>
        (await state()).players[0].readiness?.blockers.includes("microphone"),
      )
      .toBe(true);
    const updated = await state();
    expect(updated.seq).toBeGreaterThan(terminal.seq);
    expect(outcome(updated)).toEqual(outcome(terminal));
    await expect
      .poll(() =>
        a.evaluate(() =>
          (window as unknown as { faults: Faults }).faults.sockets.every(
            (socket) => socket.readyState === WebSocket.CLOSED,
          ),
        ),
      )
      .toBe(true);
    await shot(
      b,
      "friend-after-pending-leave-desktop-" + info.project.name,
      intentOutput,
    );
    for (const [width, height] of [
      [360, 640],
      [390, 844],
    ]) {
      await b.setViewportSize({ width, height });
      await b.emulateMedia({ reducedMotion: "reduce" });
      await shot(
        b,
        `friend-after-pending-leave-${width}-` + info.project.name,
        intentOutput,
      );
    }
    const observed = await b.evaluate(
      () => (window as unknown as { faults: Faults }).faults.snapshots,
    );
    for (const s of observed.filter((s) => s.seq >= terminal.seq))
      expect(outcome(snapshotSchema.parse(s))).toEqual(outcome(terminal));
    expect(
      await a.evaluate(() => ({
        saved: sessionStorage.getItem("hmo-seat"),
        sockets: (window as unknown as { faults: Faults }).faults.sockets
          .length,
      })),
    ).toEqual({ saved: null, sockets: departedSocketCount });
    await expect(a.getByLabel("Your name", { exact: true })).toBeVisible();
    await b.getByRole("button", { name: "Back to menu", exact: true }).focus();
    await b.keyboard.press("Enter");
    await expect(b.getByLabel("Your name", { exact: true })).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally {
    await held?.route.abort().catch(() => {});
    await f.close();
  }
});
