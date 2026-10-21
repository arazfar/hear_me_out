import assert from "node:assert/strict";
import test from "node:test";
import { finishBrowserTest } from "./browser/cleanup";

test("diagnostic and cleanup failures preserve the primary failure and attempt every close", async () => {
  const primary = new Error("primary failure");
  const closed: number[] = [];
  await assert.rejects(
    async () => {
      try {
        throw primary;
      } finally {
        await finishBrowserTest(async () => {
          throw new Error("diagnostic failure");
        }, [
          async () => {
            closed.push(1);
            throw new Error("close failure");
          },
          async () => {
            closed.push(2);
          },
        ]);
      }
    },
    (error) => error === primary,
  );
  assert.deepEqual(closed, [1, 2]);
});

test("stalled diagnostics are bounded before cleanup", async () => {
  let closed = false;
  const start = performance.now();
  await finishBrowserTest(
    () => new Promise(() => {}),
    [
      async () => {
        closed = true;
      },
    ],
  );
  assert(closed);
  assert(performance.now() - start >= 1900);
  assert(performance.now() - start < 4000);
});
