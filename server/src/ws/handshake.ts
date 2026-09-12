/**
 * The RFC 6455 opening handshake. It is an HTTP/1.1 Upgrade with one magic constant
 * and one SHA-1 — that is genuinely all a WebSocket "connection" is.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const acceptKey = (clientKey: string): string =>
  createHash('sha1').update(clientKey + WS_GUID).digest('base64');

export type HandshakeResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * Validates the upgrade request and writes the 101 response. On failure it writes a
 * plain HTTP error and destroys the socket — a browser needs a real status line here,
 * not a dangling connection.
 */
export function performHandshake(req: IncomingMessage, socket: Duplex): HandshakeResult {
  const upgrade = String(req.headers.upgrade ?? '').toLowerCase();
  if (upgrade !== 'websocket') {
    return reject(socket, 400, 'Expected Upgrade: websocket');
  }
  const version = String(req.headers['sec-websocket-version'] ?? '');
  if (version !== '13') {
    // Per spec, tell the client which version we speak.
    socket.write(
      'HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\n\r\n',
    );
    socket.destroy();
    return { ok: false, status: 426, message: 'unsupported websocket version' };
  }
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || Buffer.from(key, 'base64').length !== 16) {
    return reject(socket, 400, 'Missing or malformed Sec-WebSocket-Key');
  }

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    // We negotiate no extensions, which is why the decoder rejects RSV bits outright.
    '',
    '',
  ].join('\r\n');

  socket.write(headers);
  return { ok: true };
}

function reject(socket: Duplex, status: number, message: string): HandshakeResult {
  const body = `${status} ${message}`;
  socket.write(
    `HTTP/1.1 ${status} Bad Request\r\n` +
      'Content-Type: text/plain\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: close\r\n\r\n' +
      body,
  );
  socket.destroy();
  return { ok: false, status, message };
}
