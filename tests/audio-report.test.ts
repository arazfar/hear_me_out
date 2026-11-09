import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("qualification reports preserve misses, incomplete pairs and unqualified provenance without copying secrets", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hmo-report-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "diagnostics.json"),
    manifestPath = join(dir, "manifest.json");
  const manifest = JSON.parse(
    await readFile("docs/qualification-manifest.example.json", "utf8"),
  );
  manifest.commit = "a".repeat(40);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(
    path,
    JSON.stringify({
      token: "NEVER_COPY",
      transcript: "NEVER_COPY",
      failures: {
        judgment_timeout: 1,
        judgment_configuration: 2,
        providerError: "NEVER_COPY",
      },
      timeline: [
        {
          stage: "first_render_metric",
          speechEpoch: 1,
          playerId: "a",
          mediaMode: "rtc",
          prepared: true,
          cueToRenderMs: 300,
          doneToRenderMs: 2400,
        },
        {
          stage: "first_render_metric",
          speechEpoch: 1,
          playerId: "b",
          mediaMode: "rtc",
          prepared: true,
          cueToRenderMs: 500,
          doneToRenderMs: 2600,
        },
        {
          stage: "first_render_metric",
          speechEpoch: 2,
          playerId: "a",
          mediaMode: "rtc",
        },
      ],
      metrics: { scoringMs: [100, 900] },
    }),
  );
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/audio-report.ts", path, manifestPath],
    { encoding: "utf8" },
  );
  const report = JSON.parse(output);
  assert.equal(report.manifest.commit, manifest.commit);
  assert.equal(report.manifest.liveProviders, false);
  assert.equal(report.cleanup.confirmed, false);
  assert.equal(report.incompleteUtterances, 1);
  assert.deepEqual(report.groups["rtc/cached"].latencyMisses, {
    cue: 1,
    done: 1,
  });
  assert.equal(report.groups["rtc/cached"].cueToRenderMs.p95, 500);
  assert.equal(report.failures.judgment_timeout, 1);
  assert.equal(report.failures.judgment_configuration, 2);
  assert(!output.includes("NEVER_COPY"));
});
