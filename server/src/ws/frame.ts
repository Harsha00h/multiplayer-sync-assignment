/**
 * RFC 6455 framing — encode/decode, written by hand because the assignment is about
 * knowing what the socket libraries do for you.
 *
 * The decoder is incremental: TCP hands us arbitrary chunks, so a frame header may be
 * split across two `push()` calls and a single chunk may contain five whole frames.
 * We buffer, parse as much as we can, and keep the remainder.
 */

export const OPCODE = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
} as const;

/** Close codes we actually use. */
export const CLOSE = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED_DATA: 1003,
  POLICY_VIOLATION: 1008,
  /**
   * "Closed abnormally — no close frame was received." Per RFC 6455 this code is
   * local-only: it must never appear *in* a close frame, it is what you record when the
   * socket simply died. It is how we tell "the user closed the tab" (a real close frame)
   * apart from "the network vanished" (this), which is what decides whether a seat is
   * dropped immediately or held open for a reconnect.
   */
  ABNORMAL: 1006,
  TOO_LARGE: 1009,
  INTERNAL: 1011,
  /** Application range: this seat was taken over by a newer connection. */
  REPLACED: 4001,
} as const;

export type DecodedFrame =
  | { kind: 'text'; data: string }
  | { kind: 'binary'; data: Buffer }
  | { kind: 'ping'; data: Buffer }
  | { kind: 'pong'; data: Buffer }
  | { kind: 'close'; code: number; reason: string };

/** Thrown for anything that RFC 6455 says must terminate the connection. */
export class WsProtocolError extends Error {
  constructor(readonly closeCode: number, message: string) {
    super(message);
    this.name = 'WsProtocolError';
  }
}

interface DecoderOptions {
  /** Reject any message whose assembled payload exceeds this. */
  maxMessageBytes: number;
  /** Server-side decoders require masking; the spec mandates it for client->server. */
  requireMask: boolean;
}

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  /** Fragmented-message assembly state. */
  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private fragmentOpcode: number | null = null;

  constructor(private readonly opts: DecoderOptions) {}

  /**
   * Feed a chunk from the socket; returns every complete frame it unlocked.
   * Throws WsProtocolError on a malformed stream — the caller must close.
   */
  push(chunk: Buffer): DecodedFrame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const out: DecodedFrame[] = [];

    // Guard against a peer that opens a frame header and dribbles bytes forever.
    if (this.buffer.length > this.opts.maxMessageBytes + 16) {
      throw new WsProtocolError(CLOSE.TOO_LARGE, 'frame exceeds max message size');
    }

    for (;;) {
      const frame = this.readOne();
      if (!frame) break;
      if (frame !== SKIP) out.push(frame);
    }
    return out;
  }

  /** Returns null when more bytes are needed, SKIP when a fragment was absorbed. */
  private readOne(): DecodedFrame | typeof SKIP | null {
    const buf = this.buffer;
    if (buf.length < 2) return null;

    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0b1000_0000) !== 0;
    const rsv = b0 & 0b0111_0000;
    const opcode = b0 & 0b0000_1111;
    const masked = (b1 & 0b1000_0000) !== 0;
    let length = b1 & 0b0111_1111;

    // No extensions were negotiated, so any reserved bit set is a protocol error.
    if (rsv !== 0) throw new WsProtocolError(CLOSE.PROTOCOL_ERROR, 'reserved bits set');
    if (this.opts.requireMask && !masked) {
      throw new WsProtocolError(CLOSE.PROTOCOL_ERROR, 'client frame must be masked');
    }

    const isControl = (opcode & 0b1000) !== 0;
    if (isControl) {
      // Control frames: never fragmented, payload <= 125 bytes.
      if (!fin) throw new WsProtocolError(CLOSE.PROTOCOL_ERROR, 'fragmented control frame');
      if (length > 125) throw new WsProtocolError(CLOSE.PROTOCOL_ERROR, 'control frame too long');
    }

    let offset = 2;
    if (length === 126) {
      if (buf.length < offset + 2) return null;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(this.opts.maxMessageBytes)) {
        throw new WsProtocolError(CLOSE.TOO_LARGE, 'declared payload too large');
      }
      length = Number(big);
      offset += 8;
    }

    if (length > this.opts.maxMessageBytes) {
      throw new WsProtocolError(CLOSE.TOO_LARGE, 'payload exceeds max message size');
    }

    let maskKey: Buffer | null = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + length) return null;

    const payload = Buffer.from(buf.subarray(offset, offset + length));
    if (maskKey) unmask(payload, maskKey);
    this.buffer = buf.subarray(offset + length);

    if (isControl) return this.decodeControl(opcode, payload);

    // Data frames: assemble fragments before handing anything up.
    if (opcode === OPCODE.CONTINUATION) {
      if (this.fragmentOpcode === null) {
        throw new WsProtocolError(CLOSE.PROTOCOL_ERROR, 'continuation without start frame');
      }
    } else if (opcode === OPCODE.TEXT || opcode === OPCODE.BINARY) {
      if (this.fragmentOpcode !== null) {
        throw new WsProtocolError(CLOSE.PROTOCOL_ERROR, 'new data frame inside fragmented message');
      }
      this.fragmentOpcode = opcode;
    } else {
      throw new WsProtocolError(CLOSE.PROTOCOL_ERROR, `unknown opcode ${opcode}`);
    }

    this.fragmentBytes += payload.length;
    if (this.fragmentBytes > this.opts.maxMessageBytes) {
      throw new WsProtocolError(CLOSE.TOO_LARGE, 'assembled message exceeds max size');
    }
    this.fragments.push(payload);

    if (!fin) return SKIP;

    const complete = this.fragments.length === 1 ? this.fragments[0] : Buffer.concat(this.fragments);
    const kind = this.fragmentOpcode === OPCODE.TEXT ? 'text' : 'binary';
    this.fragments = [];
    this.fragmentBytes = 0;
    this.fragmentOpcode = null;

    if (kind === 'text') {
      // Invalid UTF-8 in a text frame is a protocol error, not a mojibake string.
      const text = decodeUtf8Strict(complete);
      if (text === null) throw new WsProtocolError(CLOSE.UNSUPPORTED_DATA, 'invalid UTF-8');
      return { kind: 'text', data: text };
    }
    return { kind: 'binary', data: complete };
  }

  private decodeControl(opcode: number, payload: Buffer): DecodedFrame {
    switch (opcode) {
      case OPCODE.PING:
        return { kind: 'ping', data: payload };
      case OPCODE.PONG:
        return { kind: 'pong', data: payload };
      case OPCODE.CLOSE: {
        if (payload.length === 0) return { kind: 'close', code: CLOSE.NORMAL, reason: '' };
        if (payload.length === 1) {
          throw new WsProtocolError(CLOSE.PROTOCOL_ERROR, 'malformed close payload');
        }
        const code = payload.readUInt16BE(0);
        const reason = payload.subarray(2).toString('utf8');
        return { kind: 'close', code, reason };
      }
      default:
        throw new WsProtocolError(CLOSE.PROTOCOL_ERROR, `unknown control opcode ${opcode}`);
    }
  }
}

const SKIP = Symbol('fragment-absorbed');

function unmask(payload: Buffer, key: Buffer): void {
  for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
function decodeUtf8Strict(buf: Buffer): string | null {
  try {
    return utf8Decoder.decode(buf);
  } catch {
    return null;
  }
}

/**
 * Encode a server->client frame. Server frames are never masked.
 * Kept allocation-light: one Buffer for the header, one concat.
 */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0b1000_0000 | opcode; // FIN + opcode; we never fragment outbound
  return Buffer.concat([header, payload], header.length + len);
}

export const encodeText = (text: string): Buffer =>
  encodeFrame(OPCODE.TEXT, Buffer.from(text, 'utf8'));

export const encodePing = (payload: Buffer = Buffer.alloc(0)): Buffer =>
  encodeFrame(OPCODE.PING, payload);

export const encodePong = (payload: Buffer): Buffer => encodeFrame(OPCODE.PONG, payload);

export function encodeClose(code: number, reason = ''): Buffer {
  const reasonBuf = Buffer.from(reason, 'utf8').subarray(0, 123);
  const payload = Buffer.allocUnsafe(2 + reasonBuf.length);
  payload.writeUInt16BE(code, 0);
  reasonBuf.copy(payload, 2);
  return encodeFrame(OPCODE.CLOSE, payload);
}
