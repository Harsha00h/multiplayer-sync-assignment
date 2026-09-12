/**
 * Remote-motion reconstruction.
 *
 * The problem: a remote cursor's true path is sampled ~30 times a second, aggregated
 * into 20 ticks a second, and then delivered over a network that adds a variable delay.
 * If you draw each position the moment it arrives, you get a cursor that stutters at
 * 20fps and freezes whenever a tick is late.
 *
 * The fix used here is the standard one from game networking — *render in the past*:
 *
 *   renderTime = serverNow() - INTERPOLATION_DELAY
 *
 * By deliberately staying ~100ms behind the server clock, we almost always hold samples
 * on *both* sides of the time we want to draw, so drawing becomes interpolation between
 * two known points instead of guessing. The cost is exactly the delay we chose: a remote
 * cursor is shown where it was 100ms ago.
 *
 * The tradeoff, stated plainly:
 *   - delay too small -> the buffer starves, we fall back to extrapolation, motion
 *     overshoots and snaps back on correction.
 *   - delay too large -> perfectly smooth, but the other person feels laggy.
 *   - ~1.5 ticks + 2x network jitter is the sweet spot; that is what
 *     `computeInterpolationDelay` returns, and the demo exposes it as a slider so the
 *     tradeoff can be *seen* rather than argued about.
 *
 * Everything here works in normalized [0,1] coordinates and server-clock milliseconds,
 * so it is resolution-independent and has no idea a canvas exists.
 */

export interface PositionSample {
  /** Server-clock ms at which this position was captured. */
  t: number;
  x: number;
  y: number;
}

export type SampleMode =
  /** Between two known samples — the good case. */
  | 'interpolated'
  /** Past the newest sample; velocity-projected forward. */
  | 'extrapolated'
  /** Buffer starved beyond the extrapolation budget, or the peer stopped moving. */
  | 'held'
  /** Nothing known yet. */
  | 'empty';

export interface SampledPosition {
  x: number;
  y: number;
  /** Normalized units per second — used for cursor tilt and debug readouts. */
  vx: number;
  vy: number;
  mode: SampleMode;
}

/**
 * Hard caps. Without these, a tab left open overnight accumulates every position a peer
 * ever visited: the classic unbounded-buffer leak.
 */
const MAX_SAMPLES = 32;
const MAX_HISTORY_MS = 2_000;

/**
 * How far past the newest sample we are willing to invent motion. Beyond this we stop
 * and wait: a cursor frozen for 200ms reads as "their connection hiccupped", whereas a
 * cursor that keeps gliding into a wall and then teleports back reads as "this app is broken".
 */
const EXTRAPOLATION_LIMIT_MS = 180;

/**
 * Velocity decay constant for extrapolation. Displacement is the integral of an
 * exponentially decaying velocity, so the projected cursor eases to a stop instead of
 * flying off at constant speed — bounded error by construction.
 */
const EXTRAPOLATION_TAU_MS = 90;

/**
 * A gap larger than this between two samples is not motion we should smooth over — it
 * is a stall (packet loss, a reconnect, a backgrounded tab). Sliding a cursor smoothly
 * across a 3-second gap looks like a ghost drifting; holding then jumping is honest.
 */
const MAX_INTERPOLATION_GAP_MS = 300;

export class CursorTrack {
  private samples: PositionSample[] = [];
  private lastAcceptedT = -Infinity;

  /** Wall-clock arrival times, for the jitter readout. Bounded to 24 entries. */
  private arrivals: number[] = [];
  private lastArrivalAt = 0;
  private arrivalMean = 0;
  private arrivalDeviation = 0;

  /**
   * Insert a sample.
   *
   * Out-of-order and duplicate samples are rejected here, by timestamp, and this is the
   * only place that decision is made. A sample older than one we have already integrated
   * carries no information we can use — the newer one already supersedes it — so it is
   * dropped rather than spliced into the middle of the timeline.
   */
  push(sample: PositionSample, arrivedAt = performance.now()): boolean {
    if (sample.t <= this.lastAcceptedT) return false;
    this.lastAcceptedT = sample.t;
    this.samples.push(sample);

    // Trim by count and by age. Both, because either alone has a pathological case.
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    }
    const cutoff = sample.t - MAX_HISTORY_MS;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();

    this.recordArrival(arrivedAt);
    return true;
  }

  /** Called on join/resume: drop the timeline, keep the cursor where it is. */
  reset(to?: PositionSample): void {
    this.samples = to ? [to] : [];
    this.lastAcceptedT = to ? to.t : -Infinity;
  }

  /**
   * Position at `renderTime` (server clock).
   *
   * Three regimes, in order of preference: interpolate between two samples, extrapolate
   * a little past the newest one, or hold.
   */
  sampleAt(renderTime: number, allowExtrapolation = true): SampledPosition {
    const n = this.samples.length;
    if (n === 0) return { x: 0, y: 0, vx: 0, vy: 0, mode: 'empty' };

    const newest = this.samples[n - 1];
    const oldest = this.samples[0];

    // Before anything we know about: the peer just appeared, or our clock estimate moved.
    // Showing the oldest known position beats showing nothing.
    if (renderTime <= oldest.t) {
      return { x: oldest.x, y: oldest.y, vx: 0, vy: 0, mode: 'held' };
    }

    if (renderTime < newest.t) {
      // Walk backwards: the bracket we want is almost always the last pair.
      for (let i = n - 1; i > 0; i--) {
        const b = this.samples[i];
        const a = this.samples[i - 1];
        if (renderTime >= a.t && renderTime <= b.t) {
          const span = b.t - a.t;
          if (span > MAX_INTERPOLATION_GAP_MS) {
            // Don't smooth across a stall — hold at `a`, then pop to `b`.
            return { x: a.x, y: a.y, vx: 0, vy: 0, mode: 'held' };
          }
          const alpha = span <= 0 ? 1 : (renderTime - a.t) / span;
          const inv = span <= 0 ? 0 : 1000 / span;
          return {
            x: a.x + (b.x - a.x) * alpha,
            y: a.y + (b.y - a.y) * alpha,
            vx: (b.x - a.x) * inv,
            vy: (b.y - a.y) * inv,
            mode: 'interpolated',
          };
        }
      }
    }

    // Past the newest sample: the buffer has starved. Project forward, briefly.
    // With extrapolation switched off (the demo's "raw" mode) we simply show the last
    // known position, which is what naive implementations do — and it visibly steps.
    if (!allowExtrapolation) {
      return { x: newest.x, y: newest.y, vx: 0, vy: 0, mode: 'held' };
    }
    const ahead = renderTime - newest.t;
    const velocity = this.velocityAt(n - 1);
    if (ahead <= 0 || (velocity.vx === 0 && velocity.vy === 0)) {
      return { x: newest.x, y: newest.y, vx: 0, vy: 0, mode: 'held' };
    }
    if (ahead > EXTRAPOLATION_LIMIT_MS) {
      // Freeze at the far end of the extrapolation budget rather than snapping back to
      // the last known sample — a rewind is more jarring than a pause.
      const frozen = this.project(newest, velocity, EXTRAPOLATION_LIMIT_MS);
      return { ...frozen, vx: 0, vy: 0, mode: 'held' };
    }
    return { ...this.project(newest, velocity, ahead), mode: 'extrapolated' };
  }

  /**
   * Displacement of an exponentially decaying velocity:
   *   x(t) = x0 + v * tau * (1 - e^(-t/tau))
   * which is bounded by `v * tau` no matter how long the stall lasts.
   */
  private project(
    from: PositionSample,
    velocity: { vx: number; vy: number },
    dtMs: number,
  ): { x: number; y: number; vx: number; vy: number } {
    const scale = (EXTRAPOLATION_TAU_MS / 1000) * (1 - Math.exp(-dtMs / EXTRAPOLATION_TAU_MS));
    return {
      x: clamp01(from.x + velocity.vx * scale),
      y: clamp01(from.y + velocity.vy * scale),
      vx: velocity.vx,
      vy: velocity.vy,
    };
  }

  /** Velocity in normalized units/second, from the two most recent samples. */
  private velocityAt(index: number): { vx: number; vy: number } {
    if (index < 1) return { vx: 0, vy: 0 };
    const b = this.samples[index];
    const a = this.samples[index - 1];
    const dt = b.t - a.t;
    // Two samples further apart than a stall threshold say nothing about current speed.
    if (dt <= 0 || dt > MAX_INTERPOLATION_GAP_MS) return { vx: 0, vy: 0 };
    return { vx: ((b.x - a.x) * 1000) / dt, vy: ((b.y - a.y) * 1000) / dt };
  }

  private recordArrival(now: number): void {
    if (this.lastArrivalAt > 0) {
      const gap = now - this.lastArrivalAt;
      this.arrivals.push(gap);
      if (this.arrivals.length > 24) this.arrivals.shift();
      if (this.arrivalMean === 0) {
        this.arrivalMean = gap;
      } else {
        const error = gap - this.arrivalMean;
        this.arrivalMean += error * 0.15;
        this.arrivalDeviation += (Math.abs(error) - this.arrivalDeviation) * 0.2;
      }
    }
    this.lastArrivalAt = now;
  }

  /** Mean absolute deviation of inter-arrival time: "how irregular is this peer's stream". */
  get arrivalJitterMs(): number {
    return this.arrivalDeviation;
  }

  get msSinceLastArrival(): number {
    return this.lastArrivalAt === 0 ? Infinity : performance.now() - this.lastArrivalAt;
  }

  /** How much runway the buffer has past a given render time. Negative = starving. */
  bufferedMs(renderTime: number): number {
    if (this.samples.length === 0) return 0;
    return this.samples[this.samples.length - 1].t - renderTime;
  }

  get size(): number {
    return this.samples.length;
  }

  get newest(): PositionSample | null {
    return this.samples.length ? this.samples[this.samples.length - 1] : null;
  }

  /**
   * The most recent samples, oldest first — a read-only view for rendering the history
   * marks behind a tracked symbol. Bounded by the buffer itself, so this can never hand
   * back more than MAX_SAMPLES entries however long the session runs.
   */
  recent(max: number): PositionSample[] {
    if (this.samples.length <= max) return this.samples.slice();
    return this.samples.slice(this.samples.length - max);
  }
}

export interface InterpolationDelayInput {
  tickMs: number;
  /** Network jitter estimate (ms), e.g. from ClockSync or per-peer arrival spacing. */
  jitterMs: number;
  minMs?: number;
  maxMs?: number;
}

/**
 * How far behind the server clock to render.
 *
 * 1.5 ticks covers the aggregation cadence itself (a sample can be produced just after a
 * tick was built, so it waits nearly a full tick, plus the tick-to-tick spacing). Two
 * standard-ish deviations of jitter covers most late arrivals without over-buffering.
 * Clamped so a bad measurement can never make the app feel broken in either direction.
 */
export function computeInterpolationDelay({
  tickMs,
  jitterMs,
  minMs = 60,
  maxMs = 400,
}: InterpolationDelayInput): number {
  const raw = tickMs * 1.5 + jitterMs * 2;
  return Math.round(Math.min(maxMs, Math.max(minMs, raw)));
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
