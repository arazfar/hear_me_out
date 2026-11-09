import assert from "node:assert/strict";
import test from "node:test";
import { runProviderSmoke } from "../scripts/provider-smoke";
import { deferred, flush, proposal } from "./fixtures";
import { JudgeFailure } from "../server/providers/judge-request";

for (const finalAt of [0, 300, null]) {
  test(`provider smoke records first final arrival at ${finalAt} without paced-silence inflation`, async (t) => {
    let now = 100000,
      closed = false,
      judged = false,
      callbacks = 0;
    t.mock.method(Date, "now", () => now);
    const result = await runProviderSmoke({
      streamVoice: async (_text, chunk) => {
        chunk(new Uint8Array(3200));
        return 0.04;
      },
      pause: async (ms) => {
        now += ms;
      },
      createInk: (playerId, roundId, turnId, handlers) => ({
        connected: true,
        send: () => {
          if (finalAt === null) handlers.error("Fixture failure");
          else if (now >= 100000 + finalAt) {
            callbacks++;
            handlers.segment({
              id: `smoke-${callbacks}`,
              playerId,
              roundId,
              turnId,
              sessionEpoch: "fixture",
              text: "Waffles distribute syrup evenly.",
              stableAt: now,
              source: "voice",
              eligible: true,
            });
          }
        },
        close: async () => {
          closed = true;
          return true;
        },
      }),
      judge: async (_s, batch, _k, _t, _r, _c, jobId) => {
        judged = true;
        assert.equal(batch[0].id, "smoke-1");
        return proposal(jobId, batch[0]);
      },
    });
    assert.equal(
      now - 100000,
      2600,
      "paced delivery and silence remain unchanged",
    );
    assert(closed);
    assert.equal(judged, finalAt !== null);
    assert.equal(result.ok, finalAt !== null);
    assert.equal(result.metrics.sttFinalMs, finalAt ?? undefined);
    assert.equal(result.failure, finalAt === null ? "transcription" : null);
    if (finalAt !== null)
      assert(
        callbacks > 1,
        "later finals cannot replace the first timestamp or segment",
      );
  });
}

for (const outcome of [
  "success",
  "judge-failure",
  "cleanup-failure",
] as const) {
  test(`provider smoke ${outcome} waits for drainage and reports cleanup`, async () => {
    const drain = deferred<boolean>();
    let closed = false,
      settled = false;
    const work = runProviderSmoke({
      streamVoice: async (_text, chunk) => {
        chunk(new Uint8Array(3200));
        return 0.04;
      },
      pause: async () => {},
      createInk: (playerId, roundId, turnId, handlers) => ({
        connected: true,
        send: () =>
          handlers.segment({
            id: "smoke",
            playerId,
            roundId,
            turnId,
            sessionEpoch: "fixture",
            text: "Waffles distribute syrup evenly.",
            stableAt: Date.now(),
            source: "voice",
            eligible: true,
          }),
        close: () => {
          closed = true;
          return drain.promise;
        },
      }),
      judge: async (_s, batch, _kind, _targets, _recent, _claims, jobId) => {
        if (outcome === "judge-failure") throw new JudgeFailure("quota");
        return proposal(jobId, batch[0]);
      },
    }).then((result) => {
      settled = true;
      return result;
    });
    await flush();
    assert(closed);
    assert.equal(
      settled,
      false,
      "no success before physical disposal resolves",
    );
    drain.resolve(outcome !== "cleanup-failure");
    const result = await work;
    assert.equal(result.ok, outcome === "success");
    assert.equal(
      result.cleanup.transcriptionDisposed,
      outcome !== "cleanup-failure",
    );
    assert.equal(result.failure, outcome === "judge-failure" ? "quota" : null);
    assert(!JSON.stringify(result).includes("Waffles"));
  });
}
