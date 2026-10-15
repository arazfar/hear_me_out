import type { Player, Snapshot } from "../../shared/domain";
import { RecoveryCheck, currentReadinessPresentation } from "./DeviceCheck";
import { client } from "../game/client";
import { Icon } from "./Icon";
import { rematchPresentation } from "./presentation";
import { useDecision } from "./hooks";
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
  const { pending, error, submit } = useDecision(state);
  const winnerId = final ? state.winnerId : result?.winnerId;
  const winner = state.players.find((p) => p.id === winnerId);
  const other = state.players.find((p) => p.id !== me?.id);
  const readiness = currentReadinessPresentation();
  const { ready, actionLabel } = rematchPresentation(state, me?.id, readiness);
  const opponent = state.players.find((p) => p.id !== winnerId);
  const series = `${winner?.wins ?? 0}–${opponent?.wins ?? 0}`;
  return (
    <section
      className={
        "phase-panel result-panel " +
        (celebrate ? "celebrating " : "") +
        (state.judge && state.judge.status !== "silent"
          ? "has-verdict-caption"
          : "")
      }
    >
      <Icon name="trophy" className="verdict-icon" />
      <h2>
        {winner?.name || "The court"}{" "}
        <span>
          {final
            ? `wins the match, ${series}!`
            : `wins round ${result?.round || state.round}.`}
        </span>
      </h2>
      <p className="verdict-reason">{result?.reason || state.status}</p>
      {result?.tieBreak && result.tieBreak !== result.reason && (
        <p className="tie-break">{result.tieBreak}</p>
      )}
      {error && (
        <p className="decision-error" role="alert">
          {error}
        </p>
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
              disabled={ready || !me?.mediaReady || !!pending}
              aria-busy={!!pending}
              onClick={() => submit({ type: "rematch", value: true })}
            >
              {pending ? "Queuing rematch…" : actionLabel}
              <Icon name={ready ? "check" : "refresh"} />
            </button>
          )}
          {me?.mediaReady &&
            other &&
            !other.mediaReady &&
            readiness.message && (
              <p className="support-copy">{readiness.message}</p>
            )}
        </>
      ) : null}
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
