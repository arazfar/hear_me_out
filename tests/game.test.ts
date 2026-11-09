import assert from "node:assert/strict";
import test from "node:test";
import { Game } from "../server/game/game";
import { CAPS, CRITERIA, type Segment } from "../shared/domain";
import type { GameEvent } from "../shared/protocol";
function setup() {
  let time = 100000;
  const g = new Game(
    "0123",
    () => {},
    () => time,
  );
  const a = g.addPlayer("Sam"),
    b = g.addPlayer("Alex");
  a.mediaReady = b.mediaReady = true;
  g.ready(a.id);
  g.ready(b.id);
  time += 8001;
  g.tick();
  assert.equal(
    g.state.phase,
    "INTRO_COIN",
    "intro waits for playback ownership",
  );
  g.selectTopic();
  g.proposeTopic(
    g.state.tailsId!,
    "Waffles are better than pancakes.",
    "Waffles",
    "Pancakes",
    true,
  );
  g.confirm(a.id, 1);
  g.confirm(b.id, 1);
  return {
    g,
    a,
    b,
    advance: (ms: number) => {
      time += ms;
      g.tick();
    },
  };
}
function segment(g: Game, id = "s"): Segment {
  return {
    id,
    playerId: g.state.turn!.playerId,
    turnId: g.state.turn!.id,
    roundId: g.state.roundId!,
    sessionEpoch: "test",
    eligible: true,
    source: "voice",
    text: "A meaningful argument.",
    stableAt: g.now(),
  };
}
function finishTurn(g: Game) {
  const turn = g.state.turn!;
  g.endTurn(turn.playerId, turn.id);
  g.tick();
}
test("score ledger enforces exact budgets, duplicate keys, stale evidence and off-floor eligibility", () => {
  const { g, advance } = setup();
  const t = g.state.turn!;
  const s = segment(g);
  assert(g.registerSegment(s));
  for (const criterion of CRITERIA)
    g.score({
      ...s,
      segmentId: s.id,
      turnId: t.id,
      criterion,
      quality: 4,
      reason: "specific evidence",
    });
  assert.equal(g.player(t.playerId).scoreUnits, 40);
  assert.equal(
    g.state.ledger.reduce((n, e) => n + e.deltaUnits, 0),
    40,
  );
  assert.equal(
    g.score({
      ...s,
      segmentId: s.id,
      turnId: t.id,
      criterion: "reasoning",
      quality: 4,
      reason: "duplicate",
    }),
    false,
  );
  assert.equal(
    g.score({
      ...s,
      turnId: t.id,
      segmentId: "unknown",
      criterion: "reasoning",
      quality: 5,
      reason: "invalid",
    }),
    false,
  );
  assert.equal(
    g.registerSegment({ ...s, id: "off", playerId: g.other(t.playerId).id }),
    false,
  );
  g.endTurn(t.playerId, t.id);
  advance(3001);
  assert.equal(
    g.score({
      ...s,
      segmentId: s.id,
      turnId: t.id,
      criterion: "wit",
      quality: 4,
      reason: "late",
    }),
    false,
  );
});
test("six equal opportunities, alternating opener, reset score, first to two and rematch", () => {
  const { g, advance } = setup();
  const heads = g.state.headsId!;
  for (let round = 1; round <= 3; round++) {
    assert.equal(g.state.turn!.playerId, round % 2 ? heads : g.state.tailsId);
    const seen = new Map<string, number>();
    for (let i = 0; i < 6; i++) {
      const t = g.state.turn!;
      seen.set(t.playerId, (seen.get(t.playerId) || 0) + 1);
      assert.equal(t.durationMs, i < 4 ? 30000 : 15000);
      const s = segment(g, `${round}-${i}`);
      g.registerSegment(s);
      if (t.playerId === heads)
        for (const criterion of CRITERIA)
          g.score({
            ...s,
            segmentId: s.id,
            turnId: t.id,
            criterion,
            quality: 4,
            reason: "clear decisive reason",
          });
      g.endTurn(t.playerId, t.id);
      advance(3001);
    }
    assert.equal(seen.get(heads), 3);
    assert.equal(seen.get(g.other(heads).id), 3);
    assert.equal(g.state.results.at(-1)!.scores[heads], 120);
    advance(12001);
    if (round === 2) break;
    assert.equal(g.player(heads).scoreUnits, 0);
  }
  assert.equal(g.state.phase, "MATCH_RESULT");
  assert.equal(g.state.winnerId, heads);
  const old = g.state.matchId;
  for (const p of g.state.players) g.rematch(p.id, true);
  assert.notEqual(g.state.matchId, old);
  assert.equal(g.state.ledger.length, 0);
});
test("tied scores put the round's responder first in Closing for either opener", () => {
  const { g, advance } = setup();
  for (const opener of [g.state.headsId!, g.state.tailsId!]) {
    const responder = g.other(opener).id;
    assert.equal(g.state.turn?.playerId, opener);
    for (let i = 0; i < 3; i++) finishTurn(g);

    assert.deepEqual(g.opportunityAt(4), {
      playerId: responder,
      kind: "closing",
    });
    assert.equal(g.opportunityAt(5), undefined);
    assert.equal(
      g.order.length,
      4,
      "looking ahead leaves the order uncommitted",
    );

    finishTurn(g);
    assert.equal(g.state.turn?.playerId, responder);
    assert.equal(g.state.turn?.kind, "closing");
    finishTurn(g);
    assert.equal(g.state.turn?.playerId, opener);
    assert.equal(g.state.turn?.kind, "closing");
    finishTurn(g);
    advance(2200);
  }
});
for (const [deficitUnits, qualifies] of [
  [15, false],
  [16, true],
  [39, true],
  [40, false],
] as const) {
  test(`a ${deficitUnits}-unit deficit ${qualifies ? "announces" : "skips"} a comeback window before Closing`, () => {
    const { g } = setup();
    const trailing = g.state.headsId!;
    for (let i = 0; i < 3; i++) finishTurn(g);
    g.other(trailing).scoreUnits = deficitUnits;
    const events: GameEvent[] = [];
    g.onEvent = (event) => events.push(event);

    finishTurn(g);
    assert.equal(g.state.turn?.playerId, trailing);
    assert.equal(g.state.comebackPlayerId, qualifies ? trailing : null);
    assert.deepEqual(
      events.map((event) => event.type),
      qualifies
        ? ["turn_sealed", "comeback_window", "floor_granted"]
        : ["turn_sealed", "floor_granted"],
    );
    if (qualifies)
      assert.deepEqual(events[1].payload, { playerId: trailing, deficitUnits });
  });
}
test("judge pauses preserve time; natural pauses never surrender the floor", () => {
  const { g, advance } = setup();
  const t = g.state.turn!;
  advance(4000);
  g.pause("judge");
  const left = g.remaining();
  advance(3000);
  assert.equal(g.remaining(), left);
  g.resume("judge");
  g.registerSegment(segment(g));
  g.thought(t.playerId);
  g.speechStarted(t.playerId);
  advance(900);
  assert(!t.sealing);
  g.thought(t.playerId);
  advance(8000);
  assert(!t.sealing);
  advance(30000);
  assert(t.sealing);
});
test("topic requires both confirmations and connection recovery cannot invent winner", () => {
  let time = 0;
  const g = new Game(
    "9999",
    () => {},
    () => time,
  );
  const a = g.addPlayer("A"),
    b = g.addPlayer("B");
  a.mediaReady = b.mediaReady = true;
  g.ready(a.id);
  g.ready(b.id);
  time = 8001;
  g.selectTopic();
  time += 45001;
  g.tick();
  assert.equal(g.state.phase, "TOPIC_CONFIRM");
  g.confirm(a.id, 1);
  time += 20001;
  g.tick();
  assert.equal(g.state.phase, "LOBBY");
  g.startMatch();
  g.recover("lost");
  time += 60001;
  g.tick();
  assert.equal(g.state.phase, "ABORTED");
  assert.equal(g.state.winnerId, null);
});
test("case rubric has no rebuttal penalty and every opportunity sums to forty units", () => {
  for (const caps of Object.values(CAPS))
    assert.equal(
      Object.values(caps).reduce((a, b) => a + b),
      40,
    );
  assert.equal(CAPS.case.rebuttal, 0);
});
test("reconnect during judge pause restores clock and timed intro resumes", () => {
  const { g, advance } = setup();
  const t = g.state.turn!;
  advance(2000);
  g.pause("judge");
  const remaining = g.remaining();
  g.recover("connection lost");
  g.resume("judge");
  advance(5000);
  assert.equal(g.remaining(), remaining);
  g.resumeRecovery();
  assert.equal(g.remaining(), remaining);
  assert.equal(g.state.phase, "ROUND");
  advance(1000);
  assert.equal(g.remaining(), remaining - 1000);
  g.startMatch();
  advance(2000);
  g.recover("intro lost");
  advance(5000);
  g.resumeRecovery();
  advance(6001);
  assert.equal(g.state.phase, "INTRO_COIN");
  g.selectTopic();
  assert.equal(g.state.phase, "TOPIC_SELECT");
});
test("settlement cannot advance a floor until judge playback finishes", () => {
  const { g, advance } = setup();
  const t = g.state.turn!;
  g.state.judge = {
    id: "j",
    epoch: 1,
    status: "speaking",
    startAt: g.now(),
    text: "Answer that",
    expression: "smug",
    targetPlayerId: g.other(t.playerId).id,
  };
  g.endTurn(t.playerId, t.id);
  advance(3001);
  assert.equal(g.state.turn!.id, t.id);
  assert(t.sealing);
  advance(2000);
  g.silenceJudge(1);
  g.tick();
  assert.notEqual(g.state.turn!.id, t.id);
  assert.equal(g.remaining(), 30000);
});
