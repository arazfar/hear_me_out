import Cartesia from "@cartesia/cartesia-js";
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
  on(event: "error" | "close", callback: (event: unknown) => void): unknown;
  sendRaw(audio: Buffer): unknown;
  send(message: { type: "close" }): unknown;
  close(): unknown;
  stream(): AsyncIterable<InkEvent>;
}
function connectInk(): InkTransport {
  return cartesia().stt.autoFinalize.websocket({
    model: "ink-2",
    encoding: "pcm_s16le",
    sample_rate: 16000,
    turn_start_threshold: 0.8,
    turn_eager_end_threshold: 0.5,
    turn_end_threshold: 0.3,
    turn_end_timeout_ms: 1600,
  });
}
export class InkSession {
  epoch = randomUUID();
  ws: InkTransport;
  drainPromise: Promise<boolean> | null = null;
  resolveDrain: ((ok: boolean) => void) | null = null;
  drainTimer: ReturnType<typeof setTimeout> | null = null;
  drainCompleted: boolean | null = null;
  finishDrain(ok: boolean) {
    if (this.drainCompleted !== null) return;
    this.drainCompleted = ok;
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.resolveDrain?.(ok);
  }
  speechCounter = 0;
  transcript = "";
  consumed = 0;
  connected = false;
  closing = false;
  failed = false;
  fail(error: unknown) {
    if (this.failed) return;
    if (this.closing) {
      this.failed = true;
      this.finishDrain(false);
      return;
    }
    this.failed = true;
    this.connected = false;
    this.handlers.error(error);
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
    this.ws.on("close", () => {
      if (!this.closing) this.fail(new Error("Transcription socket closed"));
    });
    void this.listen().then(
      () => this.finishDrain(!this.failed),
      (e) => {
        this.fail(e);
        this.finishDrain(false);
      },
    );
  }
  send(audio: Buffer) {
    if (this.closing || this.failed) return;
    if (this.connected) this.ws.sendRaw(audio);
    else {
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
      if (event.type === "error") {
        this.fail(event.error);
        continue;
      }
      if (event.type !== "message") continue;
      const m = event.message;
      if (!m) continue;
      if (m.type === "connected") {
        this.connected = true;
        for (const b of this.buffer) this.ws.sendRaw(b);
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
    if (this.drainPromise) return this.drainPromise;
    this.closing = true;
    this.drainPromise = new Promise((resolve) => {
      this.resolveDrain = resolve;
    });
    if (this.drainCompleted !== null) {
      this.resolveDrain?.(this.drainCompleted);
      return this.drainPromise;
    }
    try {
      this.ws.send({ type: "close" });
    } catch {
      this.finishDrain(false);
      return this.drainPromise;
    }
    this.drainTimer = setTimeout(() => {
      this.finishDrain(false);
      try {
        this.ws.close();
      } catch {}
    }, 5000);
    this.drainTimer.unref();
    return this.drainPromise;
  }
}
