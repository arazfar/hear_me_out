import { createHash } from "node:crypto";
import { WebSocket } from "ws";
import type { Snapshot } from "../shared/domain";
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  type Command,
  type GameEvent,
  type Session,
} from "../shared/protocol";
import { encodeMicrophone, decodeJudgeAudio } from "../shared/media";
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
  pcm = new Uint8Array(640);
  interval: ReturnType<typeof setInterval> | null = null;
  errors: string[] = [];
  events: GameEvent[] = [];
  voice = new Map<number, string[]>();
  cancelled = new Set<number>();
  ready = new Set<number>();
  acks = new Map<string, boolean>();
  constructor(
    readonly base: string,
    public session: Session,
    public state: Snapshot,
  ) {}
  send(command: Command, id: string = crypto.randomUUID()) {
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
  async connect() {
    this.seq = 0;
    for (const channel of ["control", "audio", "video"]) {
      const ws = new WebSocket(
        this.base.replace(/^http/, "ws") + "/socket/" + channel,
      );
      this.sockets.set(channel, ws);
      ws.on("message", (raw, binary) => {
        if (binary) {
          if (channel === "audio" && Buffer.isBuffer(raw)) {
            const packet = decodeJudgeAudio(raw);
            if (packet) {
              const hashes = this.voice.get(packet.epoch) || [];
              hashes.push(createHash("sha256").update(raw).digest("hex"));
              this.voice.set(packet.epoch, hashes);
              this.ackAudio();
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
        }
        if ("seq" in event && "snapshot" in event) this.events.push(event);
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
            this.pcm,
          ),
        );
      if (++count % 25 === 0)
        this.send({
          type: "media_status",
          ready: true,
          cameraOn: false,
          rtc: false,
        });
    }, 20);
  }
  close() {
    if (this.interval) clearInterval(this.interval);
    for (const ws of this.sockets.values()) ws.close();
    this.sockets.clear();
  }
}
