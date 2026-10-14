# Audio, turn, and visual acceptance

Protocol 4 separates friend conversation, judge eligibility, and judge output. Correctness takes priority over a latency target: do not skip samples, bypass settlement, or charge player time before capture opens. Deploy matching client/server builds between matches; old pages must refresh.

## Automated evidence and measurement

Run `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm test:ui`. Core tests use deterministic clocks, real binary codecs, worklets evaluated at 44.1/48 kHz, and provider stubs. Socket integration uses real authenticated WebSockets. Browser acceptance uses actual browser AudioWorklets and RTC/relay connections with synthetic media and mock providers. `verify:match` uses real providers when keys are configured, but simulates output acknowledgments; identical received chunks are not proof of acoustic playback.

The nine-second fixture contains a detectable final partial frame. Tests cover late middle chunks and EOF, exact rendered sample counts, asymmetric clients, Bonk mute, provider chunks larger than the old decoder limit, invalid/stale acknowledgments, backpressure, one complete replay, and caption fallback. Capture tests verify partial-frame flush, ordered end markers, delayed final evidence, input epochs, and no pause-based auto-yield. Routing tests exercise social/private/health/gameplay purposes and exclusion from STT/scoring. Existing recovery tests cover permission loss, stopped devices, suspended audio, foreground changes, socket reconnection, private-check reconnect, and deliberate Leave.

The browser audio fixture supplies distinct tones to the two microphones and measures actual friend-output level/frequency throughout judge playback and a judge-socket repair. It uses a roughly 170 ms energy window and dominant spectral frequency to tolerate short native-codec concealment while detecting muted or stalled routes; this does not certify gap-free acoustic output. It catches connected-but-one-way RTC negotiation, which video readiness alone cannot establish. Unit coverage also preserves pre-intervention capture tails and a racing Done without admitting speech captured after Bonk takes the floor.

Capture-clock tests simulate a 400 ms clock correction, retaining already captured timestamps, sample ownership, and the exact deadline. The WebKit relay fixture checks that fresh conversation stays audible throughout playback; widening the stale-packet allowance is not a substitute for keeping the capture clock mapping current.

A current seat may POST its normal session credentials to `/api/diagnostics` to export bounded metadata (no audio, transcript text, or provider keys). Export promptly after an utterance: the room keeps only the newest 512 events and 128 samples per category. Never put seat tokens in URLs or reports. Run `pnpm exec tsx scripts/audio-report.ts diagnostics.json` to report p50/p95 and the slower client's cue/Done-to-render measurements, split by transport and cached/uncached source. Incomplete pairs are reported rather than treated as success. Add browser version, device/output route, RTT, provider configuration, and foreground state to each qualification run's manifest.

| Metric                 | Start → end                                                                        | Healthy-session initial target              |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| Visible acknowledgment | click/tap handler → first frame showing Done/repair acknowledgment                 | p95 ≤100 ms                                 |
| Turn cue               | receipt of `floor_opened` → correctly emphasized card and label                    | p95 ≤100 ms; two-client skew ≤150 ms        |
| Cached cue             | server `judge_buffer` cue time → first AudioWorklet-rendered sample, slower client | p95 ≤400 ms                                 |
| Uncached cue           | same, including synthesis                                                          | p95 ≤1,500 ms                               |
| Done reaction          | server `turn_seal` → first rendered judge sample, slower client                    | p95 ≤2,500 ms                               |
| Next input             | later accepted `render_complete` → next valid capture frame                        | p95 ≤250 ms                                 |
| Conversation           | microphone capture → friend's acoustic output                                      | provisional p95 ≤200 ms RTC / ≤300 ms relay |

Targets apply to foreground clients at RTT ≤150 ms; report failures/recoveries separately rather than removing them silently. Cue/Done metrics use synchronized client render clocks. Server timestamps also expose input grant/first capture, capture receipt, provider final/drained, score commit, first TTS packet/EOF, and per-seat render progress/completion. Use browser performance marks plus an animation-frame observation for visible acknowledgments and turn cues. Output timestamps/latency guards estimate hardware drain; loopback or synchronized acoustic recordings are needed for conversation latency and final syllables. Diagnostic capture must be an explicit qualification activity, not game recording enabled by default.

Historical README p95 values (1,215 ms cue-to-start and 2,758 ms Done-to-start; warmed cues 152–160 ms) measured server-scheduled starts on an earlier revision. They are directional baselines only. Current acoustic latency, conversational comfort, and physical-device support remain unqualified until the sessions below are recorded in a separate evidence report.

## Required visual and browser matrix

Run desktop Chrome (`rtc`, `relay`), phone-sized Chrome (`phone`, `phone-relay`), and WebKit (`webkit`, `webkit-relay`). Full matches, recovery, rematches, and multi-second completion run under both transports. The desktop visual matrix covers 1280×720, 1366×768, 1440×900, 1920×1080, 1024×768, 360×640, 390×844, landscape, CSS zoom, keyboard operation, reduced motion, and WebGL failure. Inspect representative screenshots and recordings; DOM assertions cannot verify Bonk's appearance, timing, or emphasis. Check grayscale manually: ear/outline/text must still identify the floor, independently of the speech meters. Preserve two adjacent faces and 44px essential targets on phones.

## Physical/live-provider qualification

Use two people on separate networks, with actual Cartesia/OpenAI/Fish providers. Cover desktop Chrome ↔ Android Chrome, desktop Chrome ↔ iPhone Safari, and Android Chrome ↔ iPhone Safari, plus a mobile/mobile same-platform pair where practical. Run native RTC (including provisioned TURN) and forced WSS. Collect at least 100 judge utterances per transport across the matrix. Record complete matches and rematches, RTT and output routes, and explicitly check the final syllable on both sides. Do not label emulated WebKit as iPhone evidence.

Use distinct simultaneous sources for each friend and Bonk. Chat during every phase, every turn, settlement, and judge speech; check uninterrupted friend output and independent meters. Off-turn and private test phrases must appear in zero gameplay STT payloads, captions, evidence, awards, or cancellations. With speakers, check whether acoustic echo re-enters the eligible microphone; routing exclusion alone cannot prove echo cancellation. Repeat with headphones and wired/Bluetooth outputs.

Speak immediately before Done/deadline and after the listening badge appears. Verify final syllables, partial capture frames, correct attribution, no semantic auto-yield, and no time consumed during preparation. Interrupt each socket separately, switch RTC to relay, delay first/middle/final judge chunks and EOF, suspend/resume the context, replace devices, revoke permissions, background/foreground the page, and reconnect during sealing/playback. Confirm one bounded cached replay or shared captions, preserved accepted evidence and privacy choices, useful repair labels, no stale floor unlock, and cleanup after Leave.

## Deployment boundary

This scope keeps React/R3F, the authoritative Node room/ledger, and two-peer WebRTC. No SFU is required for two seats. TURN REST credential plumbing is implemented; service provisioning is not. WSS is a degraded fallback: TCP head-of-line blocking and low-resolution JPEG video cannot match native media on poor networks. Retain conservative admission limits until provider quotas, CPU, memory, socket backlog, and relay bandwidth are load-tested. Stable hosting, regional placement, replica ownership, durable restart recovery, quota/abuse operations, and retention review remain deployment work. Passing this suite is not public-production readiness.
