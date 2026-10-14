import { useEffect, useRef, useState } from "react";
import { client } from "../game/client";
import { Icon } from "./Icon";
import { useMediaVersion } from "./hooks";
import { readinessPresentation } from "./readiness";

function deviceCheckStatus() {
  const setup = client.setup;
  if (setup.error) return setup.error;
  if (setup.phase === "permissions")
    return setup.repair === "camera"
      ? "Restarting your camera…"
      : "Allow mic & camera";
  if (setup.phase === "connecting") return "Connecting…";
  if (setup.phase === "testing")
    return setup.listening ? "Say ‘Bonk, hear me out.’" : "Connecting to Bonk…";
  if (setup.phase === "ready" && setup.busy)
    return "Mic works. Checking video…";
  return "Check mic & camera";
}

export function DeviceCheck({
  compact = false,
  repair,
  actionLabel = "Check mic & camera",
}: {
  compact?: boolean;
  repair?: "camera";
  actionLabel?: string;
}) {
  const version = useMediaVersion(),
    preview = useRef<HTMLVideoElement>(null),
    meter = useRef<HTMLMeterElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const setup = client.setup;
  useEffect(() => {
    const video = preview.current;
    if (video && video.srcObject !== client.capture.stream) {
      video.srcObject = client.capture.stream;
      void video.play().catch(() => {});
    }
  }, [version]);
  useEffect(
    () =>
      client.on((u) => {
        if (u.activity && meter.current)
          meter.current.value = Math.min(1, client.capture.micLevel * 8);
      }),
    [],
  );
  if (client.reconnecting)
    return (
      <div className="device-check">
        <ConnectionCheck announce />
        <button
          type="button"
          className="text-button"
          onClick={() => client.leave()}
        >
          Back
        </button>
      </div>
    );
  return (
    <div
      className={"device-check " + (compact ? "compact" : "")}
      aria-label="Mic and camera setup"
    >
      {!compact && (
        <span className="private-check-label">
          <Icon name="mic" />
          Private mic check
        </span>
      )}
      {!compact && (
        <div className="setup-preview">
          <video
            ref={preview}
            autoPlay
            playsInline
            muted
            aria-label="Your live camera preview"
          />
          {!client.capture.stream && <Icon name="camera" />}
        </div>
      )}
      {(setup.busy || setup.error) && (
        <div className="setup-status" role={!compact ? "status" : undefined}>
          {deviceCheckStatus()}
        </div>
      )}
      {setup.listening && (
        <meter
          ref={meter}
          className="setup-meter"
          min={0}
          max={1}
          value={0}
          aria-label="Microphone input level"
        />
      )}
      {!setup.busy && (
        <button
          type="button"
          className="primary setup-action"
          onClick={() => void setup.run(repair)}
        >
          <Icon name={repair === "camera" ? "camera" : "refresh"} />
          {setup.error ? "Try again" : actionLabel}
        </button>
      )}
      {(setup.error || !setup.busy) && (
        <details
          className="device-help"
          onToggle={(e) => {
            if (e.currentTarget.open)
              void navigator.mediaDevices
                ?.enumerateDevices()
                .then(setDevices)
                .catch(() => {});
          }}
        >
          <summary>Device help</summary>
          <p>
            Allow both devices in your browser’s site settings. Close other apps
            using them, then retry.
          </p>
          {["audioinput", "videoinput"].map((kind) => (
            <label key={kind}>
              {kind === "audioinput" ? "Microphone" : "Camera"}
              <select
                defaultValue=""
                onChange={(e) => {
                  if (kind === "audioinput")
                    client.capture.micDevice = e.target.value;
                  else client.capture.cameraDevice = e.target.value;
                }}
              >
                <option value="">System default</option>
                {devices
                  .filter((d) => d.kind === kind)
                  .map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label ||
                        `${kind === "audioinput" ? "Microphone" : "Camera"} ${i + 1}`}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </details>
      )}
      {(!compact || setup.busy) && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            if (compact) {
              setup.cancel();
              client.notify({ media: true });
            } else client.leave();
          }}
        >
          {compact ? "Cancel check" : "Back"}
        </button>
      )}
    </div>
  );
}

export function currentReadinessPresentation() {
  const me = client.state?.players.find(
    (p) => p.id === client.session?.playerId,
  );
  const other = client.state?.players.find((p) => p.id !== me?.id);
  const presentation = readinessPresentation(me, other, {
    reconnecting: client.reconnecting,
    offline: client.connection.phase === "offline",
    hasStream: !!client.capture.stream,
    micOff:
      client.capture.micMuted &&
      !!client.capture.stream
        ?.getAudioTracks()
        .some((t) => t.readyState === "live"),
    cameraOff:
      client.capture.cameraOff &&
      !!client.capture.stream
        ?.getVideoTracks()
        .some((t) => t.readyState === "live"),
    busy: client.setup.busy,
    error: client.setup.error,
    repair: client.setup.repair,
  });
  if (
    presentation.action === "check" &&
    (client.setup.busy || client.setup.error)
  )
    return { ...presentation, message: deviceCheckStatus() };
  return presentation;
}

export function RecoveryCheck({ heading = false }: { heading?: boolean }) {
  useMediaVersion();
  const presentation = currentReadinessPresentation();
  const showMessage =
    presentation.action !== "check" ||
    (!client.setup.busy && !client.setup.error);
  const Message = heading ? "h2" : "p";
  return (
    <>
      {presentation.message && showMessage && (
        <Message className="recovery-reason">{presentation.message}</Message>
      )}
      {presentation.action === "privacy" && (
        <button
          className="primary"
          onClick={() => {
            if (client.capture.micMuted) client.capture.muteMic();
            if (client.capture.cameraOff) client.capture.muteCamera();
          }}
        >
          <Icon name={client.capture.micMuted ? "mic" : "camera"} />
          {presentation.label}
        </button>
      )}
      {presentation.action === "check" && (
        <DeviceCheck
          compact
          repair={presentation.repair}
          actionLabel={presentation.label}
        />
      )}
    </>
  );
}

export function ConnectionCheck({
  heading = false,
  announce = false,
}: {
  heading?: boolean;
  announce?: boolean;
}) {
  const presentation = currentReadinessPresentation();
  const Message = heading ? "h2" : "p";
  return (
    <>
      <Message
        className="recovery-reason"
        role={announce ? "status" : undefined}
      >
        {presentation.message}
      </Message>
      {presentation.action === "connection" && (
        <button
          className="primary"
          onClick={() => void client.retryConnection()}
        >
          <Icon name="refresh" />
          {presentation.label}
        </button>
      )}
    </>
  );
}
