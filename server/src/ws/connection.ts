/**
 * A single upgraded socket, wrapped in something the application layer can hold.
 *
 * Responsibilities, and nothing else: framing in/out, the close handshake, control-frame
 * ping/pong bookkeeping, and backpressure. It knows nothing about rooms, cursors, or the
 * message schema — `onText` hands raw strings up and that is the entire seam.
 */
import type { Socket } from 'node:net';
import {
  CLOSE,
  FrameDecoder,
  WsProtocolError,
  encodeClose,
  encodePing,
  encodePong,
  encodeText,
} from './frame.js';

let nextConnectionId = 1;

export interface WsConnectionOptions {
  maxMessageBytes: number;
  /**
   * Outbound bytes allowed to sit in the kernel/stream buffer before we start dropping
   * droppable frames for this connection. A slow client must not become everyone's problem.
   */
  highWaterMark: number;
}

export class WsConnection {
  readonly id = nextConnectionId++;
  readonly remote: string;

  /** Set by the application layer; used only for logging. */
  label = '';

  onText: ((data: string) => void) | null = null;
  onClose: ((code: number, reason: string) => void) | null = null;

  /** Last time we saw *any* evidence of life: a frame, a pong, anything. */
  lastSeenAt = Date.now();
  /** Frames dropped because this socket was too far behind. */
  droppedFrames = 0;

  private readonly decoder: FrameDecoder;
  private closing = false;
  private closed = false;
  private closeTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly socket: Socket,
    private readonly opts: WsConnectionOptions,
  ) {
    this.remote = describeRemote(socket);
    this.decoder = new FrameDecoder({
      maxMessageBytes: opts.maxMessageBytes,
      requireMask: true,
    });

    socket.setNoDelay(true);
    socket.on('data', (chunk: Buffer) => this.handleData(chunk));
    // All three of these mean the same thing: the socket went away without a close
    // frame. That is ABNORMAL (1006), *not* a graceful close, and the distinction is
    // load-bearing — Room uses it to decide between dropping a seat immediately and
    // holding it open for a reconnect.
    socket.on('error', () => this.destroy(CLOSE.ABNORMAL, 'socket error'));
    socket.on('close', () => this.destroy(CLOSE.ABNORMAL, 'socket closed'));
    // A half-open TCP connection is what the heartbeat exists to catch, but a proper FIN
    // we should notice immediately.
    socket.on('end', () => this.destroy(CLOSE.ABNORMAL, 'peer ended'));
  }

  get isOpen(): boolean {
    return !this.closed && !this.closing;
  }

  private handleData(chunk: Buffer): void {
    if (this.closed) return;
    this.lastSeenAt = Date.now();
    let frames;
    try {
      frames = this.decoder.push(chunk);
    } catch (error) {
      if (error instanceof WsProtocolError) {
        this.close(error.closeCode, error.message);
      } else {
        this.close(CLOSE.INTERNAL, 'decoder failure');
      }
      return;
    }

    for (const frame of frames) {
      switch (frame.kind) {
        case 'text':
          this.onText?.(frame.data);
          break;
        case 'binary':
          // This protocol is text-only; a binary frame is a client bug, not a hostile act.
          this.close(CLOSE.UNSUPPORTED_DATA, 'binary frames not supported');
          return;
        case 'ping':
          this.writeRaw(encodePong(frame.data), false);
          break;
        case 'pong':
          // lastSeenAt already bumped above; nothing else to do.
          break;
        case 'close':
          this.handlePeerClose(frame.code);
          return;
      }
    }
  }

  private handlePeerClose(code: number): void {
    if (!this.closing) {
      // Peer initiated: echo the close frame back, then tear down.
      this.writeRaw(encodeClose(code === 1005 ? CLOSE.NORMAL : code), false);
    }
    this.destroy(code, 'peer closed');
  }

  /**
   * Send an application text frame.
   * `droppable` marks frames that are safe to lose under backpressure — a tick is
   * droppable (another one is 50ms away), a `welcome` never is.
   */
  send(text: string, droppable = false): boolean {
    if (!this.isOpen) return false;
    if (droppable && this.socket.writableLength > this.opts.highWaterMark) {
      this.droppedFrames++;
      return false;
    }
    return this.writeRaw(encodeText(text), droppable);
  }

  /**
   * Send a frame that was already encoded once for a whole fan-out. This is the
   * difference between N encodes and 1 encode when broadcasting identical bytes to a
   * room, and it is why `Room` builds a shared payload wherever it can.
   */
  sendPrepared(frame: Buffer, droppable = true): boolean {
    if (!this.isOpen) return false;
    if (droppable && this.socket.writableLength > this.opts.highWaterMark) {
      this.droppedFrames++;
      return false;
    }
    return this.writeRaw(frame, droppable);
  }

  ping(): void {
    if (!this.isOpen) return;
    this.writeRaw(encodePing(), true);
  }

  /** Graceful close: send the close frame, then give the peer a moment to answer. */
  close(code: number, reason = ''): void {
    if (this.closing || this.closed) return;
    this.closing = true;
    this.writeRaw(encodeClose(code, reason), false);
    this.socket.end();
    this.closeTimer = setTimeout(() => this.destroy(code, reason), 3_000);
    this.closeTimer.unref?.();
  }

  private writeRaw(buf: Buffer, droppable: boolean): boolean {
    if (this.closed) return false;
    try {
      const flushed = this.socket.write(buf);
      if (!flushed && droppable) this.droppedFrames++;
      return flushed;
    } catch {
      this.destroy(CLOSE.ABNORMAL, 'write failed');
      return false;
    }
  }

  private destroy(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.socket.destroy();
    // Fire exactly once, and after `closed` is set, so handlers can't re-enter.
    this.onClose?.(code, reason);
    this.onText = null;
    this.onClose = null;
  }
}

function describeRemote(socket: Socket): string {
  if (!socket.remoteAddress) return 'unknown';
  return `${socket.remoteAddress}:${socket.remotePort ?? 0}`;
}
