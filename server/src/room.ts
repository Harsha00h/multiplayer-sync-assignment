/**
 * Room = presence + the per-tick aggregation of relayed events.
 *
 * What the server *owns* (authoritative): the member list, pid assignment, colors, the
 * timeline (every event is stamped with server time on arrival), the tap target and the
 * scoreboard.
 *
 * What the server merely *relays*: cursor positions and reaction bursts. It keeps the
 * latest cursor per member only so that a joiner can be handed a snapshot instead of
 * staring at an empty canvas until everyone happens to move.
 */
import { randomUUID } from 'node:crypto';
import {
  COORD_SCALE,
  MAX_SAMPLES_PER_TICK,
  MAX_SAMPLE_AGE_MS,
  PROTOCOL_VERSION,
  RESUME_GRACE_MS,
  TARGET_HOLD_MS,
  TARGET_RADIUS,
  TICK_MS,
  encodeServerMessage,
} from './protocol.js';
import type {
  ClientMessage,
  HelloMsg,
  PeerCursor,
  PeerSnapshot,
  Pid,
  ServerMessage,
  TargetState,
  TickCursorTuple,
  TickMsg,
  TickReactionTuple,
} from './protocol.js';
import { CLOSE, encodeText } from './ws/frame.js';
import type { WsConnection } from './ws/connection.js';

/** Per-second budgets. Generous for a real client, tight enough to stop a hot loop. */
const LIMIT_MESSAGES_PER_SEC = 120;
const LIMIT_SAMPLES_PER_SEC = 240;
const LIMIT_STRIKES = 3;

const MAX_MEMBERS = 64;

export interface Member {
  pid: Pid;
  clientId: string;
  name: string;
  hue: number;
  /** Presented on reconnect to resume this seat. */
  token: string;
  conn: WsConnection | null;
  online: boolean;
  joinedAt: number;

  /** Latest known cursor, in server time. Used for join snapshots. */
  cursor: PeerCursor | null;
  /** Server time of the newest sample accepted so far — the stale-update filter. */
  lastSampleSt: number;
  /** Highest `seq` seen on the current connection; resets on reconnect. */
  lastSeq: number;

  /** Buffered until the next tick. */
  pendingCursors: PeerCursor[];
  pendingReactions: { x: number; y: number; k: number; st: number }[];

  score: number;

  /** Reconnect grace timer, armed on an unclean disconnect. */
  graceTimer: NodeJS.Timeout | null;

  // Rate limiting (fixed 1s window; simple and good enough here).
  windowStart: number;
  windowMessages: number;
  windowSamples: number;
  strikes: number;
}

export class Room {
  private readonly members = new Map<Pid, Member>();
  private readonly byClientId = new Map<string, Member>();
  private nextPid = 1;
  /**
   * Room-wide tick counter. Every recipient of a given tick sees the same `seq`, which
   * is what lets one encoded frame be shared across the fan-out. Clients use it to
   * discard a duplicated or reordered tick — not as a loss counter, because a client is
   * legitimately skipped for any tick that contained only its own events.
   */
  private tickSeq = 0;
  private nextHue = Math.floor(Math.random() * 360);

  private target: TargetState;
  /** Taps that landed on the target this tick, resolved together at tick time. */
  private pendingClaims: { pid: Pid; st: number }[] = [];

  constructor(
    readonly roomId: string,
    private readonly log: (msg: string) => void,
  ) {
    this.target = {
      ...randomTargetPosition(),
      heldBy: null,
      until: 0,
      gen: 1,
      scores: [],
    };
  }

  get size(): number {
    return this.members.size;
  }

  get connectedCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.online) n++;
    return n;
  }

  get isEmpty(): boolean {
    return this.members.size === 0;
  }

  // -------------------------------------------------------------------------
  // Join / resume
  // -------------------------------------------------------------------------

  /**
   * Attach a connection to a seat.
   *
   * Three cases, and getting them right is the whole "no duplicate cursors" story:
   *   1. Unknown clientId          -> new seat, new pid, broadcast join.
   *   2. Known clientId, seat idle -> resume: same pid, same color, broadcast online.
   *   3. Known clientId, seat live -> the old connection is stale (e.g. a laptop that
   *      slept and whose FIN never arrived). Close it with 4001 and take over the seat.
   *      Deliberately *not* a second cursor.
   */
  join(conn: WsConnection, hello: HelloMsg, now: number): Member | null {
    if (hello.v !== PROTOCOL_VERSION) {
      this.sendTo(conn, {
        t: 'err',
        code: 'bad_version',
        msg: `server speaks protocol v${PROTOCOL_VERSION}`,
        fatal: true,
      });
      conn.close(CLOSE.POLICY_VIOLATION, 'protocol version');
      return null;
    }

    const existing = this.byClientId.get(hello.clientId);
    let member: Member;
    let resumed = false;

    if (existing && existing.token === hello.token) {
      resumed = true;
      member = existing;
      if (member.graceTimer) {
        clearTimeout(member.graceTimer);
        member.graceTimer = null;
      }
      if (member.conn && member.conn !== conn) {
        this.log(`room ${this.roomId}: pid ${member.pid} replaced by a newer connection`);
        // Detach first: `handleDisconnect` compares the closing connection against the
        // seat's current one, so the stale close becomes a no-op for this seat. We must
        // NOT null its onClose to achieve that — that handler is also how the HTTP layer
        // drops the connection from its tracking set.
        const stale = member.conn;
        member.conn = null;
        stale.close(CLOSE.REPLACED, 'replaced by newer connection');
      }
      member.conn = conn;
      member.name = this.uniqueName(hello.name, member.pid);
      member.lastSeq = -1;
      member.online = true;
    } else {
      if (this.members.size >= MAX_MEMBERS) {
        this.sendTo(conn, { t: 'err', code: 'room_full', msg: 'room is full', fatal: true });
        conn.close(CLOSE.POLICY_VIOLATION, 'room full');
        return null;
      }
      // A clientId we know but whose token doesn't match is treated as a brand new
      // client: tokens are the only thing preventing one tab from stealing another's seat.
      if (existing) this.removeMember(existing, 'replaced', now);

      const pid = this.nextPid++;
      member = {
        pid,
        clientId: hello.clientId,
        name: this.uniqueName(hello.name, pid),
        hue: this.allocateHue(),
        token: randomUUID(),
        conn,
        online: true,
        joinedAt: now,
        cursor: null,
        lastSampleSt: 0,
        lastSeq: -1,
        pendingCursors: [],
        pendingReactions: [],
        score: 0,
        graceTimer: null,
        windowStart: now,
        windowMessages: 0,
        windowSamples: 0,
        strikes: 0,
      };
      this.members.set(member.pid, member);
      this.byClientId.set(member.clientId, member);
    }

    conn.label = `${this.roomId}#${member.pid}`;

    this.sendTo(conn, {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      st: now,
      tick: TICK_MS,
      token: member.token,
      you: publicInfo(member),
      resumed,
      // The snapshot: every other member plus their last known cursor. This is the
      // answer to "what does a client joining mid-session see?" — immediate, one frame,
      // no replay log, no waiting for the next mousemove.
      peers: this.snapshotPeers(member.pid),
      target: this.targetWithScores(),
    });

    if (resumed) {
      this.broadcast({ t: 'pres', st: now, pid: member.pid, online: true }, member.pid);
    } else {
      this.broadcast(
        { t: 'join', st: now, peer: { ...publicInfo(member), cursor: member.cursor } },
        member.pid,
      );
    }

    this.log(
      `room ${this.roomId}: ${resumed ? 'resume' : 'join'} pid=${member.pid} ` +
        `client=${member.clientId.slice(0, 8)} members=${this.members.size}`,
    );
    return member;
  }

  // -------------------------------------------------------------------------
  // Inbound messages
  // -------------------------------------------------------------------------

  handleMessage(member: Member, msg: ClientMessage, now: number): void {
    if (!this.checkRate(member, msg, now)) return;

    switch (msg.t) {
      case 'hello':
        // A second hello on a live connection is meaningless; ignore rather than close.
        return;

      case 'in': {
        // Per-connection ordering is guaranteed by TCP, so `seq` going backwards means a
        // duplicate or a frame from a connection we already replaced. Drop it.
        if (msg.seq <= member.lastSeq) return;
        member.lastSeq = msg.seq;

        for (const [dt, x, y] of msg.s) {
          // The client's clock is used only for the *relative* offset inside this batch.
          const st = now - Math.min(dt, MAX_SAMPLE_AGE_MS);
          if (st <= member.lastSampleSt) continue; // stale or out-of-order sample
          member.lastSampleSt = st;
          member.cursor = { x, y, st };
          member.pendingCursors.push({ x, y, st });
        }
        // Bound the per-tick payload: under a burst we keep the newest samples, because
        // an old position nobody rendered yet is worth less than the current one.
        if (member.pendingCursors.length > MAX_SAMPLES_PER_TICK) {
          member.pendingCursors.splice(0, member.pendingCursors.length - MAX_SAMPLES_PER_TICK);
        }
        return;
      }

      case 'react': {
        if (msg.seq <= member.lastSeq) return;
        member.lastSeq = msg.seq;
        const st = now - Math.min(msg.dt, MAX_SAMPLE_AGE_MS);
        member.pendingReactions.push({ x: msg.x, y: msg.y, k: msg.k, st });
        if (member.pendingReactions.length > 8) member.pendingReactions.shift();

        // Did this tap land on the target? Queue it; contested taps are resolved together
        // at tick time so that "simultaneous" actually means something.
        if (now >= this.target.until && withinTarget(msg.x, msg.y, this.target)) {
          this.pendingClaims.push({ pid: member.pid, st });
        }
        return;
      }

      case 'ping':
        // Answered immediately rather than on the tick: an RTT measurement that waits for
        // the next tick measures the tick, not the network.
        this.sendTo(member.conn, { t: 'pong', id: msg.id, ct: msg.ct, st: now });
        return;

      case 'bye':
        this.removeMember(member, 'bye', now);
        member.conn?.close(CLOSE.NORMAL, 'bye');
        return;
    }
  }

  /** Fixed-window limiter. Three strikes and the connection goes away. */
  private checkRate(member: Member, msg: ClientMessage, now: number): boolean {
    if (now - member.windowStart >= 1_000) {
      member.windowStart = now;
      member.windowMessages = 0;
      member.windowSamples = 0;
    }
    member.windowMessages++;
    if (msg.t === 'in') member.windowSamples += msg.s.length;

    if (
      member.windowMessages <= LIMIT_MESSAGES_PER_SEC &&
      member.windowSamples <= LIMIT_SAMPLES_PER_SEC
    ) {
      return true;
    }

    member.strikes++;
    if (member.strikes >= LIMIT_STRIKES) {
      this.sendTo(member.conn, {
        t: 'err',
        code: 'rate_limit',
        msg: 'too many messages',
        fatal: true,
      });
      member.conn?.close(CLOSE.POLICY_VIOLATION, 'rate limit');
    } else if (member.windowMessages === LIMIT_MESSAGES_PER_SEC + 1) {
      this.sendTo(member.conn, {
        t: 'err',
        code: 'rate_limit',
        msg: 'slow down: cursor updates are capped server-side',
        fatal: false,
      });
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------

  /**
   * Called when a connection attached to this member closes.
   *
   * Clean close  -> the seat goes away immediately.
   * Unclean drop -> the seat is marked offline right now (so nobody sees a frozen
   *                 cursor pretending to be live) and is destroyed after RESUME_GRACE_MS
   *                 unless the client comes back and resumes it.
   */
  handleDisconnect(member: Member, conn: WsConnection, code: number, now: number): void {
    // A connection that was already superseded by a resume must not tear down the seat
    // that its replacement now owns.
    if (member.conn !== conn) return;
    member.conn = null;

    // "Clean" means the peer actually performed the WebSocket close handshake — a
    // closed tab, a navigation, an explicit bye. Anything else (1006) is a network
    // failure that the client may well recover from in a second or two.
    const clean = code === CLOSE.NORMAL || code === CLOSE.GOING_AWAY;
    if (clean) {
      this.removeMember(member, 'closed', now);
      return;
    }

    if (!member.online) return;
    member.online = false;
    member.pendingCursors.length = 0;
    member.pendingReactions.length = 0;
    this.broadcast({ t: 'pres', st: now, pid: member.pid, online: false });
    this.log(`room ${this.roomId}: pid=${member.pid} offline, ${RESUME_GRACE_MS}ms to resume`);

    member.graceTimer = setTimeout(() => {
      member.graceTimer = null;
      if (!member.online) this.removeMember(member, 'timeout', Date.now());
    }, RESUME_GRACE_MS);
    member.graceTimer.unref?.();
  }

  private removeMember(member: Member, reason: 'bye' | 'closed' | 'timeout' | 'replaced', now: number): void {
    if (!this.members.has(member.pid)) return;
    if (member.graceTimer) clearTimeout(member.graceTimer);
    this.members.delete(member.pid);
    if (this.byClientId.get(member.clientId) === member) this.byClientId.delete(member.clientId);
    this.pendingClaims = this.pendingClaims.filter((c) => c.pid !== member.pid);
    this.broadcast({ t: 'leave', st: now, pid: member.pid, reason });
    this.log(`room ${this.roomId}: leave pid=${member.pid} (${reason}) members=${this.members.size}`);
  }

  /** Called by the hub's heartbeat sweep. */
  dropSilentConnections(now: number, timeoutMs: number): void {
    for (const member of this.members.values()) {
      const conn = member.conn;
      if (!conn) continue;
      if (now - conn.lastSeenAt > timeoutMs) {
        this.log(`room ${this.roomId}: pid=${member.pid} heartbeat timeout`);
        conn.close(CLOSE.GOING_AWAY, 'heartbeat timeout');
      } else {
        conn.ping();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  /**
   * Build one aggregated broadcast and fan it out.
   *
   * Fan-out shape: events are collected once into a shared array. Members who
   * contributed nothing this tick all receive the *same* bytes, encoded once. Members
   * who did contribute get a filtered copy, because we never echo a client's own cursor
   * back to it — the client already drew that position locally, at zero latency, and
   * re-rendering the echo is how you get a rubber-banding cursor.
   *
   * Cost is O(members + events) for the common case and O(contributors x events) worst
   * case, not O(n^2) re-serialization per recipient.
   */
  tick(now: number): void {
    this.resolveClaims(now);

    const cursors: TickCursorTuple[] = [];
    const reactions: TickReactionTuple[] = [];
    const contributors = new Set<Pid>();

    for (const member of this.members.values()) {
      const hasCursor = member.pendingCursors.length > 0;
      const hasReaction = member.pendingReactions.length > 0;
      if (!hasCursor && !hasReaction) continue;
      contributors.add(member.pid);

      for (const c of member.pendingCursors) {
        cursors.push([member.pid, c.x, c.y, clampAge(now - c.st)]);
      }
      for (const r of member.pendingReactions) {
        reactions.push([member.pid, r.x, r.y, r.k, clampAge(now - r.st)]);
      }
      member.pendingCursors.length = 0;
      member.pendingReactions.length = 0;
    }

    if (cursors.length === 0 && reactions.length === 0) return;
    const seq = ++this.tickSeq;

    // Encoded lazily, and at most once, for every member who sent nothing this tick.
    let sharedFrame: Buffer | null = null;

    for (const member of this.members.values()) {
      const conn = member.conn;
      if (!conn || !member.online) continue;

      if (!contributors.has(member.pid)) {
        sharedFrame ??= encodeText(
          encodeServerMessage(buildTick(now, seq, cursors, reactions)),
        );
        conn.sendPrepared(sharedFrame, true);
        continue;
      }

      const myCursors = cursors.filter((c) => c[0] !== member.pid);
      const myReactions = reactions.filter((r) => r[0] !== member.pid);
      if (myCursors.length === 0 && myReactions.length === 0) continue;
      conn.send(encodeServerMessage(buildTick(now, seq, myCursors, myReactions)), true);
    }
  }

  /**
   * Conflict resolution for simultaneous taps on the target.
   *
   * Two clients can genuinely tap the same target "at the same time": their frames land
   * in the same 50ms tick. Rather than let arrival order at the TCP layer decide (which
   * rewards whoever has the shorter cable, and is unstable), we order by the *captured*
   * server timestamp — the moment the tap happened, reconstructed on arrival — and break
   * exact ties deterministically by pid so every observer agrees. Losers are told they
   * lost, so the UI can show the near-miss instead of silently dropping their input.
   */
  private resolveClaims(now: number): void {
    if (this.pendingClaims.length === 0) return;
    const claims = this.pendingClaims;
    this.pendingClaims = [];

    if (now < this.target.until) return; // cooldown started mid-tick; everyone missed

    claims.sort((a, b) => a.st - b.st || a.pid - b.pid);
    const winner = claims[0];
    const losers = claims.slice(1).map((c) => c.pid);

    const member = this.members.get(winner.pid);
    if (member) member.score++;

    this.target = {
      ...randomTargetPosition(),
      heldBy: winner.pid,
      until: now + TARGET_HOLD_MS,
      gen: this.target.gen + 1,
      scores: [],
    };
    this.broadcast({
      t: 'target',
      st: now,
      target: this.targetWithScores(),
      lost: losers.length ? losers : undefined,
    });
  }

  // -------------------------------------------------------------------------
  // Send helpers
  // -------------------------------------------------------------------------

  private broadcast(msg: ServerMessage, exceptPid?: Pid): void {
    const frame = encodeText(encodeServerMessage(msg));
    for (const member of this.members.values()) {
      if (member.pid === exceptPid) continue;
      // Presence-class messages are not droppable: losing a `leave` leaves a zombie.
      member.conn?.sendPrepared(frame, false);
    }
  }

  private sendTo(conn: WsConnection | null, msg: ServerMessage): void {
    conn?.send(encodeServerMessage(msg), false);
  }

  private snapshotPeers(exceptPid: Pid): PeerSnapshot[] {
    const out: PeerSnapshot[] = [];
    for (const member of this.members.values()) {
      if (member.pid === exceptPid) continue;
      out.push({ ...publicInfo(member), cursor: member.cursor });
    }
    return out;
  }

  private targetWithScores(): TargetState {
    const scores: [Pid, number][] = [];
    for (const m of this.members.values()) if (m.score > 0) scores.push([m.pid, m.score]);
    return { ...this.target, scores };
  }

  /**
   * Display names are client-supplied and clients pick them independently, so two people
   * can absolutely turn up as the same name. The server is the only party that can see
   * the whole room, so it is the only party that can fix it: suffix duplicates.
   * The result is re-truncated to the protocol's 24-char limit — a name that overflowed
   * it would be rejected by the *receiving* client's validator, which would turn a
   * cosmetic clash into a dropped presence frame.
   */
  private uniqueName(requested: string, forPid: Pid): string {
    const taken = new Set<string>();
    for (const m of this.members.values()) if (m.pid !== forPid) taken.add(m.name);
    if (!taken.has(requested)) return requested;
    for (let n = 2; n < 100; n++) {
      const suffix = ` ${n}`;
      const candidate = requested.slice(0, 24 - suffix.length) + suffix;
      if (!taken.has(candidate)) return candidate;
    }
    return requested.slice(0, 24);
  }

  /** Spread hues around the wheel so two members are never the same color by accident. */
  private allocateHue(): number {
    const hue = this.nextHue % 360;
    this.nextHue += 137; // golden-angle-ish stride
    return hue;
  }
}

function buildTick(
  st: number,
  seq: number,
  cursors: TickCursorTuple[],
  reactions: TickReactionTuple[],
): TickMsg {
  const msg: TickMsg = { t: 'k', st, seq };
  if (cursors.length) msg.c = cursors;
  if (reactions.length) msg.r = reactions;
  return msg;
}

const publicInfo = (m: Member) => ({
  pid: m.pid,
  clientId: m.clientId,
  name: m.name,
  hue: m.hue,
  online: m.online,
});

const clampAge = (age: number): number =>
  Math.max(0, Math.min(MAX_SAMPLE_AGE_MS, Math.round(age)));

function withinTarget(x: number, y: number, target: TargetState): boolean {
  const dx = x - target.x;
  const dy = y - target.y;
  return dx * dx + dy * dy <= TARGET_RADIUS * TARGET_RADIUS;
}

/** Keeps the target away from the extreme edges so it is always clickable. */
function randomTargetPosition(): { x: number; y: number } {
  const margin = TARGET_RADIUS * 1.5;
  const span = COORD_SCALE - margin * 2;
  return {
    x: Math.round(margin + Math.random() * span),
    y: Math.round(margin + Math.random() * span),
  };
}
