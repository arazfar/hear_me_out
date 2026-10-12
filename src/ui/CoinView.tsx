import { type Player, type Snapshot } from "../../shared/domain";
export function CoinView({ state, me }: { state: Snapshot; me?: Player }) {
  return (
    <section className="center-card coin-card">
      <span className="card-kicker">THE COIN HAS SPOKEN</span>
      <div className="coin-token">✦</div>
      <h3>{state.players.find((p) => p.id === state.headsId)?.name} opens.</h3>
      <p>
        {state.players.find((p) => p.id === state.tailsId)?.name} chooses the
        topic and their side.
      </p>
      <span className="pill">
        YOUR ROLE:{" "}
        {me?.id === state.headsId
          ? "HEADS · OPEN THE CASE"
          : "TAILS · PICK THE TOPIC"}
      </span>
    </section>
  );
}
