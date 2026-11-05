import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { catalog, FLOWS, SIZES } from "./model.mjs";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const reviewDirectory = path.join(repositoryRoot, "output/ui-review");
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export async function resolveReview({
  review,
  cwd = process.cwd(),
  latestFile = path.join(reviewDirectory, "LATEST"),
} = {}) {
  if (review !== undefined) {
    requireValue(nonempty(review), "--review must name a review directory.");
    return path.resolve(cwd, review);
  }
  let selected;
  try {
    selected = (await fs.readFile(latestFile, "utf8")).trim();
  } catch (error) {
    throw new Error(
      `Cannot read ${latestFile}. Select a review with --review <directory>; see tools/ui-review/README.md.`,
      { cause: error },
    );
  }
  requireValue(
    nonempty(selected),
    "LATEST is empty. Select a review with --review <directory>.",
  );
  return path.resolve(path.dirname(latestFile), selected);
}

async function readJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read valid JSON from ${file}: ${error.message}`, {
      cause: error,
    });
  }
}
function relativeFile(value) {
  return (
    nonempty(value) &&
    !path.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.split("/").some((part) => !part || part === "." || part === "..")
  );
}
export function validateManifest(manifest) {
  requireValue(
    object(manifest) &&
      nonempty(manifest.id) &&
      Array.isArray(manifest.scenarios) &&
      manifest.scenarios.length > 0 &&
      Array.isArray(manifest.captures),
    "Invalid review manifest.",
  );
  const scenarios = new Set();
  for (const s of manifest.scenarios) {
    requireValue(
      object(s) &&
        nonempty(s.id) &&
        nonempty(s.title) &&
        FLOWS.includes(s.group) &&
        !scenarios.has(s.id),
      "Invalid or duplicate scenario.",
    );
    scenarios.add(s.id);
  }
  const ids = new Set(),
    positions = new Set();
  for (const c of manifest.captures) {
    requireValue(
      object(c) &&
        nonempty(c.id) &&
        !ids.has(c.id) &&
        scenarios.has(c.scenario) &&
        SIZES.includes(c.viewport) &&
        ["before", "after"].includes(c.version) &&
        Number.isInteger(c.frame) &&
        c.frame >= 0 &&
        relativeFile(c.file) &&
        Number.isInteger(c.width) &&
        c.width > 0 &&
        Number.isInteger(c.height) &&
        c.height > 0 &&
        digest(c.sha256),
      "Invalid or duplicate capture.",
    );
    const position = JSON.stringify([
      c.scenario,
      c.viewport,
      c.version,
      c.frame,
    ]);
    requireValue(!positions.has(position), "Duplicate capture frame.");
    ids.add(c.id);
    positions.add(position);
  }
  const model = catalog(manifest);
  for (const s of model.scenarios)
    for (const size of SIZES)
      for (const version of ["before", "after"]) {
        requireValue(
          model
            .frames(s.id, size, version)
            .every((c, index) => c.frame === index),
          "Capture frames must start at zero and be consecutive.",
        );
      }
  return model;
}
function validateFeedback(feedback, manifest, model) {
  requireValue(
    object(feedback) &&
      feedback.schemaVersion === 1 &&
      feedback.reviewId === manifest.id &&
      Number.isInteger(feedback.revision) &&
      feedback.revision >= 0 &&
      Array.isArray(feedback.comments) &&
      object(feedback.reviewed),
    "Feedback does not match this review or has an invalid schema.",
  );
  const ids = new Set(),
    numbers = new Set();
  for (const c of feedback.comments) {
    const cap = model.captures.get(c?.captureId);
    requireValue(
      object(c) &&
        nonempty(c.id) &&
        !ids.has(c.id) &&
        Number.isInteger(c.number) &&
        c.number > 0 &&
        !numbers.has(c.number) &&
        cap &&
        c.reviewId === manifest.id &&
        typeof c.text === "string" &&
        Number.isFinite(c.updatedAt) &&
        Number.isFinite(c.createdAt) &&
        typeof c.deleted === "boolean" &&
        typeof c.resolved === "boolean" &&
        [c.x, c.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1),
      "Invalid saved comment.",
    );
    for (const key of ["scenario", "viewport", "version", "frame"])
      requireValue(c[key] === cap[key], "Saved comment attachment mismatch.");
    requireValue(
      c.screenshot === cap.file && c.screenshotSha256 === cap.sha256,
      "Saved comment screenshot hash mismatch.",
    );
    ids.add(c.id);
    numbers.add(c.number);
  }
  const views = new Set(
    manifest.scenarios.flatMap((s) => SIZES.map((size) => `${s.id}:${size}`)),
  );
  for (const [key, value] of Object.entries(feedback.reviewed))
    requireValue(
      views.has(key) &&
        object(value) &&
        typeof value.value === "boolean" &&
        Number.isFinite(value.updatedAt),
      "Invalid legacy review mark.",
    );
}

export async function loadReview({
  reviewRoot,
  dataRoot = reviewRoot,
  verify = true,
}) {
  const manifest = await readJSON(path.join(reviewRoot, "manifest.json"));
  const model = validateManifest(manifest);
  if (verify) {
    const seal = await readJSON(path.join(reviewRoot, "sealed.json"));
    requireValue(
      object(seal) && seal.reviewId === manifest.id && object(seal.hashes),
      "Invalid review seal.",
    );
    requireValue(
      digest(seal.hashes["manifest.json"]),
      "The seal must cover manifest.json.",
    );
    for (const c of manifest.captures)
      requireValue(
        seal.hashes[c.file] === c.sha256,
        `Capture is missing from the seal or has a mismatched hash: ${c.file}`,
      );
    const actualRoot = await fs.realpath(reviewRoot);
    for (const [relative, hash] of Object.entries(seal.hashes)) {
      requireValue(
        relativeFile(relative) &&
          digest(hash) &&
          !["feedback.json", "progress.json", "sealed.json"].includes(relative),
        `Invalid immutable asset in seal: ${relative}`,
      );
      const file = path.join(reviewRoot, relative),
        actualFile = await fs.realpath(file);
      requireValue(
        actualFile.startsWith(actualRoot + path.sep),
        `Sealed asset leaves the review directory: ${relative}`,
      );
      requireValue(
        sha(await fs.readFile(file)) === hash,
        `Immutable asset changed: ${relative}`,
      );
    }
  }
  const feedback = await readJSON(path.join(dataRoot, "feedback.json"));
  validateFeedback(feedback, manifest, model);
  let progress;
  try {
    progress = JSON.parse(
      await fs.readFile(path.join(dataRoot, "progress.json"), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(`Cannot read valid progress.json: ${error.message}`, {
        cause: error,
      });
    progress = {
      schemaVersion: 1,
      reviewId: manifest.id,
      viewedCaptureIds: [],
    };
  }
  requireValue(
    object(progress) &&
      progress.schemaVersion === 1 &&
      progress.reviewId === manifest.id &&
      Array.isArray(progress.viewedCaptureIds) &&
      progress.viewedCaptureIds.every((id) => model.captures.has(id)),
    "Invalid saved progress.",
  );
  return { manifest, model, feedback, progress };
}
