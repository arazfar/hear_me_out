import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { command } from "../server/rooms/commands";
import { createRegistry } from "../server/rooms/registry";
import type { RoomController } from "../server/rooms/room";
import type { Command, ServerMessage } from "../shared/protocol";
import { fakeSpeech, services, startRound } from "./fixtures";

function fixture(t: TestContext) {
  const registry = createRegistry(services(), () => true);
  const rooms = ["1234", "5678"].map((code) => {
    const room = registry.createRoom(code);
    registry.rooms.set(code, room);
    registry.byId.set(room.game.state.roomId, room);
    registry.session(room, "Alex");
    registry.session(room, "Sam");
    room.game.state.players.forEach((p) => (p.mediaReady = true));
    room.readiness.tick = () => {};
    room.playback.say = async () => {};
    return room;
  });
  t.after(() => rooms.forEach((room) => room.close()));
  const send = (room: RoomController, player: number, c: Command) =>
    command(registry, room, room.game.state.players[player].id, {
      commandId: crypto.randomUUID(),
      connectionEpoch: 1,
      matchId: room.game.state.matchId,
      expectedPhaseVersion: room.game.state.phaseVersion,
      command: c,
    });
  const count = () =>
    rooms.filter(
      (r) => !["LOBBY", "MATCH_RESULT", "ABORTED"].includes(r.game.state.phase),
    ).length;
  return { registry, rooms, send, count };
}

function verdict(room: RoomController) {
  startRound(room.game);
  room.playback.pendingHandoff = null;
  room.playback.hostCues = [];
  room.game.state.players[0].wins = 1;
  room.game.state.players[0].scoreUnits = 20;
  room.game.resolveRound();
  room.game.finishMatch();
  const speech = fakeSpeech(room);
  room.playback.speech = speech;
  room.game.bufferJudge({
    id: speech.id,
    epoch: speech.epoch,
    status: "speaking",
    text: "Case closed.",
    startAt: 100000,
    expression: "happy",
    targetPlayerId: null,
  });
  return speech;
}

test("a queued rematch rechecks admission at real playback completion, preserves its verdict, and can retry", async (t) => {
  const {
    rooms: [a, b],
    send,
    count,
  } = fixture(t);
  const speech = verdict(a);
  const before = structuredClone({
    winner: a.game.state.winnerId,
    results: a.game.state.results,
    ledger: a.game.state.ledger,
    match: a.game.state.matchId,
  });
  const messages: { id: string; message: ServerMessage }[] = [];
  a.send = (id, message) =>
    messages.push({ id, message: message as ServerMessage });
  await send(a, 0, { type: "rematch", value: true });
  await send(a, 1, { type: "rematch", value: true });
  await send(b, 0, { type: "ready", value: true });
  await send(b, 1, { type: "ready", value: true });
  assert.equal(count(), 1);
  a.playback.finishSpeech(speech);
  assert.equal(count(), 1);
  assert.equal(a.game.state.phase, "MATCH_RESULT");
  assert.deepEqual(
    {
      winner: a.game.state.winnerId,
      results: a.game.state.results,
      ledger: a.game.state.ledger,
      match: a.game.state.matchId,
    },
    before,
  );
  assert.deepEqual(a.game.state.rematchReady, []);
  assert(a.game.state.players.every((p) => !p.ready));
  for (const p of a.game.state.players)
    assert(
      messages.some(
        ({ id, message }) =>
          id === p.id &&
          message.type === "error" &&
          /stage is occupied/.test(message.error),
      ),
    );
  b.game.abort("Fixture complete");
  await send(a, 0, { type: "rematch", value: true });
  await send(a, 1, { type: "rematch", value: true });
  assert.equal(a.game.state.phase, "INTRO_COIN");
  assert.notEqual(a.game.state.matchId, before.match);
  assert.equal(count(), 1);
});

function permutations<T>(values: T[]): T[][] {
  return values.length
    ? values.flatMap((value, i) =>
        permutations(values.filter((_, j) => j !== i)).map((rest) => [
          value,
          ...rest,
        ]),
      )
    : [[]];
}

test("all readiness arrival orders admit only one room", async (t) => {
  for (const order of permutations([0, 1, 2, 3])) {
    const { rooms, send, count } = fixture(t);
    for (const action of order) {
      try {
        await send(rooms[Math.floor(action / 2)], action % 2, {
          type: "ready",
          value: true,
        });
      } catch (error) {
        assert.match((error as Error).message, /stage is occupied/);
      }
      assert(count() <= 1);
    }
    assert.equal(count(), 1);
    rooms.forEach((room) => room.close());
  }
});

test("deferred lobby and direct aborted rematch starts also use authoritative admission", async (t) => {
  const {
    rooms: [a, b],
    send,
    count,
  } = fixture(t);
  const speech = fakeSpeech(a);
  a.playback.speech = speech;
  a.game.bufferJudge({
    id: speech.id,
    epoch: speech.epoch,
    status: "speaking",
    text: "Welcome.",
    startAt: 100000,
    expression: "happy",
    targetPlayerId: null,
  });
  await send(a, 0, { type: "ready", value: true });
  await send(a, 1, { type: "ready", value: true });
  b.game.startMatch();
  a.playback.finishSpeech(speech);
  assert.equal(a.game.state.phase, "LOBBY");
  assert(a.game.state.players.every((p) => !p.ready));
  a.game.abort("Fixture abort");
  a.game.state.players.forEach((p) => a.game.rematch(p.id, true));
  assert.equal(a.game.state.phase, "ABORTED");
  assert.deepEqual(a.game.state.rematchReady, []);
  assert.equal(count(), 1);
});

test("departure while a rematch is queued cannot start a match after playback", async (t) => {
  const {
    rooms: [a],
    send,
    count,
  } = fixture(t);
  const speech = verdict(a);
  await send(a, 0, { type: "rematch", value: true });
  await send(a, 1, { type: "rematch", value: true });
  const winner = a.game.state.winnerId;
  a.leave(a.game.state.players[0].id);
  a.playback.finishSpeech(speech);
  a.game.maybeRematch();
  assert.equal(count(), 0);
  assert.equal(a.game.state.phase, "MATCH_RESULT");
  assert.equal(a.game.state.winnerId, winner);
});
