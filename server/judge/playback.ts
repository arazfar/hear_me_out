import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  encodeJudgeAudio,
  JUDGE_FRAME_SAMPLES,
  JUDGE_MAX_SAMPLES,
  JUDGE_RATE,
} from "../../shared/media.js";
import type { RoomController } from "../rooms/room.js";
import {
  completeSpeech,
  HostPhrases,
  voiceSettingsKey,
} from "./personality.js";
import { PreparedVoice } from "./voice-cache.js";

type Speech = {
  id: string;
  epoch: number;
  text: string;
  target: string | null;
  ready: Set<string>;
  completed: Set<string>;
  connections: Map<string, number>;
  progress: Map<string, { samples: number; at: number }>;
  rtt: number;
  duration: number;
  samples: number;
  startedAt: number | null;
  done: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  began: number;
  generatedAt: number;
  frames: Uint8Array[];
  sent: number;
  eofSent: boolean;
  carry: Uint8Array;
  turnId: string | null;
  matchId: string | null;
  source?: PreparedVoice;
  attempt: number;
  repairAt?: number;
  fallback: boolean;
  hostPhase?: { phase: string; version: number };
};
/** Owns generation and delivery separately from both clients' rendered completion. */
export class JudgePlayback {
  constructor(readonly room: RoomController) {}
  speechEpoch = 0;
  speech: Speech | null = null;
  pendingHandoff: {
    matchId: string | null;
    roundId: string | null;
    turnId: string;
    playerId: string;
    text: string;
    intervention: boolean;
  } | null = null;
  host = new HostPhrases();
  hostCues: {
    text: string;
    target: string | null;
    phaseVersion: number;
    phase: string;
    source?: PreparedVoice;
  }[] = [];
  topicNudge: ReturnType<typeof setTimeout> | null = null;
  topicNudged = false;
  lastSealedTurnId: string | null = null;
  speechCues = new Map<number, { at: number; prepared: boolean }>();
  turnDoneAt = new Map<string, number>();
  metricsCue: {
    cueAt: number;
    startedAt: number;
    latencyMs: number;
    prepared: boolean;
  }[] = [];
  nudgeTopic(version: number) {
    if (
      this.topicNudged ||
      this.room.closed ||
      this.room.game.state.phase !== "TOPIC_SELECT" ||
      this.room.game.state.phaseVersion !== version ||
      this.speech
    )
      return;
    this.topicNudged = true;
    this.hostCues = [
      {
        text: this.host.pick("nudge"),
        target: this.room.game.state.tailsId,
        phase: "TOPIC_SELECT",
        phaseVersion: version,
      },
    ];
    this.startHostCue();
  }
  startHostCue() {
    if (this.speech || this.room.closed) return;
    let cue = this.hostCues.shift();
    while (
      cue &&
      (cue.phaseVersion !== this.room.game.state.phaseVersion ||
        cue.phase !== this.room.game.state.phase)
    ) {
      cue.source?.cancel();
      cue = this.hostCues.shift();
    }
    if (!cue) {
      if (this.room.game.state.phase === "INTRO_COIN")
        this.room.game.selectTopic();
      return;
    }
    void this.say(cue.text, cue.target, false, 20, cue.source, 0, {
      phase: cue.phase,
      version: cue.phaseVersion,
    });
  }
  discardSupersededHostCue() {
    const speech = this.speech;
    if (
      speech?.hostPhase &&
      (speech.hostPhase.phase !== this.room.game.state.phase ||
        speech.hostPhase.version !== this.room.game.state.phaseVersion) &&
      (speech.startedAt === null || this.room.services.now() < speech.startedAt)
    )
      this.cancelSpeech();
  }
  startHandoff() {
    const handoff = this.pendingHandoff;
    if (!handoff || this.speech) return;
    const state = this.room.game.state;
    if (
      state.phase !== "ROUND" ||
      state.matchId !== handoff.matchId ||
      state.roundId !== handoff.roundId ||
      state.turn?.id !== handoff.turnId ||
      state.turn.sealing
    ) {
      this.pendingHandoff = null;
      return;
    }
    this.pendingHandoff = null;
    const text = completeSpeech(handoff.text, 27),
      candidate = this.room.judging.candidate;
    const prepared =
      candidate &&
      candidate.turnId === this.lastSealedTurnId &&
      candidate.matchId === state.matchId &&
      candidate.roundId === state.roundId &&
      candidate.revision ===
        (this.room.judging.argumentRevision.get(candidate.turnId) || 0) &&
      candidate.playerId === handoff.playerId &&
      candidate.kind === state.turn.kind &&
      candidate.text === text &&
      candidate.key.endsWith(voiceSettingsKey())
        ? candidate.voice
        : undefined;
    // A selected clip transfers ownership. Later evidence cannot cancel active playback.
    if (prepared) this.room.judging.candidate = null;
    else this.room.judging.invalidateCandidate();
    void this.say(text, handoff.playerId, handoff.intervention, 20, prepared);
  }
  async say(
    text: string,
    target: string | null,
    intervention: boolean,
    _budget = 20,
    prepared?: PreparedVoice,
    attempt = 0,
    hostPhase?: Speech["hostPhase"],
  ) {
    if (
      this.speech ||
      this.room.closed ||
      (intervention && !this.room.game.canIntervene())
    )
      return;
    if (intervention) this.room.game.markIntervention();
    const limited = completeSpeech(text),
      epoch = ++this.speechEpoch,
      now = this.room.services.now();
    const s: Speech = {
      id: randomUUID(),
      epoch,
      text: limited,
      target,
      ready: new Set(),
      completed: new Set(),
      connections: new Map(
        [...this.room.seats].map(([id, seat]) => [id, seat.epoch]),
      ),
      progress: new Map(),
      rtt: 0,
      duration: 0,
      samples: 0,
      startedAt: null,
      done: false,
      timer: null,
      began: now,
      generatedAt: now,
      frames: [],
      sent: 0,
      eofSent: false,
      carry: new Uint8Array(),
      turnId: this.room.game.state.turn?.id || null,
      matchId: this.room.game.state.matchId,
      attempt,
      fallback: false,
      hostPhase,
    };
    this.speech = s;
    if (this.room.game.state.turn && !this.room.game.state.turn.sealing) {
      this.room.turnCoordinator.holdInput();
      this.room.game.holdFloorForJudge();
      this.room.game.state.turn.inputState = "preparing";
    }
    const doneAt = this.lastSealedTurnId
      ? this.turnDoneAt.get(this.lastSealedTurnId)
      : undefined;
    if (this.lastSealedTurnId) this.turnDoneAt.delete(this.lastSealedTurnId);
    this.room.game.bufferJudge({
      id: s.id,
      epoch,
      text: limited,
      status: "buffering",
      startAt: null,
      expression: intervention ? "smug" : "happy",
      targetPlayerId: target,
      cueAt: now,
      turnDoneAt: doneAt,
    });
    this.room.game.emit("judge_buffer");
    const fixed = prepared ? undefined : this.room.services.fixedVoice(limited);
    s.source = prepared; // Only exclusive preparation is canceled with this utterance; shared fixed cache is not.
    const source = prepared || fixed;
    this.speechCues.set(epoch, { at: now, prepared: !!source?.chunks.length });
    const cancelled = () => this.speech !== s || s.fallback || this.room.closed;
    this.watch(s);
    try {
      const receive = (pcm: Uint8Array) => {
        if (cancelled() || !pcm.length) return;
        if (
          pcm.length % 2 ||
          s.samples + (s.carry.length + pcm.length) / 2 > JUDGE_MAX_SAMPLES
        )
          throw new Error("Invalid or excessive judge PCM");
        if (!s.samples && !s.carry.length) {
          this.room.recordMetric(
            "speechGenerationMs",
            this.room.services.now() - s.began,
          );
          this.room.trace("tts_first_generated", { speechEpoch: s.epoch });
        }
        const joined = new Uint8Array(s.carry.length + pcm.length);
        joined.set(s.carry);
        joined.set(pcm, s.carry.length);
        let offset = 0;
        while (joined.length - offset >= JUDGE_FRAME_SAMPLES * 2) {
          s.frames.push(joined.slice(offset, offset + JUDGE_FRAME_SAMPLES * 2));
          offset += JUDGE_FRAME_SAMPLES * 2;
          s.samples += JUDGE_FRAME_SAMPLES;
        }
        s.carry = joined.slice(offset);
        s.generatedAt = this.room.services.now();
        s.duration = (s.samples + s.carry.length / 2) / JUDGE_RATE;
        this.pump(s);
      };
      if (source) await source.stream(receive, cancelled);
      else
        await this.room.services.streamVoice(limited, receive, cancelled, 20);
      if (cancelled()) return;
      if (s.carry.length) {
        s.frames.push(s.carry);
        s.samples += s.carry.length / 2;
        s.carry = new Uint8Array();
      }
      s.duration = s.samples / JUDGE_RATE;
      if (!s.samples) throw new Error("Empty voice");
      s.done = true;
      this.room.trace("tts_eof", { speechEpoch: s.epoch, samples: s.samples });
      this.pump(s);
    } catch {
      if (!cancelled()) this.voiceFailure(false);
    }
  }
  private socketsReady() {
    return (
      this.room.seats.size === 2 &&
      [...this.room.seats.values()].every(
        (seat) => seat.sockets.get("judge")?.readyState === WebSocket.OPEN,
      )
    );
  }
  private pump(s: Speech) {
    if (this.speech !== s || s.fallback || s.repairAt !== undefined) return;
    if (!this.socketsReady()) {
      this.voiceFailure(true);
      return;
    }
    const now = this.room.services.now();
    // 120 ms before readiness, then at most 400 ms ahead. Cached clips cannot flood either socket.
    const horizon =
      s.startedAt === null
        ? 6
        : Math.max(6, Math.ceil((now - s.startedAt + 400) / 20));
    while (s.sent < s.frames.length && s.sent < horizon) {
      const seats = [...this.room.seats.values()];
      if (
        seats.some((seat) => seat.sockets.get("judge")!.bufferedAmount > 65536)
      )
        return;
      const frame = s.frames[s.sent],
        offset = s.sent * JUDGE_FRAME_SAMPLES;
      const packet = encodeJudgeAudio(s.epoch, s.sent, offset, frame);
      for (const seat of seats)
        seat.sockets.get("judge")!.send(packet, (error) => {
          if (error && this.speech === s) this.voiceFailure(true);
        });
      if (s.sent++ === 0) {
        this.room.trace("tts_first_packet", { speechEpoch: s.epoch });
      }
    }
    if (s.done && s.sent === s.frames.length && !s.eofSent) {
      const packet = encodeJudgeAudio(
        s.epoch,
        s.sent,
        s.samples,
        new Uint8Array(),
        true,
      );
      for (const seat of this.room.seats.values())
        seat.sockets.get("judge")!.send(packet);
      s.eofSent = true;
    }
  }
  private watch(s: Speech) {
    if (s.timer) {
      this.room.services.clearTimeout(s.timer);
      this.room.timers.delete(s.timer);
    }
    s.timer = this.room.later(() => {
      if (this.speech !== s || s.fallback) return;
      const now = this.room.services.now();
      if (s.repairAt !== undefined) {
        if (s.done && this.socketsReady() && s.attempt === 0) {
          this.replay(s);
          return;
        }
        if (now - s.repairAt >= 3000) {
          this.captions(s);
          return;
        }
      } else if (
        now - s.began >= 30000 ||
        (!s.done && now - s.began >= 20000) ||
        (!s.duration && now - s.began >= 5000) ||
        (!s.done && s.duration > 0 && now - s.generatedAt >= 3000)
      ) {
        this.voiceFailure(false);
        return;
      } else if (
        s.startedAt !== null &&
        [...s.connections.keys()].some(
          (id) =>
            !s.completed.has(id) &&
            now - (s.progress.get(id)?.at ?? s.startedAt!) >= 3000,
        )
      ) {
        this.voiceFailure(true);
        return;
      } else if (
        s.duration &&
        s.startedAt === null &&
        now - s.generatedAt >= 3000
      ) {
        this.voiceFailure(true);
        return;
      }
      this.pump(s);
      if (this.speech === s && !s.fallback) this.watch(s);
    }, 20);
  }
  audioReady(id: string, utteranceId: string, epoch: number, rtt = 0) {
    const s = this.owned(id, utteranceId, epoch);
    if (!s || s.fallback || s.repairAt !== undefined) return;
    s.ready.add(id);
    s.rtt = Math.max(s.rtt, Math.min(2000, rtt));
    if (s.ready.size === 2) this.beginSpeech(s);
  }
  private owned(id: string, utteranceId: string, epoch: number) {
    const s = this.speech;
    return s &&
      s.id === utteranceId &&
      s.epoch === epoch &&
      s.connections.get(id) === this.room.seats.get(id)?.epoch
      ? s
      : null;
  }
  audioPlayback(
    id: string,
    utteranceId: string,
    epoch: number,
    status: "progress" | "complete" | "failed",
    samples: number,
  ) {
    const s = this.owned(id, utteranceId, epoch);
    if (!s || s.fallback || s.repairAt !== undefined || s.completed.has(id))
      return;
    if (status === "failed") {
      this.voiceFailure(true);
      return;
    }
    if (
      s.startedAt === null ||
      samples < (s.progress.get(id)?.samples ?? 0) ||
      samples > s.samples
    )
      return;
    if (
      status === "complete" &&
      (!s.done ||
        !s.eofSent ||
        samples !== s.samples ||
        this.room.services.now() < s.startedAt + s.duration * 1000 - 20)
    )
      return;
    const previous = s.progress.get(id);
    if (!previous || samples > previous.samples) {
      s.progress.set(id, { samples, at: this.room.services.now() });
      this.room.trace(previous ? "render_progress" : "render_first", {
        playerId: id,
        speechEpoch: epoch,
        samples,
      });
    }
    if (
      status === "complete" &&
      s.done &&
      s.eofSent &&
      samples === s.samples &&
      this.room.services.now() >= s.startedAt + s.duration * 1000 - 20
    ) {
      s.completed.add(id);
      this.room.trace("render_complete", {
        playerId: id,
        speechEpoch: epoch,
        samples,
      });
      if (s.completed.size === 2) this.finishSpeech(s);
    }
  }
  beginSpeech(s: Speech) {
    if (
      this.speech !== s ||
      s.startedAt !== null ||
      !s.duration ||
      s.ready.size !== 2
    )
      return;
    s.startedAt =
      this.room.services.now() + Math.max(150, Math.min(1000, s.rtt + 50));
    const cue = this.speechCues.get(s.epoch);
    this.metricsCue.push({
      cueAt: s.began,
      startedAt: s.startedAt,
      latencyMs: s.startedAt - s.began,
      prepared: cue?.prepared || false,
    });
    if (this.metricsCue.length > 100) this.metricsCue.shift();
    this.room.game.state.degraded.tts = false;
    this.room.game.startJudge(s.epoch, s.startedAt);
    this.room.game.pause("judge");
    this.room.game.emit("judge_started", {
      startAt: s.startedAt,
      epoch: s.epoch,
    });
    this.pump(s);
  }
  voiceFailure(recoverable = true) {
    const s = this.speech;
    if (!s || s.fallback || this.room.closed) return;
    this.room.recordFailure("voice_delivery");
    if (recoverable && s.attempt === 0 && s.done) {
      if (s.repairAt === undefined) {
        s.repairAt = this.room.services.now();
        this.room.game.emit("judge_cancelled", { epoch: s.epoch });
        // A watchdog can discover this failure itself. Re-arm it so repair
        // cannot get stranded after that callback returns.
        this.watch(s);
      }
    } else this.captions(s);
  }
  private replay(s: Speech) {
    const pcm = s.frames;
    const source = new PreparedVoice(
      s.text,
      20,
      async (_text, onChunk, cancelled) => {
        for (const chunk of pcm) if (!cancelled()) onChunk(chunk);
        return s.duration;
      },
    );
    this.cancelSpeech();
    void this.say(s.text, s.target, false, 20, source, 1, s.hostPhase);
  }
  private captions(s: Speech) {
    s.fallback = true;
    s.source?.cancel();
    this.clearTimer(s);
    this.room.game.degrade(
      "tts",
      "Bonk’s voice is unavailable. Read the shared line.",
    );
    this.room.game.emit("judge_cancelled", { epoch: s.epoch });
    if (this.room.game.state.judge?.epoch === s.epoch)
      this.room.game.state.judge.status = "captions";
    this.room.game.emit("voice_recovery");
    s.timer = this.room.later(
      () => this.finishSpeech(s),
      Math.max(2000, Math.min(6000, s.text.split(/\s+/).length * 250)),
    );
  }
  finishSpeech(s: Speech) {
    if (this.speech !== s) return;
    this.clearTimer(s);
    this.speech = null;
    this.room.game.silenceJudge(s.epoch);
    this.speechCues.delete(s.epoch);
    this.room.game.emit("judge_finished");
    if (this.pendingHandoff) this.startHandoff();
    else this.startHostCue();
    if (!this.speech && this.room.game.state.phase === "ROUND_RESOLVE")
      this.room.game.finishRoundPresentation();
    if (!this.speech && this.room.game.state.phase === "MATCH_RESULT")
      this.room.game.maybeRematch();
    if (
      !this.speech &&
      this.room.game.state.phase === "LOBBY" &&
      this.room.game.allMediaReady() &&
      this.room.game.state.players.every((p) => p.ready)
    )
      this.room.game.startMatch();
    this.room.turnCoordinator.advance();
    if (!this.speech && this.room.game.state.phase === "ROUND")
      this.room.judging.prepareHandoff();
  }
  /** Hard cancellation never opens input. The coordinator must issue a fresh grant. */
  cancelSpeech() {
    const s = this.speech;
    if (!s) return;
    this.speech = null;
    s.source?.cancel();
    this.clearTimer(s);
    this.speechEpoch++;
    this.room.game.silenceJudge(s.epoch);
    this.speechCues.delete(s.epoch);
    this.room.game.emit("judge_cancelled", { epoch: s.epoch });
  }
  private clearTimer(s: Speech) {
    if (!s.timer) return;
    this.room.services.clearTimeout(s.timer);
    this.room.timers.delete(s.timer);
    s.timer = null;
  }
}
