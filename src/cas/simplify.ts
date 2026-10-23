/**
 * Rewriting beyond the automatic canonical form: cancelling rational functions, factoring expressions,
 * trigonometric identities, and simplify(), which keeps the smallest of the equivalent forms it tries.
 */
import { Expr, I, ONE, TWO, add, children, div, expand, fn, freeOf, isFn, isNum, isZero, mapChildren, mul, num, numDen, pow, same, size, sub, sym, together, variables, isSym, split, isInt, key } from './expr';
import { complexParts } from './functions';
import { P, factorPoly, fromInts, pdivmod, pgcd, polyOf, polyToExpr, primitive, deg } from './poly';
import { Q, Q1, gcd, qdiv, q, qeq, qint } from './q';

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
function linearizeTerm(t: Expr): Expr {
  const factors: Expr[] = [];
  for (const f of t.k === '*' ? t.t : [t]) {
    if (f.k === '^' && (isFn(f.b, 'sin') || isFn(f.b, 'cos')) && isInt(f.e) && f.e.v.n > 1n && f.e.v.n <= 40n) {
      for (let k = 0n; k < f.e.v.n; k++) factors.push(f.b);
    } else factors.push(f);
  }
  const trig = factors.filter(f => isFn(f, 'sin') || isFn(f, 'cos'));
  if (trig.length < 2) return t;
  const others = factors.filter(f => !(isFn(f, 'sin') || isFn(f, 'cos')));
  const [A, B] = trig as [Expr & { n: string; a: Expr[] }, Expr & { n: string; a: Expr[] }];
  const a = A.a[0], b = B.a[0];
  let pair: Expr;
  if (A.n === 'sin' && B.n === 'sin') pair = mul(num(1, 2), sub(fn('cos', sub(a, b)), fn('cos', add(a, b))));
  else if (A.n === 'cos' && B.n === 'cos') pair = mul(num(1, 2), add(fn('cos', sub(a, b)), fn('cos', add(a, b))));
  else {
    const [s, c] = A.n === 'sin' ? [a, b] : [b, a];
    pair = mul(num(1, 2), add(fn('sin', add(s, c)), fn('sin', sub(s, c))));
  }
  return trigLinearize(mul(pair, ...trig.slice(2), ...others));
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
  let best = cands[0];
  for (const c of cands.slice(1)) if (cost(c) < cost(best)) best = c;
  return best;
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

