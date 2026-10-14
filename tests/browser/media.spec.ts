import { test, expect } from "@playwright/test";
import type { Snapshot } from "../../shared/domain";

type Faults = {
  context?: AudioContext;
  permission: EventTarget & { state: string };
  background: boolean;
  dropVideo: boolean;
};

test("runtime media failures preserve the floor, points, and recovery clock", async ({
  browser,
  baseURL,
  request,
}) => {
  await request.post("/__test/reset");
  const contexts = await Promise.all(
    [0, 1].map(() =>
      browser.newContext({ permissions: ["camera", "microphone"] }),
    ),
  );
  for (const context of contexts)
    await context.addInitScript(() => {
      const faults: Faults = {
        permission: Object.assign(new EventTarget(), { state: "granted" }),
        background: false,
        dropVideo: false,
      };
      Object.assign(window, { faults });
      const Context = window.AudioContext;
      window.AudioContext = class extends Context {
        constructor(...args: ConstructorParameters<typeof AudioContext>) {
          super(...args);
          faults.context = this;
        }
      };
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (descriptor) =>
        descriptor.name === ("microphone" as PermissionName)
          ? Promise.resolve(faults.permission as PermissionStatus)
          : query(descriptor);
      const acquire = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = (constraints) =>
        faults.permission.state === "denied"
          ? Promise.reject(new DOMException("Revoked", "NotAllowedError"))
          : acquire(constraints);
      Object.defineProperty(document, "hidden", {
        get: () => faults.background,
      });
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        if (faults.dropVideo && this.url.includes("/socket/video")) return;
        send.call(this, data);
      };
    });
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    await a.goto(baseURL!);
    await a.getByLabel("Your name", { exact: true }).fill("Alex");
    await a.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(a.locator(".invite-code span")).toBeVisible();
    const code = (await a.locator(".invite-code span").innerText()).trim();
    const state = async (): Promise<Snapshot> =>
      (await request.post("/__test/state/" + code)).json();
    await b.goto(baseURL + "/?room=" + code);
    await b.getByLabel("Your name", { exact: true }).fill("Sam");
    await b.getByRole("button", { name: "Join room", exact: true }).click();
    await expect
      .poll(async () => (await state()).players.every((p) => p.mediaReady))
      .toBe(true);
    await a.getByRole("button", { name: "Ready to argue" }).click();
    await b.getByRole("button", { name: "Ready to argue" }).click();
    await expect.poll(async () => (await state()).phase).toBe("TOPIC_SELECT");
    const lobby = await state();
    const tails =
      lobby.players.find((p) => p.id === lobby.tailsId)?.name === "Alex"
        ? a
        : b;
    await tails
      .getByRole("button", { name: "Is a hot dog a sandwich?" })
      .click();
    for (const page of [a, b])
      await page.getByRole("button", { name: "Confirm my side" }).click();
    await expect
      .poll(async () => {
        const s = await state();
        return s.phase === "ROUND" && !s.turn?.pausedReason;
      })
      .toBe(true);
    // Fill this turn's budget so a pending mock judgment cannot legitimately
    // increase it while we isolate device recovery and preserved evidence.
    await request.post("/__test/award/" + code, { data: { quality: 4 } });
    const before = await state();
    for (const fault of [
      "audio",
      "permission",
      "background",
      "video",
    ] as const) {
      await a.evaluate(async (kind) => {
        const f = (window as unknown as { faults: Faults }).faults;
        if (kind === "audio") await f.context!.suspend();
        if (kind === "permission") {
          f.permission.state = "denied";
          f.permission.dispatchEvent(new Event("change"));
        }
        if (kind === "background") {
          f.background = true;
          document.dispatchEvent(new Event("visibilitychange"));
        }
        if (kind === "video") f.dropVideo = true;
      }, fault);
      await expect.poll(async () => (await state()).phase).toBe("RECOVERING");
      const held = await state();
      expect(held.turn?.id).toBe(before.turn?.id);
      expect(held.turn?.playerId).toBe(before.turn?.playerId);
      expect(held.ledger).toEqual(before.ledger);
      await a.waitForTimeout(1200);
      const waiting = await state();
      expect(waiting.turn?.remainingMs).toBe(held.turn?.remainingMs);
      expect(waiting.players.map((p) => p.scoreUnits)).toEqual(
        before.players.map((p) => p.scoreUnits),
      );
      if (fault === "permission") {
        await a
          .getByRole("button", { name: "Check mic & camera", exact: true })
          .click();
        await expect(a.locator(".setup-status")).toContainText(
          "Allow your mic and camera",
        );
      }
      await a.evaluate(() => {
        const f = (window as unknown as { faults: Faults }).faults;
        f.permission.state = "granted";
        f.permission.dispatchEvent(new Event("change"));
        f.background = f.dropVideo = false;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      if (fault === "audio" || fault === "permission")
        await a
          .getByRole("button", {
            name: fault === "permission" ? "Try again" : "Check mic & camera",
            exact: true,
          })
          .click();
      await expect.poll(async () => (await state()).phase).toBe("ROUND");
      const resumed = await state();
      expect(resumed.turn?.id).toBe(before.turn?.id);
      expect(resumed.ledger).toEqual(before.ledger);
      expect(resumed.players.every((p) => p.mediaReady)).toBe(true);
      for (const page of [a, b]) {
        await expect(page.locator(".typed-recovery")).toHaveCount(0);
        await expect(page.locator(".room-notice")).toHaveCount(0);
      }
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("frozen live cameras require replacement and never resume on cached frames", async ({
  browser,
  baseURL,
  request,
}, info) => {
  const root = "output/playwright/recovery-dependable/after";
  const { mkdir } = await import("node:fs/promises");
  await mkdir(root, { recursive: true });
  await request.post("/__test/reset");
  const ca = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: root + "/video", size: { width: 1280, height: 720 } },
  });
  const cb = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 1280, height: 720 },
  });
  await ca.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    const f = {
      requests: [] as MediaStreamConstraints[],
      mode: "healthy",
      freeze: () => {},
      release: () => {},
      late: null as MediaStream | null,
    };
    Object.assign(window, { cameraFault: f });
    const camera = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d")!;
      let hue = 0;
      const draw = () => {
        ctx.fillStyle = `hsl(${hue++ % 360},60%,40%)`;
        ctx.fillRect(0, 0, 640, 360);
      };
      const stream = canvas.captureStream(24);
      draw();
      if (f.mode !== "still") {
        const timer = setInterval(draw, 40);
        f.freeze = () => clearInterval(timer);
        stream
          .getVideoTracks()[0]
          .addEventListener("ended", () => clearInterval(timer));
      }
      return stream;
    };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      f.requests.push(constraints || {});
      if (f.mode === "deny")
        throw new DOMException("Camera unavailable", "NotReadableError");
      if (f.mode === "pending")
        return new Promise<MediaStream>((resolve) => {
          f.release = () => {
            f.late = camera();
            resolve(f.late);
          };
        });
      const stream = await original(constraints);
      if (constraints?.video) {
        stream.getVideoTracks().forEach((t) => {
          t.stop();
          stream.removeTrack(t);
        });
        stream.addTrack(camera().getVideoTracks()[0]);
      }
      return stream;
    };
  });
  const a = await ca.newPage(),
    b = await cb.newPage();
  const states: Snapshot[] = [];
  let speechChecks = 0;
  a.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (
        typeof payload === "string" &&
        JSON.parse(payload).command?.type === "setup_start"
      )
        speechChecks++;
    });
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      const data = JSON.parse(payload);
      if (data.snapshot) states.push(data.snapshot);
    });
  });
  try {
    await a.goto(baseURL!);
    await a.getByLabel("Your name", { exact: true }).fill("Alex");
    await a.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(a.locator(".invite-code span")).toBeVisible();
    const code = (await a.locator(".invite-code span").innerText()).trim();
    const state = async (): Promise<Snapshot> =>
      (await request.post("/__test/state/" + code)).json();
    await b.goto(baseURL + "/?room=" + code);
    await b.getByLabel("Your name", { exact: true }).fill("Sam");
    await b.getByRole("button", { name: "Join room", exact: true }).click();
    await expect
      .poll(async () => (await state()).players.every((p) => p.mediaReady))
      .toBe(true);
    await a.getByRole("button", { name: "Mic on", exact: true }).click();
    await expect(
      a.getByRole("button", { name: "Turn mic on", exact: true }),
    ).toBeVisible();
    await expect(a.locator('.app > [aria-live="polite"]')).toHaveText(
      "Mic off.",
    );
    await expect(
      a.getByRole("button", { name: "Connecting video…", exact: true }),
    ).toHaveCount(0);
    await expect(b.locator(".lobby")).toContainText("Waiting for Alex’s mic.");
    await a.screenshot({ path: root + `/lobby-mute-${info.project.name}.png` });
    await a.getByRole("button", { name: "Turn mic on", exact: true }).click();
    await a
      .getByRole("button", { name: "Ready to argue", exact: true })
      .click();
    await b
      .getByRole("button", { name: "Ready to argue", exact: true })
      .click();
    await expect.poll(async () => (await state()).phase).toBe("TOPIC_SELECT");
    const lobby = await state();
    const tails =
      lobby.players.find((p) => p.id === lobby.tailsId)?.name === "Alex"
        ? a
        : b;
    await tails
      .getByRole("button", { name: "Is a hot dog a sandwich?" })
      .click();
    for (const p of [a, b])
      await p.getByRole("button", { name: "Confirm my side" }).click();
    await expect
      .poll(async () => {
        const s = await state();
        return s.phase === "ROUND" && !s.turn?.pausedReason;
      })
      .toBe(true);
    await request.post("/__test/award/" + code, { data: { quality: 4 } });
    const mic = await a
      .locator(".face-0 video")
      .evaluate(
        (v: HTMLVideoElement) =>
          (v.srcObject as MediaStream).getAudioTracks()[0].id,
      );
    const passedSpeechChecks = speechChecks;
    expect(passedSpeechChecks).toBe(1);
    await a.evaluate(() => (window as any).cameraFault.freeze());
    await expect.poll(async () => (await state()).phase).toBe("RECOVERING");
    const held = await state();
    states.length = 0;
    const preserved = async () => {
      const s = await state();
      expect(s.phase).toBe("RECOVERING");
      expect(s.turn).toEqual(held.turn);
      expect(s.ledger).toEqual(held.ledger);
      expect(s.players.map((p) => p.scoreUnits)).toEqual(
        held.players.map((p) => p.scoreUnits),
      );
      expect(states.every((s) => s.phase === "RECOVERING")).toBe(true);
    };
    await expect(
      a.getByRole("button", { name: "Restart camera", exact: true }),
    ).toBeVisible();
    await expect(a.locator(".recovery-reason")).toHaveText(
      "Your camera stopped.",
    );
    await expect(a.locator('.app > [aria-live="polite"]')).toHaveText(
      "Your camera stopped.",
    );
    await a.screenshot({
      path: root + `/camera-frozen-${info.project.name}.png`,
    });
    await a.evaluate(() => ((window as any).cameraFault.mode = "deny"));
    await a
      .getByRole("button", { name: "Restart camera", exact: true })
      .click();
    await expect(a.locator(".setup-status")).toContainText("busy");
    await expect(a.locator('.app > [aria-live="polite"]')).toHaveText(
      await a.locator(".setup-status").innerText(),
    );
    await preserved();
    await a.setViewportSize({ width: 360, height: 640 });
    await a.emulateMedia({ reducedMotion: "reduce" });
    await a.screenshot({
      path: root + `/camera-denied-phone-${info.project.name}.png`,
      fullPage: true,
    });
    await a.evaluate(() => ((window as any).cameraFault.mode = "still"));
    await a.getByRole("button", { name: "Try again", exact: true }).click();
    await expect
      .poll(() => a.evaluate(() => (window as any).cameraFault.requests.length))
      .toBe(3);
    // Longer than the freshness window catches a false resume/re-pause, not just the endpoint.
    await a.waitForTimeout(4200);
    await preserved();
    await expect(
      a.getByRole("button", { name: "Restart camera", exact: true }),
    ).toBeVisible();
    const clipped = await a
      .locator(".controls, .phase-content")
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => n.getBoundingClientRect().bottom > innerHeight + 1)
          .map((n) => n.className),
      );
    expect(clipped).toEqual([]);
    await a.screenshot({
      path: root + `/camera-cached-phone-${info.project.name}.png`,
      fullPage: true,
    });
    await a.evaluate(() => ((window as any).cameraFault.mode = "pending"));
    await a
      .getByRole("button", { name: "Restart camera", exact: true })
      .click();
    await expect(
      a.getByRole("button", { name: "Cancel check", exact: true }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Cancel check", exact: true }).click();
    await a.evaluate(() => (window as any).cameraFault.release());
    await expect
      .poll(() =>
        a.evaluate(
          () => (window as any).cameraFault.late.getVideoTracks()[0].readyState,
        ),
      )
      .toBe("ended");
    await preserved();
    await a.setViewportSize({ width: 390, height: 844 });
    await a.evaluate(() => ((window as any).cameraFault.mode = "healthy"));
    await a
      .getByRole("button", { name: "Restart camera", exact: true })
      .focus();
    await a.keyboard.press("Enter");
    await expect.poll(async () => (await state()).phase).toBe("ROUND");
    const resumed = await state();
    expect(resumed.turn!.id).toBe(held.turn!.id);
    expect(resumed.turn!.remainingMs).toBe(held.turn!.remainingMs);
    expect(resumed.ledger).toEqual(held.ledger);
    expect(resumed.players.every((p) => p.mediaReady)).toBe(true);
    expect(speechChecks).toBe(passedSpeechChecks);
    expect(
      await a
        .locator(".face-0 video")
        .evaluate(
          (v: HTMLVideoElement) =>
            (v.srcObject as MediaStream).getAudioTracks()[0].id,
        ),
    ).toBe(mic);
    const constraints = await a.evaluate(
      () => (window as any).cameraFault.requests as MediaStreamConstraints[],
    );
    expect(
      constraints.slice(1).every((c) => c.audio === false && !!c.video),
    ).toBe(true);
    await a.screenshot({
      path: root + `/camera-repaired-phone-${info.project.name}.png`,
    });
  } finally {
    await Promise.all([ca.close(), cb.close()]);
    await a.video()!.saveAs(root + `/camera-repair-${info.project.name}.webm`);
  }
});
