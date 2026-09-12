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
      setError('Enter a room code.');
      return;
    }
    onEnter(roomId, callsign());
  };

  return (
    <div className="lobby">
      <section className="lobby-face" aria-labelledby="lobby-title">
        <header className="lobby-head">
          <span className="placard">Welcome</span>
          <h1 id="lobby-title">Join a room</h1>
          <p>
            Every browser tab is its own person. Create a room and share its code, or join
            one someone else created.
          </p>
        </header>

        <label className="field">
          <span className="placard">Your name</span>
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
            Shown next to your cursor.
          </span>
        </label>

        <div className="lobby-bays">
          <div className="bay-card">
            <div className="group-head">
              <IconTarget className="glyph" />
              <span className="placard">Create a room</span>
            </div>
            <p>A new room with a short code.</p>
            <button type="button" className="key wide" onClick={open}>
              Create room
            </button>
          </div>

          <form className="bay-card" onSubmit={join}>
            <div className="group-head">
              <IconLink className="glyph" />
              <span className="placard">Join with a code</span>
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
            <button type="submit" className="key wide secondary">
              Join
            </button>
          </form>
        </div>

        <p className="lobby-foot placard">
          Built on raw WebSockets — no sync libraries
        </p>
      </section>
    </div>
  );
}
