import "dotenv/config";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { streamVoice, InkSession, judge } from "../server/providers/index";
import { judgeFailure } from "../server/providers/judge-request";
import { Game } from "../server/game/game";
import type { Segment } from "../shared/domain";

type Providers = {
  streamVoice: typeof streamVoice;
  judge: typeof judge;
  createInk: (
    ...args: ConstructorParameters<typeof InkSession>
  ) => Pick<InkSession, "connected" | "send" | "close">;
  pause: (ms: number, signal: AbortSignal) => Promise<void>;
};
const defaults: Providers = {
  streamVoice,
  judge,
  createInk: (...args) => new InkSession(...args),
  pause: (ms, signal) => delay(ms, undefined, { signal }),
};
async function bounded<T>(
  task: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Synthetic phrase through actual providers; never print transcripts or raw errors.
 * Dependency injection verifies failure cleanup without spending provider credits. */
export async function runProviderSmoke(overrides: Partial<Providers> = {}) {
  const providers = { ...defaults, ...overrides },
    owner = new AbortController();
  const deadline = setTimeout(() => owner.abort(), 60000);
  const g = new Game("1234"),
    a = g.addPlayer("Sam"),
    b = g.addPlayer("Alex");
  a.mediaReady = b.mediaReady = true;
  g.startMatch();
  g.state.headsId = a.id;
  g.state.tailsId = b.id;
  g.selectTopic();
  g.proposeTopic(
    b.id,
    "Waffles are a better breakfast than pancakes.",
    "Pancakes",
    "Waffles",
    true,
  );
  g.confirm(a.id, 1);
  g.confirm(b.id, 1);
  const turn = g.state.turn!;
  let ink: ReturnType<Providers["createInk"]> | undefined;
  let stage = "synthesis",
    failed: string | null = null,
    cleaned = true;
  const metrics: Record<string, number | boolean | null> = {};
  try {
    const chunks: Buffer[] = [],
      began = Date.now();
    let first = 0,
      alignmentAt = 0;
    await providers.streamVoice(
      "Waffles trap syrup in pockets, so every bite gets sweetness instead of the last bite swimming in a puddle.",
      (pcm) => {
        first ||= Date.now();
        chunks.push(Buffer.from(pcm));
      },
      () => owner.signal.aborted,
      12,
      (cues) => {
        alignmentAt ||= Date.now();
        metrics.alignedSegments = cues.length;
      },
    );
    owner.signal.throwIfAborted();
    metrics.ttsFirstChunkMs = first ? first - began : null;
    metrics.ttsFirstAlignmentMs = alignmentAt ? alignmentAt - began : null;
    const combined = Buffer.concat(chunks);
    if (!combined.length || combined.length % 2)
      throw new Error("Missing audio");
    metrics.audioBytes = combined.length;
    const output = Buffer.alloc(
      Math.floor(((combined.length / 2) * 16000) / 44100) * 2,
    );
    for (let i = 0; i < output.length / 2; i++)
      output.writeInt16LE(
        combined.readInt16LE(Math.floor((i * 44100) / 16000) * 2),
        i * 2,
      );
    stage = "transcription";
    let resolve!: (segment: Segment) => void, reject!: (error: Error) => void;
    const stable = new Promise<Segment>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // A provider may fail while audio is still being sent, before stable is awaited.
    void stable.catch(() => {});
    const sttAt = Date.now();
    ink = providers.createInk(turn.playerId, g.state.roundId!, turn.id, {
      caption() {},
      segment: (segment) => {
        // Record arrival once, even if more finals arrive during paced silence.
        metrics.sttFinalMs ??= Date.now() - sttAt;
        resolve(segment);
      },
      start() {},
      end() {},
      error: () => reject(new Error("Transcription provider failed")),
    });
    await bounded(
      (async () => {
        while (!ink!.connected) await providers.pause(25, owner.signal);
      })(),
      5000,
      "Transcription connection timed out",
    );
    metrics.sttConnectMs = Date.now() - sttAt;
    for (let at = 0; at < output.length; at += 3200) {
      ink.send(output.subarray(at, at + 3200));
      await providers.pause(100, owner.signal);
    }
    for (let i = 0; i < 25; i++) {
      ink.send(Buffer.alloc(3200));
      await providers.pause(100, owner.signal);
    }
    const segment = await bounded(stable, 6000, "No stable transcript");
    if (
      !segment.eligible ||
      segment.playerId !== turn.playerId ||
      !g.registerSegment(segment)
    )
      throw new Error("Invalid transcript ownership");
    stage = "judge";
    const at = Date.now();
    const result = await providers.judge(
      g.snapshot(),
      [segment],
      turn.kind,
      turn.targets,
      [segment],
      [],
      "smoke",
      ["claim-a", "claim-b"],
      [],
      owner.signal,
    );
    for (const score of result.scores) g.score(score);
    metrics.judgeMs = Date.now() - at;
    metrics.scoreUnits = g.player(turn.playerId).scoreUnits;
    if (!g.state.ledger.length) throw new Error("No scores committed");
  } catch (error) {
    failed = owner.signal.aborted
      ? "timeout"
      : stage === "judge"
        ? judgeFailure(error).category
        : stage;
  } finally {
    clearTimeout(deadline);
    owner.abort();
    try {
      if (ink)
        cleaned = await bounded(
          ink.close(),
          6500,
          "Transcription cleanup timed out",
        );
    } catch {
      cleaned = false;
    }
  }
  return {
    ok: failed === null && cleaned,
    failure: failed,
    cleanup: { transcriptionDisposed: cleaned },
    metrics,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const configured = [
    "OPENAI_API_KEY",
    "CARTESIA_API_KEY",
    "FISH_AUDIO_API_KEY",
  ].every((key) => !!process.env[key]);
  if (!configured) {
    console.error(
      "Provider verification needs OpenAI, Cartesia, and Fish keys.",
    );
    process.exitCode = 1;
  } else {
    // Natural success exit proves no owned transport remains. Only a failure
    // watchdog may force exit if a provider ignores disposal/cancellation.
    const watchdog = setTimeout(() => {
      console.error(JSON.stringify({ ok: false, failure: "cleanup_deadline" }));
      process.exit(1);
    }, 70000);
    watchdog.unref();
    const result = await runProviderSmoke();
    console.log(
      JSON.stringify({
        kind: "provider-smoke",
        commit: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        dirty: !!execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim(),
        node: process.version,
        transport: "provider-loopback",
        device: null,
        browser: null,
        providers: {
          judge: process.env.JUDGE_MODEL || "gpt-6-luna",
          reasoning: process.env.JUDGE_REASONING || "none",
          stt: "ink-2",
          tts: process.env.FISH_TTS_MODEL || "s2-pro",
        },
        ...result,
      }),
    );
    process.exitCode = result.ok ? 0 : 1;
  }
}
