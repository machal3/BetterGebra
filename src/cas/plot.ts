/**
 * The calculator's plots, built in the worker. Each curve comes sampled (drawn as is when the page can't redraw it,
 * and read back on hover) and, when it has one, as text in the graph panel's syntax: the page then traces it
 * exactly at any zoom and can open it in Wykresy. Zeros, extrema, inflections and crossings are found here too.
 */
import { compileComplex } from '../math/complex';
import { compileRow } from '../model';
import { compile } from '../math/real';
import { zeroRuns } from '../math/analysis';
import { type Expr, ZERO, isZero, sub, subst, sym, variables } from './expr';
import { compileDouble, type RealFn } from './fast';
import { toText } from './format';

export type MarkKind = 'zero' | 'max' | 'min' | 'inflection' | 'cross' | 'point' | 'hole' | 'pole';
/** `color` indexes the palette; `series` ties the point to a curve, so hiding the curve hides it too. */
export interface Mark { x: number; y: number; label: string; kind: MarkKind; color?: number; series?: number }
export interface Series {
  label: string;
  /** Pieces of the curve as flat [x0, y0, x1, y1, …]. */
  segs: number[][];
  /** y = f(x) in the graph panel's syntax, when it reads back exactly. */
  expr?: string;
  dash?: boolean;
  /** Index into the palette; the series' own index when absent. */
  color?: number;
  /** A graph y = f(x): its samples can be read at any x. */
  graph?: boolean;
  /** Discrete values: dots, or dots on stems from the axis. */
  style?: 'line' | 'dots' | 'stems';
  faint?: boolean;
}
/** The region between a series and the x axis (or another series) over [a; b]. */
export interface Fill { series: number; a: number; b: number; to?: number; label: string }
/** A labelled reference line: x = const when `x` is set, y = const otherwise. */
export interface Ref { x?: number; y?: number; label: string }
export interface Vector { x1: number; y1: number; x2: number; y2: number; label: string; color?: number; dash?: boolean }
/** A polygon, or a polyline when `open`. */
export interface Shape { pts: number[]; label: string; color?: number; dash?: boolean; open?: boolean; fill?: boolean }
export interface Bar { x0: number; x1: number; h: number; label: string }

/** The graph panel's three modes. */
/** The graph panel's modes: Wykresy (graphs and sets, row by row) and Zespolone. */
export type PanelMode = 'graph' | 'complex';
/** One function row for the graph panel, in its syntax; `series` ties it to a curve here (colour, hidden). */
export interface HandoffRow { expr: string; series?: number; color?: number; dash?: boolean; faint?: boolean; from?: number; to?: number }
/** How the plot moves to the graph panel; without it, the curves y = f(x) go to Wykresy. */
export interface Handoff { mode: PanelMode; rows: HandoffRow[] }

export interface Plot {
  x: [number, number]; y: [number, number];
  /** Equal scale on both axes, so circles stay round; `plane` names the axes Re and Im. */
  equal?: boolean; plane?: boolean;
  /** Ticks on the x axis in multiples of π (trigonometric functions). */
  xUnit?: 'num' | 'pi';
  /** Regions filled the way Zbiory fills them: conditions on z = x + yi in the graph panel's syntax. */
  regions?: { expr: string; color: number }[];
  open?: Handoff;
  series: Series[]; marks: Mark[];
  /** x intervals shaded across the whole height (solutions of an inequality). */
  bands: [number, number][];
  /** Asymptotes. */
  vlines: number[]; hlines: number[];
  refs: Ref[]; fills: Fill[]; vectors: Vector[]; shapes: Shape[]; bars: Bar[];
}

const blank = (x: [number, number], y: [number, number]): Plot =>
  ({ x, y, series: [], marks: [], bands: [], vlines: [], hlines: [], refs: [], fills: [], vectors: [], shapes: [], bars: [] });

const gcdInt = (a: number, b: number): number => (b ? gcdInt(b, a % b) : a);
/** 1,234 · −0,5 · 1,2e+21 · π/6: short Polish numbers for labels; multiples of π/12 as such. */
export const fmt = (v: number): string => {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '?';
  if (Math.abs(v) < 1e-7) return '0';
  const k = v / Math.PI * 12, n = Math.round(k);
  if (n && Math.abs(n) <= 240 && Math.abs(k - n) < 1e-9 * Math.max(1, Math.abs(k))) {
    const g = gcdInt(Math.abs(n), 12), a = Math.abs(n) / g, d = 12 / g;
    return `${n < 0 ? '−' : ''}${a === 1 ? '' : a}π${d > 1 ? `/${d}` : ''}`;
  }
  return String(Number(v.toPrecision(4))).replace('.', ',').replace('-', '−');
};
/** A number the graph panel reads back exactly enough: 0.1, -2.5e-7. */
const plain = (v: number) => String(Number(v.toPrecision(12)));

/** sin, cos, tan…, but not arcsin or sinh: the curves whose x axis reads best in multiples of π. */
export const periodic = (text: string) => /(?<![a-z])(?:sin|cos|tan|cot|sec|csc)\(/.test(text);

/** The variable `from` (a single letter) replaced by `to` in text written by toText. */
const swap = (text: string, from: string, to: string) => text.replace(new RegExp(`(?<![A-Za-zα-ωΑ-Ω])${from}(?![A-Za-zα-ωΑ-Ω])`, 'g'), to);
const close = (a: number, b: number) => Number.isFinite(a) === Number.isFinite(b) && (!Number.isFinite(a) || Math.abs(a - b) <= 1e-6 * (1 + Math.abs(b)));
const SAMPLES: [number, number][] = [[0.31, 0.72], [1.3, -0.41], [-2.1, 1.7], [2.6, 2.2], [-0.8, -1.9]];

/**
 * A condition or equation in two variables as Wykresy writes it, in x and y (x^2 + y^2 <= 25), read back the way
 * the panel reads it and checked against the worker's numbers at a few points; undefined when they would differ.
 */
export function planeCondition(parts: Expr[], ops: string[], vx: string, vy: string): string | undefined {
  const texts = parts.map(e => swap(swap(toText(e), vx, '\u0001'), vy, '\u0002').replace(/\u0001/g, 'x').replace(/\u0002/g, 'y'));
  const text = texts.map((t, k) => (k ? ` ${ops[k - 1]} ${t}` : t)).join('');
  try {
    const c = compileRow({ id: -1, expression: text, color: '', visible: true, from: -Infinity, to: Infinity, fromOpen: false, toOpen: false, width: 2, dash: '' }, 'graph', {});
    if (!c.ok || !c.xy || c.set?.kind !== 'condition' || c.set.sides.length !== parts.length) return undefined;
    const sides = c.set.sides;
    for (const [x, y] of SAMPLES) {
      for (let k = 0; k < parts.length; k++) {
        const want = compileDouble(parts[k], vx, { [vy]: y })(x), got = sides[k]([x, y]);
        if (!close(got[0], want) || (Number.isFinite(want) && Math.abs(got[1]) > 1e-9 * (1 + Math.abs(want)))) return undefined;
      }
    }
    return text;
  } catch {
    return undefined;
  }
}

/** f(v) as a function of z for Zespolone, or an equation in z for Zbiory; checked on the real axis. */
export function zText(e: Expr, v: string): string | undefined {
  if (variables(e).some(u => u !== v)) return undefined;
  const text = swap(toText(e), v, 'z');
  try {
    const page = compileComplex(text), here = compileDouble(e, v);
    for (const t of [-2.7, -0.41, 0.35, 1.1, 2.9]) { const got = page([t, 0]); if (!close(got[0], here(t)) || (Number.isFinite(got[0]) && Math.abs(got[1]) > 1e-9)) return undefined; }
    return text;
  } catch {
    return undefined;
  }
}

/** A complex number for Zbiory (a point): its exact text when the page reads it back, else decimals. */
export function pointText(text: string, re: number, im: number): string {
  try {
    const [a, b] = compileComplex(text)([0, 0]);
    if (close(a, re) && close(b, im)) return text;
  } catch { /* decimals below */ }
  return im ? `${plain(re)} ${im < 0 ? '-' : '+'} ${plain(Math.abs(im))}i` : plain(re);
}

/** (x(t); y(t)) as the number x(t) + y(t)·i with the unknown t, for Zbiory; checked at a few t. */
export function curveText(ex: Expr, ey: Expr, t: string): string | undefined {
  const u = t === 'z' || t === 'i' ? 't' : t, text = `${swap(toText(ex), t, u)} + (${swap(toText(ey), t, u)})*i`;
  try {
    const params: Record<string, number> = { [u]: 0 }, page = compileComplex(text, params), fx = compileDouble(ex, t), fy = compileDouble(ey, t);
    for (const s of [0.3, 1.7, -2.2, 4.1]) {
      params[u] = s;
      const [a, b] = page([0, 0]);
      if (!close(a, fx(s)) || !close(b, fy(s))) return undefined;
    }
    return text;
  } catch {
    return undefined;
  }
}
const KIND: Record<MarkKind, string> = {
  zero: 'miejsce zerowe', max: 'maksimum', min: 'minimum', inflection: 'punkt przegięcia', cross: 'punkt wspólny', point: 'punkt', hole: 'granica', pole: 'biegun',
};
export const markLabel = (kind: MarkKind, x: number, y: number) => `${KIND[kind]} (${fmt(x)}; ${fmt(y)})`;

/** e as y = f(x) for the graph panel, checked against the worker's own numbers; undefined when they disagree. */
export function graphText(e: Expr, x: string): string | undefined {
  if (variables(e).some(v => v !== x)) return undefined;
  const g = x === 'x' ? e : subst(e, x, sym('x'));
  const text = toText(g);
  try {
    const page = compile(text), here = compileDouble(g, 'x');
    for (const t of [-7.3, -2.7, -1.3, -0.41, 0.35, 0.8, 1.1, 2.9, 6.2]) {
      const a = page(t), b = here(t);
      if (Number.isFinite(a) !== Number.isFinite(b) || (Number.isFinite(a) && Math.abs(a - b) > 1e-6 * (1 + Math.abs(b)))) return undefined;
    }
    return text;
  } catch {
    return undefined;
  }
}

/** f sampled on [lo; hi], cut where it is undefined or jumps (an asymptote). */
function sample(f: RealFn, lo: number, hi: number, N = 900): { segs: number[][]; ys: number[] } {
  const segs: number[][] = [], ys: number[] = [];
  let cur: number[] = [], prev = NaN;
  for (let i = 0; i <= N; i++) {
    const t = lo + (hi - lo) * i / N, y = f(t);
    if (!Number.isFinite(y) || Math.abs(y) > 1e12) { if (cur.length > 2) segs.push(cur); cur = []; prev = NaN; continue; }
    ys.push(y);
    if (Number.isFinite(prev) && Math.sign(y) !== Math.sign(prev) && Math.abs(y - prev) > 10 && Math.abs(y - prev) > 5e4 * (Math.abs(prev) + Math.abs(y) + 1) / N) { if (cur.length > 2) segs.push(cur); cur = []; }
    cur.push(t, y);
    prev = y;
  }
  if (cur.length > 2) segs.push(cur);
  return { segs, ys };
}

/** The 3rd–97th percentile of the values: spikes at asymptotes don't flatten everything else. */
function robust(ys: number[]): [number, number] | null {
  if (!ys.length) return null;
  const s = [...ys].sort((a, b) => a - b);
  return [s[Math.floor(s.length * 0.03)], s[Math.ceil(s.length * 0.97) - 1]];
}

/** Zeros, extrema and inflection points of f on [lo; hi], found on a fine grid and refined. */
export function features(f: RealFn, lo: number, hi: number, kinds: MarkKind[], span: number): { x: number; kind: MarkKind }[] {
  const N = 1200, h = (hi - lo) / N, xs: number[] = [], ys: number[] = [], out: { x: number; kind: MarkKind }[] = [];
  for (let i = 0; i <= N; i++) { xs.push(lo + h * i); ys.push(f(lo + h * i)); }
  const ok = Number.isFinite, want = new Set(kinds), gap = Math.max(span, 1e-12) * 0.5;
  // no jump within the step from i to i + 1
  const smooth = (i: number) => ok(ys[i]) && ok(ys[i + 1]) && Math.abs(ys[i + 1] - ys[i]) < gap;
  if (want.has('zero')) {
    // samples that are exactly 0: one zero per run, and none from float underflow (x²⁰⁰ near 0)
    for (const x of zeroRuns(xs, ys)) out.push({ x, kind: 'zero' });
    for (let i = 0; i <= N; i++) {
      if (ys[i] === 0) continue;
      if (i === N || !smooth(i) || ys[i] * ys[i + 1] >= 0) continue;
      let l = xs[i], r = xs[i + 1], fl = ys[i];
      for (let k = 0; k < 64; k++) {
        const m = (l + r) / 2, fm = f(m);
        if (!ok(fm) || fm === 0) { l = r = m; break; }
        if ((fm < 0) === (fl < 0)) { l = m; fl = fm; } else r = m;
      }
      const x = (l + r) / 2;
      if (Math.abs(f(x)) <= 1e-6 * Math.max(span, 1)) out.push({ x, kind: 'zero' });
    }
  }
  if (want.has('max') || want.has('min')) {
    for (let i = 1; i < N; i++) {
      if (!smooth(i - 1) || !smooth(i)) continue;
      const d1 = ys[i] - ys[i - 1], d2 = ys[i + 1] - ys[i];
      const max = d1 > 0 && d2 < 0, min = d1 < 0 && d2 > 0;
      if (!(max && want.has('max')) && !(min && want.has('min'))) continue;
      // golden-section search for the turning point
      const s = max ? 1 : -1, g = (t: number) => s * f(t), phi = (Math.sqrt(5) - 1) / 2;
      let a = xs[i - 1], b = xs[i + 1], c = b - phi * (b - a), d = a + phi * (b - a);
      for (let k = 0; k < 60; k++) { if (g(c) > g(d)) b = d; else a = c; c = b - phi * (b - a); d = a + phi * (b - a); }
      out.push({ x: (a + b) / 2, kind: max ? 'max' : 'min' });
    }
  }
  if (want.has('inflection')) {
    const dd: number[] = [];
    for (let i = 1; i < N; i++) dd[i] = ys[i - 1] - 2 * ys[i] + ys[i + 1];
    const noise = 1e-9 * (Math.max(span, 1e-12) + 1);
    const g = (t: number) => f(t - h) - 2 * f(t) + f(t + h);
    for (let i = 1; i < N - 1; i++) {
      const p = dd[i], q = dd[i + 1];
      if (!ok(p) || !ok(q) || Math.abs(p) < noise || Math.abs(q) < noise || p * q > 0 || !smooth(i - 1) || !smooth(i) || !smooth(i + 1)) continue;
      let l = xs[i], r = xs[i + 1], gl = p;
      for (let k = 0; k < 40; k++) { const m = (l + r) / 2, gm = g(m); if (!ok(gm)) break; if ((gm < 0) === (gl < 0)) { l = m; gl = gm; } else r = m; }
      out.push({ x: (l + r) / 2, kind: 'inflection' });
    }
  }
  // ponytail: a fixed cap per kind; past it (sin x on a wide range) the dots would only clutter the plot
  const count = (k: MarkKind) => out.filter(m => m.kind === k).length;
  return out.filter(m => count(m.kind) <= 24);
}

export interface PlotOptions {
  /** x values the view should take in. */
  hints?: number[];
  /** Points known exactly: their kind and series (0 by default); y is computed. */
  at?: { x: number; y?: number; kind: MarkKind; series?: number; label?: string }[];
  /** Per series: which points to look for numerically. */
  find?: MarkKind[][];
  /** Mark where series 0 and 1 meet. */
  crossings?: boolean;
  labels?: (string | undefined)[];
  dash?: boolean[];
  faint?: boolean[];
  bands?: [number, number][]; vlines?: number[]; hlines?: number[]; refs?: Ref[];
  fills?: Omit<Fill, 'series'>[];
  /** The x range to show, instead of one chosen around the hints. */
  range?: [number, number];
}

/** Functions of x plotted together, with their notable points marked. */
export function plotOf(es: Expr[], x: string, o: PlotOptions = {}): Plot | null {
  const fs = es.map(e => compileDouble(e, x));
  const hints = [...(o.hints ?? []), ...(o.at ?? []).map(a => a.x)].filter(v => Number.isFinite(v) && Math.abs(v) < 1e6);
  const trig = es.some(e => periodic(toText(e)));
  let [lo, hi] = o.range ?? (trig ? [-2 * Math.PI, 2 * Math.PI] : [-10, 10]);
  if (!o.range && hints.length) {
    const a = Math.min(...hints), b = Math.max(...hints), w = Math.max(b - a, 2);
    lo = Math.min(-1, a - w * 0.6); hi = Math.max(1, b + w * 0.6);
    if (hi - lo < 4) { const c = (lo + hi) / 2; lo = c - 2; hi = c + 2; }
  }
  const all: number[] = [];
  const series: Series[] = fs.map((f, k) => {
    const { segs, ys } = sample(f, lo, hi);
    all.push(...ys);
    return { label: o.labels?.[k] ?? toText(es[k]), segs, expr: graphText(es[k], x), graph: true, dash: o.dash?.[k] || undefined, faint: o.faint?.[k] || undefined };
  });
  const r = robust(all);
  if (!r) return null;
  let [ylo, yhi] = r;
  const span = yhi - ylo;

  // notable points: the known ones first, then what the numeric search adds that isn't already there
  const marks: Mark[] = [];
  const near = (x: number, s: number) => marks.find(n => n.series === s && Math.abs(n.x - x) < (hi - lo) * 2e-3);
  const add = (x: number, kind: MarkKind, s: number, label?: string) => {
    const y = kind === 'zero' ? 0 : fs[s]?.(x);
    if (y === undefined || !Number.isFinite(y)) return;
    // one dot per place: a zero that is also an inflection point says both
    const there = near(x, s);
    if (there) { if (there.kind !== kind && !there.label.includes(KIND[kind])) there.label = there.label.replace(' (', `, ${KIND[kind]} (`); return; }
    marks.push({ x, y: kind === 'zero' ? 0 : y, kind, label: label ?? markLabel(kind, x, y), color: s, series: s });
  };
  for (const a of o.at ?? []) {
    const s = a.series ?? 0;
    if (a.kind === 'hole' || a.kind === 'pole') marks.push({ x: a.x, y: a.y ?? NaN, kind: a.kind, label: a.label ?? '', color: s, series: s });
    else add(a.x, a.kind, s, a.label);
  }
  if (o.crossings && fs.length >= 2) {
    const [f, g] = fs;
    for (const p of features(t => f(t) - g(t), lo, hi, ['zero'], span)) add(p.x, 'cross', 0);
  }
  (o.find ?? []).forEach((kinds, s) => { if (fs[s] && kinds.length) for (const p of features(fs[s], lo, hi, kinds, span)) add(p.x, p.kind, s); });

  const my = marks.map(m => m.y).filter(Number.isFinite);
  if (my.length >= 2) {
    const a = Math.min(...my), b = Math.max(...my), S = Math.max(b - a, 1);
    if (span > 6 * S) { ylo = Math.max(ylo, a - 1.5 * S); yhi = Math.min(yhi, b + 1.5 * S); }
  }
  for (const m of marks) if (Number.isFinite(m.y) && Math.abs(m.y - (ylo + yhi) / 2) < 10 * (span + 1)) { ylo = Math.min(ylo, m.y); yhi = Math.max(yhi, m.y); }
  for (const v of [...(o.hlines ?? []), ...(o.refs ?? []).flatMap(r => r.y ?? [])]) if (Math.abs(v - (ylo + yhi) / 2) < 10 * (span + 1)) { ylo = Math.min(ylo, v); yhi = Math.max(yhi, v); }
  if (ylo > 0 && ylo < yhi - ylo) ylo = 0;
  if (yhi < 0 && -yhi < yhi - ylo) yhi = 0;
  if (yhi - ylo < 1e-9) { ylo -= 1; yhi += 1; }
  const pad = (yhi - ylo) * 0.12;
  const plot = blank([lo, hi], [ylo - pad, yhi + pad]);
  if (trig) plot.xUnit = 'pi';
  plot.series = series;
  plot.marks = marks;
  plot.bands = (o.bands ?? []).map(([a, b]) => [Math.max(a, lo - 1), Math.min(b, hi + 1)]);
  plot.vlines = o.vlines ?? [];
  plot.hlines = o.hlines ?? [];
  plot.refs = o.refs ?? [];
  plot.fills = (o.fills ?? []).map(f => ({ ...f, series: 0 }));
  return plot;
}

/** Fits the view around the points (flat [x, y, …]) with a margin; equal axes. */
function around(pts: number[], min = 2): [[number, number], [number, number]] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (!Number.isFinite(pts[i]) || !Number.isFinite(pts[i + 1])) continue;
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  if (x0 > x1) return [[-min, min], [-min, min]];
  const w = Math.max(x1 - x0, y1 - y0, min) * 0.65, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return [[cx - w, cx + w], [cy - w, cy + w]];
}

const circle = (cx: number, cy: number, r: number, from = 0, to = 2 * Math.PI, n = 160): number[] =>
  Array.from({ length: n + 1 }, (_, i) => { const t = from + (to - from) * i / n; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; }).flat();

/** A complex number on the plane: its vector, conjugate, modulus circle and argument. */
export function argandPlot(re: number, im: number, texts?: { z: string; conj: string; r: string }): Plot {
  const r = Math.hypot(re, im), phi = Math.atan2(im, re);
  const [x, y] = around([0, 0, re, im, re, -im, r, 0, -r, 0, 0, r, 0, -r], 1);
  const p = blank(x, y);
  p.equal = p.plane = true;
  p.series.push({ label: `|z| = ${fmt(r)}`, segs: [circle(0, 0, r)], dash: true, color: 2 });
  p.vectors.push({ x1: 0, y1: 0, x2: re, y2: im, label: '', color: 0 });
  if (im) p.vectors.push({ x1: 0, y1: 0, x2: re, y2: -im, label: 'z̄', color: 1, dash: true });
  p.shapes.push({ pts: [re, 0, re, im, 0, im], label: 'Re z, Im z', open: true, dash: true, color: 4 });
  if (r) p.shapes.push({ pts: circle(0, 0, r * 0.28, Math.min(0, phi), Math.max(0, phi), 40), label: `arg z = ${fmt(phi)}`, open: true, color: 3 });
  p.marks.push({ x: re, y: im, kind: 'point', label: `z = ${fmt(re)}${im < 0 ? ' − ' : ' + '}${fmt(Math.abs(im))}i`, color: 0 });
  if (texts) {
    const rows: HandoffRow[] = [{ expr: pointText(texts.z, re, im), color: 0 }];
    if (im) rows.push({ expr: pointText(texts.conj, re, -im), color: 1 });
    rows.push({ expr: `|z| = ${pointText(texts.r, r, 0)}`, series: 0, color: 2, dash: true });
    p.open = { mode: 'graph', rows };
  }
  return p;
}

/** Solutions on the complex plane; roots with one modulus get their circle and the polygon they make. */
export function rootsPlot(zs: { re: number; im: number; label: string }[], equation?: string): Plot | null {
  if (!zs.length) return null;
  const rs = zs.map(z => Math.hypot(z.re, z.im)), r = rs[0];
  const same = zs.length >= 2 && r > 0 && rs.every(v => Math.abs(v - r) < 1e-9 * Math.max(1, r));
  const pts = zs.flatMap(z => [z.re, z.im]);
  const [x, y] = around(same ? [...pts, r, r, -r, -r] : [...pts, 0, 0], 1);
  const p = blank(x, y);
  p.equal = p.plane = true;
  if (same) {
    p.series.push({ label: `|z| = ${fmt(r)}`, segs: [circle(0, 0, r)], dash: true, color: 2 });
    if (zs.length >= 3) {
      const sorted = [...zs].sort((a, b) => Math.atan2(a.im, a.re) - Math.atan2(b.im, b.re));
      p.shapes.push({ pts: sorted.flatMap(z => [z.re, z.im]), label: 'wielokąt z rozwiązań', fill: true, color: 0 });
    }
  }
  for (const z of zs) p.marks.push({ x: z.re, y: z.im, kind: 'point', label: z.label, color: Math.abs(z.im) < 1e-12 ? 4 : 0 });
  p.open = { mode: 'graph', rows: equation ? [{ expr: equation, color: 0 }] : zs.map(z => ({ expr: pointText('', z.re, z.im), color: 0 })) };
  if (same) p.open.rows.push({ expr: `|z| = ${plain(r)}`, series: 0, color: 2, dash: true });
  return p;
}

/** What a 2×2 matrix does to the plane: the unit square's image, the images of e₁ and e₂, real eigenvector lines. */
export function matrixPlot(a: number, b: number, c: number, d: number): Plot | null {
  if (![a, b, c, d].every(Number.isFinite)) return null;
  const [x, y] = around([0, 0, 1, 1, a, c, b, d, a + b, c + d, -1, -1], 2);
  const p = blank(x, y);
  p.equal = true;
  p.shapes.push({ pts: [0, 0, 1, 0, 1, 1, 0, 1], label: 'kwadrat jednostkowy', dash: true, color: 4 });
  const det = a * d - b * c;
  p.shapes.push({ pts: [0, 0, a, c, a + b, c + d, b, d], label: `obraz kwadratu, pole = |det A| = ${fmt(Math.abs(det))}`, fill: true, color: 0 });
  p.vectors.push({ x1: 0, y1: 0, x2: a, y2: c, label: 'Ae₁', color: 1 }, { x1: 0, y1: 0, x2: b, y2: d, label: 'Ae₂', color: 2 });
  const tr = a + d, disc = tr * tr - 4 * det;
  if (disc >= 0) {
    const ls = disc === 0 ? [tr / 2] : [(tr + Math.sqrt(disc)) / 2, (tr - Math.sqrt(disc)) / 2];
    ls.forEach((l, k) => {
      // (A − λI)v = 0: v = (b; l − a), or (l − d; c) when that row vanishes
      let vx = b, vy = l - a;
      if (Math.hypot(vx, vy) < 1e-12) { vx = l - d; vy = c; }
      if (Math.hypot(vx, vy) < 1e-12) return; // A = λI: every direction is an eigenvector
      const label = `prosta własna, λ = ${fmt(l)}`;
      if (Math.abs(vx) < 1e-12 * Math.abs(vy)) { p.refs.push({ x: 0, label }); return; }
      const slope = vy / vx, R = 4 * (x[1] - x[0]);
      const m = Number(slope.toPrecision(15));
      p.series.push({ label, segs: [[-R, -R * slope, R, R * slope]], expr: m === 1 ? 'x' : m === -1 ? '-x' : m ? `${m}*x` : '0', dash: true, color: 5 + k });
    });
  }
  return p;
}

/** A histogram of the data with the mean, the median and one standard deviation either side. */
export function statsPlot(values: number[]): Plot | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const n = v.length, lo = v[0], hi = v[n - 1];
  const neumaier = (xs: number[]) => {
    let s = 0, c = 0;
    for (const t of xs) { const y = s + t; c += Math.abs(s) >= Math.abs(t) ? (s - y) + t : (t - y) + s; s = y; }
    return s + c;
  };
  const mean = neumaier(v) / n, median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  const sd = Math.sqrt(neumaier(v.map(t => (t - mean) ** 2)) / n);
  // integers in a short range: one bar per value; otherwise Sturges' rule
  const ints = v.every(Number.isInteger) && hi - lo <= 40;
  const bins = ints ? hi - lo + 1 : Math.max(1, Math.ceil(Math.log2(n) + 1));
  const w = ints ? 1 : (hi - lo) / bins || 1, start = ints ? lo - 0.5 : lo;
  const counts = Array<number>(bins).fill(0);
  for (const t of v) counts[Math.min(bins - 1, Math.floor((t - start) / w))]++;
  const top = Math.max(...counts);
  const p = blank([start - w, start + (bins + 1) * w], [-top * 0.08, top * 1.3]);
  counts.forEach((h, i) => { if (h) p.bars.push({ x0: start + i * w, x1: start + (i + 1) * w, h, label: `${ints ? fmt(start + i * w + 0.5) : `⟨${fmt(start + i * w)}; ${fmt(start + (i + 1) * w)})`}: ${h}` }); });
  if (sd > 0) p.bands.push([mean - sd, mean + sd]);
  p.refs.push({ x: mean, label: `średnia ${fmt(mean)}` });
  if (Math.abs(median - mean) > 1e-12 * (Math.abs(mean) + 1)) p.refs.push({ x: median, label: `mediana ${fmt(median)}` });
  return p;
}

/** The terms aₖ as stems and the partial sums Sₙ as dots, with the sum's value when it is known. */
export function sequencePlot(f: RealFn, k0: number, k1: number, total?: number, term = 'aₖ'): Plot | null {
  const last = Math.min(k1, k0 + 59);
  const terms: number[] = [], sums: number[] = [];
  let s = 0, c = 0;
  for (let k = k0; k <= last; k++) {
    const t = f(k);
    if (!Number.isFinite(t)) return null;
    const y = s + t;
    c += Math.abs(s) >= Math.abs(t) ? (s - y) + t : (t - y) + s;
    s = y;
    terms.push(k, t);
    sums.push(k, s + c);
  }
  if (!terms.length) return null;
  const ys = [...terms.filter((_, i) => i % 2), ...sums.filter((_, i) => i % 2), 0, ...(total !== undefined && Number.isFinite(total) ? [total] : [])];
  const r = robust(ys)!, lo = Math.min(r[0], 0), hi = Math.max(r[1], 0, ...(total !== undefined && Number.isFinite(total) ? [total] : [])), pad = (hi - lo || 1) * 0.12;
  const p = blank([k0 - 1, last + 1], [lo - pad, hi + pad]);
  p.series.push({ label: `wyrazy ${term}`, segs: [terms], style: 'stems', color: 0 }, { label: 'sumy częściowe Sₙ', segs: [sums], style: 'dots', color: 1 });
  if (total !== undefined && Number.isFinite(total)) p.refs.push({ y: total, label: `suma = ${fmt(total)}` });
  return p;
}

/** F(x, y) = 0 traced by marching squares on [x0; x1] × [y0; y1]; pieces as two-point segments. */
function contour(F: (x: number, y: number) => number, x0: number, x1: number, y0: number, y1: number, nx = 180, ny = 180): number[][] {
  const v: number[][] = [];
  for (let j = 0; j <= ny; j++) { const y = y0 + (y1 - y0) * j / ny, row: number[] = []; for (let i = 0; i <= nx; i++) row.push(F(x0 + (x1 - x0) * i / nx, y)); v.push(row); }
  const X = (i: number) => x0 + (x1 - x0) * i / nx, Y = (j: number) => y0 + (y1 - y0) * j / ny, out: number[][] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = [v[j][i], v[j][i + 1], v[j + 1][i + 1], v[j + 1][i]];
    if (!c.every(Number.isFinite)) continue;
    const corners: [number, number][] = [[X(i), Y(j)], [X(i + 1), Y(j)], [X(i + 1), Y(j + 1)], [X(i), Y(j + 1)]];
    const hits: number[] = [];
    for (let e = 0; e < 4; e++) {
      const a = c[e], b = c[(e + 1) % 4];
      if ((a < 0) === (b < 0) || a === b) continue;
      const t = a / (a - b), [ax, ay] = corners[e], [bx, by] = corners[(e + 1) % 4], px = ax + t * (bx - ax), py = ay + t * (by - ay);
      // a sign change across a pole (1/x = y near x = 0) isn't a curve
      if (Math.abs(F(px, py)) > 0.5 * (Math.abs(a) + Math.abs(b))) continue;
      hits.push(px, py);
    }
    if (hits.length === 4) out.push(hits);
    else if (hits.length === 8) out.push(hits.slice(0, 4), hits.slice(4));
  }
  return stitch(out, Math.min((x1 - x0) / nx, (y1 - y0) / ny) * 1e-6);
}

/** Joins two-point pieces that share an end into longer polylines. */
function stitch(pieces: number[][], eps: number): number[][] {
  const key = (x: number, y: number) => `${Math.round(x / eps)},${Math.round(y / eps)}`;
  // a curve through a grid corner leaves zero-length pieces in the cells around it
  pieces = pieces.filter(p => key(p[0], p[1]) !== key(p[2], p[3]));
  const ends = new Map<string, number[]>();
  pieces.forEach((p, i) => { for (const k of [key(p[0], p[1]), key(p[2], p[3])]) { const list = ends.get(k); if (list) list.push(i); else ends.set(k, [i]); } });
  const used = new Set<number>(), out: number[][] = [];
  const next = (x: number, y: number): number | undefined => ends.get(key(x, y))?.find(i => !used.has(i));
  pieces.forEach((p, i) => {
    if (used.has(i)) return;
    used.add(i);
    const line = [...p];
    // grow forwards from the last point, then backwards from the first
    for (let j = next(line.at(-2)!, line.at(-1)!); j !== undefined; j = next(line.at(-2)!, line.at(-1)!)) {
      used.add(j);
      const q = pieces[j], fwd = key(q[0], q[1]) === key(line.at(-2)!, line.at(-1)!);
      line.push(...(fwd ? [q[2], q[3]] : [q[0], q[1]]));
    }
    for (let j = next(line[0], line[1]); j !== undefined; j = next(line[0], line[1])) {
      used.add(j);
      const q = pieces[j], fwd = key(q[2], q[3]) === key(line[0], line[1]);
      line.unshift(...(fwd ? [q[0], q[1]] : [q[2], q[3]]));
    }
    out.push(line);
  });
  return out;
}

/** Curves F(x, y) = 0 in two variables, with the points given (solutions of a system) marked. */
export function implicitPlot(fs: Expr[], vx: string, vy: string, labels: string[], points: [number, number][] = [], sides?: [Expr, Expr][]): Plot | null {
  const Fs = fs.map(e => { const rows = new Map<number, RealFn>(); return (x: number, y: number) => { let f = rows.get(y); if (!f) { f = compileDouble(e, vx, { [vy]: y }); rows.set(y, f); } return f(x); }; });
  // find where the curves are: try a few scales, then fit the view to what was found
  let segs: number[][][] = [];
  for (const R of [10, 100, 2, 1000]) {
    segs = Fs.map(F => contour(F, -R, R, -R, R, 90, 90));
    if (segs.some(s => s.length)) break;
  }
  const pts = [...segs.flat(2), ...points.flat()];
  if (!pts.length) return null;
  // around the solutions when there are some, else around the curves
  const [x, y] = points.length ? around(points.flat(), 4) : around(pts, 1);
  const p = blank(x, y);
  p.equal = true;
  // traced on three times the view, so moving it a little still shows the curve
  const wx = x[1] - x[0], wy = y[1] - y[0];
  Fs.forEach((F, k) => p.series.push({ label: labels[k], segs: contour(F, x[0] - wx, x[1] + wx, y[0] - wy, y[1] + wy, 360, 360), color: k }));
  for (const [a, b] of points) p.marks.push({ x: a, y: b, kind: 'cross', label: `(${fmt(a)}; ${fmt(b)})`, color: 0 });
  const rows = (sides ?? fs.map(f => [f, ZERO] as [Expr, Expr])).map(([l, r], k) => {
    const t = planeCondition([l, isZero(r) ? ZERO : r], ['='], vx, vy);
    return t && { expr: t, series: k, color: k };
  });
  if (rows.every(Boolean)) p.open = { mode: 'graph', rows: [...rows as HandoffRow[], ...points.map(([a, b]) => ({ expr: pointText('', a, b), color: 0 }))] };
  return p;
}

/** The region where a condition on x and y holds, filled as Zbiory fills it, with its boundary curves. */
export function regionPlot(parts: Expr[], ops: string[], vx: string, vy: string, label: string): Plot | null {
  const condition = planeCondition(parts, ops, vx, vy);
  if (!condition) return null;
  // the boundary: where each comparison turns into an equality
  const edges = parts.slice(1).map((r, k) => sub(parts[k], r));
  const boundary = implicitPlot(edges, vx, vy, edges.map(() => label));
  const p = boundary ?? blank([-10, 10], [-10, 10]);
  p.equal = true;
  p.series = p.series.map((s, k) => ({ ...s, label: k ? '' : `brzeg: ${label}`, dash: /^[<>]$|≠/.test(ops[k] ?? '') || undefined, color: 0 }));
  p.regions = [{ expr: condition, color: 0 }];
  p.open = { mode: 'graph', rows: [{ expr: condition, color: 0 }] };
  return p;
}

/** A parametric curve for Zbiory: x(t) + y(t)·i over [t0; t1]. */
export function curveRow(ex: Expr, ey: Expr, t: string, t0: number, t1: number, series: number): HandoffRow | undefined {
  const text = curveText(ex, ey, t);
  return text ? { expr: text, series, color: series, from: t0, to: t1 } : undefined;
}

/** A curve (x(t); y(t)), t from t0 to t1. */
export function parametricSeries(ex: Expr, ey: Expr, t: string, t0: number, t1: number, label: string, color: number): Series {
  const fx = compileDouble(ex, t), fy = compileDouble(ey, t), N = 2000, segs: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = t0 + (t1 - t0) * i / N, a = fx(s), b = fy(s);
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 1e9 || Math.abs(b) > 1e9) { if (cur.length > 2) segs.push(cur); cur = []; continue; }
    cur.push(a, b);
  }
  if (cur.length > 2) segs.push(cur);
  return { label, segs, color };
}

/** Puts several pieces in one view with equal axes: implicit and parametric curves next to graphs of functions. */
export function combine(parts: Plot[]): Plot | null {
  if (!parts.length) return null;
  const x: [number, number] = [Math.min(...parts.map(p => p.x[0])), Math.max(...parts.map(p => p.x[1]))];
  const y: [number, number] = [Math.min(...parts.map(p => p.y[0])), Math.max(...parts.map(p => p.y[1]))];
  const p = blank(x, y);
  p.equal = parts.some(q => q.equal);
  p.xUnit = parts.every(q => q.xUnit === 'pi') ? 'pi' : undefined;
  for (const q of parts) {
    const base = p.series.length;
    p.series.push(...q.series.map((s, k) => ({ ...s, color: s.color ?? base + k })));
    p.marks.push(...q.marks.map(m => ({ ...m, color: m.series === undefined ? m.color : m.series + base, series: m.series === undefined ? undefined : m.series + base })));
    p.vlines.push(...q.vlines); p.hlines.push(...q.hlines); p.refs.push(...q.refs);
  }
  return p;
}
