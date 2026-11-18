# Render deployment

The `hear-me-out` Node service belongs in Kisora → kisora → Production, in Oregon.
`render.yaml` defines Free compute, one instance, and automatic deployments off.
Promote a qualified commit from `main` by SHA in the Render dashboard.
Preview deployments are intentionally omitted/disabled.
The frontend, API and four WebSocket channels share one HTTPS origin.

## Build and configuration

Node is pinned in `.node-version`; pnpm is pinned in `package.json`. CI uses the
same versions. Render installs development tools for the build, then starts
`node dist-server/index.js` directly. The local `pnpm start` supervisor remains
available for laptop demos. Render supplies `PORT`; the server binds `0.0.0.0`.

Enter `OPENAI_API_KEY`, `CARTESIA_API_KEY` and `FISH_AUDIO_API_KEY` into this
service's Environment settings. The Blueprint uses `sync: false` and never stores
their values. Do not prefix secrets with `VITE_`, put them in Git, print them, or
share them through a workspace environment group. Replace a secret in Render and
redeploy when updating credentials. Model and voice defaults stay unchanged.

`/readyz` checks configured providers, the frontend build, and shutdown state.
Startup validates the HTML entry, Vite manifest and its referenced files, plus
all three public audio worklets. That result is cached for the immutable deploy;
replacing files in a running instance requires a restart. Missing assets return
404 instead of the SPA HTML. Readiness does not call providers or prove key
validity; live smoke tests establish that.
`/healthz` remains compatible with existing scripts.

## Proxy verification

`TRUST_PROXY_HOPS` is zero for local/direct connections and initially three for
Render's public ingress. HTTP and WebSocket admission use the same right-to-left
resolver. A client-supplied prefix cannot override the trusted position. Malformed
or shorter-than-configured chains fall back to the socket peer.

Before release, temporarily set `PROXY_DIAGNOSTICS=true`. An authenticated seat's
`POST /api/diagnostics` then includes only its selected IP and forwarded-hop count.
Compare normal requests and requests with one and multiple forged X-Forwarded-For
prefixes against the caller's known public IP. Repeat with WebSocket admission.
Set the hop count to the observed ingress depth if different, repeat the probes,
then remove `PROXY_DIAGNOSTICS`. Never enable unlimited proxy trust. Revalidate
this setting if adding another proxy or changing ingress topology.

## Verification and operations

1. Confirm **Auto-Deploy** is **Off** in the Render service settings and in the Blueprint. Land changes through a PR with GitHub's `verify` check.
2. On an interactive Apple silicon Mac, check out the full SHA from `main` using the pinned Node and pnpm. Run `pnpm verify:release --sha <full-sha>`. The command builds and tests in its own detached worktree. Run it again for a different release SHA.
3. Run the [live-provider and physical-device checks](AUDIO_ACCEPTANCE.md#physicallive-provider-qualification) for that SHA, and save the provider smoke and signed-off reports as described below.
4. Run `pnpm release:check --sha <full-sha>` with GitHub CLI authenticated. The command checks the GitHub push and all release evidence. Once it prints eligibility, the release owner chooses **Manual Deploy → Deploy a specific commit** in Render. Verify the exact commit in Deploys and confirm `/readyz` succeeds.

Live-provider tests consume API usage and require keys in the process environment
or a local ignored `.env`. From the clean candidate checkout, save the JSON output of
`DOTENV_CONFIG_QUIET=true pnpm --silent verify:providers` as
`output/release/<full-sha>/provider-smoke.json`. Use `TEST_URL` with
`scripts/health-check.ts` and `pnpm verify:match` for public HTTPS/WSS and synthetic
match checks. Keep `EXPORT_REHEARSAL` unset. Synthetic checks do not establish
physical microphone/speaker quality or performance across two real networks.

Save each physical session's generated audio report as a distinct JSON file in the
same directory. After reviewing the evidence, the release owner creates `physical.json`
with the full SHA, their name, approval timestamp, and the report filenames and device
pairs. Use the codes `desktop-chrome`, `android-chrome`, and `iphone-safari`. List
each of the three pairings on RTC and WSS, with at least 100 paired judge utterances
per transport across their sessions. For example, this is one session entry in an
otherwise incomplete sign-off.

```json
{
  "sha": "0000000000000000000000000000000000000000",
  "approvedBy": "Release owner",
  "approvedAt": "2026-11-18T12:00:00Z",
  "sessions": [
    { "report": "rtc-desktop-iphone.json", "platforms": ["desktop-chrome", "iphone-safari"] }
  ]
}
```

In Render, inspect Deploys and Logs after release. Free compute does not expose
CPU/RAM usage graphs, so passing smoke checks does not establish capacity headroom.
The health check must
pass and the public game must load; verify both WebRTC and WSS fallback, reconnect,
and rematch. Run one idle/wake check without persistent browser sockets or polling.
Use existing Render failure notifications; do not add uptime keep-alive requests.

For a bad release, use Render's Deploys page to roll back to a known-good deploy.
Revert or fix the offending change in Git, qualify the corrected `main` SHA, then
deploy that specific commit. Rollback also reuses the selected
deployment's environment values: check that its secrets and proxy settings are
still appropriate and that temporary proxy diagnostics were disabled. A normal
subsequent deploy uses the service's current configuration. See
[Render's rollback behavior](https://render.com/docs/rollbacks). Free
services retain only two previous deploys for rollback. Rollbacks and all restarts
discard in-memory rooms; players must create new courts. Shutdown rejects new
admissions, closes sockets with restart code 1012, and awaits transcription
disposal while cancelled voice/judge requests release their transports. Peers
that ignore socket closure are forced closed after five seconds. Normal shutdown
exits naturally; cleanup failures report a generic message and nonzero status.
Any remaining live handle is bounded by a 25-second process deadline (Render's
deadline is 30 seconds).
The Blueprint omits `maxShutdownDelaySeconds`: Render rejects that setting on Free.

Release the scoring/deadline, worklet-cache, and lobby-lease changes as one matching client/server build between matches. Judge scores now publish per completed, validated batch; monitor `scoringMs`, `judgment_timeout`, and other `judgment_*` counters during provider qualification. Logical judging has one 12-second budget including retry. Lobby reservations and disconnected seats expire after 60 seconds; authenticated control/audio/video connections retain their seat while permissions are pending. Active-match recovery limits and finished verdict retention are unchanged.

All three stable worklet URLs are served and fetched with `no-store`; fingerprinted assets retain caching. Validate both a warm-cache upgrade and rollback with an ordinary refresh. Rolling back to a build predating this cache fix restores its old caching policy, so require a hard refresh if that build serves stale worklets. Complete local regression repetition and physical/provider qualification before release.

## Free-tier limits

Only one match may run at once. There is no durable room storage or horizontal
scaling. Free compute sleeps after 15 idle minutes and can take about a minute to
wake; Render may also restart it. Do not promise uninterrupted matches or uptime.
The workspace shares 750 free running hours each month. Bandwidth and build-minute
overages can be billed, and provider usage is separate. Media relay consumes
bandwidth, so review included usage in Billing before sharing widely. No paid
TURN service, database, persistent disk, or custom domain is provisioned.

References: [Render Free](https://render.com/docs/free),
[Blueprints](https://render.com/docs/blueprint-spec),
[WebSockets](https://render.com/docs/websocket).
