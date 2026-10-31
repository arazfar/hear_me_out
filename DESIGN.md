---
name: Hear Me Out — Tangerine Arcade
description: Two live friends on a midnight toy-court stage, hosted by the Honorable Bonk.
colors:
  surface-canvas: "#151E32"
  surface-panel: "#24314B"
  surface-raised: "#2F3F5C"
  surface-hover: "#3B4E6B"
  surface-input: "#19263D"
  surface-media: "#151E32"
  surface-inverse: "#F6F8FF"
  text-primary: "#F6F8FF"
  text-secondary: "#BFCBE0"
  text-accent: "#FFAF45"
  text-on-accent: "#151E32"
  text-inverse: "#151E32"
  text-placeholder: "#BFCBE0"
  border-control: "#8B9DB9"
  border-focus: "#F6F8FF"
  border-focus-gap: "#151E32"
  action-primary: "#FFAF45"
  action-hover: "#FFC36E"
  action-pressed: "#E99728"
  action-text: "#151E32"
  identity-seat0-base: "#55D6CB"
  identity-seat0-tint: "#173F45"
  identity-seat0-on-base: "#151E32"
  identity-seat1-base: "#C3A4FF"
  identity-seat1-tint: "#3B3157"
  identity-seat1-on-base: "#151E32"
  status-warning-text: "#FFD17A"
  status-error-text: "#FFADB9"
  status-error-surface: "#4B2636"
  status-privacy-text: "#BFCBE0"
  status-privacy-surface: "#19263D"
  status-disabled-text: "#B5C2D8"
  status-disabled-surface: "#33425B"
  scene-furniture: "#344762"
  scene-bonk-body: "#FFAF45"
  scene-bonk-highlight: "#FFD59C"
  scene-bonk-shade: "#B86D15"
  scene-bonk-features: "#151E32"
  scene-bonk-wig: "#F6F8FF"
typography:
  display:
    fontFamily: '"Lilita One", sans-serif'
    fontSize: clamp(64px, 7.5vw, 96px)
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "0"
  headline:
    fontFamily: '"Lilita One", sans-serif'
    fontSize: 34px
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "0"
  title:
    fontFamily: '"Lilita One", sans-serif'
    fontSize: 22px
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "0"
  proposition:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: clamp(24px, 2.5vw, 36px)
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: -0.03em
  body:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.45
  body-small:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: 14px
    fontWeight: 600
  action:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: 15px
    fontWeight: 700
  score:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: 40px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: -0.03em
  timer:
    fontFamily: '"Nunito Sans", sans-serif'
    fontSize: 64px
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: -0.03em
rounded:
  radius: 16px
  radius-small: 12px
  status: 8px
  circular: 50%
spacing:
  space-1: 4px
  space-2: 8px
  space-3: 12px
  space-4: 16px
  space-6: 24px
  space-8: 32px
  space-12: 48px
components:
  button-primary:
    backgroundColor: "{colors.action-primary}"
    textColor: "{colors.action-text}"
    typography: "{typography.action}"
    rounded: "{rounded.radius-small}"
    padding: 12px 18px
    width: 100%
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-primary-active:
    backgroundColor: "{colors.action-pressed}"
  button-disabled:
    backgroundColor: "{colors.status-disabled-surface}"
    textColor: "{colors.status-disabled-text}"
  button-text:
    backgroundColor: transparent
    textColor: "{colors.text-primary}"
    padding: 6px 8px
  button-icon:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.circular}"
    height: 44px
    width: 44px
  button-control:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.radius-small}"
    padding: 10px 14px
  input:
    backgroundColor: "{colors.surface-input}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.radius-small}"
    padding: 12px 14px
    width: 100%
  room-code:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.radius-small}"
    padding: 10px 16px
  card-entry:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.radius}"
    padding: 32px
  card-phase:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.radius}"
    padding: 22px
  card-player:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.radius}"
    padding: 4px
  status-eligible-seat0:
    backgroundColor: "{colors.identity-seat0-base}"
    textColor: "{colors.identity-seat0-on-base}"
    rounded: "{rounded.status}"
    padding: 3px 6px
  caption:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.radius-small}"
    padding: 16px 20px
---

# Design System: Hear Me Out — Tangerine Arcade

## Overview

**Creative North Star: "Tangerine Arcade"**

Tangerine Arcade is a midnight toy courtroom for two friends making ridiculous arguments. Slate panels carry the conversation, ice-white text keeps it readable, and equally prominent turquoise and lilac identify the players. Tangerine belongs to Bonk and shared primary actions. The contrast between silly opinions and fair treatment remains the enduring character.

Rounded painted frames, Lilita One lettering, and Nunito Sans controls connect the live faces to the procedural courtroom. The approved change replaces color roles and scene materials while retaining composition, type, geometry, motion, media ownership, and behavior. PRODUCT.md governs behavior and claims; .impeccable/surfaces/src-app-tsx.md records the approved direction. Validation scope and remaining release work are recorded in docs/design/tangerine-arcade/README.md; this system document does not certify test or CI completion.

**Key Characteristics:**

- Midnight and slate reading surfaces with ice-white text and dark form controls.
- Permanent turquoise/lilac player identities, independent of shared tangerine actions and labeled statuses.
- A matte tangerine procedural host with painted-blue furniture and restrained lighting.
- Existing composition, typography, motion, and media behavior retained.

## Colors

Six pinned pigments establish the world; semantic roles separate reading surfaces, text, actions, player ownership, status, and scene materials. Frontmatter records their implemented values under the emitted CSS token names, including distinct roles that currently share a pigment.

### Primary

- **Tangerine action and host:** action-primary and text-accent identify shared next actions, title accents, Bonk captions, and host cues. Action-hover and action-pressed provide control states. Scene-bonk-body shares the pigment without making material, action, and text interchangeable roles.

### Secondary

- **Turquoise seat 0:** identity-seat0-base identifies the first permanent server seat across frames, names, scores, clocks, captions, verdicts, and scene details. Its tint supports camera-off avatars; on-base supplies dark ink for filled badges.
- **Lilac seat 1:** identity-seat1-base supplies the equivalent second-seat identity, with its own tint and on-base roles. Neither identity doubles as a warning, privacy state, or shared action.

### Tertiary

- **Warning amber:** status-warning-text supplies the low-time clock warning.
- **Error rose and dark rose:** status-error-text and status-error-surface identify errors and interruption notices.
- **Neutral privacy and disabled roles:** deliberate mic-off uses mist text on the dark input surface; camera-off remains a neutrally styled control with explicit text/icon state. Disabled controls have explicit fill/text values. Status meaning remains visible in words and icons.
- **Painted scene companions:** blue furniture, tangerine highlights and shade, midnight features and robe, and ice-white wig connect Bonk to the interface. These are material roles, not alternate interface themes.

### Neutral

- **Midnight canvas:** page and media ground, plus dark ink and the focus-ring gap through their respective semantic roles.
- **Slate panels:** entry, player, task, caption, dialog, and dock surfaces. Raised and hover blue distinguish secondary controls.
- **Ice-white and mist:** primary and secondary text. Ice-white also forms the keyboard focus ring. Border-control supplies input outlines, tracks, and other boundaries.
- **Dark input:** values use primary text and placeholders use mist. Inputs, entry forms, and native device selectors declare a dark color scheme. The inverse ice-white toast with midnight text remains a local notification treatment.

**The One Source Rule.** Change semantic values in src/design/tokens.ts. DOM custom properties, React identity helpers, Three.js materials and lighting, the document theme color, and generated favicon consume that source; DESIGN.md records the implemented system.

**The Permanent Seats Rule.** Seat 0 stays turquoise and seat 1 stays lilac on both clients. Color follows the server-assigned seat, never local/remote position, speaking order, score rank, or winner status.

**The Separate Meanings Rule.** Keep player identity, shared actions, and labeled status on their own semantic roles. Deliberate mic/camera privacy is neutral; failures use error styling. Low-time clocks use warning text.

src/main.tsx imports virtual:theme-tokens.css. Vite emits CSS from TypeScript, serves/emits favicon.svg from the same theme, and injects the canvas theme color into index.html. Do not create an independently edited public/favicon.svg. The raster fallback is deliberately recaptured from the scene after material changes. Sidecar tonal ramps are reference previews, not additional runtime palette choices.

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

Slate tonal layering supplies structure. Soft midnight-tinted shadows lift frames, panels, and dialogs; tangerine actions carry a shallow inset lower edge. Retained rounded geometry, matte painted-blue furniture and backdrop, and a tangerine host provide scene depth without emissive glow or video tint.

### Shadow Vocabulary

- **Surface (--shadow):** 0 12px 30px #151E3255 for entry/task panels and toast.
- **Dialog (--shadow-dialog):** 0 20px 80px #151E3299, above a #151E32df backdrop.
- **Button (--shadow-button):** inset 0 -3px 0 #B86D1555, 0 4px 10px #151E3233.
- **Frame (--shadow-frame):** 0 8px 24px #151E3255 around live player cards.

**The Quiet Depth Rule.** Use soft ambient shadows and tonal slate layering around the content. Keep the shallow inset tangerine button shadow as a painted-material cue.

Control transitions use 160ms and cubic-bezier(0.16, 1, 0.3, 1). Handoff arrival, coin landing, win pulses, and verdict strikes use distinct cues recorded in the sidecar. Animate decoration rather than media, captions, or inputs. Reduced motion removes CSS animations/transitions and confetti, snaps score changes, and suppresses Bonk's decorative movement while preserving state and usable controls.

## Shapes

Painted panels and frames use 16px corners; inputs, primary buttons, captions, and camera windows use 12px. Small statuses use 8px. Circular icon controls are 44px. Round pips and the coin echo the scene's toy geometry. An identity-colored inner frame strengthens around the eligible speaker. Inline stroke SVGs provide icons; text remains present for meaningful state.

## Components

### Buttons and controls

Tangerine primary actions are full-width, at least 48px tall, with midnight text and 12px 18px padding. Hover lightens and lifts one pixel; press deepens the tangerine and moves two pixels with a slight scale reduction. Compact phone actions may reduce to 44px. Disabled buttons use explicit fill/text and no shadow. Underlined text actions are at least 44px tall. Circular icon controls and the room-code button use slate, brightening on hover. The dock uses raised-slate controls; Leave is transparent within it.

Keyboard focus uses a three-pixel ice-white outline, two-pixel offset, and two-pixel midnight box-shadow gap. The gap overrides component shadows with !important so hover and press retain it. Labels and icons convey privacy state without relying only on color.

### Inputs and entry panels

Inputs use dark input fill, ice-white values, mist placeholders and caret, a 1.5px control border, and 12px corners. Native device selectors use the same dark fill/text, a 1px control border, 8px corners, and an explicit dark color scheme. Default padding is 12px 14px; task forms use 10px 12px. Entry panels remain slate with ice-white text and 32px padding, reducing to 20px on phones. Device setup includes a real preview, explicit private-check label, activity meter, one primary action, and expandable help. Recovery problems and repair actions remain visible.

### Player cards and status

Each persistent card owns its video and relay canvas. The server's optional seat field provides stable identities; the compatibility helper uses snapshot order only when the field is absent. A departed first seat must not recolor the second seat. Names, frames, scores, round wins, and verdicts follow the permanent seat. Camera-off initials use Lilita One with explicit status text.

The three-bar **Voice** meter shows audio activity independently of scoring and keeps its visible label on phones. The separate filled ear badge says **Bonk is scoring** only for the eligible player. Mic on/off always describes the privacy switch. Private checks are explicitly labeled and cannot become score evidence. Give each routine status one visible owner.

### Captions and phase tasks

Slate task panels have centered short headings and wrapping propositions. The center turn label identifies the opportunity and judge audio state. Timers use the active seat color, changing to warning text for low time. Full captions sit below the faces; Bonk uses tangerine and player speakers use their seat color. Caption lifecycle status uses neutral secondary text for sound-off, preparation, speaking, and finishing speech. Keep the single phase announcement and recovery precedence from PRODUCT.md; duplicate snapshots and clock ticks must not repeat announcements.

### Bonk and verdicts

The signature host is the live procedural toy gavel in src/ui/CourtroomStage.tsx. Matte tangerine body (roughness 0.65, metalness 0), ice-white wig, midnight features and robe, painted-blue furniture (shared block roughness 0.58), and backdrop roughness 0.95 connect it to the interface. Ice-white key/sky and a restrained warm rim accompany the existing seat lights. Lighting intensities remain ambient 0.8, hemisphere 1.45, key 2.6, and rim 1.2. The normal DPR ceiling remains 1.5; degraded quality uses DPR 1 and disables shadows. Geometry, animation triggers, and performance fallback behavior remain established. A verdict strike accompanies winner-colored text, restrained decoration, and a clear rematch action. An aborted match never invents a winner.

public/bonk-fallback.png is a direct capture of this scene with embedded provenance for WebGL failure; controls and captions remain usable. Recapture deliberately with `EXPORT_BONK_FALLBACK=true pnpm test:ui --project=rtc -g 'Tangerine Arcade'`, preserve embedded provenance, and rebuild before reviewing the fallback. Ordinary test runs do not mutate the asset. This is a runtime scene artifact, not generated model imagery. Review it alongside live rendering after scene or material changes.

## Do's and Don'ts

### Do:

- Do preserve the pinned pigments through separate semantic roles and the shared token source.
- Do keep full names, propositions, positions, and captions visible; wrap or scroll long content.
- Do preserve media nodes across layout and phase changes through CSS placement and stable seat components.
- Do retain the visible Voice label on phones and distinguish activity, scoring eligibility, and mic privacy.
- Do keep deliberate mic/camera privacy neutral and use explicit labels/icons alongside status color.
- Do provide visible focus, at least 44px interactive targets, reduced motion, and usable controls when WebGL fails.
- Do recapture the procedural fallback and preserve its provenance when the scene changes.

### Don't:

- Don't swap player identities when a player leaves, a turn changes, or the local client is the second seat.
- Don't use ice-white as the general panel or field background; reading surfaces stay slate and fields stay dark.
- Don't use display lettering for long arguments, infer scoring eligibility from audio level, or describe Mic on as permission to score.
- Don't truncate user-authored content or cover live faces and controls with celebration.
- Don't add emissive glow, tint live video, or make identity colors stand in for shared actions.
- Don't replace the procedural scene or live media with generated model imagery.
- Don't present synthetic browser coverage as physical-device, live-provider, production, or statistical-fairness validation.
