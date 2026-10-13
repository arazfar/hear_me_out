import { useEffect, useState } from "react";
import { canSpeak, type Snapshot } from "../../shared/domain";
import { client } from "../game/client";
import { Icon } from "./Icon";
import { useMediaVersion, useServerNow } from "./hooks";
import { turnStatus } from "./presentation";

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
  const paused = !!turn.pausedReason || turn.sealing;
  const seconds = Math.max(
    0,
    Math.ceil((turn.deadline ? turn.deadline - now : turn.remainingMs) / 1000),
  );
  const status = turnStatus(state, playerId);
  return (
    <section
      className={"turn-panel " + (seconds <= 5 && !paused ? "time-low" : "")}
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
        <span className="turn-dot" />
        {status}
      </div>
      <div
        className="timer"
        aria-label={paused ? "Clock paused" : seconds + " seconds remaining"}
      >
        {turn.sealing ? (
          <Icon name="gavel" />
        ) : (
          <>
            {seconds}
            <small>sec</small>
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
      {turn.pausedReason === "judge" && (
        <p className="turn-guidance">Clock paused</p>
      )}
      {mine && !turn.sealing && (
        <button
          className="primary yield-button"
          disabled={!canSpeak(state, playerId || null)}
          onClick={() =>
            client.command({
              type: "done",
              turnId: turn.id,
              lastAudioSeq: client.capture.audioSeq,
            })
          }
        >
          I’m done
          <Icon name="arrow" />
        </button>
      )}
    </section>
  );
}
