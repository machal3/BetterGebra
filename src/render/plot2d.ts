import { endpoint, holes } from '../math';
import type { Dot, RealFunction } from '../math';
import { format, unitLabel } from '../format';
import type { AxisUnit } from '../state';
import { Viewport, axisSteps } from './viewport';

export interface Theme { bg: string; gridMinor: string; gridMajor: string; axis: string; label: string }

/** Labels in the interface font at the size and weight of Affect UI's small labels (11px, 500); names in the math italic. */
export let LABEL = '500 11px "Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif';
export let SERIF = 'italic 15px "Cambria Math", "STIX Two Math", serif';

/** The canvas colours and fonts from the CSS tokens (styles/tokens.css); read again when the theme changes. */
export function readTheme(): Theme {
  const s = getComputedStyle(document.documentElement), v = (k: string) => s.getPropertyValue(`--${k}`).trim();
  if (v('b-font')) LABEL = `500 11px ${v('b-font')}`;
  if (v('b-math')) SERIF = `italic 15px ${v('b-math')}`;
  return { bg: v('plot-bg'), gridMinor: v('grid-minor'), gridMajor: v('grid-major'), axis: v('axis'), label: v('plot-label') };
}

export interface AxesOptions { grid: boolean; axes: boolean; xUnit: AxisUnit; yUnit: AxisUnit; plane: boolean; minorGrid: boolean; halo: boolean }

/**
 * Multiples of step in [from, to] (or [from, to) when open), counted rather than accumulated: far from 0 a tiny
 * step no longer moves x += step, which would loop forever. Too many to draw → none.
 */
function multiples(from: number, to: number, step: number, open = false): number[] {
  const first = Math.ceil(from / step), n = Math.floor(to / step) - first;
  if (!(n >= 0) || n > 4000) return [];
  const out: number[] = [];
  for (let i = 0; i <= n; i++) { const v = (first + i) * step; if (v > to || (open && v >= to)) break; out.push(v); }
  return out;
}

/** Significant digits that tell apart labels `step` apart around `size` (100,0001 next to 100,0002). */
export const labelDigits = (size: number, step: number) =>
  Math.min(15, Math.max(5, Math.ceil(Math.log10(Math.max(1, Math.abs(size)) / step)) + 2));

export function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, theme: Theme, o: AxesOptions): void {
  if (!o.grid) return;
  const xs = axisSteps(vp.scale, o.xUnit), ys = axisSteps(vp.yscale, o.yUnit);
  const lines = (sx: number, sy: number, color: string) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
    for (const x of multiples(vp.min, vp.max, sx)) { const p = Math.round(vp.px(x)) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, vp.height); }
    for (const y of multiples(vp.bottom, vp.top, sy)) { const p = Math.round(vp.py(y)) + 0.5; ctx.moveTo(0, p); ctx.lineTo(vp.width, p); }
    ctx.stroke();
  };
  if (o.minorGrid) lines(xs.minor, ys.minor, theme.gridMinor);
  lines(xs.major, ys.major, theme.gridMajor);
}

/** Axes with labels. When an axis is out of view its labels stay pinned to the nearest edge. */
export function drawAxes(ctx: CanvasRenderingContext2D, vp: Viewport, theme: Theme, o: AxesOptions): void {
  if (!o.axes) return;
  const { width, height } = vp, x0 = Math.round(vp.px(0)) + 0.5, y0 = Math.round(vp.py(0)) + 0.5;
  ctx.strokeStyle = theme.axis; ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(x0, 0); ctx.lineTo(x0, height); ctx.moveTo(0, y0); ctx.lineTo(width, y0);
  ctx.stroke();

  const step = axisSteps(vp.scale, o.xUnit).major, ystep = axisSteps(vp.yscale, o.yUnit).major;
  const xd = labelDigits(Math.max(Math.abs(vp.min), Math.abs(vp.max)), step), yd = labelDigits(Math.max(Math.abs(vp.bottom), Math.abs(vp.top)), ystep);
  const xLabel = (v: number) => unitLabel(o.xUnit, v, xd);
  const yLabel = !o.plane ? (v: number) => unitLabel(o.yUnit, v, yd)
    : o.yUnit === 'num' ? (v: number) => ({ '1': 'i', '-1': '−i' } as Record<string, string>)[String(Math.round(v * 1e12) / 1e12)] ?? `${format(v, yd)}i`
    : (v: number) => `${unitLabel(o.yUnit, v, yd)}i`;
  ctx.font = LABEL; ctx.fillStyle = theme.label;
  // Over the colours of the complex plane labels get a halo in the background colour.
  ctx.strokeStyle = theme.bg; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  const text = (s: string, x: number, y: number) => { if (o.halo) ctx.strokeText(s, x, y); ctx.fillText(s, x, y); };
  const ys: number[] = [];
  for (const y of multiples(vp.bottom, vp.top, ystep, true)) if (Math.abs(y) > ystep / 100) ys.push(y);
  // Long y labels push the pinned axis right instead of running off the canvas.
  const labelWidth = Math.max(0, ...ys.map(y => ctx.measureText(yLabel(y)).width));
  // An axis out of sight is pinned to the edge of the part no panel covers, with its labels
  const { left, bottom } = vp.inset;
  const axisY = Math.max(14, Math.min(height - bottom - 40, vp.py(0))), axisX = Math.max(left + labelWidth + 14, Math.min(width - 12, vp.px(0)));
  ctx.textAlign = 'center';
  for (const x of multiples(vp.min, vp.max, step, true)) {
    const p = vp.px(x);
    if (Math.abs(x) > step / 100 && p > left + 16 && p < width - 24) text(xLabel(x), p, axisY + 16);
  }
  ctx.textAlign = 'right';
  for (const y of ys) text(yLabel(y), axisX - 8, vp.py(y) + 4);
  if (axisX === vp.px(0) && axisY === vp.py(0)) text('0', axisX - 8, axisY + 16); // only where the axes really cross
  ctx.font = SERIF;
  text(o.plane ? 'Re' : 'x', width - 14, axisY - 8);
  ctx.textAlign = 'left';
  text(o.plane ? 'Im' : 'y', axisX + 8, 18);
}

export const dashPattern = (dash: string, width: number) => dash ? dash.split(' ').map(n => Number(n) * width / 2) : [];

/**
 * Strokes y = fn(x) across the view. Each pixel step is split until the curve is straight to ½ px, so corners,
 * domain edges (√(1−x²) at the axis) and asymptotes (tan x, 1/x) are drawn exactly instead of bridged or cut short.
 * Returns the dots where pieces end (domain edges, jumps, removable holes).
 */
export function traceCurve(ctx: CanvasRenderingContext2D, vp: Viewport, fn: RealFunction): Dot[] {
  const { width, height } = vp, ok = Number.isFinite, far = height * 10, tol = 0.5 / vp.yscale, ends: Dot[] = [];
  const Y = (p: number) => vp.py(fn(vp.fromX(p)));
  let pen = false;
  const point = (p: number, y: number) => {
    if (!ok(y)) { pen = false; return; }
    y = Math.max(-far, Math.min(height + far, y));
    if (pen) ctx.lineTo(p, y); else ctx.moveTo(p, y);
    pen = true;
  };
  const segment = (p0: number, y0: number, p1: number, y1: number, depth: number, parentDelta: number): void => {
    if (!ok(y0) && !ok(y1)) return point(p1, y1);
    const both = ok(y0) && ok(y1), delta = Math.abs(y1 - y0);
    const offscreen = both && ((y0 < 0 && y1 < 0) || (y0 > height && y1 > height));
    // Both ends off the same edge: still look at the middle of a whole step, a narrow spike or pole may come into view.
    if (depth && (!offscreen || depth === 8)) {
      const pm = (p0 + p1) / 2, ym = Y(pm);
      const stillOff = offscreen && ok(ym) && ((ym < 0 && y0 < 0) || (ym > height && y0 > height));
      if (!stillOff && (!both || delta > height || !ok(ym) || Math.abs(ym - (y0 + y1) / 2) > 0.5)) {
        segment(p0, y0, pm, ym, depth - 1, delta);
        segment(pm, ym, p1, y1, depth - 1, delta);
        return;
      }
    }
    // After 8 halvings a continuous curve's step shrinks (~½ per halving, ~0.8 for ∛x); a jump doesn't.
    const jump = !depth && both && !offscreen && delta > 2 && (delta > height || delta > 0.95 * parentDelta);
    if (jump || (!depth && !both)) {
      // A piece ends inside this 1/256 px step: run the left piece into (c; its end), lift the pen,
      // start the right piece from (c; its start). ±∞ becomes a point far off-screen.
      const e = endpoint(fn, vp.fromX(p0), vp.fromX(p1), tol), pc = vp.px(e.x);
      const at = (v: number) => v === Infinity ? -far : v === -Infinity ? height + far : vp.py(v);
      ends.push(...e.dots);
      if (ok(y0) && !Number.isNaN(e.left)) point(pc, at(e.left));
      if (e.left !== e.right) pen = false;
      if (ok(y1) && !Number.isNaN(e.right)) point(pc, at(e.right));
    }
    point(p1, y1);
  };
  // ponytail: depth 8 (1/256 px) caps work on wild functions like sin(1/x); raise it if detail there matters.
  let p0 = 0, y0 = Y(0);
  point(p0, y0);
  for (let p = 1; p <= Math.ceil(width); p++) {
    const y = Y(p);
    segment(p0, y0, p, y, 8, Infinity);
    p0 = p; y0 = y;
  }
  return [...ends, ...holes(fn, vp.min, vp.max, tol)];
}

export function dot(ctx: CanvasRenderingContext2D, vp: Viewport, x: number, y: number, r: number, fill: string, stroke: string): void {
  const X = vp.px(x), Y = vp.py(y);
  if (X < -r || X > vp.width + r || Y < -r || Y > vp.height + r) return;
  ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke();
}
