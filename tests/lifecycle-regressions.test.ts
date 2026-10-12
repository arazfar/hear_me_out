import assert from "node:assert/strict";
import test from "node:test";
import { RoomController } from "../server/rooms/room";
import { acceptUpgrade } from "../server/transport/upgrade";
import { Client } from "../src/game/client";

test("an old failed judgment cannot abort a replacement match", async () => {
  const savedFetch = globalThis.fetch,
    savedKey = process.env.OPENAI_API_KEY;
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((r) => {
    started = r;
  });
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) {
      started();
      await new Promise<void>((r) => {
        release = r;
      });
    }
    return new Response(
      JSON.stringify({ error: { message: "Fixture failure" } }),
      { status: 400 },
    );
  };
  process.env.OPENAI_API_KEY = "fixture";
  const c = new RoomController("1234");
  c.game.onEvent = () => {};
  try {
    const a = c.game.addPlayer("Sam"),
      b = c.game.addPlayer("Alex");
    c.game.startMatch();
    c.game.selectTopic();
    c.game.proposeTopic(
      c.game.state.tailsId!,
      "Waffles are better",
      "Waffles",
      "Pancakes",
      true,
    );
    c.game.confirm(a.id, 1);
    c.game.confirm(b.id, 1);
    const t = c.game.state.turn!;
    const segment = {
      id: "s",
      playerId: t.playerId,
      roundId: c.game.state.roundId!,
      turnId: t.id,
      sessionEpoch: "old",
      text: "Syrup pockets spread sweetness.",
      stableAt: Date.now(),
      eligible: true,
      source: "voice" as const,
    };
    c.game.registerSegment(segment);
    c.judging.queue.push(segment);
    const pending = c.judging.drain();
    await entered;
    c.game.abort("Old game ended");
    c.game.startMatch();
    const match = c.game.state.matchId;
    release();
    await pending;
    assert.equal(c.game.state.matchId, match);
    assert.equal(c.game.state.phase, "INTRO_COIN");
  } finally {
    c.close();
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  }
});
test("leaving invalidates an in-flight resume response", async () => {
  const client = new Client();
  let resolve!: (r: Response) => void;
  const savedFetch = globalThis.fetch,
    savedStorage = globalThis.sessionStorage;
  globalThis.fetch = async () =>
    await new Promise<Response>((r) => {
      resolve = r;
    });
  globalThis.sessionStorage = {
    length: 0,
    clear: () => {},
    getItem: () => null,
    key: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  client.session = {
    roomId: "old",
    playerId: "a",
    token: "fixture",
    connectionEpoch: 1,
    code: "1234",
  };
  let attached = false;
  client.attach = () => {
    attached = true;
  };
  try {
    client.scheduleReconnect();
    await new Promise((r) => setTimeout(r, 1050));
    client.leave();
    resolve(
      new Response(
        JSON.stringify({ session: { roomId: "old" }, snapshot: {} }),
      ),
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(attached, false);
  } finally {
    client.leave();
    globalThis.fetch = savedFetch;
    globalThis.sessionStorage = savedStorage;
  }
});
test("synchronized media time survives a local wall-clock jump", () => {
  const client = new Client();
  const original = Date.now;
  let wall = 100000;
  Date.now = () => wall;
  try {
    client.message({ type: "pong", clientTime: wall, serverNow: 200000 });
    const before = client.serverNow();
    wall += 60000;
    assert(Math.abs(client.serverNow() - before) < 100);
  } finally {
    Date.now = original;
  }
});
test("malformed upgrade origins are rejected without throwing", () => {
  assert.equal(
    acceptUpgrade("/socket/control", "game.example", "https://game.example"),
    true,
  );
  for (const origin of ["null", "%", "https://elsewhere.example"])
    assert.equal(
      acceptUpgrade("/socket/control", "game.example", origin),
      false,
    );
});
