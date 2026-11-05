---
name: Hear Me Out
description: A tactile toy courtroom for two friends and the Honorable Bonk.
colors:
  cream: "#fff0ce"
  plum: "#20102e"
  lime: "#d8ff3e"
  pink: "#ff4f9a"
  cyan: "#39d8f2"
  lavender: "#b6a0e8"
  surface: "#35213f"
  player-shell: "#281833"
  muted: "#d6c6dd"
  warning: "#ffca82"
  control-primary: "#b8e51c"
  control-secondary: "#20102e"
  control-pending: "#e5ff91"
  control-accepted: "#efdfba"
  control-unavailable: "#dacdaf"
  control-unavailable-ink: "#615067"
  control-hover: "#a9d318"
  control-pressed: "#9cc315"
  control-pink: "#ff4f9a"
  control-cyan: "#39d8f2"
  field-paper: "#fffaf0"
  field-stroke: "#9c8b9e"
  paper-copy: "#64516b"
  paper-focus: "#602480"
  quiet-control: "#fff0ce0e"
  quiet-control-hover: "#fff0ce22"
  disabled-fill: "#dacdaf"
  disabled-copy: "#615067"
  option-fill: "#eaddca"
typography:
  display:
    fontFamily: "Bungee, sans-serif"
    fontSize: "clamp(48px, 6.2vw, 88px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  headline:
    fontFamily: '"Space Grotesk", sans-serif'
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  proposition:
    fontFamily: '"Space Grotesk", sans-serif'
    fontSize: "clamp(24px, 2.5vw, 36px)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  title:
    fontFamily: '"Space Grotesk", sans-serif'
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  body:
    fontFamily: '"Space Grotesk", sans-serif'
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.45
  body-small:
    fontFamily: '"Space Grotesk", sans-serif'
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: '"Space Grotesk", sans-serif'
    fontSize: "14px"
    fontWeight: 600
  action:
    fontFamily: '"Space Grotesk", sans-serif'
    fontSize: "15px"
    fontWeight: 700
  score:
    fontFamily: '"Space Grotesk", sans-serif'
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  timer:
    fontFamily: '"Space Grotesk", sans-serif'
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
  timer-phone:
    fontFamily: '"Space Grotesk", sans-serif'
    fontSize: "16px"
    fontWeight: 700
    lineHeight: "20px"
rounded:
  radius: "16px"
  radius-small: "12px"
  status: "8px"
  circular: "50%"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-6: "24px"
  space-8: "32px"
  space-12: "48px"
components:
  button-primary:
    backgroundColor: "{colors.control-primary}"
    textColor: "{colors.plum}"
    typography: "{typography.action}"
    rounded: "{rounded.radius-small}"
    padding: "12px 18px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.control-hover}"
    textColor: "{colors.plum}"
  button-primary-pressed:
    backgroundColor: "{colors.control-pressed}"
    textColor: "{colors.plum}"
  button-primary-pending:
    backgroundColor: "{colors.control-pending}"
    textColor: "{colors.plum}"
    boxShadow: "none"
  button-primary-accepted:
    backgroundColor: "{colors.control-accepted}"
    textColor: "{colors.plum}"
    boxShadow: "none"
  button-primary-disabled:
    backgroundColor: "{colors.control-unavailable}"
    textColor: "{colors.control-unavailable-ink}"
    boxShadow: "none"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.plum}"
    padding: "6px 8px"
  button-icon:
    backgroundColor: "{colors.quiet-control}"
    textColor: "{colors.cream}"
    rounded: "{rounded.circular}"
    width: "44px"
    height: "44px"
  button-icon-hover:
    backgroundColor: "{colors.quiet-control-hover}"
  button-device:
    backgroundColor: "#fff0ce0c"
    textColor: "{colors.cream}"
    rounded: "{rounded.radius-small}"
    padding: "10px 12px"
  button-device-hover:
    backgroundColor: "{colors.quiet-control-hover}"
  room-code:
    backgroundColor: "{colors.quiet-control}"
    textColor: "{colors.cream}"
    rounded: "{rounded.radius-small}"
    padding: "10px 16px"
  input-name:
    backgroundColor: "{colors.field-paper}"
    textColor: "{colors.plum}"
    rounded: "{rounded.radius-small}"
    padding: "12px 14px"
    width: "100%"
  header:
    textColor: "{colors.cream}"
    padding: "12px 32px"
  entry-card:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.plum}"
    rounded: "{rounded.radius}"
    padding: "32px"
  phase-card:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.plum}"
    rounded: "{rounded.radius}"
    padding: "24px"
  player-card-pink:
    backgroundColor: "{colors.player-shell}"
    textColor: "{colors.cream}"
    rounded: "{rounded.radius}"
    padding: "4px"
  player-card-cyan:
    backgroundColor: "{colors.player-shell}"
    textColor: "{colors.cream}"
    rounded: "{rounded.radius}"
    padding: "4px"
  dialog:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.plum}"
    rounded: "{rounded.radius}"
    width: "min(510px, calc(100% - 32px))"
---

# Design System: Hear Me Out

## Overview

**Creative North Star: "The Toy Courtroom"**

Hear Me Out makes a courtroom feel like a friendly tabletop toy: a lavender gavel judge, cream painted surfaces, rounded player frames, and a deep plum setting. The Honorable Bonk supplies the mischievous personality. The two friends remain the largest social presence, while a compact task surface makes the next action clear.

The interface uses an expressive game stage with practical setup and recovery controls. Bungee carries the identity; Space Grotesk carries instructions, names, captions, and numbers. Soft lighting and shallow control edges give the scene and interface a shared material language. Readable state labels accompany the visual playfulness.

**Key Characteristics:**

- Persistent player faces with stable pink and cyan seat identities.
- Cream task surfaces and lime actions within a plum courtroom.
- A procedural lavender Bonk with a matching static fallback.
- Rounded SVG icons, soft shadows, and brief state-driven responses.
- Separate space for the proposition, player media, captions, and controls.

The interface is implemented in `src/style.css`, `src/App.tsx`, and `src/ui`. See [product commitments](PRODUCT.md), [protocol and recovery rules](docs/PROTOCOL.md), and [browser acceptance](tests/browser/README.md) for behavior, verification commands, and release limits. The original visual reference remains in `.impeccable/surfaces/src-app-tsx.md`; its historical measurements do not establish current performance.

## Colors

Warm cream and plum establish the courtroom; vivid seat colors and lime actions make the live game easy to read. The frontmatter preserves the exact source values.

### Primary

- **Identity Lime** (`lime`): the emphasized part of the title, Bonk's accent, the judge caption label, and focus indicators on dark surfaces.
- **Action Lime** (`control-primary`): available primary actions. Enabled hover uses `control-hover`; pressing uses `control-pressed`. All three use plum text.
- **Pending / Accepted** (`control-pending`, `control-accepted`): pale lime for a request awaiting acknowledgement; warm beige for accepted Ready, Confirmed and acknowledged rematch votes. Both use plum text and no shadow.
- **Unavailable** (`control-unavailable`, `control-unavailable-ink`): muted fill and ink for disabled actions that are neither pending nor accepted.

### Secondary

- **Seat Pink** (`pink`): server seat zero, including its frame, caption name, turn accent, and courtroom seat marker.
- **Seat Cyan** (`cyan`): server seat one, using the same roles as pink.
- **Bonk Lavender** (`lavender`): Bonk's head and the result icon.
- **Secondary Controls** (`control-secondary`): plum surfaces with cream text. Side choices use `control-pink` and `control-cyan`, preserving the existing seat palette.

### Tertiary

- **Warm Warning** (`warning`): low time, manually muted controls, and captions-only status on dark surfaces. Form errors and warnings on cream use their darker local ink treatments.

### Neutral

- **Painted Cream** (`cream`): task cards, dialog surfaces, light text, and cream elements in the courtroom model.
- **Plum Ink** (`plum`): the outer ground and dark text on cream surfaces.
- **Player Shell** (`player-shell`): quiet frames beneath the colored player names, video edges, and scores.
- **Plum Surface** (`surface`): the media well beneath video and canvas content.
- **Muted Lilac** (`muted`): secondary copy on the plum field.
- **Field Paper / Field Stroke** (`field-paper`, `field-stroke`): lighter input fill with a defined edge.
- **Paper Copy / Paper Focus** (`paper-copy`, `paper-focus`): secondary prose and visible focus on light cards.
- **Quiet Control / Quiet Control Hover** (`quiet-control`, `quiet-control-hover`): translucent cream treatments for room and help controls on plum.
- **Disabled Fill / Disabled Copy** (`disabled-fill`, `disabled-copy`): the same values as the unavailable control fill and ink. Pending and accepted actions have their own treatments even while disabled.
- **Option Fill** (`option-fill`): quieter topic choices and audio setting rows on cream.

### Named Rules

**The Seat Continuity Rule.** Pink belongs to server seat zero and cyan to server seat one. Local identity, the current speaker, and the winner never reorder those colors.

**The Action Lime Rule.** Use `control-primary` for an available forward action and `lime` for established judge/identity accents and focus. Keep player identity in pink and cyan, with words and icons carrying state alongside color.

## Typography

**Display Font:** Bungee, with sans-serif fallback. The application loads the regular face (400) and disables font synthesis. The display token records the heading's computed weight (700); it does not imply an additional Bungee font file.

**Body Font:** Space Grotesk, with sans-serif fallback. Loaded weights are 400, 500, 600, and 700. The root uses 500; normal inputs inherit it.

**Character:** Bungee gives the toy court its chunky letterforms. Space Grotesk keeps instructions and live game data compact and readable. The observed sizes are tuned to their roles, not generated from a single modular ratio.

### Hierarchy

- **Display** (`display`): the title screen identity. At narrower breakpoints it becomes 58px, then 48px; short desktop viewports use 64px.
- **Headline** (`headline`): larger interface headings; dialog headings use 30px. Entry leads directly with its form instead of an extra heading.
- **Proposition** (`proposition`): the room's main heading, with wrapping for long topics. Short desktop viewports use 28px; narrow screens use 23px.
- **Title** (`title`): phase card headings. Player names use 18px, becoming 15px on narrow screens.
- **Body** (`body`, `body-small`): entry explanations and captions use the larger body role; phase instructions and dialogs use the smaller role. Support text is commonly 12px or 13px.
- **Label / Action** (`label`, `action`): field labels are semibold; lime action labels are bold. Ordinary device and text actions use 13px.
- **Score** (`score`): 34px live totals, becoming 26px on narrow screens. Tabular numerals and a 4.8ch minimum number width prevent the total from shifting as digits change; the small point label remains separate.
- **Timer** (`timer`, `timer-phone`): compact tabular seconds at 22px with 1.2 line height by default. At widths through 700px, the timer uses 16px with 20px line height beside its progress track. Neither timer token adds letter spacing.

The wordmark uses Bungee at 20px, becoming 16px on narrow screens. Bungee also appears in camera-off initials, room invitation digits, score bursts, and result headings. These are deliberate identity moments rather than a replacement for interface text.

### Named Rules

**The Two Voices Rule.** Keep Bungee on identity and celebratory moments; keep tasks, names, captions, and timed information in Space Grotesk.

## Layout

The title screen remains in document flow. At 960px and above it is a centered two-column composition, with a flexible diorama, a 320–360px form, a 32px gap, and a 1240px maximum width. Below 960px it stacks with a form capped at 420px. The hero stage is 280–400px on desktop, 220–280px on stacked tablets, and 180–200px on phones. Its perspective camera fits stable platform, podium, arch, and Bonk animation bounds with 8% clearance at each viewport edge. Resizing changes framing, not the scene model or in-game camera. The loading/error image uses the same stage container and contain sizing.

Rooms use a fixed dynamic-viewport-height shell with a header, a bounded game region, and a dedicated footer row. The visually floating dock occupies real layout space and never covers the game region. Ordinary content fits the initial viewport. The court centers safely when it fits; unusually long content, zoom, keyboards, and short landscape retain internal panel scrolling. Desktop and tablet captions use a bounded lane. On phones, captions belong to the single lower reading region; empty caption and reaction space is released without moving the cards. Focused controls receive scroll clearance. Safe-area insets apply to the header, content gutters, and footer. While a text field is focused at normal browser scale, a reduced VisualViewport height constrains the shell for the software keyboard; pinch zoom remains browser-owned.

From 960px upward, two equal player columns flank a center well sized with `clamp(280px, 25vw, 360px)`. The court has a 1512px maximum width and 24px column gaps. At 959px and below, both player seats stay side by side above the Bonk/task row. At 700px and below, the Bonk column is 80px; topic selection and recovery use the full task width. The primary turn action remains alongside Bonk. Short phones cap video at 96px and use compact captions. Unusually long content and short landscape screens scroll inside bounded panels rather than losing text.

Both player cards share intrinsic heading, video, and side/score rows through a common grid and CSS subgrid. Wrapping names enlarge the shared heading row only when needed; neither name is truncated. The task column sits outside this row sizing, so long tasks cannot stretch the faces. Video elements stay mounted through phase and viewport changes, and award space remains separate from these rows.

Outer gutters are 32px desktop, 24px tablet, and 12px phone, enlarged where device safe areas require it. The phone entry form retains 16px gutters. Captions share the courtroom's content edges. Phase padding is 24px desktop, 20px tablet and short desktop, 16px phone, and 12px short phone. Bonk and cream task panels have an 8px gap. Desktop heights at or below 820px use a 150px in-game stage and video height `clamp(180px, 28vh, 220px)`; taller desktop video uses `clamp(210px, 32vh, 330px)`.

On scored phone cards, Wins and status share one metadata row. The listening state uses an accessible ear icon; Ready and Confirmed retain text. Shared card rows align both videos even when full names wrap. Score notices retain their dedicated space above each card. One `--award-space` variable owns both the card offset and award layer: 64px normally and 36px on phones. Captions and score updates must not reposition the live faces. Names, sides, propositions, captions, and verdicts remain complete and may wrap. Physical iPhone Safari and Android Chrome testing is still required before claiming mobile-device readiness.

## Elevation & Depth

The court uses a hybrid of tonal layering, soft directional shadows, and rounded three-dimensional objects. The root's radial plum field (`radial-gradient(ellipse at 50% 48%, #4d2c59, #281632 65%, #20102e)`) provides an ambient stage. Player frames use restrained shadows and thin seat-colored video edges; the primary action has a shallow bottom inset lip. Both fit the toy material language.

### Shadow Vocabulary

- **Surface lift** (`0 12px 30px #0b041a55`): cream cards, score bursts, and toasts.
- **Player frame** (`0 12px 28px #10031944`): the dark media shells.
- **Primary action** (`inset 0 -3px 0 #51650a33, 0 5px 12px #21112919`): the resting lime button.
- **Primary hover** (`inset 0 -3px 0 #51650a33, 0 7px 18px #21112925`): the button's hover lift, paired with a 1px upward translation.
- **Dialog** (`0 20px 80px #08021099`): the modal above its plum backdrop (`#14091fc4`).

### Named Rules

**The Toy Material Rule.** Use soft cast shadows, rounded edges, and shallow inset highlights to join the interface to Bonk's physical world. Keep the established plum gradients and tactile button lip as native parts of that world.

## Shapes

The larger shells use the `radius` token; controls and nested media wells use `radius-small`. Action-required status badges use the smaller `status` radius; scores sit directly in the frame. Circular shapes are reserved for round controls, the coin, and round-win marks. Topic options use a local 10px radius.

Inputs have a 1.5px edge. Most cream cards are separated by fill and shadow instead of a perimeter border. Media is clipped inside the player frame; score explanations remain separate and can expand below it.

Icons are inline SVG paths with a 24 × 24 viewBox, no fill, a 1.8-unit stroke, and round caps and joins. The standard icon is 20px, with context-specific sizes for compact statuses and identity marks. Controls retain text or an accessible label; the decorative SVG itself is hidden from assistive technology.

## Components

### Buttons

The main action is a shallow toy button. It uses `control-primary`, plum ink, the small control radius, bold action type, and the padding recorded in frontmatter, with a minimum height of 48px. Enabled hover uses `control-hover` without moving the hit area; pressing uses `control-pressed`. Requests with `aria-busy="true"` use `control-pending`; accepted Ready, Confirmed and acknowledged rematch votes use `control-accepted`. Other disabled actions use `control-unavailable` and `control-unavailable-ink`. Pending, accepted and unavailable actions remove their shadow. Pending and accepted classes preserve their own colors while disabled.

The text action is an underlined, transparent alternative with a minimum height of 44px. Help and close controls use the circular icon treatment. Device buttons use a quieter translucent treatment, a minimum height of 44px, and explicit labels such as “Mic on” or “Mic off.” These labels describe privacy only; the listening badge describes judge eligibility. The footer's leave action is transparent. Topic choices use the option fill; sound toggles share the quieter media-control treatment instead of competing with the lime action.

The shared button transition uses `quick` (180ms); movement uses `ease` (`cubic-bezier(0.16, 1, 0.3, 1)`). Pressing an enabled button gives immediate small-scale feedback. Keyboard focus uses a 3px outline with a 4px offset, lime on the dark field and Paper Focus on light cards and dialogs. Player frames use the lime focus treatment. These are implemented treatments, not a claim of an audited accessibility standard.

### Media disclosure

The footer contains an icon-only “Mic & camera” trigger and a labeled Leave action. The trigger shows both device icons, slashed privacy states, and a warning icon for missing devices. Accessible descriptions and a focus/hover tooltip identify “Mic off”, “Camera off”, “Both off”, or “Check devices”. It opens an upward popover with two pairs: mic/camera privacy controls, then Friend audio and Bonk & effects output toggles. Pairs use 8px internal gaps and 12px between them, with no extra visible headings. Sound controls retain On/Off text, volume icons, and pressed states; changing output never changes capture, readiness, or the game clock. There is no separate Sound dialog. Capture state remains authoritative; opening and closing controls never changes media. Recovery actions remain visible in the task panel.

The popover uses a 180ms upward reveal, slight scale, and opacity; reduced motion removes the effect. All actions have at least 44×44px targets. Opening focuses the first enabled action. Escape restores trigger focus; outside click or focus dismisses without stealing focus. Tab follows normal disclosure order. All four toggles keep the popover open, including during toggle-driven recovery. The rules dialog and departure close it. Short viewports allow internal scrolling while keeping microphone and camera first. Copy feedback and room notices occupy a shared reserved area immediately above the dock. The popover opens above that area and uses the measured footer height to stay within the viewport.

### Room Code

The copyable code is a compact utility chip with quiet fill, a copy icon, and tabular digits with 0.12em tracking. Its digits are 20px on desktop and 16px on narrow screens; the “Room” prefix hides on the narrow layout. The button’s accessible name still identifies the code and copy action. While alone in the lobby, the central invitation is the only visible code; the header code returns when the friend joins.

### Cards / Containers

The joined, healthy lobby shows its lone Ready to argue/Ready button directly beneath Bonk, without a cream surface. Its semantic section and button stay mounted as pending or readiness state changes. Invitation, recovery, status, and error content retain the cream panel. The standalone action uses the lime focus ring against the plum field.

Cream cards feel like painted inserts in the court. Entry cards use the larger padding step and left-aligned forms; phase cards use responsive 24/20/16px padding (12px on short phones) and centered guidance. Both use the same surface radius and lift. Phase headings and copy can wrap. The surrounding game state determines the content; the card itself does not invent an outcome or a score.

### Inputs / Fields

Fields use Field Paper, Plum Ink, the small control radius, and the defined field stroke. Labels stay above the field. Placeholder text uses the darker local muted ink (`#706274`) and the caret uses `#762f79`. The name field is a regular inherited-size input; room digits use 24px and 0.24em tracking. Phase forms use 14px inputs with 10px 12px padding on larger screens, and at least 16px text and 44px height on phones to avoid input-focus zoom. Errors appear as labeled inline text with a warning icon.

### Navigation

The header is a compact identity and room-utility row, not a separate navigation system. The left wordmark stands alone; room-copy and help controls sit on the right. Entry already has a large title, so it does not repeat the wordmark. The original tagline appears once beside that title. Room horizontal padding steps from 32px to 24px to 12px at the layout breakpoints, with safe-area clearance. The wordmark does not leave an active room; the footer provides the explicit leave action.

### Player Seats

Player cards retain their position through setup, play, verdict, and recovery. They show live video or relay canvas when available, with the local camera mirrored. Camera-off and connecting states use initials or a camera icon plus truthful text. The score, side of the proposition, and two round-win marks remain attached to the same seat. The cream ear badge “Bonk is listening” identifies the eligible player. Other badges mark actual Ready or Confirmed decisions and private mic checks. Routine chat, coin roles, turn settlement, and result descriptions do not repeat on the cards. During rounds, a compact badge slot keeps the faces and scores aligned across handoffs; other phases omit empty status space. Speech meters remain visible on phones and react to local/received audio even off-turn. Never dim a friend’s face to imply input eligibility.

The eligible floor holder’s video edge brightens only when input opens; the ear icon and label make this understandable without color. Audible friend conversation does not change that outline. Two 12px round-win marks sit beside the name, with an accessible count. The fixed score sits beside the role below the video. The central verdict and earned marks identify the winner at every size; player cards do not repeat a WINNER badge or hide the winner’s voice activity. The marks are labeled “Wins” and retain their accessible round-win count; “Round pts” distinguishes the current round score. The ledger disclosure and reserved row are removed. The internal ledger still supplies exact totals and verdict reasons.

Fresh accepted score events drive a 400ms count-up in score units. Interrupting awards retarget from the current displayed value and land on the latest authoritative total, including quarter points. Each event gets its own colorful +X below the video: a roughly 120ms pop, upward travel, and fade within 900ms. Notices occupy up to five slots, allowing 96px per slot. Starts stagger by 85ms, and each slot stays reserved for its notice’s full 900ms lifetime. Pending notices mount only when space is available. Reduced motion uses the same queue with static labels. Totals, accessible announcements, badge pulses, and throttled sound respond immediately to accepted awards. A recovery, round or match reset, unmount, or visibility change clears the entire notice queue.

The client feedback controller consumes sequences and award IDs across subscriptions. Initial and recovered snapshots silently seed it. Stale events, duplicate awards, and awards from other rounds or matches cannot replay celebrations. Round resets snap totals immediately. Remounts start at the authoritative value, and leaving or returning from a background tab clears transient effects.

### Bonk asides

A fresh accepted award may trigger one silent aside under Bonk’s action area. It names the player and quotes the accepted reason, limited to eight words and 80 characters. One appears per turn, at least six seconds apart, for 3.2 seconds. No backlog, extra provider call, or speech is added. Ineligible or long reasons still award points normally. Speech, recovery, reset, visibility changes, and remount clear presentation; snapshots and repeated event IDs do not replay it. The spoken handoff filters out verbatim repeats of shown reasons.

### Device setup and recovery

Create/join reserves a seat while setup stays in the main menu. The successful camera/mic stream survives into the lobby. Capture, final transcription, camera echo, and reciprocal decoded delivery are independent checks. Readiness is a server decision. Privacy toggles pause play; actual source interruptions invalidate affected proof. Recovery uses the same component and specific local action, with a video-paused label when a displayed frame is stale. Independent blockers cannot unpause one another. Essential game state survives the interruption. A refreshed page asks for a tap to restart devices; a socket-only reconnect reuses them.

Lobby, recovery, and rematch repair share one readiness presentation. Local connection and device problems take precedence over waiting for a friend. A manual switch offers “Turn mic on” or “Turn camera on”; stalled capture says “Your camera stopped.” with “Restart camera”. Provider and delivery retries describe their actual progress. Local repair replaces the unavailable Ready or Rematch action. The actual problem owns the recovery heading; there is no generic heading above it. While a private check runs, its prompt and meter replace the repair button. Cancel remains available, and the local card keeps the private-check badge. Peer-only problems name the friend and affected capability. Short-phone recovery omits the redundant refresh icon, tightens empty spacing, and keeps 44px controls visible; expanded help and unusually long content can scroll.

A connection drop during a private mic check shows the same reconnecting state and clears the stale speech prompt. The prompt returns when the replacement private provider connects. The check keeps its original time limit and reuses healthy devices; a lost success response restores the completed check without asking the player to repeat it. Private speech remains absent from shared captions and scoring throughout this transition.

Socket loss immediately replaces the task with “Reconnecting…”. The stale turn countdown and completion action disappear; mounted faces, scores, privacy controls, and Leave remain. The same connection decision drives accessible announcements, without a competing banner. Once bounded automatic retries finish, “Connection lost. Check your network.” offers “Retry connection”. Authenticated state, synchronized time, and open required channels are all necessary before normal server-controlled presentation returns. Device repair stages replacement capture separately, so cancellation cannot interrupt another healthy device.

A deliberate departure ends an unfinished match with the friend's name, “No winner this time.”, and one “Back to menu” action. The empty card says “Left the court”. Recovery countdowns and device checks disappear. Completed results keep the winner or draw, with “Your friend isn’t here.” and the same exit. The departed winner's card uses an “Offline” avatar instead of a reconnect badge or stale video. Interrupted matches reuse the compact recovery footer at short phone sizes. A stalled audio download shows “Couldn’t load sound. Try again.” beside the existing retry action; it does not suggest changing permissions.

### Captions and Turn Information

Captions occupy a dedicated dark strip below the stage. Bonk is marked in lime with the gavel icon; player labels use their seat colors. The interface distinguishes captions-only judge output, final player captions, paused microphones, and connection recovery with text. The timer uses tabular digits, a seat-colored progress bar, and the warm warning treatment when time is low.

Nonempty captions are a labeled keyboard stop with an inset lime focus ring and native scrolling. A new Bonk utterance, player turn/speaker, match, or cleared caption resets the lane to its beginning before paint. Updates within the same utterance preserve the reader’s position without automatic tail-following, focus changes, or media remounts. Empty reserved lanes are outside the tab order. The media tooltip is hidden while captions have keyboard focus, so a parked pointer cannot cover the text. The trigger’s accessible name and privacy description remain available.

One presentation model prioritizes private checks, recovery, caption fallback, judge buffering/playback, settlement, preparation, and open turns. Ordinary turn labels are announced accessibly; the active card, listening icon, clock, and completion action provide visible orientation. During rounds it owns Bonk’s preparing, speaking, finishing, or captions-only status; in other phases that status appears beside his name in the caption speaker row. One phase/turn live region announces changes. Captions and score awards have separate announcements; clocks do not announce ticks. Complete supplied captions remain available through Transcript; full-text fallbacks wrap and scroll within the reserved bounded strip without line clamping. Open turns announce “Your case/rebuttal/closing” or the friend’s name without repeating a visible label. Done immediately shows “Finishing Alex’s turn…” and freezes the clock; preparation shows “Your turn next.” Buffering reads “Bonk’s getting ready…” without mouth animation. Actual rendering reads “Bonk speaking”; the faster client can show “Finishing Bonk’s line…” while waiting for its friend. Failure keeps the complete line visible with “Captions only.” Background judging preserves the open turn’s action and timer.

Decision copy comes from the same pure presentation selectors in the views and the phase announcement. Topic selection names the chooser. A successful confirmation announces “Confirmed. Waiting for Sam to confirm.”; the other player hears “Alex confirmed. Confirm your side.” Lobby readiness and rematch votes update this same region. Repeated snapshots and countdown ticks leave its text unchanged. Recovery and departure take precedence over decision feedback. Ready and Confirmed badges do not add competing live regions or move keyboard focus.

### Dialogs

Rules use a cream native dialog, bounded to the viewport, with a visible close control. The implementation opens it modally, wraps Tab and Shift+Tab through visible controls, handles Escape and backdrop dismissal, and restores prior focus. The content padding is 32px, becoming 28px 24px on narrow screens. Preview snippets describe the visual surface; the application component owns these interaction behaviors.

### Bonk and Motion

Bonk is the procedural lavender toy-gavel judge, with a lime accent, cream eyes, and a cream-and-wood court. The rendered scene points toward the eligible floor holder and uses locally rendered, audible judge amplitude for the speaking mouth. Listening, buffering, speech, and reactions have distinct poses; a silent or muted Bonk does not lip-sync a server estimate. Verdict strikes follow fresh result events. The coin icon displays the assigned H or T face, matching the accompanying text.

Fresh `floor_opened` events give the active turn surface a 220ms handoff; assignment and preparation do not celebrate early. Fresh coin results reveal the assigned face over 850ms. A round win pulses the earned win mark and triggers Bonk’s strike; a match win adds a short central confetti burst and a 180ms, 3px bench shake. Faces and captions remain stationary. Animation never controls input, clocks, or phase progression. Idle task surfaces stay still.

Effects share a gain control with “Bonk & effects.” Muting stops active or scheduled effect nodes. Clustered score sounds are throttled, effects duck beneath player/judge speech; friend audio is never automatically ducked or muted, and suspended audio is not replayed later. Reduced motion follows the system preference automatically, including changes during play; there is no manual setting. It disables CSS transitions and animations, hides confetti, updates totals immediately, and keeps static +X notices and state labels. It removes Bonk’s idle bob, blink, and strike; gaze and mouth state still communicate game state.

The stage uses a matching static Bonk image during loading or rendering failure. That decorative image does not replace room controls, media, captions, or game facts. It is an export of the actual model, not a substitute player image.

## Player-facing copy

Humanizer review covers the interface, recovery and error messages, fixed host phrases, handoffs, and generated-copy guidance. Keep one useful instruction per task, natural turn labels, and humor tied to the argument.

Entry has the title, original tagline, labeled name/code fields, and create/join actions. The name input has no redundant placeholder; pending actions say “Creating room…” or “Joining room…”. The joined lobby needs only readiness or a repair action; the invite heading and code appear while alone. Conversation and scoring guidance lives in How to play.

Setup replaces the entry form inline with a live preview, one progress message, a mic meter, and “Say anything to test your mic.” Setup is labeled private once. Hide the disabled checking action while progress is already visible, and omit the repeated transcript echo in setup and the lobby. Device selection and permission guidance appear on demand; one cancellable attempt owns resources, and retries reuse successful checks. Coin text explains the assigned role once. Confirmation keeps the full proposition and both sides visible, followed by Confirm my side and the rejection action. After confirmation, one message names the friend who has yet to confirm.

Player names, transcripts, and Bonk’s spoken scripts remain verbatim during interface copy work. Topics and sides come from the existing preset list.

Result panels show a concise winner or draw headline, a brief gavel accent, match score, and rematch or recovery actions. The panel does not repeat verdict reasons; Bonk still speaks his explanation and accessible captions retain every word. Seat colors accent wins; draws celebrate both players. Round-score ties give both players a win, and simultaneous qualification at two wins draws the match. Card voice indicators remain available. Ready badges and rematch waiting/queued states preserve their existing readiness semantics. The rules dialog contains three short play instructions, with no rubric or motion setting.

## Do's and Don'ts

### Do:

- **Do** keep pink on server seat zero and cyan on server seat one through every phase.
- **Do** use cream task surfaces, lime forward actions, and plum surroundings as the established hierarchy.
- **Do** preserve both live faces above the task when the desktop three-column stage collapses.
- **Do** pair color and icons with clear labels for speaking, mute, connection, time, and results.
- **Do** keep captions, controls, and Bonk’s brief asides in their own readable space.
- **Do** trigger score and verdict flourishes from fresh game events and honor reduced-motion settings.
- **Do** keep Bonk's static fallback consistent with the rendered character and retain the usable interface around it.

### Don't:

- **Don't** swap seat colors to make the local player, active speaker, or winner a particular color.
- **Don't** use synthetic test faces, captions, or scores as product content or customer evidence.
- **Don't** make a missing camera or muted microphone look live; use the implemented initials and status treatments.
- **Don't** replace the approved Bungee and Space Grotesk pairing or the toy-gavel identity as a routine extension.
- **Don't** hide instructions, captions, or essential controls inside the decorative 3D scene.
- **Don't** turn screenshot coverage or a local performance sample into a general accessibility, device-support, or frame-rate claim.

## Historical review notes

The dated notes below record earlier review decisions and their original validation scope. They are retained as history, not a separate source of current control or typography values; use the structured definitions and corresponding guidance above for those values. Historical measurements do not establish physical-device, live-provider or public-production readiness. Current qualification limits remain in [PRODUCT.md](PRODUCT.md) and [browser validation](tests/browser/README.md).

### Saved-comment refinement · 2026-10-31

On tall phones (width ≤700px, height >740px), videos retain a 3:4 portrait ratio, capped at 240px, across phases at the same viewport; the phone court is capped at 440px so tiles cannot become excessively tall near the tablet breakpoint. Short phones cap video at 96px, and short landscape remains compact. The shared caption lane is 96px normally and 88px on short phones. Full-text fallbacks remain available through the bounded Transcript reader; the phone excerpt follows text locally while gestures scroll the shared lower region. Live phrases use the same reserved lane. Desktop/tablet seat colors, full names, shared rows, and stable media mounting remain intact.

Entry switching uses a full-width secondary action. Setup has an 80–144px hero sized from available phone space, no tagline/credit, and a stable preview area shared by missing-camera artwork and live video. Expanded device help removes the decorative hero. The mic prompt is “Say anything to test your mic.”; successful transcription is still required. The regular home diorama retains aspect-aware complete-scene framing.

Topics are presets only. Coin copy reads “Heads. You go first.” and “Tails. You choose.” Ordinary turn text and redundant next-turn copy are visually removed while accessible speaker/stage announcements remain. Timers, I’m done, active-card highlighting, Bonk state, captions, settlement, and recovery messages remain explicit.

Result headings place the centered winner/draw title and match score directly on the courtroom, without a static gavel emblem. Recovery actions and Device help stack vertically on every screen. Desktop/tablet verdict headings and help instructions use bounded reading regions. On phones, verdicts, actions and expanded help scroll together below the fixed cards. Decorative Bonk disappears with expanded phone setup help; the preview area stays mounted and height-bounded.

### Saved-review refinements · November 2026

The toy courtroom remains the visual authority. Setup groups center in spare space. The preview is 160px desktop, 112–200px on tall phones, and 96px on short phones regardless of device stage. Expanded help and keyboard entry use compact previews and hide decoration. Entry/setup help instructions scroll independently, with retry and Back outside their reading region. In-room phone help expands inside the shared lower region. Phone video frames fill the card width with centered cover cropping. Tall phones retain the lobby’s 3:4 portrait height, capped at 240px, in every phase; short phones use 96px. Task content yields space to these fixed video tracks. Definite grid tracks allocate the heading, cards/task, captions, notifications and dock. The page and courtroom do not scroll; exceptional content uses keyboard-accessible bounded regions. Short landscape uses the three-column court with the decorative stage hidden to retain reachable task controls.

Topics use cream, plum-outlined tactile choices; sides use equally weighted pink and cyan treatments. Ready to argue and side choices retain arrows. Accepted Ready, Confirm my side, Confirmed and I’m done retain checkmarks. Pending, entry, repair and retry actions are text-only. Available Rematch includes a trailing replay arrow; queued or waiting rematches are text-only. Pending text, busy states, cancellation and acknowledgements remain explicit. Primary controls use a dedicated #B8E51C lime token, plum text, and a 48px height/12px radius (44px on short screens). Secondary controls use plum with cream text. Pink/cyan side choices retain equal weight; hover does not move hit areas. Seat and character colors remain unchanged. The timer is a compact track directly above I’m done, 78% of available width up to 220px, with a readable seconds badge and a single 420ms bounce at newly crossed five-second milestones. It never replays missed milestones after pause or backgrounding.

Results sit directly on the court, with persistent seat-colored winner/draw text and a brief text entrance and Bonk strike from fresh feedback only. Recovery controls keep their own cream grouping. Draws celebrate both seats. Shared notices use the same type, padding, radius and icon treatment; short copy feedback fits its content. Peer connection status belongs to Friend audio, and departed-seat status belongs to that card. Privacy icons remain recognizable and labeled.

The caption lane reveals provider-aligned segments at the device's rendered audio position. Player captions reveal current recognized text, including ASR corrections. The whole nonempty caption surface is a native button opening the bounded Transcript dialog through Enter/Space or touch. Its descriptive accessible name and inset focus outline are independent of full-text live announcements. The visual text viewport is excluded from sequential focus to avoid Chromium adding a second stop inside the button. Both live text and the selected transcript automatically follow additions or corrections, even after manual scrolling. Unchanged text stays stationary. A new utterance/replay resets live reading; a freshly opened reader starts at the beginning and remains attached to its selected utterance. Full text remains keyboard-scrollable in the reader. On dismissal, focus resolves to the current visible, enabled caption surface, falling back to the room shell's persistent media trigger if captions have cleared. Leaving the room does not focus detached controls or override the destination screen. Reduced motion preserves all information without movement, and no animation controls media, timing, or game state.

Review 411 retains the reserved 96px caption lane (88px on short phones, 64px in short landscape). Result score stays on its own nonwrapping row beneath the centered headline. Desktop/tablet long result headings can scroll while the recovery/rematch action remains outside that region; on phones, the complete result and recovery content scroll together. Authored copy uses “Two friends. Zero chill.” and “Speak when your card lights up. Tap ‘I’m done’ to finish.” Contextual recovery icons derive from readiness capabilities, never message text.

### Review 174: prominent faces and useful control cues

Home hero and form center as one content-sized group, with a 16px phone gap. Entry/setup Device help is left-aligned; room recovery stays centered. Expanded phone help retains a 112px preview on tall screens and 80px on short screens or during keyboard entry. The preview node stays mounted.

Phone cards anchor above one lower task region with a 12px gap. Active-round scored cards retain the shared award allowance; phase changes, captions, notices, results and recovery never reduce the video dimensions. Excess task content scrolls internally. Completed matches omit the redundant topic/round heading. Topic selection can use a 420px desktop center column (30vw), preserving equal player columns; long text still wraps.

Phone result/recovery captions use a 44px “Bonk · Transcript” control, with full text and live announcements retained. The same trigger and reader stay mounted through responsive changes. Notices retain their pinned footer area without imposing special topic-heading height caps. Ordinary propositions and round labels remain complete. Both-device recovery uses a single warning symbol beside explicit device copy; the media trigger retains both device icons.

Phones up to 800px high compact header, card padding and action spacing, while the video-size cutoff remains 740px: 741–800px phones still keep the full portrait tiles. Their gameplay caption lane is 64px. Phone timers place the small seconds badge beside the track, together above I’m done. Tasks, result headings, actions and expanded in-room help have natural heights inside the single lower scroll region; they do not create nested scroll containers. The transcript dialog retains its separate reader.

### Review 163: complete phone recovery surfaces

At widths through 700px, the fixed shell allocates the heading, shared player-card rows, one keyboard-focusable lower reading region, then pinned notifications and controls. The lower region contains Bonk, task/recovery content, actions and nonempty captions. New phase/round/turn/topic identities reset it to the top; updates to the same task retain its position. Native focus scrolling keeps help selectors reachable. Expanded help follows the verdict and recovery action in reading order. Phone caption following only moves the caption text viewport or dialog reader, never the court.

Normal 390×844 videos remain 173×230.67px; 360×640 videos remain 158×96px. A 16px heading-to-card gap and 12px card-to-task gap leave ordinary collapsed recovery panels fully visible. The active scoring award lane remains stable; other phases release unused award space. Interrupted/recovering panels use the full phone width and no decorative Bonk column. Their small contextual icon shares a row with a short heading; longer headings wrap onto a full-width row below the icon. While a software keyboard constrains the viewport, compact 64px video and card chrome keep focused controls reachable; dismissal restores the original video geometry. Short landscape retains a bounded task region that can scroll both timer and completion action into view.

Control tokens distinguish available lime (#B8E51C), pending pale lime (#E5FF91), accepted/waiting warm beige (#EFDFBA), unavailable beige (#DACDAF with #615067 text), and secondary plum/cream. Accepted Ready, Confirmed and acknowledged rematch votes derive their class from existing server decision state and have no active shadow. Available win/draw Rematch includes the existing decorative replay arrow; pending and accepted votes remain text-only.

### Review 62: balanced initial phone composition

The phone header and topic/round heading stay at the top. Within the remaining room area, cards and initially visible task/caption content center as one group when they fit. A local placement helper applies nonnegative top padding, calculated from natural content height; oversized tasks use zero offset and the existing single lower scroller. A changed repair action/icon/capability is a new task, so a larger repair panel does not inherit another task's top padding. No task-height caps or video reductions are introduced.

Placement is stable while captions change, score feedback appears, labels acknowledge a request, or Device help expands. Viewport, keyboard, pinned-notification height and font changes may recalculate it. Notification changes alter the available room area; the lower content’s own growth does not. Returning to a previously measured viewport restores that task's placement even if help is now expanded. Keyboard-open layout uses zero centering padding and the existing compact card treatment; local focus clearance scrolls only the lower region. The intrinsic wrapper uses `display: contents` outside the phone breakpoint, preserving tablet and desktop grids and mounted media/readers.

Nonempty phone captions and compact transcript surfaces have one 16px gap after the Bonk/task group. Empty captions add no gap. The decorative phone stage has stable 100px bounds (64px in short landscape) across lazy loading and fallback, so asset readiness does not change the initial measurement. Existing camera framing is unchanged. Phone recovery panels wrap their icon and heading intrinsically: short headings stay beside the icon, while longer headings receive the full inner width. Complete text wraps naturally at narrower widths without truncation or smaller type.

## Responsive cascade maintenance

`src/style.css` keeps base presentation before the responsive sections: desktop, compact desktop height, stacked tablet, phone composition, constrained phone height, short landscape, phone task surfaces, portrait boundaries, keyboard overrides, then reduced motion. Phone task surfaces intentionally follow height budgets so the single lower scroll region owns overflowing content. Keyboard overrides follow those surfaces, and reduced motion retains final precedence. Shared conditions are grouped without increasing selector specificity. Preserve this order when a width and height condition intersect; validate both sides of each boundary before changing it.
