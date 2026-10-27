/**
 * The calculator's plots, drawn by the same code as Wykresy and Geometria: viewport, grid, axes and exact curve
 * tracing. Curves the graph panel can read are retraced at every zoom; the rest are drawn from the worker's samples.
 * Drag to move, Ctrl + wheel, a pinch or the buttons to zoom, hover to read values; "Otwórz w Wykresach" hands the
 * curves to the full graph panel. This module draws and handles the canvas; the card around it (toolbar, legend,
 * points) is the React component CalcPlot, which drives it through the handle mountPlot returns.
 */
import type { Handoff, Mark, PanelMode, Plot, Series } from '../../cas/engine';
import { format, piLabel } from '../../format';
import { compile, type RealFunction } from '../../math';
import { compileRow, type ConditionSet } from '../../model';
import { LABEL, dot, drawAxes, drawGrid, readTheme, traceCurve, type AxesOptions, type Theme } from '../../render/plot2d';
import { paintCondition } from '../../render/sets';
import { Viewport, axisSteps, panned, zoomed } from '../../render/viewport';
import { MAX_FUNCTIONS, PALETTE, addFunction, commit, state, type AxisUnit, type FnState, type Mode, type View } from '../../state';
import { toast } from '../toast';

/** Every plot on the page redraws when the theme changes; plots no longer in the page drop out. */
const live = new Set<() => void>();
export function redrawCalcPlots(): void {
  for (const draw of live) draw();
}

export const color = (i: number) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
// Only the major grid lines: a card is small, and the minor ones turned it grey.
const OPTIONS = (plane: boolean, xUnit: AxisUnit = 'num'): AxesOptions => ({ grid: true, axes: true, xUnit, yUnit: 'num', plane, minorGrid: false, halo: false });
/** Where each mode of the graph panel lives, for the button and the toast. */
export const PANEL: Record<PanelMode, { to: string; name: string }> = { graph: { to: 'Wykresach', name: 'Wykresy' }, complex: { to: 'Zespolonych', name: 'Zespolone' } };
/** A function row as the graph panel keeps it, for compiling a region the way Wykresy does. */
const row = (expression: string, c: string): FnState => ({ id: -1, expression, color: c, visible: true, from: -Infinity, to: Infinity, fromOpen: false, toOpen: false, width: 2, dash: '' });

/** What goes to the graph panel: the plot's own hand-off, or else its curves y = f(x) to Wykresy. */
export function handoff(p: Plot): Handoff {
  return p.open ?? { mode: 'graph', rows: p.series.flatMap((s, i) => (s.expr ? [{ expr: s.expr, series: i, color: s.color ?? i, dash: s.dash, faint: s.faint }] : [])) };
}
/** Points a curve's analysis found: on the plot they show only their coordinates, the list below names them. */
const ANALYSED = new Set(['zero', 'max', 'min', 'inflection', 'cross']);
const num = (v: number) => format(v, 4).replace(/^-/, '−');

/** Snapping the readout to the grid: one switch for every plot on the page, remembered. */
const SNAP_STORE = 'bettergebra.calc.snap', SNAP_PX = 8;
let snapOn = true;
try { snapOn = localStorage.getItem(SNAP_STORE) !== '0'; } catch { /* on by default */ }
const snapListeners = new Set<() => void>();
export const snapping = { get: () => snapOn, subscribe: (l: () => void) => { snapListeners.add(l); return () => { snapListeners.delete(l); }; } };
export function toggleSnap(): void {
  snapOn = !snapOn;
  try { localStorage.setItem(SNAP_STORE, snapOn ? '1' : '0'); } catch { /* just don't remember */ }
  for (const l of snapListeners) l();
  redrawCalcPlots();
}

/** The view showing x and y ranges on a W × H canvas; with equal axes the shorter side grows. */
function fit(x: [number, number], y: [number, number], W: number, H: number, equal: boolean): View {
  const cx = (x[0] + x[1]) / 2, cy = (y[0] + y[1]) / 2;
  if (!equal) return { min: x[0], max: x[1], cy, ratio: (y[1] - y[0]) * W / (H * (x[1] - x[0])) };
  const w = Math.max(x[1] - x[0], (y[1] - y[0]) * W / H);
  return { min: cx - w / 2, max: cx + w / 2, cy, ratio: 1 };
}

/** y at x read off sampled pieces, NaN between them. */
function interpolate(segs: number[][]): RealFunction {
  return x => {
    for (const s of segs) {
      if (x < s[0] || x > s[s.length - 2]) continue;
      let lo = 0, hi = s.length / 2 - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[2 * m] <= x) lo = m; else hi = m; }
      const x0 = s[2 * lo], x1 = s[2 * hi], t = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
      return s[2 * lo + 1] + t * (s[2 * hi + 1] - s[2 * lo + 1]);
    }
    return NaN;
  };
}

/** What the card around a plot can ask of it. */
export interface PlotHandle {
  zoom(factor: number): void;
  reset(): void;
  /** Shows or hides a series; returns whether it is shown now. */
  toggle(series: number): boolean;
  /** Lights a point up while it is pointed at in the list (null: none). */
  focus(mark: Mark | null): void;
  center(mark: Mark): void;
  /** Hands the plot to the graph panel (see openInGraphs). */
  open(): void;
  png(): void;
  destroy(): void;
}

export function mountPlot(p: Plot, canvas: HTMLCanvasElement, stage: HTMLElement, tip: HTMLElement): PlotHandle {
  const ctx = canvas.getContext('2d')!;
  const hidden = new Set<number>();
  // y = f(x) of each series: the exact function when the graph panel reads it, else the samples
  const fns: (RealFunction | null)[] = p.series.map(s => {
    if (s.expr) { try { return compile(s.expr); } catch { /* fall back to the samples */ } }
    return s.graph ? interpolate(s.segs) : null;
  });
  const regions = (p.regions ?? []).flatMap(r => {
    const f = row(r.expr, color(r.color)), c = compileRow(f, 'graph', {});
    return c.set?.kind === 'condition' ? [{ f, set: c.set as ConditionSet }] : [];
  });
  const xUnit: AxisUnit = p.xUnit ?? 'num';
  let W = 0, H = 0, view: View | null = null, home: View | null = null, pointer: { x: number; y: number } | null = null;
  const vp = () => new Viewport(view!, W, H);
  let focus: Mark | null = null;

  // --- Drawing ---
  let frame = 0;
  const request = () => { frame ||= requestAnimationFrame(() => { frame = 0; draw(); }); };
  function draw(): void {
    if (!canvas.isConnected) { live.delete(draw); return; }
    if (!view || !W || !H) return;
    const v = vp(), theme = readTheme(), css = getComputedStyle(document.documentElement), muted = css.getPropertyValue('--plot-label').trim() || theme.axis;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);
    // the zoom buttons and the axis letters (x at the right end of the x axis, y at the top of the y axis)
    const axisY = Math.max(14, Math.min(H - 40, v.py(0)));
    taken = [[W - 116, 0, 116, 46], [v.px(0) - 4, 0, 26, 26], [W - 28, axisY - 24, 28, 22]];
    // inequality solutions and one standard deviation: shaded across the whole height
    for (const [a, b] of p.bands) {
      const X0 = Math.max(-10, v.px(a)), X1 = Math.min(W + 10, v.px(b));
      if (X1 > X0) { ctx.globalAlpha = 0.08; ctx.fillStyle = color(0); ctx.fillRect(X0, 0, X1 - X0, H); ctx.globalAlpha = 1; }
    }
    drawGrid(ctx, v, theme, OPTIONS(!!p.plane, xUnit));
    for (const r of regions) { ctx.save(); paintCondition(ctx, v, theme, r.f, r.set, undefined, dragging); ctx.restore(); }
    for (const b of p.bars) {
      const X0 = v.px(b.x0) + 1.5, X1 = v.px(b.x1) - 1.5, Y = v.py(b.h), Y0 = v.py(0);
      ctx.beginPath(); ctx.roundRect(X0, Y, X1 - X0, Y0 - Y, [4, 4, 0, 0]);
      ctx.globalAlpha = 0.3; ctx.fillStyle = color(0); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = color(0); ctx.lineWidth = 1.5; ctx.stroke();
    }
    for (const f of p.fills) fillArea(v, f.series, f.a, f.b, f.to);
    drawAxes(ctx, v, theme, OPTIONS(!!p.plane, xUnit));

    // asymptotes and reference lines
    const line = (x0: number, y0: number, x1: number, y1: number, stroke: string, dash: number[], width = 1.25) => {
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.setLineDash(dash); ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.stroke(); ctx.setLineDash([]);
    };
    // labelled in small pills: vertical lines at the top edge (the bottom when that is taken), horizontal ones at the left
    const atEdge = [...[0, 1, 2].map(k => [0, 20 + 24 * k, 'center'] as const), ...[0, 1].map(k => [0, H - 10 - 24 * k, 'center'] as const)];
    const atLeft = [[0, -8, 'left'], [0, 18, 'left']] as const;
    const pill = { fill: muted, pill: true };
    for (const x of p.vlines) { const X = v.px(x); line(X, 0, X, H, muted, [6, 5]); place(`x = ${num(x)}`, X, 0, atEdge, pill); }
    for (const y of p.hlines) { const Y = v.py(y); line(0, Y, W, Y, muted, [6, 5]); place(`y = ${num(y)}`, 10, Y, atLeft, pill); }
    for (const r of p.refs) {
      if (r.x !== undefined) { const X = v.px(r.x); line(X, 0, X, H, muted, [2, 4]); if (r.label) place(r.label, X, 0, atEdge, pill); }
      else if (r.y !== undefined) { const Y = v.py(r.y); line(0, Y, W, Y, muted, [2, 4]); place(r.label, 10, Y, atLeft, pill); }
    }

    for (const s of p.shapes) {
      ctx.beginPath();
      for (let i = 0; i < s.pts.length; i += 2) { const X = v.px(s.pts[i]), Y = v.py(s.pts[i + 1]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
      if (!s.open) ctx.closePath();
      const c = color(s.color ?? 0);
      if (s.fill) { ctx.globalAlpha = 0.14; ctx.fillStyle = c; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.setLineDash(s.dash ? [6, 5] : []); ctx.lineWidth = s.open ? 1.5 : 2; ctx.strokeStyle = c; ctx.stroke(); ctx.setLineDash([]);
    }

    p.series.forEach((s, i) => { if (!hidden.has(i)) drawSeries(v, s, i, theme); });

    for (const a of p.vectors) arrow(v, a.x1, a.y1, a.x2, a.y2, color(a.color ?? 0), a.label, a.dash);

    // notable points; short labels stay on the plot while there are few
    const shown = p.marks.filter(m => Number.isFinite(m.y) && !(m.series !== undefined && hidden.has(m.series)) && inView(v, m.x, m.y));
    const near = hoverMark(v), lit = near ?? focus;
    for (const m of shown) {
      const c = color(m.color ?? 0), X = v.px(m.x), Y = v.py(m.y);
      if (m === lit) { ctx.beginPath(); ctx.arc(X, Y, 12, 0, 2 * Math.PI); ctx.globalAlpha = 0.18; ctx.fillStyle = c; ctx.fill(); ctx.globalAlpha = 1; }
      if (m.kind === 'hole') dot(ctx, v, m.x, m.y, 5, theme.bg, c);
      else dot(ctx, v, m.x, m.y, m === lit ? 6 : 5, c, theme.bg);
    }
    if (shown.length <= 8) for (const m of shown) {
      if (!m.label || m === lit) continue;
      const text = ANALYSED.has(m.kind) ? `(${num(m.x)}; ${num(m.y)})` : m.label;
      place(text, v.px(m.x), v.py(m.y), [[9, -9, 'left'], [9, 19, 'left'], [-9, -9, 'right'], [-9, 19, 'right'], [0, -15, 'center'], [0, 25, 'center']], { fill: theme.label });
    }
    // the point picked in the list says everything about itself
    if (lit && focus === lit && !near) place(lit.label, v.px(lit.x), v.py(lit.y), [[12, -12, 'left'], [-12, -12, 'right'], [12, 22, 'left'], [-12, 22, 'right']], { fill: color(lit.color ?? 0), strong: true, pill: true }, true);
    hover(v, theme, near);
  }
  const inView = (v: Viewport, x: number, y: number) => { const X = v.px(x), Y = v.py(y); return X > -8 && X < W + 8 && Y > -8 && Y < H + 8; };

  function drawSeries(v: Viewport, s: Series, i: number, theme: Theme): void {
    const c = color(s.color ?? i);
    ctx.strokeStyle = c; ctx.fillStyle = c;
    ctx.globalAlpha = s.faint ? 0.55 : 1;
    if (s.style === 'dots' || s.style === 'stems') {
      for (const seg of s.segs) for (let k = 0; k < seg.length; k += 2) {
        const X = v.px(seg[k]), Y = v.py(seg[k + 1]);
        if (s.style === 'stems') { ctx.beginPath(); ctx.moveTo(X, v.py(0)); ctx.lineTo(X, Y); ctx.lineWidth = 1.5; ctx.stroke(); }
        ctx.beginPath(); ctx.arc(X, Y, 3.5, 0, 2 * Math.PI); ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    ctx.lineWidth = s.faint ? 1.75 : 2.5;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.setLineDash(s.dash ? [8, 6] : []);
    ctx.beginPath();
    const f = s.expr ? fns[i] : null;
    const ends = f ? traceCurve(ctx, v, f) : [];
    if (!f) for (const seg of s.segs) seg.forEach((t, k) => { if (k % 2) return; const X = v.px(t), Y = v.py(seg[k + 1]); if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
    ctx.stroke();
    ctx.setLineDash([]);
    // where a traced piece ends: filled when the point belongs to the graph, hollow when it doesn't
    if (!s.dash) for (const d of ends) dot(ctx, v, d.x, d.y, 3.5, d.closed ? c : theme.bg, c);
    ctx.globalAlpha = 1;
  }

  /** The region between series `si` and the axis (or series `to`) over [a; b]: above the axis in one colour, below in another. */
  function fillArea(v: Viewport, si: number, a: number, b: number, to?: number): void {
    const f = fns[si], g = to === undefined ? () => 0 : fns[to];
    if (!f || !g) return;
    const X0 = Math.max(v.px(a), -2), X1 = Math.min(v.px(b), W + 2);
    if (X1 <= X0) return;
    const clampY = (Y: number) => Math.max(-H, Math.min(2 * H, Y));
    const path = new Path2D();
    let top: [number, number][] = [], bottom: [number, number][] = [];
    const flush = () => {
      if (top.length < 2) { top = []; bottom = []; return; }
      top.forEach(([X, Y], k) => (k ? path.lineTo(X, Y) : path.moveTo(X, Y)));
      for (let k = bottom.length - 1; k >= 0; k--) path.lineTo(bottom[k][0], bottom[k][1]);
      path.closePath();
      top = []; bottom = [];
    };
    for (let X = X0; ; X = Math.min(X + 1, X1)) {
      const x = v.fromX(X), y = f(x), z = g(x);
      if (Number.isFinite(y) && Number.isFinite(z)) {
        top.push([X, clampY(v.py(y))]);
        bottom.push([X, clampY(v.py(z))]);
      } else flush();
      if (X === X1) break;
    }
    flush();
    const Y0 = clampY(v.py(0));
    for (const [clipY, clipH, c] of to === undefined ? [[0, Y0, color(0)], [Y0, H - Y0, color(1)]] as const : [[0, H, color(0)]] as const) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, clipY, W, clipH); ctx.clip();
      ctx.globalAlpha = 0.2; ctx.fillStyle = c; ctx.fill(path);
      ctx.restore();
    }
  }

  function arrow(v: Viewport, x1: number, y1: number, x2: number, y2: number, c: string, label: string, dash?: boolean): void {
    const X1 = v.px(x1), Y1 = v.py(y1), X2 = v.px(x2), Y2 = v.py(y2), a = Math.atan2(Y2 - Y1, X2 - X1), k = 11;
    if (Math.hypot(X2 - X1, Y2 - Y1) < 1) return;
    ctx.beginPath(); ctx.moveTo(X1, Y1); ctx.lineTo(X2 - 6 * Math.cos(a), Y2 - 6 * Math.sin(a));
    ctx.setLineDash(dash ? [6, 4] : []); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = c; ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(X2, Y2);
    ctx.lineTo(X2 - k * Math.cos(a - 0.4), Y2 - k * Math.sin(a - 0.4)); ctx.lineTo(X2 - k * Math.cos(a + 0.4), Y2 - k * Math.sin(a + 0.4));
    ctx.closePath(); ctx.fillStyle = c; ctx.fill();
    if (label) place(label, X2, Y2, [[8 * Math.cos(a) + 4, 8 * Math.sin(a) - 4, 'left'], [8 * Math.cos(a) - 4, 8 * Math.sin(a) + 14, 'right'], [8, 16, 'left']], { fill: c, strong: true });
  }

  /** Areas already labelled this frame, as [x, y, w, h]: a label takes the first offset where it fits, or none. */
  let taken: number[][] = [];
  function place(s: string, x: number, y: number, offsets: readonly (readonly [number, number, CanvasTextAlign])[], style: { fill: string; strong?: boolean; pill?: boolean }, force = false): boolean {
    const theme = readTheme();
    // one weight, as in the interface; a strong label stands out by its colour
    ctx.font = LABEL;
    const w = ctx.measureText(s).width, padX = style.pill ? 7 : 2;
    for (const [dx, dy, align] of offsets) {
      let X = x + dx, left = align === 'left' ? X : align === 'right' ? X - w : X - w / 2;
      const Y = y + dy;
      // slide along the edge rather than give up on a label that only sticks out
      const shift = Math.max(0, padX + 2 - left) - Math.max(0, left + w + padX + 2 - W);
      X += shift; left += shift;
      const box = [left - padX, Y - 14, w + 2 * padX, 20];
      if (box[1] < 2 || box[1] + box[3] > H - 2) continue;
      if (!force && taken.some(t => box[0] < t[0] + t[2] && t[0] < box[0] + box[2] && box[1] < t[1] + t[3] && t[1] < box[1] + box[3])) continue;
      taken.push(box);
      if (style.pill) {
        // a tag in the Affect UI manner: a 6px card with a hairline and a soft lift
        ctx.beginPath(); ctx.roundRect(box[0], box[1], box[2], box[3], 6);
        ctx.save(); ctx.shadowColor = 'rgba(0, 0, 0, 0.12)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
        ctx.fillStyle = theme.bg; ctx.fill(); ctx.restore();
        ctx.lineWidth = 0.5; ctx.strokeStyle = theme.gridMajor; ctx.stroke();
      }
      ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
      if (!style.pill) { ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = theme.bg; ctx.strokeText(s, X, Y); }
      ctx.fillStyle = style.fill; ctx.fillText(s, X, Y);
      return true;
    }
    return false;
  }

  // --- Hover: the point under the cursor, or every curve's value at the cursor's x ---
  function hoverMark(v: Viewport): Mark | null {
    if (!pointer) return null;
    let best: Mark | null = null, bestD = 12;
    for (const m of p.marks) {
      if (!Number.isFinite(m.y) || (m.series !== undefined && hidden.has(m.series))) continue;
      const d = Math.hypot(v.px(m.x) - pointer.x, v.py(m.y) - pointer.y);
      if (d < bestD) { best = m; bestD = d; }
    }
    return best;
  }
  function hover(v: Viewport, theme: Theme, mark: Mark | null): void {
    if (!pointer || dragging) { tip.hidden = true; return; }
    const lines: string[] = [], colors: (string | null)[] = [];
    let accent = '';
    if (mark) { lines.push(mark.label); colors.push(color(mark.color ?? 0)); accent = color(mark.color ?? 0); }
    else {
      const x = v.fromX(pointer.x), y = v.fromY(pointer.y);
      const bar = p.bars.find(b => x >= b.x0 && x <= b.x1 && y >= 0 && y <= b.h);
      const vec = p.vectors.find(a => Math.hypot(v.px(a.x2) - pointer!.x, v.py(a.y2) - pointer!.y) < 12);
      if (bar) lines.push(bar.label);
      else if (vec) lines.push(`${vec.label ? `${vec.label} = ` : ''}(${format(vec.x2 - vec.x1)}; ${format(vec.y2 - vec.y1)})`);
      else {
        const at = snapOn ? snapX(v, x) : null;
        const sx = at?.x ?? x;
        const values = p.series.flatMap((s, i) => {
          if (hidden.has(i)) return [];
          if (s.style === 'dots' || s.style === 'stems') {
            // discrete: the value at the nearest whole index
            const seg = s.segs[0] ?? [], k = Math.round(sx);
            for (let j = 0; j < seg.length; j += 2) if (seg[j] === k) return [{ i, s, x: k, y: seg[j + 1] }];
            return [];
          }
          const f = fns[i], fy = f?.(sx);
          return f && Number.isFinite(fy) ? [{ i, s, x: sx, y: fy! }] : [];
        });
        if (values.length) {
          const X = at ? v.px(sx) : pointer.x;
          ctx.beginPath(); ctx.moveTo(Math.round(X) + 0.5, 0); ctx.lineTo(Math.round(X) + 0.5, H);
          ctx.lineWidth = 1; ctx.strokeStyle = theme.axis; ctx.globalAlpha = 0.45; ctx.stroke(); ctx.globalAlpha = 1;
          lines.push(`x = ${at && xUnit === 'pi' && at.y === undefined ? piLabel(values[0].x) : num(values[0].x)}`); colors.push(null);
          if (at?.y !== undefined) snapRing(v, sx, at.y, theme);
          for (const { i, s, x: X, y: Y } of values) {
            dot(ctx, v, X, Y, 4.5, color(s.color ?? i), theme.bg);
            lines.push(`${values.length > 1 ? `${short(s.label)}: ` : 'y = '}${num(Y)}`); colors.push(color(s.color ?? i));
          }
        } else {
          // no curve to follow: the point under the cursor, on a grid node when one is near
          const node = snapOn ? snapNode(v, x, y) : null, px = node?.x ?? x, py = node?.y ?? y;
          if (node) snapRing(v, px, py, theme);
          lines.push(p.plane ? `${num(px)} ${py < 0 ? '−' : '+'} ${num(Math.abs(py))}i` : `(${num(px)}; ${num(py)})`);
        }
      }
    }
    tip.replaceChildren(...lines.map((t, k) => {
      const el = document.createElement('div');
      el.className = colors[k] ? 'row' : 'row head';
      if (colors[k]) el.style.setProperty('--c', colors[k]);
      el.textContent = t;
      return el;
    }));
    tip.style.borderLeftColor = accent || '';
    tip.hidden = false;
    // beside the cursor, flipped at the right and bottom edges
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${pointer.x + 14 + tw > W ? pointer.x - 14 - tw : pointer.x + 14}px`;
    tip.style.top = `${Math.max(4, Math.min(H - th - 4, pointer.y + 14))}px`;
  }
  const short = (label: string) => label.length > 28 ? `${label.slice(0, 26)}…` : label;

  // --- Snapping to the grid (the major lines, the ones drawn) ---
  const steps = (v: Viewport) => ({ x: axisSteps(v.scale, xUnit).major, y: axisSteps(v.yscale, 'num').major });
  /** The x to read at: a vertical grid line within reach, or where the curve under the cursor meets a horizontal one. */
  function snapX(v: Viewport, x: number): { x: number; y?: number } | null {
    const st = steps(v), best: { x: number; y?: number; d: number }[] = [];
    const gx = Math.round(x / st.x) * st.x + 0;
    if (Math.abs(v.px(gx) - pointer!.x) <= SNAP_PX) best.push({ x: gx, d: Math.abs(v.px(gx) - pointer!.x) });
    p.series.forEach((s, i) => {
      const f = fns[i];
      if (!f || hidden.has(i) || (s.style && s.style !== 'line')) return;
      const fy = f(x);
      // only the curve near the cursor, and only a grid line it is about to cross
      if (!Number.isFinite(fy) || Math.abs(v.py(fy) - pointer!.y) > 40) return;
      const level = Math.round(fy / st.y) * st.y + 0;
      let a = v.fromX(pointer!.x - 2 * SNAP_PX), b = v.fromX(pointer!.x + 2 * SNAP_PX), ga = f(a) - level;
      if (!Number.isFinite(ga) || !Number.isFinite(f(b) - level) || ga * (f(b) - level) > 0) return;
      for (let k = 0; k < 50; k++) { const m = (a + b) / 2, gm = f(m) - level; if ((gm < 0) === (ga < 0)) { a = m; ga = gm; } else b = m; }
      const t = (a + b) / 2, d = Math.abs(v.px(t) - pointer!.x);
      if (d <= SNAP_PX) best.push({ x: t, y: level, d });
    });
    return best.sort((a, b) => a.d - b.d)[0] ?? null;
  }
  /** The grid node near (x; y), each coordinate snapped on its own when its line is within reach. */
  function snapNode(v: Viewport, x: number, y: number): { x: number; y: number } | null {
    const st = steps(v), gx = Math.round(x / st.x) * st.x + 0, gy = Math.round(y / st.y) * st.y + 0;
    const nx = Math.abs(v.px(gx) - pointer!.x) <= SNAP_PX, ny = Math.abs(v.py(gy) - pointer!.y) <= SNAP_PX;
    return nx || ny ? { x: nx ? gx : x, y: ny ? gy : y } : null;
  }
  /** Where the readout snapped: a small ring on the grid. */
  function snapRing(v: Viewport, x: number, y: number, theme: Theme): void {
    const X = v.px(x), Y = v.py(y);
    if (Y < -6 || Y > H + 6) return;
    ctx.beginPath(); ctx.arc(X, Y, 6, 0, 2 * Math.PI);
    ctx.lineWidth = 1.5; ctx.strokeStyle = theme.axis; ctx.stroke();
  }

  // --- View changes ---
  const setView = (next: View | null) => { if (next) { view = next; request(); } };
  const zoom = (f: number, x = W / 2, y = H / 2) => { if (view) setView(zoomed(view, W, H, f, f, x, y)); };
  const reset = () => setView(home && { ...home });

  let dragging = false;
  const pointers = new Map<number, { x: number; y: number }>();
  let start: { x: number; y: number; view: View; dist: number } | null = null;
  const local = (e: PointerEvent | WheelEvent | MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !view) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    const pts = [...pointers.values()];
    const mid = pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    start = { ...mid, view: { ...view }, dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0 };
  });
  canvas.addEventListener('pointermove', e => {
    const at = local(e);
    if (!pointers.has(e.pointerId)) { pointer = at; request(); return; }
    pointers.set(e.pointerId, at);
    if (!start) return;
    const pts = [...pointers.values()];
    if (pts.length === 2 && start.dist) {
      // pinch: zoom about the midpoint, and follow it
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const z = zoomed(start.view, W, H, start.dist / d, start.dist / d, start.x, start.y);
      if (z) setView(panned(z, W, start.x - mid.x, mid.y - start.y));
      return;
    }
    if (!dragging && Math.hypot(at.x - start.x, at.y - start.y) < 3) return;
    dragging = true;
    canvas.classList.add('grabbing');
    pointer = null;
    setView(panned(start.view, W, start.x - at.x, at.y - start.y));
  });
  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    const rest = [...pointers.values()][0];
    start = rest && view ? { ...rest, view: { ...view }, dist: 0 } : null;
    if (!pointers.size) { dragging = false; canvas.classList.remove('grabbing'); }
    request();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('pointerleave', () => { pointer = null; request(); });
  // The page scrolls with the wheel; Ctrl (or a trackpad pinch, which sets it) zooms.
  canvas.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const at = local(e);
    zoom(Math.exp(Math.max(-300, Math.min(300, e.deltaY * [1, 16, H][e.deltaMode])) * 0.004), at.x, at.y);
  }, { passive: false });
  canvas.addEventListener('dblclick', e => { const at = local(e); zoom(e.shiftKey ? 2 : 0.5, at.x, at.y); });
  canvas.addEventListener('keydown', e => {
    if (!view) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (step) setView(panned(view, W, step[0] * W * 0.1, step[1] * H * 0.1));
    else if (e.key === '+' || e.key === '=') zoom(0.7);
    else if (e.key === '-') zoom(1 / 0.7);
    else if (e.key === '0') reset();
    else return;
    e.preventDefault();
  });

  const ro = new ResizeObserver(() => {
    if (!canvas.isConnected) { live.delete(draw); ro.disconnect(); return; }
    const r = stage.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    // keep the same x range and centre when the card changes width
    const was = view ? vp() : null;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    home = fit(p.x, p.y, W, H, !!p.equal);
    view = was ? fit([was.min, was.max], [was.bottom, was.top], W, H, !!p.equal) : { ...home };
    draw();
  });
  ro.observe(stage);
  live.add(draw);
  return {
    zoom: f => zoom(f),
    reset,
    toggle(i) { if (hidden.has(i)) hidden.delete(i); else hidden.add(i); draw(); return !hidden.has(i); },
    focus(m) { focus = m; request(); },
    center(m) { if (view) { const v = vp(); setView(panned(view, W, v.px(m.x) - W / 2, H / 2 - v.py(m.y))); } },
    open() { if (view) openInGraphs(p, handoff(p), hidden, vp()); },
    png() {
      canvas.toBlob(blob => {
        if (!blob) { toast('Nie udało się zapisać obrazu.'); return; }
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = 'bettergebra-kalkulator.png'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    },
    destroy() { live.delete(draw); ro.disconnect(); cancelAnimationFrame(frame); },
  };
}

/**
 * Hands the plot to the graph panel in the mode it needs (Wykresy or Zespolone), replacing its functions:
 * colours, dashes, thin helper curves, hidden ones (kept, but hidden), a curve's range of t, the axis unit and the
 * view all carry over. The toast can bring the previous state back.
 */
function openInGraphs(p: Plot, out: Handoff, hidden: Set<number>, v: Viewport): void {
  const rows = out.rows.slice(0, MAX_FUNCTIONS);
  const before = {
    functions: [...state.functions], activeId: state.activeId, view: { ...state.view }, mode: state.mode,
    xUnit: state.xUnit, yUnit: state.yUnit, grid: state.grid, axes: state.axes, analysisOpen: state.analysisOpen,
  };
  state.functions.splice(0);
  for (const r of rows) {
    addFunction(r.expr, {
      color: color(r.color ?? r.series ?? 0), dash: r.dash ? '8 6' : '', width: r.faint ? 1.5 : 2,
      visible: r.series === undefined || !hidden.has(r.series), from: r.from, to: r.to,
    });
  }
  state.activeId = (state.functions.find(f => f.visible) ?? state.functions[0]).id;
  state.mode = out.mode as Mode;
  // the axes as they were here: multiples of π for trigonometric graphs, plain numbers otherwise
  state.xUnit = out.mode === 'graph' ? p.xUnit ?? 'num' : 'num';
  state.yUnit = 'num';
  state.grid = state.axes = true;
  // one function: its zeros, extrema and values are worth seeing next to the graph at once
  if (out.mode === 'graph' && rows.length === 1) state.analysisOpen = true;
  commit('list', 'expr', 'active', 'mode', 'style', 'toggles', 'panel');
  const x: [number, number] = [v.min, v.max], equal = !!p.equal || out.mode !== 'graph';
  // a real graph's y range (z² + 1 up to 100) says nothing about the complex plane: the same width, centred on 0
  const y: [number, number] = out.mode === 'complex' ? [-(v.max - v.min) / 2, (v.max - v.min) / 2] : [v.bottom, v.top];
  if (out.mode === 'complex') { x[0] = -(v.max - v.min) / 2; x[1] = (v.max - v.min) / 2; }
  // the same ranges as here, fitted to the graph panel once it is on screen
  addEventListener('hashchange', () => requestAnimationFrame(() => {
    const r = document.getElementById('stage')!.getBoundingClientRect();
    if (r.width && r.height) { state.view = fit(x, y, r.width, r.height, equal); commit('view'); }
  }), { once: true });
  location.hash = '#wykresy';
  const n = rows.length;
  toast(`${n === 1 ? 'Przeniesiono 1 wiersz' : `Przeniesiono ${n} ${n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'wiersze' : 'wierszy'}`} do: ${PANEL[out.mode].name}.${out.rows.length > n ? ` Pominięto ${out.rows.length - n} (limit ${MAX_FUNCTIONS}).` : ''}`, {
    label: 'Cofnij',
    run: () => {
      state.functions.splice(0, state.functions.length, ...before.functions);
      Object.assign(state, { activeId: before.activeId, view: before.view, mode: before.mode, xUnit: before.xUnit, yUnit: before.yUnit, grid: before.grid, axes: before.axes, analysisOpen: before.analysisOpen });
      commit('list', 'expr', 'active', 'mode', 'style', 'view', 'toggles', 'panel');
    },
  });
}
