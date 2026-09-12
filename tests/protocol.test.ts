/**
 * Validation tests: the requirement is that an unknown or malformed message is
 * *rejected*, never silently accepted and never able to crash a peer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COORD_SCALE,
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
} from '../shared/protocol.js';

test('accepts a well-formed hello', () => {
  const result = parseClientMessage(
    JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, roomId: 'r', clientId: 'c', name: 'nia' }),
  );
  assert.ok(result.ok);
  assert.equal(result.value.t, 'hello');
});

test('rejects unknown message types instead of passing them through', () => {
  const result = parseClientMessage(JSON.stringify({ t: 'drop-tables', payload: 1 }));
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /unknown message type/);
});

test('rejects malformed JSON, non-objects and missing fields', () => {
  for (const raw of ['{', '[]', '"hi"', 'null', JSON.stringify({ t: 'in' })]) {
    assert.equal(parseClientMessage(raw).ok, false, `should reject: ${raw}`);
  }
});

test('rejects structurally wrong tuples in a cursor batch', () => {
  const bad = [
    { t: 'in', seq: 1, s: [[0, 1]] },
    { t: 'in', seq: 1, s: [[0, 'x', 1]] },
    { t: 'in', seq: 1, s: [] },
    { t: 'in', seq: -1, s: [[0, 1, 1]] },
  ];
  for (const msg of bad) {
    assert.equal(parseClientMessage(JSON.stringify(msg)).ok, false, JSON.stringify(msg));
  }
});

test('clamps out-of-range coordinates rather than dropping the frame', () => {
  const result = parseClientMessage(
    JSON.stringify({ t: 'in', seq: 1, s: [[0, -500, COORD_SCALE * 4]] }),
  );
  assert.ok(result.ok);
  assert.deepEqual(result.value.t === 'in' && result.value.s[0], [0, 0, COORD_SCALE]);
});

test('rejects an unknown reaction kind', () => {
  const result = parseClientMessage(JSON.stringify({ t: 'react', seq: 1, dt: 0, x: 1, y: 1, k: 99 }));
  assert.equal(result.ok, false);
});

test('rejects NaN and Infinity, which survive JSON round-trips as nulls or strings', () => {
  assert.equal(parseClientMessage(JSON.stringify({ t: 'ping', id: null, ct: 1 })).ok, false);
  assert.equal(parseClientMessage('{"t":"ping","id":1e999,"ct":1}').ok, false);
});

test('client-side validation rejects a bad server frame', () => {
  assert.equal(parseServerMessage(JSON.stringify({ t: 'k', st: 1, seq: 0, c: [[1, 2]] })).ok, false);
  assert.equal(parseServerMessage(JSON.stringify({ t: 'k', seq: 0 })).ok, false);
  assert.equal(
    parseServerMessage(JSON.stringify({ t: 'welcome', v: 999, st: 1, token: 'x' })).ok,
    false,
  );
});

test('accepts a valid tick and preserves tuple ordering', () => {
  const result = parseServerMessage(
    JSON.stringify({ t: 'k', st: 1000, seq: 7, c: [[3, 100, 200, 25]] }),
  );
  assert.ok(result.ok);
  assert.deepEqual(result.value.t === 'k' && result.value.c?.[0], [3, 100, 200, 25]);
});
