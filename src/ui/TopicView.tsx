import { SUGGESTIONS, type Player, type Snapshot } from "../../shared/domain";
import { client } from "../game/client";
export function TopicView({
  state,
  me,
  topic,
  position,
  setTopic,
  setPosition,
  now,
}: {
  state: Snapshot;
  me?: Player;
  topic: string;
  position: string;
  setTopic: (v: string) => void;
  setPosition: (v: string) => void;
  now: number;
}) {
  const phase = state.phase;
  return (
    <section className="center-card topic-card">
      <span className="card-kicker">
        {state.tailsId === me?.id ? "YOUR PICK, TAILS" : "TAILS IS PICKING"}
      </span>
      {phase === "TOPIC_SELECT" ? (
        <>
          {state.tailsId === me?.id ? (
            <>
              <h3>Pick a fight. Politely.</h3>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
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
                    <span>{s.icon}</span>
                    {s.label}
                    <b>↗</b>
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  client.command({
                    type: "propose_topic",
                    text: topic,
                    chosenPosition: position,
                  });
                }}
              >
                <label>
                  Or bring your own
                  <input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    maxLength={160}
                    placeholder="Cats are better roommates than dogs"
                    required
                  />
                </label>
                <label>
                  Your side
                  <input
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    maxLength={80}
                    placeholder="I’m defending cats"
                    required
                  />
                </label>
                <button
                  className="primary"
                  disabled={!topic.trim() || !position.trim()}
                >
                  MAKE IT OFFICIAL ↗
                </button>
              </form>
            </>
          ) : (
            <>
              <h3>
                {state.players.find((p) => p.id === state.tailsId)?.name} is
                choosing.
              </h3>
              <p>
                Keep a ridiculous example ready. Bonk respects a good argument,
                even a very silly one.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <h3>The proposition</h3>
          <p className="proposition">{state.topic?.proposition}</p>
          <div className="sides">
            {state.players.map((p) => (
              <div key={p.id}>
                <b>{p.name}</b>
                <span>{state.topic?.positions[p.id]}</span>
              </div>
            ))}
          </div>
          <button
            className="primary"
            disabled={state.topic?.confirmations.includes(me!.id)}
            onClick={() =>
              client.command({
                type: "confirm_topic",
                topicRevision: state.topic!.revision,
              })
            }
          >
            {state.topic?.confirmations.includes(me!.id)
              ? "CONFIRMED ✓ · WAITING"
              : "THAT’S THE ARGUMENT ↗"}
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
            This needs another try
          </button>
        </>
      )}
      <span className="transport-label">
        {Math.max(
          0,
          Math.ceil(
            ((state.phaseDeadline || now) - now - client.offset) / 1000,
          ),
        )}
        s to decide
      </span>
    </section>
  );
}
