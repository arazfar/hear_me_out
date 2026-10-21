import { appendFileSync, readFileSync } from "node:fs";

let report;
try {
  report = JSON.parse(readFileSync("output/playwright/results.json", "utf8"));
} catch {
  const message =
    "Browser report unavailable; inspect the preceding job steps.\n";
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
  console.log(message);
  process.exit(0);
}
const tests = [];
function visit(suite) {
  for (const spec of suite.specs || [])
    for (const test of spec.tests || [])
      tests.push({ title: spec.title, ...test });
  for (const child of suite.suites || []) visit(child);
}
visit(report);
const count = (status) => tests.filter((test) => test.status === status).length;
const lines = [
  "### Browser results",
  "",
  `${count("expected")} passed first attempt; ${count("flaky")} passed after retry; ${count("unexpected")} failed; ${count("skipped")} skipped.`,
];
const noteworthy = tests.filter((test) =>
  ["flaky", "unexpected"].includes(test.status),
);
if (noteworthy.length) {
  lines.push("", "| Test | Result | Attempts |", "| --- | --- | --- |");
  for (const test of noteworthy)
    lines.push(
      `| ${test.title.replace(/[|\r\n]/g, " ")} | ${test.status} | ${test.results.length} |`,
    );
}
const summary = lines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
