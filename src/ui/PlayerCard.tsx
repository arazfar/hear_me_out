import { useCallback, useEffect, useRef, useState } from "react";
import {
  canSpeak,
  points,
  type Player,
  type Snapshot,
} from "../../shared/domain";
import { client } from "../game/client";
import { AnimatedScore } from "./AnimatedScore";
import { Icon } from "./Icon";
import { useMediaVersion } from "./hooks";
import { playerStatus } from "./presentation";
import {
  AwardQueue,
  awardCapacity,
  type AwardNotice,
} from "../game/award-queue";

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
  const [presentation, setPresentation] = useState<{
    notices: AwardNotice[];
    slots: number;
    fontSize: number;
  }>({ notices: [], slots: 1, fontSize: 23 });
  const [winPulse, setWinPulse] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const scoreWrap = useRef<HTMLDivElement>(null),
    awardLayer = useRef<HTMLDivElement>(null),
    quiet = useRef(reduced);
  quiet.current = reduced;
  useEffect(() => {
    if (reduced) scoreWrap.current?.getAnimations().forEach((a) => a.cancel());
  }, [reduced]);
  const version = useMediaVersion();
  const active =
    !client.reconnecting &&
    state.turn?.playerId === player?.id &&
    state.phase === "ROUND";
  const winner =
    state.phase === "MATCH_RESULT" && state.winnerId === player?.id;
  const offlineResult =
    state.phase === "MATCH_RESULT" && player?.connected === false;
  const showScore = state.round > 0;
  const emptyStatus =
    state.phase === "ABORTED" ? "Left the court" : "Waiting for your friend";
  const status = !player
    ? emptyStatus
    : offlineResult
      ? "Offline"
      : client.reconnecting
        ? "Reconnecting"
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
    let displayTimer: ReturnType<typeof setTimeout> | undefined,
      pulse: Animation | undefined;
    const display = () => {
      clearTimeout(displayTimer);
      const now = performance.now();
      const width = awardLayer.current?.clientWidth || 96;
      const { notices, slots, nextAt } = queue.advance(
        now,
        awardCapacity(width),
      );
      setPresentation({
        notices,
        slots,
        // Keep occupied slots legible and separate if the window shrinks mid-cue.
        fontSize: Math.min(23, width / slots / 4.5),
      });
      if (Number.isFinite(nextAt))
        displayTimer = setTimeout(display, Math.max(1, nextAt - now));
    };
    const clear = () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      clearTimeout(displayTimer);
      queue.clear();
      pulse?.cancel();
      setPresentation((previous) => ({ ...previous, notices: [] }));
      setWinPulse(false);
      setAnnouncement("");
    };
    clear();
    const resize = new ResizeObserver(display);
    if (awardLayer.current) resize.observe(awardLayer.current);
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
        setAnnouncement(
          `+${points(cue.deltaUnits)}. ${points(cue.totalUnits)} points.`,
        );
        if (!quiet.current) {
          pulse?.cancel();
          pulse = scoreWrap.current?.animate(
            [
              { transform: "scale(1)" },
              {
                transform: `scale(${cue.deltaUnits >= 8 ? 1.12 : 1.07})`,
                offset: 0.3,
              },
              { transform: "scale(1)" },
            ],
            { duration: 240, easing: "cubic-bezier(.16,1,.3,1)" },
          );
        }
      }
      if (cue.kind === "round" || cue.kind === "match") {
        setWinPulse(true);
        later(() => setWinPulse(false), 700);
      }
    });
    return () => {
      unsub();
      resize.disconnect();
      clear();
    };
  }, [player?.id, state.matchId, state.roundId]);
  return (
    <article
      className={
        "face face-" +
        index +
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
        {showScore && (
          <div
            className={"round-pips " + (winPulse ? "win-pulse" : "")}
            role="img"
            aria-label={(player?.wins || 0) + " of 2 round wins"}
            title={(player?.wins || 0) + " of 2 round wins"}
          >
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
        <span className="activity" ref={activity} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
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
      <span className="sr-only">{status}</span>
      {player &&
        ((!player.connected && !offlineResult) ||
          (state.phase === "LOBBY" && player.ready) ||
          (active && local && client.capture.micMuted)) && (
          <div className="player-status">
            <Icon
              name={
                !player.connected
                  ? "refresh"
                  : player.ready && state.phase === "LOBBY"
                    ? "check"
                    : "mic-off"
              }
            />
            <span>
              {!player.connected
                ? "Reconnecting"
                : state.phase === "LOBBY"
                  ? "Ready"
                  : "Unmute to speak"}
            </span>
          </div>
        )}
      <div className="face-bottom">
        {state.topic?.positions[player?.id || ""] && (
          <p className="position">{state.topic.positions[player!.id]}</p>
        )}
        {showScore && (
          <div className="score-wrap" ref={scoreWrap}>
            <AnimatedScore
              playerId={player?.id}
              units={player?.scoreUnits || 0}
              reduced={reduced}
              roundId={state.roundId}
            />
          </div>
        )}
      </div>
      <div
        className="award-layer"
        ref={awardLayer}
        aria-hidden="true"
        style={
          {
            "--award-slots": presentation.slots,
            "--award-font": `${presentation.fontSize}px`,
          } as React.CSSProperties
        }
      >
        {presentation.notices.map((award) => (
          <span
            key={award.id}
            className="award-slot"
            style={{ "--lane": award.slot } as React.CSSProperties}
          >
            <span className="score-burst" data-award-id={award.id}>
              +{points(award.deltaUnits)}
            </span>
          </span>
        ))}
      </div>
      <span className="sr-only" role="status" aria-atomic="true">
        {announcement}
      </span>
    </article>
  );
}
