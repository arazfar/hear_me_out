import type { Player, Snapshot } from "../../shared/domain";
import { Icon } from "./Icon";
export function CoinView({ state, me }: { state: Snapshot; me?: Player }) {
  const heads = state.headsId === me?.id;
  return (
    <section className="phase-panel coin-panel">
      <div
        className="coin-token"
        data-side={heads ? "heads" : "tails"}
        aria-hidden="true"
      >
        <Icon name={heads ? "coin" : "coin-tails"} />
      </div>
      <h2>{heads ? "You open the case." : "You pick the topic."}</h2>
      <p>
        {heads
          ? "Heads. First word is yours."
          : "Tails. Choose the argument and your side."}
      </p>
    </section>
  );
}
