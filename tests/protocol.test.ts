import { ServerClock } from "../src/media/server-clock";
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeJudgeAudio,
  decodeMicrophone,
  decodeVideo,
  encodeJudgeAudio,
  encodeMicrophone,
  encodeVideo,
} from "../shared/media";
import {
  authSchema,
  auxiliarySchema,
  commandEnvelopeSchema,
  PROTOCOL_VERSION,
} from "../shared/protocol";
import { fakeVoice, flush, roomFixture } from "./fixtures";

test("codecs reject malformed lengths, timestamps, rates, and sample budgets before use", () => {
  const mic = encodeMicrophone(3, 1, 100000, new Uint8Array(640));
  assert.equal(decodeMicrophone(mic)?.samples, 320);
  for (const size of [0, 1, 16, 24, 26, 664])
    assert.equal(decodeMicrophone(mic.slice(0, size)), null);
  const invalid = mic.slice();
  new DataView(invalid.buffer).setFloat64(17, NaN, true);
  assert.equal(decodeMicrophone(invalid), null);
  new DataView(invalid.buffer).setFloat64(17, 100000, true);
  new DataView(invalid.buffer).setUint32(13, 0xffffffff, true);
  assert.equal(decodeMicrophone(invalid), null);
  const video = encodeVideo(
    3,
    7,
    100000,
    new Uint8Array([255, 216, 0, 255, 217]),
  );
  assert.equal(decodeVideo(video)?.seq, 7);
  assert.equal(decodeVideo(video.slice(0, -1)), null);
  const speech = encodeJudgeAudio(
    8,
    0,
    0,
    new Uint8Array(new Float32Array([0.1, 0.2]).buffer),
  );
  assert.equal(decodeJudgeAudio(speech)?.pcm.length, 2);
  assert.equal(decodeJudgeAudio(Buffer.from(speech))?.pcm.length, 2);
  new DataView(speech.buffer).setUint32(13, 44100 * 8, true);
  assert.equal(decodeJudgeAudio(speech), null);
});
test("shared schemas reject missing versions, nonfinite clocks, oversized signaling, and obsolete commands", () => {
  assert(
    !authSchema.safeParse({
      type: "auth",
      roomId: "r",
      playerId: "p",
      token: "t",
      connectionEpoch: 1,
    }).success,
  );
  assert(
    authSchema.safeParse({
      type: "auth",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "r",
      playerId: "p",
      token: "t",
      connectionEpoch: 1,
    }).success,
  );
  assert(
    !auxiliarySchema.safeParse({ type: "ping", clientTime: Infinity }).success,
  );
  assert(
    !auxiliarySchema.safeParse({
      type: "signal",
      mediaEpoch: 1,
      description: { type: "offer", sdp: "x".repeat(60001) },
    }).success,
  );
  assert(
    !commandEnvelopeSchema.safeParse({
      commandId: "c",
      connectionEpoch: 1,
      matchId: "m",
      expectedPhaseVersion: 1,
      command: { type: "barge_in", utteranceId: "u", speechEpoch: 1 },
    }).success,
  );
});
test("missing audio recipient cancels shared speech instead of silently dropping one copy", async () => {
  const { room } = roomFixture({ streamVoice: fakeVoice });
  await flush();
  await room.playback.say("Those syrup pockets came prepared.", null, false);
  assert.equal(room.playback.speech, null);
  assert.equal(room.game.state.degraded.tts, true);
  assert.equal(room.game.state.judge?.status, "silent");
  room.close();
});
test("diagnostic samples stay bounded", () => {
  const { room } = roomFixture();
  for (let i = 0; i < 1000; i++) room.recordMetric("scoringMs", i);
  assert.equal(room.metrics.scoringMs.length, 128);
  assert.equal(room.metrics.scoringMs.at(-1), 999);
  room.close();
});

test("synchronized capture timestamps keep relay audio alive with either clock offset", () => {
  for (const skew of [-60000, 60000]) {
    const now = 100000;
    const { room } = roomFixture({ now: () => now });
    room.game.lobby("Fixture media check");
    room.game.setMediaMode("wss");
    const player = room.game.state.players[0];
    let forwarded = 0;
    room.media.forward = () => {
      forwarded++;
    };
    // Local wall time is deliberately skewed; the capture clock uses the server observation.
    const localWall = now + skew;
    let monotonic = 0;
    const clock = new ServerClock(() => monotonic);
    clock.observe(localWall - skew);
    room.media.audio(
      player.id,
      Buffer.from(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          1,
          clock.now(),
          new Uint8Array(640),
        ),
      ),
    );
    monotonic += 20;
    room.media.audio(
      player.id,
      Buffer.from(
        encodeMicrophone(
          room.game.state.mediaEpoch,
          2,
          clock.now(),
          new Uint8Array(640),
        ),
      ),
    );
    assert.equal(forwarded, 2);
    room.close();
  }
});
