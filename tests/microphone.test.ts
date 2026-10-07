import test from "node:test";
import assert from "node:assert/strict";
import { Controller, type Seat } from "../server/controller";

test("timestamped microphone packets retain attribution and reject replay or old media epochs", () => {
  const c = new Controller("0246");
  const a = c.game.addPlayer("Sam"),
    b = c.game.addPlayer("Alex");
  c.game.state.mediaMode = "wss";
  const forwarded: Buffer[] = [],
    transcribed: Buffer[] = [];
  const seat = (): Seat => ({
    tokenHash: "test",
    epoch: 1,
    sockets: new Map(),
    audioSeq: -1,
    lastAudioAt: 0,
    voiceAt: 0,
    lastActivity: 0,
    rtcReady: false,
    acks: new Map(),
  });
  c.seats.set(a.id, seat());
  c.seats.set(b.id, seat());
  c.seats
    .get(b.id)!
    .sockets.set("audio", {
      readyState: 1,
      bufferedAmount: 0,
      send: (raw: Buffer) => forwarded.push(raw),
    } as any);
  c.ink.set(a.id, { send: (pcm: Buffer) => transcribed.push(pcm) } as any);
  const packet = Buffer.alloc(665);
  packet[0] = 1;
  packet.writeUInt32LE(c.game.state.mediaEpoch, 1);
  packet.writeUInt32LE(1, 5);
  packet.writeUInt32LE(16000, 9);
  packet.writeUInt32LE(320, 13);
  packet.writeDoubleLE(Date.now(), 17);
  packet.writeInt16LE(1234, 25);
  c.audio(a.id, packet);
  assert.equal(transcribed.length, 1);
  assert.equal(transcribed[0].length, 640);
  assert.equal(transcribed[0].readInt16LE(0), 1234);
  assert.equal(forwarded.length, 1);
  c.audio(a.id, packet);
  assert.equal(transcribed.length, 1, "replayed sequence cannot enter STT");
  packet.writeUInt32LE(2, 5);
  packet.writeUInt32LE(99, 1);
  c.audio(a.id, packet);
  assert.equal(transcribed.length, 1);
  packet.writeUInt32LE(c.game.state.mediaEpoch, 1);
  packet.writeDoubleLE(Date.now() - 1000, 17);
  c.audio(a.id, packet);
  assert.equal(
    transcribed.length,
    2,
    "transport delay must not discard scoring evidence",
  );
  assert.equal(
    forwarded.length,
    1,
    "stale audio must not create playback backlog",
  );
});
