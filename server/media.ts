import { WebSocket } from "ws";
import { canSpeak } from "../shared/types.js";
import type { Controller } from "./controller.js";
export class RoomMedia {
  constructor(readonly room: Controller) {}
  rtcTimer: ReturnType<typeof setTimeout> | null = null;
  audio(id: string, raw: Buffer) {
    if (
      raw.length < 17 ||
      raw[0] !== 1 ||
      raw.length > 4096 ||
      raw.readUInt32LE(9) !== 16000 ||
      raw.readUInt32LE(1) !== this.room.game.state.mediaEpoch ||
      (raw.length - 17) % 2 !== 0
    )
      return;
    const headerBytes = raw.length - raw.readUInt32LE(13) * 2;
    if (headerBytes !== 17 && headerBytes !== 25) return;
    const seat = this.room.seats.get(id)!;
    const seq = raw.readUInt32LE(5);
    if (seq <= seat.audioSeq) return;
    seat.audioSeq = seq;
    seat.lastAudioAt = this.room.services.now();
    const allowed = canSpeak(this.room.game.state, id);
    const boundary = this.room.transcription.sealedAudio.get(id);
    const draining =
      !!boundary &&
      this.room.game.state.phase === "ROUND" &&
      this.room.game.state.turn?.id === boundary.turnId &&
      this.room.game.state.turn.sealing &&
      this.room.services.now() <= boundary.expiresAt &&
      seq <= boundary.maxSeq &&
      headerBytes === 25 &&
      raw.readDoubleLE(17) <= boundary.capturedBefore;
    const pcm =
      allowed || draining
        ? raw.subarray(headerBytes)
        : Buffer.alloc(raw.length - headerBytes);
    this.room.transcription.ink.get(id)?.send(pcm);
    if (!allowed) {
      seat.voiceAt = 0;
      return;
    }
    let rms = 0;
    for (let i = 0; i < pcm.length; i += 16)
      rms += (pcm.readInt16LE(i) / 32768) ** 2;
    rms = Math.sqrt(rms / Math.max(1, pcm.length / 16));
    if (rms > 0.018) seat.voiceAt = this.room.services.now();
    if (
      this.room.game.state.mediaMode !== "rtc" &&
      (headerBytes === 17 ||
        this.room.services.now() - raw.readDoubleLE(17) < 250)
    )
      this.forward(id, "audio", raw);
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
        ws?.readyState === WebSocket.OPEN &&
        ws.bufferedAmount < (channel === "video" ? 12000 : 8000)
      )
        ws.send(raw);
    }
  }
  mediaStatus(id: string, ready: boolean, cameraOn: boolean, rtc: boolean) {
    const seat = this.room.seats.get(id)!,
      player = this.room.game.player(id);
    seat.rtcReady = rtc;
    this.room.game.setCaptureReady(
      id,
      cameraOn,
      ready &&
        !!seat.sockets.get("audio") &&
        this.room.services.now() - seat.lastAudioAt < 2000,
    );
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
    this.room.game.setMediaReady(
      id,
      player.captureReady && this.room.game.state.mediaMode !== "connecting",
    );
    this.room.game.emit("media_status");
    if (
      this.room.game.state.phase === "RECOVERING" &&
      this.room.game.state.players.every((p) => p.connected && p.mediaReady)
    )
      this.room.game.resumeRecovery();
  }
  setMedia(mode: "rtc" | "wss") {
    if (this.room.game.state.mediaMode === mode) return;
    this.room.game.setMediaMode(mode);
    if (this.rtcTimer) this.room.services.clearTimeout(this.rtcTimer);
    this.rtcTimer = null;
    this.room.game.emit("media_mode_changed", { mode });
  }
}
