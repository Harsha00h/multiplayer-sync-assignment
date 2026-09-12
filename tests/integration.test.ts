/**
 * End-to-end tests against a real server process, driven by a hand-written WebSocket
 * client. These are the tests that would catch the failures the brief calls out by name:
 * self-echo, zombie cursors, duplicate cursors on reconnect, and a server that dies on
 * malformed input.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { createSyncServer } from '../server/src/server.js';
import type { SyncServer } from '../server/src/server.js';
import { TestClient } from './ws-test-client.js';

/** Port 0 = let the OS pick a free one, so parallel runs never collide. */
let instance: SyncServer;
let PORT = 0;

const hello = (clientId: string, roomId: string, name = clientId, token?: string) =>
  ({ t: 'hello', v: PROTOCOL_VERSION, roomId, clientId, name, token }) as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  instance = await createSyncServer({ port: 0, host: '127.0.0.1' });
  PORT = instance.port;
});

after(async () => {
  await instance.close();
});

test('two clients join and see each other', async () => {
  const room = `r-${Date.now()}-a`;
  const a = await TestClient.connect(PORT);
  a.send(hello('alice', room));
  const welcomeA = await a.waitFor('welcome');
  assert.equal(welcomeA.resumed, false);
  assert.equal(welcomeA.peers.length, 0, 'first in an empty room');

  const b = await TestClient.connect(PORT);
  b.send(hello('bob', room));
  const welcomeB = await b.waitFor('welcome');
  assert.equal(welcomeB.peers.length, 1);
  assert.equal(welcomeB.peers[0].clientId, 'alice');

  const join = await a.waitFor('join');
  assert.equal(join.peer.clientId, 'bob');
  assert.notEqual(join.peer.pid, welcomeA.you.pid, 'pids must be unique within a room');
  assert.notEqual(join.peer.hue, welcomeA.you.hue, 'colours must differ');

  a.close();
  b.close();
});

test('cursor updates reach other clients and are never echoed back to the sender', async () => {
  const room = `r-${Date.now()}-b`;
  const a = await TestClient.connect(PORT);
  a.send(hello('alice', room));
  const welcomeA = await a.waitFor('welcome');
  const b = await TestClient.connect(PORT);
  b.send(hello('bob', room));
  await b.waitFor('welcome');
  await a.waitFor('join');

  a.send({ t: 'in', seq: 1, s: [[0, 4000, 6000]] });

  const tick = await b.waitUntil((m) => m.t === 'k' && !!m.c?.length);
  assert.equal(tick.t, 'k');
  if (tick.t !== 'k') throw new Error('unreachable');
  assert.deepEqual(tick.c?.[0].slice(0, 3), [welcomeA.you.pid, 4000, 6000]);

  // Give the server several ticks to (not) echo.
  await sleep(250);
  const selfEcho = a.received.some(
    (m) => m.t === 'k' && m.c?.some(([pid]) => pid === welcomeA.you.pid),
  );
  assert.equal(selfEcho, false, 'server must not send a client its own cursor back');

  a.close();
  b.close();
});

test('a client joining mid-session gets a snapshot of existing cursors', async () => {
  const room = `r-${Date.now()}-c`;
  const a = await TestClient.connect(PORT);
  a.send(hello('alice', room));
  const welcomeA = await a.waitFor('welcome');
  a.send({ t: 'in', seq: 1, s: [[0, 1234, 5678]] });
  await sleep(120);

  const c = await TestClient.connect(PORT);
  c.send(hello('carol', room));
  const welcomeC = await c.waitFor('welcome');

  const alice = welcomeC.peers.find((p) => p.clientId === 'alice');
  assert.ok(alice, 'alice should be in the snapshot');
  assert.deepEqual([alice.cursor?.x, alice.cursor?.y], [1234, 5678]);
  assert.ok(alice.cursor && alice.cursor.st > 0, 'snapshot cursor carries a server timestamp');

  a.close();
  c.close();
});

test('reactions are relayed with the sender pid', async () => {
  const room = `r-${Date.now()}-d`;
  const a = await TestClient.connect(PORT);
  a.send(hello('alice', room));
  const welcomeA = await a.waitFor('welcome');
  const b = await TestClient.connect(PORT);
  b.send(hello('bob', room));
  await b.waitFor('welcome');
  await a.waitFor('join');

  a.send({ t: 'react', seq: 1, dt: 0, x: 500, y: 500, k: 2 });
  const tick = await b.waitUntil((m) => m.t === 'k' && !!m.r?.length);
  if (tick.t !== 'k') throw new Error('unreachable');
  assert.deepEqual(tick.r?.[0].slice(0, 4), [welcomeA.you.pid, 500, 500, 2]);

  a.close();
  b.close();
});

test('a clean close removes the cursor immediately — no zombies', async () => {
  const room = `r-${Date.now()}-e`;
  const a = await TestClient.connect(PORT);
  a.send(hello('alice', room));
  const welcomeA = await a.waitFor('welcome');
  const b = await TestClient.connect(PORT);
  b.send(hello('bob', room));
  await b.waitFor('welcome');
  await a.waitFor('join');

  a.close();
  const leave = await b.waitFor('leave', 1_500);
  assert.equal(leave.pid, welcomeA.you.pid);

  b.close();
});

test('an abrupt drop greys the peer out immediately, then reaps it after the grace window', async () => {
  const room = `r-${Date.now()}-f`;
  const a = await TestClient.connect(PORT);
  a.send(hello('alice', room));
  const welcomeA = await a.waitFor('welcome');
  const b = await TestClient.connect(PORT);
  b.send(hello('bob', room));
  await b.waitFor('welcome');
  await a.waitFor('join');

  a.destroy(); // no close frame: the "laptop lid closed" case

  const offline = await b.waitUntil((m) => m.t === 'pres' && !m.online, 2_000);
  assert.equal(offline.t === 'pres' && offline.pid, welcomeA.you.pid);

  const leave = await b.waitFor('leave', 9_000);
  assert.equal(leave.pid, welcomeA.you.pid);
  assert.equal(leave.reason, 'timeout');

  b.close();
});

test('a reconnect resumes the same seat instead of creating a second cursor', async () => {
  const room = `r-${Date.now()}-g`;
  const a = await TestClient.connect(PORT);
  a.send(hello('alice', room));
  const welcomeA = await a.waitFor('welcome');
  const b = await TestClient.connect(PORT);
  b.send(hello('bob', room));
  await b.waitFor('welcome');
  await a.waitFor('join');

  a.destroy();
  await b.waitUntil((m) => m.t === 'pres' && !m.online, 2_000);

  const a2 = await TestClient.connect(PORT);
  a2.send(hello('alice', room, 'alice', welcomeA.token));
  const welcomeA2 = await a2.waitFor('welcome');

  assert.equal(welcomeA2.resumed, true, 'server should recognise the seat');
  assert.equal(welcomeA2.you.pid, welcomeA.you.pid, 'same pid');
  assert.equal(welcomeA2.you.hue, welcomeA.you.hue, 'same colour');

  await b.waitUntil((m) => m.t === 'pres' && m.online, 2_000);

  // From bob's side the whole episode must read as "alice went offline, alice came
  // back" — a presence transition on an existing seat. Bob received alice in his
  // welcome snapshot, so a correct resume produces *no* join and *no* leave at all;
  // either one would mean a second cursor appeared or the first one vanished.
  assert.deepEqual(
    b.received.filter((m) => m.t === 'join' || m.t === 'leave'),
    [],
    'a resume must not look like a new participant',
  );
  assert.deepEqual(
    b.received.filter((m) => m.t === 'pres').map((m) => (m.t === 'pres' ? m.online : null)),
    [false, true],
    'exactly one offline -> online transition',
  );

  a2.close();
  b.close();
});

test('malformed frames are rejected without killing the connection or the room', async () => {
  const room = `r-${Date.now()}-h`;
  const a = await TestClient.connect(PORT);
  a.send(hello('alice', room));
  await a.waitFor('welcome');

  a.sendText('{not json');
  const err1 = await a.waitFor('err');
  assert.equal(err1.code, 'bad_message');
  assert.equal(err1.fatal, false);

  a.sendText(JSON.stringify({ t: 'teleport', x: 1 }));
  await a.waitUntil((m) => m.t === 'err' && /unknown message type/.test(m.msg), 2_000);

  // Still alive and still syncing after garbage input.
  const b = await TestClient.connect(PORT);
  b.send(hello('bob', room));
  await b.waitFor('welcome');
  b.send({ t: 'in', seq: 1, s: [[0, 100, 100]] });
  await a.waitUntil((m) => m.t === 'k' && !!m.c?.length, 2_000);
  assert.equal(a.closed, false);

  a.close();
  b.close();
});

test('a connection that does not say hello first is closed', async () => {
  const a = await TestClient.connect(PORT);
  a.send({ t: 'in', seq: 1, s: [[0, 1, 1]] });
  const err = await a.waitFor('err');
  assert.equal(err.fatal, true);
  await sleep(200);
  assert.equal(a.closed, true);
});

test('stale samples inside a batch are discarded', async () => {
  const room = `r-${Date.now()}-i`;
  const a = await TestClient.connect(PORT);
  a.send(hello('alice', room));
  await a.waitFor('welcome');
  const b = await TestClient.connect(PORT);
  b.send(hello('bob', room));
  await b.waitFor('welcome');
  await a.waitFor('join');

  // Three samples, deliberately out of order: 100ms ago, 300ms ago, 200ms ago.
  // Only the first is newer than everything before it; the other two are stale.
  a.send({ t: 'in', seq: 1, s: [[100, 10, 10], [300, 20, 20], [200, 30, 30]] });

  const tick = await b.waitUntil((m) => m.t === 'k' && !!m.c?.length);
  if (tick.t !== 'k') throw new Error('unreachable');
  assert.equal(tick.c?.length, 1, 'only the newest sample should survive');
  assert.equal(tick.c?.[0][1], 10);

  a.close();
  b.close();
});

test('simultaneous taps on the target are resolved deterministically', async () => {
  const room = `r-${Date.now()}-k`;
  const a = await TestClient.connect(PORT);
  a.send(hello('alice', room));
  const welcomeA = await a.waitFor('welcome');
  const b = await TestClient.connect(PORT);
  b.send(hello('bob', room));
  const welcomeB = await b.waitFor('welcome');
  await a.waitFor('join');

  const target = welcomeA.target;
  assert.deepEqual([target.x, target.y], [welcomeB.target.x, welcomeB.target.y]);

  // Both tap the target inside the same server tick. Bob's tap is stamped as having
  // happened 20ms *earlier* than alice's (dt is "how long ago"), so bob must win even
  // though alice's frame is written first.
  a.send({ t: 'react', seq: 1, dt: 0, x: target.x, y: target.y, k: 0 });
  b.send({ t: 'react', seq: 1, dt: 20, x: target.x, y: target.y, k: 0 });

  const result = await a.waitFor('target', 2_000);
  assert.equal(result.target.heldBy, welcomeB.you.pid, 'earliest capture time wins');
  assert.deepEqual(result.lost, [welcomeA.you.pid], 'the loser is told, not silently dropped');
  assert.equal(result.target.gen, target.gen + 1);
  assert.notDeepEqual([result.target.x, result.target.y], [target.x, target.y], 'target moves');
  assert.deepEqual(result.target.scores, [[welcomeB.you.pid, 1]]);

  // Every observer agrees — the resolution is server-side, not raced per client.
  const fromB = await b.waitFor('target', 2_000);
  assert.deepEqual(fromB.target, result.target);

  a.close();
  b.close();
});

test('the room disappears when the last member leaves', async () => {
  const room = `r-${Date.now()}-j`;
  const a = await TestClient.connect(PORT);
  a.send(hello('alice', room));
  await a.waitFor('welcome');

  let stats = await (await fetch(`http://127.0.0.1:${PORT}/stats`)).json();
  assert.ok(stats.rooms.some((r: { roomId: string }) => r.roomId === room));

  a.close();
  await sleep(300);
  stats = await (await fetch(`http://127.0.0.1:${PORT}/stats`)).json();
  assert.equal(
    stats.rooms.some((r: { roomId: string }) => r.roomId === room),
    false,
    'empty rooms must not leak',
  );
});
