import "dotenv/config";
import { writeFileSync } from "node:fs";
import { streamVoice } from "../server/providers";
const chunks: Buffer[] = [];
await streamVoice(
  "Pancakes spread syrup across their soft surface, so every bite tastes balanced instead of hiding puddles in pockets.",
  (p) => chunks.push(Buffer.from(p)),
  () => false,
  12,
);
const bytes = Buffer.concat(chunks),
  floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4),
  pcm = Buffer.alloc(Math.floor((floats.length * 16000) / 44100) * 2);
for (let i = 0; i < pcm.length / 2; i++)
  pcm.writeInt16LE(
    Math.max(
      -32768,
      Math.min(
        32767,
        Math.round(floats[Math.floor((i * 44100) / 16000)] * 32767),
      ),
    ),
    i * 2,
  );
writeFileSync("output/test-argument.pcm", pcm);
console.log(
  JSON.stringify({ generatedTestAudio: true, samples: pcm.length / 2 }),
);
process.exit();
