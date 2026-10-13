import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app";
import { CRITERIA, canSpeak } from "../shared/domain";
import { services, flush } from "./fixtures";
import { WsPeer, post, waitFor } from "./ws-peer";

test(
  "two real socket clients finish an attributed scored match, recover shared speech and rematch",
  { timeout: 45000 },
  async (t) => {
    const previous = process.env.FORCE_WSS;
    process.env.FORCE_WSS = "true";
    let transcriptCount = 0;
    const app = createApp({
      providersReady: () => true,
      services: services({
        transcriptionAvailable: () => true,
        normalizeTopic: async () => ({
          safe: true,
          proposition: "Waffles are better than pancakes.",
          positive: "Waffles",
          negative: "Pancakes",
        }),
        createTranscription: (playerId, roundId, turnId, handlers) => {
          let heard = false,
            closed = false;
          return {
            turnId,
            roundId,
            connected: true,
            closing: false,
            failed: false,
            send: (audio) => {
              if (audio.some((x) => x !== 0) && !closed) {
                if (!heard && !turnId)
                  setTimeout(() => {
                    if (!closed)
                      handlers.segment({
                        id: crypto.randomUUID(),
                        playerId,
                        roundId,
                        turnId: null,
                        sessionEpoch: "setup",
                        text: "Bonk hear me out",
                        stableAt: Date.now(),
                        eligible: false,
                        source: "voice",
                      });
                  }, 100);
                heard = true;
              }
            },
            close: async () => {
              if (closed) return true;
              closed = true;
              await flush();
              if (heard && turnId) {
                transcriptCount++;
                handlers.caption("Syrup pockets spread sweetness.", true);
                handlers.segment({
                  id: crypto.randomUUID(),
                  playerId,
                  roundId,
                  turnId,
                  sessionEpoch: "fixture",
                  text: "Syrup pockets spread sweetness.",
                  stableAt: Date.now(),
                  eligible: true,
                  source: "voice",
                });
              }
              return true;
            },
          };
        },
        judge: async (
          state,
          segments,
          _kind,
          _targets,
          _recent,
          _claims,
          jobId,
          ids,
        ) => {
          const s = segments[0];
          return {
            jobId,
            scores: CRITERIA.map((criterion) => ({
              playerId: s.playerId,
              roundId: s.roundId,
              turnId: s.turnId!,
              segmentId: s.id,
              criterion,
              quality: s.playerId === state.players[0].id ? 3 : 1,
              reason: "Syrup pockets explain even sweetness.",
            })),
            arguments: [
              {
                claimId: ids[0],
                playerId: s.playerId,
                segmentId: s.id,
                summary: "Syrup pockets distribute sweetness.",
                answersClaimId: null,
              },
            ],
            reaction: { segmentId: s.id, text: "Those pockets came prepared." },
            intervention: {
              kind: "unanswered",
              targetPlayerId: state.players.find((p) => p.id !== s.playerId)!
                .id,
              claimId: ids[0],
              text: `${state.players.find((p) => p.id !== s.playerId)!.name}, answer those syrup pockets.`,
            },
          };
        },
      }),
    });
    await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const a = await post(base, "/api/rooms", { name: "Sam" }),
      b = await post(base, "/api/join", { name: "Alex", code: a.session.code });
    const pa = new WsPeer(base, a.session, a.snapshot),
      pb = new WsPeer(base, b.session, b.snapshot);
    t.after(() => {
      pa.close();
      pb.close();
      app.close();
      if (previous === undefined) delete process.env.FORCE_WSS;
      else process.env.FORCE_WSS = previous;
    });
    await pa.connect();
    await pb.connect();
    await waitFor(
      () =>
        pa.state.players.every((p) => p.mediaReady) &&
        pb.state.players.every((p) => p.mediaReady),
    );
    pa.send({ type: "ready", value: true });
    pb.send({ type: "ready", value: true });
    await waitFor(
      () =>
        pa.state.phase === "TOPIC_SELECT" && pb.state.phase === "TOPIC_SELECT",
    );
    const tails = pa.state.tailsId === pa.session.playerId ? pa : pb;
    tails.send({
      type: "propose_topic",
      text: "Waffles vs pancakes",
      chosenPosition: "waffles",
    });
    await waitFor(
      () =>
        pa.state.phase === "TOPIC_CONFIRM" &&
        pb.state.phase === "TOPIC_CONFIRM",
    );
    pa.send({ type: "confirm_topic", topicRevision: 1 });
    pb.send({ type: "confirm_topic", topicRevision: 1 });
    await waitFor(
      () => pa.state.phase === "ROUND" && pa.state.judge?.status === "speaking",
    );
    pa.close();
    await waitFor(() => pb.state.phase === "RECOVERING");
    const protectedTurn = pb.state.turn!.id;
    const resume = await post(base, "/api/resume", pa.session);
    pa.session = resume.session;
    pa.state = resume.snapshot;
    await pa.connect();
    await waitFor(
      () =>
        pa.state.phase === "ROUND" &&
        pb.state.phase === "ROUND" &&
        !pa.state.turn?.pausedReason,
    );
    assert.equal(pa.state.turn!.id, protectedTurn);
    let turns = 0;
    while (pa.state.phase !== "MATCH_RESULT") {
      await waitFor(
        () =>
          pa.state.phase === "MATCH_RESULT" ||
          (pa.state.phase === "ROUND" &&
            canSpeak(pa.state, pa.state.turn!.playerId)),
      );
      if ((pa.state as typeof pa.state).phase === "MATCH_RESULT") break;
      const turn = pa.state.turn!,
        speaker = turn.playerId === pa.session.playerId ? pa : pb,
        other = speaker === pa ? pb : pa;
      // Both send nonzero audio. Server eligibility must admit only the floor holder.
      speaker.pcm.fill(1);
      other.pcm.fill(2);
      await new Promise((r) => setTimeout(r, 100));
      speaker.pcm.fill(0);
      other.pcm.fill(0);
      const id = speaker.send({
        type: "done",
        turnId: turn.id,
        lastAudioSeq: speaker.seq,
      });
      speaker.send(
        { type: "done", turnId: turn.id, lastAudioSeq: speaker.seq },
        id,
      );
      await waitFor(() => pa.state.turn?.id !== turn.id);
      turns++;
    }
    await waitFor(
      () =>
        pb.state.phase === "MATCH_RESULT" &&
        pa.state.judge?.status === "silent" &&
        pb.state.judge?.status === "silent",
    );
    assert.equal(turns, 12);
    assert.equal(transcriptCount, 12);
    assert.equal(pa.state.players[0].wins, 2);
    assert.deepEqual(pa.state.ledger, pb.state.ledger);
    assert.deepEqual(pa.state.results, pb.state.results);
    assert.equal(pa.state.winnerId, pb.state.winnerId);
    assert.deepEqual(pa.errors, []);
    assert.deepEqual(pb.errors, []);
    assert.deepEqual(pa.state.degraded, { tts: false });
    const cancelled = new Set([...pa.cancelled, ...pb.cancelled]);
    let completed = 0;
    for (const [epoch, hashes] of pa.voice) {
      if (!cancelled.has(epoch)) {
        assert(hashes.length > 0);
        assert.deepEqual(hashes, pb.voice.get(epoch));
        completed++;
      }
    }
    assert(completed > 10);
    assert(cancelled.size > 0);
    assert(
      pa.events.some(
        (e) =>
          e.type === "judge_buffer" &&
          e.snapshot.judge?.text.includes("syrup pockets"),
      ),
    );
    assert.equal(
      pa.events.filter(
        (e) => e.type === "phase_changed" && e.snapshot.phase === "RECOVERING",
      ).length,
      0,
    );
    assert.equal(
      pb.events.filter(
        (e) => e.type === "phase_changed" && e.snapshot.phase === "RECOVERING",
      ).length,
      1,
    );
    const old = pa.state.matchId;
    await waitFor(
      () =>
        pa.state.players.every((p) => p.mediaReady) &&
        pb.state.players.every((p) => p.mediaReady),
    );
    pa.send({ type: "rematch", value: true });
    pb.send({ type: "rematch", value: true });
    await waitFor(
      () => pa.state.matchId !== old && pb.state.matchId === pa.state.matchId,
    );
    assert.equal(pa.state.ledger.length, 0);
  },
);
