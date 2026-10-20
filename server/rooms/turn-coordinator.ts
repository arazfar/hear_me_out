import { randomUUID } from "node:crypto";
import type { decodeMicrophone } from "../../shared/media.js";
import type { RoomController } from "./room.js";
type Packet = NonNullable<ReturnType<typeof decodeMicrophone>>;

/** Device readiness, provider preparation and capture ownership are independent. */
export class TurnCoordinator {
  constructor(readonly room: RoomController) {}
  private epoch = 0;
  private advancing = false;
  private draining = new Set<string>();
  private ends = new Map<number, { seq: number; at: number }>();
  private heldInput: {
    epoch: number;
    before: number;
    expiresAt: number;
  } | null = null;
  nextEpoch() {
    return ++this.epoch;
  }
  assigned() {
    const t = this.room.game.state.turn;
    if (!t) return;
    this.room.game.holdFloorForJudge();
    t.inputState = "preparing";
    t.inputEpoch = undefined;
    this.heldInput = null;
  }
  holdInput() {
    const t = this.room.game.state.turn;
    if (!t?.inputEpoch || !["open", "granted"].includes(t.inputState || ""))
      return;
    const now = this.room.services.now();
    this.heldInput = {
      epoch: t.inputEpoch,
      before: Math.min(now, t.deadline ?? now),
      expiresAt: now + 3000,
    };
  }
  captureCutoff() {
    const t = this.room.game.state.turn;
    return Math.min(
      t
        ? (this.room.transcription.sealedAudio.get(t.playerId)
            ?.capturedBefore ??
            t.deadline ??
            Infinity)
        : -Infinity,
      this.heldInput && this.heldInput.epoch === t?.inputEpoch
        ? this.heldInput.before
        : Infinity,
    );
  }
  /** Pure eligibility check, also used before rejecting rate-limited evidence. */
  acceptsCapture(id: string, packet: Packet) {
    const { game, transcription } = this.room,
      t = game.state.turn;
    if (
      !t ||
      game.state.phase !== "ROUND" ||
      t.playerId !== id ||
      packet.purpose !== "gameplay" ||
      packet.inputEpoch !== t.inputEpoch ||
      !packet.inputEpoch ||
      packet.capturedAt < (t.inputGrantedAt ?? Infinity) - 50 ||
      transcription.ink.get(id)?.turnId !== t.id
    )
      return false;
    if (packet.end) {
      const boundary = transcription.sealedAudio.get(id);
      return (
        !t.sealing ||
        (!!boundary &&
          (!Number.isFinite(boundary.maxSeq) || packet.seq === boundary.maxSeq))
      );
    }
    if (this.ends.has(packet.inputEpoch)) return false;
    const boundary = transcription.sealedAudio.get(id);
    if (t.sealing)
      return (
        !!boundary &&
        packet.seq <= boundary.maxSeq &&
        packet.capturedAt <= boundary.capturedBefore &&
        this.room.services.now() <= boundary.expiresAt
      );
    if (this.heldInput?.epoch === packet.inputEpoch)
      return (
        packet.capturedAt <= this.heldInput.before &&
        this.room.services.now() <= this.heldInput.expiresAt
      );
    return (
      (!game.state.judge || game.state.judge.status === "silent") &&
      ((t.inputState === "granted" &&
        packet.capturedAt <=
          Math.max(
            t.inputGrantedAt!,
            Math.min(this.room.services.now(), packet.capturedAt),
          ) +
            t.remainingMs) ||
        (t.inputState === "open" &&
          !t.pausedReason &&
          packet.capturedAt <= (t.deadline ?? -Infinity)))
    );
  }
  capture(id: string, packet: Packet) {
    if (!this.acceptsCapture(id, packet)) return false;
    const { game } = this.room,
      t = game.state.turn!;
    if (packet.end) {
      this.ends.set(packet.inputEpoch, {
        seq: packet.seq,
        at: packet.capturedAt,
      });
      if (t.sealing) void this.drain(t.id);
      return false;
    }
    if (
      t.inputState === "granted" &&
      !t.sealing &&
      this.heldInput?.epoch !== packet.inputEpoch
    ) {
      this.room.recordMetric(
        "grantToCaptureMs",
        Math.max(0, this.room.services.now() - t.inputGrantedAt!),
      );
      game.openInput(
        packet.inputEpoch,
        Math.max(
          t.inputGrantedAt!,
          Math.min(this.room.services.now(), packet.capturedAt),
        ),
      );
      this.room.trace("input_first_capture", {
        playerId: id,
        turnId: t.id,
        inputEpoch: packet.inputEpoch,
        capturedAt: packet.capturedAt,
      });
    }
    return true;
  }
  sealed(lastAudioSeq: number, capturedBefore: number) {
    const { game, transcription } = this.room,
      t = game.state.turn!;
    t.inputState = "sealing";
    const end = t.inputEpoch ? this.ends.get(t.inputEpoch) : undefined;
    transcription.sealedAudio.set(t.playerId, {
      turnId: t.id,
      maxSeq: lastAudioSeq >= 0 ? lastAudioSeq : Infinity,
      capturedBefore: Math.min(
        capturedBefore,
        end?.at ?? Infinity,
        this.captureCutoff(),
      ),
      expiresAt: this.room.services.now() + 3000,
    });
    this.room.trace("turn_seal", {
      playerId: t.playerId,
      turnId: t.id,
      inputEpoch: t.inputEpoch,
    });
    this.prepareSuccessor();
    if (end && (lastAudioSeq < 0 || end.seq === lastAudioSeq))
      void this.drain(t.id);
    else
      this.room.later(() => {
        if (
          game.state.turn?.id === t.id &&
          game.state.turn.settlement === "draining" &&
          !this.draining.has(t.id)
        )
          game.abort(
            "The end of that turn didn’t arrive. No verdict was issued. Start a fresh match.",
          );
      }, 3000);
  }
  private prepareSuccessor() {
    const { game } = this.room,
      turn = game.state.turn;
    const next = game.order[game.state.turnIndex + 1];
    if (!next || !turn || next.playerId === turn.playerId || game.nextTurnId)
      return;
    game.nextTurnId = randomUUID();
    this.room.transcription.rotate(next.playerId, game.nextTurnId);
  }
  private async drain(turnId: string) {
    const { game, transcription } = this.room,
      t = game.state.turn;
    if (!t || t.id !== turnId || !t.sealing || this.draining.has(turnId))
      return;
    const matchId = game.state.matchId;
    this.draining.add(turnId);
    transcription.sealedAudio.delete(t.playerId);
    const stream = transcription.ink.get(t.playerId);
    transcription.ink.delete(t.playerId);
    const drained = !stream || (await stream.close());
    this.draining.delete(turnId);
    if (
      this.room.closed ||
      game.state.matchId !== matchId ||
      game.state.turn?.id !== turnId
    )
      return;
    if (!drained) {
      this.room.recordFailure("transcription");
      game.abort("Bonk couldn’t finish that turn. Start a fresh match.");
      return;
    }
    game.setSettlement(
      this.room.judging.busy || this.room.judging.queue.length
        ? "scoring"
        : "ready",
    );
    this.room.trace("transcript_drained", { turnId });
    game.emit("turn_settlement");
    this.room.judging.prepareHandoff();
    this.advance();
  }
  advance() {
    if (this.advancing || this.room.closed) return;
    this.advancing = true;
    try {
      const { game } = this.room;
      game.tick();
      const t = game.state.turn;
      if (!t || game.state.phase !== "ROUND" || t.sealing) return;
      if (t.inputState === "granted") {
        if (this.room.services.now() - t.inputGrantedAt! >= 3000)
          game.recover(
            `${game.player(t.playerId).name}’s microphone isn’t arriving. Your time is on hold.`,
          );
        return;
      }
      if (t.inputState === "open" && !t.pausedReason) return;
      if (
        this.room.playback.speech ||
        this.room.playback.pendingHandoff ||
        !game.allMediaReady()
      )
        return;
      const stream = this.room.transcription.ink.get(t.playerId);
      if (stream?.turnId !== t.id) {
        this.room.transcription.rotate(t.playerId, t.id);
        return;
      }
      if (!stream.connected || stream.closing || stream.failed) return;
      this.heldInput = null;
      game.grantInput(this.nextEpoch());
      this.ends.clear();
      this.room.trace("input_grant", {
        playerId: t.playerId,
        turnId: t.id,
        inputEpoch: t.inputEpoch,
      });
    } finally {
      this.advancing = false;
    }
  }
}
