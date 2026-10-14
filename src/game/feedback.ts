import type { Snapshot } from "../../shared/domain";
import type { GameEvent } from "../../shared/protocol";

export type FeedbackCue =
  | {
      kind: "reaction";
      id: string;
      playerId: string;
      turnId: string;
      text: string;
      at: number;
    }
  | {
      kind: "score";
      id: string;
      playerId: string;
      deltaUnits: number;
      totalUnits: number;
      at: number;
    }
  | {
      kind: "coin" | "turn" | "round" | "match";
      id: string;
      playerId: string | null;
      at: number;
    };

/** Presentation consumes live events once. Snapshots are recovery, never rewards. */
export class FeedbackController {
  private room: string | null = null;
  private match: string | null = null;
  private round: string | null = null;
  private seq = -1;
  private awards = new Set<string>();
  private reactions = new Set<string>();

  accept(
    state: Snapshot,
    event?: GameEvent,
    at = performance.now(),
  ): { reset: boolean; cue?: FeedbackCue } {
    if (state.roomId === this.room && state.seq < this.seq)
      return { reset: false };
    const initial = this.room !== state.roomId;
    const changed =
      initial || this.match !== state.matchId || this.round !== state.roundId;
    const previousSeq = initial ? -1 : this.seq;
    const reset =
      changed ||
      !event ||
      state.phase === "RECOVERING" ||
      state.phase === "ABORTED";
    if (changed) {
      this.awards.clear();
      this.reactions.clear();
    }
    this.room = state.roomId;
    this.match = state.matchId;
    this.round = state.roundId;
    this.seq = Math.max(previousSeq, state.seq);
    let cue: FeedbackCue | undefined;
    const fresh =
      !initial &&
      event &&
      event.seq > previousSeq &&
      event.seq === state.seq &&
      event.roomId === state.roomId &&
      event.matchId === state.matchId &&
      state.phase !== "RECOVERING" &&
      state.phase !== "ABORTED";
    if (fresh) {
      const id = `${state.roomId}:${state.matchId}:${event.seq}`;
      if (
        event.type === "bonk_reaction" &&
        state.phase === "ROUND" &&
        state.turn?.id === event.payload.turnId &&
        state.roundId === event.payload.roundId &&
        !this.reactions.has(event.payload.id) &&
        (!state.judge || state.judge.status === "silent") &&
        state.ledger.some(
          (a) =>
            a.id === event.payload.awardId &&
            a.playerId === event.payload.playerId &&
            a.deltaUnits > 0 &&
            a.reason.trim() === event.payload.text,
        )
      ) {
        this.reactions.add(event.payload.id);
        cue = {
          kind: "reaction",
          id: event.payload.id,
          playerId: event.payload.playerId,
          turnId: event.payload.turnId,
          text: event.payload.text,
          at,
        };
      } else if (event.type === "score_committed") {
        const award = event.payload;
        const player = state.players.find((p) => p.id === award.playerId);
        if (
          player &&
          award.roundId === state.roundId &&
          award.deltaUnits > 0 &&
          !this.awards.has(award.id) &&
          state.ledger.some((s) => s.id === award.id)
        )
          cue = {
            kind: "score",
            id: award.id,
            playerId: player.id,
            deltaUnits: award.deltaUnits,
            totalUnits: player.scoreUnits,
            at,
          };
      } else if (
        event.type === "coin_committed" &&
        state.phase === "INTRO_COIN"
      ) {
        cue = { kind: "coin", id, playerId: null, at };
      } else if (
        event.type === "floor_opened" &&
        state.turn?.id === event.payload.turnId
      ) {
        cue = { kind: "turn", id, playerId: event.payload.playerId, at };
      } else if (
        event.type === "round_result" &&
        state.phase === "ROUND_RESOLVE" &&
        event.payload.roundId === state.roundId
      ) {
        cue = { kind: "round", id, playerId: event.payload.winnerId, at };
      } else if (
        event.type === "match_result" &&
        state.phase === "MATCH_RESULT" &&
        state.winnerId
      ) {
        cue = { kind: "match", id, playerId: state.winnerId, at };
      }
    }
    for (const award of state.ledger) this.awards.add(award.id);
    return { reset, cue };
  }
}

/** A retargetable tally, with exact endpoints and no changes to game state. */
export class ScoreTally {
  from: number;
  target: number;
  began = -Infinity;
  constructor(units: number) {
    this.from = this.target = units;
  }
  value(now: number) {
    const t = Math.max(0, Math.min(1, (now - this.began) / 400));
    return t === 1
      ? this.target
      : this.from + (this.target - this.from) * (1 - (1 - t) ** 3);
  }
  aim(units: number, now: number) {
    this.from = this.value(now);
    this.target = units;
    this.began = now;
  }
  snap(units: number) {
    this.from = this.target = units;
    this.began = -Infinity;
  }
}
