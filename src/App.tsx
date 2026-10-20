import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../shared/domain";
import { client } from "./game/client";
import {
  ConnectionCheck,
  RecoveryCheck,
  currentReadinessPresentation,
} from "./ui/DeviceCheck";
import { BonkReaction } from "./ui/BonkReaction";
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
import {
  useDecision,
  useMediaVersion,
  useReducedMotion,
  useServerNow,
} from "./ui/hooks";
import {
  phaseAnnouncement,
  phaseTitle,
  rematchPresentation,
} from "./ui/presentation";

function Recovery({ state }: { state: Snapshot }) {
  const { pending, error, submit } = useDecision(state);
  const now = useServerNow(),
    disconnected = client.reconnecting,
    aborted = state.phase === "ABORTED" && !disconnected,
    departed = aborted && state.players.length < 2;
  const me = state.players.find((p) => p.id === client.session?.playerId);
  const other = state.players.find((p) => p.id !== me?.id);
  const readiness = currentReadinessPresentation();
  const rematch = rematchPresentation(state, me?.id, readiness);
  return (
    <section className="phase-panel recovery-panel">
      <Icon name={aborted ? "gavel" : "refresh"} />
      {aborted && <h2>Match interrupted</h2>}
      {disconnected ? (
        <ConnectionCheck heading />
      ) : !aborted ? (
        <RecoveryCheck heading />
      ) : (
        <p>{state.status}</p>
      )}
      {departed && (
        <button className="primary" onClick={() => client.leave()}>
          Back to menu
          <Icon name="arrow" />
        </button>
      )}
      {aborted && !departed && !me?.mediaReady && <RecoveryCheck />}
      {state.recoveryDeadline && !aborted && !disconnected && (
        <p className="decision-clock">
          {Math.max(0, Math.ceil((state.recoveryDeadline - now) / 1000))}s to
          reconnect
        </p>
      )}
      {aborted && !departed && me?.mediaReady && (
        <button
          className="primary"
          disabled={!me.mediaReady || rematch.ready || !!pending}
          aria-busy={!!pending}
          onClick={() => submit({ type: "rematch", value: true })}
        >
          {pending ? "Queuing rematch…" : rematch.actionLabel}
          <Icon name="refresh" />
        </button>
      )}
      {error && (
        <p className="decision-error" role="alert">
          {error}
        </p>
      )}
      {aborted &&
        !departed &&
        me?.mediaReady &&
        other &&
        !other.mediaReady &&
        readiness.message && (
          <p className="support-copy">{readiness.message}</p>
        )}
    </section>
  );
}
function AudioSettings({ state }: { state: Snapshot | null }) {
  useMediaVersion();
  return (
    <>
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
      {state?.mediaMode === "connecting" && (
        <p className="support-copy">Connecting audio…</p>
      )}
    </>
  );
}
export function App() {
  useMediaVersion();
  const [state, setState] = useState<Snapshot | null>(client.state),
    [name, setName] = useState(""),
    [code, setCode] = useState(
      new URLSearchParams(location.search).get("room") || "",
    );
  const [joining, setJoining] = useState(/^\d{4}$/.test(code)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"rules" | "audio" | null>(null),
    [celebrate, setCelebrate] = useState(false),
    [reveal, setReveal] = useState(false);
  const [reduced, setReduced] = useReducedMotion();
  const actionLock = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    previousPhase = useRef<string | undefined>(undefined);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let coinTimer: ReturnType<typeof setTimeout> | undefined;
    let noticeContext = client.state;
    const unsub = client.on((u) => {
      if (u.state) {
        // Clear in message order, preserving any error from the new match.
        if (
          u.state.roomId !== noticeContext?.roomId ||
          u.state.matchId !== noticeContext?.matchId
        )
          setError("");
        noticeContext = u.state;
        setState(u.state);
      }
      if (u.connection) {
        if (u.connection === "left") {
          setState(null);
          setError("");
          setCelebrate(false);
        }
      }
      if (u.error) setError(u.error);
      if (u.feedbackReset) {
        setCelebrate(false);
        setReveal(false);
        clearTimeout(timer);
        clearTimeout(coinTimer);
      }
      const cue = u.feedback;
      if (!cue) return;
      if (cue.kind === "coin") {
        client.sound.effect("coin");
        setReveal(true);
        clearTimeout(coinTimer);
        coinTimer = setTimeout(() => setReveal(false), 850);
      }
      if (cue.kind === "round" || cue.kind === "match") {
        client.sound.effect("verdict");
        setCelebrate(true);
        clearTimeout(timer);
        timer = setTimeout(() => setCelebrate(false), 1200);
      }
    });
    const visibility = () => {
      if (document.hidden) client.video.cancelFrameRead();
      client.notify({ feedbackReset: true });
      void client.reportHealth();
    };
    const pagehide = () => client.video.resetVideo();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    void client.restore();
    return () => {
      unsub();
      clearTimeout(timer);
      clearTimeout(coinTimer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pagehide);
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
    }
  }, [state?.phase, state?.turn?.id]);
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
  const phase = client.reconnecting ? "RECOVERING" : state?.phase;
  const inRoom = !!state && !client.setup.inline;
  const readiness = currentReadinessPresentation();
  const phaseLabel = !inRoom
    ? ""
    : phaseAnnouncement(state, me?.id, readiness, {
        reconnecting: client.reconnecting,
        pendingDone: client.capture.pendingDone,
        finished: client.playback.finished,
        rendering: client.playback.rendering,
        privateCheck: client.capture.privateCheck(),
      });
  return (
    <main
      className={
        "app " +
        (inRoom ? "in-room phase-" + phase?.toLowerCase() : "on-title") +
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
          HEAR ME OUT
        </a>
        <div className="header-actions">
          {state && (state.phase !== "LOBBY" || state.players.length === 2) && (
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
      {!inRoom ? (
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
          <section
            className={"arena-heading " + (!state.topic ? "no-topic" : "")}
          >
            {state.round > 0 && (
              <div className="match-progress">
                <>
                  <span>Round {state.round}</span>
                </>
              </div>
            )}
            <h1
              ref={heading}
              tabIndex={-1}
              className={!state.topic ? "sr-only" : undefined}
            >
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
              {phase === "ROUND" && <BonkReaction state={state} />}
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
                    copyInvite={copyInvite}
                  />
                )}
                {phase === "INTRO_COIN" && (
                  <CoinView state={state} me={me} reveal={reveal} />
                )}
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
          <Captions state={state} />
          {error && !client.reconnecting && (
            <div className="room-notice" role="alert">
              <Icon name="warning" />
              <p>{error}</p>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <Icon name="close" />
              </button>
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
          title={dialog === "rules" ? "How to play" : "Sound"}
          onClose={() => setDialog(null)}
        >
          {dialog === "audio" ? (
            <AudioSettings state={state} />
          ) : (
            <>
              <p>Win two rounds to win the match.</p>
              <ol className="rules-list">
                <li>
                  Heads goes first. Tails picks the topic and a side. Both
                  players confirm.
                </li>
                <li>
                  Each round, you both make a case, rebut, and close. You get 30
                  seconds per turn, 15 for your closing. “I’m done” passes the
                  floor.
                </li>
                <li>
                  Earn up to 10 points per turn, 30 per round. Points reset each
                  round. Bonk pauses the clock while speaking.
                </li>
              </ol>
              <p className="support-copy">
                Chat anytime. Bonk scores whoever has the floor. Pauses keep
                your turn.
              </p>
              <p className="support-copy">
                Headphones help keep your friend’s voice out of your mic.
              </p>
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
