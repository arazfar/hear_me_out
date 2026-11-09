import { encodeMicrophone } from "../shared/media";
import assert from "node:assert/strict";
import test from "node:test";
import type { Proposal } from "../server/providers/index";
import { ServerClock } from "../src/media/server-clock";
import { deferred, evidence, flush, proposal, roomFixture } from "./fixtures";

for (const transition of ["rematch", "dispose", "recovery"] as const) {
  test(`obsolete successful judgment cannot score after ${transition}`, async (t) => {
    const pending = deferred<Proposal>();
    let answer!: Proposal;
    const { room } = roomFixture({
      judge: async (_s, batch, _k, _targets, _r, _c, jobId) => {
        answer = proposal(jobId, batch[0]);
        return pending.promise;
      },
    });
    t.after(() => room.close());
    room.judging.onSegment(evidence(room.game));
    if (transition === "rematch") {
      room.game.abort("Fixture ended");
      room.game.startMatch();
    }
    if (transition === "dispose") void room.close();
    if (transition === "recovery") room.game.recover("Connection interrupted");
    const before = room.game.snapshot();
    pending.resolve(answer);
    await flush();
    assert.deepEqual(room.game.state.ledger, before.ledger);
    assert.equal(room.game.state.phase, before.phase);
    assert.equal(room.judging.busy, false);
  });
}

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
test("a canceled judgment cannot release its replacement or score retained evidence twice", async (t) => {
  const old = deferred<void>();
  const replacement = deferred<void>();
  const batches: string[][] = [];
  const { room } = roomFixture({
    judge: async (
      _state,
      segments,
      _kind,
      _targets,
      _recent,
      _claims,
      jobId,
    ) => {
      batches.push(segments.map((segment) => segment.id));
      await (batches.length === 1 ? old.promise : replacement.promise);
      const result = proposal(jobId, segments[0], 0);
      const reasoning = result.scores.find(
        (score) => score.criterion === "reasoning",
      )!;
      reasoning.quality = 3;
      return result;
    },
  });
  t.after(() => room.close());
  const segment = evidence(room.game);
  room.judging.onSegment(segment);
  room.game.recover("Offline");
  assert.deepEqual(room.judging.queue, [segment]);
  assert.equal(room.judging.busy, false);
  assert.equal(room.game.state.judgePending, true);

  room.game.resumeRecovery();
  old.resolve();
  await flush();
  assert.equal(batches.length, 2);
  assert.equal(room.judging.busy, true);
  assert.equal(room.game.state.judgePending, true);
  assert.equal(room.game.state.ledger.length, 0);

  replacement.resolve();
  await flush();
  assert.equal(room.game.state.phase, "ROUND");
  assert.deepEqual(batches, [[segment.id], [segment.id]]);
  assert.deepEqual(
    room.game.state.ledger.map((award) => award.segmentId),
    [segment.id],
  );
  assert.deepEqual(room.judging.queue, []);
  assert.equal(room.judging.busy, false);
  assert.equal(room.game.state.judgePending, false);
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

test("a delayed transcription drain cannot mutate a disposed room", async () => {
  const drained = deferred<boolean>(),
    started = deferred<void>();
  const { room, turn } = roomFixture();
  await flush();
  room.transcription.ink.set(turn.playerId, {
    turnId: turn.id,
    roundId: room.game.state.roundId!,
    connected: true,
    failed: false,
    closing: false,
    send: () => {},
    close: () => {
      started.resolve();
      return drained.promise;
    },
  });
  room.media.audio(
    turn.playerId,
    Buffer.from(
      encodeMicrophone(
        room.game.state.mediaEpoch,
        1,
        room.services.now(),
        new Uint8Array(),
        { purpose: "gameplay", inputEpoch: turn.inputEpoch!, end: true },
      ),
    ),
  );
  room.game.endTurn(turn.playerId, turn.id, 1);
  await started.promise;
  room.close();
  const before = structuredClone(room.game.state);
  drained.resolve(false);
  await flush();
  assert.deepEqual(room.game.state, before);
});
