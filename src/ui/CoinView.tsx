import type { Player, Snapshot } from "../../shared/domain";
import { Icon } from "./Icon";
export function CoinView({
  state,
  me,
  reveal,
}: {
  state: Snapshot;
  me?: Player;
  reveal: boolean;
}) {
  const heads = state.headsId === me?.id;
  return (
    <section className="phase-panel coin-panel">
      <div
        className={"coin-token " + (reveal ? "coin-reveal" : "")}
        data-side={heads ? "heads" : "tails"}
        aria-hidden="true"
      >
        <Icon name={heads ? "coin" : "coin-tails"} />
      </div>
      <h2>{heads ? "Heads. You go first." : "Tails. Your pick."}</h2>
      {!heads && <p>Choose a topic and your side.</p>}
    </section>
  );
}
