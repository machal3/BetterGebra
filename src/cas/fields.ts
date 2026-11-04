/**
 * Functions of two variables and fields, as MATLAB draws them: meshgrid, contour (level curves by marching squares),
 * quiver (arrows of a vector field), surf and mesh (surfaces) and plot3 (curves in space). A function comes as an
 * expression in two letters, @(x, y) …, or as matrices from meshgrid; surfaces and curves go to the 3D card.
 */
import { Expr, ONE, ZERO, add, div, isConstant, mul, neg, num, pow, sqrt, sub, subst, sym, variables } from './expr';
import { Value, approxValue, isApprox } from './evaluate';
import { grid, valueOf } from './arrays';
import { diff } from './calculus';
import { integrate } from './integrate';
import { Card, Linalg } from './linalg';
import { det, trace } from './matrix';
import { approx } from './numeric';
import { Fun, funOf, numericFun } from './numerics';
import { type Curve3, type DataSeries, type Plot, type Scene3, type Surface3, type Vector, blank, dataPlot, fmt } from './plot';
import { fail } from './q';
import { toText } from './format';
import { simplify, zeroTest } from './simplify';

type Command = (args: Value[], nout: number) => Linalg | null;
const card = (title: string, rows: [string, Value][], note?: string, plot?: Plot | null): Card => ({ title, rows, note, plot: plot ?? undefined });

/** Numbers of a value, as a grid of doubles. */
const numbers = (v: Value, what: string): number[][] => grid(v, what).map(r => r.map(e => { if (!isConstant(e)) fail(`${what}: oczekuję liczb.`); return approx(e).re; }));
const isNumeric = (v: Value) => (v.t === 'list' || v.t === 'matrix' || v.t === 'expr') && grid(v, 'dane').flat().every(isConstant);
/** [xmin xmax ymin ymax] (default MATLAB's [−5 5 −5 5]). */
function rangeOf(v: Value | undefined, k = 4): number[] {
  if (!v) return k === 4 ? [-5, 5, -5, 5] : [-5, 5];
  const r = numbers(v, 'Zakres').flat();
  if (r.length !== k || r.some(x => !Number.isFinite(x)) || r[0] >= r[1] || (k === 4 && r[2] >= r[3])) fail(k === 4 ? 'Zakres zapisz jako [xmin xmax ymin ymax].' : 'Zakres zapisz jako [tmin tmax].');
  return r;
}
const span = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
/** The values without the few wild ones near poles: the 2nd to 98th percentile, widened. */
function robust(vals: number[]): [number, number] {
  const s = vals.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) fail('Funkcja nie ma tu skończonych wartości.');
  const lo = s[Math.floor(s.length * 0.02)], hi = s[Math.ceil(s.length * 0.98) - 1], w = hi - lo || Math.max(1, Math.abs(hi));
  return [Math.max(s[0], lo - 0.25 * w), Math.min(s[s.length - 1], hi + 0.25 * w)];
}
/** f(x, y) on a grid: z[i][j] at (xs[j], ys[i]). */
function sample(f: Fun, r: number[], n: number): { xs: number[]; ys: number[]; z: number[][] } {
  if (f.outs.length !== 1) fail('Funkcja ma dawać jedną liczbę.');
  const g = numericFun(f), xs = span(r[0], r[1], n), ys = span(r[2], r[3], n);
  return { xs, ys, z: ys.map(y => xs.map(x => g([x, y])[0])) };
}
const title2 = (f: Fun) => (f.outs.length === 1 ? toText(f.outs[0]) : '');

// --- Level curves: marching squares, the pieces joined into lines ---

function levelLines(xs: number[], ys: number[], z: number[][], c: number): number[][] {
  const segs: [number, number, number, number][] = [];
  const cross = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): [number, number] => { const t = (c - z0) / (z1 - z0); return [x0 + t * (x1 - x0), y0 + t * (y1 - y0)]; };
  for (let i = 0; i < ys.length - 1; i++) for (let j = 0; j < xs.length - 1; j++) {
    const v = [z[i][j], z[i][j + 1], z[i + 1][j + 1], z[i + 1][j]];
    if (v.some(w => !Number.isFinite(w))) continue;
    const p = [[xs[j], ys[i]], [xs[j + 1], ys[i]], [xs[j + 1], ys[i + 1]], [xs[j], ys[i + 1]]];
    const pts: [number, number][] = [];
    for (let k = 0; k < 4; k++) {
      const a = v[k], b = v[(k + 1) % 4];
      if ((a < c) !== (b < c)) pts.push(cross(p[k][0], p[k][1], a, p[(k + 1) % 4][0], p[(k + 1) % 4][1], b));
    }
    if (pts.length === 2) segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
    else if (pts.length === 4) {
      // a saddle: the cell's mean decides which corners belong together
      const mid = (v[0] + v[1] + v[2] + v[3]) / 4 < c === v[0] < c;
      segs.push(mid ? [pts[0][0], pts[0][1], pts[3][0], pts[3][1]] : [pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
      segs.push(mid ? [pts[1][0], pts[1][1], pts[2][0], pts[2][1]] : [pts[2][0], pts[2][1], pts[3][0], pts[3][1]]);
    }
  }
  // join pieces that share an end
  const key = (x: number, y: number) => `${Math.round(x * 1e9)},${Math.round(y * 1e9)}`;
  const at = new Map<string, number[]>();
  segs.forEach((s, k) => { for (const e of [key(s[0], s[1]), key(s[2], s[3])]) { const l = at.get(e) ?? []; l.push(k); at.set(e, l); } });
  const used = new Set<number>(), lines: number[][] = [];
  segs.forEach((s0, k0) => {
    if (used.has(k0)) return;
    used.add(k0);
    const line = [s0[0], s0[1], s0[2], s0[3]];
    for (const forward of [true, false]) {
      for (;;) {
        const [x, y] = forward ? line.slice(-2) : line.slice(0, 2);
        const next = (at.get(key(x, y)) ?? []).find(k => !used.has(k));
        if (next === undefined) break;
        used.add(next);
        const s = segs[next], first = key(s[0], s[1]) === key(x, y);
        const [nx, ny] = first ? [s[2], s[3]] : [s[0], s[1]];
        if (forward) line.push(nx, ny); else line.unshift(nx, ny);
      }
    }
    lines.push(line);
  });
  return lines;
}

/** A function of two variables from an expression, @(x, y) …, or data X, Y, Z (meshgrid's): its grid. */
function surfaceData(args: Value[], what: string, n: number, rangeAt = 1): { xs: number[]; ys: number[]; z: number[][]; label: string; rest: Value[] } {
  if (args.length >= 3 && args.slice(0, 3).every(isNumeric)) {
    const [X, Y, Z] = args.slice(0, 3).map(v => numbers(v, what));
    if (Z.length !== X.length && Z.length !== Y.length) fail(`${what}: macierze X, Y i Z mają mieć ten sam rozmiar.`);
    // X, Y from meshgrid (or vectors along the columns and rows)
    const xs = X.length === 1 ? X[0] : X[0], ys = Y.length === 1 ? Y[0] : Y.map(r => r[0]);
    if (xs.length !== Z[0].length || ys.length !== Z.length) fail(`${what}: Z ma ${Z.length}×${Z[0].length}, a siatka ${ys.length}×${xs.length}.`);
    return { xs, ys, z: Z, label: 'z', rest: args.slice(3) };
  }
  if (args.length >= 1 && isNumeric(args[0]) && args[0].t === 'matrix') {
    // surf(Z): the indices as x and y
    const Z = numbers(args[0], what);
    return { xs: Z[0].map((_, j) => j + 1), ys: Z.map((_, i) => i + 1), z: Z, label: 'z', rest: args.slice(1) };
  }
  // surf(f, range); contour(f, levels, range)
  const f = funOf(args[0], 2, what);
  const s = sample(f, rangeOf(args[rangeAt]), n);
  return { ...s, label: title2(f), rest: args.slice(1).filter((_, k) => k + 1 !== rangeAt) };
}

/** The box of a scene, z clipped where a function runs off near a pole. */
function boxOf(xs: number[], ys: number[], zs: number[]): Scene3['box'] {
  const [z0, z1] = robust(zs);
  const lo = (a: number[]) => Math.min(...a.filter(Number.isFinite)), hi = (a: number[]) => Math.max(...a.filter(Number.isFinite));
  return [lo(xs), hi(xs), lo(ys), hi(ys), z0, z1 > z0 ? z1 : z0 + 1];
}
const scene = (s: Scene3): Plot => ({ ...blank([s.box[0], s.box[1]], [s.box[2], s.box[3]]), three: s });

export const FIELDS: Record<string, Command> = {
  meshgrid: ([xv, yv], nout) => {
    const x = grid(xv, 'meshgrid').flat(), y = yv ? grid(yv, 'meshgrid').flat() : x;
    if (x.length * y.length > 100_000) fail('meshgrid: siatka ma ponad 100 000 punktów.');
    const ap = isApprox(xv) || (!!yv && isApprox(yv));
    const X = valueOf(y.map(() => x.slice())), Y = valueOf(y.map(v => x.map(() => v)));
    const [Xv, Yv] = ap ? [approxValue(X), approxValue(Y)] : [X, Y];
    return { cards: [card('Siatka punktów', [['X', Xv], ['Y', Yv]], 'X powtarza wektor x w każdym wierszu, Y wektor y w każdej kolumnie (jak w MATLAB-ie).')], outputs: nout >= 2 ? [Xv, Yv] : [Xv] };
  },
  contour: (args) => {
    const d = surfaceData(args, 'contour', 120, 2);
    const zs = d.z.flat(), [lo, hi] = robust(zs);
    const lv = d.rest[0];
    const levels = lv && (lv.t === 'list' || lv.t === 'matrix') ? numbers(lv, 'Poziomy').flat()
      : (() => { const k = lv ? Math.round(numbers(lv, 'Liczba poziomów')[0][0]) : 10; if (!(k >= 1 && k <= 60)) fail('contour: od 1 do 60 poziomów.'); return Array.from({ length: k }, (_, i) => lo + (hi - lo) * (i + 1) / (k + 1)); })();
    const series: DataSeries[] = levels.map((c, i) => {
      const lines = levelLines(d.xs, d.ys, d.z, c);
      const xs: number[] = [], ys: number[] = [];
      for (const l of lines) { for (let k = 0; k < l.length; k += 2) { xs.push(l[k]); ys.push(l[k + 1]); } xs.push(NaN); ys.push(NaN); }
      return { xs, ys, label: '', color: i % 8 };
    }).filter(s => s.xs.length);
    if (!series.length) fail('contour: żaden z poziomów nie przecina obszaru.');
    const plot = dataPlot(series, { equal: Math.abs((d.xs.at(-1)! - d.xs[0]) / (d.ys.at(-1)! - d.ys[0]) - 1) < 0.5 });
    if (plot) { plot.x = [d.xs[0], d.xs.at(-1)!]; plot.y = [d.ys[0], d.ys.at(-1)!]; }
    return { cards: [card('Poziomice', [], `${d.label ? `f(x, y) = ${d.label}; ` : ''}poziomy: ${levels.map(fmt).join('; ')}.`, plot)], outputs: [] };
  },
  quiver: (args) => {
    let pts: { x: number; y: number; u: number; v: number }[];
    let label = '';
    if (args.length >= 4 && args.slice(0, 4).every(isNumeric)) {
      const [X, Y, U, V] = args.slice(0, 4).map(v => numbers(v, 'quiver').flat());
      if (![Y, U, V].every(a => a.length === X.length)) fail('quiver: X, Y, U i V mają mieć ten sam rozmiar.');
      pts = X.map((x, i) => ({ x, y: Y[i], u: U[i], v: V[i] }));
    } else {
      // quiver([P, Q]) or quiver(P, Q): the field (P(x, y), Q(x, y))
      const pair = args[0]?.t === 'list' || args[0]?.t === 'fn' ? args[0] : { t: 'list', set: false, items: [args[0], args[1]] } as Value;
      const f = funOf(pair, 2, 'quiver');
      if (f.outs.length !== 2) fail('quiver: pole to dwie składowe, np. quiver([-y, x]).');
      const r = rangeOf(pair === args[0] ? args[1] : args[2]), g = numericFun(f), n = 15;
      pts = span(r[0], r[1], n).flatMap(x => span(r[2], r[3], n).map(y => { const [u, v] = g([x, y]); return { x, y, u, v }; }));
      label = `(${f.outs.map(toText).join('; ')})`;
    }
    // arrows scaled together so that the longest fits a cell, as MATLAB's autoscale
    const xs = [...new Set(pts.map(p => p.x))].sort((a, b) => a - b), ys = [...new Set(pts.map(p => p.y))].sort((a, b) => a - b);
    const cell = Math.min(xs.length > 1 ? (xs.at(-1)! - xs[0]) / (xs.length - 1) : 1, ys.length > 1 ? (ys.at(-1)! - ys[0]) / (ys.length - 1) : 1);
    const longest = Math.max(...pts.map(p => Math.hypot(p.u, p.v)).filter(Number.isFinite), 1e-300), s = 0.9 * cell / longest;
    const arrows: Vector[] = pts.filter(p => [p.u, p.v].every(Number.isFinite) && (p.u || p.v)).map(p => ({ x1: p.x, y1: p.y, x2: p.x + s * p.u, y2: p.y + s * p.v, label: '', color: 0 }));
    const plot = dataPlot([], { arrows, equal: true });
    return { cards: [card('Pole wektorowe', [], `${label ? `${label}; ` : ''}długości strzałek proporcjonalne (najdłuższa mieści się w oczku siatki).`, plot)], outputs: [] };
  },
  surf: (args) => surface(args, 'surf', false),
  mesh: (args) => surface(args, 'mesh', true),
  plot3: (args) => {
    let pts: number[] = [], label = '';
    if (args.length >= 3 && args.slice(0, 3).every(isNumeric)) {
      const [X, Y, Z] = args.slice(0, 3).map(v => numbers(v, 'plot3').flat());
      if (Y.length !== X.length || Z.length !== X.length) fail('plot3: x, y i z mają mieć tę samą długość.');
      pts = X.flatMap((x, i) => [x, Y[i], Z[i]]);
    } else {
      // plot3([cos t, sin t, t]) or plot3(cos t, sin t, t), t over [tmin tmax] (−5 to 5 as fplot3)
      const triple = args[0]?.t === 'list' || args[0]?.t === 'fn' ? args[0] : { t: 'list', set: false, items: args.slice(0, 3) } as Value;
      const f = funOf(triple, 1, 'plot3');
      if (f.outs.length !== 3) fail('plot3: krzywa to trzy składowe, np. plot3([cos t, sin t, t/5]).');
      const r = rangeOf(triple === args[0] ? args[1] : args[3], 2), g = numericFun(f);
      pts = span(r[0], r[1], 600).flatMap(t => g([t]));
      label = `(${f.outs.map((e: Expr) => toText(e)).join('; ')}), ${f.vars[0]} ∈ ⟨${fmt(r[0])}; ${fmt(r[1])}⟩`;
    }
    const xs = pts.filter((_, i) => i % 3 === 0), ys = pts.filter((_, i) => i % 3 === 1), zs = pts.filter((_, i) => i % 3 === 2);
    const box = boxOf(xs, ys, zs);
    const curve: Curve3 = { pts, label: label || 'krzywa', color: 0 };
    return { cards: [card('Krzywa w przestrzeni', [], `${label ? `${label}. ` : ''}Przeciągnij, aby obrócić; kółko przybliża.`, scene({ surfaces: [], curves: [curve], box }))], outputs: [] };
  },
  gradient: (args) => gradientCmd(args),
  divergence: (args) => divergenceCmd(args),
  curl: (args) => curlCmd(args),
  potential: (args) => potentialCmd(args),
  laplacian: (args) => laplacianCmd(args),
  jacobian: (args) => jacobianCmd(args),
  hessian: (args) => hessianCmd(args),
  directional: (args) => directionalCmd(args),
  tangentplane: (args) => tangentPlaneCmd(args),
};

function surface(args: Value[], what: string, wire: boolean): Linalg {
  const d = surfaceData(args, what, 45);
  const box = boxOf(d.xs, d.ys, d.z.flat());
  // beyond the clipped range a cell is left out (a pole is not drawn as a wall)
  const z = d.z.map(r => r.map(v => (Number.isFinite(v) && v >= box[4] - 1e-12 && v <= box[5] + 1e-12 ? v : NaN)));
  const s: Surface3 = { xs: d.xs, ys: d.ys, z, label: d.label, wire };
  const holes = z.flat().filter(v => !Number.isFinite(v)).length;
  return {
    cards: [card(wire ? 'Siatka powierzchni' : 'Powierzchnia', [], `${d.label ? `z = ${d.label}; ` : ''}x ∈ ⟨${fmt(box[0])}; ${fmt(box[1])}⟩, y ∈ ⟨${fmt(box[2])}; ${fmt(box[3])}⟩, z ∈ ⟨${fmt(box[4])}; ${fmt(box[5])}⟩.${holes ? ' Miejsca, gdzie funkcja ucieka poza ten zakres albo nie istnieje, są puste.' : ''} Przeciągnij, aby obrócić; kółko przybliża.`, scene({ surfaces: [s], curves: [], box }))],
    outputs: [],
  };
}


// --- Symbolic multivariable & vector calculus ---

const exVal = (e: Expr): Value => ({ t: 'expr', e });
const listVal = (es: Expr[]): Value => ({ t: 'list', set: false, items: es.map(exVal) });
const matVal = (rows: Expr[][]): Value => ({ t: 'matrix', rows });

function exprsOf(v: Value, what: string): Expr[] {
  if (v.t === 'expr') return [v.e];
  if (v.t === 'list') return v.items.map(i => { if (i.t !== 'expr') return fail(`${what}: oczekuję wyrażeń.`); return i.e; });
  if (v.t === 'matrix') {
    if (v.rows.length === 1 || v.rows[0]?.length === 1) return v.rows.flat();
    fail(`${what}: oczekuję wektora albo wyrażenia skalarnego.`);
  }
  if (v.t === 'fn') {
    const f = funOf(v, v.params.length, what);
    return f.outs;
  }
  return fail(`${what}: oczekuję wyrażenia albo wektora wyrażeń.`);
}

const isVarSym = (e: Expr): e is { k: 's'; n: string } => e.k === 's' && !['pi', 'e', 'i', 'inf', 'gammaconst'].includes(e.n);
const VAR_ORDER = ['x', 'y', 'z', 't', 'u', 'v', 'w', 'r', 's'];

function inferVars(es: Expr[], dimHint?: number, fnParams?: string[]): string[] {
  if (fnParams && fnParams.length) return fnParams.slice();
  const used = [...new Set(es.flatMap(e => variables(e)))];
  if (dimHint === 2 && used.every(v => v === 'x' || v === 'y')) return ['x', 'y'];
  if (dimHint === 3 && used.every(v => v === 'x' || v === 'y' || v === 'z')) return ['x', 'y', 'z'];
  used.sort((a, b) => {
    const ia = VAR_ORDER.indexOf(a), ib = VAR_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
  if (dimHint && used.length < dimHint) {
    for (const c of ['x', 'y', 'z', 'w', 'u', 'v']) {
      if (used.length >= dimHint) break;
      if (!used.includes(c)) used.push(c);
    }
  }
  return used.length ? used : dimHint === 3 ? ['x', 'y', 'z'] : dimHint === 2 ? ['x', 'y'] : ['x'];
}

function parseVarsAndPoint(es: Expr[], arg1?: Value, arg2?: Value, dimHint?: number, fnParams?: string[]): { vars: string[]; pt: Expr[] | null } {
  let vars: string[] | null = null;
  let pt: Expr[] | null = null;
  if (arg1) {
    const a1 = exprsOf(arg1, 'Argument');
    if (a1.length && a1.every(isVarSym)) vars = a1.map(e => e.n);
    else pt = a1;
  }
  if (arg2) {
    const a2 = exprsOf(arg2, 'Punkt');
    pt = a2;
  }
  const resolved = vars ?? inferVars(es, pt?.length ?? dimHint, fnParams);
  if (pt && pt.length !== resolved.length) fail(`Punkt ma mieć tyle współrzędnych, ile jest zmiennych (${resolved.length}).`);
  return { vars: resolved, pt };
}

function substPoint(e: Expr, vars: string[], pt: Expr[]): Expr {
  let out = e;
  for (let i = 0; i < vars.length; i++) out = subst(out, vars[i], pt[i]);
  return simplify(out);
}

function gradientPlot2D(f: Expr, gx: Expr, gy: Expr, vars: [string, string], center?: [number, number]): Plot | null {
  try {
    const cx = center && Number.isFinite(center[0]) ? center[0] : 0;
    const cy = center && Number.isFinite(center[1]) ? center[1] : 0;
    const r = [cx - 4, cx + 4, cy - 4, cy + 4];
    const ff: Fun = { vars, outs: [f] }, fg: Fun = { vars, outs: [gx, gy] };
    const s = sample(ff, r, 70);
    const [lo, hi] = robust(s.z.flat());
    const levels = Array.from({ length: 8 }, (_, i) => lo + (hi - lo) * (i + 1) / 9);
    const series: DataSeries[] = levels.map((c, i) => {
      const lines = levelLines(s.xs, s.ys, s.z, c);
      const xs: number[] = [], ys: number[] = [];
      for (const l of lines) { for (let k = 0; k < l.length; k += 2) { xs.push(l[k]); ys.push(l[k + 1]); } xs.push(NaN); ys.push(NaN); }
      return { xs, ys, label: '', color: i % 8 };
    }).filter(sr => sr.xs.length);
    const g = numericFun(fg), n = 13;
    const pts = span(r[0], r[1], n).flatMap(x => span(r[2], r[3], n).map(y => { const [u, v] = g([x, y]); return { x, y, u, v }; }));
    const cell = 8 / (n - 1);
    const longest = Math.max(...pts.map(p => Math.hypot(p.u, p.v)).filter(Number.isFinite), 1e-300), sc = 0.85 * cell / longest;
    const arrows: Vector[] = pts.filter(p => [p.u, p.v].every(Number.isFinite) && (p.u || p.v)).map(p => ({ x1: p.x, y1: p.y, x2: p.x + sc * p.u, y2: p.y + sc * p.v, label: '', color: 0 }));
    const plot = dataPlot(series, { arrows, equal: true });
    if (plot) { plot.x = [r[0], r[1]]; plot.y = [r[2], r[3]]; }
    return plot;
  } catch {
    return null;
  }
}

function gradientCmd(args: Value[]): Linalg {
  // MATLAB numeric vector gradient: gradient([y1, y2, ...]) or gradient(y, h)
  if ((args[0].t === 'list' || args[0].t === 'matrix') && isNumeric(args[0])) {
    const es = grid(args[0], 'gradient').flat();
    if (es.length >= 2) {
      const h = args[1] ? exprsOf(args[1], 'Krok h')[0] : ONE;
      if (zeroTest(h)) fail('gradient: krok h nie może być zerem.');
      const n = es.length;
      const out = es.map((_, i) => {
        if (i === 0) return simplify(div(sub(es[1], es[0]), h));
        if (i === n - 1) return simplify(div(sub(es[n - 1], es[n - 2]), h));
        return simplify(div(sub(es[i + 1], es[i - 1]), mul(num(2), h)));
      });
      const v = isApprox(args[0]) ? approxValue(listVal(out)) : listVal(out);
      return { cards: [card('Gradient numeryczny', [['∇y', v]], 'Różnice centralne wewnątrz wektora, jednostronne na brzegach.')], outputs: [v] };
    }
  }
  const es = exprsOf(args[0], 'gradient');
  if (es.length !== 1) fail('gradient: podaj funkcję skalarną, np. gradient(x^2 + y^2).');
  const f = es[0];
  const fnParams = args[0].t === 'fn' ? args[0].params : undefined;
  const { vars, pt } = parseVarsAndPoint([f], args[1], args[2], undefined, fnParams);
  const grad = vars.map(v => simplify(diff(f, v)));
  const rows: [string, Value][] = [['∇f', listVal(grad)]];
  vars.forEach((v, i) => rows.push([`∂f/∂${v}`, exVal(grad[i])]));
  let outVal = grad.length === 1 ? exVal(grad[0]) : listVal(grad);
  if (pt) {
    const at = grad.map(g => substPoint(g, vars, pt));
    const normAt = simplify(sqrt(add(...at.map(g => pow(g, num(2))))));
    const pText = pt.map(toText).join('; ');
    rows.push([`∇f(${pText})`, listVal(at)], [`‖∇f(${pText})‖`, exVal(normAt)]);
    outVal = at.length === 1 ? exVal(at[0]) : listVal(at);
  }
  const center: [number, number] | undefined = pt && pt.length === 2 && pt.every(isConstant) ? [approx(pt[0]).re, approx(pt[1]).re] : undefined;
  const plot = vars.length === 2 ? gradientPlot2D(f, grad[0], grad[1], [vars[0], vars[1]], center) : null;
  const note = vars.length === 2 && plot ? `Poziomice funkcji f(${vars.join(', ')}) i prostopadłe do nich wektory gradientu ∇f.` : `Zmienne: (${vars.join(', ')}).`;
  return { cards: [card('Gradient', rows, note, plot)], outputs: [outVal] };
}

function tryPotential(F: Expr[], vars: string[]): Expr | null {
  try {
    for (let i = 0; i < F.length; i++) {
      for (let j = i + 1; j < F.length; j++) {
        if (!zeroTest(sub(diff(F[i], vars[j]), diff(F[j], vars[i])))) return null;
      }
    }
    let U: Expr = ZERO;
    for (let i = 0; i < F.length; i++) {
      const rem = simplify(sub(F[i], diff(U, vars[i])));
      const intRem = integrate(rem, vars[i]);
      if (!intRem) return null;
      U = simplify(add(U, intRem));
    }
    for (let i = 0; i < F.length; i++) {
      if (!zeroTest(sub(diff(U, vars[i]), F[i]))) return null;
    }
    return U;
  } catch {
    return null;
  }
}

function divergenceCmd(args: Value[]): Linalg {
  const F = exprsOf(args[0], 'divergence');
  if (F.length < 2) fail('divergence: podaj pole wektorowe, np. divergence([x^2, y^2, z^2]).');
  const fnParams = args[0].t === 'fn' ? args[0].params : undefined;
  const { vars } = parseVarsAndPoint(F, args[1], undefined, F.length, fnParams);
  if (vars.length !== F.length) fail(`divergence: liczba składowych pola (${F.length}) musi być równa liczbie zmiennych (${vars.length}).`);
  const parts = F.map((fi, i) => simplify(diff(fi, vars[i])));
  const divF = simplify(add(...parts));
  const rows: [string, Value][] = [['div F = ∇ · F', exVal(divF)]];
  parts.forEach((p, i) => rows.push([`∂F_${i + 1}/∂${vars[i]}`, exVal(p)]));
  const solenoidal = zeroTest(divF);
  const note = solenoidal ? 'Pole jest bezźródłowe (solenoidalne): div F = 0.' : `Zmienne: (${vars.join(', ')}).`;
  return { cards: [card('Dywergencja pola', rows, note)], outputs: [exVal(divF)] };
}

function curlCmd(args: Value[]): Linalg {
  const F = exprsOf(args[0], 'curl');
  if (F.length !== 2 && F.length !== 3) fail('curl: podaj pole wektorowe 2D [P, Q] albo 3D [P, Q, R].');
  const fnParams = args[0].t === 'fn' ? args[0].params : undefined;
  const { vars } = parseVarsAndPoint(F, args[1], undefined, F.length, fnParams);
  if (vars.length !== F.length) fail(`curl: liczba składowych pola (${F.length}) musi być równa liczbie zmiennych (${vars.length}).`);
  if (F.length === 2) {
    const [P, Q] = F, [x, y] = vars;
    const dQx = simplify(diff(Q, x)), dPy = simplify(diff(P, y));
    const rot2 = simplify(sub(dQx, dPy));
    const irrot = zeroTest(rot2);
    const rows: [string, Value][] = [['(rot F)_z = ∂Q/∂x − ∂P/∂y', exVal(rot2)], [`∂Q/∂${x}`, exVal(dQx)], [`∂P/∂${y}`, exVal(dPy)]];
    if (irrot) {
      const U = tryPotential(F, vars);
      if (U) rows.push(['Potencjał skalarny U (∇U = F)', exVal(U)]);
    }
    const note = irrot ? 'Pole płaskie jest bezwirowe (potencjalne): ∂Q/∂x = ∂P/∂y.' : undefined;
    return { cards: [card('Rotacja pola (2D)', rows, note)], outputs: [exVal(rot2)] };
  }
  const [P, Q, R] = F, [x, y, z] = vars;
  const cx = simplify(sub(diff(R, y), diff(Q, z)));
  const cy = simplify(sub(diff(P, z), diff(R, x)));
  const cz = simplify(sub(diff(Q, x), diff(P, y)));
  const rot = [cx, cy, cz];
  const irrot = rot.every(zeroTest);
  const rows: [string, Value][] = [
    ['rot F = ∇ × F', listVal(rot)],
    [`(rot F)_${x}`, exVal(cx)],
    [`(rot F)_${y}`, exVal(cy)],
    [`(rot F)_${z}`, exVal(cz)],
  ];
  if (irrot) {
    const U = tryPotential(F, vars);
    if (U) rows.push(['Potencjał skalarny U (∇U = F)', exVal(U)]);
  }
  const note = irrot ? 'Pole jest bezwirowe (potencjalne): rot F = [0, 0, 0].' : undefined;
  return { cards: [card('Rotacja pola (3D)', rows, note)], outputs: [listVal(rot)] };
}

function potentialCmd(args: Value[]): Linalg {
  const F = exprsOf(args[0], 'potential');
  if (F.length < 2 || F.length > 4) fail('potential: podaj pole wektorowe [P, Q] albo [P, Q, R].');
  const fnParams = args[0].t === 'fn' ? args[0].params : undefined;
  const { vars } = parseVarsAndPoint(F, args[1], undefined, F.length, fnParams);
  if (vars.length !== F.length) fail(`potential: liczba składowych pola (${F.length}) musi być równa liczbie zmiennych (${vars.length}).`);
  for (let i = 0; i < F.length; i++) {
    for (let j = i + 1; j < F.length; j++) {
      const dij = simplify(diff(F[i], vars[j])), dji = simplify(diff(F[j], vars[i]));
      if (!zeroTest(sub(dij, dji))) {
        fail(`Pole nie jest potencjalne (zachowawcze): ∂F_${i + 1}/∂${vars[j]} = ${toText(dij)} ≠ ∂F_${j + 1}/∂${vars[i]} = ${toText(dji)}.`);
      }
    }
  }
  const U = tryPotential(F, vars);
  if (!U) return fail('Nie udało się wyznaczyć potencjału pola w postaci elementarnej.');
  const rows: [string, Value][] = [
    ['Potencjał matematyczny U (∇U = F)', exVal(U)],
    ['Potencjał fizyczny V = −U (F = −∇V)', exVal(simplify(neg(U)))],
  ];
  return {
    cards: [card('Potencjał pola wektorowego', rows, `Zweryfikowano symbolicznie: ∇U = [${F.map(toText).join('; ')}]. Pełna rodzina potencjałów: U + C.`)],
    outputs: [exVal(U)],
  };
}

function laplacianCmd(args: Value[]): Linalg {
  const es = exprsOf(args[0], 'laplacian');
  if (es.length !== 1) fail('laplacian: podaj funkcję skalarną, np. laplacian(x^3 - 3*x*y^2).');
  const f = es[0];
  const fnParams = args[0].t === 'fn' ? args[0].params : undefined;
  const { vars } = parseVarsAndPoint([f], args[1], undefined, undefined, fnParams);
  const d2 = vars.map(v => simplify(diff(diff(f, v), v)));
  const lap = simplify(add(...d2));
  const rows: [string, Value][] = [['Δf = ∇²f', exVal(lap)]];
  vars.forEach((v, i) => rows.push([`∂²f/∂${v}²`, exVal(d2[i])]));
  const harmonic = zeroTest(lap);
  const note = harmonic ? 'Funkcja jest harmoniczna (spełnia równanie Laplace’a Δf = 0).' : `Zmienne: (${vars.join(', ')}).`;
  return { cards: [card('Laplasjan', rows, note)], outputs: [exVal(lap)] };
}

function jacobianCmd(args: Value[]): Linalg {
  const F = exprsOf(args[0], 'jacobian');
  const fnParams = args[0].t === 'fn' ? args[0].params : undefined;
  const { vars } = parseVarsAndPoint(F, args[1], undefined, F.length > 1 ? F.length : undefined, fnParams);
  const J = F.map(fi => vars.map(v => simplify(diff(fi, v))));
  const Jv = matVal(J);
  const rows: [string, Value][] = [['Macierz Jacobiego J', Jv]];
  if (F.length === vars.length) {
    const detJ = simplify(det(J));
    rows.push(['Wyznacznik (jakobian) det J', exVal(detJ)]);
  }
  return {
    cards: [card('Jakobian', rows, `Rozmiar ${F.length}×${vars.length} względem zmiennych (${vars.join(', ')}).`)],
    outputs: [Jv],
  };
}

function classifyHessian(H: Expr[][]): string | null {
  if (!H.flat().every(isConstant)) return null;
  const n = H.length;
  const minors: number[] = [];
  for (let k = 1; k <= n; k++) {
    const subM = H.slice(0, k).map(r => r.slice(0, k));
    const d = approx(det(subM)).re;
    if (!Number.isFinite(d)) return null;
    minors.push(d);
  }
  if (minors.every(m => m > 1e-12)) return 'Macierz dodatnio określona (kryterium Sylvestera: wszystkie minory główne Δ_k > 0 → minimum lokalne w punkcie stacjonarnym).';
  if (minors.every((m, i) => (i % 2 === 0 ? m < -1e-12 : m > 1e-12))) return 'Macierz ujemnie określona (kryterium Sylvestera: (−1)^k Δ_k > 0 → maksimum lokalne w punkcie stacjonarnym).';
  if (n === 2 && minors[1] < -1e-12) return 'Macierz nieokreślona (det H < 0 → punkt siodłowy w punkcie stacjonarnym).';
  if (minors.some(m => Math.abs(m) <= 1e-12)) return 'Macierz półokreślona / przypadek zdegenerowany (det H = 0).';
  return 'Macierz nieokreślona (punkt siodłowy w punkcie stacjonarnym).';
}

function hessianCmd(args: Value[]): Linalg {
  const es = exprsOf(args[0], 'hessian');
  if (es.length !== 1) fail('hessian: podaj funkcję skalarną, np. hessian(x^3 + y^3 - 3*x*y).');
  const f = es[0];
  const fnParams = args[0].t === 'fn' ? args[0].params : undefined;
  const { vars, pt } = parseVarsAndPoint([f], args[1], args[2], undefined, fnParams);
  const grad = vars.map(v => simplify(diff(f, v)));
  const H = vars.map((_, i) => vars.map((vj) => simplify(diff(grad[i], vj))));
  const detH = simplify(det(H)), trH = simplify(trace(H));
  const rows: [string, Value][] = [
    ['Macierz Hessego H', matVal(H)],
    ['Wyznacznik det H', exVal(detH)],
    ['Ślad tr H = Δf', exVal(trH)],
  ];
  let outMat = H;
  let note = `Zmienne: (${vars.join(', ')}).`;
  if (pt) {
    const Hat = H.map(r => r.map(e => substPoint(e, vars, pt)));
    const detAt = substPoint(detH, vars, pt);
    const pText = pt.map(toText).join('; ');
    rows.push([`H(${pText})`, matVal(Hat)], [`det H(${pText})`, exVal(detAt)]);
    outMat = Hat;
    note = classifyHessian(Hat) ?? note;
  } else {
    note = classifyHessian(H) ?? note;
  }
  return { cards: [card('Hesjan', rows, note)], outputs: [matVal(outMat)] };
}

function directionalCmd(args: Value[]): Linalg {
  const es = exprsOf(args[0], 'directional');
  if (es.length !== 1) fail('directional: pierwszym argumentem musi być funkcja skalarna.');
  const f = es[0];
  const v = exprsOf(args[1], 'Wektor kierunkowy');
  if (v.length < 1) fail('directional: podaj wektor kierunkowy, np. [1, 2].');
  const fnParams = args[0].t === 'fn' ? args[0].params : undefined;
  const { vars, pt } = parseVarsAndPoint([f], args[2], args[3], v.length, fnParams);
  if (vars.length !== v.length) fail(`directional: wymiar wektora (${v.length}) musi być równy liczbie zmiennych (${vars.length}).`);
  const vNorm = simplify(sqrt(add(...v.map(vi => pow(vi, num(2))))));
  if (zeroTest(vNorm)) fail('directional: wektor kierunkowy nie może być zerowy.');
  const u = v.map(vi => simplify(div(vi, vNorm)));
  const grad = vars.map(xi => simplify(diff(f, xi)));
  const dirDeriv = simplify(add(...grad.map((gi, i) => mul(gi, u[i]))));
  const rows: [string, Value][] = [
    ['Gradient ∇f', listVal(grad)],
    ['Wersor kierunku u = v/‖v‖', listVal(u)],
    ['Pochodna kierunkowa ∂f/∂u = ∇f · u', exVal(dirDeriv)],
  ];
  let out = dirDeriv;
  if (pt) {
    const at = substPoint(dirDeriv, vars, pt);
    const pText = pt.map(toText).join('; ');
    rows.push([`(∂f/∂u)(${pText})`, exVal(at)]);
    out = at;
  }
  return { cards: [card('Pochodna kierunkowa', rows, `Kierunek v = [${v.map(toText).join('; ')}], ‖v‖ = ${toText(vNorm)}.`)], outputs: [exVal(out)] };
}

function tangentPlaneCmd(args: Value[]): Linalg {
  const es = exprsOf(args[0], 'tangentplane');
  if (es.length !== 1) fail('tangentplane: podaj funkcję z = f(x, y), np. tangentplane(x^2 + y^2, [1, 2]).');
  const f = es[0];
  const fnParams = args[0].t === 'fn' ? args[0].params : undefined;
  const { vars, pt } = parseVarsAndPoint([f], args[1], args[2], 2, fnParams);
  if (!pt || pt.length !== 2 || vars.length !== 2) return fail('tangentplane: podaj funkcję dwóch zmiennych i punkt [x₀, y₀], np. tangentplane(x^2 + y^2, [1, 2]).');
  const [x, y] = vars, [x0, y0] = pt;
  const z0 = substPoint(f, vars, pt);
  const fx = substPoint(diff(f, x), vars, pt);
  const fy = substPoint(diff(f, y), vars, pt);
  const plane = simplify(add(z0, mul(fx, sub(sym(x), x0)), mul(fy, sub(sym(y), y0))));
  const normal = [simplify(neg(fx)), simplify(neg(fy)), ONE];
  const pText = `${toText(x0)}; ${toText(y0)}; ${toText(z0)}`;
  const rows: [string, Value][] = [
    ['Płaszczyzna styczna z', exVal(plane)],
    ['Punkt styczności P₀', listVal([x0, y0, z0])],
    [`pochodna ∂f/∂${x}(P₀)`, exVal(fx)],
    [`pochodna ∂f/∂${y}(P₀)`, exVal(fy)],
    ['Wektor normalny N', listVal(normal)],
  ];
  let plot: Plot | null = null;
  if (pt.every(isConstant)) {
    try {
      const cx = approx(x0).re, cy = approx(y0).re;
      const r = [cx - 3, cx + 3, cy - 3, cy + 3];
      const s1 = sample({ vars, outs: [f] }, r, 35);
      const s2 = sample({ vars, outs: [plane] }, r, 25);
      const box = boxOf(s1.xs, s1.ys, s1.z.flat());
      const clip = (z: number[][]) => z.map(row => row.map(v => (Number.isFinite(v) && v >= box[4] - 1e-9 && v <= box[5] + 1e-9 ? v : NaN)));
      const surf1: Surface3 = { xs: s1.xs, ys: s1.ys, z: clip(s1.z), label: toText(f), wire: false };
      const surf2: Surface3 = { xs: s2.xs, ys: s2.ys, z: clip(s2.z), label: 'styczna', wire: true };
      plot = scene({ surfaces: [surf1, surf2], curves: [], box });
    } catch { plot = null; }
  }
  return {
    cards: [card('Płaszczyzna styczna', rows, `Równanie: z = ${toText(plane)} w punkcie (${pText}).`, plot)],
    outputs: [exVal(plane)],
  };
}
