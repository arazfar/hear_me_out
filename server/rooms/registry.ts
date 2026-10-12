import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { RuleError } from "../game/game.js";
import { RoomController } from "./room.js";

import type { RoomServices } from "./services.js";
export function createRegistry(
  services: Partial<RoomServices> = {},
  providersReady = () =>
    !!(
      process.env.OPENAI_API_KEY &&
      process.env.CARTESIA_API_KEY &&
      process.env.FISH_AUDIO_API_KEY
    ),
) {
  const rooms = new Map<string, RoomController>(),
    byId = new Map<string, RoomController>();
  const buckets = new Map<string, { count: number; expires: number }>();
  const hash = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  function rate(key: string, limit: number, windowMs: number) {
    if (buckets.size > 5000 && !buckets.has(key)) return false;
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
  function session(room: RoomController, playerName: string) {
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

  return {
    rooms,
    byId,
    buckets,
    rate,
    name,
    session,
    authenticate,
    providersReady,
    createRoom: (code: string) => new RoomController(code, services),
  };
}
export type RoomRegistry = ReturnType<typeof createRegistry>;
