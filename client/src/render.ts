/**
 * The canvas.
 *
 * Everything inside the bordered surface is drawn here: a faint dot grid, the tap target,
 * every peer's cursor with a small name chip, and the reaction bursts. The renderer is
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
import { trackingState } from './ui/console.js';

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
  /** Shows each peer's buffer depth and where their raw samples landed. */
  showDebug: boolean;
  /** Freezes decorative animation. Peer motion is never frozen. */
  reducedMotion: boolean;
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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_PARTICLES = 200;

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const CANVAS = '#ffffff';
const DOT = '#e5e5e5';
const INK = '#171717';
const INK_2 = '#6b6b6b';

/**
 * Peer colour on a white surface. Lightness 36% is the highest at which *every* hue —
 * including yellow and cyan-green, the perceptually lightest — clears 3:1 against white,
 * which is what a graphic element needs. Text is never set on this colour.
 */
export const peerColor = (hue: number): string => `hsl(${hue}, 60%, 36%)`;

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
    this.particles.push({ x: px, y: py, vx: 0, vy: -40, kind, hue, born: now, life: 1400 });
    this.particles.push({ x: px, y: py, vx: 0, vy: 0, kind: -1, hue, born: now, life: 560 });
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  }

  draw(input: RenderInput, now = performance.now()): void {
    const { ctx, width, height } = this;
    ctx.fillStyle = CANVAS;
    ctx.fillRect(0, 0, width, height);

    this.drawGrid();
    if (input.target) this.drawTarget(input.target, input.serverNow, now, input.reducedMotion);
    this.drawParticles(now);

    // Chips placed this frame, so a crowded corner does not stack names on each other.
    const placed: Rect[] = [];
    for (const peer of input.peers) {
      if (peer.position.mode === 'empty') continue;
      this.drawPeer(peer, input.showDebug, placed);
    }

    if (input.self?.visible) {
      // Drawn last and never interpolated: your own position is always "now".
      this.drawCursor(input.self.x * width, input.self.y * height, peerColor(input.self.hue), 1);
    }
  }

  /** A dot grid: enough to read motion against, quiet enough to disappear. */
  private drawGrid(): void {
    const { ctx, width, height } = this;
    const step = 24;
    ctx.fillStyle = DOT;
    for (let x = step; x < width; x += step) {
      for (let y = step; y < height; y += step) {
        ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
      }
    }
  }

  private drawTarget(target: TargetState, serverNow: number, now: number, reducedMotion: boolean): void {
    const { ctx } = this;
    const x = (target.x / COORD_SCALE) * this.width;
    const y = (target.y / COORD_SCALE) * this.height;
    // Radius resolves against the shorter axis so the drawn ring matches the server's
    // circular hit test whatever the window's aspect ratio.
    const r = (TARGET_RADIUS / COORD_SCALE) * Math.min(this.width, this.height);
    const cooling = serverNow < target.until;
    const pulse = reducedMotion ? 0 : Math.sin(now / 500) * 0.5 + 0.5;

    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = cooling ? '#d4d4d4' : INK;
    ctx.setLineDash(cooling ? [4, 4] : []);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();

    if (!cooling) {
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.18 + pulse * 0.14;
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.72 + pulse * 0.1), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = cooling ? '#d4d4d4' : INK;
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `500 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = cooling ? '#a3a3a3' : INK_2;
    ctx.fillText(cooling ? 'Taken' : 'Tap me', 0, r * 0.62 + 8);
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
        ctx.globalAlpha = (1 - progress) * 0.5;
        ctx.strokeStyle = peerColor(p.hue);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 + progress * 36, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.globalAlpha = 1 - progress * progress;
        ctx.font = `${22 + progress * 8}px ${FONT}, "Apple Color Emoji", "Segoe UI Emoji"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(REACTIONS[p.kind] ?? '', x, y);
      }
      ctx.restore();
    }
    // In-place compaction: no per-frame allocation, no unbounded growth.
    this.particles.length = write;
  }

  /** The familiar arrow pointer, in the peer's colour. */
  private drawCursor(x: number, y: number, color: string, alpha: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 15);
    ctx.lineTo(3.8, 11.6);
    ctx.lineTo(6.4, 17.2);
    ctx.lineTo(9.2, 16);
    ctx.lineTo(6.6, 10.6);
    ctx.lineTo(11.4, 10.4);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  /** A peer: faint sample marks, the arrow, and a name chip with a small state dot. */
  private drawPeer(peer: PeerFrame, showDebug: boolean, placed: Rect[]): void {
    const { ctx } = this;
    const x = peer.position.x * this.width;
    const y = peer.position.y * this.height;
    const state = trackingState(peer.position.mode, peer.online, peer.staleness);
    const color = peerColor(peer.hue);
    const alpha = peer.online ? 1 : 0.4;

    if (showDebug && peer.trail.length > 1) {
      ctx.save();
      ctx.fillStyle = color;
      for (let i = 0; i < peer.trail.length - 1; i++) {
        const t = peer.trail[i];
        ctx.globalAlpha = alpha * 0.25 * ((i + 1) / peer.trail.length);
        ctx.fillRect(t.x * this.width - 1.5, t.y * this.height - 1.5, 3, 3);
      }
      ctx.restore();
    }

    this.drawCursor(x, y, color, alpha);

    // Name chip. Placed below-right; flips when it would leave the surface; nudges down
    // when it would overlap a chip already placed this frame.
    const label = peer.name;
    ctx.font = `500 11px ${FONT}`;
    const labelWidth = ctx.measureText(label).width;
    const debugText = showDebug ? `${Math.round(peer.bufferedMs)}ms · ${state.code}` : '';
    ctx.font = `10px ${MONO}`;
    const debugWidth = showDebug ? ctx.measureText(debugText).width : 0;
    const w = Math.max(labelWidth, debugWidth) + 18 + 8; // dot + padding
    const h = showDebug ? 34 : 22;

    const flipX = x + 14 + w > this.width - 4;
    let bx = clamp(flipX ? x - 4 - w : x + 14, 2, Math.max(2, this.width - w - 2));
    const minY = 2;
    const maxY = Math.max(2, this.height - h - 2);
    let by = clamp(y + 16, minY, maxY);
    for (let attempt = 0; attempt < 5; attempt++) {
      const hit = placed.find(
        (r) => bx < r.x + r.w && bx + w > r.x && by < r.y + r.h && by + h > r.y,
      );
      if (!hit) break;
      const below = hit.y + hit.h + 3;
      by = below + h <= maxY ? below : clamp(hit.y - h - 3, minY, maxY);
    }
    placed.push({ x: bx, y: by, w, h });

    // White chip, dark text, the peer's colour as a hairline border: text contrast is
    // then independent of which hue the peer was dealt.
    ctx.save();
    ctx.globalAlpha = alpha;
    roundRect(ctx, bx, by, w, h, 6);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `500 11px ${FONT}`;
    ctx.fillText(label, bx + 8, by + 11);

    // The state dot in the peer's colour: filled for smooth, hollow for anything else.
    const dx = bx + w - 10;
    const dy = by + 11;
    ctx.beginPath();
    ctx.arc(dx, dy, 2.5, 0, Math.PI * 2);
    if (state.tone === 'go') {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    if (showDebug) {
      ctx.font = `10px ${MONO}`;
      ctx.fillStyle = INK_2;
      ctx.fillText(debugText, bx + 8, by + 25);
    }
    ctx.restore();
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
