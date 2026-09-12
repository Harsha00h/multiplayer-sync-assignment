/**
 * The hub owns rooms and the two timers that drive everything: the broadcast tick and
 * the heartbeat sweep.
 *
 * Deliberately one interval for all rooms rather than one per room — with a handful of
 * rooms it makes no difference, but it keeps teardown honest and means the tick budget
 * is visible in one place.
 */
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  TICK_MS,
  encodeServerMessage,
  parseClientMessage,
} from './protocol.js';
import { Room } from './room.js';
import type { Member } from './room.js';
import { CLOSE } from './ws/frame.js';
import type { WsConnection } from './ws/connection.js';

export interface HubOptions {
  log: (msg: string) => void;
}

/** Per-connection state that exists before the client has identified itself. */
interface Session {
  room: Room | null;
  member: Member | null;
  /** Frames rejected by the validator; a few are tolerable, a stream of them is not. */
  badFrames: number;
}

const MAX_BAD_FRAMES = 5;

export class Hub {
  private readonly rooms = new Map<string, Room>();
  private tickTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: HubOptions) {}

  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.runTick(), TICK_MS);
    this.heartbeatTimer = setInterval(() => this.runHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.tickTimer = null;
    this.heartbeatTimer = null;
  }

  /**
   * Wire an upgraded socket into the application.
   *
   * Note what this function does *not* do: it never touches frames, masks, or opcodes.
   * The transport hands it strings; it hands the transport strings back. Adding a new
   * action type means editing the protocol and the room, and nothing below this line.
   */
  handleConnection(conn: WsConnection): void {
    const session: Session = { room: null, member: null, badFrames: 0 };

    conn.onText = (raw) => {
      const now = Date.now();
      const parsed = parseClientMessage(raw);

      if (!parsed.ok) {
        // Malformed input is a client bug or an attack; either way it is *rejected*,
        // never partially applied, and it never reaches room logic.
        session.badFrames++;
        this.opts.log(`conn ${conn.id}: rejected frame (${parsed.error})`);
        const fatal = session.badFrames >= MAX_BAD_FRAMES;
        conn.send(
          encodeServerMessage({ t: 'err', code: 'bad_message', msg: parsed.error, fatal }),
          false,
        );
        if (fatal) conn.close(CLOSE.POLICY_VIOLATION, 'too many malformed frames');
        return;
      }

      const msg = parsed.value;

      if (!session.member) {
        if (msg.t !== 'hello') {
          conn.send(
            encodeServerMessage({
              t: 'err',
              code: 'bad_message',
              msg: 'first frame must be hello',
              fatal: true,
            }),
            false,
          );
          conn.close(CLOSE.POLICY_VIOLATION, 'hello expected');
          return;
        }
        const room = this.getOrCreateRoom(msg.roomId);
        const member = room.join(conn, msg, now);
        if (!member) return; // join() already sent the error and closed
        session.room = room;
        session.member = member;
        return;
      }

      session.room?.handleMessage(session.member, msg, now);
    };

    conn.onClose = (code, reason) => {
      const now = Date.now();
      this.opts.log(`conn ${conn.id} closed (${code} ${reason})`);
      if (session.room && session.member) {
        session.room.handleDisconnect(session.member, conn, code, now);
        this.reapIfEmpty(session.room);
      }
    };
  }

  private getOrCreateRoom(roomId: string): Room {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId, this.opts.log);
      this.rooms.set(roomId, room);
      this.opts.log(`room ${roomId}: created (${this.rooms.size} live)`);
    }
    return room;
  }

  private reapIfEmpty(room: Room): void {
    if (!room.isEmpty) return;
    this.rooms.delete(room.roomId);
    this.opts.log(`room ${room.roomId}: empty, discarded`);
  }

  private runTick(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) room.tick(now);
  }

  private runHeartbeat(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      room.dropSilentConnections(now, HEARTBEAT_TIMEOUT_MS);
    }
  }

  stats(): { rooms: { roomId: string; members: number; connected: number }[] } {
    return {
      rooms: [...this.rooms.values()].map((r) => ({
        roomId: r.roomId,
        members: r.size,
        connected: r.connectedCount,
      })),
    };
  }
}
