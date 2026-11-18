import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  projects,
  repeatArgs,
  validateMatrix,
  validateRepeat,
  validateResults,
} from "./browser-matrix.mjs";
import {
  parseReleaseSha,
  readJson,
  releaseVersion,
} from "./release-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const minutes = (count) => count * 60_000;

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function fixturePorts() {
  const servers = [];
  try {
    for (let i = 0; i < 2; i++) {
      const server = createServer();
      servers.push(server);
      await new Promise((resolve, reject) =>
        server.once("error", reject).listen(0, "127.0.0.1", resolve),
      );
    }
    return servers.map((server) => String(server.address().port));
  } finally {
    for (const server of servers) server.close();
  }
}

async function verifyRelease() {
  const sha = parseReleaseSha(process.argv.slice(2));
  assert(
    process.platform === "darwin" && process.arch === "arm64",
    "Use native Node on an Apple silicon Mac.",
  );
  assert.equal(
    statSync("/dev/console").uid,
    process.getuid(),
    "Sign into an interactive macOS desktop for the headed Chrome focus check.",
  );
  assert.equal(
    git("rev-parse", "HEAD"),
    sha,
    "Run from a checkout of the selected SHA.",
  );
  assert.equal(
    git("status", "--porcelain", "--untracked-files=all"),
    "",
    "Use a clean source checkout.",
  );
  const node = readFileSync(join(root, ".node-version"), "utf8").trim();
  const { packageManager } = readJson(join(root, "package.json"));
  assert.equal(
    process.versions.node,
    node,
    `Use Node ${node} from .node-version.`,
  );
  assert.equal(
    `pnpm@${execFileSync("pnpm", ["--version"], { encoding: "utf8", cwd: root }).trim()}`,
    packageManager,
    `Use ${packageManager}.`,
  );

  const revisionDirectory = join(root, "output", "release", sha);
  mkdirSync(revisionDirectory, { recursive: true });
  const directory = mkdtempSync(join(revisionDirectory, "run-"));
  const checkout = join(directory, "checkout");
  const evidencePath = join(directory, "qualification.json");
  const evidence = {
    version: releaseVersion,
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

  const env = { ...process.env, CI: "1" };
  for (const key of [
    "OPENAI_API_KEY",
    "CARTESIA_API_KEY",
    "FISH_AUDIO_API_KEY",
    "RENDER_API_KEY",
    "RENDER_DEPLOY_HOOK",
    "DOTENV_CONFIG_PATH",
    "PWDEBUG",
    "PLAYWRIGHT_JSON_OUTPUT_FILE",
    "PLAYWRIGHT_JSON_OUTPUT_NAME",
    "PLAYWRIGHT_JSON_OUTPUT_DIR",
    "GITHUB_STEP_SUMMARY",
  ]) {
    delete env[key];
  }

  let activeChild;
  let interrupted;
  let escalation;
  function stopChild() {
    if (!activeChild?.pid) return;
    const { pid } = activeChild;
    try {
      process.kill(-pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    escalation ??= setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") console.error(error.message);
      }
    }, 5000).unref();
  }
  const onInterrupt = () => {
    interrupted = "Release qualification interrupted.";
    stopChild();
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);

  async function run(
    name,
    args,
    { overrides, timeout = minutes(15), inspect } = {},
  ) {
    assert(!interrupted, interrupted);
    const log = `${name}.log`;
    const stage = {
      name,
      status: "running",
      startedAt: new Date().toISOString(),
      log,
    };
    const start = Date.now();
    evidence.steps.push(stage);
    saveEvidence();
    console.log(`\n[${name}] pnpm ${args.join(" ")}`);
    const stream = createWriteStream(join(directory, log));
    let timer;
    try {
      let timedOut = false;
      activeChild = spawn("pnpm", args, {
        cwd: checkout,
        env: { ...env, ...overrides },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const { stdout, stderr } = activeChild;
      stdout.pipe(stream, { end: false });
      stderr.pipe(stream, { end: false });
      stdout.pipe(process.stdout, { end: false });
      stderr.pipe(process.stderr, { end: false });
      const result = await new Promise((resolve, reject) => {
        stream.once("error", (error) => {
          stopChild();
          reject(error);
        });
        activeChild.once("error", reject);
        activeChild.once("close", (status, signal) =>
          resolve({ status, signal }),
        );
        timer = setTimeout(() => {
          timedOut = true;
          stopChild();
        }, timeout);
      });
      assert(!interrupted, interrupted);
      assert(!timedOut, `${name} exceeded its time limit.`);
      assert.equal(
        result.status,
        0,
        `${name} failed (${result.signal || result.status}). See ${log}.`,
      );
      inspect?.();
      stage.status = "passed";
    } finally {
      clearTimeout(timer);
      clearTimeout(escalation);
      escalation = undefined;
      activeChild = undefined;
      await new Promise((resolve) => stream.end(resolve));
      if (stage.status === "running")
        stage.status = interrupted ? "interrupted" : "failed";
      stage.durationMs = Date.now() - start;
      saveEvidence();
    }
  }

  async function browser(
    name,
    selection = [],
    { review = false, discoveredCheck } = {},
  ) {
    const output = join(directory, name);
    mkdirSync(output);
    const list = join(output, "discovered.json");
    const results = join(output, "results.json");
    const args = review
      ? ["--config", "tools/ui-review/playwright.config.mjs"]
      : selection;
    await run(
      `${name}-list`,
      ["exec", "playwright", "test", ...args, "--list", "--reporter=json"],
      {
        overrides: { PLAYWRIGHT_JSON_OUTPUT_FILE: list },
        inspect: () => discoveredCheck?.(readJson(list)),
      },
    );
    await run(
      name,
      [
        review ? "test:ui-review" : "test:ui",
        ...selection,
        "--retries=0",
        "--output",
        join(output, "results"),
      ],
      {
        overrides: {
          PLAYWRIGHT_JSON_OUTPUT_FILE: results,
          UI_SCREENSHOT_DIR: join(output, "screenshots"),
        },
        timeout: minutes(90),
        inspect: () => validateResults(readJson(list), readJson(results)),
      },
    );
  }

  console.log(`Qualifying ${sha}. Evidence directory: ${directory}`);
  saveEvidence();
  let created = false;
  try {
    git("worktree", "add", "--detach", checkout, sha);
    created = true;
    [env.TEST_RTC_PORT, env.TEST_RELAY_PORT] = await fixturePorts();
    await run("install", ["install", "--frozen-lockfile", "--prod=false"]);
    await run("install-webkit", ["exec", "playwright", "install", "webkit"]);
    const browserVersions = join(directory, "browser-versions.json");
    await run(
      "browser-preflight",
      [
        "exec",
        "node",
        "--input-type=module",
        "-e",
        `
      import { chromium, webkit } from "@playwright/test";
      import { writeFileSync } from "node:fs";
      const versions = {};
      for (const [name, type, options] of [["chrome", chromium, {channel:"chrome"}], ["webkit", webkit, {}]]) {
        const browser = await type.launch(options);
        try { versions[name] = browser.version(); } finally { await browser.close(); }
      }
      writeFileSync(process.argv[1], JSON.stringify(versions));
    `,
        browserVersions,
      ],
      {
        inspect: () => {
          evidence.browsers = readJson(browserVersions);
        },
      },
    );
    await browser("ui-review", [], { review: true });
    await run("build", ["build"]);
    await run("browser-diagnostics", ["test:browser-diagnostics"], {
      overrides: {
        BROWSER_DIAGNOSTICS_OUTPUT_DIR: join(directory, "browser-diagnostics"),
      },
      inspect: () => {
        const report = readJson(
          join(directory, "browser-diagnostics", "report.json"),
        );
        assert.equal(
          report.stats?.unexpected,
          2,
          "Missing injected browser diagnostics.",
        );
      },
    });
    await browser("gameplay", [], { discoveredCheck: validateMatrix });
    for (const project of projects) {
      await browser(`repeat-${project}`, repeatArgs(project), {
        discoveredCheck: (report) => validateRepeat(report, project),
      });
    }
    assert(!interrupted, interrupted);
    evidence.status = "passed";
  } catch (error) {
    evidence.status = interrupted ? "interrupted" : "failed";
    evidence.error = error.message;
    throw error;
  } finally {
    try {
      if (created) {
        try {
          const screenshots = join(checkout, "output", "playwright");
          if (existsSync(screenshots))
            cpSync(screenshots, join(directory, "fixture-screenshots"), {
              recursive: true,
            });
        } finally {
          git("worktree", "remove", "--force", checkout);
        }
      }
    } catch (error) {
      evidence.status = "failed";
      evidence.error = `Evidence collection or worktree cleanup failed: ${error.message}`;
      throw error;
    } finally {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      evidence.finishedAt = new Date().toISOString();
      saveEvidence();
      console.log(`Qualification record: ${evidencePath}`);
    }
  }
  console.log(`Local release checks passed for ${sha}.`);
}

try {
  await verifyRelease();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
