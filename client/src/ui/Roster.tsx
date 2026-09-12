import type { ReactElement } from 'react';
import type { PeerInfo } from '../protocol.js';
import type { PeerFrame } from '../net/room.js';
import { callsign, trackingState } from './console.js';
import { peerColor } from '../render.js';


export interface RosterProps {
  self: PeerInfo | null;
  peers: PeerFrame[];
  scores: Map<number, number>;
  connected: boolean;
  roomId: string;
}

/**
 * Who's here.
 *
 * Every member is listed, including one who has joined and never moved — presence and the
 * canvas answer different questions, and a list that hides someone until they twitch is
 * lying about who is in the room.
 *
 * The bar under each person is the per-peer network readout: how fresh their last update
 * is, with their arrival jitter underneath. Watch it while throttling the connection.
 */
export function Roster({ self, peers, scores, connected, roomId }: RosterProps): ReactElement {
  const total = peers.length + (self ? 1 : 0);
  const selfState = connected
    ? { code: 'Connected', tone: 'go' as const }
    : { code: 'Offline', tone: 'nogo' as const };

  return (
    <section className="roster" aria-label="People in the room">
      <div className="roster-head">
        <span className="placard">People</span>
        <span className="count">{total}</span>
      </div>

      <ul className="roster-list">
        {self && (
          <li className="station is-self">
            <span className="hue" style={{ background: peerColor(self.hue) }} />
            <span className="name">
              {callsign(self.name)} <em>you</em>
            </span>
            <span className={`track tone-${selfState.tone}`}>{selfState.code}</span>
            <span className="meters">
              <span className="placard">Targets won</span>
              <span className="score">{scores.get(self.pid) ?? 0}</span>
            </span>
          </li>
        )}

        {peers.map((peer) => {
          const state = trackingState(peer.position.mode, peer.online, peer.staleness);
          return (
            <li key={peer.pid} className={peer.online ? 'station' : 'station is-lost'}>
              <span className="hue" style={{ background: peerColor(peer.hue) }} />
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
            Nobody else yet. Open this page in another tab — each tab is its own person — or
            share the room code <code>{roomId}</code>.
          </li>
        )}
      </ul>

      <PlotKey />
      <div className="roster-fill" />
    </section>
  );
}

/**
 * What the states mean, in the words the list uses. A first-time reviewer meets these on
 * this page, and four lines of legend costs less than a guess.
 */
function PlotKey(): ReactElement {
  return (
    <div className="plot-key">
      <span className="placard">Cursor states</span>
      <dl>
        <div>
          <dt><Dot tone="go" /> Smooth</dt>
          <dd>drawn between two known positions</dd>
        </div>
        <div>
          <dt><Dot tone="caution" /> Predicting</dt>
          <dd>no fresh data; projected from last velocity</dd>
        </div>
        <div>
          <dt><Dot tone="caution" /> Stalled</dt>
          <dd>waiting for data past the prediction limit</dd>
        </div>
        <div>
          <dt><Dot tone="off" /> Idle</dt>
          <dd>connected, not moving</dd>
        </div>
        <div>
          <dt><Dot tone="nogo" /> Reconnecting</dt>
          <dd>dropped; seat held 5 seconds</dd>
        </div>
      </dl>
      <p>Bars show freshness of the last update, with arrival jitter underneath.</p>
    </div>
  );
}

function Dot({ tone }: { tone: 'go' | 'caution' | 'nogo' | 'off' }): ReactElement {
  return <span className="lamp" data-tone={tone} aria-hidden />;
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
