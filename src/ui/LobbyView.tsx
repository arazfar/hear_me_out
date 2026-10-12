import { useEffect, useRef } from "react";
import type { Player, Snapshot } from "../../shared/domain";
import { client } from "../game/client";
import { Icon } from "./Icon";
import { useMediaVersion } from "./hooks";

function MicMeter() {
  const meter = useRef<HTMLMeterElement>(null);
  useEffect(
    () =>
      client.on((u) => {
        if (
          u.activity &&
          u.activity.playerId === client.session?.playerId &&
          meter.current
        )
          meter.current.value = Math.min(1, client.capture.micLevel * 8);
      }),
    [],
  );
  return (
    <label className="mic-check">
      <Icon name="mic" />
      <span>Say hello</span>
      <meter
        ref={meter}
        min={0}
        max={1}
        value={0}
        aria-label="Microphone input level"
      />
    </label>
  );
}
export function LobbyView({
  state,
  me,
  other,
  busy,
  action,
  copyInvite,
}: {
  state: Snapshot;
  me?: Player;
  other?: Player;
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  copyInvite: () => void;
}) {
  useMediaVersion();
  const hasMic = client.capture.stream
    ?.getAudioTracks()
    .some((t) => t.readyState === "live");
  return (
    <section className="phase-panel lobby" aria-label="Get ready">
      <h2>
        {!other
          ? "Save them a seat."
          : me?.ready
            ? "You’re ready."
            : "Can you hear each other?"}
      </h2>
      {!other && (
        <button
          className="invite-code"
          onClick={copyInvite}
          aria-label={"Copy invite link for room " + state.code}
        >
          <span>{state.code}</span>
          <Icon name="copy" />
        </button>
      )}
      <p>
        {!other
          ? "Send your friend the code or invite link."
          : me?.ready
            ? "Waiting for " + other.name + "."
            : "Say hello, then both hit Ready."}
      </p>
      {!hasMic ? (
        <>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void action(() => client.capture.devices())}
          >
            {busy ? "Connecting devices…" : "Enable camera & mic"}
            <Icon name="camera" />
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void action(() => client.capture.devices(false))}
          >
            Use microphone only
          </button>
          <p className="support-copy">
            A microphone is required. Camera optional.
          </p>
        </>
      ) : (
        <>
          <MicMeter />
          {client.capture.micMuted && (
            <p className="inline-warning">
              <Icon name="mic-off" />
              Your mic is off. Unmute to check it.
            </p>
          )}
          <button
            className={"primary " + (me?.ready ? "ready-button" : "")}
            disabled={!me?.mediaReady || !other?.connected || busy}
            onClick={() => client.command({ type: "ready", value: !me?.ready })}
          >
            {me?.ready
              ? "Ready · undo"
              : !other?.connected
                ? "Waiting for your friend"
                : !me?.mediaReady
                  ? "Connecting audio…"
                  : "Ready to argue"}
            <Icon name={me?.ready ? "check" : "arrow"} />
          </button>
        </>
      )}
    </section>
  );
}
