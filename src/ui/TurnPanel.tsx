import { useEffect, useState } from "react";
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
  const next = `${mine ? "Your" : state.players.find((p) => p.id === turn.playerId)?.name + "’s"} ${turn.kind} next`;
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
      <div key={handoff} className={"turn-label " + (handoff ? "handoff" : "")}>
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
      <div
        className="timer"
        aria-label={paused ? "Clock paused" : seconds + " seconds remaining"}
      >
        {turn.sealing || pending ? (
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
            transform:
              "scaleX(" + Math.min(1, (seconds * 1000) / turn.durationMs) + ")",
          }}
        />
      </div>
      {mine && client.capture.micMuted && !paused && (
        <p className="turn-guidance">Your mic is off.</p>
      )}
      <div className="turn-action">
        {mine && listening ? (
          <button
            className="primary yield-button"
            onClick={() => client.capture.finishTurn()}
          >
            I’m done
            <Icon name="arrow" />
          </button>
        ) : ["judge", "buffering", "captions"].includes(presentation.kind) ? (
          <p className="turn-next">{next}</p>
        ) : null}
      </div>
    </section>
  );
}
