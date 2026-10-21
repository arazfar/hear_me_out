# Render deployment

The `hear-me-out` Node service belongs in Kisora → kisora → Production, in Oregon.
`render.yaml` defines Free compute, one instance, and deployments from `main` only
after GitHub CI succeeds. Preview deployments are intentionally omitted/disabled.
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

Run `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm test:ui` before merging.
Live-provider tests consume API usage and require keys in the process environment
or a local ignored `.env`. Run `pnpm verify:providers`; use `TEST_URL` with
`scripts/health-check.ts` and `pnpm verify:match` for public HTTPS/WSS and synthetic
match checks. Keep `EXPORT_REHEARSAL` unset. Synthetic checks do not establish
physical microphone/speaker quality or performance across two real networks.

In Render, inspect Deploys and Logs after release. Free compute does not expose
CPU/RAM usage graphs, so passing smoke checks does not establish capacity headroom.
The health check must
pass and the public game must load; verify both WebRTC and WSS fallback, reconnect,
and rematch. Run one idle/wake check without persistent browser sockets or polling.
Use existing Render failure notifications; do not add uptime keep-alive requests.

For a bad release, use Render's Deploys page to roll back to a known-good deploy.
A dashboard rollback disables automatic deployments. Revert the offending change
in Git, wait for its CI checks to pass, then restore **After CI Checks Pass** in
Settings and verify the corrected commit deploys; deploy that checked commit
manually if it is not automatically queued. Rollback also reuses the selected
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
