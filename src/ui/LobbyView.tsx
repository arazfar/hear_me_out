import { RecoveryCheck, currentReadinessPresentation } from "./DeviceCheck";
import { useEffect, useState } from "react";
import type { Player, Snapshot } from "../../shared/domain";
import { client } from "../game/client";
import { Icon } from "./Icon";
import { useMediaVersion } from "./hooks";

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
  const [heard, setHeard] = useState(() =>
    Date.now() - client.setup.heardAt < 3200 ? client.setup.text : "",
  );
  useEffect(() => {
    const timer = setTimeout(
      () => setHeard(""),
      Math.max(0, 3200 - (Date.now() - client.setup.heardAt)),
    );
    return () => clearTimeout(timer);
  }, []);
  const blocked = !me?.mediaReady;
  const readiness = currentReadinessPresentation();
  const inviting =
    !other && me?.readiness?.blockers.every((b) => b === "peer_video");
  return (
    <section className="phase-panel lobby" aria-label="Get ready">
      <h2>
        {!other
          ? "Invite your friend"
          : blocked
            ? "Get ready"
            : me?.ready
              ? "Ready!"
              : "All set?"}
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
      {(!blocked || inviting) && (
        <p>
          {other && !other.mediaReady && readiness.message
            ? readiness.message
            : heard
              ? `Heard you: “${heard}”`
              : !other
                ? "Tap the code to copy an invite."
                : me?.ready
                  ? "Waiting for " + other.name + "."
                  : "Mic, camera, a terrible opinion. Ready?"}
        </p>
      )}
      {blocked && !inviting && <RecoveryCheck />}
      {(!blocked || inviting) && (
        <button
          className={"primary " + (me?.ready ? "ready-button" : "")}
          disabled={!me?.mediaReady || !other?.connected || busy}
          onClick={() => client.command({ type: "ready", value: !me?.ready })}
        >
          {me?.ready
            ? "Ready · undo"
            : !other?.connected
              ? "Waiting for your friend"
              : "Ready to argue"}
          <Icon name={me?.ready ? "check" : "arrow"} />
        </button>
      )}
    </section>
  );
}
