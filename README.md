# Hear Me Out

Two friends, one ridiculous argument, and the Honorable Bonk: a mischievous toy-gavel judge who scores what was actually said and challenges a friend to answer it.

A desktop Chrome party game with prominent live faces, microphone checks, four-digit rooms, a procedural Three.js courtroom, free-form topics, live justified scores, shared judge speech, best-of-three matches, and rematch.

## Run

Requires Node 22.12+ and pnpm. No LiveKit or managed media account is used.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# Set OPENAI_API_KEY, CARTESIA_API_KEY, and FISH_AUDIO_API_KEY in .env or the server environment.
pnpm build
pnpm start
```

Open `http://127.0.0.1:3000`. For remote laptops, install `cloudflared`, then run `pnpm tunnel` in another terminal. Use the HTTPS URL it prints. Keep the server laptop awake; on macOS use `caffeinate -dimsu pnpm start`. Quick Tunnel URLs are temporary and change when the tunnel restarts. The server supervisor restarts after at most three unexpected failures; active rooms are ephemeral across restarts.

`pnpm dev` runs Vite on 5173 and Node on 3000. `pnpm check`, `pnpm test`, and `pnpm build` are the normal checks. Provider verification consumes actual API usage:

```sh
pnpm verify:providers
pnpm verify:judge
# In another terminal: PORT=3001 FORCE_WSS=true pnpm exec tsx server/index.ts
pnpm verify:match
pnpm verify:idle
```

`TEST_URL` changes the match-test origin. `pnpm exec tsx scripts/health-check.ts` checks HTTP plus authenticated WSS at that origin. Verification scripts are type-checked. Match verification never rewrites public assets unless `EXPORT_REHEARSAL=true` is explicitly set. `CHECK_MODEL` / `CHECK_REASONING` override the judge fixture model. `.env` is ignored; browser bundles contain no provider keys. Captured player recordings are off. Raw media, room state, captions, and claims live in memory and expire with the room.

## Play

Both players enter their names and the same room, enable microphones/cameras, confirm they can hear each other, and hit Ready. A server coin assigns Heads to open and Tails to choose the topic and their side. Both confirm the explicit proposition. Use headphones.

Every round offers Case → Case → Rebuttal → Rebuttal → two Closings. Heads opens odd rounds; Tails opens round two. Normal turns allow 30 active seconds, Closings 15. Closing order is trailing player first, leader second; the responder closes first when tied. “I'm done” yields immediately. Semantic handoff has an eight-second normal/four-second Closing protection and an 800 ms resumption guard. A turn's final transcripts and in-flight judging are sealed before granting the next floor.

During the debate only the floor holder's microphone is enabled and eligible for transcription. Both players are muted while judging, during shared judge speech, and during recovery. Lobby/results allow conversation; manual mute persists. Bonk makes a named handoff between opportunities, using contextual interventions at most 14 words/4.5 seconds, 15 seconds apart, twice before Closing and three times per round overall. The next player's clock opens only after playback completes or the voice recovery path finishes.

There is no early defeat. After both normal opportunities, a 4–9.75 point deficit opens a focused comeback challenge using the existing ten-point Closing budget. Points reset each round; round wins persist. First to two wins takes the match. Exact ties compare rebuttal, reasoning, impact, wit, then clarity. An exact remaining dead heat is explicitly resolved by a server coin. A stuck round aborts at 240 seconds; reconnects preserve the seat and state for 60 cumulative seconds per round. Aborts never fabricate a judged winner.

## Scoring and authority

Each opportunity caps at 10 points; each player at 30 per round. Scores use integer quarter-point units. Quality 0–4 sets a bounded target per criterion; the server commits only a positive increase over the existing target. Repeated segments, duplicates, filler, and more words cannot multiply the budget.

Rebuttal/Closing weights: reasoning 35%, rebuttal 30%, impact 20%, wit 10%, clarity 5%. Both Case opportunities use reasoning 50%, impact 30%, wit 15%, clarity 5%; neither is penalized for having no opposing argument yet. Concise complete arguments compete fairly. Accent, appearance, loudness, delivery speed, and transcript imperfections are excluded. Unsupported research is not verified evidence.

Partial/eager transcripts update captions only; only provider-final utterance segments become score evidence. The model proposes quality and a reason, never points or a winner. The server checks stable segment ownership, opportunity eligibility, round/turn IDs, sealing deadlines, quality range, and duplicate keys. One committed ledger drives both displays and results. Names, topics, and speech are untrusted data. The rubric prompt and strict provider schemas are in `server/providers/openai.ts`; the rule authority is `server/game/game.ts`.

## Architecture

```mermaid
flowchart LR
  A[Chrome player A] <-->|native WebRTC| B[Chrome player B]
  A <-->|control, PCM, JPEG WSS| N[Node: authoritative room / clock / ledger]
  B <-->|control, PCM, JPEG WSS| N
  N --> IA[Ink 2: authenticated identity A]
  N --> IB[Ink 2: authenticated identity B]
  IA --> J[Shared text judge]
  IB --> J
  J -->|validated proposals| N
  N --> T[Fish Audio: one excited utterance]
  T -->|same PCM and speech epoch| N
```

React/Vite and React Three Fiber present the game. Node/Express and `ws` serve the production app and persistent connections. Native WebRTC uses authenticated server signaling, perfect negotiation, and public STUN. No TURN service is assumed. If direct media cannot connect, both clients use independent audio/video WSS channels. Relay video is **256×144 JPEG, up to 15 fps**, quality 0.35, with at most two unacknowledged frames; only the latest pending frame is decoded onto a persistent canvas. Delayed frames remain visible rather than being rejected by age. Relay audio is 16 kHz mono PCM, captured in 20 ms frames and played through a bounded audio-thread jitter buffer. Local camera stays a live DOM video, independent of relay frames. Media warms up while direct negotiation runs. Network latency still bounds achievable response time.

Provider defaults are **Cartesia Ink 2**, **OpenAI GPT-6 Luna with no reasoning**, and **Fish Audio S2 Pro**, voice ID `29f4e37195264ebc86cf568ea6e36aff`, **1.2× speed, +4 dB volume, `[excited]` tags on every utterance**. Fish streams 16-bit mono 44.1 kHz PCM; the adapter converts it to the existing shared float-PCM playback contract. HTTP cancellation aborts generation and both clients flush the canceled speech epoch. [Fish TTS API](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech). Sol with low reasoning was integrated first, then replaced after measured 7–12 second judgments. The adapters remain replaceable. Provider quotas/access are account-dependent; STT uses two steady sessions and briefly up to four during eligibility transitions.

Source boundaries:

- `shared/domain.ts`: domain schemas, inferred types, scoring caps and floor policy; `shared/protocol.ts`: versioned commands/events; `shared/media.ts`: validated binary codecs.
- `server/game/`: rules, transitions, clocks and the committed ledger. Room coordination changes state through explicit Game methods.
- `server/rooms/`: room coordination, seats, command dispatch and transcription ownership. `services.ts` supplies injectable providers and scheduling.
- `server/judge/`: scoring jobs, evidence-linked reactions, shared playback and bounded voice preparation.
- `server/providers/`: independent OpenAI, Cartesia and Fish adapters.
- `server/transport/`: HTTP authentication, guarded socket upgrades, rate limits and relay media. `server/index.ts` only starts and stops `createApp()`.
- `src/game/`: browser session/connection coordination. `src/media/`: device capture, peer negotiation, relay video, audio output and judge playback.
- `src/ui/`: phase views, persistent `PlayerCard`, captions/controls and the separately loaded `CourtroomStage`. Entry-form state stays in `App`; the stage has a visual fallback for loading or WebGL failure.

Bonk now hosts the welcome, coin reveal, topic invitation/nudge, and round resets with short rotating lines. Evidence-linked reactions arrive in the scoring response and combine with the next named handoff; routine commentary does not spend strategic-intervention allowances. Fixed lines warm asynchronously in a bounded memory cache, and each room prepares one replaceable reaction/handoff candidate. Turn settlement waits for the 500 ms microphone drain, final STT stream completion, and eligible scoring jobs rather than a fixed three-second delay. Provider stalls retain bounded recovery; evidence is never skipped for speed. Silent packets cannot overflow an STT startup buffer.

Commands carry an idempotency ID, connection epoch, match ID, and phase version. Events carry a room sequence and complete authoritative snapshot. Stale commands/audio/provider results are rejected. Sequence gaps request a snapshot. Four-digit codes locate rooms; separate 256-bit seat tokens protect reconnects and never appear in URLs. Capacity, code collision checks, create/join/control rate limits, idle expiration, one-hour room lifetime, and provider/socket cleanup are enforced. Only one match runs concurrently on the demo server. Protocol version 2 is required at socket authentication; old pages receive an explicit refresh instruction. Malformed origins/URLs are rejected without throwing. Signaling, snapshots, metrics, authentication attempts and media rates are bounded as well as game commands.

Requests capture their match, round, turn or connection ownership. Rematch/disposal cancels stale jobs and timers; same-match recovery requeues eligible scoring evidence. Browser Leave invalidates resume responses and old socket/device callbacks. Microphone timestamps use a server-synchronized monotonic clock, established before media readiness. Shared judge playback requires both initial-buffer acknowledgments; a missing or backlogged recipient cancels both copies and uses the caption recovery path. Metrics keep at most 128 samples per category and no raw speech.

## Verification and limits

Private-beta refactor verified October 11, 2026 (Pacific):

- Type check, 45 deterministic tests and production build pass. CI runs frozen-lockfile installation plus those checks.
- The four regressions fail before their fixes and pass afterward: stale judge failure, reconnect after Leave, clock discontinuity and malformed WebSocket origin. Further checks cover disposal/recovery, delayed final transcripts, duplicate commands, packet validation, manual mute, and bounded playback/metrics. The clock diagnosis is specifically synchronization startup and wall-clock discontinuities: the original browser already applied a server offset.
- A deterministic two-client WebSocket match completes 12 opportunities, recovery during judge speech, identical ledger/results and nonempty identical completed speech, then rematch. Non-floor audio cannot produce evidence.
- A real OpenAI/Cartesia/Fish synthetic-voice match completed 12 opportunities, 31 committed score events, identical results and **1,629 identical audio chunks per client**, contextual argument commentary, reconnect and rematch; zero command errors and no typed/caption-only degradation. Normal verification did not alter the saved rehearsal.
- Chrome automation at 1280×800 checked native WebRTC and forced WSS relay: both cameras, exclusive microphone tracks, manual mute, camera restoration after reload, leaving/rejoining without refresh, player-side buttons and clear captions. This used generated camera/microphone devices on one host, not two human networks. WebGL failure preserved usable room controls.
- The initial JavaScript chunk is **368 KB / 112 KB gzip**, down from approximately 1.18 MB / 324 KB gzip. The separately loaded 3D chunk remains **916 KB / 243 KB gzip**, with the expected large-chunk build warning.

Timing observations from that provider match are **server-scheduled start times**, not acoustic playback measurements: cue-to-start p95 **1,215 ms** (19 utterances), and turn-completion-to-start p95 **2,758 ms** (12 reactions/verdicts). The first four cached opening cues scheduled in 152–160 ms. The 1.5-second reaction target is therefore not established; actual end-to-end latency, FPS, broader fairness and two-network human verification remain deferred.

Deploy the client and server together between matches. Keep a copy of both `dist/` and `dist-server/` before rebuilding; this pass retained the prior pair under ignored `output/rollback/`. Rollback must restore both directories and restart the server, then refresh browser pages. Rooms remain deliberately ephemeral: server restarts require a new room. Do not market this beta as public-production ready.


See [demo and verification notes](docs/DEMO.md) for observed checks, measured limitations, the demo script, and fallback. A synthetic-audio integration test is distinct from a real two-laptop match. The user confirmed the updated relay audio/video works properly on two laptops; full human-match verification is tracked separately.

Current concessions: temporary laptop/Quick Tunnel hosting; low-resolution relay video; no music bed/share image/extra modes. Captions, camera-off initials, mute controls, reduced motion, and adaptive DPR/shadows are available. The 60 fps rendering target and requested end-to-end p95 judge latency have not been established across typical laptops/networks.

Production work remaining: stable persistent hosting with TURN, durable room/ledger recovery, provider quota and abuse management, retention review, and measured browser/network/load coverage. Quick Tunnel hosting is a hackathon demo, not a production availability guarantee.
