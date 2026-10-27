/**
 * MATLAB's polynomials on coefficient vectors (roots, poly, polyval, polyder, polyint, conv, deconv, residue), fitting
 * (polyfit, fit), interpolation (interp1, spline, pchip), trapz and the plots of data (plot(x, y), scatter, stem, bar,
 * histogram, errorbar, polarplot). Coefficients are written from the highest power down, as in MATLAB.
 * Exact for rational data: least squares through the normal equations over ℚ, spline and pchip slopes solved over ℚ;
 * in floating point otherwise (QR, Levenberg–Marquardt), checked.
 */
import { Expr, I, ONE, ZERO, add, div, expand, fn, isConstant, isNum, mul, neg, num, pow, sub, subst, sym, variables } from './expr';
import { Value, approxValue, ex, isApprox } from './evaluate';
import { grid, valueOf } from './arrays';
import { diff } from './calculus';
import * as D from './dense';
import { compileDouble } from './fast';
import { constSign } from './functions';
import { Card, Linalg, tiny } from './linalg';
import * as LA from './matrix';
import { approx } from './numeric';
import { toText } from './format';
import { type DataSeries, dataPlot, fmt, graphText, histogramPlot, parametricSeries } from './plot';
import { solvePoly } from './poly';
import { Q, fail } from './q';
import { simplify } from './simplify';

type Command = (args: Value[], nout: number) => Linalg | null;
const tidy = (e: Expr) => { try { return simplify(e); } catch { return e; } };
const X = sym('x');

/** A vector's entries (a list, a row or a column); what: the name for errors. */
function vector(v: Value | undefined, what: string): Expr[] {
  if (!v) return fail(`${what}: brak argumentu.`);
  const m = grid(v, what);
  if (m.length > 1 && m[0].length > 1) fail(`${what}: oczekuję wektora, a nie macierzy ${m.length}×${m[0].length}.`);
  return m.flat();
}
const isVector = (v: Value) => (v.t === 'list' && !v.set && v.items.every(i => i.t === 'expr')) || (v.t === 'matrix' && (v.rows.length === 1 || v.rows[0]?.length === 1));
const toNum = (e: Expr) => { if (isNum(e)) return Number(e.v.n) / Number(e.v.d); const z = approx(e); return Math.abs(z.im) > 1e-12 * (1 + Math.abs(z.re)) ? NaN : z.re; };
const realNums = (es: Expr[], what: string) => es.map(e => { if (!isConstant(e)) fail(`${what}: oczekuję liczb.`); return toNum(e); });
const row = (es: Expr[], ap: boolean): Value => { const v = valueOf([es.map(tidy)]); return ap ? approxValue(v) : v; };
const col = (es: Expr[], ap: boolean): Value => { const v: Value = es.length === 1 ? ex(tidy(es[0])) : { t: 'matrix', rows: es.map(e => [tidy(e)]) }; return ap ? approxValue(v) : v; };
const sign = (e: Expr) => { const s = constSign(e); if (s === null) fail('Porównuję tylko liczby rzeczywiste.'); return s!; };
const allRational = (...vs: Expr[][]) => vs.every(v => v.every(isNum));

// --- Polynomials as coefficient vectors, highest power first ---

const strip = (p: Expr[]) => { let k = 0; while (k < p.length - 1 && constSign(p[k]) === 0) k++; return p.slice(k); };
const asExpr = (p: Expr[], x: Expr = X) => add(...p.map((c, k) => mul(c, pow(x, num(p.length - 1 - k)))));
function conv(a: Expr[], b: Expr[]): Expr[] {
  const out = Array<Expr>(a.length + b.length - 1).fill(ZERO);
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] = add(out[i + j], mul(x, y)); }));
  return out;
}
/** b = conv(a, q) + r, r as long as b (MATLAB's deconv). */
function deconv(b: Expr[], a0: Expr[]): [Expr[], Expr[]] {
  const a = strip(a0);
  if (sign(a[0]) === 0) fail('deconv: dzielnik jest zerowy.');
  if (b.length < a.length) return [[ZERO], b.slice()];
  const r = b.slice(), q: Expr[] = [];
  for (let k = 0; k <= b.length - a.length; k++) {
    const c = tidy(div(r[k], a[0]));
    q.push(c);
    a.forEach((x, j) => { r[k + j] = tidy(sub(r[k + j], mul(c, x))); });
  }
  return [q, r];
}
const horner = (p: Expr[], x: Expr) => p.reduce<Expr>((acc, c) => add(mul(acc, x), c), ZERO);
/** The value of each element of v under f, in v's shape. */
function each(v: Value, f: (e: Expr) => Expr): Value {
  if (v.t === 'expr') return ex(f(v.e));
  if (v.t === 'list') return { t: 'list', set: false, items: v.items.map(i => each(i, f)) };
  if (v.t === 'matrix') return { t: 'matrix', rows: v.rows.map(r => r.map(f)) };
  return fail('Oczekuję liczby, wektora albo macierzy.');
}

/** The roots of a polynomial given by its coefficients: exact when they read well, else from the companion matrix. */
function polyRoots(p0: Expr[], ap: boolean): { roots: Expr[]; exact: boolean; note?: string } {
  let p = strip(p0);
  // zeros at the end are roots 0
  let zeros = 0;
  while (p.length > 1 && constSign(p[p.length - 1]) === 0) { p = p.slice(0, -1); zeros++; }
  const z = Array<Expr>(zeros).fill(ZERO);
  if (p.length <= 1) return { roots: z, exact: true };
  if (!ap && allRational(p)) {
    const P: Q[] = [...p].reverse().map(e => (e as { v: Q }).v);
    const rs = solvePoly(P);
    if (rs.every(r => r.exact && readable(r.exact))) {
      const out = [...z, ...rs.flatMap(r => Array<Expr>(r.mult).fill(r.exact!))];
      return { roots: sortRoots(out), exact: true };
    }
  }
  // the eigenvalues of the companion matrix, as MATLAB's roots
  const c = realNums(p, 'roots'), n = c.length - 1;
  const C = D.zeros(n, n);
  for (let j = 0; j < n; j++) C[0][j] = -c[j + 1] / c[0];
  for (let i = 1; i < n; i++) C[i][i - 1] = 1;
  const lams = D.eigenvalues(C);
  const out = lams.map(([re, im]) => (Math.abs(im) > 1e-14 * Math.max(1, Math.abs(re)) ? add(num(toQ(re)), mul(I, num(toQ(im)))) : num(toQ(re))));
  // each root checked: |p(r)| small next to the sizes of the terms
  const bad = lams.some(([re, im]) => {
    let pr = 0, pi = 0, scale = 0;
    for (const a of c) { [pr, pi] = [pr * re - pi * im + a, pr * im + pi * re]; scale = scale * Math.hypot(re, im) + Math.abs(a); }
    return Math.hypot(pr, pi) > 1e-8 * (scale || 1);
  });
  if (bad) fail('roots: pierwiastki numeryczne nie przeszły sprawdzenia.');
  return { roots: sortRoots([...z, ...out]), exact: false, note: 'Numerycznie: wartości własne macierzy towarzyszącej (jak w MATLAB-ie); każdy pierwiastek sprawdzony.' };
}
const readable = (e: Expr): boolean => e.k !== 'f' && (e.k === 'n' || e.k === 's' || (e.k === '^' ? readable(e.b) && readable(e.e) : e.k === '+' || e.k === '*' ? e.t.every(readable) : false));
const toQ = (x: number): Q => { let m = x, e = 0; while (!Number.isInteger(m)) { m *= 2; e++; } return { n: BigInt(m), d: 1n << BigInt(e) } as Q; };
function sortRoots(rs: Expr[]): Expr[] {
  const key = (e: Expr) => { const z = approx(e); return [z.re, z.im]; };
  return rs.sort((a, b) => { const [p, q] = key(a), [r, s] = key(b); return r - p || s - q; });
}

// --- Interpolation: piecewise linear, nearest, cubic Hermite (spline, pchip) ---

interface Pieces { xs: Expr[]; ys: Expr[]; slopes: Expr[] | null; kind: 'linear' | 'nearest' | 'previous' | 'next' | 'cubic' }
/** Data sorted by x, with distinct x. */
function sortedData(x: Expr[], y: Expr[], what: string): [Expr[], Expr[]] {
  if (x.length !== y.length) fail(`${what}: x i y mają różne długości (${x.length} i ${y.length}).`);
  if (x.length < 2) fail(`${what}: potrzeba co najmniej dwóch punktów.`);
  const pairs = x.map((xi, i) => [xi, y[i]] as const).sort((a, b) => sign(sub(a[0], b[0])));
  for (let i = 1; i < pairs.length; i++) if (sign(sub(pairs[i][0], pairs[i - 1][0])) === 0) fail(`${what}: wartości x muszą być różne.`);
  return [pairs.map(p => p[0]), pairs.map(p => p[1])];
}
/** Solves a tridiagonal system exactly (Thomas): sub, diag, sup, rhs. */
function tridiagonal(a: Expr[], b: Expr[], c: Expr[], d: Expr[]): Expr[] {
  const n = b.length, cp = Array<Expr>(n).fill(ZERO), dp = Array<Expr>(n).fill(ZERO);
  for (let i = 0; i < n; i++) {
    const m = i ? tidy(sub(b[i], mul(a[i], cp[i - 1]))) : b[i];
    if (constSign(m) === 0) fail('Interpolacja: układ dla nachyleń jest osobliwy.');
    cp[i] = i < n - 1 ? tidy(div(c[i], m)) : ZERO;
    dp[i] = tidy(div(i ? sub(d[i], mul(a[i], dp[i - 1])) : d[i], m));
  }
  const s = Array<Expr>(n).fill(ZERO);
  for (let i = n - 1; i >= 0; i--) s[i] = i === n - 1 ? dp[i] : tidy(sub(dp[i], mul(cp[i], s[i + 1])));
  return s;
}
/**
 * Slopes of the cubic spline: not-a-knot (MATLAB's default), clamped (end slopes given) or natural (second derivative
 * 0 at the ends; not in MATLAB's spline, the one of the textbooks). The rows are MATLAB's (spline.m, de Boor).
 */
function splineSlopes(x: Expr[], y: Expr[], ends: 'notaknot' | 'natural' | [Expr, Expr]): Expr[] {
  const n = x.length, h = x.slice(1).map((v, i) => tidy(sub(v, x[i]))), del = h.map((hi, i) => tidy(div(sub(y[i + 1], y[i]), hi)));
  if (n === 2 && ends !== 'natural' && !Array.isArray(ends)) return [del[0], del[0]];
  if (n === 3 && ends === 'notaknot') {
    // the parabola through the three points
    const c2 = tidy(div(sub(del[1], del[0]), add(h[0], h[1])));
    return [tidy(sub(del[0], mul(c2, h[0]))), tidy(add(del[0], mul(c2, h[0]))), tidy(add(del[1], mul(c2, h[1])))];
  }
  const a = Array<Expr>(n).fill(ZERO), b = Array<Expr>(n).fill(ZERO), c = Array<Expr>(n).fill(ZERO), d = Array<Expr>(n).fill(ZERO);
  for (let i = 1; i < n - 1; i++) {
    a[i] = h[i]; b[i] = mul(num(2), add(h[i - 1], h[i])); c[i] = h[i - 1];
    d[i] = mul(num(3), add(mul(h[i], del[i - 1]), mul(h[i - 1], del[i])));
  }
  if (Array.isArray(ends)) { b[0] = ONE; d[0] = ends[0]; b[n - 1] = ONE; d[n - 1] = ends[1]; }
  else if (ends === 'natural') {
    b[0] = num(2); c[0] = ONE; d[0] = mul(num(3), del[0]);
    a[n - 1] = ONE; b[n - 1] = num(2); d[n - 1] = mul(num(3), del[n - 2]);
  } else {
    const x31 = add(h[0], h[1]), xn = add(h[n - 3], h[n - 2]);
    b[0] = h[1]; c[0] = x31;
    d[0] = div(add(mul(add(h[0], mul(num(2), x31)), h[1], del[0]), mul(pow(h[0], num(2)), del[1])), x31);
    a[n - 1] = xn; b[n - 1] = h[n - 3];
    d[n - 1] = div(add(mul(pow(h[n - 2], num(2)), del[n - 3]), mul(add(mul(num(2), xn), h[n - 2]), h[n - 3], del[n - 2])), xn);
  }
  return tridiagonal(a, b, c, d);
}
/** pchip's slopes (Fritsch–Carlson, as MATLAB's pchip): the interpolant keeps the data's monotonicity. */
function pchipSlopes(x: Expr[], y: Expr[]): Expr[] {
  const n = x.length, h = x.slice(1).map((v, i) => tidy(sub(v, x[i]))), del = h.map((hi, i) => tidy(div(sub(y[i + 1], y[i]), hi)));
  if (n === 2) return [del[0], del[0]];
  const s = Array<Expr>(n).fill(ZERO);
  for (let k = 1; k < n - 1; k++) {
    if (sign(del[k - 1]) * sign(del[k]) <= 0) continue;
    const w1 = add(mul(num(2), h[k]), h[k - 1]), w2 = add(h[k], mul(num(2), h[k - 1]));
    s[k] = tidy(div(add(w1, w2), add(div(w1, del[k - 1]), div(w2, del[k]))));
  }
  const end = (h0: Expr, h1: Expr, d0: Expr, d1: Expr) => {
    const v = tidy(div(sub(mul(add(mul(num(2), h0), h1), d0), mul(h0, d1)), add(h0, h1)));
    if (sign(v) !== sign(d0)) return ZERO;
    if (sign(d0) !== sign(d1) && sign(sub(pow(v, num(2)), pow(mul(num(3), d0), num(2)))) > 0) return tidy(mul(num(3), d0));
    return v;
  };
  s[0] = end(h[0], h[1], del[0], del[1]);
  s[n - 1] = end(h[n - 2], h[n - 3], del[n - 2], del[n - 3]);
  return s;
}
/** The interval of t (0 … n − 2), or −1 / n − 1 beyond the ends. */
function intervalOf(xs: Expr[], t: Expr): number {
  if (sign(sub(t, xs[0])) < 0) return -1;
  if (sign(sub(t, xs[xs.length - 1])) > 0) return xs.length - 1;
  let lo = 0, hi = xs.length - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (sign(sub(t, xs[m])) >= 0) lo = m; else hi = m - 1; }
  return lo;
}
/** The interpolant at t, exactly; extrap: beyond the data, the end pieces go on (else an error). */
function interpAt(p: Pieces, t: Expr, extrap: boolean): Expr {
  const n = p.xs.length;
  let k = intervalOf(p.xs, t);
  if ((k < 0 || k === n - 1) && !extrap) fail(`Punkt ${fmt(toNum(t))} leży poza danymi ⟨${fmt(toNum(p.xs[0]))}; ${fmt(toNum(p.xs[n - 1]))}⟩. Dodaj 'extrap', aby przedłużyć interpolację.`);
  k = Math.max(0, Math.min(n - 2, k));
  const [x0, x1, y0, y1] = [p.xs[k], p.xs[k + 1], p.ys[k], p.ys[k + 1]];
  if (sign(sub(t, x1)) === 0) return y1;
  switch (p.kind) {
    case 'nearest': return sign(sub(sub(t, x0), sub(x1, t))) < 0 ? y0 : y1;
    case 'previous': return y0;
    case 'next': return sign(sub(t, x0)) === 0 ? y0 : y1;
    case 'linear': return tidy(add(y0, mul(div(sub(y1, y0), sub(x1, x0)), sub(t, x0))));
    default: return tidy(cubicPiece(p, k, t));
  }
}
/** The cubic of interval k at t: y₀ + s₀u + c₂u² + c₃u³, u = t − x₀. */
function cubicPiece(p: Pieces, k: number, t: Expr): Expr {
  const [x0, x1, y0, y1] = [p.xs[k], p.xs[k + 1], p.ys[k], p.ys[k + 1]], [s0, s1] = [p.slopes![k], p.slopes![k + 1]];
  const h = sub(x1, x0), del = div(sub(y1, y0), h), u = sub(t, x0);
  const c2 = div(sub(sub(mul(num(3), del), mul(num(2), s0)), s1), h), c3 = div(sub(add(s0, s1), mul(num(2), del)), pow(h, num(2)));
  return add(y0, mul(s0, u), mul(c2, pow(u, num(2))), mul(c3, pow(u, num(3))));
}
/** The interpolant in doubles, for the plot. */
function interpNumeric(p: Pieces): (t: number) => number {
  const xs = p.xs.map(toNum), ys = p.ys.map(toNum), ss = p.slopes?.map(toNum);
  return t => {
    let k = 0;
    while (k < xs.length - 2 && t > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k], u = t - xs[k], del = (ys[k + 1] - ys[k]) / h;
    switch (p.kind) {
      case 'nearest': return u < h / 2 ? ys[k] : ys[k + 1];
      case 'previous': return t >= xs[k + 1] ? ys[k + 1] : ys[k];
      case 'next': return u <= 0 ? ys[k] : ys[k + 1];
      case 'linear': return ys[k] + del * u;
      default: { const [s0, s1] = [ss![k], ss![k + 1]]; return ys[k] + s0 * u + (3 * del - 2 * s0 - s1) / h * u * u + (s0 + s1 - 2 * del) / (h * h) * u * u * u; }
    }
  };
}
const METHODS: Record<string, Pieces['kind'] | 'spline' | 'pchip'> = { linear: 'linear', nearest: 'nearest', previous: 'previous', next: 'next', spline: 'spline', pchip: 'pchip', cubic: 'pchip', liniowa: 'linear' };
function piecesOf(x: Expr[], y: Expr[], method: string, what: string): Pieces {
  const m = METHODS[method];
  if (!m) fail(`${what}: metoda to 'linear', 'nearest', 'previous', 'next', 'pchip' albo 'spline'.`);
  const [xs, ys] = sortedData(x, y, what);
  if (m === 'spline') return { xs, ys, slopes: splineSlopes(xs, ys, 'notaknot'), kind: 'cubic' };
  if (m === 'pchip') return { xs, ys, slopes: pchipSlopes(xs, ys), kind: 'cubic' };
  return { xs, ys, slopes: null, kind: m as Pieces['kind'] };
}
/** The cards of an interpolation: values at xq (in xq's shape), the pieces when few, a plot of data and interpolant. */
function interpolation(p: Pieces, xq: Value | null, extrap: boolean, ap: boolean, title: string, note: string): Linalg {
  const xsN = p.xs.map(toNum), ysN = p.ys.map(toNum);
  const plot = dataPlot([{ xs: xsN, ys: ysN, label: 'dane', style: 'dots' }], { curve: { f: interpNumeric(p), label: title } });
  const cards: Card[] = [];
  const out: Value[] = [];
  if (xq) {
    const v = each(xq, t => { if (!isConstant(t)) fail('Punkty interpolacji: oczekuję liczb.'); return interpAt(p, t, extrap); });
    const value = ap ? approxValue(v) : v;
    cards.push({ title, rows: [['', value]], note, plot: plot ?? undefined });
    out.push(value);
  } else {
    // the pieces themselves, for a few intervals: what a textbook asks for
    const rows: [string, Value][] = [];
    if (p.kind === 'cubic' && p.xs.length <= 9) {
      p.xs.slice(0, -1).forEach((x0, k) => {
        const piece = ex(expand(cubicPiece(p, k, X)));
        rows.push([`na ⟨${fmt(toNum(x0))}; ${fmt(toNum(p.xs[k + 1]))}⟩`, ap ? approxValue(piece) : piece]);
      });
    }
    cards.push({ title, rows, note: rows.length ? `${note} Każdy kawałek to wielomian zmiennej x.` : note, plot: plot ?? undefined });
    out.push(valueOf([p.slopes ?? p.ys]));
  }
  return { cards, outputs: out };
}

// --- Least squares ---

/** Coefficients short enough to read exactly; long fractions are shown as their (correctly rounded) decimals. */
const short = (es: Expr[]) => es.every(e => String(e.k === 'n' ? `${e.v.n}/${e.v.d}` : '').length <= 24);
/** 1 − SS_res/SS_tot, or null when y is constant. */
function rSquared(y: Expr[], fitted: Expr[]): Expr | null {
  const mean = div(add(...y), num(y.length));
  const tot = add(...y.map(v => pow(sub(v, mean), num(2))));
  if (constSign(tot) === 0) return null;
  return sub(ONE, div(add(...y.map((v, i) => pow(sub(v, fitted[i]), num(2)))), tot));
}

/** Levenberg–Marquardt from one start: the parameters, the sum of squares, whether it converged. */
function levenberg(model: Expr, names: string[], xs: number[], ys: number[], start: number[]): { p: number[]; sse: number; ok: boolean } {
  const f = (p: number[]) => compileDouble(model, 'x', Object.fromEntries(names.map((n, k) => [n, p[k]])));
  const resid = (p: number[]) => { const g = f(p); return ys.map((y, i) => y - g(xs[i])); };
  const sse = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  let p = start.slice(), r = resid(p), s = sse(r), lam = 1e-3;
  if (!Number.isFinite(s)) return { p, sse: Infinity, ok: false };
  for (let it = 0; it < 300; it++) {
    const J = xs.map(() => Array<number>(p.length).fill(0));
    p.forEach((pk, k) => {
      const h = 1e-7 * Math.max(1, Math.abs(pk)), q = p.slice(); q[k] += h;
      const rq = resid(q);
      rq.forEach((v, i) => { J[i][k] = (r[i] - v) / h; });
    });
    const JT = D.transpose(J), A = D.mul(JT, J), g = JT.map(row => row.reduce((acc, v, i) => acc + v * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 20; tries++) {
      const M = A.map((row, i) => row.map((v, j) => v + (i === j ? lam * (A[i][i] || 1) : 0)));
      const dlt = D.solve(M, g.map(v => [v]));
      if (!dlt) { lam *= 10; continue; }
      const q = p.map((v, k) => v + dlt[k][0]), rq = resid(q), sq = sse(rq);
      if (Number.isFinite(sq) && sq < s) {
        const step = Math.max(...dlt.map((d, k) => Math.abs(d[0]) / (Math.abs(q[k]) + 1e-12)));
        p = q; r = rq; lam = Math.max(lam / 3, 1e-15); improved = true;
        if (step < 1e-13 || s - sq <= 1e-15 * s) { s = sq; return { p, sse: s, ok: true }; }
        s = sq;
        break;
      }
      lam *= 4;
    }
    if (!improved) return { p, sse: s, ok: true };
  }
  return { p, sse: s, ok: false };
}

// --- The commands ---

const card = (title: string, rows: [string, Value][], note?: string, plot?: ReturnType<typeof dataPlot>): Card => ({ title, rows, note, plot: plot ?? undefined });
const only = (title: string, label: string, v: Value, note?: string): Linalg => ({ cards: [card(title, [[label, v]], note)], outputs: [v] });

export const DATAFIT: Record<string, Command> = {
  roots: ([v]) => {
    if (!v || !isVector(v)) return null;
    const p = vector(v, 'roots'), ap = isApprox(v);
    const r = polyRoots(p, ap);
    const value = col(r.roots, !r.exact);
    return { cards: [card('Pierwiastki wielomianu', [['', value]], r.note ?? `Dokładnie, z krotnościami; wielomian ${pretty(asExpr(strip(p)))}.`)], outputs: [value] };
  },
  poly: ([v]) => {
    const m = grid(v, 'poly'), ap = isApprox(v);
    if (m.length > 1 && m[0].length > 1) {
      // poly(A): the characteristic polynomial's coefficients
      if (m.length !== m[0].length) fail('poly: macierz musi być kwadratowa.');
      const cp = LA.charpoly(m, 'λ'), n = m.length;
      const c = Array.from({ length: n + 1 }, (_, k) => tidy(coefficient(cp, 'λ', n - k)));
      return only('Wielomian charakterystyczny', '', row(c, ap), `det(λI − A) = ${pretty(asExpr(c, sym('λ')))}`);
    }
    const c = m.flat().reduce<Expr[]>((acc, r) => conv(acc, [ONE, neg(r)]), [ONE]).map(tidy);
    return only('Wielomian o tych pierwiastkach', '', row(c, ap), pretty(asExpr(c)));
  },
  polyval: ([p0, x0]) => {
    const p = vector(p0, 'polyval');
    // a number: Horner; a letter: the polynomial in it, power by power
    const v = each(x0, t => (isConstant(t) ? tidy(horner(p, t)) : expand(asExpr(strip(p), t))));
    const value = isApprox(p0) || isApprox(x0) ? approxValue(v) : v;
    return only('Wartość wielomianu', '', value, `p(x) = ${pretty(asExpr(strip(p)))}`);
  },
  polyder: ([a0, b0]) => {
    const p = b0 ? conv(vector(a0, 'polyder'), vector(b0, 'polyder')) : vector(a0, 'polyder');
    const n = p.length - 1, d = n < 1 ? [ZERO] : strip(p.slice(0, -1).map((c, k) => tidy(mul(num(n - k), c))));
    return only(b0 ? 'Pochodna iloczynu' : 'Pochodna wielomianu', '', row(d, isApprox(a0) || (!!b0 && isApprox(b0))), pretty(asExpr(d)));
  },
  polyint: ([p0, k0]) => {
    const p = vector(p0, 'polyint'), n = p.length, k = k0 ? scalarOf(k0, 'Stała') : ZERO;
    const out = [...p.map((c, i) => tidy(div(c, num(n - i)))), k];
    return only('Całka wielomianu', '', row(out, isApprox(p0)), pretty(asExpr(out)));
  },
  conv: ([a, b]) => {
    const c = conv(vector(a, 'conv'), vector(b, 'conv')).map(tidy);
    return only('Splot (iloczyn wielomianów)', '', row(c, isApprox(a) || isApprox(b)), pretty(asExpr(c)));
  },
  deconv: ([b, a], nout) => {
    const [q, r] = deconv(vector(b, 'deconv'), vector(a, 'deconv')), ap = isApprox(a) || isApprox(b);
    const [qv, rv] = [row(q, ap), row(r, ap)];
    return { cards: [card('Dzielenie wielomianów', [['q', qv], ['r', rv]], `b = conv(a, q) + r: ${pretty(asExpr(q))} reszty ${pretty(asExpr(strip(r)))}.`)], outputs: nout >= 2 ? [qv, rv] : [qv] };
  },
  residue: ([b0, a0], nout) => residue(vector(b0, 'residue'), vector(a0, 'residue'), nout),
  polyfit: ([x0, y0, n0]) => {
    const x = vector(x0, 'polyfit'), y = vector(y0, 'polyfit'), n = intOf(n0, 'Stopień');
    if (x.length !== y.length) fail(`polyfit: x i y mają różne długości (${x.length} i ${y.length}).`);
    if (x.length < n + 1) fail(`polyfit: wielomian stopnia ${n} potrzebuje co najmniej ${n + 1} punktów.`);
    const ap = isApprox(x0) || isApprox(y0);
    let c: Expr[], exact = false, note: string;
    if (!ap && allRational(x, y) && x.length <= 2000 && n <= 30) {
      // exact least squares: the normal equations over ℚ lose nothing
      const V = x.map(xi => Array.from({ length: n + 1 }, (_, k) => (k === n ? ONE : pow(xi, num(n - k)))));
      c = LA.leftSolve(V, y.map(v => [v])).map(r => r[0]);
      exact = true;
      note = x.length === n + 1 ? 'Dokładnie: wielomian przechodzi przez wszystkie punkty.' : 'Dokładnie: najmniejsze kwadraty z równań normalnych nad ℚ.';
    } else {
      const xs = realNums(x, 'polyfit'), ys = realNums(y, 'polyfit');
      const V = xs.map(xi => Array.from({ length: n + 1 }, (_, k) => xi ** (n - k)));
      const sol = D.leastSquares(V, ys.map(v => [v]));
      if (!sol) fail('polyfit: punkty nie wyznaczają wielomianu tego stopnia (wartości x się powtarzają).');
      c = sol!.map(r => num(toQ(r[0])));
      const S = D.svd(V).S, cnd = S[0] / S[S.length - 1];
      note = `Numerycznie: najmniejsze kwadraty przez rozkład QR.${cnd > 1e10 ? ` Uwaga: zadanie jest źle uwarunkowane (cond ≈ ${tiny(cnd)}); mniejszy stopień albo przesunięcie x pomogą.` : ''}`;
    }
    const showExact = exact && short(c);
    const coeffs = row(c, !showExact);
    const pE = asExpr(c), fitted = x.map(xi => horner(c, xi)), r2 = rSquared(y, fitted);
    const plot = dataPlot([{ xs: realNums(x, 'polyfit'), ys: realNums(y, 'polyfit'), label: 'dane', style: 'dots' }], { curve: { f: compileDouble(pE, 'x'), label: `p(x)`, expr: showExact ? graphText(pE, 'x') : undefined } });
    const rows: [string, Value][] = [['p', coeffs], ...(showExact ? [['p(x)', ex(tidy(pE))] as [string, Value]] : [])];
    // a statistic: as a decimal, unless the fit is exact (1) or useless (0)
    if (r2) { const r2s = tidy(r2); rows.push(['R²', exact && isNum(r2s) && r2s.v.d === 1n ? ex(r2s) : approxValue(ex(r2))]); }
    return { cards: [card(`Wielomian stopnia ${n} dopasowany do danych`, rows, `${showExact ? '' : `p(x) ≈ ${decimalPoly(c)}. `}${note}${exact && !showExact ? ' Ułamki są długie, więc pokazuję je w postaci dziesiętnej.' : ''} Współczynniki od najwyższej potęgi, jak w MATLAB-ie.`, plot)], outputs: [coeffs] };
  },
  fit: ([x0, y0, m0]) => {
    const xs = realNums(vector(x0, 'fit'), 'fit'), ys = realNums(vector(y0, 'fit'), 'fit');
    if (m0?.t !== 'expr') return fail('fit(x, y, model): model to wyrażenie zmiennej x z parametrami, np. a*exp(b*x).');
    const model = m0.e, names = variables(model).filter(v => v !== 'x');
    if (!names.length) fail('fit: model nie ma parametrów do dopasowania, np. a*exp(b*x).');
    if (xs.length !== ys.length) fail('fit: x i y mają różne długości.');
    if (xs.length < names.length) fail(`fit: ${names.length} parametry potrzebują co najmniej tylu punktów.`);
    // several starts: a sum of squares has local minima
    const starts = [1, 0.5, 2, -1, 0.1, 10, -0.5].map(s => names.map((_, k) => s * (k % 2 ? 1 : 1.3) ** k));
    const runs = starts.map(s => levenberg(model, names, xs, ys, s)).filter(r => Number.isFinite(r.sse));
    if (!runs.length) fail('fit: model nie daje skończonych wartości dla tych danych.');
    runs.sort((a, b) => a.sse - b.sse);
    const best = runs[0];
    if (!best.ok) fail('fit: dopasowanie nie zbiegło się; spróbuj innego modelu.');
    const rival = runs.find(r => r.sse <= best.sse * (1 + 1e-6) + 1e-300 && r.p.some((v, k) => Math.abs(v - best.p[k]) > 1e-4 * (1 + Math.abs(best.p[k]))));
    const fitted = subst(model, 'x', X);
    const at = names.reduce((e, n, k) => subst(e, n, num(toQ(best.p[k]))), fitted);
    const mean = ys.reduce((s, v) => s + v, 0) / ys.length, tot = ys.reduce((s, v) => s + (v - mean) ** 2, 0);
    const rows: [string, Value][] = names.map((n, k) => [n, approxValue(ex(num(toQ(best.p[k]))))]);
    rows.push(['suma kwadratów', approxValue(ex(num(toQ(best.sse))))]);
    if (tot > 0) rows.push(['R²', approxValue(ex(num(toQ(1 - best.sse / tot))))]);
    const plot = dataPlot([{ xs, ys, label: 'dane', style: 'dots' }], { curve: { f: compileDouble(at, 'x'), label: 'model', expr: graphText(at, 'x') } });
    return {
      cards: [card('Dopasowanie modelu (najmniejsze kwadraty)', rows, `Numerycznie: metoda Levenberga–Marquardta z ${starts.length} punktów startowych.${rival ? ' Uwaga: inny zestaw parametrów daje równie dobre dopasowanie, więc wynik nie jest jednoznaczny.' : ''}`, plot)],
      outputs: [valueOf([best.p.map(v => num(toQ(v)))])].map(v => approxValue(v)),
    };
  },
  interp1: ([x0, y0, q0, m0, e0]) => {
    const method = m0?.t === 'str' ? m0.s : 'linear';
    if (m0 && m0.t !== 'str') fail("interp1: metoda to napis, np. 'spline'.");
    const extrap = e0?.t === 'str' && e0.s === 'extrap' || (m0?.t === 'str' && m0.s === 'extrap');
    const p = piecesOf(vector(x0, 'interp1'), vector(y0, 'interp1'), m0?.t === 'str' && m0.s === 'extrap' ? 'linear' : method, 'interp1');
    const names: Record<string, string> = { linear: 'liniowa', nearest: 'najbliższy sąsiad', previous: 'poprzednia wartość', next: 'następna wartość', spline: 'funkcja sklejana (not-a-knot)', pchip: 'pchip (zachowuje monotoniczność)', cubic: 'pchip' };
    return interpolation(p, q0, extrap || p.kind === 'cubic', isApprox(x0) || isApprox(y0) || isApprox(q0), 'Interpolacja', `Metoda: ${names[method] ?? method}${p.kind === 'cubic' ? '' : ''}; ${isApprox(x0) || isApprox(y0) ? 'z liczb przybliżonych.' : 'dokładnie.'}`);
  },
  spline: ([x0, y0, q0]) => {
    const x = vector(x0, 'spline'), y = vector(y0, 'spline');
    const natural = q0?.t === 'str' && /^(natural|naturalna)$/.test(q0.s);
    if (q0?.t === 'str' && !natural) fail("spline: trzeci argument to punkty albo 'natural'.");
    // y two longer than x: the end slopes first and last (clamped), as in MATLAB
    const clamped = y.length === x.length + 2;
    const [xs, ys] = sortedData(x, clamped ? y.slice(1, -1) : y, 'spline');
    const slopes = splineSlopes(xs, ys, natural ? 'natural' : clamped ? [y[0], y[y.length - 1]] : 'notaknot');
    const kind = natural ? 'naturalna (druga pochodna 0 na końcach)' : clamped ? 'z zadanymi nachyleniami na końcach' : 'not-a-knot, jak w MATLAB-ie';
    return interpolation({ xs, ys, slopes, kind: 'cubic' }, q0 && !natural ? q0 : null, true, isApprox(x0) || isApprox(y0), 'Funkcja sklejana stopnia 3', `Rodzaj: ${kind}; liczona dokładnie dla danych wymiernych.`);
  },
  pchip: ([x0, y0, q0]) => {
    const [xs, ys] = sortedData(vector(x0, 'pchip'), vector(y0, 'pchip'), 'pchip');
    return interpolation({ xs, ys, slopes: pchipSlopes(xs, ys), kind: 'cubic' }, q0 ?? null, true, isApprox(x0) || isApprox(y0), 'Interpolacja pchip', 'Kawałkami sześcienna, zachowuje monotoniczność danych (Fritsch–Carlson, jak w MATLAB-ie).');
  },
  trapz: ([a, b]) => {
    const [x, y] = b ? [vector(a, 'trapz'), vector(b, 'trapz')] : [null, vector(a, 'trapz')];
    if (x && x.length !== y.length) fail('trapz: x i y mają różne długości.');
    const s = add(...y.slice(1).map((v, i) => mul(x ? sub(x[i + 1], x[i]) : ONE, div(add(y[i], v), num(2)))));
    const ap = isApprox(a) || (!!b && isApprox(b));
    return only('Całka metodą trapezów', '', ap ? approxValue(ex(s)) : ex(tidy(s)), x ? undefined : 'Odstęp 1 między punktami (jak trapz(y) w MATLAB-ie).');
  },
  cumtrapz: ([a, b]) => {
    const [x, y] = b ? [vector(a, 'cumtrapz'), vector(b, 'cumtrapz')] : [null, vector(a, 'cumtrapz')];
    if (x && x.length !== y.length) fail('cumtrapz: x i y mają różne długości.');
    let s: Expr = ZERO;
    const out = [ZERO, ...y.slice(1).map((v, i) => (s = tidy(add(s, mul(x ? sub(x[i + 1], x[i]) : ONE, div(add(y[i], v), num(2)))))))];
    return only('Całki częściowe metodą trapezów', '', row(out, isApprox(a) || (!!b && isApprox(b))));
  },
  scatter: ([x, y]) => dataCard('Wykres punktowy', [{ ...xy(x, y, 'scatter'), label: 'punkty', style: 'dots' }]),
  stem: ([a, b]) => dataCard('Wykres łodygowy', [{ ...xy(b ? a : null, b ?? a, 'stem'), label: 'wartości', style: 'stems' }]),
  bar: ([a, b]) => {
    const { xs, ys } = xy(b ? a : null, b ?? a, 'bar');
    const w = xs.length > 1 ? Math.min(...xs.slice(1).map((v, i) => v - xs[i])) * 0.8 : 0.8;
    const plot = dataPlot([], { bars: { xs, hs: ys, width: w, labels: xs.map((x, i) => `${fmt(x)}: ${fmt(ys[i])}`) } });
    return { cards: [card('Wykres słupkowy', [], undefined, plot)], outputs: [] };
  },
  histogram: ([v, n0]) => {
    const vals = realNums(vector(v, 'histogram'), 'histogram');
    const h = histogramPlot(vals, n0 ? intOf(n0, 'Liczba przedziałów') : undefined);
    if (!h) fail('histogram: brak liczb.');
    const counts = valueOf([h!.counts.map(c => num(c))]);
    return { cards: [card('Histogram', [['liczności', counts]], `${h!.counts.length} przedziałów od ${fmt(h!.edges[0])} do ${fmt(h!.edges[h!.edges.length - 1])}${n0 ? '' : ' (reguła Sturgesa)'}.`, h!.plot)], outputs: [counts] };
  },
  errorbar: ([x, y, e]) => {
    const d = xy(x, y, 'errorbar'), es = realNums(vector(e, 'errorbar'), 'errorbar');
    if (es.length !== d.xs.length) fail('errorbar: błędy mają inną długość niż dane.');
    const plot = dataPlot([{ ...d, label: 'dane', style: 'line' }], { errors: { xs: d.xs, ys: d.ys, es } });
    return { cards: [card('Wykres z odcinkami błędów', [], 'Pionowe odcinki: y ± błąd.', plot)], outputs: [] };
  },
  polarplot: ([t0, r0]) => {
    if (!r0) {
      // polarplot(r(θ)): the curve (r cos θ, r sin θ), θ from 0 to 2π
      const re = t0.t === 'expr' ? t0.e : fail('polarplot(r(θ)) albo polarplot(θ, r) z danymi.');
      const vs = variables(re);
      if (vs.length > 1) fail('polarplot: r ma zależeć od jednej zmiennej (kąta).');
      const t = vs[0] ?? 't', T = sym(t);
      const s = parametricSeries(mul(re, fn('cos', T)), mul(re, fn('sin', T)), t, 0, 2 * Math.PI, `r = ${pretty(re)}`, 0);
      if (!s.segs.length) fail('polarplot: krzywa nie ma punktów rzeczywistych.');
      const pts = s.segs.flat(), xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2);
      const w = Math.max(...xs.map(Math.abs), ...ys.map(Math.abs), 1e-9) * 1.15;
      const plot = { x: [-w, w] as [number, number], y: [-w, w] as [number, number], equal: true, series: [s], marks: [], bands: [], vlines: [], hlines: [], refs: [], fills: [], vectors: [], shapes: [], bars: [] };
      return { cards: [card('Wykres biegunowy', [], `r = ${pretty(re)}, ${t} ∈ ⟨0; 2π⟩.`, plot)], outputs: [] };
    }
    const { xs: th, ys: r } = xy(t0, r0, 'polarplot');
    return dataCard('Wykres biegunowy', [{ xs: th.map((t, i) => r[i] * Math.cos(t)), ys: th.map((t, i) => r[i] * Math.sin(t)), label: 'r(θ)', style: 'line' }], true);
  },
};

const pretty = (e: Expr) => toText(tidy(e));

function coefficient(e: Expr, x: string, k: number): Expr {
  // the k-th derivative at 0 over k!
  let d = e, f = 1;
  for (let i = 1; i <= k; i++) { d = diff(d, x); f *= i; }
  return div(subst(d, x, ZERO), num(f));
}
function intOf(v: Value | undefined, what: string): number {
  const e = v?.t === 'expr' ? v.e : null;
  if (!e || !isNum(e) || e.v.d !== 1n || e.v.n < 0n || e.v.n > 1000n) return fail(`${what}: oczekuję liczby całkowitej nieujemnej.`);
  return Number(e.v.n);
}
function scalarOf(v: Value, what: string): Expr {
  if (v.t !== 'expr') return fail(`${what}: oczekuję liczby.`);
  return v.e;
}
/** x and y of data as doubles; without x, 1, 2, 3, … as MATLAB's plot(y). */
function xy(x0: Value | null, y0: Value, what: string): { xs: number[]; ys: number[] } {
  const ys = realNums(vector(y0, what), what);
  const xs = x0 ? realNums(vector(x0, what), what) : ys.map((_, i) => i + 1);
  if (xs.length !== ys.length) fail(`${what}: x i y mają różne długości (${xs.length} i ${ys.length}).`);
  return { xs, ys };
}
function dataCard(title: string, series: DataSeries[], equal = false): Linalg {
  const plot = dataPlot(series, { equal });
  if (!plot) fail('Brak punktów do narysowania.');
  return { cards: [card(title, [], `${series[0].xs.length} punktów.`, plot)], outputs: [] };
}

/** plot(x, y), plot(y), plot(x, y1, x, y2): data drawn as lines; null when the arguments are not data. */
export function plotData(vals: Value[]): Linalg | null {
  if (!vals.length || !vals.every(v => isVector(v) && grid(v, 'plot').flat().every(isConstant))) return null;
  const series: DataSeries[] = [];
  if (vals.length === 1) series.push({ ...xy(null, vals[0], 'plot'), label: 'y' });
  else {
    if (vals.length % 2) fail('plot: podaj pary x, y (albo samo y).');
    for (let k = 0; k < vals.length; k += 2) series.push({ ...xy(vals[k], vals[k + 1], 'plot'), label: vals.length > 2 ? `seria ${k / 2 + 1}` : 'y(x)' });
  }
  return dataCard('Wykres danych', series);
}

/** [r, p, k] = residue(b, a): b/a = Σ r/(x − p)^j + k(x), exactly when the poles have closed forms. */
function residue(b: Expr[], a0: Expr[], nout: number): Linalg {
  const a = strip(a0);
  if (!allRational(b, a)) fail('residue: liczę dokładnie dla współczynników wymiernych.');
  const [kq, rem] = b.length >= a.length ? deconv(b, a) : [[] as Expr[], b];
  const P: Q[] = [...a].reverse().map(e => (e as { v: Q }).v), roots = solvePoly(P);
  if (roots.some(r => !r.exact)) fail('residue: bieguny nie mają postaci dokładnej; dokładnie liczę tylko takie.');
  const lead = a[0], x = 'x', remE = asExpr(rem.length ? rem : [ZERO]);
  const rs: Expr[] = [], ps: Expr[] = [];
  const sorted = [...roots].sort((u, v) => toNum(v.exact!) - toNum(u.exact!));
  for (const { exact: p, mult } of sorted) {
    let g: Expr = div(remE, mul(lead, ...sorted.filter(o => o.exact !== p).map(o => pow(sub(X, o.exact!), num(o.mult)))));
    const at: Expr[] = [];
    for (let j = 0; j < mult; j++) { at.push(div(subst(g, x, p!), num(factorial(j)))); g = diff(g, x); }
    // the coefficient of 1/(x − p)^j is the (m − j)-th derivative over (m − j)!
    for (let j = 1; j <= mult; j++) { rs.push(tidy(at[mult - j])); ps.push(p!); }
  }
  // checked at two points
  for (const t of [num(7, 3), num(-11, 5)]) {
    const lhs = div(horner(b, t), horner(a, t));
    let rhs: Expr = kq.length ? horner(kq, t) : ZERO, power = new Map<string, number>();
    rs.forEach((r, i) => { const key = String(toNum(ps[i])); const j = (power.get(key) ?? 0) + 1; power.set(key, j); rhs = add(rhs, div(r, pow(sub(t, ps[i]), num(j)))); });
    const z = approx(sub(lhs, rhs));
    if (Math.hypot(z.re, z.im) > 1e-9 * (1 + Math.abs(toNum(lhs)))) fail('residue: rozkład nie przeszedł sprawdzenia.');
    power = new Map();
  }
  const [rv, pv, kv] = [col(rs, false), col(ps, false), kq.length ? valueOf([kq]) : ({ t: 'list', items: [], set: false } as Value)];
  return { cards: [card('Rozkład na ułamki proste', [['r', rv], ['p', pv], ['k', kv]], 'Dokładnie: b/a = Σ rᵢ/(x − pᵢ)^j + k(x); przy biegunie wielokrotnym kolejne r należą do kolejnych potęg, jak w MATLAB-ie.')], outputs: nout >= 3 ? [rv, pv, kv] : nout === 2 ? [rv, pv] : [rv] };
}
const factorial = (n: number): number => (n < 2 ? 1 : n * factorial(n - 1));
/** 0,5x + 1,1667: a polynomial with its coefficients as 5 significant digits. */
function decimalPoly(c: Expr[]): string {
  const n = c.length - 1;
  const terms = c.map((e, k) => [toNum(e), n - k] as const).filter(([v]) => v !== 0);
  if (!terms.length) return '0';
  return terms.map(([v, k], i) => {
    const a = Math.abs(v), digits = String(Number(a.toPrecision(5))).replace('.', ',');
    const body = k === 0 ? digits : `${digits === '1' ? '' : digits}x${k > 1 ? `^${k}` : ''}`;
    return `${i ? (v < 0 ? ' − ' : ' + ') : v < 0 ? '−' : ''}${body}`;
  }).join('');
}
