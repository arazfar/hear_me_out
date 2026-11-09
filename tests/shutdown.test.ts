import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import { WebSocket } from "ws";
import { createApp } from "../server/app";
import { RoomController } from "../server/rooms/room";
import { services, fakeTranscription, deferred } from "./fixtures";

test("room closure waits, deduplicates providers, and attempts cleanup after failures", async () => {
  const runtime = createApp({ services: services() });
  const room = runtime.registry.createRoom("1234");
  runtime.registry.rooms.set("1234", room);
  const pending = deferred<boolean>();
  let calls = 0;
  const stream = fakeTranscription(null, "");
  stream.close = () => {
    calls++;
    return pending.promise;
  };
  room.transcription.active.add(stream);
  room.transcription.ink.set("player", stream);
  const broken = fakeTranscription(null, "");
  broken.close = () => {
    throw new Error("test failure");
  };
  room.transcription.active.add(broken);
  const first = room.close();
  assert.equal(first, room.close());
  assert(room.closed);
  assert.equal(calls, 1);
  let finished = false;
  const closing = runtime.close().then((ok) => {
    finished = true;
    return ok;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  pending.resolve(true);
  assert.equal(await first, false);
  assert.equal(await closing, false);
});

test("room closure attempts each timer and closes providers after a timer clear fails", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const room = new RoomController(
    "1234",
    services({ setTimeout, clearTimeout }),
  );
  let fired = 0;
  const failed = room.later(() => fired++, 100);
  const pending = room.later(() => fired++, 100);
  const clear = t.mock.method(
    room.services,
    "clearTimeout",
    (timer: Parameters<typeof clearTimeout>[0]) => {
      if (timer === failed) throw new Error("test failure");
      clearTimeout(timer);
    },
  );
  const stream = fakeTranscription(null, "");
  const closeStream = t.mock.method(stream, "close");
  room.transcription.active.add(stream);

  assert.equal(await room.close(), false);
  assert.deepEqual(
    clear.mock.calls.map((call) => call.arguments[0]),
    [failed, pending],
  );
  assert.equal(room.timers.has(pending), false);
  assert.equal(closeStream.mock.callCount(), 1);
  t.mock.timers.tick(100);
  assert.equal(fired, 0);
});

test(
  "an unresponsive WebSocket is force-closed after five seconds",
  { timeout: 10000 },
  async () => {
    const runtime = createApp();
    await new Promise<void>((resolve) =>
      runtime.server.listen(0, "127.0.0.1", resolve),
    );
    const address = runtime.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/socket/control`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    // Stop reading so this peer cannot receive/respond to the close handshake.
    ws.pause();
    const start = performance.now();
    try {
      assert.equal(await runtime.close(), true);
      assert(performance.now() - start >= 4900);
      assert(performance.now() - start < 8000);
    } finally {
      ws.terminate();
      await runtime.close();
    }
  },
);

for (const mode of ["delayed", "rejected", "stalled"]) {
  test(
    `production signal handler: ${mode} cleanup`,
    { timeout: 30000 },
    async (t) => {
      const child = fork(
        new URL("./support/shutdown-child.ts", import.meta.url),
        [mode],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "pipe", "pipe", "ipc"],
          env: {
            ...process.env,
            OPENAI_API_KEY: "",
            CARTESIA_API_KEY: "",
            FISH_AUDIO_API_KEY: "",
          },
        },
      );
      t.after(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      });
      let stderr = "";
      const messages: any[] = [];
      child.on("message", (message) => messages.push(message));
      child.stderr!.on("data", (chunk) => (stderr += chunk));
      const exited = new Promise<{
        code: number | null;
        signal: string | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("message", () => resolve());
      });
      const start = performance.now();
      child.kill("SIGTERM");
      // Deliver a different signal while the first cleanup is still pending.
      const repeat = setTimeout(() => child.kill("SIGINT"), 50);
      const result = await exited;
      clearTimeout(repeat);
      const elapsed = performance.now() - start;
      assert.equal(result.signal, null);
      assert.equal(result.code, mode === "delayed" ? 0 : 1);
      assert(elapsed >= (mode === "stalled" ? 24900 : 240));
      assert(elapsed < (mode === "stalled" ? 27000 : 3000));
      assert(!stderr.includes("PRIVATE_PROVIDER_PAYLOAD"));
      assert.equal(messages.filter((message) => message.closing).length, 1);
      assert.equal(
        messages.filter((message) => message.voiceCancelled).length,
        1,
      );
      if (mode !== "stalled") {
        assert(messages.some((message) => message.disposed));
        assert(messages.some((message) => message.voiceDisposed));
      }
      if (mode === "stalled") assert.match(stderr, /deadline/);
      if (mode === "rejected") assert.match(stderr, /did not complete cleanly/);
    },
  );
}
