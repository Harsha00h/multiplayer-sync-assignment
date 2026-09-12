/**
 * The glass.
 *
 * Everything inside the bezel is drawn here: the plot graticule, the acquisition target,
 * every station's tracked symbol and data block, and the reaction bursts. The renderer is
 * handed already-interpolated positions in normalized [0,1] space and turns them into
 * pixels; it knows nothing about sockets, and it holds exactly one piece of mutable state
 * of its own — the burst particles, which are a visual effect with a lifetime rather than
 * synced state.
 *
 * Kept out of React on purpose. The loop runs at display rate; pushing sixty position
 * updates a second through component state would cost more in reconciliation than the
 * entire sync engine costs in total.
 */
import { REACTIONS, TARGET_RADIUS, COORD_SCALE } from './protocol.js';
import type { TargetState } from './protocol.js';
import type { PeerFrame } from './net/room.js';
import { callsign, trackingState } from './ui/console.js';

export interface SelfCursor {
  name: string;
  hue: number;
  x: number;
  y: number;
  visible: boolean;
}

export interface RenderInput {
  peers: PeerFrame[];
  self: SelfCursor | null;
  target: TargetState | null;
  /** Current server time, for the target's cooldown. */
  serverNow: number;
  /** Draws each station's buffer depth and raw sample marks. */
  showDebug: boolean;
  /** Freezes chrome animation inside the glass. Station motion is never frozen. */
  reducedMotion: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: number;
  hue: number;
  born: number;
  life: number;
}

const MAX_PARTICLES = 200;
const BURST_RINGS = 1;

const MONO = '"Azeret Mono", ui-monospace, SFMono-Regular, monospace';
const NARROW = '"Archivo Narrow", "Arial Narrow", sans-serif';

const GLASS = '#0a0e0c';
const RULE_MINOR = 'rgba(120, 168, 140, 0.055)';
const RULE_MAJOR = 'rgba(120, 168, 140, 0.11)';
const GLASS_INK = '#cfd8cf';
const GLASS_INK_2 = '#7d8b81';

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = cssWidth;
    this.height = cssHeight;
    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** @param x,y normalized [0,1] */
  spawnReaction(x: number, y: number, kind: number, hue: number, now = performance.now()): void {
    const px = x * this.width;
    const py = y * this.height;
    this.particles.push({ x: px, y: py, vx: 0, vy: -40, kind, hue, born: now, life: 1500 });
    for (let i = 0; i < BURST_RINGS; i++) {
      this.particles.push({ x: px, y: py, vx: 0, vy: 0, kind: -1, hue, born: now, life: 620 });
    }
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  }

  draw(input: RenderInput, now = performance.now()): void {
    const { ctx, width, height } = this;
    ctx.fillStyle = GLASS;
    ctx.fillRect(0, 0, width, height);

    this.drawGraticule();
    if (input.target) this.drawTarget(input.target, input.serverNow, now, input.reducedMotion);
    this.drawParticles(now);

    // Data blocks placed this frame, so a crowded plot does not stack callsigns on top of
    // each other. Frame-local: allocated once per draw, never retained.
    const placed: Rect[] = [];
    for (const peer of input.peers) {
      // On station but never seen moving: the roster lists them, the plot has nothing to draw.
      if (peer.position.mode === 'empty') continue;
      this.drawStation(peer, input.showDebug, placed);
    }

    if (input.self?.visible) {
      // Drawn last and never interpolated: this station's own position is always now.
      this.drawOwnMarker(input.self);
    }
  }

  /** A plot graticule: fine rules, every fourth one weighted, edge ticks for scale. */
  private drawGraticule(): void {
    const { ctx, width, height } = this;
    const step = 34;
    ctx.lineWidth = 1;

    for (let i = 1; i * step < width; i++) {
      const x = Math.round(i * step) + 0.5;
      ctx.strokeStyle = i % 4 === 0 ? RULE_MAJOR : RULE_MINOR;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let i = 1; i * step < height; i++) {
      const y = Math.round(i * step) + 0.5;
      ctx.strokeStyle = i % 4 === 0 ? RULE_MAJOR : RULE_MINOR;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Centre reference, weighted a touch more than the majors.
    ctx.strokeStyle = 'rgba(120, 168, 140, 0.14)';
    ctx.beginPath();
    ctx.moveTo(Math.round(width / 2) + 0.5, 0);
    ctx.lineTo(Math.round(width / 2) + 0.5, height);
    ctx.moveTo(0, Math.round(height / 2) + 0.5);
    ctx.lineTo(width, Math.round(height / 2) + 0.5);
    ctx.stroke();
  }

  private drawTarget(
    target: TargetState,
    serverNow: number,
    now: number,
    reducedMotion: boolean,
  ): void {
    const { ctx } = this;
    const x = (target.x / COORD_SCALE) * this.width;
    const y = (target.y / COORD_SCALE) * this.height;
    // Radius resolves against the shorter axis so the drawn ring matches the server's
    // circular hit test whatever the window's aspect ratio.
    const r = (TARGET_RADIUS / COORD_SCALE) * Math.min(this.width, this.height);
    const cooling = serverNow < target.until;
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 420);

    ctx.save();
    ctx.translate(x, y);

    ctx.strokeStyle = cooling ? 'rgba(125, 139, 129, 0.5)' : `rgba(207, 138, 36, ${0.55 + pulse * 0.4})`;
    ctx.lineWidth = 1.5;

    ctx.setLineDash(cooling ? [3, 5] : []);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Four corner brackets: the acquisition frame.
    const b = r * (cooling ? 0.95 : 0.9 + pulse * 0.12);
    const arm = r * 0.26;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      ctx.moveTo(sx * b, sy * b - sy * arm);
      ctx.lineTo(sx * b, sy * b);
      ctx.lineTo(sx * b - sx * arm, sy * b);
    }
    ctx.stroke();

    ctx.fillStyle = cooling ? 'rgba(125, 139, 129, 0.55)' : '#cf8a24';
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `500 9px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = cooling ? 'rgba(125, 139, 129, 0.7)' : 'rgba(207, 138, 36, 0.9)';
    ctx.fillText(cooling ? 'COOLDOWN' : 'ACQUIRE', 0, b + 7);

    ctx.restore();
  }

  private drawParticles(now: number): void {
    const { ctx } = this;
    let write = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const age = now - p.born;
      if (age >= p.life) continue;
      this.particles[write++] = p;

      const progress = age / p.life;
      const seconds = age / 1000;
      const x = p.x + p.vx * seconds;
      const y = p.y + p.vy * seconds + 46 * seconds * seconds;

      ctx.save();
      if (p.kind < 0) {
        // The transmission ring: one expanding hairline, not a shower of confetti.
        ctx.globalAlpha = (1 - progress) * 0.7;
        ctx.strokeStyle = `hsl(${p.hue}, 62%, 68%)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 + progress * 42, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.globalAlpha = 1 - progress * progress;
        ctx.font = `${22 + progress * 10}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(REACTIONS[p.kind] ?? '', x, y);
      }
      ctx.restore();
    }
    // In-place compaction: no per-frame allocation, no unbounded growth.
    this.particles.length = write;
  }

  /**
   * A station on the plot: the tracked symbol, a leader line, and a data block carrying
   * the callsign and what the interpolator is currently doing for it.
   */
  private drawStation(peer: PeerFrame, showDebug: boolean, placed: Rect[]): void {
    const { ctx } = this;
    const x = peer.position.x * this.width;
    const y = peer.position.y * this.height;
    const state = trackingState(peer.position.mode, peer.online, peer.staleness);
    const hue = peer.hue;
    const dim = peer.online ? 1 : 0.4;

    ctx.save();
    ctx.globalAlpha = dim;

    // History marks: where samples actually landed, behind the interpolated symbol.
    if (peer.trail.length > 1) {
      for (let i = 0; i < peer.trail.length - 1; i++) {
        const t = peer.trail[i];
        ctx.globalAlpha = dim * 0.1 * (i / peer.trail.length + 0.35);
        ctx.fillStyle = `hsl(${hue}, 45%, 62%)`;
        ctx.fillRect(t.x * this.width - 1, t.y * this.height - 1, 2, 2);
      }
      ctx.globalAlpha = dim;
    }

    const color = `hsl(${hue}, 58%, 66%)`;
    const symbol = 7;

    // Every tracking state gets its own dash signature, so the symbol on the plot says
    // exactly what the badge beside it says — and so the plot key can tell four states
    // apart instead of listing four names against two marks.
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dashFor(state.code));
    ctx.strokeRect(x - symbol / 2, y - symbol / 2, symbol, symbol);
    ctx.setLineDash([]);

    ctx.fillStyle = color;
    ctx.fillRect(x - 1, y - 1, 2, 2);

    const label = callsign(peer.name);
    ctx.font = `600 10px ${NARROW}`;
    const labelWidth = ctx.measureText(label).width;
    ctx.font = `500 9px ${MONO}`;
    const stateWidth = ctx.measureText(state.code).width;
    const blockWidth = Math.max(labelWidth, stateWidth + (showDebug ? 46 : 0)) + 8;
    const blockHeight = showDebug ? 30 : 21;

    // Which way the leader goes is decided by the bezel, not by habit: a station near the
    // right edge trails its block to the left, one near the top trails it downward. With
    // 3-5 tabs in a room these edges are where the pointers actually spend their time.
    const flipX = x + 20 + blockWidth > this.width - 4;
    const flipY = y - 13 - blockHeight < 4;
    const dirX = flipX ? -1 : 1;
    const dirY = flipY ? 1 : -1;

    const lx = x + 13 * dirX;
    const blockX = clamp(
      flipX ? lx - 7 - blockWidth : lx + 7,
      2,
      Math.max(2, this.width - blockWidth - 2),
    );

    // Clamp first, then de-conflict, and re-clamp on every nudge — clamping only at the
    // end would push a block back onto one it had just cleared.
    const minY = 2;
    const maxY = Math.max(2, this.height - blockHeight - 2);
    let blockY = clamp(y + 13 * dirY - 9, minY, maxY);

    for (let attempt = 0; attempt < 5; attempt++) {
      const hit = placed.find(
        (r) =>
          blockX < r.x + r.w &&
          blockX + blockWidth > r.x &&
          blockY < r.y + r.h &&
          blockY + blockHeight > r.y,
      );
      if (!hit) break;
      const below = hit.y + hit.h + 3;
      // No room underneath: stack upward instead of piling up on the bottom bezel.
      blockY = below + blockHeight <= maxY ? below : clamp(hit.y - blockHeight - 3, minY, maxY);
    }
    placed.push({ x: blockX, y: blockY, w: blockWidth, h: blockHeight });

    const anchorX = flipX ? blockX + blockWidth : blockX;
    ctx.strokeStyle = `hsla(${hue}, 45%, 62%, 0.6)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + (symbol / 2) * dirX, y + (symbol / 2) * dirY);
    ctx.lineTo(lx, blockY + 9);
    ctx.lineTo(anchorX, blockY + 9);
    ctx.stroke();

    ctx.fillStyle = 'rgba(10, 14, 12, 0.72)';
    ctx.fillRect(blockX, blockY, blockWidth, blockHeight);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `600 10px ${NARROW}`;
    ctx.fillStyle = peer.online ? GLASS_INK : GLASS_INK_2;
    ctx.fillText(label, blockX + 4, blockY + 2);

    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = toneInk(state.tone);
    ctx.fillText(state.code, blockX + 4, blockY + 13);

    if (showDebug) {
      ctx.fillStyle = GLASS_INK_2;
      ctx.fillText(`${Math.round(peer.bufferedMs)}ms buf`, blockX + 4 + stateWidth + 6, blockY + 13);
    }

    ctx.restore();
  }

  /** This station's own marker: a filled crosshair, never a data block. */
  private drawOwnMarker(self: SelfCursor): void {
    const { ctx } = this;
    const x = self.x * this.width;
    const y = self.y * this.height;
    const color = `hsl(${self.hue}, 62%, 70%)`;

    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(-3, 0);
    ctx.moveTo(9, 0);
    ctx.lineTo(3, 0);
    ctx.moveTo(0, -9);
    ctx.lineTo(0, -3);
    ctx.moveTo(0, 9);
    ctx.lineTo(0, 3);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${self.hue}, 62%, 70%, 0.28)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** One dash signature per tracking state. Mirrored by the marks in the roster's plot key. */
export function dashFor(code: string): number[] {
  switch (code) {
    case 'TRACK':
      return [];
    case 'COAST':
      return [3, 2];
    case 'HOLD':
      return [1, 2];
    case 'LOST':
      return [1, 4];
    default:
      return [1, 3]; // IDLE, NO SIG
  }
}

function toneInk(tone: string): string {
  switch (tone) {
    case 'go':
      return '#7fc98d';
    case 'caution':
      return '#e2ae5c';
    case 'nogo':
      return '#e0836f';
    default:
      return GLASS_INK_2;
  }
}
