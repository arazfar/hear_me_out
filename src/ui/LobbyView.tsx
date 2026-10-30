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
  return (
    <section className="phase-panel lobby" aria-label="Lobby">
      {!other && <h2>Save a seat for your friend.</h2>}
      {other && !blocked && <h2>Both sides are here.</h2>}
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
      {!blocked && other && !other.mediaReady && readiness.message && (
        <p>{readiness.message}</p>
      )}
      {blocked && !inviting && <RecoveryCheck />}
      {state.matchId && state.status && <p>{state.status}</p>}
      {error && (
        <p className="decision-error" role="alert">
          {error}
        </p>
      )}
      {other && (!blocked || inviting) && (
        <button
          className={"primary " + (me?.ready ? "ready-button" : "")}
          disabled={!me?.mediaReady || !other?.connected || busy || !!pending}
          aria-busy={!!pending}
          onClick={() => submit({ type: "ready", value: !me?.ready })}
        >
          {pending?.type === "ready"
            ? pending.value
              ? "Readying…"
              : "Undoing…"
            : presentation.actionLabel}
          <Icon name={me?.ready ? "check" : "arrow"} />
        </button>
      )}
    </section>
  );
}
