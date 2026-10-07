import { HostPhrases, safeReaction, voiceSettingsKey } from "./host.js";
import { PreparedVoice, fixedVoice, warmHostVoice } from "./voice-cache.js";
import { randomUUID, createHash } from "node:crypto";
import { WebSocket } from "ws";
import { Game } from "./game.js";
import {
  InkSession,
  judge,
  streamVoice,
  shortSentence,
  type Proposal,
} from "./providers.js";
import { canSpeak, type GameEvent, type Segment } from "../shared/types.js";
export type Seat = {
  tokenHash: string;
  epoch: number;
  sockets: Map<string, WebSocket>;
  audioSeq: number;
  lastAudioAt: number;
  voiceAt: number;
  lastActivity: number;
  rtcReady: boolean;
  acks: Map<string, unknown>;
};
export class Controller {
  game: Game;
  seats = new Map<string, Seat>();
  ink = new Map<string, InkSession>();
  recent: Segment[] = [];
  queue: Segment[] = [];
  busy = false;
  closed = false;
  createdAt = Date.now();
  lastActiveAt = Date.now();
  speechEpoch = 0;
  speech: {
    id: string;
    epoch: number;
    ready: Set<string>;
    duration: number;
    startedAt: number | null;
    done: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    maxSeconds: number;
    turnId: string | null;
    matchId: string | null;
  } | null = null;
  pendingHandoff: { matchId: string | null; roundId: string | null; turnId: string; playerId: string; text: string; intervention: boolean } | null = null;
  host = new HostPhrases();
  hostCues: {text: string; target: string | null; phaseVersion: number; phase: string; source?: PreparedVoice}[] = [];
  topicNudge: ReturnType<typeof setTimeout> | null = null;
  topicNudged = false;
  reactions = new Map<string, {segmentId: string; text: string; revision: number}>();
  argumentRevision = new Map<string, number>();
  lastSealedTurnId: string | null = null;
  candidate: {key: string; text: string; turnId: string; matchId: string | null; roundId: string | null; revision: number; playerId: string; kind: string; voice: PreparedVoice} | null = null;
  speechCues = new Map<number, {at:number;prepared:boolean}>();
  turnDoneAt = new Map<string, number>();
  metricsCue: {text: string; cueAt: number; startedAt: number; latencyMs: number; prepared: boolean}[] = [];
  sealedAudio = new Map<string, { turnId: string; maxSeq: number; capturedBefore: number; expiresAt: number }>();
  planned = new Map<string, NonNullable<Proposal["intervention"]> & {roundId:string;sourceTurnId:string}>();
  rtcTimer: ReturnType<typeof setTimeout> | null = null;
  retries = new Map<string, number>();
  metrics: {
    scoringMs: number[];
    speechGenerationMs: number[];
    playbackMs: number[];
  } = { scoringMs: [], speechGenerationMs: [], playbackMs: [] };
  constructor(code: string) {
    this.game = new Game(code, (e) => this.onEvent(e));
  }
  send(playerId: string, message: unknown) {
    const ws = this.seats.get(playerId)?.sockets.get("control");
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }
  broadcast(message: unknown) {
    for (const id of this.seats.keys()) this.send(id, message);
  }
  onEvent(event: GameEvent) {
    // Publish a paused floor atomically, before either client can open its mic.
    if (event.type === "floor_granted" && this.game.state.turn) {
      const turn = this.game.state.turn;
      turn.remainingMs = this.game.remaining(turn);
      turn.deadline = null;
      turn.pausedReason = "judge";
      event.snapshot = this.game.snapshot();
    }
    if (event.type === "turn_sealed" && this.game.state.turn) {
      this.game.state.turn.settlement = "draining";
      event.snapshot = this.game.snapshot();
    }
    if (event.type === "player_joined") warmHostVoice();
    if (event.type === "phase_changed") {
      this.hostCues = [];
      if (this.topicNudge) clearTimeout(this.topicNudge);
      this.topicNudge = null;
      if (this.game.state.phase !== "ROUND" || !this.game.state.turn) this.pendingHandoff = null;
      if (["LOBBY", "RECOVERING", "ABORTED"].includes(this.game.state.phase)) this.invalidateCandidate();
    }
    this.broadcast(event);
    if (event.type === "phase_changed" && ["TOPIC_CONFIRM", "ROUND", "LOBBY", "RECOVERING", "ABORTED"].includes(this.game.state.phase)) this.cancelSpeech();
    if (
      event.type === "phase_changed" &&
      ["LOBBY", "MATCH_RESULT", "ABORTED"].includes(event.snapshot.phase)
    ) {
      for (const stream of this.ink.values()) stream.close();
      this.ink.clear();
    }
    if (event.type === "coin_committed") {
      this.cancelSpeech();
      this.queue = [];
      this.sealedAudio.clear();
      this.planned.clear();
      this.retries.clear();
      for (const p of this.game.state.players) this.rotate(p.id, null);
      this.host.reset();
      this.reactions.clear(); this.argumentRevision.clear(); this.lastSealedTurnId = null; this.turnDoneAt.clear();
      this.invalidateCandidate();
      const reveal = `${this.game.player(this.game.state.headsId!).name} opens. ${this.game.player(this.game.state.tailsId!).name} picks the battlefield.`;
      const phaseVersion = this.game.state.phaseVersion;
      this.hostCues = [
        {text:this.host.pick("welcome"),target:null,phase:"INTRO_COIN",phaseVersion},
        {text:this.host.pick("coin"),target:null,phase:"INTRO_COIN",phaseVersion},
        {text:reveal,target:null,phase:"INTRO_COIN",phaseVersion,source:new PreparedVoice(reveal, 3)},
      ];
      this.startHostCue();
    }
    if (event.type === "phase_changed" && this.game.state.phase === "TOPIC_SELECT") {
      this.cancelSpeech();
      const phaseVersion = this.game.state.phaseVersion;
      this.hostCues = [{text:this.host.pick("topic"),target:this.game.state.tailsId,phase:"TOPIC_SELECT",phaseVersion}];
      this.startHostCue();
      this.topicNudged = false;
      this.topicNudge = setTimeout(() => this.nudgeTopic(phaseVersion), 12000);
    }
    if (event.type === "floor_granted") {
      const t = this.game.state.turn!;
      this.rotate(t.playerId, t.id);
      const {text, intervention} = this.handoff(t.playerId, t.kind, this.lastSealedTurnId);
      if (intervention) this.planned.delete(t.playerId);
      this.pendingHandoff = {matchId: this.game.state.matchId, roundId: this.game.state.roundId, turnId: t.id, playerId: t.playerId, text, intervention};
      this.startHandoff();
    }
    if (event.type === "turn_sealed") {
      const { playerId, lastAudioSeq } = event.payload as {
        playerId: string;
        lastAudioSeq: number;
      };
      const turnId = this.game.state.turn!.id;
      this.lastSealedTurnId = turnId;
      this.turnDoneAt.set(turnId, Date.now());
      this.sealedAudio.set(playerId, {turnId, maxSeq: lastAudioSeq >= 0 ? lastAudioSeq : Infinity, capturedBefore: event.serverNowMs, expiresAt: Date.now() + 500});
      const rotate = async () => {
        if (this.game.state.turn?.id !== turnId || !this.game.state.turn.sealing) return;
        this.sealedAudio.delete(playerId);
        const stream = this.ink.get(playerId);
        this.ink.delete(playerId);
        const drained = !stream || await stream.close();
        if (this.game.state.turn?.id !== turnId) return;
        if (!drained && !this.game.state.degraded.stt) {
          this.game.abort("Transcription could not finish safely. No unjudged evidence was skipped. Try a fresh match.");
          return;
        }
        this.game.state.turn.settlement = this.busy || this.queue.length ? "scoring" : "ready";
        this.game.emit("turn_settlement");
        this.prepareHandoff();
      };
      // Drain frames captured before the handoff; they retain the old STT epoch.
      setTimeout(rotate, 500);
    }
    if (event.type === "reconnected") {
      const t = this.game.state.turn;
      if (t && !t.sealing) this.rotate(t.playerId, t.id);
      void this.drain();
    }
    if (event.type === "round_result") {
      this.pendingHandoff = null; this.hostCues = [];
      this.cancelSpeech();
      const r = this.game.state.results.at(-1)!;
      void this.say(
        `${this.latestReaction() || ""} ${this.game.player(r.winnerId).name} takes it. ${r.reason}${this.game.player(r.winnerId).wins < 2 ? " " + this.host.pick("round") : ""}`,
        r.winnerId,
        false,
        8,
      ).catch(() => {});
    }
    if (event.type === "match_result") {
      this.pendingHandoff = null; this.hostCues = [];
      this.cancelSpeech();
      void this.say(
        `${this.game.player(this.game.state.winnerId!).name} wins the match. ${this.game.state.results.at(-1)?.reason || ""} Case closed.`,
        this.game.state.winnerId,
        false,
        6,
      ).catch(() => {});
    }
    if (
      event.snapshot.phase === "ABORTED" ||
      event.snapshot.phase === "RECOVERING"
    )
      this.cancelSpeech();
  }
  rotate(id: string, turnId: string | null) {
    if (
      this.closed ||
      ["LOBBY", "MATCH_RESULT", "ABORTED"].includes(this.game.state.phase) ||
      !process.env.CARTESIA_API_KEY ||
      !this.seats.get(id)?.sockets.has("audio") ||
      this.game.state.degraded.stt
    )
      return;
    const old = this.ink.get(id);
    if (old && !old.closing && !old.failed && old.turnId === turnId && old.roundId === (this.game.state.roundId || "")) return;
    const stream = new InkSession(id, this.game.state.roundId || "", turnId, {
      caption: (text, final) => {
        // A draining old session must never overwrite the new epoch's captions.
        if (this.ink.get(id) !== stream && !(turnId && this.game.state.turn?.id === turnId && this.game.state.turn.sealing && this.game.state.turn.settlement === "draining")) return;
        this.game.state.captions[id] = { text, final, at: Date.now() };
        this.game.emit("transcript", { playerId: id, text, final, turnId });
      },
      segment: (segment) => this.onSegment(segment),
      start: () => {
        if (this.ink.get(id) === stream) {
          this.game.speechStarted(id);

        }
      },
      end: () => {
        if (this.ink.get(id) === stream && turnId) this.game.thought(id);
      },
      error: () => {
        if (this.ink.get(id) === stream) this.sttFailure(id, turnId);
      },
    });
    this.ink.set(id, stream);
    old?.close();
  }
  sttFailure(id: string, turnId: string | null) {
    const key = `${id}:${turnId || "off"}`,
      count = this.retries.get(key) ?? 0;
    this.retries.set(key, count + 1);
    if (!count) {
      this.game.pause("transcription");
      setTimeout(() => {
        this.rotate(id, turnId);
        this.game.resume("transcription");
      }, 700);
    } else {
      this.game.state.degraded.stt = true;
      for (const stream of this.ink.values()) stream.close();
      this.ink.clear();
      this.game.resume("transcription");
      this.game.state.status =
        "Transcription unavailable. Both players can type arguments; live audio stays on.";
      this.game.emit("recovery");
    }
  }
  onSegment(segment: Segment) {
    this.recent.push(segment);
    if (this.recent.length > 12) this.recent.shift();
    if (!this.game.registerSegment(segment)) return;
    this.argumentRevision.set(segment.turnId!, (this.argumentRevision.get(segment.turnId!) || 0) + 1);
    this.invalidateCandidate();
    this.queue.push(segment);
    if (this.queue.length > 8) { this.game.abort("Argument processing backlog exceeded its limit. No evidence was silently discarded."); return; }
    void this.drain();
  }
  async drain() {
    if (
      this.busy ||
      !this.queue.length ||
      this.closed ||
      this.game.state.phase === "RECOVERING"
    )
      return;
    this.busy = true;
    this.game.state.judgePending = true;
    this.game.emit("judge_thinking");
    const first = this.queue[0],
      batch = this.queue.filter((s) => s.turnId === first.turnId).slice(0, 4);
    this.queue = this.queue.filter((s) => !batch.includes(s));
    const record = first.turnId ? this.game.turns.get(first.turnId) : null;
    const jobId = randomUUID(),
      claimIds: string[] = [randomUUID(), randomUUID()];
    let version = this.game.ledgerVersion;
    const revision = this.argumentRevision.get(first.turnId!) || 0;
    try {
      if (!record || Date.now() > record.validUntil) return;
      let proposal: Proposal | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          proposal = await judge(
            this.game.snapshot(),
            batch,
            record.turn.kind,
            record.turn.targets,
            this.recent,
            this.game.state.claims,
            jobId,
            claimIds,
            (score) => {
              if (
                this.game.ledgerVersion !== version ||
                first.roundId !== this.game.state.roundId ||
                this.game.snapshot().phase === "RECOVERING"
              )
                return;
              if (
                score.playerId === first.playerId &&
                score.turnId === first.turnId &&
                batch.some((s) => s.id === score.segmentId)
              ) {
                if (this.game.score(score))
                  this.metrics.scoringMs.push(Date.now() - first.stableAt);
                version = this.game.ledgerVersion;
              }
            },
            [...this.reactions.values()].map(reaction => reaction.text).slice(-6),
          );
          break;
        } catch (e) {
          if (attempt) throw e;
        }
      }
      if (this.game.snapshot().phase === "RECOVERING") {
        this.queue.unshift(...batch);
        return;
      }
      if (
        !proposal ||
        proposal.jobId !== jobId ||
        this.game.ledgerVersion !== version ||
        Date.now() > record.validUntil ||
        first.roundId !== this.game.state.roundId
      )
        return;
      for (const score of proposal.scores)
        if (
          score.playerId === first.playerId &&
          score.turnId === first.turnId &&
          batch.some((s) => s.id === score.segmentId)
        )
          this.game.score(score);
      for (const a of proposal.arguments)
        if (
          (claimIds.includes(a.claimId) ||
            this.game.state.claims.some((c) => c.id === a.claimId)) &&
          a.playerId === first.playerId &&
          batch.some((s) => s.id === a.segmentId)
        )
          this.game.claim({
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
        i.targetPlayerId === this.game.other(first.playerId).id &&
        i.text.split(/\s+/).length <= 14 &&
        (!i.claimId || this.game.state.claims.some((c) => c.id === i.claimId))
      ) {
        this.planned.set(i.targetPlayerId, {...i,roundId:first.roundId,sourceTurnId:first.turnId!});

      }
    } catch {
      this.game.abort(
        "The judge could not score reliably. No winner was invented. Try a new match.",
      );
    } finally {
      this.busy = false;
      this.game.state.judgePending = false;
      if (this.game.state.turn?.sealing && this.game.state.turn.settlement === "scoring" && !this.queue.length) this.game.state.turn.settlement = "ready";
      this.game.emit("judge_idle");
      if (this.queue.length) void this.drain();
      else this.prepareHandoff();
    }
  }
  typed(id: string, turnId: string, text: string) {
    if (
      !canSpeak(this.game.state, id) ||
      !this.game.state.degraded.stt ||
      this.game.state.turn?.id !== turnId ||
      this.game.state.turn.playerId !== id ||
      this.game.state.turn.sealing
    )
      throw new Error("Typed recovery is not available for this opportunity.");
    const s: Segment = {
      id: createHash("sha256")
        .update(`${turnId}:${text}`)
        .digest("hex")
        .slice(0, 24),
      playerId: id,
      roundId: this.game.state.roundId!,
      turnId,
      sessionEpoch: "typed",
      text,
      stableAt: Date.now(),
      eligible: true,
      source: "typed",
    };
    this.game.state.captions[id] = { text, final: true, at: Date.now() };
    this.game.emit("transcript");
    this.onSegment(s);
  }
  audio(id: string, raw: Buffer) {
    if (
      raw.length < 17 ||
      raw[0] !== 1 ||
      raw.length > 4096 ||
      raw.readUInt32LE(9) !== 16000 ||
      raw.readUInt32LE(1) !== this.game.state.mediaEpoch ||
      (raw.length - 17) % 2 !== 0
    )
      return;
    const headerBytes = raw.length - raw.readUInt32LE(13) * 2;
    if (headerBytes !== 17 && headerBytes !== 25) return;
    const seat = this.seats.get(id)!;
    const seq = raw.readUInt32LE(5);
    if (seq <= seat.audioSeq) return;
    seat.audioSeq = seq;
    seat.lastAudioAt = Date.now();
    const allowed = canSpeak(this.game.state, id);
    const boundary = this.sealedAudio.get(id);
    const draining = !!boundary && this.game.state.phase === "ROUND" && this.game.state.turn?.id === boundary.turnId && this.game.state.turn.sealing && Date.now() <= boundary.expiresAt && seq <= boundary.maxSeq && headerBytes === 25 && raw.readDoubleLE(17) <= boundary.capturedBefore;
    const pcm = allowed || draining ? raw.subarray(headerBytes) : Buffer.alloc(raw.length - headerBytes);
    this.ink.get(id)?.send(pcm);
    if (!allowed) { seat.voiceAt = 0; return; }
    let rms = 0;
    for (let i = 0; i < pcm.length; i += 16)
      rms += (pcm.readInt16LE(i) / 32768) ** 2;
    rms = Math.sqrt(rms / Math.max(1, pcm.length / 16));
    if (rms > 0.018) seat.voiceAt = Date.now();
    if (
      this.game.state.mediaMode !== "rtc" &&
      (headerBytes === 17 || Date.now() - raw.readDoubleLE(17) < 250)
    )
      this.forward(id, "audio", raw);
    if (Date.now() - seat.lastActivity > 250) {
      seat.lastActivity = Date.now();
      this.broadcast({
        type: "activity",
        playerId: id,
        level: Math.min(1, rms * 8),
      });
    }
  }
  forward(id: string, channel: string, raw: Buffer) {
    for (const [otherId, seat] of this.seats) {
      const ws = seat.sockets.get(channel);
      if (
        otherId !== id &&
        ws?.readyState === WebSocket.OPEN &&
        ws.bufferedAmount < (channel === "video" ? 12000 : 8000)
      )
        ws.send(raw);
    }
  }
  mediaStatus(id: string, ready: boolean, cameraOn: boolean, rtc: boolean) {
    const seat = this.seats.get(id)!,
      player = this.game.player(id);
    seat.rtcReady = rtc;
    player.cameraOn = cameraOn;
    player.captureReady =
      ready &&
      !!seat.sockets.get("audio") &&
      Date.now() - seat.lastAudioAt < 2000;
    if (
      this.game.state.mediaMode === "connecting" &&
      this.game.state.players.length === 2 &&
      this.game.state.players.every((p) => p.captureReady)
    ) {
      if (
        this.game.state.players.every((p) => this.seats.get(p.id)?.rtcReady) &&
        process.env.FORCE_WSS !== "true"
      )
        this.setMedia("rtc");
      else if (!this.rtcTimer)
        this.rtcTimer = setTimeout(
          () => this.setMedia("wss"),
          process.env.FORCE_WSS === "true" ? 100 : 8000,
        );
    }
    player.mediaReady =
      ready &&
      !!seat.sockets.get("audio") &&
      Date.now() - seat.lastAudioAt < 2000 &&
      this.game.state.mediaMode !== "connecting";
    this.game.emit("media_status");
    if (
      this.game.state.phase === "RECOVERING" &&
      this.game.state.players.every((p) => p.connected && p.mediaReady)
    )
      this.game.resumeRecovery();
  }
  setMedia(mode: "rtc" | "wss") {
    if (this.game.state.mediaMode === mode) return;
    this.game.state.mediaMode = mode;
    if (this.rtcTimer) clearTimeout(this.rtcTimer);
    this.rtcTimer = null;
    this.game.emit("media_mode_changed", { mode });
  }
  acceptReaction(turnId: string, batch: Segment[], reaction: Proposal["reaction"], revision: number) {
    if (!reaction || revision !== this.argumentRevision.get(turnId) || this.game.state.phase !== "ROUND") return false;
    const record = this.game.turns.get(turnId);
    const evidence = batch.find(segment => segment.id === reaction.segmentId);
    const text = safeReaction(reaction.text);
    if (!text || !record || record.roundId !== this.game.state.roundId || !evidence || !evidence.eligible || evidence.playerId !== record.turn.playerId || evidence.turnId !== turnId || !record.segments.has(evidence.id) || evidence.text.trim().split(/\s+/).length < 3) return false;
    if ([...this.reactions.entries()].some(([id,reaction]) => id !== turnId && reaction.text === text)) return false;
    this.reactions.set(turnId, {segmentId:evidence.id,text,revision});
    return true;
  }
  invalidateCandidate() {
    this.candidate?.voice.cancel(); this.candidate = null;
  }
  latestReaction(turnId = this.lastSealedTurnId) {
    if (!turnId) return null;
    const reaction = this.reactions.get(turnId);
    return reaction && reaction.revision === this.argumentRevision.get(turnId) ? reaction.text : null;
  }
  handoff(playerId: string, kind: string, previousTurnId: string | null) {
    const player = this.game.player(playerId);
    const planned = this.planned.get(playerId);
    const answered = planned?.claimId && this.game.state.claims.some(c => c.playerId === playerId && c.answersClaimId === planned.claimId);
    if (planned && planned.roundId === this.game.state.roundId && !answered && this.game.canIntervene()) return {text:planned.text,intervention:true};
    if (kind === "closing" && this.game.state.comebackPlayerId === playerId && this.game.canIntervene()) {
      const claim = [...this.game.state.claims].reverse().find(c=>c.playerId === this.game.other(playerId).id);
      const detail = claim?.summary.replace(/[.!?]/g, "").split(/\s+/).slice(0,7).join(" ") || "their strongest argument";
      return {text:`${player.name}, counter this: ${detail}. Your closing matters.`,intervention:true};
    }
    const sameRound = previousTurnId && this.game.turns.get(previousTurnId)?.roundId === this.game.state.roundId;
    const reaction = sameRound ? this.latestReaction(previousTurnId) : null;
    return {text:reaction ? `${reaction} ${player.name}, your turn.` : `${sameRound ? "Case presented. " : ""}${player.name}, ${kind === "case" ? "make your case" : kind === "rebuttal" ? "your rebuttal" : "your closing argument"}.`,intervention:false};
  }
  prepareHandoff() {
    const turn = this.game.state.turn;
    if (!turn || this.game.state.phase !== "ROUND" || this.busy || this.queue.length) return;
    let next = this.game.order[this.game.state.turnIndex+1];
    if (!next && this.game.state.turnIndex === 3) {
      const [a,b] = this.game.state.players;
      const trailing = a.scoreUnits < b.scoreUnits ? a : b.scoreUnits < a.scoreUnits ? b : this.game.other(this.game.order[0].playerId);
      next = {playerId:trailing.id,kind:"closing"};
    }
    if (!next) return;
    const handoff = this.handoff(next.playerId,next.kind,turn.id);
    const text = handoff.text.split(/\s+/).slice(0,14).join(" ");
    const key = `${this.game.state.matchId}:${this.game.state.roundId}:${turn.id}:${this.argumentRevision.get(turn.id) || 0}:${next.playerId}:${next.kind}:${text}:${voiceSettingsKey()}`;
    if (this.candidate?.key === key) return;
    this.invalidateCandidate();
    this.candidate = {key,text,turnId:turn.id,matchId:this.game.state.matchId,roundId:this.game.state.roundId,revision:this.argumentRevision.get(turn.id) || 0,playerId:next.playerId,kind:next.kind,voice:new PreparedVoice(text)};
  }
  nudgeTopic(version: number) {
    if (this.topicNudged || this.closed || this.game.state.phase !== "TOPIC_SELECT" || this.game.state.phaseVersion !== version || this.speech) return;
    this.topicNudged = true;
    this.hostCues = [{text:this.host.pick("nudge"),target:this.game.state.tailsId,phase:"TOPIC_SELECT",phaseVersion:version}];
    this.startHostCue();
  }
  startHostCue() {
    if (this.speech || this.closed) return;
    const cue = this.hostCues.shift();
    if (!cue) {
      if (this.game.state.phase === "INTRO_COIN") this.game.selectTopic();
      return;
    }
    if (cue.phaseVersion !== this.game.state.phaseVersion || cue.phase !== this.game.state.phase) { cue.source?.cancel(); return; }
    void this.say(cue.text,cue.target,false,cue.phase === "INTRO_COIN" ? 3 : 4.5,cue.source).catch(()=>{});
  }
  startHandoff() {
    const handoff = this.pendingHandoff;
    if (!handoff || this.speech) return;
    if (this.game.state.phase !== "ROUND" || this.game.state.matchId !== handoff.matchId || this.game.state.roundId !== handoff.roundId || this.game.state.turn?.id !== handoff.turnId || this.game.state.turn.sealing) {
      this.pendingHandoff = null;
      return;
    }
    this.pendingHandoff = null;
    const text = handoff.text.split(/\s+/).slice(0,14).join(" ");
    const candidate = this.candidate;
    const previousTurnId = this.lastSealedTurnId;
    const prepared = candidate && candidate.turnId === previousTurnId && candidate.matchId === this.game.state.matchId && candidate.roundId === this.game.state.roundId && candidate.revision === (this.argumentRevision.get(candidate.turnId) || 0) && candidate.playerId === handoff.playerId && candidate.kind === this.game.state.turn?.kind && candidate.text === text && candidate.key.endsWith(voiceSettingsKey()) ? candidate.voice : undefined;
    if (!prepared) this.invalidateCandidate();
    void this.say(text, handoff.playerId, handoff.intervention, 4.5, prepared).catch(() => {
      if (this.game.state.turn?.id === handoff.turnId && this.game.state.matchId === handoff.matchId) this.game.resume("judge");
    });
  }
  async say(
    text: string,
    target: string | null,
    intervention: boolean,
    maxSeconds = 4.5,
    prepared?: PreparedVoice,
  ) {
    if (this.speech || this.closed) return;
    if (intervention && !this.game.canIntervene()) return;
    if (intervention) this.game.markIntervention();
    const limited = text
        .split(/\s+/)
        .slice(0, intervention ? 14 : 27)
        .join(" "),
      epoch = ++this.speechEpoch;
    const speech = {
      id: randomUUID(),
      epoch,
      ready: new Set<string>(),
      duration: 0,
      startedAt: null as number | null,
      done: false,
      timer: null as ReturnType<typeof setTimeout> | null,
      maxSeconds,
      turnId: this.game.state.turn?.id || null,
      matchId: this.game.state.matchId,
    };
    this.speech = speech;
    this.game.state.judge = {
      id: speech.id,
      epoch,
      text: limited,
      status: "buffering",
      startAt: null,
      expression: intervention ? "smug" : "happy",
      targetPlayerId: target,
      cueAt: Date.now(),
      turnDoneAt: ["ROUND", "ROUND_RESOLVE"].includes(this.game.state.phase) && this.lastSealedTurnId && this.game.turns.get(this.lastSealedTurnId)?.roundId === this.game.state.roundId ? this.turnDoneAt.get(this.lastSealedTurnId) : undefined,
    };
    this.game.emit("judge_buffer");
    const began = Date.now();
    const source = prepared || fixedVoice(limited);
    this.speechCues.set(epoch, {at:began,prepared:!!source?.chunks.length});
    let chunkSeq = 0,
      offset = 0;
    const cancelled = () => this.speech !== speech || this.closed;
    try {
      const emitChunk = (pcm: Uint8Array) => {
          if (cancelled()) return;
          const remainingBytes = Math.max(0, Math.floor(maxSeconds * 44100) - offset) * 4;
          if (!remainingBytes) return;
          pcm = pcm.subarray(0, remainingBytes);
          const header = Buffer.alloc(17);
          header[0] = 2;
          header.writeUInt32LE(epoch, 1);
          header.writeUInt32LE(chunkSeq++, 5);
          header.writeUInt32LE(44100, 9);
          header.writeUInt32LE(offset, 13);
          offset += pcm.byteLength / 4;
          const data = Buffer.concat([header, Buffer.from(pcm)]);
          for (const seat of this.seats.values()) {
            const ws = seat.sockets.get("audio");
            if (
              ws?.readyState === WebSocket.OPEN &&
              ws.bufferedAmount < 1000000
            )
              ws.send(data);
          }
          speech.duration = offset / 44100;
          if (chunkSeq === 1) {
            this.metrics.speechGenerationMs.push(Date.now() - began);
            speech.timer = setTimeout(() => this.beginSpeech(speech), 400);
          }
        };
      if (source) await source.stream(emitChunk, cancelled);
      else await streamVoice(limited, emitChunk, cancelled, maxSeconds);
      if (cancelled()) return;
      speech.done = true;
      if (!speech.duration) throw new Error("Empty speech");
      if (speech.startedAt) this.scheduleSpeechEnd(speech);
    } catch {
      if (cancelled()) return;
      this.game.state.degraded.tts = true;
      this.game.state.status =
        "Judge voice unavailable. The same verdict and captions are shared.";
      this.cancelSpeech();
      this.game.emit("voice_recovery");
      this.startHostCue();
      if (this.game.state.phase === "ROUND_RESOLVE") { this.game.state.phaseDeadline = Date.now(); this.game.tick(); }
    }
  }
  audioReady(id: string, utteranceId: string, epoch: number) {
    const s = this.speech;
    if (!s || s.id !== utteranceId || s.epoch !== epoch) return;
    s.ready.add(id);
    if (s.ready.size === this.game.state.players.length) this.beginSpeech(s);
  }
  beginSpeech(s: NonNullable<Controller["speech"]>) {
    if (this.speech !== s || s.startedAt || !s.duration) return;
    if (s.timer) clearTimeout(s.timer);
    s.startedAt = Date.now() + 150;
    const cue = this.speechCues.get(s.epoch);
    this.metricsCue.push({text:this.game.state.judge?.text || "",cueAt:cue?.at || Date.now(),startedAt:s.startedAt,latencyMs:s.startedAt-(cue?.at || Date.now()),prepared:cue?.prepared || false});
    if (this.metricsCue.length > 100) this.metricsCue.shift();
    if (this.game.state.judge) {
      this.game.state.judge.status = "speaking";
      this.game.state.judge.startAt = s.startedAt;
    }
    this.game.emit("judge_started", { startAt: s.startedAt, epoch: s.epoch });
    setTimeout(() => {
      if (this.speech === s) this.game.pause("judge");
    }, 150);
    s.timer = setTimeout(() => this.finishSpeech(s), s.maxSeconds * 1000 + 150);
    if (s.done) this.scheduleSpeechEnd(s);
  }
  scheduleSpeechEnd(s: NonNullable<Controller["speech"]>) {
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(
      () => this.finishSpeech(s),
      Math.max(0, s.startedAt! + s.duration * 1000 - Date.now()) + 80,
    );
  }
  finishSpeech(s: NonNullable<Controller["speech"]>) {
    if (this.speech !== s) return;
    if (s.timer) clearTimeout(s.timer);
    this.speech = null;
    if (this.game.state.judge) this.game.state.judge.status = "silent";
    if (this.pendingHandoff) this.startHandoff();
    else if (this.game.state.matchId === s.matchId && this.game.state.turn?.id === s.turnId) this.game.resume("judge");
    this.speechCues.delete(s.epoch);
    this.game.emit("judge_finished");
    this.startHostCue();
    if (!this.speech && this.game.state.phase === "ROUND_RESOLVE") { this.game.state.phaseDeadline = Date.now(); this.game.tick(); }
    else if (!this.speech && this.game.state.phase === "ROUND") this.prepareHandoff();
  }
  cancelSpeech() {
    const s = this.speech;
    if (!s) return;
    this.speech = null;
    if (s.timer) clearTimeout(s.timer);
    this.speechEpoch++;
    if (this.game.state.judge) this.game.state.judge.status = "silent";
    if (this.game.state.phase === "RECOVERING" || this.game.state.phase === "ABORTED") this.pendingHandoff = null;
    else if (this.pendingHandoff) this.startHandoff();
    else if (this.game.state.matchId === s.matchId && this.game.state.turn?.id === s.turnId) this.game.resume("judge");
    this.speechCues.delete(s.epoch);
    this.game.emit("judge_cancelled", { epoch: s.epoch });
  }
  disconnect(id: string) {
    const p = this.game.player(id);
    p.connected = false;
    p.mediaReady = false;
    p.captureReady = false;
    p.ready = false;
    this.ink.get(id)?.close();
    this.ink.delete(id);
    this.game.recover(
      `${p.name} disconnected. Holding their seat and the clock.`,
    );
    this.game.emit("player_disconnected");
  }
  tick() {
    const voices = [...this.seats.values()];
    if (
      voices.length === 2 &&
      voices.every((s) => Date.now() - s.voiceAt < 120)
    )
      this.game.overlap(100);
    this.game.tick();
  }
  close() {
    this.closed = true;
    if (this.topicNudge) clearTimeout(this.topicNudge);
    for (const cue of this.hostCues) cue.source?.cancel();
    this.hostCues = [];
    this.invalidateCandidate();
    this.cancelSpeech();
    if (this.rtcTimer) clearTimeout(this.rtcTimer);
    for (const s of this.ink.values()) s.close();
    for (const seat of this.seats.values())
      for (const ws of seat.sockets.values()) ws.close();
  }
}
