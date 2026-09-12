/**
 * A minimal WebSocket *client* for the integration tests — hand-rolled for the same
 * reason the server is: so the tests exercise real framing, including the masking that
 * the server requires of every client frame.
 */
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { FrameDecoder, OPCODE } from '../server/src/ws/frame.js';
import { acceptKey } from '../server/src/ws/handshake.js';
import { parseServerMessage } from '../shared/protocol.js';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';

export class TestClient {
  private socket!: Socket;
  private decoder = new FrameDecoder({ maxMessageBytes: 1 << 20, requireMask: false });
  readonly received: ServerMessage[] = [];
  readonly rawReceived: string[] = [];
  closed = false;
  closeCode = 0;

  private waiters: { predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  static async connect(port: number, path = '/ws'): Promise<TestClient> {
    const client = new TestClient();
    await client.open(port, path);
    return client;
  }

  private open(port: number, path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const key = randomBytes(16).toString('base64');
      this.socket = connect(port, '127.0.0.1', () => {
        this.socket.write(
          `GET ${path} HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${port}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${key}\r\n` +
            'Sec-WebSocket-Version: 13\r\n\r\n',
        );
      });

      let handshakeDone = false;
      let buffer = Buffer.alloc(0);

      this.socket.on('data', (chunk: Buffer) => {
        if (!handshakeDone) {
          buffer = Buffer.concat([buffer, chunk]);
          const end = buffer.indexOf('\r\n\r\n');
          if (end === -1) return;
          const head = buffer.subarray(0, end).toString('utf8');
          if (!head.startsWith('HTTP/1.1 101')) {
            reject(new Error(`handshake failed: ${head.split('\r\n')[0]}`));
            return;
          }
          if (!head.includes(acceptKey(key))) {
            reject(new Error('Sec-WebSocket-Accept mismatch'));
            return;
          }
          handshakeDone = true;
          const rest = buffer.subarray(end + 4);
          buffer = Buffer.alloc(0);
          resolve();
          if (rest.length) this.consume(rest);
          return;
        }
        this.consume(chunk);
      });

      this.socket.on('close', () => {
        this.closed = true;
      });
      this.socket.on('error', reject);
    });
  }

  private consume(chunk: Buffer): void {
    for (const frame of this.decoder.push(chunk)) {
      if (frame.kind === 'text') {
        this.rawReceived.push(frame.data);
        const parsed = parseServerMessage(frame.data);
        if (!parsed.ok) throw new Error(`server sent an invalid frame: ${parsed.error}`);
        this.received.push(parsed.value);
        for (let i = this.waiters.length - 1; i >= 0; i--) {
          if (this.waiters[i].predicate(parsed.value)) {
            this.waiters.splice(i, 1)[0].resolve(parsed.value);
          }
        }
      } else if (frame.kind === 'ping') {
        this.sendFrame(OPCODE.PONG, frame.data);
      } else if (frame.kind === 'close') {
        this.closeCode = frame.code;
        this.closed = true;
      }
    }
  }

  send(msg: ClientMessage): void {
    this.sendText(JSON.stringify(msg));
  }

  /** Bypasses the type system on purpose — used to test malformed-input handling. */
  sendText(text: string): void {
    this.sendFrame(OPCODE.TEXT, Buffer.from(text, 'utf8'));
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    // Client frames must be masked (RFC 6455 s5.3). The server's `encodeFrame` never
    // masks — that is correct for server->client — so the test client builds its own
    // header with the MASK bit set.
    const mask = randomBytes(4);
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
    this.socket.write(Buffer.concat([buildMaskedHeader(opcode, payload.length), mask, masked]));
  }

  waitFor<T extends ServerMessage['t']>(type: T, timeoutMs = 2_000): Promise<Extract<ServerMessage, { t: T }>> {
    const existing = this.received.find((m) => m.t === type);
    if (existing) return Promise.resolve(existing as Extract<ServerMessage, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for "${type}"`)), timeoutMs);
      this.waiters.push({
        predicate: (m) => m.t === type,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  waitUntil(predicate: (m: ServerMessage) => boolean, timeoutMs = 2_000): Promise<ServerMessage> {
    const existing = this.received.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
      this.waiters.push({
        predicate,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  /** Abrupt disconnect: no close frame, just a dead socket — the "lost network" case. */
  destroy(): void {
    this.socket.destroy();
  }

  close(): void {
    const payload = Buffer.allocUnsafe(2);
    payload.writeUInt16BE(1000, 0);
    this.sendFrame(OPCODE.CLOSE, payload);
    this.socket.end();
  }
}

function buildMaskedHeader(opcode: number, length: number): Buffer {
  let header: Buffer;
  if (length < 126) {
    header = Buffer.allocUnsafe(2);
    header[1] = 0x80 | length;
  } else if (length < 65536) {
    header = Buffer.allocUnsafe(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return header;
}
