import assert from "node:assert/strict";
import test from "node:test";
import { finishBrowserTest } from "./browser/cleanup";
import { attachAudioDiagnostics } from "./browser/audio-diagnostics";
import type { Page, APIRequestContext, TestInfo } from "@playwright/test";

test("injected audio assertion failure retains samples, timeline, state and screenshot before close", async () => {
  const attachments: string[] = [];
  let closed = false;
  const primary = new Error("caption tolerance failed");
  const page = {
    evaluate: async () => {
      assert(!closed);
      return {
        captionSamples: [{ samples: 7000, start: 0, end: 0 }],
        renderEvents: [],
      };
    },
    screenshot: async () => {
      assert(!closed);
      return Buffer.from("image");
    },
  } as unknown as Page;
  const request = {
    post: async () => ({
      body: async () => {
        assert(!closed);
        return Buffer.from("{}");
      },
    }),
  } as unknown as APIRequestContext;
  const info = {
    status: "passed",
    expectedStatus: "passed",
    attach: async (name: string) => {
      assert(!closed);
      attachments.push(name);
    },
  } as unknown as TestInfo;
  await assert.rejects(
    async () => {
      try {
        throw primary;
      } finally {
        await finishBrowserTest(
          () => attachAudioDiagnostics([page], request, "1234", info, true),
          [
            async () => {
              closed = true;
            },
          ],
        );
      }
    },
    (error) => error === primary,
  );
  assert.deepEqual(attachments.sort(), [
    "audio-failure-0",
    "audio-samples-0",
    "audio-state",
    "audio-timeline",
  ]);
  assert(closed);
});

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
