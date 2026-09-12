/**
 * The sync engine's public surface — the object the demo app actually talks to.
 *
 *   const room = createRoom({ roomId: 'watch-party-42', clientId });
 *   room.sendAction({ type: 'cursor', x, y });
 *   room.onRemoteAction((clientId, action) => { ... });
 *
 * It sits between the transport (which knows sockets but not cursors) and the renderer
 * (which knows pixels but not sockets), and owns three things:
 *
 *   1. Outbound rate control — turning a 60-120Hz mousemove firehose into ~20 batched
 *      frames per second.
 *   2. Peer state — who is here, and a per-peer interpolation buffer.
 *   3. Timeline — converting server-stamped events into the local render clock.
 *
 * Adding a new action type touches this file's dispatch and the protocol, and nothing
 * in `connection.ts` or `frame.ts`. That is the layering test.
 */
import { CLIENT_SAMPLE_HZ, COORD_SCALE, TICK_MS } from '../protocol.js';
import type { PeerInfo, ServerMessage, TargetState } from '../protocol.js';
import { Connection } from './connection.js';
import type { ConnectionStatus, NetworkEmulation } from './connection.js';
import { CursorTrack, computeInterpolationDelay } from '../interpolation.js';
import type { SampledPosition } from '../interpolation.js';

// -- Public action types -----------------------------------------------------

export interface CursorAction {
  type: 'cursor';
  /** Normalized [0,1], relative to the shared surface. */
  x: number;
  y: number;
}

export interface ReactionAction {
  type: 'reaction';
  x: number;
  y: number;
  /** Index into REACTIONS. */
  kind: number;
}

export interface CounterAction {
  type: 'counter';
  delta: 1 | -1;
}

export type LocalAction = CursorAction | ReactionAction | CounterAction;

export interface CounterState {
  value: number;
  /** Pid of whoever last changed it, or null before anyone has. */
  by: number | null;
}

export type RemoteAction =
  | (CursorAction & { t: number })
  | (ReactionAction & { t: number });

// -- Peer state --------------------------------------------------------------

export interface Peer extends PeerInfo {
  track: CursorTrack;
  /** Set false while the peer sits in the server's reconnect grace window. */
  online: boolean;
}

/** What the renderer needs, per peer, for one frame. */
export interface PeerFrame {
  pid: number;
  clientId: string;
  name: string;
  hue: number;
  online: boolean;
  position: SampledPosition;
  /**
   * Where this peer's recent samples actually landed, oldest first. The plot draws these
   * behind the interpolated symbol, which is what makes the difference between a raw
   * sample and a reconstructed position visible rather than merely claimed.
   */
  trail: { x: number; y: number }[];
  /** ms since the last update from this peer actually landed. */
  staleness: number;
  arrivalJitterMs: number;
  bufferedMs: number;
}

export interface RoomStats {
  status: ConnectionStatus;
  statusDetail: string;
  rttMs: number;
  jitterMs: number;
  clockOffsetReady: boolean;
  interpolationDelayMs: number;
  sampleHz: number;
  flushHz: number;
  peers: number;
  online: number;
  bytesIn: number;
  bytesOut: number;
  messagesIn: number;
  messagesOut: number;
  rejected: number;
  droppedByEmulator: number;
  reconnects: number;
}

export interface RoomOptions {
  roomId: string;
  clientId: string;
  name?: string;
  url?: string;
  /** Override the automatic interpolation delay. Undefined = adaptive. */
  interpolationDelayMs?: number;
}

type Unsubscribe = () => void;

/** History marks drawn behind each tracked symbol. Small on purpose: this is a plot, not a comet. */
const TRAIL_SAMPLES = 6;

export class Room {
  private readonly connection: Connection;
  private readonly peers = new Map<number, Peer>();
  private self: PeerInfo | null = null;
  private target: TargetState | null = null;
  private counter: CounterState = { value: 0, by: null };

  private status: ConnectionStatus = 'connecting';
  private statusDetail = '';

  // Outbound cursor batching.
  private pending: { t: number; x: number; y: number }[] = [];
  private lastCaptureAt = 0;
  private lastSentX = -1;
  private lastSentY = -1;
  private seq = 0;
  private flushTimer: number | null = null;
  private sampleIntervalMs = 1000 / CLIENT_SAMPLE_HZ;
  private flushIntervalMs = TICK_MS;

  /** Manual override for the interpolation delay; null = adaptive. */
  private delayOverride: number | null = null;
  private smoothedDelay = TICK_MS * 1.5;

  private readonly actionListeners = new Set<(clientId: string, action: RemoteAction) => void>();
  private readonly presenceListeners = new Set<() => void>();
  private readonly targetListeners = new Set<(target: TargetState, lost: number[]) => void>();
  private readonly counterListeners = new Set<(state: CounterState) => void>();

  constructor(options: RoomOptions) {
    this.delayOverride = options.interpolationDelayMs ?? null;
    this.connection = new Connection({
      url: options.url ?? defaultServerUrl(),
      roomId: options.roomId,
      clientId: options.clientId,
      name: options.name ?? 'anon',
      onMessage: (msg) => this.handleMessage(msg),
      onStatus: (status, detail) => {
        this.status = status;
        this.statusDetail = detail;
        if (status !== 'open') this.stopFlushing();
        else this.startFlushing();
        this.emitPresence();
      },
      onProtocolError: (error) => console.warn('[sync] rejected server frame:', error),
    });
    this.connection.connect();
  }

  // -- Outbound --------------------------------------------------------------

  /**
   * The single entry point for local input.
   *
   * Cursor moves are *sampled*, not sent: pointermove fires up to 120 times a second and
   * a human cannot perceive the difference between 120Hz and 30Hz of cursor data once it
   * has been through a network and an interpolator. We keep at most `sampleIntervalMs`
   * resolution, skip samples that did not move, and flush a batch on the server's tick
   * cadence — one WebSocket frame carrying 1-2 samples instead of 2-6 frames.
   *
   * Reactions are discrete and rare, so they go out immediately: adding 50ms of batching
   * delay to a tap is a worse trade than the bandwidth it saves.
   */
  sendAction(action: LocalAction): void {
    if (action.type === 'counter') {
      // Optimistic: bump locally so the click feels instant, then send the *intent*. The
      // server's counterState replaces this value rather than adding to it, which is the
      // reconciliation — if someone else clicked in the same instant, the correction from
      // +1 to +2 is the server telling the truth.
      this.counter = { value: this.counter.value + action.delta, by: this.self?.pid ?? null };
      this.emitCounter();
      this.connection.send({ t: 'counter', seq: ++this.seq, delta: action.delta });
      return;
    }
    if (action.type === 'reaction') {
      this.connection.send({
        t: 'react',
        seq: ++this.seq,
        dt: 0,
        x: toWire(action.x),
        y: toWire(action.y),
        k: action.kind,
      });
      return;
    }

    const now = Date.now();
    if (now - this.lastCaptureAt < this.sampleIntervalMs) return;

    const x = toWire(action.x);
    const y = toWire(action.y);
    // Quantization does double duty: it cuts bytes, and it makes "did this move?" a
    // cheap integer comparison, so a resting cursor sends nothing at all.
    if (x === this.lastSentX && y === this.lastSentY) return;

    this.lastCaptureAt = now;
    this.lastSentX = x;
    this.lastSentY = y;
    this.pending.push({ t: now, x, y });
    // Bounded: if the socket is down we keep only the freshest few positions.
    if (this.pending.length > 8) this.pending.splice(0, this.pending.length - 8);
  }

  private startFlushing(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setInterval(() => this.flush(), this.flushIntervalMs);
  }

  private stopFlushing(): void {
    if (this.flushTimer !== null) window.clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  private flush(): void {
    this.adaptRates();
    if (this.pending.length === 0) return;
    const now = Date.now();
    // `dt` = how long ago each sample was captured. Relative, so the server never has to
    // trust our wall clock — it only trusts our stopwatch.
    const samples = this.pending.map(
      (s) => [Math.max(0, now - s.t), s.x, s.y] as [number, number, number],
    );
    this.pending.length = 0;
    this.connection.send({ t: 'in', seq: ++this.seq, s: samples });
  }

  /**
   * Adaptive throttling (bonus): the worse the round trip, the less point there is in
   * sending fine-grained samples — they will be smoothed into a longer interpolation
   * window anyway, and the extra frames only add queueing delay on a congested link.
   */
  private adaptRates(): void {
    const rtt = this.connection.clock.rtt;
    let sampleHz: number;
    let flushMs: number;
    if (rtt < 60) {
      sampleHz = 30;
      flushMs = TICK_MS;
    } else if (rtt < 150) {
      sampleHz = 24;
      flushMs = TICK_MS * 1.4;
    } else {
      sampleHz = 15;
      flushMs = TICK_MS * 2;
    }
    this.sampleIntervalMs = 1000 / sampleHz;
    if (Math.abs(flushMs - this.flushIntervalMs) > 1) {
      this.flushIntervalMs = flushMs;
      if (this.flushTimer !== null) {
        this.stopFlushing();
        this.startFlushing();
      }
    }
  }

  // -- Inbound ---------------------------------------------------------------

  private handleMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome': {
        this.self = msg.you;
        // Reuse existing tracks on a resume so peers who never left don't visibly reset.
        const previous = new Map(this.peers);
        this.peers.clear();
        for (const snapshot of msg.peers) {
          const existing = previous.get(snapshot.pid);
          const peer: Peer = {
            pid: snapshot.pid,
            clientId: snapshot.clientId,
            name: snapshot.name,
            hue: snapshot.hue,
            online: snapshot.online,
            track: existing?.clientId === snapshot.clientId ? existing.track : new CursorTrack(),
          };
          // The snapshot cursor is what makes a mid-session join feel instant: every
          // peer is drawn at their last known position on the very first frame.
          if (snapshot.cursor) {
            peer.track.push({
              t: snapshot.cursor.st,
              x: fromWire(snapshot.cursor.x),
              y: fromWire(snapshot.cursor.y),
            });
          }
          this.peers.set(peer.pid, peer);
        }
        this.target = msg.target;
        this.counter = { value: msg.counter, by: null };
        this.emitCounter();
        this.emitPresence();
        return;
      }

      case 'join': {
        const peer: Peer = {
          pid: msg.peer.pid,
          clientId: msg.peer.clientId,
          name: msg.peer.name,
          hue: msg.peer.hue,
          online: msg.peer.online,
          track: new CursorTrack(),
        };
        if (msg.peer.cursor) {
          peer.track.push({
            t: msg.peer.cursor.st,
            x: fromWire(msg.peer.cursor.x),
            y: fromWire(msg.peer.cursor.y),
          });
        }
        this.peers.set(peer.pid, peer);
        this.emitPresence();
        return;
      }

      case 'leave':
        this.peers.delete(msg.pid);
        this.emitPresence();
        return;

      case 'pres': {
        const peer = this.peers.get(msg.pid);
        if (!peer) return;
        peer.online = msg.online;
        this.emitPresence();
        return;
      }

      case 'k': {
        const arrivedAt = performance.now();
        if (msg.c) {
          for (const [pid, x, y, age] of msg.c) {
            const peer = this.peers.get(pid);
            if (!peer) continue; // event for a peer we haven't been told about yet
            // Reconstruct capture time on the shared (server) timeline.
            peer.track.push({ t: msg.st - age, x: fromWire(x), y: fromWire(y) }, arrivedAt);
            this.emitAction(peer, { type: 'cursor', x: fromWire(x), y: fromWire(y), t: msg.st - age });
          }
        }
        if (msg.r) {
          for (const [pid, x, y, kind, age] of msg.r) {
            const peer = this.peers.get(pid);
            if (!peer) continue;
            this.emitAction(peer, {
              type: 'reaction',
              x: fromWire(x),
              y: fromWire(y),
              kind,
              t: msg.st - age,
            });
          }
        }
        return;
      }

      case 'target':
        this.target = msg.target;
        for (const listener of this.targetListeners) listener(msg.target, msg.lost ?? []);
        this.emitPresence();
        return;

      case 'counterState':
        this.counter = { value: msg.value, by: msg.by };
        this.emitCounter();
        return;

      case 'err':
        console.warn(`[sync] server error (${msg.code}): ${msg.msg}`);
        return;

      case 'pong':
        return; // consumed by the transport's clock
    }
  }

  private emitAction(peer: Peer, action: RemoteAction): void {
    for (const listener of this.actionListeners) listener(peer.clientId, action);
  }

  private emitPresence(): void {
    for (const listener of this.presenceListeners) listener();
  }

  private emitCounter(): void {
    for (const listener of this.counterListeners) listener(this.counter);
  }

  // -- Subscriptions ---------------------------------------------------------

  onRemoteAction(listener: (clientId: string, action: RemoteAction) => void): Unsubscribe {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  onPresenceChange(listener: () => void): Unsubscribe {
    this.presenceListeners.add(listener);
    return () => this.presenceListeners.delete(listener);
  }

  onTargetChange(listener: (target: TargetState, lost: number[]) => void): Unsubscribe {
    this.targetListeners.add(listener);
    return () => this.targetListeners.delete(listener);
  }

  onCounterChange(listener: (state: CounterState) => void): Unsubscribe {
    this.counterListeners.add(listener);
    return () => this.counterListeners.delete(listener);
  }

  // -- Read models used by rendering ----------------------------------------

  /** Server time we are currently rendering, i.e. `serverNow() - interpolationDelay`. */
  renderTime(): number {
    return this.connection.clock.serverNow() - this.interpolationDelayMs;
  }

  get interpolationDelayMs(): number {
    if (this.delayOverride !== null) return this.delayOverride;
    const target = computeInterpolationDelay({
      tickMs: TICK_MS,
      jitterMs: Math.max(this.connection.clock.jitter, this.worstPeerJitter()),
    });
    // Ease, so an adaptive delay never steps the render clock and snaps every cursor.
    this.smoothedDelay += (target - this.smoothedDelay) * 0.05;
    return this.smoothedDelay;
  }

  setInterpolationDelay(ms: number | null): void {
    this.delayOverride = ms;
  }

  private worstPeerJitter(): number {
    let worst = 0;
    for (const peer of this.peers.values()) {
      if (peer.track.arrivalJitterMs > worst) worst = peer.track.arrivalJitterMs;
    }
    return worst;
  }

  /**
   * One frame's worth of interpolated peer state.
   *
   * Every member is returned, including one who has joined but never moved — their
   * position comes back with mode 'empty'. Presence and rendering are different
   * questions: the roster must list someone with no cursor yet, while the canvas has
   * nothing to draw for them and skips them.
   */
  frameAt(renderTime: number, allowExtrapolation = true): PeerFrame[] {
    const out: PeerFrame[] = [];
    for (const peer of this.peers.values()) {
      const position = peer.track.sampleAt(renderTime, allowExtrapolation);
      out.push({
        pid: peer.pid,
        clientId: peer.clientId,
        name: peer.name,
        hue: peer.hue,
        online: peer.online,
        position,
        trail: peer.track.recent(TRAIL_SAMPLES),
        staleness: peer.track.msSinceLastArrival,
        arrivalJitterMs: peer.track.arrivalJitterMs,
        bufferedMs: peer.track.bufferedMs(renderTime),
      });
    }
    return out;
  }

  getSelf(): PeerInfo | null {
    return this.self;
  }

  getTarget(): TargetState | null {
    return this.target;
  }

  getCounter(): CounterState {
    return this.counter;
  }

  getPeers(): Peer[] {
    return [...this.peers.values()];
  }

  stats(): RoomStats {
    const c = this.connection.counters;
    return {
      status: this.status,
      statusDetail: this.statusDetail,
      rttMs: this.connection.clock.rtt,
      jitterMs: this.connection.clock.jitter,
      clockOffsetReady: this.connection.clock.ready,
      interpolationDelayMs: this.interpolationDelayMs,
      sampleHz: Math.round(1000 / this.sampleIntervalMs),
      flushHz: Math.round(1000 / this.flushIntervalMs),
      peers: this.peers.size,
      online: [...this.peers.values()].filter((p) => p.online).length + (this.self ? 1 : 0),
      bytesIn: c.bytesIn,
      bytesOut: c.bytesOut,
      messagesIn: c.messagesIn,
      messagesOut: c.messagesOut,
      rejected: c.rejected,
      droppedByEmulator: c.droppedByEmulator,
      reconnects: c.reconnects,
    };
  }

  // -- Demo controls ---------------------------------------------------------

  setNetworkEmulation(next: Partial<NetworkEmulation>): void {
    this.connection.setNetworkEmulation(next);
  }

  getNetworkEmulation(): NetworkEmulation {
    return this.connection.getNetworkEmulation();
  }

  simulateDrop(): void {
    this.connection.simulateDrop();
  }

  leave(): void {
    this.stopFlushing();
    this.connection.dispose();
  }
}

export const createRoom = (options: RoomOptions): Room => new Room(options);

// -- Helpers -----------------------------------------------------------------

const toWire = (v: number): number =>
  Math.max(0, Math.min(COORD_SCALE, Math.round(v * COORD_SCALE)));

const fromWire = (v: number): number => v / COORD_SCALE;

/**
 * Where to connect. Same origin in production (the server serves the built client);
 * an explicit port in dev, because Vite is on 5173 and the sync server is on 8787.
 */
export function defaultServerUrl(): string {
  const override = import.meta.env?.VITE_SYNC_URL;
  if (override) return override;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const isViteDev = location.port === '5173';
  const host = isViteDev ? `${location.hostname}:8787` : location.host;
  return `${proto}//${host}/ws`;
}
