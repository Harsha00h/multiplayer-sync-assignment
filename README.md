# Real-Time Multiplayer Cursor Sync

A shared canvas where everyone in a room sees everyone else's cursor move live, can fire
off emoji reactions, and can race each other to tap a target. Built directly on the raw
`WebSocket` API and Node's built-in `http` module.

**No sync or socket libraries.** No Socket.IO, Yjs, PartyKit, Liveblocks, Ably, Pusher —
and no `ws` either. The RFC 6455 handshake, frame parser, masking, fragmentation, close
handshake, ping/pong and backpressure are all in [`server/src/ws/`](server/src/ws/). The
protocol, throttling, clock sync, interpolation and reconciliation are mine too. The only
runtime dependencies in the whole repo are `react` and `react-dom`, for the demo UI.

---

## Quick start

```bash
npm install
npm run dev
```

Then open **http://localhost:5173** in 3–5 tabs. Each browser tab is an independent
client (identity lives in `sessionStorage`, which is per-tab), so tabs behave exactly like
separate devices.

- Different room: `http://localhost:5173/?room=my-room`
- Custom name: `http://localhost:5173/?name=alice`

`npm run dev` starts the sync server on **:8787** and the Vite dev server on **:5173**.
To run them separately: `npm run dev:server` / `npm run dev:client`.

### Single-process production build

```bash
npm run build   # builds the client into client/dist
npm start       # server serves the built client *and* the WebSocket on :8787
```

Then open http://localhost:8787. One process, one origin — which is also what makes this
deployable to any host that supports persistent WebSocket connections (Fly, Railway,
Render, a VPS; **not** Vercel/Netlify static hosting).

### Tests and benchmark

```bash
npm test        # 39 tests: framing, protocol validation, interpolation, and
                # end-to-end multi-client integration against a real server
npm run bench   # measures actual bytes on the wire
npm run typecheck
```

---

## Try this (the 3-minute tour)

The interface is a mission-control console: the shared canvas is the room's front screen
(the **plot**, inside the dark bezel), everyone in the room is a **station**, and every
switch on the face sits beside the reading it changes.

1. **Multi-client.** Open 4 tabs, wave the mouse around in each. Every tab draws every
   other station as a tracked symbol with a leader line and a data block, and lists them
   under **ON STATION**.
2. **Reactions.** Click the plot to transmit a burst; press `1`–`6` to arm a different
   one. Your own burst appears instantly (optimistic), everyone else's arrives over the
   wire.
3. **Contested taps.** Two tabs race for the **ACQUIRE** reticle. Exactly one scores; the
   loser is told *"beaten to it — ordered by capture time"*. Resolution happens on the
   server, by capture time, not by who arrived first.
4. **Degrade the network.** In the **LINK** group, drag *Latency* to 300ms and *Jitter* to
   250ms. The whole face moves together: the BUFFER lamp swings from NOMINAL to COASTING,
   stations step from TRACK to COAST, the *Render delay* slider climbs on its own from
   ~78ms to ~280ms, and *Rate* drops from 30/20Hz to 24/14Hz — while the plot stays
   smooth. Chrome DevTools → Network → throttling works too, and is the more honest test.
5. **Break interpolation on purpose.** In **BUFFER**, throw *Adaptive* off, drag *Render
   delay* to 0, and throw *Extrapolate* off. Stations now step at the 20Hz tick rate.
   That is the naive implementation, and the difference is the whole point of the module.
6. **Kill the connection.** Throw **CUT LINK**. Other tabs mark your station LOST and dim
   it immediately; you reconnect within ~1s and resume the *same seat* — same colour, same
   peer id, no duplicate station. Reloading a tab (⌘R) does the same thing.
7. **Close a tab.** Your station disappears from the other tabs at once. No zombies.

The **PLOT KEY** at the foot of the roster explains the symbology: TRACK is drawn between
two known samples, COAST is projected from the last velocity, HOLD is starved past the
projection budget, IDLE is connected but not moving.

---

## Protocol design

Text JSON over a single WebSocket. Every frame is validated on **both** ends by
[`shared/protocol.ts`](shared/protocol.ts) — one file, imported by client and server, so
the two cannot drift apart.

### Client → server

| Type | Shape | When | Size |
|---|---|---|---|
| `hello` | `{t, v, roomId, clientId, name, token?}` | first frame on every connection; `token` present = "resume my seat" | 116 B |
| `in` | `{t, seq, s: [[dt, x, y], …]}` | batched cursor samples, ~20/s | 39 B (1 sample) / 54 B (2) |
| `react` | `{t, seq, dt, x, y, k}` | discrete tap, sent immediately | 53 B |
| `ping` | `{t, id, ct}` | RTT/clock probe, every 2s | 38 B |
| `bye` | `{t}` | voluntary leave; skips the reconnect grace window | 12 B |

### Server → client

| Type | Shape | When | Size |
|---|---|---|---|
| `welcome` | `{t, v, st, tick, token, you, resumed, peers[], target}` | reply to `hello`; **carries the full room snapshot** | ~200 B + 100 B/peer |
| `join` | `{t, st, peer}` | someone arrived | 157 B |
| `leave` | `{t, st, pid, reason}` | seat destroyed | 59 B |
| `pres` | `{t, st, pid, online}` | online↔offline inside the grace window | 54 B |
| `k` (tick) | `{t, st, seq, c?: [[pid,x,y,age],…], r?: [[pid,x,y,k,age],…]}` | every 50ms, if anything happened | **110 B** (4 peers moving) |
| `pong` | `{t, id, ct, st}` | reply to `ping` | 57 B |
| `target` | `{t, st, target, lost?}` | target claimed/moved | ~130 B |
| `err` | `{t, code, msg, fatal}` | rejected frame, rate limit, bad version | ~80 B |

### Three tricks instead of a binary codec

I kept JSON — readable in devtools, trivially versionable — and made the hot path cheap:

1. **Peer ids.** Inside a room every member gets a small integer `pid`. Ticks carry
   `pid`, not a 36-character UUID. The mapping is sent once, in presence messages.
   *Saves ~33 B per cursor sample.*
2. **Quantized, normalized coordinates.** Positions are integers in `[0, 10000]`
   relative to the canvas — resolution-independent (a 4K monitor and a phone agree) and
   ~4 characters instead of a float's ~18. The quantization also makes "did it move?" an
   integer comparison, so **a resting cursor sends nothing at all**.
3. **Tuples, not objects,** for anything repeated: `[3,4000,6000,25]` instead of
   `{"pid":3,"x":4000,"y":6000,"age":25}`. *Saves ~22 B per sample.*

A cursor sample costs **~17 bytes** on the wire. Binary framing would roughly halve the
remaining overhead; it is the obvious next step and not worth the debuggability cost at
this scale.

### Throttling and batching — with measurements

Raw `pointermove` fires 60–120 times a second. Sending each one as its own frame is the
anti-pattern the brief calls out, so the client does three things
([`client/src/net/room.ts`](client/src/net/room.ts)):

- **Sample at 30Hz, not event rate.** Anything faster is invisible after it has been
  through a network and an interpolator.
- **Skip no-op samples.** Quantized position unchanged ⇒ nothing captured.
- **Batch on the server's cadence.** Samples accumulate and flush every 50ms, so one
  frame carries 1–2 samples instead of 2–6 separate frames.
- **Adapt to RTT** *(bonus)*: `<60ms` → 30Hz/20Hz flush; `<150ms` → 24Hz/14Hz;
  otherwise 15Hz/10Hz. On a congested link, extra samples only add queueing delay — they
  get smoothed into a longer interpolation window anyway.

Measured with `npm run bench` (5 clients, all moving continuously, 8s):

| | throttled + batched | naive (one frame per event, 120Hz) | |
|---|---|---|---|
| per client, outbound | **0.88 KB/s** | 4.45 KB/s | **5.1× less** |
| per client, inbound | **2.07 KB/s** | 5.82 KB/s | **2.8× less** |
| server total egress | **10.4 KB/s** | 29.1 KB/s | **2.8× less** |
| bytes per tick | 109 B | 302 B | |

Reproduce with `npm run bench -- --clients 5 --seconds 8` and
`npm run bench -- --clients 5 --seconds 8 --naive`.

Note the naive column does not blow up 5× on the inbound side: the server caps each
member at 4 samples per tick and keeps the *newest*, so a badly-behaved client degrades
its own uplink but cannot flood everyone else's downlink.

### Timestamps: whose clock?

No client timestamp is ever trusted as an absolute. A client sends `dt` — "this sample was
captured N ms *before* I sent this frame" — a relative number from a single stopwatch. The
server converts it to its own clock on arrival (`st = now - dt`), so **everything the
server emits is in server time**. Each client maps server time back onto its own clock
using an offset estimated from ping/pong:

```
rtt    = now - ct
offset = st + rtt/2 - now        // add to local clock to get server time
```

with a 12-sample window, the *lowest-RTT* sample used as the estimate (least-queued probe
= least-contaminated), and easing rather than snapping so the render timeline never jumps.
See [`client/src/net/clock.ts`](client/src/net/clock.ts).

### What lives where

**Server owns** (authoritative): membership, `pid` assignment, colours, name uniqueness,
the event timeline, the tap target and the scoreboard.
**Server relays**: cursor positions, reaction bursts. It retains only the *latest* cursor
per member — not a history — purely so a joiner can be handed a snapshot.

---

## Interpolation strategy

Remote cursors are rendered **in the past**:

```
renderTime = serverNow() - interpolationDelay
```

By staying deliberately ~100ms behind the server clock, we almost always hold samples on
*both sides* of the time we want to draw, so drawing is interpolation between two known
points rather than guessing. Implementation:
[`client/src/interpolation.ts`](client/src/interpolation.ts).

Three regimes, in order of preference:

1. **Interpolate** — `renderTime` falls between two buffered samples: linear lerp. The
   normal case, and what you want ~95% of the time.
2. **Extrapolate** *(bonus)* — buffer starved. Project forward from the last sample using
   velocity from the previous two, with **exponential decay**:
   `x(t) = x₀ + v·τ·(1 − e^(−t/τ))`, τ = 90ms. Displacement is bounded by `v·τ` no matter
   how long the stall lasts, so the cursor eases to a stop instead of flying off and
   snapping back. Capped at 180ms.
3. **Hold** — past the extrapolation budget. Freeze at the far end of the projection
   rather than rewinding to the last known sample: a pause reads as "their connection
   hiccupped", a rewind reads as "this app is broken".

**Gaps are not smoothed.** If two consecutive samples are more than 300ms apart, that is a
stall (loss, a reconnect, a throttled background tab), not motion. Sliding a cursor
smoothly across a 3-second gap looks like a ghost drifting; we hold, then jump.

### The delay/smoothness tradeoff

| Buffer | Result |
|---|---|
| 0ms | No added latency. Buffer always starved ⇒ pure extrapolation, or visible 20Hz stepping with extrapolation off. |
| ~75ms (1.5 ticks) | Smooth on a LAN. Marginal the moment jitter appears. |
| **~120–200ms (adaptive default)** | Smooth through 250ms of jitter. Remote cursors lag ~0.15s — below the threshold where a *pointer* feels sluggish. |
| 400ms (clamp) | Glassy. Now perceptibly laggy. |

The adaptive rule is `tick × 1.5 + jitter × 2`, clamped to `[60, 400]ms`:

- `tick × 1.5` covers the aggregation cadence itself (a sample can miss a tick by almost a
  full interval, plus tick-to-tick spacing).
- `jitter × 2` covers late arrivals, using the mean absolute deviation of RTT and of
  per-peer inter-arrival spacing, whichever is worse.
- Changes are **eased** (5% per update), because stepping the render clock would snap
  every cursor at once.

**Added latency, measured:** on localhost the buffer settles at ~78ms. With the emulator at
300ms latency / 250ms jitter it settles at ~215ms. That is the honest cost: remote cursors
are shown where they were 78–215ms ago, and in exchange they never teleport.

**Memory is bounded**: at most 32 samples *and* 2 seconds of history per peer, whichever
is tighter, compacted in place. A tab left open overnight holds the same memory as one
opened a second ago. There is a test for this.

---

## Failure handling

### Disconnect

The distinction that matters is whether the peer completed the WebSocket close handshake:

| Event | Detected via | Result |
|---|---|---|
| Tab closed / navigated away | close frame (1000/1001) | seat destroyed **immediately**, `leave` broadcast |
| Explicit `bye` | application frame | seat destroyed immediately |
| Network died, laptop slept, cable pulled | socket error/FIN with **no** close frame ⇒ 1006 | marked offline **immediately** (`pres`), seat held **5s** for resume, then `leave` |
| Half-open TCP (no packets at all) | heartbeat: WS ping every 10s, no traffic for 25s | connection closed, then the above |

So a station is gone within **~5s** worst case for a dropped connection and
**immediately** for a clean exit. Nothing lingers indefinitely. A station inside the grace
window is drawn dimmed and marked LOST rather than pretending it is live — and a station
that simply stopped moving is marked IDLE, not treated as a fault, because an instrument
that cries wolf is worse than no instrument.

### Reconnect

The client reconnects automatically with exponential backoff plus full jitter
(250ms → 8s), and presents the `token` it received in `welcome`. The server matches
`clientId` + `token` and **resumes the same seat**: same `pid`, same colour, same
scoreboard entry. Other clients see `pres online`, not a second `join` — so no duplicate
cursor and no page reload. There is an integration test asserting that a resume produces
*zero* join/leave frames on the observing peer.

If a *live* connection already holds that seat (a laptop that slept and whose FIN never
arrived), the newer connection wins and the stale one is closed with 4001. A client that
receives 4001 does **not** retry — otherwise two tabs sharing an id would fight forever.

### Out-of-order and duplicate delivery

WebSocket runs over TCP, so within a single connection frames are ordered — I want to be
honest about that rather than pretend otherwise. Reordering is still possible **across**
connections (a resume interleaving with the old socket's in-flight frames), and duplicates
are possible on a retry path. Defences, all of them cheap:

- **`seq` per connection.** A frame whose `seq` is not greater than the last is dropped.
- **Server-side timestamp monotonicity.** Within a batch each reconstructed sample must be
  newer than every sample already integrated for that member; older ones are discarded.
  Tested — a batch of `[100ms ago, 300ms ago, 200ms ago]` forwards exactly one sample.
- **Client-side buffer monotonicity.** `CursorTrack.push` rejects any sample at or before
  the newest it holds. An old position carries no information the newer one hasn't already
  superseded, so splicing it into the middle of the timeline would only cause a visible
  stutter.
- **Room-wide tick `seq`** lets a client discard a duplicated or reordered tick.

The client's built-in network emulator deliberately applies a *per-frame* random delay,
which really does reorder frames — so this path is exercised by dragging the Jitter slider,
not just by unit tests.

### Malformed messages

Every inbound frame — on both ends — goes through a hand-written validator before any
other code sees it. It is total: it never throws, it returns a `Result`.

- **Unknown type** (`{"t":"teleport"}`) → rejected with an `err` frame naming the reason.
- **Malformed JSON, wrong tuple arity, wrong value types, `NaN`/`Infinity`** → rejected.
- **Out-of-range coordinates** → *clamped*, not rejected. A stray pixel is not worth a
  disconnect.
- **5 bad frames on one connection** → connection closed (`fatal: true` first).
- **A binary frame, an unmasked frame, a reserved bit, a fragmented control frame, invalid
  UTF-8, an oversized payload** → closed at the framing layer with the correct RFC close
  code.
- The client validates server frames too, and drops bad ones without disturbing rendering.
  One bad frame must not white-screen the canvas.

### Rate limiting and backpressure

Per connection: 120 messages/s and 240 samples/s, three strikes then closed. If a socket
has more than 256KB unflushed, ticks are **dropped** for that client rather than queued —
a stale cursor position has no value, and one slow client must not become everyone's
problem. Presence frames are never droppable: losing a `leave` would leave a zombie.

---

## Conflict resolution (bonus)

Two clients tapping the ⚽ inside the same 50ms tick is a genuine simultaneous conflict.
Rather than letting TCP arrival order decide — which rewards whoever has the shorter cable
and is unstable run to run — the server buffers claims for the tick and resolves them by
**captured** server timestamp (the moment the tap happened, reconstructed on arrival),
breaking exact ties by `pid` so every observer agrees. The winner scores; **losers are told
they lost** so the UI can show the near-miss instead of silently swallowing the input.
Covered by an integration test that has the *later-arriving* frame win on capture time.

---

## Also implemented from the bonus list

- **Extrapolation** with bounded, decaying velocity (above).
- **Adaptive throttling** from measured RTT (above).
- **Conflict reconciliation** for simultaneous taps (above).
- **Per-client latency/jitter visualisation** — every station in the roster carries its
  tracking state (TRACK / COAST / HOLD / IDLE / LOST), a freshness bar over an
  arrival-jitter bar, and ms since its last update actually landed.
- **In-page network emulator** — inbound latency, jitter and loss sliders, plus CUT LINK,
  so the failure paths can be demoed without DevTools.
- **Horizontal scaling discussion** — below.

---

## Known limitations

- **No persistence.** Restart the server and all rooms are gone. Clients reconnect
  automatically and re-join, but scores and pids reset.
- **Single process, no horizontal scaling.** Room state is in memory. See below.
- **No authentication or access control.** Any `clientId` may claim any `roomId`. The
  resume `token` stops one tab from stealing another's *seat*, but it is not a security
  boundary.
- **No TLS in dev.** Deploying behind a TLS terminator is required for `wss://`.
- **Text JSON, not binary.** ~2× more bytes than a packed binary encoding.
- **Backgrounded browser tabs are throttled by the browser** (timers to ~1Hz, rAF
  paused). A background tab therefore stops sending cursor updates and its peers show it
  as `held`. This is browser policy, not a bug in the sync layer — but it means "5 tabs"
  really means "5 *visible* windows" for a smoothness demo.
- **`MAX_MEMBERS` is 64 per room** and the fan-out is O(members × events-per-tick). Fine
  for the 3–10 clients this targets, and the shared-frame optimisation covers the common
  broadcast case, but it is not a 10k-user design.
- **No mobile testing beyond pointer events.** Touch works via Pointer Events; multitouch
  is not modelled.
- **One benign dev-only console warning.** React StrictMode double-mounts effects, so the
  first room is created and immediately disposed; Chrome logs *"WebSocket is closed before
  the connection is established"*. StrictMode is left on deliberately — it is a free test
  that teardown is correct (the dispose path closes a still-`CONNECTING` socket, so no
  ghost seat is left on the server). It does not occur in a production build.
- **The demo's reaction particles are client-local.** Two clients see slightly different
  particle physics — deliberate, since they are decoration, not state.

---

## Horizontal scaling (discussion)

The current server is one process holding rooms in a `Map`. Scaling out:

**1. Shard by room, not by connection.** A room is the natural consistency boundary:
members only ever interact within one. Put a consistent-hash or lookup layer at the edge
(`roomId → instance`) so every member of a room lands on the same process. That gets you
horizontal capacity with **zero** cross-node coordination on the hot path, and is where
I would stop for anything short of very large rooms.

**2. If a single room must exceed one process** (thousands of viewers on a broadcast
moment), the shape changes:
- Cursor state is ephemeral and lossy-tolerant, so a pub/sub bus (Redis, NATS) carrying
  per-room tick deltas between nodes is adequate — you do not need consensus for
  "where is the mouse".
- The tick becomes two-stage: each node aggregates its local members, publishes its
  partial tick, and every node fans the union out to its own members. Bandwidth per node
  becomes O(members_local × total_events), which is why…
- …at that scale you stop broadcasting everyone to everyone: interest management (only
  send cursors within the viewport / nearest N / a sampled subset) is what actually makes
  "10,000 live cursors" tractable. That is a product decision as much as a technical one.
- Presence needs a shared store with TTL heartbeats so a node dying does not leave
  phantom members. The 5s resume grace becomes a TTL on that record.
- The authoritative bits (the target, the scoreboard) need a single owner. Either pin
  them to one node per room, or use a compare-and-set in the shared store — the same
  "resolve by capture time, tie-break by pid" rule works, it just needs an atomic write.

**3. Sticky sessions are required either way.** A resume presents a token that only the
owning node knows about; behind a round-robin LB the resume would land on a node with no
such seat and silently degrade into a fresh join (a duplicate cursor, briefly). Either
route by `roomId` at L7 or move the seat record to the shared store.

**4. What would *not* change:** the wire protocol, the client, the interpolation. They are
already indifferent to how many processes are behind the socket — which is the main
argument for keeping the timeline server-stamped and the client purely a consumer of it.

---

## Time spent

Roughly **a day of focused work across two sessions**. The first session produced the
engine end to end — the RFC 6455 framing layer, the protocol, the server's room/presence/
tick logic, the client sync engine (clock sync, batching, interpolation), the test suite,
the benchmark and this documentation. The second session was the interface: replacing the
first-pass dashboard with the console design, and the review rounds that followed.

## AI tool disclosure

This was built with **Claude Code** (Anthropic's Claude Opus 5) as a pair programmer, and
I want to be specific about the split rather than vague.

**What the AI did.** Wrote the first draft of nearly every file from a brief I gave it;
wrote the tests and the benchmark; drafted this README and ARCHITECTURE.md; ran the app in
a browser with several tabs, throttled the network, killed sockets and inspected the
results; and found and fixed bugs that only showed up by running it. The UI was designed
with the **impeccable** design skill ([skills.sh/pbakaus/impeccable](https://skills.sh/pbakaus/impeccable)),
which drove a structured process: a product brief captured from my answers, a randomised
direction roll that assigned the mission-control concept from a ranked list, a written
direction contract, and four independent review passes that found ten defects in the first
build — including two I would not have caught by reading the code.

**What I did.** Set the constraints and made the calls the AI could not: that no library
does any of the sync; that the interface must serve a reviewer with several windows tiled;
that every existing control stays reachable; that no runtime dependency is added. I chose
the direction from the roll. I read every file that shipped, pushed back where I
disagreed, and reworked what I did not like. I can walk through any line of it and defend
every decision in it — the wire format, the render-in-the-past model, the clean-versus-
abnormal close distinction, the resume-token seat model, the idle-versus-starved
distinction in the status matrix.

**The honest caveat.** A reviewer should assume the AI's share of the keystrokes was very
high. What I am submitting is my judgement about what to build and whether it is correct,
exercised over an AI that types faster than I do — and the assignment is explicit that
this is allowed provided it is disclosed.

Three bugs found by actually running the engine rather than by reading it, worth noting
because they are the interesting ones:

1. **Abnormal closes were being classified as clean.** A TCP reset was mapped to close
   code 1001, which the room treated as a graceful exit — so a dropped connection
   destroyed the seat immediately and the reconnect grace window was dead code. Fixed by
   mapping "socket died with no close frame" to 1006 and keying the decision on that.
2. **The presence list was derived from the render model**, which deliberately skips peers
   with no known cursor — so anyone who joined and didn't move was invisible in the roster
   *and* the headcount. Presence and rendering are different questions and now have
   different sources.
3. **Duplicate display names.** Independently-generated names collide ~1.6% of the time
   per pair; the server is the only party that can see the whole room, so it dedupes.

And two the design review caught in the interface that I had shipped without noticing:
the roster's "freshness" bars were wired to *staleness* and grew as signal died, and the
LINK lamp watched only whether the socket existed, so it sat green while the link was
being throttled — falsifying the one behaviour the console exists to demonstrate.

## Layout

```
├── shared/protocol.ts        # the wire contract — imported verbatim by both sides
├── server/src/
│   ├── server.ts             # http + Upgrade + static files
│   ├── hub.ts                # rooms, tick loop, heartbeat sweep
│   ├── room.ts               # presence, aggregation, conflict resolution
│   ├── protocol.ts           # re-export of shared/
│   └── ws/                   # RFC 6455: framing, handshake, connection lifecycle
├── client/src/
│   ├── net/connection.ts     # raw WebSocket, reconnect, RTT, network emulator
│   ├── net/room.ts           # createRoom(): batching, peer state, timeline
│   ├── net/clock.ts          # server-clock estimation
│   ├── interpolation.ts      # buffering, lerp, bounded extrapolation
│   ├── render.ts             # the plot: graticule, tracked symbols, bursts
│   ├── styles.css            # the console world
│   ├── ui/console.ts         # engine state -> console vocabulary + GO/NO-GO matrix
│   ├── ui/icons.tsx          # authored SVG icon set, one stroke weight
│   ├── ui/TopRail.tsx        # designation, mission clock, status matrix
│   ├── ui/Roster.tsx         # stations on console + plot key
│   ├── ui/SwitchBank.tsx     # the switch bank, grouped by subsystem
│   └── App.tsx               # the demo
├── tests/                    # 39 tests incl. end-to-end multi-client
└── scripts/bench.ts          # the bandwidth numbers above
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the layering, the data flow end to end, and
how to add a new action type without touching transport code.
