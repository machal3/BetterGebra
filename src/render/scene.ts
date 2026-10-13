/**
 * Owns the two canvases: the plot (redrawn when something changes, at most once per frame) and the hover layer
 * on top (redrawn on every mouse move without touching the graphs, so the cursor dot keeps up).
 */
import type { AnalysisResult, Mark } from '../analysis/compute';
import { approx, complexText, format, stacked, unitLabel } from '../format';
import { exactPoint, exactValue, roots } from '../math';
import type { Dot, RealFunction } from '../math';
import { compiled, type Compiled } from '../model';
import { activeFn, state, type AxisUnit, type FnState } from '../state';
import { paintDomain } from './domain';
import { dashPattern, dot, drawAxes, drawGrid, readTheme, traceCurve, type Theme } from './plot2d';
import { drawParametric, paintCondition, type SetFound } from './sets';
import { Viewport, axisSteps, minorOf } from './viewport';

export class Scene {
  width = 0;
  height = 0;
  theme: Theme = readTheme();
  analysis: AnalysisResult | null = null;
  /** What each set's drawing found, for the analysis panel. */
  readonly found = new Map<number, SetFound>();
  /** Pointer in CSS px over the plot, or null when outside. */
  pointer: { x: number; y: number } | null = null;
  /** Coarser painting while a gesture, wheel or slider keeps going. */
  moving = false;
  dragging = false;
  onDrawn: () => void = () => {};

  private ctx: CanvasRenderingContext2D;
  private hoverCtx: CanvasRenderingContext2D;
  private frame = 0;
  private plotDirty = false;
  private ends: (Dot & { color: string; fn: RealFunction; expr: string })[] = [];

  constructor(private plot: HTMLCanvasElement, private hover: HTMLCanvasElement, private tip: HTMLElement) {
    this.ctx = plot.getContext('2d')!;
    this.hoverCtx = hover.getContext('2d')!;
  }

  get vp(): Viewport { return new Viewport(state.view, this.width, this.height); }

  resize(width: number, height: number): void {
    this.width = width; this.height = height;
    const dpr = window.devicePixelRatio || 1;
    for (const [c, cx] of [[this.plot, this.ctx], [this.hover, this.hoverCtx]] as const) {
      c.width = Math.max(1, Math.round(width * dpr)); c.height = Math.max(1, Math.round(height * dpr));
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.draw();
  }

  refreshTheme(): void { this.theme = readTheme(); this.request(); }

  /** Redraw plot and hover in the next frame (several requests collapse into one). */
  request(plot = true): void {
    this.plotDirty ||= plot;
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      if (this.plotDirty) this.draw(); else this.drawHover();
    });
  }

  private rows(): { f: FnState; c: Compiled }[] {
    return state.functions.map(f => ({ f, c: compiled(f, state.mode, state.params) }));
  }

  draw(): void {
    this.plotDirty = false;
    if (!this.width || !this.height) return;
    const { ctx, theme } = this, vp = this.vp, mode = state.mode, active = activeFn();
    const rows = this.rows(), shown = rows.filter(r => r.f.visible && r.c.ok);
    // The active graph is drawn last, on top.
    shown.sort((a, b) => Number(a.f === active) - Number(b.f === active));
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    const activeRow = rows.find(r => r.f === active);
    const sets = shown.filter(r => r.c.set), graphs = shown.filter(r => r.c.fn);
    // Re and Im on the axes only when the plot is all complex numbers (|z − 1| ≤ 2), not with y = f(x) or y > x²
    const complex = mode === 'complex', plane = complex || (!graphs.length && sets.length > 0 && sets.every(r => !r.c.xy));
    if (complex && activeRow?.f.visible && activeRow.c.cfn) paintDomain(ctx, vp, activeRow.f.expression, activeRow.c.cfn, state.params, this.moving || this.dragging);
    const axes = { grid: state.grid, axes: state.axes, xUnit: state.xUnit, yUnit: state.yUnit, plane, minorGrid: !complex, halo: complex };
    drawGrid(ctx, vp, theme, axes);
    drawAxes(ctx, vp, theme, axes);

    ctx.lineJoin = ctx.lineCap = 'round';
    const ends: (Dot & { color: string; fn: RealFunction; expr: string })[] = [];
    this.found.clear();
    if (!complex) {
      // sets first, so their fills lie under the graphs
      for (const { f, c } of sets) {
        if (c.set?.kind === 'condition') this.found.set(f.id, paintCondition(ctx, vp, theme, f, c.set, this.analysis?.setPoints[f.id], this.moving || this.dragging));
        else if (c.set) drawParametric(ctx, vp, theme, f, c.set);
      }
      for (const { f, c } of graphs) {
        ctx.beginPath();
        ctx.lineWidth = f.width + (f === active ? 1 : 0);
        ctx.strokeStyle = f.color;
        ctx.setLineDash(dashPattern(f.dash, f.width));
        for (const e of traceCurve(ctx, vp, c.fn!)) ends.push({ ...e, color: f.color, fn: c.fn!, expr: f.expression });
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    this.ends = ends;
    // Roots and intersections: small neutral dots, so they don't read as hollow endpoints (a set draws its own points).
    if (!activeRow?.c.set) for (const m of this.analysis?.marks ?? []) dot(ctx, vp, m.x, m.y, 3.5, theme.label, theme.bg);
    // Where a piece ends: filled = the point belongs to the graph, hollow = only approached.
    for (const e of ends) dot(ctx, vp, e.x, e.y, 4, e.closed ? e.color : theme.bg, e.color);
    this.drawHover();
    this.onDrawn();
  }

  // --- Hover ---

  drawHover(): void {
    const h = this.hoverCtx, tip = this.tip;
    h.clearRect(0, 0, this.width, this.height);
    if (!this.pointer || this.dragging) { tip.hidden = true; return; }
    // On Wykresy the graph under the cursor wins; elsewhere the point of the plane, read for the active set
    const hit = state.mode === 'graph' ? this.realHit() ?? this.planeHit() : this.planeHit();
    if (!hit) { tip.hidden = true; return; }
    const vp = this.vp, hx = vp.px(hit.x), hy = vp.py(hit.y);
    if (hit.dot) {
      h.beginPath(); h.arc(hx, hy, 5, 0, Math.PI * 2);
      h.fillStyle = hit.color; h.fill();
      h.lineWidth = 2; h.strokeStyle = this.theme.bg; h.stroke();
    }
    tip.hidden = false;
    tip.innerHTML = hit.html;
    tip.style.setProperty('--c', hit.color);
    const ax = hit.dot ? hx : this.pointer.x, ay = hit.dot ? hy : this.pointer.y;
    tip.style.left = `${Math.max(8, Math.min(this.width - tip.offsetWidth - 8, ax + 14))}px`;
    tip.style.top = `${Math.max(8, Math.min(this.height - tip.offsetHeight - 8, ay - 44))}px`;
  }

  private nearestMark(marks: Mark[], radius: number): Mark | undefined {
    const vp = this.vp, p = this.pointer!, dist = (m: Mark) => Math.hypot(vp.px(m.x) - p.x, vp.py(m.y) - p.y);
    return marks.filter(m => dist(m) < radius).sort((a, b) => dist(a) - dist(b))[0];
  }

  /** The point of fn's graph nearest the cursor: the graph sampled every px within 24 px, plus ends of pieces, the cursor projected onto it. */
  private nearestOnGraph(fn: RealFunction, fnEnds: Dot[] = []): { d: number; x: number; y: number } | null {
    const vp = this.vp, p = this.pointer!;
    let best: { d: number; x: number; y: number } | null = null, a: [number, number] | null = null;

    const check = (x0: number, y0: number, x1: number, y1: number, xVal0?: number, xVal1?: number) => {
      const dx = x1 - x0, dy = y1 - y0, lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return;
      const t = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / lenSq));
      const projX = x0 + t * dx, projY = y0 + t * dy;
      const d = Math.hypot(projX - p.x, projY - p.y);
      if (d < 24 && (!best || d < best.d)) {
        const x = xVal0 !== undefined && xVal1 !== undefined ? xVal0 + t * (xVal1 - xVal0) : vp.fromX(projX);
        const yVal = fn(x);
        best = { d, x, y: Number.isFinite(yVal) ? yVal : vp.fromY(projY) };
      }
    };

    for (let i = -24; i <= 24; i++) {
      const b: [number, number] = [p.x + i, vp.py(fn(vp.fromX(p.x + i)))];
      if (!Number.isFinite(b[1])) { a = null; continue; }
      // A segment whose middle isn't between its ends spans a jump or an asymptote, not the graph.
      const mid = a && vp.py(fn(vp.fromX(p.x + i - 0.5)));
      if (a && mid !== null && mid >= Math.min(a[1], b[1]) - 1 && mid <= Math.max(a[1], b[1]) + 1) {
        check(a[0], a[1], b[0], b[1]);
      }
      a = b;
    }

    for (const e of fnEnds) {
      const ex = vp.px(e.x), ey = vp.py(e.y);
      if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;
      const de = Math.hypot(ex - p.x, ey - p.y);
      if (de < 24 && (!best || de < best.d)) best = { d: de, x: e.x, y: e.y };

      const pl = Math.floor(ex);
      if (Math.abs(pl - p.x) <= 25) {
        const xl = vp.fromX(pl), yl = fn(xl);
        if (Number.isFinite(yl)) check(pl, vp.py(yl), ex, ey, xl, e.x);
      }
      const pr = Math.ceil(ex);
      if (Math.abs(pr - p.x) <= 25) {
        const xr = vp.fromX(pr), yr = fn(xr);
        if (Number.isFinite(yr)) check(ex, ey, pr, vp.py(yr), e.x, xr);
      }
    }

    return best;
  }

  private realHit(): Hit | null {
    const vp = this.vp, active = activeFn(), { xUnit, yUnit } = state;
    // The nearest root, intersection, extremum, y-intercept or endpoint within 8 px wins, with its exact coordinates.
    if (state.snap) {
      const marks: Mark[] = [
        ...(this.analysis?.marks ?? []).map(m => ({ ...m, color: active?.color })),
        ...(this.analysis?.snaps ?? []),
        ...this.ends.map(e => {
          const xText = exactPoint([e.expr, String(e.y)], state.params, e.x)?.x ?? unitLabel(xUnit, e.x, 12);
          const yText = exactValue(e.expr, state.params, e.x) ?? unitLabel(yUnit, e.y, 12);
          return { x: e.x, y: e.y, text: `x = ${xText}   y = ${yText}`, color: e.color };
        }),
      ];
      const m = this.nearestMark(marks, 8);
      if (m) return { x: m.x, y: m.y, color: m.color ?? 'currentColor', html: stacked(m.text), dot: true };
    }
    // Otherwise follow the graph nearest the cursor (in px, so steep parts follow up-and-down moves too)…
    let best: { d: number; x: number; y: number; f: FnState; fn: RealFunction } | null = null;
    for (const { f, c } of this.rows()) {
      if (!f.visible || !c.fn) continue;
      const fnEnds = this.ends.filter(e => e.fn === c.fn);
      const p = this.nearestOnGraph(c.fn, fnEnds);
      if (p && p.d < 24 && (!best || p.d < best.d)) best = { ...p, f, fn: c.fn };
    }
    if (!best) return null;
    const plain: Hit = { x: best.x, y: best.y, color: best.f.color, html: `x ${format(best.x)}   y ${format(best.y)}`, dot: true };
    if (!state.snap || !state.grid) return plain;
    // …sticking to where it crosses a grid line within 3 px: the roundest vertical and the roundest horizontal
    // line in reach, whichever is nearer. Grid values are short decimals or multiples of π, so they are exact.
    const { fn, f } = best, gap = (q: { x: number; y: number }) => Math.hypot(vp.px(q.x) - vp.px(best!.x), vp.py(q.y) - vp.py(best!.y));
    const options: Hit[] = [];
    // Multiples of π (also shown in degrees) round to the major or the minor step, decimals to the roundest value.
    const near = (v: number, unit: AxisUnit, pxPerUnit: number) => {
      const steps = axisSteps(pxPerUnit, unit);
      return unit === 'num' ? roundNear(v, steps.major) : [steps.major, steps.minor].map(s => Math.round(v / s) * s);
    };
    const gx = near(best.x, xUnit, vp.scale)
      .map(x => ({ x, y: fn(x) })).find(q => Number.isFinite(q.y) && gap(q) < 3);
    if (gx) {
      const x = unitLabel(xUnit, gx.x, 12);
      const y = xUnit !== 'num' ? approx(gx.y) : exactValue(f.expression, state.params, gx.x) ?? approx(gx.y);
      options.push({ ...gx, color: f.color, html: stacked(`x = ${x}   y = ${y}`), dot: true });
    }
    // ponytail: up to 4 root searches per mouse move; fine for the one graph under the cursor.
    for (const level of near(best.y, yUnit, vp.yscale)) {
      const at = roots(t => fn(t) - level, vp.fromX(vp.px(best.x) - 3), vp.fromX(vp.px(best.x) + 3)).find(t => gap({ x: t, y: level }) < 3);
      if (at === undefined) continue;
      const x = exactPoint([f.expression, String(level)], state.params, at)?.x ?? approx(at);
      options.push({ x: at, y: level, color: f.color, html: stacked(`x = ${x}   y = ${unitLabel(yUnit, level, 12)}`), dot: true });
      break;
    }
    return options.sort((a, b) => gap(a) - gap(b))[0] ?? plain;
  }

  /** On the complex plane: z under the cursor and f(z) (only z for sets), or the exact value of a zero within 8 px. */
  private planeHit(): Hit | null {
    const f = activeFn(), vp = this.vp, p = this.pointer!;
    if (!f) return null;
    const c = compiled(f, state.mode, state.params);
    // on Wykresy only a set reads points of the plane; a graph is read along its curve
    if (!c.ok || (state.mode === 'graph' && !c.set)) return null;
    const m = this.nearestMark(this.analysis?.marks ?? [], 8);
    if (m) return { x: m.x, y: m.y, color: f.color, html: stacked(m.text), dot: true };
    if (c.xy) return { x: vp.fromX(p.x), y: vp.fromY(p.y), color: f.color, html: `x ${format(vp.fromX(p.x))}   y ${format(vp.fromY(p.y))}`, dot: false };
    const z: [number, number] = [vp.fromX(p.x), vp.fromY(p.y)], short = (v: number) => format(v);
    const zText = `z = ${complexText(z, short)}`;
    const html = c.cfn ? `${zText}   f(z) = ${complexText(c.cfn(z), short) ?? 'nie istnieje'}` : zText;
    return { x: z[0], y: z[1], color: f.color, html, dot: false };
  }

  /** PNG of the plot as shown, without the hover layer. */
  toBlob(): Promise<Blob | null> {
    return new Promise(resolve => { this.draw(); this.plot.toBlob(resolve, 'image/png'); });
  }
}

interface Hit { x: number; y: number; color: string; html: string; dot: boolean }

/**
 * Grid lines nearest v, roundest first: the major line, then minor lines that are multiples of 1, 0,5, 0,2…
 * (with lines every 0,5 between 0 and 2: 2, then 1, then 0,5). Snapping takes the first one in reach.
 */
function roundNear(v: number, major: number): number[] {
  const e = Math.floor(Math.log10(major)), minor = minorOf(major), onGrid = (s: number) => Math.abs(s / minor - Math.round(s / minor)) < 1e-9;
  const steps = [major, ...[e, e - 1].flatMap(k => [5, 2, 1].map(m => m * 10 ** k)).filter(s => s < major && s > minor && onGrid(s)), minor];
  return [...new Set(steps.map(s => Number((Math.round(v / s) * s).toPrecision(12))))];
}
