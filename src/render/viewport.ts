import type { View } from '../state';

/** World ↔ screen (CSS px) for a view on a canvas of the given size. Immutable: a new one per frame. */
export class Viewport {
  readonly scale: number;
  readonly yscale: number;

  constructor(readonly view: View, readonly width: number, readonly height: number) {
    this.scale = width / (view.max - view.min);
    this.yscale = this.scale / view.ratio;
  }

  get min() { return this.view.min; }
  get max() { return this.view.max; }
  /** World y at the top and bottom edge. */
  get top() { return this.fromY(0); }
  get bottom() { return this.fromY(this.height); }

  px = (x: number) => (x - this.view.min) * this.scale;
  py = (y: number) => this.height / 2 - (y - this.view.cy) * this.yscale;
  fromX = (p: number) => this.view.min + p / this.scale;
  fromY = (p: number) => this.view.cy + (this.height / 2 - p) / this.yscale;
}

/** Visible ranges where float64 still draws cleanly. */
export function fits(range: number, ratio: number, width: number, height: number): boolean {
  const ys = height * range * ratio / width;
  return range >= 1e-4 && range <= 1e7 && ys >= 1e-4 && ys <= 1e12;
}

/** Scales the visible x and y range by fx, fy (< 1 zooms in), keeping the world point under (x; y) px in place. */
export function zoomed(v: View, width: number, height: number, fx: number, fy = fx, x = width / 2, y = height / 2): View | null {
  const range = (v.max - v.min) * fx, ratio = v.ratio * fy / fx;
  if (!fits(range, ratio, width, height)) return null;
  const vp = new Viewport(v, width, height), anchorX = vp.fromX(x), anchorY = vp.fromY(y), min = anchorX - range * x / width;
  return { min, max: min + range, ratio, cy: anchorY - (height / 2 - y) * range * ratio / width };
}

export function panned(v: View, width: number, dx: number, dy: number): View {
  const s = width / (v.max - v.min), ys = s / v.ratio;
  return { ...v, min: v.min + dx / s, max: v.max + dx / s, cy: v.cy + dy / ys };
}

/** A "nice" grid step (1, 2, 5 × 10ⁿ) about 70 px apart at `pxPerUnit`. */
export function tick(pxPerUnit: number): number {
  const raw = 70 / pxPerUnit, magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(v => v * magnitude).find(v => v >= raw)!;
}
/** Trigonometric x ticks: π/12 … π/2, then π, 2π, 5π…; below π/20 back to decimal multiples of π. */
export function piTick(pxPerUnit: number): number {
  const raw = 70 / pxPerUnit / Math.PI;
  return Math.PI * ([1 / 12, 1 / 6, 1 / 4, 1 / 3, 1 / 2].find(v => v >= raw && raw > 0.05) ?? tick(pxPerUnit * Math.PI));
}
/** Minor lines on round values: 1 → 0,2; 2 → 0,5 (not 0,4, so 1 is a line); 5 → 1. */
export const minorOf = (major: number) => major / (Math.round(major / 10 ** Math.floor(Math.log10(major))) === 2 ? 4 : 5);

export function xSteps(vp: Viewport, trig: boolean): { major: number; minor: number } {
  const major = trig ? piTick(vp.scale) : tick(vp.scale);
  return { major, minor: trig ? major / 2 : minorOf(major) };
}
