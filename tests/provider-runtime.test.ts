import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { build } from "esbuild";

test("production ESM provider transport closes unresponsive peers", async (t) => {
  // Keep external dependencies resolvable, as they are in dist-server/.
  await mkdir("output", { recursive: true });
  const directory = await mkdtemp(resolve("output/provider-runtime-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundle = resolve(directory, "ink.mjs");
  await build({
    entryPoints: ["server/providers/ink.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: bundle,
  });
  // No tsx loader or inherited execArgv: exercise the production ESM runtime.
  try {
    await promisify(execFile)(
      process.execPath,
      [resolve("tests/provider-runtime-fixture.mjs"), bundle],
      {
        timeout: 15_000,
        env: {
          ...process.env,
          NODE_OPTIONS: "",
          NODE_TEST_CONTEXT: undefined,
          CARTESIA_API_KEY: "local-fixture",
        },
      },
    );
  } catch (error) {
    const result = error as Error & { stdout?: string; stderr?: string };
    assert.fail(`${result.message}\n${result.stdout}\n${result.stderr}`);
  }
});
