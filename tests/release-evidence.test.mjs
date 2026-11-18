import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  projects,
  validateMatrix,
  validateRepeat,
  validateResults,
} from "../scripts/browser-matrix.mjs";
import {
  verifyLocalEvidence,
  verifyProviderEvidence,
  verifyPhysicalEvidence,
} from "../scripts/release-evidence.mjs";

function spec(project, tag = "case-match", index = 0) {
  return {
    id: `${tag}-${index}`,
    title: "A completely different display title",
    tags: [tag],
    tests: [
      {
        projectName: project,
        expectedStatus: "passed",
        status: "expected",
        results: [{ status: "passed" }],
      },
    ],
  };
}
const report = (specs) => ({ suites: [{ specs }], errors: [] });

test("the browser matrix depends on tags and catches omitted project coverage", () => {
  const cases = [
    "match",
    "long-audio",
    "expanded-recovery",
    "short-landscape",
    "captions",
    "rematch-feedback",
  ];
  const specs = projects.flatMap((project) =>
    cases.map((name) => spec(project, `case-${name}`)),
  );
  validateMatrix(report(specs));
  const markedDesktopOnly = structuredClone(specs);
  markedDesktopOnly[0].tags.push("rtc-only");
  assert.throws(
    () => validateMatrix(report(markedDesktopOnly)),
    /must run on both transports/,
  );
  assert.throws(
    () => validateMatrix(report(specs.slice(1))),
    /Expected one @case-match in rtc/,
  );
  const repeated = [
    "match",
    "long-audio",
    "expanded-recovery",
    "short-landscape",
    "captions",
  ].flatMap((name) =>
    Array.from({ length: 10 }, (_, index) =>
      spec("relay", `case-${name}`, index),
    ),
  );
  validateRepeat(report(repeated), "relay");
  assert.throws(
    () => validateRepeat(report(repeated.slice(1)), "relay"),
    /Wrong repetition count/,
  );
});

test("missing reports, skipped cases, and retries cannot qualify", () => {
  const good = spec("rtc");
  const discovered = report([good]);
  validateResults(discovered, report([good]));
  assert.throws(
    () => validateResults(discovered, report([])),
    /contains no cases/,
  );
  assert.throws(
    () => validateResults(discovered, report([spec("phone")])),
    /differ from discovery/,
  );
  for (const status of ["skipped", "flaky", "unexpected"]) {
    const rejected = structuredClone(good);
    rejected.tests[0].status = status;
    assert.throws(
      () => validateResults(discovered, report([rejected])),
      /Unqualified case/,
    );
  }
  const retry = structuredClone(good);
  retry.tests[0].results.unshift({ status: "failed" });
  assert.throws(
    () => validateResults(discovered, report([retry])),
    /Missing result or retry/,
  );
});

test("promotion rejects incomplete or wrong-SHA evidence", (t) => {
  const sha = "a".repeat(40);
  const directory = mkdtempSync(join(tmpdir(), "hear-me-out-evidence-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "run-test"));
  const record = join(directory, "run-test", "qualification.json");
  writeFileSync(
    record,
    JSON.stringify({
      version: 1,
      sha,
      startedAt: "2026-11-18T00:00:00Z",
      status: "running",
    }),
  );
  assert.throws(() => verifyLocalEvidence(directory, sha), /has not passed/);
  assert.throws(
    () => verifyLocalEvidence(directory, "b".repeat(40)),
    /different SHA/,
  );
  const provider = {
    commit: sha,
    kind: "provider-smoke",
    ok: true,
    dirty: false,
    cleanup: { transcriptionDisposed: true },
  };
  verifyProviderEvidence(provider, sha);
  assert.throws(
    () => verifyProviderEvidence({ ...provider, commit: "b".repeat(40) }, sha),
    /different SHA/,
  );
  assert.throws(
    () =>
      verifyPhysicalEvidence(
        {
          sha,
          approvedBy: "Release owner",
          approvedAt: "2026-11-18T00:00:00Z",
          sessions: [],
        },
        sha,
      ),
    /Missing physical session/,
  );
});

test("physical sign-off requires every real device pairing on both transports", () => {
  const sha = "a".repeat(40);
  const pairs = [
    ["desktop-chrome", "iphone-safari"],
    ["desktop-chrome", "android-chrome"],
    ["android-chrome", "iphone-safari"],
  ];
  const sessions = ["rtc", "wss"].flatMap((transport) =>
    pairs.map((platforms, i) => ({
      report: `${transport}-${i}.json`,
      platforms,
    })),
  );
  const signoff = {
    sha,
    approvedBy: "Release owner",
    approvedAt: "2026-11-18T00:00:00Z",
    sessions,
  };
  const readReport = (name) => {
    const transport = name.split("-")[0];
    return {
      manifest: {
        commit: sha,
        dirty: false,
        liveProviders: true,
        transport,
        date: name,
        devices: [
          { device: "Device A", browser: "Chrome 152", network: "A" },
          { device: "Device B", browser: "Safari 27", network: "B" },
        ],
        checks: Object.fromEntries(
          [
            "sharedOutcomes",
            "finalSyllables",
            "privateIsolation",
            "simultaneousConversation",
            "boundedRecovery",
            "backgrounding",
            "outputChanges",
            "sealingDisconnect",
            "rematch",
            "turnRelayExercised",
          ].map((name) => [name, true]),
        ),
        cleanup: { confirmed: true, retainedProviderTransports: 0 },
      },
      incompleteUtterances: 0,
      groups: {
        [`${transport}/uncached`]: {
          pairedSamples: 34,
          cueToRenderMs: { count: 34 },
          doneToRenderMs: { count: 34 },
        },
      },
    };
  };
  verifyPhysicalEvidence(signoff, sha, readReport);
  assert.throws(
    () =>
      verifyPhysicalEvidence(
        { ...signoff, sessions: sessions.slice(1) },
        sha,
        readReport,
      ),
    /Missing physical session/,
  );
  assert.throws(
    () =>
      verifyPhysicalEvidence(signoff, sha, (name) => ({
        ...readReport(name),
        groups: {},
      })),
    /No paired samples/,
  );
});
