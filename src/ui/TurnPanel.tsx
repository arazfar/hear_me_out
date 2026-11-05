import { useEffect, useRef, useState } from "react";
import { judgeIsListening, type Snapshot } from "../../shared/domain";
import { client } from "../game/client";
import { Icon } from "./Icon";
import { useMediaVersion, useServerNow } from "./hooks";
import { speakingState } from "./presentation";

export function TurnPanel({
  state,
  playerId,
}: {
  state: Snapshot;
  playerId?: string;
}) {
  const now = useServerNow();
  const [handoff, setHandoff] = useState("");
  useEffect(
    () =>
      client.on((u) => {
        if (u.feedbackReset) setHandoff("");
        if (u.feedback?.kind === "turn") setHandoff(u.feedback.id);
      }),
    [],
  );
  useMediaVersion();
  const turn = state.turn;
  if (!turn) return null;
  const mine = turn.playerId === playerId;
  const pending = client.capture.pendingDone === turn.id;
  const paused = !!turn.pausedReason || turn.sealing || pending;
  const seconds = Math.max(
    0,
    Math.ceil(
      (turn.deadline
        ? turn.deadline - (pending ? client.capture.doneAt : now)
        : turn.remainingMs) / 1000,
    ),
  );
  const presentation = speakingState(state, playerId, {
    pendingDone: client.capture.pendingDone,
    finished: client.playback.finished,
    rendering: client.playback.rendering,
    privateCheck: client.capture.privateCheck(),
  });
  const listening = !pending && judgeIsListening(state, playerId || null);
  return (
    <section
      className={
        "turn-panel " +
        (turn.sealing || pending ? "is-settling " : "") +
        (seconds <= 5 && !paused ? "time-low" : "")
      }
      style={
        {
          "--turn-color":
            state.players[0]?.id === turn.playerId
              ? "var(--pink)"
              : "var(--cyan)",
        } as React.CSSProperties
      }
      aria-label="Current turn"
    >
      <div
        className="turn-context"
        tabIndex={0}
        role="region"
        aria-label="Turn status"
      >
        <div
          key={handoff}
          className={
            "turn-label " +
            (presentation.kind === "player" ? "sr-only " : "") +
            (handoff ? "handoff" : "")
          }
        >
          {presentation.kind !== "player" && (
            <Icon
              name={
                presentation.kind === "judge" && client.playback.rendering
                  ? "volume"
                  : "clock"
              }
            />
          )}
          {presentation.label}
        </div>
        <TurnTimer
          turnId={turn.id}
          seconds={seconds}
          duration={turn.durationMs}
          paused={paused}
          settling={turn.sealing || pending}
        />
        {mine && client.capture.micMuted && !paused && (
          <p className="turn-guidance">Your mic is off.</p>
        )}
      </div>
      {mine && listening && (
        <div className="turn-action">
          <button
            className="primary yield-button"
            onClick={() => client.capture.finishTurn()}
          >
            I’m done
            {!pending && <Icon name="check" />}
          </button>
        </div>
      )}
    </section>
  );
}

function TurnTimer({
  turnId,
  seconds,
  duration,
  paused,
  settling,
}: {
  turnId: string;
  seconds: number;
  duration: number;
  paused: boolean;
  settling: boolean;
}) {
  const previous = useRef<{
    id: string;
    seconds: number;
    at: number;
    paused: boolean;
  } | null>(null);
  const [bounce, setBounce] = useState(false);
  useEffect(() => {
    const clear = () => {
      previous.current = null;
      setBounce(false);
    };
    document.addEventListener("visibilitychange", clear);
    return () => document.removeEventListener("visibilitychange", clear);
  }, []);
  useEffect(() => {
    const old = previous.current,
      at = performance.now();
    previous.current = { id: turnId, seconds, at, paused };
    const milestone =
      !paused &&
      !document.hidden &&
      seconds > 0 &&
      seconds % 5 === 0 &&
      old?.id === turnId &&
      !old.paused &&
      old.seconds === seconds + 1 &&
      at - old.at < 1500;
    setBounce(!!milestone);
    const timer = setTimeout(() => setBounce(false), 420);
    return () => clearTimeout(timer);
  }, [seconds, paused, turnId]);
  return (
    <div className="turn-timer">
      <div
        className={"timer " + (bounce ? "timer-milestone" : "")}
        aria-label={paused ? "Clock paused" : seconds + " seconds remaining"}
      >
        {settling ? (
          <Icon name="gavel" />
        ) : (
          <>
            {seconds}
            <small>{paused ? "held" : "sec"}</small>
          </>
        )}
      </div>
      <div className="timer-track" aria-hidden="true">
        <i
          style={{
            transform: `scaleX(${Math.min(1, (seconds * 1000) / duration)})`,
          }}
        />
      </div>
    </div>
  );
}
