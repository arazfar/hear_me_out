import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { cpus, platform, release, totalmem } from "node:os";
import { resolve, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";
import { frontendReady } from "../server/frontend";
import type { Snapshot } from "../shared/domain";
import { sampleFrames } from "./frame-sample";

const { values } = parseArgs({
  options: {
    "app-root": { type: "string", default: "." },
    "compare-root": { type: "string" },
    runs: { type: "string", default: "5" },
    port: { type: "string", default: "3242" },
    output: { type: "string", default: "output/profile/game.json" },
    "cpu-profile": { type: "boolean", default: false },
  },
});
const runs = Number(values.runs);
const port = Number(values.port);
assert(Number.isInteger(runs) && runs > 0, "--runs must be a positive integer");
assert(
  Number.isInteger(port) && port > 0 && port < 65536,
  "--port must be a TCP port",
);
const url = "http://127.0.0.1:" + port;
const output = resolve(values.output!);
const roots = [
  values["app-root"]!,
  ...(values["compare-root"] ? [values["compare-root"]] : []),
].map(resolveRoot);
function resolveRoot(path: string) {
  return resolve(path);
}

async function request<T>(path: string, body: object = {}): Promise<T> {
  const response = await fetch(url + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw Error(
      path.split("/").slice(0, 3).join("/") + " returned " + response.status,
    );
  return response.json() as Promise<T>;
}

async function until<T>(
  label: string,
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeout = 30000,
) {
  const deadline = performance.now() + timeout;
  do {
    const value = await read();
    if (ready(value)) return value;
    await delay(100);
  } while (performance.now() < deadline);
  throw Error("Timed out waiting for " + label);
}

async function title(page: Page) {
  await page.goto(url + "/?profileColdTitle=1");
  await page
    .getByRole("button", { name: "Create room", exact: true })
    .waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      ".stage[data-quality] canvas",
    );
    return !!canvas && canvas.width > 1 && canvas.height > 1;
  });
  return page.evaluate(
    () =>
      new Promise<number>((done) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => done(performance.now())),
        ),
      ),
  );
}

async function measure(
  browser: Browser,
  transport: "rtc" | "wss",
  label: string,
) {
  const observer = {
    path: fileURLToPath(new URL("./profile-observer.js", import.meta.url)),
  };
  const settings = {
    permissions: ["microphone", "camera"],
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  };
  const left = await browser.newContext(settings);
  const right = await browser.newContext(settings);
  try {
    await Promise.all([
      left.addInitScript(observer),
      right.addInitScript(observer),
    ]);
    const a = await left.newPage();
    const b = await right.newPage();
    const sessions = await Promise.all([
      left.newCDPSession(a),
      right.newCDPSession(b),
    ]);
    for (const session of sessions) await session.send("Performance.enable");
    await a.bringToFront();
    await a.goto("data:text/html,<title>Idle cadence</title>");
    const idle = await sampleFrames(a, sessions[0], () => delay(1800));
    let readyMs = 0;
    const coldTitle = await sampleFrames(
      a,
      sessions[0],
      async () => {
        readyMs = await title(a);
      },
      true,
    );
    const titleMetrics = await a.evaluate(() => ({
      paint:
        performance.getEntriesByName("first-contentful-paint")[0]?.startTime ??
        null,
    }));
    await a.getByLabel("Your name", { exact: true }).fill("Alex");
    await a.getByRole("button", { name: "Create room", exact: true }).click();
    const code = (
      await a.locator(".room-code b, .invite-code span").innerText()
    ).trim();
    await b.goto(url + "/?room=" + code);
    await b.getByLabel("Your name", { exact: true }).fill("Sam");
    await b.getByRole("button", { name: "Join room", exact: true }).click();
    const state = () => request<Snapshot>("/__test/state/" + code);
    await until(
      "both cameras and microphones",
      state,
      (s) =>
        s.mediaMode === transport &&
        s.players.length === 2 &&
        s.players.every((p) => p.mediaReady),
    );
    await a.bringToFront();
    await delay(2000);
    const timeline = () =>
      request<{ stage: string; speechEpoch: number; samples: number }[]>(
        "/__test/timeline/" + code,
      );
    const alignedJudge = await sampleFrames(a, sessions[0], async () => {
      const voice = await request<{ epoch: number; samples: number }>(
        "/__test/voice/" + code,
        { aligned: true },
      );
      await until(
        "both complete judge renders",
        timeline,
        (history) =>
          history.filter(
            (e) =>
              e.stage === "render_complete" &&
              e.speechEpoch === voice.epoch &&
              e.samples === voice.samples,
          ).length === 2,
      );
    });
    for (const p of [a, b])
      await p.getByRole("button", { name: "Ready to argue" }).click();
    const selection = await until(
      "topic selection",
      state,
      (s) => s.phase === "TOPIC_SELECT",
    );
    // Assign identical roles on both checkouts after the real coin flow. This
    // fixture-only snapshot is confined to profiling, before topic selection.
    await request("/__test/present/" + code, {
      headsId: selection.players[0].id,
      tailsId: selection.players[1].id,
    });
    const byId = (id: string | null) =>
      selection.players.find((p) => p.id === id)?.name === "Alex" ? a : b;
    const chooser = b;
    await chooser
      .getByRole("button", { name: "Is a hot dog a sandwich?" })
      .click();
    await chooser
      .getByRole("button", { name: "It is a sandwich", exact: true })
      .click();
    for (const p of [a, b])
      await p.getByRole("button", { name: "Confirm my side" }).click();
    const round = await until(
      "first active Case",
      state,
      (s) =>
        s.phase === "ROUND" &&
        !!s.turn &&
        !s.turn.pausedReason &&
        !s.turn.sealing &&
        s.turn.inputState === "open",
    );
    const speaker = byId(round.turn!.playerId);
    assert.equal(speaker, a, "Profiler expected the creator to open the Case");
    const session = sessions[0];
    await speaker.bringToFront();
    await delay(2000);
    const renderer = await speaker.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        ".stage[data-quality] canvas",
      )!;
      const gl = canvas.getContext("webgl2")!;
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        name: gl.getParameter(
          info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
        ),
        width: canvas.width,
        height: canvas.height,
        dpr: devicePixelRatio,
      };
    });
    if (values["cpu-profile"]) {
      await session.send("Profiler.enable");
      await session.send("Profiler.start");
    }
    const activeCase = await sampleFrames(speaker, session, () => delay(8000));
    let awards = 0;
    const awardBurst = await sampleFrames(speaker, session, async () => {
      for (const quality of [1, 2, 3, 4]) {
        const result = await request<{ ids: string[] }>(
          "/__test/award/" + code,
          { quality },
        );
        awards += result.ids.length;
        await delay(140);
      }
      await delay(3800);
    });
    assert.equal(awards, 14);
    if (values["cpu-profile"]) {
      const { profile } = await session.send("Profiler.stop");
      await writeFile(
        output + "." + label + ".cpuprofile",
        JSON.stringify(profile),
      );
    }
    const final = await state();
    assert.equal(final.turn?.id, round.turn!.id);
    assert.equal(final.turn?.pausedReason, null);
    assert.equal(final.mediaMode, transport);
    assert(final.players.every((p) => p.mediaReady));
    for (const sample of [activeCase, alignedJudge, awardBurst]) {
      assert(
        sample.initialQuality && sample.finalQuality,
        "Stage fell back during measurement",
      );
      assert(sample.cameraDelta.local > 0, "Local camera did not progress");
      assert(
        sample.cameraDelta[transport === "rtc" ? "remote" : "relay"] > 0,
        "Remote camera did not progress",
      );
    }
    await speaker
      .getByRole("button", { name: "I’m done", exact: true })
      .click();
    const next = await until(
      "handoff after Done",
      state,
      (s) =>
        s.phase === "ROUND" &&
        s.turn?.id !== round.turn!.id &&
        s.turn?.inputState === "open" &&
        !s.turn.pausedReason,
    );
    const observed = await Promise.all(
      [a, b].map((p) =>
        until(
          "visible recipient cue",
          () => p.evaluate(() => window.gameInteractions),
          (events) => events.cues.some((cue) => cue.turn === next.turn!.id),
        ),
      ),
    );
    assert.equal(
      observed[speaker === a ? 0 : 1].done.length,
      1,
      "Missing visible Done acknowledgment",
    );
    const receipt = await timeline();
    const interactions = {
      observed,
      timeline: receipt.filter((e) =>
        [
          "input_grant",
          "input_first_capture",
          "turn_seal",
          "first_render_metric",
          "render_complete",
        ].includes(e.stage),
      ),
    };
    return {
      idle,
      coldTitle,
      titleMetrics: { ...titleMetrics, readyMs },
      interactions,
      alignedJudge,
      activeCase,
      awardBurst,
      awards,
      renderer,
      foregroundSeat: speaker === a ? "creator" : "joiner",
    };
  } finally {
    await Promise.allSettled([left.close(), right.close()]);
  }
}

async function profile(root: string, transport: "rtc" | "wss", label: string) {
  // Prove this process owns the port before sending requests to the fixture.
  const fixture = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/browser-fixture.ts"],
    {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        FORCE_WSS: String(transport === "wss"),
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const exited = once(fixture, "exit");
  let browser: Browser | undefined;
  try {
    await Promise.race([
      once(fixture.stdout, "data").then(([chunk]) =>
        assert(String(chunk).includes("Browser fixture on " + port)),
      ),
      exited.then(() => {
        throw Error("Fixture exited before listening");
      }),
      delay(60000, undefined, { ref: false }).then(() => {
        throw Error("Fixture start timed out");
      }),
    ]);
    assert(
      (await fetch(url + "/readyz", { signal: AbortSignal.timeout(5000) })).ok,
      "Build or fixture is not ready",
    );
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    return {
      chrome: browser.version(),
      ...(await measure(browser, transport, label)),
    };
  } finally {
    try {
      await browser?.close();
    } finally {
      fixture.kill("SIGTERM");
      const force = setTimeout(() => fixture.kill("SIGKILL"), 6000);
      try {
        await exited;
      } finally {
        clearTimeout(force);
      }
    }
  }
}

await mkdir(dirname(output), { recursive: true });
const revisions = await Promise.all(
  roots.map(async (root) => {
    assert(
      frontendReady(resolve(root, "dist")),
      "Build the checkout first: " + root,
    );
    const git = (args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    return {
      root,
      sha: git(["rev-parse", "HEAD"]),
      dirty: !!git(["status", "--porcelain"]),
      manifestSha256: createHash("sha256")
        .update(await readFile(resolve(root, "dist/.vite/manifest.json")))
        .digest("hex"),
    };
  }),
);
const report = {
  revisions,
  node: process.version,
  os: platform() + " " + release(),
  cpu: cpus()[0].model,
  ramBytes: totalmem(),
  cpuProfile: values["cpu-profile"],
  completed: false,
  results: [] as {
    round: number;
    checkout: number;
    transport: string;
    measurement: Awaited<ReturnType<typeof profile>>;
  }[],
};
for (let round = 1; round <= runs; round++) {
  const transports: ("rtc" | "wss")[] =
    round % 2 ? ["rtc", "wss"] : ["wss", "rtc"];
  for (const transport of transports) {
    const indices = roots.map((_, i) => i);
    if (round % 2 === 0) indices.reverse();
    for (const i of indices) {
      const label = [round, i, transport].join("-");
      const measurement = await profile(roots[i], transport, label);
      report.results.push({ round, checkout: i, transport, measurement });
      await writeFile(output, JSON.stringify(report));
      console.log(
        label,
        "Case p95/p99",
        measurement.activeCase.p95Ms.toFixed(1),
        measurement.activeCase.p99Ms.toFixed(1),
        "ms",
      );
    }
  }
}
report.completed = true;
await writeFile(output, JSON.stringify(report));
