# Browser acceptance

Run `pnpm build` and then `pnpm test:ui`. The suite uses installed desktop Chrome, two independent browser contexts, fake camera/microphone devices, and local fixture servers on 3102 and 3103. It makes no external speech, topic, scoring, or voice-provider calls. Outputs and retained failure traces are under `output/playwright/` (ignored by Git).

The `rtc` and `relay` projects play the actual server-controlled journey: create/join, camera toggle, readiness, coin, suggested topic, rejection/custom revision, agreement, all turn types, manual mute across handoffs, reload/reconnect, speech-recognition degradation with typed recovery, matching scores/results, and rematch. Local video element identity is checked across phases. The relay project forces the existing WebSocket transport.

The visual matrix separately injects schema-validated presentation snapshots; these are **synthetic presentation fixtures**, not evidence that arbitrary game states can occur. It captures entry, lobby, coin, topic/custom/confirmation, debate, judging, results, recovery, abort, long text/zoom, and WebGL context loss. Viewports: 1280×720, 1366×768, 1440×900, 1920×1080, 1024×768, and a defensive 390×844 check. Device tests simulate denied permissions, absent cameras, blocked clipboard, and a failed lazy scene load. Keyboard checks cover dialog focus wrapping/restoration and Escape; motion checks cover both system changes and the explicit setting.

The screenshot cameras show Chrome's synthetic moving test pattern. They are not photographs of participants. Screenshots are review evidence, not pixel-perfect golden assertions. Layout assertions cover face/task/caption overlap, horizontal overflow, and clipped control bounds. Full-page captures intentionally include vertical scrolling where needed.

`/__test/*` routes exist only in `scripts/browser-fixture.ts`, bound to loopback. The production entrypoint never imports the fixture. Real network conditions, real microphones/cameras, perceived audio quality, and external providers still require a human/device smoke test.
