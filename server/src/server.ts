/**
 * Entry point: a plain `node:http` server that also speaks WebSocket.
 *
 * Layering, top to bottom:
 *   server.ts   HTTP, the Upgrade handshake, static files
 *   ws/*        RFC 6455 framing, close handshake, backpressure   (transport)
 *   hub.ts      connection -> session -> room routing, timers
 *   room.ts     presence, aggregation, conflict resolution        (application)
 *   protocol.ts message shapes + validation                       (contract)
 *
 * The server is exported as a factory and only auto-starts when this file is executed
 * directly, so the integration tests can run it in-process instead of shelling out.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Hub } from './hub.js';
import { MAX_FRAME_BYTES, PROTOCOL_VERSION, TICK_MS } from './protocol.js';
import { performHandshake } from './ws/handshake.js';
import { CLOSE } from './ws/frame.js';
import { WsConnection } from './ws/connection.js';

const here = fileURLToPath(new URL('.', import.meta.url));
/** Built client, if there is one. Lets a single process serve the demo in production. */
const CLIENT_DIST = resolve(here, '../../client/dist');

export interface SyncServerOptions {
  port?: number;
  host?: string;
  log?: (msg: string) => void;
}

export interface SyncServer {
  server: Server;
  hub: Hub;
  port: number;
  close: () => Promise<void>;
}

export function createSyncServer(options: SyncServerOptions = {}): Promise<SyncServer> {
  const log = options.log ?? (() => {});
  const hub = new Hub({ log });
  hub.start();

  /** Live upgraded connections, tracked purely so shutdown can be decisive. */
  const connections = new Set<WsConnection>();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/healthz') {
      return json(res, 200, { ok: true, protocol: PROTOCOL_VERSION, tickMs: TICK_MS });
    }
    if (url.pathname === '/stats') {
      return json(res, 200, hub.stats());
    }
    if (existsSync(CLIENT_DIST)) {
      return serveStatic(url.pathname, res);
    }
    return json(res, 404, {
      error: 'not found',
      hint: 'run the client with `npm run dev` — this process serves the WebSocket at /ws',
    });
  });

  /**
   * The Upgrade path. Node hands us the raw socket and gets out of the way; everything
   * after `performHandshake` is our own framing code.
   */
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const result = performHandshake(req, socket);
    if (!result.ok) {
      log(`upgrade rejected: ${result.message}`);
      return;
    }

    // Node types the upgrade socket as a Duplex; for a TCP server it is always a
    // net.Socket, and we want setNoDelay — Nagle's algorithm is the enemy of small,
    // frequent frames.
    const conn = new WsConnection(socket as Socket, {
      maxMessageBytes: MAX_FRAME_BYTES,
      // ~256KB of unflushed bytes means this client is not keeping up. Past that, ticks
      // are dropped for it rather than queued: stale positions have no value.
      highWaterMark: 256 * 1024,
    });
    connections.add(conn);
    log(`conn ${conn.id} open from ${conn.remote}`);
    hub.handleConnection(conn);

    // `hub` sets its own onClose; chain rather than overwrite.
    const hubOnClose = conn.onClose;
    conn.onClose = (code, reason) => {
      connections.delete(conn);
      hubOnClose?.(code, reason);
    };

    // Bytes that arrived in the same TCP segment as the handshake must not be lost.
    if (head && head.length > 0) socket.unshift(head);
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8787, options.host ?? '0.0.0.0', () => {
      server.removeListener('error', reject);
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : (options.port ?? 8787);
      resolvePromise({
        server,
        hub,
        port,
        close: () =>
          new Promise<void>((done) => {
            hub.stop();
            for (const conn of connections) conn.close(CLOSE.GOING_AWAY, 'server shutting down');
            connections.clear();
            server.close(() => done());
            // Keep-alive sockets can outlive close(); don't hang a test run on them.
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const PORT = Number(process.env.PORT ?? 8787);
  const HOST = process.env.HOST ?? '0.0.0.0';
  const VERBOSE = process.env.SYNC_LOG !== 'quiet';
  const log = (msg: string): void => {
    if (VERBOSE) console.log(`[${new Date().toISOString()}] ${msg}`);
  };

  const instance = await createSyncServer({ port: PORT, host: HOST, log });
  log(`sync server listening on http://${HOST}:${instance.port} (ws://${HOST}:${instance.port}/ws)`);
  log(`protocol v${PROTOCOL_VERSION}, tick ${TICK_MS}ms`);
  if (existsSync(CLIENT_DIST)) log(`serving built client from ${CLIENT_DIST}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      log(`${signal} received, shutting down`);
      void instance.close().then(() => process.exit(0));
      setTimeout(() => process.exit(0), 1_000).unref();
    });
  }
}

// ---------------------------------------------------------------------------
// Static file serving — only used when a production build of the client exists.
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function serveStatic(pathname: string, res: ServerResponse): void {
  // normalize() then a prefix check: the classic `../../etc/passwd` defence.
  const requested = normalize(join(CLIENT_DIST, decodeURIComponent(pathname)));
  let filePath = requested.startsWith(CLIENT_DIST) ? requested : CLIENT_DIST;

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(CLIENT_DIST, 'index.html'); // SPA fallback
  }
  if (!existsSync(filePath)) {
    return json(res, 404, { error: 'not found' });
  }

  res.writeHead(200, {
    'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(filePath).pipe(res);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
