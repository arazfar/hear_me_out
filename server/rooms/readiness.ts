import type { Command, ServerMessage } from "../../shared/protocol.js";
import { RuleError } from "../game/game.js";
import type { RoomController } from "./room.js";

type Observation = Extract<Command, { type: "media_status" }>;
type Health = {
  captureId: string;
  cameraId: string;
  epoch: number;
  mediaEpoch: number;
  observation?: Observation;
  observedAt: number;
  localAt: number;
  remoteAt: number;
  probeAt: number;
  healthySince: number | null;
  progress?: { localFrames: number; remoteAt: number; probeAt: number };
  passed: boolean;
  setup: "needed" | "checking" | "passed" | "failed";
  checkId: string;
  inputEpoch: number;
  checkDeadline: number;
  listened: boolean;
  result?: Extract<ServerMessage, { type: "setup_result" }>;
  listening: boolean;
  heard: boolean;
  attempts: number[];
  sent: Map<number, { at: number; probe: boolean }>;
};

/** Server-owned readiness. Client observations alone can never pass the speech test. */
export class Readiness {
  records = new Map<string, Health>();
  constructor(readonly room: RoomController) {}
  get(id: string) {
    let record = this.records.get(id);
    if (!record) {
      record = {
        captureId: "",
        cameraId: "",
        epoch: -1,
        mediaEpoch: -1,
        observedAt: -Infinity,
        localAt: -Infinity,
        remoteAt: -Infinity,
        probeAt: -Infinity,
        healthySince: null,
        passed: false,
        setup: "needed",
        checkId: "",
        inputEpoch: 0,
        checkDeadline: 0,
        listened: false,
        listening: false,
        heard: false,
        attempts: [],
        sent: new Map(),
      };
      this.records.set(id, record);
    }
    return record;
  }
  observe(id: string, observation: Observation) {
    const r = this.get(id),
      seat = this.room.seats.get(id)!;
    if (observation.mediaEpoch !== this.room.game.state.mediaEpoch) return;
    const now = this.room.services.now();
    if (r.captureId !== observation.captureId) {
      this.cancel(id);
      r.passed = false;
      r.setup = "needed";
      r.captureId = observation.captureId;
      r.healthySince = null;
    }
    if (observation.micSource === false && r.setup === "checking") {
      r.setup = "failed";
      r.listening = false;
      r.checkDeadline = 0;
      this.room.transcription.stopCheck(id);
      this.result(id, "failed", "Your mic stopped. Reconnect it and retry.");
    }
    if (observation.micSource === false && r.passed) {
      this.cancel(id);
      r.passed = false;
      r.setup = "needed";
    }
    if (
      r.cameraId !== observation.cameraId ||
      r.observation?.cameraGeneration !== observation.cameraGeneration
    ) {
      r.cameraId = observation.cameraId;
      r.healthySince = null;
      r.probeAt = r.localAt = -Infinity;
      r.sent.clear();
      const other = this.room.game.state.players.find((p) => p.id !== id);
      if (other) {
        this.get(other.id).remoteAt = -Infinity;
        this.get(other.id).healthySince = null;
      }
    }
    if (r.epoch !== seat.epoch || r.mediaEpoch !== observation.mediaEpoch) {
      r.epoch = seat.epoch;
      r.mediaEpoch = observation.mediaEpoch;
      r.observation = undefined;
      r.remoteAt = r.probeAt = r.localAt = -Infinity;
      r.healthySince = null;
      r.sent.clear();
    }
    if (observation.localFrames > (r.observation?.localFrames ?? 0))
      r.localAt = now;
    if (
      observation.rtc &&
      observation.remoteFrames > (r.observation?.remoteFrames ?? 0)
    )
      r.remoteAt = now;
    r.observation = observation;
    r.observedAt = now;
    seat.rtcReady = observation.rtc;
    this.tick();
  }
  sent(id: string, seq: number, probe: boolean) {
    const r = this.get(id),
      now = this.room.services.now();
    r.sent.set(seq, { at: now, probe });
    for (const [key, frame] of r.sent)
      if (now - frame.at > 3000) r.sent.delete(key);
    while (r.sent.size > 64) r.sent.delete(r.sent.keys().next().value!);
  }
  received(id: string, seq: number, mediaEpoch: number, probe = false) {
    if (mediaEpoch !== this.room.game.state.mediaEpoch) return false;
    const sender = probe
      ? id
      : this.room.game.state.players.find((p) => p.id !== id)?.id;
    if (!sender) return false;
    const r = this.get(sender),
      frame = r.sent.get(seq);
    if (
      !frame ||
      frame.probe !== probe ||
      this.room.services.now() - frame.at > 3000
    )
      return false;
    r.sent.delete(seq);
    if (probe) r.probeAt = this.room.services.now();
    else this.get(id).remoteAt = this.room.services.now();
    return true;
  }
  start(id: string, checkId: string, captureId: string) {
    const r = this.get(id),
      now = this.room.services.now();
    // A lost result can be recovered even after its successful check reopened
    // the floor. Replaying it neither creates a provider nor extends a deadline.
    if (r.checkId === checkId && r.captureId === captureId) {
      this.expire(id, now);
      if (
        r.result &&
        (r.result.status !== "listening" ||
          this.room.transcription.checkStream(id))
      )
        this.room.send(id, r.result);
      return;
    }
    if (
      !["LOBBY", "RECOVERING", "MATCH_RESULT", "ABORTED"].includes(
        this.room.game.state.phase,
      )
    )
      throw new RuleError("Pause the game before checking your mic.");
    if (
      captureId !== r.captureId ||
      !r.observation?.mic ||
      now - r.observedAt > 3000
    )
      throw new RuleError("Connect your microphone, then try again.");
    if (!this.room.services.transcriptionAvailable())
      throw new RuleError("Bonk’s ears are offline. Try again shortly.");
    r.attempts = r.attempts.filter((at) => now - at < 60000);
    if (r.attempts.length >= 6)
      throw new RuleError("Give your mic a moment. Try again shortly.");
    this.cancel(id);
    r.attempts.push(now);
    r.checkId = checkId;
    r.inputEpoch = this.room.turnCoordinator.nextEpoch();
    r.setup = "checking";
    r.passed = false;
    r.heard = r.listening = r.listened = false;
    r.checkDeadline = now + 10000;
    this.room.transcription.rotate(id, null, true);
    this.tick();
  }
  cancel(id: string, checkId?: string) {
    const r = this.get(id);
    if (checkId && r.checkId !== checkId) return;
    if (r.setup === "checking" || r.setup === "failed") {
      r.setup = r.passed ? "passed" : "needed";
      this.room.transcription.stopCheck(id);
    }
    r.checkId = "";
    r.result = undefined;
    r.listening = false;
    r.checkDeadline = 0;
  }
  disconnected(id: string) {
    const r = this.get(id);
    if (r.setup !== "checking") return;
    r.listening = r.heard = false;
    r.result = undefined;
  }
  private result(
    id: string,
    status: "listening" | "passed" | "failed",
    text: string,
  ) {
    const r = this.get(id);
    if (!r.checkId) return;
    r.result = {
      type: "setup_result",
      checkId: r.checkId,
      inputEpoch: r.inputEpoch,
      status,
      text: text.slice(0, 300),
    };
    this.room.send(id, r.result);
  }
  private expire(id: string, now: number) {
    const r = this.get(id);
    if (!r.checkDeadline || now < r.checkDeadline) return;
    r.checkDeadline = 0;
    r.setup = "failed";
    r.passed = false;
    this.result(
      id,
      "failed",
      r.listened
        ? "No words came through. Check your mic and try again."
        : "Bonk couldn’t connect. Try again.",
    );
    r.listening = false;
    this.room.transcription.stopCheck(id);
  }
  testing(id: string) {
    return this.get(id).setup === "checking";
  }
  audio(id: string, pcm: Uint8Array) {
    const r = this.get(id);
    if (r.setup === "checking" && r.listening && pcm.some((byte) => byte !== 0))
      r.heard = true;
  }
  transcript(id: string, text: string) {
    const r = this.get(id);
    this.expire(id, this.room.services.now());
    if (
      !r.checkId ||
      !r.listening ||
      !r.heard ||
      r.setup !== "checking" ||
      !text.trim()
    )
      return;
    r.setup = "passed";
    r.passed = true;
    r.listening = false;
    this.room.transcription.retries.delete(id);
    r.checkDeadline = 0;
    this.result(id, "passed", text.trim());
    this.room.transcription.stopCheck(id);
    this.tick();
  }
  failed(
    id: string,
    message = "Bonk couldn’t hear that. Try the mic check again.",
  ) {
    const r = this.get(id);
    r.passed = false;
    r.setup = "failed";
    r.healthySince = null;
    r.checkDeadline = 0;
    r.listening = false;
    this.result(id, "failed", message);
    this.tick();
  }
  tick() {
    if (this.room.closed) return;
    const { game } = this.room,
      now = this.room.services.now();
    let changed = false;
    let onlyPlannedConnections = true;
    for (const p of game.state.players) {
      // Finished verdicts retain departed participants, without retaining seats.
      if (!this.room.seats.has(p.id)) continue;
      const r = this.get(p.id),
        o = r.observation,
        stream = this.room.transcription.ink.get(p.id);
      const fresh =
        now - r.observedAt < 3000 &&
        r.epoch === this.room.seats.get(p.id)?.epoch;
      this.expire(p.id, now);
      if (this.room.transcription.checkStream(p.id) && !r.listening) {
        r.listening = true;
        if (!r.listened) r.checkDeadline = now + 15000;
        r.listened = true;
        this.result(p.id, "listening", "Say ‘Bonk, hear me out.’");
      }
      const mic =
        fresh &&
        !!o?.mic &&
        now - (this.room.seats.get(p.id)?.lastAudioAt ?? 0) < 3000;
      const camera = fresh && !!o?.camera && now - r.localAt < 3000;
      const provider = !!stream?.connected && !stream.failed && !stream.closing;
      const rotating = r.passed && this.room.transcription.connecting(p.id);
      const sealing =
        game.state.turn?.playerId === p.id && game.state.turn.sealing;
      const blockers: string[] = [];
      if (!p.connected || !fresh) blockers.push("connection");
      if (!o?.foreground) blockers.push("foreground");
      if (!mic) blockers.push("microphone");
      if (!camera) blockers.push("camera");
      if (!r.passed) blockers.push("speech_check");
      if (
        !provider &&
        !sealing &&
        game.state.turn?.playerId === p.id &&
        game.state.turn.inputState === "open"
      )
        blockers.push("transcription");
      if (now - r.probeAt >= 3000) blockers.push("camera_delivery");
      if (game.state.mediaMode === "rtc" && o?.rtcFailed)
        blockers.push("peer_video");
      if (game.state.players.length < 2 || now - r.remoteAt >= 3000)
        blockers.push("peer_video");
      if (
        blockers.length &&
        !(rotating && blockers.every((b) => b === "transcription"))
      )
        onlyPlannedConnections = false;
      if (blockers.length) r.healthySince = null;
      else if (r.healthySince === null) {
        r.healthySince = r.observedAt;
        r.progress = {
          localFrames: o!.localFrames,
          remoteAt: r.remoteAt,
          probeAt: r.probeAt,
        };
      }
      const ready =
        game.state.mediaMode !== "connecting" &&
        r.healthySince !== null &&
        r.observedAt - r.healthySince >= 1000 &&
        !!r.progress &&
        // Freshness alone accepts a cached first frame after preview recreation.
        // Qualification needs actual capture and decoded delivery progress.
        o!.localFrames > r.progress.localFrames &&
        r.remoteAt > r.progress.remoteAt &&
        r.probeAt > r.progress.probeAt;
      const next = { setup: r.setup, blockers };
      changed ||=
        JSON.stringify(p.readiness) !== JSON.stringify(next) ||
        p.mediaReady !== ready ||
        p.captureReady !== (mic && camera) ||
        p.cameraOn !== !!o?.camera;
      p.readiness = next;
      game.setCaptureReady(p.id, !!o?.camera, mic && camera);
      game.setMediaReady(p.id, ready);
    }
    const failures = game.state.players
      .filter((p) => this.room.seats.has(p.id))
      .flatMap((p) =>
        p.readiness!.blockers.map((b) => ({ player: p, blocker: b })),
      );
    if (
      failures.length &&
      !onlyPlannedConnections &&
      game.state.phase !== "RECOVERING"
    ) {
      const issue = failures[0];
      game.recover(
        `${issue.player.name} needs to reconnect. Your time is on hold.`,
      );
    }
    if (game.allMediaReady()) {
      const turn = game.state.turn;
      if (
        game.state.phase === "RECOVERING" &&
        turn &&
        !turn.sealing &&
        this.room.transcription.ink.get(turn.playerId)?.turnId !== turn.id
      ) {
        // Connect the replacement gameplay session before publishing an open floor.
        this.room.transcription.rotate(turn.playerId, turn.id);
      }
      if (game.state.phase === "RECOVERING") game.resumeRecovery();
      else if (game.pendingResume) game.resume(game.pendingResume);
    }
    if (changed) game.emit("media_status");
  }
}
