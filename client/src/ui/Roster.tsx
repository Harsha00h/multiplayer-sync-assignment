import type { ReactElement } from 'react';
import type { PeerInfo } from '../protocol.js';
import type { PeerFrame } from '../net/room.js';
import { callsign, trackingState } from './console.js';
import { IconTarget } from './icons.js';
import { dashFor } from '../render.js';

export interface RosterProps {
  self: PeerInfo | null;
  peers: PeerFrame[];
  scores: Map<number, number>;
  connected: boolean;
  roomId: string;
}

/**
 * Controllers on station.
 *
 * Every member is listed, including one who has joined and never moved — presence and the
 * plot answer different questions, and a roster that hides someone until they twitch is
 * lying about who is in the room.
 *
 * The two stacked bars per station are the per-peer network readout: signal freshness over
 * arrival jitter. Watch them while throttling the link.
 */
export function Roster({ self, peers, scores, connected, roomId }: RosterProps): ReactElement {
  const total = peers.length + (self ? 1 : 0);
  const selfState = connected
    ? { code: 'ON CONSOLE', tone: 'go' as const }
    : { code: 'OFF LINE', tone: 'nogo' as const };

  return (
    <section className="roster" aria-label="Controllers on station">
      <div className="roster-head">
        <span className="placard">On station</span>
        <span className="count">{String(total).padStart(2, '0')}</span>
      </div>

      <ul className="roster-list">
        {self && (
          <li className="station is-self">
            <span className="hue" style={{ background: `hsl(${self.hue}, 58%, 56%)` }} />
            <span className="name">
              {callsign(self.name)} <em>you</em>
            </span>
            <span className={`track tone-${selfState.tone}`}>{selfState.code}</span>
            <span className="meters">
              <span className="placard">Score</span>
              <span className="score">{scores.get(self.pid) ?? 0}</span>
            </span>
          </li>
        )}

        {peers.map((peer) => {
          const state = trackingState(peer.position.mode, peer.online, peer.staleness);
          return (
            <li key={peer.pid} className={peer.online ? 'station' : 'station is-lost'}>
              <span className="hue" style={{ background: `hsl(${peer.hue}, 58%, 56%)` }} />
              <span className="name">{callsign(peer.name)}</span>
              <span className={`track tone-${state.tone}`}>
                {state.code}
                <span className="sr-only"> — {state.meaning}</span>
              </span>
              <span className="meters">
                <span className="meter">
                  <i className="fresh" style={{ transform: `scaleX(${freshness(peer.staleness)})` }} />
                  <i
                    className="jitter"
                    style={{ transform: `scaleX(${bar(peer.arrivalJitterMs, 200)})` }}
                  />
                </span>
                <span className="age">
                  {Number.isFinite(peer.staleness) ? `${Math.round(peer.staleness)}ms` : '—'}
                </span>
                <span className="score">{scores.get(peer.pid) ?? 0}</span>
              </span>
            </li>
          );
        })}

        {peers.length === 0 && (
          <li className="roster-empty">
            No other stations. Open this page in another tab — each tab is its own client —
            or join from a second device on <code>?room={roomId}</code>.
          </li>
        )}
      </ul>

      <PlotKey />
      <div className="roster-fill" />
    </section>
  );
}

/**
 * The symbology, spelled out.
 *
 * A reviewer meets these marks for the first time on this page, and a legend that teaches
 * them costs four lines. It also anchors the foot of the rail with something true rather
 * than leaving a void under a short roster.
 */
function PlotKey(): ReactElement {
  return (
    <div className="plot-key">
      <span className="placard">Plot key</span>
      <dl>
        <div>
          <dt>
            <Mark code="TRACK" /> TRACK
          </dt>
          <dd>drawn between two samples</dd>
        </div>
        <div>
          <dt>
            <Mark code="COAST" /> COAST
          </dt>
          <dd>projected from last velocity</dd>
        </div>
        <div>
          <dt>
            <Mark code="HOLD" /> HOLD
          </dt>
          <dd>starved past the projection budget</dd>
        </div>
        <div>
          <dt>
            <Mark code="IDLE" /> IDLE
          </dt>
          <dd>connected, not moving</dd>
        </div>
        <div>
          <dt>
            <Mark code="LOST" muted /> LOST
          </dt>
          <dd>dropped, seat held 5s to resume</dd>
        </div>
        <div>
          <dt>
            <Crosshair /> YOU
          </dt>
          <dd>your own pointer, never interpolated</dd>
        </div>
        <div>
          <dt>
            <IconTarget width={11} height={11} strokeWidth={2} /> ACQUIRE
          </dt>
          <dd>tap it — earliest capture time wins</dd>
        </div>
      </dl>
      <p>Bars read signal freshness over arrival jitter.</p>
    </div>
  );
}

/** The own-station marker, at key scale. */
function Crosshair(): ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden focusable="false">
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M0.8 5.5h2M8.2 5.5h2M5.5 0.8v2M5.5 8.2v2" />
      </g>
      <circle cx="5.5" cy="5.5" r="1" fill="currentColor" />
    </svg>
  );
}

/**
 * The station symbol at key scale. The dash pattern comes from the same function the plot
 * draws with, so the key cannot drift from the glass it explains.
 */
function Mark({ code, muted }: { code: string; muted?: boolean }): ReactElement {
  const dash = dashFor(code);
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden focusable="false">
      <rect
        x="1.5"
        y="1.5"
        width="8"
        height="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={dash.length ? dash.join(' ') : undefined}
        opacity={muted ? 0.55 : 1}
      />
      <rect x="5" y="5" width="1.5" height="1.5" fill="currentColor" opacity={muted ? 0.55 : 1} />
    </svg>
  );
}

/**
 * Freshness, not staleness — the caption promises freshness, so the bar has to fall as the
 * signal ages rather than grow. A station with no signal at all reads empty, not full.
 */
const freshness = (staleness: number): number =>
  Number.isFinite(staleness) ? Math.max(0, 1 - Math.min(1, staleness / 400)) : 0;

/** Fraction in [0,1] for scaleX. An unmeasured value reads empty. */
const bar = (value: number, full: number): number =>
  Number.isFinite(value) ? Math.min(1, value / full) : 0;
