# Architecture

How the pieces fit, why they are split where they are, and what it costs to change them.
[README.md](README.md) covers protocol tables, measurements and failure semantics; this
document is about structure.

## Layering

The organising rule: **each layer speaks a different vocabulary, and none of them leaks
downward.**

```
┌──────────────────────────────────────────────────────────────────┐
│  App.tsx / ui/*            pixels, pointers, panels              │  knows nothing
│                            "the user moved the mouse"            │  about sockets
├──────────────────────────────────────────────────────────────────┤
│  render.ts                 canvas drawing, particles             │  pure output;
│                            "draw a cursor at (x,y)"              │  no I/O at all
├──────────────────────────────────────────────────────────────────┤
│  net/room.ts               THE SYNC ENGINE                       │  the only place
│  interpolation.ts          batching, peer state, the timeline    │  that knows both
│  net/clock.ts              "where was this peer 120ms ago?"      │  ends exist
├──────────────────────────────────────────────────────────────────┤
│  net/connection.ts         raw WebSocket, reconnect, RTT probes  │  strings in,
│                            "deliver this string, keep the link"  │  strings out
└──────────────────────────────────────────────────────────────────┘
                                    │
                      shared/protocol.ts  ← the contract
                       types + validators, one file, both sides
                                    │
┌──────────────────────────────────────────────────────────────────┐
│  ws/frame.ts               RFC 6455 bytes: masks, opcodes,       │  no idea what a
│  ws/handshake.ts           lengths, fragments, close codes       │  cursor is
│  ws/connection.ts          one socket's lifecycle + backpressure │
├──────────────────────────────────────────────────────────────────┤
│  hub.ts                    connection → session → room routing   │  timers live here
│                            tick loop, heartbeat sweep            │
├──────────────────────────────────────────────────────────────────┤
│  room.ts                   presence, aggregation, conflicts      │  the application
│                            "who is here, what happened this tick"│
├──────────────────────────────────────────────────────────────────┤
│  server.ts                 http, Upgrade, static files           │
└──────────────────────────────────────────────────────────────────┘
```

Two seams are load-bearing:

- **`WsConnection.onText` / `.send`** — the transport boundary. Above it, strings and
  message objects. Below it, bytes and opcodes. `room.ts` contains the word "frame"
  exactly once (to encode a shared broadcast payload once instead of N times) and never
  touches a mask or an opcode.
- **`shared/protocol.ts`** — the contract boundary. Not two files kept in sync by
  discipline; *one* file imported by both sides. `server/src/protocol.ts` and
  `client/src/protocol.ts` are one-line re-exports, so the submission's expected layout is
  satisfied without duplicating a single type.

## Data flow, end to end

Following one cursor movement from a mouse to another person's screen:

```
 CLIENT A                          SERVER                        CLIENT B
 ────────                          ──────                        ────────
 pointermove (60-120Hz)
   │
   ▼
 room.sendAction({type:'cursor'})
   │  sample at ≤30Hz
   │  skip if quantized position unchanged
   ▼
 pending[] ──flush every 50ms──▶ {t:'in', seq, s:[[dt,x,y],…]}
                                   │
                                   ▼
                                 parseClientMessage()   ← unknown/malformed dies here
                                   │
                                   ▼
                                 st = now − dt          ← client clock used only for
                                   │                      the *relative* offset
                                   ▼
                                 drop if st ≤ member.lastSampleSt   ← stale filter
                                   │
                                   ▼
                                 member.pendingCursors[] (cap 4, newest kept)
                                   │
                                   │  ── every 50ms ──
                                   ▼
                                 Room.tick(): collect all members' events
                                   │  build ONE shared payload
                                   │  contributors get a self-filtered copy
                                   ▼
                                 {t:'k', st, seq, c:[[pid,x,y,age],…]}
                                                                  │
                                                                  ▼
                                                        parseServerMessage()
                                                                  │
                                                                  ▼
                                                        t = msg.st − age
                                                        CursorTrack.push({t,x,y})
                                                                  │  reject if t ≤ newest
                                                                  ▼
                                              ┌───────── rAF loop, display rate ─────────┐
                                              │ renderTime = clock.serverNow() − delay   │
                                              │ track.sampleAt(renderTime)               │
                                              │   → interpolate / extrapolate / hold     │
                                              │ renderer.draw(...)                       │
                                              └──────────────────────────────────────────┘
```

Three properties fall out of this shape:

1. **One timeline, one clock.** Every event is stamped in server time on arrival, so
   samples from five clients with five wrong clocks are directly comparable. Clients map
   that timeline onto their own clock once, in `ClockSync`.
2. **The stale filter appears twice** — once server-side, once client-side — because they
   defend against different things: the server protects the room from one client's bad
   ordering, the client protects its own render buffer from cross-connection reordering.
3. **Positions never enter React state.** The rAF loop pulls interpolated positions
   straight out of the room and hands them to the canvas. React re-renders 5×/second, for
   panels only. Sixty `setState` calls a second would cost more in reconciliation than the
   entire sync engine costs in total.

## Module responsibilities

| Module | Owns | Deliberately does *not* know |
|---|---|---|
| `ws/frame.ts` | masks, opcodes, lengths, fragments, close codes | that JSON exists |
| `ws/handshake.ts` | the 101 Upgrade, `Sec-WebSocket-Accept` | anything after the handshake |
| `ws/connection.ts` | one socket's lifecycle, close handshake, backpressure | rooms, cursors, message types |
| `hub.ts` | connection→session→room routing, the two timers | how a room aggregates anything |
| `room.ts` | presence, pids, colours, tick aggregation, conflicts | sockets, frames, masks |
| `shared/protocol.ts` | every wire shape + total validators | both of the above |
| `net/connection.ts` | reconnect/backoff, resume token, RTT, emulator | cursors, interpolation |
| `net/clock.ts` | server-time estimation | why anyone wants it |
| `net/room.ts` | batching, peer registry, timeline conversion | pixels, React |
| `interpolation.ts` | buffering, lerp, bounded extrapolation | networks, canvases |
| `render.ts` | the plot: graticule, station symbols, bursts | where positions came from |
| `ui/console.ts` | engine state → console vocabulary, GO/NO-GO derivation | rendering, sockets |
| `ui/useDamped.ts` | easing a displayed number like a settling meter | what the number means |
| `App.tsx` | pointer input, rails, wiring | all of the above |

## Adding a new action type

This is the extensibility test the brief asks about, so here it is concretely. Suppose you
want **"draw a stroke"**. The complete change set:

1. **`shared/protocol.ts`** — add `StrokeMsg` to `ClientMessage`, add a case to
   `parseClientMessage`, add the tick field (e.g. `s?: TickStrokeTuple[]`) and validate it
   in `parseServerMessage`.
2. **`server/src/room.ts`** — one `case 'stroke':` in `handleMessage` pushing to
   `member.pendingStrokes`, and one loop in `tick()` draining it into the tick payload.
3. **`client/src/net/room.ts`** — one branch in `sendAction`, one branch in the `'k'`
   handler to emit it as a `RemoteAction`.
4. **`client/src/render.ts`** — draw it.

**Zero changes** to `ws/*`, `hub.ts`, `server.ts`, `net/connection.ts`, `net/clock.ts` or
`interpolation.ts`. The transport never learns a new word; the frame parser never learns
that strokes exist. That is the whole reason `onText` hands up opaque strings rather than
a parsed union.

If the new action needs *smoothed* motion (a dragged object, say), it reuses `CursorTrack`
as-is — it is written against `{t, x, y}` in normalized coordinates and has no idea it is
usually a mouse pointer.

## Two kinds of shared state

The room carries state of two different natures, and the protocol treats them differently
on purpose:

- **Relayed** (cursors, reactions): lossy-tolerant, high-frequency, no single truth. The
  server forwards without owning, excludes the sender, and drops under backpressure.
- **Authoritative** (target, scoreboard, tally): one truth, low-frequency, must not be
  lost. The server owns the value, clients send intents, the result is broadcast to
  everyone *including* the sender (the echo is the confirmation), and the frames are never
  droppable.

The tally is the clearest example: `{t:'counter', delta:+1}` is an intent, never a value,
so two simultaneous clicks both count with no CRDT and no client-side merge. See the
README for the trade against the CRDT approach.

## Fan-out: the cost model

The naive bug the brief warns about is re-serializing the payload once per recipient. What
`Room.tick()` actually does:

- Collect every member's pending events into **one** array pass — O(events).
- Members who contributed nothing this tick all receive **identical bytes**: the payload is
  `JSON.stringify`'d and framed **once**, then written to each socket
  (`WsConnection.sendPrepared`). This is the common case for joins, leaves, reactions, and
  for anyone who is watching rather than moving.
- Members who *did* contribute get a filtered copy, because we never echo a client's own
  cursor back to it.

So the cost is **O(members + events)** in the common case and **O(contributors × events)**
in the worst case (a room where everyone is moving at once), not O(n²) serialization.

**Why exclude self at all?** The alternative — send everything to everyone and let clients
filter their own `pid` — is genuinely cheaper on the server (one encode, N writes, always).
I chose exclusion because the client already drew its own cursor locally at zero latency;
an echo is bytes that can only cause harm if anyone ever renders them. At a scale where the
encode cost mattered, I would flip this and treat the echo as an intentional
acknowledgement channel — it doubles as a free RTT measurement. It is a deliberate
trade, not an oversight.

## Timing model

Three clocks, and keeping them distinct is most of the correctness:

| Clock | Used for | Why not the others |
|---|---|---|
| `Date.now()` on the **server** | stamping every event; the shared timeline | the only clock all clients can be related to |
| `Date.now()` on the **client** | measuring `dt` within a batch, and RTT | never trusted as an absolute — only as a stopwatch |
| `performance.now()` on the client | arrival-jitter measurement, particle lifetimes | monotonic; unaffected by clock steps or NTP |

`ClockSync` converts between the first two. `renderTime = serverNow() − interpolationDelay`
is the single expression that ties the whole client together — everything drawn is a
question about that one number.

## The interface layer

The console face is a separate concern from the sync engine and is kept that way. Two
seams matter:

**`ui/console.ts` is the only translator.** It turns engine state into the words the face
uses — `interpolated` becomes `TRACK`, `extrapolated` becomes `COAST` — and derives the
GO/NO-GO matrix from telemetry that is actually measured. Nothing else in the UI decides
what a subsystem's health is, and no lamp on the face is decorative: LINK reads DEGRADED
off measured RTT and jitter, BUFFER reads STARVED only when a station is still receiving
and still starving. A station that merely stopped moving reads IDLE, because an instrument
that reports a user sitting still as a fault is an instrument nobody will trust twice.

**`render.ts` owns the glass and nothing else.** It is handed already-interpolated
positions in normalized [0,1] space. It exports `dashFor(code)`, which the roster's plot
key imports for its legend marks — so the key that explains the symbology is drawn from
the same function as the symbology, and cannot drift from it.

Positions never enter React state. The rAF loop pulls interpolated positions straight out
of the room; React re-renders about five times a second, for the rails only. The one place
a number animates per frame is `useDamped`, which is scoped to a single readout component
so a settling figure re-renders one dial rather than the whole bank, and which stops the
moment it arrives.

## Testing strategy

39 tests, in three bands:

- **Framing** (`tests/frame.test.ts`) — the RFC 6455 example accept-key, extended lengths,
  fragmentation, a frame arriving one byte at a time, several frames in one chunk,
  unmasked frames, reserved bits, oversized payloads, invalid UTF-8. Everything else rests
  on the byte parser being right.
- **Contract** (`tests/protocol.test.ts`) — unknown types, malformed JSON, wrong tuple
  arity, `NaN`/`Infinity`, coordinate clamping, and that the *client* rejects bad server
  frames too.
- **Behaviour** (`tests/interpolation.test.ts`, `tests/integration.test.ts`) — every claim
  the README makes, asserted: bounded extrapolation, no smoothing across stalls, bounded
  memory, no self-echo, join snapshots, immediate cleanup on clean close, grey-out then
  reap on abrupt drop, resume without duplicate cursors, stale-sample rejection,
  deterministic conflict resolution, and empty rooms not leaking.

The integration tests run the **real server in-process** (`createSyncServer({port: 0})`)
and drive it with a **hand-written WebSocket client** (`tests/ws-test-client.ts`) that does
its own masked framing — so the tests exercise the actual byte path, not a mock. That is
also why `server.ts` exports a factory instead of only auto-starting: a testable server is
a design requirement, not an afterthought.
