import { RecoveryCheck, currentReadinessPresentation } from "./DeviceCheck";
import type { Player, Snapshot } from "../../shared/domain";
import { Icon } from "./Icon";
import { useDecision, useMediaVersion } from "./hooks";
import { lobbyPresentation } from "./presentation";

export function LobbyView({
  state,
  me,
  other,
  busy,
  copyInvite,
}: {
  state: Snapshot;
  me?: Player;
  other?: Player;
  busy: boolean;
  copyInvite: () => void;
}) {
  useMediaVersion();
  const { pending, error, submit } = useDecision(state);
  const blocked = !me?.mediaReady;
  const readiness = currentReadinessPresentation();
  const presentation = lobbyPresentation(state, me?.id);
  const inviting =
    !other && me?.readiness?.blockers.every((b) => b === "peer_video");
  const peerMessage =
    !blocked && other && !other.mediaReady && readiness.message;
  const recovery = blocked && !inviting;
  const status = state.matchId && state.status;
  const readyAction = other && (!blocked || inviting);
  const actionOnly =
    readyAction && !peerMessage && !recovery && !status && !error;
  return (
    <section
      className={"phase-panel lobby" + (actionOnly ? " lobby-action-only" : "")}
      aria-label="Lobby"
    >
      {!other && <h2>Invite your friend</h2>}
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
      {peerMessage && <p>{peerMessage}</p>}
      {recovery && <RecoveryCheck />}
      {status && <p>{status}</p>}
      {readyAction && (
        <button
          className={
            "primary " + (me?.ready && !pending ? "accepted-button" : "")
          }
          disabled={
            !!me?.ready ||
            !me?.mediaReady ||
            !other?.connected ||
            busy ||
            !!pending
          }
          aria-describedby={error ? "ready-error" : undefined}
          aria-busy={!!pending}
          onClick={() => submit({ type: "ready" })}
        >
          {pending ? "Readying…" : presentation.actionLabel}
          {!pending && <Icon name={me?.ready ? "check" : "arrow"} />}
        </button>
      )}
      {error && (
        <p id="ready-error" className="decision-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
