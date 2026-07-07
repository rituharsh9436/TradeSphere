---
name: Money-logix
description: A learner-first paper-trading terminal — pro-grade instruments with a coach's clarity.
colors:
  plane: "#191b20"
  surface: "#24262d"
  surface-2: "#30333b"
  surface-3: "#3a3d47"
  surface-hover: "#343842"
  ink: "#f4f5f7"
  ink-secondary: "#c4c7d0"
  muted: "#818690"
  line: "#383b44"
  accent: "#f7ca24"
  accent-strong: "#e4b50b"
  gain: "#21c983"
  gain-strong: "#19b171"
  loss: "#ff5b6b"
  loss-strong: "#eb4c5c"
  warning: "#f7ca24"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  data:
    fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
    fontFeature: "tabular-nums"
rounded:
  field: "0.45rem"
  card: "0.5rem"
  pill: "9999px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#1f2128"
    rounded: "{rounded.field}"
    padding: "0.58rem 0.95rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
    textColor: "#1f2128"
    rounded: "{rounded.field}"
    padding: "0.58rem 0.95rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.field}"
    padding: "0.58rem 0.95rem"
  button-up:
    backgroundColor: "{colors.gain}"
    textColor: "#ffffff"
    rounded: "{rounded.field}"
    padding: "0.58rem 0.95rem"
  button-down:
    backgroundColor: "{colors.loss}"
    textColor: "#ffffff"
    rounded: "{rounded.field}"
    padding: "0.58rem 0.95rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  field:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0.62rem 0.75rem"
---

# Design System: Money-logix

## 1. Overview

**Creative North Star: "The Training Terminal"**

Money-logix looks and behaves like a real trading desk that happens to teach. The
surface is a near-black graphite terminal — the kind of instrument a professional
would trust — but every reading is legible, every state is honest, and nothing is
left for the user to decode alone. The pro-grade fidelity is the point (this is not a
toy), and so is the coach's clarity (this is not a wall of blinking panels). A novice
should sit down and feel capable, not intimidated.

Depth comes from **tonal layering**, not decoration. Four graphite steps —
`plane → surface → surface-2 → surface-3` — stack to separate the chart canvas from
control panels from inputs, the way a physical console has recessed and raised faces.
A single warm yellow accent carries identity and action; green and red carry market
direction and are never the only signal. Numbers are the hero: tabular figures that
line up in columns like a calibrated readout.

This system explicitly rejects the **generic SaaS admin dashboard** — no purple
gradients, no hero-metric template, no interchangeable rounded-card grid. It equally
rejects the **overwhelming day-trader terminal**: density is earned by the task, never
piled on for effect. The tool disappears into the act of learning to trade.

**Key Characteristics:**
- Dark graphite terminal; depth via tonal layers, not shadows
- One yellow accent for identity + action; used sparingly
- Green/red for direction, always paired with a non-color cue
- Tabular numerics; data reads like an instrument panel
- Inter throughout, one family, weight-driven hierarchy

## 2. Colors

A dark, cool-graphite palette anchored by one warm yellow accent, with saturated green/red reserved strictly for market direction.

### Primary
- **Terminal Yellow** (#f7ca24): The single brand + action color. Primary buttons, the "ML" logo mark, the active-account accent, focus rings, and pending/warning states. Deliberately rare — it marks what to act on.
- **Terminal Yellow Deep** (#e4b50b): Hover/pressed state for the yellow accent only.

### Secondary (directional)
- **Signal Green** (#21c983): Gains, BUY actions, FILLED/LIVE states. Never the sole indicator of direction — always paired with a sign, arrow, or label.
- **Signal Red** (#ff5b6b): Losses, SELL actions, REJECTED states. Same pairing rule as green.

### Neutral (the graphite stack)
- **Plane** (#191b20): The base canvas — page background and the chart well. The deepest layer.
- **Surface** (#24262d): Default panel/card face; the primary content layer above the plane.
- **Surface-2** (#30333b): Raised controls, secondary panels, ghost-button hover.
- **Surface-3** (#3a3d47): Input fields, the topmost interactive layer; also scrollbar thumbs.
- **Surface Hover** (#343842): Transient hover fill for interactive rows/controls.
- **Line** (#383b44): Borders and dividers between layers.
- **Ink** (#f4f5f7): Primary text — headings, values, active labels.
- **Ink Secondary** (#c4c7d0): Supporting text, ghost-button label, inactive-but-readable copy.
- **Muted** (#818690): De-emphasized labels, placeholders, inactive nav. Use only on `plane`/`surface`; verify ≥4.5:1 before using on lighter layers.

### Named Rules
**The Rare-Yellow Rule.** The accent appears on ≤10% of any screen — the primary action, the current selection, a focus ring. Its scarcity is what makes it read as "act here." Never use it as a decorative fill or a section divider.

**The Direction-Is-Never-Only-Color Rule.** Green and red must always travel with a second cue: a `+`/`−` sign, a ▲/▼ arrow, or an explicit word (BUY/SELL, FILLED). ~8% of men cannot distinguish the two hues; the number and its sign must be readable in grayscale. `format.js` already signs percentages (`+1.05%` / `-1.30%`) — preserve that everywhere.

## 3. Typography

**Display Font:** Inter (with system-ui, -apple-system, "Segoe UI", sans-serif)
**Body Font:** Inter (same stack)
**Label/Data Font:** Inter, `font-variant-numeric: tabular-nums` for all figures

**Character:** One humanist-geometric sans across the whole system, differentiated by weight and tabular numerics rather than a second family. This keeps a dense instrument panel calm and coherent — hierarchy comes from weight and size, never from font-switching. Product UI, not a magazine.

### Hierarchy
- **Display** (700, 1.875rem/30px, -0.02em): Page titles (Dashboard, Market). One per screen.
- **Headline** (700, 1.25rem/20px, -0.01em): Panel and section headings, the primary summary figure.
- **Title** (600, 1rem/16px): Card headers, table captions, grouped-control labels.
- **Body** (400, 0.875rem/14px, 1.5): Descriptions, helper text, empty-state copy. Cap prose at 65–75ch.
- **Label** (600, 0.75rem/12px): Badges, field labels, nav items, metadata.
- **Data** (500, 0.875rem/14px, tabular-nums): All money, quantities, and percentages. Apply `.tnum` so columns align.

### Named Rules
**The Fixed-Scale Rule.** Type sizes are a fixed rem scale, never fluid `clamp()`. A trading panel is viewed at consistent DPI and often in a narrow column; a heading that shrinks in a sidebar reads as broken, not responsive.

**The Numbers-Are-Tabular Rule.** Every figure a user might scan or compare — balances, prices, P/L, ROI, quantities — uses tabular numerics so digits sit in fixed columns like a real readout. Proportional figures in a data table are a bug.

## 4. Elevation

Depth is **tonal, not cast**. Money-logix separates planes by stepping through the graphite stack (`plane → surface → surface-2 → surface-3`) rather than floating elements on shadows. A recessed chart well, a raised control panel, and an inset input are distinguished by their surface value and a 1px `line` border — the way faces on a physical console catch light differently. Shadows are the rare exception, reserved for genuine escape from the plane (modals) and for the one elevated summary card.

### Shadow Vocabulary (sparingly)
- **Elevated card** (`box-shadow: 0 18px 40px rgba(0,0,0,0.22)` + a subtle top-lit gradient `linear-gradient(180deg, rgba(48,51,59,0.72), rgba(36,38,45,0.98))`): The single primary summary surface (e.g. the portfolio/account card). At most one per screen.
- **Modal / overlay**: Reset-confirmation and any dialog float above a scrim; this is the only other legitimate shadow.

### Named Rules
**The Layered-Panels Rule.** Reach for a darker or lighter surface step before you reach for a shadow. If two panels need separating, change the tonal layer and add a `line` border; a cast shadow is a last resort, not a default. Nested cards are never allowed — layer tonally instead.

## 5. Components

Components read like **calibrated instruments**: measured, tight-stated, tabular. Every interactive element defines its full state set — default, hover, focus-visible, active, disabled — and shares one vocabulary across every screen.

### Buttons
- **Shape:** rounded 0.45rem (`--radius`-ish `field` radius); padding `0.58rem 0.95rem`; weight 700; icon+label gap 0.5rem.
- **Primary** (`.btn-primary`): Terminal Yellow fill, near-black `#1f2128` text (high contrast on yellow). Hover → Terminal Yellow Deep. The one "act here" control.
- **Ghost** (`.btn-ghost`): Transparent with a `line` border and Ink-Secondary label. Hover → `surface-2` fill, Ink label. Secondary/cancel actions.
- **Up / Down** (`.btn-up` / `.btn-down`): Signal Green / Signal Red fills with white text, for BUY / SELL. Always accompanied by the word BUY/SELL — never color alone.
- **Disabled:** opacity 0.55, `cursor: not-allowed`. **Focus:** 2px Terminal Yellow outline, 2px offset (global `:focus-visible`).

### Cards & Panels
- **Shape:** rounded 0.5rem (`card`), 1px `line` border.
- **Default** (`.card`): `surface` fill — the standard content panel.
- **Elevated** (`.card-elevated`): the one top-lit gradient + soft shadow surface for a screen's primary summary. One per screen; never nest.

### Inputs
- **Field** (`.field`): `surface-3` fill, `#494d58` border, rounded 0.45rem, padding `0.62rem 0.75rem`. Placeholder = Muted. **Focus:** border → Terminal Yellow, fill lightens to `#41454f`. Full-width by default.

### Badges (StatusBadge)
- Pill of `border + bg-tint/10 + colored text` keyed to a semantic tone: LIVE/FILLED/BUY → green; PENDING/UNPRICED/WARNING → yellow; REJECTED/SELL → red; CANCELLED → muted. Text label carries the meaning; the tint reinforces it.

### Tables / Rows
- Dense, tabular-numeric rows with a transient `surface-hover` tint on hover (`.table-row`). Data columns right-align money/quantities; labels left-align.

### Feedback (Toast / Skeleton)
- **Skeleton** for loading content regions — never a centered spinner mid-content.
- **Toast** for transient action results (order placed, error), auto-dismissing, top-lit surface.

### Named Rules
**The One-Vocabulary Rule.** The same button shape, field style, and badge grammar appear on every screen. If a "place order" button looks different on Market than on Dashboard, one is wrong.

## 6. Do's and Don'ts

**Do**
- Layer tonally (`plane → surface → surface-2 → surface-3`) to create depth; add a `line` border between planes.
- Keep the yellow accent rare — action, selection, focus only.
- Pair every green/red with a sign, arrow, or word so direction survives grayscale.
- Use `.tnum` tabular numerics on all money, quantity, and percent figures.
- Give every interactive element its full state set (default/hover/focus-visible/active/disabled).
- Teach in empty and first-run states — say what to do next, not "nothing here."
- Use Skeletons for loading; keep motion 150–250ms and state-driven.

**Don't**
- Don't drift toward the generic SaaS dashboard — no purple gradients, hero-metric template, or interchangeable card grids.
- Don't use shadows as a default depth cue; don't nest cards.
- Don't rely on color alone for gain/loss, BUY/SELL, or any status.
- Don't introduce a second font family or fluid `clamp()` heading sizes.
- Don't spend the yellow accent on decoration or section dividers.
- Don't pile on density for effect — a novice must be able to parse every screen.
- Don't add orchestrated page-load animation; the app loads into a task.
