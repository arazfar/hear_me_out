import type { Player, Snapshot } from "../../shared/domain";
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
  return (
    <section
      className={"phase-panel result-panel " + (celebrate ? "celebrating" : "")}
    >
      <Icon name="trophy" className="verdict-icon" />
      <h2>
        {winner?.name || "The court"}
        <span>{final ? "wins the case." : "takes the round."}</span>
      </h2>
      <p>{result?.reason || state.status}</p>
      {result?.tieBreak && <p className="tie-break">{result.tieBreak}</p>}
      {final ? (
        <>
          <button
            className="primary"
            disabled={ready || !me}
            onClick={() => client.command({ type: "rematch", value: true })}
          >
            {ready ? "Rematch ready" : "Again. Obviously."}
            <Icon name={ready ? "check" : "refresh"} />
          </button>
          <p className="support-copy">
            {ready
              ? "Waiting for your friend."
              : otherReady
                ? "Your friend wants a rematch."
                : "New coin. New argument."}
          </p>
        </>
      ) : (
        <p className="next-round">
          <Icon name="arrow" />
          Next round after Bonk’s verdict
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
