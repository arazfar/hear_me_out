# Hear Me Out

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two friends playing together on desktop Chrome, Android Chrome, or iPhone Safari, using live audio and video to make ridiculous arguments. No debate expertise is required. The primary use is social play, not formal debate training or factual adjudication.

## Product Purpose

Make a funny, fair spoken debate easy to start and worth playing again. The Honorable Bonk, a mischievous toy-gavel judge, hosts the match, responds to what players actually say, and challenges their friend to answer it. Success means both players can participate, follow the reasoning behind scores, reach a shared result, and rematch.

## Positioning

A two-friend party game combining prominent live faces, preset debate topics, a shared speaking judge, and evidence-linked live scores. Bonk is both host and judge; scoring reacts to actual arguments within equal, bounded opportunities rather than rewarding sheer speaking volume.

## Operating Context

- Players create or join a four-digit room, enter names, and pass an inline microphone, camera, and transcription check. The seat is reserved during setup. Both cameras must reach their friend before either can ready up. Headphones are recommended.
- A server coin assigns Heads to open and Tails to choose the topic and side. Both players confirm the explicit proposition before debating.
- Each round has two Cases, two Rebuttals, and two Closings. Normal opportunities allow 30 active seconds; Closings allow 15. Only “I'm done” or the deadline ends an opportunity; natural pauses retain the floor. The clock starts when the first eligible capture frame arrives, including silence. Opening order alternates by round; the trailing player closes first, with the responder first when tied.
- Friends can hear each other throughout lobby, topic selection, turns, judge speech, settlement, and results. Only the floor holder’s capture-time input grant can enter gameplay transcription or scoring. Private checks isolate both directions of friend audio before inviting speech. Judge speech holds player clocks until both clients render every sample and drain output; explicit Bonk mute advances the same timeline silently. Mic on/off always describes the privacy switch. Disabling or losing a required capability pauses active play and preserves the shared clock.
- Points reset each round. First to two round wins takes the match, followed by a rematch option.

## Capabilities and Constraints

- The supported experience targets complete matches on desktop Chrome, Android Chrome, and iPhone Safari, with two players per room and one concurrent match on the demo server. Automated browser coverage does not establish physical-device or live-provider readiness.
- Preserve preset topics, explicit agreement on the proposition, live faces, microphone checks, justified scores, shared judge speech, best-of-three matches, and rematches.
- Each opportunity has a ten-point cap, each player a thirty-point round cap. The server owns the clock, score ledger, and outcome; the model proposes quality and reasons, never points or a winner.
- Both players require live microphones and cameras, delivered video, and working transcription. Setup and recovery speech is private and cannot score. No typed-argument or camera-optional mode exists. Readiness comes from server-scoped observations and successful provider transcripts; explicit failures pause immediately and stale progress expires after three seconds.
- Only final, eligible, correctly attributed transcripts may become score evidence. Duplicate segments, filler, and verbosity cannot multiply scoring budgets. Unsupported research is not verified evidence.
- Reasoning, rebuttal, impact, wit, and clarity determine scores. Case turns are not penalized for lacking an opposing argument. Accent, appearance, loudness, delivery speed, and transcript imperfections are excluded.
- Preserve equal opportunities and no early defeat. A focused comeback challenge uses the existing Closing budget. Exact round-score ties award both players one round win. Reaching two wins together ends the match in a draw. An aborted match must never fabricate a judged winner.
- Reconnect recovery is bounded; current rooms are ephemeral and expire. Server restarts require new rooms. Raw media, room state, captions, and claims stay in memory and expire with the room; captured player recordings are off and provider keys stay server-side.
- Lost connections immediately hide stale gameplay actions and clocks. Automatic recovery is bounded by the known allowance or 60 seconds, then offers a manual retry without renewing that allowance. Device repairs preserve healthy capture and the player’s latest privacy choices; pending reconnection cannot swallow a deliberate Leave; leaving releases it.
- Deliberate departure ends an unfinished match immediately, with no reconnect wait or invented winner. Completed verdicts remain visible after a friend leaves. Sound initialization times out after ten seconds and offers a retry on the existing audio context; cancellation preserves already-working resources.
- The existing React/Vite and React Three Fiber client uses a Node/Express server with persistent WebSocket connections. Native WebRTC has an audio/video WebSocket relay fallback. The current provider adapters are replaceable; exact versions and operational settings belong in the README and code.
- Current hosting is a laptop with a temporary Quick Tunnel. Stable hosting, provisioned TURN (credential support is implemented), durable recovery, provider quota/abuse management, retention review, and broader browser/network/load coverage remain production work.
- Do not claim public-production readiness, established 60 fps across typical devices, established end-to-end judge latency targets, or statistical fairness validation.
- Open decisions: audience age, support beyond these browsers, commercial model, production deployment, and any additional accessibility standard. These must not be invented by future design work.

## Brand Commitments

The product name is **Hear Me Out**. The host is **the Honorable Bonk**, a mischievous toy-gavel judge in a courtroom setting. Existing copy is playful, irreverent, and friendly-competitive: “Two friends. Zero chill.” and “The Court of Bad Takes.” Preserve the contrast between ridiculous opinions and fair treatment of players. Bonk's reactions and handoffs should stay brief, contextual, and grounded in the actual debate.

## Evidence on Hand

- `README.md` documents current functionality, architecture, rules, verification, and known limits. `docs/DEMO.md` contains demo and historical verification notes; dated measurements retain their original scope.
- `src/ui/TitleView.tsx` and the other phase views contain shipped product copy and workflows. `src/ui/CourtroomStage.tsx` contains the procedural courtroom and character implementation; `public/favicon.svg` is an existing identity asset.
- `server/game/game.ts` and `shared/domain.ts` define game authority and limits. `server/providers/openai.ts` holds the scoring rubric; `server/judge/personality.ts` defines hosting lines.
- `tests/` and verification scripts provide deterministic and synthetic integration evidence. Saved rehearsal assets in `public/rehearsal.*` are demonstrations, not customer testimony or a live human match.
- The README records user confirmation of audio/video working on two laptops. Full human-match verification and broader performance/fairness measurement remain deferred. Historical checks must not be presented as newly run checks.
- No customer testimonials, adoption metrics, or independently validated marketing benchmarks are established in this record.

## Product Principles

1. Make arguing with a friend easy and entertaining; keep setup and recovery understandable.
2. Judge the argument that was actually made, with bounded, explainable scores and equal chances to answer.
3. Keep both players in the same match reality: shared clocks, judge speech, committed scores, and results.
4. Let Bonk add personality without interrupting participation or compromising fairness.
5. Describe capabilities and verification honestly, including privacy boundaries and beta limitations.

## Accessibility & Inclusion

Confirmation and readiness decisions must be acknowledged through the single phase announcement, including keyboard use. Rematch waiting copy distinguishes an undecided friend from queued progression; both votes can wait for Bonk’s complete playback. Recovery problems and deliberate departure take precedence. Duplicate snapshots and clock ticks must not repeat announcements.

Preserve complete captions, camera-off initials, explicit privacy controls, reduced-motion support, and usable room controls when WebGL fails. The center label identifies the turn and Bonk’s audio state; the eligible player has an ear badge. Voice meters indicate actual activity independently of eligibility. Each routine status has one visible owner. Put secondary instructions in How to play or Device help, while keeping recovery problems, repair actions, deadlines, and private-check labels visible. Preserve user-authored content verbatim. Long content may scroll; it must not be truncated to fit a screen. Preserve scoring exclusions for accent, appearance, loudness, delivery speed, and transcript imperfections. No additional product-specific accessibility standard has been confirmed.

### Saved-review refinements (November 2026)

Ready is one-way for players, with accepted/pending/error states and server-controlled readiness recovery. The three-rule dialog says to speak when the card lights up and tap “I’m done” to finish; it omits the explanatory tie subtitle. Tied rounds and drawn matches retain their existing rules.

Mobile keeps the outer screen fixed. Ordinary states fit; long instructions, full transcripts, keyboard entry, accessibility zoom, and short landscape use bounded internal scrolling. Setup previews retain their size across device stages. Full names, aligned cards, live media, and accessible recovery actions take priority over decoration.

Bonk's live phrase follows real audio alignment at rendered output time. Player phrases follow recognition updates, including corrections, without pretending that transcription has zero latency. The complete caption surface opens a bounded Transcript reader and retains the selected utterance while open. Live captions and the selected reader automatically follow newly added or corrected text, including after manual scrolling. Unchanged text stays still, and opening a complete transcript starts at its beginning. Full text remains available when alignment or voice is unavailable or sound is off. Screen readers receive complete/final text without per-word highlight announcements. Provider credentials and physical-device validation are required before claiming live synchronization or mobile-device readiness.

Phone live faces retain their tallest lobby dimensions across play, results, departure and device recovery. Surrounding task content uses bounded scrolling when needed. Completed-match screens prioritize the winner/draw, score and next action over the repeated topic heading. On phone result/recovery screens a compact transcript control replaces the excerpt, preserving the full explanation, announcements and reading behavior. Pending controls use pale lime and accepted/waiting controls use warm beige, with selected arrows/checkmarks that clarify advancing or completing an action. Available Rematch includes a replay arrow; queued votes remain text-only. On phones, one lower reading region contains tasks, recovery, expanded help and captions below the fixed faces. Notices and the media dock stay pinned. Ordinary collapsed recovery surfaces fit completely; exceptional content uses that single region, while the full transcript retains its dialog reader.

Phone room compositions center the cards and initial task within the space below the fixed topic heading and above notifications/controls. Once placed, live caption updates and expanded help do not move the faces; additional content uses the single lower scroll region. A new task or viewport can establish a new placement. Captions have clear separation from Bonk, and longer recovery headings use the full panel width without shrinking text or reducing video size.
