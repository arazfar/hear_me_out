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

CI runs type checking, core tests, the production build, and browser acceptance in a 20-minute job. It installs Chrome and WebKit with system dependencies and retains the JSON report and failure traces for 14 days. A local passing run does not establish that hosted CI has run successfully.

## Coverage

The `rtc`, `relay`, `phone`, and `webkit` projects complete setup, topic selection and agreement, every speaking turn, results, recovery, and rematch through the real server-controlled game. Both clients must receive matching scores, ledgers, and results. Rematches reset points, wins, and evidence. Local video elements stay mounted across phases. The relay project forces WebSocket media; two duplicate visual/setup scenarios are intentionally skipped there.

| Area                        | Required behavior                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup and readiness         | Captured PCM produces a final private transcript through the provider adapter. Missing devices block play. Retries reuse the seat and healthy checks. Cancellation, timeouts, and late permissions clean up only attempt-owned resources.                                                                                                             |
| Active turns                | Holding mock judging open during case, rebuttal, and closing preserves the correct heading, accessible announcement, microphone ownership, advancing clock, and enabled action.                                                                                                                                                                       |
| Rewards                     | Real server commits preserve fractional totals and complete ledgers. Four rapid quality updates produce fourteen distinct notices with no rectangle collisions under normal or reduced motion. Duplicates and restored snapshots cannot replay rewards. Mute, audio ducking, interrupted count-ups, resizing, and queue resets have focused coverage. |
| Device recovery             | Manual mute, overlapping blockers, stopped tracks, suspended audio, permission revocation, backgrounding, and lost video packets preserve the floor, remaining time, scores, and accepted evidence. A frozen live camera requires video-only replacement and fresh advancing capture and delivery; cached frames cannot reopen the clock.             |
| Capture and sound ownership | Cancellation during permissions or module loading and failed replacement graphs preserve healthy capture. Privacy choices made during repair persist until explicit re-enabling. Stalled sound downloads time out and retry; obsolete completion cannot attach duplicate nodes.                                                                       |
| Connection recovery         | Stalled requests, delayed bodies, missing authentication, reordered epochs, and exhausted retries remain bounded. Disconnected players immediately lose stale gameplay actions. A late response cannot reopen a connection after Leave.                                                                                                               |
| Private checks              | Reconnecting the current speaker retains the same check and deadlines. Interim and final test speech cannot reach shared captions, claims, evidence, judging, or awards. Lost results replay without reacquiring devices or repeating speech. Normal scored speech works after repair.                                                                |
| Departure                   | HTTP and socket Leave share one policy during setup, turns, sealing, judging, recovery, and terminal states. Pending resume ownership permits departure after server acceptance. Completed verdicts retain their winner; interrupted matches offer Back to menu.                                                                                      |

The pending-resume departure test deliberately changes the remaining player's microphone status after Leave. Media-health events may advance the room sequence, but the terminal outcome, participants, scores, claims, and ledger must remain unchanged. The departing client's session stays cleared and its sockets stay closed without replacements. Controlled server idempotency tests retain their exact sequence assertions.

Core tests cover the lifecycle boundaries with deterministic clocks and provider callbacks. `private-check-reconnect.test.ts` additionally uses real authenticated sockets and HTTP resume with a delayed provider stub. Recovery browser fixtures fill the current scoring budget before injecting faults so a legitimate pending judgment cannot change the baseline.

## Visual checks and artifacts

The visual matrix uses schema-validated presentation snapshots for setup, coin, topics, turns, judging, results, recovery, long content, and WebGL fallback. These fixtures test rendering; they do not prove that arbitrary injected states arise during play.

Viewports include 1280×720, 1366×768, 1440×900, 1920×1080, 1024×768, 360×640, 390×844, and 844×390. Checks cover face/task/caption overlap, horizontal overflow, vertical control bounds in ordinary desktop and portrait-phone states, orientation changes, keyboard focus, dialog dismissal, permission errors, clipboard failure, and reduced motion. Long content, landscape, and zoom may scroll. Zoom coverage uses 125% CSS zoom, not native browser zoom automation.

The JSON report is written to `output/playwright/results.json`; failure traces are under `output/playwright/results/`. Screenshots and recordings go to scenario-specific folders under `output/playwright/`. All are ignored by Git. Inspect representative captures alongside DOM assertions, especially for Bonk's WebGL stage and fallback. Screenshot cameras show generated test patterns, not participants. These are review artifacts rather than pixel-perfect golden tests.

## Release limits

Chrome uses its built-in synthetic media. WebKit runs the players in separate processes because its mock devices are shared within a process. Its mock microphone can stop producing audio after reload, so `synthetic-media.ts` supplies a continuous generated tone on the game's unlocked audio clock. That tone crosses the normal capture worklet, authenticated socket, private check, and provider adapter. This verifies application flow in WebKit, not native iPhone microphone continuity or audio unlocking.

Live-provider rehearsal and physical two-player matches on desktop Chrome, Android Chrome, and iPhone Safari remain release requirements. Verify real permissions, unplugging, foreground/background interruptions, acoustic echo, perceived speech/effect balance, conversational pacing, and adverse network conditions. Mock provider timing and injected device faults cannot establish those qualities. Current hosting, room durability, and other deployment limitations are documented in the [project README](../../README.md); lifecycle and compatibility rules are in the [protocol guide](../../docs/PROTOCOL.md).
