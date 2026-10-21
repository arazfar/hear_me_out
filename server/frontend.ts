import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const AUDIO_WORKLETS = [
  "pcm-worklet.js",
  "peer-worklet.js",
  "judge-worklet.js",
];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate an immutable Vite build once, without contacting any provider. */
export function frontendReady(dist: string) {
  try {
    const exists = (file: unknown) => {
      if (typeof file !== "string" || !file || isAbsolute(file)) return false;
      const path = resolve(dist, file);
      const local = relative(dist, path);
      if (local.startsWith("..") || isAbsolute(local)) return false;
      const stat = statSync(path);
      return stat.isFile() && stat.size > 0;
    };
    const manifest: unknown = JSON.parse(
      readFileSync(resolve(dist, ".vite/manifest.json"), "utf8"),
    );
    if (!record(manifest)) return false;
    const entrypoint = manifest["index.html"];
    if (!record(entrypoint) || entrypoint.isEntry !== true) return false;
    if (!["index.html", ...AUDIO_WORKLETS].every(exists)) return false;
    return Object.values(manifest).every(
      (entry) =>
        record(entry) &&
        exists(entry.file) &&
        ["css", "assets"].every(
          (key) =>
            entry[key] === undefined ||
            (Array.isArray(entry[key]) && entry[key].every(exists)),
        ) &&
        ["imports", "dynamicImports"].every(
          (key) =>
            entry[key] === undefined ||
            (Array.isArray(entry[key]) &&
              entry[key].every(
                (name: unknown) =>
                  typeof name === "string" && Object.hasOwn(manifest, name),
              )),
        ),
    );
  } catch {
    return false;
  }
}
