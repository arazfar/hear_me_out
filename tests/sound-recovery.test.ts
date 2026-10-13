import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Client } from "../src/game/client";
import { deferred, flush } from "./fixtures";

function soundFixture(t: TestContext) {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("// Playback worklet"),
  );
  const savedContext = globalThis.AudioContext;
  const savedWorklet = globalThis.AudioWorkletNode;
  let blocked = false,
    moduleFails = false,
    requests = 0,
    contexts = 0,
    holdModules = false,
    failGraph = false;
  const modules: ReturnType<typeof deferred<void>>[] = [];
  const playbackNodes: Playback[] = [];
  class Node {
    gain = { value: 1, setTargetAtTime() {} };
    connect() {
      return this;
    }
    disconnect() {}
  }
  class Playback extends Node {
    disconnected = false;
    constructor() {
      super();
      playbackNodes.push(this);
    }
    connect() {
      if (failGraph) throw new Error("Cannot connect audio node");
      return this;
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  class Context {
    currentTime = 0;
    destination = new Node();
    state = "running";
    constructor() {
      contexts++;
    }
    resume() {
      return blocked ? new Promise<void>(() => {}) : Promise.resolve();
    }
    audioWorklet = {
      addModule: async () => {
        requests++;
        if (holdModules) {
          const module = deferred<void>();
          modules.push(module);
          return module.promise;
        }
        if (moduleFails) throw new Error("Audio download failed.");
      },
    };
    createGain() {
      return new Node();
    }
    createAnalyser() {
      return new Node();
    }
  }
  globalThis.AudioContext = Context as unknown as typeof AudioContext;
  globalThis.AudioWorkletNode = Playback as unknown as typeof AudioWorkletNode;
  t.after(() => {
    client.sound.cancelInitialization();
    globalThis.AudioContext = savedContext;
    globalThis.AudioWorkletNode = savedWorklet;
  });
  const client = new Client();
  return {
    client,
    modules,
    playbackNodes,
    holdModules: (value: boolean) => (holdModules = value),
    failGraph: (value: boolean) => (failGraph = value),
    block: (value: boolean) => (blocked = value),
    failModule: (value: boolean) => (moduleFails = value),
    requests: () => requests,
    contexts: () => contexts,
  };
}

test("blocked audio unlock offers a retry without retaining an obsolete promise", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = soundFixture(t);
  f.block(true);
  const first = f.client.sound.unlock();
  t.mock.timers.tick(2001);
  await assert.rejects(first, /Tap again/);
  f.block(false);
  await f.client.sound.unlock();
  assert(f.client.sound.peerPlayback);
  assert.equal(f.contexts(), 1);
});

test("a failed audio module can retry using the same unlocked context", async (t) => {
  const f = soundFixture(t);
  f.failModule(true);
  await assert.rejects(f.client.sound.unlock(), /Couldn’t load sound/);
  await flush();
  f.failModule(false);
  await f.client.sound.unlock();
  assert(f.client.sound.peerPlayback);
  assert(f.client.sound.judgeGain);
  assert.equal(f.requests(), 2);
  assert.equal(f.contexts(), 1);
});

test("a stalled audio module times out, retries, and ignores obsolete completion", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = soundFixture(t);
  f.holdModules(true);
  const first = f.client.sound.unlock();
  assert.equal(
    f.client.sound.unlock(),
    first,
    "concurrent callers share one attempt",
  );
  await flush();
  t.mock.timers.tick(10000);
  await assert.rejects(first, /Couldn’t load sound/);
  const retry = f.client.sound.unlock();
  await flush();
  assert.equal(f.requests(), 2);
  f.modules[0].resolve();
  await flush();
  assert.equal(
    f.playbackNodes.length,
    0,
    "obsolete work cannot publish a node",
  );
  f.modules[1].resolve();
  await retry;
  assert.equal(f.playbackNodes.length, 1);
  assert.equal(f.contexts(), 1);
  await f.client.sound.unlock();
  assert.equal(f.requests(), 2, "successful initialization is reused");
});

test("cancelling setup releases audio initialization while retaining healthy capture", async (t) => {
  const f = soundFixture(t);
  let stopped = 0;
  const stream = {
    getTracks: () => [{ stop: () => stopped++ }],
  } as unknown as MediaStream;
  f.client.capture.stream = stream;
  f.holdModules(true);
  const pending = f.client.sound.unlock();
  await flush();
  f.client.setup.cancel();
  await assert.rejects(pending, /cancelled/);
  assert.equal(f.client.capture.stream, stream);
  assert.equal(stopped, 0);
  f.holdModules(false);
  await f.client.sound.unlock();
  const playback = f.client.sound.peerPlayback;
  f.modules[0].resolve();
  await flush();
  assert.equal(f.client.sound.peerPlayback, playback);
  assert.equal(f.playbackNodes.length, 1);
  f.client.setup.cancel();
  assert.equal(f.playbackNodes[0].disconnected, false);
});

test("leaving during audio initialization rejects immediately and cannot attach late nodes", async (t) => {
  const f = soundFixture(t);
  const saved = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { removeItem() {} },
  });
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, "sessionStorage", saved);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });
  f.holdModules(true);
  const pending = f.client.sound.unlock();
  await flush();
  f.client.leave();
  await assert.rejects(pending, /cancelled/);
  f.modules[0].resolve();
  await flush();
  assert.equal(f.playbackNodes.length, 0);
  assert.equal(f.client.sound.peerPlayback, null);
});

test("failed audio-node initialization cleans staging and reuses the loaded module", async (t) => {
  const f = soundFixture(t);
  f.failGraph(true);
  await assert.rejects(f.client.sound.unlock(), /Couldn’t load sound/);
  assert.equal(f.playbackNodes[0].disconnected, true);
  assert.equal(f.client.sound.peerPlayback, null);
  const gain = f.client.sound.peerGain;
  f.failGraph(false);
  await f.client.sound.unlock();
  assert.equal(f.requests(), 1);
  assert.equal(f.contexts(), 1);
  assert.equal(f.client.sound.peerGain, gain);
  assert.equal(f.playbackNodes[1].disconnected, false);
});

test("audio download timeout aborts its request and a late body cannot load a module", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = soundFixture(t);
  const body = deferred<string>();
  let signal: AbortSignal | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      signal = init.signal!;
      return { ok: true, text: () => body.promise } as Response;
    },
  );
  const first = f.client.sound.unlock();
  await flush();
  t.mock.timers.tick(10000);
  await assert.rejects(first, /Couldn’t load sound/);
  assert.equal(signal?.aborted, true);
  t.mock.method(globalThis, "fetch", async () => new Response("// Retry"));
  await f.client.sound.unlock();
  body.resolve("// Obsolete response");
  await flush();
  assert.equal(
    f.requests(),
    1,
    "only the replacement download reaches addModule",
  );
  assert.equal(f.playbackNodes.length, 1);
});
