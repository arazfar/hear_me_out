import "dotenv/config";
import { streamVoice, InkSession, judge } from "../server/providers";
import { Game } from "../server/game";
import type { Segment } from "../shared/types";
const g = new Game("1234");
const a = g.addPlayer("Sam"),
  b = g.addPlayer("Alex");
a.mediaReady = b.mediaReady = true;
g.startMatch();
g.state.headsId = a.id;
g.state.tailsId = b.id;
g.selectTopic();
g.proposeTopic(
  g.state.tailsId!,
  "Waffles are a better breakfast than pancakes.",
  "Pancakes",
  "Waffles",
  true,
);
g.confirm(a.id, 1);
g.confirm(b.id, 1);
const t = g.state.turn!;
const chunks: Buffer[] = [];
const ttsAt = Date.now();
let first = 0;
await streamVoice(
  "Waffles trap syrup in pockets, so every bite gets sweetness instead of the last bite swimming in a puddle.",
  (pcm) => {
    first ||= Date.now();
    chunks.push(Buffer.from(pcm));
  },
  () => false,
  12,
);
console.log(
  JSON.stringify({
    ttsFirstChunkMs: first - ttsAt,
    audioBytes: chunks.reduce((n, b) => n + b.length, 0),
  }),
);
const combined = Buffer.concat(chunks);
const pcm = new Float32Array(
  combined.buffer,
  combined.byteOffset,
  combined.length / 4,
);
const output = Buffer.alloc(Math.floor((pcm.length * 16000) / 44100) * 2);
for (let i = 0; i < output.length / 2; i++)
  output.writeInt16LE(
    Math.max(
      -32768,
      Math.min(32767, Math.round(pcm[Math.floor((i * 44100) / 16000)] * 32767)),
    ),
    i * 2,
  );
let resolve!: (s: Segment) => void;
const stable = new Promise<Segment>((r) => (resolve = r));
const ink = new InkSession(t.playerId, g.state.roundId!, t.id, {
  caption: () => {},
  segment: (s) => resolve(s),
  start: () => {},
  end: () => {},
  error: (e) =>
    console.error(
      "STT error:",
      e instanceof Error ? e.message : "provider error",
    ),
});
await new Promise((r) => setTimeout(r, 350));
for (let at = 0; at < output.length; at += 3200) {
  ink.send(output.subarray(at, at + 3200));
  await new Promise((r) => setTimeout(r, 100));
}
for (let i = 0; i < 25; i++) {
  ink.send(Buffer.alloc(3200));
  await new Promise((r) => setTimeout(r, 100));
}
const s = await Promise.race([
  stable,
  new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("No stable attributed transcript")),
      6000,
    ),
  ),
]);
ink.close();
console.log(
  JSON.stringify({
    transcript: s.text,
    eligible: s.eligible,
    playerCorrect: s.playerId === t.playerId,
  }),
);
g.registerSegment(s);
const at = Date.now();
const proposal = await judge(
  g.snapshot(),
  [s],
  t.kind,
  t.targets,
  [s],
  [],
  "smoke",
  ["claim-a", "claim-b"],
);
for (const score of proposal.scores) g.score(score);
console.log(
  JSON.stringify({
    judgeMs: Date.now() - at,
    scoreUnits: g.player(t.playerId).scoreUnits,
    intervention: proposal.intervention,
    committedReasons: g.state.ledger.map((e) => e.reason),
  }),
);
process.exit(g.state.ledger.length ? 0 : 1);
