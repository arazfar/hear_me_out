import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const projects = [
  "rtc",
  "relay",
  "phone",
  "phone-relay",
  "webkit",
  "webkit-relay",
];
export const repetitions = 10;
const cases = {
  match: projects,
  "long-audio": projects,
  "expanded-recovery": projects,
  "short-landscape": projects,
  captions: ["rtc", "relay", "phone-relay"],
  "rematch-feedback": ["rtc", "phone-relay"],
};
const caseTag = (name) => `@case-${name}`;
const caseTags = Object.keys(cases).map(caseTag);

export function repeatArgs(project) {
  assert(projects.includes(project), `Unknown browser project ${project}`);
  const tags = Object.entries(cases)
    .filter(([, selected]) => selected.includes(project))
    .map(([name]) => caseTag(name));
  return [
    `--project=${project}`,
    "--grep",
    `(?:${tags.join("|")})\\b`,
    `--repeat-each=${repetitions}`,
  ];
}

export function reportRows(report) {
  assert(
    Array.isArray(report.suites) && Array.isArray(report.errors),
    "Invalid Playwright report",
  );
  assert.equal(report.errors.length, 0, "Playwright reported runner errors");
  function rows(suites) {
    return suites.flatMap((suite) => [
      ...suite.specs.flatMap((spec) =>
        spec.tests.map((test) => ({
          ...test,
          id: spec.id,
          tags: spec.tags.map((tag) => (tag.startsWith("@") ? tag : `@${tag}`)),
          title: spec.title,
        })),
      ),
      ...rows(suite.suites ?? []),
    ]);
  }
  const result = rows(report.suites);
  assert(result.length > 0, "Playwright report contains no cases");
  return result;
}

export function validateMatrix(report) {
  const tests = reportRows(report);
  const discoveredProjects = [
    ...new Set(tests.map((test) => test.projectName)),
  ];
  assert.deepEqual(
    discoveredProjects.sort(),
    [...projects].sort(),
    "Browser projects changed",
  );
  for (const tag of caseTags) {
    for (const project of projects) {
      assert.equal(
        tests.filter(
          (test) => test.projectName === project && test.tags.includes(tag),
        ).length,
        1,
        `Expected one ${tag} in ${project}`,
      );
    }
  }
}

export function validateRepeat(report, project) {
  const expected = Object.entries(cases)
    .filter(([, selected]) => selected.includes(project))
    .map(([name]) => caseTag(name));
  const tests = reportRows(report);
  assert(
    tests.every((test) => test.projectName === project),
    `Unexpected project in ${project} repeat`,
  );
  assert.equal(
    tests.length,
    expected.length * repetitions,
    `Wrong repetition count for ${project}`,
  );
  for (const tag of expected) {
    assert.equal(
      tests.filter((test) => test.tags.includes(tag)).length,
      repetitions,
      `Missing repetitions for ${tag} in ${project}`,
    );
  }
}

export function validateResults(discovered, completed) {
  const key = (test) => `${test.projectName}:${test.id}`;
  const expected = reportRows(discovered);
  const actual = reportRows(completed);
  assert.deepEqual(
    actual.map(key).sort(),
    expected.map(key).sort(),
    "Executed cases differ from discovery",
  );
  for (const test of actual) {
    const label = `${test.projectName}: ${test.title}`;
    const intentionalSkip =
      test.projectName === "relay" && test.tags.includes("@rtc-only");
    assert.equal(
      test.expectedStatus,
      intentionalSkip ? "skipped" : "passed",
      `Unexpected expectation for ${label}`,
    );
    assert.equal(
      test.status,
      intentionalSkip ? "skipped" : "expected",
      `Unqualified case: ${label}`,
    );
    assert.equal(
      test.results.length,
      1,
      `Missing result or retry for ${label}`,
    );
    assert.equal(
      test.results[0].status,
      intentionalSkip ? "skipped" : "passed",
      `Unexpected result for ${label}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const project = process.argv[2];
  if (project) {
    execFileSync("pnpm", ["test:ui", ...repeatArgs(project), "--retries=0"], {
      stdio: "inherit",
    });
  } else {
    const report = JSON.parse(
      execFileSync(
        "pnpm",
        ["exec", "playwright", "test", "--list", "--reporter=json"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            CI: "1",
            PLAYWRIGHT_JSON_OUTPUT_FILE: "",
            PLAYWRIGHT_JSON_OUTPUT_NAME: "",
          },
        },
      ),
    );
    validateMatrix(report);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `projects=${JSON.stringify(projects)}\n`,
      );
    }
    console.log(`Browser matrix verified across ${projects.length} projects.`);
  }
}
