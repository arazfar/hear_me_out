---
name: Hear Me Out — Velvet Verdict
description: Two live friends in a warm toy court, hosted by the Honorable Bonk.
colors:
  canvas: "#26131E"
  surface: "#40263B"
  cream: "#FFF3DF"
  seat0: "#A8D5F2"
  seat1: "#F7B38C"
  brass: "#D9B464"
  surface-raised: "#513449"
  surface-hover: "#63465A"
  muted: "#D6BDCA"
  stroke: "#AA879B"
  action-hover: "#EBCB86"
  action-pressed: "#C9A153"
  field: "#FFF8EC"
  paper-copy: "#654354"
  field-stroke: "#956B80"
  disabled-fill: "#604858"
  disabled-text: "#E3CED9"
  danger: "#FFB5B9"
  danger-ink: "#852E43"
  wood: "#A96E51"
  wood-light: "#D1A17A"
  wood-dark: "#633A36"
  brass-light: "#F1D79C"
  brass-dark: "#896329"
  velvet-light: "#6F465D"
  shadow: "#160B13"
typography:
  display:
    fontFamily: '"Lilita One", sans-serif'
    fontSize: "clamp(64px, 7.5vw, 96px)"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "0"
  headline:
    fontFamily: '"Lilita One", sans-serif'
    fontSize: "34px"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "0"
  title:
    fontFamily: '"Lilita One", sans-serif'
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "0"
  proposition:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: "clamp(24px, 2.5vw, 36px)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  body:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.45
  body-small:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: "14px"
    fontWeight: 600
  action:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: "15px"
    fontWeight: 700
  score:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  timer:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: "64px"
    fontWeight: 800
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
    backgroundColor: "{colors.brass}"
    textColor: "{colors.canvas}"
    typography: "{typography.action}"
    rounded: "{rounded.radius-small}"
    padding: "12px 18px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-primary-active:
    backgroundColor: "{colors.action-pressed}"
  button-disabled:
    backgroundColor: "{colors.disabled-fill}"
    textColor: "{colors.disabled-text}"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.cream}"
    padding: "6px 8px"
  button-icon:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cream}"
    rounded: "{rounded.circular}"
    height: "44px"
    width: "44px"
  button-control:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.cream}"
    rounded: "{rounded.radius-small}"
    padding: "10px 14px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.radius-small}"
    padding: "12px 14px"
    width: "100%"
  room-code:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cream}"
    rounded: "{rounded.radius-small}"
    padding: "10px 16px"
  card-entry:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cream}"
    rounded: "{rounded.radius}"
    padding: "32px"
  card-phase:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cream}"
    rounded: "{rounded.radius}"
    padding: "22px"
  card-player:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cream}"
    rounded: "{rounded.radius}"
    padding: "4px"
  status-eligible-seat0:
    backgroundColor: "{colors.seat0}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.status}"
    padding: "3px 6px"
  caption:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cream}"
    rounded: "{rounded.radius-small}"
    padding: "16px 20px"
---

# Design System: Hear Me Out — Velvet Verdict

## Overview

**Creative North Star: "Velvet Verdict"**

Velvet Verdict is a warm toy courtroom for two friends making ridiculous arguments. Burgundy holds the room, plum surfaces frame decisions, and cream keeps the conversation readable. Powder blue and apricot belong to the players; brass belongs to Bonk and the next action. The contrast between silly opinions and fair treatment is the enduring character.

Rounded painted frames, restrained velvet shading, Lilita One lettering, and Nunito Sans controls connect the live faces to the procedural courtroom. The scene supplies personality while the active speaker, full captions, and next action remain clear. PRODUCT.md governs behavior and claims; .impeccable/surfaces/src-app-tsx.md records the approved surface direction.

**Key Characteristics:**

- Six pinned palette roles with semantic state and material companions.
- Stable player identities across clients, phase changes, and departures.
- Live faces and readable decisions supported by a procedural brass host.
- Decoration responds to play while media ownership and privacy remain stable.

## Colors

Six pinned colors define the court. Frontmatter values mirror the implemented tokens; the other colors support readable states and physical scene materials.

### Primary

- **Brass:** Bonk, primary actions, focus rings, judge captions, and neutral result accents. Action-hover and action-pressed supply control states; brass-light and brass-dark shade the scene and tactile buttons.

### Secondary

- **Powder blue (seat0):** the first permanent seat across frame, name, score, clock, caption speaker, verdict, and scene details.
- **Apricot (seat1):** the second permanent seat across the same surfaces. Apricot also supports explicit room notices; copy carries their meaning.

### Tertiary

- **Danger:** warm rose for errors, muted controls, caption interruption status, and low time. Danger-ink is a companion in the source palette, not a third player identity.
- **Wood, wood-light, wood-dark, velvet-light:** courtroom material companions rather than alternate interface themes.

### Neutral

- **Burgundy canvas:** page ground and dark ink on brass, player accents, and light fields.
- **Velvet plum surface:** entry, player, task, caption, dialog, and dock surfaces. Surface-raised and surface-hover distinguish controls and secondary options.
- **Cream:** primary text; muted rose-cream supplies secondary copy. Stroke supplies outlines and tracks.
- **Field:** light input fill, with burgundy text, paper-copy placeholders, and field-stroke boundaries. Light fields, toast surfaces, and native device selectors are deliberate local exceptions to the plum panels.
- **Disabled fill / disabled text:** explicit opaque disabled states. Shadow supplies the dark tint in the depth recipes.

**The One Source Rule.** Change semantic values in src/design/tokens.ts. DOM custom properties, Three.js materials, the document theme color, and the generated favicon derive from that source; DESIGN.md records the implemented system.

**The Permanent Seats Rule.** Seat 0 stays powder blue and seat 1 stays apricot on both clients. Color follows the server-assigned seat, never local/remote position, speaking order, score rank, or winner status.

src/main.tsx imports virtual:velvet-tokens.css. Vite emits the CSS from TypeScript, serves/emits favicon.svg from the same palette, and injects the canvas theme color into index.html. Do not create an independently edited public/favicon.svg. Sidecar tonal ramps are reference previews, not additional runtime palette choices.

## Typography

**Display Font:** Lilita One, sans-serif fallback; locally bundled at weight 400.
**Body Font:** Nunito Sans, sans-serif fallback; locally bundled at weights 400–800.

Rounded Lilita One makes short statements playful. Nunito Sans keeps conversational copy, operational labels, and tabular numbers easy to scan. Display headings use normal tracking; proposition and number tracking follow the frontmatter roles.

### Hierarchy

- **Display:** the frontmatter title clamp becomes 58px below 1120px and 48px at 700px and below. Wide screens no taller than 820px use 64px.
- **Headline:** entry headings use 34px, reducing to 26px on phones; dialogs use 30px.
- **Title:** task headings use 22px; verdict headings use 25px on larger layouts and 24px on phones, in the winner's permanent identity color.
- **Proposition:** Nunito Sans bold, reduced to 28px on wide short screens and 20px on phones. User content wraps without truncation.
- **Body and labels:** base copy is 16px; task and dialog copy 14px. Captions use 15px, reducing to 14px on phones. Labels use 14px/600 and primary actions 15px/700. Supporting status text uses 11–13px; the visible Voice label uses 10px.
- **Score and timer:** tabular Nunito Sans numbers. Scores reduce from 40px to 28px on phones; timers from 64px to 44px, then 32px on short phones. Player names use 18px/800, reducing to 14px on phones.

**The Readable Conversation Rule.** Use Nunito Sans for user content, scores, timers, controls, and captions. Reserve Lilita One for the brand, short panel titles, initials, and celebratory lettering.

## Layout

A four-pixel rhythm supplies the reusable spacing steps, with local intermediate spacing where components require it. Entry composition caps at 1240px and the courtroom at 1512px. Desktop page gutters are 32px, medium gutters 24px, and phone gutters 8–16px according to surface. Long conversations scroll rather than fitting into a cropped viewport.

At 1120px and wider, live faces flank a 292px center column holding Bonk and the task. The title places its world beside the entry form. At 1119px and narrower, both faces share the first row and the center stage moves below them through CSS grid placement. At 700px and narrower, the title stacks above the form and the room uses an 80px Bonk column beside the task. Phone topic and recovery tasks use the full row and hide the decorative stage; result tasks do the same on phones no taller than 740px. These are layout changes to stable media nodes, not remounts or reparenting.

Captions follow the courtroom and preserve full text, wrapping and whitespace. Caption length must not move the live faces; empty caption regions collapse. Award decoration has reserved space above scored cards. Player headers accommodate names, visible Voice activity, round pips, and status.

The normal desktop and portrait control dock is fixed near the bottom, with safe-area-aware room padding (80px, or 78px on phones) reserving its footprint. Phones use four equal control columns. **At max-height 500px and max-width 1119px, the dock becomes static in document flow with 16px top margin; the whole document scrolls without the dock covering faces.** Wide screens no taller than 820px and phones no taller than 740px receive compact spacing and scene sizing. Preserve 44px interactive targets.

## Elevation & Depth

Plum tonal layering supplies structure. Soft burgundy-tinted shadows lift frames, panels, and dialogs; brass actions carry a small inset lower edge. Actual rounded geometry, velvet curtains, painted wood, brass, and warm lighting provide depth inside the procedural scene.

### Shadow Vocabulary

- **Surface (--shadow):** 0 12px 30px #160B1355 for entry/task panels and toast.
- **Dialog (--shadow-dialog):** 0 20px 80px #160B1399, above a #26131Edf backdrop.
- **Button (--shadow-button):** inset 0 -3px 0 #89632955, 0 4px 10px #160B1333.
- **Frame (--shadow-frame):** 0 8px 24px #160B1355 around live player cards.

**The Quiet Depth Rule.** Use soft ambient shadows and tonal plum layering around the content. Keep the small inset brass button shadow as a painted-material cue.

Control transitions use 160ms and cubic-bezier(0.16, 1, 0.3, 1). Handoff arrival, coin landing, win pulses, and verdict strikes use distinct cues recorded in the sidecar. Animate decoration rather than media, captions, or inputs. Reduced motion removes CSS animations/transitions and confetti, snaps score changes, and suppresses Bonk's decorative movement while preserving state and usable controls.

## Shapes

Painted panels and frames use 16px corners; inputs, primary buttons, captions, and camera windows use 12px. Small statuses use 8px. Circular icon controls are 44px. Round pips and the coin echo the scene's toy geometry. An identity-colored inner frame strengthens around the eligible speaker. Inline stroke SVGs provide icons; text remains present for meaningful state.

## Components

### Buttons and controls

Brass primary actions are full-width, at least 48px tall, with burgundy text and 12px 18px padding. Hover lightens and lifts one pixel; press deepens the brass and moves two pixels with a slight scale reduction. Compact phone actions may reduce to 44px. Disabled buttons use explicit fill/text and no shadow. Underlined text actions are at least 44px tall. Circular icon controls and the room-code button use plum, brightening on hover. The dock uses raised-plum controls; Leave is transparent within it.

Keyboard focus is a three-pixel brass outline with four-pixel offset. On apricot room notices the outline is burgundy. Labels and icons convey privacy state without relying only on color.

### Inputs and entry panels

Inputs use light field fill, dark values and placeholders, a 1.5px field stroke, and 12px corners. Default padding is 12px 14px; task forms use 10px 12px. Entry panels remain plum with cream text and 32px padding, reducing to 20px on phones. Device setup includes a real preview, explicit private-check label, activity meter, one primary action, and expandable help. Recovery problems and repair actions remain visible.

### Player cards and status

Each persistent card owns its video and relay canvas. The server's optional seat field provides stable identities; the compatibility helper uses snapshot order only when the field is absent. A departed first seat must not recolor the second seat. Names, frames, scores, round wins, and verdicts follow the permanent seat. Camera-off initials use Lilita One with explicit status text.

The three-bar **Voice** meter shows audio activity independently of scoring and keeps its visible label on phones. The separate filled ear badge says **Bonk is scoring** only for the eligible player. Mic on/off always describes the privacy switch. Private checks are explicitly labeled and cannot become score evidence. Give each routine status one visible owner.

### Captions and phase tasks

Plum task panels have centered short headings and wrapping propositions. The center turn label identifies the opportunity and judge audio state. Timers use the active seat color, changing to danger for low time. Full captions sit below the faces; Bonk uses brass and player speakers use their seat color. Caption status explains muted, preparing, and finishing speech. Keep the single phase announcement and recovery precedence from PRODUCT.md; duplicate snapshots and clock ticks must not repeat announcements.

### Bonk and verdicts

The signature host is the live procedural toy gavel in src/ui/CourtroomStage.tsx. Shared painted, velvet, and brass material values, warm lighting, and seat accents connect it to the interface. A verdict strike accompanies winner-colored text, restrained decoration, and a clear rematch action. An aborted match never invents a winner.

public/bonk-fallback.png is a direct capture of this scene with embedded provenance for WebGL failure; controls and captions remain usable. Recapture with the scoped atlas run `EXPORT_BONK_FALLBACK=true pnpm exec playwright test tests/browser/velvet.spec.ts --project=rtc` and refresh embedded provenance after export. This is a runtime scene artifact, not generated model imagery. Review it alongside live rendering after scene or material changes.

## Do's and Don'ts

### Do:

- Do preserve the six pinned color roles and the shared semantic token source.
- Do keep full names, propositions, positions, and captions visible; wrap or scroll long content.
- Do preserve media nodes across layout and phase changes through CSS placement and stable seat components.
- Do retain the visible Voice label on phones and distinguish activity, scoring eligibility, and mic privacy.
- Do provide visible focus, at least 44px interactive targets, reduced motion, and usable controls when WebGL fails.
- Do recapture the procedural fallback and preserve its provenance when the scene changes.

### Don't:

- Don't swap player identities when a player leaves, a turn changes, or the local client is the second seat.
- Don't use cream as the general panel background; entry, task, caption, and dialog surfaces are plum.
- Don't use display lettering for long arguments, infer scoring eligibility from audio level, or describe Mic on as permission to score.
- Don't truncate user-authored content or cover live faces and controls with celebration.
- Don't replace the procedural scene or live media with generated model imagery.
- Don't present synthetic browser coverage as physical-device, live-provider, production, or statistical-fairness validation.
