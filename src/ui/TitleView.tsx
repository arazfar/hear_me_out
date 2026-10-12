import { client } from "../game/client";
export function TitleView({
  name,
  code,
  joining,
  busy,
  setName,
  setCode,
  setJoining,
  action,
}: {
  name: string;
  code: string;
  joining: boolean;
  busy: boolean;
  setName: (s: string) => void;
  setCode: (s: string) => void;
  setJoining: (v: boolean) => void;
  action: (f: () => Promise<void>) => Promise<void>;
}) {
  return (
    <section className="title-layout">
      <div className="title-copy">
        <span className="eyebrow">
          <i /> TWO FRIENDS. ONE TERRIBLE TAKE.
        </span>
        <h1>
          HEAR
          <br />
          ME{" "}
          <span>
            OUT<span className="asterisk">✳</span>
          </span>
          <b className="period">.</b>
        </h1>
        <p>
          Make your case.
          <br />
          Watch your friend get cooked.
        </p>
        <div className="title-sticker">
          JUDGED BY
          <br />
          <strong>
            THE HONORABLE
            <br />
            BONK
          </strong>
          <span>✦ ABSURDLY FAIR ✦</span>
        </div>
      </div>
      <div className="entry-card">
        <span className="card-kicker">THE COURT IS NOW IN SESSION</span>
        <h2>
          Bring a friend.
          <br />
          Bring a bad opinion.
        </h2>
        <label>
          Your name
          <input
            autoComplete="nickname"
            value={name}
            maxLength={20}
            placeholder="What should Bonk call you?"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {joining && (
          <label>
            Room code
            <input
              inputMode="numeric"
              value={code}
              placeholder="0000"
              maxLength={4}
              className="code-input"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
        )}
        <button
          className="primary"
          disabled={busy || !name.trim() || (joining && code.length !== 4)}
          onClick={() =>
            void action(() =>
              client.enter(joining ? "join" : "create", name, code),
            )
          }
        >
          {busy
            ? "Opening court…"
            : joining
              ? "JOIN THE ROOM ↗"
              : "CREATE A ROOM ↗"}
        </button>
        <button
          className="text-button"
          onClick={() => {
            setJoining(!joining);
            setCode(new URLSearchParams(location.search).get("room") || "");
          }}
        >
          {joining
            ? "Start your own argument instead"
            : "Got a code? Join your friend"}
        </button>
        <p className="tiny">
          2 players · camera + microphone · headphones recommended
        </p>
      </div>
      <div className="title-bottom">
        <span>NO EXPERTISE REQUIRED.</span>
        <span>JUST UNREASONABLE CONFIDENCE.</span>
      </div>
    </section>
  );
}
