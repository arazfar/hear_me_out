import {
  completedOutcome,
  type Player,
  type Snapshot,
} from "../../shared/domain";
import { RecoveryCheck, currentReadinessPresentation } from "./DeviceCheck";
import { client } from "../game/client";
import { rematchPresentation } from "./presentation";
import { Icon } from "./Icon";
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
  const final = state.phase === "MATCH_RESULT";
  const { pending, error, submit } = useDecision(state);
  const outcome = completedOutcome(state);
  const winnerId = outcome?.winnerId;
  const draw = !!outcome && !winnerId;
  const winner = state.players.find((p) => p.id === winnerId);
  const other = state.players.find((p) => p.id !== me?.id);
  const readiness = currentReadinessPresentation();
  const { ready, actionLabel } = rematchPresentation(state, me?.id, readiness);
  const opponent = state.players.find((p) => p.id !== winnerId);
  const series = draw
    ? state.players.map((p) => p.wins).join("–")
    : `${winner?.wins ?? 0}–${opponent?.wins ?? 0}`;
  return (
    <section
      className={
        "result-panel " +
        (!me?.mediaReady && final && other?.connected
          ? "result-recovery "
          : "") +
        (draw
          ? "result-draw "
          : state.players[0]?.id === winnerId
            ? "result-0 "
            : "result-1 ") +
        (celebrate ? "celebrating" : "")
      }
    >
      <div
        className="result-heading"
        tabIndex={0}
        role="region"
        aria-label="Verdict"
      >
        <h2>
          {draw
            ? final
              ? "It’s a draw!"
              : "Round tied!"
            : winner?.name || "The court"}{" "}
          {!draw && (
            <span>{final ? "wins the match!" : "wins the round!"}</span>
          )}
        </h2>
        {final && (
          <p className="match-score" aria-label={"Round wins: " + series}>
            {series}
          </p>
        )}
      </div>
      <div
        className="result-actions"
        tabIndex={!me?.mediaReady ? 0 : undefined}
        role={!me?.mediaReady ? "region" : undefined}
        aria-label={!me?.mediaReady ? "Result actions" : undefined}
      >
        {error && (
          <p className="decision-error" role="alert">
            {error}
          </p>
        )}
        {final && !other?.connected ? (
          <>
            <button className="primary" onClick={() => client.leave()}>
              Back to menu
            </button>
          </>
        ) : final ? (
          <>
            {!me?.mediaReady && <RecoveryCheck />}
            {me?.mediaReady && (
              <button
                className={
                  "primary" + (ready && !pending ? " accepted-button" : "")
                }
                disabled={ready || !me?.mediaReady || !!pending}
                aria-busy={!!pending}
                onClick={() => submit({ type: "rematch", value: true })}
              >
                {pending ? "Queuing rematch…" : actionLabel}
                {!ready && !pending && <Icon name="refresh" />}
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
      </div>
      {celebrate && (
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
