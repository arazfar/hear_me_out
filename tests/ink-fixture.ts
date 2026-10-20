import type { InkEvent, InkTransport } from "../server/providers/ink";
import { InkSession } from "../server/providers/ink";
import { deferred } from "./fixtures";
export class FakeInkTransport implements InkTransport {
  events: InkEvent[] = [];
  ended = false;
  wake = deferred<void>();
  listeners = new Map<string, (...args: any[]) => void>();
  on(type: "error" | "close", callback: (...args: any[]) => void) {
    this.listeners.set(type, callback);
  }
  sendRaw(_audio: Buffer) {}
  send(_message: { type: "close" }) {
    this.close();
  }
  close() {
    this.ended = true;
    this.listeners.get("close")?.(1000, "OK", []);
    this.wake.resolve();
  }
  async dispose() {
    if (!this.ended) this.close();
  }
  push(event: InkEvent) {
    this.events.push(event);
    this.wake.resolve();
  }
  async *stream() {
    while (!this.ended || this.events.length) {
      while (this.events.length) yield this.events.shift()!;
      if (!this.ended) {
        await this.wake.promise;
        this.wake = deferred<void>();
      }
    }
  }
}
export function inkFixture(
  handlers: Partial<ConstructorParameters<typeof InkSession>[3]> = {},
) {
  const socket = new FakeInkTransport();
  const stream = new InkSession(
    "player-a",
    "round",
    "turn",
    {
      caption: () => {},
      segment: () => {},
      start: () => {},
      end: () => {},
      error: () => {},
      ...handlers,
    },
    socket,
  );
  return { stream, socket };
}
