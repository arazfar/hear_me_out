import { WebSocket, WebSocketServer } from "ws";
import { decodeVideo } from "../shared/media.js";
import {
  authSchema,
  auxiliarySchema,
  commandEnvelopeSchema,
  PROTOCOL_VERSION,
} from "../shared/protocol.js";
import { Controller } from "./controller.js";
import { RuleError } from "./game.js";
import { acceptUpgrade } from "./transport/upgrade.js";

import type { Server } from "node:http";
import { command } from "./commands.js";
import type { RoomRegistry } from "./registry.js";
export function registerSockets(server: Server, registry: RoomRegistry) {
  const { authenticate, rate } = registry;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 131072,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    if (
      wss.clients.size >= 128 ||
      !rate(`upgrade:${req.socket.remoteAddress}`, 60, 60000) ||
      !acceptUpgrade(req.url, req.headers.host, req.headers.origin)
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  wss.on("connection", (ws: WebSocket, req) => {
    const channel = new URL(req.url || "", "http://localhost").pathname
      .split("/")
      .at(-1)!;
    let room: Controller | null = null,
      id = "",
      epoch = 0,
      alive = true,
      videoAt = 0,
      videoSeq = -1,
      videoEpoch = -1;
    const timeout = setTimeout(
      () => ws.close(4003, "Authentication required"),
      5000,
    );
    ws.on("pong", () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 15000);
    ws.on("message", async (raw, binary) => {
      try {
        const bytes = Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw as ArrayBuffer);
        if (!room) {
          if (binary) throw new RuleError("Authenticate first.");
          if (bytes.length > 2048) {
            ws.close(4003, "Invalid authentication");
            return;
          }
          const input = JSON.parse(bytes.toString());
          if (input.protocolVersion !== PROTOCOL_VERSION) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: "The game was updated. Refresh this page to continue.",
              }),
            );
            ws.close(4406, "Refresh required");
            return;
          }
          const auth = authSchema.parse(input);
          const result = authenticate(auth.roomId, auth.playerId, auth.token);
          if (result.seat.epoch !== auth.connectionEpoch)
            throw new RuleError("This seat connection expired.");
          room = result.room;
          id = auth.playerId;
          epoch = auth.connectionEpoch;
          result.seat.sockets.get(channel)?.close(4001, "Channel replaced");
          result.seat.sockets.set(channel, ws);
          clearTimeout(timeout);
          room.game.connectPlayer(id);
          if (channel === "control")
            ws.send(
              JSON.stringify({
                type: "authenticated",
                snapshot: room.game.snapshot(),
              }),
            );
          if (channel === "audio")
            room.transcription.rotate(
              id,
              room.game.state.turn?.playerId === id &&
                !room.game.state.turn.sealing
                ? room.game.state.turn.id
                : null,
            );
          return;
        }
        const seat = room.seats.get(id);
        if (!seat || seat.epoch !== epoch || seat.sockets.get(channel) !== ws) {
          ws.close(4001);
          return;
        }
        if (binary) {
          if (channel === "audio" && rate(`audio:${id}`, 100, 1000))
            room.media.audio(id, bytes);
          else if (channel === "video" && room.game.state.mediaMode !== "rtc") {
            const frame = decodeVideo(bytes);
            if (videoEpoch !== room.game.state.mediaEpoch) {
              videoEpoch = room.game.state.mediaEpoch;
              videoSeq = -1;
            }
            if (
              frame &&
              frame.epoch === videoEpoch &&
              frame.seq > videoSeq &&
              Date.now() - videoAt > 40
            ) {
              videoSeq = frame.seq;
              videoAt = Date.now();
              room.media.forward(id, "video", bytes);
            }
          }
          return;
        }
        if (channel !== "control") return;
        if (bytes.length > 64000)
          throw new RuleError("Control message too large.");
        const input = JSON.parse(bytes.toString());
        const auxiliary = auxiliarySchema.safeParse(input);
        if (auxiliary.success) {
          const data = auxiliary.data;
          const limits = {
            ping: 4,
            snapshot_request: 2,
            signal: 30,
            video_ack: 30,
            playback_metric: 5,
          };
          if (!rate(`${data.type}:${id}`, limits[data.type], 1000))
            throw new RuleError("Control rate exceeded.");
          if (data.type === "video_ack") {
            if (
              data.mediaEpoch === room.game.state.mediaEpoch &&
              Number.isInteger(data.seq) &&
              data.seq >= 0 &&
              rate(`videoack:${id}`, 30, 1000)
            )
              room.send(room.game.other(id)?.id, {
                type: "video_ack",
                seq: data.seq,
                mediaEpoch: data.mediaEpoch,
              });
            return;
          }
          if (data.type === "ping") {
            ws.send(
              JSON.stringify({
                type: "pong",
                clientTime: data.clientTime,
                serverNow: Date.now(),
              }),
            );
            return;
          }
          if (data.type === "snapshot_request") {
            ws.send(
              JSON.stringify({
                type: "snapshot",
                snapshot: room.game.snapshot(),
              }),
            );
            return;
          }
          if (data.type === "signal") {
            if (
              data.mediaEpoch !== room.game.state.mediaEpoch ||
              bytes.length > 64000
            )
              return;
            room.send(room.game.other(id)?.id, {
              type: "signal",
              from: id,
              mediaEpoch: data.mediaEpoch,
              description: data.description,
              candidate: data.candidate,
            });
            return;
          }
          if (data.type === "playback_metric") {
            if (
              typeof data.latencyMs === "number" &&
              data.latencyMs >= 0 &&
              data.latencyMs < 30000
            )
              room.recordMetric("playbackMs", data.latencyMs);
            return;
          }
          return;
        }
        const envelope = commandEnvelopeSchema.parse(input);
        if (seat.acks.has(envelope.commandId)) {
          ws.send(JSON.stringify(seat.acks.get(envelope.commandId)));
          return;
        }
        if (!rate(`control:${id}`, 10, 1000))
          throw new RuleError("Slow down a little.");
        const pending = {
          type: "ack",
          commandId: envelope.commandId,
          pending: true,
        };
        seat.acks.set(envelope.commandId, pending);
        try {
          await command(registry, room, id, envelope);
          const ack = { type: "ack", commandId: envelope.commandId, ok: true };
          seat.acks.set(envelope.commandId, ack);
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ack));
        } catch (e) {
          const ack = {
            type: "ack",
            commandId: envelope.commandId,
            ok: false,
            error:
              e instanceof RuleError
                ? e.message
                : "The request could not complete. Try again.",
          };
          seat.acks.set(envelope.commandId, ack);
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ack));
        }
        if (seat.acks.size > 200)
          seat.acks.delete(seat.acks.keys().next().value!);
      } catch {
        if (!room) {
          ws.close(4003, "Invalid authentication");
          return;
        }
        if (ws.readyState === WebSocket.OPEN)
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Invalid or expired connection message.",
            }),
          );
      }
    });
    ws.on("close", () => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      if (!room || !room.seats.has(id)) return;
      const seat = room.seats.get(id)!;
      if (seat.epoch !== epoch || seat.sockets.get(channel) !== ws) return;
      seat.sockets.delete(channel);
      if (channel === "control" || channel === "audio") room.disconnect(id);
    });
    ws.on("error", () => {});
  });

  return wss;
}
