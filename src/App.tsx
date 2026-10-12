import { useEffect, useRef, useState } from "react";
import { points, scoreShare, type Snapshot } from "../shared/domain";
import { client } from "./game/client";
import { Captions } from "./ui/Captions";
import { CoinView } from "./ui/CoinView";
import { LobbyView } from "./ui/LobbyView";
import { PlayerCard } from "./ui/PlayerCard";
import { PlayerControls } from "./ui/PlayerControls";
import { ResultView } from "./ui/ResultView";
import { StageLoader } from "./ui/StageLoader";
import { TitleView } from "./ui/TitleView";
import { TopicView } from "./ui/TopicView";

export function App() {
  const bursts = useRef<
    Record<
      string,
      { units: number; at: number; timer: ReturnType<typeof setTimeout> }
    >
  >({});
  const lastScoreSound = useRef(0);
  const [state, setState] = useState<Snapshot | null>(client.state),
    [name, setName] = useState(""),
    [code, setCode] = useState(
      new URLSearchParams(location.search).get("room") || "",
    ),
    [joining, setJoining] = useState(() =>
      /^\d{4}$/.test(new URLSearchParams(location.search).get("room") || ""),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [connection, setConnection] = useState(""),
    [now, setNow] = useState(Date.now()),
    [topic, setTopic] = useState(""),
    [position, setPosition] = useState(""),
    [typed, setTyped] = useState(""),
    [levels, setLevels] = useState<Record<string, number>>({}),
    [burst, setBurst] = useState<Record<string, string>>({}),
    [media, setMedia] = useState(0),
    [rules, setRules] = useState(false),
    [reduced, setReduced] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  useEffect(() => {
    const unsub = client.on((u) => {
      if (u.state) setState(u.state);
      if (u.connection) {
        setConnection(u.connection);
        if (u.connection === "left") setState(null);
      }
      if (u.error) {
        setError(u.error);
        setTimeout(() => setError(""), 7000);
      }
      if (u.media) setMedia((v) => v + 1);
      if (u.activity)
        setLevels((v) => ({ ...v, [u.activity!.playerId]: u.activity!.level }));
      const e = u.event;
      if (e?.type === "score_committed") {
        const score = e.payload;
        const previous = bursts.current[score.playerId];
        if (previous) clearTimeout(previous.timer);
        const units =
          (previous && Date.now() - previous.at < 500 ? previous.units : 0) +
          score.deltaUnits;
        setBurst((v) => ({ ...v, [score.playerId]: `+${points(units)}` }));
        if (Date.now() - lastScoreSound.current > 450) {
          client.sound.effect("score");
          lastScoreSound.current = Date.now();
        }
        bursts.current[score.playerId] = {
          units,
          at: Date.now(),
          timer: setTimeout(
            () => setBurst((v) => ({ ...v, [score.playerId]: "" })),
            1200,
          ),
        };
      }
      if (e?.type === "coin_committed") client.sound.effect("coin");
      if (e?.type === "match_result" || e?.type === "round_result")
        client.sound.effect("verdict");
    });
    void client.restore();
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);
  const me = state?.players.find((p) => p.id === client.session?.playerId),
    other = state?.players.find((p) => p.id !== client.session?.playerId),
    turn = state?.turn;
  const mine = turn?.playerId === me?.id;
  const seconds = turn
    ? Math.max(
        0,
        Math.ceil(
          (turn.deadline
            ? turn.deadline - now - client.offset
            : turn.remainingMs) / 1000,
        ),
      )
    : 0;
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const phase = state?.phase;
  const selecting = phase === "TOPIC_SELECT" || phase === "TOPIC_CONFIRM";
  const inMatch =
    phase &&
    !["LOBBY", "INTRO_COIN", "TOPIC_SELECT", "TOPIC_CONFIRM"].includes(phase);
  void media;
  return (
    <main
      className={`app ${state ? "in-room" : "on-title"} ${reduced ? "reduced-motion" : ""}`}
    >
      <div className="grain" />
      <header>
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (!state) void client.sound.unlock();
          }}
        >
          HEAR ME OUT<span>THE COURT OF BAD TAKES</span>
        </a>
        <div className="header-right">
          {state && (
            <button
              className="room-code"
              onClick={() =>
                void navigator.clipboard
                  .writeText(`${location.origin}?room=${state.code}`)
                  .then(() => setError("Invite link copied."))
              }
            >
              ROOM <b>{state.code}</b> <span>↗</span>
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => setRules(!rules)}
            aria-label="How to play"
          >
            ?
          </button>
        </div>
      </header>
      <StageLoader state={state} reduced={reduced} />
      {!state ? (
        <TitleView
          name={name}
          code={code}
          joining={joining}
          busy={busy}
          setName={setName}
          setCode={setCode}
          setJoining={setJoining}
          action={action}
        />
      ) : (
        <>
          <div className="arena-head">
            <div className="arena-eyebrow">
              {phase === "LOBBY"
                ? "PREPARE YOUR BAD TAKE"
                : selecting
                  ? "CHOOSE YOUR HILL TO DIE ON"
                  : phase === "INTRO_COIN"
                    ? "LET FATE MAKE A BAD DECISION"
                    : `ROUND ${state.round} · FIRST TO TWO`}
            </div>
            <h2>
              {state.topic?.proposition ||
                (phase === "LOBBY"
                  ? "Your friend belongs in this courtroom."
                  : phase === "INTRO_COIN"
                    ? "Heads opens. Tails chooses."
                    : "What are we arguing about?")}
            </h2>
            {inMatch && (
              <div
                className="momentum"
                aria-label="Momentum from the committed score"
              >
                <i
                  style={{
                    width: `${scoreShare(state.players) * 100}%`,
                  }}
                />
                <span>MOMENTUM</span>
              </div>
            )}
          </div>
          <div className="faces">
            <PlayerCard
              reduced={reduced}
              player={state.players[0]}
              index={0}
              local={state.players[0]?.id === me?.id}
              state={state}
              level={levels[state.players[0]?.id] || 0}
              burst={burst[state.players[0]?.id]}
            />
            <PlayerCard
              reduced={reduced}
              player={state.players[1]}
              index={1}
              local={state.players[1]?.id === me?.id}
              state={state}
              level={levels[state.players[1]?.id] || 0}
              burst={burst[state.players[1]?.id]}
            />
          </div>
          {phase === "LOBBY" && (
            <LobbyView
              state={state}
              me={me}
              other={other}
              busy={busy}
              action={action}
            />
          )}
          {phase === "INTRO_COIN" && <CoinView state={state} me={me} />}
          {selecting && (
            <TopicView
              state={state}
              me={me}
              topic={topic}
              position={position}
              setTopic={setTopic}
              setPosition={setPosition}
              now={now}
            />
          )}
          {inMatch && (
            <>
              <div className={`turn-panel ${mine ? "your-turn" : ""}`}>
                <span className="card-kicker">
                  {phase === "ROUND"
                    ? turn?.sealing
                      ? "POINTS ARE BEING SEALED"
                      : `${turn?.kind || ""} · ${mine ? "YOUR FLOOR" : state.players.find((p) => p.id === turn?.playerId)?.name + "’S FLOOR"}`
                    : phase === "ROUND_RESOLVE"
                      ? "ROUND CLOSED"
                      : phase === "MATCH_RESULT"
                        ? "CASE CLOSED"
                        : phase === "RECOVERING"
                          ? "HOLDING THE FLOOR"
                          : "COURT ADJOURNED"}
                </span>
                <div className="timer">
                  {phase === "ROUND" ? (
                    <>
                      {turn?.sealing ? "···" : seconds}
                      <small>{turn?.sealing ? "" : "SEC"}</small>
                    </>
                  ) : (
                    <span>✦</span>
                  )}
                </div>
                {phase === "ROUND" && (
                  <div className="timer-track">
                    <i
                      style={{
                        width: `${(turn?.durationMs ? (seconds * 1000) / turn.durationMs : 0) * 100}%`,
                      }}
                    />
                  </div>
                )}
                <p>
                  {turn?.pausedReason === "judge"
                    ? "Bonk’s talking. Your clock is paused."
                    : turn?.sealing
                      ? "Making those points official…"
                      : mine
                        ? turn?.kind === "case"
                          ? "Make a claim. Tell us why it matters."
                          : turn?.kind === "rebuttal"
                            ? "Answer their actual argument."
                            : "Make your strongest final point."
                        : "Listen for the argument you can answer."}
                </p>
                {state.comebackPlayerId &&
                  phase === "ROUND" &&
                  turn?.kind === "closing" && (
                    <span className="comeback-label">
                      ✦ COMEBACK WINDOW · EARN IT
                    </span>
                  )}
              </div>
              {(phase === "ROUND_RESOLVE" || phase === "MATCH_RESULT") && (
                <ResultView state={state} me={me} />
              )}
              {(phase === "RECOVERING" || phase === "ABORTED") && (
                <section className="center-card">
                  <span className="card-kicker">
                    {phase === "RECOVERING"
                      ? "A BRIEF RECESS"
                      : "THE JUDGE NEEDS A RECESS"}
                  </span>
                  <h3>
                    {phase === "RECOVERING"
                      ? "Holding your place."
                      : "No invented verdicts."}
                  </h3>
                  <p>{state.status}</p>
                  {phase === "ABORTED" && (
                    <button
                      className="primary"
                      onClick={() =>
                        client.command({ type: "rematch", value: true })
                      }
                    >
                      TRY A FRESH MATCH ↗
                    </button>
                  )}
                </section>
              )}
              {state.degraded.stt &&
                phase === "ROUND" &&
                mine &&
                !turn?.sealing && (
                  <form
                    className="typed-recovery"
                    onSubmit={(e) => {
                      e.preventDefault();
                      client.command({
                        type: "typed_argument",
                        turnId: turn!.id,
                        text: typed,
                      });
                      setTyped("");
                    }}
                  >
                    <label>
                      Transcription recovery · type your argument
                      <input
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        maxLength={1000}
                        required
                      />
                    </label>
                    <button className="primary">SUBMIT</button>
                  </form>
                )}
            </>
          )}
          <Captions state={state} />
          <PlayerControls action={action} />
        </>
      )}
      {(error || connection === "reconnecting") && (
        <div role="status" className="toast">
          {connection === "reconnecting"
            ? "Reconnecting. Your seat is protected."
            : error}
          <button onClick={() => setError("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {rules && (
        <div className="modal-backdrop" onClick={() => setRules(false)}>
          <section className="rules" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setRules(false)}>
              ×
            </button>
            <span className="card-kicker">
              HOW TO GET AWAY WITH A GOOD POINT
            </span>
            <h2>
              Speak. Listen.
              <br />
              Make it count.
            </h2>
            <p>
              First to two round wins. Every round gives you a case, a rebuttal,
              and a closing. Take up to 30 seconds; close in 15. Hit “I’m done”
              when you’ve made your point.
            </p>
            <p>
              Reasoning 35%, rebuttal 30%, impact 20%, wit 10%, clarity 5%. Both
              opening cases skip rebuttal and share the same rubric. Each turn
              can earn 10 points. More words don’t mean more points.
            </p>
            <p>
              Bonk scores what you say, calls out unanswered arguments, and
              gives comebacks a chance. Interruptions never earn points. Judge
              speech pauses the clock.
            </p>
            <label className="reduced">
              <input
                type="checkbox"
                checked={reduced}
                onChange={(e) => setReduced(e.target.checked)}
              />{" "}
              Reduce motion
            </label>
            <button className="primary" onClick={() => setRules(false)}>
              OBJECTION? OVERRULED.
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
