// Lossless utterance FIFO. Network lateness inserts silence; it never skips words.
class JudgePlayback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pcm = new Float32Array(44100 * 20);
    this.reset(0);
    this.port.onmessage = ({ data }) => {
      if (data.type === "reset") {
        this.reset(data.epoch);
        return;
      }
      if (data.epoch !== this.epoch) return;
      if (data.type === "pcm") {
        const pcm = new Int16Array(data.pcm);
        if (
          data.offset !== this.received ||
          this.received + pcm.length > this.pcm.length
        ) {
          this.port.postMessage({ type: "failed", epoch: this.epoch });
          return;
        }
        for (let i = 0; i < pcm.length; i++)
          this.pcm[this.received++] = pcm[i] / 32768;
      } else if (data.type === "end") {
        if (data.samples !== this.received)
          this.port.postMessage({ type: "failed", epoch: this.epoch });
        else this.final = data.samples;
      } else if (data.type === "start") this.startAt = data.at;
    };
  }
  reset(epoch) {
    this.epoch = epoch;
    this.received = 0;
    this.position = 0;
    this.final = null;
    this.startAt = Infinity;
    this.ready = false;
    this.started = false;
    this.rendering = false;
    this.complete = false;
    this.reportAt = 0;
  }
  report(type, contextTime) {
    this.port.postMessage({
      type,
      epoch: this.epoch,
      samples: Math.floor(this.position),
      contextTime,
    });
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    out.fill(0);
    if (!this.epoch || this.complete) return true;
    const available = this.received - Math.floor(this.position);
    if (
      !this.ready &&
      (available >= 5292 || (this.final !== null && available > 0))
    ) {
      this.ready = true;
      this.report("ready", currentTime);
    }
    if (
      !this.started &&
      (available >= 5292 || (this.final !== null && available > 0))
    )
      this.started = true;
    for (let i = 0; i < out.length; i++) {
      const at = currentTime + i / sampleRate;
      if (!this.started || at < this.startAt) continue;
      const index = Math.floor(this.position),
        fraction = this.position - index;
      if (index + 1 >= this.received && this.final === null) {
        this.started = false;
        if (this.rendering) {
          this.rendering = false;
          this.report("buffering", at);
        }
        break;
      }
      if (!this.rendering) {
        this.rendering = true;
        this.report("rendering", at);
      }
      const a = this.pcm[index],
        b = this.pcm[Math.min(index + 1, this.received - 1)];
      out[i] = a + (b - a) * fraction;
      this.position = Math.min(
        this.received,
        this.position + 44100 / sampleRate,
      );
      if (this.final !== null && this.position >= this.final) {
        this.complete = true;
        this.rendering = false;
        this.report("drained", at + 1 / sampleRate);
        break;
      }
    }
    if (this.position > 0 && !this.complete && currentTime >= this.reportAt) {
      this.reportAt = currentTime + 0.25;
      this.report("progress", currentTime);
    }
    return true;
  }
}
registerProcessor("judge-playback", JudgePlayback);
