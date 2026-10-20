import type { RoomController } from "./room.js";
import { type TranscriptionStream } from "./services.js";

type Purpose =
  | { kind: "idle" }
  | { kind: "turn"; turnId: string }
  | { kind: "check"; checkId: string; captureId: string; epoch: number };

export class Transcription {
  constructor(readonly room: RoomController) {}
  ink = new Map<string, TranscriptionStream>();
  active = new Set<TranscriptionStream>();
  // Physical closure can precede turn settlement. Keep completed contributors
  // as well as draining ones until all evidence for this turn is sealed.
  private contributors = new Map<
    string,
    { matchId: string | null; streams: Set<TranscriptionStream> }
  >();
  private reportedFailures = new WeakSet<TranscriptionStream>();
  private waiting = new Map<
    string,
    { requestedTurn?: string | null; force: boolean }
  >();
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
  openedAt = new Map<string, number>();
  private retryVersions = new Map<string, number>();
  private purposes = new WeakMap<TranscriptionStream, Purpose>();
  private purpose(id: string, requestedTurn?: string | null): Purpose {
    const check = this.room.readiness.get(id);
    if (check.setup === "checking")
      return {
        kind: "check",
        checkId: check.checkId,
        captureId: check.captureId,
        epoch: this.room.seats.get(id)!.epoch,
      };
    const { turn, phase } = this.room.game.state;
    if (!["ROUND", "RECOVERING"].includes(phase)) return { kind: "idle" };
    const turnId =
      requestedTurn === undefined
        ? check.passed &&
          ["ROUND", "RECOVERING"].includes(phase) &&
          turn?.playerId === id &&
          !turn.sealing
          ? turn.id
          : null
        : requestedTurn;
    return turnId ? { kind: "turn", turnId } : { kind: "idle" };
  }
  private ownsCheck(id: string, purpose: Purpose) {
    const check = this.room.readiness.get(id);
    return (
      purpose.kind === "check" &&
      check.setup === "checking" &&
      check.checkId === purpose.checkId &&
      check.captureId === purpose.captureId &&
      this.room.seats.get(id)?.epoch === purpose.epoch
    );
  }
  checkStream(id: string) {
    const stream = this.ink.get(id),
      purpose = stream && this.purposes.get(stream);
    return stream &&
      purpose &&
      this.ownsCheck(id, purpose) &&
      stream.connected &&
      !stream.closing &&
      !stream.failed
      ? stream
      : undefined;
  }
  checkAudio(id: string, pcm: Uint8Array) {
    const stream = this.checkStream(id);
    if (!stream || !this.room.readiness.get(id).listening) return;
    this.room.readiness.audio(id, pcm);
    stream.send(Buffer.from(pcm));
  }
  private retain(stream: TranscriptionStream) {
    const turnId = stream.turnId!,
      matchId = this.room.game.state.matchId;
    let record = this.contributors.get(turnId);
    if (!record || record.matchId !== matchId) {
      record = { matchId, streams: new Set() };
      this.contributors.set(turnId, record);
    }
    record.streams.add(stream);
    return record;
  }
  private recordFailure(stream?: TranscriptionStream) {
    if (stream && this.reportedFailures.has(stream)) return;
    if (stream) this.reportedFailures.add(stream);
    this.room.recordFailure("transcription");
  }
  private failEvidence(stream: TranscriptionStream) {
    const { game } = this.room;
    const record = stream.turnId && this.contributors.get(stream.turnId);
    if (
      this.room.closed ||
      !record ||
      !record.streams.has(stream) ||
      record.matchId !== game.state.matchId ||
      stream.turnId !== game.state.turn?.id ||
      !["ROUND", "RECOVERING"].includes(game.state.phase)
    )
      return false;
    this.recordFailure(stream);
    game.abort("Bonk couldn’t finish that turn. Start a fresh match.");
    return true;
  }
  /** Only eligible, cutoff-trimmed gameplay PCM belongs in this method. */
  sendGameplay(id: string, pcm: Buffer) {
    const stream = this.ink.get(id),
      turn = this.room.game.state.turn;
    if (!turn || turn.playerId !== id) return;
    if (stream?.turnId !== turn.id) {
      this.recordFailure();
      this.room.game.abort(
        "Bonk couldn’t finish that turn. Start a fresh match.",
      );
      return;
    }
    // send() may synchronously report a provider failure.
    this.retain(stream);
    try {
      stream.send(pcm);
    } catch {
      this.sttFailure(id, turn.id);
    }
  }
  async settleTurn(id: string, turnId: string) {
    const current = this.ink.get(id);
    if (current?.turnId !== turnId) {
      this.recordFailure();
      return false;
    }
    const record = this.retain(current);
    this.ink.delete(id);
    this.openedAt.delete(id);
    const outcomes = await Promise.all(
      [...record.streams].map(async (stream) => {
        const ok = await stream.close().catch(() => false);
        if (!ok) this.failEvidence(stream);
        return ok;
      }),
    );
    if (this.contributors.get(turnId) === record)
      this.contributors.delete(turnId);
    return outcomes.every(Boolean);
  }
  resetEvidence() {
    this.contributors.clear();
  }
  disconnect(id: string) {
    const stream = this.ink.get(id);
    this.ink.delete(id);
    this.openedAt.delete(id);
    this.room.readiness.disconnected(id);
    void stream?.close();
  }
  release(id: string) {
    const stream = this.ink.get(id);
    this.ink.delete(id);
    this.openedAt.delete(id);
    this.sealedAudio.delete(id);
    this.retries.delete(id);
    this.retryVersions.delete(id);
    this.waiting.delete(id);
    void stream?.close();
  }
  stopCheck(id: string) {
    this.waiting.delete(id);
    this.retryVersions.set(id, (this.retryVersions.get(id) || 0) + 1);
    const stream = this.ink.get(id);
    if (stream?.turnId === null) {
      this.ink.delete(id);
      this.openedAt.delete(id);
      void stream.close();
    }
  }
  retireGameplay() {
    this.resetEvidence();
    this.sealedAudio.clear();
    for (const id of this.room.seats.keys()) {
      if (this.room.readiness.get(id).setup !== "checking") {
        this.waiting.delete(id);
        this.retryVersions.set(id, (this.retryVersions.get(id) || 0) + 1);
      }
      const stream = this.ink.get(id);
      if (stream?.turnId) {
        this.ink.delete(id);
        this.openedAt.delete(id);
      }
    }
    // Includes draining old epochs and a prepared successor, not just ink.
    for (const stream of this.active)
      if (stream.turnId !== null) void stream.close();
  }
  connecting(id: string) {
    const s = this.ink.get(id);
    return (
      !!s &&
      !s.failed &&
      !s.closing &&
      !s.connected &&
      this.room.services.now() - (this.openedAt.get(id) ?? 0) < 10000
    );
  }
  rotate(id: string, requestedTurn?: string | null, force = false) {
    const seat = this.room.seats.get(id);
    if (
      this.room.closed ||
      !this.room.services.transcriptionAvailable() ||
      !seat?.sockets.has("audio")
    )
      return;
    const old = this.ink.get(id),
      purpose = this.purpose(id, requestedTurn),
      turnId = purpose.kind === "turn" ? purpose.turnId : null;
    if (
      !force &&
      old &&
      !old.closing &&
      !old.failed &&
      JSON.stringify(this.purposes.get(old)) === JSON.stringify(purpose) &&
      old.roundId === (this.room.game.state.roundId || "")
    )
      return;
    if (purpose.kind === "idle") {
      this.ink.delete(id);
      this.openedAt.delete(id);
      void old?.close();
      return;
    }
    if (this.active.size >= 4) {
      this.waiting.set(id, { requestedTurn, force });
      return;
    }
    this.waiting.delete(id);
    const matchId = this.room.game.state.matchId;
    const roundId = this.room.game.state.roundId || "";
    const ownsSeat = () =>
      !this.room.closed && this.room.seats.get(id) === seat;
    const acceptsEvidence = () =>
      ownsSeat() &&
      matchId === this.room.game.state.matchId &&
      ["ROUND", "RECOVERING"].includes(this.room.game.state.phase);
    this.retryVersions.set(id, (this.retryVersions.get(id) || 0) + 1);
    if (purpose.kind === "check") this.room.readiness.disconnected(id);
    const stream = this.room.services.createTranscription(id, roundId, turnId, {
      caption: (text, final) => {
        if (purpose.kind !== "turn") return;
        if (!acceptsEvidence()) return;
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
        if (!ownsSeat()) return;
        if (purpose.kind === "check") {
          if (this.ink.get(id) === stream && this.ownsCheck(id, purpose))
            this.room.readiness.transcript(id, segment.text);
        } else if (
          purpose.kind === "turn" &&
          acceptsEvidence() &&
          segment.playerId === id &&
          segment.roundId === roundId &&
          segment.turnId === turnId
        )
          this.room.judging.onSegment(segment);
      },
      start: () => {
        if (turnId && acceptsEvidence() && this.ink.get(id) === stream) {
          this.room.game.speechStarted(id);
        }
      },
      end: () => {
        if (turnId && acceptsEvidence() && this.ink.get(id) === stream)
          this.room.game.thought(id);
      },
      error: () => {
        if (ownsSeat() && this.ink.get(id) === stream)
          this.sttFailure(id, turnId);
      },
    });
    this.active.add(stream);
    const close = stream.close.bind(stream);
    let closing: Promise<boolean> | undefined;
    stream.close = () =>
      (closing ||= close()
        .catch(() => false)
        .then((ok) => {
          if (!ok) this.failEvidence(stream);
          return ok;
        })
        .finally(() => {
          this.active.delete(stream);
          const pending = [...this.waiting];
          this.waiting.clear();
          for (const [player, request] of pending)
            this.rotate(player, request.requestedTurn, request.force);
        }));
    this.purposes.set(stream, purpose);
    this.ink.set(id, stream);

    this.openedAt.set(id, this.room.services.now());
    old?.close();
  }
  sttFailure(id: string, _turnId: string | null) {
    if (this.room.closed) return;
    const stream = this.ink.get(id);
    this.recordFailure(stream);
    this.ink.delete(id);
    void stream?.close();
    if (stream && this.failEvidence(stream)) return;
    this.room.readiness.failed(id);
    const count = this.retries.get(id) || 0;
    const version = (this.retryVersions.get(id) || 0) + 1;
    this.retryVersions.set(id, version);
    this.retries.set(id, count + 1);
    if (count < 4)
      this.room.later(
        () => {
          if (
            this.retryVersions.get(id) === version &&
            !this.ink.has(id) &&
            this.room.seats.has(id)
          )
            this.rotate(id);
        },
        Math.min(4000, 700 * 2 ** count),
      );
  }
}
