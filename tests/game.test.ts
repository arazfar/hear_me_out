import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../server/game";
import { CRITERIA, CAPS, type Segment } from "../shared/types";
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
  g.ready(a.id, true);
  g.ready(b.id, true);
  time += 8001;
  g.tick();
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
test("judge pauses and overlap restore bounded time; resumed speech cancels protected handoff", () => {
  const { g, advance } = setup();
  const t = g.state.turn!;
  advance(4000);
  g.pause("judge");
  const left = g.remaining();
  advance(3000);
  assert.equal(g.remaining(), left);
  g.resume("judge");
  for (let i = 0; i < 100; i++) g.overlap(100);
  assert.equal(t.overlapRefundMs, 6000);
  assert(t.suppressOpponent);
  g.registerSegment(segment(g));
  g.thought(t.playerId);
  g.speechStarted(t.playerId);
  advance(900);
  assert(!t.sealing);
  g.thought(t.playerId);
  advance(8000);
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
  g.ready(a.id, true);
  g.ready(b.id, true);
  time = 8001;
  g.tick();
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
  assert.equal(g.state.phase, "TOPIC_SELECT");
});
test("complete score JSON objects stream atomically despite braces and escaped quotes in reasons", async () => {
  const { completeScoreObjects } = await import("../server/providers");
  const text =
    '{"jobId":"job","scores":[{"reason":"a {real} reason with \\"quotes\\"","quality":3},{"reason":"pending';
  assert.equal(completeScoreObjects(text).length, 1);
  assert.equal(completeScoreObjects('{"jobId":"job"').length, 0);
});
test("floor granted during judge speech starts paused and resumes full remaining time", () => {
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
  assert.equal(g.state.turn!.pausedReason, "judge");
  advance(2000);
  assert.equal(g.remaining(), 30000);
  g.resume("judge");
  assert.equal(g.remaining(), 30000);
});
