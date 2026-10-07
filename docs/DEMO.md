Current update: exclusive server-authorized speaking turns replace overlap play. Relay frames are 256×144 at up to 15 fps, displayed on a persistent canvas without an age cutoff. Bonk makes shared, clock-paused handoffs between opportunities. Player yield controls sit outside their own cards, or underneath on narrow screens. Human verification and latency/FPS benchmarking remain deferred.

# Demo and verification — October 7, 2026

## Observed

- TypeScript check and production build pass. Critical tests cover score budgets, duplicate/stale/off-floor evidence, equal opportunities and first-to-two/rematch, protected handoff/resumption, bounded overlap refunds, topic agreement, recovery without an invented winner, clocks paused by judge speech, streamed score JSON atomicity, and the bounded relay audio buffer/packet format.
- **13 focused tests pass**, including final-only transcript evidence and Fish prosody/PCM/cancellation.
- Actual provider access and independent transcription were exercised. Generated voice audio fed into Ink produced a correctly attributed transcript, an OpenAI proposal, and server-committed justified points.
- Two Chrome pages with fake camera/microphone devices exercised native direct WebRTC and forced WSS. Both local videos played; both decoded remote relay cameras appeared. This is browser integration, not proof of different-network media.
- Two real laptops initially exposed local-video reattachment flicker and relay backlog. Stable video refs and the lower-delay relay were deployed. The user then confirmed audio/video were working properly.
- The final Fish-voiced synthetic match verified shared barge-in cancellation with zero off-floor points, reconnect preserving the match/floor/remaining time, **649 identical judge audio chunks**, a shared winner, and rematch.
- Real-provider synthetic-audio matches exercised six opportunities per round, two-round completion, matching results, identical judge audio chunks, a named argument-specific intervention, and a fresh rematch. No fixture scores or simulated local winner were used.
- An idle Cartesia socket closure no longer crashes Node; the failure callback fires once and failed streams stop accepting sends.
- Judge fixtures swapped display names, compared a concrete syrup-pocket argument against unsupported preference, and attempted score-rule injection. Strong arguments ranked above the weak preference; instruction-only speech earned zero. The final five-fixture check scored the strong argument 5.75 with both names and both speaking orders, versus 2.50 for preference and zero for instruction-only injection. This is a small fixture check, not a statistical fairness claim.

## Measurements, honestly scoped

Sol judgments measured approximately 7–12 seconds, which caused the switch to Luna/no reasoning. In three sampled Luna fixture requests, the first complete bounded score objects arrived at approximately **1.71, 2.05, and 1.88 seconds**; total structured responses took roughly 2.7–3.0 seconds. A later five-fixture run measured first complete score objects at **0.892, 0.996, 0.998, 0.860, and 1.148 seconds**, with total responses at **1.64–2.29 seconds**. These are small text-fixture samples; the end-to-end p95 ≤1.5-second display target is **not established**. Streaming commits complete validated score objects while the rest of the response is pending.

The previous Cartesia voice adapter's first generated audio chunk measured **406 ms** in one smoke run. The judge voice was subsequently switched to Fish Audio at the user's request; that historical number is not a Fish latency claim. Fish returned a successful streamed sample using the requested voice ID, 1.2× speed, +4 dB volume, and excited tags. The 406 ms figure is generation latency, not end-of-thought-to-browser playback latency. The full ≤2-second p95 spoken-intervention target remains unverified. STT semantic-end detection, judgment, network transport, and shared playback scheduling add delay. Never present these generation numbers as end-to-end measurements.

Visual checks used 1280×800 Chrome. The under-player “I’m done” control and colorful score explosion/count-up were checked with actual committed points. Faces/captions stay protected during score, coin, and verdict feedback. Adaptive rendering lowers DPR and disables shadows under sustained slow frames; typical-laptop 60 fps remains a target rather than an established result.

## Rehearsal

Keep the server/tunnel laptop awake. Check `/healthz`, then run a real two-network headphone match. Confirm both people hear each other before Ready. Speak after the floor badge appears. Use short complete arguments and “I'm done”; semantic handoff is also available. Verify the final name, scores, and round wins match on both screens, then both press Rematch.

The intended 90-second script:

1. 0–10 s: preflighted laptops enter the same code, show both live faces, Ready.
2. 10–20 s: coin/roles; choose waffles/pancakes; both confirm.
3. 20–48 s: short first-round arguments. Point out the syrup-pocket score burst and Bonk's named challenge.
4. 48–75 s: second round, concise specific rebuttals, visible momentum.
5. 75–85 s: shared verdict and decisive reason.
6. 85–90 s: both choose Rematch.

This pacing is aspirational: normal sealing/judging and a three-round match can run longer. Continue the live match; do not accelerate rules or override scores to force 90 seconds.

Example argument: “Waffles' pockets trap syrup, so each bite gets sweetness instead of the last bite swimming in a puddle.” Rebuttal: “Pockets make sweetness uneven; pancakes absorb it across a soft surface. Breakfast should optimize balance.” These are suggested demo lines, not expected model scores.

## Clearly labeled failure fallback

- Direct media failure: automatic low-resolution WSS audio/video, with the mode shown in the lobby.
- TTS failure: shared judge text/captions, with voice recovery clearly stated.
- STT failure: retry, then shared typed arguments under the same opportunity budgets while player media remains live. This is degraded recovery, not full voice completion.
- Persistent judge failure: abort with no invented winner; Rematch or join a fresh room.
- Unrecoverable provider outage: open `/rehearsal.html` to show the saved successful synthetic rehearsal result/transcript labeled **Rehearsal replay — generated test speech, real providers**. Explain the failed component. Never pass a replay off as a live match.

## Final 20 minutes

At 2:40 p.m. Pacific: freeze features. Check public HTTPS, persistent WS, permissions, both media modes, provider availability, audio controls, and a match/rematch. Keep the tunnel running. Rehearse without extra browser tabs holding microphone streams. Restarting Node resets ephemeral rooms; restarting Quick Tunnel changes its URL.

## Remaining risk

Temporary hosting and missing TURN make relay necessary on restrictive networks. One demo match at a time keeps provider/resource use bounded. Credentials/quotas and the local network can still cause outages. Stable hosting, TURN, durable recovery, quota/abuse controls, retention review, and measured load/browser coverage are the specific remaining production tasks.
