import express from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

import { registerHttp } from "./http.js";
import { createRegistry } from "./registry.js";
import type { RoomServices } from "./runtime.js";
import { registerSockets } from "./sockets.js";
export function createApp(
  options: {
    services?: Partial<RoomServices>;
    providersReady?: () => boolean;
  } = {},
) {
  const app = express(),
    server = createServer(app);
  const registry = createRegistry(options.services, options.providersReady);
  const { rooms, byId, buckets } = registry;
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self)");
    next();
  });

  registerHttp(app, registry);
  const wss = registerSockets(server, registry);
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
  const dist = resolve("dist");
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
    clearInterval(ticking);
    clearInterval(pruning);
    for (const room of rooms.values()) room.close();
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    server.close();
  }

  return { app, server, registry, close };
}
