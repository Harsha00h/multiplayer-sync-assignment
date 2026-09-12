/**
 * Client identity and the room address.
 *
 * `clientId` lives in **sessionStorage**, which is per-tab. That is the whole trick behind
 * the demo: five tabs are five distinct clients, exactly as if they were five devices, and
 * reloading a tab keeps its id so the server *resumes* the seat instead of spawning a second
 * cursor.
 *
 * The room lives in the URL (`?room=k7r-4mq`) so a link is shareable. The name lives in
 * sessionStorage, not the URL, so sharing a link does not share your callsign.
 */
const ID_KEY = 'sync.clientId';
const NAME_KEY = 'sync.name';

const ADJECTIVES = ['swift', 'calm', 'bright', 'lucky', 'bold', 'keen', 'sly', 'warm'];
const NOUNS = ['otter', 'falcon', 'comet', 'maple', 'ember', 'pike', 'wren', 'delta'];

export function getClientId(): string {
  const existing = sessionStorage.getItem(ID_KEY);
  if (existing) return existing;
  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  sessionStorage.setItem(ID_KEY, id);
  return id;
}

/** A stable generated name for this tab: derived from the client id, so a reload keeps it. */
export function suggestedName(clientId: string): string {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) hash = (hash * 31 + clientId.charCodeAt(i)) >>> 0;
  // Unsigned shift: `>>` would go negative for hashes above 2^31 and index off the end.
  return `${ADJECTIVES[hash % ADJECTIVES.length]}-${NOUNS[(hash >>> 5) % NOUNS.length]}`;
}

/** Chosen name first, then a `?name=` override (handy for demos), then the suggestion. */
export function getDisplayName(clientId: string): string {
  const chosen = sessionStorage.getItem(NAME_KEY);
  if (chosen) return chosen;
  const fromUrl = new URLSearchParams(location.search).get('name');
  if (fromUrl) return normalizeName(fromUrl);
  return suggestedName(clientId);
}

export function setDisplayName(name: string): string {
  const clean = normalizeName(name);
  sessionStorage.setItem(NAME_KEY, clean);
  return clean;
}

/** Protocol caps names at 24 chars; the server dedupes collisions. */
export const normalizeName = (raw: string): string =>
  raw.trim().replace(/\s+/g, '-').slice(0, 24) || 'anon';

/** `null` means "no room in the address" — show the lobby. */
export function getRoomId(): string | null {
  const raw = new URLSearchParams(location.search).get('room');
  if (!raw) return null;
  const clean = normalizeRoomId(raw);
  return clean || null;
}

/** Room ids are case-insensitive and URL-safe; the protocol caps them at 64 chars. */
export const normalizeRoomId = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

/**
 * A fresh room code, shaped to be read aloud: two groups of three, from an alphabet with
 * no 0/O or 1/I/L ambiguity. ~1 billion combinations; collisions are not a concern here
 * and would only mean two parties share a room, not a security failure.
 */
export function generateRoomCode(): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  const pick = () => alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}`;
}

/** Write the room into the address without a reload; the console mounts on the new value. */
export function navigateToRoom(roomId: string | null): void {
  const url = new URL(location.href);
  if (roomId) url.searchParams.set('room', roomId);
  else url.searchParams.delete('room');
  url.searchParams.delete('name');
  history.pushState({}, '', url);
}
