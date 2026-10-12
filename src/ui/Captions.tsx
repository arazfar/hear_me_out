import type { Snapshot } from "../../shared/domain";
import { Icon } from "./Icon";
export function Captions({ state }: { state: Snapshot }) {
  const judge =
    state.judge && state.judge.status !== "silent" ? state.judge : null;
  const speaker = state.players.find((p) => p.id === state.turn?.playerId);
  const caption = speaker && state.captions[speaker.id];
  return (
    <section
      className={"caption-zone " + (judge ? "judge-speaking" : "")}
      aria-label="Live captions"
    >
      {judge ? (
        <div className="judge-caption">
          <span className="caption-speaker">
            <Icon name="gavel" />
            Bonk
          </span>
          <p aria-live="polite">{judge.text}</p>
          {state.degraded.tts && (
            <span className="caption-status">Captions only</span>
          )}
        </div>
      ) : state.phase === "ROUND" && caption?.text ? (
        <div className="player-caption">
          <span
            className={
              "caption-speaker player-color-" + state.players.indexOf(speaker!)
            }
          >
            {speaker?.name}
          </span>
          <p aria-live={caption.final ? "polite" : "off"}>
            {caption.text.slice(-400)}
          </p>
        </div>
      ) : null}
    </section>
  );
}
