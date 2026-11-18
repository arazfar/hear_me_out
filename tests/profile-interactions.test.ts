import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  missingInteractions,
  saveCompletedProfile,
  type InteractionObservations,
} from "../scripts/profile-interactions";

test("Done evidence distinguishes a DOM-only settling transition from a state visible at a frame", async () => {
  const script = await readFile(
    new URL("../scripts/profile-observer.js", import.meta.url),
    "utf8",
  );
  let now = 12;
  let frame = () => {};
  let expiry = () => {};
  let mutation = (_changes: { oldValue: string }[]) => {};
  let click = (_event: { target: ElementFixture; timeStamp: number }) => {};
  class ElementFixture {
    localName = "button";
    className = "turn-panel";
    classList = {
      contains: (value: string) => this.className.split(" ").includes(value),
    };
    closest = () => this;
  }
  const panel = new ElementFixture();
  const window = {} as {
    gameInteractions: InteractionObservations;
    armProfileDone(): void;
  };
  runInNewContext(script, {
    window,
    URLSearchParams,
    location: { search: "" },
    document: {
      hidden: false,
      querySelector: () => panel,
      addEventListener: (_name: string, handler: typeof click) => {
        click = handler;
      },
    },
    performance: { now: () => now, timeOrigin: 1000 },
    WebSocket: class {},
    PerformanceObserver: class {},
    Element: ElementFixture,
    MutationObserver: class {
      constructor(callback: typeof mutation) {
        mutation = callback;
      }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (handler: typeof frame) => {
      frame = handler;
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout: (handler: typeof expiry) => {
      expiry = handler;
      return 2;
    },
    clearTimeout() {},
  });
  window.armProfileDone();
  click({ target: panel, timeStamp: 10 });
  mutation([{ oldValue: "turn-panel is-settling" }]);
  now = 20;
  frame();
  now = 2010;
  expiry();
  const { done, doneEvidence } = window.gameInteractions;
  assert.equal(done.length, 0);
  assert.equal(doneEvidence[0].settlingCommitted, true);
  assert.equal(doneEvidence[0].status, "missed");
  assert.equal(doneEvidence[0].clickedAt, 10);
  assert.equal(doneEvidence[0].firstFrameMs, 10);
  assert.equal(doneEvidence[0].lastPanelClass, "turn-panel");
  window.armProfileDone();
  click({ target: panel, timeStamp: 2020 });
  panel.className = "turn-panel is-settling";
  now = 2060;
  frame();
  assert.deepEqual([...done], [40]);
  assert.equal(doneEvidence[1].status, "visible");
});

test("all frame rows and missing interaction gates are saved before the benchmark fails", async () => {
  const seat = (): InteractionObservations => ({
    cues: [],
    done: [],
    cueEvidence: [],
    doneEvidence: [],
  });
  const seats = [seat(), seat()];
  seats[0].cues.push({ turn: "next", ms: 10, visibleAt: 80 });
  const failures = missingInteractions(seats, 0, "next");
  assert.deepEqual(failures, [
    "Missing or duplicate visible Done acknowledgment",
    "Missing visible successor cue on seat 2",
  ]);
  assert(
    missingInteractions(seats, 0, null).includes(
      "Missing open successor after Done",
    ),
  );
  seats[0].done.push(15);
  seats[1].cues.push({ turn: "next", ms: 12, visibleAt: 82 });
  const recovered = missingInteractions(seats, 0, "next");
  assert.deepEqual(recovered, []);
  const report = {
    completed: false,
    results: [failures, recovered].map((gates, i) => ({
      round: i + 1,
      checkout: 1,
      transport: "rtc",
      measurement: {
        activeCase: { p95Ms: 30 },
        interactions: { failures: gates },
      },
    })),
  };
  const dir = await mkdtemp(join(tmpdir(), "profile-gates-"));
  try {
    const output = join(dir, "sample.json");
    await assert.rejects(
      saveCompletedProfile(output, report),
      /round 1, checkout 1, rtc: Missing visible successor cue/,
    );
    const written = JSON.parse(await readFile(output, "utf8"));
    assert(written.completed);
    assert.deepEqual(written.results, report.results);
    await saveCompletedProfile(output, {
      completed: false,
      results: [report.results[1]],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
