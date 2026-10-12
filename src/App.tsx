import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../shared/domain";
import { client } from "./game/client";
import { Captions } from "./ui/Captions";
import { CoinView } from "./ui/CoinView";
import { Dialog } from "./ui/Dialog";
import { Icon } from "./ui/Icon";
import { LobbyView } from "./ui/LobbyView";
import { PlayerCard } from "./ui/PlayerCard";
import { PlayerControls } from "./ui/PlayerControls";
import { ResultView } from "./ui/ResultView";
import { StageLoader } from "./ui/StageLoader";
import { TitleView } from "./ui/TitleView";
import { TopicView } from "./ui/TopicView";
import { TurnPanel } from "./ui/TurnPanel";
import { useMediaVersion, useReducedMotion, useServerNow } from "./ui/hooks";
import { phaseTitle } from "./ui/presentation";

function Recovery({ state }: { state: Snapshot }) {
  const now = useServerNow(),
    aborted = state.phase === "ABORTED";
  return (
    <section className="phase-panel recovery-panel">
      <Icon name={aborted ? "gavel" : "refresh"} />
      <h2>{aborted ? "Let’s call a recess." : "Holding your place."}</h2>
      <p>{state.status}</p>
      {state.recoveryDeadline && !aborted && (
        <p className="decision-clock">
          {Math.max(0, Math.ceil((state.recoveryDeadline - now) / 1000))}s to
          reconnect
        </p>
      )}
      {aborted && (
        <button
          className="primary"
          disabled={state.rematchReady.includes(client.session?.playerId || "")}
          onClick={() => client.command({ type: "rematch", value: true })}
        >
          {state.rematchReady.includes(client.session?.playerId || "")
            ? "Waiting for your friend"
            : "Try a fresh match"}
          <Icon name="refresh" />
        </button>
      )}
    </section>
  );
}
function AudioSettings({ state }: { state: Snapshot | null }) {
  useMediaVersion();
  return (
    <>
      <p>Control what you hear. Your friend’s settings stay theirs.</p>
      <div className="audio-options">
        <button
          aria-pressed={!client.sound.peerMuted}
          onClick={() => client.sound.mutePeer()}
        >
          <Icon name={client.sound.peerMuted ? "muted" : "volume"} />
          <span>Friend audio</span>
          <b>{client.sound.peerMuted ? "Off" : "On"}</b>
        </button>
        <button
          aria-pressed={!client.sound.judgeMuted}
          onClick={() => client.sound.muteJudge()}
        >
          <Icon name={client.sound.judgeMuted ? "muted" : "volume"} />
          <span>Bonk & effects</span>
          <b>{client.sound.judgeMuted ? "Off" : "On"}</b>
        </button>
      </div>
      <p className="support-copy">
        {state?.mediaMode === "connecting"
          ? "Connecting audio…"
          : state?.mediaMode === "wss"
            ? "Connected through the media relay."
            : "Direct media connected."}
      </p>
    </>
  );
}
export function App() {
  const [state, setState] = useState<Snapshot | null>(client.state),
    [name, setName] = useState(""),
    [code, setCode] = useState(
      new URLSearchParams(location.search).get("room") || "",
    );
  const [joining, setJoining] = useState(/^\d{4}$/.test(code)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [connection, setConnection] = useState("");
  const [dialog, setDialog] = useState<"rules" | "audio" | null>(null),
    [typed, setTyped] = useState(""),
    [celebrate, setCelebrate] = useState(false);
  const [reduced, setReduced] = useReducedMotion();
  const actionLock = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    previousPhase = useRef<string | undefined>(undefined);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let soundAt = 0;
    const seen = new Set<string>();
    const unsub = client.on((u) => {
      if (u.state) setState(u.state);
      if (u.connection) {
        setConnection(u.connection);
        if (u.connection === "left") {
          setState(null);
          setError("");
          setCelebrate(false);
          setTyped("");
        }
      }
      if (u.error) setError(u.error);
      const event = u.event;
      if (!event) return;
      const key = event.snapshot.matchId + ":" + event.seq;
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 256) seen.delete(seen.values().next().value!);
      if (event.type === "score_committed" && Date.now() - soundAt > 450) {
        client.sound.effect("score");
        soundAt = Date.now();
      }
      if (event.type === "coin_committed") client.sound.effect("coin");
      if (event.type === "round_result" || event.type === "match_result") {
        client.sound.effect("verdict");
        setCelebrate(true);
        clearTimeout(timer);
        timer = setTimeout(() => setCelebrate(false), 1200);
      }
    });
    void client.restore();
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (previousPhase.current !== state?.phase) {
      previousPhase.current = state?.phase;
      if (document.activeElement === document.body)
        heading.current?.focus({ preventScroll: true });
      setTyped("");
    }
  }, [state?.phase, state?.turn?.id]);
  useEffect(() => setTyped(""), [state?.turn?.id]);
  const action = async (fn: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };
  const copyInvite = () => {
    if (!state) return;
    if (!navigator.clipboard) {
      setError("Share room code " + state.code + " with your friend.");
      return;
    }
    void navigator.clipboard
      .writeText(location.origin + "?room=" + state.code)
      .then(
        () => setNotice("Invite link copied."),
        () =>
          setError(
            "Couldn’t copy the link. Share room code " +
              state.code +
              " instead.",
          ),
      );
  };
  const me = state?.players.find((p) => p.id === client.session?.playerId),
    other = state?.players.find((p) => p.id !== client.session?.playerId);
  const phase = state?.phase;
  const phaseLabel = !state
    ? ""
    : phase === "ROUND"
      ? "Round " +
        state.round +
        ". " +
        state.players.find((p) => p.id === state.turn?.playerId)?.name +
        " has the floor."
      : phase === "LOBBY"
        ? "Sound check"
        : phase === "TOPIC_SELECT"
          ? "Choose a topic"
          : phase === "TOPIC_CONFIRM"
            ? "Confirm the proposition"
            : phase === "INTRO_COIN"
              ? "The coin has spoken"
              : phase === "ROUND_RESOLVE"
                ? "Round verdict"
                : phase === "MATCH_RESULT"
                  ? "Match verdict"
                  : state.status;
  return (
    <main
      className={
        "app " +
        (state ? "in-room phase-" + phase?.toLowerCase() : "on-title") +
        (reduced ? " reduced-motion" : "")
      }
    >
      <header className="app-header">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (!state) void client.sound.unlock();
          }}
          aria-label="Hear Me Out"
        >
          HEAR ME OUT<span>The court of bad takes</span>
        </a>
        <div className="header-actions">
          {state && (
            <button
              className="room-code"
              onClick={copyInvite}
              aria-label={"Copy invite link for room " + state.code}
            >
              <span>Room</span>
              <b>{state.code}</b>
              <Icon name="copy" />
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => setDialog("rules")}
            aria-label="How to play"
          >
            <Icon name="help" />
          </button>
        </div>
      </header>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {phaseLabel}
      </div>
      {!state ? (
        <TitleView
          name={name}
          code={code}
          joining={joining}
          busy={busy}
          error={error}
          reduced={reduced}
          setName={setName}
          setCode={setCode}
          setJoining={setJoining}
          action={action}
        />
      ) : (
        <>
          <section className="arena-heading">
            {state.round > 0 && (
              <div className="match-progress">
                <>
                  <span>Round {state.round}</span>
                  <span>First to 2 wins</span>
                </>
              </div>
            )}
            <h1 ref={heading} tabIndex={-1}>
              {phaseTitle(state)}
            </h1>
          </section>
          <div className="courtroom">
            <PlayerCard
              player={state.players[0]}
              index={0}
              state={state}
              local={state.players[0]?.id === me?.id}
              reduced={reduced}
            />
            <div className="center-stage">
              <StageLoader state={state} reduced={reduced} />
              <div
                className="phase-content"
                key={
                  phase === "TOPIC_CONFIRM"
                    ? "topic"
                    : phase === "TOPIC_SELECT"
                      ? "topic"
                      : phase
                }
              >
                {phase === "LOBBY" && (
                  <LobbyView
                    state={state}
                    me={me}
                    other={other}
                    busy={busy}
                    action={action}
                    copyInvite={copyInvite}
                  />
                )}
                {phase === "INTRO_COIN" && <CoinView state={state} me={me} />}
                {(phase === "TOPIC_SELECT" || phase === "TOPIC_CONFIRM") && (
                  <TopicView state={state} me={me} />
                )}
                {phase === "ROUND" && (
                  <TurnPanel state={state} playerId={me?.id} />
                )}
                {(phase === "ROUND_RESOLVE" || phase === "MATCH_RESULT") && (
                  <ResultView state={state} me={me} celebrate={celebrate} />
                )}
                {(phase === "RECOVERING" || phase === "ABORTED") && (
                  <Recovery state={state} />
                )}
              </div>
            </div>
            <PlayerCard
              player={state.players[1]}
              index={1}
              state={state}
              local={state.players[1]?.id === me?.id}
              reduced={reduced}
            />
          </div>
          {state.degraded.stt &&
            phase === "ROUND" &&
            state.turn?.playerId === me?.id &&
            !state.turn?.sealing && (
              <form
                className="typed-recovery"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!typed.trim()) return;
                  client.command({
                    type: "typed_argument",
                    turnId: state.turn!.id,
                    text: typed.trim(),
                  });
                  setTyped("");
                }}
              >
                <label htmlFor="typed-argument">
                  Speech recognition is unavailable. Type your argument.
                </label>
                <div>
                  <input
                    id="typed-argument"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    maxLength={1000}
                    required
                  />
                  <button
                    className="primary"
                    disabled={!!state.turn?.pausedReason || !typed.trim()}
                  >
                    Submit
                    <Icon name="arrow" />
                  </button>
                </div>
              </form>
            )}
          <Captions state={state} />
          {(error || connection === "reconnecting") && (
            <div className="room-notice" role="alert">
              <Icon name="warning" />
              <p>
                {connection === "reconnecting"
                  ? "Reconnecting. Your seat is on hold."
                  : error}
              </p>
              {connection !== "reconnecting" && (
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setError("")}
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
          )}
          <PlayerControls
            action={action}
            busy={busy}
            onAudio={() => setDialog("audio")}
          />
        </>
      )}
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" />
          {notice}
        </div>
      )}
      {dialog && (
        <Dialog
          title={
            dialog === "rules" ? "Make your case." : "Sound in your court."
          }
          onClose={() => setDialog(null)}
        >
          {dialog === "audio" ? (
            <AudioSettings state={state} />
          ) : (
            <>
              <p>
                Two friends. One ridiculous proposition. First to two round
                wins.
              </p>
              <ol className="rules-list">
                <li>
                  <strong>Pick your fight.</strong> Heads opens. Tails chooses
                  the topic and a side. You both confirm.
                </li>
                <li>
                  <strong>Speak. Listen. Answer.</strong> Each round: a case, a
                  rebuttal, and a closing for each player. Take 30 seconds, or
                  15 for your closing. “I’m done” passes the floor.
                </li>
                <li>
                  <strong>Earn the verdict.</strong> Up to 10 points per turn,
                  30 per round. More words don’t mean more points. Bonk’s voice
                  pauses the clock.
                </li>
              </ol>
              <details className="rubric">
                <summary>How Bonk scores</summary>
                <p>
                  Reasoning 35%, rebuttal 30%, impact 20%, wit 10%, clarity 5%.
                  Opening cases use reasoning 50%, impact 30%, wit 15%, clarity
                  5%. Bonk scores the argument, never your accent or appearance.
                </p>
              </details>
              <label className="motion-toggle">
                <input
                  type="checkbox"
                  checked={reduced}
                  onChange={(e) => setReduced(e.target.checked)}
                />
                Reduce motion
              </label>
              <button className="primary" onClick={() => setDialog(null)}>
                Got it
                <Icon name="check" />
              </button>
            </>
          )}
        </Dialog>
      )}
    </main>
  );
}
