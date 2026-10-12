import { type Player, type Snapshot } from "../../shared/domain";
import { client } from "../game/client";
export function ResultView({ state, me }: { state: Snapshot; me?: Player }) {
  const phase = state.phase;
  return (
    <section className="result-card">
      <span className="card-kicker">
        {phase === "MATCH_RESULT" ? "THE VERDICT" : "ROUND VERDICT"}
      </span>
      <h2>
        {
          state.players.find(
            (p) =>
              p.id ===
              (phase === "MATCH_RESULT"
                ? state.winnerId
                : state.results.at(-1)?.winnerId),
          )?.name
        }
        <br />
        <em>
          {phase === "MATCH_RESULT" ? "wins the case." : "takes the round."}
        </em>
      </h2>
      <p>{state.results.at(-1)?.reason}</p>
      {state.results.at(-1)?.tieBreak && (
        <p className="tiny">{state.results.at(-1)?.tieBreak}</p>
      )}
      {phase === "MATCH_RESULT" && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${i * 9}%`,
                background: ["#FF4F9A", "#39D8F2", "#20102E"][i % 3],
                animationDelay: `${i * 0.06}s`,
                rotate: `${i * 37}deg`,
              }}
            />
          ))}
        </div>
      )}
      {phase === "MATCH_RESULT" && (
        <button
          className="primary"
          disabled={state.rematchReady.includes(me!.id)}
          onClick={() => client.command({ type: "rematch", value: true })}
        >
          {state.rematchReady.includes(me!.id)
            ? "REMATCH READY ✓"
            : "AGAIN. OBVIOUSLY. ↗"}
        </button>
      )}
    </section>
  );
}
