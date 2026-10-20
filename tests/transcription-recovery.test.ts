import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { WebSocket } from "ws";
import { InkSession } from "../server/providers/ink";
import { encodeMicrophone } from "../shared/media";
import { flush, roomFixture } from "./fixtures";
import { FakeInkTransport } from "./ink-fixture";

async function fixture(t: TestContext) {
  const sessions: {
    stream: InkSession;
    socket: FakeInkTransport;
    sent: number;
    closes: number;
  }[] = [];
  const { room, turn } = roomFixture({
    now: () => 100000,
    transcriptionAvailable: () => true,
    createTranscription: (id, roundId, turnId, handlers) => {
      const socket = new FakeInkTransport();
      const stream = new InkSession(id, roundId, turnId, handlers, socket);
      const session = { stream, socket, sent: 0, closes: 0 };
      socket.sendRaw = (pcm) => {
        session.sent += pcm.length;
      };
      socket.send = () => {
        session.closes++;
        socket.close();
      };
      sessions.push(session);
      socket.push({ type: "message", message: { type: "connected" } });
      return stream;
    },
    judge: async (
      _state,
      segments,
      _kind,
      _targets,
      _recent,
      _claims,
      jobId,
    ) => ({
      jobId,
      scores: segments.map((s) => ({
        playerId: s.playerId,
        roundId: s.roundId,
        turnId: s.turnId!,
        segmentId: s.id,
        criterion: "reasoning" as const,
        quality: s.text.startsWith("The pockets") ? 4 : 1,
        reason: "Syrup pockets distribute sweetness.",
      })),
      arguments: [],
      reaction: null,
      intervention: null,
    }),
  });
  t.after(() => {
    room.close();
    sessions.forEach(({ socket }) => socket.close());
  });
  // Device requalification is explicit here; browser journeys cover its sensors.
  room.readiness.tick = () => {};
  room.playback.say = async () => {};
  room.judging.prepareHandoff = () => {};
  const id = turn.playerId;
  room.seats.get(id)!.sockets.set("audio", { close() {} } as WebSocket);
  room.readiness.get(id).passed = true;
  room.transcription.rotate(id, turn.id);
  await flush();
  let seq = 0,
    epoch = 10;
  const capture = (end = false, fill = 1) => {
    room.media.audio(
      id,
      Buffer.from(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          ++seq,
          100000,
          new Uint8Array(end ? 0 : 640).fill(fill),
          { purpose: "gameplay", inputEpoch: turn.inputEpoch!, end },
        ),
      ),
    );
  };
  const hold = (session = sessions.at(-1)!) => {
    session.socket.send = () => {
      session.closes++;
    };
    return session;
  };
  const replace = async () => {
    room.disconnect(id);
    room.game.connectPlayer(id);
    room.game.state.players.forEach((p) => {
      p.mediaReady = true;
    });
    room.readiness.get(id).passed = true;
    room.transcription.rotate(id, turn.id);
    await flush();
    room.game.resumeRecovery();
    room.game.grantInput(++epoch);
    return sessions.at(-1)!;
  };
  const seal = () => {
    capture(true);
    room.game.endTurn(id, turn.id, seq);
  };
  return { room, turn, id, sessions, capture, hold, replace, seal };
}

function abnormal(socket: FakeInkTransport) {
  socket.ended = true;
  socket.listeners.get("close")?.(1006, "fixture failure", []);
  socket.wake.resolve();
}
function final(
  socket: FakeInkTransport,
  text = "Waffle pockets distribute syrup across every bite.",
) {
  socket.push({
    type: "message",
    message: { type: "turn.end", transcript: text },
  });
  socket.close();
}

for (const [fault, fill] of [
  ["abnormal", 0],
  ["abnormal", 1],
  ["error", 1],
] as const) {
  test(`${fault} retired gameplay drainage aborts after recovery (PCM fill ${fill})`, async (t) => {
    const f = await fixture(t),
      old = f.hold();
    f.capture(false, fill);
    assert.equal(old.sent, 640);
    await f.replace();
    f.capture();
    if (fault === "abnormal") abnormal(old.socket);
    else
      old.socket.push({ type: "error", error: new Error("provider failure") });
    assert.equal(await old.stream.close(), false);
    await flush();
    assert.equal(f.room.game.state.phase, "ABORTED");
    assert.equal(f.room.game.state.winnerId, null);
    assert.equal(f.room.game.state.turnIndex, 0);
    assert.equal(f.room.failures.get("transcription"), 1);
  });
}

test("replacement settlement waits for a retired clean final and scores it exactly once", async (t) => {
  const f = await fixture(t),
    old = f.hold();
  f.capture();
  const current = await f.replace();
  f.capture();
  f.seal();
  await flush();
  assert.equal(current.closes, 1);
  assert.equal(f.room.game.state.turnIndex, 0);
  assert.equal(f.room.game.state.turn?.settlement, "draining");
  final(old.socket);
  await old.stream.close();
  await flush();
  assert.equal(f.room.game.turns.get(f.turn.id)!.segments.size, 1);
  assert.equal(f.room.game.state.ledger.length, 1);
  assert.equal(f.room.game.state.turnIndex, 1);
  old.stream.update("Waffle pockets distribute syrup across every bite.", true);
  await flush();
  assert.equal(f.room.game.state.ledger.length, 1);
  assert.equal(old.closes, 1);
});

test("multiple recovery epochs retain completed evidence and await every pending contributor", async (t) => {
  const f = await fixture(t),
    first = f.hold();
  f.capture();
  const second = f.hold(await f.replace());
  final(first.socket);
  await first.stream.close();
  await flush();
  assert(!f.room.transcription.active.has(first.stream));
  f.capture();
  await f.replace();
  f.capture();
  f.seal();
  await flush();
  assert.equal(f.room.game.state.turnIndex, 0);
  final(second.socket, "The pockets also keep syrup off your plate.");
  await second.stream.close();
  await flush();
  assert.equal(f.room.game.state.turnIndex, 1);
  assert.equal(f.room.game.turns.get(f.turn.id)!.segments.size, 2);
  assert.equal(f.room.game.state.ledger.length, 2);
  assert.equal(first.closes, 1);
  assert.equal(second.closes, 1);
});

test("a recovered contributor keeps its original drain deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await fixture(t),
    old = f.hold();
  f.capture();
  await f.replace();
  t.mock.timers.tick(2000);
  f.capture();
  f.seal();
  await flush();
  t.mock.timers.tick(2999);
  await flush();
  assert.equal(f.room.game.state.turn?.settlement, "draining");
  t.mock.timers.tick(1);
  await flush();
  assert.equal(f.room.game.state.phase, "ABORTED");
  assert.equal(f.room.transcription.active.size, 0);
  assert.equal(old.closes, 1);
  assert.equal(f.room.failures.get("transcription"), 1);
});

test("a synchronous gameplay send failure is registered before the provider callback", async (t) => {
  const f = await fixture(t);
  f.sessions[0].socket.sendRaw = () => {
    throw new Error("send failed");
  };
  f.capture();
  await flush();
  assert.equal(f.room.game.state.phase, "ABORTED");
  assert.equal(f.room.failures.get("transcription"), 1);
  assert.equal(f.room.transcription.active.size, 0);
});

test("unused preparation and private-check failures do not invalidate gameplay evidence", async (t) => {
  const f = await fixture(t),
    unused = f.hold();
  await f.replace();
  abnormal(unused.socket);
  await unused.stream.close();
  await flush();
  assert.equal(f.room.game.state.phase, "ROUND");
  f.room.game.recover("Check microphone");
  const check = f.room.readiness.get(f.id);
  check.setup = "checking";
  check.checkId = "private";
  check.captureId = "capture";
  f.room.transcription.rotate(f.id, null, true);
  await flush();
  const privateStream = f.sessions.at(-1)!;
  assert.equal(privateStream.stream.turnId, null);
  privateStream.socket.push({
    type: "error",
    error: new Error("private failure"),
  });
  await flush();
  assert.equal(f.room.game.state.phase, "RECOVERING");
  assert.equal(check.setup, "failed");
});

for (const transition of ["abort", "dispose", "rematch"] as const) {
  test(`a retired contributor cannot mutate a room after ${transition}`, async (t) => {
    const f = await fixture(t),
      old = f.hold();
    f.capture();
    await f.replace();
    if (transition === "dispose") f.room.close();
    else {
      f.room.game.abort("Fixture ended");
      if (transition === "rematch") f.room.game.startMatch();
    }
    await flush();
    const before = f.room.game.snapshot();
    abnormal(old.socket);
    await old.stream.close();
    old.stream.update("Late discarded words.", true);
    await flush();
    assert.deepEqual(f.room.game.snapshot(), before);
    assert.equal(f.room.transcription.active.size, 0);
  });
}

test("a missing final transcription owner cannot silently settle an ended turn", async (t) => {
  const f = await fixture(t);
  f.capture(true);
  f.room.transcription.ink.delete(f.id);
  f.room.game.endTurn(f.id, f.turn.id, f.room.seats.get(f.id)!.audioSeq);
  await flush();
  assert.equal(f.room.game.state.phase, "ABORTED");
  assert.equal(f.room.game.state.turnIndex, 0);
});
