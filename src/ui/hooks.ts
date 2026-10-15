import { useEffect, useRef, useState } from "react";
import { client } from "../game/client";
import type { Snapshot } from "../../shared/domain";
import type { Command } from "../../shared/protocol";

/** Decisions acknowledge the tap locally; the server still owns their outcome. */
export function useDecision(state: Snapshot) {
  const [pending, setPending] = useState<Command | null>(null);
  const [error, setError] = useState("");
  const request = useRef<{
    id: string;
    command: Command;
    phaseVersion: number;
    matchId: string | null;
    playerId: string;
  } | null>(null);
  useEffect(() => {
    request.current = null;
    setPending(null);
    setError("");
  }, [state.roomId, state.matchId, state.phaseVersion]);
  useEffect(
    () =>
      client.on((update) => {
        const current = request.current;
        if (!current) return;
        const result = update.commandResult;
        const next = update.state;
        const command = current.command;
        const accepted =
          next &&
          (next.phaseVersion !== current.phaseVersion ||
            next.matchId !== current.matchId ||
            (command.type === "ready" &&
              next.players.find((p) => p.id === current.playerId)?.ready ===
                command.value) ||
            (command.type === "rematch" &&
              next.rematchReady.includes(current.playerId) === command.value) ||
            (command.type === "confirm_topic" &&
              next.topic?.revision === command.topicRevision &&
              next.topic.confirmations.includes(current.playerId)));
        if (result?.commandId === current.id || accepted || update.connection) {
          request.current = null;
          setPending(null);
          if (result?.commandId === current.id && !result.ok)
            setError(result.error || "That didn’t go through. Try again.");
        }
      }),
    [],
  );
  const submit = (command: Command) => {
    if (request.current) return;
    setError("");
    const id = client.command(command, { inlineError: true });
    if (!id || !client.session) {
      setError("Couldn’t send that. Check your connection and try again.");
      return;
    }
    request.current = {
      id,
      command,
      phaseVersion: state.phaseVersion,
      matchId: state.matchId,
      playerId: client.session.playerId,
    };
    setPending(command);
  };
  return { pending, error, submit };
}

export function useMediaVersion() {
  const [version, setVersion] = useState(0);
  useEffect(
    () =>
      client.on((u) => {
        if (u.media || u.connection) setVersion((v) => v + 1);
      }),
    [],
  );
  return version;
}
export function useServerNow() {
  const [now, setNow] = useState(() => client.serverNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(client.serverNow()), 100);
    return () => clearInterval(timer);
  }, []);
  return now;
}
export function useReducedMotion() {
  const [override, setOverride] = useState<boolean | null>(null);
  const [system, setSystem] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystem(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return [override ?? system, setOverride] as const;
}
