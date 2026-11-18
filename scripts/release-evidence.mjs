import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  projects,
  validateMatrix,
  validateRepeat,
  validateResults,
} from "./browser-matrix.mjs";

export const releaseVersion = 1;
export const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

export function parseReleaseSha(args) {
  const {
    values: { sha },
  } = parseArgs({ args, options: { sha: { type: "string" } } });
  assert(
    sha && /^[0-9a-f]{40}$/.test(sha),
    "Supply --sha with the full 40-character commit SHA.",
  );
  return sha;
}

export function verifyLocalEvidence(directory, sha, expectedRuntime) {
  const attempts = readdirSync(directory)
    .filter((name) => /^run-[a-zA-Z0-9]+$/.test(name))
    .map((name) => {
      const path = join(directory, name);
      return { path, record: readJson(join(path, "qualification.json")) };
    })
    .sort((a, b) => b.record.startedAt.localeCompare(a.record.startedAt));
  assert(attempts.length, "No local qualification attempt found");
  const { path, record } = attempts[0];
  assert.equal(
    record.sha,
    sha,
    "Local qualification belongs to a different SHA",
  );
  assert.equal(
    record.version,
    releaseVersion,
    "Local qualification uses an older harness",
  );
  assert.equal(
    record.status,
    "passed",
    "Latest local qualification has not passed",
  );
  if (expectedRuntime) {
    assert.equal(
      record.node,
      expectedRuntime.node,
      "Local qualification used a different Node version",
    );
    assert.equal(
      record.packageManager,
      expectedRuntime.packageManager,
      "Local qualification used a different pnpm version",
    );
  }
  assert(
    Number.isFinite(Date.parse(record.startedAt)) &&
      Date.parse(record.finishedAt) >= Date.parse(record.startedAt),
    "Incomplete local qualification",
  );
  assert(
    record.browsers?.chrome && record.browsers?.webkit,
    "Missing qualified browser versions",
  );
  const suites = [
    "ui-review",
    "gameplay",
    ...projects.map((project) => `repeat-${project}`),
  ];
  const stages = [
    "install",
    "install-webkit",
    "browser-preflight",
    "build",
    "browser-diagnostics",
    ...suites.flatMap((suite) => [`${suite}-list`, suite]),
  ];
  assert.deepEqual(
    record.steps.map((step) => step.name).sort(),
    stages.sort(),
    "Local qualification is missing required stages",
  );
  assert(
    record.steps.every(
      (step) =>
        step.status === "passed" &&
        Number.isFinite(step.durationMs) &&
        step.durationMs >= 0,
    ),
    "Local qualification contains an incomplete stage",
  );
  assert.equal(
    readJson(join(path, "browser-diagnostics", "report.json")).stats
      ?.unexpected,
    2,
    "Missing injected browser diagnostics",
  );
  for (const suite of suites) {
    const discovered = readJson(join(path, suite, "discovered.json"));
    const results = readJson(join(path, suite, "results.json"));
    if (suite === "gameplay") validateMatrix(discovered);
    if (suite.startsWith("repeat-"))
      validateRepeat(discovered, suite.slice("repeat-".length));
    validateResults(discovered, results);
  }
  return path;
}

export function verifyProviderEvidence(report, sha) {
  assert.equal(report.commit, sha, "Provider smoke belongs to a different SHA");
  assert(
    report.kind === "provider-smoke" &&
      report.dirty === false &&
      report.ok === true &&
      report.cleanup?.transcriptionDisposed === true,
    "Live-provider smoke has not passed from a clean checkout",
  );
}
