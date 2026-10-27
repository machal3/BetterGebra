import type { AxisUnit, View } from '../state';

/**
 * Where a floating panel covers the canvas, in CSS px from the left and from the bottom edge. The view's range is
 * the part beside it, so the view, a reset, a zoom to the middle and the typed ranges are about what can be seen;
 * the grid and the graphs still run on under the panel.
 */
export type Inset = { left: number; bottom: number };
export const NO_INSET: Inset = { left: 0, bottom: 0 };

/** World ↔ screen (CSS px) for a view on a canvas of the given size. Immutable: a new one per frame. */
export class Viewport {
  readonly scale: number;
  readonly yscale: number;
  /** Screen y of the view's centre (cy): the middle of the part above a bottom panel. */
  readonly mid: number;

  constructor(readonly view: View, readonly width: number, readonly height: number, readonly inset: Inset = NO_INSET) {
    this.scale = Math.max(1, width - inset.left) / (view.max - view.min);
    this.yscale = this.scale / view.ratio;
    this.mid = (height - inset.bottom) / 2;
  }

  /** World x at the left and right edge of the canvas (under the panel too). */
  get min() { return this.fromX(0); }
  get max() { return this.fromX(this.width); }
  /** World y at the top and bottom edge. */
  get top() { return this.fromY(0); }
  get bottom() { return this.fromY(this.height); }
  /** The ranges of the part no panel covers. */
  get visible() { return { min: this.view.min, max: this.view.max, bottom: this.fromY(this.height - this.inset.bottom), top: this.fromY(0) }; }

  px = (x: number) => this.inset.left + (x - this.view.min) * this.scale;
  py = (y: number) => this.mid - (y - this.view.cy) * this.yscale;
  fromX = (p: number) => this.view.min + (p - this.inset.left) / this.scale;
  fromY = (p: number) => this.view.cy + (this.mid - p) / this.yscale;
}

/** Visible ranges where float64 still draws cleanly (width and height of the part no panel covers). */
export function fits(range: number, ratio: number, width: number, height: number): boolean {
  const ys = height * range * ratio / width;
  return range >= 1e-4 && range <= 1e7 && ys >= 1e-4 && ys <= 1e12;
}

/** The view with this x range and ratio that puts the world point (ax; ay) under the screen point (x; y). */
export function anchored(range: number, ratio: number, ax: number, ay: number, x: number, y: number, width: number, height: number, inset = NO_INSET): View {
  const s = Math.max(1, width - inset.left) / range, min = ax - (x - inset.left) / s;
  return { min, max: min + range, ratio, cy: ay - ((height - inset.bottom) / 2 - y) * ratio / s };
}

/** Scales the visible x and y range by fx, fy (< 1 zooms in), keeping the world point under (x; y) px in place. */
export function zoomed(v: View, width: number, height: number, fx: number, fy = fx, x?: number, y?: number, inset = NO_INSET): View | null {
  const range = (v.max - v.min) * fx, ratio = v.ratio * fy / fx, w = width - inset.left, h = height - inset.bottom;
  if (!fits(range, ratio, w, h)) return null;
  const at = { x: x ?? inset.left + w / 2, y: y ?? h / 2 }, vp = new Viewport(v, width, height, inset);
  return anchored(range, ratio, vp.fromX(at.x), vp.fromY(at.y), at.x, at.y, width, height, inset);
}

export function panned(v: View, width: number, dx: number, dy: number, inset = NO_INSET): View {
  const range = v.max - v.min, s = Math.max(1, width - inset.left) / range, ys = s / v.ratio;
  const next = { ...v, min: v.min + dx / s, max: v.max + dx / s, cy: v.cy + dy / ys };
  // So far out that float64 can't resolve the visible range any more: stay put.
  const far = Math.max(Math.abs(next.min), Math.abs(next.max)), yrange = range * v.ratio * 0.5;
  return range < 1e-10 * far || yrange < 1e-10 * Math.abs(next.cy) ? v : next;
}

/** A "nice" grid step (1, 2, 5 × 10ⁿ) about 70 px apart at `pxPerUnit`. */
export function tick(pxPerUnit: number): number {
  const raw = 70 / pxPerUnit, magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(v => v * magnitude).find(v => v >= raw)!;
}
/** Trigonometric ticks: π/12 … π/2, then π, 2π, 5π…; below π/20 back to decimal multiples of π. */
export function piTick(pxPerUnit: number): number {
  const raw = 70 / pxPerUnit / Math.PI;
  return Math.PI * ([1 / 12, 1 / 6, 1 / 4, 1 / 3, 1 / 2].find(v => v >= raw && raw > 0.05) ?? tick(pxPerUnit * Math.PI));
}
/** Minor lines on round values: 1 → 0,2; 2 → 0,5 (not 0,4, so 1 is a line); 5 → 1. */
export const minorOf = (major: number) => major / (Math.round(major / 10 ** Math.floor(Math.log10(major))) === 2 ? 4 : 5);

/** Grid steps along one axis: round decimals for numbers, fractions of π for π and degrees. */
export function axisSteps(pxPerUnit: number, unit: AxisUnit): { major: number; minor: number } {
  const major = unit === 'num' ? tick(pxPerUnit) : piTick(pxPerUnit);
  return { major, minor: unit === 'num' ? minorOf(major) : major / 2 };
}
