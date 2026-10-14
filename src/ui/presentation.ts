import {
  judgeIsListening,
  type Player,
  type Snapshot,
} from "../../shared/domain";
import type { ReadinessPresentation } from "./readiness";

export type LocalPresentation = {
  finished?: boolean;
  rendering?: boolean;
  pendingDone?: string | null;
  privateCheck?: boolean;
};
/** The same priority order drives the task label, face emphasis and judge pose. */
export function speakingState(
  state: Snapshot,
  playerId?: string,
  local: LocalPresentation = {},
) {
  const turn = state.turn,
    name =
      state.players.find((p) => p.id === turn?.playerId)?.name || "Your friend";
  if (local.privateCheck)
    return {
      kind: "private",
      label: "Private mic check",
      listening: null,
    } as const;
  if (state.phase === "RECOVERING")
    return {
      kind: "recovery",
      label: "A brief recess",
      listening: null,
    } as const;
  if (state.judge?.status === "captions")
    return {
      kind: "captions",
      label: "Bonk · captions only",
      listening: null,
    } as const;
  if (state.judge?.status === "buffering")
    return {
      kind: "buffering",
      label: "Bonk’s getting ready…",
      listening: null,
    } as const;
  if (state.judge?.status === "speaking")
    return {
      kind: "judge",
      label: local.finished
        ? "Finishing Bonk’s line…"
        : local.rendering === false
          ? "Bonk’s getting ready…"
          : "Bonk speaking",
      listening: null,
    } as const;
  if (!turn) return { kind: "social", label: "", listening: null } as const;
  if (turn.sealing || local.pendingDone === turn.id)
    return {
      kind: "settling",
      label: `Finishing ${name}’s turn…`,
      listening: null,
    } as const;
  if (
    turn.pausedReason ||
    turn.inputState === "preparing" ||
    turn.inputState === "granted"
  )
    return {
      kind: "preparing",
      label:
        turn.playerId === playerId ? "Your turn next" : `${name}’s turn next`,
      listening: null,
    } as const;
  return {
    kind: "player",
    label: `${turn.playerId === playerId ? "Your" : name + "’s"} ${turn.kind}`,
    listening: turn.playerId,
  } as const;
}
export function turnStatus(
  state: Snapshot,
  playerId?: string,
  local: LocalPresentation = {},
) {
  return speakingState(state, playerId, local).label;
}

export function playerStatus(
  state: Snapshot,
  player: Player | undefined,
  local: boolean,
  micMuted: boolean,
) {
  if (!player?.connected) return "";
  if (state.phase === "LOBBY") return player.ready ? "Ready" : "";
  if (state.phase === "TOPIC_CONFIRM")
    return state.topic?.confirmations.includes(player.id) ? "Confirmed" : "";
  if (state.phase === "MATCH_RESULT" || state.phase === "ABORTED")
    return state.rematchReady.includes(player.id) ? "Ready" : "";
  if (judgeIsListening(state, player.id))
    return local
      ? micMuted
        ? "Your turn · mic off"
        : "Bonk is listening"
      : "Bonk is listening";
  return "";
}

export function topicPresentation(state: Snapshot, playerId?: string) {
  const other = state.players.find((p) => p.id !== playerId);
  const name = other?.name || "your friend";
  const choosing = !!playerId && state.tailsId === playerId;
  const confirmed =
    !!playerId && !!state.topic?.confirmations.includes(playerId);
  const otherConfirmed =
    !!other && !!state.topic?.confirmations.includes(other.id);
  const waiting =
    confirmed && !otherConfirmed ? `Waiting for ${name} to confirm.` : "";
  const chooser =
    state.players.find((p) => p.id === state.tailsId)?.name || "Your friend";
  return {
    choosing,
    confirmed,
    waiting,
    selectionLabel: choosing ? "Choose a topic" : `${chooser} is choosing.`,
    announcement: confirmed
      ? otherConfirmed
        ? "Both sides confirmed."
        : `Confirmed. ${waiting}`
      : otherConfirmed
        ? `${other.name} confirmed. Confirm your side.`
        : "Confirm your side.",
  };
}

export function lobbyPresentation(state: Snapshot, playerId?: string) {
  const me = state.players.find((p) => p.id === playerId);
  const other = state.players.find((p) => p.id !== playerId);
  const name = other?.name || "your friend";
  return {
    actionLabel: me?.ready
      ? "Ready · undo"
      : !other?.connected
        ? "Waiting for your friend"
        : "Ready to argue",
    announcement: !other
      ? "Invite your friend"
      : me?.ready && other.ready
        ? "Both ready."
        : me?.ready
          ? `Ready. Waiting for ${name}.`
          : other.ready
            ? `${name} is ready. Ready to argue.`
            : "Ready to argue",
  };
}

export function rematchPresentation(
  state: Snapshot,
  playerId: string | undefined,
  readiness: ReadinessPresentation,
) {
  const other = state.players.find((p) => p.id !== playerId);
  const name = other?.name || "your friend";
  const ready = !!playerId && state.rematchReady.includes(playerId);
  const otherReady = !!other && state.rematchReady.includes(other.id);
  const queued =
    otherReady || !other?.connected || !other.mediaReady || !!readiness.message;
  return {
    ready,
    actionLabel: ready
      ? queued
        ? "Rematch queued"
        : `Waiting for ${name}`
      : state.phase === "ABORTED"
        ? "Try a fresh match"
        : "Rematch",
    announcement: ready
      ? otherReady
        ? "Both ready. Rematch queued."
        : queued
          ? "Rematch queued."
          : `Ready. Waiting for ${name}.`
      : otherReady
        ? `${name} is ready for a rematch.`
        : state.phase === "ABORTED"
          ? state.status
          : "Match verdict",
  };
}

/** One live region owns decisions and phases; clocks and repeated snapshots add no text. */
export function phaseAnnouncement(
  state: Snapshot,
  playerId: string | undefined,
  readiness: ReadinessPresentation,
  local: LocalPresentation & { reconnecting?: boolean } = {},
) {
  const recovery = readiness.message || readiness.label || "Checking devices…";
  if (local.reconnecting) return recovery;
  if (state.phase === "ROUND")
    return `Round ${state.round}. ${turnStatus(state, playerId, local)}`;
  if (state.phase === "ABORTED" && state.players.length < 2)
    return state.status;
  const other = state.players.find((p) => p.id !== playerId);
  if (state.phase === "MATCH_RESULT" && !other?.connected)
    return "Match complete. Your friend isn’t here.";
  if (
    state.phase === "RECOVERING" ||
    (["LOBBY", "MATCH_RESULT", "ABORTED"].includes(state.phase) &&
      state.players.some((p) => !p.mediaReady))
  )
    return recovery;
  switch (state.phase) {
    case "LOBBY":
      return lobbyPresentation(state, playerId).announcement;
    case "TOPIC_SELECT":
      return topicPresentation(state, playerId).selectionLabel;
    case "TOPIC_CONFIRM":
      return topicPresentation(state, playerId).announcement;
    case "INTRO_COIN":
      return "The coin has spoken";
    case "ROUND_RESOLVE":
      return "Round verdict";
    case "MATCH_RESULT":
    case "ABORTED":
      return rematchPresentation(state, playerId, readiness).announcement;
    default:
      return state.status;
  }
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
