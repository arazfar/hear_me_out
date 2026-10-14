import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "../src/game/client";
import { flush } from "./fixtures";

test("RTC detaches private test audio without muting or stopping its capture source", async () => {
  const client = new Client();
  const source = { enabled: true, readyState: "live" } as MediaStreamTrack;
  client.capture.stream = { getAudioTracks: () => [source] } as MediaStream;
  const sent: (MediaStreamTrack | null)[] = [];
  client.peer.audioSender = {
    replaceTrack: async (track: MediaStreamTrack | null) => {
      sent.push(track);
    },
  } as RTCRtpSender;
  client.peer.syncAudio();
  await flush();
  client.setup.busy = client.setup.listening = true;
  client.peer.syncAudio();
  await flush();
  assert.deepEqual(sent, [source, null]);
  assert.equal(source.enabled, true);
  assert.equal(source.readyState, "live");
  client.setup.busy = client.setup.listening = false;
  client.peer.syncAudio();
  await flush();
  assert.deepEqual(sent, [source, null, source]);
  client.peer.reset();
  assert.equal(source.readyState, "live");
});

test("remote video and audio follow live receivers after an offer rollback", async () => {
  const saved = globalThis.MediaStream;
  class Stream {
    constructor(readonly tracks: MediaStreamTrack[]) {}
    getTracks() {
      return this.tracks;
    }
    getVideoTracks() {
      return this.tracks.filter((t) => t.kind === "video");
    }
  }
  globalThis.MediaStream = Stream as unknown as typeof MediaStream;
  try {
    const client = new Client();
    let connects = 0,
      disconnects = 0;
    client.sound.context = {
      createAnalyser: () => ({
        fftSize: 256,
        connect: () => connects++,
        disconnect: () => {},
        getFloatTimeDomainData: () => {},
      }),
      createMediaStreamSource: () => ({
        connect: () => connects++,
        disconnect: () => disconnects++,
      }),
    } as unknown as AudioContext;
    client.sound.peerGain = {} as GainNode;
    const track = (kind: string, muted: boolean) =>
      ({ kind, muted, readyState: "live" }) as MediaStreamTrack;
    const stale = [track("video", true), track("audio", true)];
    const current = [track("video", false), track("audio", false)];
    client.peer.remote = new Stream(stale) as unknown as MediaStream;
    client.peer.pc = {
      connectionState: "connected",
      close: () => {},
      getStats: async () =>
        new Map([
          [1, { type: "inbound-rtp", kind: "video", framesDecoded: 5 }],
        ]),
      getReceivers: () => [...stale, ...current].map((track) => ({ track })),
    } as unknown as RTCPeerConnection;
    await client.peer.sample();
    assert.deepEqual(client.peer.remote?.getTracks(), current);
    assert.equal(client.peer.remoteFrames, 5);
    await client.peer.sample();
    assert.equal(
      connects,
      2,
      "health sampling must not reconnect healthy audio",
    );
    Object.assign(current[0], { muted: true });
    await client.peer.sample();
    assert.equal(
      client.peer.remoteFrames,
      0,
      "old decoder totals cannot prove delivery to an interrupted track",
    );
    client.peer.reset();
    assert.equal(disconnects, 1);
  } finally {
    globalThis.MediaStream = saved;
  }
});
