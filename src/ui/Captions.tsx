import { type Snapshot } from "../../shared/domain";
export function Captions({ state }: { state: Snapshot }) {
  const phase = state.phase;
  return (
    <div className="caption-zone" aria-live="polite">
      {state.judge && state.judge.status !== "silent" ? (
        <div className="judge-caption">
          <span>BONK {state.judgePending ? "···" : "✦"}</span>
          <p>“{state.judge.text}”</p>
        </div>
      ) : phase === "ROUND" ? (
        <div className="player-captions">
          {state.players.map((p) => (
            <p key={p.id}>
              <b>{p.name}</b>
              {state.captions[p.id]?.text?.slice(-240) || "…"}
            </p>
          ))}
        </div>
      ) : (
        <div className="judge-caption quiet">
          <span>BONK ✦</span>
          <p>
            {phase === "LOBBY"
              ? "“A strong opinion is not the same as a strong argument. Luckily, this is a game.”"
              : state.status}
          </p>
        </div>
      )}
    </div>
  );
}
