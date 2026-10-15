import { WebSocket } from "ws";
import { type GameEvent } from "../../shared/protocol.js";
import { Game } from "../game/game.js";
import { Judging } from "../judge/judging.js";
import { JudgePlayback } from "../judge/playback.js";
import { RoomMedia } from "../transport/media.js";
import { defaultServices, type RoomServices } from "./services.js";
import { Readiness } from "./readiness.js";
import { TurnCoordinator } from "./turn-coordinator.js";
import { Transcription } from "./transcription.js";
export type Seat = {
  tokenHash: string;
  epoch: number;
  resume?: { id: string; fromEpoch: number; toEpoch: number };
  sockets: Map<string, WebSocket>;
  audioSeq: number;
  lastAudioAt: number;
  voiceAt: number;
  lastActivity: number;
  rtcReady: boolean;
  acks: Map<string, unknown>;
};
export class RoomController {
  judging = new Judging(this);
  transcription = new Transcription(this);
  readiness = new Readiness(this);
  playback = new JudgePlayback(this);
  media = new RoomMedia(this);
  game: Game;
  turnCoordinator = new TurnCoordinator(this);
  timeline: { stage: string; at: number; [key: string]: unknown }[] = [];
  trace(stage: string, data: Record<string, unknown> = {}) {
    this.timeline.push({ stage, at: this.services.now(), ...data });
    if (this.timeline.length > 512) this.timeline.shift();
  }
  seats = new Map<string, Seat>();
  closed = false;
  createdAt = Date.now();
  lastActiveAt = Date.now();
  metrics: {
    scoringMs: number[];
    speechGenerationMs: number[];
    playbackMs: number[];
    cueToRenderMs: number[];
    doneToRenderMs: number[];
    grantToCaptureMs: number[];
    captureToServerMs: number[];
  } = {
    scoringMs: [],
    speechGenerationMs: [],
    playbackMs: [],
    cueToRenderMs: [],
    doneToRenderMs: [],
    grantToCaptureMs: [],
    captureToServerMs: [],
  };
  recordMetric(kind: keyof RoomController["metrics"], value: number) {
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
    this.game.coordinateInput = true;
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
      this.turnCoordinator.assigned();
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
        if (this.game.state.phase !== "LOBBY") this.clearTimers();
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
    if (event.type === "score_committed")
      this.trace("score_commit", {
        turnId: event.payload.turnId,
        segmentId: event.payload.segmentId,
      });
    this.broadcast(event);
    if (event.type === "phase_changed")
      this.playback.discardSupersededHostCue();
    if (
      event.type === "phase_changed" &&
      ["RECOVERING", "ABORTED"].includes(this.game.state.phase)
    )
      this.playback.cancelSpeech();
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
      const reveal = `Court is in session! ${this.game.player(this.game.state.headsId!).name} opens. ${this.game.player(this.game.state.tailsId!).name} picks the battlefield.`;
      const phaseVersion = this.game.state.phaseVersion;
      this.playback.hostCues = [
        {
          text: reveal,
          target: null,
          phase: "INTRO_COIN",
          phaseVersion,
          source: this.services.prepareVoice(reveal),
        },
      ];
      this.playback.startHostCue();
    }
    if (
      event.type === "phase_changed" &&
      this.game.state.phase === "TOPIC_SELECT"
    ) {
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
      const { lastAudioSeq, capturedBefore } = event.payload as {
        playerId: string;
        lastAudioSeq: number;
        capturedBefore: number;
      };
      const turnId = this.game.state.turn!.id;
      this.playback.lastSealedTurnId = turnId;
      this.playback.turnDoneAt.set(turnId, this.services.now());
      this.turnCoordinator.sealed(lastAudioSeq, capturedBefore);
    }

    if (event.type === "reconnected") {
      const t = this.game.state.turn;
      if (t && !t.sealing) this.transcription.rotate(t.playerId, t.id);
      void this.judging.drain();
      if (this.game.state.phase === "INTRO_COIN") this.playback.startHostCue();
      if (this.game.state.phase === "ROUND_RESOLVE" && !this.playback.speech)
        this.game.finishRoundPresentation();
    }
    if (event.type === "round_result") {
      this.playback.pendingHandoff = null;
      this.playback.hostCues = [];
      const r = this.game.state.results.at(-1)!;
      if (this.game.player(r.winnerId).wins >= 2) this.game.finishMatch();
      else
        void this.playback.say(
          `${this.game.player(r.winnerId).name} takes it. ${r.reason} ${this.playback.host.pick("round")}`,
          r.winnerId,
          false,
        );
    }
    if (event.type === "match_result") {
      this.playback.pendingHandoff = null;
      this.playback.hostCues = [];
      void this.playback.say(
        `${this.game.player(this.game.state.winnerId!).name} wins the match. ${this.game.state.results.at(-1)?.reason || ""} Case closed.`,
        this.game.state.winnerId,
        false,
      );
    }
    if (
      ["judge_idle", "turn_settlement", "media_status", "reconnected"].includes(
        event.type,
      )
    )
      this.turnCoordinator.advance();
    if (
      event.snapshot.phase === "ABORTED" ||
      event.snapshot.phase === "RECOVERING"
    )
      this.playback.cancelSpeech();
  }
  disconnect(id: string) {
    const p = this.game.player(id);
    this.game.disconnectPlayer(id);
    this.transcription.disconnect(id);
    this.game.recover(
      `${p.name} disconnected. Holding their seat and the clock.`,
    );
    this.game.emit("player_disconnected");
  }
  leave(id: string) {
    const seat = this.seats.get(id);
    if (!seat) return;
    this.playback.pendingHandoff = null;
    for (const cue of this.playback.hostCues) cue.source?.cancel();
    this.playback.hostCues = [];
    this.playback.cancelSpeech();
    const { game } = this;
    if (!["LOBBY", "ABORTED", "MATCH_RESULT"].includes(game.state.phase))
      game.abort(
        `${game.player(id).name} left the court. No winner this time.`,
      );
    // Revoke callback/socket ownership before closing anything that can emit a
    // final transcript or a disconnect. Both departure transports use this path.
    this.seats.delete(id);
    this.transcription.release(id);
    this.readiness.records.delete(id);
    for (const ws of seat.sockets.values()) ws.close();
    if (game.state.phase === "MATCH_RESULT") {
      // The seat is gone, but the finished verdict still refers to this player.
      game.disconnectPlayer(id);
      game.setMediaReady(id, false);
      game.setCaptureReady(id, false, false);
    } else game.removePlayer(id);
    game.emit("player_left");
  }
  tick() {
    for (const [id, stream] of this.transcription.ink) {
      if (
        !stream.connected &&
        !stream.closing &&
        !stream.failed &&
        !this.transcription.connecting(id)
      )
        this.transcription.sttFailure(id, stream.turnId);
    }
    this.readiness.tick();
    this.media.selectMode();
    this.turnCoordinator.advance();
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
    for (const s of this.transcription.active) void s.close();
    for (const s of this.transcription.ink.values()) void s.close();
    this.transcription.ink.clear();
    for (const seat of this.seats.values())
      for (const ws of seat.sockets.values()) ws.close();
  }
}
