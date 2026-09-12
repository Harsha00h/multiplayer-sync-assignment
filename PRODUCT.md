# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences share one surface, confirmed with the author:

1. **The evaluating engineer** (primary). A reviewer of a take-home submission who opens
   3–5 browser tabs side by side, waves the cursor in each, throttles the network in
   DevTools, kills a socket, and closes a tab — checking whether the sync engine behaves.
   Their job is to *decide whether this person can build real-time systems*, and they are
   doing it in a few minutes, probably with other submissions open.
2. **The imagined end viewer** — a fan in a live watch-party moment during a broadcast,
   tapping and reacting alongside strangers. Nobody real uses this yet, but the product is
   supposed to look like something they *would* use.

The confirmed resolution: the surface must read as a shipped product on first impression
and be flippable into an instrumented mode that proves the engine. Two layers, one screen.

## Product Purpose

A real-time multiplayer cursor and reaction canvas. Everyone in a room sees everyone
else's cursor move live, can fire emoji reactions, and can race to tap a shared target.

It exists as the deliverable for a take-home assignment whose explicit subject is *the
sync engine*, not the app: protocol design, throttling, interpolation, and honest failure
handling, built on raw WebSockets with no sync libraries. Success is a reviewer coming
away convinced the sync is correct and smooth, and the demo is the instrument that
convinces them.

## Positioning

Every part a sync library would normally provide is hand-written here and can be shown
working: the RFC 6455 framing, the wire protocol, the clock synchronisation, the
interpolation buffer, the reconnect/resume model. The differentiator a neighbouring
submission could not truthfully copy is that the invisible machinery is *demonstrable* —
interpolation mode, buffer depth, arrival jitter and connection state are all observable
live, and degradable live, from inside the page.

## Operating Context

- Evaluated on a desktop browser, frequently as **several tiled windows or tabs at once**,
  which means the layout must survive being half a screen wide and must be legible at a
  glance from a neighbouring window.
- Identity is per browser tab (`sessionStorage`), so tabs behave as separate people.
- Sessions are short and hands-on: move the mouse, click, drag a slider, kill the socket,
  reload.
- A live interview follow-up is expected, where the author demos multiple clients, throttles
  the network, and explains what interpolation does under those conditions — the UI is a
  presentation surface for that conversation.
- Also runs from a single process in production (`npm start`) at one origin.

## Capabilities and Constraints

Confirmed functionality that must remain reachable:

- Live remote cursors with name labels; local cursor drawn at zero latency.
- Six emoji reaction types (`1`–`6` to select, click to fire), bursting at a point.
- A server-owned ⚽ target: tap to score, contested taps resolved server-side by capture
  time, with a scoreboard and a cooldown.
- Presence list with headcount, per-peer interpolation mode, freshness and arrival jitter.
- Connection readouts: status, RTT, jitter, buffer depth, adaptive send rate, bytes and
  message counts in/out, resume count, rejected-frame count.
- **All current controls stay reachable** (pinned by the author as a hard constraint):
  adaptive-buffer toggle, buffer slider, extrapolation toggle, per-cursor debug toggle,
  inbound latency/jitter/loss emulator sliders, and the kill-the-socket button.

Technical constraints:

- **No new runtime dependencies.** `react` and `react-dom` are the only ones, and the
  submission's central claim is that no library does the sync. Hand-written CSS only.
  Web fonts via a `<link>` are permitted; no JS packages.
- Cursors render on `<canvas>` at requestAnimationFrame rate, and positions deliberately
  never enter React state — a documented performance decision.
- Coordinates are normalized `[0,1]` over the shared surface, so any layout change to the
  canvas area changes what every client's coordinate space means.
- Rooms are in-memory; no persistence, no auth.

## Brand Commitments

None pre-existing. No company, logo, or established identity. The room id
(`watch-party-42`) and the broadcast/fan-moment framing come from the assignment brief.

## Evidence on Hand

Real and usable in the interface:

- Genuine live telemetry — RTT, jitter, buffer depth, per-peer arrival statistics,
  byte/message counters — all already measured by the running client.
- Measured benchmark results in README.md (0.88 vs 4.45 KB/s outbound; 5.1× reduction),
  reproducible via `npm run bench`.
- 39 passing tests, including end-to-end multi-client integration.

Absences that must not be fabricated: no users, no customers, no testimonials, no uptime
or scale claims, no real broadcast partner. There is no logo and no photography.

## Product Principles

1. **The engine is the product.** Anything on screen should either be the shared
   experience itself or evidence that the sync underneath it is working.
2. **Show, don't assert.** Claims about smoothness, jitter handling or reconnects are made
   by letting the reviewer break the connection and watch, not by copy.
3. **Two layers, never two apps.** A convincing live surface first; instrumentation is a
   deliberate second layer the same person can summon, not a debug panel bolted on.
4. **Survive a tiled window.** The evaluation happens in several small windows at once, so
   nothing important may depend on a wide viewport.
5. **Honesty over polish.** Degraded, disconnected and empty states are shown truthfully;
   a frozen cursor is labelled as such rather than pretended live.

## Accessibility & Inclusion

No standard was contractually established. Product-specific needs that do apply: peers are
distinguished by hue, so colour must never be the *only* differentiator (names are always
attached); the emulator and control panel are keyboard-reachable form controls and must
stay that way; and motion is central to the product, so reduced-motion users need the
interface chrome to stop animating even though remote cursors cannot.
