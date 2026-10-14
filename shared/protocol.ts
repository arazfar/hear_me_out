import { z } from "zod";
import {
  roundResultSchema,
  scoreEventSchema,
  snapshotSchema,
} from "./domain.js";
export const PROTOCOL_VERSION = 4;
export const commandEnvelopeSchema = z
  .object({
    commandId: z.string().max(80),
    connectionEpoch: z.number().int(),
    matchId: z.string().nullable(),
    expectedPhaseVersion: z.number().int(),
    command: z.discriminatedUnion("type", [
      z.object({ type: z.literal("ready"), value: z.boolean() }).strict(),
      z
        .object({
          type: z.literal("media_status"),
          captureId: z.string().max(100),
          cameraId: z.string().max(100),
          mic: z.boolean(),
          camera: z.boolean(),
          foreground: z.boolean(),
          micSource: z.boolean().optional(),
          rtcFailed: z.boolean().optional(),
          localFrames: z.number().int().nonnegative(),
          cameraGeneration: z.number().int().nonnegative().optional(),
          remoteFrames: z.number().int().nonnegative(),
          mediaEpoch: z.number().int(),
          rtc: z.boolean(),
        })
        .strict(),
      z
        .object({
          type: z.literal("setup_start"),
          checkId: z.string().min(1).max(100),
          captureId: z.string().min(1).max(100),
        })
        .strict(),
      z
        .object({
          type: z.literal("setup_cancel"),
          checkId: z.string().max(100),
        })
        .strict(),
      z
        .object({
          type: z.literal("propose_topic"),
          text: z.string().min(1).max(160),
          chosenPosition: z.string().max(100),
          suggestion: z.string().optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("confirm_topic"),
          topicRevision: z.number().int(),
        })
        .strict(),
      z
        .object({
          type: z.literal("reject_topic"),
          topicRevision: z.number().int(),
        })
        .strict(),
      z
        .object({
          type: z.literal("done"),
          turnId: z.string(),
          lastAudioSeq: z.number().int(),
        })
        .strict(),
      z
        .object({
          type: z.literal("audio_ready"),
          utteranceId: z.string(),
          speechEpoch: z.number().int(),
          rttMs: z.number().min(0).max(2000).optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("audio_playback"),
          utteranceId: z.string().max(100),
          speechEpoch: z.number().int().nonnegative(),
          status: z.enum(["progress", "complete", "failed"]),
          samples: z.number().int().min(0).max(882000),
        })
        .strict(),
      z.object({ type: z.literal("rematch"), value: z.boolean() }).strict(),
      z.object({ type: z.literal("leave") }).strict(),
    ]),
  })
  .strict();

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export const commandSchema = commandEnvelopeSchema.shape.command;
export type Command = z.infer<typeof commandSchema>;
const id = z.string().min(1).max(100),
  uint = z.number().int().min(0).max(0xffffffff),
  time = z.number().finite();
export const sessionSchema = z.object({
  roomId: id,
  playerId: id,
  token: z.string().min(1).max(128),
  connectionEpoch: uint,
  code: z.string().regex(/^\d{4}$/),
});
export type Session = z.infer<typeof sessionSchema>;
export const authSchema = sessionSchema
  .omit({ code: true })
  .extend({
    type: z.literal("auth"),
    protocolVersion: z.literal(PROTOCOL_VERSION),
  })
  .strict();
const description = z.object({
  type: z.enum(["offer", "answer", "pranswer", "rollback"]),
  sdp: z.string().max(60000).optional(),
});
const candidate = z.object({
  candidate: z.string().max(2000).optional(),
  sdpMid: z.string().max(100).nullable().optional(),
  sdpMLineIndex: uint.nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});
export const signalSchema = z
  .object({
    type: z.literal("signal"),
    mediaEpoch: uint,
    description: description.optional(),
    candidate: candidate.optional(),
    from: id.optional(),
  })
  .refine((v) => !!v.description !== !!v.candidate);
export type Signal = z.infer<typeof signalSchema>;
export const auxiliarySchema = z.union([
  z.object({ type: z.literal("ping"), clientTime: time }).strict(),
  z.object({ type: z.literal("snapshot_request") }).strict(),
  signalSchema,
  z
    .object({
      type: z.literal("video_ack"),
      seq: uint,
      mediaEpoch: uint,
      probe: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("playback_metric"),
      utteranceId: z.string().min(1).max(80),
      speechEpoch: z.number().int().nonnegative(),
      latencyMs: z.number().min(0).max(30000),
      cueToPlaybackMs: z.number().min(0).max(60000).optional(),
      turnDoneToPlaybackMs: z.number().min(0).max(60000).optional(),
    })
    .strict(),
]);
export const eventPayloads = {
  phase_changed: z.null(),
  player_joined: z.null(),
  ready_changed: z.null(),
  coin_committed: z.null(),
  topic_confirmed: z.null(),
  clock_changed: z.null(),
  turn_settlement: z.null(),
  judge_thinking: z.null(),
  judge_idle: z.null(),
  judge_buffer: z.null(),
  judge_finished: z.null(),
  voice_recovery: z.null(),
  recovery: z.null(),
  player_disconnected: z.null(),
  player_resumed: z.null(),
  player_left: z.null(),
  media_status: z.null(),
  match_result: z.null(),
  rematch_changed: z.null(),
  reconnected: z.null(),
  input_granted: z.object({ turnId: id, playerId: id, inputEpoch: uint }),
  floor_opened: z.object({ turnId: id, playerId: id, inputEpoch: uint }),
  floor_granted: z.object({ turnId: id, playerId: id }),
  turn_sealed: z.object({
    turnId: id,
    playerId: id,
    lastAudioSeq: z.number().int().min(-1),
    capturedBefore: z.number().finite(),
  }),
  comeback_window: z.object({ playerId: id, deficitUnits: uint }),
  score_committed: scoreEventSchema,
  bonk_reaction: z.object({
    id,
    awardId: id,
    playerId: id,
    roundId: id,
    turnId: id,
    text: z.string().max(80),
  }),
  round_result: roundResultSchema,
  judge_started: z.object({ startAt: time, epoch: uint }),
  judge_cancelled: z.object({ epoch: uint }),
  media_mode_changed: z.object({ mode: z.enum(["rtc", "wss"]) }),
  transcript: z
    .object({
      playerId: id,
      text: z.string().max(12000),
      final: z.boolean(),
      turnId: id.nullable(),
    })
    .nullable(),
};
const eventBase = z.object({
  roomId: id,
  matchId: id.nullable(),
  seq: uint,
  serverNowMs: time,
  phaseVersion: uint,
  snapshot: snapshotSchema,
});
function event<T extends keyof typeof eventPayloads>(type: T) {
  return eventBase.extend({
    type: z.literal(type),
    payload: eventPayloads[type],
  });
}
export const gameEventSchema = z.union([
  event("phase_changed"),
  event("player_joined"),
  event("ready_changed"),
  event("coin_committed"),
  event("topic_confirmed"),
  event("clock_changed"),
  event("turn_settlement"),
  event("judge_thinking"),
  event("judge_idle"),
  event("judge_buffer"),
  event("judge_finished"),
  event("voice_recovery"),
  event("recovery"),
  event("player_disconnected"),
  event("player_resumed"),
  event("player_left"),
  event("media_status"),
  event("match_result"),
  event("rematch_changed"),
  event("reconnected"),
  event("floor_granted"),
  event("input_granted"),
  event("floor_opened"),
  event("turn_sealed"),
  event("comeback_window"),
  event("score_committed"),
  event("bonk_reaction"),
  event("round_result"),
  event("judge_started"),
  event("judge_cancelled"),
  event("media_mode_changed"),
  event("transcript"),
]);
export type GameEvent = z.infer<typeof gameEventSchema>;
export const serverMessageSchema = z.union([
  z.object({
    type: z.literal("setup_result"),
    checkId: id,
    status: z.enum(["listening", "passed", "failed"]),
    inputEpoch: uint.optional(),
    text: z.string().max(300),
  }),
  gameEventSchema,
  z.object({
    type: z.enum(["authenticated", "snapshot"]),
    snapshot: snapshotSchema,
  }),
  z.object({ type: z.literal("pong"), clientTime: time, serverNow: time }),
  z.object({
    type: z.literal("activity"),
    playerId: id,
    level: z.number().min(0).max(1),
  }),
  signalSchema,
  z.object({
    type: z.literal("ack"),
    commandId: id,
    pending: z.boolean().optional(),
    ok: z.boolean().optional(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal("error"), error: z.string() }),
  z.object({
    type: z.literal("video_ack"),
    seq: uint,
    mediaEpoch: uint,
    probe: z.boolean().optional(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
