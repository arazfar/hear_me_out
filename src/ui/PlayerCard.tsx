import { useCallback, useEffect, useRef } from "react";
import {
  canSpeak,
  points,
  type Player,
  type Snapshot,
} from "../../shared/domain";
import { client } from "../game/client";
import { AnimatedScore } from "./AnimatedScore";
export function PlayerCard({
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
      const desired = local ? client.capture.stream : client.peer.remote;
      if (video.current.srcObject !== desired)
        video.current.srcObject = desired;
      video.current.muted =
        local || client.sound.peerMuted || !canSpeak(state, player?.id || null);
      video.current.volume = 1;
      void video.current.play().catch(() => {});
    }
  }, [
    local,
    client.capture.stream,
    client.peer.remote,
    state.mediaMode,
    player?.cameraOn,
    client.capture.cameraOff,
    state.turn?.playerId,
    state.turn?.pausedReason,
    state.turn?.sealing,
    state.phase,
    state.judge?.status,
    client.sound.peerMuted,
  ]);
  useEffect(() => {
    if (
      relayCanvas.current &&
      client.video.remoteCanvas &&
      client.video.remoteFrame
    )
      relayCanvas.current
        .getContext("2d")
        ?.drawImage(client.video.remoteCanvas, 0, 0, 256, 144);
  }, [
    client.video.remoteFrameSeq,
    client.video.remoteFrame,
    state.mediaMode,
    player?.cameraOn,
  ]);
  const attachVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      video.current = node;
      if (!node) return;
      const desired = local ? client.capture.stream : client.peer.remote;
      if (node.srcObject !== desired) node.srcObject = desired;
      if (node.paused) void node.play().catch(() => {});
    },
    [local, client.capture.stream, client.peer.remote],
  );
  const camera = player?.cameraOn && (local ? !client.capture.cameraOff : true);
  const media = local
    ? client.capture.stream
    : state.mediaMode === "rtc"
      ? client.peer.remote
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
        {camera && (media || (!local && client.video.remoteFrame)) ? (
          <>
            {!local && state.mediaMode !== "rtc" ? (
              <canvas
                ref={relayCanvas}
                width={256}
                height={144}
                role="img"
                aria-label={`${player?.name}'s live camera`}
              />
            ) : (
              <video
                ref={attachVideo}
                autoPlay
                playsInline
                muted={
                  local ||
                  client.sound.peerMuted ||
                  !canSpeak(state, player?.id || null)
                }
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
        {!local &&
          camera &&
          state.mediaMode !== "rtc" &&
          (!client.video.remoteFrameAt ||
            Date.now() - client.video.remoteFrameAt > 2000) && (
            <span className="camera-status">Connecting camera…</span>
          )}
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
      {state.phase === "ROUND" && (
        <div className="speaking-status">
          {canSpeak(state, player?.id || null)
            ? local && client.capture.micMuted
              ? "MIC OFF · your turn"
              : "Your turn"
            : state.judge?.status !== "silent" && state.judge
              ? "Muted · Bonk is talking"
              : state.turn?.sealing
                ? "Muted · judging argument"
                : "Muted · opponent’s turn"}
        </div>
      )}
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
                lastAudioSeq: client.capture.audioSeq,
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
