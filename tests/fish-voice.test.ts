import test from "node:test";
import assert from "node:assert/strict";
import { streamVoice } from "../server/providers";

test("Fish voice streams odd PCM chunks with the requested identity, prosody, and excitement", async () => {
  const fetchBefore = globalThis.fetch,
    keyBefore = process.env.FISH_AUDIO_API_KEY;
  process.env.FISH_AUDIO_API_KEY = "test";
  let request: any, signal: AbortSignal | undefined;
  const chunks: Float32Array[] = [];
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(init!.body as string);
    signal = init!.signal as AbortSignal;
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([0, 64, 0]));
          c.enqueue(new Uint8Array([128, 255, 127, 0]));
          c.close();
        },
      }),
      { status: 200 },
    );
  };
  try {
    await streamVoice(
      "Sam, answer that argument.",
      (bytes) =>
        chunks.push(
          new Float32Array(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength / 4,
          ),
        ),
      () => false,
    );
    assert.equal(request.reference_id, "29f4e37195264ebc86cf568ea6e36aff");
    assert.equal(request.prosody.speed, 1.2);
    assert.equal(request.prosody.volume, 4);
    assert.match(request.text, /^\[excited\]/);
    assert.equal(request.format, "pcm");
    assert.equal(request.sample_rate, 44100);
    assert.deepEqual(
      chunks.flatMap((c) => Array.from(c)),
      [0.5, -1, 32767 / 32768],
    );
    assert(signal!.aborted);
  } finally {
    globalThis.fetch = fetchBefore;
    if (keyBefore === undefined) delete process.env.FISH_AUDIO_API_KEY;
    else process.env.FISH_AUDIO_API_KEY = keyBefore;
  }
});

test("Fish cancellation drops the rest of the response instead of forwarding buffered speech", async () => {
  const fetchBefore = globalThis.fetch,
    keyBefore = process.env.FISH_AUDIO_API_KEY;
  process.env.FISH_AUDIO_API_KEY = "test";
  let cancelled = false,
    count = 0;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([0, 64]));
          c.enqueue(new Uint8Array([0, 64]));
          c.close();
        },
      }),
    );
  try {
    await streamVoice(
      "Answer that.",
      () => {
        count++;
        cancelled = true;
      },
      () => cancelled,
    );
    assert.equal(count, 1);
  } finally {
    globalThis.fetch = fetchBefore;
    if (keyBefore === undefined) delete process.env.FISH_AUDIO_API_KEY;
    else process.env.FISH_AUDIO_API_KEY = keyBefore;
  }
});
