import { z } from "zod";
export const phaseSchema = z.union([
  z.literal("LOBBY"),
  z.literal("INTRO_COIN"),
  z.literal("TOPIC_SELECT"),
  z.literal("TOPIC_CONFIRM"),
  z.literal("ROUND"),
  z.literal("ROUND_RESOLVE"),
  z.literal("MATCH_RESULT"),
  z.literal("RECOVERING"),
  z.literal("ABORTED"),
]);
export type Phase = z.infer<typeof phaseSchema>;
export const criterionSchema = z.union([
  z.literal("reasoning"),
  z.literal("rebuttal"),
  z.literal("impact"),
  z.literal("wit"),
  z.literal("clarity"),
]);
export type Criterion = z.infer<typeof criterionSchema>;
export const CRITERIA: Criterion[] = [
  "reasoning",
  "rebuttal",
  "impact",
  "wit",
  "clarity",
];
export const opportunitySchema = z.union([
  z.literal("case"),
  z.literal("rebuttal"),
  z.literal("closing"),
]);
export type Opportunity = z.infer<typeof opportunitySchema>;
export const CAPS: Record<Opportunity, Record<Criterion, number>> = {
  case: { reasoning: 20, rebuttal: 0, impact: 12, wit: 6, clarity: 2 },
  rebuttal: { reasoning: 14, rebuttal: 12, impact: 8, wit: 4, clarity: 2 },
  closing: { reasoning: 14, rebuttal: 12, impact: 8, wit: 4, clarity: 2 },
};
export const playerSchema = z.object({
  id: z.string(),
  name: z.string(),
  connected: z.boolean(),
  ready: z.boolean(),
  mediaReady: z.boolean(),
  captureReady: z.boolean(),
  cameraOn: z.boolean(),
  readiness: z
    .object({
      setup: z.enum(["needed", "checking", "passed", "failed"]),
      blockers: z.array(z.string()),
    })
    .optional(),
  wins: z.number().finite(),
  scoreUnits: z.number().finite(),
});
export type Player = z.infer<typeof playerSchema>;
export const topicSchema = z.object({
  proposition: z.string(),
  positions: z.record(z.string(), z.string()),
  revision: z.number().finite(),
  confirmations: z.array(z.string()),
});
export type Topic = z.infer<typeof topicSchema>;
export const turnSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  kind: opportunitySchema,
  durationMs: z.number().finite(),
  remainingMs: z.number().finite(),
  deadline: z.union([z.number().finite(), z.null()]),
  pausedReason: z.union([z.string(), z.null()]),
  sealing: z.boolean(),
  settlement: z
    .union([z.literal("draining"), z.literal("scoring"), z.literal("ready")])
    .optional(),
  targets: z.record(criterionSchema, z.number().finite()),
});
export type Turn = z.infer<typeof turnSchema>;
export const segmentSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  roundId: z.string(),
  turnId: z.union([z.string(), z.null()]),
  sessionEpoch: z.string(),
  text: z.string(),
  stableAt: z.number().finite(),
  eligible: z.boolean(),
  source: z.literal("voice"),
});
export type Segment = z.infer<typeof segmentSchema>;
export const scoreEventSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  roundId: z.string(),
  turnId: z.string(),
  segmentId: z.string(),
  criterion: criterionSchema,
  quality: z.number().finite(),
  deltaUnits: z.number().finite(),
  reason: z.string(),
  at: z.number().finite(),
});
export type ScoreEvent = z.infer<typeof scoreEventSchema>;
export const claimSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  segmentId: z.string(),
  summary: z.string(),
  answersClaimId: z.union([z.string(), z.null()]),
});
export type Claim = z.infer<typeof claimSchema>;
export const roundResultSchema = z.object({
  round: z.number().finite(),
  roundId: z.string(),
  winnerId: z.string(),
  scores: z.record(z.string(), z.number().finite()),
  reason: z.string(),
  tieBreak: z.union([z.string(), z.null()]),
});
export type RoundResult = z.infer<typeof roundResultSchema>;
export const judgeStateSchema = z.object({
  id: z.string(),
  epoch: z.number().finite(),
  text: z.string(),
  status: z.union([
    z.literal("buffering"),
    z.literal("speaking"),
    z.literal("silent"),
  ]),
  startAt: z.union([z.number().finite(), z.null()]),
  expression: z.string(),
  targetPlayerId: z.union([z.string(), z.null()]),
  cueAt: z.number().finite().optional(),
  turnDoneAt: z.number().finite().optional(),
});
export type JudgeState = z.infer<typeof judgeStateSchema>;
export const snapshotSchema = z.object({
  roomId: z.string(),
  code: z.string(),
  seq: z.number().finite(),
  phaseVersion: z.number().finite(),
  phase: phaseSchema,
  serverNow: z.number().finite(),
  players: z.array(playerSchema),
  matchId: z.union([z.string(), z.null()]),
  headsId: z.union([z.string(), z.null()]),
  tailsId: z.union([z.string(), z.null()]),
  topic: z.union([topicSchema, z.null()]),
  phaseDeadline: z.union([z.number().finite(), z.null()]),
  round: z.number().finite(),
  roundId: z.union([z.string(), z.null()]),
  turn: z.union([turnSchema, z.null()]),
  turnIndex: z.number().finite(),
  ledger: z.array(scoreEventSchema),
  claims: z.array(claimSchema),
  results: z.array(roundResultSchema),
  captions: z.record(
    z.string(),
    z.object({ text: z.string(), final: z.boolean(), at: z.number().finite() }),
  ),
  judge: z.union([judgeStateSchema, z.null()]),
  mediaMode: z.union([
    z.literal("connecting"),
    z.literal("rtc"),
    z.literal("wss"),
  ]),
  mediaEpoch: z.number().finite(),
  comebackPlayerId: z.union([z.string(), z.null()]),
  rematchReady: z.array(z.string()),
  status: z.string(),
  judgePending: z.boolean(),
  recoveryDeadline: z.union([z.number().finite(), z.null()]),
  degraded: z.object({ tts: z.boolean() }),
  winnerId: z.union([z.string(), z.null()]),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const SUGGESTIONS = [
  {
    id: "waffles",
    icon: "🧇",
    label: "Waffles vs. pancakes",
    proposition: "Waffles are a better breakfast than pancakes.",
    positive: "Team waffles",
    negative: "Team pancakes",
  },
  {
    id: "sports",
    icon: "🏀",
    label: "Basketball vs. football",
    proposition: "Basketball is a better spectator sport than football.",
    positive: "Team basketball",
    negative: "Team football",
  },
  {
    id: "hotdog",
    icon: "🌭",
    label: "Is a hot dog a sandwich?",
    proposition: "A hot dog is a sandwich.",
    positive: "It is a sandwich",
    negative: "It is not a sandwich",
  },
];
export const points = (units: number) =>
  (units / 4).toFixed(2).replace(/\.00$/, "");
export function canSpeak(
  state: Snapshot | null,
  playerId: string | null,
): boolean {
  if (!state) return true;
  if (state.judge && state.judge.status !== "silent") return false;
  if (state.phase === "LOBBY" || state.phase === "MATCH_RESULT") return true;
  return (
    state.phase === "ROUND" &&
    !!state.turn &&
    state.turn.playerId === playerId &&
    !state.turn.sealing &&
    !state.turn.pausedReason
  );
}
export function scoreShare(
  players: readonly Pick<Player, "scoreUnits">[],
): number {
  if (players.length < 2) return 0.5;
  const a = players[0].scoreUnits,
    b = players[1].scoreUnits;
  return a + b ? a / (a + b) : 0.5;
}
