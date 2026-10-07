export type Phase =
  | "LOBBY"
  | "INTRO_COIN"
  | "TOPIC_SELECT"
  | "TOPIC_CONFIRM"
  | "ROUND"
  | "ROUND_RESOLVE"
  | "MATCH_RESULT"
  | "RECOVERING"
  | "ABORTED";
export type Criterion = "reasoning" | "rebuttal" | "impact" | "wit" | "clarity";
export const CRITERIA: Criterion[] = [
  "reasoning",
  "rebuttal",
  "impact",
  "wit",
  "clarity",
];
export type Opportunity = "case" | "rebuttal" | "closing";
export const CAPS: Record<Opportunity, Record<Criterion, number>> = {
  case: { reasoning: 20, rebuttal: 0, impact: 12, wit: 6, clarity: 2 },
  rebuttal: { reasoning: 14, rebuttal: 12, impact: 8, wit: 4, clarity: 2 },
  closing: { reasoning: 14, rebuttal: 12, impact: 8, wit: 4, clarity: 2 },
};
export interface Player {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  mediaReady: boolean;
  captureReady: boolean;
  cameraOn: boolean;
  wins: number;
  scoreUnits: number;
}
export interface Topic {
  proposition: string;
  positions: Record<string, string>;
  revision: number;
  confirmations: string[];
}
export interface Turn {
  id: string;
  playerId: string;
  kind: Opportunity;
  durationMs: number;
  remainingMs: number;
  deadline: number | null;
  pausedReason: string | null;
  sealing: boolean;
  settlement?: "draining" | "scoring" | "ready";
  targets: Record<Criterion, number>;
  overlapRefundMs: number;
  suppressOpponent: boolean;
}
export interface Segment {
  id: string;
  playerId: string;
  roundId: string;
  turnId: string | null;
  sessionEpoch: string;
  text: string;
  stableAt: number;
  eligible: boolean;
  source: "voice" | "typed";
}
export interface ScoreEvent {
  id: string;
  playerId: string;
  roundId: string;
  turnId: string;
  segmentId: string;
  criterion: Criterion;
  quality: number;
  deltaUnits: number;
  reason: string;
  at: number;
}
export interface Claim {
  id: string;
  playerId: string;
  segmentId: string;
  summary: string;
  answersClaimId: string | null;
}
export interface RoundResult {
  round: number;
  roundId: string;
  winnerId: string;
  scores: Record<string, number>;
  reason: string;
  tieBreak: string | null;
}
export interface JudgeState {
  id: string;
  epoch: number;
  text: string;
  status: "buffering" | "speaking" | "silent";
  startAt: number | null;
  expression: string;
  targetPlayerId: string | null;
  cueAt?: number;
  turnDoneAt?: number;
}
export interface Snapshot {
  roomId: string;
  code: string;
  seq: number;
  phaseVersion: number;
  phase: Phase;
  serverNow: number;
  players: Player[];
  matchId: string | null;
  headsId: string | null;
  tailsId: string | null;
  topic: Topic | null;
  phaseDeadline: number | null;
  round: number;
  roundId: string | null;
  turn: Turn | null;
  turnIndex: number;
  ledger: ScoreEvent[];
  claims: Claim[];
  results: RoundResult[];
  captions: Record<string, { text: string; final: boolean; at: number }>;
  judge: JudgeState | null;
  mediaMode: "connecting" | "rtc" | "wss";
  mediaEpoch: number;
  comebackPlayerId: string | null;
  rematchReady: string[];
  status: string;
  judgePending: boolean;
  recoveryDeadline: number | null;
  degraded: { tts: boolean; stt: boolean };
  winnerId: string | null;
}
export type Command =
  | { type: "ready"; value: boolean }
  | { type: "media_status"; ready: boolean; cameraOn: boolean; rtc: boolean }
  | {
      type: "propose_topic";
      text: string;
      chosenPosition: string;
      suggestion?: string;
    }
  | { type: "confirm_topic"; topicRevision: number }
  | { type: "reject_topic"; topicRevision: number }
  | { type: "done"; turnId: string; lastAudioSeq: number }
  | { type: "barge_in"; utteranceId: string; speechEpoch: number }
  | { type: "audio_ready"; utteranceId: string; speechEpoch: number }
  | { type: "rematch"; value: boolean }
  | { type: "typed_argument"; turnId: string; text: string }
  | { type: "leave" };
export interface CommandEnvelope {
  commandId: string;
  connectionEpoch: number;
  matchId: string | null;
  expectedPhaseVersion: number;
  command: Command;
}
export interface GameEvent {
  roomId: string;
  matchId: string | null;
  seq: number;
  serverNowMs: number;
  phaseVersion: number;
  type: string;
  payload: unknown;
  snapshot: Snapshot;
}
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

/** Authoritative floor policy, shared by capture, playback and server ingestion. */
export function canSpeak(state: Snapshot | null, playerId: string | null): boolean {
  if (!state) return true;
  if (state.judge && state.judge.status !== "silent") return false;
  if (state.phase === "LOBBY" || state.phase === "MATCH_RESULT") return true;
  return state.phase === "ROUND" && !!state.turn &&
    state.turn.playerId === playerId && !state.turn.sealing &&
    !state.turn.pausedReason;
}

export function scoreShare(players: readonly Pick<Player, "scoreUnits">[]): number {
  if (players.length < 2) return 0.5;
  const a = players[0].scoreUnits, b = players[1].scoreUnits;
  return a + b ? a / (a + b) : 0.5;
}
