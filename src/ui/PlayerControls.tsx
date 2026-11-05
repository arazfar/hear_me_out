import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { client } from "../game/client";
import { Icon } from "./Icon";
import { useMediaVersion } from "./hooks";

export function PlayerControls({
  action,
  busy,
  audioConnecting,
  dialogOpen,
  notification,
  triggerRef,
}: {
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  audioConnecting: boolean;
  dialogOpen: boolean;
  notification?: ReactNode;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  useMediaVersion();
  const [open, setOpen] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const footer = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = footer.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      node.style.setProperty("--dock-height", `${node.offsetHeight}px`),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const mic = client.capture.stream
    ?.getAudioTracks()
    .some((t) => t.readyState === "live");
  const video = client.capture.stream
    ?.getVideoTracks()
    .some((t) => t.readyState === "live");
  const camera = video && !client.capture.cameraOff;
  const muted = client.capture.micMuted;
  const blockers =
    client.state?.players.find((p) => p.id === client.session?.playerId)
      ?.readiness?.blockers || [];
  const deviceFailure =
    !mic ||
    !video ||
    !!client.setup.error ||
    (!muted && blockers.includes("microphone")) ||
    (!client.capture.cameraOff && blockers.includes("camera"));
  const status = deviceFailure
    ? "Check devices"
    : muted && !camera
      ? "Both off"
      : muted
        ? "Mic off"
        : !camera
          ? "Camera off"
          : "";

  useEffect(() => {
    if (dialogOpen) setOpen(false);
  }, [dialogOpen]);
  useEffect(() => {
    if (!open) return;
    panel.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      if (!group.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, triggerRef]);

  return (
    <footer ref={footer} className="control-row" aria-label="Player controls">
      <div className="notification-area">{notification}</div>
      <div className="controls">
        <div className="media-control" ref={group}>
          <button
            tabIndex={0}
            ref={triggerRef}
            className={"media-trigger" + (status ? " muted" : "")}
            aria-label="Mic & camera"
            title={"Mic & camera · " + (status || "Both on")}
            aria-expanded={open}
            aria-controls={id}
            aria-describedby={id + "-status"}
            onClick={() => setOpen(!open)}
          >
            <span className="media-icons">
              <Icon name={!mic || muted ? "mic-off" : "mic"} />
              <Icon name={camera ? "camera" : "camera-off"} />
            </span>
            {deviceFailure && <Icon name="warning" />}
            <span id={id + "-status"} className="sr-only">
              {status || "Microphone and camera on"}
            </span>
            <span className="media-tooltip" aria-hidden="true">
              Mic & camera · {status || "Both on"}
            </span>
            <Icon name="chevron" className="media-chevron" />
          </button>
          {open && (
            <div
              id={id}
              ref={panel}
              className="media-popover"
              role="group"
              aria-label="Media controls"
            >
              <div className="device-controls media-control-pair">
                <button
                  tabIndex={0}
                  disabled={busy && !mic}
                  aria-pressed={!!mic && !muted}
                  className={muted ? "muted" : ""}
                  onClick={() =>
                    mic
                      ? client.capture.muteMic()
                      : void action(() => client.setup.run())
                  }
                >
                  <Icon name={!mic || muted ? "mic-off" : "mic"} />
                  {!mic ? "Enable mic" : muted ? "Mic off" : "Mic on"}
                </button>
                <button
                  tabIndex={0}
                  aria-pressed={!!camera}
                  onClick={() => client.capture.muteCamera()}
                >
                  <Icon name={camera ? "camera" : "camera-off"} />
                  {camera ? "Camera on" : "Camera off"}
                </button>
              </div>
              <div className="media-control-pair">
                <button
                  tabIndex={0}
                  aria-pressed={!client.sound.peerMuted}
                  aria-label={
                    "Friend audio " + (client.sound.peerMuted ? "Off" : "On")
                  }
                  aria-describedby={
                    audioConnecting ? id + "-connection" : undefined
                  }
                  onClick={() => client.sound.mutePeer()}
                >
                  <Icon name={client.sound.peerMuted ? "muted" : "volume"} />
                  <span>Friend audio</span>
                  {audioConnecting && (
                    <span
                      className="connection-pending"
                      id={id + "-connection"}
                      role="img"
                      aria-label="Connecting friend audio"
                      title="Connecting friend audio"
                    >
                      <Icon name="connection" />
                    </span>
                  )}
                  <b>{client.sound.peerMuted ? "Off" : "On"}</b>
                </button>
                <button
                  tabIndex={0}
                  aria-pressed={!client.sound.judgeMuted}
                  onClick={() => client.sound.muteJudge()}
                >
                  <Icon name={client.sound.judgeMuted ? "muted" : "volume"} />
                  <span>Bonk & effects</span>
                  <b>{client.sound.judgeMuted ? "Off" : "On"}</b>
                </button>
              </div>
            </div>
          )}
        </div>
        <button
          tabIndex={0}
          className="leave-button"
          onClick={() => client.leave()}
        >
          <Icon name="leave" />
          Leave
        </button>
      </div>
    </footer>
  );
}
