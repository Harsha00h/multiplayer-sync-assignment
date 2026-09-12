/**
 * The interface's vocabulary.
 *
 * Two jobs, both kept out of the components so they can be reasoned about on their own:
 * translating engine state into plain words, and deriving the four status indicators from
 * telemetry that is actually measured.
 *
 * Nothing here invents a status. Every indicator traces to a real reading; one that reads
 * "good" because it always reads "good" is decoration.
 */
import type { PeerFrame, RoomStats } from '../net/room.js';
import type { SampleMode } from '../interpolation.js';

export type Tone = 'go' | 'caution' | 'nogo' | 'off';

/** What the interpolator is doing for a peer, in a word anyone can read. */
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
    return { code: 'Reconnecting', tone: 'nogo', meaning: 'Connection dropped; their seat is held for 5 seconds' };
  }
  if (mode === 'held' && staleness > IDLE_AFTER_MS) {
    return { code: 'Idle', tone: 'off', meaning: 'Connected, not moving' };
  }
  switch (mode) {
    case 'interpolated':
      return { code: 'Smooth', tone: 'go', meaning: 'Drawn between two known positions' };
    case 'extrapolated':
      return { code: 'Predicting', tone: 'caution', meaning: 'No fresh data yet; projected from last velocity' };
    case 'held':
      return { code: 'Stalled', tone: 'caution', meaning: 'Waiting for data past the prediction limit' };
    case 'empty':
      return { code: 'No cursor', tone: 'off', meaning: 'Joined, but has not moved yet' };
  }
}

export interface MatrixRow {
  id: 'link' | 'clock' | 'buffer' | 'feed';
  label: string;
  /** One word. The lamp carries the severity; this says why. */
  reading: string;
  tone: Tone;
}

/** The four things the room depends on, each read from live telemetry. */
export function statusMatrix(stats: RoomStats | null, peers: PeerFrame[]): MatrixRow[] {
  const up = stats?.status === 'open';

  // A lamp named LINK that only watches whether the socket object exists is scenery: it
  // stays green through the exact impairment the console is built to demonstrate. Quality
  // of the link counts, not just its existence.
  const degraded = !!stats && (stats.rttMs >= RTT_DEGRADED_MS || stats.jitterMs >= JITTER_DEGRADED_MS);
  const link: MatrixRow = !stats
    ? { id: 'link', label: 'Connection', reading: 'Waiting', tone: 'off' }
    : stats.status === 'open'
      ? degraded
        ? { id: 'link', label: 'Connection', reading: 'Slow', tone: 'caution' }
        : { id: 'link', label: 'Connection', reading: 'Good', tone: 'go' }
      : stats.status === 'closed'
        ? { id: 'link', label: 'Connection', reading: 'Offline', tone: 'nogo' }
        : { id: 'link', label: 'Connection', reading: 'Connecting', tone: 'caution' };

  const clock: MatrixRow = !up
    ? { id: 'clock', label: 'Clock', reading: 'Waiting', tone: 'off' }
    : stats && stats.clockOffsetReady
      ? { id: 'clock', label: 'Clock', reading: 'Synced', tone: 'go' }
      : { id: 'clock', label: 'Clock', reading: 'Syncing', tone: 'caution' };

  // The buffer's health is not a number, it is what the peers' tracks are doing.
  const tracked = peers.filter((p) => p.online && p.position.mode !== 'empty');
  // Only a station that is still sending can starve the buffer; one that stopped moving
  // is idle, and idle is not a fault.
  const starved = tracked.some((p) => p.position.mode === 'held' && p.staleness <= IDLE_AFTER_MS);
  const coasting = tracked.some((p) => p.position.mode === 'extrapolated');
  const buffer: MatrixRow = !up
    ? { id: 'buffer', label: 'Smoothing', reading: 'Waiting', tone: 'off' }
    : tracked.length === 0
      ? { id: 'buffer', label: 'Smoothing', reading: 'No motion', tone: 'off' }
      : starved
        ? { id: 'buffer', label: 'Smoothing', reading: 'Stalled', tone: 'nogo' }
        : coasting
          ? { id: 'buffer', label: 'Smoothing', reading: 'Predicting', tone: 'caution' }
          : { id: 'buffer', label: 'Smoothing', reading: 'Smooth', tone: 'go' };

  const feed: MatrixRow = !up || !stats
    ? { id: 'feed', label: 'Send rate', reading: 'Waiting', tone: 'off' }
    : stats.sampleHz < 30
      ? { id: 'feed', label: 'Send rate', reading: 'Reduced', tone: 'caution' }
      : { id: 'feed', label: 'Send rate', reading: 'Full', tone: 'go' };

  return [link, clock, buffer, feed];
}

/** Session time, counted from when this tab connected. */
export function formatMet(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function formatBytes(n: number): string {
  // Rounded on every branch: the callers now hand this a *damped* number mid-settle.
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Names are shown as typed. Kept as a function so the rendering path has one place to change. */
export const callsign = (name: string): string => name;
