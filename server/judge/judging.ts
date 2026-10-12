import { createHash, randomUUID } from "node:crypto";
import { canSpeak, type Segment } from "../../shared/types.js";
import { type Proposal } from "../providers/index.js";
import type { RoomController } from "../rooms/room.js";
import { safeReaction, voiceSettingsKey } from "./personality.js";
import { PreparedVoice } from "./voice-cache.js";
export class Judging {
  constructor(readonly room: RoomController) {}
  recent: Segment[] = [];
  queue: Segment[] = [];
  busy = false;
  judgeRequest: AbortController | null = null;
  reactions = new Map<
    string,
    { segmentId: string; text: string; revision: number }
  >();
  argumentRevision = new Map<string, number>();
  candidate: {
    key: string;
    text: string;
    turnId: string;
    matchId: string | null;
    roundId: string | null;
    revision: number;
    playerId: string;
    kind: string;
    voice: PreparedVoice;
  } | null = null;
  planned = new Map<
    string,
    NonNullable<Proposal["intervention"]> & {
      roundId: string;
      sourceTurnId: string;
    }
  >();
  cancelJudgment(preserve = false) {
    this.judgeRequest?.abort();
    this.judgeRequest = null;
    if (preserve) this.queue.unshift(...this.activeBatch);
    else this.queue = [];
    this.activeBatch = [];
    this.busy = false;
    this.room.game.setJudgePending(!!this.queue.length);
  }
  activeBatch: Segment[] = [];
  onSegment(segment: Segment) {
    if (!this.room.game.registerSegment(segment)) return;
    this.recent.push(segment);
    if (this.recent.length > 12) this.recent.shift();
    this.argumentRevision.set(
      segment.turnId!,
      (this.argumentRevision.get(segment.turnId!) || 0) + 1,
    );
    this.invalidateCandidate();
    this.queue.push(segment);
    if (this.queue.length > 8) {
      this.room.game.abort(
        "Argument processing backlog exceeded its limit. No evidence was silently discarded.",
      );
      return;
    }
    void this.drain();
  }
  async drain() {
    if (
      this.busy ||
      !this.queue.length ||
      this.room.closed ||
      this.room.game.state.phase === "RECOVERING"
    )
      return;
    const request = (this.judgeRequest = new AbortController());
    const matchId = this.room.game.state.matchId;
    const roundId = this.room.game.state.roundId;
    const current = () =>
      !this.room.closed &&
      !request.signal.aborted &&
      this.judgeRequest === request &&
      this.room.game.state.matchId === matchId &&
      this.room.game.state.roundId === roundId;
    this.busy = true;
    this.room.game.setJudgePending(true);
    this.room.game.emit("judge_thinking");
    const first = this.queue[0],
      batch = this.queue.filter((s) => s.turnId === first.turnId).slice(0, 4);
    this.queue = this.queue.filter((s) => !batch.includes(s));
    this.activeBatch = batch;
    const record = first.turnId ? this.room.game.turns.get(first.turnId) : null;
    const jobId = randomUUID(),
      claimIds: string[] = [randomUUID(), randomUUID()];
    let version = this.room.game.ledgerVersion;
    const revision = this.argumentRevision.get(first.turnId!) || 0;
    try {
      if (!record || this.room.services.now() > record.validUntil) return;
      let proposal: Proposal | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          proposal = await this.room.services.judge(
            this.room.game.snapshot(),
            batch,
            record.turn.kind,
            record.turn.targets,
            this.recent,
            this.room.game.state.claims,
            jobId,
            claimIds,
            (score) => {
              if (
                !current() ||
                this.room.game.ledgerVersion !== version ||
                first.roundId !== this.room.game.state.roundId ||
                this.room.game.snapshot().phase === "RECOVERING"
              )
                return;
              if (
                score.playerId === first.playerId &&
                score.turnId === first.turnId &&
                batch.some((s) => s.id === score.segmentId)
              ) {
                if (this.room.game.score(score))
                  this.room.recordMetric(
                    "scoringMs",
                    this.room.services.now() - first.stableAt,
                  );
                version = this.room.game.ledgerVersion;
              }
            },
            [...this.reactions.values()]
              .map((reaction) => reaction.text)
              .slice(-6),
            request.signal,
          );
          break;
        } catch (e) {
          if (!current()) return;
          if (attempt) throw e;
        }
      }
      if (!current()) return;
      if (this.room.game.snapshot().phase === "RECOVERING") {
        this.queue.unshift(...batch);
        return;
      }
      if (
        !proposal ||
        proposal.jobId !== jobId ||
        this.room.game.ledgerVersion !== version ||
        this.room.services.now() > record.validUntil ||
        first.roundId !== this.room.game.state.roundId
      )
        return;
      for (const score of proposal.scores)
        if (
          score.playerId === first.playerId &&
          score.turnId === first.turnId &&
          batch.some((s) => s.id === score.segmentId)
        )
          this.room.game.score(score);
      for (const a of proposal.arguments)
        if (
          (claimIds.includes(a.claimId) ||
            this.room.game.state.claims.some((c) => c.id === a.claimId)) &&
          a.playerId === first.playerId &&
          batch.some((s) => s.id === a.segmentId)
        )
          this.room.game.claim({
            id: a.claimId,
            playerId: a.playerId,
            segmentId: a.segmentId,
            summary: a.summary,
            answersClaimId: a.answersClaimId,
          });
      this.acceptReaction(first.turnId!, batch, proposal.reaction, revision);
      const i = proposal.intervention;
      if (
        i &&
        i.targetPlayerId === this.room.game.other(first.playerId).id &&
        i.text.split(/\s+/).length <= 14 &&
        (!i.claimId ||
          this.room.game.state.claims.some((c) => c.id === i.claimId))
      ) {
        this.planned.set(i.targetPlayerId, {
          ...i,
          roundId: first.roundId,
          sourceTurnId: first.turnId!,
        });
      }
    } catch {
      if (!current()) return;
      this.room.recordFailure("judgment");
      this.room.game.abort(
        "The judge could not score reliably. No winner was invented. Try a new match.",
      );
    } finally {
      if (!current()) return;
      this.judgeRequest = null;
      this.activeBatch = [];
      this.busy = false;
      this.room.game.setJudgePending(false);
      if (
        this.room.game.state.turn?.sealing &&
        this.room.game.state.turn.settlement === "scoring" &&
        !this.queue.length
      )
        this.room.game.setSettlement("ready");
      this.room.game.emit("judge_idle");
      if (this.queue.length) void this.drain();
      else this.prepareHandoff();
    }
  }
  typed(id: string, turnId: string, text: string) {
    if (
      !canSpeak(this.room.game.state, id) ||
      !this.room.game.state.degraded.stt ||
      this.room.game.state.turn?.id !== turnId ||
      this.room.game.state.turn.playerId !== id ||
      this.room.game.state.turn.sealing
    )
      throw new Error("Typed recovery is not available for this opportunity.");
    const s: Segment = {
      id: createHash("sha256")
        .update(`${turnId}:${text}`)
        .digest("hex")
        .slice(0, 24),
      playerId: id,
      roundId: this.room.game.state.roundId!,
      turnId,
      sessionEpoch: "typed",
      text,
      stableAt: this.room.services.now(),
      eligible: true,
      source: "typed",
    };
    this.room.game.caption(id, text, true);
    this.room.game.emit("transcript");
    this.onSegment(s);
  }
  acceptReaction(
    turnId: string,
    batch: Segment[],
    reaction: Proposal["reaction"],
    revision: number,
  ) {
    if (
      !reaction ||
      revision !== this.argumentRevision.get(turnId) ||
      this.room.game.state.phase !== "ROUND"
    )
      return false;
    const record = this.room.game.turns.get(turnId);
    const evidence = batch.find((segment) => segment.id === reaction.segmentId);
    const text = safeReaction(reaction.text);
    if (
      !text ||
      !record ||
      record.roundId !== this.room.game.state.roundId ||
      !evidence ||
      !evidence.eligible ||
      evidence.playerId !== record.turn.playerId ||
      evidence.turnId !== turnId ||
      !record.segments.has(evidence.id) ||
      evidence.text.trim().split(/\s+/).length < 3
    )
      return false;
    if (
      [...this.reactions.entries()].some(
        ([id, reaction]) => id !== turnId && reaction.text === text,
      )
    )
      return false;
    this.reactions.set(turnId, { segmentId: evidence.id, text, revision });
    return true;
  }
  invalidateCandidate() {
    this.candidate?.voice.cancel();
    this.candidate = null;
  }
  latestReaction(turnId = this.room.playback.lastSealedTurnId) {
    if (!turnId) return null;
    const reaction = this.reactions.get(turnId);
    return reaction && reaction.revision === this.argumentRevision.get(turnId)
      ? reaction.text
      : null;
  }
  handoff(playerId: string, kind: string, previousTurnId: string | null) {
    const player = this.room.game.player(playerId);
    const planned = this.planned.get(playerId);
    const answered =
      planned?.claimId &&
      this.room.game.state.claims.some(
        (c) => c.playerId === playerId && c.answersClaimId === planned.claimId,
      );
    if (
      planned &&
      planned.roundId === this.room.game.state.roundId &&
      !answered &&
      this.room.game.canIntervene()
    )
      return { text: planned.text, intervention: true };
    if (
      kind === "closing" &&
      this.room.game.state.comebackPlayerId === playerId &&
      this.room.game.canIntervene()
    ) {
      const claim = [...this.room.game.state.claims]
        .reverse()
        .find((c) => c.playerId === this.room.game.other(playerId).id);
      const detail =
        claim?.summary
          .replace(/[.!?]/g, "")
          .split(/\s+/)
          .slice(0, 7)
          .join(" ") || "their strongest argument";
      return {
        text: `${player.name}, counter this: ${detail}. Your closing matters.`,
        intervention: true,
      };
    }
    const sameRound =
      previousTurnId &&
      this.room.game.turns.get(previousTurnId)?.roundId ===
        this.room.game.state.roundId;
    const reaction = sameRound ? this.latestReaction(previousTurnId) : null;
    return {
      text: reaction
        ? `${reaction} ${player.name}, your turn.`
        : `${sameRound ? "Case presented. " : ""}${player.name}, ${kind === "case" ? "make your case" : kind === "rebuttal" ? "your rebuttal" : "your closing argument"}.`,
      intervention: false,
    };
  }
  prepareHandoff() {
    const turn = this.room.game.state.turn;
    if (
      !turn ||
      this.room.game.state.phase !== "ROUND" ||
      this.busy ||
      this.queue.length
    )
      return;
    let next = this.room.game.order[this.room.game.state.turnIndex + 1];
    if (!next && this.room.game.state.turnIndex === 3) {
      const [a, b] = this.room.game.state.players;
      const trailing =
        a.scoreUnits < b.scoreUnits
          ? a
          : b.scoreUnits < a.scoreUnits
            ? b
            : this.room.game.other(this.room.game.order[0].playerId);
      next = { playerId: trailing.id, kind: "closing" };
    }
    if (!next) return;
    const handoff = this.handoff(next.playerId, next.kind, turn.id);
    const text = handoff.text.split(/\s+/).slice(0, 14).join(" ");
    const key = `${this.room.game.state.matchId}:${this.room.game.state.roundId}:${turn.id}:${this.argumentRevision.get(turn.id) || 0}:${next.playerId}:${next.kind}:${text}:${voiceSettingsKey()}`;
    if (this.candidate?.key === key) return;
    this.invalidateCandidate();
    this.candidate = {
      key,
      text,
      turnId: turn.id,
      matchId: this.room.game.state.matchId,
      roundId: this.room.game.state.roundId,
      revision: this.argumentRevision.get(turn.id) || 0,
      playerId: next.playerId,
      kind: next.kind,
      voice: this.room.services.prepareVoice(text),
    };
  }
}
