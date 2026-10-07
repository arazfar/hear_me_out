class PCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.samples = [];
    this.energy = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const v of input) {
      this.phase += 16000;
      this.sum += v;
      this.count++;
      if (this.phase >= sampleRate) {
        const s = this.sum / this.count;
        this.samples.push(
          Math.max(-32768, Math.min(32767, Math.round(s * 32767))),
        );
        this.energy += s * s;
        this.phase -= sampleRate;
        this.sum = 0;
        this.count = 0;
        if (this.samples.length === 320) {
          const pcm = new Int16Array(this.samples);
          this.port.postMessage(
            { pcm: pcm.buffer, level: Math.sqrt(this.energy / 320) },
            [pcm.buffer],
          );
          this.samples = [];
          this.energy = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PCM);
