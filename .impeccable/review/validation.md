# Implementation validation — 2026-10-12

The updated application uses a responsive social stage with persistent player media, stable pink/cyan seat colors, cream task surfaces, plum surroundings, lime actions, and a procedural lavender toy-gavel judge. Bungee and Space Grotesk remain the identity typefaces. Source game rules, scoring, synchronization, deadlines, speech acknowledgments, and media transports are preserved.

## Browser evidence

`tests/browser/game.spec.ts` runs against local deterministic services with desktop Chrome and synthetic audio/video. The full journey exercises the real server game state machine; the visual matrix uses explicitly synthetic presentation snapshots. See `tests/browser/README.md` for coverage and reproduction. Screenshot camera panels contain Chrome's moving test pattern.

Inspected entry, lobby, coin, suggested/custom topics, confirmation, debate, judging, results, typed transcription recovery, disconnect recovery, abort, and WebGL fallback. Debate viewport matrix: 1280×720, 1366×768, 1440×900, 1920×1080, 1024×768, plus defensive 390×844. The long-content capture uses 125% CSS zoom; this is an approximation of increased browser scale, not a claim of native Chrome zoom automation. Native WebRTC and forced WebSocket relay journeys are exercised separately.

Concrete findings corrected during implementation: overlapping absolute panels replaced by grid; caption/face collisions eliminated; canvas intrinsic width prevented from expanding narrow grids; delayed first render and compositor resize artifacts handled in the screenshot fixture; native dialog reverse-tab escape fixed with explicit wrapping; missing device labels corrected; stale result animations moved to fresh event subscriptions; static fallback exported from the actual Bonk model. Recovery fixtures now hold the disconnected state long enough to inspect it.

## Measured performance

Baseline is committed revision `3b4b0a9`, built in an isolated ignored directory with the same installed dependencies. Hardware: Apple M1 Pro, 16 GB. Browser: headless Chrome 154, ANGLE Metal renderer on Apple M1 Pro. Viewport: 1280×720, DPR 1, normal rendering quality. Two independent camera/microphone contexts connected over native WebRTC; both server media-ready flags were verified before sampling. The second page stayed connected while the measured page was foreground.

Two five-second samples each in lobby and debate, after warmup:

| Build | Median rAF interval | 95th percentile | Observed main-thread long tasks |
|---|---:|---:|---:|
| Baseline | 33.3 ms | 33.4 ms | 0 |
| Upgrade | 33.3 ms | 33.4 ms | 0 |

These are local requestAnimationFrame intervals, not GPU frame-time measurements. They demonstrate comparable pacing in this environment, not universal 60fps, real-network performance, or audio/video quality. Raw data is preserved in `.impeccable/review/performance.json`; the local reproduction script is `output/playwright/profile.mjs`.

Approximate uncompressed JavaScript changed from 368.54 KB to 376.58 KB for the entry bundle and 915.73 KB to 921.04 KB for the lazy scene. The final build reports gzip sizes of 113.92 KB and 244.65 KB respectively. No new production dependency was added. The existing large-scene build warning remains; the scene stays lazy, caps DPR, and reduces shadows/DPR under sustained slow frames. The fallback PNG is approximately 61 KB and preserves controls and media if scene loading or WebGL fails.

## Completed checks

`pnpm check`, `pnpm test` (46/46), and `pnpm build` pass. The complete browser acceptance run passed four tests, with two deliberate skips for duplicate presentation/device cases in the relay project. Both transport-specific match journeys passed. The final copy and presentation-fixture cleanup is also covered by a focused rerun of the two Chrome presentation/device tests. `git diff --check` passes.

The independent finish reviewer requested two material fixes: full Bonk framing at increased zoom, and a coin mark matching the assigned Heads/Tails result. Both were applied and recaptured. The reviewer scored both resolved with disposition **ship**, scoped to those two findings; see `finish-review.md` and `finish-verdict.md`. The fallback raster's provenance scan passed. `DESIGN.md` and `.impeccable/design.json` document the implemented system.

## Design detector

One manual detector pass returned two style warnings and no mechanical findings. Space Grotesk is explicitly retained by the approved plan. The other warning identifies the primary button's 3px bottom inset lip; this is an intentional tactile toy-button treatment, not a side-tab accent. The independent reviewer receives both warnings unchanged.

## Limits

No human-network or real-device audio/video session was performed. External speech/topic/judging providers were replaced with deterministic test services. Production hosting was not changed. Screenshot testing cannot establish the subjective quality of live facial reactions, perceived voice latency, or sound balance.
