import type { BrowserContext } from "@playwright/test";

/** WebKit's mock microphone can become silent across reloads even in a bare
 * getUserMedia/Analyser page. Supply a continuous test tone, retaining its camera
 * and the game's capture worklet, sockets, private check, and provider adapter. */
export async function stableWebKitAudio(context: BrowserContext) {
  await context.addInitScript(() => {
    const OriginalContext = AudioContext;
    let captureContext: AudioContext;
    window.AudioContext = class extends OriginalContext {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        captureContext = this;
      }
    };
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints?.audio) return acquire(constraints);
      // Share the game's unlocked audio clock; a second synthetic context may
      // itself be autoplay-blocked after navigation in WebKit automation.
      const audio = captureContext;
      try {
        const stream = await acquire(constraints);
        for (const track of stream.getAudioTracks()) {
          stream.removeTrack(track);
          track.stop();
        }
        const tone = audio.createOscillator(),
          gain = audio.createGain();
        const destination = audio.createMediaStreamDestination();
        tone.frequency.value = 330;
        gain.gain.value = 0.12;
        tone.connect(gain).connect(destination);
        tone.start();
        const track = destination.stream.getAudioTracks()[0];
        const stop = track.stop.bind(track);
        track.stop = () => {
          stop();
          tone.stop();
          tone.disconnect();
          gain.disconnect();
        };
        stream.addTrack(track);
        return stream;
      } catch (error) {
        throw error;
      }
    };
  });
}
