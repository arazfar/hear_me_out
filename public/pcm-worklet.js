class PCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.samples = [];
    this.energy = 0;
    this.tag = { purpose: "health", inputEpoch: 0, mediaEpoch: 0 };
    this.anchor = 0;
    this.endsAt = null;
    this.firstAt = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "clock") {
        // Device clocks can drift or pause independently of the server clock.
        // Finish the old timestamped frame before changing the mapping; keep
        // its purpose/epoch and do not emit an input end marker.
        this.flushPartial(this.anchor + currentTime * 1000);
        this.anchor = data.serverAt - data.contextAt * 1000;
      } else if (data.type === "gate") {
        const changed =
          data.purpose !== this.tag.purpose ||
          data.inputEpoch !== this.tag.inputEpoch ||
          data.mediaEpoch !== this.tag.mediaEpoch;
        if (changed) this.close(false);
        this.tag = {
          purpose: data.purpose,
          inputEpoch: data.inputEpoch,
          mediaEpoch: data.mediaEpoch,
        };
        this.anchor = data.serverAt - data.contextAt * 1000;
        this.endsAt = data.endsAt;
        if (data.requestId)
          this.port.postMessage({
            type: "isolated",
            requestId: data.requestId,
          });
      } else if (
        data.type === "done" &&
        data.inputEpoch === this.tag.inputEpoch &&
        this.tag.purpose === "gameplay"
      ) {
        this.close(true);
        this.tag = { ...this.tag, purpose: data.nextPurpose, inputEpoch: 0 };
        this.endsAt = null;
      }
    };
  }
  flush() {
    if (!this.samples.length) return;
    const pcm = new Int16Array(this.samples);
    this.port.postMessage(
      {
        type: "pcm",
        ...this.tag,
        capturedAt: this.firstAt,
        level: Math.sqrt(this.energy / this.samples.length),
        pcm: pcm.buffer,
      },
      [pcm.buffer],
    );
    this.samples = [];
    this.energy = 0;
  }
  flushPartial(at) {
    if (this.count) {
      const sample = this.sum / this.count;
      if (!this.samples.length) this.firstAt = at;
      this.samples.push(
        Math.max(-32768, Math.min(32767, Math.round(sample * 32767))),
      );
      this.energy += sample * sample;
    }
    this.flush();
    // No partial resampler state crosses a clock, ownership or privacy boundary.
    this.sum = this.count = this.phase = 0;
  }
  close(done, at = this.anchor + currentTime * 1000) {
    this.flushPartial(at);
    if (this.tag.purpose === "gameplay")
      this.port.postMessage({ type: "end", ...this.tag, capturedAt: at, done });
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const at = this.anchor + (currentTime + i / sampleRate) * 1000;
      if (
        this.tag.purpose === "gameplay" &&
        this.endsAt !== null &&
        at >= this.endsAt
      ) {
        this.close(false, at);
        this.tag = { ...this.tag, purpose: "social", inputEpoch: 0 };
        this.endsAt = null;
      }
      this.phase += 16000;
      this.sum += input[i];
      this.count++;
      if (this.phase >= sampleRate) {
        const s = this.sum / this.count;
        if (!this.samples.length) this.firstAt = at;
        this.samples.push(
          Math.max(-32768, Math.min(32767, Math.round(s * 32767))),
        );
        this.energy += s * s;
        this.phase -= sampleRate;
        this.sum = this.count = 0;
        if (this.samples.length === 320) this.flush();
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PCM);
