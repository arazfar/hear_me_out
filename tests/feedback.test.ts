import assert from "node:assert/strict";
import test from "node:test";
import { Game } from "../server/game/game";
import { startRound } from "./fixtures";
import { points, type Snapshot } from "../shared/domain";
import type { GameEvent } from "../shared/protocol";
import { FeedbackController, ScoreTally } from "../src/game/feedback";
import { Client } from "../src/game/client";
import { AwardQueue, type ScoreAward } from "../src/game/award-queue";
import { turnStatus } from "../src/ui/presentation";

const notice = (n: number): ScoreAward => ({
  kind: "score",
  id: `award-${n}`,
  playerId: "p1",
  deltaUnits: (n % 3) + 1,
  totalUnits: n * 3 + 1,
  at: 0,
});

test("background judging preserves ownership for every turn type", () => {
  const state = fixture();
  const turn = state.turn!;
  const speaker = state.players.find((p) => p.id === turn.playerId)!;
  state.judgePending = true;
  for (const kind of ["case", "rebuttal", "closing"] as const) {
    turn.kind = kind;
    assert.equal(turnStatus(state, speaker.id), `Your ${kind}`);
    assert.equal(turnStatus(state), `${speaker.name}’s ${kind}`);
  }
  turn.pausedReason = "judge";
  assert.equal(turnStatus(state, speaker.id), "Your closing next");
  turn.pausedReason = "recovery";
  assert.equal(turnStatus(state, speaker.id), "Your closing next");
  turn.sealing = true;
  assert.equal(
    turnStatus(state, speaker.id),
    `Finishing ${speaker.name}’s words…`,
  );
});

test("fractional awards combine into one burst and one exact announcement", () => {
  const queue = new AwardQueue();
  const awards = Array.from({ length: 14 }, (_, n) => notice(n));
  awards.forEach((award) => queue.enqueue(award));
  assert.equal(queue.advance(99).notice, null);
  const shown = queue.advance(100);
  assert(shown.started);
  assert.deepEqual(
    shown.notice?.awardIds,
    awards.map((a) => a.id),
  );
  const units = awards.reduce((sum, award) => sum + award.deltaUnits, 0);
  assert.equal(shown.notice?.deltaUnits, units);
  assert.equal(shown.notice?.totalUnits, awards.at(-1)?.totalUnits);
  assert(queue.advance(899).notice);
  const finished = queue.advance(900);
  assert.equal(finished.notice, null);
  assert.equal(finished.completed?.deltaUnits, units);
  assert.equal(queue.advance(901).completed, null);
});

test("late display timers show the combined reward for its full lifetime", () => {
  const queue = new AwardQueue();
  for (let n = 0; n < 8; n++) queue.enqueue(notice(n));
  assert.equal(queue.advance(0).notice, null);
  const late = queue.advance(2000);
  assert.equal(late.notice?.startedAt, 2000);
  assert.equal(late.notice?.awardIds.length, 8);
  assert.equal(late.nextAt, 2600);
  assert(queue.advance(2799).notice);
  assert.equal(queue.advance(2800).notice, null);
});

test("clearing presentation discards both the visible burst and pending gains", () => {
  const queue = new AwardQueue();
  for (let n = 0; n < 14; n++) queue.enqueue(notice(n));
  queue.advance(100);
  queue.clear();
  assert.deepEqual(queue.advance(100), {
    notice: null,
    started: false,
    completed: null,
    nextAt: Infinity,
  });
  queue.enqueue({ ...notice(20), at: 100 });
  assert.equal(queue.advance(199).notice, null);
  assert.equal(queue.advance(200).notice?.id, "award-20");
  assert.equal(queue.advance(10000).notice, null);
});

test("successive gains renew one burst without restarting its entrance", () => {
  const queue = new AwardQueue();
  queue.enqueue(notice(0));
  const first = queue.advance(100).notice!;
  queue.enqueue({ ...notice(1), at: 750 });
  const renewed = queue.advance(750);
  assert.equal(renewed.started, false);
  assert.equal(renewed.notice?.id, first.id);
  assert.equal(renewed.notice?.startedAt, first.startedAt);
  assert.equal(renewed.notice?.deltaUnits, 3);
  assert.equal(renewed.notice?.holdUntil, 1200);
  assert(queue.advance(1399).notice);
  assert.equal(queue.advance(1400).completed?.deltaUnits, 3);
});

function fixture() {
  const game = new Game("0123", () => {});
  startRound(game);
  return game.snapshot();
}
function award(
  previous: Snapshot,
  id: string,
  deltaUnits = 1,
): GameEvent & { type: "score_committed" } {
  const snapshot = structuredClone(previous);
  const player = snapshot.players[0];
  const payload = {
    id,
    playerId: player.id,
    roundId: snapshot.roundId!,
    turnId: snapshot.turn!.id,
    segmentId: "evidence",
    criterion: "wit" as const,
    quality: 3,
    deltaUnits,
    reason: "A specific counterexample.",
    at: 1000,
  };
  player.scoreUnits += deltaUnits;
  snapshot.ledger.push(payload);
  snapshot.seq++;
  return {
    type: "score_committed",
    payload,
    snapshot,
    roomId: snapshot.roomId,
    matchId: snapshot.matchId,
    seq: snapshot.seq,
    phaseVersion: snapshot.phaseVersion,
    serverNowMs: 1000,
  };
}

test("Bonk asides require the exact accepted award and cannot replay after restoration or remount", () => {
  const score = award(fixture(), "aside-award", 2);
  const s = structuredClone(score.snapshot);
  s.seq++;
  const event: GameEvent = {
    ...score,
    type: "bonk_reaction",
    seq: s.seq,
    snapshot: s,
    payload: {
      id: "aside",
      awardId: score.payload.id,
      playerId: score.payload.playerId,
      roundId: s.roundId!,
      turnId: s.turn!.id,
      text: score.payload.reason,
    },
  };
  const gate = new FeedbackController();
  gate.accept(score.snapshot);
  assert.equal(gate.accept(s, event).cue?.kind, "reaction");
  const duplicate = structuredClone(event);
  duplicate.seq = ++duplicate.snapshot.seq;
  assert.equal(gate.accept(duplicate.snapshot, duplicate).cue, undefined);
  const restored = new FeedbackController();
  restored.accept(s);
  assert.equal(restored.accept(s, event).cue, undefined);
  for (const corrupt of ["text", "playerId", "awardId", "turnId"] as const) {
    const bad: Extract<GameEvent, { type: "bonk_reaction" }> =
      structuredClone(event);
    bad.payload[corrupt] = "wrong";
    const fresh = new FeedbackController();
    fresh.accept(score.snapshot);
    assert.equal(fresh.accept(s, bad).cue, undefined);
  }
});

test("snapshot baselines and reconnects restore fractional totals without rewards", () => {
  const gate = new FeedbackController();
  const event = award(fixture(), "old", 3);
  assert.deepEqual(gate.accept(event.snapshot), {
    reset: true,
    cue: undefined,
  });
  assert.equal(gate.accept(event.snapshot, event).cue, undefined);
  const next = award(event.snapshot, "new", 2);
  assert.equal(gate.accept(next.snapshot, next).cue?.kind, "score");
  assert.equal(gate.accept(next.snapshot).cue, undefined);
  assert.equal(gate.accept(next.snapshot, next).cue, undefined);
});
test("rapid awards each retain their identity and exact authoritative target", () => {
  const gate = new FeedbackController();
  let state = fixture();
  gate.accept(state);
  const targets = [1, 3, 6, 10, 15];
  for (let n = 0; n < 5; n++) {
    const event = award(state, `award-${n}`, n + 1);
    const cue = gate.accept(event.snapshot, event).cue;
    assert(cue?.kind === "score");
    assert.equal(cue.deltaUnits, n + 1);
    assert.equal(cue.totalUnits, targets[n]);
    state = event.snapshot;
  }
  assert.equal(points(state.players[0].scoreUnits), "3.75");
});
test("duplicate IDs, equal sequences and out-of-order events cannot replay rewards", () => {
  const gate = new FeedbackController(),
    state = fixture();
  gate.accept(state);
  const first = award(state, "one", 1),
    second = award(first.snapshot, "two", 2);
  gate.accept(first.snapshot, first);
  gate.accept(second.snapshot, second);
  assert.equal(gate.accept(first.snapshot, first).cue, undefined);
  assert.equal(gate.accept(second.snapshot, second).cue, undefined);
  const duplicate = award(second.snapshot, "one", 1);
  assert.equal(gate.accept(duplicate.snapshot, duplicate).cue, undefined);
  const fresh = award(duplicate.snapshot, "three", 3);
  assert.equal(gate.accept(fresh.snapshot, fresh).cue?.kind, "score");
});
test("awards from another round or match and absent ledger entries are ignored", () => {
  for (const kind of ["round", "match", "ledger"] as const) {
    const gate = new FeedbackController(),
      state = fixture();
    gate.accept(state);
    const event = award(state, kind);
    if (kind === "round") event.payload.roundId = "old-round";
    if (kind === "match") event.matchId = "old-match";
    if (kind === "ledger") event.snapshot.ledger = [];
    assert.equal(gate.accept(event.snapshot, event).cue, undefined);
  }
});
test("round and match changes clear presentation and keep restored ledgers consumed", () => {
  const gate = new FeedbackController(),
    state = fixture();
  gate.accept(state);
  const first = award(state, "round-one");
  gate.accept(first.snapshot, first);
  const next = {
    ...first.snapshot,
    seq: first.seq + 1,
    roundId: "round-two",
    round: 2,
    players: first.snapshot.players.map((p) => ({ ...p, scoreUnits: 0 })),
  };
  assert.equal(gate.accept(next).reset, true);
  const fresh = award(next, "round-two");
  assert.equal(gate.accept(fresh.snapshot, fresh).cue?.kind, "score");
  const rematch = {
    ...next,
    seq: fresh.seq + 1,
    matchId: "rematch",
    roundId: null,
    round: 0,
    ledger: [],
  };
  assert.equal(gate.accept(rematch).reset, true);
  assert.equal(gate.accept(first.snapshot, first).cue, undefined);
});
test("subscribers mounting after an award receive no historical cue", () => {
  const client = new Client(),
    state = fixture();
  client.notify({ state });
  const event = award(state, "scored");
  client.notify({ state: event.snapshot, event });
  const observed: string[] = [];
  const off = client.on((u) => {
    if (u.feedback) observed.push(u.feedback.id);
  });
  client.notify({ state: event.snapshot, event });
  client.notify({ state: event.snapshot });
  const fresh = award(event.snapshot, "fresh");
  client.notify({ state: fresh.snapshot, event: fresh });
  off();
  assert.deepEqual(observed, ["fresh"]);
});
test("count-up retargets continuously and ends on exact quarter points", () => {
  const tally = new ScoreTally(0);
  tally.aim(3, 100);
  const visible = tally.value(230);
  assert(visible > 0 && visible < 3);
  tally.aim(13, 230);
  assert.equal(tally.value(230), visible);
  assert(tally.value(400) > visible);
  assert.equal(tally.value(630), 13);
  assert.equal(points(tally.value(630)), "3.25");
  tally.snap(0);
  assert.equal(tally.value(640), 0);
  tally.snap(14);
  assert.equal(points(tally.value(650)), "3.50");
});
test("muting cancels scheduled effects and speech ducks their gain", () => {
  const client = new Client();
  const values: number[] = [];
  client.sound.context = { currentTime: 2 } as AudioContext;
  client.sound.effectsGain = {
    gain: { setTargetAtTime: (n: number) => values.push(n) },
  } as unknown as GainNode;
  let stopped = 0;
  client.sound.effectNodes.add({
    stop: () => stopped++,
    disconnect: () => {},
  } as unknown as AudioScheduledSourceNode);
  client.sound.updateEffectsGain();
  assert.equal(values.at(-1), 0.65);
  client.sound.duckForSpeech();
  assert.equal(values.at(-1), 0.15);
  client.sound.muteJudge();
  assert.equal(stopped, 1);
  assert.equal(client.sound.effectNodes.size, 0);
  assert.equal(values.at(-1), 0);
});
