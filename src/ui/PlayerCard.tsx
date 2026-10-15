import { useCallback, useEffect, useRef, useState } from "react";
import {
  judgeIsListening,
  points,
  type Player,
  type Snapshot,
} from "../../shared/domain";
import { client } from "../game/client";
import { AnimatedScore } from "./AnimatedScore";
import { ScoreBurst } from "./ScoreBurst";
import { Icon } from "./Icon";
import { useMediaVersion } from "./hooks";
import { playerStatus } from "./presentation";
import { AwardQueue, type AwardNotice } from "../game/award-queue";

export function PlayerCard({
  player,
  index,
  state,
  local,
  reduced,
}: {
  player?: Player;
  index: number;
  state: Snapshot;
  local: boolean;
  reduced: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null),
    relayCanvas = useRef<HTMLCanvasElement>(null),
    activity = useRef<HTMLSpanElement>(null);
  const [award, setAward] = useState<AwardNotice | null>(null);
  const [winPulse, setWinPulse] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const version = useMediaVersion();
  const active =
    !client.reconnecting &&
    judgeIsListening(state, player?.id || null) &&
    !(local && client.capture.pendingDone === state.turn?.id);
  const winner =
    state.phase === "MATCH_RESULT" && state.winnerId === player?.id;
  const offlineResult =
    state.phase === "MATCH_RESULT" && player?.connected === false;
  const showScore = state.round > 0;
  const emptyStatus =
    state.phase === "ABORTED" ? "Left the court" : "Waiting for your friend";
  const status =
    local && client.capture.privateCheck()
      ? "Private mic check"
      : client.reconnecting ||
          (local && client.capture.pendingDone === state.turn?.id)
        ? ""
        : playerStatus(state, player, local, client.capture.micMuted);
  const camera =
    !offlineResult &&
    !!player?.cameraOn &&
    (local ? !client.capture.cameraOff : true);
  const interrupted = player?.readiness?.blockers.some((b) =>
    ["camera", "camera_delivery", "connection"].includes(b),
  );
  const media = local
    ? client.capture.stream
    : state.mediaMode === "rtc"
      ? client.peer.remote
      : null;
  const showVideo = camera && !!media;
  const showRelay =
    camera && !local && state.mediaMode === "wss" && !!client.video.remoteFrame;
  // Peer audio uses the unlocked Web Audio path; video stays autoplay-safe on phones.
  const muted = true;
  const attach = useCallback((node: HTMLVideoElement | null) => {
    video.current = node;
  }, []);
  useEffect(() => {
    if (!video.current) return;
    if (video.current.srcObject !== media) video.current.srcObject = media;
    video.current.muted = muted;
    if (media) void video.current.play().catch(() => {});
    if (showRelay && relayCanvas.current && client.video.remoteCanvas)
      relayCanvas.current
        .getContext("2d")
        ?.drawImage(client.video.remoteCanvas, 0, 0, 256, 144);
  }, [media, muted, showRelay, version]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const queue = new AwardQueue();
    let displayTimer: ReturnType<typeof setTimeout> | undefined;
    const display = () => {
      clearTimeout(displayTimer);
      const now = performance.now();
      const { notice, started, completed, nextAt } = queue.advance(now);
      setAward(notice);
      if (started && !document.hidden) client.sound.effect("score");
      if (completed)
        setAnnouncement(
          `+${points(completed.deltaUnits)}. ${points(completed.totalUnits)} points.`,
        );
      if (Number.isFinite(nextAt))
        displayTimer = setTimeout(display, Math.max(1, nextAt - now));
    };
    const clear = () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      clearTimeout(displayTimer);
      queue.clear();
      setAward(null);
      setWinPulse(false);
      setAnnouncement("");
    };
    clear();
    const later = (fn: () => void, ms: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
    };
    const unsub = client.on((u) => {
      if (u.activity && u.activity.playerId === player?.id && activity.current)
        activity.current.style.setProperty(
          "--level",
          String(Math.max(0.12, u.activity.level)),
        );
      if (u.feedbackReset) clear();
      const cue = u.feedback;
      if (!cue || cue.playerId !== player?.id) return;
      if (cue.kind === "score") {
        queue.enqueue(cue);
        display();
      }
      if (cue.kind === "round" || cue.kind === "match") {
        setWinPulse(true);
        later(() => setWinPulse(false), 700);
      }
    });
    return () => {
      unsub();
      clear();
    };
  }, [player?.id, state.matchId, state.roundId]);
  return (
    <article
      className={
        "face face-" +
        index +
        (showScore ? " scored" : "") +
        (active ? " has-floor" : "") +
        (winner ? " winner" : "")
      }
      aria-label={(player?.name || "Empty seat") + (local ? ", you" : "")}
    >
      <div className="face-heading">
        <h2>
          {player?.name || "Your friend"}
          {local && <span className="you-label">you</span>}
        </h2>
        <span
          className="activity"
          ref={activity}
          role="img"
          aria-label="Voice activity"
        >
          <i />
          <i />
          <i />
        </span>
        <div className="face-meta">
          {showScore && (
            <div
              className={"round-pips " + (winPulse ? "win-pulse" : "")}
              role="img"
              aria-label={(player?.wins || 0) + " of 2 round wins"}
              title={(player?.wins || 0) + " of 2 round wins"}
            >
              <small>Rounds</small>
              {[0, 1].map((n) => (
                <span
                  key={n}
                  className={
                    (player?.wins || 0) > n
                      ? "won" +
                        (n === (player?.wins || 0) - 1 ? " latest-win" : "")
                      : ""
                  }
                >
                  {(player?.wins || 0) > n && <Icon name="check" />}
                </span>
              ))}
            </div>
          )}
          {status && (
            <div
              className={"player-status " + (active ? "listening-badge" : "")}
            >
              <Icon
                name={
                  active
                    ? "ear"
                    : status === "Ready" || status === "Confirmed"
                      ? "check"
                      : local && client.capture.micMuted
                        ? "mic-off"
                        : "mic"
                }
              />
              <span>{active ? "Listening" : status}</span>
            </div>
          )}
        </div>
      </div>
      <div className="face-picture">
        <video
          ref={attach}
          autoPlay
          playsInline
          muted={muted}
          hidden={!showVideo}
          aria-label={
            (player?.name || "Player") +
            (interrupted ? "’s paused camera" : "’s live camera")
          }
          style={{ transform: local ? "scaleX(-1)" : undefined }}
        />
        <canvas
          ref={relayCanvas}
          width={256}
          height={144}
          hidden={!showRelay}
          role="img"
          aria-label={
            (player?.name || "Player") +
            (interrupted ? "’s paused camera" : "’s live camera")
          }
        />
        {camera && interrupted && (showVideo || showRelay) && (
          <span className="camera-interruption">Video paused</span>
        )}
        {!showVideo && !showRelay && (
          <div className="avatar">
            <span>
              {player?.name?.slice(0, 1).toUpperCase() || (
                <Icon name="camera" />
              )}
            </span>
            <small>
              {offlineResult
                ? "Offline"
                : !player
                  ? emptyStatus
                  : camera
                    ? "Connecting camera…"
                    : "Camera off"}
            </small>
          </div>
        )}
      </div>
      <div className="face-bottom">
        {state.topic?.positions[player?.id || ""] && (
          <p className="position">{state.topic.positions[player!.id]}</p>
        )}
        {showScore && (
          <div className="score-wrap">
            <AnimatedScore
              playerId={player?.id}
              units={player?.scoreUnits || 0}
              reduced={reduced}
              roundId={state.roundId}
            />
          </div>
        )}
      </div>
      <div className="award-layer" aria-hidden="true">
        {award && (
          <ScoreBurst key={award.id} notice={award} reduced={reduced} />
        )}
      </div>
      <span className="sr-only" role="status" aria-atomic="true">
        {announcement}
      </span>
    </article>
  );
}
