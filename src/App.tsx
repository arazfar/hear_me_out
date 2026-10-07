import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "./client";
import { Stage } from "./Stage";
import {
  canSpeak,
  scoreShare,
  points,
  SUGGESTIONS,
  type Snapshot,
  type Player,
} from "../shared/types";
function AnimatedScore({
  units,
  reduced,
  roundId,
}: {
  units: number;
  reduced: boolean;
  roundId: string | null;
}) {
  const [display, setDisplay] = useState(units);
  const displayRef = useRef(units);
  const previousRound = useRef(roundId);
  useEffect(() => {
    if (
      reduced ||
      units <= displayRef.current ||
      previousRound.current !== roundId
    ) {
      previousRound.current = roundId;
      displayRef.current = units;
      setDisplay(units);
      return;
    }
    const from = displayRef.current,
      began = performance.now();
    let frame = 0;
    const tally = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - began - 180) / 460));
      const next = Math.min(
        units,
        Math.floor(from + (units - from) * (1 - (1 - t) ** 3)),
      );
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) frame = requestAnimationFrame(tally);
    };
    frame = requestAnimationFrame(tally);
    return () => cancelAnimationFrame(frame);
  }, [units, reduced, roundId]);
  return (
    <span
      className={`score ${display !== units ? "tallying" : ""}`}
      aria-label={`${points(units)} points`}
    >
      <span className="score-numbers">{points(display)}</span>
      <small>PTS</small>
    </span>
  );
}
function Face({
  player,
  index,
  state,
  local,
  burst,
  level,
  reduced,
}: {
  player?: Player;
  index: number;
  state: Snapshot;
  local: boolean;
  burst?: string;
  level: number;
  reduced: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const relayCanvas = useRef<HTMLCanvasElement>(null);
  const winner =
    state.phase === "MATCH_RESULT" && state.winnerId === player?.id;
  const active = state.turn?.playerId === player?.id && state.phase === "ROUND";
  const ownScores = state.ledger.filter(
    (e) => e.playerId === player?.id && e.roundId === state.roundId,
  );
  const recentTurn = ownScores.at(-1)?.turnId;
  const priority = { rebuttal: 5, reasoning: 4, impact: 3, wit: 2, clarity: 1 };
  const lastScore = ownScores
    .filter((e) => e.turnId === recentTurn)
    .sort(
      (a, b) => priority[b.criterion] - priority[a.criterion] || b.at - a.at,
    )[0];
  useEffect(() => {
    if (video.current) {
      const desired = local ? client.stream : client.remote;
      if (video.current.srcObject !== desired)
        video.current.srcObject = desired;
      video.current.muted = local || client.peerMuted || !canSpeak(state, player?.id || null);
      video.current.volume = 1;
      void video.current.play().catch(() => {});
    }
  }, [
    local,
    client.stream,
    client.remote,
    state.mediaMode,
    player?.cameraOn,
    client.cameraOff,
    state.turn?.suppressOpponent,
    state.turn?.playerId,
    state.turn?.pausedReason,
    state.turn?.sealing,
    state.phase,
    state.judge?.status,
    client.peerMuted,
  ]);
  useEffect(() => {
    if (relayCanvas.current && client.remoteCanvas && client.remoteFrame)
      relayCanvas.current.getContext("2d")?.drawImage(client.remoteCanvas, 0, 0, 256, 144);
  }, [client.remoteFrameSeq, client.remoteFrame, state.mediaMode, player?.cameraOn]);
  const attachVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      video.current = node;
      if (!node) return;
      const desired = local ? client.stream : client.remote;
      if (node.srcObject !== desired) node.srcObject = desired;
      if (node.paused) void node.play().catch(() => {});
    },
    [local, client.stream, client.remote],
  );
  const camera = player?.cameraOn && (local ? !client.cameraOff : true);
  const media = local
    ? client.stream
    : state.mediaMode === "rtc"
      ? client.remote
      : null;
  return (
    <article
      className={`face face-${index} ${active ? "has-floor" : ""} ${burst ? "scored" : ""} ${winner ? "winner" : ""}`}
    >
      <div className="face-top">
        <span className="name">{player?.name || "Your worthy opponent"}</span>
        <span className="live">
          <i className={level > 0.08 ? "lit" : ""} />
          {player?.connected ? "LIVE" : "WAITING"}
        </span>
      </div>
      <div className="face-picture">
        {camera && (media || (!local && client.remoteFrame)) ? (
          <>
            {!local && state.mediaMode !== "rtc" ? (
              <canvas ref={relayCanvas} width={256} height={144} role="img" aria-label={`${player?.name}'s live camera`} />
            ) : (
              <video
                ref={attachVideo}
                autoPlay
                playsInline
                muted={local || client.peerMuted || !canSpeak(state, player?.id || null)}
                style={{ transform: local ? "scaleX(-1)" : undefined }}
              />
            )}
          </>
        ) : (
          <div className="avatar">
            <span>{player?.name?.slice(0, 1).toUpperCase() || "?"}</span>
            <small>{player ? "Camera off" : "Send them the room code"}</small>
          </div>
        )}
        {!local && camera && state.mediaMode !== "rtc" && (!client.remoteFrameAt || Date.now() - client.remoteFrameAt > 2000) && <span className="camera-status">Connecting camera…</span>}
        {active && (
          <span className="floor-tag">
            {state.turn?.sealing ? "✦ CASE PRESENTED" : "✦ HAS THE FLOOR"}
          </span>
        )}
        {state.phase === "MATCH_RESULT" && (
          <span className="floor-tag">
            {winner ? "✦ WINNER" : "APPEAL PENDING"}
          </span>
        )}
      </div>
      {state.phase === "ROUND" && <div className="speaking-status">{canSpeak(state, player?.id || null) ? (local && client.micMuted ? "MIC OFF · your turn" : "Your turn") : state.judge?.status !== "silent" && state.judge ? "Muted · Bonk is talking" : state.turn?.sealing ? "Muted · judging argument" : "Muted · opponent’s turn"}</div>}
      <div className="face-bottom">
        <span className="position">
          {state.topic?.positions[player?.id || ""] ||
            (local ? "That’s you" : "Bring a questionable opinion")}
        </span>
        <AnimatedScore
          units={player?.scoreUnits || 0}
          reduced={reduced}
          roundId={state.roundId}
        />
        {burst && (
          <div className="score-explosion" key={burst} aria-hidden="true">
            <i className="burst-ring" />
            <span className="burst-star">✦</span>
            {Array.from({ length: 12 }, (_, i) => (
              <i
                key={i}
                className="burst-piece"
                style={
                  {
                    "--dx": `${Math.cos((i * Math.PI) / 6) * (45 + (i % 3) * 12)}px`,
                    "--dy": `${Math.sin((i * Math.PI) / 6) * (45 + (i % 3) * 12)}px`,
                    "--spin": `${i * 73}deg`,
                    background: ["#D8FF3E", "#FF4F9A", "#39D8F2", "#FFF0CE"][
                      i % 4
                    ],
                  } as React.CSSProperties
                }
              />
            ))}
            <div className="score-burst">
              <small>THAT COOKS!</small>
              <b>{burst}</b>
            </div>
          </div>
        )}
      </div>
      {lastScore && (
        <div className="score-note">
          <b>
            {lastScore.criterion} +{points(lastScore.deltaUnits)}
          </b>
          <span title={lastScore.reason}>{lastScore.reason}</span>
        </div>
      )}
      <div
        className="round-pips"
        aria-label={`${player?.wins || 0} round wins`}
      >
        {[0, 1].map((n) => (
          <i key={n} className={(player?.wins || 0) > n ? "won" : ""} />
        ))}
        <span>
          {state.phase === "LOBBY"
            ? player?.ready
              ? "READY ✓"
              : player?.mediaReady
                ? "DEVICES READY"
                : "CHECKING DEVICES"
            : "ROUND WINS"}
        </span>
      </div>
      {active && local && !state.turn?.sealing && (
        <div className="player-yield">
          <button
            className="primary"
            disabled={!canSpeak(state, player?.id || null)}
            onClick={() =>
              client.command({
                type: "done",
                turnId: state.turn!.id,
                lastAudioSeq: client.audioSeq,
              })
            }
          >
            I’M DONE ↗
          </button>
        </div>
      )}
    </article>
  );
}
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
        const score = e.payload as any;
        const previous = bursts.current[score.playerId];
        if (previous) clearTimeout(previous.timer);
        const units =
          (previous && Date.now() - previous.at < 500 ? previous.units : 0) +
          score.deltaUnits;
        setBurst((v) => ({ ...v, [score.playerId]: `+${points(units)}` }));
        if (Date.now() - lastScoreSound.current > 450) {
          client.effect("score");
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
      if (e?.type === "coin_committed") client.effect("coin");
      if (e?.type === "match_result" || e?.type === "round_result")
        client.effect("verdict");
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
            if (!state) void client.unlock();
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
      <Stage state={state} reduced={reduced} />
      {!state ? (
        <section className="title-layout">
          <div className="title-copy">
            <span className="eyebrow">
              <i /> TWO FRIENDS. ONE TERRIBLE TAKE.
            </span>
            <h1>
              HEAR
              <br />
              ME{" "}
              <span>
                OUT<span className="asterisk">✳</span>
              </span>
              <b className="period">.</b>
            </h1>
            <p>
              Make your case.
              <br />
              Watch your friend get cooked.
            </p>
            <div className="title-sticker">
              JUDGED BY
              <br />
              <strong>
                THE HONORABLE
                <br />
                BONK
              </strong>
              <span>✦ ABSURDLY FAIR ✦</span>
            </div>
          </div>
          <div className="entry-card">
            <span className="card-kicker">THE COURT IS NOW IN SESSION</span>
            <h2>
              Bring a friend.
              <br />
              Bring a bad opinion.
            </h2>
            <label>
              Your name
              <input
                autoComplete="nickname"
                value={name}
                maxLength={20}
                placeholder="What should Bonk call you?"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {joining && (
              <label>
                Room code
                <input
                  inputMode="numeric"
                  value={code}
                  placeholder="0000"
                  maxLength={4}
                  className="code-input"
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </label>
            )}
            <button
              className="primary"
              disabled={busy || !name.trim() || (joining && code.length !== 4)}
              onClick={() =>
                void action(() =>
                  client.enter(joining ? "join" : "create", name, code),
                )
              }
            >
              {busy
                ? "Opening court…"
                : joining
                  ? "JOIN THE ROOM ↗"
                  : "CREATE A ROOM ↗"}
            </button>
            <button
              className="text-button"
              onClick={() => {
                setJoining(!joining);
                setCode(new URLSearchParams(location.search).get("room") || "");
              }}
            >
              {joining
                ? "Start your own argument instead"
                : "Got a code? Join your friend"}
            </button>
            <p className="tiny">
              2 players · camera + microphone · headphones recommended
            </p>
          </div>
          <div className="title-bottom">
            <span>NO EXPERTISE REQUIRED.</span>
            <span>JUST UNREASONABLE CONFIDENCE.</span>
          </div>
        </section>
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
            <Face
              reduced={reduced}
              player={state.players[0]}
              index={0}
              local={state.players[0]?.id === me?.id}
              state={state}
              level={levels[state.players[0]?.id] || 0}
              burst={burst[state.players[0]?.id]}
            />
            <Face
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
            <section className="center-card lobby">
              <span className="card-kicker">A VERY SERIOUS SOUND CHECK</span>
              <h3>
                {other ? "The jury is assembled." : "Invite your accomplice."}
              </h3>
              {!other && <div className="big-code">{state.code}</div>}
              <p>
                {other
                  ? "Say something. Can you hear each other? Then both hit Ready."
                  : "Send your friend the room code. No sign-up, no dignity required."}
              </p>
              {!client.stream ? (
                <>
                  <button
                    className="primary"
                    onClick={() => void action(() => client.devices())}
                  >
                    ENABLE CAMERA + MIC
                  </button>
                  <p className="tiny">
                    Blocked? Allow microphone in Chrome’s site controls, then
                    retry.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => void action(() => client.devices(false))}
                  >
                    Join with microphone only
                  </button>
                </>
              ) : (
                <>
                  <div className="mic-check">
                    <span>MIC CHECK</span>
                    <div>
                      <i
                        style={{
                          width: `${Math.max(3, Math.min(100, client.micLevel * 700))}%`,
                        }}
                      />
                    </div>
                    <span>{client.micMuted ? "MUTED" : "SAY HELLO"}</span>
                  </div>
                  <button
                    className="primary"
                    disabled={!me?.mediaReady || !other || busy}
                    onClick={() =>
                      client.command({ type: "ready", value: !me?.ready })
                    }
                  >
                    {me?.ready
                      ? "READY ✓ · WAITING FOR FRIEND"
                      : !other
                        ? "WAITING FOR YOUR FRIEND"
                        : !me?.mediaReady
                          ? "CONNECTING AUDIO…"
                          : "I’M READY TO ARGUE ↗"}
                  </button>
                </>
              )}
              <span className="transport-label">
                {state.mediaMode === "connecting"
                  ? "Connecting your devices…"
                  : state.mediaMode === "rtc"
                    ? "Direct media connected"
                    : "Relay media connected · 15 fps camera"}
              </span>
            </section>
          )}
          {phase === "INTRO_COIN" && (
            <section className="center-card coin-card">
              <span className="card-kicker">THE COIN HAS SPOKEN</span>
              <div className="coin-token">✦</div>
              <h3>
                {state.players.find((p) => p.id === state.headsId)?.name} opens.
              </h3>
              <p>
                {state.players.find((p) => p.id === state.tailsId)?.name}{" "}
                chooses the topic and their side.
              </p>
              <span className="pill">
                YOUR ROLE:{" "}
                {me?.id === state.headsId
                  ? "HEADS · OPEN THE CASE"
                  : "TAILS · PICK THE TOPIC"}
              </span>
            </section>
          )}
          {selecting && (
            <section className="center-card topic-card">
              <span className="card-kicker">
                {state.tailsId === me?.id
                  ? "YOUR PICK, TAILS"
                  : "TAILS IS PICKING"}
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
                        {
                          state.players.find((p) => p.id === state.tailsId)
                            ?.name
                        }{" "}
                        is choosing.
                      </h3>
                      <p>
                        Keep a ridiculous example ready. Bonk respects a good
                        argument, even a very silly one.
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
                <section className="result-card">
                  <span className="card-kicker">
                    {phase === "MATCH_RESULT" ? "THE VERDICT" : "ROUND VERDICT"}
                  </span>
                  <h2>
                    {
                      state.players.find(
                        (p) =>
                          p.id ===
                          (phase === "MATCH_RESULT"
                            ? state.winnerId
                            : state.results.at(-1)?.winnerId),
                      )?.name
                    }
                    <br />
                    <em>
                      {phase === "MATCH_RESULT"
                        ? "wins the case."
                        : "takes the round."}
                    </em>
                  </h2>
                  <p>{state.results.at(-1)?.reason}</p>
                  {state.results.at(-1)?.tieBreak && (
                    <p className="tiny">{state.results.at(-1)?.tieBreak}</p>
                  )}
                  {phase === "MATCH_RESULT" && (
                    <div className="confetti" aria-hidden="true">
                      {Array.from({ length: 12 }, (_, i) => (
                        <i
                          key={i}
                          style={{
                            left: `${i * 9}%`,
                            background: ["#FF4F9A", "#39D8F2", "#20102E"][
                              i % 3
                            ],
                            animationDelay: `${i * 0.06}s`,
                            rotate: `${i * 37}deg`,
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {phase === "MATCH_RESULT" && (
                    <button
                      className="primary"
                      disabled={state.rematchReady.includes(me!.id)}
                      onClick={() =>
                        client.command({ type: "rematch", value: true })
                      }
                    >
                      {state.rematchReady.includes(me!.id)
                        ? "REMATCH READY ✓"
                        : "AGAIN. OBVIOUSLY. ↗"}
                    </button>
                  )}
                </section>
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
          <div className="caption-zone" aria-live="polite">
            {state.judge && state.judge.status !== "silent" ? (
              <div className="judge-caption">
                <span>BONK {state.judgePending ? "···" : "✦"}</span>
                <p>“{state.judge.text}”</p>
              </div>
            ) : phase === "ROUND" ? (
              <div className="player-captions">
                {state.players.map((p) => (
                  <p key={p.id}>
                    <b>{p.name}</b>
                    {state.captions[p.id]?.text?.slice(-240) || "…"}
                  </p>
                ))}
              </div>
            ) : (
              <div className="judge-caption quiet">
                <span>BONK ✦</span>
                <p>
                  {phase === "LOBBY"
                    ? "“A strong opinion is not the same as a strong argument. Luckily, this is a game.”"
                    : state.status}
                </p>
              </div>
            )}
          </div>
          <footer className="controls">
            <div>
              <button
                onClick={() => client.muteMic()}
                className={client.micMuted ? "muted" : ""}
              >
                {client.micMuted ? "MIC OFF" : client.microphoneAllowed() ? "MIC ON" : "AUTO MUTED"} <span>●</span>
              </button>
              <button onClick={() => client.muteCamera()}>
                {client.cameraOff ? "CAM OFF" : "CAM ON"} <span>▣</span>
              </button>
              {!client.stream && (
                <button onClick={() => void action(() => client.devices())}>
                  ENABLE DEVICES
                </button>
              )}
            </div>
            <div>
              <button onClick={() => client.mutePeer()}>
                {client.peerMuted ? "FRIEND MUTED" : "FRIEND AUDIO"}
              </button>
              <button onClick={() => client.muteJudge()}>
                {client.judgeMuted ? "BONK MUTED" : "BONK AUDIO"}
              </button>
              <button onClick={() => client.leave()}>LEAVE ↗</button>
            </div>
          </footer>
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
