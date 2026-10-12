export async function streamVoice(
  text: string,
  onChunk: (pcm: Uint8Array) => void,
  isCancelled: () => boolean,
  maxSeconds = 4.5,
) {
  if (!process.env.FISH_AUDIO_API_KEY)
    throw new Error("Fish Audio key is missing");
  const abort = new AbortController();
  const cancellation = setInterval(() => {
    if (isCancelled()) abort.abort();
  }, 25);
  cancellation.unref();
  const timeout = setTimeout(() => abort.abort(), 12000);
  timeout.unref();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
    count = 0,
    carry = Buffer.alloc(0);
  try {
    const response = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      signal: abort.signal,
      headers: {
        Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}`,
        "Content-Type": "application/json",
        model: process.env.FISH_TTS_MODEL || "s2-pro",
      },
      body: JSON.stringify({
        text: `[excited] ${text.replace(/\[[^\]]*\]/g, "")}`,
        reference_id:
          process.env.FISH_VOICE_ID || "29f4e37195264ebc86cf568ea6e36aff",
        format: "pcm",
        sample_rate: 44100,
        latency: "low",
        chunk_length: 100,
        prosody: { speed: 1.2, volume: 4, normalize_loudness: true },
      }),
    });
    if (!response.ok || !response.body)
      throw new Error(`Fish Audio synthesis failed (${response.status})`);
    reader = response.body.getReader();
    while (!isCancelled()) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = Buffer.concat([carry, Buffer.from(value)]),
        available = bytes.length - (bytes.length % 2);
      const samples = Math.min(
        available / 2,
        Math.max(0, Math.floor(maxSeconds * 44100) - count),
      );
      const floats = new Float32Array(samples);
      for (let i = 0; i < samples; i++)
        floats[i] = bytes.readInt16LE(i * 2) / 32768;
      carry = Buffer.from(bytes.subarray(available));
      count += samples;
      if (samples && !isCancelled()) onChunk(new Uint8Array(floats.buffer));
      if (count >= Math.floor(maxSeconds * 44100)) break;
    }
  } catch (error) {
    if (!isCancelled()) throw error;
  } finally {
    clearInterval(cancellation);
    clearTimeout(timeout);
    abort.abort();
    try {
      await reader?.cancel();
    } catch {}
  }
  return count / 44100;
}
