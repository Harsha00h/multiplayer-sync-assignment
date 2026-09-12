import { useEffect, useRef, useState } from 'react';

/**
 * Eases a displayed number toward its target the way a panel meter settles: exponential
 * approach, no overshoot, and it stops the moment it arrives.
 *
 * This is the numeric half of the console's one authored motion. Throwing a switch moves
 * several readings at once, and letting them all snap at the next telemetry tick makes
 * four independent jumps where the face should show one settling.
 *
 * Reduced motion gets the value immediately — the damping is expression, not information.
 */
export function useDamped(target: number, tau = 260): number {
  const value = useRef(target);
  const frame = useRef(0);
  const last = useRef(0);
  const [, force] = useState(0);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      value.current = target;
      force((n) => n + 1);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      value.current = target;
      force((n) => n + 1);
      return;
    }

    last.current = performance.now();
    const step = (now: number) => {
      // Clamped so a backgrounded tab does not jump the whole distance on its first frame.
      const dt = Math.min(100, now - last.current);
      last.current = now;
      value.current += (target - value.current) * (1 - Math.exp(-dt / tau));

      if (Math.abs(target - value.current) < 0.5) {
        value.current = target;
        force((n) => n + 1);
        return;
      }
      force((n) => n + 1);
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target, tau]);

  return value.current;
}
