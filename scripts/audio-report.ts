/** Summarize an authenticated /api/diagnostics export; never records player audio. */
import { z } from "zod";
import { readFileSync } from "node:fs";
const path = process.argv[2];
if (!path)
  throw new Error(
    "Usage: pnpm exec tsx scripts/audio-report.ts diagnostics.json",
  );
// Whitelist provenance fields; never copy credentials or arbitrary request data.
const manifestSchema = z
  .object({
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    dirty: z.boolean(),
    date: z.string().max(40),
    transport: z.enum(["rtc", "wss"]),
    liveProviders: z.boolean(),
    devices: z
      .array(
        z
          .object({
            device: z.string().max(100),
            browser: z.string().max(100),
            output: z.enum(["speakers", "wired", "bluetooth"]),
            network: z.string().max(80),
          })
          .strict(),
      )
      .length(2),
    providers: z
      .object({
        judge: z.string().max(80),
        reasoning: z.string().max(30),
        stt: z.string().max(80),
        tts: z.string().max(80),
      })
      .strict(),
    rttMs: z.number().nonnegative(),
    checks: z
      .object({
        sharedOutcomes: z.boolean(),
        finalSyllables: z.boolean(),
        privateIsolation: z.boolean(),
        simultaneousConversation: z.boolean(),
        boundedRecovery: z.boolean(),
        backgrounding: z.boolean(),
        outputChanges: z.boolean(),
        sealingDisconnect: z.boolean(),
        rematch: z.boolean(),
        turnRelayExercised: z.boolean(),
      })
      .strict(),
    deployment: z
      .object({
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        readiness: z.boolean(),
        publicWss: z.boolean(),
        proxyHopsVerified: z.boolean(),
        idleWake: z.boolean(),
      })
      .strict()
      .nullable(),
    cleanup: z
      .object({
        confirmed: z.boolean(),
        retainedProviderTransports: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
const manifest = process.argv[3]
  ? manifestSchema.parse(JSON.parse(readFileSync(process.argv[3], "utf8")))
  : null;
const data = JSON.parse(readFileSync(path, "utf8"));
const timeline: Array<Record<string, any>> = Array.isArray(data)
  ? data
  : data.timeline;
if (!Array.isArray(timeline)) throw new Error("Expected a diagnostic timeline");
const percentile = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? null,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
    max: sorted.at(-1) ?? null,
  };
};
const utterances = new Map<number, Map<string, Record<string, any>>>();
for (const event of timeline) {
  if (event.stage !== "first_render_metric") continue;
  if (!utterances.has(event.speechEpoch))
    utterances.set(event.speechEpoch, new Map());
  utterances.get(event.speechEpoch)!.set(event.playerId, event);
}
const groups: Record<string, { cue: number[]; done: number[] }> = {};
let incomplete = 0;
for (const players of utterances.values()) {
  if (players.size !== 2) {
    incomplete++;
    continue;
  }
  const events = [...players.values()],
    label = `${events[0].mediaMode}/${events[0].prepared ? "cached" : "uncached"}`;
  const group = (groups[label] ||= { cue: [], done: [] });
  if (events.every((e) => Number.isFinite(e.cueToRenderMs)))
    group.cue.push(Math.max(...events.map((e) => e.cueToRenderMs)));
  if (events.every((e) => Number.isFinite(e.doneToRenderMs)))
    group.done.push(Math.max(...events.map((e) => e.doneToRenderMs)));
}
console.log(
  JSON.stringify(
    {
      qualification:
        "Requires physical/device and deployment review; synthetic or loopback checks do not qualify a release",
      manifest,
      failures: Object.fromEntries(
        Object.entries(data.failures || {}).filter(
          ([key, count]) =>
            /^(judgment(_(timeout|transport|quota|authentication|configuration|invalid_output))?|transcription|voice_delivery)$/.test(
              key,
            ) &&
            typeof count === "number" &&
            Number.isFinite(count),
        ),
      ),
      cleanup: manifest?.cleanup ?? null,
      measurement:
        "First rendered sample on the slower client; browser estimates, not acoustic output",
      incompleteUtterances: incomplete,
      groups: Object.fromEntries(
        Object.entries(groups).map(([label, values]) => [
          label,
          {
            cueToRenderMs: percentile(values.cue),
            latencyMisses: {
              cue: values.cue.filter(
                (ms) => ms > (label.endsWith("/cached") ? 400 : 1500),
              ).length,
              done: values.done.filter((ms) => ms > 2500).length,
            },
            doneToRenderMs: percentile(values.done),
          },
        ]),
      ),
      stageSamples: Object.fromEntries(
        Object.entries(data.metrics || {}).map(([label, values]) => [
          label,
          percentile(values as number[]),
        ]),
      ),
    },
    null,
    2,
  ),
);
