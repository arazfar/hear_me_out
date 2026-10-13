import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Client } from "../src/game/client";
import { Game } from "../server/game/game";
import type { Session } from "../shared/protocol";
import { deferred, flush } from "./fixtures";

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const client = new Client();
  const game = new Game("1234");
  const player = game.addPlayer("Alex");
  const session: Session = {
    roomId: game.state.roomId,
    playerId: player.id,
    token: "fixture",
    connectionEpoch: 1,
    code: "1234",
  };
  client.session = session;
  client.state = game.snapshot();
  const requests: {
    deferred: ReturnType<typeof deferred<Response>>;
    signal: AbortSignal;
    body: Session & { resumeId: string };
    at: number;
  }[] = [];
  const leaves: (Session & { resumeId?: string })[] = [];
  t.mock.method(globalThis, "fetch", (url: string, init: RequestInit) => {
    if (url === "/api/leave") {
      leaves.push(JSON.parse(init.body as string));
      return Promise.resolve(new Response("{}"));
    }
    const request = {
      deferred: deferred<Response>(),
      signal: init.signal!,
      body: JSON.parse(init.body as string),
      at: now,
    };
    requests.push(request);
    return request.deferred.promise;
  });
  const stored = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const storage = new Map([["hmo-seat", JSON.stringify(session)]]);
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      removeItem: (key: string) => storage.delete(key),
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  const attached: Session[] = [];
  client.attach = (session, snapshot) => {
    attached.push(session);
    client.session = session;
    client.state = snapshot;
    client.clock.reset();
    for (const channel of ["control", "audio", "video"])
      client.sockets.set(channel, {
        readyState: WebSocket.OPEN,
        send() {},
        close() {},
      } as unknown as WebSocket);
  };
  client.reportHealth = async () => {};
  t.after(() => {
    client.leave();
    if (stored) Object.defineProperty(globalThis, "sessionStorage", stored);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });
  return {
    client,
    game,
    requests,
    attached,
    session,
    storage,
    leaves,
    advance: async (ms: number) => {
      now += ms;
      t.mock.timers.tick(ms);
      await flush();
    },
    answer: async (index: number, epoch = 2) => {
      requests[index].deferred.resolve(
        new Response(
          JSON.stringify({
            session: { ...session, connectionEpoch: epoch },
            snapshot: game.snapshot(),
          }),
        ),
      );
      await flush();
    },
    handshake: async () => {
      client.clock.observe(Date.now());
      client.connection.progress(true);
      await flush();
    },
  };
}

test("restore stays blocked until authentication, clock synchronization, and every socket are ready", async (t) => {
  const f = fixture(t);
  const restoring = f.client.restore();
  const duplicate = f.client.restore();
  assert.equal(f.requests.length, 1, "restore calls share the active attempt");
  await f.answer(0);
  assert(f.client.reconnecting);
  f.client.connection.progress(true);
  assert(f.client.reconnecting, "authentication alone is insufficient");
  const video = f.client.sockets.get("video")!;
  f.client.sockets.delete("video");
  await f.handshake();
  assert(f.client.reconnecting, "clock and control alone are insufficient");
  f.client.sockets.set("video", video);
  await f.handshake();
  await restoring;
  await duplicate;
  assert.equal(f.client.connection.phase, "connected");
});

test("stalled requests time out and retry serially with bounded backoff", async (t) => {
  const f = fixture(t);
  f.client.scheduleReconnect();
  await f.advance(1000);
  assert.equal(f.requests.length, 1);
  await f.advance(10000);
  assert(f.requests[0].signal.aborted);
  await f.advance(1999);
  assert.equal(f.requests.length, 1);
  await f.advance(1);
  assert.equal(f.requests.length, 2);
  assert.equal(
    f.requests[1].body.connectionEpoch,
    1,
    "a lost response retries the same epoch",
  );
  assert.equal(f.requests[1].body.resumeId, f.requests[0].body.resumeId);
  await f.advance(10000);
  await f.advance(4000);
  assert.equal(f.requests.length, 3);
  await f.answer(0, 2);
  assert.equal(f.attached.length, 0, "obsolete HTTP response cannot attach");
  await f.answer(2, 2);
  await f.handshake();
  assert.equal(f.client.connection.phase, "connected");
  assert.equal(f.attached.length, 1);
});

test("delayed response bodies and missing authentication share the attempt deadline", async (t) => {
  const f = fixture(t),
    body = deferred<unknown>();
  f.client.scheduleReconnect();
  await f.advance(1000);
  f.requests[0].deferred.resolve({
    status: 200,
    ok: true,
    json: () => body.promise,
  } as Response);
  await flush();
  await f.advance(10000);
  assert(f.requests[0].signal.aborted);
  await f.advance(2000);
  await f.answer(1, 2);
  assert.equal(f.attached.length, 1);
  f.client.clock.observe(Date.now());
  f.client.connection.progress();
  await f.advance(10000);
  assert(
    f.requests[1].signal.aborted,
    "open sockets and a clock do not replace authentication",
  );
  body.resolve({
    session: { ...f.session, connectionEpoch: 99 },
    snapshot: f.game.snapshot(),
  });
  await flush();
  assert.equal(f.attached.length, 1);
});

test("automatic recovery exhausts at 60 seconds; explicit retry can fetch the current server state", async (t) => {
  const f = fixture(t);
  f.client.scheduleReconnect();
  for (let i = 0; i < 60; i++) await f.advance(1000);
  assert.equal(f.client.connection.phase, "offline");
  const count = f.requests.length;
  await f.advance(20000);
  assert.equal(f.requests.length, count);
  f.client.retryConnection();
  assert.equal(f.requests.length, count + 1);
  await f.answer(count);
  await f.handshake();
  assert.equal(f.client.connection.phase, "connected");
});

test("known recovery allowance bounds a pending handshake without extending the server clock", async (t) => {
  const f = fixture(t);
  const snapshot = f.game.snapshot();
  snapshot.phase = "RECOVERING";
  snapshot.recoveryDeadline = snapshot.serverNow + 2500;
  const connecting = f.client.connection.open(f.session, snapshot);
  await f.advance(2500);
  await connecting;
  assert.equal(f.client.connection.phase, "offline");
  assert.equal(f.client.state!.recoveryDeadline, snapshot.recoveryDeadline);
  assert.equal(f.requests.length, 0);
});

test("leaving cancels requests and retry delay; late replies cannot reopen the seat", async (t) => {
  const f = fixture(t);
  f.client.scheduleReconnect();
  await f.advance(1000);
  f.client.leave();
  assert.deepEqual(f.leaves[0], f.requests[0].body);
  assert.equal(f.storage.has("hmo-seat"), false);
  assert(f.requests[0].signal.aborted);
  await f.answer(0);
  await f.advance(60000);
  assert.equal(f.attached.length, 0);
  assert.equal(f.requests.length, 1);
  f.client.session = f.session;
  f.client.scheduleReconnect();
  f.client.leave();
  await f.advance(10000);
  assert.equal(f.requests.length, 1);
});

test("reload retains an unanswered resume identity and accepted responses clear it atomically", async (t) => {
  const f = fixture(t);
  const first = f.client.restore();
  const pending = JSON.parse(f.storage.get("hmo-seat")!);
  assert.equal(pending.resumeId, f.requests[0].body.resumeId);
  assert.equal(pending.connectionEpoch, 1);
  f.client.connection.cancel();
  await first;
  const restored = f.client.restore();
  assert.deepEqual(f.requests[1].body, pending);
  await f.answer(1);
  assert.deepEqual(JSON.parse(f.storage.get("hmo-seat")!), {
    ...f.session,
    connectionEpoch: 2,
  });
  assert.equal(f.client.connection.departure()!.connectionEpoch, 2);
  await f.handshake();
  await restored;
  f.client.scheduleReconnect();
  await f.advance(1000);
  assert.notEqual(f.requests[2].body.resumeId, pending.resumeId);
  assert.equal(f.requests[2].body.connectionEpoch, 2);
  // An old response arriving after the newer transition cannot clear its ID.
  await f.answer(0, 2);
  assert.equal(
    JSON.parse(f.storage.get("hmo-seat")!).resumeId,
    f.requests[2].body.resumeId,
  );
});

test("leaving during socket authentication discards the handshake and its deadline", async (t) => {
  const f = fixture(t);
  const restoring = f.client.restore();
  await f.answer(0);
  assert.equal(f.attached.length, 1);
  f.client.leave();
  await f.handshake();
  await restoring;
  await f.advance(60000);
  assert.equal(f.client.connection.phase, "idle");
  assert.equal(f.client.session, null);
  assert.equal(f.client.sockets.size, 0);
  assert.equal(f.requests.length, 1);
});

test("gameplay commands cannot be sent while connection state is uncertain", (t) => {
  const f = fixture(t),
    sent: unknown[] = [];
  f.client.send = (data) => {
    sent.push(data);
  };
  f.client.connection.phase = "connecting";
  f.client.command({ type: "ready", value: true });
  f.client.command({ type: "rematch", value: true });
  f.client.command({ type: "done", turnId: "stale", lastAudioSeq: 0 });
  assert.equal(sent.length, 0);
  f.client.connection.phase = "connected";
  f.client.command({ type: "ready", value: true });
  assert.equal(sent.length, 1);
});
