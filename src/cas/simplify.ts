/**
 * Rewriting beyond the automatic canonical form: cancelling rational functions, factoring expressions,
 * trigonometric identities, and simplify(), which keeps the smallest of the equivalent forms it tries.
 */
import { Expr, I, ONE, TWO, add, children, div, expand, fn, freeOf, isFn, isNum, isZero, mapChildren, mul, num, numDen, pow, same, size, sub, subst, sym, together, variables, isSym, split, isInt, key } from './expr';
import { complexParts } from './functions';
import { P, factorPoly, fromInts, pdivmod, pgcd, polyOf, polyToExpr, primitive, deg } from './poly';
import { Q, Q1, gcd, qdiv, q, qeq, qint } from './q';
import { compileDouble } from './fast';
import { csub, evalC } from './numeric';
import { top } from './bigfloat';
import { factorInteger } from './ntheory';

// --- Rational functions ---

/** N/D with the polynomial gcd divided out, when N and D are polynomials in one variable over ℚ. */
export function cancel(e: Expr): Expr {
  const [n, d] = numDen(e);
  if (isNum(d)) return e;
  const vs = variables(mul(n, d));
  if (vs.length !== 1) return cancelMonomials(n, d) ?? e;
  const x = vs[0], pn = polyOf(n, x), pd = polyOf(d, x);
  if (!pn || !pd) return cancelMonomials(n, d) ?? e;
  const g = pgcd(pn, pd);
  let a = pn, b = pd;
  if (deg(g) > 0) { a = pdivmod(pn, g)[0]; b = pdivmod(pd, g)[0]; }
  // denominator primitive with a positive leading coefficient; its content moves up
  const [cb, ib] = primitive(b);
  const X = sym(x);
  const top = polyToExpr(a.map(c => qdiv(c, cb)), X), bottom = polyToExpr(fromInts(ib), X);
  return div(top, bottom);
}
/** x²y/(xy³) → x/y² for products of powers (any number of variables). */
function cancelMonomials(n: Expr, d: Expr): Expr | null {
  const nf = n.k === '*' ? n.t : [n], df = d.k === '*' ? d.t : [d];
  if (![...nf, ...df].every(f => f.k !== '+')) return null;
  return div(n, d);
}

// --- Factoring ---

export interface Factored { e: Expr; complete: boolean }

/** Factors over ℚ: univariate polynomials completely (Kronecker within a budget), common monomials, homogeneous forms. */
export function factorExpr(e: Expr): Factored {
  const t = together(e);
  const [n, d] = numDen(t);
  const fn_ = factorPolynomial(n), fd = factorPolynomial(d);
  return { e: isOneE(fd.e) ? fn_.e : div(fn_.e, fd.e), complete: fn_.complete && fd.complete };
}
const isOneE = (e: Expr) => isNum(e) && qeq(e.v, Q1);

/** Product kept as written: c · f₁^m₁ · f₂^m₂ … (the canonical mul doesn't expand it). */
function product(c: Q, factors: [Expr, number][]): Expr {
  return mul(num(c), ...factors.map(([f, m]) => pow(f, num(m))));
}

function factorPolynomial(e: Expr): Factored {
  const ex = expand(e);
  if (isNum(ex)) return { e: ex, complete: true };
  const vs = variables(ex);
  if (!vs.length) return { e, complete: true };
  // common numeric content and monomial
  const terms = ex.k === '+' ? ex.t : [ex];
  // x^(n + 1), 1/x, sin x are no polynomial: the steps below would read x^(n + 1) as degree 0 and put x = 1 into it
  if (!terms.every(t => isMonomial(t, vs))) return { e, complete: false };
  const mono = commonMonomial(terms, vs);
  const rest = expand(div(ex, mono));
  if (vs.length === 1) {
    const p = polyOf(rest, vs[0]);
    if (!p) return { e, complete: false };
    const r = factorUni(p, sym(vs[0]));
    return { e: mul(mono, r.e), complete: r.complete };
  }
  // homogeneous in two variables: factor f(x, 1) and homogenise back
  if (vs.length === 2) {
    const [x, y] = vs;
    const h = homogeneousDegree(rest, vs);
    if (h !== null) {
      const p = polyOf(subsY(rest, y), x);
      if (p) {
        const r = factorPolyFactors(p);
        const X = sym(x), Y = sym(y);
        const fs: [Expr, number][] = r.factors.map(([f, m]) => [homogenise(fromInts(f), X, Y), m]);
        // degree lost in f(x, 1) is a power of y
        const lost = h - r.factors.reduce((s, [f, m]) => s + (f.length - 1) * m, 0);
        return { e: mul(mono, product(r.content, fs), pow(Y, num(lost))), complete: r.complete };
      }
    }
    // a polynomial in x whose coefficients involve y: pull out rational roots in x of the form ±y·c (difference of squares etc.)
  }
  return { e: mul(mono, rest), complete: false };
}
/** c·x^a·y^b… with natural exponents and c free of every variable in vs. */
function isMonomial(t: Expr, vs: string[]): boolean {
  return (t.k === '*' ? t.t : [t]).every(f => vs.every(v => freeOf(f, v))
    || vs.some(v => isSym(f, v) || (f.k === '^' && isSym(f.b, v) && isInt(f.e) && f.e.v.n > 0n)));
}
function subsY(e: Expr, y: string): Expr {
  return expand(mapSym(e, y, ONE));
}
function mapSym(e: Expr, name: string, to: Expr): Expr {
  if (e.k === 's' && e.n === name) return to;
  if (e.k === 'n' || e.k === 's') return e;
  return mapChildren(e, c => mapSym(c, name, to));
}
function homogenise(p: P, X: Expr, Y: Expr): Expr {
  const d = p.length - 1;
  return add(...p.map((c, k) => mul(num(c), pow(X, num(k)), pow(Y, num(d - k)))));
}
function homogeneousDegree(e: Expr, vs: string[]): number | null {
  const terms = e.k === '+' ? e.t : [e];
  let deg0: number | null = null;
  for (const t of terms) {
    const d = vs.reduce((s, v) => s + degreeIn(t, v), 0);
    if (deg0 === null) deg0 = d; else if (d !== deg0) return null;
  }
  return deg0;
}
function degreeIn(t: Expr, v: string): number {
  const fs = t.k === '*' ? t.t : [t];
  let d = 0;
  for (const f of fs) {
    if (isSym(f, v)) d += 1;
    else if (f.k === '^' && isSym(f.b, v) && isInt(f.e)) d += Number(f.e.v.n);
  }
  return d;
}
function commonMonomial(terms: readonly Expr[], vs: string[]): Expr {
  let g = 0n, l = 1n;
  const mins = new Map<string, number>(vs.map(v => [v, Infinity]));
  for (const t of terms) {
    const [c] = split(t);
    g = gcd(g, c.n); l = l * c.d / gcd(l, c.d);
    for (const v of vs) mins.set(v, Math.min(mins.get(v)!, degreeIn(t, v)));
  }
  const lead = terms.reduce((a, b) => (degreeTotal(b, vs) > degreeTotal(a, vs) ? b : a));
  const sign = split(lead)[0].n < 0n ? -1n : 1n;
  return mul(num(q(sign * g, l)), ...vs.map(v => pow(sym(v), num(Number.isFinite(mins.get(v)!) ? mins.get(v)! : 0))));
}
const degreeTotal = (t: Expr, vs: string[]) => vs.reduce((s, v) => s + degreeIn(t, v), 0);

function factorPolyFactors(p: P) { return factorPoly(p); }
function factorUni(p: P, X: Expr): Factored {
  const r = factorPoly(p);
  const fs: [Expr, number][] = r.factors.map(([f, m]) => [polyToExpr(fromInts(f), X), m]);
  return { e: product(r.content, fs), complete: r.complete };
}

// --- Trigonometry ---

/** Products and powers of sin/cos turned into sums of sin/cos of multiples (product-to-sum). */
export function trigLinearize(e: Expr): Expr {
  const ex = expand(e);
  const terms = ex.k === '+' ? ex.t : [ex];
  return add(...terms.map(linearizeTerm));
}
const LINEAR_FAMILIES = [['sin', 'cos'], ['sinh', 'cosh']];
function linearizeTerm(t: Expr): Expr {
  const inFamily = (f: Expr) => isFn(f) && LINEAR_FAMILIES.some(fam => fam.includes(f.n));
  const factors: Expr[] = [];
  for (const f of t.k === '*' ? t.t : [t]) {
    if (f.k === '^' && inFamily(f.b) && isInt(f.e) && f.e.v.n > 1n && f.e.v.n <= 40n) {
      for (let k = 0n; k < f.e.v.n; k++) factors.push(f.b);
    } else factors.push(f);
  }
  for (const fam of LINEAR_FAMILIES) {
    const at = factors.flatMap((f, k) => (isFn(f) && fam.includes(f.n) ? [k] : []));
    if (at.length < 2) continue;
    const [A, B] = [factors[at[0]], factors[at[1]]] as [Expr & { n: string; a: Expr[] }, Expr & { n: string; a: Expr[] }];
    const rest = factors.filter((_, k) => k !== at[0] && k !== at[1]);
    const a = A.a[0], b = B.a[0], [S, C] = fam;
    let pair: Expr;
    // sin a sin b = (cos(a − b) − cos(a + b))/2, sinh a sinh b = (cosh(a + b) − cosh(a − b))/2, …
    if (A.n === S && B.n === S) pair = mul(num(1, 2), S === 'sin' ? sub(fn(C, sub(a, b)), fn(C, add(a, b))) : sub(fn(C, add(a, b)), fn(C, sub(a, b))));
    else if (A.n === C && B.n === C) pair = mul(num(1, 2), add(fn(C, sub(a, b)), fn(C, add(a, b))));
    else {
      const [s, c] = A.n === S ? [a, b] : [b, a];
      pair = mul(num(1, 2), add(fn(S, add(s, c)), fn(S, sub(s, c))));
    }
    return trigLinearize(mul(pair, ...rest));
  }
  return t;
}

/** sin(a ± b), cos(a ± b) and integer multiples expanded into powers of sin and cos of the parts. */
export function trigExpand(e: Expr): Expr {
  if (e.k === 'n' || e.k === 's') return e;
  const m = mapChildren(e, trigExpand);
  if ((isFn(m, 'sin') || isFn(m, 'cos') || isFn(m, 'tan')) && m.a.length === 1) {
    const u = m.a[0];
    if (m.n === 'tan') return trigExpand(div(fn('sin', u), fn('cos', u)));
    // integer multiple: (cos x + i sin x)^n
    const [c, rest] = split(u);
    if (u.k !== '+' && qint(c) && c.n > 1n && c.n <= 20n) {
      const z = expand(pow(add(fn('cos', rest), mul(I, fn('sin', rest))), num(c.n)));
      const parts = complexParts(z);
      if (parts) return m.n === 'cos' ? parts[0] : parts[1];
    }
    if (u.k === '+') {
      const a = u.t[0], b = add(...u.t.slice(1));
      const sa = trigExpand(fn('sin', a)), ca = trigExpand(fn('cos', a)), sb = trigExpand(fn('sin', b)), cb = trigExpand(fn('cos', b));
      return expand(m.n === 'sin' ? add(mul(sa, cb), mul(ca, sb)) : sub(mul(ca, cb), mul(sa, sb)));
    }
  }
  return m;
}

/** cos²u → 1 − sin²u (and the reverse), keeping whichever comes out smaller. */
function pythagoras(e: Expr): Expr {
  const args = new Map<string, Expr>();
  const collect = (x: Expr) => { if ((isFn(x, 'sin') || isFn(x, 'cos')) && x.a.length === 1) args.set(key(x.a[0]), x.a[0]); children(x).forEach(collect); };
  collect(e);
  let best = e;
  for (const u of args.values()) {
    for (const [from, to] of [['cos', 'sin'], ['sin', 'cos']] as const) {
      const cand = expand(replaceSquares(e, from, to, u));
      if (size(cand) < size(best)) best = cand;
    }
  }
  return best;
}
function replaceSquares(e: Expr, from: 'sin' | 'cos', to: 'sin' | 'cos', u: Expr): Expr {
  if (e.k === '^' && isFn(e.b, from) && same(e.b.a[0], u) && isInt(e.e) && e.e.v.n >= 2n) {
    const n = e.e.v.n;
    return mul(pow(sub(ONE, pow(fn(to, u), TWO)), num(n / 2n)), pow(fn(from, u), num(n % 2n)));
  }
  if (e.k === 'n' || e.k === 's') return e;
  return mapChildren(e, c => replaceSquares(c, from, to, u));
}

/** ln(ab) = ln a + ln b, ln(a^n) = n ln a (for positive a, b). */
export function expandLog(e: Expr): Expr {
  if (e.k === 'n' || e.k === 's') return e;
  const m = mapChildren(e, expandLog);
  if (isFn(m, 'ln')) {
    const u = m.a[0];
    if (u.k === '*') return add(...u.t.map(f => expandLog(fn('ln', f))));
    if (u.k === '^') return mul(u.e, expandLog(fn('ln', u.b)));
    if (isNum(u) && u.v.d !== 1n) return sub(fn('ln', num(u.v.n)), fn('ln', num(u.v.d)));
  }
  return m;
}

/**
 * ln of every positive rational split over primes, ln 12 = 2 ln 2 + ln 3, so that ln 12 − ln 3 comes out 2 ln 2
 * (and a difference of logarithms that is 0 comes out 0). Numbers with a prime factor that isn't found stay.
 */
export function lnPrimes(e: Expr): Expr {
  if (e.k === 'n' || e.k === 's') return e;
  const m = mapChildren(e, lnPrimes);
  if (!isFn(m, 'ln') || !isNum(m.a[0]) || m.a[0].v.n <= 0n) return m;
  const { n, d } = m.a[0].v;
  const parts: Expr[] = [];
  for (const [v, sign] of [[n, 1n], [d, -1n]] as const) {
    if (v === 1n || v > 10n ** 40n) { if (v !== 1n) return m; continue; }
    const f = factorInteger(v, 20000);
    if (f.unfactored.length) return m;
    for (const [p, k] of f.factors) parts.push(mul(num(sign * BigInt(k)), fn('ln', num(p))));
  }
  return add(...parts);
}

// --- Radicals and complex denominators ---

/** 1/(a + b√k) → (a − b√k)/(a² − b²k) and 1/(a + bi) → (a − bi)/(a² + b²), anywhere in e. */
export function rationalize(e: Expr): Expr {
  if (e.k === 'n' || e.k === 's') return e;
  if (e.k === '^' && isNum(e.e) && e.e.v.n < 0n && e.e.v.d === 1n) {
    const b = rationalize(e.b);
    const inv = conjugateInverse(b);
    if (inv) return expand(pow(inv, num(-e.e.v.n)));
    return pow(b, e.e);
  }
  return mapChildren(e, rationalize);
}
function conjugateInverse(b: Expr): Expr | null {
  const ex = expand(b);
  if (ex.k !== '+') return null;
  // complex: a + bi with a, b free of i
  const parts = complexParts(ex);
  if (parts && !isZero(parts[1]) && freeOf(parts[0], 'i') && freeOf(parts[1], 'i')) {
    const [a, c] = parts;
    return div(sub(a, mul(I, c)), add(pow(a, TWO), pow(c, TWO)));
  }
  if (ex.t.length === 2) {
    const [u, v] = ex.t, u2 = expand(pow(u, TWO)), v2 = expand(pow(v, TWO));
    const hasRoot = (t: Expr) => !isNum(t) && freeOf(expand(pow(t, TWO)), 'i') && size(expand(pow(t, TWO))) < size(t);
    if ((hasRoot(u) || hasRoot(v)) && !same(u2, v2)) {
      const d = expand(sub(u2, v2));
      if (!isZero(d) && size(d) <= size(ex)) return div(sub(u, v), d);
    }
  }
  return null;
}

// --- simplify ---

/** The smallest of: as written, expanded, over a common denominator and cancelled, factored, with sin² + cos² = 1. */
export function simplify(e: Expr): Expr {
  if (e.k === 'n' || e.k === 's') return e;
  // inside out: arguments of functions first
  const inner = e.k === 'f' ? mapChildren(e, simplify) : e.k === '^' ? pow(simplify(e.b), simplify(e.e)) : e;
  const cands: Expr[] = [];
  const tryAdd = (f: () => Expr) => { try { cands.push(f()); } catch { /* a rewrite that doesn't apply */ } };
  tryAdd(() => cancel(together(inner)));
  tryAdd(() => expand(inner));
  cands.push(inner);
  tryAdd(() => pythagoras(inner));
  tryAdd(() => pythagoras(expand(inner)));
  tryAdd(() => { const f = factorExpr(inner); return f.e; });
  tryAdd(() => cancel(together(pythagoras(expand(inner)))));
  tryAdd(() => expand(rationalize(inner)));
  tryAdd(() => rationalize(inner));
  if (hasLnOfNumber(inner)) { tryAdd(() => expand(lnPrimes(inner))); tryAdd(() => cancel(together(lnPrimes(inner)))); }
  // the cheapest form that still has the value of the input: a rewrite with a bug in it is dropped, never shown
  const ranked = cands.map((c, k) => ({ c, k, w: cost(c) })).sort((a, b) => a.w - b.w || a.k - b.k);
  for (const { c } of ranked) if (c === inner || agrees(c, inner)) return c;
  return inner;
}

const hasLnOfNumber = (e: Expr): boolean => (isFn(e, 'ln') && isNum(e.a[0])) || children(e).some(hasLnOfNumber);

const SAMPLES = [0.7316, -0.4429, 1.6180, 2.3851];
/**
 * a = b at a few generic points (every variable gets its own value): doubles first, and when doubles disagree,
 * 300 bits at nearby rationals, so cancellation in a long polynomial is not taken for a difference. Points where
 * either side is undefined or not real tell nothing.
 */
export function agrees(a: Expr, b: Expr): boolean {
  if (same(a, b)) return true;
  const vs = [...new Set([...variables(a), ...variables(b)])];
  for (const [s, base] of SAMPLES.entries()) {
    const params: Record<string, number> = {};
    vs.forEach((v, k) => { params[v] = base + 0.2137 * k * (s % 2 ? -1 : 1); });
    const x = vs[0] ?? '·', t = params[x] ?? 0;
    const A = compileDouble(a, x, params)(t), B = compileDouble(b, x, params)(t);
    if (!Number.isFinite(A) || !Number.isFinite(B)) continue;
    if (Math.abs(A - B) <= 1e-9 * Math.max(1, Math.abs(A), Math.abs(B))) continue;
    if (!agreesPrecisely(a, b, vs, params)) return false;
  }
  return true;
}
function agreesPrecisely(a: Expr, b: Expr, vs: string[], params: Record<string, number>): boolean {
  const at = (e: Expr) => vs.reduce((r, v) => subst(r, v, num(q(BigInt(Math.round(params[v] * 1e4)), 10000n))), e);
  let A, B;
  try { A = evalC(at(a), 300); B = evalC(at(b), 300); } catch { return false; }
  const d = csub(A, B, 300);
  return Math.max(top(d.re), top(d.im)) <= Math.max(top(A.re), top(A.im), top(B.re), top(B.im), 0) - 200;
}

/** Size, with roots or i left in a denominator counted as clutter. */
export function cost(e: Expr): number {
  let penalty = 0;
  const visit = (x: Expr) => {
    if (x.k === '^' && isNum(x.e) && x.e.v.n < 0n && hasRootOrI(x.b)) penalty += 4;
    children(x).forEach(visit);
  };
  visit(e);
  return size(e) + penalty;
}
const hasRootOrI = (e: Expr): boolean => (e.k === '^' && isNum(e.e) && e.e.v.d !== 1n) || isSym(e, 'i') || children(e).some(hasRootOrI);

/** Simplified for display: like simplify(), but keeps numbers times sums distributed (x/2 + 1/2 → (x + 1)/2 only if shorter). */
export const tidy = simplify;

