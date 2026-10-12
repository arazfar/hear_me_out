import { client } from "../game/client";
export function PlayerControls({
  action,
}: {
  action: (f: () => Promise<void>) => Promise<void>;
}) {
  return (
    <footer className="controls">
      <div>
        <button
          onClick={() => client.capture.muteMic()}
          className={client.capture.micMuted ? "muted" : ""}
        >
          {client.capture.micMuted
            ? "MIC OFF"
            : client.capture.microphoneAllowed()
              ? "MIC ON"
              : "AUTO MUTED"}{" "}
          <span>●</span>
        </button>
        <button onClick={() => client.capture.muteCamera()}>
          {client.capture.cameraOff ? "CAM OFF" : "CAM ON"} <span>▣</span>
        </button>
        {!client.capture.stream && (
          <button onClick={() => void action(() => client.capture.devices())}>
            ENABLE DEVICES
          </button>
        )}
      </div>
      <div>
        <button onClick={() => client.sound.mutePeer()}>
          {client.sound.peerMuted ? "FRIEND MUTED" : "FRIEND AUDIO"}
        </button>
        <button onClick={() => client.sound.muteJudge()}>
          {client.sound.judgeMuted ? "BONK MUTED" : "BONK AUDIO"}
        </button>
        <button onClick={() => client.leave()}>LEAVE ↗</button>
      </div>
    </footer>
  );
}
