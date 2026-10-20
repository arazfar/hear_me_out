import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import type { BrowserContext } from "@playwright/test";
import { syntheticMicrophone } from "./browser/synthetic-media";

class Track {
  stopped = false;
  constructor(readonly kind: "audio" | "video") {}
  stop() {
    this.stopped = true;
  }
}

class Stream {
  constructor(readonly tracks: Track[] = []) {}
  addTrack(track: Track) {
    this.tracks.push(track);
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }
}

async function fixture(frequency = 330) {
  const requests: (MediaStreamConstraints | undefined)[] = [];
  const camera = new Track("video");
  const captured = new Stream([camera]);
  let failure: Error | undefined;
  const nodes: {
    frequency: { value: number };
    gain: { value: number };
    started: boolean;
    stopped: boolean;
    disconnected: boolean;
  }[] = [];
  const node = () => {
    const value = {
      frequency: { value: 0 },
      gain: { value: 0 },
      started: false,
      stopped: false,
      disconnected: false,
      connect(target: unknown) {
        return target;
      },
      start() {
        this.started = true;
      },
      stop() {
        this.stopped = true;
      },
      disconnect() {
        this.disconnected = true;
      },
    };
    nodes.push(value);
    return value;
  };
  let contexts = 0;
  const realm = {
    AudioContext: class {
      constructor() {
        contexts++;
      }
      createOscillator = node;
      createGain = node;
      createMediaStreamDestination = () => ({
        stream: new Stream([new Track("audio")]),
      });
    },
    MediaStream: Stream,
    navigator: {
      mediaDevices: {
        getUserMedia: async (constraints?: MediaStreamConstraints) => {
          requests.push(constraints);
          assert(
            !constraints?.audio,
            "synthetic capture must not open native audio",
          );
          if (failure) throw failure;
          return captured;
        },
      },
    },
    frequency,
    // tsx names transformed classes/functions inside the serialized init script.
    __name: (value: unknown) => value,
  };
  await syntheticMicrophone(
    {
      addInitScript: async (script: Function) => {
        runInNewContext(`(${script.toString()})(frequency)`, {
          ...realm,
          window: realm,
        });
      },
    } as unknown as BrowserContext,
    frequency,
  );
  new realm.AudioContext();
  return {
    acquire: realm.navigator.mediaDevices.getUserMedia,
    requests,
    captured,
    camera,
    nodes,
    contexts: () => contexts,
    fail: (error: Error) => {
      failure = error;
    },
  };
}

test("synthetic microphone preserves camera capture and releases only its audio generator", async () => {
  const f = await fixture(550);
  const video = { deviceId: { exact: "camera" }, width: { ideal: 640 } };
  const stream = await f.acquire({ audio: { echoCancellation: true }, video });
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]?.audio, false);
  assert.equal(f.requests[0]?.video, video);
  assert.equal(stream, f.captured);
  assert.deepEqual(stream.getVideoTracks(), [f.camera]);
  assert.equal(f.contexts(), 1, "reuse the game's unlocked audio context");
  const [tone, gain] = f.nodes;
  assert.equal(tone.frequency.value, 550);
  assert.equal(gain.gain.value, 0.12);
  assert(tone.started);
  const [audio] = stream.getAudioTracks();
  assert(audio);
  audio.stop();
  assert(
    audio.stopped && tone.stopped && tone.disconnected && gain.disconnected,
  );
  assert.equal(f.camera.stopped, false);
});

test("audio-only synthetic replacements never acquire a native device and own separate generators", async () => {
  const f = await fixture();
  const first = await f.acquire({ audio: true });
  const second = await f.acquire({ audio: true, video: false });
  assert.equal(f.requests.length, 0);
  assert.equal(first.getVideoTracks().length, 0);
  assert.equal(second.getAudioTracks().length, 1);
  assert.notEqual(first.getAudioTracks()[0], second.getAudioTracks()[0]);
  first.getAudioTracks()[0].stop();
  assert(f.nodes[0].stopped);
  assert.equal(f.nodes[2].stopped, false);
  second.getAudioTracks()[0].stop();
  assert(f.nodes[2].stopped);
});

test("synthetic capture delegates non-audio requests and preserves camera acquisition errors", async () => {
  const f = await fixture();
  const constraints = { video: true, audio: false };
  assert.equal(await f.acquire(constraints), f.captured);
  assert.equal(f.requests[0], constraints);
  const error = new Error("Camera permission denied");
  f.fail(error);
  await assert.rejects(
    f.acquire({ audio: true, video: true }),
    (cause) => cause === error,
  );
  assert.equal(
    f.nodes.length,
    0,
    "failed camera capture must not start a generator",
  );
});
