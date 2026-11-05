import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createViewer } from "../server.mjs";
import { loadReview, resolveReview } from "../review.mjs";
import {
  startReview,
  temporaryReview,
  readJSON,
  post,
  testOutput,
} from "./helpers.mjs";
const exec = promisify(execFile),
  cli = fileURLToPath(new URL("../server.mjs", import.meta.url));
test("portable review selection, including old absolute LATEST pointers", async (t) => {
  const root = await temporaryReview();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const latestFile = path.join(root, "LATEST");
  await fs.writeFile(latestFile, "../selected\n");
  assert.equal(
    await resolveReview({ latestFile }),
    path.resolve(root, "../selected"),
  );
  await fs.writeFile(latestFile, root);
  assert.equal(await resolveReview({ latestFile }), root);
  assert.equal(
    await resolveReview({ review: "relative", cwd: root }),
    path.join(root, "relative"),
  );
  await fs.writeFile(latestFile, "");
  await assert.rejects(resolveReview({ latestFile }), /LATEST is empty/);
  await assert.rejects(
    resolveReview({ latestFile: path.join(root, "absent") }),
    /--review/,
  );
});
test("--check is read-only and CLI failures are actionable", async (t) => {
  const root = await temporaryReview();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = await fs.readFile(path.join(root, "feedback.json"));
  const result = await exec(
    process.execPath,
    [cli, "--review", root, "--check"],
    { cwd: testOutput },
  );
  assert.match(result.stdout, /synthetic-review.*36 captures/);
  assert.deepEqual(await fs.readFile(path.join(root, "feedback.json")), before);
  await assert.rejects(fs.stat(path.join(root, "progress.json")), {
    code: "ENOENT",
  });
  await assert.rejects(
    exec(process.execPath, [cli, "--review", root, "--port", "oops"]),
    (e) => /--port must/.test(e.stderr),
  );
  const app = await createViewer({ reviewRoot: root, port: 0 });
  t.after(app.close);
  await assert.rejects(
    exec(process.execPath, [
      cli,
      "--review",
      root,
      "--port",
      String(app.server.address().port),
    ]),
    (e) => /already in use/.test(e.stderr),
  );
});
test("seal/data failures never initialize replacement feedback", async (t) => {
  const root = await temporaryReview();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const feedback = await fs.readFile(path.join(root, "feedback.json"));
  await fs.appendFile(path.join(root, "images/desktop-before.png"), "tampered");
  await assert.rejects(
    loadReview({ reviewRoot: root }),
    /Immutable asset changed/,
  );
  assert.deepEqual(
    await fs.readFile(path.join(root, "feedback.json")),
    feedback,
  );
  await fs.writeFile(path.join(root, "feedback.json"), "bad json");
  await assert.rejects(
    loadReview({ reviewRoot: root, verify: false }),
    /Cannot read valid JSON/,
  );
  assert.equal(
    await fs.readFile(path.join(root, "feedback.json"), "utf8"),
    "bad json",
  );
});
test("schema validation rejects duplicate captures, path escapes and missing pairs", async (t) => {
  const root = await temporaryReview();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original = await readJSON(path.join(root, "manifest.json"));
  for (const mutate of [
    (m) => m.captures.push(m.captures[0]),
    (m) => (m.captures[0].file = "../escape.png"),
    (m) =>
      (m.captures = m.captures.filter(
        (c) =>
          !(
            c.scenario === "entry" &&
            c.viewport === "phone" &&
            c.version === "before"
          ),
      )),
  ]) {
    const m = structuredClone(original);
    mutate(m);
    await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(m));
    await assert.rejects(loadReview({ reviewRoot: root, verify: false }));
  }
});
test("loopback API validates writes; progress unions atomically and survives restart", async (t) => {
  let app = await startReview();
  t.after(() => app.dispose());
  let url = app.url;
  const manifest = app.manifest,
    ids = manifest.captures.slice(0, 8).map((c) => c.id);
  await Promise.all(
    ids.map((id) =>
      post(url, "/api/progress", {
        reviewId: manifest.id,
        viewedCaptureIds: [id],
      }),
    ),
  );
  const saved = await (await fetch(url + "/api/progress")).json();
  assert.equal(saved.viewedCaptureIds.length, 8);
  await post(url, "/api/progress", {
    reviewId: manifest.id,
    viewedCaptureIds: [ids[0]],
  });
  assert.deepEqual(await (await fetch(url + "/api/progress")).json(), saved);
  assert.equal(
    (
      await post(url, "/api/progress", {
        reviewId: manifest.id,
        viewedCaptureIds: ["unknown"],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(url + "/api/progress", {
        method: "POST",
        headers: {
          Origin: "http://elsewhere.invalid",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal((await fetch(url + "/server.mjs")).status, 404);
  await app.close();
  const restarted = await createViewer({ reviewRoot: app.root, port: 0 });
  t.after(restarted.close);
  assert.deepEqual(
    await (await fetch(restarted.url + "/api/progress")).json(),
    saved,
  );
});
test("comments retain attachments, numbers and tombstones; exports include progress", async (t) => {
  const app = await startReview();
  t.after(app.dispose);
  const original = await (await fetch(app.url + "/api/feedback")).json();
  const update = structuredClone(original);
  update.comments[0].text = "Changed";
  update.comments[0].updatedAt = 100;
  update.comments[0].number = 99;
  const saved = await (await post(app.url, "/api/feedback", update)).json();
  assert.equal(saved.comments[0].text, "Changed");
  assert.equal(saved.comments[0].number, 1);
  assert.deepEqual(saved.comments[2], original.comments[2]);
  update.comments[0].viewport = "phone";
  assert.equal((await post(app.url, "/api/feedback", update)).status, 400);
  const exported = await (await fetch(app.url + "/export.json")).json();
  assert.deepEqual(exported.comments, saved.comments);
  assert(exported.progress);
  assert.match(await (await fetch(app.url + "/export.md")).text(), /Changed/);
});

test("failed atomic writes retain prior feedback and retry cleanly", async (t) => {
  const app = await startReview();
  t.after(app.dispose);
  const original = await readJSON(path.join(app.root, "feedback.json"));
  await fs.mkdir(path.join(app.root, "feedback.json.tmp"));
  const update = structuredClone(original);
  update.comments[0].text = "Retry this write";
  update.comments[0].updatedAt = 100;
  const response = await post(app.url, "/api/feedback", update);
  assert.equal(response.status, 500);
  await response.text();
  assert.deepEqual(
    await readJSON(path.join(app.root, "feedback.json")),
    original,
  );
  assert.deepEqual(
    await (await fetch(app.url + "/api/feedback")).json(),
    original,
  );
  await fs.rm(path.join(app.root, "feedback.json.tmp"), { recursive: true });
  const saved = await (await post(app.url, "/api/feedback", update)).json();
  assert.equal(saved.comments[0].text, "Retry this write");
  await app.close();
  const restored = await createViewer({ reviewRoot: app.root, port: 0 });
  try {
    assert.deepEqual(
      await (await fetch(restored.url + "/api/feedback")).json(),
      saved,
    );
  } finally {
    await restored.close();
  }
});

test(
  "shutdown closes accepted speculative connections and tolerates repeated close",
  { timeout: 10000 },
  async (t) => {
    const { default: net } = await import("node:net");
    const app = await startReview();
    t.after(app.dispose);
    const accepted = once(app.server, "connection");
    const socket = new net.Socket();
    const errors = [];
    socket.on("error", (error) => errors.push(error));
    const disconnected = new Promise((resolve) =>
      socket.once("close", resolve),
    );
    t.after(() => socket.destroy());
    const connected = once(socket, "connect");
    socket.connect(app.server.address().port, "127.0.0.1");
    await Promise.all([connected, accepted]);
    const started = performance.now();
    await Promise.all([app.close(), app.close()]);
    await disconnected;
    assert(performance.now() - started < 3000);
    for (const error of errors) assert.equal(error.code, "ECONNRESET");
  },
);

test(
  "shutdown drains accepted feedback and progress writes before returning",
  { timeout: 10000 },
  async (t) => {
    const app = await startReview();
    const original = await readJSON(path.join(app.root, "feedback.json"));
    const update = structuredClone(original);
    update.comments[0].text = "Saved during shutdown";
    update.comments[0].updatedAt = 100;
    update.comments.push({
      ...update.comments[0],
      id: "new-comment",
      number: 999,
    });
    const ids = app.manifest.captures.slice(0, 3).map((capture) => capture.id);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const rename = fs.rename.bind(fs);
    let held = false;
    const barrier = t.mock.method(fs, "rename", async (from, to) => {
      if (!held && from === path.join(app.root, "feedback.json.tmp")) {
        held = true;
        entered.resolve();
        await release.promise;
      }
      return rename(from, to);
    });
    t.after(async () => {
      release.resolve();
      barrier.mock.restore();
      await app.dispose();
    });
    // Forced connection closure can lose the HTTP acknowledgement. The browser
    // retains that draft; shutdown must still finish every accepted disk write.
    const response = (request) =>
      request.then(
        async (res) => {
          assert.equal(res.status, 200);
          return { value: await res.json() };
        },
        (error) => ({ error }),
      );
    const feedbackResponse = response(post(app.url, "/api/feedback", update));
    await entered.promise;
    const progressAccepted = Promise.withResolvers();
    app.server.once("request", (request) => {
      assert.equal(request.url, "/api/progress");
      // The body parser queues the write in the microtask following 'end'.
      request.once("end", () => setImmediate(progressAccepted.resolve));
    });
    const progressResponse = response(
      post(app.url, "/api/progress", {
        reviewId: app.manifest.id,
        viewedCaptureIds: ids,
      }),
    );
    await progressAccepted.promise;
    const transportClosed = once(app.server, "close");
    const started = performance.now();
    let finished = false;
    const closing = app.close().then(() => {
      finished = true;
    });
    await transportClosed;
    assert(performance.now() - started < 3000);
    assert.equal(
      finished,
      false,
      "shutdown returned before the blocked write completed",
    );
    release.resolve();
    await closing;
    assert(performance.now() - started < 3000);
    for (const result of await Promise.all([
      feedbackResponse,
      progressResponse,
    ])) {
      if (result.error)
        assert(
          ["UND_ERR_SOCKET", "ECONNRESET"].includes(result.error.cause?.code),
        );
    }
    const saved = await readJSON(path.join(app.root, "feedback.json"));
    assert.equal(saved.comments[0].text, "Saved during shutdown");
    assert.equal(saved.comments[0].number, original.comments[0].number);
    assert.deepEqual(saved.comments.slice(1, 3), original.comments.slice(1, 3));
    assert.equal(saved.comments.at(-1).number, 4);
    const progress = await readJSON(path.join(app.root, "progress.json"));
    assert.deepEqual(progress.viewedCaptureIds, ids);
    const restarted = await createViewer({ reviewRoot: app.root, port: 0 });
    try {
      assert.deepEqual(
        await (await fetch(restarted.url + "/api/feedback")).json(),
        saved,
      );
      assert.deepEqual(
        await (await fetch(restarted.url + "/api/progress")).json(),
        progress,
      );
      await restarted.close();
      await restarted.close();
    } finally {
      await restarted.close();
    }
  },
);
