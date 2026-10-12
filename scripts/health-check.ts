import assert from "node:assert/strict";
import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  sessionSchema,
} from "../shared/protocol";
const base = process.env.TEST_URL || "http://127.0.0.1:3000";
assert((await fetch(base)).ok, "Public app unavailable");
const health = await fetch(base + "/healthz");
assert(health.ok);
assert.equal((await health.json()).ok, true);
const response = await fetch(base + "/api/rooms", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Health check" }),
});
assert(response.ok);
const session = sessionSchema.parse((await response.json()).session);
await new Promise<void>((resolve, reject) => {
  const socket = new WebSocket(
    base.replace(/^http/, "ws") + "/socket/control",
    { origin: new URL(base).origin },
  );
  const timeout = setTimeout(() => {
    socket.terminate();
    reject(Error("Public WSS timeout"));
  }, 10000);
  socket.on("error", reject);
  socket.on("open", () =>
    socket.send(
      JSON.stringify({
        type: "auth",
        protocolVersion: PROTOCOL_VERSION,
        ...session,
        code: undefined,
      }),
    ),
  );
  socket.on("message", (raw) => {
    const message = serverMessageSchema.parse(JSON.parse(raw.toString()));
    if (message.type === "authenticated") {
      socket.send(
        JSON.stringify({ type: "ping", clientTime: performance.now() }),
      );
      socket.send(
        JSON.stringify({
          commandId: crypto.randomUUID(),
          connectionEpoch: session.connectionEpoch,
          matchId: message.snapshot.matchId,
          expectedPhaseVersion: message.snapshot.phaseVersion,
          command: { type: "leave" },
        }),
      );
    }
    if (message.type === "pong") {
      clearTimeout(timeout);
      socket.close();
      resolve();
    }
  });
});
console.log(
  JSON.stringify({
    http: true,
    health: true,
    authenticatedWss: true,
    protocol: PROTOCOL_VERSION,
  }),
);
