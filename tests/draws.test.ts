import assert from "node:assert/strict";
import test from "node:test";
import { Game } from "../server/game/game";
import { startRound, roomFixture } from "./fixtures";
import { completedOutcome } from "../shared/domain";
import {
  commandEnvelopeSchema,
  PROTOCOL_VERSION,
  type GameEvent,
} from "../shared/protocol";
import { FeedbackController } from "../src/game/feedback";

function fixture() {
  let now = 100000;
  const events: GameEvent[] = [];
  const game = new Game(
    "1234",
    (event) => events.push(event),
    () => now,
  );
  startRound(game);
  return {
    game,
    events,
    next: () => {
      now += 3000;
      game.tick();
    },
  };
}
for (const [name, rounds, wins, drawn] of [
  [
    "ordinary winner",
    [
      [12, 4],
      [12, 4],
    ],
    [2, 0],
    false,
  ],
  [
    "zero-point ties",
    [
      [0, 0],
      [0, 0],
    ],
    [2, 2],
    true,
  ],
  [
    "nonzero ties",
    [
      [17, 17],
      [23, 23],
    ],
    [2, 2],
    true,
  ],
  [
    "win then tie",
    [
      [12, 4],
      [20, 20],
    ],
    [2, 1],
    false,
  ],
  [
    "deciding tie",
    [
      [12, 4],
      [4, 12],
      [16, 16],
    ],
    [2, 2],
    true,
  ],
] as const)
  test(name + " uses exact round units and first-to-two", () => {
    const { game, events, next } = fixture();
    const [a, b] = game.state.players;
    for (const scores of rounds) {
      a.scoreUnits = scores[0];
      b.scoreUnits = scores[1];
      game.resolveRound();
      const result = game.state.results.at(-1)!;
      assert.equal(
        result.winnerId,
        scores[0] === scores[1] ? null : scores[0] > scores[1] ? a.id : b.id,
      );
      const earned = [a.wins, b.wins];
      game.resolveRound();
      assert.deepEqual(
        [a.wins, b.wins],
        earned,
        "duplicate settlement cannot award wins again",
      );
      next();
    }
    assert.equal(game.state.phase, "MATCH_RESULT");
    assert.deepEqual([a.wins, b.wins], wins);
    assert.equal(game.state.winnerId, drawn ? null : a.id);
    assert.equal(completedOutcome(game.state)?.playerIds.length, drawn ? 2 : 1);
    assert.equal(events.filter((e) => e.type === "match_result").length, 1);
    const snapshot = game.snapshot();
    game.disconnectPlayer(b.id);
    game.resumePlayer(b.id);
    game.connectPlayer(b.id);
    assert.deepEqual(game.state.results, snapshot.results);
    assert.equal(game.state.phase, "MATCH_RESULT");
    assert.equal(game.state.winnerId, snapshot.winnerId);
    for (const p of game.state.players) {
      p.mediaReady = true;
      game.rematch(p.id, true);
    }
    assert.equal(game.state.phase, "INTRO_COIN");
    assert.deepEqual(
      game.state.players.map((p) => p.wins),
      [0, 0],
    );
    assert.equal(completedOutcome(game.state), null);
  });

test("equal totals ignore criterion differences and draws celebrate both once", () => {
  const { game, events } = fixture();
  const [a, b] = game.state.players;
  const feedback = new FeedbackController();
  feedback.accept(game.snapshot());
  a.scoreUnits = b.scoreUnits = 12;
  game.state.ledger.push({
    id: "award",
    playerId: a.id,
    roundId: game.state.roundId!,
    turnId: game.state.turn!.id,
    segmentId: "s",
    criterion: "reasoning",
    quality: 3,
    deltaUnits: 12,
    reason: "Stronger reasoning",
    at: 0,
  });
  game.resolveRound();
  assert.equal(game.state.results[0].winnerId, null);
  const event = [...events].reverse().find((e) => e.type === "round_result")!;
  const cue = feedback.accept(event.snapshot, event).cue;
  assert(cue?.kind === "round");
  assert.deepEqual(cue.playerIds, [a.id, b.id]);
  assert.equal(feedback.accept(event.snapshot, event).cue, undefined);
  a.wins = b.wins = 2;
  game.finishMatch();
  const finalEvent = [...events]
    .reverse()
    .find((e) => e.type === "match_result")!;
  const finalCue = feedback.accept(finalEvent.snapshot, finalEvent).cue;
  assert(finalCue?.kind === "match");
  assert.deepEqual(finalCue.playerIds, [a.id, b.id]);
  assert.equal(feedback.accept(finalEvent.snapshot, finalEvent).cue, undefined);
  assert.equal(
    new FeedbackController().accept(finalEvent.snapshot, finalEvent).cue,
    undefined,
    "restored outcomes never celebrate again",
  );
  game.state.phase = "ABORTED";
  assert.equal(completedOutcome(game.state), null);
});

test("room-owned final tied round produces draw speech and survives departure", async () => {
  const { room } = roomFixture();
  const players = room.game.state.players;
  players.forEach((p) => {
    p.wins = 1;
    p.scoreUnits = 8;
  });
  room.game.resolveRound();
  assert.equal(room.game.state.phase, "MATCH_RESULT");
  assert.equal(room.game.state.winnerId, null);
  assert.match(room.game.state.judge?.text || "", /draw/i);
  const before = room.game.snapshot();
  room.leave(players[1].id);
  assert.equal(room.game.state.phase, "MATCH_RESULT");
  assert.equal(room.game.state.winnerId, null);
  assert.deepEqual(room.game.state.results, before.results);
  await room.close();
});

test("preset topic contract rejects free text, missing/unknown IDs, and invalid sides", () => {
  assert.equal(PROTOCOL_VERSION, 6);
  const envelope = {
    commandId: "c",
    connectionEpoch: 1,
    matchId: "m",
    expectedPhaseVersion: 1,
  };
  for (const command of [
    {
      type: "propose_topic",
      suggestion: "waffles",
      chosenPosition: "positive",
    },
    { type: "propose_topic", suggestion: "hotdog", chosenPosition: "negative" },
  ])
    assert(commandEnvelopeSchema.safeParse({ ...envelope, command }).success);
  for (const command of [
    { type: "propose_topic", chosenPosition: "positive" },
    {
      type: "propose_topic",
      suggestion: "missing",
      chosenPosition: "positive",
    },
    { type: "propose_topic", suggestion: "waffles", chosenPosition: "waffles" },
    {
      type: "propose_topic",
      suggestion: "waffles",
      chosenPosition: "positive",
      text: "custom",
    },
  ])
    assert(!commandEnvelopeSchema.safeParse({ ...envelope, command }).success);
});
