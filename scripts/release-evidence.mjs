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

const platforms = ["android-chrome", "desktop-chrome", "iphone-safari"];
const transports = ["rtc", "wss"];
const physicalChecks = [
  "sharedOutcomes",
  "finalSyllables",
  "privateIsolation",
  "simultaneousConversation",
  "boundedRecovery",
  "backgrounding",
  "outputChanges",
  "sealingDisconnect",
  "rematch",
];

export function verifyPhysicalEvidence(signoff, sha, readReport) {
  assert.equal(
    signoff.sha,
    sha,
    "Physical-device sign-off belongs to a different SHA",
  );
  assert(
    typeof signoff.approvedBy === "string" &&
      signoff.approvedBy.trim() &&
      Number.isFinite(Date.parse(signoff.approvedAt)),
    "Missing release-owner sign-off",
  );
  assert(Array.isArray(signoff.sessions), "Missing physical-device sessions");
  const pairs = new Set();
  const reports = new Set();
  const distinctEvidence = new Set();
  const observations = { rtc: new Set(), wss: new Set() };
  const samples = { rtc: 0, wss: 0 };
  for (const session of signoff.sessions) {
    const { report: filename, platforms: devices } = session;
    assert(
      typeof filename === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(filename) &&
        !reports.has(filename),
      "Use a unique local JSON report filename for each physical session",
    );
    reports.add(filename);
    assert(
      Array.isArray(devices) &&
        devices.length === 2 &&
        new Set(devices).size === 2 &&
        devices.every((device) => platforms.includes(device)),
      "Invalid physical device pairing",
    );
    const report = readReport(filename);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(report))
      .digest("hex");
    assert(
      !distinctEvidence.has(fingerprint),
      `Duplicate physical evidence in ${filename}`,
    );
    distinctEvidence.add(fingerprint);
    const { manifest } = report;
    assert(
      manifest?.commit === sha &&
        manifest.dirty === false &&
        manifest.liveProviders === true,
      `Physical report ${filename} lacks clean, live-provider evidence for the selected SHA`,
    );
    assert(
      transports.includes(manifest.transport),
      `Invalid transport in ${filename}`,
    );
    assert(
      manifest.devices?.length === 2 &&
        manifest.devices.every(
          (device) =>
            device.device?.trim() &&
            device.browser?.trim() &&
            device.network?.trim(),
        ) &&
        manifest.devices[0].network !== manifest.devices[1].network,
      `Physical report ${filename} needs two real devices on distinct networks`,
    );
    assert(
      ["sharedOutcomes", "finalSyllables", "privateIsolation"].every(
        (check) => manifest.checks?.[check] === true,
      ),
      `Physical checks are incomplete in ${filename}`,
    );
    for (const check of [...physicalChecks, "turnRelayExercised"]) {
      if (manifest.checks[check] === true)
        observations[manifest.transport].add(check);
    }
    assert(
      manifest.cleanup?.confirmed === true &&
        manifest.cleanup.retainedProviderTransports === 0,
      `Provider cleanup is unverified in ${filename}`,
    );
    const complete = Object.entries(report.groups ?? {}).reduce(
      (total, [label, group]) => {
        if (!label.startsWith(`${manifest.transport}/`)) return total;
        const count = group.pairedSamples;
        assert(
          Number.isInteger(count) &&
            count >= 0 &&
            count <= group.cueToRenderMs?.count &&
            count <= group.doneToRenderMs?.count,
          `Invalid paired sample count in ${filename}`,
        );
        return total + count;
      },
      0,
    );
    assert(complete > 0, `No paired samples in ${filename}`);
    samples[manifest.transport] += complete;
    pairs.add(`${manifest.transport}:${[...devices].sort().join("+")}`);
  }
  for (const transport of transports) {
    for (const [first, second] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const pair = `${transport}:${platforms[first]}+${platforms[second]}`;
      assert(pairs.has(pair), `Missing physical session for ${pair}`);
    }
    assert(
      samples[transport] >= 100,
      `Need 100 paired judge utterances for ${transport}; found ${samples[transport]}`,
    );
    assert(
      physicalChecks.every((check) => observations[transport].has(check)),
      `Missing physical observations on ${transport}`,
    );
  }
  assert(
    observations.rtc.has("turnRelayExercised"),
    "Missing provisioned TURN observation",
  );
}
