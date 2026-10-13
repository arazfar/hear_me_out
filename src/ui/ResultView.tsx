import type { Player, Snapshot } from "../../shared/domain";
import { RecoveryCheck, currentReadinessPresentation } from "./DeviceCheck";
import { client } from "../game/client";
import { Icon } from "./Icon";
export function ResultView({
  state,
  me,
  celebrate,
}: {
  state: Snapshot;
  me?: Player;
  celebrate: boolean;
}) {
  const final = state.phase === "MATCH_RESULT",
    result = state.results.at(-1);
  const winnerId = final ? state.winnerId : result?.winnerId;
  const winner = state.players.find((p) => p.id === winnerId);
  const ready = !!me && state.rematchReady.includes(me.id);
  const otherReady = state.rematchReady.some((id) => id !== me?.id);
  const other = state.players.find((p) => p.id !== me?.id);
  const readiness = currentReadinessPresentation();
  return (
    <section
      className={"phase-panel result-panel " + (celebrate ? "celebrating" : "")}
    >
      <Icon name="trophy" className="verdict-icon" />
      <h2>
        {winner?.name || "The court"}
        <span>{final ? "wins the match!" : "wins this round."}</span>
      </h2>
      <p>{result?.reason || state.status}</p>
      {result?.tieBreak && result.tieBreak !== result.reason && (
        <p className="tie-break">{result.tieBreak}</p>
      )}
      {final && !other?.connected ? (
        <>
          <p className="support-copy">Your friend isn’t here.</p>
          <button className="primary" onClick={() => client.leave()}>
            Back to menu
            <Icon name="arrow" />
          </button>
        </>
      ) : final ? (
        <>
          {!me?.mediaReady && <RecoveryCheck />}
          {me?.mediaReady && (
            <button
              className="primary"
              disabled={ready || !me?.mediaReady}
              onClick={() => client.command({ type: "rematch", value: true })}
            >
              {ready ? "Rematch ready" : "Rematch"}
              <Icon name={ready ? "check" : "refresh"} />
            </button>
          )}
          {me?.mediaReady && (
            <p className="support-copy">
              {other && !other.mediaReady
                ? readiness.message
                : ready
                  ? "Waiting for your friend."
                  : otherReady
                    ? "Your friend wants a rematch."
                    : ""}
            </p>
          )}
        </>
      ) : (
        <p className="next-round">
          <Icon name="arrow" />
          {winner && winner.wins >= 2
            ? "Bonk has the final verdict"
            : "Next round after the verdict"}
        </p>
      )}
      {celebrate && final && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <i
              key={i}
              style={
                {
                  "--i": i,
                  "--piece-color": i % 2 ? "var(--pink)" : "var(--cyan)",
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
