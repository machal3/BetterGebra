/**
 * Functions of two variables and fields, as MATLAB draws them: meshgrid, contour (level curves by marching squares),
 * quiver (arrows of a vector field), surf and mesh (surfaces) and plot3 (curves in space). A function comes as an
 * expression in two letters, @(x, y) …, or as matrices from meshgrid; surfaces and curves go to the 3D card.
 */
import { Expr, isConstant } from './expr';
import { Value, approxValue, isApprox } from './evaluate';
import { grid, valueOf } from './arrays';
import { Card, Linalg } from './linalg';
import { approx } from './numeric';
import { Fun, funOf, numericFun } from './numerics';
import { type Curve3, type DataSeries, type Plot, type Scene3, type Surface3, type Vector, blank, dataPlot, fmt } from './plot';
import { fail } from './q';
import { toText } from './format';

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
