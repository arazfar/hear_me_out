import {
  encodeVideo,
  decodeVideo,
  encodeMicrophone,
  decodeJudgeAudio,
} from "../shared/media";
import { PROTOCOL_VERSION, type Session } from "../shared/protocol";
import "dotenv/config";
import { WebSocket } from "ws";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { streamVoice } from "../server/providers/index";
import {
  canSendJudgeInput,
  judgeIsListening,
  type Snapshot,
} from "../shared/domain";
import { type Command } from "../shared/protocol";
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
  connected = false;
  seq = 0;
  videoSeq = 0;
  setup = false;
  inputEpoch = 0;
  ends = new Map<string, number>();
  eof = new Map<number, number>();
  completed = new Set<number>();
  playbackTimers = new Set<ReturnType<typeof setTimeout>>();
  pcm: Buffer = Buffer.alloc(640);
  interval: ReturnType<typeof setInterval> | undefined;
  voiceHashes: string[] = [];
  interventions: string[] = [];
  cancelled = 0;
  timing: Array<{ text: string; cueMs: number; turnDoneMs: number | null }> =
    [];
  readyEpochs = new Set<number>();
  errors: string[] = [];
  transcripts: Array<{
    playerId: string;
    roundId: string;
    turnId: string | null;
    text: string;
  }> = [];
  constructor(
    public session: Session,
    state: Snapshot,
  ) {
    this.state = state;
  }
  command(command: Command, id = crypto.randomUUID()) {
    if (command.type === "done") {
      if (!this.ends.has(command.turnId)) {
        this.sockets.get("audio")!.send(
          encodeMicrophone(
            this.state.mediaEpoch,
            ++this.seq,
            Date.now(),
            new Uint8Array(),
            {
              purpose: "gameplay",
              inputEpoch: this.state.turn!.inputEpoch!,
              end: true,
            },
          ),
        );
        this.ends.set(command.turnId, this.seq);
      }
      command = { ...command, lastAudioSeq: this.ends.get(command.turnId)! };
    }
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
    this.connected = false;
    for (const ch of ["control", "audio", "video", "judge"]) {
      const s = new WebSocket(`${wsbase}/socket/${ch}`);
      this.sockets.set(ch, s);
      await new Promise<void>((r) =>
        s.on("open", () => {
          s.send(
            JSON.stringify({
              type: "auth",
              protocolVersion: PROTOCOL_VERSION,
              ...this.session,
              code: undefined,
            }),
          );
          r();
        }),
      );
      s.on("message", (raw, binary) => {
        if (binary) {
          if (ch === "video" && Buffer.isBuffer(raw)) {
            const frame = decodeVideo(raw);
            if (frame)
              this.sockets.get("control")!.send(
                JSON.stringify({
                  type: "video_ack",
                  seq: frame.seq,
                  mediaEpoch: frame.epoch,
                  probe: frame.probe,
                }),
              );
          }
          if (ch === "judge" && Buffer.isBuffer(raw)) {
            this.voiceHashes.push(
              createHash("sha256")
                .update(raw as Buffer)
                .digest("hex"),
            );
            const frame = decodeJudgeAudio(raw);
            if (!frame) return;
            if (frame.end) this.eof.set(frame.epoch, frame.offset);
            this.finishAudio();
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
        if (event.type === "setup_result")
          this.inputEpoch = event.status === "listening" ? event.inputEpoch : 0;
        this.finishAudio();
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
        if (event.type === "judge_started") {
          const judge = this.state.judge!;
          this.timing.push({
            text: judge.text,
            cueMs: judge.startAt! - (judge.cueAt || event.serverNowMs),
            turnDoneMs: judge.turnDoneAt
              ? judge.startAt! - judge.turnDoneAt
              : null,
          });
        }
        if (event.type === "judge_cancelled") this.cancelled++;
        if (
          event.type === "error" ||
          (event.type === "ack" && event.ok === false)
        )
          this.errors.push(event.error);
      });
    }
    this.connected = true;
    this.interval = setInterval(() => this.audio(), 20);
  }
  finishAudio() {
    const judge = this.state.judge;
    if (
      !judge ||
      judge.status !== "speaking" ||
      !this.eof.has(judge.epoch) ||
      this.completed.has(judge.epoch)
    )
      return;
    this.completed.add(judge.epoch);
    const samples = this.eof.get(judge.epoch)!;
    const timer = setTimeout(
      () => {
        this.playbackTimers.delete(timer);
        this.command({
          type: "audio_playback",
          utteranceId: judge.id,
          speechEpoch: judge.epoch,
          status: "complete",
          samples,
        });
      },
      Math.max(0, judge.startAt! + samples / 44.1 + 300 - Date.now()),
    );
    this.playbackTimers.add(timer);
  }
  audio() {
    const turn = this.state.turn;
    const tag =
      this.setup && this.inputEpoch
        ? { purpose: "private" as const, inputEpoch: this.inputEpoch }
        : canSendJudgeInput(this.state, this.session.playerId) &&
            turn &&
            !this.ends.has(turn.id)
          ? { purpose: "gameplay" as const, inputEpoch: turn.inputEpoch! }
          : { purpose: "social" as const, inputEpoch: 0 };
    this.sockets
      .get("audio")!
      .send(
        encodeMicrophone(
          this.state.mediaEpoch,
          ++this.seq,
          Date.now(),
          this.pcm,
          tag,
        ),
      );
    // This operational client simulates output accounting; it never measures acoustic playback.
    const judge = this.state.judge;
    if (judge?.status === "speaking" && this.seq % 25 === 0) {
      const samples = Math.max(
        0,
        Math.floor((Date.now() - judge.startAt!) * 44.1),
      );
      this.command({
        type: "audio_playback",
        utteranceId: judge.id,
        speechEpoch: judge.epoch,
        status: "progress",
        samples: Math.min(this.eof.get(judge.epoch) ?? 882000, samples),
      });
    }
  }
  close() {
    this.connected = false;
    clearInterval(this.interval);
    for (const timer of this.playbackTimers) clearTimeout(timer);
    this.playbackTimers.clear();
    for (const s of this.sockets.values()) s.close();
  }
}
const pa = new Peer(a.session, a.snapshot),
  pb = new Peer(b.session, b.snapshot);
await pa.connect();
await pb.connect();
const status = setInterval(() => {
  for (const p of [pa, pb]) {
    // A public reconnect can span a status tick while channels are opening.
    if (!p.connected) continue;
    p.command({
      type: "media_status",
      captureId: p.session.playerId + ":mic",
      cameraId: p.session.playerId + ":camera",
      mic: true,
      camera: true,
      foreground: true,
      localFrames: p.seq,
      remoteFrames: 0,
      mediaEpoch: p.state.mediaEpoch,
      rtc: false,
    });
    for (const probe of [true, false])
      setTimeout(
        () => {
          const video = p.sockets.get("video");
          if (p.connected && video?.readyState === WebSocket.OPEN)
            video.send(
              encodeVideo(
                p.state.mediaEpoch,
                ++p.videoSeq,
                Date.now(),
                new Uint8Array([255, 216, 255, 217]),
                probe,
              ),
            );
        },
        probe ? 0 : 100,
      );
  }
}, 1000);
async function wait(check: () => boolean, timeout = 40000) {
  const at = Date.now();
  while (!check()) {
    if (pa.state.phase === "ABORTED") throw Error(pa.state.status);
    if (pa.state.degraded.tts)
      throw Error("Unexpected caption-only voice recovery");
    if (pa.errors.length || pb.errors.length)
      throw Error("Command error: " + [...pa.errors, ...pb.errors].join("; "));
    if (Date.now() - at > timeout)
      throw Error(`Wait expired in ${pa.state.phase}: ${pa.state.status}`);
    await sleep(100);
  }
}
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
    f = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2),
    pcm = Buffer.alloc(Math.floor((f.length * 16000) / 44100) * 2);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(
      Math.max(
        -32768,
        Math.min(32767, Math.round(f[Math.floor((i * 44100) / 16000)])),
      ),
      i * 2,
    );
  audioCache.set(text, pcm);
  return pcm;
}
await wait(() => pa.state.players.every((p) => p.captureReady));
for (const p of [pa, pb]) {
  p.setup = true;
  p.command({
    type: "setup_start",
    checkId: crypto.randomUUID(),
    captureId: p.session.playerId + ":mic",
  });
}
await sleep(700);
const testPhrase = await voice("Bonk, hear me out.");
for (let i = 0; i < testPhrase.length; i += 640) {
  for (const p of [pa, pb]) {
    p.pcm = Buffer.alloc(640);
    testPhrase.copy(p.pcm, 0, i, i + 640);
  }
  await sleep(20);
}
for (const p of [pa, pb]) p.pcm.fill(0);
await wait(() => pa.state.players.every((p) => p.mediaReady));
for (const p of [pa, pb]) p.setup = false;
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
console.log(
  JSON.stringify({
    exclusiveIntro: true,
    offFloorScoreUnits: pa.state.ledger.reduce((n, e) => n + e.deltaUnits, 0),
  }),
);
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
let turns = 0;

while (true) {
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
  await wait(() => judgeIsListening(pa.state, p.session.playerId));
  if (pa.state.turn?.id !== turn.id) continue;
  for (let at = 0; at < pcm.length; at += 640) {
    p.pcm = pcm.subarray(at, at + 640);
    if (p.pcm.length < 640)
      p.pcm = Buffer.concat([p.pcm, Buffer.alloc(640 - p.pcm.length)]);

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
await wait(
  () =>
    pb.state.phase === "MATCH_RESULT" &&
    pa.state.judge?.status === "silent" &&
    pb.state.judge?.status === "silent",
);
// Compare complete utterances after playback settles, not while the final
// provider stream is still delivering chunks to the two independent sockets.
await sleep(150);
const sameResult =
  JSON.stringify(pa.state.results) === JSON.stringify(pb.state.results) &&
  pa.state.winnerId === pb.state.winnerId &&
  JSON.stringify(pa.state.ledger) === JSON.stringify(pb.state.ledger);
const sharedAudio =
  pa.voiceHashes.length > 0 &&
  pa.voiceHashes.length === pb.voiceHashes.length &&
  pa.voiceHashes.every((h, i) => h === pb.voiceHashes[i]);
console.log(
  JSON.stringify({
    finished: true,
    turns,
    sameResult,
    sharedAudio,
    audioChunks: pa.voiceHashes.length,
    peerAudioChunks: pb.voiceHashes.length,
    cancelledUtterances: pa.cancelled,
    interventions: pa.interventions,
    scheduledPlaybackTimings: pa.timing,
    errors: [...pa.errors, ...pb.errors],
  }),
);
await wait(
  () =>
    pb.state.phase === "MATCH_RESULT" && pa.state.judge?.status === "silent",
);
if (process.env.EXPORT_REHEARSAL === "true" && sameResult && sharedAudio)
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
pa.command({ type: "leave" });
pb.command({ type: "leave" });
await sleep(100);
pa.close();
pb.close();
const contextual = pa.interventions.some((line) =>
  /syrup|pocket|soft|crisp|texture|sweet/i.test(line),
);
process.exit(
  sameResult &&
    sharedAudio &&
    contextual &&
    !pa.errors.length &&
    !pb.errors.length &&
    pa.state.ledger.length === 0
    ? 0
    : 1,
);
