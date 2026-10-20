import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "../src/game/client";
import { ServerClock } from "../src/media/server-clock";
import { encodeMicrophone } from "../shared/media";
import { roomFixture } from "./fixtures";

for (const [uplink, downlink] of [
  [75, 75],
  [150, 150],
  [250, 250],
  [250, 350],
  [500, 100],
  [100, 500],
  [375, 375],
]) {
  for (const skew of [-60000, 60000]) {
    test(`relay admits 50 in-order frames with ${uplink}+${downlink} ms age and ${skew} ms wall skew`, (t) => {
      let serverNow = 100000;
      const { room } = roomFixture({ now: () => serverNow });
      t.after(() => room.close());
      room.game.setMediaMode("wss");
      const client = new Client();
      client.state = room.game.snapshot();
      client.sound.context = {} as AudioContext;
      const admitted: ArrayBuffer[] = [];
      client.sound.peerPlayback = {
        port: {
          postMessage: (message: { pcm: ArrayBuffer }) =>
            admitted.push(message.pcm),
        },
      } as unknown as AudioWorkletNode;
      client.serverNow = () => serverNow + downlink;
      room.media.forward = (_id, _channel, bytes) =>
        client.audio(Uint8Array.from(bytes).buffer);
      let monotonic = 0;
      const clock = new ServerClock(() => monotonic);
      clock.observe(serverNow + skew - skew - uplink);
      const id = room.game.state.players[0].id;
      for (let seq = 1; seq <= 50; seq++) {
        room.media.audio(
          id,
          Buffer.from(
            encodeMicrophone(
              room.game.state.mediaEpoch,
              seq,
              clock.now(),
              new Uint8Array(640).fill(1),
            ),
          ),
        );
        monotonic += 20;
        serverNow += 20;
      }
      assert.equal(admitted.length, 50);
      assert(admitted.every((pcm) => pcm.byteLength === 1280));
    });
  }
}

test("relay drops expired audio on either hop and keeps mode, epoch, private-check, and explicit mute isolation", (t) => {
  const now = 100000;
  const { room } = roomFixture({ now: () => now });
  t.after(() => room.close());
  room.game.setMediaMode("wss");
  const client = new Client();
  client.state = room.game.snapshot();
  client.sound.context = { currentTime: 1 } as AudioContext;
  client.serverNow = () => now;
  let admitted = 0,
    forwarded = 0,
    gain = 1;
  client.sound.peerPlayback = {
    port: {
      postMessage: (message: { pcm?: ArrayBuffer }) => {
        if (message.pcm) admitted++;
      },
    },
  } as AudioWorkletNode;
  client.sound.peerGain = {
    gain: {
      setTargetAtTime: (value: number) => {
        gain = value;
      },
      setValueAtTime: (value: number) => {
        gain = value;
      },
      cancelScheduledValues: () => {},
    },
  } as unknown as GainNode;
  room.media.forward = (_id, _channel, bytes) => {
    forwarded++;
    client.audio(Uint8Array.from(bytes).buffer);
  };
  let seq = 0;
  const packet = (
    age: number,
    purpose: "social" | "private" = "social",
    epoch = room.game.state.mediaEpoch,
  ) =>
    encodeMicrophone(epoch, ++seq, now - age, new Uint8Array(640), {
      purpose,
      inputEpoch: 0,
    });
  const id = room.game.state.players[0].id;
  room.media.audio(id, Buffer.from(packet(751)));
  assert.equal(forwarded, 0);
  assert.equal(room.media.audioRejections.relayAge, 1);
  room.media.audio(id, Buffer.from(packet(750)));
  assert.equal(admitted, 1);
  client.audio(packet(751).buffer);
  assert.equal(admitted, 1);
  assert.equal(client.relayAudioAgeDrops, 1);
  client.state.mediaMode = "rtc";
  client.audio(packet(500).buffer);
  assert.equal(admitted, 1);
  client.state.mediaMode = "wss";
  client.audio(packet(500, "social", client.state.mediaEpoch + 1).buffer);
  client.audio(packet(500, "private").buffer);
  client.capture.privateCheck = () => true;
  client.audio(packet(500).buffer);
  assert.equal(admitted, 1);
  client.capture.privateCheck = () => false;
  client.sound.mutePeer();
  client.audio(packet(500).buffer);
  assert.equal(gain, 0);
  assert.equal(
    admitted,
    2,
    "playback admission cannot override explicit output mute",
  );
  client.sound.mutePeer();
  assert.equal(gain, 1);
});
