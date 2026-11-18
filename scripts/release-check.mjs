import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseReleaseSha,
  readJson,
  verifyLocalEvidence,
  verifyProviderEvidence,
} from "./release-evidence.mjs";

const repository = "arazfar/hear_me_out";
const root = fileURLToPath(new URL("../", import.meta.url));

function github(...args) {
  return JSON.parse(
    execFileSync("gh", args, { cwd: root, encoding: "utf8", timeout: 30_000 }),
  );
}

function pinnedRuntime(sha) {
  const read = (path) =>
    execFileSync("git", ["show", `${sha}:${path}`], {
      cwd: root,
      encoding: "utf8",
    });
  return {
    node: read(".node-version").trim(),
    packageManager: JSON.parse(read("package.json")).packageManager,
  };
}

function verifyGitHub(sha) {
  const comparison = github("api", `repos/${repository}/compare/${sha}...main`);
  assert.equal(
    comparison.merge_base_commit?.sha,
    sha,
    "The selected SHA is not on GitHub main",
  );
  const [run] = github(
    "run",
    "list",
    "--repo",
    repository,
    "--workflow",
    "ci.yml",
    "--branch",
    "main",
    "--event",
    "push",
    "--commit",
    sha,
    "--limit",
    "1",
    "--json",
    "databaseId,headSha,status,conclusion,url",
  );
  assert(
    run?.headSha === sha &&
      run.status === "completed" &&
      run.conclusion === "success",
    "The latest GitHub main check for the selected SHA has not passed",
  );
  const { jobs } = github(
    "api",
    `repos/${repository}/actions/runs/${run.databaseId}/jobs`,
  );
  assert(
    jobs.some(
      (job) =>
        job.name === "verify" &&
        job.conclusion === "success" &&
        job.labels.includes("ubuntu-latest"),
    ),
    "Missing successful Linux verify job",
  );
  return run.url;
}

try {
  const sha = parseReleaseSha(process.argv.slice(2));
  const directory = join(root, "output", "release", sha);
  const checks = [
    ["GitHub main", () => verifyGitHub(sha)],
    [
      "Local browser qualification",
      () => verifyLocalEvidence(directory, sha, pinnedRuntime(sha)),
    ],
    [
      "Live-provider smoke",
      () =>
        verifyProviderEvidence(
          readJson(join(directory, "provider-smoke.json")),
          sha,
        ),
    ],
  ];
  for (const [label, check] of checks) {
    try {
      const details = check();
      console.log(`PASS ${label}${details ? ` — ${details}` : ""}`);
    } catch (error) {
      console.error(`BLOCKED ${label} — ${error.message}`);
      process.exitCode = 1;
    }
  }
  if (!process.exitCode)
    console.log(`Eligible for manual Render deployment: ${sha}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
