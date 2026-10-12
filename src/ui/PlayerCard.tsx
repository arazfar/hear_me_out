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
  const [burst, setBurst] = useState(0);
  const version = useMediaVersion();
  const active = state.turn?.playerId === player?.id && state.phase === "ROUND";
  const winner =
    state.phase === "MATCH_RESULT" && state.winnerId === player?.id;
  const showScore = state.round > 0;
  const scores = state.ledger.filter(
    (e) => e.playerId === player?.id && e.roundId === state.roundId,
  );
  const lastScore = scores.at(-1);
  const status = playerStatus(state, player, local, client.capture.micMuted);
  const camera =
    !!player?.cameraOn && (local ? !client.capture.cameraOff : true);
  const media = local
    ? client.capture.stream
    : state.mediaMode === "rtc"
      ? client.peer.remote
      : null;
  const showVideo = camera && !!media;
  const showRelay =
    camera && !local && state.mediaMode === "wss" && !!client.video.remoteFrame;
  const muted =
    local || client.sound.peerMuted || !canSpeak(state, player?.id || null);
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
    setBurst(0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sum = 0,
      at = 0;
    const seen = new Set<number>();
    const unsub = client.on((u) => {
      if (u.activity && u.activity.playerId === player?.id && activity.current)
        activity.current.style.setProperty(
          "--level",
          String(Math.max(0.12, u.activity.level)),
        );
      if (
        u.event?.type !== "score_committed" ||
        u.event.payload.playerId !== player?.id ||
        seen.has(u.event.seq)
      )
        return;
      seen.add(u.event.seq);
      if (seen.size > 128) seen.delete(seen.values().next().value!);
      sum = (Date.now() - at < 500 ? sum : 0) + u.event.payload.deltaUnits;
      at = Date.now();
      setBurst(sum);
      clearTimeout(timer);
      timer = setTimeout(() => setBurst(0), 1200);
    });
    return () => {
      unsub();
      clearTimeout(timer);
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
          aria-label={(player?.name || "Player") + "’s live camera"}
          style={{ transform: local ? "scaleX(-1)" : undefined }}
        />
        <canvas
          ref={relayCanvas}
          width={256}
          height={144}
          hidden={!showRelay}
          role="img"
          aria-label={(player?.name || "Player") + "’s live camera"}
        />
        {!showVideo && !showRelay && (
          <div className="avatar">
            <span>
              {player?.name?.slice(0, 1).toUpperCase() || (
                <Icon name="camera" />
              )}
            </span>
            <small>
              {!player
                ? "A seat for your bad influence"
                : camera
                  ? "Connecting camera…"
                  : "Camera off"}
            </small>
          </div>
        )}
        {!player?.connected && player && (
          <span className="camera-status">
            <Icon name="refresh" />
            Reconnecting
          </span>
        )}
      </div>
      <div className="player-status">
        <Icon
          name={
            winner
              ? "trophy"
              : active && canSpeak(state, player?.id || null)
                ? local && client.capture.micMuted
                  ? "mic-off"
                  : "mic"
                : state.phase === "LOBBY" && player?.ready
                  ? "check"
                  : "headphones"
          }
        />
        <span>{status}</span>
      </div>
      <div className="face-bottom">
        <p className="position">
          {state.topic?.positions[player?.id || ""] ||
            (player
              ? local
                ? "Your side of the courtroom"
                : "The other side of the story"
              : "Invite them with your room code")}
        </p>
        {showScore && (
          <AnimatedScore
            units={player?.scoreUnits || 0}
            reduced={reduced}
            roundId={state.roundId}
          />
        )}
        {burst > 0 && (
          <span className="score-burst" key={lastScore?.id} aria-hidden="true">
            +{points(burst)}
          </span>
        )}
      </div>
      {showScore && (
        <div
          className="round-pips"
          aria-label={(player?.wins || 0) + " of 2 round wins"}
        >
          {[0, 1].map((n) => (
            <span key={n} className={(player?.wins || 0) > n ? "won" : ""}>
              {(player?.wins || 0) > n && <Icon name="check" />}
            </span>
          ))}
          <small>Round wins</small>
        </div>
      )}
      {lastScore && (
        <details className="score-note">
          <summary>
            <span>
              {lastScore.criterion} +{points(lastScore.deltaUnits)}
            </span>
            <Icon name="chevron" />
            <span className="score-reason-preview">{lastScore.reason}</span>
          </summary>
          <div>
            {scores.map((s) => (
              <p key={s.id}>
                <b>
                  {s.criterion} +{points(s.deltaUnits)}
                </b>
                {s.reason}
              </p>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}
