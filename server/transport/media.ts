import { WebSocket } from "ws";
import {
  decodeMicrophone,
  RELAY_AUDIO_MAX_AGE_MS,
} from "../../shared/media.js";
import type { Command } from "../../shared/protocol.js";
import type { RoomController } from "../rooms/room.js";
export class RoomMedia {
  constructor(readonly room: RoomController) {}
  rtcTimer: ReturnType<typeof setTimeout> | null = null;
  audioRejections = {
    invalid: 0,
    epoch: 0,
    sequence: 0,
    stale: 0,
    future: 0,
    messages: 0,
    bytes: 0,
    relayAge: 0,
  };
  private rejectAudio(reason: keyof RoomMedia["audioRejections"]) {
    this.audioRejections[reason] = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.audioRejections[reason] + 1,
    );
  }
  audio(id: string, raw: Buffer) {
    const packet = decodeMicrophone(raw),
      seat = this.room.seats.get(id);
    if (!seat) return;
    const now = this.room.services.now(),
      limited = seat.audioBudget.admit(raw.length, now);
    if (!packet) return this.rejectAudio("invalid");
    if (packet.epoch !== this.room.game.state.mediaEpoch)
      return this.rejectAudio("epoch");
    if (packet.seq <= seat.audioSeq || packet.seq > seat.audioSeq + 4096)
      return this.rejectAudio("sequence");
    if (packet.capturedAt < now - 3000) return this.rejectAudio("stale");
    if (packet.capturedAt > now + 1000) return this.rejectAudio("future");
    if (limited) {
      this.rejectAudio(limited);
      const check = this.room.readiness.get(id);
      if (this.room.readiness.testing(id)) {
        if (
          packet.purpose === "private" &&
          packet.inputEpoch === check.inputEpoch
        ) {
          this.room.readiness.failed(
            id,
            "Your mic audio arrived too quickly. Try the mic check again.",
          );
          this.room.transcription.stopCheck(id);
        }
      } else if (this.room.turnCoordinator.acceptsCapture(id, packet)) {
        this.room.game.abort(
          "Part of that turn’s audio couldn’t be received. No verdict was issued. Start a fresh match.",
        );
      }
      return;
    }
    const { seq, capturedAt } = packet;
    seat.audioSeq = seq;
    seat.lastAudioAt = this.room.services.now();
    if (this.room.readiness.testing(id)) {
      const check = this.room.readiness.get(id);
      if (
        packet.purpose === "private" &&
        packet.inputEpoch === check.inputEpoch &&
        !packet.end
      )
        this.room.transcription.checkAudio(id, packet.pcm);
      return;
    }
    // Purpose is fixed at capture, never inferred from arrival-time turn ownership.
    if (packet.purpose === "private") return;
    const eligible = this.room.turnCoordinator.capture(id, packet);
    const stream = this.room.transcription.ink.get(id);
    if (eligible) {
      const cutoff = this.room.turnCoordinator.captureCutoff();
      const samples = Math.min(
        packet.samples,
        Math.max(0, Math.floor((cutoff - packet.capturedAt) * 16) + 1),
      );
      if (samples)
        this.room.transcription.sendGameplay(
          id,
          Buffer.from(packet.pcm.subarray(0, samples * 2)),
        );
      this.room.recordMetric(
        "captureToServerMs",
        Math.max(0, this.room.services.now() - packet.capturedAt),
      );
    } else if (!packet.end && stream?.connected && !stream.closing) {
      // Provider turn detection needs time to pass even when gameplay input is closed.
      // Off-turn/social PCM itself is never sent to STT.
      stream.send(Buffer.alloc(packet.samples ? packet.samples * 2 : 640));
    }
    if (packet.end || packet.purpose === "health") return;
    const pcm = Buffer.from(packet.pcm);
    let rms = 0;
    for (let i = 0; i < pcm.length; i += 16)
      rms += (pcm.readInt16LE(i) / 32768) ** 2;
    rms = Math.sqrt(rms / Math.max(1, pcm.length / 16));
    if (rms > 0.018) seat.voiceAt = this.room.services.now();
    if (this.room.game.state.mediaMode !== "rtc") {
      if (this.room.services.now() - capturedAt <= RELAY_AUDIO_MAX_AGE_MS)
        this.forward(id, "audio", raw);
      else this.rejectAudio("relayAge");
    }
    if (this.room.services.now() - seat.lastActivity > 250) {
      seat.lastActivity = this.room.services.now();
      this.room.broadcast({
        type: "activity",
        playerId: id,
        level: Math.min(1, rms * 8),
      });
    }
  }
  forward(id: string, channel: string, raw: Buffer) {
    for (const [otherId, seat] of this.room.seats) {
      const ws = seat.sockets.get(channel);
      if (
        otherId !== id &&
        (channel !== "audio" || !this.room.readiness.testing(otherId)) &&
        ws?.readyState === WebSocket.OPEN &&
        ws.bufferedAmount < (channel === "video" ? 12000 : 8000)
      )
        ws.send(raw);
    }
  }
  mediaStatus(
    id: string,
    observation: Extract<Command, { type: "media_status" }>,
  ) {
    this.room.readiness.observe(id, observation);
    if (this.room.game.state.mediaMode === "rtc" && observation.rtcFailed)
      this.setMedia("wss");
    this.selectMode();
  }
  selectMode() {
    if (this.room.game.state.mediaMode === "rtc") {
      const stalled =
        this.room.game.state.players.every((p) => p.captureReady) &&
        this.room.game.state.players.some((p) =>
          p.readiness?.blockers.includes("peer_video"),
        );
      if (stalled && !this.rtcTimer)
        this.rtcTimer = this.room.later(() => {
          this.rtcTimer = null;
          this.setMedia("wss");
        }, 3000);
      else if (!stalled && this.rtcTimer) {
        this.room.services.clearTimeout(this.rtcTimer);
        this.rtcTimer = null;
      }
      return;
    }
    if (
      this.room.game.state.mediaMode === "connecting" &&
      this.room.game.state.players.length === 2 &&
      this.room.game.state.players.every((p) => p.captureReady)
    ) {
      if (
        this.room.game.state.players.every(
          (p) => this.room.seats.get(p.id)?.rtcReady,
        ) &&
        process.env.FORCE_WSS !== "true"
      )
        this.setMedia("rtc");
      else if (!this.rtcTimer)
        this.rtcTimer = this.room.later(
          () => this.setMedia("wss"),
          process.env.FORCE_WSS === "true" ? 100 : 8000,
        );
    }
  }
  setMedia(mode: "rtc" | "wss") {
    if (this.room.game.state.mediaMode === mode) return;
    this.room.game.setMediaMode(mode);
    if (this.rtcTimer) this.room.services.clearTimeout(this.rtcTimer);
    this.rtcTimer = null;
    this.room.game.emit("media_mode_changed", { mode });
  }
}
