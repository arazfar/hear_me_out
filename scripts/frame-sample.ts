import type { CDPSession, Page } from "@playwright/test";

interface CameraProgress {
  local: number;
  remote: number;
  relay: number;
}

interface FrameObserver {
  start(): void;
  finish(): {
    intervals: number[];
    longTasks: number[];
    durationMs: number;
    cameraDelta: CameraProgress;
    hidden: boolean;
    initialQuality: string | null;
    finalQuality: string | null;
  };
}

declare global {
  interface Window {
    gameFrameObserver: FrameObserver;
    gameInteractions: {
      cues: { turn: string; ms: number; visibleAt: number }[];
      done: number[];
    };
  }
}

async function durations(session: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await session.send("Performance.getMetrics");
  return Object.fromEntries(
    metrics.map(({ name, value }: { name: string; value: number }) => [
      name,
      value,
    ]),
  );
}

export async function sampleFrames(
  page: Page,
  session: CDPSession,
  run: () => Promise<void>,
  navigation = false,
) {
  const isolateBefore = navigation
    ? (await session.send("Runtime.getIsolateId")).id
    : undefined;
  const before = await durations(session);
  if (!navigation) await page.evaluate(() => window.gameFrameObserver.start());
  await run();
  const sample = await page.evaluate(() => window.gameFrameObserver.finish());
  const after = await durations(session);
  const isolateAfter = navigation
    ? (await session.send("Runtime.getIsolateId")).id
    : undefined;
  const counters = [
    "Timestamp",
    "TaskDuration",
    "ScriptDuration",
    "LayoutDuration",
  ];
  let counterStatus = "ok";
  if (isolateBefore !== isolateAfter) counterStatus = "renderer changed";
  else if (
    counters.some(
      (key) => !Number.isFinite(before[key]) || !Number.isFinite(after[key]),
    )
  )
    counterStatus = "counter missing";
  else if (
    after.Timestamp === before.Timestamp ||
    counters.some((key) => after[key] < before[key])
  )
    counterStatus = "counter reset";
  const delta = (name: string) =>
    counterStatus === "ok" ? (after[name] - before[name]) * 1000 : null;
  const sorted = [...sample.intervals].sort((a, b) => a - b);
  if (!sorted.length || sample.hidden)
    throw Error("The measured page did not produce visible frames.");
  const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
  return {
    ...sample,
    frames: sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    worstMs: sorted.at(-1)!,
    hitchesOver50Ms: sorted.filter((n) => n > 50).length,
    counterStatus,
    counterDurationMs: delta("Timestamp"),
    taskMs: delta("TaskDuration"),
    scriptMs: delta("ScriptDuration"),
    layoutMs: delta("LayoutDuration"),
  };
}
