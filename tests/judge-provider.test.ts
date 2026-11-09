import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { judge } from "../server/providers/openai";
import { JudgeFailure } from "../server/providers/judge-request";
import { CRITERIA } from "../shared/domain";
import { evidence, flush, roomFixture } from "./fixtures";
import { waitFor } from "./ws-peer";

const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

for (const outcome of [
  "completed",
  "invalid",
  "incomplete",
  "failed",
  "missing",
] as const) {
  test(`real SDK ${outcome} response settles without waiting for EOF and releases its transport`, async (t) => {
    let requests = 0,
      closed = 0;
    const { room } = roomFixture();
    const server = createServer((_req, res) => {
      requests++;
      res.on("close", () => closed++);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        event({
          type: "response.output_text.delta",
          delta:
            outcome === "invalid"
              ? "{"
              : JSON.stringify({
                  jobId: "job",
                  scores: CRITERIA.map((criterion) => ({
                    segmentId: "s0",
                    criterion,
                    quality: 4,
                    reason: "Specific supporting argument.",
                  })),
                  arguments: [],
                  reaction: null,
                  intervention: null,
                }),
        }),
      );
      if (outcome === "missing") res.end();
      else
        res.write(
          event({
            type:
              outcome === "failed"
                ? "response.failed"
                : outcome === "incomplete"
                  ? "response.incomplete"
                  : "response.completed",
            response: { error: { code: "invalid_api_key" } },
          }),
        );
      // All terminal-event cases deliberately leave the HTTP body open.
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const previous = {
      key: process.env.OPENAI_API_KEY,
      base: process.env.OPENAI_BASE_URL,
    };
    process.env.OPENAI_API_KEY = "local-fixture";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    t.after(async () => {
      for (const [key, value] of [
        ["OPENAI_API_KEY", previous.key],
        ["OPENAI_BASE_URL", previous.base],
      ])
        if (value === undefined) delete process.env[key!];
        else process.env[key!] = value;
      await room.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const began = performance.now();
    room.judging.onSegment(evidence(room.game));
    await waitFor(
      () => !room.game.state.judgePending && closed === requests,
      1900,
    );
    assert(performance.now() - began < 2000);
    const success = outcome === "completed";
    assert.equal(requests, success || outcome === "failed" ? 1 : 2);
    assert.equal(room.game.state.phase, success ? "ROUND" : "ABORTED");
    assert.equal(room.game.state.ledger.length, success ? 4 : 0);
    assert.equal(room.judging.busy, false);
    if (!success)
      assert.equal(
        room.failures.get(
          `judgment_${outcome === "failed" ? "authentication" : outcome === "missing" ? "transport" : "invalid_output"}`,
        ),
        1,
      );
  });
}

test("real SDK discards interrupted low/high partial scores before a successful retry", async (t) => {
  for (const partialQuality of [1, 4]) {
    let calls = 0;
    const { room } = roomFixture();
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const scores = CRITERIA.map((criterion) => ({
        segmentId: "s0",
        criterion,
        quality: 4,
        reason: "Specific supporting argument.",
      }));
      if (++calls === 1) {
        res.write(
          event({
            type: "response.output_text.delta",
            delta:
              '{"jobId":"job","scores":[' +
              JSON.stringify({ ...scores[0], quality: partialQuality }) +
              ",",
          }),
        );
        setTimeout(() => res.destroy(), 30);
      } else {
        assert.equal(room.game.state.ledger.length, 0);
        res.end(
          event({
            type: "response.output_text.delta",
            delta: JSON.stringify({
              jobId: "job",
              scores,
              arguments: [],
              reaction: null,
              intervention: null,
            }),
          }) + event({ type: "response.completed" }),
        );
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const previous = {
      key: process.env.OPENAI_API_KEY,
      base: process.env.OPENAI_BASE_URL,
    };
    process.env.OPENAI_API_KEY = "local-fixture";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      room.judging.onSegment(evidence(room.game));
      await waitFor(() => !room.game.state.judgePending);
      assert.equal(calls, 2);
      assert.equal(room.game.state.phase, "ROUND");
      assert.equal(
        room.game.player(room.game.state.turn!.playerId).scoreUnits,
        40,
      );
      assert.equal(room.game.state.ledger.length, 4);
    } finally {
      for (const [key, value] of [
        ["OPENAI_API_KEY", previous.key],
        ["OPENAI_BASE_URL", previous.base],
      ])
        if (value === undefined) delete process.env[key!];
        else process.env[key!] = value;
      await room.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});

test("direct SDK calls bound stalled headers and SSE bodies and close both transports", async () => {
  let requests = 0,
    closed = 0;
  const server = createServer((_req, res) => {
    if (++requests === 2) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": connected\n\n");
    }
    res.on("close", () => closed++);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = {
    key: process.env.OPENAI_API_KEY,
    base: process.env.OPENAI_BASE_URL,
  };
  process.env.OPENAI_API_KEY = "local-fixture";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { room, turn } = roomFixture();
  try {
    const began = Date.now(),
      segment = evidence(room.game);
    await Promise.all(
      [1, 2].map(() =>
        assert.rejects(
          judge(
            room.game.snapshot(),
            [segment],
            turn.kind,
            turn.targets,
            [],
            [],
            "job",
            [],
          ),
          (error: unknown) =>
            error instanceof JudgeFailure && error.category === "timeout",
        ),
      ),
    );
    assert(
      Date.now() - began < 15000,
      "stream consumption must obey the 12-second budget",
    );
    await waitFor(() => closed === 2, 2000);
    await flush();
    assert.equal(requests, 2);
  } finally {
    for (const [key, value] of [
      ["OPENAI_API_KEY", previous.key],
      ["OPENAI_BASE_URL", previous.base],
    ])
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    await room.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
