import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createApp } from "../server/app";
import { PROTOCOL_VERSION, type Session } from "../shared/protocol";
import type { RoomServices } from "../server/rooms/services";
import {
  deferred,
  evidence,
  fakeTranscription,
  flush,
  roomFixture,
  services,
  startRound,
} from "./fixtures";
import { post, waitFor } from "./ws-peer";

const scenarios = [
  "setup",
  "turn",
  "sealing",
  "judging",
  "recovery",
  "completed",
  "aborted",
] as const;
for (const transport of ["http", "socket"] as const)
  for (const scenario of scenarios)
    test(`${transport} departure during ${scenario} uses the same terminal policy`, async (t) => {
      const pending = deferred<never>();
      let judgeSignal: AbortSignal | undefined;
      const app = createApp({
        providersReady: () => true,
        services: services({
          judge: async (...args) => {
            judgeSignal = args.at(-1) as AbortSignal;
            return pending.promise;
          },
        }),
      });
      t.after(() => app.close());
      await new Promise<void>((resolve) =>
        app.server.listen(0, "127.0.0.1", resolve),
      );
      const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
      const a = await post(base, "/api/rooms", { name: "Alex" });
      const b = await post(base, "/api/join", {
        name: "Sam",
        code: a.session.code,
      });
      const room = app.registry.rooms.get(a.session.code)!;
      const { game } = room;
      // These tests isolate departure policy from media qualification, which has
      // its own integration suite. Advance the real room tick explicitly below.
      const tick = room.tick.bind(room);
      room.tick = () => {};
      let leaving: Session = a.session;
      if (scenario !== "setup") {
        const turn = startRound(game);
        leaving = [a.session, b.session].find(
          (s) => s.playerId === turn.playerId,
        )!;
        room.playback.cancelSpeech();
        const segment = evidence(game);
        game.registerSegment(segment);
        game.score({
          playerId: segment.playerId,
          roundId: segment.roundId,
          turnId: segment.turnId!,
          segmentId: segment.id,
          criterion: "reasoning",
          quality: 2,
          reason: "Those pockets keep the syrup put.",
        });
        if (scenario === "sealing") {
          turn.pausedReason = null;
          turn.deadline = game.now() + turn.remainingMs;
          game.endTurn(leaving.playerId, turn.id, 0);
        }
        if (scenario === "judging")
          room.judging.onSegment(evidence(game, "pending"));
        if (scenario === "recovery") game.recover("Temporary connection loss.");
        if (scenario === "completed") {
          game.player(leaving.playerId).wins = 1;
          game.resolveRound();
          game.finishMatch();
          room.playback.cancelSpeech();
        }
        if (scenario === "aborted")
          game.abort("The match was already interrupted.");
      } else {
        room.readiness.get(leaving.playerId).setup = "checking";
      }
      const before = game.snapshot();
      const scores = before.players.map((p) => ({
        id: p.id,
        score: p.scoreUnits,
      }));
      if (transport === "http") {
        const response = await fetch(base + "/api/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(leaving),
        });
        assert.equal(response.status, 200);
      } else {
        const ws = new WebSocket(
          base.replace("http", "ws") + "/socket/control",
        );
        t.after(() => ws.terminate());
        await new Promise<void>((resolve, reject) => {
          ws.once("error", reject);
          ws.on("open", () =>
            ws.send(
              JSON.stringify({
                type: "auth",
                protocolVersion: PROTOCOL_VERSION,
                ...leaving,
                code: undefined,
              }),
            ),
          );
          ws.on("message", (data) => {
            if (JSON.parse(data.toString()).type === "authenticated") resolve();
          });
        });
        ws.send(
          JSON.stringify({
            commandId: crypto.randomUUID(),
            connectionEpoch: leaving.connectionEpoch,
            matchId: before.matchId,
            expectedPhaseVersion: before.phaseVersion,
            command: { type: "leave" },
          }),
        );
        await waitFor(() => !room.seats.has(leaving.playerId));
      }
      assert.equal(room.seats.has(leaving.playerId), false);
      assert.equal(room.readiness.records.has(leaving.playerId), false);
      assert.equal(room.transcription.ink.has(leaving.playerId), false);
      assert.deepEqual(game.state.ledger, before.ledger);
      for (const p of game.state.players)
        assert.equal(p.scoreUnits, scores.find((s) => s.id === p.id)!.score);
      if (scenario === "setup") {
        assert.equal(game.state.phase, "LOBBY");
        assert.equal(game.state.players.length, 1);
        assert.doesNotThrow(() => game.addPlayer("New friend"));
      } else if (scenario === "completed") {
        assert.equal(game.state.phase, "MATCH_RESULT");
        assert.equal(game.state.winnerId, before.winnerId);
        assert.deepEqual(game.state.results, before.results);
        assert.equal(
          game.player(leaving.playerId).name,
          before.players.find((p) => p.id === leaving.playerId)!.name,
        );
        assert.equal(game.player(leaving.playerId).connected, false);
        assert.equal(game.player(leaving.playerId).mediaReady, false);
        assert.equal(game.allMediaReady(), false);
      } else {
        assert.equal(game.state.phase, "ABORTED");
        assert.equal(game.state.turn, null);
        assert.equal(game.state.winnerId, null);
        assert.equal(game.state.judgePending, false);
        assert.equal(room.judging.queue.length, 0);
        assert.equal(room.timers.size, 0);
        if (scenario !== "aborted")
          assert.match(game.state.status, /left the court/);
        if (scenario === "judging") assert.equal(judgeSignal?.aborted, true);
      }
      const sequence = game.state.seq;
      room.leave(leaving.playerId);
      assert.equal(game.state.seq, sequence, "repeated cleanup is harmless");
      if (judgeSignal) pending.reject(new Error("Late provider failure"));
      await flush();
      tick();
      if (scenario !== "setup")
        assert.equal(
          game.state.phase,
          scenario === "completed" ? "MATCH_RESULT" : "ABORTED",
        );
      assert.deepEqual(game.state.ledger, before.ledger);
    });

test("departed and terminal transcription callbacks cannot restore evidence, captions, or judging", async () => {
  const callbacks = new Map<
    string,
    Parameters<RoomServices["createTranscription"]>[3]
  >();
  const closing: { id: string; ownsSeat: boolean; phase: string }[] = [];
  const f = roomFixture({
    transcriptionAvailable: () => true,
    createTranscription: (id, roundId, turnId, handlers) => {
      callbacks.set(id, handlers);
      const final = { ...evidence(f.room.game, "close-final"), playerId: id };
      return {
        ...fakeTranscription(turnId, roundId),
        close: async () => {
          closing.push({
            id,
            ownsSeat: f.room.seats.has(id),
            phase: f.room.game.state.phase,
          });
          handlers.caption("Late caption from close", true);
          handlers.segment(final);
          return true;
        },
      };
    },
  });
  try {
    const { room, turn } = f;
    for (const p of room.game.state.players) {
      room.seats
        .get(p.id)!
        .sockets.set("audio", { close() {}, readyState: 1, send() {} } as any);
      room.transcription.rotate(p.id, turn.id);
    }
    const segment = evidence(room.game);
    room.game.registerSegment(segment);
    const record = room.game.turns.get(turn.id)!;
    const evidenceBefore = [...record.segments];
    const captionsBefore = structuredClone(room.game.state.captions);
    room.leave(turn.playerId);
    assert.deepEqual(
      closing.filter((entry) => entry.id === turn.playerId),
      [{ id: turn.playerId, ownsSeat: false, phase: "ABORTED" }],
      "ownership was revoked before provider close",
    );
    assert.equal(
      closing.length,
      2,
      "abort also retires the other gameplay stream",
    );
    assert(closing.every((entry) => entry.phase === "ABORTED"));
    for (const [id, handlers] of callbacks) {
      handlers.caption("Late caption", true);
      handlers.segment({ ...segment, id: "late:" + id, playerId: id });
      handlers.start();
      handlers.end();
      if (id === turn.playerId) handlers.error(new Error("Late failure"));
    }
    await flush();
    assert.equal(room.game.state.phase, "ABORTED");
    assert.deepEqual([...record.segments], evidenceBefore);
    assert.deepEqual(room.game.state.captions, captionsBefore);
    assert.equal(room.judging.busy, false);
    assert.equal(room.judging.queue.length, 0);
    assert.equal(room.game.state.judgePending, false);
    assert.equal(room.readiness.records.has(turn.playerId), false);
  } finally {
    // This fixture's close callback deliberately probes the sealed turn.
    f.room.transcription.ink.clear();
    f.room.close();
  }
});

test("HTTP departure rejects a stale epoch and an invalid token without evicting the seat", async (t) => {
  const app = createApp({ providersReady: () => true, services: services() });
  t.after(() => app.close());
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const { session } = await post(base, "/api/rooms", { name: "Alex" });
  const current = await post(base, "/api/resume", session);
  const room = app.registry.rooms.get(session.code)!;
  for (const input of [session, { ...current.session, token: "wrong" }]) {
    const response = await fetch(base + "/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 401);
    assert.equal(
      room.seats.get(session.playerId)!.epoch,
      current.session.connectionEpoch,
    );
    assert.equal(room.game.state.players.length, 1);
  }
});
