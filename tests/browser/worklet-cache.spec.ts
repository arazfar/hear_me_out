import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

test("worklet refresh bypasses a fresh old cache across deploy and rollback", async ({
  page,
}) => {
  const loader = await transform(
    await readFile("src/media/worklet.ts", "utf8"),
    { loader: "ts", format: "esm" },
  );
  let build = "A",
    downloads = 0;
  const paths = ["/pcm-worklet.js", "/peer-worklet.js", "/judge-worklet.js"];
  const server = createServer((req, res) => {
    res.setHeader(
      "Cache-Control",
      paths.includes(req.url!) ? "public, max-age=3600" : "no-store",
    );
    if (paths.includes(req.url!)) {
      downloads++;
      res.end(build);
    } else if (req.url === "/loader.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(loader.code);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(`<html><body>${build}</body></html>`);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await page.goto(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    );
    await page.evaluate(
      async (paths) =>
        Promise.all(paths.map(async (path) => (await fetch(path)).text())),
      paths,
    );
    expect(downloads).toBe(3);
    for (const revision of ["B", "A"]) {
      build = revision;
      await page.reload();
      const modules = await page.evaluate(async (paths) => {
        const path = "/loader.js";
        const { loadWorklet } = await import(/* @vite-ignore */ path);
        const modules: string[] = [];
        const context = {
          audioWorklet: {
            addModule: async (url: string) =>
              modules.push(await (await fetch(url)).text()),
          },
        };
        for (const path of paths) {
          await loadWorklet(context, path, new AbortController().signal);
          await loadWorklet(context, path, new AbortController().signal);
        }
        return modules;
      }, paths);
      expect(modules).toEqual([revision, revision, revision]);
    }
    expect(
      downloads,
      "each new context downloads once, including rollback",
    ).toBe(9);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
