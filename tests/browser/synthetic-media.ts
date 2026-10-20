import type { BrowserContext } from "@playwright/test";

/** Distinct continuous test tones exercise actual capture and received output.
 * This also avoids WebKit mock-microphone silence across reloads. The real camera
 * fixture, game worklets, RTC/sockets, private checks, and provider adapter remain. */
export async function syntheticMicrophone(
  context: BrowserContext,
  frequency = 330,
) {
  await context.addInitScript((frequency) => {
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
        // Opening a discarded native microphone can reconfigure CoreAudio and
        // pause WebKit's shared audio clock, interrupting the generated tone.
        const stream = constraints.video
          ? await acquire({ ...constraints, audio: false })
          : new MediaStream();
        const tone = audio.createOscillator(),
          gain = audio.createGain();
        const destination = audio.createMediaStreamDestination();
        tone.frequency.value = frequency;
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
  }, frequency);
}
