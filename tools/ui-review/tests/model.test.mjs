import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  catalog,
  completeView,
  completeState,
  unseenStep,
  locate,
  mergeFeedback,
  markdown,
  FLOWS,
} from "../model.mjs";
import { readJSON, fixtureRoot } from "./helpers.mjs";
const manifest = await readJSON(path.join(fixtureRoot, "manifest.json"));
const feedback = await readJSON(path.join(fixtureRoot, "feedback.json"));
const model = catalog(manifest);
test("all flows/captures are reachable in Desktop frames → Phone frames order", () => {
  assert.deepEqual([...new Set(model.steps.map((s) => s.group))], FLOWS);
  assert.equal(
    new Set(model.steps.flatMap((s) => [s.before.id, s.after.id])).size,
    manifest.captures.length,
  );
  for (const scenario of model.scenarios) {
    const steps = model.steps.filter((s) => s.scenario === scenario.id);
    const firstPhone = steps.findIndex((s) => s.viewport === "phone");
    assert(firstPhone > 0);
    assert(steps.slice(firstPhone).every((s) => s.viewport === "phone"));
  }
  const held = model.steps.find(
    (s) => s.scenario === "turn" && s.viewport === "desktop" && s.frame === 1,
  );
  assert.equal(held.before.frame, 0);
  assert.equal(held.after.frame, 1);
  assert.equal(
    model.scenarios.findIndex((s) => s.id === "match-draw"),
    model.scenarios.findIndex((s) => s.id === "winner") + 1,
  );
});
test("legacy links, continuation clamping, completion and legacy marks", () => {
  assert.equal(
    model.steps[locate(model, "#screen=turn&viewport=phone")].frame,
    0,
  );
  assert.equal(
    model.steps[locate(model, "#screen=turn&viewport=phone&frame=99")].frame,
    2,
  );
  assert.equal(locate(model, "#screen=missing"), -1);
  assert.equal(locate(model, "#end=1"), model.steps.length);
  const viewed = new Set();
  assert(completeState(model, feedback, viewed, "lobby"));
  assert(!completeView(model, feedback, viewed, "entry", "desktop"));
  assert.equal(unseenStep(model, feedback, viewed), 0);
  manifest.captures.forEach((c) => viewed.add(c.id));
  assert.equal(unseenStep(model, feedback, viewed), -1);
  assert(
    model.scenarios.every((s) => completeState(model, feedback, viewed, s.id)),
  );
});
test("feedback merge preserves canonical numbers, newer edits, tombstones and readable exports", () => {
  const draft = structuredClone(feedback);
  draft.comments[0].text = "New feedback";
  draft.comments[0].updatedAt = 50;
  draft.comments[1].number = 99; // Equal timestamp cannot replace a server-assigned number.
  const merged = mergeFeedback(feedback, draft);
  assert.equal(merged.comments[0].text, "New feedback");
  assert.equal(merged.comments[1].number, 2);
  assert(merged.comments[2].deleted);
  const text = markdown(
    manifest,
    { ...merged, dirty: true },
    { viewedCaptureIds: [] },
  );
  assert.match(text, /Includes unsaved browser drafts/);
  assert.match(text, /SHA-256:/);
  assert.match(text, /New feedback/);
  assert(!text.includes("Deleted test note"));
});
