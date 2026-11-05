import assert from "node:assert/strict";
import test from "node:test";
import { FishStream } from "../server/providers/fish-stream";
import { PreparedVoice } from "../server/judge/voice-cache";
import { CaptionClock } from "../src/media/caption-clock";
import { captionAlignmentSchema, type CaptionCue } from "../shared/domain";
import { commandSchema, PROTOCOL_VERSION } from "../shared/protocol";
import { Game } from "../server/game/game";

test("Ready is one way, duplicate requests are idempotent, obsolete commands must refresh", () => {
  assert.equal(PROTOCOL_VERSION, 6);
  assert(commandSchema.safeParse({ type: "ready" }).success);
  for (const value of [true, false])
    assert(!commandSchema.safeParse({ type: "ready", value }).success);
  const game = new Game("1234");
  const p = game.addPlayer("Sam");
  assert.throws(() => game.ready(p.id), /check first/);
  p.mediaReady = true;
  game.ready(p.id);
  const seq = game.state.seq;
  game.ready(p.id);
  assert(p.ready);
  assert.equal(game.state.seq, seq);
});

function event(
  audio: number[],
  chunk_seq: number,
  offset: number,
  segments: unknown,
) {
  return (
    "data: " +
    JSON.stringify({
      audio_base64: Buffer.from(audio).toString("base64"),
      chunk_seq,
      chunk_audio_offset_sec: offset,
      alignment: segments === null ? null : { segments },
    }) +
    "\r\n\r\n"
  );
}
test("timestamp streams preserve every PCM byte across UTF-8/CRLF fragments and replace alignment snapshots", () => {
  const bytes: number[] = [],
    updates: CaptionCue[][] = [];
  const stream = new FishStream(
    (chunk) => bytes.push(...chunk),
    (cues) => updates.push(cues),
  );
  const input =
    ": keepalive\r\n\r\n" +
    event([0, 1, 2], 0, 0, null) +
    event([3], 0, 0, [{ text: "Bonk’s", start: 0, end: 0.2 }]) +
    event([4, 5], 0, 0, [{ text: "Bonk’s", start: 0, end: 0.3 }]) +
    event([], 1, 0.5, [{ text: "verdict", start: 0, end: 0.2 }]);
  for (const b of new TextEncoder().encode(input))
    stream.push(new Uint8Array([b]));
  stream.push(new Uint8Array(), true);
  assert.deepEqual(bytes, [0, 1, 2, 3, 4, 5]);
  assert.equal(updates.length, 3);
  assert.deepEqual(updates.at(-1), [
    { text: "Bonk’s", start: 0, end: 13230 },
    { text: "verdict", start: 22050, end: 30870 },
  ]);
});
test("bad alignment never discards audio; multiline SSE and EOF are supported", () => {
  const bytes: number[] = [],
    cues: CaptionCue[][] = [];
  const stream = new FishStream(
    (b) => bytes.push(...b),
    (c) => cues.push(c),
  );
  stream.push(
    new TextEncoder().encode(
      'data: {"audio_base64":"AAE=",\ndata: "alignment":null}\n\n',
    ),
  );
  stream.push(new TextEncoder().encode("data: null\n\n"));
  stream.push(
    new TextEncoder().encode(
      event([2, 3], 0, 0, [{ text: "bad", start: -1, end: 50 }]) +
        event([4, 5], 1, 2, [
          { text: "negative relative time", start: -1, end: 1 },
        ]) +
        event(
          [6, 7],
          2,
          0,
          Array(513).fill({ text: "excess", start: 0, end: 1 }),
        ).trim(),
    ),
    true,
  );
  assert.deepEqual(bytes, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(cues.length, 0);
  assert(
    !captionAlignmentSchema.safeParse({
      revision: 1,
      cues: Array(513).fill({ text: "a", start: 0, end: 1 }),
    }).success,
  );
});
test("prepared voice caches and replays the latest alignment without synthesizing twice", async () => {
  let calls = 0;
  const expected = [{ text: "Hello", start: 0, end: 100 }];
  const voice = new PreparedVoice(
    "Hello",
    20,
    async (_, audio, _cancelled, _budget, aligned) => {
      calls++;
      audio(new Uint8Array([0, 1]));
      aligned?.(expected);
      return 1 / 44100;
    },
  );
  for (let i = 0; i < 2; i++) {
    const chunks: Uint8Array[] = [],
      cues: CaptionCue[][] = [];
    await voice.stream(
      (b) => chunks.push(b),
      () => false,
      (c) => cues.push(c),
    );
    assert.equal(chunks.length, 1);
    assert.deepEqual(cues, [expected]);
  }
  assert.equal(calls, 1);
});
test("caption cursor follows output time, freezes in gaps, never guesses future samples, and resets", () => {
  const clock = new CaptionClock();
  clock.record(0, 1);
  clock.record(4410, 1.1);
  clock.record(4410, 2);
  assert.equal(clock.at(0.5), 0);
  assert(Math.abs(clock.at(1.05) - 2205) <= 1);
  assert.equal(clock.at(1.8), 4410);
  assert.equal(clock.at(10), 4410);
  clock.record(0, 3); // stale sample regression
  assert.equal(clock.at(10), 4410);
  clock.reset();
  assert.equal(clock.at(10), 0);
});

test("spoken phrases follow cue offsets, hold between words, and reconcile transcript corrections", async () => {
  const { spokenPhrase, latestPhrase } =
    await import("../src/ui/caption-phrases");
  const cues = [
    { text: "A", start: 10, end: 20 },
    { text: "clear verdict.", start: 30, end: 40 },
  ];
  assert.equal(spokenPhrase(cues, 0), null);
  assert.deepEqual(spokenPhrase(cues, 15), { cues: [cues[0]], active: 0 });
  assert.deepEqual(spokenPhrase(cues, 25), { cues: [cues[0]], active: -1 });
  assert.equal(spokenPhrase(cues, 35)?.active, 1);
  assert.equal(spokenPhrase(cues, 50)?.active, -1);
  assert.equal(latestPhrase("Waffles are better"), "Waffles are better");
  assert.equal(latestPhrase("Waffles were better"), "Waffles were better");
});
