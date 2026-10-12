import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { encodeJudgeAudio } from "../shared/media.js";
import type { Controller } from "./controller.js";
import { HostPhrases, voiceSettingsKey } from "./host.js";
import { PreparedVoice } from "./voice-cache.js";
export class JudgePlayback {
  constructor(readonly room: Controller) {}
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
    const cue = this.hostCues.shift();
    if (!cue) {
      if (this.room.game.state.phase === "INTRO_COIN")
        this.room.game.selectTopic();
      return;
    }
    if (
      cue.phaseVersion !== this.room.game.state.phaseVersion ||
      cue.phase !== this.room.game.state.phase
    ) {
      cue.source?.cancel();
      return;
    }
    void this.say(
      cue.text,
      cue.target,
      false,
      cue.phase === "INTRO_COIN" ? 3 : 4.5,
      cue.source,
    ).catch(() => {});
  }
  startHandoff() {
    const handoff = this.pendingHandoff;
    if (!handoff || this.speech) return;
    if (
      this.room.game.state.phase !== "ROUND" ||
      this.room.game.state.matchId !== handoff.matchId ||
      this.room.game.state.roundId !== handoff.roundId ||
      this.room.game.state.turn?.id !== handoff.turnId ||
      this.room.game.state.turn.sealing
    ) {
      this.pendingHandoff = null;
      return;
    }
    this.pendingHandoff = null;
    const text = handoff.text.split(/\s+/).slice(0, 14).join(" ");
    const candidate = this.room.judging.candidate;
    const previousTurnId = this.lastSealedTurnId;
    const prepared =
      candidate &&
      candidate.turnId === previousTurnId &&
      candidate.matchId === this.room.game.state.matchId &&
      candidate.roundId === this.room.game.state.roundId &&
      candidate.revision ===
        (this.room.judging.argumentRevision.get(candidate.turnId) || 0) &&
      candidate.playerId === handoff.playerId &&
      candidate.kind === this.room.game.state.turn?.kind &&
      candidate.text === text &&
      candidate.key.endsWith(voiceSettingsKey())
        ? candidate.voice
        : undefined;
    if (!prepared) this.room.judging.invalidateCandidate();
    void this.say(
      text,
      handoff.playerId,
      handoff.intervention,
      4.5,
      prepared,
    ).catch(() => {
      if (
        this.room.game.state.turn?.id === handoff.turnId &&
        this.room.game.state.matchId === handoff.matchId
      )
        this.room.game.resume("judge");
    });
  }
  async say(
    text: string,
    target: string | null,
    intervention: boolean,
    maxSeconds = 4.5,
    prepared?: PreparedVoice,
  ) {
    if (this.speech || this.room.closed) return;
    if (intervention && !this.room.game.canIntervene()) return;
    if (intervention) this.room.game.markIntervention();
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
      turnId: this.room.game.state.turn?.id || null,
      matchId: this.room.game.state.matchId,
    };
    this.speech = speech;
    this.room.game.bufferJudge({
      id: speech.id,
      epoch,
      text: limited,
      status: "buffering",
      startAt: null,
      expression: intervention ? "smug" : "happy",
      targetPlayerId: target,
      cueAt: this.room.services.now(),
      turnDoneAt:
        ["ROUND", "ROUND_RESOLVE"].includes(this.room.game.state.phase) &&
        this.lastSealedTurnId &&
        this.room.game.turns.get(this.lastSealedTurnId)?.roundId ===
          this.room.game.state.roundId
          ? this.turnDoneAt.get(this.lastSealedTurnId)
          : undefined,
    });
    this.room.game.emit("judge_buffer");
    const began = this.room.services.now();
    const source = prepared || this.room.services.fixedVoice(limited);
    this.speechCues.set(epoch, {
      at: began,
      prepared: !!source?.chunks.length,
    });
    let chunkSeq = 0,
      offset = 0;
    const cancelled = () => this.speech !== speech || this.room.closed;
    try {
      const emitChunk = (pcm: Uint8Array) => {
        if (cancelled()) return;
        const remainingBytes =
          Math.max(0, Math.floor(maxSeconds * 44100) - offset) * 4;
        if (!remainingBytes) return;
        pcm = pcm.subarray(0, remainingBytes);
        const data = encodeJudgeAudio(epoch, chunkSeq++, offset, pcm);
        offset += pcm.byteLength / 4;
        const sockets = [...this.room.seats.values()].map((seat) =>
          seat.sockets.get("audio"),
        );
        if (
          sockets.length !== 2 ||
          sockets.some(
            (ws) =>
              ws?.readyState !== WebSocket.OPEN || ws.bufferedAmount > 1000000,
          )
        )
          throw new Error("Shared audio delivery unavailable");
        for (const ws of sockets)
          ws!.send(data, (error) => {
            if (error && !cancelled()) this.voiceFailure();
          });
        speech.duration = offset / 44100;
        if (chunkSeq === 1) {
          this.room.recordMetric(
            "speechGenerationMs",
            this.room.services.now() - began,
          );
          speech.timer = this.room.later(() => {
            if (this.speech === speech) this.voiceFailure();
          }, 2000);
        }
      };
      if (source) await source.stream(emitChunk, cancelled);
      else
        await this.room.services.streamVoice(
          limited,
          emitChunk,
          cancelled,
          maxSeconds,
        );
      if (cancelled()) return;
      speech.done = true;
      if (!speech.duration) throw new Error("Empty speech");
      if (speech.startedAt) this.scheduleSpeechEnd(speech);
    } catch {
      if (cancelled()) return;
      this.voiceFailure();
    }
  }
  voiceFailure() {
    if (!this.speech || this.room.closed) return;
    this.room.recordFailure("voice_delivery");
    this.room.game.degrade(
      "tts",
      "Judge voice unavailable. The same verdict and captions are shared.",
    );
    this.cancelSpeech();
    this.room.game.emit("voice_recovery");
    this.startHostCue();
    if (this.room.game.state.phase === "ROUND_RESOLVE") {
      this.room.game.finishRoundPresentation();
    }
  }
  audioReady(id: string, utteranceId: string, epoch: number) {
    const s = this.speech;
    if (!s || s.id !== utteranceId || s.epoch !== epoch) return;
    s.ready.add(id);
    if (s.ready.size === this.room.game.state.players.length)
      this.beginSpeech(s);
  }
  beginSpeech(s: NonNullable<JudgePlayback["speech"]>) {
    if (
      this.speech !== s ||
      s.startedAt ||
      !s.duration ||
      s.ready.size !== this.room.game.state.players.length
    )
      return;
    if (s.timer) this.room.services.clearTimeout(s.timer);
    s.startedAt = this.room.services.now() + 150;
    const cue = this.speechCues.get(s.epoch);
    this.metricsCue.push({
      cueAt: cue?.at || this.room.services.now(),
      startedAt: s.startedAt,
      latencyMs: s.startedAt - (cue?.at || this.room.services.now()),
      prepared: cue?.prepared || false,
    });
    if (this.metricsCue.length > 100) this.metricsCue.shift();
    this.room.game.startJudge(s.epoch, s.startedAt);
    this.room.game.emit("judge_started", {
      startAt: s.startedAt,
      epoch: s.epoch,
    });
    this.room.later(() => {
      if (this.speech === s) this.room.game.pause("judge");
    }, 150);
    s.timer = this.room.later(
      () => this.finishSpeech(s),
      s.maxSeconds * 1000 + 150,
    );
    if (s.done) this.scheduleSpeechEnd(s);
  }
  scheduleSpeechEnd(s: NonNullable<JudgePlayback["speech"]>) {
    if (s.timer) this.room.services.clearTimeout(s.timer);
    s.timer = this.room.later(
      () => this.finishSpeech(s),
      Math.max(0, s.startedAt! + s.duration * 1000 - this.room.services.now()) +
        80,
    );
  }
  finishSpeech(s: NonNullable<JudgePlayback["speech"]>) {
    if (this.speech !== s) return;
    if (s.timer) this.room.services.clearTimeout(s.timer);
    this.speech = null;
    this.room.game.silenceJudge(s.epoch);
    if (this.pendingHandoff) this.startHandoff();
    else if (
      this.room.game.state.matchId === s.matchId &&
      this.room.game.state.turn?.id === s.turnId
    )
      this.room.game.resume("judge");
    this.speechCues.delete(s.epoch);
    this.room.game.emit("judge_finished");
    this.startHostCue();
    if (!this.speech && this.room.game.state.phase === "ROUND_RESOLVE") {
      this.room.game.finishRoundPresentation();
    } else if (!this.speech && this.room.game.state.phase === "ROUND")
      this.room.judging.prepareHandoff();
  }
  cancelSpeech() {
    const s = this.speech;
    if (!s) return;
    this.speech = null;
    if (s.timer) this.room.services.clearTimeout(s.timer);
    this.speechEpoch++;
    this.room.game.silenceJudge(s.epoch);
    if (
      this.room.game.state.phase === "RECOVERING" ||
      this.room.game.state.phase === "ABORTED"
    )
      this.pendingHandoff = null;
    else if (this.pendingHandoff) this.startHandoff();
    else if (
      this.room.game.state.matchId === s.matchId &&
      this.room.game.state.turn?.id === s.turnId
    )
      this.room.game.resume("judge");
    this.speechCues.delete(s.epoch);
    this.room.game.emit("judge_cancelled", { epoch: s.epoch });
  }
}
