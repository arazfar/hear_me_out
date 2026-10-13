import { DeviceCheck } from "./DeviceCheck";
import { client } from "../game/client";
import { Icon } from "./Icon";
import { StageLoader } from "./StageLoader";

export function TitleView({
  name,
  code,
  joining,
  busy,
  error,
  reduced,
  setName,
  setCode,
  setJoining,
  action,
}: {
  name: string;
  code: string;
  joining: boolean;
  busy: boolean;
  error: string;
  reduced: boolean;
  setName: (v: string) => void;
  setCode: (v: string) => void;
  setJoining: (v: boolean) => void;
  action: (fn: () => Promise<void>) => Promise<void>;
}) {
  return (
    <section className="title-layout">
      <div className="title-world">
        <h1>
          HEAR ME <span>OUT.</span>
        </h1>
        <p className="title-tagline">Two friends. One terrible take.</p>
        <StageLoader state={null} reduced={reduced} hero />
        <p className="host-credit">
          <strong>The Honorable Bonk</strong>
        </p>
      </div>
      <form
        className="entry-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && name.trim() && (!joining || code.length === 4))
            void action(() =>
              client.enter(joining ? "join" : "create", name, code),
            );
        }}
      >
        {(client.setup.inline || client.reconnecting) && client.session ? (
          <DeviceCheck />
        ) : (
          <>
            <label htmlFor="player-name">Your name</label>
            <input
              id="player-name"
              autoComplete="nickname"
              value={name}
              maxLength={20}
              placeholder="What’s your name?"
              onChange={(e) => setName(e.target.value)}
              required
            />
            {joining && (
              <>
                <label htmlFor="room-code">Room code</label>
                <input
                  id="room-code"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]{4}"
                  value={code}
                  placeholder="0000"
                  maxLength={4}
                  className="code-input"
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                <Icon name="warning" />
                {error}
              </p>
            )}
            <button
              className="primary"
              disabled={busy || !name.trim() || (joining && code.length !== 4)}
            >
              {busy ? "Opening court…" : joining ? "Join room" : "Create room"}
              <Icon name="arrow" />
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (busy) {
                  client.leave();
                  return;
                }
                setJoining(!joining);
                setCode(new URLSearchParams(location.search).get("room") || "");
              }}
            >
              {busy
                ? "Cancel"
                : joining
                  ? "Create your own room"
                  : "Join a friend"}
            </button>
            <p className="entry-note">Mic & camera required</p>
          </>
        )}
      </form>
    </section>
  );
}
