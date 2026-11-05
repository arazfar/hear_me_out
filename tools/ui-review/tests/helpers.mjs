import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createViewer } from "../server.mjs";
import { repositoryRoot } from "../review.mjs";
export const fixtureRoot = fileURLToPath(
  new URL("./fixtures/", import.meta.url),
);
export const testOutput = path.join(repositoryRoot, "output/ui-review-tests");
export async function temporaryReview() {
  await fs.mkdir(testOutput, { recursive: true });
  const root = await fs.mkdtemp(path.join(testOutput, "review-"));
  await fs.cp(fixtureRoot, root, { recursive: true });
  return root;
}
export async function startReview() {
  const root = await temporaryReview();
  const app = await createViewer({ reviewRoot: root, port: 0 });
  return {
    ...app,
    root,
    dispose: async () => {
      await app.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
export const readJSON = async (file) =>
  JSON.parse(await fs.readFile(file, "utf8"));
export const post = (url, endpoint, body) =>
  fetch(url + endpoint, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
