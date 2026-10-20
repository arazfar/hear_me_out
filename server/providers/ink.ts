// SDK 4.2's ESM entry falls back to native WebSocket without terminate().
// Its exported CommonJS entry selects Node ws, bounding forced disposal.
import Cartesia from "@cartesia/cartesia-js/index.js";
import { createHash, randomUUID } from "node:crypto";
import { type Segment } from "../../shared/domain.js";

export const cartesia = () =>
  new Cartesia({ apiKey: process.env.CARTESIA_API_KEY });
export type InkEvent = {
  type: string;
  message?: { type: string; transcript?: string };
  error?: unknown;
};
export interface InkTransport {
  on(event: "error", callback: (error: unknown) => void): unknown;
  on(
    event: "close",
    callback: (code: number, reason: string, unsent: unknown[]) => void,
  ): unknown;
  sendRaw(audio: Buffer): unknown;
  send(message: { type: "close" }): unknown;
  /** Resolves only when the physical transport is closed. */
  dispose(): Promise<void>;
  stream(): AsyncIterable<InkEvent>;
}
export function inkTransport(
  socket: ReturnType<Cartesia["stt"]["autoFinalize"]["websocket"]>,
): InkTransport {
  return {
    on: (event, callback) => socket.on(event, callback),
    sendRaw: (audio) => socket.sendRaw(audio),
    send: (message) => socket.send(message),
    stream: () => socket.stream(),
    dispose: () =>
      new Promise<void>((resolve) => {
        const platform = socket.socket.platformSocket;
        if (platform.readyState === 3) return resolve();
        socket.on("close", () => resolve());
        socket.close();
        // This adapter runs on the Node server. A graceful close alone can wait
        // 30 seconds for an unresponsive peer after a terminal provider failure.
        if ("terminate" in platform) platform.terminate();
      }),
  };
}
function connectInk(): InkTransport {
  return inkTransport(
    cartesia().stt.autoFinalize.websocket({
      model: "ink-2",
      encoding: "pcm_s16le",
      sample_rate: 16000,
      turn_start_threshold: 0.8,
      turn_eager_end_threshold: 0.5,
      turn_end_threshold: 0.3,
      turn_end_timeout_ms: 1600,
    }),
  );
}
export class InkSession {
  epoch = randomUUID();
  ws: InkTransport;
  private resolveDrain!: (ok: boolean) => void;
  drainPromise = new Promise<boolean>((resolve) => {
    this.resolveDrain = resolve;
  });
  drainTimer: ReturnType<typeof setTimeout> | null = null;
  drainCompleted: boolean | null = null;
  private cleanClose = false;
  finishDrain(ok: boolean) {
    if (this.drainCompleted !== null) return;
    this.drainCompleted = ok;
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.connected = false;
    this.buffer = [];
    this.bufferedBytes = 0;
    // Keep the manager's active ownership until disposal has completed.
    void this.ws.dispose().then(
      () => this.resolveDrain(ok),
      () => this.resolveDrain(false),
    );
  }
  speechCounter = 0;
  transcript = "";
  consumed = 0;
  connected = false;
  closing = false;
  failed = false;
  fail(error: unknown) {
    if (this.failed) return;
    this.failed = true;
    this.connected = false;
    this.finishDrain(false);
    if (!this.closing) this.handlers.error(error);
  }
  buffer: Buffer[] = [];
  bufferedBytes = 0;
  constructor(
    public playerId: string,
    public roundId: string,
    public turnId: string | null,
    public handlers: {
      segment: (s: Segment) => void;
      caption: (text: string, final: boolean) => void;
      start: () => void;
      end: () => void;
      error: (error: unknown) => void;
    },
    transport: InkTransport = connectInk(),
  ) {
    this.ws = transport;
    this.ws.on("error", (e) => this.fail(e));
    this.ws.on("close", (code, _reason, unsent) => {
      this.connected = false;
      this.cleanClose = this.closing && code === 1000 && unsent.length === 0;
      if (!this.cleanClose)
        this.fail(
          new Error("Transcription socket closed before successful drainage"),
        );
    });
    void this.listen().then(
      () => {
        // The SDK iterator finishes even on abnormal closure. Its queued final
        // events must be consumed before a clean close can seal the evidence.
        if (this.cleanClose && !this.failed) this.finishDrain(true);
        else
          this.fail(
            new Error("Transcription stream ended without a clean close"),
          );
      },
      (e) => this.fail(e),
    );
  }
  send(audio: Buffer) {
    if (this.closing || this.failed) return;
    if (this.connected) {
      try {
        this.ws.sendRaw(audio);
      } catch (error) {
        this.fail(error);
      }
    } else {
      // Silence while a session connects carries no evidence and must not
      // exhaust the bounded speech buffer (especially during judge playback).
      if (audio.every((byte) => byte === 0)) return;
      this.buffer.push(audio);
      this.bufferedBytes += audio.length;
      if (this.bufferedBytes > 16000) {
        this.buffer = [];
        this.bufferedBytes = 0;
        this.fail(new Error("STT transition buffer exceeded"));
      }
    }
  }
  update(text: string, final: boolean) {
    if (this.failed) return;
    this.transcript = text;
    this.handlers.caption(text, final);
    // Interim/eager transcripts are captions only: a provider revision must
    // never turn an unconfirmed transcription into committed game points.
    if (!final) return;
    const boundary = text.length;
    if (boundary <= this.consumed) return;
    const segmentText = text.slice(this.consumed, boundary);
    const id = createHash("sha256")
      .update(
        `${this.epoch}:${this.speechCounter}:${this.consumed}:${boundary}:${segmentText}`,
      )
      .digest("hex")
      .slice(0, 24);
    this.consumed = boundary;
    if (segmentText.trim())
      this.handlers.segment({
        id,
        playerId: this.playerId,
        roundId: this.roundId,
        turnId: this.turnId,
        sessionEpoch: this.epoch,
        text: segmentText,
        stableAt: Date.now(),
        eligible: this.turnId !== null,
        source: "voice",
      });
  }
  async listen() {
    for await (const event of this.ws.stream()) {
      if (this.failed) continue;
      if (event.type === "error") {
        this.fail(event.error);
        continue;
      }
      if (event.type !== "message") continue;
      const m = event.message;
      if (!m) continue;
      if (m.type === "connected") {
        this.connected = true;
        for (const b of this.buffer) {
          if (this.failed) break;
          this.ws.sendRaw(b);
        }
        this.buffer = [];
        this.bufferedBytes = 0;
      } else if (m.type === "turn.start") {
        this.speechCounter++;
        this.transcript = "";
        this.consumed = 0;
        this.handlers.start();
      } else if (m.type === "turn.update")
        this.update(m.transcript || "", false);
      else if (m.type === "turn.eager_end")
        this.update(m.transcript || "", false);
      else if (m.type === "turn.resume") this.handlers.start();
      else if (m.type === "turn.end") {
        this.update(m.transcript || "", true);
        this.handlers.end();
      } else if (m.type === "error")
        this.fail(new Error("Transcription provider error"));
    }
  }
  close(): Promise<boolean> {
    if (this.closing) return this.drainPromise;
    this.closing = true;
    if (this.drainCompleted !== null) return this.drainPromise;
    this.drainTimer = setTimeout(() => {
      this.fail(new Error("Transcription drain timed out"));
    }, 5000);
    this.drainTimer.unref();
    try {
      this.ws.send({ type: "close" });
    } catch (error) {
      this.fail(error);
    }
    return this.drainPromise;
  }
}
