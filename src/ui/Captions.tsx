import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Snapshot } from "../../shared/domain";
import { client } from "../game/client";
import { useMediaVersion } from "./hooks";
import { Icon } from "./Icon";
import { Dialog } from "./Dialog";
import { speakingState } from "./presentation";
import { latestPhrase, spokenPhrase } from "./caption-phrases";

export function Captions({
  state,
  fallbackFocus,
}: {
  state: Snapshot;
  fallbackFocus: RefObject<HTMLButtonElement | null>;
}) {
  useMediaVersion();
  const judge =
    state.judge && state.judge.status !== "silent" ? state.judge : null;
  const speaker = state.players.find((p) => p.id === state.turn?.playerId);
  const caption = speaker && state.captions[speaker.id];
  const playerCaption =
    state.phase === "ROUND" && caption?.text ? caption : null;
  const contentKey = judge
    ? JSON.stringify([state.matchId, "judge", judge.id, judge.epoch])
    : playerCaption
      ? JSON.stringify([state.matchId, "player", state.turn?.id, speaker?.id])
      : null;
  const text = judge?.text || playerCaption?.text || "";
  const name = judge ? "Bonk" : speaker?.name || "";
  const viewport = useRef<HTMLSpanElement>(null);
  const previousContent = useRef<{
    key: string | null;
    text: string;
    cue: number | undefined;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [reader, setReader] = useState<{
    key: string;
    text: string;
    name: string;
  } | null>(null);
  const [samples, setSamples] = useState(0);
  const timed =
    !!judge?.alignment?.cues.length &&
    !client.sound.judgeMuted &&
    judge.status !== "captions";
  useLayoutEffect(() => {
    setSamples(0);
  }, [contentKey]);
  useLayoutEffect(() => {
    setReader((old) =>
      old && old.key === contentKey && old.text !== text
        ? { ...old, text }
        : old,
    );
  }, [contentKey, text]);
  useEffect(() => {
    if (!timed || !judge) return;
    let frame = 0;
    const tick = () => {
      setSamples(client.playback.renderedSamples(judge.epoch));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [timed, judge?.epoch]);
  const phrase =
    timed && samples > 0 ? spokenPhrase(judge!.alignment!.cues, samples) : null;
  useLayoutEffect(() => {
    const old = previousContent.current;
    const node = viewport.current;
    if (node) {
      if (old?.key !== contentKey) node.scrollTop = 0;
      else if (old.text !== text || old.cue !== phrase?.cues.at(-1)?.start)
        node.scrollTop = node.scrollHeight;
    }
    previousContent.current = {
      key: contentKey,
      text,
      cue: phrase?.cues.at(-1)?.start,
    };
  }, [contentKey, text, phrase?.cues.at(-1)?.start]);
  const status = speakingState(state, client.session?.playerId, {
    finished: client.playback.finished,
    rendering: client.playback.rendering,
  });
  return (
    <>
      <section
        className={
          "caption-zone " +
          (judge ? "judge-speaking " : "") +
          (["ROUND_RESOLVE", "MATCH_RESULT", "RECOVERING", "ABORTED"].includes(
            state.phase,
          ) || client.reconnecting
            ? "caption-compact-phone"
            : "")
        }
        aria-label="Live captions"
      >
        {contentKey && (
          <div className={judge ? "judge-caption" : "player-caption"}>
            <button
              ref={trigger}
              className="caption-surface"
              aria-label={"Read " + name + "’s full transcript"}
              aria-haspopup="dialog"
              onClick={() => setReader({ key: contentKey, text, name })}
            >
              <span className="caption-compact-label" aria-hidden="true">
                {name} · Transcript
              </span>
              <span className="caption-heading" aria-hidden="true">
                <span
                  className={
                    "caption-speaker " +
                    (!judge
                      ? "player-color-" + state.players.indexOf(speaker!)
                      : "")
                  }
                >
                  {judge && <Icon name="gavel" />}
                  {name}
                </span>
                {judge &&
                  (state.phase !== "ROUND" || client.sound.judgeMuted) && (
                    <span className="caption-status">
                      {status.kind === "captions"
                        ? "Captions only"
                        : client.sound.judgeMuted
                          ? "Sound off"
                          : client.playback.finished
                            ? "Finishing line…"
                            : !client.playback.rendering
                              ? "Getting ready…"
                              : "Speaking"}
                    </span>
                  )}
              </span>
              <span
                ref={viewport}
                tabIndex={-1}
                className={
                  "caption-text " +
                  (timed || playerCaption ? "caption-phrase" : "")
                }
                aria-hidden="true"
              >
                {timed ? (
                  phrase ? (
                    phrase.cues.map((cue, i) => (
                      <span
                        data-cue-start={cue.start}
                        data-cue-end={cue.end}
                        key={i}
                        className={i === phrase.active ? "spoken-word" : ""}
                      >
                        {cue.text}{" "}
                      </span>
                    ))
                  ) : (
                    <span className="caption-waiting">…</span>
                  )
                ) : playerCaption ? (
                  <span className="spoken-word">{latestPhrase(text)}</span>
                ) : (
                  text
                )}
              </span>
            </button>
            <span
              className="sr-only"
              aria-live={judge || playerCaption?.final ? "polite" : "off"}
            >
              {text}
            </span>
          </div>
        )}
      </section>
      {reader && (
        <Dialog
          title={reader.name + " · Transcript"}
          returnFocus={() => {
            const current = trigger.current;
            return current?.isConnected &&
              !current.disabled &&
              current.getClientRects().length > 0 &&
              getComputedStyle(current).visibility === "visible"
              ? current
              : fallbackFocus.current;
          }}
          onClose={() => setReader(null)}
        >
          <TranscriptReader text={reader.text} />
        </Dialog>
      )}
    </>
  );
}

function TranscriptReader({ text }: { text: string }) {
  const region = useRef<HTMLDivElement>(null);
  const previous = useRef(text);
  useLayoutEffect(() => {
    if (previous.current !== text && region.current)
      region.current.scrollTop = region.current.scrollHeight;
    previous.current = text;
  }, [text]);
  return (
    <div
      ref={region}
      className="transcript-reader"
      tabIndex={0}
      role="region"
      aria-label="Full transcript"
    >
      <p>{text}</p>
    </div>
  );
}
