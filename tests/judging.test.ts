import assert from "node:assert/strict";
import test from "node:test";
import {
  JudgeFailure,
  JUDGE_BUDGET_MS,
  judgeFailure,
  type JudgeFailureCategory,
} from "../server/providers/judge-request";
import { deferred, evidence, flush, proposal, roomFixture } from "./fixtures";
import type { Proposal } from "../server/providers/openai";

const failures: Array<[unknown, JudgeFailureCategory, boolean]> = [
  [{ status: 401 }, "authentication", false],
  [{ status: 403 }, "authentication", false],
  [{ code: "invalid_api_key" }, "authentication", false],
  [{ code: "permission_denied" }, "authentication", false],
  [{ code: "model_not_found", status: 404 }, "configuration", false],
  [{ code: "invalid_prompt" }, "configuration", false],
  [{ status: 400 }, "configuration", false],
  [{ status: 404 }, "configuration", false],
  [{ status: 422 }, "configuration", false],
  [{ status: 408 }, "transport", true],
  [{ status: 409 }, "transport", true],
  [{ status: 500 }, "transport", true],
  [{ status: 503 }, "transport", true],
  [new Error("Connection lost"), "transport", true],
  [{ status: 429 }, "quota", true],
  [{ code: "rate_limit_exceeded" }, "quota", true],
  [{ code: "insufficient_quota", status: 429 }, "quota", false],
  [new JudgeFailure("invalid_output"), "invalid_output", true],
  [new JudgeFailure("timeout"), "timeout", false],
];
for (const [error, category, retryable] of failures) {
  test(`judge failure ${JSON.stringify(error)} is ${category}, retry=${retryable}`, async (t) => {
    const failure = judgeFailure(error);
    assert.equal(failure.category, category);
    assert.equal(failure.retryable, retryable);
    if (error instanceof JudgeFailure) assert.equal(failure, error);
    let attempts = 0;
    const { room } = roomFixture({
      judge: async () => {
        attempts++;
        throw error;
      },
    });
    t.after(() => room.close());
    room.judging.onSegment(evidence(room.game));
    await flush();
    assert.equal(attempts, retryable ? 2 : 1);
    assert.equal(room.game.state.phase, "ABORTED");
    assert.equal(room.game.state.ledger.length, 0);
    assert.equal(room.game.state.judgePending, false);
    assert.equal(room.judging.busy, false);
    assert.equal(room.failures.get(`judgment_${category}`), 1);
  });
}

for (const corruption of [
  "duplicate",
  "missing",
  "segment",
  "player",
  "round",
  "turn",
  "job",
] as const) {
  test(`invalid ${corruption} is retried without committing any partial scores`, async (t) => {
    let attempts = 0;
    const next = deferred<Proposal>();
    const { room } = roomFixture({
      judge: async (
        _state,
        batch,
        _kind,
        _targets,
        _recent,
        _claims,
        jobId,
      ) => {
        const result = proposal(jobId, batch[0]);
        if (++attempts === 2) {
          assert.equal(room.game.state.ledger.length, 0);
          next.resolve(result);
          return result;
        }
        if (corruption === "duplicate")
          result.scores[4] = { ...result.scores[0] };
        else if (corruption === "missing") result.scores.pop();
        else if (corruption === "job") result.jobId = "wrong";
        else result.scores[4][`${corruption}Id`] = "wrong";
        return result;
      },
    });
    t.after(() => room.close());
    room.judging.onSegment(evidence(room.game));
    await next.promise;
    await flush();
    assert.equal(attempts, 2);
    assert.equal(
      room.game.player(room.game.state.turn!.playerId).scoreUnits,
      40,
    );
    assert.equal(
      room.game.state.ledger.length,
      4,
      "case rebuttal remains disabled",
    );
    assert.equal(room.game.state.judgePending, false);
    await room.judging.drain();
    assert.equal(room.game.state.ledger.length, 4);
  });
}

test("invalid output twice aborts honestly; authentication is never retried", async (t) => {
  for (const authentication of [false, true]) {
    let attempts = 0;
    const { room } = roomFixture({
      judge: async (_s, batch, _k, _t, _r, _c, jobId) => {
        attempts++;
        if (authentication)
          throw { status: 401, message: "secret provider error" };
        const result = proposal(jobId, batch[0]);
        result.scores[0].segmentId = "unknown";
        return result;
      },
    });
    t.after(() => room.close());
    room.judging.onSegment(evidence(room.game));
    await flush();
    assert.equal(attempts, authentication ? 1 : 2);
    assert.equal(room.game.state.phase, "ABORTED");
    assert.equal(room.game.state.ledger.length, 0);
    assert.equal(room.judging.busy, false);
    assert.equal(room.game.state.judgePending, false);
    assert.equal(
      room.failures.get(
        `judgment_${authentication ? "authentication" : "invalid_output"}`,
      ),
      1,
    );
    assert(!JSON.stringify(room.timeline).includes("secret provider error"));
  }
});

test("retries share one deadline and late success cannot score after timeout", async (t) => {
  let expire!: () => void,
    attempts = 0,
    scheduled = 0;
  let signal!: AbortSignal, answer!: Proposal;
  const late = deferred<Proposal>();
  const { room } = roomFixture({
    judge: async (
      _s,
      batch,
      _k,
      _t,
      _r,
      _c,
      jobId,
      _ids,
      _reactions,
      request,
    ) => {
      signal = request!;
      if (++attempts === 1) throw new JudgeFailure("transport");
      answer = proposal(jobId, batch[0]);
      return late.promise;
    },
  });
  room.services.setTimeout = ((fn: () => void, ms: number) => {
    if (ms === JUDGE_BUDGET_MS) {
      expire = fn;
      scheduled++;
      return setTimeout(() => {}, 0);
    }
    return setTimeout(fn, ms);
  }) as typeof setTimeout;
  t.after(() => room.close());
  room.judging.onSegment(evidence(room.game));
  await flush();
  assert.equal(attempts, 2);
  assert.equal(scheduled, 1);
  expire();
  await flush();
  assert(signal.aborted);
  assert.equal(room.game.state.phase, "ABORTED");
  assert.equal(room.failures.get("judgment_timeout"), 1);
  assert.equal(room.game.state.judgePending, false);
  assert.equal(room.judging.busy, false);
  late.resolve(answer);
  await flush();
  assert.equal(room.game.state.ledger.length, 0);
});
