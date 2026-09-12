/**
 * Framing tests. These matter more than they look: every other guarantee in the system
 * rests on the byte parser being right about lengths, masks and fragmentation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  CLOSE,
  FrameDecoder,
  OPCODE,
  WsProtocolError,
  encodeClose,
  encodeText,
} from '../server/src/ws/frame.js';
import { acceptKey } from '../server/src/ws/handshake.js';

/** Build a client-style (masked) frame. */
function maskedFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const mask = randomBytes(4);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  let header: Buffer;
  const len = payload.length;
  if (len < 126) {
    header = Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, mask, masked]);
}

const decoder = () => new FrameDecoder({ maxMessageBytes: 64 * 1024, requireMask: true });

test('handshake accept key matches the RFC 6455 example', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('decodes a short masked text frame', () => {
  const frames = decoder().push(maskedFrame(OPCODE.TEXT, Buffer.from('hello', 'utf8')));
  assert.deepEqual(frames, [{ kind: 'text', data: 'hello' }]);
});

test('decodes 16-bit and 64-bit extended lengths', () => {
  // A decoder with a larger cap: 70_000 bytes deliberately crosses into the 64-bit
  // length encoding, which the production 64KB cap would (correctly) reject outright.
  const big = new FrameDecoder({ maxMessageBytes: 1 << 20, requireMask: true });
  for (const size of [200, 70_000]) {
    const frames = big.push(maskedFrame(OPCODE.TEXT, Buffer.alloc(size, 'x')));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].kind === 'text' && frames[0].data.length, size);
  }
});

test('reassembles a message split across continuation frames', () => {
  const d = decoder();
  assert.deepEqual(d.push(maskedFrame(OPCODE.TEXT, Buffer.from('multi'), false)), []);
  assert.deepEqual(d.push(maskedFrame(OPCODE.CONTINUATION, Buffer.from('-part'), false)), []);
  const frames = d.push(maskedFrame(OPCODE.CONTINUATION, Buffer.from('-done'), true));
  assert.deepEqual(frames, [{ kind: 'text', data: 'multi-part-done' }]);
});

test('handles a frame arriving one byte at a time', () => {
  const d = decoder();
  const frame = maskedFrame(OPCODE.TEXT, Buffer.from('dribble'));
  const collected = [];
  for (const byte of frame) collected.push(...d.push(Buffer.from([byte])));
  assert.deepEqual(collected, [{ kind: 'text', data: 'dribble' }]);
});

test('handles several frames arriving in one chunk', () => {
  const chunk = Buffer.concat([
    maskedFrame(OPCODE.TEXT, Buffer.from('a')),
    maskedFrame(OPCODE.TEXT, Buffer.from('b')),
    maskedFrame(OPCODE.PING, Buffer.alloc(0)),
  ]);
  const frames = decoder().push(chunk);
  assert.equal(frames.length, 3);
  assert.equal(frames[2].kind, 'ping');
});

test('rejects an unmasked client frame', () => {
  assert.throws(
    () => decoder().push(encodeText('unmasked')),
    (e: unknown) => e instanceof WsProtocolError && e.closeCode === CLOSE.PROTOCOL_ERROR,
  );
});

test('rejects reserved bits, fragmented control frames and oversized payloads', () => {
  const rsv = maskedFrame(OPCODE.TEXT, Buffer.from('x'));
  rsv[0] |= 0b0100_0000;
  assert.throws(() => decoder().push(rsv), WsProtocolError);

  const badControl = maskedFrame(OPCODE.PING, Buffer.from('x'), false);
  assert.throws(() => decoder().push(badControl), WsProtocolError);

  const huge = maskedFrame(OPCODE.TEXT, Buffer.alloc(65 * 1024, 'y'));
  assert.throws(
    () => decoder().push(huge),
    (e: unknown) => e instanceof WsProtocolError && e.closeCode === CLOSE.TOO_LARGE,
  );
});

test('rejects invalid UTF-8 in a text frame', () => {
  assert.throws(
    () => decoder().push(maskedFrame(OPCODE.TEXT, Buffer.from([0xff, 0xfe, 0xfd]))),
    (e: unknown) => e instanceof WsProtocolError && e.closeCode === CLOSE.UNSUPPORTED_DATA,
  );
});

test('close frames carry code and reason', () => {
  const encoded = encodeClose(CLOSE.GOING_AWAY, 'bye');
  // Re-decode as if we were the client (server frames are unmasked).
  const d = new FrameDecoder({ maxMessageBytes: 1024, requireMask: false });
  assert.deepEqual(d.push(encoded), [{ kind: 'close', code: CLOSE.GOING_AWAY, reason: 'bye' }]);
});
