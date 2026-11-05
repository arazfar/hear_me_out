import { Notice } from "./ui/Notice";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { useCourtPlacement } from "./ui/court-placement";
import {
  useDecision,
  useMediaVersion,
  useReducedMotion,
  useServerNow,
  useKeyboardViewport,
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
      <Icon name={aborted ? "gavel" : readiness.icon || "connection"} />
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
          className={
            "primary" + (rematch.ready && !pending ? " accepted-button" : "")
          }
          disabled={!me.mediaReady || rematch.ready || !!pending}
          aria-busy={!!pending}
          onClick={() => submit({ type: "rematch", value: true })}
        >
          {pending ? "Queuing rematch…" : rematch.actionLabel}
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
export function App() {
  useMediaVersion();
  useKeyboardViewport();
  const [state, setState] = useState<Snapshot | null>(client.state),
    [name, setName] = useState(""),
    [code, setCode] = useState(
      new URLSearchParams(location.search).get("room") || "",
    );
  const [joining, setJoining] = useState(/^\d{4}$/.test(code)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false),
    [celebrate, setCelebrate] = useState(false),
    [reveal, setReveal] = useState(false);
  const reduced = useReducedMotion();
  const actionLock = useRef(false),
    lowerCourt = useRef<HTMLDivElement>(null),
    mediaTrigger = useRef<HTMLButtonElement>(null),
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
    let navigationSuspended = false;
    const visibility = () => {
      client.video.setPageActive(!document.hidden && !navigationSuspended);
      client.notify({ feedbackReset: true });
      void client.reportHealth();
    };
    // WebKit stops permitting Blob reads after beforeunload, while the old
    // document can still receive frames before pagehide/visibilitychange.
    let resumeVideoFrame = 0;
    const hideVideo = () => {
      navigationSuspended = true;
      cancelAnimationFrame(resumeVideoFrame);
      resumeVideoFrame = 0;
      client.video.setPageActive(false);
    };
    const showVideo = () => {
      navigationSuspended = false;
      cancelAnimationFrame(resumeVideoFrame);
      resumeVideoFrame = 0;
      client.video.setPageActive(!document.hidden);
    };
    const beforeUnload = () => {
      hideVideo();
      // WebKit suspends rendering during navigation. If navigation is aborted,
      // the next frame resumes video without waiting for a pageshow that never
      // arrives. A successful navigation cancels this callback in pagehide.
      resumeVideoFrame = requestAnimationFrame(showVideo);
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", hideVideo);
    window.addEventListener("pageshow", showVideo);
    void client.restore();
    return () => {
      unsub();
      clearTimeout(timer);
      clearTimeout(coinTimer);
      document.removeEventListener("visibilitychange", visibility);
      cancelAnimationFrame(resumeVideoFrame);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", hideVideo);
      window.removeEventListener("pageshow", showVideo);
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
  const readiness = currentReadinessPresentation();
  const repairing =
    phase === "RECOVERING" ||
    phase === "ABORTED" ||
    (phase === "MATCH_RESULT" && !me?.mediaReady);
  const taskIdentity = JSON.stringify([
    state?.roomId,
    state?.matchId,
    phase,
    state?.roundId,
    state?.turn?.id,
    state?.topic?.revision,
    repairing ? [readiness.action, readiness.icon, readiness.repair] : null,
  ]);
  useLayoutEffect(() => {
    if (lowerCourt.current) lowerCourt.current.scrollTop = 0;
  }, [taskIdentity]);
  const inRoom = !!state && !client.setup.inline;
  const placement = useCourtPlacement(inRoom, taskIdentity);
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
            onClick={() => setRulesOpen(true)}
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
          <div className="room-scroll" aria-label="Game court">
            <div className="court-content">
              <section
                className={
                  "arena-heading " +
                  (phase === "MATCH_RESULT"
                    ? "match-complete"
                    : !state.topic
                      ? "no-topic"
                      : "")
                }
                tabIndex={
                  state.topic && phase !== "MATCH_RESULT" ? 0 : undefined
                }
                aria-label={
                  state.topic && phase !== "MATCH_RESULT"
                    ? "Current topic"
                    : undefined
                }
              >
                {state.round > 0 && phase !== "MATCH_RESULT" && (
                  <div className="match-progress">
                    <>
                      <span>Round {state.round}</span>
                    </>
                  </div>
                )}
                <h1
                  ref={heading}
                  tabIndex={-1}
                  className={
                    !state.topic || phase === "MATCH_RESULT"
                      ? "sr-only"
                      : undefined
                  }
                >
                  {phaseTitle(state)}
                </h1>
              </section>
              <div className="courtroom" ref={placement.court}>
                <div className="players">
                  <PlayerCard
                    player={state.players[0]}
                    index={0}
                    state={state}
                    local={state.players[0]?.id === me?.id}
                    reduced={reduced}
                  />
                  <PlayerCard
                    player={state.players[1]}
                    index={1}
                    state={state}
                    local={state.players[1]?.id === me?.id}
                    reduced={reduced}
                  />
                </div>
                <div
                  className="court-lower"
                  ref={lowerCourt}
                  tabIndex={0}
                  role="region"
                  aria-label="Court activity"
                >
                  <div className="court-lower-content" ref={placement.content}>
                    <div className="center-stage">
                      <StageLoader state={state} reduced={reduced} />
                      {phase === "ROUND" && <BonkReaction state={state} />}
                      <div
                        className="phase-content"
                        tabIndex={0}
                        role="region"
                        aria-label="Game actions"
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
                        {(phase === "TOPIC_SELECT" ||
                          phase === "TOPIC_CONFIRM") && (
                          <TopicView state={state} me={me} />
                        )}
                        {phase === "ROUND" && (
                          <TurnPanel state={state} playerId={me?.id} />
                        )}
                        {(phase === "ROUND_RESOLVE" ||
                          phase === "MATCH_RESULT") && (
                          <ResultView
                            state={state}
                            me={me}
                            celebrate={celebrate}
                          />
                        )}
                        {(phase === "RECOVERING" || phase === "ABORTED") && (
                          <Recovery state={state} />
                        )}
                      </div>
                    </div>
                    <Captions state={state} fallbackFocus={mediaTrigger} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <PlayerControls
            triggerRef={mediaTrigger}
            notification={
              <>
                {error && !client.reconnecting && (
                  <Notice onDismiss={() => setError("")}>{error}</Notice>
                )}
                {notice && <Notice>{notice}</Notice>}
              </>
            }
            dialogOpen={rulesOpen}
            action={action}
            busy={busy}
            audioConnecting={state.mediaMode === "connecting"}
          />
        </>
      )}
      {notice && !inRoom && <Notice>{notice}</Notice>}
      {rulesOpen && (
        <Dialog title="How to play" onClose={() => setRulesOpen(false)}>
          <ol className="rules-list">
            <li>Pick a topic and your side.</li>
            <li>Speak when your card lights up. Tap “I’m done” to finish.</li>
            <li>Win two rounds to win the match.</li>
          </ol>
          <button className="primary" onClick={() => setRulesOpen(false)}>
            Got it
          </button>
        </Dialog>
      )}
    </main>
  );
}
