import express from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

import { createRegistry } from "./rooms/registry.js";
import type { RoomServices } from "./rooms/services.js";
import { registerHttp } from "./transport/http.js";
import { registerSockets } from "./transport/sockets.js";
import { AUDIO_WORKLETS, frontendReady } from "./frontend.js";
import { settleCleanup } from "./shutdown.js";
import {
  createClientIpResolver,
  trustedProxyHops,
} from "./transport/client-ip.js";
export function createApp(
  options: {
    services?: Partial<RoomServices>;
    providersReady?: () => boolean;
    distPath?: string;
    proxyHops?: number;
  } = {},
) {
  const app = express(),
    server = createServer(app);
  const registry = createRegistry(options.services, options.providersReady);
  const { rooms, byId, buckets } = registry;
  const proxyHops = options.proxyHops ?? trustedProxyHops();
  const clientIp = createClientIpResolver(proxyHops);
  const dist = resolve(options.distPath ?? "dist");
  const built = frontendReady(dist);
  let stopping = false;
  let closing: Promise<boolean> | undefined;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self)");
    next();
  });

  app.get("/readyz", (_req, res) => {
    const ready = !stopping && registry.providersReady() && built;
    res.setHeader("Cache-Control", "no-store");
    res.status(ready ? 200 : 503).json({ ok: ready });
  });
  app.use((_req, res, next) => {
    if (stopping) {
      res.setHeader("Connection", "close");
      res
        .status(503)
        .json({ error: "Server restarting. Join a new court shortly." });
      return;
    }
    next();
  });
  registerHttp(app, registry, clientIp);
  const wss = registerSockets(server, registry, clientIp, () => stopping);
  const ticking = setInterval(() => {
    for (const room of rooms.values()) if (!room.closed) room.tick();
  }, 100);
  const pruning = setInterval(() => {
    for (const [code, room] of rooms) {
      const empty = room.game.state.players.every((p) => !p.connected);
      if (
        Date.now() - room.createdAt > 3600000 ||
        Date.now() - room.lastActiveAt > (empty ? 60000 : 900000)
      ) {
        room.close();
        rooms.delete(code);
        byId.delete(room.game.state.roomId);
      }
    }
    for (const [key, b] of buckets)
      if (b.expires < Date.now()) buckets.delete(key);
  }, 10000);
  if (existsSync(dist)) {
    app.use(
      express.static(dist, {
        maxAge: "1h",
        setHeaders: (res, path) => {
          if (path.endsWith("index.html"))
            res.setHeader("Cache-Control", "no-store");
        },
      }),
    );
    app.get(
      ["/assets/{*path}", ...AUDIO_WORKLETS.map((file) => "/" + file)],
      (_req, res) => res.sendStatus(404),
    );
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve(dist, "index.html")),
    );
  } else
    app.get("/", (_req, res) =>
      res
        .type("text")
        .send(
          "Hear Me Out server is ready. Run pnpm dev for the app, or pnpm build && pnpm start.",
        ),
    );
  function close() {
    if (closing) return closing;
    let done!: (ok: boolean) => void;
    closing = new Promise<boolean>((resolve) => (done = resolve));
    stopping = true;
    clearInterval(ticking);
    clearInterval(pruning);
    const force = setTimeout(() => {
      for (const socket of wss.clients) socket.terminate();
      server.closeAllConnections();
    }, 5000);
    force.unref();
    const cleanup = settleCleanup([
      ...[...wss.clients].map(
        (socket) => () => socket.close(1012, "Server restarting"),
      ),
      ...[...rooms.values()].map((room) => () => room.close()),
      () =>
        new Promise<boolean>((resolve) =>
          wss.close((error) => resolve(!error)),
        ),
      () =>
        new Promise<boolean>((resolve) =>
          server.close((error) =>
            resolve(
              !error ||
                (error as NodeJS.ErrnoException).code ===
                  "ERR_SERVER_NOT_RUNNING",
            ),
          ),
        ),
    ]);
    rooms.clear();
    byId.clear();
    buckets.clear();
    void cleanup.then((ok) => {
      clearTimeout(force);
      done(ok);
    });
    return closing;
  }

  return { app, server, registry, close };
}
