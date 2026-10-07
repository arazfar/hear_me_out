// A bounded audio-thread jitter buffer. Late bursts replace old audio instead of accumulating delay.
class PeerPlayback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(4096);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.phase = 0;
    this.started = false;
    this.last = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "flush") {
        this.count = 0;
        this.read = this.write;
        this.started = false;
        this.phase = 0;
        return;
      }
      const samples = new Float32Array(data.pcm);
      for (const x of samples) {
        this.ring[this.write] = x;
        this.write = (this.write + 1) % 4096;
        this.count++;
      }
      if (this.count > 1600) {
        this.count = 640;
        this.read = (this.write - 640 + 4096) % 4096;
        this.phase = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!this.started && this.count >= 640) this.started = true;
    for (let i = 0; i < output.length; i++) {
      if (!this.started || this.count < 2) {
        this.started = false;
        output[i] = this.last *= 0.98;
        continue;
      }
      const a = this.ring[this.read],
        b = this.ring[(this.read + 1) % 4096];
      output[i] = this.last = a + (b - a) * this.phase;
      this.phase += 16000 / sampleRate;
      if (this.phase >= 1) {
        const n = Math.floor(this.phase);
        this.read = (this.read + n) % 4096;
        this.count -= n;
        this.phase -= n;
      }
    }
    return true;
  }
}
registerProcessor("peer-playback", PeerPlayback);
