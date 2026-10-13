import { canSpeak, type Player, type Snapshot } from "../../shared/domain";

export function turnStatus(state: Snapshot, playerId?: string) {
  const turn = state.turn;
  if (!turn) return "";
  if (turn.sealing) return "Bonk is scoring…";
  if (turn.pausedReason === "judge") return "Bonk has the floor";
  if (turn.pausedReason) return "Clock paused";
  const speaker = state.players.find((p) => p.id === turn.playerId);
  return `${turn.playerId === playerId ? "Your" : (speaker?.name || "Your friend") + "’s"} ${turn.kind}`;
}

export function playerStatus(
  state: Snapshot,
  player: Player | undefined,
  local: boolean,
  micMuted: boolean,
) {
  if (!player) return "Waiting for a friend";
  if (!player.connected) return "Reconnecting";
  if (state.phase === "LOBBY")
    return player.ready
      ? "Ready"
      : player.mediaReady
        ? "Connected"
        : "Checking devices";
  if (state.phase === "TOPIC_CONFIRM")
    return state.topic?.confirmations.includes(player.id)
      ? "Confirmed"
      : "Review your side";
  if (state.phase === "TOPIC_SELECT")
    return state.tailsId === player.id
      ? "Choosing the topic"
      : "Opens the case";
  if (state.phase === "INTRO_COIN")
    return state.headsId === player.id ? "Heads · opens" : "Tails · chooses";
  if (state.phase === "RECOVERING") return "On hold";
  if (state.phase === "ABORTED") return "Match ended";
  if (state.phase === "ROUND_RESOLVE" || state.phase === "MATCH_RESULT")
    return state.results.at(-1)?.winnerId === player.id
      ? "Round winner"
      : "Round complete";
  if (canSpeak(state, player.id))
    return local
      ? micMuted
        ? "Your turn · mic off"
        : "Your turn"
      : player.name + "’s turn";
  if (state.judge && state.judge.status !== "silent")
    return "Listening to Bonk";
  if (state.turn?.sealing)
    return state.turn.playerId === player.id
      ? "Scoring your argument"
      : "Waiting for the handoff";
  return "Listening";
}

export function phaseTitle(state: Snapshot) {
  if (state.topic) return state.topic.proposition;
  switch (state.phase) {
    case "LOBBY":
      return "Sound check";
    case "INTRO_COIN":
      return "Who goes first?";
    case "TOPIC_SELECT":
      return "Pick a topic";
    case "RECOVERING":
      return "A brief recess.";
    case "ABORTED":
      return "Match interrupted";
    default:
      return "The court of bad takes.";
  }
}
