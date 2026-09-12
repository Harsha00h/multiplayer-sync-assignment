/**
 * The console's vocabulary.
 *
 * Two jobs, both kept out of the components so they can be reasoned about (and tested)
 * on their own: translating engine state into the words a console face uses, and deriving
 * the GO / NO-GO matrix from telemetry that is actually measured.
 *
 * Nothing here invents a status. Every lamp traces to a real reading, which is the whole
 * point of the surface: a matrix that reads GO because it always reads GO is scenery.
 */
import type { PeerFrame, RoomStats } from '../net/room.js';
import type { SampleMode } from '../interpolation.js';

export type Tone = 'go' | 'caution' | 'nogo' | 'off';

/**
 * Radar and telemetry already have exact words for what the interpolator does, and they
 * are better than the engine's own: a track being dead-reckoned from its last known
 * velocity has been "coasting" since long before anyone wrote a cursor demo.
 */
export interface TrackingState {
  code: string;
  tone: Tone;
  /**
   * The expansion, for assistive technology only. The face teaches this vocabulary in the
   * plot key; a screen reader gets it inline, because "COAST" alone is not a word.
   */
  meaning: string;
}

/**
 * @param staleness ms since this peer's last update actually landed.
 *
 * Staleness is what separates a fault from a person sitting still. A held track whose
 * samples stopped arriving seconds ago is IDLE — someone let go of the mouse — while a
 * held track that is still receiving is genuinely starved. Reporting both as a fault
 * makes the console cry wolf, and an instrument that cries wolf is worse than none.
 */
const IDLE_AFTER_MS = 1_000;

/**
 * Where a healthy link stops being healthy. Both are round-trip figures the engine already
 * measures, and both are low enough that a reviewer dragging the impairment sliders sees
 * the lamp lift immediately.
 */
const RTT_DEGRADED_MS = 200;
const JITTER_DEGRADED_MS = 100;

export function trackingState(mode: SampleMode, online: boolean, staleness = 0): TrackingState {
  if (!online) {
    return { code: 'LOST', tone: 'nogo', meaning: 'Signal lost — holding this station for reacquisition' };
  }
  if (mode === 'held' && staleness > IDLE_AFTER_MS) {
    return { code: 'IDLE', tone: 'off', meaning: 'On station and connected, but not moving' };
  }
  switch (mode) {
    case 'interpolated':
      return { code: 'TRACK', tone: 'go', meaning: 'Drawn between two known samples' };
    case 'extrapolated':
      return { code: 'COAST', tone: 'caution', meaning: 'Buffer starved — projected from last known velocity' };
    case 'held':
      return { code: 'HOLD', tone: 'caution', meaning: 'Past the projection budget — frozen until the next sample' };
    case 'empty':
      return { code: 'NO SIG', tone: 'off', meaning: 'On station, but has not moved yet' };
  }
}

export interface MatrixRow {
  id: 'link' | 'clock' | 'buffer' | 'feed';
  label: string;
  /** One word. The lamp carries the severity; this says why. */
  reading: string;
  tone: Tone;
}

/** The four subsystems this room actually depends on, each read from live telemetry. */
export function statusMatrix(stats: RoomStats | null, peers: PeerFrame[]): MatrixRow[] {
  const up = stats?.status === 'open';

  // A lamp named LINK that only watches whether the socket object exists is scenery: it
  // stays green through the exact impairment the console is built to demonstrate. Quality
  // of the link counts, not just its existence.
  const degraded = !!stats && (stats.rttMs >= RTT_DEGRADED_MS || stats.jitterMs >= JITTER_DEGRADED_MS);
  const link: MatrixRow = !stats
    ? { id: 'link', label: 'LINK', reading: 'STANDBY', tone: 'off' }
    : stats.status === 'open'
      ? degraded
        ? { id: 'link', label: 'LINK', reading: 'DEGRADED', tone: 'caution' }
        : { id: 'link', label: 'LINK', reading: 'NOMINAL', tone: 'go' }
      : stats.status === 'closed'
        ? { id: 'link', label: 'LINK', reading: 'DOWN', tone: 'nogo' }
        : { id: 'link', label: 'LINK', reading: 'ACQUIRING', tone: 'caution' };

  const clock: MatrixRow = !up
    ? { id: 'clock', label: 'CLOCK', reading: 'STANDBY', tone: 'off' }
    : stats && stats.clockOffsetReady
      ? { id: 'clock', label: 'CLOCK', reading: 'LOCKED', tone: 'go' }
      : { id: 'clock', label: 'CLOCK', reading: 'ACQUIRING', tone: 'caution' };

  // The buffer's health is not a number, it is what the peers' tracks are doing.
  const tracked = peers.filter((p) => p.online && p.position.mode !== 'empty');
  // Only a station that is still sending can starve the buffer; one that stopped moving
  // is idle, and idle is not a fault.
  const starved = tracked.some((p) => p.position.mode === 'held' && p.staleness <= IDLE_AFTER_MS);
  const coasting = tracked.some((p) => p.position.mode === 'extrapolated');
  const buffer: MatrixRow = !up
    ? { id: 'buffer', label: 'BUFFER', reading: 'STANDBY', tone: 'off' }
    : tracked.length === 0
      ? { id: 'buffer', label: 'BUFFER', reading: 'NO TRAFFIC', tone: 'off' }
      : starved
        ? { id: 'buffer', label: 'BUFFER', reading: 'STARVED', tone: 'nogo' }
        : coasting
          ? { id: 'buffer', label: 'BUFFER', reading: 'COASTING', tone: 'caution' }
          : { id: 'buffer', label: 'BUFFER', reading: 'NOMINAL', tone: 'go' };

  const feed: MatrixRow = !up || !stats
    ? { id: 'feed', label: 'FEED', reading: 'STANDBY', tone: 'off' }
    : stats.sampleHz < 30
      ? { id: 'feed', label: 'FEED', reading: 'THROTTLED', tone: 'caution' }
      : { id: 'feed', label: 'FEED', reading: 'FULL RATE', tone: 'go' };

  return [link, clock, buffer, feed];
}

/** Mission elapsed time, counted from this station coming on console. */
export function formatMet(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Callsigns are engraved in caps; the underlying name is never mutated. */
export const callsign = (name: string): string => name.toUpperCase();
