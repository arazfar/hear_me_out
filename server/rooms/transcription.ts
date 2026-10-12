import type { RoomController } from "./room.js";
import { type TranscriptionStream } from "./services.js";
export class Transcription {
  constructor(readonly room: RoomController) {}
  ink = new Map<string, TranscriptionStream>();
  sealedAudio = new Map<
    string,
    {
      turnId: string;
      maxSeq: number;
      capturedBefore: number;
      expiresAt: number;
    }
  >();
  retries = new Map<string, number>();
  rotate(id: string, turnId: string | null) {
    if (
      this.room.closed ||
      ["LOBBY", "MATCH_RESULT", "ABORTED"].includes(
        this.room.game.state.phase,
      ) ||
      !this.room.services.transcriptionAvailable() ||
      !this.room.seats.get(id)?.sockets.has("audio") ||
      this.room.game.state.degraded.stt
    )
      return;
    const old = this.ink.get(id);
    if (
      old &&
      !old.closing &&
      !old.failed &&
      old.turnId === turnId &&
      old.roundId === (this.room.game.state.roundId || "")
    )
      return;
    const matchId = this.room.game.state.matchId;
    const stream = this.room.services.createTranscription(
      id,
      this.room.game.state.roundId || "",
      turnId,
      {
        caption: (text, final) => {
          if (this.room.closed || matchId !== this.room.game.state.matchId)
            return;
          // A draining old session must never overwrite the new epoch's captions.
          if (
            this.ink.get(id) !== stream &&
            !(
              turnId &&
              this.room.game.state.turn?.id === turnId &&
              this.room.game.state.turn.sealing &&
              this.room.game.state.turn.settlement === "draining"
            )
          )
            return;
          this.room.game.caption(id, text, final);
          this.room.game.emit("transcript", {
            playerId: id,
            text,
            final,
            turnId,
          });
        },
        segment: (segment) => {
          if (!this.room.closed && matchId === this.room.game.state.matchId)
            this.room.judging.onSegment(segment);
        },
        start: () => {
          if (this.ink.get(id) === stream) {
            this.room.game.speechStarted(id);
          }
        },
        end: () => {
          if (this.ink.get(id) === stream && turnId) this.room.game.thought(id);
        },
        error: () => {
          if (this.ink.get(id) === stream) this.sttFailure(id, turnId);
        },
      },
    );
    this.ink.set(id, stream);
    old?.close();
  }
  sttFailure(id: string, turnId: string | null) {
    if (this.room.closed || this.room.game.state.phase === "RECOVERING") return;
    this.room.recordFailure("transcription");
    const key = `${id}:${turnId || "off"}`,
      count = this.retries.get(key) ?? 0;
    this.retries.set(key, count + 1);
    if (!count) {
      this.room.game.pause("transcription");
      this.room.later(() => {
        if (
          this.room.game.state.turn?.id !== turnId ||
          this.room.game.state.phase !== "ROUND"
        )
          return;
        this.rotate(id, turnId);
        this.room.game.resume("transcription");
      }, 700);
    } else {
      this.room.game.degrade(
        "stt",
        "Transcription unavailable. Both players can type arguments; live audio stays on.",
      );
      for (const stream of this.ink.values()) stream.close();
      this.ink.clear();
      this.room.game.resume("transcription");

      this.room.game.emit("recovery");
    }
  }
}
