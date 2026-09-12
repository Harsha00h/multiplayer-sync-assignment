/**
 * Transport. Raw `WebSocket`, and nothing above it.
 *
 * This module owns: the socket lifecycle, reconnection with backoff, the resume token,
 * RTT probing, and (for demos) an inbound network emulator. It does not know what a
 * cursor is. Everything it emits upward is an already-validated `ServerMessage`.
 */
import {
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  encodeClientMessage,
  parseServerMessage,
} from '../protocol.js';
import type { ClientMessage, ServerMessage } from '../protocol.js';
import { ClockSync } from './clock.js';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface NetworkEmulation {
  /** Extra one-way delay applied to inbound frames, in ms. */
  latencyMs: number;
  /** Uniform random jitter added on top of `latencyMs`. Can reorder frames — on purpose. */
  jitterMs: number;
  /** Probability in [0,1] that an inbound frame is discarded. */
  lossPct: number;
}

export interface ConnectionOptions {
  url: string;
  roomId: string;
  clientId: string;
  name: string;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: ConnectionStatus, detail: string) => void;
  /** Malformed inbound frames — surfaced so the UI can show they were rejected, not fatal. */
  onProtocolError?: (error: string) => void;
}

const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 8_000;

export class Connection {
  readonly clock = new ClockSync();

  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'closed';
  private disposed = false;

  /** Proof that we owned this seat before; lets the server resume it instead of duplicating. */
  private token: string | undefined;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private nextPingId = 1;

  private emulation: NetworkEmulation = { latencyMs: 0, jitterMs: 0, lossPct: 0 };
  /** Timers for frames the emulator is holding, so dispose() can cancel them. */
  private heldFrames = new Set<number>();

  /** Counters for the stats panel. */
  readonly counters = {
    bytesIn: 0,
    bytesOut: 0,
    messagesIn: 0,
    messagesOut: 0,
    rejected: 0,
    droppedByEmulator: 0,
    reconnects: 0,
  };

  constructor(private readonly opts: ConnectionOptions) {}

  connect(): void {
    if (this.disposed || this.ws) return;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting', `attempt ${this.attempt + 1}`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch (error) {
      this.scheduleReconnect(String(error));
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('open', 'connected');
      // The hello is never delayed by the emulator: it is the handshake, not traffic.
      this.rawSend({
        t: 'hello',
        v: PROTOCOL_VERSION,
        roomId: this.opts.roomId,
        clientId: this.opts.clientId,
        name: this.opts.name,
        token: this.token,
      });
      this.startPinging();
    };

    ws.onmessage = (event) => {
      const data = event.data;
      if (typeof data !== 'string') return; // this protocol is text-only
      this.counters.bytesIn += data.length;
      this.deliver(data);
    };

    ws.onerror = () => {
      // `error` is always followed by `close`; let close drive the state machine.
    };

    ws.onclose = (event) => {
      this.stopPinging();
      this.ws = null;
      this.clock.reset();
      if (this.disposed) {
        this.setStatus('closed', 'disposed');
        return;
      }
      // 4001 = the server handed our seat to a newer connection of ours. Reconnecting
      // would start a fight between two tabs of the same client id, so we stay down.
      if (event.code === 4001) {
        this.setStatus('closed', 'replaced by another connection');
        return;
      }
      this.scheduleReconnect(`socket closed (${event.code})`);
    };
  }

  /**
   * Inbound path: emulator -> validator -> application.
   * Note the order — emulated loss happens before validation so the numbers in the
   * stats panel mean what they say.
   */
  private deliver(raw: string): void {
    const { latencyMs, jitterMs, lossPct } = this.emulation;
    if (lossPct > 0 && Math.random() < lossPct) {
      this.counters.droppedByEmulator++;
      return;
    }
    const delay = latencyMs + (jitterMs > 0 ? Math.random() * jitterMs : 0);
    if (delay <= 0) {
      this.accept(raw);
      return;
    }
    // Per-frame delay means frames can overtake each other, which is exactly the
    // out-of-order case the sequence/timestamp filters exist to handle.
    const handle = window.setTimeout(() => {
      this.heldFrames.delete(handle);
      if (!this.disposed) this.accept(raw);
    }, delay);
    this.heldFrames.add(handle);
  }

  private accept(raw: string): void {
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) {
      // A frame we cannot understand is dropped. It never reaches rendering, and it
      // never throws: one bad frame must not take the canvas down.
      this.counters.rejected++;
      this.opts.onProtocolError?.(parsed.error);
      return;
    }
    this.counters.messagesIn++;
    const msg = parsed.value;

    switch (msg.t) {
      case 'welcome':
        this.token = msg.token;
        this.clock.seed(msg.st, Date.now());
        if (msg.resumed) this.counters.reconnects++;
        break;
      case 'pong':
        this.clock.addSample(msg.ct, msg.st, Date.now());
        break;
      default:
        break;
    }
    this.opts.onMessage(msg);
  }

  /** Outbound. Returns false if the socket is not open — callers drop, they don't queue. */
  send(msg: ClientMessage): boolean {
    return this.rawSend(msg);
  }

  private rawSend(msg: ClientMessage): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const payload = encodeClientMessage(msg);
    ws.send(payload);
    this.counters.bytesOut += payload.length;
    this.counters.messagesOut++;
    return true;
  }

  private startPinging(): void {
    this.stopPinging();
    const probe = () => this.rawSend({ t: 'ping', id: this.nextPingId++, ct: Date.now() });
    probe(); // measure immediately; don't make the UI wait two seconds for a number
    this.pingTimer = window.setInterval(probe, PING_INTERVAL_MS);
  }

  private stopPinging(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** Exponential backoff with full jitter, so N tabs reconnecting don't sync up. */
  private scheduleReconnect(reason: string): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempt);
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempt++;
    this.setStatus('reconnecting', `${reason}; retrying in ${Math.round(delay)}ms`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  setNetworkEmulation(next: Partial<NetworkEmulation>): void {
    this.emulation = { ...this.emulation, ...next };
  }

  getNetworkEmulation(): NetworkEmulation {
    return { ...this.emulation };
  }

  /** Force a disconnect without tearing the room down — the "pull the cable" demo button. */
  simulateDrop(): void {
    this.ws?.close(4000, 'simulated drop');
  }

  private setStatus(status: ConnectionStatus, detail: string): void {
    this.status = status;
    this.opts.onStatus(status, detail);
  }

  get currentStatus(): ConnectionStatus {
    return this.status;
  }

  /** Clean shutdown: tell the server we meant it, so it skips the reconnect grace window. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopPinging();
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    for (const handle of this.heldFrames) window.clearTimeout(handle);
    this.heldFrames.clear();
    if (this.ws) {
      // A socket still in CONNECTING must be closed too, or it opens after we are gone
      // and joins the room as a ghost. (React StrictMode's double-mount hits this.)
      if (this.ws.readyState === WebSocket.OPEN) this.rawSend({ t: 'bye' });
      this.ws.close(1000, 'bye');
    }
    this.ws = null;
    this.setStatus('closed', 'disposed');
  }
}
