/**
 * Interpolation tests — the behavioural claims made in the README, asserted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CursorTrack, computeInterpolationDelay } from '../client/src/interpolation.js';

const track = (samples: [number, number, number][]) => {
  const t = new CursorTrack();
  for (const [time, x, y] of samples) t.push({ t: time, x, y });
  return t;
};

test('interpolates linearly between two samples', () => {
  const t = track([
    [1000, 0, 0],
    [1100, 1, 0.5],
  ]);
  const mid = t.sampleAt(1050);
  assert.equal(mid.mode, 'interpolated');
  assert.ok(Math.abs(mid.x - 0.5) < 1e-9, `x was ${mid.x}`);
  assert.ok(Math.abs(mid.y - 0.25) < 1e-9);
});

test('drops stale and duplicate samples instead of rewriting the timeline', () => {
  const t = new CursorTrack();
  assert.equal(t.push({ t: 1000, x: 0.5, y: 0.5 }), true);
  assert.equal(t.push({ t: 1100, x: 0.6, y: 0.5 }), true);
  // Late arrival of an older sample — exactly what reordering looks like.
  assert.equal(t.push({ t: 1050, x: 0.0, y: 0.0 }), false);
  assert.equal(t.push({ t: 1100, x: 0.9, y: 0.9 }), false);
  assert.equal(t.size, 2);
  assert.equal(t.newest?.x, 0.6);
});

test('extrapolates past the newest sample, and the projection is bounded', () => {
  const t = track([
    [1000, 0.2, 0.2],
    [1100, 0.3, 0.2],
  ]);
  const ahead = t.sampleAt(1150);
  assert.equal(ahead.mode, 'extrapolated');
  assert.ok(ahead.x > 0.3, 'should have moved forward');

  // Far past the extrapolation budget it freezes rather than flying off. Velocity here
  // is 1.0 units/s, so the analytic ceiling on displacement is v * tau = 0.09 — the
  // cursor can never travel further than that no matter how long the stall lasts.
  const farther = t.sampleAt(5_000);
  const muchFarther = t.sampleAt(60_000);
  assert.equal(farther.mode, 'held');
  assert.ok(farther.x <= 0.3 + 0.09, `bounded displacement, got ${farther.x}`);
  assert.equal(farther.x, muchFarther.x, 'a longer stall must not move it further');
});

test('extrapolation can be disabled, which is the naive behaviour', () => {
  const t = track([
    [1000, 0.2, 0.2],
    [1100, 0.3, 0.2],
  ]);
  const raw = t.sampleAt(1150, false);
  assert.equal(raw.mode, 'held');
  assert.equal(raw.x, 0.3);
});

test('does not smooth across a long stall — holds, then jumps', () => {
  const t = track([
    [1000, 0.1, 0.1],
    [4000, 0.9, 0.9], // 3s gap: a reconnect, not motion
  ]);
  const during = t.sampleAt(2500);
  assert.equal(during.mode, 'held');
  assert.equal(during.x, 0.1, 'must not drift halfway across the screen');
});

test('buffer memory is bounded no matter how long the session runs', () => {
  const t = new CursorTrack();
  for (let i = 0; i < 5_000; i++) t.push({ t: 1000 + i * 33, x: i / 5000, y: 0.5 });
  assert.ok(t.size <= 32, `buffer grew to ${t.size}`);
});

test('renders the oldest known position before the timeline starts', () => {
  const t = track([[2000, 0.4, 0.6]]);
  const before = t.sampleAt(1000);
  assert.equal(before.mode, 'held');
  assert.deepEqual([before.x, before.y], [0.4, 0.6]);
});

test('adaptive delay grows with jitter and stays inside its clamps', () => {
  assert.equal(computeInterpolationDelay({ tickMs: 50, jitterMs: 0 }), 75);
  assert.equal(computeInterpolationDelay({ tickMs: 50, jitterMs: 40 }), 155);
  assert.equal(computeInterpolationDelay({ tickMs: 50, jitterMs: 10_000 }), 400);
  assert.equal(computeInterpolationDelay({ tickMs: 1, jitterMs: 0 }), 60);
});
