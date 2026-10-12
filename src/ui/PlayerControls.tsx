import { client } from "../game/client";
import { Icon } from "./Icon";
import { useMediaVersion } from "./hooks";
export function PlayerControls({
  action,
  busy,
  onAudio,
}: {
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  onAudio: () => void;
}) {
  useMediaVersion();
  const mic = client.capture.stream
    ?.getAudioTracks()
    .some((t) => t.readyState === "live");
  const camera =
    client.capture.stream
      ?.getVideoTracks()
      .some((t) => t.readyState === "live") && !client.capture.cameraOff;
  const muted = client.capture.micMuted;
  const allowed = client.capture.microphoneAllowed();
  return (
    <footer className="controls" aria-label="Player controls">
      <div className="device-controls">
        <button
          disabled={busy}
          aria-pressed={!!mic && !muted}
          className={muted ? "muted" : ""}
          onClick={() =>
            mic
              ? client.capture.muteMic()
              : void action(() => client.capture.devices(false))
          }
        >
          <Icon name={!mic || muted || !allowed ? "mic-off" : "mic"} />
          {!mic
            ? "Enable mic"
            : muted
              ? "Mic off"
              : allowed
                ? "Mic on"
                : "Mic paused"}
        </button>
        <button
          disabled={busy}
          aria-pressed={!!camera}
          onClick={() => client.capture.muteCamera()}
        >
          <Icon name={camera ? "camera" : "camera-off"} />
          {camera ? "Camera on" : "Camera off"}
        </button>
        <button onClick={onAudio}>
          <Icon name="volume" />
          <span>Audio</span>
        </button>
      </div>
      <button className="leave-button" onClick={() => client.leave()}>
        <Icon name="leave" />
        Leave
      </button>
    </footer>
  );
}
