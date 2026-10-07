import { randomInt, randomUUID } from "node:crypto";
import {
  CAPS,
  CRITERIA,
  SUGGESTIONS,
  type Claim,
  type Criterion,
  type GameEvent,
  type Opportunity,
  type Phase,
  type Player,
  type Segment,
  type Snapshot,
  type Turn,
} from "../shared/types.js";

export class RuleError extends Error {}
type StoredTurn = {
  turn: Turn;
  roundId: string;
  validUntil: number;
  segments: Map<string, Segment>;
};
export class Game {
  state: Snapshot;
  turns = new Map<string, StoredTurn>();
  seenScores = new Set<string>();
  ledgerVersion = 0;
  order: { playerId: string; kind: Opportunity }[] = [];
  now: () => number;
  onEvent: (event: GameEvent) => void;
  roundStartedAt = 0;
  recoverySpent = 0;
  recoveryStarted = 0;
  recoveryPrevious: Phase = "LOBBY";
  recoveryPhaseRemaining: number | undefined;
  recoverySealRemaining = 0;
  topicRejections = 0;
  sealAt = 0;
  endOfThoughtAt = 0;
  interventions = 0;
  lastInterventionAt = -Infinity;
  constructor(
    code: string,
    onEvent: (e: GameEvent) => void = () => {},
    now = Date.now,
  ) {
    this.now = now;
    this.onEvent = onEvent;
    this.state = {
      roomId: randomUUID(),
      code,
      seq: 0,
      phaseVersion: 0,
      phase: "LOBBY",
      serverNow: now(),
      players: [],
      matchId: null,
      headsId: null,
      tailsId: null,
      topic: null,
      phaseDeadline: null,
      round: 0,
      roundId: null,
      turn: null,
      turnIndex: 0,
      ledger: [],
      claims: [],
      results: [],
      captions: {},
      judge: null,
      mediaMode: "connecting",
      mediaEpoch: 1,
      comebackPlayerId: null,
      rematchReady: [],
      status: "The court is waiting for two questionable opinions.",
      judgePending: false,
      recoveryDeadline: null,
      degraded: { tts: false, stt: false },
      winnerId: null,
    };
  }
  snapshot(): Snapshot {
    this.state.serverNow = this.now();
    return structuredClone(this.state);
  }
  emit(type: string, payload: unknown = null) {
    this.state.seq++;
    this.state.serverNow = this.now();
    this.onEvent({
      roomId: this.state.roomId,
      matchId: this.state.matchId,
      seq: this.state.seq,
      serverNowMs: this.now(),
      phaseVersion: this.state.phaseVersion,
      type,
      payload,
      snapshot: this.snapshot(),
    });
  }
  setPhase(phase: Phase, timeout?: number) {
    this.state.phase = phase;
    this.state.phaseVersion++;
    this.state.phaseDeadline = timeout ? this.now() + timeout : null;
    this.emit("phase_changed");
  }
  player(id: string) {
    const p = this.state.players.find((p) => p.id === id);
    if (!p) throw new RuleError("This seat is no longer available.");
    return p;
  }
  other(id: string) {
    return this.state.players.find((p) => p.id !== id)!;
  }
  addPlayer(name: string) {
    if (this.state.players.length >= 2 || this.state.phase !== "LOBBY")
      throw new RuleError("This court already has two players.");
    const duplicate = this.state.players.some(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    const p: Player = {
      id: randomUUID(),
      name: duplicate ? `${name.slice(0, 16)} (2)` : name,
      connected: true,
      ready: false,
      mediaReady: false,
      captureReady: false,
      cameraOn: true,
      wins: 0,
      scoreUnits: 0,
    };
    this.state.players.push(p);
    this.emit("player_joined");
    return p;
  }
  ready(id: string, value: boolean) {
    if (!["LOBBY", "ABORTED"].includes(this.state.phase))
      throw new RuleError("Ready belongs in the lobby.");
    const p = this.player(id);
    if (value && !p.mediaReady)
      throw new RuleError(
        "Finish the microphone and peer connection check first.",
      );
    p.ready = value;
    this.emit("ready_changed");
    if (
      this.state.players.length === 2 &&
      this.state.players.every((p) => p.connected && p.ready && p.mediaReady)
    )
      this.startMatch();
  }
  startMatch() {
    this.state.degraded = { tts: false, stt: false };
    this.state.matchId = randomUUID();
    this.state.headsId = this.state.players[randomInt(2)].id;
    this.state.tailsId = this.other(this.state.headsId).id;
    this.state.players.forEach((p) => {
      p.wins = 0;
      p.scoreUnits = 0;
    });
    this.state.round = 0;
    this.state.roundId = null;
    this.state.topic = null;
    this.state.turn = null;
    this.state.ledger = [];
    this.state.claims = [];
    this.state.results = [];
    this.state.rematchReady = [];
    this.state.winnerId = null;
    this.state.judge = null;
    this.state.comebackPlayerId = null;
    this.turns.clear();
    this.seenScores.clear();
    this.ledgerVersion = 0;
    this.topicRejections = 0;
    this.state.status = "Heads opens. Tails picks the topic and their side.";
    this.setPhase("INTRO_COIN", 8000);
    this.emit("coin_committed");
  }
  selectTopic() {
    this.state.status = `${this.player(this.state.tailsId!).name}, pick your hill to die on.`;
    this.setPhase("TOPIC_SELECT", this.topicRejections ? 20000 : 45000);
  }
  proposeTopic(
    id: string,
    proposition: string,
    positive: string,
    negative: string,
    choosePositive: boolean,
  ) {
    if (
      !["TOPIC_SELECT", "TOPIC_CONFIRM"].includes(this.state.phase) ||
      id !== this.state.tailsId
    )
      throw new RuleError("Tails gets to choose this time.");
    this.state.topic = {
      proposition,
      positions: {
        [id]: choosePositive ? positive : negative,
        [this.other(id).id]: choosePositive ? negative : positive,
      },
      revision: (this.state.topic?.revision ?? 0) + 1,
      confirmations: [],
    };
    this.state.status = "Same topic. Opposite sides. Both of you sign off.";
    this.setPhase("TOPIC_CONFIRM", 20000);
  }
  confirm(id: string, revision: number) {
    if (
      this.state.phase !== "TOPIC_CONFIRM" ||
      this.state.topic?.revision !== revision
    )
      throw new RuleError("The topic changed. Read the new version first.");
    if (!this.state.topic.confirmations.includes(id))
      this.state.topic.confirmations.push(id);
    this.emit("topic_confirmed");
    if (this.state.topic.confirmations.length === 2) this.startRound();
  }
  reject(id: string, revision: number) {
    this.player(id);
    if (
      this.state.phase !== "TOPIC_CONFIRM" ||
      this.state.topic?.revision !== revision
    )
      throw new RuleError("That topic confirmation expired.");
    this.topicRejections++;
    if (this.topicRejections >= 2)
      this.lobby("No agreement, no argument. Pick again when you are ready.");
    else this.selectTopic();
  }
  lobby(status: string) {
    this.state.turn = null;
    this.state.judge = null;
    this.state.players.forEach((p) => (p.ready = false));
    this.state.status = status;
    this.setPhase("LOBBY");
  }
  startRound() {
    this.state.round++;
    this.state.roundId = randomUUID();
    this.state.turnIndex = 0;
    this.state.comebackPlayerId = null;
    this.state.players.forEach((p) => (p.scoreUnits = 0));
    this.roundStartedAt = this.now();
    this.recoverySpent = 0;
    this.interventions = 0;
    this.lastInterventionAt = -Infinity;
    const opener =
      this.state.round % 2 === 1 ? this.state.headsId! : this.state.tailsId!;
    const responder = this.other(opener).id;
    this.order = [
      { playerId: opener, kind: "case" },
      { playerId: responder, kind: "case" },
      { playerId: opener, kind: "rebuttal" },
      { playerId: responder, kind: "rebuttal" },
    ];
    this.setPhase("ROUND");
    this.openTurn();
  }
  openTurn() {
    if (this.state.turnIndex === 4 && this.order.length === 4) {
      const [a, b] = this.state.players;
      const trailing =
        a.scoreUnits === b.scoreUnits
          ? this.order[1].playerId
          : a.scoreUnits < b.scoreUnits
            ? a.id
            : b.id;
      this.order.push(
        { playerId: trailing, kind: "closing" },
        { playerId: this.other(trailing).id, kind: "closing" },
      );
      const deficit = Math.abs(a.scoreUnits - b.scoreUnits);
      if (deficit >= 16 && deficit < 40) {
        this.state.comebackPlayerId = trailing;
        this.emit("comeback_window", {
          playerId: trailing,
          deficitUnits: deficit,
        });
      }
    }
    if (this.state.turnIndex >= this.order.length) {
      this.resolveRound();
      return;
    }
    const entry = this.order[this.state.turnIndex],
      duration = entry.kind === "closing" ? 15000 : 30000;
    const t: Turn = {
      id: randomUUID(),
      playerId: entry.playerId,
      kind: entry.kind,
      durationMs: duration,
      remainingMs: duration,
      deadline: this.now() + duration,
      pausedReason: null,
      sealing: false,
      targets: { reasoning: 0, rebuttal: 0, impact: 0, wit: 0, clarity: 0 },
      overlapRefundMs: 0,
      suppressOpponent: false,
    };
    if (this.state.judge?.status === "speaking") {
      t.pausedReason = "judge";
      t.deadline = null;
    }
    this.state.turn = t;
    this.turns.set(t.id, {
      turn: t,
      roundId: this.state.roundId!,
      validUntil: Infinity,
      segments: new Map(),
    });
    this.endOfThoughtAt = 0;
    this.state.status =
      entry.kind === "case"
        ? "Make your case. Give us a reason."
        : entry.kind === "rebuttal"
          ? "Answer their argument. Make it hurt."
          : "One last point. Make it count.";
    this.emit("floor_granted", { turnId: t.id, playerId: t.playerId });
  }
  remaining(t = this.state.turn) {
    return t
      ? t.deadline === null
        ? t.remainingMs
        : Math.max(0, t.deadline - this.now())
      : 0;
  }
  pause(reason: string) {
    const t = this.state.turn;
    if (!t || t.sealing || t.pausedReason) return;
    t.remainingMs = this.remaining(t);
    t.deadline = null;
    t.pausedReason = reason;
    this.emit("clock_changed");
  }
  resume(reason?: string) {
    const t = this.state.turn;
    if (
      !t ||
      t.sealing ||
      !t.pausedReason ||
      (reason && t.pausedReason !== reason)
    )
      return;
    t.pausedReason = null;
    t.deadline = this.now() + t.remainingMs;
    this.emit("clock_changed");
  }
  endTurn(id: string, turnId: string, lastAudioSeq = -1) {
    const t = this.state.turn;
    if (
      this.state.phase !== "ROUND" ||
      !t ||
      t.playerId !== id ||
      t.id !== turnId ||
      t.sealing
    )
      throw new RuleError("That speaking opportunity is no longer yours.");
    t.remainingMs = this.remaining();
    t.deadline = null;
    t.pausedReason = "judging";
    t.sealing = true;
    t.settlement = "ready";
    this.sealAt = this.now() + 500;
    this.turns.get(t.id)!.validUntil = this.sealAt + 15000;
    this.emit("turn_sealed", { turnId: t.id, playerId: id, lastAudioSeq });
  }
  thought(id: string) {
    if (
      this.state.turn?.playerId === id &&
      !this.state.turn.sealing &&
      [...(this.turns.get(this.state.turn.id)?.segments.values() || [])].some(
        (s) =>
          s.text.trim().split(/\s+/).length >= 3 &&
          !/^(um|uh|hmm|okay|hello|hi|yeah|yes|no)[.,!?\s]*$/i.test(s.text),
      )
    )
      this.endOfThoughtAt = this.now();
  }
  speechStarted(id: string) {
    if (this.state.turn?.playerId === id) this.endOfThoughtAt = 0;
  }
  overlap(ms: number) {
    const t = this.state.turn;
    if (!t || t.sealing || t.pausedReason || this.state.phase !== "ROUND")
      return;
    const credit = Math.min(ms, 6000 - t.overlapRefundMs);
    if (credit <= 0) return;
    t.overlapRefundMs += credit;
    t.remainingMs += credit;
    if (t.deadline) t.deadline += credit;
    if (t.overlapRefundMs >= 6000) {
      t.suppressOpponent = true;
      this.emit("overlap_protected");
    }
  }
  registerSegment(segment: Segment) {
    if (!segment.turnId || !segment.eligible) return false;
    const record = this.turns.get(segment.turnId);
    if (
      !record ||
      record.turn.playerId !== segment.playerId ||
      record.roundId !== segment.roundId ||
      this.now() > record.validUntil ||
      (record.turn.sealing && record.turn.settlement !== "draining" && this.now() > this.sealAt) ||
      this.state.roundId !== segment.roundId
    )
      return false;
    record.segments.set(segment.id, segment);
    return true;
  }
  score(input: {
    playerId: string;
    roundId: string;
    turnId: string;
    segmentId: string;
    criterion: Criterion;
    quality: number;
    reason: string;
  }) {
    if (this.state.phase !== "ROUND") return false;
    const r = this.turns.get(input.turnId);
    if (
      !r ||
      input.roundId !== this.state.roundId ||
      r.roundId !== input.roundId ||
      r.turn.playerId !== input.playerId ||
      this.now() > r.validUntil ||
      !r.segments.has(input.segmentId) ||
      !["ROUND", "ROUND_RESOLVE"].includes(this.state.phase)
    )
      return false;
    if (
      !CRITERIA.includes(input.criterion) ||
      !Number.isInteger(input.quality) ||
      input.quality < 0 ||
      input.quality > 4
    )
      return false;
    const key = `${this.state.matchId}:${input.roundId}:${input.turnId}:${input.segmentId}:${input.criterion}`;
    if (this.seenScores.has(key)) return false;
    this.seenScores.add(key);
    const target = Math.round(
      (CAPS[r.turn.kind][input.criterion] * input.quality) / 4,
    );
    const deltaUnits = target - r.turn.targets[input.criterion];
    if (deltaUnits <= 0) return false;
    r.turn.targets[input.criterion] = target;
    this.player(input.playerId).scoreUnits += deltaUnits;
    const event = {
      ...input,
      id: randomUUID(),
      deltaUnits,
      reason: input.reason.slice(0, 100),
      at: this.now(),
    };
    this.state.ledger.push(event);
    this.ledgerVersion++;
    this.emit("score_committed", event);
    return true;
  }
  claim(claim: Claim) {
    const r = [...this.turns.values()].find((r) =>
      r.segments.has(claim.segmentId),
    );
    if (!r || r.turn.playerId !== claim.playerId) return;
    const existing = this.state.claims.find((c) => c.id === claim.id);
    if (existing && existing.playerId !== claim.playerId) return;
    if (
      claim.answersClaimId &&
      !this.state.claims.some(
        (c) => c.id === claim.answersClaimId && c.playerId !== claim.playerId,
      )
    )
      return;
    if (existing) Object.assign(existing, claim);
    else this.state.claims.push(claim);
    const own = this.state.claims.filter((c) => c.playerId === claim.playerId);
    if (own.length > 12)
      this.state.claims = this.state.claims.filter((c) => c.id !== own[0].id);
  }
  canIntervene() {
    return (
      this.state.phase === "ROUND" &&
      this.interventions < (this.state.turnIndex < 4 ? 2 : 3) &&
      this.now() - this.lastInterventionAt >= 15000
    );
  }
  markIntervention() {
    this.interventions++;
    this.lastInterventionAt = this.now();
  }
  resolveRound() {
    const [a, b] = this.state.players;
    let winner = a.scoreUnits > b.scoreUnits ? a : b,
      tieBreak: string | null = null;
    if (a.scoreUnits === b.scoreUnits) {
      let chosen: Player | undefined;
      for (const criterion of [
        "rebuttal",
        "reasoning",
        "impact",
        "wit",
        "clarity",
      ] as Criterion[]) {
        const total = (id: string) =>
          this.state.ledger
            .filter(
              (e) =>
                e.roundId === this.state.roundId &&
                e.playerId === id &&
                e.criterion === criterion,
            )
            .reduce((n, e) => n + e.deltaUnits, 0);
        if (total(a.id) !== total(b.id)) {
          chosen = total(a.id) > total(b.id) ? a : b;
          tieBreak = `Tie broken by ${criterion}`;
          break;
        }
      }
      if (!chosen) {
        chosen = this.state.players[randomInt(2)];
        tieBreak = "Exact dead heat · server coin toss";
      }
      winner = chosen;
    }
    const decisive = this.state.ledger
      .filter(
        (e) => e.roundId === this.state.roundId && e.playerId === winner.id,
      )
      .sort((a, b) => b.deltaUnits - a.deltaUnits)[0];
    const reason =
      tieBreak ?? decisive?.reason ?? "The committed score decides this round.";
    winner.wins++;
    this.state.results.push({
      round: this.state.round,
      roundId: this.state.roundId!,
      winnerId: winner.id,
      scores: { [a.id]: a.scoreUnits, [b.id]: b.scoreUnits },
      reason,
      tieBreak,
    });
    this.state.turn = null;
    this.state.status = `${winner.name} takes round ${this.state.round}. ${reason}`;
    this.setPhase("ROUND_RESOLVE", 12000);
    this.emit("round_result", this.state.results.at(-1));
  }
  finishMatch() {
    const winner = this.state.players.find((p) => p.wins >= 2)!;
    this.state.winnerId = winner.id;
    this.state.status = `${winner.name} wins. Case closed.`;
    this.setPhase("MATCH_RESULT");
    this.emit("match_result");
  }
  rematch(id: string, value: boolean) {
    if (!["MATCH_RESULT", "ABORTED"].includes(this.state.phase))
      throw new RuleError("Finish the match first.");
    this.state.rematchReady = this.state.rematchReady.filter((p) => p !== id);
    if (value) this.state.rematchReady.push(id);
    this.emit("rematch_changed");
    if (
      this.state.rematchReady.length === 2 &&
      this.state.players.every((p) => p.connected)
    )
      this.startMatch();
  }
  recover(status: string) {
    if (
      ![
        "ROUND",
        "INTRO_COIN",
        "TOPIC_SELECT",
        "TOPIC_CONFIRM",
        "ROUND_RESOLVE",
      ].includes(this.state.phase)
    )
      return;
    this.recoveryPrevious = this.state.phase;
    this.recoveryPhaseRemaining = this.state.phaseDeadline
      ? Math.max(1, this.state.phaseDeadline - this.now())
      : undefined;
    this.recoverySealRemaining = this.state.turn?.sealing
      ? Math.max(1, this.sealAt - this.now())
      : 0;
    if (this.state.turn && !this.state.turn.sealing) {
      const t = this.state.turn;
      t.remainingMs = this.remaining(t);
      t.deadline = null;
      t.pausedReason = "connection";
    }
    this.recoveryStarted = this.now();
    this.state.recoveryDeadline =
      this.now() + Math.max(0, 60000 - this.recoverySpent);
    this.state.status = status;
    this.setPhase("RECOVERING");
  }
  resumeRecovery() {
    if (this.state.phase !== "RECOVERING") return;
    const elapsed = this.now() - this.recoveryStarted;
    this.recoverySpent += elapsed;
    this.roundStartedAt += elapsed;
    this.state.recoveryDeadline = null;
    this.setPhase(this.recoveryPrevious, this.recoveryPhaseRemaining);
    if (this.recoverySealRemaining && this.state.turn) {
      this.sealAt = this.now() + this.recoverySealRemaining;
      this.turns.get(this.state.turn.id)!.validUntil = this.sealAt + 15000;
    }
    this.resume("connection");
    this.state.status = "Back in court. Same score. Same argument.";
    this.emit("reconnected");
  }
  abort(status: string) {
    this.state.turn = null;
    this.state.judge = null;
    this.state.winnerId = null;
    this.state.status = status;
    this.state.players.forEach((p) => (p.ready = false));
    this.setPhase("ABORTED");
  }
  tick() {
    const now = this.now(),
      s = this.state;
    if (s.phase === "RECOVERING") {
      if (now >= (s.recoveryDeadline ?? Infinity))
        this.abort(
          "Connection recovery expired. No judged winner was awarded.",
        );
      return;
    }
    if (s.phase === "ROUND") {
      if (now - this.roundStartedAt > 240000) {
        this.abort(
          "The round could not finish safely. No winner was invented.",
        );
        return;
      }
      const t = s.turn;
      if (t?.sealing && now >= this.sealAt + 15000 && (t.settlement === "draining" || s.judgePending)) {
        this.abort("Argument processing timed out. No unjudged evidence was skipped; try a fresh match.");
        return;
      }
      if (
        t?.sealing &&
        now >= this.sealAt &&
        t.settlement !== "draining" &&
        !s.judgePending
      ) {
        this.turns.get(t.id)!.validUntil = now - 1;
        s.turnIndex++;
        this.openTurn();
      } else if (t && !t.pausedReason) {
        const active = t.durationMs + t.overlapRefundMs - this.remaining(t);
        if (
          this.remaining(t) <= 0 ||
          (this.endOfThoughtAt &&
            now - this.endOfThoughtAt >= 800 &&
            active >= (t.kind === "closing" ? 4000 : 8000))
        )
          this.endTurn(t.playerId, t.id);
      }
    }
    if (!s.phaseDeadline || now < s.phaseDeadline) return;
    if (s.phase === "INTRO_COIN") this.selectTopic();
    else if (s.phase === "TOPIC_SELECT") {
      const t = SUGGESTIONS[0];
      this.proposeTopic(
        s.tailsId!,
        t.proposition,
        t.positive,
        t.negative,
        true,
      );
    } else if (s.phase === "TOPIC_CONFIRM")
      this.lobby("Topic confirmation timed out. Both players must agree.");
    else if (s.phase === "ROUND_RESOLVE") {
      if (s.judge && s.judge.status !== "silent") return;
      if (s.players.some((p) => p.wins >= 2)) this.finishMatch();
      else this.startRound();
    }
  }
}
