/**
 * The console.
 *
 * This file owns pointer input, a canvas, and the rails around it. It never sees a socket,
 * a frame, or a timestamp conversion — everything below is `createRoom(...)` plus a render
 * loop, which is the layering the architecture doc describes.
 *
 * One deliberate structural choice: positions never enter React state. The rAF loop pulls
 * interpolated positions straight out of the room and draws them; React re-renders a few
 * times a second, for the rails only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { REACTIONS } from './protocol.js';
import type { PeerInfo, TargetState } from './protocol.js';
import { createRoom } from './net/room.js';
import type { PeerFrame, Room, RoomStats } from './net/room.js';
import type { NetworkEmulation } from './net/connection.js';
import { Renderer } from './render.js';
import { formatMet, statusMatrix } from './ui/console.js';
import { getClientId, getDisplayName, getRoomId } from './ui/identity.js';
import { TopRail } from './ui/TopRail.js';
import { Roster } from './ui/Roster.js';
import { SwitchBank } from './ui/SwitchBank.js';

/** The rails refresh at 5Hz; the glass refreshes at display rate. */
const RAIL_REFRESH_MS = 200;
const ANNUNCIATOR_MS = 2200;

interface Annunciation {
  text: string;
  tone: 'go' | 'caution';
}

export default function App(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  /** This station's own position, read by the render loop and never by React. */
  const selfPos = useRef({ x: 0.5, y: 0.5, visible: false });
  const onConsoleSince = useRef<number | null>(null);

  const identity = useMemo(() => {
    const clientId = getClientId();
    return { clientId, name: getDisplayName(clientId), roomId: getRoomId() };
  }, []);

  const [self, setSelf] = useState<PeerInfo | null>(null);
  const [peers, setPeers] = useState<PeerFrame[]>([]);
  const [stats, setStats] = useState<RoomStats | null>(null);
  const [target, setTarget] = useState<TargetState | null>(null);
  const [annunciation, setAnnunciation] = useState<Annunciation | null>(null);
  const [met, setMet] = useState('00:00:00');

  const [reaction, setReaction] = useState(0);
  const [delayAuto, setDelayAuto] = useState(true);
  const [delayMs, setDelayMs] = useState(120);
  const [extrapolate, setExtrapolate] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [emulation, setEmulation] = useState<NetworkEmulation>({
    latencyMs: 0,
    jitterMs: 0,
    lossPct: 0,
  });
  const [reducedMotion, setReducedMotion] = useState(false);

  // Refs the animation loop reads, so flipping a switch never restarts the loop.
  const extrapolateRef = useRef(extrapolate);
  const showDebugRef = useRef(showDebug);
  const reactionRef = useRef(reaction);
  const reducedMotionRef = useRef(reducedMotion);
  extrapolateRef.current = extrapolate;
  showDebugRef.current = showDebug;
  reactionRef.current = reaction;
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // -- Room lifecycle --------------------------------------------------------

  useEffect(() => {
    const room = createRoom({
      roomId: identity.roomId,
      clientId: identity.clientId,
      name: identity.name,
    });
    roomRef.current = room;

    const offAction = room.onRemoteAction((clientId, action) => {
      // Cursor actions are already inside the room's interpolation buffers; this callback
      // is the raw event stream. Reactions are one-shot visuals, so they spawn here.
      if (action.type !== 'reaction') return;
      const peer = room.getPeers().find((p) => p.clientId === clientId);
      rendererRef.current?.spawnReaction(action.x, action.y, action.kind, peer?.hue ?? 140);
    });

    const offTarget = room.onTargetChange((next, lost) => {
      setTarget(next);
      const me = room.getSelf();
      if (!me) return;
      if (next.heldBy === me.pid) {
        setAnnunciation({ text: 'Target acquired', tone: 'go' });
      } else if (lost.includes(me.pid)) {
        setAnnunciation({ text: 'Beaten to it — ordered by capture time', tone: 'caution' });
      }
    });

    const offPresence = room.onPresenceChange(() => setSelf(room.getSelf()));

    return () => {
      offAction();
      offTarget();
      offPresence();
      room.leave();
      roomRef.current = null;
      onConsoleSince.current = null;
    };
  }, [identity]);

  // Tell the server we are going before the socket dies, so the room drops the seat at
  // once instead of holding it open for the reconnect grace window.
  useEffect(() => {
    const onHide = (event: PageTransitionEvent) => {
      // `persisted` means the page went into the back/forward cache and may return;
      // disposing there would resurrect a dead console.
      if (!event.persisted) roomRef.current?.leave();
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  useEffect(() => {
    if (!annunciation) return;
    const timer = window.setTimeout(() => setAnnunciation(null), ANNUNCIATOR_MS);
    return () => window.clearTimeout(timer);
  }, [annunciation]);

  // -- The glass -------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;

    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) renderer.resize(parent.clientWidth, parent.clientHeight);
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const room = roomRef.current;
      if (!room) return;
      const renderTime = room.renderTime();
      renderer.draw({
        peers: room.frameAt(renderTime, extrapolateRef.current),
        self: {
          name: room.getSelf()?.name ?? identity.name,
          hue: room.getSelf()?.hue ?? 140,
          x: selfPos.current.x,
          y: selfPos.current.y,
          visible: selfPos.current.visible,
        },
        target: room.getTarget(),
        serverNow: renderTime + room.interpolationDelayMs,
        showDebug: showDebugRef.current,
        reducedMotion: reducedMotionRef.current,
      });
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      rendererRef.current = null;
    };
  }, [identity]);

  // -- Rail refresh (low frequency) -----------------------------------------

  useEffect(() => {
    const timer = window.setInterval(() => {
      const room = roomRef.current;
      if (!room) return;
      const next = room.stats();
      setPeers(room.frameAt(room.renderTime(), extrapolateRef.current));
      setStats(next);
      setSelf(room.getSelf());
      setTarget(room.getTarget());
      if (delayAuto) setDelayMs(room.interpolationDelayMs);

      if (next.status === 'open') {
        onConsoleSince.current ??= Date.now();
        setMet(formatMet(Date.now() - onConsoleSince.current));
      }
    }, RAIL_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [delayAuto]);

  useEffect(() => {
    roomRef.current?.setInterpolationDelay(delayAuto ? null : delayMs);
  }, [delayAuto, delayMs]);

  // -- Input -----------------------------------------------------------------

  const toNormalized = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }, []);

  const handleMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const { x, y } = toNormalized(event);
      selfPos.current = { x, y, visible: true };
      // Called at pointer-event rate; the room decides what actually reaches the wire.
      roomRef.current?.sendAction({ type: 'cursor', x, y });
    },
    [toNormalized],
  );

  const handleTap = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const { x, y } = toNormalized(event);
      const kind = reactionRef.current;
      roomRef.current?.sendAction({ type: 'reaction', x, y, kind });
      // Optimistic local spawn: this station's own burst appears without waiting for a
      // round trip. The server never echoes it back, so there is no double burst.
      const hue = roomRef.current?.getSelf()?.hue ?? 140;
      rendererRef.current?.spawnReaction(x, y, kind, hue);
    },
    [toNormalized],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < REACTIONS.length) setReaction(index);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cutLink = useCallback(() => {
    roomRef.current?.simulateDrop();
    setAnnunciation({ text: 'Link cut — reacquiring', tone: 'caution' });
  }, []);

  const scores = useMemo(() => new Map(target?.scores ?? []), [target]);
  const matrix = useMemo(() => statusMatrix(stats, peers), [stats, peers]);
  const overlay = describeOverlay(stats);

  return (
    <div className="console">
      <TopRail roomId={identity.roomId} met={met} matrix={matrix} />

      <div className="bay">
        <div
          className="glass"
          onPointerMove={handleMove}
          onPointerDown={handleTap}
          onPointerLeave={() => {
            selfPos.current = { ...selfPos.current, visible: false };
          }}
        >
          <canvas ref={canvasRef} />
          {overlay && (
            <div className="glass-overlay">
              <strong>{overlay.title}</strong>
              <span>{overlay.detail}</span>
            </div>
          )}
          {annunciation && (
            <div className="annunciator" data-tone={annunciation.tone} role="status">
              <span className="lamp" data-tone={annunciation.tone} />
              {annunciation.text}
            </div>
          )}
        </div>

        <p className="imperative">
          <span>Move to transmit · click to react · take the target</span>
          <span className="rule" />
          <strong>
            <span aria-hidden>{REACTIONS[reaction]}</span> armed
          </strong>
        </p>
      </div>

      <Roster
        self={self}
        peers={peers}
        scores={scores}
        connected={stats?.status === 'open'}
        roomId={identity.roomId}
      />

      <SwitchBank
        stats={stats}
        reaction={reaction}
        onReaction={setReaction}
        delayMs={delayMs}
        delayAuto={delayAuto}
        onDelayAuto={setDelayAuto}
        onDelay={setDelayMs}
        extrapolate={extrapolate}
        onExtrapolate={setExtrapolate}
        showDebug={showDebug}
        onShowDebug={setShowDebug}
        emulation={emulation}
        onEmulation={(next) => {
          setEmulation((prev) => ({ ...prev, ...next }));
          roomRef.current?.setNetworkEmulation(next);
        }}
        onCutLink={cutLink}
      />
    </div>
  );
}

/** The glass says what is wrong with the link, in the console's own voice. */
function describeOverlay(stats: RoomStats | null): { title: string; detail: string } | null {
  if (!stats || stats.status === 'connecting') {
    return { title: 'Acquiring link', detail: 'Opening the socket' };
  }
  if (stats.status === 'reconnecting') {
    return { title: 'Signal lost', detail: stats.statusDetail };
  }
  if (stats.status === 'closed') {
    return { title: 'Link down', detail: stats.statusDetail };
  }
  return null;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
