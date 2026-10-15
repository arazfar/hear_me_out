import type { Snapshot } from "../../shared/domain";
import { client } from "../game/client";
import { useMediaVersion } from "./hooks";
import { Icon } from "./Icon";
import { speakingState } from "./presentation";
export function Captions({ state }: { state: Snapshot }) {
  useMediaVersion();
  const judge =
    state.judge && state.judge.status !== "silent" ? state.judge : null;
  const speaker = state.players.find((p) => p.id === state.turn?.playerId);
  const caption = speaker && state.captions[speaker.id];
  const status = speakingState(state, client.session?.playerId, {
    finished: client.playback.finished,
    rendering: client.playback.rendering,
  });
  return (
    <section
      className={"caption-zone " + (judge ? "judge-speaking" : "")}
      aria-label="Live captions"
    >
      {judge ? (
        <div className="judge-caption">
          <div className="caption-heading">
            <span className="caption-speaker">
              <Icon name="gavel" />
              Bonk
            </span>
            {(state.phase !== "ROUND" || client.sound.judgeMuted) && (
              <span className="caption-status">
                {status.kind === "captions"
                  ? "Captions only"
                  : client.sound.judgeMuted
                    ? "Sound off"
                    : client.playback.finished
                      ? "Finishing line…"
                      : status.kind === "judge" && client.playback.rendering
                        ? "Speaking"
                        : "Getting ready…"}
              </span>
            )}
          </div>
          <p aria-live="polite">{judge.text}</p>
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
          <p aria-live={caption.final ? "polite" : "off"}>{caption.text}</p>
        </div>
      ) : null}
    </section>
  );
}
