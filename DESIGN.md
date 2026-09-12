---
name: Quiet Canvas
description: A light, near-monochrome surface where colour belongs only to state dots and people's cursors.
colors:
  bg: "#fafafa"
  surface: "#ffffff"
  surface-2: "#f5f5f5"
  border: "#e5e5e5"
  border-strong: "#d4d4d4"
  border-hover: "#b8b8b8"
  text: "#171717"
  text-2: "#6b6b6b"
  text-3: "#a3a3a3"
  go: "#22c55e"
  caution: "#f59e0b"
  nogo: "#ef4444"
  off: "#d4d4d4"
  go-text: "#15803d"
  caution-text: "#b45309"
  nogo-text: "#b91c1c"
  accent: "#171717"
  accent-hover: "#262626"
  focus: "#2563eb"
  focus-glow: "rgba(37, 99, 235, 0.15)"
  selection: "#dbeafe"
  danger-bg: "#fef2f2"
  danger-border: "#fecaca"
  canvas: "#ffffff"
  canvas-dot: "#e5e5e5"
  overlay: "rgba(255, 255, 255, 0.85)"
  shadow-thumb: "rgba(0, 0, 0, 0.08)"
  shadow-card: "rgba(0, 0, 0, 0.04)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
  readout:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.3
  micro:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1
  glyph:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1
  index:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "8px"
    fontWeight: 400
    lineHeight: 1
rounded:
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "10px"
  xl: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "28px"
components:
  pill:
    background: "{colors.surface}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  toggle:
    background: "{colors.border-strong}"
    rounded: "{rounded.pill}"
  key:
    background: "{colors.surface}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.md}"
  primary-button:
    background: "{colors.accent}"
    color: "{colors.surface}"
    rounded: "{rounded.md}"
  input:
    background: "{colors.surface}"
    border: "1px solid {colors.border-strong}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  card:
    background: "{colors.surface}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.xl}"
---

# Quiet Canvas

<!-- impeccable:design-schema 1 -->

## Overview

A light, near-monochrome interface in the register of Linear and Vercel: white surfaces on
an off-white ground, 1px hairline borders, small system type, generous space. Colour is
rationed to exactly two jobs — **state** (three dots: green, amber, red) and **people**
(each participant's cursor and list marker) — and appears nowhere else. Nothing floats; a
1px border is the only elevation, with one soft shadow on the lobby card because it is the
only element that sits on nothing.

The audience is an engineer evaluating a real-time sync engine with several windows tiled,
so the surface must read at a glance from a neighbouring window and never distract from
the canvas. Plain words throughout: *Smooth / Predicting / Stalled / Idle*, not jargon.

No external resources. The system font stack is the type; the page runs offline.

## Colors

**Surfaces.** `{colors.bg}` is the page; `{colors.surface}` is every panel, the canvas and
the lobby card; `{colors.surface-2}` is the selected row and hover fill. `{colors.border}`
draws every hairline; `{colors.border-strong}` is for controls that need a visible edge on
white (inputs, slider tracks, toggle-off) and `{colors.border-hover}` their hover.

**Text.** `{colors.text}` for everything primary (17.9:1). `{colors.text-2}` for secondary
labels, captions and notes — verified 5.3:1 on white, 5.1:1 on the ground, 4.9:1 on
`surface-2`. `{colors.text-3}` is **non-text only**: icon glyphs and the disabled slider
thumb. Never set type in it.

**State.** Three dot fills — `{colors.go}`, `{colors.caution}`, `{colors.nogo}` — and
`{colors.off}` for "nothing to report". Each has a darkened text twin for the word beside
it: `{colors.go-text}` 5.0:1, `{colors.caution-text}` 5.0:1, `{colors.nogo-text}` 6.5:1.
One hue means one thing; the dots never decorate.

**People.** Each participant is dealt a hue by the server. On the canvas it renders as
`hsl(hue, 60%, 36%)` — lightness 36% is the highest at which *every* hue, including yellow,
clears 3:1 against white. Text is never set on a participant colour: name chips are white
with the hue as a hairline border and a dot.

**Interaction.** `{colors.accent}` is the one primary button and the toggle-on fill;
`{colors.focus}` is the keyboard ring, with `{colors.focus-glow}` on focused inputs.
`{colors.danger-bg}` / `{colors.danger-border}` appear only on hover of the one destructive
control (Disconnect).

## Typography

System stack for everything (`display`, `headline`, `body`, `label`, `caption`) and the
system monospace for measurements (`readout`, `micro`). Ramp: 20 / 14 / 13 / 12 / 11 / 10,
plus 15 for the emoji glyph in a reaction key and 8 for its index. Weights 400, 500, 600
only. Tabular numerals globally so readings don't jitter as they change. Tracking stops at
−0.02em on the display step; nothing is uppercased.

## Layout

A fixed grid: a 52px top bar, the canvas with a 280px people column beside it, and a
control bar along the bottom. Below 1180px the column narrows to 248px and status pills
drop their labels; below 900px everything stacks and the page scrolls. The bottom bar's
groups sit side by side; the connection group lays its three sliders in a row so the bar
stays one row tall.

## Elevation & Depth

Declared once, by border. Panels and the canvas carry a 1px `{colors.border}` and no
shadow. The single exception is the lobby card (`{colors.shadow-card}`, twice, soft) and
the slider thumb (`{colors.shadow-thumb}`), both because they sit on nothing.

## Shapes

`{rounded.md}` (6px) on controls and rows, `{rounded.lg}` (10px) on the canvas,
`{rounded.xl}` (12px) on the lobby card, `{rounded.sm}` (4px) on inline code and the
scrollbar thumb, `{rounded.xs}` (2px) on the 3–4px meter bars and slider tracks,
`{rounded.pill}` on status pills, toggles and the toast. Cursor arrows and
chips are drawn on canvas with a 6px chip radius to match.

## Components

- **Status pill** — dot, label, value; the four at the top right. `pill`.
- **Toggle** — 28×16 pill, `{colors.accent}` when on. `toggle`.
- **Reaction key** — 32×30 bordered square, emoji as content, index in the corner; the
  selected one takes an `{colors.accent}` border. `key`.
- **Primary button** — full-width `{colors.accent}` with white text; the secondary variant
  is white with `{colors.border-strong}`. `primary-button`.
- **Input** — white, `{colors.border-strong}`, focus ring + glow. `input`.
- **Person row** — hue dot, name, state word, a 4px freshness bar with jitter beneath.
- **Name chip** (canvas) — white, hue border, 11px name, a hue dot filled for Smooth and
  hollow for anything else.
- **Toast** — `{colors.text}` pill, white text, bottom-centre of the canvas.
- **Lobby card** — `card`, 440px, one soft shadow.

## Do's and Don'ts

- Do keep colour to state dots and participants. Don't add an accent for emphasis.
- Do use `text-2` for secondary text. Don't set type in `text-3`.
- Do put text on white. Don't put text on a participant's colour.
- Do use 1px borders for separation. Don't add shadows to panels.
- Do use plain words for states. Don't reintroduce jargon or uppercase labels.
- Do keep the system font. Don't add a web font.
