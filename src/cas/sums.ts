/**
 * Σ and Π. Finite ranges are added up exactly. Closed forms: polynomial summands (by interpolation, which is
 * exact: the sum of a degree-d polynomial is a polynomial of degree d + 1), geometric terms, telescoping
 * rational terms, Σ 1/k^s = ζ(s), Σ c^k/k! = e^c; infinite sums as limits of the closed form.
 */
import { limit } from './calculus';
import {
  E, Expr, INF, MINUS_ONE, ONE, PI, TWO, ZERO, add, div, expand, fn, freeOf, infSign, isConstant, isInt, isNum, isZero, mul, neg, num, numDen, pow, sub,
  subst, sym, together,
} from './expr';
import { coeffsOf, polyOf } from './poly';
import { partialFractions } from './integrate';
import { cancel } from './simplify';
import { Q, Q0, fail, q, qadd, qdiv, qsub } from './q';
import { approx } from './numeric';

/** ratio: the sum holds for |ratio| < 1 (a geometric series with a symbolic ratio). */
export interface SumResult { value: Expr | null; divergent?: boolean; note?: string; ratio?: Expr }

const MAX_TERMS = 20000;

export function sum(f: Expr, k: string, a: Expr, b: Expr): SumResult {
  if (!isInt(a) && !infSign(a) && isConstant(a)) fail('Dolna granica sumy musi być liczbą całkowitą.');
  if (isInt(a) && isInt(b)) {
    const lo = a.v.n, hi = b.v.n;
    if (hi < lo) return { value: ZERO };
    if (hi - lo <= BigInt(MAX_TERMS)) {
      const terms: Expr[] = [];
      for (let j = lo; j <= hi; j++) terms.push(subst(f, k, num(j)));
      return { value: add(...terms) };
    }
  }
  if (infSign(a)) return { value: null, note: 'Dolna granica musi być skończona.' };
  if (infSign(b) > 0) {
    const g = geometric(f, k);
    if (g) {
      const { first, r } = g, fa = subst(first, k, a);
      const value = div(mul(fa, pow(r, a)), sub(ONE, r));
      if (!isConstant(r)) return { value, ratio: r };
      const v = approx(r);
      if (Math.hypot(v.re, v.im) < 1 - 1e-15) return { value };
      return { value: null, divergent: true, note: 'Szereg geometryczny o ilorazie |q| ≥ 1 jest rozbieżny.' };
    }
    const special = infiniteSpecial(f, k, a);
    if (special) return { value: special };
  }
  const n = sym('ŋ');
  const closed = closedForm(f, k, a, n);
  if (!closed) return { value: null };
  if (!infSign(b)) return { value: cancel(together(subst(closed, 'ŋ', b))) };
  // infinite: the limit of the partial sums
  const L = limit(closed, 'ŋ', INF);
  if (!L) return { value: null };
  if (L.kind === 'fin') return { value: L.v };
  if (L.kind === 'inf') return { value: null, divergent: true, note: `Szereg jest rozbieżny do ${L.s > 0 ? '+∞' : '−∞'}.` };
  return { value: null, divergent: true, note: 'Szereg jest rozbieżny (sumy częściowe nie mają granicy).' };
}

/** S(n) = Σ_{k=a}^{n} f(k) in closed form, or null. */
function closedForm(f: Expr, k: string, a: Expr, n: Expr): Expr | null {
  const K = sym(k);
  // linearity
  if (f.k === '+') {
    const parts = f.t.map(t => closedForm(t, k, a, n));
    if (parts.every(Boolean)) return add(...(parts as Expr[]));
  }
  if (freeOf(f, k)) return mul(f, add(sub(n, a), ONE));
  if (f.k === '*') {
    const c = f.t.filter(t => freeOf(t, k)), g = f.t.filter(t => !freeOf(t, k));
    if (c.length) { const r = closedForm(mul(...g), k, a, n); return r ? mul(...c, r) : null; }
  }
  // polynomial in k: interpolate S at d + 2 points
  const c = coeffsOf(f, k, 60);
  if (c) {
    const d = c.length - 1;
    if (!isInt(a)) return null;
    const lo = a.v.n;
    const xs: bigint[] = [], ys: Expr[] = [];
    let acc: Expr = ZERO;
    for (let j = 0; j <= d + 1; j++) {
      acc = add(acc, subst(f, k, num(lo + BigInt(j))));
      xs.push(lo + BigInt(j)); ys.push(acc);
    }
    return lagrange(xs, ys, n);
  }
  // geometric: f = C · r^k (including products/quotients of exponential powers)
  const g = geometric(f, k);
  if (g) {
    const { first, r } = g;
    const fa = mul(first, pow(r, a));
    if (isZero(sub(r, ONE)) || isZero(expand(sub(r, ONE)))) return mul(fa, add(sub(n, a), ONE));
    // fa · (r^(n−a+1) − 1)/(r − 1)
    return div(mul(fa, sub(pow(r, add(sub(n, a), ONE)), ONE)), sub(r, ONE));
  }
  // c^k / k!
  const [N, D] = numDen(f);
  if (D.k === 'f' && D.n === 'factorial' && D.a[0].k === 's' && D.a[0].n === k && N.k === '^' && freeOf(N.b, k) && N.e.k === 's' && N.e.n === k) {
    if (!isInt(a) || a.v.n < 0n) return null;
    // only the infinite sum has a closed form here: e^c − Σ_{j<a}
    return null;
  }
  // rational in k: telescoping partial fractions with simple poles
  return telescoping(f, k, a, n, K);
}

function lagrange(xs: bigint[], ys: Expr[], n: Expr): Expr {
  const terms: Expr[] = [];
  for (let i = 0; i < xs.length; i++) {
    let t: Expr = ys[i];
    for (let j = 0; j < xs.length; j++) {
      if (i === j) continue;
      t = mul(t, div(sub(n, num(xs[j])), num(xs[i] - xs[j])));
    }
    terms.push(t);
  }
  const s = expand(add(...terms));
  return s;
}

function telescoping(f: Expr, k: string, a: Expr, n: Expr, K: Expr): Expr | null {
  const [N, D] = numDen(together(f));
  const Np = polyOf(N, k, 40), Dp = polyOf(D, k, 40);
  if (!Np || !Dp || Dp.length < 2) return null;
  const pf = partialFractions(Np, Dp);
  if (!pf || pf.poly.length) return null;
  // every term A/(pk + r): simple poles only; group poles by r/p mod 1
  const poles: { c: Q; A: Q }[] = [];
  for (const t of pf.terms) {
    if (t.factor.length !== 2 || t.power !== 1) return null;
    const [r, p] = t.factor.map(v => q(v));
    // A/(p k + r) = (A/p)/(k + r/p)
    poles.push({ c: qdiv(r, p), A: qdiv(t.num[0], p) });
  }
  const classes = new Map<string, { c: Q; A: Q }[]>();
  for (const p of poles) {
    const frac = qsub(p.c, q(floorQ(p.c)));
    const id = `${frac.n}/${frac.d}`;
    (classes.get(id) ?? classes.set(id, []).get(id)!).push(p);
  }
  const out: Expr[] = [];
  for (const group of classes.values()) {
    const total = group.reduce((s, p) => qadd(s, p.A), Q0);
    if (total.n) return null; // a harmonic-like part: no elementary closed form
    // Σ_{k=a}^{n} Σ A_c/(k + c) with Σ A_c = 0: shift each pole to the smallest c0
    const c0 = group.reduce((m, p) => (qsub(p.c, m).n < 0n ? p.c : m), group[0].c);
    for (const p of group) {
      const m = qsub(p.c, c0);  // a nonnegative integer
      const M = Number(m.n / m.d);
      // A/(k + c0 + M) summed = A·[H-like shifted]: Σ_{k=a}^{n} 1/(k + c0 + M) − Σ 1/(k + c0) = Σ_{j=1}^{M} 1/(n + c0 + j) − Σ_{j=0}^{M−1} 1/(a + c0 + j)
      for (let j = 1; j <= M; j++) out.push(mul(num(p.A), pow(add(n, num(c0), num(j)), MINUS_ONE)));
      for (let j = 0; j < M; j++) out.push(neg(mul(num(p.A), pow(add(a, num(c0), num(j)), MINUS_ONE))));
    }
  }
  void K;
  return add(...out);
}
const floorQ = (x: Q) => { const f = x.n / x.d; return x.n < 0n && f * x.d !== x.n ? f - 1n : f; };

/** f = C(k-free) · r^k: returns C (as the term at k with r^k divided out) and r. */
function geometric(f: Expr, k: string): { first: Expr; r: Expr } | null {
  const factors = f.k === '*' ? f.t : [f];
  const powers = factors.filter(t => !freeOf(t, k));
  if (!powers.length || !powers.every(t => t.k === '^' && freeOf(t.b, k))) return null;
  let r: Expr = ONE;
  let first: Expr = mul(...factors.filter(t => freeOf(t, k)));
  for (const p of powers as (Expr & { b: Expr; e: Expr })[]) {
    const e = coeffsOf(p.e, k, 1);
    if (!e || e.length !== 2) return null;
    r = mul(r, pow(p.b, e[1]));
    first = mul(first, pow(p.b, e[0]));
  }
  if (!freeOf(first, k) || !freeOf(r, k)) return null;
  return { first, r };
}

/** Extract (-1)^(α·k + β) factor from N, returning { coef, parity } where (-1)^(α·k + β) = (-1)^(k + parity) for integer k. */
function splitAlternating(N: Expr, k: string): { coef: Expr; shift: bigint } | null {
  const factors = N.k === '*' ? N.t : [N];
  const alt = factors.filter(t => !freeOf(t, k));
  if (alt.length !== 1) return null;
  const p = alt[0];
  if (p.k !== '^' || !isNum(p.b) || p.b.v.n !== -1n || p.b.v.d !== 1n) return null;
  const e = coeffsOf(p.e, k, 1);
  if (!e || e.length !== 2 || !isInt(e[0]) || !isInt(e[1])) return null;
  if (e[1].v.n % 2n === 0n) return null;
  const coef = mul(...factors.filter(t => t !== p));
  return { coef, shift: e[0].v.n };
}

/** Σ_{k=a}^{∞} for the special forms with known values; null otherwise. */
export function infiniteSpecial(f: Expr, k: string, a: Expr): Expr | null {
  if (!isInt(a)) return null;
  const [N, D] = numDen(f);
  // c/(k + d)^s, s ≥ 2: ζ(s) minus the first terms
  if (freeOf(N, k) && D.k === '^' && isInt(D.e) && D.e.v.n >= 2n) {
    const lin = coeffsOf(D.b, k, 1);
    if (lin && lin.length === 2 && isNum(lin[1]) && isNum(lin[0]) && lin[1].v.n === 1n && lin[1].v.d === 1n && isInt(lin[0])) {
      const start = a.v.n + lin[0].v.n; // Σ_{m=start}^{∞} 1/m^s
      if (start >= 1n) {
        const s = D.e;
        const head: Expr[] = [];
        for (let m = 1n; m < start; m++) head.push(pow(num(m), neg(s)));
        return mul(N, sub(fn('zeta', s), add(...head)));
      }
    }
  }
  // Alternating series: c·(-1)^(k + shift) / D(k)
  const alt = splitAlternating(N, k);
  if (alt) {
    // 1. Alternating harmonic & Leibniz: D = p·k + d
    const lin = coeffsOf(D, k, 1);
    if (lin && lin.length === 2 && isInt(lin[1]) && isInt(lin[0])) {
      const p = lin[1].v.n, d = lin[0].v.n;
      // p = 1: Σ_{m=start}^∞ (-1)^(m-1)/m = ln(2) − Σ_{m=1}^{start-1} (-1)^(m-1)/m
      if (p === 1n && a.v.n + d >= 1n) {
        const start = a.v.n + d;
        const signFactor = ((alt.shift - d + 1n) % 2n === 0n) ? ONE : MINUS_ONE;
        const head: Expr[] = [];
        for (let m = 1n; m < start; m++) head.push(mul(m % 2n === 1n ? ONE : MINUS_ONE, pow(num(m), MINUS_ONE)));
        return mul(alt.coef, signFactor, sub(fn('ln', TWO), add(...head)));
      }
      // p = 2, d odd: Σ_{j=start}^∞ (-1)^j/(2j + 1) = π/4 − Σ_{j=0}^{start-1} (-1)^j/(2j + 1)
      if (p === 2n && ((d % 2n) + 2n) % 2n === 1n) {
        const jShift = (d - 1n) / 2n;
        const start = a.v.n + jShift;
        if (start >= 0n) {
          const signFactor = ((alt.shift - jShift) % 2n === 0n) ? ONE : MINUS_ONE;
          const head: Expr[] = [];
          for (let j = 0n; j < start; j++) head.push(mul(j % 2n === 0n ? ONE : MINUS_ONE, pow(num(2n * j + 1n), MINUS_ONE)));
          return mul(alt.coef, signFactor, sub(div(PI, num(4)), add(...head)));
        }
      }
    }
    // 2. Alternating zeta: c·(-1)^(k + shift) / (k + d)^s, s ≥ 2: (1 − 2^(1−s))·ζ(s)
    if (D.k === '^' && isInt(D.e) && D.e.v.n >= 2n) {
      const linB = coeffsOf(D.b, k, 1);
      if (linB && linB.length === 2 && isInt(linB[1]) && linB[1].v.n === 1n && isInt(linB[0])) {
        const d = linB[0].v.n, start = a.v.n + d;
        if (start >= 1n) {
          const s = D.e;
          const signFactor = ((alt.shift - d + 1n) % 2n === 0n) ? ONE : MINUS_ONE;
          const eta = mul(sub(ONE, pow(TWO, sub(ONE, s))), fn('zeta', s));
          const head: Expr[] = [];
          for (let m = 1n; m < start; m++) head.push(mul(m % 2n === 1n ? ONE : MINUS_ONE, pow(num(m), neg(s))));
          return mul(alt.coef, signFactor, sub(eta, add(...head)));
        }
      }
    }
  }
  // c^k/k! → e^c − Σ_{j<a} c^j/j!
  if (D.k === 'f' && D.n === 'factorial' && D.a[0].k === 's' && D.a[0].n === k) {
    const c = coeffsOf(N, k, 0);
    let base: Expr | null = null, coef: Expr = ONE;
    if (N.k === '^' && freeOf(N.b, k) && N.e.k === 's' && N.e.n === k) base = N.b;
    else if (N.k === '*') {
      const p = N.t.find(t => t.k === '^' && freeOf(t.b, k) && t.e.k === 's' && t.e.n === k) as (Expr & { b: Expr }) | undefined;
      if (p && N.t.every(t => t === p || freeOf(t, k))) { base = p.b; coef = div(N, p); }
    } else if (c && freeOf(N, k)) { base = ONE; coef = N; }
    if (base && a.v.n >= 0n) {
      const head: Expr[] = [];
      for (let j = 0n; j < a.v.n; j++) head.push(div(pow(base, num(j)), fn('factorial', num(j))));
      return mul(coef, sub(pow(E, base), add(...head)));
    }
  }
  // geometric with |r| < 1 handled by the generic path (limit of the closed form)
  return null;
}

/** Π_{k=a}^{b} f: finite ranges exactly; Π k = n!, Π c = c^(n−a+1). */
export function product(f: Expr, k: string, a: Expr, b: Expr): Expr | null {
  if (isInt(a) && isInt(b)) {
    if (b.v.n < a.v.n) return ONE;
    if (b.v.n - a.v.n <= BigInt(MAX_TERMS)) {
      const fs: Expr[] = [];
      for (let j = a.v.n; j <= b.v.n; j++) fs.push(subst(f, k, num(j)));
      return mul(...fs);
    }
  }
  if (freeOf(f, k)) return pow(f, add(sub(b, a), ONE));
  if (f.k === 's' && f.n === k && isInt(a) && a.v.n >= 1n) return div(fn('factorial', b), fn('factorial', num(a.v.n - 1n)));
  return null;
}

/** Ratio test by numbers: |f(k+1)/f(k)| for large k. */
export function ratioHint(f: Expr, k: string): number | null {
  try {
    const big = 100000;
    const r = approx(div(subst(f, k, num(big + 1)), subst(f, k, num(big))));
    return Number.isFinite(r.re) ? Math.abs(r.re) : null;
  } catch { return null; }
}

