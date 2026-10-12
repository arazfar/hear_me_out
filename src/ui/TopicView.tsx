import { useState } from "react";
import { SUGGESTIONS, type Player, type Snapshot } from "../../shared/domain";
import { client } from "../game/client";
import { Icon } from "./Icon";
import { useServerNow } from "./hooks";

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
    [position, setPosition] = useState("");
  const selecting = state.phase === "TOPIC_SELECT",
    choosing = state.tailsId === me?.id;
  const confirmed = !!me && !!state.topic?.confirmations.includes(me.id);
  return (
    <section
      className="phase-panel topic-panel"
      aria-label={selecting ? "Choose a topic" : "Confirm proposition"}
    >
      {selecting ? (
        choosing ? (
          <>
            <h2>{custom ? "Your own bad take." : "Your pick."}</h2>
            {custom ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  client.command({
                    type: "propose_topic",
                    text: topic.trim(),
                    chosenPosition: position.trim(),
                  });
                }}
              >
                <label htmlFor="proposition">The proposition</label>
                <input
                  id="proposition"
                  value={topic}
                  maxLength={160}
                  placeholder="Cats are better roommates than dogs"
                  onChange={(e) => setTopic(e.target.value)}
                  required
                />
                <label htmlFor="position">Your side</label>
                <input
                  id="position"
                  value={position}
                  maxLength={80}
                  placeholder="I’m defending cats"
                  onChange={(e) => setPosition(e.target.value)}
                  required
                />
                <button
                  className="primary"
                  disabled={!topic.trim() || !position.trim()}
                >
                  Propose it
                  <Icon name="arrow" />
                </button>
              </form>
            ) : (
              <div className="suggestions">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() =>
                      client.command({
                        type: "propose_topic",
                        text: s.proposition,
                        chosenPosition: s.positive,
                        suggestion: s.id,
                      })
                    }
                  >
                    <span className="topic-number" aria-hidden="true">
                      {i + 1}
                    </span>
                    {s.label}
                    <Icon name="arrow" />
                  </button>
                ))}
              </div>
            )}
            <button
              className="text-button"
              onClick={() => setCustom((v) => !v)}
            >
              {custom ? "Back to suggestions" : "Write your own"}
            </button>
          </>
        ) : (
          <>
            <h2>
              {state.players.find((p) => p.id === state.tailsId)?.name} is
              choosing.
            </h2>
            <p>You’ll open the case. Prepare a ridiculous example.</p>
            <span className="waiting-dots" aria-label="Waiting">
              <i />
              <i />
              <i />
            </span>
          </>
        )
      ) : (
        <>
          <h2>{confirmed ? "You’re in." : "That’s the argument?"}</h2>
          <p>
            {confirmed
              ? "Waiting for your friend to confirm."
              : "Check the proposition and your side."}
          </p>
          <button
            className="primary"
            disabled={confirmed || !me}
            onClick={() =>
              client.command({
                type: "confirm_topic",
                topicRevision: state.topic!.revision,
              })
            }
          >
            {confirmed ? "Confirmed" : "Confirm my side"}
            <Icon name="check" />
          </button>
          <button
            className="text-button"
            onClick={() =>
              client.command({
                type: "reject_topic",
                topicRevision: state.topic!.revision,
              })
            }
          >
            Choose another topic
          </button>
        </>
      )}
      <DecisionClock deadline={state.phaseDeadline} />
    </section>
  );
}
