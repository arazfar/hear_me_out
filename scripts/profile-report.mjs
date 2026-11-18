import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const path = process.argv[2];
assert(
  path && process.argv.length === 3,
  "Usage: node scripts/profile-report.mjs <comparison.json | ->",
);
const report = JSON.parse(readFileSync(path === "-" ? 0 : path, "utf8"));
assert(
  report.revisions?.length === 2 && Array.isArray(report.results),
  "Expected the paired --app-root / --compare-root profiler output",
);

const scenarios = [
  ["activeCase", "Active Case"],
  ["awardBurst", "14 awards"],
  ["alignedJudge", "Aligned judge"],
];
const transports = new Map([
  ["rtc", new Map()],
  ["wss", new Map()],
]);
for (const { round, transport, checkout, measurement } of report.results) {
  assert(
    transports.has(transport) &&
      Number.isInteger(round) &&
      round > 0 &&
      [0, 1].includes(checkout) &&
      measurement,
    "Invalid run identity",
  );
  const rounds = transports.get(transport);
  if (!rounds.has(round)) rounds.set(round, Array(2).fill(null));
  const pair = rounds.get(round);
  assert(
    !pair[checkout],
    "Duplicate checkout for round " + round + " / " + transport,
  );
  pair[checkout] = measurement;
}

const fmt = (value) => value.toFixed(1);
function range(values) {
  if (!values.length) return "—";
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
  return sorted.length === 1
    ? fmt(median)
    : `${fmt(median)} [${fmt(sorted[0])}, ${fmt(sorted.at(-1))}]`;
}
const quality = (sample) =>
  sample?.initialQuality === sample?.finalQuality
    ? (sample?.finalQuality ?? "unknown")
    : `${sample?.initialQuality ?? "unknown"}→${sample?.finalQuality ?? "unknown"}`;

function eligible([a, b], stage) {
  const idle = [a.idle.p50Ms, b.idle.p50Ms];
  if (
    !idle.every((n) => Number.isFinite(n) && n > 0) ||
    Math.abs(idle[1] - idle[0]) > 0.1 * idle[0]
  )
    return false;
  if (
    a.chrome !== b.chrome ||
    a.foregroundSeat !== b.foregroundSeat ||
    ["name", "width", "height", "dpr"].some(
      (key) => a.renderer[key] !== b.renderer[key],
    )
  )
    return false;
  if (stage === "coldTitle")
    return (
      !!a[stage].finalQuality && a[stage].finalQuality === b[stage].finalQuality
    );
  return (
    !!a[stage].initialQuality &&
    a[stage].initialQuality === a[stage].finalQuality &&
    b[stage].initialQuality === a[stage].initialQuality &&
    b[stage].finalQuality === a[stage].finalQuality
  );
}

const metrics = [
  ["Frame p95 (ms)", (s) => s.p95Ms],
  ["Frame p99 (ms)", (s) => s.p99Ms],
  ["Worst frame (ms)", (s) => s.worstMs],
  ["Frames >50 ms (count)", (s) => s.hitchesOver50Ms],
  ["Window (s)", (s) => s.durationMs / 1000],
  [
    "Renderer task (ms/s)",
    (s) => (s.taskMs == null ? null : (1000 * s.taskMs) / s.durationMs),
  ],
  [
    "Renderer script (ms/s)",
    (s) => (s.scriptMs == null ? null : (1000 * s.scriptMs) / s.durationMs),
  ],
];

const latencyNames = {
  cue: "Floor receipt → visible cue (per seat)",
  skew: "Visible cue skew (two seats)",
  done: "Done click → visible acknowledgment",
  capture: "Later render completion → first capture",
  cached: "Cached cue → first render (slower seat)",
  uncached: "Uncached cue → first render (slower seat)",
  reaction: "Done seal → first render (slower seat)",
};

function interactions(runs, transport) {
  const values = Object.fromEntries(
    Object.keys(latencyNames).map((k) => [k, { samples: [], missing: 0 }]),
  );
  let absent = 0,
    unclassified = 0;
  const add = (key, n) => {
    if (Number.isFinite(n) && n >= 0) values[key].samples.push(n);
    else values[key].missing++;
  };
  for (const run of runs) {
    if (!run.interactions) {
      absent++;
      continue;
    }
    const { observed, timeline } = run.interactions;
    const cues = observed.map(
      (client) => new Map(client.cues.map((cue) => [cue.turn, cue])),
    );
    const turns = new Set([
      ...cues.flatMap((seat) => [...seat.keys()]),
      ...timeline
        .filter((e) => e.stage === "input_first_capture")
        .map((e) => e.turnId),
    ]);
    for (const turn of turns) {
      const left = cues[0]?.get(turn),
        right = cues[1]?.get(turn);
      add("cue", left?.ms);
      add("cue", right?.ms);
      add(
        "skew",
        Number.isFinite(left?.visibleAt) && Number.isFinite(right?.visibleAt)
          ? Math.abs(left.visibleAt - right.visibleAt)
          : NaN,
      );
    }
    const done = observed.flatMap((seat) => seat.done);
    if (done.length === 1) add("done", done[0]);
    else values.done.missing++;

    // Epochs repeat across rooms. Pair first-render metrics only within this run.
    const voices = new Map();
    const grants = new Map();
    let currentVoice = null;
    for (const e of timeline) {
      if (e.stage === "first_render_metric" || e.stage === "render_complete") {
        if (!voices.has(e.speechEpoch))
          voices.set(e.speechEpoch, { first: new Map(), complete: new Map() });
        currentVoice = voices.get(e.speechEpoch);
        if (e.stage === "first_render_metric")
          currentVoice.first.set(e.playerId, e);
        else currentVoice.complete.set(e.playerId, e.at);
      } else if (e.stage === "turn_seal") {
        currentVoice = null;
      } else if (e.stage === "input_grant") {
        const times = [...(currentVoice?.complete.values() ?? [])];
        grants.set(
          e.turnId + "/" + e.inputEpoch,
          times.length === 2 && times.every(Number.isFinite)
            ? Math.max(...times)
            : NaN,
        );
        currentVoice = null;
      } else if (e.stage === "input_first_capture") {
        const key = e.turnId + "/" + e.inputEpoch;
        add(
          "capture",
          Number.isFinite(e.capturedAt) ? e.capturedAt - grants.get(key) : NaN,
        );
        grants.delete(key);
      }
    }
    values.capture.missing += grants.size;
    let reactions = 0;
    for (const { first } of voices.values()) {
      const seat = [...first.values()];
      const paired = seat.length === 2;
      const slower = (field) =>
        paired && seat.every((e) => Number.isFinite(e[field]))
          ? Math.max(...seat.map((e) => e[field]))
          : NaN;
      if (
        seat.length &&
        typeof seat[0].prepared === "boolean" &&
        seat.every(
          (e) => e.prepared === seat[0].prepared && e.mediaMode === transport,
        )
      )
        add(seat[0].prepared ? "cached" : "uncached", slower("cueToRenderMs"));
      else unclassified++;
      if (seat.some((e) => e.doneToRenderMs != null)) {
        reactions++;
        add(
          "reaction",
          seat.every((e) => e.mediaMode === transport)
            ? slower("doneToRenderMs")
            : NaN,
        );
      }
    }
    // Each sealed player turn should have a reaction even if both render marks are missing.
    values.reaction.missing += Math.max(
      0,
      timeline.filter((e) => e.stage === "turn_seal").length - reactions,
    );
  }
  return { values, absent, unclassified };
}

const line = console.log;
line("# Paired game profile\n");
line(
  `Baseline \`${report.revisions[0].sha}\` and candidate \`${report.revisions[1].sha}\`. Worktree dirty flags ${report.revisions.map((r) => r.dirty).join(" / ")}. Capture ${report.completed ? "complete" : "partial"}.\n`,
);
line(
  `${report.cpu}, ${fmt(report.ramBytes / 2 ** 30)} GiB, ${report.os}, Node ${report.node}. Synthetic loopback, 1280×720 CSS pixels. CPU profiler ${report.cpuProfile ? "on" : "off"}.\n`,
);
line(
  "Frame rows show the median [min, max] across paired runs. Per-run p95 and p99 use foreground animation-frame intervals. Renderer task and script are main-thread durations per elapsed second. Paired Δ is candidate minus baseline for eligible same-round pairs. It describes the observed spread without a significance test.\n",
);
line(
  "Eligibility requires matching Chrome, foreground seat, renderer, backing size, DPR and stable quality tier with idle median cadence within 10% of baseline. Cold-title eligibility compares the final tier.\n",
);
for (const [transport, rounds] of transports) {
  const entries = [...rounds.entries()].sort(([a], [b]) => a - b);
  const pairs = entries
    .map(([, pair]) => pair)
    .filter((pair) => pair.every(Boolean));
  line(`## ${transport === "rtc" ? "Native RTC" : "Forced WSS relay"}\n`);
  line(
    `${pairs.length} complete pairs from ${entries.length} recorded rounds.\n`,
  );
  if (!entries.length) continue;
  const configurations = new Set(
    entries.flatMap(([, pair]) =>
      pair
        .filter(Boolean)
        .map(
          ({ chrome, renderer: r }) =>
            `Chrome ${chrome}, ${r.name}, ${r.width}×${r.height} backing pixels at DPR ${r.dpr}`,
        ),
    ),
  );
  for (const configuration of configurations) line(configuration + ".\n");
  line(
    "| Round | Idle median ms, baseline → candidate | Quality, baseline → candidate (Case / awards / judge) | Eligible scenarios |",
  );
  line("|---:|---|---|---|");
  for (const [round, pair] of entries) {
    const [a, b] = pair;
    const describe = (f) =>
      pair.map((run) => (run ? f(run) : "missing")).join(" → ");
    const tiers = describe((run) =>
      scenarios.map(([key]) => quality(run[key])).join(" / "),
    );
    const accepted =
      a && b
        ? [["coldTitle", "Title"], ...scenarios]
            .filter(([stage]) => eligible(pair, stage))
            .map(([, name]) => name)
        : [];
    line(
      `| ${round} | ${describe((r) => fmt(r.idle.p50Ms))} | ${tiers} | ${accepted.join(", ") || "None"} |`,
    );
  }
  if (!pairs.length) {
    line("");
    continue;
  }
  line(
    "\n| Scenario | Metric | Baseline | Candidate | Eligible paired Δ | Eligible / observed pairs |",
  );
  line("|---|---|---:|---:|---:|---:|");
  function row(stage, name, metric, get) {
    const both = pairs
      .map((pair) => ({
        values: pair.map(get),
        eligible: eligible(pair, stage),
      }))
      .filter((p) => p.values.every(Number.isFinite));
    const deltas = both
      .filter((p) => p.eligible)
      .map((p) => p.values[1] - p.values[0]);
    line(
      `| ${name} | ${metric} | ${range(both.map((p) => p.values[0]))} | ${range(both.map((p) => p.values[1]))} | ${range(deltas)} | ${deltas.length}/${both.length} |`,
    );
  }
  row(
    "coldTitle",
    "Cold title",
    "Controls and stage ready (ms)",
    (m) => m.titleMetrics.readyMs,
  );
  row(
    "coldTitle",
    "Cold title",
    "First contentful paint (ms)",
    (m) => m.titleMetrics.paint,
  );
  for (const [stage, title] of scenarios)
    for (const [metric, read] of metrics)
      row(stage, title, metric, (m) => read(m[stage]));

  const groups = [0, 1].map((i) =>
    interactions(
      pairs.map((p) => p[i]),
      transport,
    ),
  );
  line(
    "\n| Synthetic interaction | Baseline p95 ms (n / incomplete) | Candidate p95 ms (n / incomplete) |",
  );
  line("|---|---:|---:|");
  for (const [key, name] of Object.entries(latencyNames)) {
    const cells = groups.map(({ values }) => {
      const { samples, missing } = values[key];
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.ceil(0.95 * samples.length) - 1];
      return `${p95 == null ? "—" : fmt(p95)} (${samples.length} / ${missing})`;
    });
    line(`| ${name} | ${cells.join(" | ")} |`);
  }
  line(
    `\nPaired runs missing interaction instrumentation (baseline / candidate) ${groups.map((g) => g.absent).join(" / ")}. Utterances without a matching transport and cache classification ${groups.map((g) => g.unclassified).join(" / ")}. Audio timings use client worklet estimates and server completion acknowledgments. Acoustic output and physical-device latency require separate measurements.\n`,
  );
}
