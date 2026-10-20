import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Client } from "../src/game/client";
import { deferred, flush } from "./fixtures";

function captureFixture(t: TestContext) {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("// PCM worklet"),
  );
  const requests: ReturnType<typeof deferred<MediaStream>>[] = [];
  let loadModule = async () => {};
  let modules = 0;
  const constraints: MediaStreamConstraints[] = [];
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  };
  class Track extends EventTarget {
    id = crypto.randomUUID();
    readyState = "live";
    enabled = true;
    muted = false;
    constructor(public kind: string) {
      super();
    }
    stop() {
      this.readyState = "ended";
    }
    getSettings() {
      return { deviceId: this.id };
    }
  }
  class Stream {
    constructor(public tracks: Track[]) {}
    getTracks() {
      return this.tracks;
    }
    getAudioTracks() {
      return this.tracks.filter((t) => t.kind === "audio");
    }
    getVideoTracks() {
      return this.tracks.filter((t) => t.kind === "video");
    }
  }
  class Node {
    port = {
      onmessage: null as ((event: any) => void) | null,
      postMessage: (data: any) => {
        if (data.requestId)
          queueMicrotask(() =>
            this.port.onmessage?.({
              data: { type: "isolated", requestId: data.requestId },
            }),
          );
      },
    };
    gain = { value: 0 };
    connect() {
      return this;
    }
    disconnect() {}
  }
  const mediaDevices = Object.assign(new EventTarget(), {
    getUserMedia: (requested: MediaStreamConstraints) => {
      constraints.push(requested);
      const request = deferred<MediaStream>();
      requests.push(request);
      return request.promise;
    },
  });
  replace("navigator", { mediaDevices });
  replace("MediaStream", Stream);
  replace("AudioWorkletNode", Node);
  const client = new Client();
  client.sound.unlock = async () => {};
  client.sound.context = Object.assign(new EventTarget(), {
    state: "running",
    currentTime: 0,
    resume: async () => {},
    audioWorklet: {
      addModule: () => {
        modules++;
        return loadModule();
      },
    },
    createMediaStreamSource: () => new Node(),
    createGain: () => new Node(),
    destination: new Node(),
  }) as unknown as AudioContext;
  client.peer.makePeer = () => {};
  client.video.prepareVideo = () => {};
  client.reportHealth = async () => {};
  const stream = (audio = true, video = true) =>
    new Stream([
      ...(audio ? [new Track("audio")] : []),
      ...(video ? [new Track("video")] : []),
    ]) as unknown as MediaStream;
  t.after(() => {
    client.capture.stop();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return {
    client,
    requests,
    constraints,
    stream,
    module: (load: () => Promise<void>) => {
      loadModule = load;
    },
    modules: () => modules,
  };
}

test("cancel releases the attempt immediately and stops late permission tracks", async (t) => {
  const f = captureFixture(t),
    request = f.client.capture.devices();
  await flush();
  assert.equal(f.requests.length, 1);
  f.client.capture.cancelRequest();
  await assert.rejects(request, /cancelled/);
  const late = f.stream();
  f.requests[0].resolve(late);
  await flush();
  assert(late.getTracks().every((t) => t.readyState === "ended"));
  assert.equal(f.client.capture.stream, null);
});

test("a late permission response cannot replace a newer successful retry", async (t) => {
  const f = captureFixture(t),
    first = f.client.capture.devices();
  await flush();
  f.client.capture.cancelRequest();
  await assert.rejects(first);
  const retry = f.client.capture.devices();
  await flush();
  const good = f.stream();
  f.requests[1].resolve(good);
  await retry;
  const old = f.stream();
  f.requests[0].resolve(old);
  await flush();
  assert.equal(f.client.capture.captureId, good.getAudioTracks()[0].id);
  assert(good.getTracks().every((t) => t.readyState === "live"));
  assert(old.getTracks().every((t) => t.readyState === "ended"));
});

test("permission timeout rejects once, stops late tracks, and leaves retry available", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = captureFixture(t),
    request = f.client.capture.devices();
  await flush();
  t.mock.timers.tick(30001);
  await assert.rejects(request, /Device setup took too long/);
  assert.equal(f.client.capture.deviceRequest, null);
  const late = f.stream();
  f.requests[0].resolve(late);
  await flush();
  assert(late.getTracks().every((t) => t.readyState === "ended"));
});

test("healthy device reuse preserves track identity and a replacement reacquires only the failed device", async (t) => {
  const f = captureFixture(t),
    first = f.client.capture.devices();
  await flush();
  f.requests[0].resolve(f.stream());
  await first;
  const mic = f.client.capture.captureId,
    camera = f.client.capture.stream!.getVideoTracks()[0];
  await f.client.capture.devices();
  assert.equal(f.requests.length, 1);
  assert.equal(f.client.capture.captureId, mic);
  camera.stop();
  const retry = f.client.capture.devices();
  await flush();
  f.requests[1].resolve(f.stream());
  await retry;
  assert.equal(f.client.capture.captureId, mic);
  assert.notEqual(f.client.capture.stream!.getVideoTracks()[0].id, camera.id);
});

test("retry replaces a live source-muted microphone once and completes the private check with the same camera", async (t) => {
  const f = captureFixture(t);
  t.after(() => f.client.setup.cancel());
  const first = f.client.capture.devices();
  await flush();
  f.requests[0].resolve(f.stream());
  await first;
  const original = f.client.capture.stream!;
  const mic = original.getAudioTracks()[0],
    camera = original.getVideoTracks()[0];
  Object.defineProperty(mic, "muted", { value: true });
  const commands = await setupState(f, false);
  const repair = f.client.setup.run();
  await flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.constraints[1].video, false);
  assert(f.constraints[1].audio);
  const replacement = f.stream(true, false);
  f.requests[1].resolve(replacement);
  await flush();
  assert.equal(f.client.capture.stream!.getVideoTracks()[0], camera);
  assert.equal(
    f.client.capture.stream!.getAudioTracks()[0],
    replacement.getAudioTracks()[0],
  );
  assert.equal(mic.readyState, "ended");
  assert.equal(camera.readyState, "live");
  assert.equal(
    commands.filter((command) => command.type === "setup_start").length,
    1,
  );
  f.client.state!.players[0].readiness = { setup: "passed", blockers: [] };
  f.client.setup.result({
    type: "setup_result",
    checkId: f.client.setup.checkId,
    status: "passed",
    text: "Bonk, hear me out.",
  });
  await repair;
  assert.equal(f.client.setup.phase, "ready");
  assert.equal(f.requests.length, 2);
});

for (const outcome of ["denied", "cancelled"] as const) {
  test(`source-muted microphone repair ${outcome} preserves the healthy camera and stops late tracks`, async (t) => {
    const f = captureFixture(t);
    const first = f.client.capture.devices();
    await flush();
    f.requests[0].resolve(f.stream());
    await first;
    const original = f.client.capture.stream!,
      graph = f.client.capture.worklet;
    Object.defineProperty(original.getAudioTracks()[0], "muted", {
      value: true,
    });
    const repair = f.client.capture.devices();
    await flush();
    assert.equal(f.requests.length, 2);
    if (outcome === "denied")
      f.requests[1].reject(new DOMException("denied", "NotAllowedError"));
    else f.client.capture.cancelRequest();
    await assert.rejects(repair);
    assert.equal(f.client.capture.stream, original);
    assert.equal(f.client.capture.worklet, graph);
    assert.equal(original.getVideoTracks()[0].readyState, "live");
    if (outcome === "cancelled") {
      const late = f.stream(true, false);
      f.requests[1].resolve(late);
      await flush();
      assert.equal(late.getAudioTracks()[0].readyState, "ended");
      assert.equal(f.client.capture.stream, original);
    }
  });
}

test("source mute and player mic-off remain distinct during repair", async (t) => {
  const f = captureFixture(t);
  const first = f.client.capture.devices();
  await flush();
  f.requests[0].resolve(f.stream());
  await first;
  f.client.capture.muteMic();
  await f.client.capture.devices();
  assert.equal(
    f.requests.length,
    1,
    "explicit mic-off does not replace a healthy source",
  );
  const previous = f.client.capture.stream!;
  Object.defineProperty(previous.getAudioTracks()[0], "muted", { value: true });
  const repair = f.client.capture.devices();
  await flush();
  assert.equal(f.requests.length, 2);
  f.client.capture.muteCamera();
  const replacement = f.stream(true, false);
  f.requests[1].resolve(replacement);
  await repair;
  assert.equal(replacement.getAudioTracks()[0].enabled, false);
  assert.equal(
    f.client.capture.stream!.getVideoTracks()[0],
    previous.getVideoTracks()[0],
  );
  assert.equal(previous.getVideoTracks()[0].enabled, false);
  assert.equal(f.client.capture.micMuted, true);
  assert.equal(f.client.capture.cameraOff, true);
});

test("setup replies from cancelled attempts cannot unlock a newer check", () => {
  const client = new Client();
  client.capture.syncMicrophone = () => {};
  client.setup.busy = true;
  client.setup.checkId = "new";
  client.setup.phase = "testing";
  client.setup.result({
    type: "setup_result",
    checkId: "old",
    status: "passed",
    text: "Old words",
  });
  assert.equal(client.setup.phase, "testing");
  client.setup.result({
    type: "setup_result",
    checkId: "new",
    status: "passed",
    text: "Current words",
  });
  assert.equal(client.setup.text, "Current words");
  client.setup.busy = false;
  client.setup.result({
    type: "setup_result",
    checkId: "new",
    status: "failed",
    text: "Late failure",
  });
  assert.equal(client.setup.error, "");
});

test("targeted camera repair replaces a live stalled track and preserves the microphone graph", async (t) => {
  const f = captureFixture(t);
  const first = f.client.capture.devices();
  await flush();
  f.requests[0].resolve(f.stream());
  await first;
  const mic = f.client.capture.stream!.getAudioTracks()[0];
  const camera = f.client.capture.stream!.getVideoTracks()[0];
  const graph = f.client.capture.worklet;
  const repair = f.client.capture.devices("camera");
  await flush();
  assert.equal(f.constraints[1].audio, false);
  assert(f.constraints[1].video);
  assert.equal(mic.readyState, "live");
  f.requests[1].resolve(f.stream(false));
  await repair;
  assert.equal(f.client.capture.stream!.getAudioTracks()[0], mic);
  assert.equal(f.client.capture.worklet, graph);
  assert.equal(camera.readyState, "ended");
  assert.notEqual(f.client.capture.stream!.getVideoTracks()[0], camera);
});

test("denied and cancelled camera repairs preserve healthy capture and stop obsolete replacements", async (t) => {
  const f = captureFixture(t);
  const first = f.client.capture.devices();
  await flush();
  f.requests[0].resolve(f.stream());
  await first;
  const original = f.client.capture.stream;
  const denied = f.client.capture.devices("camera");
  await flush();
  f.requests[1].reject(new DOMException("denied", "NotAllowedError"));
  await assert.rejects(denied, /Allow your camera/);
  assert.equal(f.client.capture.stream, original);
  const cancelled = f.client.capture.devices("camera");
  await flush();
  assert.equal(
    f.client.capture.devices("camera"),
    cancelled,
    "one active acquisition",
  );
  f.client.capture.cancelRequest();
  await assert.rejects(cancelled, /cancelled/);
  const late = f.stream(false);
  f.requests[2].resolve(late);
  await flush();
  assert(late.getTracks().every((t) => t.readyState === "ended"));
  assert(original!.getTracks().every((t) => t.readyState === "live"));
  assert.equal(f.client.capture.stream, original);
});

test("cancellation before audio unlock cannot request devices later", async (t) => {
  const f = captureFixture(t),
    unlock = deferred<void>();
  f.client.sound.unlock = () => unlock.promise;
  const first = f.client.capture.devices();
  f.client.capture.cancelRequest();
  await assert.rejects(first, /cancelled/);
  unlock.resolve();
  await flush();
  assert.equal(f.requests.length, 0);
});

for (const failure of ["cancel", "timeout", "module"] as const) {
  test(`${failure} during microphone initialization preserves the existing camera and graph`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = captureFixture(t),
      load = deferred<void>();
    // A valid camera and an ended mic, with no PCM module cached in this context.
    const original = f.stream();
    const camera = original.getVideoTracks()[0];
    original.getAudioTracks()[0].stop();
    f.client.capture.stream = original;
    let disconnected = false;
    const graph = {
      disconnect: () => {
        disconnected = true;
      },
    } as unknown as AudioWorkletNode;
    f.client.capture.worklet = graph;
    f.module(() => load.promise);
    const repair = f.client.capture.devices();
    await flush();
    const acquired = f.stream(true, false);
    f.requests[0].resolve(acquired);
    await flush();
    assert.equal(f.constraints[0].video, false);
    assert.equal(f.client.capture.stream, original, "no partial commit");
    if (failure === "cancel") f.client.capture.cancelRequest();
    if (failure === "timeout") t.mock.timers.tick(30001);
    if (failure === "module") load.reject(new Error("download failed"));
    await assert.rejects(repair);
    assert.equal(f.client.capture.stream, original);
    assert.equal(f.client.capture.worklet, graph);
    assert.equal(disconnected, false);
    assert.equal(camera.readyState, "live");
    assert(acquired.getTracks().every((track) => track.readyState === "ended"));
    load.resolve();
    await flush();
    assert.equal(
      f.client.capture.stream,
      original,
      "late initialization cannot commit",
    );
  });
}

test("failed modules can retry; successful PCM loading is reused on microphone replacement", async (t) => {
  const f = captureFixture(t);
  f.module(async () => {
    throw new Error("download failed");
  });
  const first = f.client.capture.devices();
  await flush();
  const bad = f.stream();
  f.requests[0].resolve(bad);
  await assert.rejects(first, /load microphone/);
  assert.equal(f.client.capture.stream, null);
  assert(bad.getTracks().every((track) => track.readyState === "ended"));
  f.module(async () => {});
  const retry = f.client.capture.devices();
  await flush();
  f.requests[1].resolve(f.stream());
  await retry;
  const current = f.client.capture.stream!,
    camera = current.getVideoTracks()[0];
  current.getAudioTracks()[0].stop();
  const replacement = f.client.capture.devices();
  await flush();
  f.requests[2].resolve(f.stream(true, false));
  await replacement;
  assert.equal(f.modules(), 2);
  assert.equal(f.client.capture.stream!.getVideoTracks()[0], camera);
  f.client.setup.cancel();
  assert(
    f.client.capture
      .stream!.getTracks()
      .every((track) => track.readyState === "live"),
    "cancelling after commit retains capture",
  );
});

for (const replacing of ["camera", "microphone"] as const) {
  test(`${replacing} replacement keeps the other device's privacy choice made during permissions`, async (t) => {
    const f = captureFixture(t);
    const initial = f.client.capture.devices();
    await flush();
    f.requests[0].resolve(f.stream());
    await initial;
    const previous = f.client.capture.stream!;
    if (replacing === "microphone") previous.getAudioTracks()[0].stop();
    const repair = f.client.capture.devices(
      replacing === "camera" ? "camera" : undefined,
    );
    await flush();
    if (replacing === "camera") f.client.capture.muteMic();
    else f.client.capture.muteCamera();
    f.requests[1].resolve(
      f.stream(replacing === "microphone", replacing === "camera"),
    );
    await repair;
    const kept =
      replacing === "camera"
        ? f.client.capture.stream!.getAudioTracks()[0]
        : f.client.capture.stream!.getVideoTracks()[0];
    assert.equal(kept.enabled, false);
    assert.equal(kept.readyState, "live");
    assert.equal(
      replacing === "camera"
        ? f.client.capture.micMuted
        : f.client.capture.cameraOff,
      true,
    );
    await f.client.capture.devices();
    assert.equal(
      kept.enabled,
      false,
      "healthy reuse cannot enable either device",
    );
    assert.equal(f.requests.length, 2);
    if (replacing === "camera") f.client.capture.muteMic();
    else f.client.capture.muteCamera();
    assert.equal(
      kept.enabled,
      true,
      "explicit player action restores the device",
    );
  });
}

test("privacy changes gate staged tracks during module loading and survive cancellation and retry", async (t) => {
  const f = captureFixture(t),
    load = deferred<void>();
  f.module(() => load.promise);
  const attempt = f.client.capture.devices();
  await flush();
  const staged = f.stream();
  f.requests[0].resolve(staged);
  await flush();
  f.client.capture.muteMic();
  f.client.capture.muteCamera();
  assert(staged.getTracks().every((track) => !track.enabled));
  f.client.capture.cancelRequest();
  await assert.rejects(attempt, /cancelled/);
  assert(staged.getTracks().every((track) => track.readyState === "ended"));
  f.module(async () => {});
  const retry = f.client.capture.devices();
  await flush();
  f.requests[1].resolve(f.stream());
  await retry;
  load.resolve();
  await flush();
  assert(f.client.capture.stream!.getTracks().every((track) => !track.enabled));
  assert.equal(f.client.capture.microphoneAllowed(), false);
});

test("commit uses the latest privacy intent after worklet loading", async (t) => {
  const f = captureFixture(t),
    load = deferred<void>();
  f.module(() => load.promise);
  const attempt = f.client.capture.devices();
  await flush();
  f.requests[0].resolve(f.stream());
  await flush();
  f.client.capture.muteMic();
  f.client.capture.muteCamera();
  f.client.capture.muteCamera();
  load.resolve();
  await attempt;
  assert.equal(f.client.capture.stream!.getVideoTracks()[0].enabled, true);
  assert.equal(f.client.capture.stream!.getAudioTracks()[0].enabled, false);
  f.client.setup.listening = true;
  assert.equal(
    f.client.capture.microphoneAllowed(),
    false,
    "private checks cannot override privacy",
  );
  f.client.clock.observe(Date.now());
  const sent: Uint8Array[] = [];
  f.client.sockets.set("audio", {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: (data: Uint8Array) => sent.push(data),
  } as unknown as WebSocket);
  f.client.capture.worklet!.port.onmessage!({
    data: {
      type: "pcm",
      mediaEpoch: 0,
      purpose: "private",
      inputEpoch: 1,
      capturedAt: Date.now(),
      pcm: new Int16Array([1234, 5678]).buffer,
      level: 1,
    },
  } as MessageEvent);
  assert.equal(sent.length, 1);
  const { decodeMicrophone } = await import("../shared/media");
  assert(decodeMicrophone(sent[0])!.pcm.every((byte) => byte === 0));
  f.client.setup.listening = false;
  const rtc: (MediaStreamTrack | null)[] = [];
  f.client.peer.audioSender = {
    replaceTrack: async (track: MediaStreamTrack | null) => {
      rtc.push(track);
    },
  } as RTCRtpSender;
  f.client.capture.muteMic();
  await flush();
  f.client.capture.muteMic();
  await flush();
  assert.deepEqual(rtc, [f.client.capture.stream!.getAudioTracks()[0], null]);
});

async function setupState(
  f: ReturnType<typeof captureFixture>,
  passed: boolean,
) {
  const { Game } = await import("../server/game/game");
  const game = new Game("1234"),
    player = game.addPlayer("Alex");
  player.captureReady = true;
  player.readiness = {
    setup: passed ? "passed" : "needed",
    blockers: passed ? [] : ["speech_check"],
  };
  f.client.state = game.snapshot();
  f.client.session = {
    roomId: game.state.roomId,
    playerId: player.id,
    token: "fixture",
    code: "1234",
    connectionEpoch: 1,
  };
  f.client.connection.phase = "connected";
  const commands: import("../shared/protocol").Command[] = [];
  f.client.command = (command) => {
    commands.push(command);
    return crypto.randomUUID();
  };
  return commands;
}

test("reconnection reuses the private check identity and reconciles a lost success without reacquiring devices", async (t) => {
  const f = captureFixture(t),
    commands = await setupState(f, false);
  const running = f.client.setup.run();
  await flush();
  f.requests[0].resolve(f.stream());
  await flush();
  const checkId = f.client.setup.checkId;
  f.client.setup.result({
    type: "setup_result",
    checkId,
    status: "listening",
    text: "Say it.",
  });
  f.client.connection.phase = "connecting";
  f.client.setup.connectionInterrupted();
  assert.equal(f.client.setup.phase, "connecting");
  assert.equal(f.client.setup.listening, false);
  assert.equal(f.client.capture.microphoneAllowed(), false);
  f.client.connection.phase = "connected";
  f.client.setup.reconnected();
  assert.equal(commands.filter((c) => c.type === "setup_start").length, 2);
  assert(
    commands
      .filter((c) => c.type === "setup_start")
      .every((c) => c.checkId === checkId),
  );
  assert.equal(f.requests.length, 1);
  f.client.state!.players[0].readiness = { setup: "passed", blockers: [] };
  f.client.setup.result({
    type: "setup_result",
    checkId,
    status: "passed",
    text: "Bonk, hear me out.",
  });
  await running;
  assert.equal(f.client.setup.busy, false);
  assert.equal(f.client.setup.phase, "ready");
  assert.equal(f.client.setup.text, "Bonk, hear me out.");
  assert.equal(f.client.setup.listening, false);
});

test("repeated reconnects cannot extend the client's check timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = captureFixture(t);
  await setupState(f, false);
  const running = f.client.setup.run();
  await flush();
  f.requests[0].resolve(f.stream());
  await flush();
  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(5000);
    f.client.setup.connectionInterrupted();
    f.client.setup.reconnected();
  }
  t.mock.timers.tick(1001);
  await running;
  assert.equal(f.client.setup.busy, false);
  assert.equal(f.client.setup.phase, "error");
  assert.match(f.client.setup.error, /No words came through/);
  assert.equal(f.requests.length, 1);
});

for (const action of ["cancel", "privacy"] as const) {
  test(`${action} while reconnecting revokes private-result reconciliation`, async (t) => {
    const f = captureFixture(t),
      commands = await setupState(f, false);
    const running = f.client.setup.run();
    await flush();
    f.requests[0].resolve(f.stream());
    await flush();
    const checkId = f.client.setup.checkId;
    f.client.connection.phase = "connecting";
    f.client.setup.connectionInterrupted();
    if (action === "cancel") f.client.setup.cancel();
    else f.client.capture.muteMic();
    await running;
    const count = commands.length;
    f.client.connection.phase = "connected";
    f.client.setup.reconnected();
    f.client.setup.result({
      type: "setup_result",
      checkId,
      status: "passed",
      text: "Obsolete",
    });
    assert.equal(commands.length, count);
    assert.equal(f.client.setup.text, "");
    assert.equal(f.client.setup.listening, false);
    assert.equal(f.client.setup.busy, false);
    assert(
      f.client.capture
        .stream!.getTracks()
        .every((t) => t.readyState === "live"),
    );
    if (action === "privacy")
      assert.equal(f.client.capture.stream!.getAudioTracks()[0].enabled, false);
  });
}

test("repair commits healthy capture then suspends checks until the player explicitly enables the mic", async (t) => {
  const f = captureFixture(t);
  const commands = await setupState(f, true);
  const setup = f.client.setup.run("camera");
  await flush();
  f.client.capture.muteMic();
  f.requests[0].resolve(f.stream());
  await setup;
  assert.equal(f.client.setup.phase, "privacy");
  assert.equal(f.client.setup.busy, false);
  assert.equal(f.client.setup.error, "");
  assert(
    f.client.capture
      .stream!.getTracks()
      .every((track) => track.readyState === "live"),
  );
  assert.equal(
    commands.some((c) => c.type === "setup_start"),
    false,
  );
  f.client.capture.muteMic();
  await flush();
  assert.equal(f.client.setup.phase, "ready");
  assert.equal(f.client.setup.busy, false);
  assert.equal(f.requests.length, 1);
  assert.equal(
    commands.some((c) => c.type === "setup_start"),
    false,
    "valid speech proof is reused",
  );
});

test("privacy during private speech cancels only that check and ignores its late result", async (t) => {
  const f = captureFixture(t);
  const commands = await setupState(f, false);
  const setup = f.client.setup.run();
  await flush();
  f.requests[0].resolve(f.stream());
  await flush();
  const old = f.client.setup.checkId;
  assert(old);
  f.client.setup.result({
    type: "setup_result",
    checkId: old,
    status: "listening",
    text: "",
  });
  f.client.capture.muteCamera();
  await setup;
  assert.equal(f.client.setup.phase, "privacy");
  assert.equal(f.client.setup.listening, false);
  assert.equal(f.client.setup.error, "");
  assert(commands.some((c) => c.type === "setup_cancel" && c.checkId === old));
  f.client.setup.result({
    type: "setup_result",
    checkId: old,
    status: "passed",
    text: "late",
  });
  assert.equal(f.client.setup.text, "");
  f.client.capture.muteCamera();
  await flush();
  const next = f.client.setup.checkId;
  assert.notEqual(next, old);
  f.client.state!.players[0].readiness = { setup: "passed", blockers: [] };
  f.client.setup.result({
    type: "setup_result",
    checkId: next,
    status: "passed",
    text: "Bonk, hear me out",
  });
  await flush();
  assert.equal(f.client.setup.phase, "ready");
  assert.equal(f.requests.length, 1);
});
