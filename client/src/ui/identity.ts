/**
 * Client identity.
 *
 * `clientId` lives in **sessionStorage**, which is per-tab. That is the whole trick
 * behind the demo:
 *   - five tabs = five distinct clients, exactly as if they were five devices;
 *   - reloading a tab keeps its id, so the server recognises the seat and *resumes* it
 *     instead of spawning a second cursor. That is the reconnect path, testable with
 *     nothing more than Cmd-R.
 */
const KEY = 'sync.clientId';

const ADJECTIVES = ['swift', 'calm', 'bright', 'lucky', 'bold', 'keen', 'sly', 'warm'];
const NOUNS = ['otter', 'falcon', 'comet', 'maple', 'ember', 'pike', 'wren', 'delta'];

export function getClientId(): string {
  const existing = sessionStorage.getItem(KEY);
  if (existing) return existing;
  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  sessionStorage.setItem(KEY, id);
  return id;
}

/** Stable per tab: derived from the client id, so a reload keeps the same name. */
export function getDisplayName(clientId: string): string {
  const fromUrl = new URLSearchParams(location.search).get('name');
  if (fromUrl) return fromUrl.slice(0, 24);
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) hash = (hash * 31 + clientId.charCodeAt(i)) >>> 0;
  // Unsigned shift: `>>` would go negative for hashes above 2^31 and index off the end.
  return `${ADJECTIVES[hash % ADJECTIVES.length]}-${NOUNS[(hash >>> 5) % NOUNS.length]}`;
}

export function getRoomId(): string {
  return new URLSearchParams(location.search).get('room') ?? 'watch-party-42';
}
