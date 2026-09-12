import type { ReactElement } from 'react';
import { PROTOCOL_VERSION, TICK_MS } from '../protocol.js';
import type { MatrixRow } from './console.js';
import { IconBuffer, IconClock, IconFeed, IconLink } from './icons.js';

export interface TopRailProps {
  roomId: string;
  /** Mission elapsed time, already formatted. */
  met: string;
  matrix: MatrixRow[];
  /** Back to pre-flight. The console tears down cleanly; the server sees a clean close. */
  onLeave: () => void;
}

const GLYPH = {
  link: IconLink,
  clock: IconClock,
  buffer: IconBuffer,
  feed: IconFeed,
} as const;

/**
 * Room designation, mission clock, and the GO / NO-GO matrix.
 *
 * The matrix carries state and only state — no numbers appear here, because every number
 * on this console is printed exactly once, in the switch group that governs it.
 */
export function TopRail({ roomId, met, matrix, onLeave }: TopRailProps): ReactElement {
  return (
    <header className="rail-top">
      <div className="designation">
        <span className="placard">Room</span>
        <span className="room">{roomId}</span>
        <button type="button" className="leave" onClick={onLeave}>
          Leave
        </button>
      </div>

      <div className="met">
        <span className="placard">Session</span>
        <span className="clock">
          <time>{met}</time>
        </span>
      </div>

      {/* The nameplate: facts off the wire contract, engraved where a console carries
          its designation. Blank panel would read as unfinished; this is true and useful. */}
      <div className="nameplate">
        <span className="placard">Protocol</span>
        <span className="plate">
          V{PROTOCOL_VERSION} · {TICK_MS}MS TICK · RAW WEBSOCKET
        </span>
      </div>

      <div className="matrix" role="group" aria-label="Status">
        {matrix.map((row) => {
          const Glyph = GLYPH[row.id];
          return (
            <div className="matrix-cell" key={row.id}>
              <Glyph className="glyph" />
              <span className="lamp" data-tone={row.tone} />
              <span className="stack">
                <span className="placard">{row.label}</span>
                <span className={`state tone-${row.tone}`}>{row.reading}</span>
              </span>
            </div>
          );
        })}
      </div>
    </header>
  );
}
