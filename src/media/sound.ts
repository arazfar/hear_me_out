import { canSpeak } from "../../shared/types";
import type { Client } from "../game/client";
export class AudioOutput {
  constructor(readonly client: Client) {}
  peerMuted = false;
  judgeMuted = false;
  context: AudioContext | null = null;
  peerGain: GainNode | null = null;
  peerPlayback: AudioWorkletNode | null = null;
  judgeGain: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  analysisData = new Uint8Array(128);
  judgeAmplitude() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.analysisData);
    let total = 0;
    for (const x of this.analysisData) total += ((x - 128) / 128) ** 2;
    return Math.sqrt(total / 128);
  }
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.peerGain = this.context.createGain();
      this.judgeGain = this.context.createGain();
      this.peerGain.connect(this.context.destination);
      await this.context.audioWorklet.addModule("/peer-worklet.js");
      this.peerPlayback = new AudioWorkletNode(this.context, "peer-playback", {
        numberOfInputs: 0,
        outputChannelCount: [1],
      });
      this.peerPlayback.connect(this.peerGain);
      this.judgeGain.connect(this.context.destination);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      const silent = this.context.createGain();
      silent.gain.value = 0;
      this.judgeGain
        .connect(this.analyser)
        .connect(silent)
        .connect(this.context.destination);
    }
    await this.context.resume();
  }
  play(
    samples: Float32Array,
    rate: number,
    at: number,
    gain: GainNode,
    judge: boolean,
  ) {
    const buffer = this.context!.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const source = this.context!.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(at);
    if (judge) {
      this.client.playback.nodes.add(source);
      source.onended = () => this.client.playback.nodes.delete(source);
    }
  }
  mutePeer() {
    this.peerMuted = !this.peerMuted;
    if (this.peerGain && this.context)
      this.peerGain.gain.value =
        this.peerMuted ||
        !canSpeak(
          this.client.state,
          this.client.state?.players.find(
            (p) => p.id !== this.client.session?.playerId,
          )?.id || null,
        )
          ? 0
          : 1;
    this.client.notify({ media: true });
  }
  muteJudge() {
    this.judgeMuted = !this.judgeMuted;
    if (this.judgeGain) this.judgeGain.gain.value = this.judgeMuted ? 0 : 1;
    this.client.notify({ media: true });
  }
  effect(kind: "coin" | "score" | "verdict") {
    if (!this.context || this.context.state !== "running" || this.judgeMuted)
      return;
    if (kind === "score") {
      const noise = this.context.createBuffer(
        1,
        Math.floor(this.context.sampleRate * 0.07),
        this.context.sampleRate,
      );
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length);
      const pop = this.context.createBufferSource(),
        filter = this.context.createBiquadFilter(),
        gain = this.context.createGain();
      pop.buffer = noise;
      filter.type = "lowpass";
      filter.frequency.value = 1600;
      gain.gain.value = 0.045;
      pop.connect(filter).connect(gain).connect(this.context.destination);
      pop.start();
    }
    const freqs =
      kind === "coin"
        ? [220, 880]
        : kind === "score"
          ? [523, 784]
          : [392, 523, 659, 784];
    freqs.forEach((f, i) => {
      const o = this.context!.createOscillator(),
        g = this.context!.createGain(),
        at =
          this.context!.currentTime + (kind === "score" ? 0.16 : 0) + i * 0.075;
      o.type = kind === "coin" ? "triangle" : "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.05, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
      o.connect(g).connect(this.context!.destination);
      o.start(at);
      o.stop(at + 0.2);
    });
  }
}
