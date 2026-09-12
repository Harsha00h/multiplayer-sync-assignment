import type { ReactElement, ReactNode } from 'react';
import { REACTIONS } from '../protocol.js';
import type { RoomStats } from '../net/room.js';
import type { NetworkEmulation } from '../net/connection.js';
import { formatBytes } from './console.js';
import { useDamped } from './useDamped.js';
import { IconBuffer, IconCut, IconFeed, IconLink, IconTransmit } from './icons.js';

export interface SwitchBankProps {
  stats: RoomStats | null;
  reaction: number;
  onReaction: (kind: number) => void;
  delayMs: number;
  delayAuto: boolean;
  onDelayAuto: (auto: boolean) => void;
  onDelay: (ms: number) => void;
  extrapolate: boolean;
  onExtrapolate: (on: boolean) => void;
  showDebug: boolean;
  onShowDebug: (on: boolean) => void;
  emulation: NetworkEmulation;
  onEmulation: (next: Partial<NetworkEmulation>) => void;
  onCutLink: () => void;
}

/**
 * The switch bank.
 *
 * Four groups, each owning one subsystem: its readings and the switches that move them sit
 * together, so a value never appears in one place while the control that changes it lives
 * in another. There is no settings drawer and no modal — everything this console does is on
 * its face.
 */
export function SwitchBank(props: SwitchBankProps): ReactElement {
  const { stats } = props;

  return (
    <section className="rail-bottom" aria-label="Console controls">
      <Group title="Link" glyph={<IconLink className="glyph" />}>
        <div className="dials">
          <Dial label="RTT" value={stats ? Math.round(stats.rttMs) : '—'} unit="ms" />
          <Dial label="Jitter" value={stats ? Math.round(stats.jitterMs) : '—'} unit="ms" />
        </div>
        <div className="controls">
          <span className="placard sub">Impair inbound</span>
          <Slide
            label="Latency"
            value={props.emulation.latencyMs}
            max={600}
            step={10}
            unit="ms"
            onChange={(v) => props.onEmulation({ latencyMs: v })}
          />
          <Slide
            label="Jitter"
            value={props.emulation.jitterMs}
            max={400}
            step={10}
            unit="ms"
            onChange={(v) => props.onEmulation({ jitterMs: v })}
          />
          <Slide
            label="Loss"
            value={Math.round(props.emulation.lossPct * 100)}
            max={50}
            step={1}
            unit="%"
            onChange={(v) => props.onEmulation({ lossPct: v / 100 })}
          />
          <button type="button" className="guarded" onClick={props.onCutLink}>
            <IconCut />
            Cut link
          </button>
        </div>
      </Group>

      <Group title="Buffer" glyph={<IconBuffer className="glyph" />}>
        <div className="controls">
          <Switch label="Adaptive" checked={props.delayAuto} onChange={props.onDelayAuto} />
          <Slide
            label="Render delay"
            value={Math.round(props.delayMs)}
            max={400}
            step={10}
            unit="ms"
            disabled={props.delayAuto}
            onChange={props.onDelay}
          />
          <Switch label="Extrapolate" checked={props.extrapolate} onChange={props.onExtrapolate} />
          <Switch label="Sample marks" checked={props.showDebug} onChange={props.onShowDebug} />
        </div>
        {/* The explanation belongs on the face, not in an OS tooltip that a touch device
            never shows and a keyboard never reaches. */}
        <p className="note">
          {props.delayAuto
            ? 'Adaptive: tick × 1.5 + jitter × 2, clamped 60–400 ms.'
            : 'Manual: stations render this far behind the server clock.'}
        </p>
      </Group>

      <Group title="Feed" glyph={<IconFeed className="glyph" />}>
        <div className="dials">
          {/* Composite readouts damp their numbers and format afterwards, so the whole
              bottom rail settles as one moment instead of half of it easing and half
              snapping at the next telemetry tick. */}
          <Dial
            label="Rate"
            value={
              stats ? (
                <>
                  <Damped n={stats.sampleHz} />/<Damped n={stats.flushHz} />
                </>
              ) : (
                '—'
              )
            }
            unit="Hz"
          />
          <Dial
            label="Uplink"
            value={stats ? <Damped n={stats.bytesOut} format={formatBytes} /> : '—'}
          />
          <Dial
            label="Downlink"
            value={stats ? <Damped n={stats.bytesIn} format={formatBytes} /> : '—'}
          />
        </div>
        <div className="dials">
          <Dial label="Frames in" value={stats?.messagesIn ?? '—'} />
          <Dial label="Resumes" value={stats?.reconnects ?? '—'} />
          <Dial
            label="Dropped"
            value={stats ? stats.rejected + stats.droppedByEmulator : '—'}
          />
        </div>
      </Group>

      <Group title="Transmit" glyph={<IconTransmit className="glyph" />}>
        <div className="keys" role="group" aria-label="Reaction to transmit">
          {REACTIONS.map((emoji, index) => (
            <button
              key={emoji}
              type="button"
              className="key"
              aria-pressed={index === props.reaction}
              aria-label={`Reaction ${index + 1}`}
              onClick={() => props.onReaction(index)}
            >
              <span aria-hidden>{emoji}</span>
              <span className="idx">{index + 1}</span>
            </button>
          ))}
        </div>
        <span className="placard">Click the plot to transmit · keys 1–6 arm</span>
      </Group>
    </section>
  );
}

function Group({
  title,
  glyph,
  children,
}: {
  title: string;
  glyph: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="group">
      <div className="group-head">
        {glyph}
        <span className="placard">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Dial({
  label,
  value,
  unit,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
}): ReactElement {
  return (
    <div className="dial">
      <span className="placard">{label}</span>
      <span className="v">
        {typeof value === 'number' ? <Damped n={value} /> : value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

/**
 * One damped numeral. Scoped to its own component so a settling reading re-renders a
 * single figure rather than the whole bank, and formats *after* damping so a composite
 * readout (bytes, a rate pair) settles like every other needle on the face.
 */
function Damped({ n, format }: { n: number; format?: (value: number) => string }): ReactElement {
  const eased = useDamped(n);
  return <>{format ? format(eased) : Math.round(eased)}</>;
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}): ReactElement {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="rocker" />
      <span className="label">{label}</span>
    </label>
  );
}

function Slide({
  label,
  value,
  max,
  step,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <label className={disabled ? 'slide is-disabled' : 'slide'}>
      <span className="placard">{label}</span>
      {/* Damped only while something else is driving it: under ADAPTIVE this readout is
          the contract's "buffer readout climbs to its new value", but a number that lags
          the user's own drag by a quarter second is just a broken control. */}
      <output>
        {disabled ? <Damped n={value} /> : value}
        {unit}
      </output>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
