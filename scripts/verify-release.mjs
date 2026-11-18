import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const journeyPattern =
  "two players complete a scored match|two players render a long|expanded recovery|short landscape";
const captionsPattern = "phone layouts preserve full captions";
const rematchPattern = "two players receive decision feedback";

function read(command, ...args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

function requireRevision(sha) {
  if (
    read("git", "rev-parse", "HEAD") !== sha ||
    read("git", "status", "--porcelain", "--untracked-files=all")
  ) {
    throw new Error(
      "Release qualification requires the same clean checkout throughout the run.",
    );
  }
}

function verifyRelease() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(
      "Run release qualification with native Node on an Apple silicon Mac.",
    );
  }

  const sha = read("git", "rev-parse", "HEAD");
  requireRevision(sha);
  const node = readFileSync(join(root, ".node-version"), "utf8").trim();
  const { packageManager } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  if (process.versions.node !== node)
    throw new Error(`Use Node ${node} from .node-version.`);
  if (`pnpm@${read("pnpm", "--version")}` !== packageManager) {
    throw new Error(`Use ${packageManager} from package.json.`);
  }

  const revisionDirectory = join(root, "output", "release", sha);
  mkdirSync(revisionDirectory, { recursive: true });
  const directory = mkdtempSync(join(revisionDirectory, "run-"));
  const evidencePath = join(directory, "qualification.json");
  const evidence = {
    sha,
    node,
    packageManager,
    darwinRelease: release(),
    startedAt: new Date().toISOString(),
    status: "running",
    steps: [],
  };

  function saveEvidence() {
    writeFileSync(
      `${evidencePath}.tmp`,
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    renameSync(`${evidencePath}.tmp`, evidencePath);
  }

  function run(name, args, env = {}) {
    requireRevision(sha);
    console.log(`\n[${name}] pnpm ${args.join(" ")}`);
    const result = spawnSync("pnpm", args, {
      cwd: root,
      env: { ...process.env, CI: "1", ...env },
      stdio: "inherit",
    });
    const passed = result.status === 0;
    evidence.steps.push({ name, status: passed ? "passed" : "failed" });
    saveEvidence();
    if (!passed)
      throw (
        result.error ||
        new Error(`${name} failed (${result.signal || result.status}).`)
      );
  }

  function browser(name, script, ...args) {
    const output = join(directory, name);
    run(name, [script, "--output", join(output, "results"), ...args], {
      PLAYWRIGHT_JSON_OUTPUT_FILE: join(output, "results.json"),
      UI_SCREENSHOT_DIR: join(output, "screenshots"),
    });
  }

  console.log(`Qualifying ${sha}. Evidence directory: ${directory}`);
  saveEvidence();
  try {
    run("install", ["install", "--frozen-lockfile", "--prod=false"]);
    run("install-webkit", ["exec", "playwright", "install", "webkit"]);
    run("build", ["build"]);
    run("browser-diagnostics", ["test:browser-diagnostics"], {
      BROWSER_DIAGNOSTICS_OUTPUT_DIR: join(directory, "browser-diagnostics"),
      PLAYWRIGHT_JSON_OUTPUT_FILE: "",
    });
    browser("ui-review", "test:ui-review", "--retries=0");
    browser("gameplay", "test:ui", "--retries=0");
    const repeat = ["--repeat-each=10", "--retries=0"];
    browser("repeat-journeys", "test:ui", "--grep", journeyPattern, ...repeat);
    browser(
      "repeat-captions-rematch",
      "test:ui",
      "--project=rtc",
      "--project=phone-relay",
      "--grep",
      `${captionsPattern}|${rematchPattern}`,
      ...repeat,
    );
    browser(
      "repeat-relay-captions",
      "test:ui",
      "--project=relay",
      "--grep",
      captionsPattern,
      ...repeat,
    );
    requireRevision(sha);
    evidence.status = "passed";
    console.log(`\nLocal release checks passed for ${sha}.`);
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error.message;
    throw error;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    saveEvidence();
    console.log(`Qualification record: ${evidencePath}`);
  }
}

try {
  verifyRelease();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
