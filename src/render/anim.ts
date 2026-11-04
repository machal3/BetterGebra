/**
 * Motion on the canvases (Wykresy, Geometria): clocks and easings for what is drawn frame by frame — a curve that
 * draws itself in, a graph that morphs into its edited form, points that pop, a view that glides to where a button
 * sends it, a pan that coasts on after a flick. DOM-free apart from the reduced-motion query, so the renderers stay
 * testable; with reduced motion every animation is already at its end.
 */
export const now = (): number => performance.now();

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Progress 0…1 of an animation started at `t0` lasting `ms` (1 with reduced motion). */
export function progress(t0: number, ms: number, t = now()): number {
  if (reducedMotion()) return 1;
  return Math.max(0, Math.min(1, (t - t0) / ms));
}

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** The tokens' curve, cubic-bezier(.22, 1, .36, 1), close enough for a canvas: a quick start that settles softly. */
export const easeOutQuint = (t: number): number => 1 - (1 - t) ** 5;
/** Overshoots a little before settling: a point that pops in. */
export function easeOutBack(t: number, s = 1.9): number {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}
/** A damped spring from 0 to 1: a ring that bounces once and comes to rest. */
export const spring = (t: number): number => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(9 * t));
