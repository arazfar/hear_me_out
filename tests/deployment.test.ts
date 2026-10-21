import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createApp } from "../server/app";
import {
  createClientIpResolver,
  trustedProxyHops,
} from "../server/transport/client-ip";
import { services } from "./fixtures";
import { AUDIO_WORKLETS } from "../server/frontend";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function request(forwarded?: string) {
  return {
    socket: { remoteAddress: "127.0.0.1" },
    headers: { "x-forwarded-for": forwarded },
  } as unknown as IncomingMessage;
}

async function buildFixture(dir: string) {
  await mkdir(join(dir, ".vite"), { recursive: true });
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(
    join(dir, "index.html"),
    '<!doctype html><script type="module" src="/assets/app.js"></script>',
  );
  for (const file of [
    ...AUDIO_WORKLETS,
    "assets/app.js",
    "assets/lazy.js",
    "assets/app.css",
  ])
    await writeFile(join(dir, file), "/* fixture */");
  const manifest = {
    "index.html": {
      isEntry: true,
      file: "assets/app.js",
      css: ["assets/app.css"],
      dynamicImports: ["lazy"],
    },
    lazy: { file: "assets/lazy.js" },
  };
  await writeFile(join(dir, ".vite/manifest.json"), JSON.stringify(manifest));
}

test("proxy identity ignores forged prefixes and rejects malformed or short paths", () => {
  const direct = createClientIpResolver(0),
    proxied = createClientIpResolver(3);
  assert.equal(direct(request("203.0.113.7")), "127.0.0.1");
  assert.equal(
    proxied(request("203.0.113.7, 10.0.0.1, 10.0.0.2")),
    "203.0.113.7",
  );
  assert.equal(
    proxied(request("192.0.2.99, 203.0.113.7, 10.0.0.1, 10.0.0.2")),
    "203.0.113.7",
  );
  assert.equal(
    proxied(request("invalid-prefix, 203.0.113.7, 10.0.0.1, 10.0.0.2")),
    "203.0.113.7",
  );
  assert.equal(proxied(request("203.0.113.7")), "127.0.0.1");
  assert.equal(proxied(request("garbage, 10.0.0.1, 10.0.0.2")), "127.0.0.1");
  assert.equal(
    proxied(request("::ffff:203.0.113.7, 10.0.0.1, 10.0.0.2")),
    "203.0.113.7",
  );
  assert.throws(() => trustedProxyHops("true"));
  assert.throws(() => trustedProxyHops("-1"));
});

test("readiness requires configuration and built assets, then fails during shutdown", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hmo-readiness-"));
  await buildFixture(dir);
  let configured = false;
  const runtime = createApp({
    distPath: dir,
    providersReady: () => configured,
  });
  // A separate listener lets us inspect the app after its owned server shuts down.
  const observer = createServer(runtime.app);
  const base = await listen(observer);
  t.after(async () => {
    await runtime.close();
    await new Promise<void>((resolve) => observer.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal((await fetch(base + "/readyz")).status, 503);
  configured = true;
  const ready = await fetch(base + "/readyz");
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get("cache-control"), "no-store");
  assert.deepEqual(await ready.json(), { ok: true });
  assert.equal((await fetch(base + "/healthz")).status, 200);
  const closing = runtime.close();
  assert.equal(runtime.close(), closing);
  await closing;
  assert.equal((await fetch(base + "/readyz")).status, 503);
  assert.equal(
    (
      await fetch(base + "/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alex" }),
      })
    ).status,
    503,
  );
});

test("readiness rejects incomplete immutable builds and static misses never become HTML", async (t) => {
  for (const missing of [
    "index.html",
    ".vite/manifest.json",
    "assets/app.js",
    "assets/lazy.js",
    "assets/app.css",
    ...AUDIO_WORKLETS,
  ]) {
    await t.test(missing, async () => {
      const dir = await mkdtemp(join(tmpdir(), "hmo-build-"));
      await buildFixture(dir);
      await rm(join(dir, missing));
      const runtime = createApp({ distPath: dir, providersReady: () => true });
      try {
        const base = await listen(runtime.server);
        const ready = await fetch(base + "/readyz");
        assert.equal(ready.status, 503);
        assert.deepEqual(await ready.json(), { ok: false });
        if (missing.startsWith("assets/") || AUDIO_WORKLETS.includes(missing))
          assert.equal((await fetch(base + "/" + missing)).status, 404);
      } finally {
        await runtime.close();
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
});

test("manifest validation rejects invalid entries and keeps SPA navigation", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "hmo-manifest-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const manifest of [
    "{",
    "{}",
    JSON.stringify({
      "index.html": {
        isEntry: true,
        file: "assets/app.js",
        imports: ["absent"],
      },
    }),
    JSON.stringify({ "index.html": { isEntry: true, file: "../outside.js" } }),
  ]) {
    await buildFixture(dir);
    await writeFile(join(dir, ".vite/manifest.json"), manifest);
    const runtime = createApp({ distPath: dir, providersReady: () => true });
    const base = await listen(runtime.server);
    assert.equal((await fetch(base + "/readyz")).status, 503);
    await runtime.close();
  }
  await buildFixture(dir);
  const runtime = createApp({ distPath: dir, providersReady: () => true });
  t.after(() => runtime.close());
  const base = await listen(runtime.server);
  assert.equal((await fetch(base + "/readyz")).status, 200);
  for (const path of ["/", "/court/invite"])
    assert.match(await (await fetch(base + path)).text(), /doctype html/);
  for (const path of [
    "/assets/app.js",
    ...AUDIO_WORKLETS.map((file) => "/" + file),
  ])
    assert.match(
      (await fetch(base + path)).headers.get("content-type")!,
      /javascript/,
    );
  assert.equal((await fetch(base + "/assets/absent.js")).status, 404);
});

test("HTTP clients behind one proxy get separate limits; forged prefixes do not reset them", async (t) => {
  const runtime = createApp({ proxyHops: 1, services: services() });
  t.after(() => runtime.close());
  const base = await listen(runtime.server);
  const create = (ip: string) =>
    fetch(base + "/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: JSON.stringify({ name: "Alex" }),
    });
  for (let i = 0; i < 3; i++)
    assert.equal((await create("203.0.113.7")).status, 200);
  assert.equal((await create("192.0.2.99, 203.0.113.7")).status, 429);
  assert.equal((await create("203.0.113.8")).status, 200);
});

test("WebSocket upgrades share proxy identity and shutdown closes peers and disposes rooms", async (t) => {
  const runtime = createApp({ proxyHops: 1, services: services() });
  t.after(() => runtime.close());
  const base = await listen(runtime.server);
  const room = runtime.registry.createRoom("1234");
  runtime.registry.rooms.set("1234", room);
  runtime.registry.byId.set(room.game.state.roomId, room);
  const ws = new WebSocket(base.replace("http", "ws") + "/socket/control", {
    headers: { "X-Forwarded-For": "192.0.2.99, 203.0.113.7" },
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  assert.equal(runtime.registry.buckets.get("upgrade:203.0.113.7")?.count, 1);
  assert.equal(runtime.registry.buckets.has("upgrade:192.0.2.99"), false);
  const closed = new Promise<number>((resolve) => ws.once("close", resolve));
  await runtime.close();
  assert.equal(await closed, 1012);
  assert.equal(room.closed, true);
  assert.equal(runtime.registry.rooms.size, 0);
  assert.equal(runtime.registry.byId.size, 0);
});
