import { judgeIsListening, SUGGESTIONS } from "../../shared/domain.js";
import { type CommandEnvelope } from "../../shared/protocol.js";
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
  if (c.type === "done" && data.matchId === game.state.matchId) {
    const previous = game.turns.get(c.turnId)?.turn;
    // Deadline and Done may cross on independent control/audio sockets.
    if (previous?.playerId === id && previous.sealing) return;
  }
  if (
    ![
      "media_status",
      "setup_start",
      "setup_cancel",
      "audio_ready",
      "audio_playback",
      "leave",
    ].includes(c.type) &&
    (data.matchId !== game.state.matchId ||
      data.expectedPhaseVersion !== game.state.phaseVersion)
  )
    throw new RuleError(
      "The stage moved on. Try again with the current screen.",
    );
  room.lastActiveAt = Date.now();
  if (c.type === "ready" || (c.type === "rematch" && c.value))
    room.readiness.tick();
  if (c.type === "ready" || c.type === "rematch") {
    const denied =
      (c.type === "ready" || c.value) && registry.matchAdmissionError(room);
    if (denied) throw new RuleError(denied);
    if (c.type === "ready") game.ready(id);
    else game.rematch(id, c.value);
  } else if (c.type === "media_status") room.media.mediaStatus(id, c);
  else if (c.type === "setup_start")
    room.readiness.start(id, c.checkId, c.captureId);
  else if (c.type === "setup_cancel") room.readiness.cancel(id, c.checkId);
  else if (c.type === "propose_topic") {
    if (
      game.state.tailsId !== id ||
      !["TOPIC_SELECT", "TOPIC_CONFIRM"].includes(game.state.phase)
    )
      throw new RuleError("Tails picks the topic.");
    const suggestion = SUGGESTIONS.find((s) => s.id === c.suggestion);
    if (!suggestion) throw new RuleError("Choose one of the available topics.");
    game.proposeTopic(
      id,
      suggestion.proposition,
      suggestion.positive,
      suggestion.negative,
      c.chosenPosition === "positive",
    );
  } else if (c.type === "confirm_topic") game.confirm(id, c.topicRevision);
  else if (c.type === "reject_topic") game.reject(id, c.topicRevision);
  else if (c.type === "done") {
    if (!judgeIsListening(game.state, id))
      throw new RuleError("Wait for your speaking turn.");
    if (
      c.lastAudioSeq < 0 ||
      c.lastAudioSeq > seat.audioSeq + 4096 ||
      c.lastAudioSeq < seat.audioSeq - 4096
    )
      throw new RuleError("Invalid audio boundary.");
    game.endTurn(id, c.turnId, c.lastAudioSeq);
  } else if (c.type === "audio_ready")
    room.playback.audioReady(id, c.utteranceId, c.speechEpoch, c.rttMs);
  else if (c.type === "audio_playback")
    room.playback.audioPlayback(
      id,
      c.utteranceId,
      c.speechEpoch,
      c.status,
      c.samples,
    );
  else if (c.type === "leave") room.leave(id);
}
