import { canSpeak } from "../shared/types.js";
import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { Controller } from "./controller.js";
import { normalizeTopic } from "./providers.js";
import { RuleError } from "./game.js";
import { SUGGESTIONS, type CommandEnvelope } from "../shared/types.js";

const app = express(),
  server = createServer(app);
const rooms = new Map<string, Controller>(),
  byId = new Map<string, Controller>();
const buckets = new Map<string, { count: number; expires: number }>();
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
app.set("trust proxy", "loopback");
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self)");
  next();
});
function rate(key: string, limit: number, windowMs: number) {
  const now = Date.now(),
    b = buckets.get(key);
  if (!b || b.expires <= now) {
    buckets.set(key, { count: 1, expires: now + windowMs });
    return true;
  }
  return ++b.count <= limit;
}
function name(text: unknown) {
  const s = z
    .string()
    .min(1)
    .max(40)
    .parse(text)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s.'_-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
  if (!s || /\b(nazi|hitler|nigger|faggot)\b/i.test(s))
    throw new RuleError("Choose a friendly display name.");
  return s;
}
function session(room: Controller, playerName: string) {
  const p = room.game.addPlayer(playerName),
    token = randomBytes(32).toString("base64url");
  room.seats.set(p.id, {
    tokenHash: hash(token),
    epoch: 1,
    sockets: new Map(),
    audioSeq: -1,
    lastAudioAt: 0,
    voiceAt: 0,
    lastActivity: 0,
    rtcReady: false,
    acks: new Map(),
  });
  return {
    roomId: room.game.state.roomId,
    playerId: p.id,
    token,
    connectionEpoch: 1,
    code: room.game.state.code,
  };
}
const authenticate = (roomId: string, playerId: string, token: string) => {
  const room = byId.get(roomId),
    seat = room?.seats.get(playerId);
  if (!room || !seat || hash(token) !== seat.tokenHash)
    throw new RuleError("Your seat expired. Join a new room.");
  return { room, seat };
};
app.get("/healthz", (_req, res) =>
  res.json({
    ok: true,
    providers: {
      openai: !!process.env.OPENAI_API_KEY,
      cartesia: !!process.env.CARTESIA_API_KEY,
      fish: !!process.env.FISH_AUDIO_API_KEY,
    },
    model: process.env.JUDGE_MODEL || "gpt-6-luna",
    forceWss: process.env.FORCE_WSS === "true",
    recordings: false,
    rooms: [...rooms.values()].map((r) => ({
      phase: r.game.state.phase,
      players: r.game.state.players.length,
      media: r.game.state.mediaMode,
      sttConnections: [...r.ink.values()].filter((s) => s.connected).length,
    })),
  }),
);
app.post("/api/rooms", (req, res) => {
  try {
    if (!rate(`create:${req.ip}`, 3, 60000)) {
      res
        .status(429)
        .json({ error: "Too many courts opened. Try again in a minute." });
      return;
    }
    if (rooms.size >= 20)
      throw new RuleError("The courts are full. Try again shortly.");
    const playerName = name(req.body.name);
    let code = "";
    for (let i = 0; i < 20; i++) {
      const candidate = randomInt(10000).toString().padStart(4, "0");
      if (!rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new RuleError("No room codes available. Try again.");
    const room = new Controller(code);
    rooms.set(code, room);
    byId.set(room.game.state.roomId, room);
    const s = session(room, playerName);
    res.json({ session: s, snapshot: room.game.snapshot() });
  } catch (e) {
    res.status(400).json({
      error: e instanceof RuleError ? e.message : "Enter a display name first.",
    });
  }
});
app.post("/api/join", (req, res) => {
  try {
    if (!rate(`join:${req.ip}`, 5, 60000)) {
      res
        .status(429)
        .json({ error: "Too many join attempts. Try again in a minute." });
      return;
    }
    const code = z
        .string()
        .regex(/^\d{4}$/)
        .parse(req.body.code),
      room = rooms.get(code);
    if (!room)
      throw new RuleError("That court is closed or the code is incorrect.");
    const s = session(room, name(req.body.name));
    res.json({ session: s, snapshot: room.game.snapshot() });
  } catch (e) {
    res.status(400).json({
      error:
        e instanceof RuleError
          ? e.message
          : "Use a four-digit code and a display name.",
    });
  }
});
app.post("/api/resume", (req, res) => {
  try {
    const { roomId, playerId, token } = z
      .object({ roomId: z.string(), playerId: z.string(), token: z.string() })
      .parse(req.body);
    const { room, seat } = authenticate(roomId, playerId, token);
    seat.epoch++;
    for (const ws of seat.sockets.values()) ws.close(4001, "Seat resumed");
    seat.sockets.clear();
    seat.audioSeq = -1;
    const player = room.game.player(playerId);
    player.connected = true;
    player.captureReady = false;
    player.mediaReady = false;
    if (room.game.state.phase === "LOBBY") player.ready = false;
    room.lastActiveAt = Date.now();
    room.game.state.mediaEpoch++;
    room.game.state.mediaMode = "connecting";
    for (const s of room.seats.values()) s.rtcReady = false;
    room.game.emit("player_resumed");
    res.json({
      session: {
        roomId,
        playerId,
        token,
        connectionEpoch: seat.epoch,
        code: room.game.state.code,
      },
      snapshot: room.game.snapshot(),
    });
  } catch {
    res.status(401).json({ error: "Your seat expired. Join a new court." });
  }
});
const commandSchema = z
  .object({
    commandId: z.string().max(80),
    connectionEpoch: z.number().int(),
    matchId: z.string().nullable(),
    expectedPhaseVersion: z.number().int(),
    command: z.discriminatedUnion("type", [
      z.object({ type: z.literal("ready"), value: z.boolean() }).strict(),
      z
        .object({
          type: z.literal("media_status"),
          ready: z.boolean(),
          cameraOn: z.boolean(),
          rtc: z.boolean(),
        })
        .strict(),
      z
        .object({
          type: z.literal("propose_topic"),
          text: z.string().min(1).max(160),
          chosenPosition: z.string().max(100),
          suggestion: z.string().optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("confirm_topic"),
          topicRevision: z.number().int(),
        })
        .strict(),
      z
        .object({
          type: z.literal("reject_topic"),
          topicRevision: z.number().int(),
        })
        .strict(),
      z
        .object({
          type: z.literal("done"),
          turnId: z.string(),
          lastAudioSeq: z.number().int(),
        })
        .strict(),
      z
        .object({
          type: z.literal("barge_in"),
          utteranceId: z.string(),
          speechEpoch: z.number().int(),
        })
        .strict(),
      z
        .object({
          type: z.literal("audio_ready"),
          utteranceId: z.string(),
          speechEpoch: z.number().int(),
        })
        .strict(),
      z.object({ type: z.literal("rematch"), value: z.boolean() }).strict(),
      z
        .object({
          type: z.literal("typed_argument"),
          turnId: z.string(),
          text: z.string().min(1).max(1000),
        })
        .strict(),
      z.object({ type: z.literal("leave") }).strict(),
    ]),
  })
  .strict();
async function command(room: Controller, id: string, data: CommandEnvelope) {
  const { game } = room,
    c = data.command,
    seat = room.seats.get(id)!;
  if (data.connectionEpoch !== seat.epoch)
    throw new RuleError("This connection was replaced.");
  if (
    !["media_status", "audio_ready", "barge_in", "leave"].includes(c.type) &&
    (data.matchId !== game.state.matchId ||
      data.expectedPhaseVersion !== game.state.phaseVersion)
  )
    throw new RuleError(
      "The stage moved on. Try again with the current screen.",
    );
  room.lastActiveAt = Date.now();
  if (c.type === "ready") {
    if (
      c.value &&
      (!process.env.OPENAI_API_KEY ||
        !process.env.CARTESIA_API_KEY ||
        !process.env.FISH_AUDIO_API_KEY)
    )
      throw new RuleError(
        "The server needs OpenAI, Cartesia transcription, and Fish Audio voice keys before a live game.",
      );
    if (
      c.value &&
      [...rooms.values()].some(
        (r) =>
          r !== room &&
          !["LOBBY", "MATCH_RESULT", "ABORTED"].includes(r.game.state.phase),
      )
    )
      throw new RuleError(
        "The demo stage is occupied. Try again after that match.",
      );
    game.ready(id, c.value);
  } else if (c.type === "media_status")
    room.mediaStatus(id, c.ready, c.cameraOn, c.rtc);
  else if (c.type === "propose_topic") {
    if (
      game.state.tailsId !== id ||
      !["TOPIC_SELECT", "TOPIC_CONFIRM"].includes(game.state.phase)
    )
      throw new RuleError("Tails picks the topic.");
    const version = game.state.phaseVersion;
    const suggestion = SUGGESTIONS.find((s) => s.id === c.suggestion);
    const t = suggestion
      ? { safe: true, ...suggestion }
      : await normalizeTopic(c.text, c.chosenPosition);
    if (!t.safe)
      throw new RuleError(
        "Pick a harmless disagreement, not a targeted attack.",
      );
    if (version !== game.state.phaseVersion)
      throw new RuleError("Topic selection expired.");
    game.proposeTopic(
      id,
      t.proposition,
      t.positive,
      t.negative,
      c.chosenPosition !== "negative",
    );
  } else if (c.type === "confirm_topic") game.confirm(id, c.topicRevision);
  else if (c.type === "reject_topic") game.reject(id, c.topicRevision);
  else if (c.type === "done") {
    if (!canSpeak(game.state, id)) throw new RuleError("Wait for your speaking turn.");
    if (c.lastAudioSeq > seat.audioSeq + 15)
      throw new RuleError("Invalid audio boundary.");
    game.endTurn(id, c.turnId, c.lastAudioSeq);
  } else if (c.type === "audio_ready")
    room.audioReady(id, c.utteranceId, c.speechEpoch);
  else if (c.type === "barge_in") {
    if (
      canSpeak(game.state, id) &&
      room.speech?.id === c.utteranceId &&
      room.speech.epoch === c.speechEpoch &&
      Date.now() - seat.voiceAt < 500
    )
      room.cancelSpeech();
  } else if (c.type === "rematch") game.rematch(id, c.value);
  else if (c.type === "typed_argument") room.typed(id, c.turnId, c.text);
  else if (c.type === "leave") {
    if (!["LOBBY", "ABORTED", "MATCH_RESULT"].includes(game.state.phase))
      game.abort("A player left. The unfinished match has no judged winner.");
    for (const ws of seat.sockets.values()) ws.close();
    room.ink.get(id)?.close();
    room.ink.delete(id);
    room.seats.delete(id);
    game.state.players = game.state.players.filter((p) => p.id !== id);
    game.state.mediaMode = "connecting";
    game.emit("player_left");
  }
}
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 131072,
  perMessageDeflate: false,
});
server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url || "", "http://localhost").pathname;
  if (!["/socket/control", "/socket/audio", "/socket/video"].includes(path)) {
    socket.destroy();
    return;
  }
  const host = req.headers.host,
    origin = req.headers.origin;
  if (origin && new URL(origin).host !== host) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
wss.on("connection", (ws: WebSocket, req) => {
  const channel = new URL(req.url || "", "http://localhost").pathname
    .split("/")
    .at(-1)!;
  let room: Controller | null = null,
    id = "",
    epoch = 0,
    alive = true,
    videoAt = 0;
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
        const auth = z
          .object({
            type: z.literal("auth"),
            roomId: z.string(),
            playerId: z.string(),
            token: z.string(),
            connectionEpoch: z.number().int(),
          })
          .parse(JSON.parse(bytes.toString()));
        const result = authenticate(auth.roomId, auth.playerId, auth.token);
        if (result.seat.epoch !== auth.connectionEpoch)
          throw new RuleError("This seat connection expired.");
        room = result.room;
        id = auth.playerId;
        epoch = auth.connectionEpoch;
        result.seat.sockets.get(channel)?.close(4001, "Channel replaced");
        result.seat.sockets.set(channel, ws);
        clearTimeout(timeout);
        room.game.player(id).connected = true;
        if (channel === "control")
          ws.send(
            JSON.stringify({
              type: "authenticated",
              snapshot: room.game.snapshot(),
            }),
          );
        if (channel === "audio")
          room.rotate(
            id,
            room.game.state.turn?.playerId === id &&
              !room.game.state.turn.sealing
              ? room.game.state.turn.id
              : null,
          );
        return;
      }
      const seat = room.seats.get(id);
      if (!seat || seat.epoch !== epoch) {
        ws.close(4001);
        return;
      }
      if (binary) {
        if (channel === "audio") room.audio(id, bytes);
        else if (
          channel === "video" &&
          room.game.state.mediaMode !== "rtc" &&
          bytes.length > 9 &&
          bytes[0] === 3 &&
          bytes.readUInt32LE(1) === room.game.state.mediaEpoch &&
          Date.now() - videoAt > 40
        ) {
          videoAt = Date.now();
          room.forward(id, "video", bytes);
        }
        return;
      }
      if (channel !== "control") return;
      const data = JSON.parse(bytes.toString());
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
          JSON.stringify({ type: "snapshot", snapshot: room.game.snapshot() }),
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
          room.metrics.playbackMs.push(data.latencyMs);
        return;
      }
      const envelope = commandSchema.parse(data);
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
        await command(room, id, envelope);
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
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(dist, "index.html")));
} else
  app.get("/", (_req, res) =>
    res
      .type("text")
      .send(
        "Hear Me Out server is ready. Run pnpm dev for the app, or pnpm build && pnpm start.",
      ),
  );
const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () =>
  console.log(
    `Hear Me Out listening on :${port}; provider keys ${process.env.OPENAI_API_KEY && process.env.CARTESIA_API_KEY && process.env.FISH_AUDIO_API_KEY ? "configured" : "missing"}. Recordings off.`,
  ),
);
function shutdown() {
  clearInterval(ticking);
  clearInterval(pruning);
  for (const room of rooms.values()) room.close();
  server.close();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
