# Developing Hear Me Out

Use Node from `.node-version` and pnpm 10.12.1. Run the following commands from the repository root.

```sh
pnpm install --frozen-lockfile --prod=false
pnpm exec playwright install --with-deps chrome webkit
pnpm check
pnpm test
pnpm build
pnpm start
```

Open http://127.0.0.1:3000. `pnpm dev` runs Vite on 5173 and the API on 3000. Production serves the paired `dist/` and `dist-server/` builds with `NODE_ENV=production node dist-server/index.js`. Live play requires the three provider credentials named in `.env.example` in the environment or an ignored `.env`. Use `/healthz` for liveness and `/readyz` for frontend/configuration readiness. The browser fixtures run real game, media and socket code with deterministic providers on loopback.

## Check a change

```sh
pnpm exec tsx --test tests/video-progress.test.ts
pnpm test:ui --project=rtc --project=relay -g 'two players render a long' --retries=0
MEDIA_SOAK_CYCLES=10 pnpm test:ui --project=relay tests/browser/media-soak.spec.ts --retries=0
pnpm test:browser-diagnostics
pnpm test:ui --retries=0
pnpm test:ui-review
```

Rebuild after editing the client. Use `-g '<test title>'` and `--project=<name>` for a focused reproduction, then `--repeat-each=10 --retries=0` for timing or recovery changes. The six gameplay projects are `rtc`, `relay`, `phone`, `phone-relay`, `webkit`, and `webkit-relay`. Inspect per-attempt results and attachments in `output/playwright/results.json`. Run `pnpm verify:matrix` for the tagged browser matrix and `pnpm verify:release --sha <full-sha>` for local qualification. Check eligibility with `pnpm release:check --sha <full-sha>` before the release owner deploys. The optional `profile_baseline` input runs the paired profile on a dedicated runner. See [browser acceptance](tests/browser/README.md) and [audio acceptance](docs/AUDIO_ACCEPTANCE.md).

## Measure frame pacing

```sh
pnpm profile:game --app-root . --runs 1 --output output/profile/smoke.json
pnpm profile:game --app-root ../baseline --compare-root . --runs 5 --output output/profile/comparison.json
node scripts/profile-report.mjs output/profile/comparison.json
```

Install and build each checkout first. The same driver starts each checkout's fixture on loopback, alternates build and transport order, and measures a fresh Chrome session per run. After the real coin flow, the profiling fixture assigns the creator the opening Case on both builds. Compare like quality tiers at similar idle cadence. Its JSON includes raw frame intervals, idle cadence, camera progress, quality tier, CPU timings and build hashes. Use `--port` to change the default 3242. Run profiles on an idle host, separately from tests or builds. Use `--cpu-profile` in a separate single-run diagnostic to capture a DevTools CPU profile during the active Case and awards.

A missed Done acknowledgment or turn cue gives the command a failing exit after it saves the comparison. Inspect `measurement.interactions.failures` and the per-seat click, DOM and animation-frame observations in the JSON to reproduce it.

## Parallel ownership

- Use one worktree per agent and give each browser investigation its own `TEST_RTC_PORT` and `TEST_RELAY_PORT`. The game fixture's reset is process-wide. Generated screenshots, traces and JSON stay in the worktree's ignored `output/`.
- `server/game/` owns scoring, phase transitions and clocks. `server/rooms/` owns seat lifetimes, readiness, provider ownership and cleanup. Test these through injected room services and authoritative snapshots.
- `src/game/` owns session and command coordination. Each `src/media/` subsystem owns its tracks, nodes, timers and cancellation. `src/ui/` presents snapshots and user actions. Keep frame-level pixel and audio work inside its media owner.
- The scene owner maintains the pinned Three.js renderer patch in `patches/`. A Three.js upgrade must preserve lookup-texture disposal, unchanged lighting and zero detached courtroom roots after the leave/rejoin soak.
- Assign a single integrator for `shared/`, public worklets, shared fixture routes, the main browser acceptance spec, and release wiring. Coordinate changes to those contracts before concurrent edits. Keep protocol 6 and the session-storage seat format compatible, including pending resume IDs. Verify reload, genuine device loss, rematch and deliberate Leave through the UI.
