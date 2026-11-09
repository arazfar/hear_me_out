import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(repository, "output/browser-diagnostics");
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");

test(
  "real Playwright failures retain diagnostics and close contexts",
  { timeout: 45000 },
  async (t) => {
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url.includes("timeline")
            ? [{ stage: "fixture-timeline" }]
            : { phase: "ROUND" },
        ),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    await writeFile(
      join(output, "playwright.config.ts"),
      `
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'failures.spec.ts', timeout: 10000,
  workers: 1, retries: 0, forbidOnly: true,
  outputDir: './results', reporter: [['json', { outputFile: './report.json' }]],
  use: { channel: 'chrome', headless: true, trace: 'off', video: 'off',
    baseURL: 'http://127.0.0.1:${server.address().port}' },
});
`,
    );
    await writeFile(
      join(output, "failures.spec.ts"),
      `
import { expect } from '@playwright/test';
import { audioTest as test } from ${JSON.stringify(join(repository, "tests/browser/audio-test.ts"))};
import { attachAudioDiagnostics } from ${JSON.stringify(join(repository, "tests/browser/audio-diagnostics.ts"))};
import { finishBrowserTest } from ${JSON.stringify(join(repository, "tests/browser/cleanup.ts"))};
for (const failure of ['assertion', 'timeout']) {
  test(failure, async ({ browser, request, audioCleanup }, info) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent('<h1>Diagnostic fixture</h1>');
    await page.evaluate(() => {
      (window as any).__captionSamples = [{ at: 1, start: 0, end: 1, text: 'fixture' }];
      (window as any).__judgeRender = [{ type: 'complete', samples: 44100 }];
    });
    audioCleanup(() => finishBrowserTest(
        () => attachAudioDiagnostics([page], request, '1234', info, true),
        [async () => {
          await context.close();
          await info.attach('context-closed', { body: Buffer.from('closed'), contentType: 'text/plain' });
        }],
      ));
    if (failure === 'assertion') expect(1, 'Injected assertion failure').toBe(2);
    else {
      test.setTimeout(1000);
      await page.waitForTimeout(60000);
    }
  });
}
`,
    );
    let exitCode = 0;
    try {
      await promisify(execFile)(
        process.execPath,
        [cli, "test", "--config", join(output, "playwright.config.ts")],
        {
          cwd: output,
          env: { ...process.env, FORCE_COLOR: "0" },
          timeout: 35000,
        },
      );
    } catch (error) {
      exitCode = error.code;
      await writeFile(
        join(output, "process.log"),
        `${error.stdout || ""}\n${error.stderr || ""}`,
      );
    }
    assert.equal(
      exitCode,
      1,
      "the subprocess must fail on the injected errors",
    );
    const report = JSON.parse(
      await readFile(join(output, "report.json"), "utf8"),
    );
    assert.deepEqual(report.errors, []);
    const specs = (suites) =>
      suites.flatMap((suite) => [...suite.specs, ...specs(suite.suites || [])]);
    const cases = specs(report.suites);
    assert.equal(cases.length, 2);
    for (const item of cases) {
      const result = item.tests[0].results[0];
      assert.equal(
        result.status,
        item.title === "timeout" ? "timedOut" : "failed",
      );
      assert.match(
        result.error.message,
        item.title === "timeout"
          ? /Test timeout.*exceeded/
          : /Injected assertion failure/,
        "diagnostic teardown must preserve the original failure",
      );
      const attachments = new Map(
        result.attachments.map((attachment) => [attachment.name, attachment]),
      );
      const content = async (name) => {
        const attachment = attachments.get(name);
        assert(attachment, `${item.title}: missing ${name}`);
        return attachment.path
          ? readFile(attachment.path)
          : Buffer.from(attachment.body, "base64");
      };
      assert.equal(
        JSON.parse(await content("audio-samples-0")).captionSamples[0].text,
        "fixture",
      );
      assert.equal(
        JSON.parse(await content("audio-samples-0")).renderEvents[0].samples,
        44100,
      );
      assert.equal(JSON.parse(await content("audio-state")).phase, "ROUND");
      assert.equal(
        JSON.parse(await content("audio-timeline"))[0].stage,
        "fixture-timeline",
      );
      assert.deepEqual(
        (await content("audio-failure-0")).subarray(0, 8),
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      assert.equal((await content("context-closed")).toString(), "closed");
    }
  },
);
