import "dotenv/config";
import { WebSocket } from "ws";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { streamVoice } from "../server/providers";
import { canSpeak, type Snapshot, type Command } from "../shared/types";
const base = process.env.TEST_URL || "http://127.0.0.1:3001",
  wsbase = base.replace(/^http/, "ws");
const sleep = (n: number) => new Promise((r) => setTimeout(r, n));
const post = async (path: string, data: unknown) => {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const b = await r.json();
  if (!r.ok) throw Error(b.error);
  return b;
};
const a = await post("/api/rooms", { name: "Sam" }),
  b = await post("/api/join", { name: "Alex", code: a.session.code });
class Peer {
  state: Snapshot;
  sockets = new Map<string, WebSocket>();
  seq = 0;
  pcm = Buffer.alloc(640);
  interval: any;
  voiceHashes: string[] = [];
  interventions: string[] = [];
  cancelled = 0;
  readyEpochs = new Set<number>();
  errors: string[] = [];
  transcripts: Array<{
    playerId: string;
    roundId: string;
    turnId: string | null;
    text: string;
  }> = [];
  constructor(
    public session: any,
    state: Snapshot,
  ) {
    this.state = state;
  }
  command(command: Command, id = crypto.randomUUID()) {
    this.sockets.get("control")!.send(
      JSON.stringify({
        commandId: id,
        connectionEpoch: this.session.connectionEpoch,
        matchId: this.state.matchId,
        expectedPhaseVersion: this.state.phaseVersion,
        command,
      }),
    );
    return id;
  }
  async connect() {
    for (const ch of ["control", "audio", "video"]) {
      const s = new WebSocket(`${wsbase}/socket/${ch}`);
      this.sockets.set(ch, s);
      await new Promise<void>((r) =>
        s.on("open", () => {
          s.send(JSON.stringify({ type: "auth", ...this.session }));
          r();
        }),
      );
      s.on("message", (raw, binary) => {
        if (binary) {
          if (ch === "audio" && raw[0] === 2) {
            this.voiceHashes.push(
              createHash("sha256")
                .update(raw as Buffer)
                .digest("hex"),
            );
            const j = this.state.judge;
            if (j && !this.readyEpochs.has(j.epoch)) {
              this.readyEpochs.add(j.epoch);
              this.command({
                type: "audio_ready",
                utteranceId: j.id,
                speechEpoch: j.epoch,
              });
            }
          }
          return;
        }
        const event = JSON.parse(raw.toString());
        if (event.snapshot) this.state = event.snapshot;
        if (
          event.type === "transcript" &&
          event.payload.final &&
          event.payload.text
        )
          this.transcripts.push({
            playerId: event.payload.playerId,
            roundId: this.state.roundId!,
            turnId: event.payload.turnId,
            text: event.payload.text,
          });
        if (event.type === "judge_buffer")
          this.interventions.push(this.state.judge!.text);
        if (event.type === "judge_cancelled") this.cancelled++;
        if (event.type === "ack" && !event.ok) this.errors.push(event.error);
      });
    }
    this.interval = setInterval(() => this.audio(), 20);
  }
  audio() {
    const h = Buffer.alloc(25);
    h[0] = 1;
    h.writeUInt32LE(this.state.mediaEpoch, 1);
    h.writeUInt32LE(++this.seq, 5);
    h.writeUInt32LE(16000, 9);
    h.writeUInt32LE(320, 13);
    h.writeDoubleLE(Date.now(), 17);
    this.sockets.get("audio")!.send(Buffer.concat([h, canSpeak(this.state, this.session.playerId) ? this.pcm : Buffer.alloc(640)]));
  }
  close() {
    clearInterval(this.interval);
    for (const s of this.sockets.values()) s.close();
  }
}
const pa = new Peer(a.session, a.snapshot),
  pb = new Peer(b.session, b.snapshot);
await pa.connect();
await pb.connect();
const status = setInterval(() => {
  for (const p of [pa, pb])
    p.command({
      type: "media_status",
      ready: true,
      cameraOn: false,
      rtc: false,
    });
}, 1000);
async function wait(check: () => boolean, timeout = 40000) {
  const at = Date.now();
  while (!check()) {
    if (pa.state.phase === "ABORTED") throw Error(pa.state.status);
    if (Date.now() - at > timeout)
      throw Error(`Wait expired in ${pa.state.phase}: ${pa.state.status}`);
    await sleep(100);
  }
}
await wait(() => pa.state.players.every((p) => p.mediaReady));
console.log(
  JSON.stringify({
    room: a.session.code,
    media: pa.state.mediaMode,
    ready: true,
  }),
);
pa.command({ type: "ready", value: true });
pb.command({ type: "ready", value: true });
await wait(() => pa.state.judge?.status === "speaking", 10000);
console.log(JSON.stringify({exclusiveIntro: true, offFloorScoreUnits: pa.state.ledger.reduce((n, e) => n + e.deltaUnits, 0)}));
await wait(() => pa.state.phase === "TOPIC_SELECT");
const tails = pa.state.tailsId === pa.session.playerId ? pa : pb;
tails.command({
  type: "propose_topic",
  text: "Waffles versus pancakes",
  chosenPosition: "I defend waffles",
});
await wait(() => pa.state.phase === "TOPIC_CONFIRM");
pa.command({ type: "confirm_topic", topicRevision: pa.state.topic!.revision });
pb.command({ type: "confirm_topic", topicRevision: pb.state.topic!.revision });
await wait(() => pa.state.phase === "ROUND");
const audioCache = new Map<string, Buffer>();
async function voice(text: string) {
  if (audioCache.has(text)) return audioCache.get(text)!;
  const c: Buffer[] = [];
  await streamVoice(
    text,
    (p) => c.push(Buffer.from(p)),
    () => false,
    12,
  );
  const bytes = Buffer.concat(c),
    f = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4),
    pcm = Buffer.alloc(Math.floor((f.length * 16000) / 44100) * 2);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(
      Math.max(
        -32768,
        Math.min(32767, Math.round(f[Math.floor((i * 44100) / 16000)] * 32767)),
      ),
      i * 2,
    );
  audioCache.set(text, pcm);
  return pcm;
}
let turns = 0;
let bargeTested = false;
while (pa.state.phase !== "MATCH_RESULT") {
  await wait(
    () =>
      pa.state.phase === "MATCH_RESULT" ||
      (pa.state.phase === "ROUND" && !!pa.state.turn && !pa.state.turn.sealing),
  );
  if (pa.state.phase === "MATCH_RESULT") break;
  const turn = pa.state.turn!,
    p = turn.playerId === pa.session.playerId ? pa : pb;
  const side = pa.state.topic!.positions[turn.playerId].toLowerCase();
  const waffles = side.includes("waffle");
  const text = waffles
    ? turn.kind === "case"
      ? "Waffles have syrup pockets, so sweetness reaches every bite instead of pooling under the last bite."
      : turn.kind === "rebuttal"
        ? "Softness is not enough. Pancakes soak up syrup and lose their texture, while waffles keep a crisp edge."
        : "Even syrup distribution matters more than softness, because breakfast should taste balanced from first bite to last."
    : turn.kind === "case"
      ? "Pancakes are better because I like them."
      : turn.kind === "rebuttal"
        ? "I heard the syrup point, but I still prefer pancakes."
        : "Pancakes are my favorite breakfast.";
  const pcm = await voice(text);
  await wait(() => canSpeak(pa.state, p.session.playerId));
  if (pa.state.turn?.id !== turn.id) continue;
  for (let at = 0; at < pcm.length; at += 640) {
    p.pcm = pcm.subarray(at, at + 640);
    if (p.pcm.length < 640)
      p.pcm = Buffer.concat([p.pcm, Buffer.alloc(640 - p.pcm.length)]);
    if (!bargeTested && pa.state.judge?.status === "speaking") {
      p.command({
        type: "barge_in",
        utteranceId: pa.state.judge.id,
        speechEpoch: pa.state.judge.epoch,
      });
      bargeTested = true;
    }
    await sleep(20);
  }
  p.pcm = Buffer.alloc(640);
  await sleep(2000);
  if (p.state.turn?.id === turn.id && !p.state.turn.sealing)
    p.command({ type: "done", turnId: turn.id, lastAudioSeq: p.seq });
  await wait(() => pa.state.turn?.id !== turn.id || pa.state.phase !== "ROUND");
  turns++;
  if (turns === 1) {
    await wait(() => !pa.state.judge || pa.state.judge.status === "silent");
    const match = pa.state.matchId,
      floor = pa.state.turn!.id;
    pa.close();
    await wait(() => pb.state.phase === "RECOVERING");
    const remaining = pb.state.turn!.remainingMs;
    const resumed = await post("/api/resume", pa.session);
    pa.session = resumed.session;
    pa.state = resumed.snapshot;
    pa.seq = 0;
    await pa.connect();
    await wait(() => pa.state.phase === "ROUND" && pb.state.phase === "ROUND");
    if (
      pa.state.matchId !== match ||
      pa.state.turn!.id !== floor ||
      pb.state.turn!.remainingMs < remaining - 1500
    )
      throw Error(
        "Reconnect lost the authoritative match, floor, or protected time",
      );
    console.log(
      JSON.stringify({
        reconnect: true,
        sameMatch: true,
        sameFloor: true,
        protectedRemaining: true,
      }),
    );
  }
  console.log(
    JSON.stringify({
      turns,
      phase: pa.state.phase,
      scores: pa.state.players.map((p) => ({
        name: p.name,
        score: p.scoreUnits / 4,
        wins: p.wins,
      })),
      ledger: pa.state.ledger.length,
    }),
  );
}
await sleep(800);
const sameResult =
  JSON.stringify(pa.state.results) === JSON.stringify(pb.state.results) &&
  pa.state.winnerId === pb.state.winnerId;
const sharedAudio =
  pa.voiceHashes.length === pb.voiceHashes.length &&
  pa.voiceHashes.every((h, i) => h === pb.voiceHashes[i]);
console.log(
  JSON.stringify({
    finished: true,
    turns,
    sameResult,
    sharedAudio,
    audioChunks: pa.voiceHashes.length,
    interventions: pa.interventions,
    errors: [...pa.errors, ...pb.errors],
  }),
);
await wait(
  () =>
    pb.state.phase === "MATCH_RESULT" && pa.state.judge?.status === "silent",
);
if (sameResult && sharedAudio)
  writeFileSync(
    "public/rehearsal.json",
    JSON.stringify(
      {
        label: "Rehearsal replay — generated test speech, real providers",
        recordedAt: new Date().toISOString(),
        topic: pa.state.topic,
        players: pa.state.players.map((p) => ({
          id: p.id,
          name: p.name,
          wins: p.wins,
        })),
        winnerId: pa.state.winnerId,
        results: pa.state.results,
        ledger: pa.state.ledger,
        transcripts: pa.transcripts,
        judgeLines: pa.interventions,
        verification: {
          sameResult,
          sharedAudio,
          audioChunks: pa.voiceHashes.length,
        },
      },
      null,
      2,
    ),
  );
const old = pa.state.matchId;
pa.command({ type: "rematch", value: true });
pb.command({ type: "rematch", value: true });
await wait(() => pa.state.matchId !== old);
console.log(JSON.stringify({ rematch: true }));
clearInterval(status);
pa.close();
pb.close();
process.exit(sameResult && sharedAudio && pa.state.ledger.length === 0 ? 0 : 1);
