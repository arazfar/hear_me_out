/** Summarize an authenticated /api/diagnostics export; never records player audio. */
import { readFileSync } from "node:fs";
const path = process.argv[2];
if (!path)
  throw new Error(
    "Usage: pnpm exec tsx scripts/audio-report.ts diagnostics.json",
  );
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
      measurement:
        "First rendered sample on the slower client; browser estimates, not acoustic output",
      incompleteUtterances: incomplete,
      groups: Object.fromEntries(
        Object.entries(groups).map(([label, values]) => [
          label,
          {
            cueToRenderMs: percentile(values.cue),
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
