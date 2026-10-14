import { createHash } from "node:crypto";
import { WebSocket } from "ws";
import { canSendJudgeInput, type Snapshot } from "../shared/domain";
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  type Command,
  type GameEvent,
  type Session,
} from "../shared/protocol";
import {
  encodeMicrophone,
  decodeJudgeAudio,
  encodeVideo,
  decodeVideo,
} from "../shared/media";
export const waitFor = async (check: () => boolean, timeout = 10000) => {
  const at = Date.now();
  while (!check()) {
    if (Date.now() - at > timeout) throw Error("Fixture wait expired");
    await new Promise((r) => setTimeout(r, 10));
  }
};
export async function post(base: string, path: string, body: unknown) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error);
  return value as { session: Session; snapshot: Snapshot };
}
export class WsPeer {
  sockets = new Map<string, WebSocket>();
  seq = 0;
  checkId = "";
  videoSeq = 0;
  pcm = new Uint8Array(640);
  interval: ReturnType<typeof setInterval> | null = null;
  errors: string[] = [];
  events: GameEvent[] = [];
  voice = new Map<number, string[]>();
  cancelled = new Set<number>();
  ready = new Set<number>();
  ended = new Map<string, number>();
  inputEpoch = 0;
  eof = new Map<number, number>();
  completing = new Set<number>();
  timers = new Set<ReturnType<typeof setTimeout>>();
  acks = new Map<string, boolean>();
  constructor(
    readonly base: string,
    public session: Session,
    public state: Snapshot,
  ) {}
  send(command: Command, id: string = crypto.randomUUID()) {
    if (command.type === "done") {
      if (!this.ended.has(command.turnId)) {
        const seq = ++this.seq;
        this.sockets.get("audio")?.send(
          encodeMicrophone(
            this.state.mediaEpoch,
            seq,
            Date.now(),
            new Uint8Array(),
            {
              purpose: "gameplay",
              inputEpoch: this.state.turn!.inputEpoch!,
              end: true,
            },
          ),
        );
        this.ended.set(command.turnId, seq);
      }
      command = { ...command, lastAudioSeq: this.ended.get(command.turnId)! };
    }
    this.control({
      commandId: id,
      connectionEpoch: this.session.connectionEpoch,
      matchId: this.state.matchId,
      expectedPhaseVersion: this.state.phaseVersion,
      command,
    });
    return id;
  }
  control(value: unknown) {
    const ws = this.sockets.get("control");
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
  }
  ackAudio() {
    const judge = this.state.judge;
    if (
      judge &&
      this.voice.has(judge.epoch) &&
      !this.ready.has(judge.epoch) &&
      judge.status !== "silent"
    ) {
      this.ready.add(judge.epoch);
      this.send({
        type: "audio_ready",
        utteranceId: judge.id,
        speechEpoch: judge.epoch,
      });
    }
  }
  completeAudio() {
    const judge = this.state.judge;
    if (
      !judge ||
      judge.status !== "speaking" ||
      !this.eof.has(judge.epoch) ||
      this.completing.has(judge.epoch)
    )
      return;
    this.completing.add(judge.epoch);
    const samples = this.eof.get(judge.epoch)!;
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        this.send({
          type: "audio_playback",
          utteranceId: judge.id,
          speechEpoch: judge.epoch,
          status: "complete",
          samples,
        });
      },
      Math.max(0, judge.startAt! + samples / 44.1 + 30 - Date.now()),
    );
    this.timers.add(timer);
  }
  async connect() {
    this.seq = 0;
    for (const channel of ["control", "audio", "video", "judge"]) {
      const ws = new WebSocket(
        this.base.replace(/^http/, "ws") + "/socket/" + channel,
      );
      this.sockets.set(channel, ws);
      ws.on("message", (raw, binary) => {
        if (binary) {
          if (channel === "video" && Buffer.isBuffer(raw)) {
            const frame = decodeVideo(raw);
            if (frame)
              this.control({
                type: "video_ack",
                seq: frame.seq,
                mediaEpoch: frame.epoch,
                probe: frame.probe,
              });
          }
          if (channel === "judge" && Buffer.isBuffer(raw)) {
            const packet = decodeJudgeAudio(raw);
            if (packet) {
              const hashes = this.voice.get(packet.epoch) || [];
              hashes.push(createHash("sha256").update(raw).digest("hex"));
              this.voice.set(packet.epoch, hashes);
              if (packet.end) this.eof.set(packet.epoch, packet.offset);
              this.ackAudio();
              this.completeAudio();
            }
          }
          return;
        }
        const parsed = serverMessageSchema.safeParse(
          JSON.parse(raw.toString()),
        );
        if (!parsed.success) {
          this.errors.push("Invalid server event");
          return;
        }
        const event = parsed.data;
        if ("snapshot" in event) {
          this.state = event.snapshot;
          this.ackAudio();
          this.completeAudio();
        }
        if ("seq" in event && "snapshot" in event) this.events.push(event);
        if (event.type === "setup_result")
          this.inputEpoch =
            event.status === "listening" ? event.inputEpoch! : 0;
        if (event.type === "error") this.errors.push(event.error);
        if (event.type === "ack" && event.ok !== undefined) {
          this.acks.set(event.commandId, event.ok);
          if (!event.ok) this.errors.push(event.error || "Command error");
        }
        if (
          event.type === "judge_cancelled" &&
          event.payload &&
          "epoch" in event.payload
        )
          this.cancelled.add(event.payload.epoch);
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("error", reject);
        ws.once("open", () => {
          ws.send(
            JSON.stringify({
              type: "auth",
              protocolVersion: PROTOCOL_VERSION,
              ...this.session,
              code: undefined,
            }),
          );
          resolve();
        });
      });
    }
    let count = 0;
    this.interval = setInterval(() => {
      const ws = this.sockets.get("audio");
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(
          encodeMicrophone(
            this.state.mediaEpoch,
            ++this.seq,
            Date.now(),
            this.state.players.find((p) => p.id === this.session.playerId)
              ?.readiness?.setup === "passed"
              ? this.pcm
              : new Uint8Array(640).fill(1),
            this.inputEpoch
              ? { purpose: "private", inputEpoch: this.inputEpoch }
              : canSendJudgeInput(this.state, this.session.playerId) &&
                  !this.ended.has(this.state.turn!.id)
                ? {
                    purpose: "gameplay",
                    inputEpoch: this.state.turn!.inputEpoch!,
                  }
                : { purpose: "social", inputEpoch: 0 },
          ),
        );
      if (++count % 5 === 0) {
        const video = this.sockets.get("video");
        if (video?.readyState === WebSocket.OPEN)
          video.send(
            encodeVideo(
              this.state.mediaEpoch,
              ++this.videoSeq,
              Date.now(),
              new Uint8Array([255, 216, 255, 217]),
              count % 25 === 0,
            ),
          );
      }
      if (count % 25 === 0) {
        this.send({
          type: "media_status",
          captureId: this.session.playerId + ":mic",
          cameraId: this.session.playerId + ":camera",
          mic: true,
          camera: true,
          foreground: true,
          localFrames: count,
          remoteFrames: 0,
          mediaEpoch: this.state.mediaEpoch,
          rtc: false,
        });
        const me = this.state.players.find(
          (p) => p.id === this.session.playerId,
        );
        if (
          !this.checkId &&
          me?.captureReady &&
          me.readiness?.setup === "needed"
        ) {
          this.checkId = crypto.randomUUID();
          this.send({
            type: "setup_start",
            checkId: this.checkId,
            captureId: this.session.playerId + ":mic",
          });
        }
      }
    }, 20);
  }
  close() {
    if (this.interval) clearInterval(this.interval);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const ws of this.sockets.values()) ws.close();
    this.sockets.clear();
  }
}
