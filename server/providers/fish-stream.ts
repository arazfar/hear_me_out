import {
  captionAlignmentSchema,
  type CaptionCue,
} from "../../shared/domain.js";

/** Bounded SSE decoding. Transport boundaries need not align with UTF-8 or events. */
export class FishStream {
  private decoder = new TextDecoder();
  private pending = "";
  private data: string[] = [];
  private dataSize = 0;
  private chunks = new Map<number, CaptionCue[]>();
  private lastAlignment = "";
  constructor(
    private audio: (bytes: Uint8Array) => void,
    private alignment: (cues: CaptionCue[]) => void,
    private maxSeconds = 20,
  ) {}
  push(bytes: Uint8Array, done = false) {
    this.pending += this.decoder.decode(bytes, { stream: !done });
    if (this.pending.length > 4_000_000)
      throw new Error("Excessive Fish event");
    // Keep an incomplete CRLF pair until the next network chunk.
    let end: number;
    while ((end = this.pending.search(/\r|\n/)) >= 0) {
      if (
        !done &&
        end === this.pending.length - 1 &&
        this.pending[end] === "\r"
      )
        break;
      const line = this.pending.slice(0, end);
      const size = this.pending.slice(end, end + 2) === "\r\n" ? 2 : 1;
      this.pending = this.pending.slice(end + size);
      this.line(line);
    }
    if (done) {
      if (this.pending) this.line(this.pending);
      this.pending = "";
      this.line("");
    }
  }
  private line(line: string) {
    if (!line) {
      if (this.data.length) this.event(this.data.join("\n"));
      this.data = [];
      this.dataSize = 0;
    } else if (line.startsWith("data:")) {
      const value = line.slice(5).replace(/^ /, "");
      this.dataSize += value.length;
      if (this.dataSize > 4_000_000) throw new Error("Excessive Fish event");
      this.data.push(value);
    }
  }
  private event(data: string) {
    if (data === "[DONE]") return;
    const event = JSON.parse(data);
    if (!event || typeof event !== "object" || Array.isArray(event)) return;
    // Audio is incremental even when alignment replaces a previous snapshot.
    if (typeof event.audio_base64 === "string" && event.audio_base64.length) {
      if (
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          event.audio_base64,
        )
      )
        throw new Error("Invalid Fish audio encoding");
      this.audio(Buffer.from(event.audio_base64, "base64"));
    }
    if (
      !event.alignment ||
      !Number.isInteger(event.chunk_seq) ||
      event.chunk_seq < 0 ||
      event.chunk_seq > 511 ||
      !Number.isFinite(event.chunk_audio_offset_sec) ||
      event.chunk_audio_offset_sec < 0
    )
      return;
    const segments = event.alignment.segments;
    if (!Array.isArray(segments) || segments.length > 512) return;
    if (
      segments.some(
        (segment) =>
          !Number.isFinite(segment?.start) ||
          !Number.isFinite(segment?.end) ||
          segment.start < 0 ||
          segment.end < segment.start,
      )
    )
      return;
    const offset = event.chunk_audio_offset_sec;
    const cues = segments.map((segment: any) => ({
      text: typeof segment?.text === "string" ? segment.text.trim() : null,
      start:
        typeof segment?.start === "number"
          ? Math.round((offset + segment.start) * 44100)
          : NaN,
      end:
        typeof segment?.end === "number"
          ? Math.round((offset + segment.end) * 44100)
          : NaN,
    }));
    const checked = captionAlignmentSchema.safeParse({ revision: 0, cues });
    if (
      !checked.success ||
      checked.data.cues.some((cue) => cue.end > this.maxSeconds * 44100)
    )
      return;
    const next = new Map(this.chunks).set(event.chunk_seq, checked.data.cues);
    const all = [...next.entries()]
      .sort(([a], [b]) => a - b)
      .flatMap(([, value]) => value);
    const valid = captionAlignmentSchema.safeParse({ revision: 0, cues: all });
    if (
      !valid.success ||
      all.some((cue, index) => index > 0 && cue.start < all[index - 1].start)
    )
      return;
    this.chunks = next;
    const key = JSON.stringify(all);
    if (key !== this.lastAlignment) {
      this.lastAlignment = key;
      this.alignment(all);
    }
  }
}
