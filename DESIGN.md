---
name: Flight Director Console
description: A lit warm gray-green console face wrapped around one dark bezelled plot glass, where colour only ever means state.
colors:
  panel: "#c2c6b9"
  panel-lit: "#cdd1c3"
  panel-deep: "#b1b6a7"
  panel-recess: "#a4a99a"
  seam: "#8b9082"
  seam-light: "rgba(255, 255, 255, 0.55)"
  seam-dark: "rgba(28, 32, 24, 0.22)"
  ink: "#191c17"
  ink-2: "#4a4f44"
  ink-3: "#646a5c"
  glass: "#0a0e0c"
  glass-rule: "#1d2c24"
  glass-ink: "#cfd8cf"
  glass-ink-2: "#7d8b81"
  go: "#4e9a5b"
  caution: "#cf8a24"
  nogo: "#bf4632"
  lamp-off: "#7e8376"
  tone-go: "#275c31"
  tone-caution: "#6f4a0e"
  tone-nogo: "#8f3123"
  focus: "#14304f"
  rocker-live: "#7f9a7c"
  key-hover: "#d6dacc"
  bezel-edge: "#6f7468"
  guard-face: "#bda9a2"
  guard-face-lit: "#cbb8b2"
  guard-face-hover: "#c6b2ab"
  guard-face-hover-lit: "#d5c2bc"
  guard-edge: "#8c6f66"
  guard-ink: "#55211a"
  annunciate-go: "#9fe0ab"
  annunciate-caution: "#f0c583"
  shadow-lamp: "rgba(0, 0, 0, 0.25)"
  knurl: "rgba(0, 0, 0, 0.16)"
typography:
  display:
    fontFamily: "Archivo Narrow, Arial Narrow, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.06em"
  headline:
    fontFamily: "Azeret Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.02em"
    fontFeature: "tnum"
  title:
    fontFamily: "Azeret Mono, ui-monospace, monospace"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.1
    fontFeature: "tnum"
  readout:
    fontFamily: "Azeret Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.2
    fontFeature: "tnum"
  state:
    fontFamily: "Azeret Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "Archivo Narrow, Arial Narrow, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.1em"
rounded:
  hairline: "1px"
  panel: "2px"
  bezel: "3px"
spacing:
  hair: "2px"
  tight: "5px"
  snug: "8px"
  base: "10px"
  rail: "14px"
  gutter: "16px"
  wide: "18px"
components:
  lamp:
    backgroundColor: "{colors.lamp-off}"
    rounded: "{rounded.panel}"
    width: "11px"
    height: "11px"
  lamp-go:
    backgroundColor: "{colors.go}"
  lamp-caution:
    backgroundColor: "{colors.caution}"
  lamp-nogo:
    backgroundColor: "{colors.nogo}"
  matrix-cell:
    textColor: "{colors.ink}"
    typography: "{typography.state}"
    padding: "10px 16px"
    width: "132px"
  placard:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
  switch-rocker:
    backgroundColor: "{colors.panel-recess}"
    rounded: "{rounded.panel}"
    width: "34px"
    height: "16px"
  switch-rocker-on:
    backgroundColor: "{colors.rocker-live}"
  switch-paddle:
    backgroundColor: "{colors.panel-lit}"
    rounded: "{rounded.hairline}"
    width: "15px"
    height: "12px"
  slider-thumb:
    backgroundColor: "{colors.panel-lit}"
    rounded: "{rounded.panel}"
    width: "11px"
    height: "18px"
  slider-track:
    backgroundColor: "{colors.panel-recess}"
    rounded: "{rounded.hairline}"
    height: "6px"
  reaction-key:
    backgroundColor: "{colors.panel-lit}"
    rounded: "{rounded.panel}"
    width: "33px"
    height: "30px"
  reaction-key-armed:
    backgroundColor: "{colors.panel-recess}"
  guarded-button:
    backgroundColor: "{colors.guard-face}"
    textColor: "{colors.guard-ink}"
    rounded: "{rounded.panel}"
    padding: "6px 11px 6px 8px"
  guarded-button-hover:
    backgroundColor: "{colors.guard-face-lit}"
  station-row:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    padding: "9px 16px 9px 13px"
  station-row-self:
    backgroundColor: "rgba(255, 255, 255, 0.22)"
  meter:
    backgroundColor: "{colors.panel-recess}"
    rounded: "{rounded.hairline}"
    height: "8px"
  glass-bezel:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.bezel}"
  annunciator:
    backgroundColor: "rgba(10, 14, 12, 0.92)"
    textColor: "{colors.glass-ink}"
    rounded: "{rounded.panel}"
    padding: "8px 14px"
---

# Design System: Flight Director Console

## Overview

**Creative North Star: "The Flight Director Console"**

This is a mission control room's front screen, not a dashboard. The face is milled panel
metal in a warm gray-green, lit because the room it is read in is lit, and it is divided by
scored seams into rails that each own one subsystem. Set into it is exactly one dark region:
a bezelled plot glass, recessed behind a hairline highlight, where the live shared space
actually lives. Everything outside that glass is instrument face — placards engraved into
metal, values in squarish technical mono, lamps that only ever mean one thing.

The category default it refuses is the one this project already wore: a dark surface with a
neon accent, floating glass cards, and a debug drawer bolted to the side. Instrumentation is
not a panel here. It is the room. There is no settings drawer and no modal — every control
sits on the face, beside the reading it changes, and no value is printed twice anywhere.
Depth is declared once, by seam and bevel; nothing floats, because a metal face does not
float.

The density is high and unapologetic. A reviewer reads this from a neighbouring tiled window
and must be able to tell at a glance whether the link is healthy, so the top rail carries
four lamps and four words and nothing else — the numbers live down in the switch groups that
govern them. Colour is the scarcest material on the face: outside the glass, the panel is
achromatic, and a hue appearing there is always a claim about state.

**Key Characteristics:**
- Two grounds, and the split is a rule: lit panel metal everywhere, one dark bezelled glass.
- Engraved placards in letterspaced narrow caps; values in mono with tabular numerals.
- Elevation by scored seam and bevel, never by drop shadow.
- Rectilinear panels at a 2–3px radius — a deliberate refusal of the 12–16px card default.
- Lamp colour rationed to state: go, caution, no-go, off. Participant hues belong to the glass.
- One authored motion: a 420ms exponential settle, shared by lamps, state words and numerals.

## Colors

A lit warm gray-green metal face, near-black engraved ink, one deep bottle-green glass, and
four lamp hues that are the only saturated colour permitted on the panel.

### Primary

- **Lamp Go** (`{colors.go}`): the GO lamp fill, on the status matrix and the annunciator's
  border. The lamp says the severity; a word beside it says why.
- **Lamp Caution** (`{colors.caution}`): the caution lamp fill. Also the acquisition
  reticle inside the glass and the arrival-jitter bar in each roster meter — both are
  readings of the same "this is degrading" kind, which is why they are allowed this hue.
- **Lamp No-Go** (`{colors.nogo}`): the no-go lamp fill; the armed-key index mark under a
  selected reaction key; the text caret.
- **Lamp Off** (`{colors.lamp-off}`): an unlit lamp, held at 55% opacity so "off" reads as
  unpowered rather than as a fifth state.

Each lamp hue has a darkened text twin for the word beside it, because the fill values are
not legible as type on the panel: **Go Ink** (`{colors.tone-go}`), **Caution Ink**
(`{colors.tone-caution}`), **No-Go Ink** (`{colors.tone-nogo}`). All three are verified at
≥ 4.5:1 on panel metal (4.54, 4.54, 4.59).

### Secondary

- **Guard Face** (`{colors.guard-face}` / lit `{colors.guard-face-lit}`, hover
  `{colors.guard-face-hover}` / `{colors.guard-face-hover-lit}`) with **Guard Edge**
  (`{colors.guard-edge}`) and **Guard Ink** (`{colors.guard-ink}`): the dusty rose-oxide
  material of the guarded switch. The one destructive control on the face — CUT LINK — is
  the one control given its own material, the way a guarded switch on a real panel is a
  different colour of plastic. Nothing else may wear it.
- **Rocker Live** (`{colors.rocker-live}`): the well of a thrown rocker switch. A muted,
  desaturated green — deliberately not the GO lamp, because a switch being on is a position,
  not a health verdict.

### Control and material tones

Reused values that carry no state meaning. They are tokens rather than literals because a
value used in more than one rule is part of the system whether or not anyone named it.

- **Key Hover** (`{colors.key-hover}`): the lit top stop of a reaction key's gradient on
  hover. The key's pressed state is carried by the bevel reversing, not by this.
- **Bezel Edge** (`{colors.bezel-edge}`): the machined lip between panel metal and glass.
  The only border on the face that is neither seam nor hairline.
- **Annunciate Go / Caution** (`{colors.annunciate-go}`, `{colors.annunciate-caution}`):
  the annunciator's text inside the glass. Lightened relatives of the lamp hues, because
  the lamp inks are tuned for panel metal and would disappear on near-black.
- **Lamp Shadow** (`{colors.shadow-lamp}`) and **Knurl** (`{colors.knurl}`): the inner
  shade under a lamp lens and the milled ridging on a slide knob. Material, not colour.

### Tertiary

- **Focus Blue** (`{colors.focus}`): the keyboard focus ring, and the only blue on the
  face. It is not a lamp and never carries meaning about the system — it means "you are
  here". Inside the glass the ring switches to `{colors.glass-ink}`, because a dark navy
  on near-black would vanish.

### Neutral

- **Panel** (`{colors.panel}`): the console face and the contrast reference every ink on
  this system is measured against.
- **Panel Lit** (`{colors.panel-lit}`): the top of the face's vertical gradient, and the
  raised half of every bevelled control — switch paddles, slider knobs, reaction keys.
- **Panel Deep** (`{colors.panel-deep}`): the bottom of those same control gradients.
- **Panel Recess** (`{colors.panel-recess}`): anything cut into the face — meter wells,
  slider tracks, rocker wells, a pressed key, an inline code chip, the page ground behind
  the console, and the scrollbar track.
- **Seam** (`{colors.seam}`): the scored line between panels, and every hairline border on
  a control. **Seam Light** and **Seam Dark** are the two halves of the bevel.
- **Ink** (`{colors.ink}`): every value, every switch label, the room designation. 9.90:1 on
  panel.
- **Ink Secondary** (`{colors.ink-2}`): placards, captions, units, the age readout, the
  freshness bar. 4.84:1 on panel — the floor for text.
- **Ink Tertiary** (`{colors.ink-3}`): **non-text only.** Icon glyphs in the matrix and
  group heads, and hairlines. 3.21:1 on panel; it fails text contrast and is used exactly
  where nothing has to be read as a word.
- **Glass** (`{colors.glass}`): the plot field.
- **Glass Rule** (`{colors.glass-rule}`): the corner registration marks engraved into the
  bezel's inner edge, and the annunciator's border at rest.
- **Glass Ink** (`{colors.glass-ink}`) / **Glass Ink Secondary** (`{colors.glass-ink-2}`):
  callsigns and secondary text inside the glass; 13.30:1 and 5.44:1 on the glass field.

### Named Rules

**The One Meaning Rule.** A lamp hue means exactly one thing: green is GO, amber is caution,
red is no-go, unlit is off. If a hue appears on the panel face it is because a subsystem is
in that state — never for emphasis, never for branding, never to make a section feel warmer.

**The Two Grounds Rule.** This world has a lit ground and exactly one dark region. The glass
is the only dark surface; everything dark on the face is either inside the bezel or is an
overlay drawn on top of it (the link overlay, the annunciator). Adding a second dark panel
anywhere else breaks the world.

**The Hue Belongs to the Glass Rule.** Participant colour — the per-station hue, allocated
around the wheel at a golden-angle stride — is glass vocabulary. It appears on the panel in
exactly one place and one form: a 3px keying strip at the left edge of a roster row, at
`hsl(H, 58%, 56%)`, whose only job is to bind that row to its symbol on the plot. It is a
key, not decoration, and it must never grow into a fill, a border, or a text colour.

**The Contrast Floor Rule.** Text on panel metal stops at `{colors.ink-2}` (4.84:1). Any
tint darker in lightness than that — `{colors.ink-3}` included — is for glyphs and
hairlines. Test: if you can read it as a word, it may not be `{colors.ink-3}`.

## Typography

**Display Font:** Archivo Narrow (with Arial Narrow, sans-serif)
**Body Font:** Archivo (with system-ui, sans-serif)
**Label/Mono Font:** Azeret Mono (with ui-monospace, SFMono-Regular, monospace)

**Character:** Archivo Narrow does the engraving — condensed, letterspaced, set in caps and
lifted off the metal by a 1px white text-shadow, the way a placard is stamped into a panel.
Azeret Mono does the measuring: squarish, mechanical, with tabular numerals enabled globally
so a settling readout never reflows its own digits. Archivo carries the few sentences of
prose the face allows. The pairing is instrument-panel first and document second; nothing
here is a webpage voice.

### Hierarchy

- **Display** (700, 17px, 1.0, +0.06em, caps): the room designation, the largest and only
  identity on the face. Ellipsised, never wrapped.
- **Headline** (500, 17px mono, 1.0, +0.02em): the mission clock, prefixed `T+`. The one
  continuously-moving figure outside the glass.
- **Title** (500, 15px mono, 1.1): primary values — the on-station count and every dial
  reading in the switch bank. Units ride alongside at 10px in `{colors.ink-2}`.
- **Readout** (500, 13px mono, 1.2): the base value role. Instances specialise from it —
  11px for a slider's live output, 10px for a station's tracking state and age, 8px for a
  reaction key's index.
- **State** (600, 11px mono, 1.2, +0.04em): the subsystem word beside a lamp — NOMINAL,
  DEGRADED, LOCKED, STARVED, THROTTLED. Its colour transitions on the 420ms console curve.
- **Body** (400, 13px Archivo, 1.5): the notes under a switch group and the empty-roster
  message. Capped at 32ch in the switch bank so a note never spans a rail.
- **Label** (600, 10px Archivo Narrow, 1.1, +0.1em, caps, `{colors.ink-2}`): the engraved
  placard. Every group, dial, slider and section is named by one.

### Named Rules

**The Engraved Placard Rule.** Every placard is uppercase Archivo Narrow at +0.1em with the
`0 1px 0 rgba(255,255,255,0.5)` engrave shadow. That shadow is what makes it read as cut
into metal rather than printed on it, and it is applied to placards, switch labels and the
room designation only — never to a value, because a value is silkscreened, not engraved.

**The Set Once Rule.** A placard names a thing once. No value appears twice anywhere on the
face: the status matrix carries state words and no numbers, and every number lives in the
switch group that governs it. If a reading needs to be shown in two places, the layout is
wrong, not the rule.

**The Tabular Rule.** Every numeral is tabular (`font-variant-numeric` is set on `body` and
re-asserted on each numeric role). A damped readout settles through many values; if the
digits are proportional the whole rail twitches.

## Layout

A three-band console grid at full width: a top rail, a bay-plus-roster middle, and a bottom
switch rail — `minmax(0, 1fr) 306px` across, `auto minmax(0, 1fr) auto` down, filling exactly
the viewport height with no page scroll. The face carries a fine vertical machining texture
(a 1px-in-3px white repeating gradient at 3.5% over a `panel-lit → panel` vertical gradient),
which is what stops a large flat area from reading as a blank div.

- **Top rail:** designation, mission clock and protocol nameplate flush left, each in its own
  seam-bordered cell; the four-cell GO/NO-GO matrix pushed right with `margin-left: auto`.
  Cells are `10px 16px`, matrix cells hold a 132px minimum so a state word never wraps.
- **Bay:** `14px 14px 0` padding, the glass flexing to fill, and one permanent imperative
  line beneath it — never chrome over the field.
- **Roster rail:** 306px, seam on the left plus an inset white highlight. The list is
  `flex: 0 1 auto`, not `1`, so a growing roster does not open a gap between the last
  station and the plot key; leftover height falls to the foot of the rail, where blank panel
  is what a console face actually has.
- **Bottom rail:** four groups, each `11px 16px 13px`, seam-separated, horizontally
  scrollable rather than compressible.

Spacing rhythm runs on odd, tight steps — 2, 3, 5, 7, 8, 9, 10, 11, 13, 14, 16, 18 — closer
to instrument-panel machining than to an 8pt grid. Rail padding is `10px 16px`; group padding
is `11px 16px 13px`; gaps inside a group are 7–8px.

**Responsive.** Two breakpoints, both real:

- **≤ 1180px** (the tiled-window case): roster narrows to 262px, matrix cells drop their
  minimum width and their icon glyph. The words survive; the decoration goes first.
- **≤ 900px**: the grid collapses to one column, order top → bay → roster → bottom, page
  scrolling is re-enabled and height goes auto. The matrix becomes a 2×2 grid across the
  full width with its own interior seams, because four cells will not fit a phone in one row
  and nothing may be clipped. The bay holds `minmax(320px, 52vh)` so the glass stays a plot
  rather than a strip; switch groups wrap at `1 1 260px`.

### Named Rules

**The Survive a Tiled Window Rule.** This face is evaluated in several small windows at once.
Nothing important may depend on a wide viewport: at every width the four lamps, their words
and the glass remain visible and unclipped. Test: at 900px wide, can you still read all four
subsystem states without scrolling?

**The Control Beside Its Reading Rule.** A control lives in the group that owns the number it
moves. There is no settings drawer, no modal and no debug panel — if a new control cannot be
placed beside the reading it changes, the reading is in the wrong group.

## Elevation & Depth

There are no drop shadows on this face. Nothing floats, because panel metal does not float.
Depth is declared exactly once per element, by a scored seam (a 1px `{colors.seam}` border)
plus a two-part bevel: a white highlight on one edge and a dark line on the other. Whether an
element reads raised or recessed is entirely a question of which edge gets which.

### Shadow Vocabulary

- **Bevel Up** (`inset 0 1px 0 var(--seam-light), inset 0 -1px 0 var(--seam-dark)`): the
  raised state. Rails, reaction keys, the guarded switch, the plot key's top edge.
- **Bevel Down** (`inset 0 1px 2px var(--seam-dark), inset 0 -1px 0 var(--seam-light)`): cut
  into the face. Meter wells, slider tracks, rocker wells, a pressed key, an inline code chip.
- **Engrave** (`text-shadow: 0 1px 0 rgba(255,255,255,0.5)`): the type-level equivalent, on
  placards and switch labels only.
- **Bezel** (`inset 0 2px 10px rgba(0,0,0,0.75), 0 1px 0 var(--seam-light)`): reserved
  entirely for the glass. The only genuinely deep recess on the face, and the only place a
  border, an inset shadow and an outer highlight all appear on one element — because it is
  the one thing set *into* the panel rather than milled from it.

### Named Rules

**The No Float Rule.** No `box-shadow` with a blur and a positive offset appears anywhere
outside the bezel. A new surface earns depth by taking a seam and a bevel, or it stays flush.
If you reach for a card shadow, the answer is a scored seam.

**The Declared Once Rule.** One elevation statement per element. Rails take a seam border and
`bevel-up`; wells take a seam border and `bevel-down`. Stacking a bevel-up on a recessed
control, or adding a second highlight to a rail that already has one, reads as a rendering
bug, not as more depth.

## Shapes

Rectilinear throughout, on a three-step radius that tops out at 3px:

- **Hairline (1px)**: the smallest cut things — meter wells, slider tracks, a switch paddle,
  the roster's hue strip.
- **Panel (2px)**: the default for anything on the face — lamps, rocker wells, reaction keys,
  the guarded switch, slider knobs, the annunciator, code chips.
- **Bezel (3px)**: the glass only, and the favicon's plate.

This is a deliberate override of the usual 12–16px card guidance. A 12px radius on this face
would read as a web card dropped onto a console, and the whole world would come apart.

Form language is orthogonal and mechanical. Controls announce their affordance by silhouette
rather than by colour: the rocker is a 34×16 well with a 15×12 paddle that translates 15px on
throw; the slider knob is an 11×18 vertical bar with a knurled 1-in-3px stripe texture, over a
track with graduation ticks scored into the panel behind it at 10% intervals. Inside the
glass, geometry is symbology: a 7px square outline per station, a filled crosshair for your
own pointer, a bracketed reticle for the target.

### Named Rules

**The Silhouette Rule.** A control must be identifiable with all colour removed. Rocker
paddle position, knob knurling, key press-depth and the guarded switch's outline all carry
the state independently of hue — which is why the armed reaction key gets an engraved index
bar and not just a tint.

## Components

### Lamps and the Status Matrix

The signature. An 11×11 square lamp at 2px radius, seam-dark bordered, with a two-sided inner
bevel so it reads as a lit cap rather than a dot. Four states, four fills, and the word beside
it in the matching text twin. Both the fill and the word transition on
`420ms cubic-bezier(0.16, 1, 0.3, 1)` — the console curve.

- **Cell:** icon glyph (`{colors.ink-3}`, 20px) · lamp · stacked placard over state word,
  `10px 16px`, seam on the left, 132px minimum.
- **Vocabulary:** LINK reads STANDBY / ACQUIRING / NOMINAL / DEGRADED / DOWN; CLOCK reads
  STANDBY / ACQUIRING / LOCKED; BUFFER reads STANDBY / NO TRAFFIC / NOMINAL / COASTING /
  STARVED; FEED reads STANDBY / THROTTLED / FULL RATE.
- **Rule of the matrix:** every lamp traces to a measured reading. A matrix that reads GO
  because it always reads GO is scenery.

### Switches

- **Rocker:** a 34×16 recessed well (`{colors.panel-recess}`, `bevel-down`, 2px) with a
  15×12 raised paddle (`panel-lit → panel-deep`, 1px radius). Throw is shown by position —
  the paddle translates 15px over 160ms on the console curve — and confirmed by the well
  filling `{colors.rocker-live}`. Label is 600/10px Archivo Narrow at +0.09em, engraved.
- **Guarded switch:** the destructive control, and the only one with its own material —
  a rose-oxide face over `{colors.guard-edge}`, `{colors.guard-ink}` caps at +0.11em, with
  the severed-line icon. Hover lightens the face; press swaps `bevel-up` for `bevel-down`,
  so the button physically depresses. There is exactly one on the console.
- **Disabled:** a locked control looks locked all the way across — its placard and its
  output drop to 0.45 opacity too, not just the track.

### Sliders

Placard and live output share a row; the track spans the full width beneath, so a long
placard can never collide with its own control at any width. Track is a 6px recessed rail;
knob is an 11×18 knurled bar; graduation marks are scored into the panel behind the track.
Cursor is `grab`, and `grabbing` while dragging.

**The Hand Versus Engine Rule.** A slider's output is damped only when something else is
driving it. Under ADAPTIVE the render-delay figure eases to its new value; under manual drag
it tracks the hand exactly. A number that lags your own drag by a quarter second is a broken
control, not a settling instrument.

### Meters

Two stacked 3px bars in one 8px recessed well: signal freshness on top in `{colors.ink-2}`,
arrival jitter beneath in `{colors.caution}`. They are **scaled, not resized** —
`transform: scaleX()` on a 180ms curve — because these update five times a second for every
station in the room and animating width would relayout the rail on every telemetry tick.
Freshness falls as the signal ages; an unmeasured value reads empty, never full.

### Roster Station

A three-column grid — 3px hue strip, name, tracking state — with the meters row spanning
beneath. Callsigns are uppercase Archivo Narrow at +0.07em; the tracking state is 10px mono
in its tone colour and carries a screen-reader-only expansion, because "COAST" alone is not a
word. Your own row is tinted `rgba(255,255,255,0.22)`; a lost station drops to 0.62 opacity.
Every member is listed, including one who has joined and never moved.

### Reaction Keys

33×30 raised keycaps at 2px radius with `bevel-up`, carrying the reaction emoji at 15px and
an 8px mono index in the top-right corner. Armed swaps to a recessed well (`panel-recess`,
`bevel-down`) *and* gains a 12×2 engraved `{colors.nogo}` index bar at the bottom edge —
never colour alone.

### The Glass

The world's one dark region and its signature component. A 3px-radius bezel with a 1px
`#6f7468` edge, deep inset shadow, and corner registration marks inset 7px in
`{colors.glass-rule}`. Native cursor is hidden; the pointer is drawn instead. Inside:

- **Graticule:** 34px rules at 5.5% green-white, every fourth at 11%, centre lines at 14%.
- **Station symbol:** a 7px square outline in `hsl(H, 58%, 66%)` with a 2px filled core, a
  leader line at 45% lightness and 0.6 alpha, and a data block on a `rgba(10,14,12,0.72)`
  plate carrying the callsign over its tracking state. Blocks are placed per frame and
  de-conflicted so a crowded plot never stacks callsigns; the leader flips direction near a
  bezel edge rather than running off it.
- **Dash signature:** every tracking state gets its own stroke pattern — TRACK solid, COAST
  `3,2`, HOLD `1,2`, LOST `1,4`, IDLE/NO SIG `1,3` — drawn from one exported `dashFor()` that
  the roster's plot key also renders from, so the key cannot drift from the glass it explains.
- **Own marker:** a filled crosshair with a 13px ring, never a data block, never interpolated.
- **Target reticle:** a 0.62r ring inside four corner brackets, in `{colors.caution}`,
  breathing on a 420ms sine; on cooldown it goes gray and the ring switches to a `3,5` dash.
  Labelled ACQUIRE / COOLDOWN in 9px mono.
- **Trail marks:** 2px squares at 10% alpha showing where samples actually landed, behind
  the interpolated symbol.

### Annunciator

A transient dark chip centred 18px above the glass's bottom edge, `rgba(10,14,12,0.92)` at
2px radius, 11px mono caps at +0.07em, with a lamp in it. Its border and text take the tone
(`go` → `#9fe0ab`, `caution` → `#f0c583`). Rises 6px over 240ms on the console curve. Lives
2200ms, then leaves. `pointer-events: none` throughout — it reports, it never blocks.

### Link Overlay

When the socket is not open, the glass covers itself with `rgba(10,14,12,0.82)` and states
the fault in the console's own voice — a 12px mono title over a placard-styled detail line.
ACQUIRING LINK, SIGNAL LOST, LINK DOWN. The face outside stays live and readable.

### Icons

One set, authored SVG, no icon library and no glyph font. A 20×20 frame, `fill: none`,
1.5 stroke, round caps and joins, `currentColor` throughout so a glyph tints with the thing
it labels. Seven exist — Link, Clock, Buffer, Feed, Cut, Target, Transmit — and the set is
deliberately small: on a console face meaning is carried by placards and lamps, so an icon
earns its place only where a word would be slower to read. At the plot key's 11px scale the
stroke goes to 2 so the mark survives; that is optical compensation, not a second weight.

### Named Rules

**The Emoji Are Payload Rule.** The six reaction emoji are product content — the thing users
transmit to each other — and they appear in exactly three places: on the reaction keys, in
the armed indicator under the glass, and as burst particles on the plot. Every piece of
chrome iconography is authored SVG. Do not extend emoji into the icon system, into a
placard, or into a status indicator.

## Do's and Don'ts

### Do:

- **Do** keep the two grounds separate: lit panel metal (`{colors.panel}`) for the face,
  `{colors.glass}` for the plot field and nothing else.
- **Do** declare elevation once, with a seam border plus `bevel-up` or `bevel-down`.
- **Do** hold panel radii at 2px, 3px only for the bezel, 1px for cut wells and tracks.
- **Do** engrave every placard: uppercase Archivo Narrow, 600/10px, +0.1em,
  `{colors.ink-2}`, with the `0 1px 0 rgba(255,255,255,0.5)` shadow.
- **Do** set values in Azeret Mono with tabular numerals, and pair a lamp with a word — the
  lamp carries severity, the word says why.
- **Do** put a new reading in the switch group that governs it, and print it exactly once.
- **Do** use the 420ms `cubic-bezier(0.16, 1, 0.3, 1)` curve for anything that moves when a
  switch is thrown, and damp engine-driven numerals at tau 260ms via `useDamped`.
- **Do** carry state redundantly: a dash signature, a paddle position or an engraved index
  bar alongside any colour change.
- **Do** stop chrome animation under `prefers-reduced-motion` — and leave remote station
  motion running, because that motion is the product.
- **Do** keep every subsystem state readable at 900px wide.

### Don't:

- **Don't** add a drop shadow. No blurred, offset `box-shadow` exists outside the bezel, and
  a floating card would break the world's central claim.
- **Don't** use a lamp hue for anything but state. No amber section headers, no green
  "success" tint on a panel that is merely idle.
- **Don't** put a participant hue anywhere on the panel except the roster's 3px keying strip.
- **Don't** set text in `{colors.ink-3}` (3.21:1). It is for icon glyphs and hairlines only;
  text tint stops at `{colors.ink-2}`.
- **Don't** introduce a second dark region on the face, or a translucent "glass card" —
  the frosted-panel dashboard is the exact default this world refuses.
- **Don't** add a settings drawer, a modal, or a debug panel. Every control belongs on the
  face beside its reading.
- **Don't** use emoji as interface iconography. Authored 20×20 SVG at 1.5 stroke, or a word.
- **Don't** animate `width` or `height` on anything that updates at telemetry rate — scale
  or translate instead.
- **Don't** damp a number the user's own hand is dragging.
- **Don't** invent a status. Every lamp on this face must trace to something the engine
  actually measures.
