# Hear Me Out

Two friends, one ridiculous argument, and the Honorable Bonk: a mischievous toy-gavel judge who scores what was actually said and challenges a friend to answer it.

A party game targeting desktop Chrome, Android Chrome, and iPhone Safari, with prominent live faces, microphone checks, four-digit rooms, a procedural Three.js courtroom, free-form topics, live justified scores, shared judge speech, best-of-three matches, and rematch.

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

Create or join a room to reserve your seat. Allow both devices, check the live preview, and say “Bonk, hear me out.” A final transcript through the gameplay provider confirms the mic check privately. Both cameras must arrive before Ready unlocks. Retrying reuses the seat and valid checks; cancelling releases it. A server coin assigns Heads to open and Tails to choose the topic and their side. Both confirm the explicit proposition. Use headphones.

Every round offers Case → Case → Rebuttal → Rebuttal → two Closings. Heads opens odd rounds; Tails opens round two. Normal turns allow 30 active seconds, Closings 15. Closing order is trailing player first, leader second; the responder closes first when tied. Only “I'm done” or the deadline ends an opportunity. Natural pauses keep the floor. Done closes capture eligibility immediately and acknowledges the action locally; final speech still settles. A turn's final transcripts and in-flight judging are sealed before granting the next floor.

Friends can talk throughout the game, including over Bonk and during the other player’s turn. Only the floor holder’s current input epoch can reach gameplay transcription and scoring. The speech meter shows actual audio activity; the outlined card and ear badge identify who Bonk is listening to. A private setup/recovery check isolates friend audio in both directions before inviting speech. Explicit mic, camera, friend-audio, and Bonk-audio controls retain their meaning during repair.

Bonk makes a brief named handoff between opportunities. Copy ends at complete sentences; audio is never trimmed to meet a normal line budget. His full utterance must render and drain on both clients before the next floor opens. A muted Bonk still advances silently. Caption fallback is shared and bounded. Input preparation and settlement hold the timer; the first eligible capture frame, including silence, starts it. Contextual interventions retain their existing 15-second spacing and per-round budgets.

There is no early defeat. After both normal opportunities, a 4–9.75 point deficit opens a focused comeback challenge using the existing ten-point Closing budget. Points reset each round; round wins persist. First to two wins takes the match. Exact ties compare rebuttal, reasoning, impact, wit, then clarity. An exact remaining dead heat is explicitly resolved by a server coin. A stuck round aborts at 240 seconds; reconnects preserve the seat and state for 60 cumulative seconds per round. Aborts never fabricate a judged winner.

## Readiness and recovery

Both microphones, both cameras, reciprocal decoded video, and functioning transcription are required. Muting or losing a required device pauses the shared game, preserving ownership, scores, remaining time, and accepted evidence. Silence, off-turn conversation, and planned transcription rotation remain healthy. Recovery uses the same private setup flow, two healthy observations with advancing capture and decoded delivery at least one second apart, and the existing cumulative 60-second allowance. Independent blockers must all clear. Failed sealed evidence still ends safely without inventing a verdict.

Setup has a 30-second permission limit, 10-second connection limit, and 15-second speech-test limit after the provider connects. Capture failures invalidate the affected check. A healthy device or transport retry reuses successful speech proof. Tagged camera probes are echoed and decoded; relay receipts follow successful decoding, and WebRTC uses advancing decoder counters. Privacy controls remain available; there is no typed-argument fallback.

Device replacement commits only after local capture initialization succeeds. Cancelled or failed repairs stop their new resources and preserve healthy devices. Cancelling a private check keeps already-working capture. Repairs preserve the latest mic/camera privacy choices, including toggles while permissions or module loading are pending. Private checks pause quietly until the player explicitly re-enables the required device. Connection loss immediately replaces stale turn controls with recovery. One connection lifecycle owns HTTP and socket deadlines, bounded retries, and cancellation. Exhausted retries show “Connection lost. Check your network.” with a manual retry; neither retry nor duplicate resume requests reset the server's recovery allowance.

Deliberate Leave ends an unfinished match immediately through one room-owned policy shared by HTTP and socket commands. Pending resume requests carry a persisted ID so Leave still releases the seat when the server has accepted resume but its response has not arrived. A newer connection invalidates that authority. Completed verdicts retain their winner after a friend leaves. Sound initialization has a ten-second deadline; worklet downloads are cancellable and retryable without replacing a healthy audio context. Setup cancellation and Leave invalidate pending initialization while preserving resources that already work.

The center label identifies whose turn it is and whether Bonk is preparing, speaking, or finishing. Cards show the listening badge and actual readiness decisions, with round wins beside the name and scores below the video. Full captions wrap below the court and may extend the page. Secondary instructions live in How to play and Device help; setup and recovery keep one current instruction and an actionable repair or cancellation. Rematch readiness appears on the cards, with a named waiting action. Occasional silent Bonk asides reuse the accepted score reason (up to eight words / 80 characters), once per turn and no more than once every six seconds. There is no additional model request or spoken interruption. The internal ledger and scoring rules remain unchanged.

Private checks retain their identity and deadlines across reconnection. Lost results can be replayed without repeating the check, and private speech cannot become shared captions or score evidence. See [protocol details](docs/PROTOCOL.md) for lifecycle and compatibility rules, and [browser acceptance](tests/browser/README.md) for coverage and reproduction commands.

## Scoring and authority

Each opportunity caps at 10 points; each player at 30 per round. Scores use integer quarter-point units. Quality 0–4 sets a bounded target per criterion; the server commits only a positive increase over the existing target. Repeated segments, duplicates, filler, and more words cannot multiply the budget.

Rebuttal/Closing weights: reasoning 35%, rebuttal 30%, impact 20%, wit 10%, clarity 5%. Both Case opportunities use reasoning 50%, impact 30%, wit 15%, clarity 5%; neither is penalized for having no opposing argument yet. Concise complete arguments compete fairly. Accent, appearance, loudness, delivery speed, and transcript imperfections are excluded. Unsupported research is not verified evidence.

Partial/eager transcripts update captions only; only provider-final utterance segments become score evidence. The model proposes quality and a reason, never points or a winner. The server checks stable segment ownership, opportunity eligibility, round/turn IDs, sealing deadlines, quality range, and duplicate keys. One committed ledger drives both displays and results. Names, topics, and speech are untrusted data. The rubric prompt and strict provider schemas are in `server/providers/openai.ts`; the rule authority is `server/game/game.ts`.

## Architecture

```mermaid
flowchart LR
  A[Player A] <-->|native WebRTC| B[Player B]
  A <-->|control, mic, video, judge WSS| N[Node: authoritative room / clock / ledger]
  B <-->|control, mic, video, judge WSS| N
  N --> IA[Ink 2: authenticated identity A]
  N --> IB[Ink 2: authenticated identity B]
  IA --> J[Shared text judge]
  IB --> J
  J -->|validated proposals| N
  N --> T[Fish Audio: one excited utterance]
  T -->|same PCM and speech epoch| N
```

React/Vite and React Three Fiber present the game. Node/Express and `ws` serve the production app and persistent connections. Native WebRTC uses authenticated server signaling, perfect negotiation, public STUN, and authenticated short-lived TURN credentials when `TURN_URLS` and `TURN_SECRET` are configured. `/api/ice` requires a current seat token and connection epoch; credentials expire after ten minutes and refresh before a replacement peer connection. Provision a compatible TURN REST-secret service separately. If direct media cannot connect, both clients use independent audio/video WSS channels. Relay video is **256×144 JPEG, up to 15 fps**, quality 0.35, with at most two unacknowledged frames; only the latest pending frame is decoded onto a persistent canvas. The last decoded frame remains visible during brief stalls; freshness guards hold play when delivery stops. Relay audio is 16 kHz mono PCM, captured in 20 ms frames and played through a bounded audio-thread jitter buffer. Local camera stays a live DOM video, independent of relay frames. Media warms up while direct negotiation runs. Network latency still bounds achievable response time.

Provider defaults are **Cartesia Ink 2**, **OpenAI GPT-6 Luna with no reasoning**, and **Fish Audio S2 Pro**, voice ID `29f4e37195264ebc86cf568ea6e36aff`, **1.2× speed, +4 dB volume, `[excited]` tags on every utterance**. Fish streams 16-bit mono 44.1 kHz PCM; the adapter preserves it as int16 PCM. A separate authenticated judge socket sends ordered 20 ms packets and a final sample-count marker. An AudioWorklet FIFO buffers approximately 120 ms, resamples without skipping, and reports render progress and output drain independently of provider EOF. HTTP cancellation aborts generation and both clients flush the canceled speech epoch. [Fish TTS API](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech). Sol with low reasoning was integrated first, then replaced after measured 7–12 second judgments. The adapters remain replaceable. Provider quotas/access are account-dependent; STT sessions are immutable private-check or turn owners; unused sessions retire. A successor can prepare during settlement, with at most four live/draining sessions per room.

Source boundaries:

- `shared/domain.ts`: domain schemas, inferred types, scoring caps and floor policy; `shared/protocol.ts`: versioned commands/events; `shared/media.ts`: validated binary codecs.
- `server/game/`: rules, transitions, clocks and the committed ledger. Room coordination changes state through explicit Game methods.
- `server/rooms/`: room coordination, seats, command dispatch and transcription ownership. `services.ts` supplies injectable providers and scheduling.
- `server/judge/`: scoring jobs, evidence-linked reactions, shared playback and bounded voice preparation.
- `server/providers/`: independent OpenAI, Cartesia and Fish adapters.
- `server/transport/`: HTTP authentication, guarded socket upgrades, rate limits and relay media. `server/index.ts` only starts and stops `createApp()`.
- `src/game/`: browser session/connection coordination. `src/media/`: device capture, peer negotiation, relay video, audio output and judge playback.
- `src/ui/`: phase views, persistent `PlayerCard`, captions/controls and the separately loaded `CourtroomStage`. Entry-form state stays in `App`; the stage has a visual fallback for loading or WebGL failure.

Bonk now hosts the welcome, coin reveal, topic invitation/nudge, and round resets with short rotating lines. Evidence-linked reactions arrive in the scoring response and combine with the next named handoff; routine commentary does not spend strategic-intervention allowances. Fixed lines warm asynchronously in a bounded memory cache, and each room prepares one replaceable reaction/handoff candidate. Turn settlement drains immediately through a capture-worklet end marker on the ordered microphone socket, then waits for provider-final STT completion and eligible scoring jobs. An end marker can arrive before or after the control command; capture-time ownership prevents cross-turn attribution. Provider stalls retain bounded recovery; evidence is never skipped for speed. Silent packets cannot overflow an STT startup buffer.

Commands carry an idempotency ID, connection epoch, match ID, and phase version. Events carry a room sequence and complete authoritative snapshot. Stale commands/audio/provider results are rejected. Sequence gaps request a snapshot. Four-digit codes locate rooms; separate 256-bit seat tokens protect reconnects and never appear in URLs. Capacity, code collision checks, create/join/control rate limits, idle expiration, one-hour room lifetime, and provider/socket cleanup are enforced. Only one match runs concurrently on the demo server. Protocol version 4 is required at socket authentication; old pages receive an explicit refresh instruction. Malformed origins/URLs are rejected without throwing. Signaling, snapshots, metrics, authentication attempts and media rates are bounded as well as game commands.

Requests capture their match, round, turn or connection ownership. Rematch/disposal cancels stale jobs and timers; same-match recovery requeues eligible scoring evidence. Browser Leave invalidates resume responses and old socket/device callbacks. Microphone timestamps use a server-synchronized monotonic clock, established before media readiness. Shared judge playback requires both initial-buffer acknowledgments and both authenticated completion acknowledgments. Generation completion alone never advances the game. Delivery interruption can replay one complete cached utterance after repair; otherwise a 2–6 second shared caption interval completes recovery. Limits are five seconds to first generated audio, three seconds without generation/render progress, twenty seconds of audio/synthesis, and thirty seconds overall per attempt. These are failure bounds, not sentence cutoffs. Metrics keep at most 128 samples per category and a 512-entry metadata timeline, with no player audio recordings. See [audio acceptance and measurement](docs/AUDIO_ACCEPTANCE.md).

## Verification and limits

Run `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm test:ui` before merging. Browser acceptance covers complete matches, recovery, rematch, rewards, and private-check isolation in Chrome with RTC and forced relay, plus phone-sized Chrome and WebKit journeys under both transports. Multi-second deterministic PCM verifies final sample accounting and asymmetric rebuffering. CI installs the browser dependencies and retains reports and failure traces. These tests use synthetic media and mock providers; [the test guide](tests/browser/README.md) describes coverage and its limits.

Live-provider rehearsal and physical two-player matches on desktop Chrome, Android Chrome, and iPhone Safari remain release requirements for the current required-media flow. Acoustic balance, mobile interruptions, real-network behavior, and hosted CI execution also need verification.

### Historical measurements

Private-beta refactor verified October 11, 2026 (Pacific):

- Type checking, 46 deterministic tests, and the production build passed for that revision.
- The four regressions fail before their fixes and pass afterward: stale judge failure, reconnect after Leave, clock discontinuity and malformed WebSocket origin. Further checks cover disposal/recovery, delayed final transcripts, duplicate commands, packet validation, manual mute, and bounded playback/metrics. The clock diagnosis is specifically synchronization startup and wall-clock discontinuities: the original browser already applied a server offset.
- A deterministic two-client WebSocket match completes 12 opportunities, recovery during judge speech, identical ledger/results and nonempty identical completed speech, then rematch. Non-floor audio cannot produce evidence.
- A real OpenAI/Cartesia/Fish synthetic-voice match completed 12 opportunities, 31 committed score events, identical results and **1,629 identical audio chunks per client**, contextual argument commentary, reconnect and rematch; zero command errors and no typed/caption-only degradation. Normal verification did not alter the saved rehearsal.
- Chrome automation at 1280×800 checked native WebRTC and forced WSS relay: both cameras, exclusive microphone tracks, manual mute, camera restoration after reload, leaving/rejoining without refresh, player-side buttons and clear captions. This used generated camera/microphone devices on one host, not two human networks. WebGL failure preserved usable room controls.
- The initial JavaScript chunk is **368 KB / 112 KB gzip**, down from approximately 1.18 MB / 324 KB gzip. The separately loaded 3D chunk remains **916 KB / 243 KB gzip**, with the expected large-chunk build warning.

Timing observations from that provider match are **server-scheduled start times**, not acoustic playback measurements: cue-to-start p95 **1,215 ms** (19 utterances), and turn-completion-to-start p95 **2,758 ms** (12 reactions/verdicts). The first four cached opening cues scheduled in 152–160 ms. The 1.5-second reaction target is therefore not established; actual end-to-end latency, FPS, broader fairness and two-network human verification remain deferred.

These measurements describe the earlier revision and do not validate the current setup and recovery flow.

### Deployment

Deploy the client and server together between matches. Keep a matching copy of both `dist/` and `dist-server/` before rebuilding. Rollback must restore both directories and restart the server, then refresh browser pages. Rooms remain deliberately ephemeral: server restarts require a new room. Do not market this beta as public-production ready.

See [demo and verification notes](docs/DEMO.md) for historical measurements, the demo script, and fallback behavior. A synthetic-audio integration test does not establish real-device human-match quality.

Current concessions: temporary laptop/Quick Tunnel hosting; low-resolution relay video; no music bed/share image/extra modes. Captions, camera-off initials, mute controls, reduced motion, and adaptive DPR/shadows are available. The 60 fps rendering target and requested end-to-end p95 judge latency have not been established across typical laptops/networks.

Production work remaining: stable persistent hosting and TURN provisioning, regional placement, room ownership across replicas, durable room/ledger recovery, provider quota and abuse management, retention review, and measured browser/network/load coverage. Quick Tunnel hosting is a hackathon demo, not a production availability guarantee.
