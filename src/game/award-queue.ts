import type { FeedbackCue } from "./feedback";

export type ScoreAward = Extract<FeedbackCue, { kind: "score" }>;
export type AwardNotice = ScoreAward & { slot: number; startedAt: number };
export const AWARD_LIFETIME = 900;
export const AWARD_STAGGER = 85;

// Includes room for the longest fractional label and its 1.12× pop.
export const awardCapacity = (width: number) =>
  Math.max(1, Math.min(5, Math.floor(width / 96)));

/** Only decoration waits here. Totals and sound consume the original cue. */
export class AwardQueue {
  private pending: ScoreAward[] = [];
  private active: AwardNotice[] = [];
  private lastStart = -Infinity;

  enqueue(award: ScoreAward) {
    this.pending.push(award);
  }

  advance(now: number, capacity: number) {
    this.active = this.active.filter(
      (notice) => now < notice.startedAt + AWARD_LIFETIME,
    );
    const slot = Array.from({ length: capacity }, (_, i) => i).find(
      (i) => !this.active.some((notice) => notice.slot === i),
    );
    if (
      this.pending.length &&
      slot !== undefined &&
      now >= this.lastStart + AWARD_STAGGER
    ) {
      // Start one at the actual display time, even if a timer arrived late.
      this.active.push({ ...this.pending.shift()!, slot, startedAt: now });
      this.lastStart = now;
    }
    const slots = Math.max(capacity, ...this.active.map((n) => n.slot + 1));
    const nextExpiry = Math.min(
      ...this.active.map((n) => n.startedAt + AWARD_LIFETIME),
    );
    const hasSpace =
      this.active.filter((n) => n.slot < capacity).length < capacity;
    const nextStart =
      this.pending.length && hasSpace
        ? Math.max(now, this.lastStart + AWARD_STAGGER)
        : Infinity;
    return {
      notices: [...this.active],
      slots,
      nextAt: Math.min(nextExpiry, nextStart),
    };
  }

  clear() {
    this.pending = [];
    this.active = [];
    this.lastStart = -Infinity;
  }
}
