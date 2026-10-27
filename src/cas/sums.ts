/**
 * Σ and Π. Finite ranges are added up exactly. Closed forms: polynomial summands (by interpolation, which is
 * exact: the sum of a degree-d polynomial is a polynomial of degree d + 1), geometric terms, telescoping
 * rational terms, Σ 1/k^s = ζ(s), Σ c^k/k! = e^c; infinite sums as limits of the closed form.
 */
import { limit } from './calculus';
import {
  E, Expr, INF, MINUS_ONE, ONE, PI, TWO, ZERO, add, div, expand, fn, freeOf, infSign, isConstant, isInt, isNum, isSym, isZero, mul, neg, num, numDen, pow, same, sub,
  subst, sym, together,
} from './expr';
import { coeffsOf, factorPoly, polyOf } from './poly';
import { partialFractions, quad } from './integrate';
import { diff } from './calculus';
import { compileDouble } from './fast';
import { cancel } from './simplify';
import { Q, Q0, fail, q, qadd, qcmp, qdiv, qint, qmul, qsub } from './q';
import { approx } from './numeric';

/** ratio: the sum holds for |ratio| < 1 (a geometric series with a symbolic ratio). */
export interface SumResult { value: Expr | null; divergent?: boolean; note?: string; ratio?: Expr; converges?: boolean }

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
  const binom = binomialSum(f, k, a, b);
  if (binom) return { value: binom };
  const pg = polyGeometric(f, k, a);
  if (pg) {
    if (!infSign(b)) return { value: add(mul(pow(pg.r, b), pg.Q(b)), pg.C) };
    if (infSign(b) > 0) {
      // r^n·Q(n) → 0 exactly when |r| < 1
      if (!isConstant(pg.r)) return { value: pg.C, ratio: pg.r };
      const v = approx(pg.r);
      if (Math.hypot(v.re, v.im) < 1 - 1e-15) return { value: pg.C };
      return { value: null, divergent: true, note: 'Wyrazy nie dążą do zera, bo |q| ≥ 1.' };
    }
  }
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
  if (!closed) return infSign(b) > 0 ? convergence(f, k) : { value: null };
  if (!infSign(b)) return { value: cancel(together(subst(closed, 'ŋ', b))) };
  // infinite: the limit of the partial sums
  const L = limit(closed, 'ŋ', INF);
  if (!L) return { value: null };
  if (L.kind === 'fin') return { value: L.v };
  if (L.kind === 'inf') return { value: null, divergent: true, note: `Szereg jest rozbieżny do ${L.s > 0 ? '+∞' : '−∞'}.` };
  return { value: null, divergent: true, note: 'Szereg jest rozbieżny (sumy częściowe nie mają granicy).' };
}

/**
 * Tests that decide an infinite series without a closed form. They use limits over the reals, which, when they
 * exist, are also the limits along the integers: lim f ≠ 0 diverges; lim k·f = L ≠ 0 means the terms keep one sign
 * and are of the order of 1/k, so the series diverges like the harmonic one; lim k²·f finite means |f| ≤ C/k², so it
 * converges (absolutely), and `converges` asks for a numeric value.
 */
function convergence(f: Expr, k: string): SumResult {
  const at = (g: Expr) => { try { return limit(g, k, INF); } catch { return null; } };
  const l0 = at(f);
  if (l0 && (l0.kind === 'inf' || (l0.kind === 'fin' && isConstant(l0.v) && Math.abs(approx(l0.v).re) > 1e-30))) {
    return { value: null, divergent: true, note: 'Wyrazy nie dążą do zera (warunek konieczny zbieżności).' };
  }
  if (!l0 || l0.kind !== 'fin') return { value: null };
  const K = sym(k);
  const l1 = at(mul(K, f));
  const sign = !l1 ? 0 : l1.kind === 'inf' ? l1.s : l1.kind === 'fin' && isConstant(l1.v) ? Math.sign(approx(l1.v).re) : 0;
  if (sign) return { value: null, divergent: true, note: `Szereg jest rozbieżny do ${sign > 0 ? '+∞' : '−∞'}: wyrazy są rzędu 1/${k}, jak w szeregu harmonicznym (kryterium porównawcze).` };
  const l2 = at(mul(pow(K, TWO), f));
  if (l2 && (l2.kind === 'fin' || l2.kind === 'bounded')) return { value: null, converges: true };
  return { value: null };
}

/**
 * Σ_{k=a}^{∞} f(k) for a convergent series of smooth terms (|f| ≤ C/k²): the first terms added up, the tail by
 * Euler–Maclaurin, ∫_N^∞ f + f(N)/2 − f′(N)/12 + f‴(N)/720 − f⁽⁵⁾(N)/30240. Null when f isn't smooth on the reals.
 */
export function numericSum(f: Expr, k: string, a: bigint): { value: number; error: number } | null {
  const N = Number(a) + 400;
  const g = compileDouble(f, k);
  let s = 0, c = 0;
  for (let j = Number(a); j < N; j++) {
    const t = g(j);
    if (!Number.isFinite(t)) return null;
    const y = s + t;
    c += Math.abs(s) >= Math.abs(t) ? (s - y) + t : (t - y) + s;
    s = y;
  }
  let d1: Expr, d3: Expr, d5: Expr;
  try { d1 = diff(f, k); d3 = diff(diff(d1, k), k); d5 = diff(diff(d3, k), k); } catch { return null; }
  const tail = quad(g, N, Infinity);
  if (!tail) return null;
  const corr = g(N) / 2 - compileDouble(d1, k)(N) / 12 + compileDouble(d3, k)(N) / 720 - compileDouble(d5, k)(N) / 30240;
  if (!Number.isFinite(corr)) return null;
  const value = s + c + tail.value + corr;
  return { value, error: tail.error + 1e-15 * Math.abs(value) + Math.abs(compileDouble(d5, k)(N)) / 30240 };
}

/**
 * Σ_{k=a}^{n} P(k)·C·r^k with r ≠ 1: S(n) = r^n·Q(n) + C₀ where Q(n) − Q(n − 1)/r = C·P(n), solved coefficient by
 * coefficient from the top (Σ k²xᵏ = x(1 + x)/(1 − x)³ in the limit).
 */
function polyGeometric(f: Expr, k: string, a: Expr): { Q: (n: Expr) => Expr; C: Expr; r: Expr } | null {
  if (!isInt(a)) return null;
  const factors = f.k === '*' ? f.t : [f];
  const geo = factors.filter(t => t.k === '^' && freeOf(t.b, k) && !freeOf(t.e, k));
  const rest = factors.filter(t => !geo.includes(t));
  if (!geo.length) return null;
  const g = geometric(mul(...geo), k), P = coeffsOf(mul(...rest), k, 30);
  if (!g || !P || P.length < 2) return null;
  const r = g.r, s = (e: Expr) => cancel(together(e));
  if (isZero(s(sub(r, ONE)))) return null;
  const d = P.length - 1, inv = pow(r, MINUS_ONE), Qc: Expr[] = [];
  const binom = (j: number, m: number) => { let v = 1n; for (let i = 0; i < m; i++) v = v * BigInt(j - i) / BigInt(i + 1); return v; };
  for (let m = d; m >= 0; m--) {
    let rhs = mul(g.first, P[m]);
    for (let j = m + 1; j <= d; j++) rhs = add(rhs, mul(inv, Qc[j], num(binom(j, m) * ((j - m) % 2 ? -1n : 1n))));
    Qc[m] = s(div(rhs, sub(ONE, inv)));
  }
  // c₀ + c₁n + …, with no 0⁰ at n = 0
  const at = (cs: Expr[], n: Expr) => add(...cs.map((c, j) => (j ? mul(c, pow(n, num(j))) : c)));
  const Q = (n: Expr) => at(Qc, n);
  const C = s(mul(pow(r, a), sub(mul(g.first, at(P, a)), Q(a))));
  return { Q, C, r };
}

/** Σ_{k=0}^{n} P(k)·C(n, k)·C·r^k for deg P ≤ 2: (1 + r)^n, n·r·(1 + r)^(n−1), n·r·(1 + n·r)·(1 + r)^(n−2). */
function binomialSum(f: Expr, k: string, a: Expr, b: Expr): Expr | null {
  if (!isZero(a) || infSign(b)) return null;
  const factors = f.k === '*' ? f.t : [f];
  const bin = factors.find(t => t.k === 'f' && t.n === 'binomial' && t.a.length === 2 && isSym(t.a[1], k) && freeOf(t.a[0], k));
  if (!bin || bin.k !== 'f' || !same(bin.a[0], b)) return null;
  const others = factors.filter(t => t !== bin);
  const geo = others.filter(t => !freeOf(t, k) && t.k === '^' && freeOf(t.b, k));
  const g = geo.length ? geometric(mul(...geo), k) : { first: ONE, r: ONE };
  const P = coeffsOf(mul(...others.filter(t => !geo.includes(t))), k, 2);
  if (!g || !P) return null;
  const r = g.r, n = b, u = add(ONE, r);
  const forms = [pow(u, n), mul(n, r, pow(u, sub(n, ONE))), mul(n, r, add(ONE, mul(n, r)), pow(u, sub(n, TWO)))];
  return mul(g.first, add(...P.map((c, j) => mul(c, forms[j]))));
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
  // c/(k + d)^s, s > 1 rational: ζ(s) minus the first terms
  if (freeOf(N, k) && D.k === '^' && isNum(D.e) && qcmp(D.e.v, q(1)) > 0) {
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
  const n = sym('ŋ');
  const P = linearProduct(f, k, a, n);
  if (!P) return null;
  if (!infSign(b)) return cancel(together(subst(P, 'ŋ', b)));
  if (infSign(b) < 0) return null;
  const L = limit(P, 'ŋ', INF);
  // an infinite product whose partial products run off to ±∞ diverges to it
  return !L ? null : L.kind === 'fin' ? L.v : L.kind === 'inf' ? (L.s > 0 ? INF : neg(INF)) : null;
}

/**
 * Π_{k=a}^{n} of a rational function whose numerator and denominator split into linear factors over ℚ:
 * Π (k + c) = Γ(n + c + 1)/Γ(a + c), and factors whose c differ by integers telescope, so Π (1 − 1/k²) from 2 is
 * (n + 1)/(2n). Null when a factor would vanish in the range or doesn't split.
 */
function linearProduct(f: Expr, k: string, a: Expr, n: Expr): Expr | null {
  if (!isInt(a)) return null;
  const [N, D] = numDen(together(f));
  const Np = polyOf(N, k, 40), Dp = polyOf(D, k, 40);
  if (!Np || !Dp) return null;
  let lead: Q = q(1);
  const lin: { c: Q; m: number }[] = [];
  for (const [p, sign] of [[Np, 1], [Dp, -1]] as const) {
    const fac = factorPoly(p);
    if (!fac.complete) return null;
    lead = sign > 0 ? qmul(lead, fac.content) : qdiv(lead, fac.content);
    for (const [g, m] of fac.factors) {
      if (g.length !== 2) return null;
      const [r0, r1] = g.map(v => q(v));
      lead = sign > 0 ? qpow(lead, r1, m, 1) : qpow(lead, r1, m, -1);
      const c = qdiv(r0, r1);  // p·k + r = p·(k + r/p)
      if (qint(c) && a.v.n + c.n / c.d <= 0n) return null;  // k + c = 0 inside the range
      lin.push({ c, m: m * sign });
    }
  }
  const out: Expr[] = [pow(num(lead), add(sub(n, a), ONE))];
  const classes = new Map<string, { c: Q; m: number }[]>();
  for (const t of lin) { const fr = qsub(t.c, q(floorQ(t.c))); const id = `${fr.n}/${fr.d}`; (classes.get(id) ?? classes.set(id, []).get(id)!).push(t); }
  for (const group of classes.values()) {
    const c0 = group.reduce((m, t) => (qsub(t.c, m).n < 0n ? t.c : m), group[0].c);
    let total = 0;
    for (const { c, m } of group) {
      const M = Number(qsub(c, c0).n);
      // Π_{k=a}^{n} (k + c) = Γ(n + c0 + 1)/Γ(a + c) · Π_{j=1}^{M} (n + c0 + j)
      total += m;
      out.push(pow(fn('gamma', add(a, num(c))), num(-m)));
      for (let j = 1; j <= M; j++) out.push(pow(add(n, num(c0), num(j)), num(m)));
    }
    if (total) out.push(pow(fn('gamma', add(n, num(c0), ONE)), num(total)));
  }
  return mul(...out);
}
const qpow = (lead: Q, p: Q, m: number, sign: 1 | -1): Q => { let v = lead; for (let i = 0; i < m; i++) v = sign > 0 ? qmul(v, p) : qdiv(v, p); return v; };

/** Ratio test by numbers: |f(k+1)/f(k)| for large k. */
export function ratioHint(f: Expr, k: string): number | null {
  try {
    const big = 100000;
    const r = approx(div(subst(f, k, num(big + 1)), subst(f, k, num(big))));
    return Number.isFinite(r.re) ? Math.abs(r.re) : null;
  } catch { return null; }
}

