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
    fontSize: "32px"
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
    backgroundColor: "{colors.pink}"
    textColor: "{colors.plum}"
    rounded: "{rounded.radius}"
    padding: "5px"
  player-card-cyan:
    backgroundColor: "{colors.cyan}"
    textColor: "{colors.plum}"
    rounded: "{rounded.radius}"
    padding: "5px"
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

This record is extracted from `src/style.css`, `src/App.tsx`, and the implemented `src/ui` components after the final review corrections. Entry computed styles were sampled at 1200 × 872; source expressions remain authoritative. The approved direction is in `.impeccable/surfaces/src-app-tsx.md`. Product commitments and verification limits remain in `PRODUCT.md` and `.impeccable/review/validation.md`. Sidecar tonal ramps are synthesized swatch previews, not additional shipped palette scales.

## Colors

Warm cream and plum establish the courtroom; vivid seat colors and lime actions make the live game easy to read. The frontmatter preserves the exact source values.

### Primary

- **Action Lime** (`lime`): primary actions, the emphasized part of the title, Bonk's accent, and the judge caption label.
- **Lifted Lime** (`lime-hover`): primary action hover state.

### Secondary

- **Seat Pink** (`pink`): server seat zero, including its frame, caption name, turn accent, and courtroom seat marker.
- **Seat Cyan** (`cyan`): server seat one, using the same roles as pink.
- **Bonk Lavender** (`lavender`): Bonk's head and the small gavel mark on the entry card.

### Tertiary

- **Warm Warning** (`warning`): low time, manually muted controls, and captions-only status on dark surfaces. Form errors and warnings on cream use their darker local ink treatments.

### Neutral

- **Painted Cream** (`cream`): task cards, dialog surfaces, light text, and cream elements in the courtroom model.
- **Plum Ink** (`plum`): the outer ground and dark text on cream or player-color surfaces.
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
- **Headline** (`headline`): entry card heading. Dialog headings use 30px; both retain the shared tight heading spacing.
- **Proposition** (`proposition`): the room's main heading, with wrapping for long topics. Short desktop viewports use 28px; narrow screens use 23px.
- **Title** (`title`): phase card headings. Compact desktop phase cards use 22px. Player names use 20px, becoming 18px on short desktops and 15px on narrow screens.
- **Body** (`body`, `body-small`): entry explanations and captions use the larger body role; phase instructions and dialogs use the smaller role. Support text is commonly 12px or 13px.
- **Label / Action** (`label`, `action`): field labels are semibold; lime action labels are bold. Ordinary device and text actions use 13px.
- **Score / Timer** (`score`, `timer`): live totals and remaining time. Scores become 28px on short desktops and 26px on narrow screens. Both use tabular numerals; the small point label remains separate.

The wordmark uses Bungee at 20px, becoming 16px on narrow screens. Bungee also appears in camera-off initials, room invitation digits, score bursts, and result headings. These are deliberate identity moments rather than a replacement for interface text.

### Named Rules

**The Two Voices Rule.** Keep Bungee on identity and celebratory moments; keep tasks, names, captions, and timed information in Space Grotesk.

## Layout

The root fills at least the small viewport height and stacks the header, main stage, captions, and controls in normal document flow. The entry screen is a centered two-column grid with a flexible diorama and a 360px form, a 56px gap, and a 1240px maximum width. Its outer padding is 24px 32px 44px.

At desktop widths of 1120px and above, the room is a three-column grid: two equal flexible player seats around a 300px center well. The stage has a 1512px maximum width, 28px column gaps, and 32px horizontal padding. The proposition sits above it. Captions have their own row with an 1100px maximum width; the footer controls follow below. The live turn places its timer and action before the lower Bonk scene.

At 1119px and below, both player seats remain side by side in the first row. The center well spans the next row, with Bonk next to the task. At 700px and below, that center well becomes a single column, while the two seats remain together above it. Controls and captions wrap; the page can scroll vertically. This is responsive defensive behavior for the desktop-focused product, not a new mobile support commitment.

The compact desktop rule combines a maximum height of 820px with a minimum width of 1120px. It reduces header spacing, phase padding, stage height, player-name size, and score size. Media height is bounded with `clamp(150px, 25vh, 205px)` in that mode. The regular desktop video well uses a 16:9 ratio; the narrower layouts use explicit bounded heights.

The declared spacing steps are recorded in frontmatter. Component spacing also includes measured fit values such as the 22px phase padding and 28px courtroom gap; do not replace these with an invented uniform grid. Long names, topics, and captions wrap within their columns.

## Elevation & Depth

The court uses a hybrid of tonal layering, soft directional shadows, and rounded three-dimensional objects. The root's radial plum field (`radial-gradient(ellipse at 50% 48%, #4d2c59, #281632 65%, #20102e)`) provides an ambient stage. Player frames have a small top highlight; the primary action has a shallow bottom inset lip. Both fit the toy material language.

### Shadow Vocabulary

- **Surface lift** (`0 12px 30px #0b041a55`): cream cards, score bursts, and toasts.
- **Player frame** (`inset 0 2px 0 #ffffff66, 0 10px 24px #10031955`): the colored media shells.
- **Primary action** (`inset 0 -3px 0 #51650a33, 0 5px 12px #21112919`): the resting lime button.
- **Primary hover** (`inset 0 -3px 0 #51650a33, 0 7px 18px #21112925`): the button's hover lift, paired with a 1px upward translation.
- **Dialog** (`0 20px 80px #08021099`): the modal above its plum backdrop (`#14091fc4`).

### Named Rules

**The Toy Material Rule.** Use soft cast shadows, rounded edges, and shallow inset highlights to join the interface to Bonk's physical world. Keep the established plum gradients and tactile button lip as native parts of that world.

## Shapes

The larger shells use the `radius` token; controls and nested media wells use `radius-small`. Status strips and score disclosures use the smaller `status` radius. Circular shapes are reserved for round controls, the coin, and round-win marks. Topic options use a local 10px radius, and the entry gavel mark uses 14px with a slight rotation.

Inputs have a 1.5px edge. Most cream cards are separated by fill and shadow instead of a perimeter border. Media is clipped inside the player frame; score explanations remain separate and can expand below it.

Icons are inline SVG paths with a 24 × 24 viewBox, no fill, a 1.8-unit stroke, and round caps and joins. The standard icon is 20px, with context-specific sizes for compact statuses and identity marks. Controls retain text or an accessible label; the decorative SVG itself is hidden from assistive technology.

## Components

### Buttons

The main action is a shallow toy button. It uses lime, plum ink, the small control radius, bold action type, and the padding recorded in frontmatter, with a minimum height of 48px. Hover brightens the fill and lifts it slightly. Disabled actions use the shared disabled colors and remove their shadow.

The text action is an underlined, transparent alternative with a minimum height of 36px. Help and close controls use the circular icon treatment. Device buttons use a quieter translucent treatment, a minimum height of 44px, and explicit labels such as “Mic on,” “Mic off,” or “Mic paused.” The footer's leave action is transparent. Topic choices and audio settings use the option fill instead of competing with the lime action.

The shared button transition uses `quick` (180ms); movement uses `ease` (`cubic-bezier(0.16, 1, 0.3, 1)`). Keyboard focus uses a 3px outline with a 4px offset, lime on the dark field and Paper Focus on light cards, dialogs, and player frames. These are implemented treatments, not a claim of an audited accessibility standard.

### Room Code

The copyable code is a compact utility chip with quiet fill, a copy icon, and tabular digits with 0.12em tracking. Its digits are 20px on desktop and 16px on narrow screens; the “Room” prefix hides on the narrow layout. The button's accessible name still identifies the code and copy action.

### Cards / Containers

Cream cards feel like painted inserts in the court. Entry cards use the larger padding step and left-aligned forms; phase cards use 22px padding and centered guidance. Both use the same surface radius and lift. Phase headings and copy can wrap. The surrounding game state determines the content; the card itself does not invent an outcome or a score.

### Inputs / Fields

Fields use Field Paper, Plum Ink, the small control radius, and the defined field stroke. Labels stay above the field. Placeholder text uses the darker local muted ink (`#706274`) and the caret uses `#762f79`. The name field is a regular inherited-size input; room digits use 24px and 0.24em tracking. Phase forms use smaller 14px inputs with 10px 12px padding. Errors appear as labeled inline text with a warning icon.

### Navigation

The header is a compact identity and room-utility row, not a separate navigation system. The left wordmark carries its brand line; room-copy and help controls sit on the right. Horizontal padding steps from 32px to 24px to 16px at the layout breakpoints. The wordmark does not leave an active room; the footer provides the explicit leave action.

### Player Seats

Player cards retain their position through setup, play, verdict, and recovery. They show live video or relay canvas when available, with the local camera mirrored. Camera-off and connecting states use initials or a camera icon plus truthful text. The score, side of the proposition, status strip, and two round-win marks remain attached to the same seat.

The active speaker's status strip changes to cream with bold plum text. The winner receives a labeled badge; the frame keeps its seat color. The latest scoring reason is a native disclosure with a concise preview and an expandable ledger. The preview truncates only the collapsed reason; expanded text can scroll within a 180px maximum height.

Scores tally over 480ms only for increases in the same round. Fresh committed score events produce a brief 1.2s burst; snapshot restoration does not supply a decorative score event. The accessible score names the final total while the visible number animates.

### Captions and Turn Information

Captions occupy a dedicated dark strip below the stage. Bonk is marked in lime with the gavel icon; player labels use their seat colors. The interface distinguishes captions-only judge output, final player captions, paused microphones, and connection recovery with text. The timer uses tabular digits, a seat-colored progress bar, and the warm warning treatment when time is low.

### Dialogs

Rules and audio settings use a cream native dialog, bounded to the viewport, with a visible close control. The implementation opens it modally, wraps Tab and Shift+Tab through visible controls, handles Escape and backdrop dismissal, and restores prior focus. The content padding is 32px, becoming 28px 24px on narrow screens. Preview snippets describe the visual surface; the application component owns these interaction behaviors.

### Bonk and Motion

Bonk is the procedural lavender toy-gavel judge, with a lime accent, cream eyes, and a cream-and-wood court. The rendered scene points toward the current player and uses audio amplitude for the speaking mouth. Verdict strikes follow fresh result events. The coin icon displays the assigned H or T face, matching the accompanying text.

Phase content arrives over 280ms with a small 4px rise. The coin lands over 0.8s. Score bursts and result confetti last 1.2s; confetti is triggered by a new result. The reduced-motion setting follows the system preference unless the user overrides it. It disables CSS transitions and animations, hides confetti, makes scores update directly, and removes Bonk's idle bob, blink, and verdict strike. Gaze and mouth state still communicate the active game state.

The stage uses a matching static Bonk image during loading or rendering failure. That decorative image does not replace room controls, media, captions, or game facts. It is an export of the actual model, not a substitute player image.

## Do's and Don'ts

### Do:

- **Do** keep pink on server seat zero and cyan on server seat one through every phase.
- **Do** use cream task surfaces, lime forward actions, and plum surroundings as the established hierarchy.
- **Do** preserve both live faces above the task when the desktop three-column stage collapses.
- **Do** pair color and icons with clear labels for speaking, mute, connection, time, and results.
- **Do** keep captions, controls, and expandable score reasons in their own readable space.
- **Do** trigger score and verdict flourishes from fresh game events and honor reduced-motion settings.
- **Do** keep Bonk's static fallback consistent with the rendered character and retain the usable interface around it.

### Don't:

- **Don't** swap seat colors to make the local player, active speaker, or winner a particular color.
- **Don't** use synthetic test faces, captions, or scores as product content or customer evidence.
- **Don't** make a missing camera or muted microphone look live; use the implemented initials and status treatments.
- **Don't** replace the approved Bungee and Space Grotesk pairing or the toy-gavel identity as a routine extension.
- **Don't** hide instructions, captions, or essential controls inside the decorative 3D scene.
- **Don't** turn screenshot coverage or a local performance sample into a general accessibility, device-support, or frame-rate claim.
