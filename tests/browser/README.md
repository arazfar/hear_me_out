# Browser acceptance

## Run

Install dependencies with `pnpm install --frozen-lockfile`, then install browsers with `pnpm exec playwright install --with-deps chrome webkit`.

```sh
pnpm check
pnpm test
pnpm build
pnpm test:ui
```

The suite starts loopback fixture servers on ports 3102 and 3103. Keep those ports free. It uses independent players, synthetic cameras and microphones, and mock speech, topic, judging, and voice providers. It makes no external provider calls. The fixture and its `/__test/*` routes are never imported by the production entrypoint.

Run the departure regression repeatedly in both transports with:

```sh
pnpm exec playwright test tests/browser/recovery.spec.ts --project=rtc --project=relay -g 'Leave releases' --repeat-each=5
```

CI runs type checking, core tests, the production build, and browser acceptance in a 30-minute job. The six-project suite took 19.5 minutes in the local UI simplification run; the job allowance also covers dependency and browser installation. It installs Chrome and WebKit with system dependencies and retains the JSON report and failure traces for 14 days. A local passing run does not establish that hosted CI has run successfully.

## Coverage

The `rtc`, `relay`, `phone`, `phone-relay`, `webkit`, and `webkit-relay` projects complete setup, topic selection and agreement, every speaking turn, results, recovery, and rematch through the real server-controlled game. Both clients must receive matching scores, ledgers, and results. Rematches reset points, wins, and evidence. Local video elements stay mounted across phases. Projects ending in `relay` force WebSocket media; two duplicate visual/setup scenarios are intentionally skipped there.

| Area                        | Required behavior                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup and readiness         | Captured PCM produces a final private transcript through the provider adapter. Missing devices block play. Retries reuse the seat and healthy checks. Cancellation, timeouts, and late permissions clean up only attempt-owned resources.                                                                                                             |
| UI clarity                  | Ready badges reflect player decisions. A single phase/turn live region owns task announcements; Bonk’s round status stays central and other-phase status sits beside his caption name. Full long captions, unusual user punctuation, named confirmation waiting, actionable recovery, and caption fallback remain visible without duplicate routine labels. |
| Active turns                | Holding mock judging open during case, rebuttal, and closing preserves the correct heading, accessible announcement, microphone ownership, advancing clock, and enabled action.                                                                                                                                                                       |
| Rewards                     | Real server commits preserve fractional totals and complete ledgers. Four rapid quality updates produce fourteen distinct notices with no rectangle collisions under normal or reduced motion. Duplicates and restored snapshots cannot replay rewards. Mute, audio ducking, interrupted count-ups, resizing, and queue resets have focused coverage. |
| Device recovery             | Manual mute, overlapping blockers, stopped tracks, suspended audio, permission revocation, backgrounding, and lost video packets preserve the floor, remaining time, scores, and accepted evidence. A frozen live camera requires video-only replacement and fresh advancing capture and delivery; cached frames cannot reopen the clock.             |
| Capture and sound ownership | Cancellation during permissions or module loading and failed replacement graphs preserve healthy capture. Privacy choices made during repair persist until explicit re-enabling. Stalled sound downloads time out and retry; obsolete completion cannot attach duplicate nodes.                                                                       |
| Connection recovery         | Stalled requests, delayed bodies, missing authentication, reordered epochs, and exhausted retries remain bounded. Disconnected players immediately lose stale gameplay actions. A late response cannot reopen a connection after Leave.                                                                                                               |
| Private checks              | Reconnecting the current speaker retains the same check and deadlines. Interim and final test speech cannot reach shared captions, claims, evidence, judging, or awards. Lost results replay without reacquiring devices or repeating speech. Normal scored speech works after repair.                                                                |
| Departure                   | HTTP and socket Leave share one policy during setup, turns, sealing, judging, recovery, and terminal states. Pending resume ownership permits departure after server acceptance. Completed verdicts retain their winner; interrupted matches offer Back to menu.                                                                                      |

The pending-resume departure test deliberately changes the remaining player's microphone status after Leave. Media-health events may advance the room sequence, but the terminal outcome, participants, scores, claims, and ledger must remain unchanged. The departing client's session stays cleared and its sockets stay closed without replacements. Controlled server idempotency tests retain their exact sequence assertions.

Core tests cover the lifecycle boundaries with deterministic clocks and provider callbacks. `private-check-reconnect.test.ts` additionally uses real authenticated sockets and HTTP resume with a delayed provider stub. Recovery browser fixtures fill the current scoring budget before injecting faults so a legitimate pending judgment cannot change the baseline.

Mic requalification uses a healthy provider that can drain accepted evidence. Terminal provider failure after gameplay PCM instead aborts without granting another floor or issuing a winner, and releases its transports. Core recovery tests also hold retired streams across replacement: delayed clean finals must settle exactly once, while abnormal closure, provider error, and the original drain deadline fail safely.

Relay admission tests schedule capture and both delivery hops independently, with opposite 60-second client wall-clock offsets, clock jumps, synchronization refreshes, and varying 0–100 ms jitter. They use the real client clock-reading path, check packet order through 600 ms delivery age, and retain the 750/751 ms boundary. The existing worklet tests establish the separate playback-buffer bound; these are deterministic admission checks, not acoustic or real-network measurements.

The long-utterance scenario renders nine seconds plus a distinct final partial frame on both clients, delays the second client’s middle packets by one second, and explicitly mutes Bonk on one client. Both worklets must report the full sample count and the server must accept both completions before normal advancement. This is render accounting with mock PCM, not a physical speaker test.

The friend-output continuity assertion in this scenario remains a qualification issue for headless WebKit RTC. A follow-up matrix run observed nine consecutive low-energy samples at 100 ms intervals, despite complete judge rendering. The same assertion also failed in one of two isolated runs on the pre-follow-up commit `d03b329`, with a shorter dip. This establishes an intermittent pre-existing failure, not its root cause or physical-device incidence. Keep the assertion and failure artifacts; a passing recheck does not establish uninterrupted friend playback.

The decision-feedback scenario runs in all six projects. It checks lobby readiness and undo, role-specific topic selection, Enter-to-confirm feedback, subsequent Tab navigation, and a single announcement despite duplicate snapshots and clock ticks. A finished-match fixture then exercises real rematch votes during nine seconds of judge playback, with Bonk muted on one client and reduced motion on the other. Both clients must show “Rematch queued”, drain every sample, receive exactly one new-match coin event, and preserve repair/departure precedence. Peer microphone failure must keep its repair instructions visible while the healthy player’s vote stays queued. Screenshots and `decision-feedback-*.webm` recordings accompany these checks. Live-region DOM assertions establish message ownership and updates; they do not establish actual VoiceOver or other screen-reader speech.

On macOS WebKit, the decision-feedback test uses Option-Tab to include buttons in native keyboard navigation; ordinary Tab uses the browser’s default link/form-field mode. Chrome and Linux WebKit use Tab. The application does not override either navigation mode or move focus after confirmation.

The decision-feedback journey also makes another fixture room occupy the stage after both rematch votes are queued. Rejection must preserve the verdict and an actionable explanation on both clients. Once capacity is free, retry starts exactly one match and clears the obsolete notice.

See [audio acceptance and measurement](../../docs/AUDIO_ACCEPTANCE.md) for latency definitions, per-transport targets, diagnostic export, and the live/physical qualification matrix.

## Visual checks and artifacts

The visual matrix uses schema-validated presentation snapshots for setup, coin, topics, turns, judging, results, recovery, long content, and WebGL fallback. Injected open turns also connect their matching mock transcription owner so the readiness monitor does not replace a turn screenshot with recovery during capture. Assertions run after capture as well as before it. These fixtures test rendering; they do not prove that arbitrary injected states arise during play.

Viewports include 1280×720, 1366×768, 1440×900, 1920×1080, 1024×768, 360×640, 390×844, and 844×390. Checks cover face/task/caption overlap, score pops touching task or caption content, horizontal overflow, vertical control bounds in ordinary desktop and portrait-phone states, orientation changes, keyboard focus, dialog dismissal, Device help disclosure and device selectors, permission errors, clipboard failure, and reduced motion. Long content, landscape, and zoom may scroll. Zoom coverage uses 125% CSS zoom, not native browser zoom automation. The full-caption presentation scenario runs in all six projects at desktop, 360×640, 390×844, and landscape sizes. It checks exact transcript text, unclipped wrapping, verbatim propositions and sides, central turn labels, status deduplication, optional help, keyboard focus restoration, and static reduced-motion cues. Recovery coverage checks the actual problem heading and repair action, without a generic holding message or disabled checking button.

The JSON report is written to `output/playwright/results.json`; failure traces are under `output/playwright/results/`. Screenshots and recordings go to scenario-specific folders under `output/playwright/`. All are ignored by Git. Inspect representative captures alongside DOM assertions, especially for Bonk's WebGL stage and fallback. Screenshot cameras show generated test patterns, not participants. These are review artifacts rather than pixel-perfect golden tests. For the UI simplification pass, baseline screenshots and Chrome/WebKit match recordings are retained under `output/playwright/ui-simplification/before/`; matching updated files are under `output/playwright/ready-together/after/`. Review the recorded handoffs for stable faces and captions, readable labels, and immediate action availability. Check grayscale captures and muted judge playback separately from normal audio. Synthetic browser recordings cannot establish physical Android/iPhone behavior or live-provider sound.

## Release limits

Chrome uses its built-in synthetic media. WebKit runs the players in separate processes because its mock devices are shared within a process. Its mock microphone can stop producing audio after reload, so `synthetic-media.ts` supplies a continuous generated tone on the game's unlocked audio clock. That tone crosses the normal capture worklet, authenticated socket, private check, and provider adapter. This verifies application flow in WebKit, not native iPhone microphone continuity or audio unlocking.

Live-provider rehearsal and physical two-player matches on desktop Chrome, Android Chrome, and iPhone Safari remain release requirements. Verify real permissions, unplugging, foreground/background interruptions, acoustic echo, perceived speech/effect balance, conversational pacing, and adverse network conditions. Mock provider timing and injected device faults cannot establish those qualities. Current hosting, room durability, and other deployment limitations are documented in the [project README](../../README.md); lifecycle and compatibility rules are in the [protocol guide](../../docs/PROTOCOL.md).
