import type { Client } from "../game/client";
import { loadWorklet } from "./worklet";

type Initialization = {
  controller: AbortController;
  promise: Promise<void>;
  playback?: AudioWorkletNode;
  resumeTimeout?: ReturnType<typeof setTimeout>;
};
const soundLoadError = () => new Error("Couldn’t load sound. Try again.");

export class AudioOutput {
  constructor(readonly client: Client) {}
  peerMuted = false;
  judgeMuted = false;
  context: AudioContext | null = null;
  peerGain: GainNode | null = null;
  peerPlayback: AudioWorkletNode | null = null;
  judgeGain: GainNode | null = null;
  judgePlayback: AudioWorkletNode | null = null;
  effectsGain: GainNode | null = null;
  effectNodes = new Set<AudioScheduledSourceNode>();
  private effectAt = -Infinity;
  private speechUntil = 0;
  analyser: AnalyserNode | null = null;
  analysisData = new Uint8Array(128);
  judgeAmplitude() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.analysisData);
    let total = 0;
    for (const x of this.analysisData) total += ((x - 128) / 128) ** 2;
    return Math.sqrt(total / 128);
  }
  private initialization: Initialization | null = null;
  cancelInitialization() {
    this.initialization?.controller.abort(new Error("Setup cancelled."));
  }
  unlock() {
    if (this.initialization) {
      void this.context?.resume().catch(() => {});
      return this.initialization.promise;
    }
    const attempt: Initialization = {
      controller: new AbortController(),
      promise: Promise.resolve(),
    };
    this.initialization = attempt;
    attempt.promise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        clearTimeout(attempt.resumeTimeout);
        attempt.controller.signal.removeEventListener("abort", cancelled);
        attempt.playback?.disconnect();
        if (this.initialization === attempt) this.initialization = null;
        error ? reject(error) : resolve();
      };
      const cancelled = () => finish(attempt.controller.signal.reason);
      const deadline = setTimeout(
        () => attempt.controller.abort(soundLoadError()),
        10000,
      );
      attempt.controller.signal.addEventListener("abort", cancelled, {
        once: true,
      });
      void this.initialize(attempt).then(() => finish(), finish);
    });
    return attempt.promise;
  }
  private async initialize(attempt: Initialization) {
    const check = () => {
      attempt.controller.signal.throwIfAborted();
      if (this.initialization !== attempt) throw new Error("Setup cancelled.");
    };
    check();
    if (!this.context) {
      this.context = new AudioContext();
      // Resume in the initiating tap, before fetching worklet code.
      void this.context.resume().catch(() => {});
      this.peerGain = this.context.createGain();
      this.judgeGain = this.context.createGain();
      this.effectsGain = this.context.createGain();
      this.effectsGain.connect(this.context.destination);
      this.updateEffectsGain();
      this.peerGain.connect(this.context.destination);
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
    const context = this.context;
    // A restored page may need another tap on Safari. Do not leave setup waiting
    // on an autoplay-blocked resume promise, and allow a failed module to retry.
    const resumed = context.resume();
    try {
      await Promise.race([
        resumed,
        new Promise<never>((_, reject) => {
          attempt.resumeTimeout = setTimeout(
            () => reject(new Error("Tap again to enable sound.")),
            2000,
          );
        }),
      ]);
    } finally {
      clearTimeout(attempt.resumeTimeout);
    }
    check();
    if (!this.peerPlayback) {
      try {
        await loadWorklet(
          context,
          "/peer-worklet.js",
          attempt.controller.signal,
        );
        check();
        const playback = new AudioWorkletNode(context, "peer-playback", {
          numberOfInputs: 0,
          outputChannelCount: [1],
        });
        attempt.playback = playback;
        playback.connect(this.peerGain!);
        check();
        this.peerPlayback = playback;
        attempt.playback = undefined;
      } catch {
        check();
        throw soundLoadError();
      }
    }
    if (!this.judgePlayback) {
      await loadWorklet(
        context,
        "/judge-worklet.js",
        attempt.controller.signal,
      );
      check();
      const playback = new AudioWorkletNode(context, "judge-playback", {
        numberOfInputs: 0,
        outputChannelCount: [1],
      });
      attempt.playback = playback;
      playback.connect(this.judgeGain!);
      check();
      this.judgePlayback = playback;
      attempt.playback = undefined;
      this.client.playback.bind(playback);
    }
    this.syncPeerPrivacy();
    if (this.judgeGain) this.judgeGain.gain.value = this.judgeMuted ? 0 : 1;
  }
  syncPeerPrivacy() {
    if (this.peerGain && this.context) {
      if (this.client.capture.privateCheck()) {
        this.peerGain.gain.cancelScheduledValues(this.context.currentTime);
        this.peerGain.gain.setValueAtTime(0, this.context.currentTime);
      } else
        this.peerGain.gain.setTargetAtTime(
          this.peerMuted ? 0 : 1,
          this.context.currentTime,
          0.01,
        );
    }
    if (this.client.capture.privateCheck())
      this.peerPlayback?.port.postMessage({ type: "flush" });
  }
  mutePeer() {
    this.peerMuted = !this.peerMuted;
    this.syncPeerPrivacy();
    this.client.notify({ media: true });
  }

  muteJudge() {
    this.judgeMuted = !this.judgeMuted;
    if (this.judgeGain) this.judgeGain.gain.value = this.judgeMuted ? 0 : 1;
    if (this.judgeMuted) this.stopEffects();
    this.updateEffectsGain();
    this.client.notify({ media: true });
  }
  duckForSpeech() {
    this.speechUntil = performance.now() + 250;
    this.updateEffectsGain();
  }
  updateEffectsGain() {
    if (!this.context || !this.effectsGain) return;
    const speaking =
      this.client.state?.judge?.status === "speaking" ||
      performance.now() < this.speechUntil;
    this.effectsGain.gain.setTargetAtTime(
      this.judgeMuted ? 0 : speaking ? 0.15 : 0.65,
      this.context.currentTime,
      0.01,
    );
  }
  stopEffects() {
    for (const node of this.effectNodes) {
      try {
        node.stop();
      } catch {
        /* Already ended. */
      }
      node.disconnect();
    }
    this.effectNodes.clear();
  }
  private trackEffect(node: AudioScheduledSourceNode) {
    this.effectNodes.add(node);
    node.onended = () => {
      this.effectNodes.delete(node);
      node.disconnect();
    };
  }
  effect(kind: "coin" | "score" | "verdict") {
    if (
      !this.context ||
      !this.effectsGain ||
      this.context.state !== "running" ||
      this.judgeMuted
    )
      return;
    const now = performance.now();
    if (kind === "score" && now - this.effectAt < 180) return;
    this.effectAt = now;
    this.updateEffectsGain();
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
      pop.connect(filter).connect(gain).connect(this.effectsGain);
      this.trackEffect(pop);
      pop.start();
      return;
    }
    const freqs = kind === "coin" ? [220, 880] : [392, 523, 659, 784];
    freqs.forEach((f, i) => {
      const o = this.context!.createOscillator(),
        g = this.context!.createGain(),
        at = this.context!.currentTime + i * 0.075;
      o.type = kind === "coin" ? "triangle" : "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.05, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
      o.connect(g).connect(this.effectsGain!);
      this.trackEffect(o);
      o.start(at);
      o.stop(at + 0.2);
    });
  }
}
