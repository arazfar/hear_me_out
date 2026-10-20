import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "../src/game/client";
import { ServerClock } from "../src/media/server-clock";
import { decodeMicrophone, encodeMicrophone } from "../shared/media";
import { roomFixture } from "./fixtures";

for (const [uplink, downlink] of [
  [75, 75],
  [150, 150],
  [250, 250],
  [450, 50],
  [50, 450],
]) {
  for (const senderSkew of [-60000, 60000]) {
    test(`relay admits ${uplink}+${downlink} ms delivery plus 100 ms varying jitter with opposed ${senderSkew} ms clocks`, (t) => {
      const start = 100000,
        receiverSkew = -senderSkew;
      let now = start,
        wallSkew = 0;
      t.mock.method(Date, "now", () => now + wallSkew);
      const sender = new Client(),
        client = new Client();
      // Distinct monotonic origins, independent wall clocks, and actual clock
      // observations. Never replace Client.serverNow() with the expected answer.
      sender.clock = new ServerClock(() => now - start + 7312);
      client.clock = new ServerClock(() => now - start + 19000);
      sender.clock.observe(now - 20, 40);
      client.clock.observe(now - 60, 120);
      const { room } = roomFixture({ now: () => now });
      t.after(() => room.close());
      room.game.setMediaMode("wss");
      client.state = room.game.snapshot();
      client.sound.context = {} as AudioContext;
      const admitted: number[] = [],
        ages: number[] = [];
      client.sound.peerPlayback = {
        port: {
          postMessage: (message: { pcm: ArrayBuffer }) => {
            assert.equal(message.pcm.byteLength, 1280);
            admitted.push(new Float32Array(message.pcm)[0] * 32768);
          },
        },
      } as unknown as AudioWorkletNode;
      const captured = new Map<number, Uint8Array>(),
        forwarded = new Map<number, Buffer>();
      room.media.forward = (_id, _channel, bytes) => {
        forwarded.set(decodeMicrophone(bytes)!.seq, bytes);
      };
      const events: { at: number; run: () => void }[] = [];
      const id = room.game.state.players[0].id;
      for (let seq = 1; seq <= 50; seq++) {
        const at = start + (seq - 1) * 20;
        // A triangular delay grows and shrinks by 20 ms. Equal arrival times
        // model ordered TCP catch-up without inventing packet reordering.
        const step = seq % 10,
          jitter = Math.min(step, 10 - step) * 20;
        events.push({
          at,
          run: () => {
            wallSkew = senderSkew * (now < start + 500 ? 1 : -1);
            if (seq === 26) sender.clock.observe(now - 20, 40);
            assert.notEqual(
              Date.now(),
              now,
              "sender wall clock is actually skewed",
            );
            assert.equal(sender.serverNow(), now);
            captured.set(
              seq,
              encodeMicrophone(
                room.game.state.mediaEpoch,
                seq,
                sender.serverNow(),
                new Uint8Array(new Int16Array(320).fill(seq).buffer),
              ),
            );
          },
        });
        events.push({
          at: at + uplink + jitter / 2,
          run: () => {
            wallSkew = 0;
            room.media.audio(id, Buffer.from(captured.get(seq)!));
          },
        });
        events.push({
          at: at + uplink + downlink + jitter,
          run: () => {
            wallSkew = receiverSkew * (now < start + 500 ? 1 : -1);
            if (seq === 26) client.clock.observe(now - 60, 120);
            assert.notEqual(
              Date.now(),
              now,
              "receiver wall clock is independently skewed",
            );
            assert.equal(client.serverNow(), now);
            const bytes = forwarded.get(seq);
            assert(bytes, "eligible packet passes server admission");
            ages.push(client.serverNow() - decodeMicrophone(bytes)!.capturedAt);
            client.audio(Uint8Array.from(bytes).buffer);
          },
        });
      }
      for (const event of events.sort((a, b) => a.at - b.at)) {
        now = event.at;
        event.run();
      }
      assert.deepEqual(
        admitted,
        Array.from({ length: 50 }, (_, i) => i + 1),
      );
      assert.equal(Math.min(...ages), uplink + downlink);
      assert.equal(Math.max(...ages), uplink + downlink + 100);
      assert.equal(client.relayAudioAgeDrops, 0);
      assert.equal(room.media.audioRejections.relayAge, 0);
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
  client.clock = new ServerClock(() => 0);
  client.clock.observe(now);
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
