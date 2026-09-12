/**
 * The console's icon set: authored SVG, one 1.5px stroke weight, one 20x20 frame,
 * `currentColor` throughout so a lamp state tints its own glyph.
 *
 * Deliberately small. On a console face most meaning is carried by engraved placards and
 * lamps, so an icon here earns its place only where a word would be slower to read.
 */
import type { ReactElement, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps): IconProps => ({
  viewBox: '0 0 20 20',
  width: 20,
  height: 20,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  ...props,
});

/** Uplink: signal arcs off a mast. Marks everything about the socket itself. */
export const IconLink = (props: IconProps): ReactElement => (
  <svg {...base(props)}>
    <path d="M10 16.5V9.5" />
    <circle cx="10" cy="7.5" r="1.6" />
    <path d="M6.6 4.3a5 5 0 0 0 0 6.4M13.4 4.3a5 5 0 0 1 0 6.4" />
    <path d="M4.2 2a8.2 8.2 0 0 0 0 11M15.8 2a8.2 8.2 0 0 1 0 11" opacity="0.45" />
  </svg>
);

/** Timebase: a dial with one hand, for the clock-offset estimate. */
export const IconClock = (props: IconProps): ReactElement => (
  <svg {...base(props)}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 5.8V10l3 1.8" />
  </svg>
);

/** Buffer: samples stacked behind the render head. */
export const IconBuffer = (props: IconProps): ReactElement => (
  <svg {...base(props)}>
    <path d="M3.5 13.5V9M7 13.5V6.5M10.5 13.5V8" />
    <path d="M14.5 3.5v13" strokeWidth="2" />
    <path d="M17 10h-.01" />
  </svg>
);

/** Feed: the sampled waveform going out on the wire. */
export const IconFeed = (props: IconProps): ReactElement => (
  <svg {...base(props)}>
    <path d="M2.5 10h2.2l2-4.5 2.4 9L11.6 10h5.9" />
  </svg>
);

/** Cut the link: a severed line. Used only on the destructive switch. */
export const IconCut = (props: IconProps): ReactElement => (
  <svg {...base(props)}>
    <path d="M2.5 10h4.2M13.3 10h4.2" />
    <path d="M8.6 6.2 11.4 13.8" />
  </svg>
);

/** Acquisition target: the reticle used for the contested tap. */
export const IconTarget = (props: IconProps): ReactElement => (
  <svg {...base(props)}>
    <circle cx="10" cy="10" r="6.2" />
    <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
    <path d="M10 1.4v3.2M10 15.4v3.2M1.4 10h3.2M15.4 10h3.2" />
  </svg>
);

/** Transmit: the reaction burst leaving this station. */
export const IconTransmit = (props: IconProps): ReactElement => (
  <svg {...base(props)}>
    <circle cx="10" cy="10" r="2" />
    <path d="M5.8 5.8a6 6 0 0 0 0 8.4M14.2 5.8a6 6 0 0 1 0 8.4" />
  </svg>
);
