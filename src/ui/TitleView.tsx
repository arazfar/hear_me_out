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
          Presiding judge: <strong>the Honorable Bonk</strong>
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
        <div className="entry-mark" aria-hidden="true">
          <Icon name="gavel" />
        </div>
        <h2>
          {joining
            ? "Your friend awaits."
            : "Bring a friend.\nStart an argument."}
        </h2>
        <p>
          {joining
            ? "Enter their four-digit room code."
            : "Bonk will hear you both out."}
        </p>
        <label htmlFor="player-name">Your name</label>
        <input
          id="player-name"
          autoComplete="nickname"
          value={name}
          maxLength={20}
          placeholder="What should Bonk call you?"
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
          disabled={busy}
          onClick={() => {
            setJoining(!joining);
            setCode(new URLSearchParams(location.search).get("room") || "");
          }}
        >
          {joining ? "Create your own room" : "Have a code? Join a friend"}
        </button>
        <p className="entry-note">
          <Icon name="headphones" />2 players · microphone required
          <br />
          Headphones recommended
        </p>
      </form>
    </section>
  );
}
