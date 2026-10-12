import { WebSocket } from "ws";
import { type GameEvent } from "../shared/types.js";
import { Game } from "./game.js";
import { Judging } from "./judging.js";
import { RoomMedia } from "./media.js";
import { JudgePlayback } from "./playback.js";
import { defaultServices, type RoomServices } from "./runtime.js";
import { Transcription } from "./transcription.js";
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
  judging = new Judging(this);
  transcription = new Transcription(this);
  playback = new JudgePlayback(this);
  media = new RoomMedia(this);
  game: Game;
  seats = new Map<string, Seat>();
  closed = false;
  createdAt = Date.now();
  lastActiveAt = Date.now();
  metrics: {
    scoringMs: number[];
    speechGenerationMs: number[];
    playbackMs: number[];
  } = { scoringMs: [], speechGenerationMs: [], playbackMs: [] };
  recordMetric(kind: keyof Controller["metrics"], value: number) {
    if (!Number.isFinite(value)) return;
    const samples = this.metrics[kind];
    samples.push(value);
    if (samples.length > 128) samples.shift();
  }
  failures = new Map<string, number>();
  recordFailure(category: "judgment" | "transcription" | "voice_delivery") {
    this.failures.set(category, (this.failures.get(category) || 0) + 1);
  }
  services: RoomServices;
  timers = new Set<ReturnType<typeof setTimeout>>();
  topicRequest: AbortController | null = null;
  constructor(code: string, services: Partial<RoomServices> = {}) {
    this.services = { ...defaultServices, ...services };
    this.game = new Game(code, (e) => this.onEvent(e), this.services.now);
  }
  later(callback: () => void, ms: number) {
    const matchId = this.game.state.matchId;
    const timer = this.services.setTimeout(() => {
      this.timers.delete(timer);
      if (!this.closed && matchId === this.game.state.matchId) callback();
    }, ms);
    this.timers.add(timer);
    return timer;
  }
  clearTimers() {
    for (const timer of this.timers) this.services.clearTimeout(timer);
    this.timers.clear();
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
      this.game.holdFloorForJudge();
      event.snapshot = this.game.snapshot();
    }
    if (event.type === "turn_sealed" && this.game.state.turn) {
      this.game.setSettlement("draining");
      event.snapshot = this.game.snapshot();
    }
    if (event.type === "player_joined") this.services.warmVoice();
    if (event.type === "phase_changed") {
      for (const cue of this.playback.hostCues) cue.source?.cancel();
      this.playback.hostCues = [];
      this.topicRequest?.abort();
      this.topicRequest = null;
      if (this.game.state.phase === "RECOVERING")
        this.judging.cancelJudgment(true);
      if (["LOBBY", "ABORTED", "INTRO_COIN"].includes(this.game.state.phase)) {
        this.clearTimers();
        this.judging.cancelJudgment();
      }
      if (this.playback.topicNudge)
        this.services.clearTimeout(this.playback.topicNudge);
      this.playback.topicNudge = null;
      if (this.game.state.phase !== "ROUND" || !this.game.state.turn)
        this.playback.pendingHandoff = null;
      if (["LOBBY", "RECOVERING", "ABORTED"].includes(this.game.state.phase))
        this.judging.invalidateCandidate();
    }
    this.broadcast(event);
    if (
      event.type === "phase_changed" &&
      ["TOPIC_CONFIRM", "ROUND", "LOBBY", "RECOVERING", "ABORTED"].includes(
        this.game.state.phase,
      )
    )
      this.playback.cancelSpeech();
    if (
      event.type === "phase_changed" &&
      ["LOBBY", "MATCH_RESULT", "ABORTED"].includes(event.snapshot.phase)
    ) {
      for (const stream of this.transcription.ink.values()) stream.close();
      this.transcription.ink.clear();
    }
    if (event.type === "coin_committed") {
      this.playback.cancelSpeech();
      this.judging.cancelJudgment();
      this.judging.recent = [];
      this.judging.queue = [];
      this.transcription.sealedAudio.clear();
      this.judging.planned.clear();
      this.transcription.retries.clear();
      for (const p of this.game.state.players)
        this.transcription.rotate(p.id, null);
      this.playback.host.reset();
      this.judging.reactions.clear();
      this.judging.argumentRevision.clear();
      this.playback.lastSealedTurnId = null;
      this.playback.turnDoneAt.clear();
      this.judging.invalidateCandidate();
      const reveal = `${this.game.player(this.game.state.headsId!).name} opens. ${this.game.player(this.game.state.tailsId!).name} picks the battlefield.`;
      const phaseVersion = this.game.state.phaseVersion;
      this.playback.hostCues = [
        {
          text: this.playback.host.pick("welcome"),
          target: null,
          phase: "INTRO_COIN",
          phaseVersion,
        },
        {
          text: this.playback.host.pick("coin"),
          target: null,
          phase: "INTRO_COIN",
          phaseVersion,
        },
        {
          text: reveal,
          target: null,
          phase: "INTRO_COIN",
          phaseVersion,
          source: this.services.prepareVoice(reveal, 3),
        },
      ];
      this.playback.startHostCue();
    }
    if (
      event.type === "phase_changed" &&
      this.game.state.phase === "TOPIC_SELECT"
    ) {
      this.playback.cancelSpeech();
      const phaseVersion = this.game.state.phaseVersion;
      this.playback.hostCues = [
        {
          text: this.playback.host.pick("topic"),
          target: this.game.state.tailsId,
          phase: "TOPIC_SELECT",
          phaseVersion,
        },
      ];
      this.playback.startHostCue();
      this.playback.topicNudged = false;
      this.playback.topicNudge = this.later(
        () => this.playback.nudgeTopic(phaseVersion),
        12000,
      );
    }
    if (event.type === "floor_granted") {
      const t = this.game.state.turn!;
      this.transcription.rotate(t.playerId, t.id);
      const { text, intervention } = this.judging.handoff(
        t.playerId,
        t.kind,
        this.playback.lastSealedTurnId,
      );
      if (intervention) this.judging.planned.delete(t.playerId);
      this.playback.pendingHandoff = {
        matchId: this.game.state.matchId,
        roundId: this.game.state.roundId,
        turnId: t.id,
        playerId: t.playerId,
        text,
        intervention,
      };
      this.playback.startHandoff();
    }
    if (event.type === "turn_sealed") {
      const { playerId, lastAudioSeq } = event.payload as {
        playerId: string;
        lastAudioSeq: number;
      };
      const turnId = this.game.state.turn!.id;
      this.playback.lastSealedTurnId = turnId;
      this.playback.turnDoneAt.set(turnId, this.services.now());
      this.transcription.sealedAudio.set(playerId, {
        turnId,
        maxSeq: lastAudioSeq >= 0 ? lastAudioSeq : Infinity,
        capturedBefore: event.serverNowMs,
        expiresAt: this.services.now() + 500,
      });
      const rotate = async () => {
        if (
          this.game.state.turn?.id !== turnId ||
          !this.game.state.turn.sealing
        )
          return;
        this.transcription.sealedAudio.delete(playerId);
        const stream = this.transcription.ink.get(playerId);
        this.transcription.ink.delete(playerId);
        const drained = !stream || (await stream.close());
        if (this.game.state.turn?.id !== turnId) return;
        if (!drained && !this.game.state.degraded.stt) {
          this.game.abort(
            "Transcription could not finish safely. No unjudged evidence was skipped. Try a fresh match.",
          );
          return;
        }
        this.game.setSettlement(
          this.judging.busy || this.judging.queue.length ? "scoring" : "ready",
        );
        this.game.emit("turn_settlement");
        this.judging.prepareHandoff();
      };
      // Drain frames captured before the handoff; they retain the old STT epoch.
      this.later(rotate, 500);
    }
    if (event.type === "reconnected") {
      const t = this.game.state.turn;
      if (t && !t.sealing) this.transcription.rotate(t.playerId, t.id);
      void this.judging.drain();
    }
    if (event.type === "round_result") {
      this.playback.pendingHandoff = null;
      this.playback.hostCues = [];
      this.playback.cancelSpeech();
      const r = this.game.state.results.at(-1)!;
      void this.playback
        .say(
          `${this.judging.latestReaction() || ""} ${this.game.player(r.winnerId).name} takes it. ${r.reason}${this.game.player(r.winnerId).wins < 2 ? " " + this.playback.host.pick("round") : ""}`,
          r.winnerId,
          false,
          8,
        )
        .catch(() => {});
    }
    if (event.type === "match_result") {
      this.playback.pendingHandoff = null;
      this.playback.hostCues = [];
      this.playback.cancelSpeech();
      void this.playback
        .say(
          `${this.game.player(this.game.state.winnerId!).name} wins the match. ${this.game.state.results.at(-1)?.reason || ""} Case closed.`,
          this.game.state.winnerId,
          false,
          6,
        )
        .catch(() => {});
    }
    if (
      event.snapshot.phase === "ABORTED" ||
      event.snapshot.phase === "RECOVERING"
    )
      this.playback.cancelSpeech();
  }
  disconnect(id: string) {
    const p = this.game.player(id);
    this.game.disconnectPlayer(id);
    this.transcription.ink.get(id)?.close();
    this.transcription.ink.delete(id);
    this.game.recover(
      `${p.name} disconnected. Holding their seat and the clock.`,
    );
    this.game.emit("player_disconnected");
  }
  tick() {
    this.game.tick();
  }
  close() {
    this.closed = true;
    this.clearTimers();
    this.topicRequest?.abort();
    this.judging.cancelJudgment();
    if (this.playback.topicNudge)
      this.services.clearTimeout(this.playback.topicNudge);
    for (const cue of this.playback.hostCues) cue.source?.cancel();
    this.playback.hostCues = [];
    this.judging.invalidateCandidate();
    this.playback.cancelSpeech();
    if (this.media.rtcTimer) this.services.clearTimeout(this.media.rtcTimer);
    for (const s of this.transcription.ink.values()) s.close();
    for (const seat of this.seats.values())
      for (const ws of seat.sockets.values()) ws.close();
  }
}
