import express from "express";
import { iceConfiguration } from "./ice.js";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { PROTOCOL_VERSION } from "../../shared/protocol.js";
import { RuleError } from "../game/game.js";

import type { RoomRegistry } from "../rooms/registry.js";
import type { Seat } from "../rooms/room.js";

function ownsResume(seat: Seat, epoch: number, id?: string) {
  return (
    !!id &&
    seat.resume?.id === id &&
    seat.resume.fromEpoch === epoch &&
    seat.resume.toEpoch === seat.epoch
  );
}
export function registerHttp(app: express.Express, registry: RoomRegistry) {
  const { rooms, byId, rate, name, session, authenticate } = registry;
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
        sttConnections: [...r.transcription.ink.values()].filter(
          (s) => s.connected,
        ).length,
      })),
    }),
  );
  app.post("/api/ice", (req, res) => {
    try {
      const { roomId, playerId, token, connectionEpoch } = req.body;
      const { seat } = authenticate(roomId, playerId, token);
      if (seat.epoch !== connectionEpoch || !rate(`ice:${playerId}`, 12, 60000))
        throw new RuleError("ICE request expired.");
      res.setHeader("Cache-Control", "no-store");
      res.json(iceConfiguration(`${roomId}:${playerId}:${connectionEpoch}`));
    } catch {
      res.status(401).json({ error: "This seat is no longer active." });
    }
  });
  app.post("/api/diagnostics", (req, res) => {
    try {
      const { roomId, playerId, token, connectionEpoch } = req.body;
      const { room, seat } = authenticate(roomId, playerId, token);
      if (
        seat.epoch !== connectionEpoch ||
        !rate(`diagnostics:${playerId}`, 12, 60000)
      )
        throw new RuleError("Diagnostic request expired.");
      res.setHeader("Cache-Control", "no-store");
      res.json({
        protocolVersion: PROTOCOL_VERSION,
        metrics: room.metrics,
        timeline: room.timeline,
      });
    } catch {
      res.status(401).json({ error: "This seat is no longer active." });
    }
  });
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
      const room = registry.createRoom(code);
      rooms.set(code, room);
      byId.set(room.game.state.roomId, room);
      const s = session(room, playerName);
      res.json({
        protocolVersion: PROTOCOL_VERSION,
        session: s,
        snapshot: room.game.snapshot(),
      });
    } catch (e) {
      res.status(400).json({
        error:
          e instanceof RuleError ? e.message : "Enter a display name first.",
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
      res.json({
        protocolVersion: PROTOCOL_VERSION,
        session: s,
        snapshot: room.game.snapshot(),
      });
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
      if (!rate(`resume:${req.ip}`, 30, 60000)) {
        res
          .status(429)
          .json({ error: "Reconnect limit reached. Try again shortly." });
        return;
      }
      const { roomId, playerId, token, connectionEpoch, resumeId } = z
        .object({
          roomId: z.string(),
          playerId: z.string(),
          token: z.string(),
          connectionEpoch: z.number().int().positive(),
          resumeId: z.uuid().optional(),
        })
        .parse(req.body);
      const { room, seat } = authenticate(roomId, playerId, token);
      const retry = ownsResume(seat, connectionEpoch, resumeId);
      if (
        !retry &&
        (connectionEpoch !== seat.epoch ||
          (resumeId && seat.resume?.id === resumeId))
      ) {
        res.status(409).json({
          error: "This seat was reconnected elsewhere. Join a new court.",
        });
        return;
      }
      // Only the owner can retry or cancel an accepted, unanswered transition.
      if (!retry) {
        seat.epoch++;
        seat.resume = resumeId
          ? { id: resumeId, fromEpoch: connectionEpoch, toEpoch: seat.epoch }
          : undefined;
        for (const ws of seat.sockets.values()) ws.close(4001, "Seat resumed");
        seat.sockets.clear();
        seat.audioSeq = -1;
        room.game.resumePlayer(playerId);
        for (const s of room.seats.values()) s.rtcReady = false;
        room.game.emit("player_resumed");
      }
      room.lastActiveAt = Date.now();
      res.json({
        protocolVersion: PROTOCOL_VERSION,
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
  app.post("/api/leave", (req, res) => {
    try {
      const { roomId, playerId, token, connectionEpoch, resumeId } = z
        .object({
          roomId: z.string(),
          playerId: z.string(),
          token: z.string(),
          connectionEpoch: z.number().int(),
          resumeId: z.uuid().optional(),
        })
        .parse(req.body);
      const { room, seat } = authenticate(roomId, playerId, token);
      if (
        seat.epoch !== connectionEpoch &&
        !ownsResume(seat, connectionEpoch, resumeId)
      )
        throw new RuleError("This connection was replaced.");
      room.leave(playerId);
      res.json({ ok: true });
    } catch {
      res.status(401).json({ error: "This seat is no longer active." });
    }
  });
}
