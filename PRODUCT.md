# Hear Me Out

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two friends playing together on desktop Chrome, using live audio and video to make ridiculous arguments. No debate expertise is required. The primary use is social play, not formal debate training or factual adjudication.

## Product Purpose

Make a funny, fair spoken debate easy to start and worth playing again. The Honorable Bonk, a mischievous toy-gavel judge, hosts the match, responds to what players actually say, and challenges their friend to answer it. Success means both players can participate, follow the reasoning behind scores, reach a shared result, and rematch.

## Positioning

A two-friend party game combining prominent live faces, free-form debate topics, a shared speaking judge, and evidence-linked live scores. Bonk is both host and judge; scoring reacts to actual arguments within equal, bounded opportunities rather than rewarding sheer speaking volume.

## Operating Context

- Players create or join a four-digit room, enter names, check microphone/camera access, confirm they can hear each other, and ready up. Headphones are recommended.
- A server coin assigns Heads to open and Tails to choose the topic and side. Both players confirm the explicit proposition before debating.
- Each round has two Cases, two Rebuttals, and two Closings. Normal opportunities allow 30 active seconds; Closings allow 15. Players can yield with “I'm done.” Opening order alternates by round; the trailing player closes first, with the responder first when tied.
- Only the floor holder's microphone is eligible during debate. Judge speech pauses player clocks and is shared between both clients. Lobby and results allow conversation; manual mute persists.
- Points reset each round. First to two round wins takes the match, followed by a rematch option.

## Capabilities and Constraints

- Current scope is a private beta for desktop Chrome, with two players per room and one concurrent match on the demo server. Mobile support and additional modes are not established commitments.
- Preserve free-form topics, explicit agreement on the proposition, live faces, microphone checks, justified scores, shared judge speech, best-of-three matches, and rematches.
- Each opportunity has a ten-point cap, each player a thirty-point round cap. The server owns the clock, score ledger, and outcome; the model proposes quality and reasons, never points or a winner.
- Only final, eligible, correctly attributed transcripts may become score evidence. Duplicate segments, filler, and verbosity cannot multiply scoring budgets. Unsupported research is not verified evidence.
- Reasoning, rebuttal, impact, wit, and clarity determine scores. Case turns are not penalized for lacking an opposing argument. Accent, appearance, loudness, delivery speed, and transcript imperfections are excluded.
- Preserve equal opportunities and no early defeat. A focused comeback challenge uses the existing Closing budget. Exact ties use the documented criterion order, then an explicit server coin if still tied. An aborted match must never fabricate a judged winner.
- Reconnect recovery is bounded; current rooms are ephemeral and expire. Server restarts require new rooms. Raw media, room state, captions, and claims stay in memory and expire with the room; captured player recordings are off and provider keys stay server-side.
- The existing React/Vite and React Three Fiber client uses a Node/Express server with persistent WebSocket connections. Native WebRTC has an audio/video WebSocket relay fallback. The current provider adapters are replaceable; exact versions and operational settings belong in the README and code.
- Current hosting is a laptop with a temporary Quick Tunnel. Stable hosting, TURN, durable recovery, provider quota/abuse management, retention review, and broader browser/network/load coverage remain production work.
- Do not claim public-production readiness, established 60 fps across typical devices, established end-to-end judge latency targets, or statistical fairness validation.
- Open decisions: audience age, broader device/browser support, commercial model, production deployment, and any additional accessibility standard. These must not be invented by future design work.

## Brand Commitments

The product name is **Hear Me Out**. The host is **the Honorable Bonk**, a mischievous toy-gavel judge in a courtroom setting. Existing copy is playful, irreverent, and friendly-competitive: “Two friends. One terrible take.” and “The Court of Bad Takes.” Preserve the contrast between ridiculous opinions and fair treatment of players. Bonk's reactions and handoffs should stay brief, contextual, and grounded in the actual debate.

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

Preserve existing captions, camera-off initials, mute controls, reduced-motion support, and usable room controls when WebGL fails. Preserve scoring exclusions for accent, appearance, loudness, delivery speed, and transcript imperfections. No additional product-specific accessibility standard has been confirmed.
