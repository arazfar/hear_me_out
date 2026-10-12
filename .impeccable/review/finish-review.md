disposition: fix

Input limits: No separate QUALITY BAR card exists (parent confirmed); the user-approved plan supplies that target. Source was sampled, not exhaustively reviewed; motion and interaction claims rely on the supplied test evidence. Older live-* and permission captures were excluded as instructed.

## persistence

Pass. PRODUCT.md exists and records the product, rules, limits, and visual identity. The surface brief and reference-notes.md persist THESIS, OWN-WORLD, STORY, FIRST VIEWPORT, FORM, and the user's approval of an existing-world expansion. The reference is explicitly a code-led critique reference, so reproduction state/spec/diffs and a random replacement-world seed are not applicable. DESIGN.md is the remaining documenter deliverable, not a pre-existing document contradicted by this build. All 20 named captures exist, show the claimed phases, and have plausible dimensions; full-page scrolling at compact sizes is valid. The zoom image is valid evidence of an implementation crop.

## fidelity

The generated reference is not an approved reconstruction spec. The following matrix judges the implemented direction contract.

| Element or promise | Status | Evidence |
| --- | --- | --- |
| TYPE | match | Bungee supplies the identity/display voice; Space Grotesk provides readable interface text. Both are explicitly retained by the user, so the detector's font warning is not a defect. |
| MATERIAL | match | The focal Bonk/cream courtroom is rendered by the procedural 3D scene; the static fallback shows that same model. Rounded pink/cyan frames and soft directional shadows support the agreed toy world. The primary button's shallow bottom inset is a tactile control edge, not the detector's claimed side accent. |
| GROUND | match | The visible field stays plum, with cream foreground/panels; src/style.css declares #20102e and a plum radial field through #4d2c59. No blue-black or unrelated ground substitution. |
| THESIS and seat continuity | match | Both large live-media regions remain pink-first/cyan-second through setup, debate, judging, results, and recovery. Source mounts them by stable server seat order. |
| FIRST VIEWPORT and action hierarchy | match | Entry pairs the diorama with one concise form. Room captures prioritize proposition, current speaker/time, and the lime action; captions and player controls occupy separate rows. |
| Responsive composition | match | The 1280, 1366, 1440, and 1920 captures preserve three columns. The 1024 and 390 captures place the two seats above the task and allow intentional vertical scrolling. |
| Bonk framing under zoom | contradicted | zoom-long-content.png cuts through the front of the bench at the canvas's lower edge. Normal and fallback captures show the complete base; CourtroomStage.tsx:467 uses Canvas without a zoom-aware resize override. |
| STORY and coin assignment | contradicted | coin-1440.png says “Tails. Choose the argument and your side.” beneath a coin marked H. CoinView.tsx:8 always uses the coin path in Icon.tsx:46, whose inner strokes draw H regardless of headsId. |
| Results, rematch, and recovery | match | Supplied captures distinguish round/match results, provide the rematch action, explain typed speech recovery, preserve seats during reconnect, and offer a fresh match after abort. |
| Truth and accessibility | match | tests/browser/README.md explicitly identifies the presentation fixtures and synthetic camera pattern. PlayerCard uses live streams/relay frames and camera-off initials. Sampled controls expose mic on/off/paused states, dialogs use native modal behavior with focus restoration, and StageLoader supplies the visible fallback. Parent-reported interaction/motion checks are not independently rerun here. |

## ceiling

No additional material finding against the user-confirmed code-led quality target. The reference's continuous scenic bench and molded plinths are unused native devices, but the approved plan makes runtime faces, responsive DOM controls, and the procedural scene authoritative; those reference details are not reconstruction obligations. Animation feel cannot be judged from still captures.

## material_fixes

1. FIRST VIEWPORT / responsive craft: correct the R3F canvas measurement/framing at 125% zoom so the complete Bonk arch, bench front, and base remain visible; recapture .impeccable/review/zoom-long-content.png and confirm normal desktop framing remains intact (src/ui/CourtroomStage.tsx:467).
2. STORY / truth: make the coin's visible face agree with the assigned Heads/Tails result, or use a neutral coin mark; the Tails result must not display H. Recapture .impeccable/review/coin-1440.png (src/ui/CoinView.tsx:8; src/ui/Icon.tsx:46).

## keep

Keep the persistent live faces, stable pink/cyan seats, plum/cream hierarchy, real Bonk scene and matching fallback, restrained copy, separate caption/control rows, and server-authoritative behavior.
