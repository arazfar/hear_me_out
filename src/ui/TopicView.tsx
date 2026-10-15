import { useEffect, useState } from "react";
import { SUGGESTIONS, type Player, type Snapshot } from "../../shared/domain";
import { Icon } from "./Icon";
import { useDecision, useServerNow } from "./hooks";
import { topicPresentation } from "./presentation";

function DecisionClock({ deadline }: { deadline: number | null }) {
  const now = useServerNow();
  return deadline ? (
    <p className="decision-clock">
      <Icon name="clock" />
      {Math.max(0, Math.ceil((deadline - now) / 1000))}s to decide
    </p>
  ) : null;
}
export function TopicView({ state, me }: { state: Snapshot; me?: Player }) {
  const [custom, setCustom] = useState(false),
    [topic, setTopic] = useState(""),
    [position, setPosition] = useState(""),
    [suggestion, setSuggestion] = useState<(typeof SUGGESTIONS)[number] | null>(
      null,
    );
  const { pending, error, submit } = useDecision(state);
  const selecting = state.phase === "TOPIC_SELECT";
  useEffect(() => {
    if (selecting) setSuggestion(null);
  }, [selecting, state.phaseVersion]);
  const { choosing, confirmed, waiting, selectionLabel } = topicPresentation(
    state,
    me?.id,
  );
  return (
    <section
      className="phase-panel topic-panel"
      aria-label={selecting ? "Choose a topic" : "Confirm proposition"}
    >
      {selecting ? (
        choosing ? (
          <>
            <h2>
              {custom
                ? "Your topic"
                : suggestion
                  ? "Pick your side"
                  : "Pick a topic"}
            </h2>
            {custom ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit({
                    type: "propose_topic",
                    text: topic.trim(),
                    chosenPosition: position.trim(),
                  });
                }}
              >
                <label htmlFor="proposition">The argument</label>
                <input
                  id="proposition"
                  value={topic}
                  maxLength={160}
                  placeholder="Cats are better roommates than dogs"
                  onChange={(e) => setTopic(e.target.value)}
                  required
                  disabled={!!pending}
                />
                <label htmlFor="position">Your side</label>
                <input
                  id="position"
                  value={position}
                  maxLength={80}
                  placeholder="I’m defending cats"
                  onChange={(e) => setPosition(e.target.value)}
                  required
                  disabled={!!pending}
                />
                <button
                  className="primary"
                  disabled={!topic.trim() || !position.trim() || !!pending}
                  aria-busy={pending?.type === "propose_topic"}
                >
                  {pending?.type === "propose_topic"
                    ? "Proposing…"
                    : "Propose it"}
                  <Icon name="arrow" />
                </button>
              </form>
            ) : suggestion ? (
              <>
                <p className="topic-proposition">{suggestion.proposition}</p>
                <div className="suggestions side-options">
                  {(["positive", "negative"] as const).map((side) => (
                    <button
                      key={side}
                      autoFocus={side === "positive"}
                      disabled={!!pending}
                      aria-busy={
                        pending?.type === "propose_topic" &&
                        pending.chosenPosition === side
                      }
                      onClick={() =>
                        submit({
                          type: "propose_topic",
                          text: suggestion.proposition,
                          chosenPosition: side,
                          suggestion: suggestion.id,
                        })
                      }
                    >
                      {pending?.type === "propose_topic" &&
                      pending.chosenPosition === side
                        ? "Proposing…"
                        : suggestion[side]}
                      <Icon name="arrow" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.id}
                    disabled={!!pending}
                    onClick={() => setSuggestion(s)}
                  >
                    {s.label}
                    <Icon name="arrow" />
                  </button>
                ))}
              </div>
            )}
            <button
              className="text-button"
              disabled={!!pending}
              onClick={() =>
                suggestion ? setSuggestion(null) : setCustom((v) => !v)
              }
            >
              {custom || suggestion ? "Back to suggestions" : "Write your own"}
            </button>
          </>
        ) : (
          <>
            <h2>{selectionLabel}</h2>
            <span className="waiting-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </>
        )
      ) : (
        <>
          {waiting && <p>{waiting}</p>}
          <button
            className="primary"
            disabled={confirmed || !me || !!pending}
            aria-busy={pending?.type === "confirm_topic"}
            onClick={() =>
              submit({
                type: "confirm_topic",
                topicRevision: state.topic!.revision,
              })
            }
          >
            {pending?.type === "confirm_topic"
              ? "Confirming…"
              : confirmed
                ? "Confirmed"
                : "Confirm my side"}
            <Icon name="check" />
          </button>
          <button
            className="text-button"
            disabled={!!pending}
            onClick={() =>
              submit({
                type: "reject_topic",
                topicRevision: state.topic!.revision,
              })
            }
          >
            {pending?.type === "reject_topic"
              ? "Choosing again…"
              : "Choose another topic"}
          </button>
        </>
      )}
      {error && (
        <p className="decision-error" role="alert">
          {error}
        </p>
      )}
      <DecisionClock deadline={state.phaseDeadline} />
    </section>
  );
}
