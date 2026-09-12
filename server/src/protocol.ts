/**
 * The server's view of the wire protocol.
 *
 * The definitions live in `/shared/protocol.ts` so that client and server are physically
 * incapable of drifting apart — there is one file describing the wire, imported by both.
 * This module exists so server code can `import ... from './protocol.js'` as the
 * submission layout expects, and is the place any server-only protocol helper would go.
 */
export * from '../../shared/protocol.js';
