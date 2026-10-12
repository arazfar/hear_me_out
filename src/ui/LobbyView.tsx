import { type Player, type Snapshot } from "../../shared/domain";
import { client } from "../game/client";
export function LobbyView({
  state,
  me,
  other,
  busy,
  action,
}: {
  state: Snapshot;
  me?: Player;
  other?: Player;
  busy: boolean;
  action: (f: () => Promise<void>) => Promise<void>;
}) {
  return (
    <section className="center-card lobby">
      <span className="card-kicker">A VERY SERIOUS SOUND CHECK</span>
      <h3>{other ? "The jury is assembled." : "Invite your accomplice."}</h3>
      {!other && <div className="big-code">{state.code}</div>}
      <p>
        {other
          ? "Say something. Can you hear each other? Then both hit Ready."
          : "Send your friend the room code. No sign-up, no dignity required."}
      </p>
      {!client.capture.stream ? (
        <>
          <button
            className="primary"
            onClick={() => void action(() => client.capture.devices())}
          >
            ENABLE CAMERA + MIC
          </button>
          <p className="tiny">
            Blocked? Allow microphone in Chrome’s site controls, then retry.
          </p>
          <button
            className="text-button"
            onClick={() => void action(() => client.capture.devices(false))}
          >
            Join with microphone only
          </button>
        </>
      ) : (
        <>
          <div className="mic-check">
            <span>MIC CHECK</span>
            <div>
              <i
                style={{
                  width: `${Math.max(3, Math.min(100, client.capture.micLevel * 700))}%`,
                }}
              />
            </div>
            <span>{client.capture.micMuted ? "MUTED" : "SAY HELLO"}</span>
          </div>
          <button
            className="primary"
            disabled={!me?.mediaReady || !other || busy}
            onClick={() => client.command({ type: "ready", value: !me?.ready })}
          >
            {me?.ready
              ? "READY ✓ · WAITING FOR FRIEND"
              : !other
                ? "WAITING FOR YOUR FRIEND"
                : !me?.mediaReady
                  ? "CONNECTING AUDIO…"
                  : "I’M READY TO ARGUE ↗"}
          </button>
        </>
      )}
      <span className="transport-label">
        {state.mediaMode === "connecting"
          ? "Connecting your devices…"
          : state.mediaMode === "rtc"
            ? "Direct media connected"
            : "Relay media connected · 15 fps camera"}
      </span>
    </section>
  );
}
