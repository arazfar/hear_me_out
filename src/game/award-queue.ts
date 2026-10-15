import type { FeedbackCue } from "./feedback";

export type ScoreAward = Extract<FeedbackCue, { kind: "score" }>;
export type AwardNotice = ScoreAward & {
  awardIds: string[];
  startedAt: number;
  holdUntil: number;
};
export const AWARD_COALESCE = 100;
export const AWARD_HOLD = 600;
export const AWARD_RENEW = 450;
export const AWARD_FADE = 200;

/** One live burst, with no backlog of numbers competing with the next turn. */
export class AwardQueue {
  private pending: (ScoreAward & { awardIds: string[] }) | null = null;
  private active: AwardNotice | null = null;
  private completed: AwardNotice | null = null;
  private readyAt = Infinity;

  private expire(now: number) {
    if (this.active && now >= this.active.holdUntil + AWARD_FADE) {
      this.completed = this.active;
      this.active = null;
    }
  }

  enqueue(award: ScoreAward) {
    this.expire(award.at);
    const current = this.active || this.pending;
    if (current?.awardIds.includes(award.id)) return;
    if (current) {
      current.awardIds.push(award.id);
      current.deltaUnits += award.deltaUnits;
      current.totalUnits = award.totalUnits;
      current.at = award.at;
      if (this.active)
        this.active.holdUntil = Math.max(
          this.active.holdUntil,
          award.at + AWARD_RENEW,
        );
    } else {
      this.pending = { ...award, awardIds: [award.id] };
      this.readyAt = award.at + AWARD_COALESCE;
    }
  }

  advance(now: number) {
    this.expire(now);
    let started = false;
    if (this.pending && now >= this.readyAt) {
      this.active = {
        ...this.pending,
        startedAt: now,
        holdUntil: now + AWARD_HOLD,
      };
      this.pending = null;
      this.readyAt = Infinity;
      started = true;
    }
    const completed = this.completed;
    this.completed = null;
    return {
      notice: this.active
        ? { ...this.active, awardIds: [...this.active.awardIds] }
        : null,
      started,
      completed,
      nextAt: this.active
        ? now < this.active.holdUntil
          ? this.active.holdUntil
          : this.active.holdUntil + AWARD_FADE
        : this.readyAt,
    };
  }

  clear() {
    this.pending = this.active = this.completed = null;
    this.readyAt = Infinity;
  }
}
