import { streamVoice } from "./providers.js";
import { FIXED_LINES, voiceSettingsKey } from "./host.js";
/** A bounded preparation can be replayed while synthesis is still arriving. */
export class PreparedVoice {
  chunks: Uint8Array[] = [];
  done = false;
  cancelled = false;
  error: unknown = null;
  listeners = new Set<() => void>();
  constructor(public text: string, public maxSeconds = 4.5) {
    void streamVoice(text, chunk => {
      if (this.cancelled) return;
      this.chunks.push(Uint8Array.from(chunk));
      this.wake();
    }, () => this.cancelled, maxSeconds).then(() => {
      this.done = true; this.wake();
    }, error => { this.error = error; this.done = true; this.wake(); });
  }
  wake() { for (const listener of this.listeners) listener(); }
  cancel() { this.cancelled = true; this.wake(); }
  async stream(onChunk: (pcm: Uint8Array) => void, cancelled: () => boolean) {
    let cursor = 0;
    while (!cancelled() && !this.cancelled) {
      while (cursor < this.chunks.length && !cancelled()) onChunk(this.chunks[cursor++]);
      if (this.done) { if (this.error) throw this.error; return; }
      await new Promise<void>(resolve => {
        const wake = () => { clearTimeout(timer); this.listeners.delete(wake); resolve(); };
        const timer = setTimeout(wake, 25);
        this.listeners.add(wake);
      });
    }
    if (!cancelled()) throw new Error("Prepared voice became stale");
  }
}
const fixed = new Map<string, PreparedVoice>();
export function fixedVoice(text: string): PreparedVoice | undefined {
  if (!FIXED_LINES.includes(text as any)) return;
  const key = `${voiceSettingsKey()}:${text}`;
  const old = fixed.get(key);
  if (old && !old.error) { fixed.delete(key); fixed.set(key, old); return old; }
  const voice = new PreparedVoice(text);
  fixed.set(key, voice);
  // At most 15 clips × 4.5 seconds × float PCM: below 12 MiB.
  if (fixed.size > FIXED_LINES.length) { const first = fixed.keys().next().value!; fixed.get(first)?.cancel(); fixed.delete(first); }
  return voice;
}
let warming = false;
export function warmHostVoice() {
  if (warming || !process.env.FISH_AUDIO_API_KEY) return;
  warming = true;
  const firstCues = [FIXED_LINES[0], FIXED_LINES[3], FIXED_LINES[6], FIXED_LINES[9], FIXED_LINES[12]];
  const lines = [...firstCues, ...FIXED_LINES.filter(text => !firstCues.includes(text))];
  void (async () => { for (const text of lines) {
    const voice = fixedVoice(text)!;
    while (!voice.done && !voice.cancelled) await new Promise(resolve => setTimeout(resolve, 25));
  } })();
}
