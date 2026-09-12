/**
 * Wire protocol — the single source of truth for everything that crosses the socket.
 *
 * This file is shared verbatim by the client and the server. Neither side is allowed
 * to put a field on the wire that is not described here, and every inbound frame goes
 * through the validators at the bottom before any other code sees it.
 *
 * Design notes (the "why", see ARCHITECTURE.md for the long version):
 *
 *  - Text JSON, not binary. Readable in devtools, trivially versionable. The hot path
 *    (cursor motion) is kept small with three tricks instead of a binary codec:
 *      1. Peer ids. Inside a room every member gets a small integer `pid`. Ticks carry
 *         pids, not 20-char client ids. The pid -> clientId mapping is sent once, in
 *         presence messages.
 *      2. Quantized, normalized coordinates. Positions are integers in [0, COORD_SCALE]
 *         relative to the canvas, so they survive different window sizes and cost ~4
 *         characters instead of a float's ~18.
 *      3. Tuples, not objects, for repeated samples. `[dt, x, y]` instead of
 *         `{"dt":..,"x":..,"y":..}` removes ~15 bytes per sample.
 *    A cursor sample is ~14 bytes on the wire. See PROTOCOL section of README.md.
 *
 *  - Timestamps. Client and server clocks disagree, so no client timestamp is ever
 *    trusted as an absolute. Clients send `dt` — "this sample was captured N ms before
 *    I sent this frame" — a *relative* number produced by one clock. The server turns
 *    it into an absolute server-clock time on arrival. Everything the server emits is
 *    therefore in server time, and each client maps server time onto its own clock with
 *    the offset it estimates from ping/pong. See client/src/net/clock.ts.
 */

export const PROTOCOL_VERSION = 1;

/** Cursor coordinates travel as integers in [0, COORD_SCALE], normalized to the canvas. */
export const COORD_SCALE = 10_000;

/** Server broadcast cadence. One aggregated tick per interval, per room. */
export const TICK_MS = 50;

/** Client cursor sampling ceiling. Mouse events fire far faster than this; we don't care. */
export const CLIENT_SAMPLE_HZ = 30;

/** Hard cap on cursor samples one client may have in a single tick. Oldest are dropped. */
export const MAX_SAMPLES_PER_TICK = 4;

/** Application-level RTT probe interval. */
export const PING_INTERVAL_MS = 2_000;

/** WebSocket control-frame ping interval and liveness deadline (server -> client). */
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_TIMEOUT_MS = 25_000;

/**
 * How long a member's presence entry survives an *unclean* disconnect, so that a
 * reconnect resumes the same seat instead of creating a second cursor. A clean close
 * (tab closed, `bye` sent) skips the grace period entirely.
 */
export const RESUME_GRACE_MS = 5_000;

/** Any frame larger than this is a protocol violation; the connection is closed. */
export const MAX_FRAME_BYTES = 64 * 1024;

/** A sample claiming to be older than this is clamped — defends the timeline from bad clocks. */
export const MAX_SAMPLE_AGE_MS = 1_000;

/** Reactions travel as an index into this table, not as a unicode string. */
export const REACTIONS = ['🔥', '👏', '😂', '😮', '💜', '⚽'] as const;
export type ReactionKind = number;
export const isReactionKind = (k: unknown): k is ReactionKind =>
  typeof k === 'number' && Number.isInteger(k) && k >= 0 && k < REACTIONS.length;

/** Server-owned "tap target" used to demo conflict resolution between simultaneous taps. */
export const TARGET_RADIUS = 620; // in COORD_SCALE units
export const TARGET_HOLD_MS = 2_500;

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** A peer id: small integer, unique within a room for the lifetime of that membership. */
export type Pid = number;

export interface PeerInfo {
  pid: Pid;
  clientId: string;
  name: string;
  /** Hue in degrees; both sides derive the actual colors so the palette stays consistent. */
  hue: number;
  /** False while a member is inside the reconnect grace window. */
  online: boolean;
}

/** A cursor position with the server time at which it was captured. */
export interface PeerCursor {
  x: number;
  y: number;
  /** Server-clock ms. */
  st: number;
}

export interface PeerSnapshot extends PeerInfo {
  cursor: PeerCursor | null;
}

export interface TargetState {
  x: number;
  y: number;
  /** Whoever won the target most recently, or null. */
  heldBy: Pid | null;
  /** Server time until which the target is on cooldown and cannot be claimed. */
  until: number;
  /** Monotonic generation; bumped every time the target moves or changes hands. */
  gen: number;
  /** `[pid, wins]` — server-authoritative, so late joiners see the real scoreboard. */
  scores: [Pid, number][];
}

/** `[dt, x, y]` — dt is ms *before the containing frame was sent*. */
export type CursorSampleTuple = [dt: number, x: number, y: number];

/** `[pid, x, y, age]` — age is ms before the containing tick's `st`. */
export type TickCursorTuple = [pid: Pid, x: number, y: number, age: number];

/** `[pid, x, y, kind, age]` */
export type TickReactionTuple = [pid: Pid, x: number, y: number, kind: ReactionKind, age: number];

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

/** First frame on every connection. `token` present means "I am resuming this seat". */
export interface HelloMsg {
  t: 'hello';
  v: number;
  roomId: string;
  clientId: string;
  name: string;
  token?: string;
}

/** A batch of cursor samples. `seq` is per-connection and monotonic. */
export interface InputMsg {
  t: 'in';
  seq: number;
  s: CursorSampleTuple[];
}

export interface ReactMsg {
  t: 'react';
  seq: number;
  dt: number;
  x: number;
  y: number;
  k: ReactionKind;
}

export interface PingMsg {
  t: 'ping';
  /** Echoed back untouched. */
  id: number;
  /** Client clock, echoed back untouched — the client alone interprets it. */
  ct: number;
}

/**
 * A change to the shared tally. This is an *intent* ("add this"), never a value ("it is
 * now 5"): the server owns the number and applies intents in arrival order, so two
 * simultaneous clicks both count and nobody's write is lost. No CRDT is needed because
 * there is exactly one place the truth lives.
 */
export interface CounterMsg {
  t: 'counter';
  seq: number;
  delta: 1 | -1;
}

/** Voluntary leave. Lets the server skip the reconnect grace window. */
export interface ByeMsg {
  t: 'bye';
}

export type ClientMessage = HelloMsg | InputMsg | ReactMsg | CounterMsg | PingMsg | ByeMsg;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface WelcomeMsg {
  t: 'welcome';
  v: number;
  /** Server clock at send time. Seeds the client's clock estimate. */
  st: number;
  tick: number;
  /** Opaque; presented on reconnect to resume the same seat. */
  token: string;
  you: PeerInfo;
  /** True when this connection took over an existing seat rather than creating one. */
  resumed: boolean;
  /** Full room state — this is how a joiner sees existing cursors immediately. */
  peers: PeerSnapshot[];
  target: TargetState;
  /** The shared tally, so a late joiner never starts from zero. */
  counter: number;
}

export interface JoinMsg {
  t: 'join';
  st: number;
  peer: PeerSnapshot;
}

export interface LeaveMsg {
  t: 'leave';
  st: number;
  pid: Pid;
  reason: 'bye' | 'closed' | 'timeout' | 'replaced' | 'error';
}

/** Online/offline transition inside the reconnect grace window. */
export interface PresenceMsg {
  t: 'pres';
  st: number;
  pid: Pid;
  online: boolean;
}

/** The aggregated broadcast. Omits the recipient's own events. */
export interface TickMsg {
  t: 'k';
  /** Server clock at tick build time. All `age` fields are relative to this. */
  st: number;
  /** Per-connection monotonic tick counter; lets a client detect gaps. */
  seq: number;
  c?: TickCursorTuple[];
  r?: TickReactionTuple[];
}

export interface PongMsg {
  t: 'pong';
  id: number;
  /** The client's own `ct`, echoed. */
  ct: number;
  /** Server clock at reply time. */
  st: number;
}

export interface TargetMsg {
  t: 'target';
  st: number;
  target: TargetState;
  /** Set when this update was caused by a contested tap; lists the taps that lost. */
  lost?: Pid[];
}

/**
 * The authoritative tally after a change. Sent to everyone *including* the sender: unlike
 * a cursor echo (useless — you already drew it), this echo is the confirmation that the
 * sender's optimistic increment was right, or the correction when it was not.
 */
export interface CounterStateMsg {
  t: 'counterState';
  st: number;
  value: number;
  /** Who caused the change. */
  by: Pid;
}

export interface ErrorMsg {
  t: 'err';
  code: 'bad_message' | 'bad_version' | 'rate_limit' | 'room_full' | 'internal';
  msg: string;
  /** True when the server is about to close the connection. */
  fatal: boolean;
}

export type ServerMessage =
  | WelcomeMsg
  | JoinMsg
  | LeaveMsg
  | PresenceMsg
  | TickMsg
  | PongMsg
  | TargetMsg
  | CounterStateMsg
  | ErrorMsg;

// ---------------------------------------------------------------------------
// Validation
//
// Hand-rolled rather than pulled from a schema library: the whole point of the
// exercise is that nothing untrusted reaches application code unchecked, and these
// validators are the boundary. They are total — they never throw, they return a
// Result — because the caller is a socket handler that must not die on bad input.
// ---------------------------------------------------------------------------

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = (error: string): Result<never> => ({ ok: false, error });

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Coordinates are clamped rather than rejected: a stray pixel is not worth a disconnect. */
const coord = (v: unknown): number | null => {
  if (!isFiniteNum(v)) return null;
  return Math.min(COORD_SCALE, Math.max(0, Math.round(v)));
};

const age = (v: unknown): number | null => {
  if (!isFiniteNum(v)) return null;
  return Math.min(MAX_SAMPLE_AGE_MS, Math.max(0, Math.round(v)));
};

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

const seqOf = (v: unknown): number | null =>
  isFiniteNum(v) && Number.isInteger(v) && v >= 0 ? v : null;

export function parseClientMessage(raw: unknown): Result<ClientMessage> {
  let data: unknown;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return err('not valid JSON');
    }
  } else {
    data = raw;
  }
  if (!isObj(data)) return err('frame is not an object');

  switch (data.t) {
    case 'hello': {
      if (!isFiniteNum(data.v)) return err('hello.v missing');
      const roomId = str(data.roomId, 64);
      const clientId = str(data.clientId, 64);
      if (!roomId) return err('hello.roomId invalid');
      if (!clientId) return err('hello.clientId invalid');
      const name = str(data.name, 24) ?? 'anon';
      const token = data.token === undefined ? undefined : str(data.token, 128) ?? undefined;
      return ok({ t: 'hello', v: data.v, roomId, clientId, name, token });
    }
    case 'in': {
      const seq = seqOf(data.seq);
      if (seq === null) return err('in.seq invalid');
      if (!Array.isArray(data.s) || data.s.length === 0) return err('in.s empty');
      if (data.s.length > 64) return err('in.s too long');
      const samples: CursorSampleTuple[] = [];
      for (const entry of data.s) {
        if (!Array.isArray(entry) || entry.length !== 3) return err('in.s tuple malformed');
        const dt = age(entry[0]);
        const x = coord(entry[1]);
        const y = coord(entry[2]);
        if (dt === null || x === null || y === null) return err('in.s tuple values invalid');
        samples.push([dt, x, y]);
      }
      return ok({ t: 'in', seq, s: samples });
    }
    case 'react': {
      const seq = seqOf(data.seq);
      const dt = age(data.dt);
      const x = coord(data.x);
      const y = coord(data.y);
      if (seq === null) return err('react.seq invalid');
      if (dt === null || x === null || y === null) return err('react position invalid');
      if (!isReactionKind(data.k)) return err('react.k unknown');
      return ok({ t: 'react', seq, dt, x, y, k: data.k });
    }
    case 'counter': {
      const seq = seqOf(data.seq);
      if (seq === null) return err('counter.seq invalid');
      // Exactly +1 or -1. A client cannot send delta: 1000000, and a non-integer is not a click.
      if (data.delta !== 1 && data.delta !== -1) return err('counter.delta must be 1 or -1');
      return ok({ t: 'counter', seq, delta: data.delta });
    }
    case 'ping': {
      if (!isFiniteNum(data.id) || !isFiniteNum(data.ct)) return err('ping fields invalid');
      return ok({ t: 'ping', id: data.id, ct: data.ct });
    }
    case 'bye':
      return ok({ t: 'bye' });
    default:
      return err(`unknown message type ${JSON.stringify(data.t)}`);
  }
}

/**
 * The client validates too. A client that trusts the server blindly is one XSS or one
 * bad deploy away from a crash loop, and the failure mode we want is "drop the frame,
 * keep rendering", not "white screen".
 */
export function parseServerMessage(raw: unknown): Result<ServerMessage> {
  let data: unknown;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return err('not valid JSON');
    }
  } else {
    data = raw;
  }
  if (!isObj(data)) return err('frame is not an object');
  if (!isFiniteNum(data.st) && data.t !== 'err') return err('missing server timestamp');

  switch (data.t) {
    case 'welcome': {
      if (data.v !== PROTOCOL_VERSION) return err(`unsupported protocol version ${String(data.v)}`);
      const you = parsePeerInfo(data.you);
      const token = str(data.token, 128);
      if (!you.ok) return err(`welcome.you: ${you.error}`);
      if (!token) return err('welcome.token invalid');
      if (!Array.isArray(data.peers)) return err('welcome.peers invalid');
      const peers: PeerSnapshot[] = [];
      for (const raw of data.peers) {
        const p = parsePeerSnapshot(raw);
        if (!p.ok) return err(`welcome.peers: ${p.error}`);
        peers.push(p.value);
      }
      const target = parseTarget(data.target);
      if (!target.ok) return err(`welcome.target: ${target.error}`);
      return ok({
        t: 'welcome',
        v: PROTOCOL_VERSION,
        st: data.st as number,
        tick: isFiniteNum(data.tick) ? data.tick : TICK_MS,
        token,
        you: you.value,
        resumed: data.resumed === true,
        peers,
        target: target.value,
        counter: isFiniteNum(data.counter) && Number.isInteger(data.counter) ? data.counter : 0,
      });
    }
    case 'join': {
      const peer = parsePeerSnapshot(data.peer);
      if (!peer.ok) return err(`join.peer: ${peer.error}`);
      return ok({ t: 'join', st: data.st as number, peer: peer.value });
    }
    case 'leave': {
      if (!isFiniteNum(data.pid)) return err('leave.pid invalid');
      const reason = data.reason;
      const known = ['bye', 'closed', 'timeout', 'replaced', 'error'] as const;
      const match = known.find((r) => r === reason) ?? 'closed';
      return ok({ t: 'leave', st: data.st as number, pid: data.pid, reason: match });
    }
    case 'pres': {
      if (!isFiniteNum(data.pid)) return err('pres.pid invalid');
      return ok({ t: 'pres', st: data.st as number, pid: data.pid, online: data.online === true });
    }
    case 'k': {
      const seq = seqOf(data.seq);
      if (seq === null) return err('k.seq invalid');
      const out: TickMsg = { t: 'k', st: data.st as number, seq };
      if (data.c !== undefined) {
        if (!Array.isArray(data.c)) return err('k.c invalid');
        const cursors: TickCursorTuple[] = [];
        for (const entry of data.c) {
          if (!Array.isArray(entry) || entry.length !== 4) return err('k.c tuple malformed');
          const [pid, x, y, a] = entry as unknown[];
          if (!isFiniteNum(pid) || !isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(a))
            return err('k.c tuple values invalid');
          cursors.push([pid, x, y, a]);
        }
        out.c = cursors;
      }
      if (data.r !== undefined) {
        if (!Array.isArray(data.r)) return err('k.r invalid');
        const reactions: TickReactionTuple[] = [];
        for (const entry of data.r) {
          if (!Array.isArray(entry) || entry.length !== 5) return err('k.r tuple malformed');
          const [pid, x, y, k, a] = entry as unknown[];
          if (!isFiniteNum(pid) || !isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(a))
            return err('k.r tuple values invalid');
          if (!isReactionKind(k)) return err('k.r kind unknown');
          reactions.push([pid, x, y, k, a]);
        }
        out.r = reactions;
      }
      return ok(out);
    }
    case 'pong': {
      if (!isFiniteNum(data.id) || !isFiniteNum(data.ct)) return err('pong fields invalid');
      return ok({ t: 'pong', id: data.id, ct: data.ct, st: data.st as number });
    }
    case 'target': {
      const target = parseTarget(data.target);
      if (!target.ok) return err(`target: ${target.error}`);
      const lost = Array.isArray(data.lost) ? data.lost.filter(isFiniteNum) : undefined;
      return ok({ t: 'target', st: data.st as number, target: target.value, lost });
    }
    case 'counterState': {
      if (!isFiniteNum(data.value) || !Number.isInteger(data.value)) return err('counterState.value invalid');
      if (!isFiniteNum(data.by)) return err('counterState.by invalid');
      return ok({ t: 'counterState', st: data.st as number, value: data.value, by: data.by });
    }
    case 'err': {
      const msg = str(data.msg, 256) ?? 'unknown error';
      const codes = ['bad_message', 'bad_version', 'rate_limit', 'room_full', 'internal'] as const;
      const code = codes.find((c) => c === data.code) ?? 'internal';
      return ok({ t: 'err', code, msg, fatal: data.fatal === true });
    }
    default:
      return err(`unknown message type ${JSON.stringify(data.t)}`);
  }
}

function parsePeerInfo(raw: unknown): Result<PeerInfo> {
  if (!isObj(raw)) return err('not an object');
  const clientId = str(raw.clientId, 64);
  const name = str(raw.name, 24);
  if (!isFiniteNum(raw.pid)) return err('pid invalid');
  if (!clientId) return err('clientId invalid');
  if (!isFiniteNum(raw.hue)) return err('hue invalid');
  return ok({
    pid: raw.pid,
    clientId,
    name: name ?? 'anon',
    hue: raw.hue,
    online: raw.online !== false,
  });
}

function parsePeerSnapshot(raw: unknown): Result<PeerSnapshot> {
  const info = parsePeerInfo(raw);
  if (!info.ok) return info;
  const source = raw as Record<string, unknown>;
  let cursor: PeerCursor | null = null;
  if (isObj(source.cursor)) {
    const x = coord(source.cursor.x);
    const y = coord(source.cursor.y);
    const st = source.cursor.st;
    if (x !== null && y !== null && isFiniteNum(st)) cursor = { x, y, st };
  }
  return ok({ ...info.value, cursor });
}

function parseTarget(raw: unknown): Result<TargetState> {
  if (!isObj(raw)) return err('not an object');
  const x = coord(raw.x);
  const y = coord(raw.y);
  if (x === null || y === null) return err('position invalid');
  if (!isFiniteNum(raw.until) || !isFiniteNum(raw.gen)) return err('hold fields invalid');
  const scores: [Pid, number][] = [];
  if (Array.isArray(raw.scores)) {
    for (const entry of raw.scores) {
      if (!Array.isArray(entry) || entry.length !== 2) return err('scores tuple malformed');
      if (!isFiniteNum(entry[0]) || !isFiniteNum(entry[1])) return err('scores values invalid');
      scores.push([entry[0], entry[1]]);
    }
  }
  return ok({
    x,
    y,
    heldBy: isFiniteNum(raw.heldBy) ? raw.heldBy : null,
    until: raw.until,
    gen: raw.gen,
    scores,
  });
}

/** Typed serialization helper — keeps `JSON.stringify(anything)` out of the codebase. */
export const encodeServerMessage = (msg: ServerMessage): string => JSON.stringify(msg);
export const encodeClientMessage = (msg: ClientMessage): string => JSON.stringify(msg);
