/**
 * Lobby or console, decided by the address.
 *
 * `?room=<code>` in the URL means a room; no room means the lobby. Entering a room pushes
 * the code into the address (so the link is shareable) and mounts the console; leaving
 * pops it. The browser's back button works because both directions go through history.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { RoomConsole } from './ui/RoomConsole.js';
import { Lobby } from './ui/Lobby.js';
import {
  getClientId,
  getDisplayName,
  getRoomId,
  navigateToRoom,
  setDisplayName,
} from './ui/identity.js';

export default function App(): ReactElement {
  const clientId = useMemo(() => getClientId(), []);
  const [roomId, setRoomId] = useState<string | null>(() => getRoomId());
  const [name, setName] = useState(() => getDisplayName(clientId));

  // Back/forward: the address is the source of truth.
  useEffect(() => {
    const sync = () => setRoomId(getRoomId());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const enter = useCallback((nextRoom: string, nextName: string) => {
    setName(setDisplayName(nextName));
    navigateToRoom(nextRoom);
    setRoomId(nextRoom);
  }, []);

  const leave = useCallback(() => {
    navigateToRoom(null);
    setRoomId(null);
  }, []);

  if (!roomId) return <Lobby suggestedName={name} onEnter={enter} />;

  // Keyed on the room so switching rooms tears the old console down completely — the
  // socket, the buffers, the timers — rather than trying to migrate a live room object.
  return <RoomConsole key={roomId} roomId={roomId} clientId={clientId} name={name} onLeave={leave} />;
}
