import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { markdown } from "./model.mjs";
import { loadReview, resolveReview } from "./review.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
export async function createViewer({
  reviewRoot,
  dataRoot = reviewRoot,
  port = 5192,
  verify = true,
}) {
  const loaded = await loadReview({ reviewRoot, dataRoot, verify });
  const { manifest, model } = loaded;
  let { feedback, progress } = loaded;
  const feedbackFile = path.join(dataRoot, "feedback.json");
  const progressFile = path.join(dataRoot, "progress.json");
  const imageFiles = new Set(manifest.captures.map((c) => c.file));
  const viewerFiles = new Set([
    "index.html",
    "board.css",
    "board.mjs",
    "model.mjs",
  ]);
  let queue = Promise.resolve();
  const enqueue = (work) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  const atomic = async (file, value) => {
    await fs.writeFile(file + ".tmp", JSON.stringify(value, null, 2) + "\n");
    await fs.rename(file + ".tmp", file);
  };
  const server = http.createServer(async (req, res) => {
    const json = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const host = req.headers.host,
        activePort = server.address()?.port || port;
      if (
        ![`127.0.0.1:${activePort}`, `localhost:${activePort}`].includes(host)
      ) {
        json(403, { error: "Loopback only" });
        return;
      }
      const url = new URL(req.url, `http://${host}`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (["/api/feedback", "/api/progress"].includes(url.pathname)) {
        const isProgress = url.pathname === "/api/progress";
        if (req.method === "GET") {
          json(200, isProgress ? progress : feedback);
          return;
        }
        if (req.method !== "POST") {
          json(405, { error: "Method not allowed" });
          return;
        }
        if (
          req.headers.origin !== `http://${host}` ||
          !req.headers["content-type"]?.startsWith("application/json")
        ) {
          json(403, { error: "Same-origin JSON required" });
          return;
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 2e6) {
            json(413, { error: "Request too large" });
            return;
          }
          chunks.push(chunk);
        }
        const update = JSON.parse(Buffer.concat(chunks).toString());
        if (update.reviewId !== manifest.id) throw Error("Invalid review");
        if (isProgress) {
          if (
            !Array.isArray(update.viewedCaptureIds) ||
            update.viewedCaptureIds.length > model.captures.size ||
            update.viewedCaptureIds.some((id) => !model.captures.has(id))
          )
            throw Error("Invalid capture IDs");
          const next = await enqueue(async () => {
            const ids = [
              ...new Set([
                ...progress.viewedCaptureIds,
                ...update.viewedCaptureIds,
              ]),
            ];
            if (ids.length === progress.viewedCaptureIds.length)
              return progress;
            const value = {
              ...progress,
              viewedCaptureIds: ids,
              savedAt: new Date().toISOString(),
            };
            await atomic(progressFile, value);
            progress = value;
            return value;
          });
          json(200, next);
          return;
        }
        if (!Array.isArray(update.comments) || update.comments.length > 3000)
          throw Error("Invalid comments");
        for (const c of update.comments) {
          const cap = model.captures.get(c.captureId);
          if (
            typeof c.id !== "string" ||
            !c.id ||
            c.id.length > 100 ||
            !cap ||
            typeof c.text !== "string" ||
            c.text.length > 20000 ||
            !Number.isFinite(c.x) ||
            !Number.isFinite(c.y) ||
            c.x < 0 ||
            c.x > 1 ||
            c.y < 0 ||
            c.y > 1 ||
            !Number.isFinite(c.updatedAt) ||
            !Number.isFinite(c.createdAt) ||
            typeof c.deleted !== "boolean" ||
            typeof c.resolved !== "boolean"
          )
            throw Error("Invalid comment");
          for (const key of ["scenario", "viewport", "version", "frame"])
            if (c[key] !== cap[key]) throw Error("Attachment mismatch");
        }
        for (const [key, val] of Object.entries(update.reviewed || {}))
          if (
            !model.scenarios.some((s) =>
              ["desktop", "phone"].some((v) => key === s.id + ":" + v),
            ) ||
            typeof val.value !== "boolean" ||
            !Number.isFinite(val.updatedAt)
          )
            throw Error("Invalid legacy progress");
        const next = await enqueue(async () => {
          const value = structuredClone(feedback);
          let number = Math.max(0, ...value.comments.map((c) => c.number || 0));
          for (const c of update.comments) {
            const cap = model.captures.get(c.captureId),
              i = value.comments.findIndex((x) => x.id === c.id);
            const canonical = {
              ...c,
              reviewId: manifest.id,
              screenshot: cap.file,
              screenshotSha256: cap.sha256,
            };
            if (i < 0) value.comments.push({ ...canonical, number: ++number });
            else if (c.updatedAt > value.comments[i].updatedAt)
              value.comments[i] = {
                ...canonical,
                number: value.comments[i].number,
              };
          }
          for (const [key, val] of Object.entries(update.reviewed || {}))
            if (
              !value.reviewed[key] ||
              val.updatedAt > value.reviewed[key].updatedAt
            )
              value.reviewed[key] = val;
          value.revision++;
          value.savedAt = new Date().toISOString();
          await atomic(feedbackFile, value);
          feedback = value;
          return value;
        });
        json(200, next);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        json(405, { error: "Method not allowed" });
        return;
      }
      if (["/export.json", "/export.md"].includes(url.pathname)) {
        const md = url.pathname.endsWith(".md");
        res.writeHead(200, {
          "Content-Type": md
            ? "text/markdown; charset=utf-8"
            : "application/json",
          "Content-Disposition": `attachment; filename="${manifest.id}-feedback.${md ? "md" : "json"}"`,
        });
        res.end(
          md
            ? markdown(manifest, feedback, progress)
            : JSON.stringify({ ...feedback, progress }, null, 2),
        );
        return;
      }
      const rel =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname.slice(1));
      const root = viewerFiles.has(rel)
        ? here
        : rel === "manifest.json" || imageFiles.has(rel)
          ? reviewRoot
          : null;
      if (!root) {
        json(404, { error: "Not found" });
        return;
      }
      const contents = await fs.readFile(path.join(root, rel));
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
      };
      res.writeHead(200, {
        "Content-Type": mime[path.extname(rel)] || "application/octet-stream",
      });
      res.end(req.method === "HEAD" ? undefined : contents);
    } catch (e) {
      json(
        ["ENOSPC", "EACCES", "EROFS", "EIO", "EISDIR"].includes(e.code)
          ? 500
          : e.code === "ENOENT"
            ? 404
            : 400,
        {
          error: e.code
            ? "Could not read or save review data. Retry; browser drafts are retained."
            : e.message,
        },
      );
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    server,
    manifest,
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      // Chromium can leave speculative connections open without an HTTP request.
      // Stop accepting requests, drain writes, and bound those idle connections.
      const closed = new Promise((resolve, reject) =>
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
          else resolve();
        }),
      );
      const timer = setTimeout(() => server.closeAllConnections(), 1000);
      timer.unref();
      try {
        await closed;
        await queue;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        review: { type: "string" },
        port: { type: "string" },
        check: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      console.log(
        "Usage: pnpm ui:review [--review <directory>] [--port <port>] [--check]\nDefaults: output/ui-review/LATEST, port 5192. --check validates without writing or listening.",
      );
    } else {
      const reviewRoot = await resolveReview({ review: values.review });
      const port = Number(values.port ?? 5192);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error("--port must be an integer from 1 to 65535.");
      if (values.check) {
        const { manifest } = await loadReview({ reviewRoot });
        console.log(
          `Valid review ${manifest.id}: ${manifest.scenarios.length} states, ${manifest.captures.length} captures. No data changed.`,
        );
      } else {
        const app = await createViewer({ reviewRoot, port });
        console.log(
          `${app.url}\nReview: ${reviewRoot}\nFeedback: ${path.join(reviewRoot, "feedback.json")}\nProgress: ${path.join(reviewRoot, "progress.json")}`,
        );
        for (const sig of ["SIGTERM", "SIGINT"])
          process.once(sig, async () => {
            await app.close();
            process.exit(0);
          });
      }
    }
  } catch (error) {
    console.error(
      error.code === "EADDRINUSE"
        ? "Review port is already in use. Stop only the verified review server or choose another --port."
        : error.message,
    );
    process.exitCode = 1;
  }
}
