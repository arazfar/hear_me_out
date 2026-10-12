import { canSpeak, type Snapshot } from "../../shared/domain";
import { client } from "../game/client";
import { Icon } from "./Icon";
import { useMediaVersion, useServerNow } from "./hooks";

export function TurnPanel({
  state,
  playerId,
}: {
  state: Snapshot;
  playerId?: string;
}) {
  const now = useServerNow();
  useMediaVersion();
  const turn = state.turn;
  if (!turn) return null;
  const mine = turn.playerId === playerId;
  const speaker = state.players.find((p) => p.id === turn.playerId);
  const paused = !!turn.pausedReason || turn.sealing;
  const seconds = Math.max(
    0,
    Math.ceil((turn.deadline ? turn.deadline - now : turn.remainingMs) / 1000),
  );
  const judging = turn.sealing || state.judgePending;
  const status = turn.sealing
    ? "Making it official"
    : turn.pausedReason
      ? "Clock paused"
      : mine
        ? "Your turn"
        : speaker?.name + "’s turn";
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
      <div className="turn-label">
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
      <div className="turn-kind">
        {turn.kind === "case"
          ? "Make your case"
          : turn.kind === "rebuttal"
            ? "Answer their argument"
            : "Your closing argument"}
      </div>
      <p className="turn-guidance">
        {turn.pausedReason === "judge"
          ? "Bonk has the floor."
          : judging
            ? "Bonk is scoring that."
            : mine && client.capture.micMuted
              ? "Unmute to make your point."
              : mine
                ? "Say your piece. Then pass it on."
                : "Your chance to answer is coming."}
      </p>
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
      {state.comebackPlayerId && turn.kind === "closing" && (
        <p className="comeback-label">A comeback is still on the table.</p>
      )}
    </section>
  );
}
