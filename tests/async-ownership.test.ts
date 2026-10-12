import assert from "node:assert/strict";
import test from "node:test";
import type { Proposal } from "../server/providers";
import { ServerClock } from "../src/media/server-clock";
import { deferred, evidence, flush, roomFixture } from "./fixtures";

for (const transition of ["rematch", "dispose", "recovery"] as const) {
  test(`obsolete provider failure cannot mutate ${transition}`, async () => {
    const job = deferred<Proposal>();
    let calls = 0;
    const { room } = roomFixture({
      judge: async () => {
        calls++;
        return job.promise;
      },
    });
    room.judging.onSegment(evidence(room.game));
    assert.equal(calls, 1);
    if (transition === "rematch") {
      room.game.abort("Fixture ended");
      room.game.startMatch();
    }
    if (transition === "dispose") room.close();
    if (transition === "recovery") room.game.recover("Connection interrupted");
    await flush();
    const before = room.game.snapshot();
    job.reject(new Error("Delayed failure"));
    await flush();
    assert.equal(room.game.state.phase, before.phase);
    assert.equal(room.game.state.matchId, before.matchId);
    assert.deepEqual(room.game.state.ledger, before.ledger);
    if (transition === "recovery")
      assert.equal(room.judging.queue.length, 1, "eligible evidence retained");
    room.close();
  });
}
test("same-match recovery scores retained evidence only once", async () => {
  const old = deferred<Proposal>();
  let calls = 0;
  const { room } = roomFixture({
    judge: async (
      state,
      segments,
      _kind,
      _targets,
      _recent,
      _claims,
      jobId,
    ) => {
      if (++calls === 1) return old.promise;
      const s = segments[0];
      return {
        jobId,
        scores: [
          {
            playerId: s.playerId,
            roundId: s.roundId,
            turnId: s.turnId!,
            segmentId: s.id,
            criterion: "reasoning",
            quality: 3,
            reason: "Syrup pockets distribute sweetness.",
          },
        ],
        arguments: [],
        reaction: { segmentId: s.id, text: "Those pockets came prepared." },
        intervention: null,
      };
    },
  });
  room.judging.onSegment(evidence(room.game));
  room.game.recover("Offline");
  room.game.resumeRecovery();
  await flush();
  old.reject(new Error("Cancelled old job"));
  await flush();
  assert.equal(room.game.state.phase, "ROUND");
  assert.equal(room.game.state.ledger.length, 1);
  assert.equal(room.game.state.judgePending, false);
  room.close();
});
test("match reset clears transcript context, captions, reactions and queued evidence", () => {
  const { room } = roomFixture();
  room.game.caption(room.game.state.players[0].id, "old private speech", true);
  room.judging.recent.push(evidence(room.game));
  room.game.abort("Fixture ended");
  room.game.startMatch();
  assert.deepEqual(room.game.state.captions, {});
  assert.equal(room.judging.recent.length, 0);
  assert.equal(room.judging.queue.length, 0);
  assert.equal(room.judging.reactions.size, 0);
  room.close();
});
test("server time handles either direction of clock skew and elapsed monotonic time", () => {
  for (const skew of [-60000, 60000]) {
    let monotonic = 100;
    const clock = new ServerClock(() => monotonic);
    clock.observe(100000 + skew, 40);
    assert.equal(clock.now(), 100020 + skew);
    monotonic += 500;
    assert.equal(clock.now(), 100520 + skew);
    clock.reset();
    assert.equal(clock.synced, false);
  }
});
