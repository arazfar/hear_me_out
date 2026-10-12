import { WebSocket } from "ws";
import { decodeMicrophone } from "../../shared/media.js";
import { canSpeak } from "../../shared/domain.js";
import type { RoomController } from "../rooms/room.js";
export class RoomMedia {
  constructor(readonly room: RoomController) {}
  rtcTimer: ReturnType<typeof setTimeout> | null = null;
  audio(id: string, raw: Buffer) {
    const packet = decodeMicrophone(raw),
      seat = this.room.seats.get(id);
    if (
      !packet ||
      !seat ||
      packet.epoch !== this.room.game.state.mediaEpoch ||
      packet.seq <= seat.audioSeq ||
      packet.seq > seat.audioSeq + 4096 ||
      packet.capturedAt > this.room.services.now() + 1000
    )
      return;
    const { seq, capturedAt } = packet;
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
      capturedAt <= boundary.capturedBefore;
    const pcm =
      allowed || draining
        ? Buffer.from(packet.pcm)
        : Buffer.alloc(packet.pcm.length);
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
      this.room.services.now() - capturedAt < 250
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
