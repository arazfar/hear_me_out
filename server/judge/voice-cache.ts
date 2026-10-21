import { streamVoice } from "../providers/index.js";
import { FIXED_LINES, PHRASES, voiceSettingsKey } from "./personality.js";
/** A bounded preparation can be replayed while synthesis is still arriving. */
export class PreparedVoice {
  chunks: Uint8Array[] = [];
  bytes = 0;
  users = 0;
  done = false;
  cancelled = false;
  error: unknown = null;
  listeners = new Set<() => void>();
  constructor(
    public text: string,
    public maxSeconds = 20,
    synthesize = streamVoice,
  ) {
    void synthesize(
      text,
      (chunk) => {
        if (this.cancelled) return;
        this.bytes += chunk.byteLength;
        if (this.bytes > 44100 * 20 * 2) {
          this.error = new Error("Prepared voice exceeded its byte budget");
          this.cancel();
          return;
        }
        this.chunks.push(Uint8Array.from(chunk));
        this.wake();
      },
      () => this.cancelled,
      maxSeconds,
    ).then(
      () => {
        this.done = true;
        this.wake();
      },
      (error) => {
        this.error = error;
        this.done = true;
        this.wake();
      },
    );
  }
  wake() {
    for (const listener of this.listeners) listener();
  }
  cancel() {
    this.cancelled = true;
    this.wake();
  }
  async stream(onChunk: (pcm: Uint8Array) => void, cancelled: () => boolean) {
    this.users++;
    try {
      let cursor = 0;
      while (!cancelled() && !this.cancelled) {
        while (cursor < this.chunks.length && !cancelled())
          onChunk(this.chunks[cursor++]);
        if (this.done) {
          if (this.error) throw this.error;
          return;
        }
        await new Promise<void>((resolve) => {
          const wake = () => {
            clearTimeout(timer);
            this.listeners.delete(wake);
            resolve();
          };
          const timer = setTimeout(wake, 25);
          this.listeners.add(wake);
        });
      }
      if (!cancelled()) throw new Error("Prepared voice became stale");
    } finally {
      this.users--;
    }
  }
}
const fixed = new Map<string, PreparedVoice>();
export function fixedVoice(text: string): PreparedVoice | undefined {
  if (!FIXED_LINES.some((line) => line === text)) return;
  const key = `${voiceSettingsKey()}:${text}`;
  const old = fixed.get(key);
  if (old && !old.error) {
    fixed.delete(key);
    fixed.set(key, old);
    return old;
  }
  // Reserve the worst-case PCM size before generation. Six clips fit below 12 MiB.
  while (fixed.size >= 6) {
    const entry = [...fixed].find(([, clip]) => !clip.users);
    if (!entry) return;
    entry[1].cancel();
    fixed.delete(entry[0]);
  }
  const voice = new PreparedVoice(text);
  fixed.set(key, voice);
  return voice;
}
let warming = false;
let generation = 0;
export function clearHostVoice() {
  generation++;
  warming = false;
  for (const voice of fixed.values()) voice.cancel();
  fixed.clear();
}
export function warmHostVoice() {
  if (warming || !process.env.FISH_AUDIO_API_KEY) return;
  warming = true;
  const owner = generation;
  // Warm only lines the host can use verbatim, within the cache reservation.
  const lines = [...PHRASES.topic, ...PHRASES.nudge];
  void (async () => {
    for (const text of lines) {
      if (owner !== generation) return;
      const voice = fixedVoice(text);
      if (!voice) continue;
      while (!voice.done && !voice.cancelled)
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
  })();
}
