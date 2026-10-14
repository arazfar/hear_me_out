/** Local-only browser acceptance server. Never loaded by the production entrypoint. */
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app";
import { CRITERIA, snapshotSchema } from "../shared/domain";
import type { GameEvent } from "../shared/protocol";
import { PreparedVoice } from "../server/judge/voice-cache";
import { services } from "../tests/fixtures";

const heldJudges = new Map<
  string,
  { wait: Promise<void>; release: () => void }
>();
let speechDelay = 200;
const runtime = createApp({
  providersReady: () => true,
  services: services({
    transcriptionAvailable: () => true,
    normalizeTopic: async (text) => ({
      safe: true,
      proposition: text,
      positive: "For the proposition",
      negative: "Against the proposition",
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
                if (closed) return;
                // Exercise the same interim/final callback boundary as Ink.
                handlers.caption("Bonk, hear", false);
                handlers.caption("Bonk, hear me out.", true);
                handlers.segment({
                  id: randomUUID(),
                  playerId,
                  roundId,
                  turnId: null,
                  sessionEpoch: "browser-check",
                  text: "Bonk, hear me out.",
                  stableAt: Date.now(),
                  eligible: false,
                  source: "voice",
                });
              }, speechDelay);
            heard = true;
          }
        },
        close: async () => {
          if (closed) return true;
          closed = true;
          if (heard && turnId) {
            const text =
              "A bread hinge does not stop a sub being a sandwich. The hot dog gets the same deal.";
            handlers.caption(text, true);
            handlers.segment({
              id: randomUUID(),
              playerId,
              roundId,
              turnId,
              sessionEpoch: "browser-fixture",
              text,
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
      _onScore,
      _recentReactions,
      signal,
    ) => {
      const held = heldJudges.get(state.code);
      if (held) {
        signal?.addEventListener("abort", held.release, { once: true });
        await held.wait;
        signal?.removeEventListener("abort", held.release);
      }
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
          reason: "That bread hinge makes your case.",
        })),
        arguments: [
          {
            claimId: ids[0],
            playerId: s.playerId,
            segmentId: s.id,
            summary: "A sub keeps its bread hinge and is still a sandwich.",
            answersClaimId: null,
          },
        ],
        reaction: {
          segmentId: s.id,
          text: "That bread hinge is doing a lot of work.",
        },
        intervention: null,
      };
    },
  }),
});
const awardReplays = new Map<string, GameEvent[]>();
// Test-only inspection and failure injection. These routes do not exist in production.
runtime.app.post("/__test/state/:code", (req, res) => {
  const room = runtime.registry.rooms.get(req.params.code);
  res.json(room?.game.snapshot() || null);
});
runtime.app.post("/__test/timeline/:code", (req, res) => {
  res.json(runtime.registry.rooms.get(req.params.code)?.timeline || []);
});
runtime.app.post("/__test/voice/:code", (req, res) => {
  const room = runtime.registry.rooms.get(req.params.code);
  if (!room || room.playback.speech) {
    res.status(409).end();
    return;
  }
  const samples = 44100 * 9 + 13;
  const text = "Every last syllable gets its day in court. Case closed.";
  const voice = new PreparedVoice(text, 20, async (_text, receive) => {
    const pcm = new Int16Array(samples);
    for (let i = 0; i < samples; i++)
      pcm[i] = Math.round(Math.sin((i * 2 * Math.PI * 330) / 44100) * 3000);
    pcm.fill(20000, samples - 13);
    receive(new Uint8Array(pcm.buffer));
    return samples / 44100;
  });
  void room.playback.say(text, null, false, 20, voice);
  res.json({ epoch: room.playback.speech!.epoch, samples });
});
runtime.app.post("/__test/reset", (_req, res) => {
  for (const held of heldJudges.values()) held.release();
  heldJudges.clear();
  speechDelay = 200;
  awardReplays.clear();
  for (const room of runtime.registry.rooms.values()) room.close();
  runtime.registry.rooms.clear();
  runtime.registry.byId.clear();
  runtime.registry.buckets.clear();
  res.json({ ok: true });
});
runtime.app.post("/__test/provider", (req, res) => {
  speechDelay = Math.max(
    0,
    Math.min(16000, Number(req.body.speechDelay) || 200),
  );
  res.json({ ok: true });
});
// Exercise an actual asynchronous provider request while the floor stays live.
runtime.app.post("/__test/judge/:code/:action", (req, res) => {
  const room = runtime.registry.rooms.get(req.params.code);
  const turn = room?.game.state.turn;
  if (req.params.action === "release") {
    heldJudges.get(req.params.code)?.release();
    heldJudges.delete(req.params.code);
    res.json({ ok: true });
    return;
  }
  if (
    req.params.action !== "hold" ||
    !room ||
    !turn ||
    room.game.state.phase !== "ROUND" ||
    turn.sealing ||
    turn.pausedReason ||
    room.judging.busy
  ) {
    res.status(409).end();
    return;
  }
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  heldJudges.set(req.params.code, { wait, release });
  room.judging.onSegment({
    id: randomUUID(),
    playerId: turn.playerId,
    turnId: turn.id,
    roundId: room.game.state.roundId!,
    sessionEpoch: "held-judge-fixture",
    text: "A bread hinge does not change a sandwich.",
    stableAt: Date.now(),
    eligible: true,
    source: "voice",
  });
  res.json(room.game.snapshot());
});
// Real score commits, with controlled quality, for temporal UI assertions.
runtime.app.post("/__test/award/:code", (req, res) => {
  const room = runtime.registry.rooms.get(req.params.code);
  const turn = room?.game.state.turn;
  if (!room || !turn || room.game.state.phase !== "ROUND" || turn.sealing) {
    res.status(409).end();
    return;
  }
  const quality = Number(req.body.quality);
  if (![1, 2, 3, 4].includes(quality)) {
    res.status(400).end();
    return;
  }
  const segment = {
    id: randomUUID(),
    playerId: turn.playerId,
    turnId: turn.id,
    roundId: room.game.state.roundId!,
    sessionEpoch: "feedback-fixture",
    text: "A bread hinge does not change a sandwich.",
    stableAt: Date.now(),
    eligible: true,
    source: "voice" as const,
  };
  room.game.registerSegment(segment);
  const events: GameEvent[] = [],
    previous = room.game.onEvent;
  room.game.onEvent = (event) => {
    if (event.type === "score_committed") events.push(event);
    previous(event);
  };
  try {
    for (const criterion of CRITERIA)
      room.game.score({
        ...segment,
        segmentId: segment.id,
        criterion,
        quality,
        reason: "Uses a sub as a counterexample.",
      });
  } finally {
    room.game.onEvent = previous;
  }
  awardReplays.set(req.params.code, events);
  res.json({
    ids: events.map((e) => (e.type === "score_committed" ? e.payload.id : "")),
    snapshot: room.game.snapshot(),
  });
});
runtime.app.post("/__test/replay/:code", (req, res) => {
  const room = runtime.registry.rooms.get(req.params.code);
  if (!room) {
    res.status(404).end();
    return;
  }
  for (const seat of room.seats.values()) {
    const ws = seat.sockets.get("control");
    for (const event of awardReplays.get(req.params.code) || [])
      ws?.send(JSON.stringify(event));
    ws?.send(
      JSON.stringify({ type: "snapshot", snapshot: room.game.snapshot() }),
    );
  }
  res.json({ ok: true });
});
runtime.app.post("/__test/failure/:code/:kind", (req, res) => {
  const room = runtime.registry.rooms.get(req.params.code);
  if (!room) {
    res.status(404).end();
    return;
  }
  if (req.params.kind === "abort")
    room.game.abort(
      "The connection could not recover. Start a fresh match together.",
    );
  if (req.params.kind === "stt")
    room.transcription.sttFailure(
      room.game.state.turn!.playerId,
      room.game.state.turn!.id,
    );
  if (req.params.kind === "tts")
    room.game.degrade(
      "tts",
      "Bonk’s voice is unavailable. Follow the captions.",
    );
  room.game.emit("media_status");
  res.json({ ok: true });
});
runtime.app.post("/__test/present/:code", (req, res) => {
  const room = runtime.registry.rooms.get(req.params.code);
  if (!room) {
    res.status(404).end();
    return;
  }
  // Presentation fixtures only; real journey tests never use this route.
  room.playback.cancelSpeech();
  room.game.roundStartedAt = Date.now();
  room.game.state = snapshotSchema.parse({ ...room.game.state, ...req.body });
  // Injected open turns need the matching mock input owner too. Otherwise the
  // normal readiness monitor replaces the intended capture with recovery before
  // the screenshot settles. Real journey tests never use this route.
  const turn = room.game.state.turn;
  if (room.game.state.phase === "ROUND" && turn?.inputState === "open")
    room.transcription.rotate(turn.playerId, turn.id);
  if (room.game.state.turn?.sealing) room.game.sealAt = Date.now();
  room.game.emit("media_status");
  res.json({ ok: true });
});
const port = Number(process.env.PORT || 3002);
runtime.server.listen(port, "127.0.0.1", () =>
  console.log("Browser fixture on " + port),
);
process.on("SIGINT", runtime.close);
process.on("SIGTERM", runtime.close);
