import { endpoint, holes } from '../math';
import type { Dot, RealFunction } from '../math';
import { format, piLabel } from '../format';
import { Viewport, minorOf, tick, xSteps } from './viewport';

export interface Theme { bg: string; gridMinor: string; gridMajor: string; axis: string; label: string }

export function readTheme(): Theme {
  const s = getComputedStyle(document.documentElement), v = (k: string) => s.getPropertyValue(`--${k}`).trim();
  return { bg: v('plot-bg'), gridMinor: v('grid-minor'), gridMajor: v('grid-major'), axis: v('axis'), label: v('plot-label') };
}

// Labels use the Fluent type ramp (Caption 1, Segoe UI); names keep the math italic.
export const LABEL = '12px "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif';
export const SERIF = 'italic 15px "Cambria Math", "STIX Two Math", Cambria, Georgia, serif';

export interface AxesOptions { grid: boolean; axes: boolean; trig: boolean; plane: boolean; minorGrid: boolean; halo: boolean }

export function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, theme: Theme, o: AxesOptions): void {
  if (!o.grid) return;
  const { major, minor } = xSteps(vp, o.trig), ymajor = tick(vp.yscale);
  const lines = (sx: number, sy: number, color: string) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = Math.ceil(vp.min / sx) * sx; x <= vp.max; x += sx) { const p = Math.round(vp.px(x)) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, vp.height); }
    for (let y = Math.ceil(vp.bottom / sy) * sy; y <= vp.top; y += sy) { const p = Math.round(vp.py(y)) + 0.5; ctx.moveTo(0, p); ctx.lineTo(vp.width, p); }
    ctx.stroke();
  };
  if (o.minorGrid) lines(minor, minorOf(ymajor), theme.gridMinor);
  lines(major, ymajor, theme.gridMajor);
}

/** Axes with labels. When an axis is out of view its labels stay pinned to the nearest edge. */
export function drawAxes(ctx: CanvasRenderingContext2D, vp: Viewport, theme: Theme, o: AxesOptions): void {
  if (!o.axes) return;
  const { width, height } = vp, x0 = Math.round(vp.px(0)) + 0.5, y0 = Math.round(vp.py(0)) + 0.5;
  ctx.strokeStyle = theme.axis; ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(x0, 0); ctx.lineTo(x0, height); ctx.moveTo(0, y0); ctx.lineTo(width, y0);
  ctx.stroke();

  const step = xSteps(vp, o.trig).major, ystep = tick(vp.yscale);
  const xLabel = o.trig ? piLabel : (v: number) => format(v);
  const yLabel = o.plane ? (v: number) => ({ '1': 'i', '-1': '−i' } as Record<string, string>)[String(Math.round(v * 1e12) / 1e12)] ?? `${format(v)}i` : (v: number) => format(v);
  ctx.font = LABEL; ctx.fillStyle = theme.label;
  // Over the colours of the complex plane labels get a halo in the background colour.
  ctx.strokeStyle = theme.bg; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  const text = (s: string, x: number, y: number) => { if (o.halo) ctx.strokeText(s, x, y); ctx.fillText(s, x, y); };
  const ys: number[] = [];
  for (let y = Math.ceil(vp.bottom / ystep) * ystep; y < vp.top; y += ystep) if (Math.abs(y) > ystep / 100) ys.push(y);
  // Long y labels push the pinned axis right instead of running off the canvas.
  const labelWidth = Math.max(0, ...ys.map(y => ctx.measureText(yLabel(y)).width));
  const axisY = Math.max(14, Math.min(height - 40, vp.py(0))), axisX = Math.max(labelWidth + 14, Math.min(width - 12, vp.px(0)));
  ctx.textAlign = 'center';
  for (let x = Math.ceil(vp.min / step) * step; x < vp.max; x += step) {
    const p = vp.px(x);
    if (Math.abs(x) > step / 100 && p > 16 && p < width - 24) text(xLabel(x), p, axisY + 16);
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
    if (depth && !offscreen) {
      const pm = (p0 + p1) / 2, ym = Y(pm);
      if (!both || delta > height || !ok(ym) || Math.abs(ym - (y0 + y1) / 2) > 0.5) {
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
