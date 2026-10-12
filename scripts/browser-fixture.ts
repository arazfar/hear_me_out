/** Local-only browser acceptance server. Never loaded by the production entrypoint. */
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app";
import { CRITERIA, snapshotSchema } from "../shared/domain";
import { services } from "../tests/fixtures";

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
          if (audio.some((x) => x !== 0)) heard = true;
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
          reason:
            "Answers the bread-hinge distinction with a clear counterexample.",
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
// Test-only inspection and failure injection. These routes do not exist in production.
runtime.app.post("/__test/state/:code", (req, res) => {
  const room = runtime.registry.rooms.get(req.params.code);
  res.json(room?.game.snapshot() || null);
});
runtime.app.post("/__test/reset", (_req, res) => {
  for (const room of runtime.registry.rooms.values()) room.close();
  runtime.registry.rooms.clear();
  runtime.registry.byId.clear();
  runtime.registry.buckets.clear();
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
    room.game.degrade(
      "stt",
      "Speech recognition is unavailable. Type your argument.",
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
  room.game.emit("media_status");
  res.json({ ok: true });
});
const port = Number(process.env.PORT || 3002);
runtime.server.listen(port, "127.0.0.1", () =>
  console.log("Browser fixture on " + port),
);
process.on("SIGINT", runtime.close);
process.on("SIGTERM", runtime.close);
