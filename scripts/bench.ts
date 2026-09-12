/**
 * Bandwidth / fan-out benchmark.
 *
 * Spins up the real server in-process, connects N synthetic clients that move their
 * cursors like humans do (30Hz sampling, 20Hz flush — the same rates the real client
 * uses), and reports what actually crosses the wire. The numbers quoted in README.md
 * come from this script; run it yourself with `npm run bench`.
 *
 *   npm run bench -- --clients 5 --seconds 10
 */
import { createSyncServer } from '../server/src/server.js';
import { CLIENT_SAMPLE_HZ, COORD_SCALE, TICK_MS } from '../shared/protocol.js';
import { TestClient } from '../tests/ws-test-client.js';

const arg = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
};

const CLIENTS = arg('clients', 5);
const SECONDS = arg('seconds', 10);
/**
 * `--naive` is the strawman the brief warns against: every pointer event sent as its own
 * frame, uncapped, no batching. It exists so the throttling claim in the README is a
 * measurement rather than an assertion.
 */
const NAIVE = process.argv.includes('--naive');
const SAMPLE_HZ = NAIVE ? 120 : CLIENT_SAMPLE_HZ;
const FLUSH_MS = NAIVE ? 0 : TICK_MS;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const instance = await createSyncServer({ port: 0, host: '127.0.0.1' });
  const room = 'bench';
  const clients: TestClient[] = [];
  const sent = new Array<number>(CLIENTS).fill(0);

  for (let i = 0; i < CLIENTS; i++) {
    const client = await TestClient.connect(instance.port);
    client.send({ t: 'hello', v: 1, roomId: room, clientId: `bench-${i}`, name: `bench-${i}` });
    await client.waitFor('welcome');
    clients.push(client);
  }
  await sleep(200);

  const startedAt = Date.now();
  const baseline = clients.map((c) => c.rawReceived.reduce((n, s) => n + s.length, 0));

  // Each client samples at CLIENT_SAMPLE_HZ and flushes on the tick cadence, exactly
  // like client/src/net/room.ts.
  const pending: { dt: number; x: number; y: number }[][] = clients.map(() => []);
  let seq = 0;

  const emit = (i: number, samples: [number, number, number][]): void => {
    const payload = JSON.stringify({ t: 'in', seq: ++seq, s: samples });
    sent[i] += payload.length;
    clients[i].sendText(payload);
  };

  const samplers = clients.map((_, i) =>
    setInterval(() => {
      const t = (Date.now() - startedAt) / 1000;
      const sample = {
        dt: 0,
        x: Math.round(((Math.sin(t * 1.3 + i) + 1) / 2) * COORD_SCALE),
        y: Math.round(((Math.cos(t * 0.9 + i) + 1) / 2) * COORD_SCALE),
      };
      if (NAIVE) emit(i, [[sample.dt, sample.x, sample.y]]);
      else pending[i].push(sample);
    }, 1000 / SAMPLE_HZ),
  );

  const flushers = NAIVE
    ? []
    : clients.map((_, i) =>
        setInterval(() => {
          if (pending[i].length === 0) return;
          const samples = pending[i].map((s) => [s.dt, s.x, s.y] as [number, number, number]);
          pending[i] = [];
          emit(i, samples);
        }, FLUSH_MS),
      );

  await sleep(SECONDS * 1000);
  for (const t of [...samplers, ...flushers]) clearInterval(t);

  const elapsed = (Date.now() - startedAt) / 1000;
  const inbound = clients.map(
    (c, i) => c.rawReceived.reduce((n, s) => n + s.length, 0) - baseline[i],
  );
  const frames = clients.map((c) => c.received.filter((m) => m.t === 'k').length);

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  console.log(
    `\n${NAIVE ? 'NAIVE (one frame per pointer event)' : 'THROTTLED + BATCHED'}  ` +
      `clients=${CLIENTS}  duration=${elapsed.toFixed(1)}s  tick=${TICK_MS}ms  sample=${SAMPLE_HZ}Hz\n`,
  );
  console.log(`  per client, outbound : ${(avg(sent) / elapsed / 1024).toFixed(2)} KB/s`);
  console.log(`  per client, inbound  : ${(avg(inbound) / elapsed / 1024).toFixed(2)} KB/s`);
  console.log(`  per client, ticks/s  : ${(avg(frames) / elapsed).toFixed(1)}`);
  console.log(`  bytes per tick       : ${(avg(inbound) / avg(frames)).toFixed(0)} B`);
  console.log(
    `  server total egress  : ${((avg(inbound) * CLIENTS) / elapsed / 1024).toFixed(2)} KB/s\n`,
  );

  for (const c of clients) c.close();
  await instance.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
