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
  lime-hover: "#e5ff7c"
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
    fontSize: "64px"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.03em"
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
    backgroundColor: "{colors.lime}"
    textColor: "{colors.plum}"
    typography: "{typography.action}"
    rounded: "{rounded.radius-small}"
    padding: "12px 18px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.lime-hover}"
  button-primary-disabled:
    backgroundColor: "{colors.disabled-fill}"
    textColor: "{colors.disabled-copy}"
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
    padding: "10px 14px"
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
    padding: "18px 32px"
  entry-card:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.plum}"
    rounded: "{rounded.radius}"
    padding: "32px"
  phase-card:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.plum}"
    rounded: "{rounded.radius}"
    padding: "22px"
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

- **Action Lime** (`lime`): primary actions, the emphasized part of the title, Bonk's accent, and the judge caption label.
- **Lifted Lime** (`lime-hover`): primary action hover state.

### Secondary

- **Seat Pink** (`pink`): server seat zero, including its frame, caption name, turn accent, and courtroom seat marker.
- **Seat Cyan** (`cyan`): server seat one, using the same roles as pink.
- **Bonk Lavender** (`lavender`): Bonk's head and the result icon.

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
- **Disabled Fill / Disabled Copy** (`disabled-fill`, `disabled-copy`): the shared disabled action treatment.
- **Option Fill** (`option-fill`): quieter topic choices and audio setting rows on cream.

### Named Rules

**The Seat Continuity Rule.** Pink belongs to server seat zero and cyan to server seat one. Local identity, the current speaker, and the winner never reorder those colors.

**The Action Lime Rule.** Use lime for the forward action and established judge/identity accents. Keep player identity in pink and cyan, with words and icons carrying state alongside color.

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
- **Score / Timer** (`score`, `timer`): 34px live totals and 64px remaining time. Scores become 26px on narrow screens. Both use tabular numerals; the small point label remains separate. A 4.8ch minimum number width prevents the total from shifting as digits change.

The wordmark uses Bungee at 20px, becoming 16px on narrow screens. Bungee also appears in camera-off initials, room invitation digits, score bursts, and result headings. These are deliberate identity moments rather than a replacement for interface text.

### Named Rules

**The Two Voices Rule.** Keep Bungee on identity and celebratory moments; keep tasks, names, captions, and timed information in Space Grotesk.

## Layout

The root fills at least the small viewport height and stacks the header, main stage, captions, and controls in normal document flow. The entry screen is a centered two-column grid with a flexible diorama and a 360px form, a 56px gap, and a 1240px maximum width. Its outer padding is 24px 32px 44px.

At desktop widths of 1120px and above, the room is a three-column grid: two equal flexible player seats around a 280px center well. The stage has a 1512px maximum width, 24px column gaps, and 32px horizontal padding. The proposition sits above it. Captions follow directly below the courtroom with an 1100px maximum width; flexible space sits above the court and before the footer controls, keeping speech close to the action. Bonk stays above the task in every phase, including live turns. The turn type and owner share one heading, such as “Your rebuttal.” During rounds, the court stays anchored below the proposition so changing captions and handoff controls do not shift the live faces.

At 1119px and below, both player seats remain side by side in the first row. The center well spans the next row, with Bonk next to the task. At 700px and below, both seats stay side by side above an 80px Bonk stage and the action area. Topic selection and recovery use the full width. Captions and brief Bonk feedback have separate space; controls remain at least 44px tall. Short phones use 96px video, tighter heading spacing, and compact inline captions. Reflowed layouts above 700px wide reserve 56px between the faces and task for score pops; phones use 40px. Short phones retain their 32px gap and move award pops 4px closer to the cards. Landscape, long content, and zoom retain scrolling. This supports the approved Android Chrome and iPhone Safari scope; physical-device verification is still required.

The compact desktop rule combines a maximum height of 820px with a minimum width of 1120px. It uses 8px vertical header padding, 12px below the proposition, a 150px Bonk stage, 14px task padding, and media height `clamp(180px, 30vh, 330px)`. The result trophy hides at this size; Bonk and the winner heading carry the moment. Taller desktops use media height `clamp(210px, 32vh, 330px)`. Narrower layouts use their own bounded heights. The courtroom uses a 24px bottom inset on desktop, with a separate award layer. Reflowed layouts use compact gaps; short phones retain a 32px handoff gap and keep footer controls visible. Ordinary turns, results, and rematch readiness fit a 1280×720 viewport. Long content and zoom retain scrolling.

The declared spacing steps are recorded in frontmatter. Component spacing also includes measured fit values such as the 22px phase padding and 24px courtroom gap; do not replace these with an invented uniform grid. Long names, topics, and captions wrap within their columns.

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

The main action is a shallow toy button. It uses lime, plum ink, the small control radius, bold action type, and the padding recorded in frontmatter, with a minimum height of 48px. Hover brightens the fill and lifts it slightly. Disabled actions use the shared disabled colors and remove their shadow.

The text action is an underlined, transparent alternative with a minimum height of 44px. Help and close controls use the circular icon treatment. Device buttons use a quieter translucent treatment, a minimum height of 44px, and explicit labels such as “Mic on” or “Mic off.” These labels describe privacy only; the listening badge describes judge eligibility. The footer's leave action is transparent. Topic choices and audio settings use the option fill instead of competing with the lime action.

The shared button transition uses `quick` (180ms); movement uses `ease` (`cubic-bezier(0.16, 1, 0.3, 1)`). Pressing an enabled button gives immediate small-scale feedback. Keyboard focus uses a 3px outline with a 4px offset, lime on the dark field and Paper Focus on light cards and dialogs. Player frames use the lime focus treatment. These are implemented treatments, not a claim of an audited accessibility standard.

### Room Code

The copyable code is a compact utility chip with quiet fill, a copy icon, and tabular digits with 0.12em tracking. Its digits are 20px on desktop and 16px on narrow screens; the “Room” prefix hides on the narrow layout. The button’s accessible name still identifies the code and copy action. While alone in the lobby, the central invitation is the only visible code; the header code returns when the friend joins.

### Cards / Containers

Cream cards feel like painted inserts in the court. Entry cards use the larger padding step and left-aligned forms; phase cards use 22px padding and centered guidance. Both use the same surface radius and lift. Phase headings and copy can wrap. The surrounding game state determines the content; the card itself does not invent an outcome or a score.

### Inputs / Fields

Fields use Field Paper, Plum Ink, the small control radius, and the defined field stroke. Labels stay above the field. Placeholder text uses the darker local muted ink (`#706274`) and the caret uses `#762f79`. The name field is a regular inherited-size input; room digits use 24px and 0.24em tracking. Phase forms use smaller 14px inputs with 10px 12px padding. Errors appear as labeled inline text with a warning icon.

### Navigation

The header is a compact identity and room-utility row, not a separate navigation system. The left wordmark stands alone; room-copy and help controls sit on the right. Entry already has a large title, so it does not repeat the wordmark. The original tagline appears once beside that title. Horizontal padding steps from 32px to 24px to 16px at the layout breakpoints. The wordmark does not leave an active room; the footer provides the explicit leave action.

### Player Seats

Player cards retain their position through setup, play, verdict, and recovery. They show live video or relay canvas when available, with the local camera mirrored. Camera-off and connecting states use initials or a camera icon plus truthful text. The score, side of the proposition, and two round-win marks remain attached to the same seat. The cream ear badge “Bonk is listening” identifies the eligible player. Other badges mark actual Ready or Confirmed decisions and private mic checks. Routine chat, coin roles, turn settlement, and result descriptions do not repeat on the cards. During rounds, a compact badge slot keeps the faces and scores aligned across handoffs; other phases omit empty status space. Speech meters remain visible on phones and react to local/received audio even off-turn. Never dim a friend’s face to imply input eligibility.

The eligible floor holder’s video edge brightens only when input opens; the ear icon and label make this understandable without color. Audible friend conversation does not change that outline. Two 12px round-win marks sit beside the name, with an accessible count. The fixed score sits beside the role below the video. Desktop winners receive a small badge; phones use the central winner heading and earned marks. The ledger disclosure and reserved row are removed. The internal ledger still supplies exact totals and verdict reasons.

Fresh accepted score events drive a 400ms count-up in score units. Interrupting awards retarget from the current displayed value and land on the latest authoritative total, including quarter points. Each event gets its own colorful +X below the video: a roughly 120ms pop, upward travel, and fade within 900ms. Notices occupy up to five slots, allowing 96px per slot. Starts stagger by 85ms, and each slot stays reserved for its notice’s full 900ms lifetime. Pending notices mount only when space is available. Reduced motion uses the same queue with static labels. Totals, accessible announcements, badge pulses, and throttled sound respond immediately to accepted awards. A recovery, round or match reset, unmount, or visibility change clears the entire notice queue.

The client feedback controller consumes sequences and award IDs across subscriptions. Initial and recovered snapshots silently seed it. Stale events, duplicate awards, and awards from other rounds or matches cannot replay celebrations. Round resets snap totals immediately. Remounts start at the authoritative value, and leaving or returning from a background tab clears transient effects.

### Bonk asides

A fresh accepted award may trigger one silent aside under Bonk’s action area. It names the player and quotes the accepted reason, limited to eight words and 80 characters. One appears per turn, at least six seconds apart, for 3.2 seconds. No backlog, extra provider call, or speech is added. Ineligible or long reasons still award points normally. Speech, recovery, reset, visibility changes, and remount clear presentation; snapshots and repeated event IDs do not replay it. The spoken handoff filters out verbatim repeats of shown reasons.

### Device setup and recovery

Create/join reserves a seat while setup stays in the main menu. The successful camera/mic stream survives into the lobby. Capture, final transcription, camera echo, and reciprocal decoded delivery are independent checks. Readiness is a server decision. Privacy toggles pause play; actual source interruptions invalidate affected proof. Recovery uses the same component and specific local action, with a video-paused label when a displayed frame is stale. Independent blockers cannot unpause one another. Essential game state survives the interruption. A refreshed page asks for a tap to restart devices; a socket-only reconnect reuses them.

Lobby, recovery, and rematch repair share one readiness presentation. Local connection and device problems take precedence over waiting for a friend. A manual switch offers “Turn mic on” or “Turn camera on”; stalled capture says “Your camera stopped.” with “Restart camera”. Provider and delivery retries describe their actual progress. Local repair replaces the unavailable Ready or Rematch action. The actual problem owns the recovery heading; there is no generic heading above it. While a private check runs, its prompt and meter replace the repair button. Cancel remains available, and the local card keeps the private-check badge. Peer-only problems name the friend and affected capability. Short-phone recovery omits the redundant refresh icon, tightens empty spacing, and keeps 44px controls visible; expanded help and unusually long content can scroll.

A connection drop during a private mic check shows the same reconnecting state and clears the stale speech prompt. The prompt returns when the replacement private provider connects. The check keeps its original time limit and reuses healthy devices; a lost success response restores the completed check without asking the player to repeat it. Private speech remains absent from shared captions and scoring throughout this transition.

Socket loss immediately replaces the task with “Reconnecting…”. The stale turn countdown and completion action disappear; mounted faces, scores, privacy controls, and Leave remain. The same connection decision drives accessible announcements, without a competing banner. Once bounded automatic retries finish, “Connection lost. Check your network.” offers “Retry connection”. Authenticated state, synchronized time, and open required channels are all necessary before normal server-controlled presentation returns. Device repair stages replacement capture separately, so cancellation cannot interrupt another healthy device.

A deliberate departure ends an unfinished match with the friend's name, “No winner this time.”, and one “Back to menu” action. The empty card says “Left the court”. Recovery countdowns and device checks disappear. Completed results keep the winner and reason, with “Your friend isn’t here.” and the same exit. The departed winner's card uses an “Offline” avatar instead of a reconnect badge or stale video. Interrupted matches reuse the compact recovery footer at short phone sizes. A stalled audio download shows “Couldn’t load sound. Try again.” beside the existing retry action; it does not suggest changing permissions.

### Captions and Turn Information

Captions occupy a dedicated dark strip below the stage. Bonk is marked in lime with the gavel icon; player labels use their seat colors. The interface distinguishes captions-only judge output, final player captions, paused microphones, and connection recovery with text. The timer uses tabular digits, a seat-colored progress bar, and the warm warning treatment when time is low.

One presentation model prioritizes private checks, recovery, caption fallback, judge buffering/playback, settlement, preparation, and open turns. Keep the short turn label centrally beside Bonk and the clock. During rounds it owns Bonk’s preparing, speaking, finishing, or captions-only status; in other phases that status appears beside his name in the caption speaker row. One phase/turn live region announces changes. Captions and score awards have separate announcements; clocks do not announce ticks. Complete supplied captions wrap and extend the page naturally, without slicing or line clamping. Open turns show “Your case/rebuttal/closing” or the friend’s name. Done immediately shows “Finishing Alex’s turn…” and freezes the clock; preparation shows “Your turn next.” Buffering reads “Bonk’s getting ready…” without mouth animation. Actual rendering reads “Bonk speaking”; the faster client can show “Finishing Bonk’s line…” while waiting for its friend. Failure keeps the complete line visible with “Captions only.” Background judging preserves the open turn’s label, action, and timer.

Decision copy comes from the same pure presentation selectors in the views and the phase announcement. Topic selection names the chooser. A successful confirmation announces “Confirmed. Waiting for Sam to confirm.”; the other player hears “Alex confirmed. Confirm your side.” Lobby readiness, undo, and rematch votes update this same region. Repeated snapshots and countdown ticks leave its text unchanged. Recovery and departure take precedence over decision feedback. Ready and Confirmed badges do not add competing live regions or move keyboard focus.

### Dialogs

Rules and audio settings use a cream native dialog, bounded to the viewport, with a visible close control. The implementation opens it modally, wraps Tab and Shift+Tab through visible controls, handles Escape and backdrop dismissal, and restores prior focus. The content padding is 32px, becoming 28px 24px on narrow screens. Preview snippets describe the visual surface; the application component owns these interaction behaviors.

### Bonk and Motion

Bonk is the procedural lavender toy-gavel judge, with a lime accent, cream eyes, and a cream-and-wood court. The rendered scene points toward the eligible floor holder and uses locally rendered, audible judge amplitude for the speaking mouth. Listening, buffering, speech, and reactions have distinct poses; a silent or muted Bonk does not lip-sync a server estimate. Verdict strikes follow fresh result events. The coin icon displays the assigned H or T face, matching the accompanying text.

Fresh `floor_opened` events give the turn heading a 220ms handoff; assignment and preparation do not celebrate early. Fresh coin results reveal the assigned face over 850ms. A round win pulses the earned win mark and triggers Bonk’s strike; a match win adds a short central confetti burst and a 180ms, 3px bench shake. Faces and captions remain stationary. Animation never controls input, clocks, or phase progression. Idle task surfaces stay still.

Effects share a gain control with “Bonk & effects.” Muting stops active or scheduled effect nodes. Clustered score sounds are throttled, effects duck beneath player/judge speech; friend audio is never automatically ducked or muted, and suspended audio is not replayed later. The reduced-motion setting follows the system preference unless overridden. It disables CSS transitions and animations, hides confetti, updates totals immediately, and keeps static +X notices and state labels. It removes Bonk’s idle bob, blink, and strike; gaze and mouth state still communicate game state.

The stage uses a matching static Bonk image during loading or rendering failure. That decorative image does not replace room controls, media, captions, or game facts. It is an export of the actual model, not a substitute player image.

## Player-facing copy

Humanizer review covers the interface, recovery and error messages, fixed host phrases, handoffs, and generated-copy guidance. Keep one useful instruction per task, natural turn labels, and humor tied to the argument.

Entry has the title, original tagline, labeled name/code fields, and create/join actions. The name input has no redundant placeholder; pending actions say “Creating room…” or “Joining room…”. The joined lobby needs only readiness or a repair action; the invite heading and code appear while alone. Conversation and scoring guidance lives in How to play.

Setup replaces the entry form inline with a live preview, one progress message, a mic meter, and “Say ‘Bonk, hear me out.’” Setup is labeled private once. Hide the disabled checking action while progress is already visible, and omit the repeated transcript echo in setup and the lobby. Device selection and permission guidance appear on demand; one cancellable attempt owns resources, and retries reuse successful checks. Coin text explains the assigned role once. Confirmation keeps the full proposition and both sides visible, followed by Confirm my side and the rejection action. After confirmation, one message names the friend who has yet to confirm.

User-written topics, sides, names, transcripts, generated verdict reasons, and Bonk’s spoken scripts remain verbatim during interface copy work.

Results give the winner, outcome, and reason, with any tie-break explanation shown once. Ready badges on the player cards show rematch decisions. After voting, the action says “Waiting for Sam” only while the healthy friend has not voted. Both-ready or device-blocked waits say “Rematch queued”; genuine blockers and repair actions stay visible. Both-ready announces “Both ready. Rematch queued.” Bonk’s caption row owns his playback status, and the server starts the next match after both clients finish his line. The central verdict owns the winner, reason, and any necessary tie-break explanation; player cards retain scores and earned win marks without repeating “Round winner” or “Round complete”. Rules, scoring facts, accessibility labels, and useful recovery instructions remain intact.

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
