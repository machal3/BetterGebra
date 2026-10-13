/** Everything the analysis panel and hover snapping need, computed off the main thread. Pure: no DOM. */
import { complexRoots, exactPoint, exactValue, extrema, intersections, isolated, roots, compile } from '../math';
import type { Complex, ComplexFunction, Params } from '../math';
import { compileRow, type Compiled } from '../model';
import { approx, complexValue, list } from '../format';
import type { FnState, Mode } from '../state';
import type { SetPoints } from '../render/sets';

export interface AnalysisRequest {
  gen: number;
  mode: Mode;
  functions: FnState[];
  activeId: number;
  params: Params;
  /** Visible world rectangle and its size on screen. */
  bounds: { xmin: number; xmax: number; ymin: number; ymax: number; width: number; height: number };
}

/** A point with its coordinates as text: proven exact, or ≈. */
export interface Mark { x: number; y: number; text: string; color?: string }

export interface AnalysisResult {
  gen: number;
  activeId: number;
  /** Value texts at x = 0 and x = 1 (not for sets). */
  values: [string, string] | null;
  roots: string;
  /** null when there is nothing to intersect with. */
  intersections: string | null;
  marks: Mark[];
  /** Not drawn, but the cursor sticks to them: extrema and y-intercepts of every graph. */
  snaps: Mark[];
  setPoints: Record<number, SetPoints>;
}

type Row = { f: FnState; c: Compiled };
const pointText = (x: string, y: string) => `x = ${x}   y = ${y}`;

export function analyse(req: AnalysisRequest): AnalysisResult {
  const params = req.params;
  const rows: Row[] = req.functions.map(f => ({ f, c: compileRow(f, req.mode, params) }));
  const active = rows.find(r => r.f.id === req.activeId);
  const shown = rows.filter(r => r.f.visible && r.c.ok);
  const result: AnalysisResult = { gen: req.gen, activeId: req.activeId, values: null, roots: '—', intersections: null, marks: [], snaps: [], setPoints: {} };
  if (req.mode === 'complex') return active?.c.ok ? analyseComplex(req, active, shown, result) : result;
  // Wykresy: the sets' solutions are needed for drawing whichever row is active; the graph analysis for a graph
  analyseSets(req, rows, active, result);
  if (!active?.c.ok || !active.c.fn) return result;
  return analyseReal(req, active, shown.filter(r => r.c.fn), result);
}

function valueText(c: Compiled, fn: (x: number) => number, params: Params, x: number): string {
  const proven = exactValue(c.real!, params, x), y = fn(x);
  return proven === undefined || !Number.isFinite(y) ? 'nie istnieje' : proven ?? approx(y);
}

function analyseReal(req: AnalysisRequest, active: Row, shown: Row[], out: AnalysisResult): AnalysisResult {
  const { xmin, xmax } = req.bounds, params = req.params, fn = active.c.fn!, expr = active.f.expression;
  out.values = [valueText(active.c, fn, params, 0), valueText(active.c, fn, params, 1)];
  const zeroOnView = (h: (x: number) => number) => Array.from({ length: 31 }, (_, i) => h(xmin + (xmax - xmin) * i / 30)).every(y => y === 0);

  const allZero = zeroOnView(fn), xs = allZero ? [] : roots(fn, xmin, xmax);
  const labels = xs.map(x => exactPoint([expr, '0'], params, x)?.x ?? approx(x));
  const rootMarks: Mark[] = xs.map((x, k) => ({ x, y: 0, text: pointText(labels[k], '0') }));
  out.roots = allZero ? 'cały widoczny zakres' : xs.length ? `x = ${list(labels)}` : 'brak';

  const others = shown.filter(r => r !== active && !zeroOnView(x => fn(x) - r.c.fn!(x)));
  const crossings = others.flatMap(r => intersections(fn, r.c.fn!, xmin, xmax).map(p => {
    const proven = exactPoint([expr, r.f.expression], params, p.x);
    return { ...p, xs: proven?.x ?? approx(p.x), ys: proven?.y ?? approx(p.y) };
  }))
    .sort((a, b) => a.x - b.x)
    .filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y); // several graphs through one point: once
  out.intersections = !others.length ? null : crossings.length ? list(crossings.map(p => `(${p.xs}; ${p.ys})`), 4) : 'brak';
  if (active.f.visible) out.marks = [...rootMarks, ...crossings.map(p => ({ x: p.x, y: p.y, text: pointText(p.xs, p.ys) }))];

  out.snaps = shown.flatMap(r => {
    const g = r.c.fn!, y0 = g(0);
    const points = extrema(g, xmin, xmax).map(p => ({ ...p, text: pointText(approx(p.x), approx(p.y)), color: r.f.color }));
    if (Number.isFinite(y0)) points.push({ x: 0, y: y0, text: pointText('0', exactValue(r.f.expression, params, 0) ?? approx(y0)), color: r.f.color });
    return points;
  });
  return out;
}

function grid(req: AnalysisRequest) {
  const { xmin, xmax, ymin, ymax, width, height } = req.bounds;
  return { xmin, xmax, ymin, ymax, rows: Math.max(8, Math.round(64 * height / width)), pxPerUnit: width / (xmax - xmin) };
}

/** Isolated zeros of g in view; near a curve of zeros or an essential singularity nothing is reported. */
function isolatedZeros(req: AnalysisRequest, g: ComplexFunction): Complex[] {
  const b = grid(req), all = complexRoots(g, b.xmin, b.xmax, b.ymin, b.ymax, 64, b.rows);
  return all.filter(z => isolated(g, z, Math.min(6 / b.pxPerUnit, ...all.filter(w => w !== z).map(w => Math.hypot(w[0] - z[0], w[1] - z[1]) / 3))));
}

function analyseComplex(req: AnalysisRequest, active: Row, shown: Row[], out: AnalysisResult): AnalysisResult {
  const params = req.params, c = active.c, cf = c.cfn!;
  const realFn = c.real === null ? null : compile(c.real, params);
  out.values = [0, 1].map(x => {
    if (!realFn || !Number.isFinite(realFn(x))) return complexValue(cf([x, 0]));
    return valueText(c, realFn, params, x);
  }) as [string, string];

  const label = (z: Complex, h: ComplexFunction, expressions: (string | null)[]) => {
    const proven = z[1] === 0 && expressions.every(e => e !== null) ? exactPoint(expressions as string[], params, z[0]) : null;
    if (proven?.x) return proven.x;
    const w = h(z);
    return complexValue(z, z.every(Number.isInteger) && w[0] === 0 && w[1] === 0);
  };
  const zeros = isolatedZeros(req, cf), labels = zeros.map(z => label(z, cf, [c.real, '0']));
  const rootMarks: Mark[] = zeros.map((z, k) => ({ x: z[0], y: z[1], text: `z = ${labels[k]}` }));
  out.roots = zeros.length ? `z = ${list(labels)}` : 'brak';
  const others = shown.filter(r => r !== active);
  const crossings = others.flatMap(r => {
    const g = r.c.cfn!, h: ComplexFunction = z => { const [a, b] = cf(z), [p, q] = g(z); return [a - p, b - q]; };
    return isolatedZeros(req, h).map(z => ({ z, label: label(z, h, [c.real, r.c.real]) }));
  });
  out.intersections = !others.length ? null : crossings.length ? `z = ${list(crossings.map(p => p.label), 4)}` : 'brak';
  if (active.f.visible) out.marks = [...rootMarks, ...crossings.map(p => ({ x: p.z[0], y: p.z[1], text: `z = ${p.label}` }))];
  return out;
}

function analyseSets(req: AnalysisRequest, rows: Row[], active: Row | undefined, out: AnalysisResult): AnalysisResult {
  const b = grid(req);
  for (const { f, c } of rows) {
    if (!c.ok || !f.visible || c.set?.kind !== 'condition') continue;
    const { sides, ops } = c.set;
    const difference = (o: number): ComplexFunction => z => { const [p, q] = sides[o](z), [r, s] = sides[o + 1](z); return [p - r, q - s]; };
    const isolatedOf = (h: ComplexFunction) => complexRoots(h, b.xmin, b.xmax, b.ymin, b.ymax, 64, b.rows).filter(z => isolated(h, z, 6 / b.pxPerUnit));
    const points: SetPoints = { solutions: [], excluded: [] };
    if (ops.length === 1 && ops[0] === '=') {
      const h = difference(0);
      points.solutions = isolatedOf(h).map(z => ({ z, sure: z.every(Number.isInteger) && h(z).every(v => v === 0) }));
    }
    ops.forEach((op, o) => { if (op === '≠') points.excluded.push(...isolatedOf(difference(o))); });
    out.setPoints[f.id] = points;
  }
  const mine = active && out.setPoints[active.f.id];
  if (mine) out.marks = mine.solutions.map(({ z, sure }) => ({ x: z[0], y: z[1], text: active!.c.xy ? pointText(sure ? String(z[0]) : approx(z[0]), sure ? String(z[1]) : approx(z[1])) : `z = ${complexValue(z, sure)}` }));
  return out;
}
