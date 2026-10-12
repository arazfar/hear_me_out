import {
  canSpeak,
  SUGGESTIONS,
  type CommandEnvelope,
} from "../../shared/types.js";
import { RuleError } from "../game/game.js";
import { RoomController } from "./room.js";

import type { RoomRegistry } from "./registry.js";
export async function command(
  registry: RoomRegistry,
  room: RoomController,
  id: string,
  data: CommandEnvelope,
) {
  const { game } = room,
    c = data.command,
    seat = room.seats.get(id)!;
  if (data.connectionEpoch !== seat.epoch)
    throw new RuleError("This connection was replaced.");
  if (
    !["media_status", "audio_ready", "leave"].includes(c.type) &&
    (data.matchId !== game.state.matchId ||
      data.expectedPhaseVersion !== game.state.phaseVersion)
  )
    throw new RuleError(
      "The stage moved on. Try again with the current screen.",
    );
  room.lastActiveAt = Date.now();
  if (c.type === "ready") {
    if (c.value && !registry.providersReady())
      throw new RuleError(
        "The server needs OpenAI, Cartesia transcription, and Fish Audio voice keys before a live game.",
      );
    if (
      c.value &&
      [...registry.rooms.values()].some(
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
    room.media.mediaStatus(id, c.ready, c.cameraOn, c.rtc);
  else if (c.type === "propose_topic") {
    if (
      game.state.tailsId !== id ||
      !["TOPIC_SELECT", "TOPIC_CONFIRM"].includes(game.state.phase)
    )
      throw new RuleError("Tails picks the topic.");
    room.topicRequest?.abort();
    const request = (room.topicRequest = new AbortController());
    const matchId = game.state.matchId;
    const version = game.state.phaseVersion;
    const epoch = seat.epoch;
    const suggestion = SUGGESTIONS.find((s) => s.id === c.suggestion);
    const t = suggestion
      ? { safe: true, ...suggestion }
      : await room.services.normalizeTopic(
          c.text,
          c.chosenPosition,
          request.signal,
        );
    if (
      room.closed ||
      request.signal.aborted ||
      room.topicRequest !== request ||
      seat.epoch !== epoch ||
      room.seats.get(id) !== seat ||
      matchId !== game.state.matchId
    )
      throw new RuleError("Topic selection was replaced.");
    room.topicRequest = null;
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
    if (!canSpeak(game.state, id))
      throw new RuleError("Wait for your speaking turn.");
    if (c.lastAudioSeq > seat.audioSeq + 15)
      throw new RuleError("Invalid audio boundary.");
    game.endTurn(id, c.turnId, c.lastAudioSeq);
  } else if (c.type === "audio_ready")
    room.playback.audioReady(id, c.utteranceId, c.speechEpoch);
  else if (c.type === "rematch") game.rematch(id, c.value);
  else if (c.type === "typed_argument")
    room.judging.typed(id, c.turnId, c.text);
  else if (c.type === "leave") {
    if (!["LOBBY", "ABORTED", "MATCH_RESULT"].includes(game.state.phase))
      game.abort("A player left. The unfinished match has no judged winner.");
    for (const ws of seat.sockets.values()) ws.close();
    room.transcription.ink.get(id)?.close();
    room.transcription.ink.delete(id);
    room.seats.delete(id);
    game.removePlayer(id);
    game.emit("player_left");
  }
}
