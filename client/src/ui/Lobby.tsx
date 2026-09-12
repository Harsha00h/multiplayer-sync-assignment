import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { generateRoomCode, normalizeName, normalizeRoomId } from './identity.js';
import { IconLink, IconTarget } from './icons.js';

export interface LobbyProps {
  suggestedName: string;
  onEnter: (roomId: string, name: string) => void;
}

/**
 * Pre-flight: pick a callsign, then open a new room or join one by code.
 *
 * Same console world as the room itself — panel metal, engraved placards, the same key
 * and guarded-switch vocabulary — so walking through this door does not feel like
 * arriving from a different app.
 */
export function Lobby({ suggestedName, onEnter }: LobbyProps): ReactElement {
  const [name, setName] = useState(suggestedName);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const callsign = () => normalizeName(name);

  const open = () => onEnter(generateRoomCode(), callsign());

  const join = (event: FormEvent) => {
    event.preventDefault();
    const roomId = normalizeRoomId(code);
    if (!roomId) {
      setError('Enter a room code to join.');
      return;
    }
    onEnter(roomId, callsign());
  };

  return (
    <div className="lobby">
      <section className="lobby-face" aria-labelledby="lobby-title">
        <header className="lobby-head">
          <span className="placard">Pre-flight</span>
          <h1 id="lobby-title">Check in to a room</h1>
          <p>
            Every browser tab is its own station. Open a room and share its code, or join
            one someone else opened.
          </p>
        </header>

        <label className="field">
          <span className="placard">Callsign</span>
          <input
            type="text"
            value={name}
            maxLength={24}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            aria-describedby="callsign-note"
          />
          <span className="note" id="callsign-note">
            Shown beside your cursor. Duplicates in a room get a number.
          </span>
        </label>

        <div className="lobby-bays">
          <div className="bay-card">
            <div className="group-head">
              <IconTarget className="glyph" />
              <span className="placard">Open a room</span>
            </div>
            <p>A fresh room with a code you can read out loud.</p>
            <button type="button" className="key wide" onClick={open}>
              Open room
            </button>
          </div>

          <form className="bay-card" onSubmit={join}>
            <div className="group-head">
              <IconLink className="glyph" />
              <span className="placard">Join a room</span>
            </div>
            <label className="field">
              <span className="placard">Room code</span>
              <input
                type="text"
                value={code}
                placeholder="k7r-4mq"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => {
                  setCode(e.target.value);
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'join-error' : undefined}
              />
            </label>
            {error && (
              <span className="field-error tone-nogo" id="join-error" role="alert">
                {error}
              </span>
            )}
            <button type="submit" className="key wide">
              Join room
            </button>
          </form>
        </div>

        <p className="lobby-foot placard">
          Raw WebSockets · own protocol · own interpolation · no sync libraries
        </p>
      </section>
    </div>
  );
}
