/**
 * Antiderivatives: a table with linear inner arguments, polynomials, rational functions by partial fractions,
 * √(quadratic), substitution (derivative-divides), integration by parts (LIATE) and product-to-sum for
 * trigonometric products. Every antiderivative is checked by differentiating it and comparing numerically
 * at several points; one that fails the check is discarded, never shown.
 */
import { diff, limit, Lim } from './calculus';
import { E, Expr, HALF, MINUS_ONE, ONE, PI, TWO, ZERO, add, div, expand, fn, freeOf, infSign, isConstant, isFn, isNum, isSym, isZero, mul, neg, num, numDen, pow, same, size, sqrt, sub, subst, sym, together, variables, isInt, isInf, children, key, mapChildren } from './expr';
import { compileDouble } from './fast';
import { approx, csub, evalC } from './numeric';
import { P, coeffsOf, factorPoly, fromInts, pdivmod, pmul, polyOf, polyToExpr, ppow, solvePoly } from './poly';
import { solveQ } from './matrix';
import { cancel, trigLinearize } from './simplify';
import { CasError, Q, Q0, fail, q, qdiv, qmul, qneg, qsign, qsub, qToNumber } from './q';
import { bfToNumber, top } from './bigfloat';

const U = 'ū'; // substitution variable, can't clash with input

/** a·x + b with a, b free of x and a ≠ 0, or null. */
function linear(u: Expr, x: string): [Expr, Expr] | null {
  const c = coeffsOf(u, x, 2);
  if (!c || c.length !== 2 || isZero(c[1])) return null;
  return [c[1], c[0]];
}

/** ∫ e dx, verified; null when no method here finds it. */
export function integrate(e: Expr, x: string): Expr | null {
  const F = int(e, x, 0);
  if (!F) return null;
  return verify(F, e, x) ? F : null;
}

/** d/dx F − f vanishes at test points (other variables get fixed generic values). */
export function verify(F: Expr, f: Expr, x: string): boolean {
  let dF: Expr;
  try { dF = diff(F, x); } catch { return false; }
  const params: Record<string, number> = {};
  variables(add(F, f)).forEach((v, k) => { if (v !== x) params[v] = 1.37 + 0.61 * k; });
  const g = compileDouble(dF, x, params), h = compileDouble(f, x, params);
  let good = 0;
  for (const t of [0.3711, 1.2398, -0.7123, 2.913, -1.618, 0.0517, 4.31, -3.17, 0.83, 7.7]) {
    const a = g(t), b = h(t);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    // doubles lose everything to cancellation in a long expanded polynomial: then decide at 400 bits
    if (Math.abs(a - b) > 1e-7 * Math.max(1, Math.abs(b))) return verifyPrecise(dF, f, x, Object.keys(params));
    good++;
  }
  return good >= 3;
}
function verifyPrecise(dF: Expr, f: Expr, x: string, others: string[]): boolean {
  const at = (e: Expr, t: Expr) => others.reduce((r, v, k) => subst(r, v, num(q(BigInt(137 + 61 * k), 100n))), subst(e, x, t));
  let good = 0;
  for (const t of [q(3711n, 10000n), q(-7123n, 10000n), q(2913n, 1000n), q(-317n, 100n), q(77n, 10n)]) {
    let a, b;
    try { a = evalC(at(dF, num(t)), 400); b = evalC(at(f, num(t)), 400); } catch { continue; }
    const d = csub(a, b, 400);
    if (Math.max(top(d.re), top(d.im)) > Math.max(top(b.re), top(b.im), 0) - 200) return false;
    good++;
  }
  return good >= 3;
}

function int(f: Expr, x: string, depth: number): Expr | null {
  if (depth > 7) return null;
  if (freeOf(f, x)) return mul(f, sym(x));
  if (f.k === '+') {
    const parts = f.t.map(t => int(t, x, depth + 1));
    if (parts.every(Boolean)) return add(...(parts as Expr[]));
    return others(f, x, depth);
  }
  // constant factor out
  if (f.k === '*') {
    const c = f.t.filter(t => freeOf(t, x)), g = f.t.filter(t => !freeOf(t, x));
    if (c.length) {
      const G = int(mul(...g), x, depth);
      return G ? mul(...c, G) : null;
    }
  }
  return table(f, x) ?? others(f, x, depth);
}

function others(f: Expr, x: string, depth: number): Expr | null {
  return polynomial(f, x)
    ?? rational(f, x)
    ?? sqrtQuadratic(f, x)
    ?? gaussian(f, x)
    ?? expTrig(f, x)
    ?? substitution(f, x, depth)
    ?? byParts(f, x, depth)
    ?? rewrites(f, x, depth);
}

// --- Table ---

function table(f: Expr, x: string): Expr | null {
  const X = sym(x);
  if (isSym(f, x)) return mul(HALF, pow(X, TWO));
  if (f.k === '^') {
    const lin = linear(f.b, x);
    if (lin && freeOf(f.e, x)) {
      const [a] = lin;
      if (isNum(f.e) && f.e.v.n === -1n && f.e.v.d === 1n) return div(fn('ln', fn('abs', f.b)), a);
      return div(pow(f.b, add(f.e, ONE)), mul(a, add(f.e, ONE)));
    }
    const le = linear(f.e, x);
    if (le && freeOf(f.b, x)) {
      const [a] = le;
      if (isSym(f.b, 'e')) return div(f, a);
      return div(f, mul(a, fn('ln', f.b)));
    }
    // 1/cos(u), 1/sin(u), 1/cosh(u), 1/sinh(u)
    if (isNum(f.e) && f.e.v.n === -1n && f.e.v.d === 1n && f.b.k === 'f' && f.b.a.length === 1) {
      const l = linear(f.b.a[0], x);
      if (l) {
        const u = f.b.a[0], [a] = l;
        switch (f.b.n) {
          case 'cos': return div(fn('ln', fn('abs', add(fn('sec', u), fn('tan', u)))), a);
          case 'sin': return neg(div(fn('ln', fn('abs', add(fn('csc', u), fn('cot', u)))), a));
          case 'cosh': return div(mul(TWO, fn('atan', pow(E, u))), a);
          case 'sinh': return div(fn('ln', fn('abs', fn('tanh', mul(HALF, u)))), a);
        }
      }
    }
    // 1/cos²u, 1/sin²u, 1/cosh²u, 1/sinh²u
    if (isNum(f.e) && f.e.v.n === -2n && f.e.v.d === 1n && f.b.k === 'f' && f.b.a.length === 1) {
      const l = linear(f.b.a[0], x);
      if (l) {
        const u = f.b.a[0], [a] = l;
        switch (f.b.n) {
          case 'cos': return div(fn('tan', u), a);
          case 'sin': return neg(div(fn('cot', u), a));
          case 'cosh': return div(fn('tanh', u), a);
          case 'sinh': return neg(div(fn('coth', u), a));
        }
      }
    }
    // 1/cosⁿu, 1/sinⁿu for n ≥ 3, by reduction to n − 2:
    // ∫cos⁻ⁿu = sin u·cos¹⁻ⁿu/((n − 1)a) + (n − 2)/(n − 1)·∫cos²⁻ⁿu, and the same with −cos u for sin
    if (isInt(f.e) && f.e.v.n <= -3n && f.e.v.n >= -40n && f.b.k === 'f' && (f.b.n === 'cos' || f.b.n === 'sin') && f.b.a.length === 1) {
      const l = linear(f.b.a[0], x);
      const lower = l && table(pow(f.b, num(f.e.v.n + 2n)), x);
      if (l && lower) {
        const u = f.b.a[0], [a] = l, n = -f.e.v.n, other = f.b.n === 'cos' ? fn('sin', u) : neg(fn('cos', u));
        return add(div(mul(other, pow(f.b, num(1n - n))), mul(num(n - 1n), a)), mul(num(q(n - 2n, n - 1n)), lower));
      }
    }
    return null;
  }
  if (f.k === 'f' && f.a.length === 1) {
    const u = f.a[0], l = linear(u, x);
    if (!l) return null;
    const [a] = l;
    const F = (() => {
      switch (f.n) {
        case 'sin': return neg(fn('cos', u));
        case 'cos': return fn('sin', u);
        case 'tan': return neg(fn('ln', fn('abs', fn('cos', u))));
        case 'cot': return fn('ln', fn('abs', fn('sin', u)));
        case 'sec': return fn('ln', fn('abs', add(fn('sec', u), fn('tan', u))));
        case 'csc': return neg(fn('ln', fn('abs', add(fn('csc', u), fn('cot', u)))));
        case 'sinh': return fn('cosh', u);
        case 'cosh': return fn('sinh', u);
        case 'tanh': return fn('ln', fn('cosh', u));
        case 'coth': return fn('ln', fn('abs', fn('sinh', u)));
        case 'ln': return sub(mul(u, fn('ln', u)), u);
        case 'asin': return add(mul(u, fn('asin', u)), sqrt(sub(ONE, pow(u, TWO))));
        case 'acos': return sub(mul(u, fn('acos', u)), sqrt(sub(ONE, pow(u, TWO))));
        case 'atan': return sub(mul(u, fn('atan', u)), mul(HALF, fn('ln', add(ONE, pow(u, TWO)))));
        case 'acot': return add(mul(u, fn('acot', u)), mul(HALF, fn('ln', add(ONE, pow(u, TWO)))));
        case 'asinh': return sub(mul(u, fn('asinh', u)), sqrt(add(pow(u, TWO), ONE)));
        case 'acosh': return sub(mul(u, fn('acosh', u)), mul(sqrt(sub(u, ONE)), sqrt(add(u, ONE))));
        case 'atanh': return add(mul(u, fn('atanh', u)), mul(HALF, fn('ln', sub(ONE, pow(u, TWO)))));
        case 'erf': return add(mul(u, fn('erf', u)), div(pow(E, neg(pow(u, TWO))), sqrt(PI)));
        case 'abs': return mul(HALF, u, fn('abs', u));
        case 'sign': return fn('abs', u);
      }
      return null;
    })();
    return F ? div(F, a) : null;
  }
  return null;
}

// --- Polynomials and rational functions ---

function polynomial(f: Expr, x: string): Expr | null {
  const c = coeffsOf(f, x, 2000);
  if (!c) return null;
  const X = sym(x);
  return add(...c.map((k, i) => mul(k, pow(X, num(i + 1)), num(1, i + 1))));
}

/** Partial fractions over ℚ with linear and quadratic factors of the denominator. */
export function partialFractions(Np: P, Dp: P): { poly: P; terms: { factor: bigint[]; power: number; num: P }[]; content: Q } | null {
  const [quot, rem] = pdivmod(Np, Dp);
  const fac = factorPoly(Dp);
  if (!fac.complete || fac.factors.some(([g]) => g.length > 3)) return null;
  const terms: { factor: bigint[]; power: number; num: P }[] = [];
  if (!rem.length) return { poly: quot, terms, content: fac.content };
  // unknowns: for each factor g^m and j = 1..m, a numerator of degree < deg g
  const D = fac.factors.reduce((acc, [g, m]) => pmul(acc, ppow(fromInts(g), m)), [q(1)] as P);
  const n = D.length - 1;
  const cols: P[] = [];
  const shapes: { factor: bigint[]; power: number; k: number }[] = [];
  for (const [g, m] of fac.factors) {
    for (let j = 1; j <= m; j++) {
      const other = pdivmod(D, ppow(fromInts(g), j))[0];
      for (let k = 0; k < g.length - 1; k++) {
        cols.push(pmul(other, [...Array(k).fill(Q0), q(1)]));
        shapes.push({ factor: g, power: j, k });
      }
    }
  }
  if (cols.length !== n) return null;
  const target = rem.map(c => qdiv(c, fac.content));
  const A: Q[][] = Array.from({ length: n }, (_, row) => cols.map(col => col[row] ?? Q0));
  const b: Q[] = Array.from({ length: n }, (_, row) => target[row] ?? Q0);
  const sol = solveQ(A, b);
  if (!sol) return null;
  const byFactor = new Map<string, { factor: bigint[]; power: number; num: Q[] }>();
  shapes.forEach((s, i) => {
    const id = `${s.factor.join(',')}^${s.power}`;
    const t = byFactor.get(id) ?? { factor: s.factor, power: s.power, num: Array(s.factor.length - 1).fill(Q0) };
    t.num[s.k] = sol[i];
    byFactor.set(id, t);
  });
  for (const t of byFactor.values()) if (t.num.some(v => v.n)) terms.push(t);
  return { poly: quot, terms, content: fac.content };
}

function rational(f: Expr, x: string): Expr | null {
  const [n, d] = numDen(together(f));
  if (freeOf(d, x)) return null;
  const Np = polyOf(n, x, 200), Dp = polyOf(d, x, 200);
  if (!Np || !Dp) return null;
  const pf = partialFractions(Np, Dp);
  if (!pf) return null;
  const X = sym(x);
  const out: Expr[] = [polynomial(polyToExpr(pf.poly, X), x) ?? ZERO];
  for (const t of pf.terms) {
    const g = t.factor.map(v => q(v));
    if (g.length === 2) {
      // A/(px + r)^j
      const p = g[1], A = num(t.num[0]), L = polyToExpr(fromInts(t.factor), X);
      if (t.power === 1) out.push(mul(A, num(qdiv(q(1), p)), fn('ln', fn('abs', L))));
      else out.push(mul(A, num(qdiv(q(-1), qmul(p, q(t.power - 1)))), pow(L, num(1 - t.power))));
    } else out.push(quadraticTerm(g as [Q, Q, Q], t.num, t.power, X));
  }
  return add(...out);
}

/** ∫ (Bx + C)/(ax² + bx + c)^j dx for an irreducible quadratic with a > 0. */
function quadraticTerm([c, b, a]: [Q, Q, Q], numer: Q[], j: number, X: Expr): Expr {
  const B = numer[1] ?? Q0, C = numer[0] ?? Q0;
  const quad = add(mul(num(a), pow(X, TWO)), mul(num(b), X), num(c));
  const lin = add(mul(num(qmul(q(2), a)), X), num(b));         // 2ax + b = quad′
  // Bx + C = (B/2a)(2ax + b) + (C − Bb/2a)
  const k1 = qdiv(B, qmul(q(2), a)), k2 = qsub(C, qdiv(qmul(B, b), qmul(q(2), a)));
  const first = j === 1 ? mul(num(k1), fn('ln', quad)) : mul(num(k1), pow(quad, num(1 - j)), num(q(1, 1 - j)));
  const delta = qsub(qmul(q(4), qmul(a, c)), qmul(b, b));      // 4ac − b² > 0
  const I = (m: number): Expr => {
    if (m === 1) return mul(TWO, pow(num(delta), num(-1, 2)), fn('atan', mul(lin, pow(num(delta), num(-1, 2)))));
    // ∫ dx/Q^m = (2ax + b)/((m−1)Δ Q^(m−1)) + 2(2m−3)a/((m−1)Δ) ∫ dx/Q^(m−1)
    return add(div(lin, mul(num(m - 1), num(delta), pow(quad, num(m - 1)))), mul(num(qdiv(qmul(q(2 * (2 * m - 3)), a), qmul(q(m - 1), delta))), I(m - 1)));
  };
  return add(first, mul(num(k2), I(j)));
}

// --- √(quadratic) and Gaussian ---

function sqrtQuadratic(f: Expr, x: string): Expr | null {
  if (f.k !== '^' || !isNum(f.e) || f.e.v.d !== 2n || (f.e.v.n !== 1n && f.e.v.n !== -1n)) return null;
  const p = polyOf(f.b, x, 2);
  if (!p || p.length !== 3) return null;
  const [c, b, a] = p, X = sym(x);
  // a(u² + d/a) with u = x + b/(2a): a u² + d, d = c − b²/(4a)
  const u = add(X, num(qdiv(b, qmul(q(2), a))));
  const d = qsub(c, qdiv(qmul(b, b), qmul(q(4), a)));
  const R = sqrt(f.b), A = num(a), D = num(d);
  const sa = qsign(a), sd = qsign(d);
  if (f.e.v.n === -1n) {
    if (sa > 0) return mul(pow(A, num(-1, 2)), fn('ln', fn('abs', add(mul(sqrt(A), u), R))));
    if (sa < 0 && sd > 0) return mul(pow(neg(A), num(-1, 2)), fn('asin', mul(sqrt(neg(A)), u, pow(D, num(-1, 2)))));
    return null;
  }
  if (sa > 0) return add(mul(HALF, u, R), mul(D, pow(mul(TWO, sqrt(A)), MINUS_ONE), fn('ln', fn('abs', add(mul(sqrt(A), u), R)))));
  if (sa < 0 && sd > 0) return add(mul(HALF, u, R), mul(D, pow(mul(TWO, sqrt(neg(A))), MINUS_ONE), fn('asin', mul(sqrt(neg(A)), u, pow(D, num(-1, 2))))));
  return null;
}

/** ∫ e^(−k(ax + b)²) dx = √π/(2a√k) · erf(√k (ax + b)). */
function gaussian(f: Expr, x: string): Expr | null {
  if (f.k !== '^' || !isSym(f.b, 'e')) return null;
  const p = polyOf(f.e, x, 2);
  if (!p || p.length !== 3 || qsign(p[2]) >= 0) return null;
  const [c, b, a] = p; // a x² + b x + c = a(x + b/2a)² + c − b²/4a
  const k = qneg(a), shift = qdiv(b, qmul(q(2), a)), rest = qsub(c, qdiv(qmul(b, b), qmul(q(4), a)));
  const X = sym(x), sk = sqrt(num(k));
  return mul(pow(E, num(rest)), sqrt(PI), pow(mul(TWO, sk), MINUS_ONE), fn('erf', mul(sk, add(X, num(shift)))));
}

/** ∫ e^(au) sin(bu), ∫ e^(au) cos(bu) for linear arguments. */
function expTrig(f: Expr, x: string): Expr | null {
  if (f.k !== '*' || f.t.length !== 2) return null;
  const ex = f.t.find(t => t.k === '^' && isSym(t.b, 'e')) as (Expr & { e: Expr }) | undefined;
  const tr = f.t.find(t => isFn(t, 'sin') || isFn(t, 'cos')) as (Expr & { n: string; a: Expr[] }) | undefined;
  if (!ex || !tr) return null;
  const la = linear(ex.e, x), lb = linear(tr.a[0], x);
  if (!la || !lb) return null;
  const a = la[0], b = lb[0], v = tr.a[0];
  const den = add(pow(a, TWO), pow(b, TWO));
  const body = tr.n === 'sin' ? sub(mul(a, fn('sin', v)), mul(b, fn('cos', v))) : add(mul(a, fn('cos', v)), mul(b, fn('sin', v)));
  return div(mul(ex, body), den);
}

// --- Substitution: derivative-divides ---

function candidates(f: Expr, x: string): Expr[] {
  const out = new Map<string, Expr>();
  const visit = (e: Expr) => {
    if (freeOf(e, x)) return;
    if (e.k === 'f') { for (const a of e.a) if (!isSym(a, x)) add_(a); add_(e); }
    if (e.k === '^') {
      if (freeOf(e.e, x)) { if (!isSym(e.b, x)) add_(e.b); if (!isNum(e.e) || e.e.v.d !== 1n) add_(e); }
      else { add_(e.e); add_(e); }
    }
    children(e).forEach(visit);
  };
  const add_ = (e: Expr) => { if (!freeOf(e, x) && !isSym(e, x)) out.set(key(e), e); };
  visit(f);
  return [...out.values()].sort((a, b) => size(b) - size(a)).slice(0, 12);
}

function substitution(f: Expr, x: string, depth: number): Expr | null {
  for (const u of candidates(f, x)) {
    let du: Expr;
    try { du = diff(u, x); } catch { continue; }
    if (isZero(du)) continue;
    let ratio: Expr;
    try { ratio = cancel(together(div(f, du))); } catch { continue; }
    let r = replace(ratio, u, sym(U));
    if (!freeOf(r, x)) {
      // u = x^k (or a·x + b): substitute x itself through the inverse
      const inv = inverse(u, x);
      if (!inv) continue;
      try { r = cancel(together(subst(r, x, inv))); } catch { continue; }
      if (!freeOf(r, x)) continue;
    }
    if (same(r, f)) continue;
    const G = int(r, U, depth + 1);
    if (G) return subst(G, U, u);
  }
  return null;
}
/** Every occurrence of the subexpression u in e replaced, including powers of it: u = x², x⁴ → U². */
function replace(e: Expr, u: Expr, by: Expr): Expr {
  if (same(e, u)) return by;
  if (e.k === '^' && same(e.b, u)) return pow(by, replace(e.e, u, by));
  if (u.k === '^' && e.k === '^' && same(e.b, u.b) && isNum(e.e) && isNum(u.e)) {
    const k = qdiv(e.e.v, u.e.v);
    if (k.d === 1n) return pow(by, num(k));
  }
  if (e.k === 'n' || e.k === 's') return e;
  const m = e.k === '+' ? add(...e.t.map(t => replace(t, u, by))) : e.k === '*' ? mul(...e.t.map(t => replace(t, u, by))) : e.k === '^' ? pow(replace(e.b, u, by), replace(e.e, u, by)) : fn(e.n, ...e.a.map(a => replace(a, u, by)));
  return m;
}
/** x as a function of U when u is a·x^k + b, e^(ax), or ln x. */
function inverse(u: Expr, x: string): Expr | null {
  const Y = sym(U);
  const c = coeffsOf(u, x, 12);
  if (c && c.length >= 2) {
    const nz = c.map((v, k) => [v, k] as const).filter(([v, k]) => k > 0 && !isZero(v));
    if (nz.length === 1) {
      const [a, k] = nz[0];
      return pow(div(sub(Y, c[0]), a), num(1, k));
    }
  }
  if (u.k === '^' && isSym(u.b, 'e')) { const l = linear(u.e, x); if (l) return div(sub(fn('ln', Y), l[1]), l[0]); }
  if (isFn(u, 'ln') && isSym(u.a[0], x)) return pow(E, Y);
  return null;
}

// --- Integration by parts (LIATE) ---

function rank(f: Expr, x: string): number {
  if (isFn(f, 'ln') || isFn(f, 'log')) return 0;
  if (f.k === '^' && isFn(f.b, 'ln')) return 0;
  if (isFn(f) && ['asin', 'acos', 'atan', 'acot', 'asinh', 'acosh', 'atanh'].includes(f.n)) return 1;
  if (coeffsOf(f, x, 50)) return 2;
  if (isFn(f) && ['sin', 'cos', 'sinh', 'cosh'].includes(f.n)) return 3;
  if (f.k === '^' && freeOf(f.b, x)) return 4;
  return 5;
}
function byParts(f: Expr, x: string, depth: number): Expr | null {
  if (depth > 5) return null;
  const factors = f.k === '*' ? f.t : [f];
  // u = the LIATE-first factor (alone: ln x = ln x · 1)
  const sorted = [...factors].sort((a, b) => rank(a, x) - rank(b, x));
  const u = sorted[0];
  if (rank(u, x) >= 3 && factors.length < 2) return null;
  if (factors.length === 1 && rank(u, x) > 1) return null;
  const dv = factors.length === 1 ? ONE : mul(...factors.filter(t => t !== u));
  if (rank(u, x) === 2 && factors.length === 1) return null;
  const v = int(dv, x, depth + 1);
  if (!v) return null;
  let du: Expr;
  try { du = diff(u, x); } catch { return null; }
  const rest = int(cancel(together(mul(v, du))), x, depth + 1) ?? int(expand(mul(v, du)), x, depth + 1);
  if (!rest) return null;
  return sub(mul(u, v), rest);
}

// --- Rewrites: products of trigonometric functions, tan², expansion ---

function rewrites(f: Expr, x: string, depth: number): Expr | null {
  if (depth > 6) return null;
  const tries: (() => Expr)[] = [
    () => toSinCos(f),
    () => trigLinearize(f),
    () => replaceTanSquared(f),
    () => expand(f),
    () => cancel(together(f)),
  ];
  for (const t of tries) {
    let g: Expr;
    try { g = t(); } catch { continue; }
    if (same(g, f)) continue;
    const G = int(g, x, depth + 2);
    if (G) return G;
  }
  return null;
}
function toSinCos(e: Expr): Expr {
  if (e.k === 'n' || e.k === 's') return e;
  const m = mapChildren(e, toSinCos);
  if (isFn(m, 'sec')) return pow(fn('cos', m.a[0]), MINUS_ONE);
  if (isFn(m, 'csc')) return pow(fn('sin', m.a[0]), MINUS_ONE);
  if (isFn(m, 'cot')) return div(fn('cos', m.a[0]), fn('sin', m.a[0]));
  return m;
}
function replaceTanSquared(e: Expr): Expr {
  if (e.k === '^' && isFn(e.b, 'tan') && isInt(e.e) && e.e.v.n >= 2n) {
    const u = e.b.a[0], n = e.e.v.n;
    return expand(mul(pow(fn('tan', u), num(n - 2n)), sub(pow(fn('cos', u), num(-2)), ONE)));
  }
  if (e.k === 'n' || e.k === 's') return e;
  return mapChildren(e, replaceTanSquared);
}

// --- Definite integrals ---

export interface Definite {
  exact: Expr | null;
  /** Numeric value with its estimated absolute error, or null when quadrature failed. */
  numeric: { value: number; error: number } | null;
  divergent: 0 | 1 | -1 | 'yes';
  antiderivative: Expr | null;
  note?: string;
}

export function definite(f: Expr, x: string, a: Expr, b: Expr): Definite {
  const F = integrate(f, x);
  const sa = infSign(a), sb = infSign(b);
  const A = sa ? sa * Infinity : qOrNum(a), B = sb ? sb * Infinity : qOrNum(b);
  if (!Number.isFinite(A) && !sa || !Number.isFinite(B) && !sb) fail('Granice całkowania muszą być liczbami (albo ±∞).');
  let flip = 1;
  let lo = a, hi = b, LO = A, HI = B;
  if (A > B) { [lo, hi, LO, HI] = [b, a, B, A]; flip = -1; }
  if (A === B) return { exact: ZERO, numeric: { value: 0, error: 0 }, divergent: 0, antiderivative: F };
  // interior points where f blows up or is undefined: zeros of denominators, in (lo, hi)
  const cuts = singularPoints(f, x, LO, HI);
  const g = compileDouble(f, x);
  const pieces: [Expr, Expr, number, number][] = [];
  const pts: [Expr, number][] = [[lo, LO], ...cuts, [hi, HI]];
  for (let k = 0; k + 1 < pts.length; k++) pieces.push([pts[k][0], pts[k + 1][0], pts[k][1], pts[k + 1][1]]);
  // numeric
  let numeric: { value: number; error: number } | null = { value: 0, error: 0 };
  for (const [, , p, r] of pieces) {
    const res = quad(g, p, r);
    if (!res || !numeric) { numeric = null; continue; }
    numeric = { value: numeric.value + res.value, error: numeric.error + res.error };
  }
  // exact from the antiderivative, with one-sided limits at every end
  let exact: Expr | null = null, divergent: Definite['divergent'] = 0;
  if (F) {
    const parts: Expr[] = [];
    let ok = true;
    const signs: number[] = [];
    for (const [p, r] of pieces) {
      const right = endValue(F, x, r, -1), left = endValue(F, x, p, 1);
      if (!right || !left) { ok = false; continue; }
      if (right.kind === 'inf' || left.kind === 'inf') {
        const s = (right.kind === 'inf' ? right.s : 0) - (left.kind === 'inf' ? left.s : 0);
        signs.push(s > 0 ? 1 : s < 0 ? -1 : 0);
        ok = false;
        continue;
      }
      if (right.kind !== 'fin' || left.kind !== 'fin') { ok = false; continue; }
      parts.push(sub(right.v, left.v));
    }
    // one piece diverging decides it; pieces diverging to opposite infinities have no sum at all
    if (signs.length) divergent = signs.every(s => s === 1) ? 1 : signs.every(s => s === -1) ? -1 : 'yes';
    if (ok) exact = mul(num(flip), add(...parts));
    if (divergent && typeof divergent === 'number') divergent = (divergent * flip) as 1 | -1;
  }
  if (numeric) numeric = { value: numeric.value * flip, error: numeric.error };
  // the two must agree; an exact value the quadrature contradicts is dropped
  let note: string | undefined;
  if (exact && numeric && isConstant(exact)) {
    const v = approx(exact).re;
    const tol = Math.max(1e-6 * Math.abs(v), 50 * numeric.error, 1e-9);
    if (!(Math.abs(v - numeric.value) <= tol)) { note = 'Wartość z funkcji pierwotnej nie zgadza się z całkowaniem numerycznym, więc jej nie podaję.'; exact = null; }
  }
  if (divergent && numeric && Math.abs(numeric.value) < 1e6 && numeric.error < 1e-3 * Math.max(1, Math.abs(numeric.value))) {
    // the quadrature converged although the antiderivative's limit is infinite: something is off; show neither as certain
    note = 'Nie udało się rozstrzygnąć zbieżności.';
    divergent = 0;
    numeric = null;
  }
  return { exact, numeric: divergent ? null : numeric, divergent, antiderivative: F, note };
}
function qOrNum(e: Expr): number {
  if (!isConstant(e)) return NaN;
  const v = approx(e);
  return Math.abs(v.im) > 1e-12 ? NaN : v.re;
}
function endValue(F: Expr, x: string, at: Expr, dir: 1 | -1): Lim | null {
  if (isInf(at)) return limit(F, x, at);
  try {
    const v = subst(F, x, at);
    if (isConstant(v) && Number.isFinite(approx(v).re)) return { kind: 'fin', v };
  } catch (err) { if (!(err instanceof CasError)) throw err; }
  return limit(F, x, at, dir);
}

/** Real zeros of the denominator (and of ln / root arguments' boundaries) strictly inside (lo, hi). */
function singularPoints(f: Expr, x: string, lo: number, hi: number): [Expr, number][] {
  const out: [Expr, number][] = [];
  const dens: Expr[] = [];
  const visit = (e: Expr) => {
    if (e.k === '^' && isNum(e.e) && qsign(e.e.v) < 0) dens.push(e.b);
    if (isFn(e, 'tan') || isFn(e, 'sec')) dens.push(fn('cos', e.a[0]));
    if (isFn(e, 'cot') || isFn(e, 'csc')) dens.push(fn('sin', e.a[0]));
    if (isFn(e, 'ln')) dens.push(e.a[0]);
    children(e).forEach(visit);
  };
  visit(f);
  for (const d of dens) {
    const p = polyOf(d, x, 40);
    if (p) {
      for (const r of solvePoly(p)) {
        if (r.approx.im.m) continue;
        const v = bfToNumber(r.approx.re);
        if (v > lo && v < hi && !out.some(([, w]) => Math.abs(w - v) < 1e-12)) out.push([r.exact ?? num(qFromNumber(v)), v]);
      }
    } else {
      // sin/cos of a linear argument: zeros are periodic; collect those inside
      const l = (isFn(d, 'sin') || isFn(d, 'cos')) ? linear(d.a[0], x) : null;
      if (l && isNum(l[0]) && isNum(l[1])) {
        const a = qToNumber((l[0] as { v: Q }).v), b0 = qToNumber((l[1] as { v: Q }).v);
        const off = isFn(d, 'cos') ? 0.5 : 0;
        for (let k = Math.ceil(((Math.min(a * lo, a * hi) + 0) - b0) / Math.PI - off) - 1; k <= Math.floor((Math.max(a * lo, a * hi) - b0) / Math.PI - off) + 1; k++) {
          const v = ((k + off) * Math.PI - b0) / a;
          if (v > lo && v < hi && !out.some(([, w]) => Math.abs(w - v) < 1e-12)) {
            out.push([div(sub(mul(num(q(BigInt(2 * k + (off ? 1 : 0)), 2n)), PI), l[1]), l[0]), v]);
          }
        }
      }
    }
  }
  return out.sort((p, r) => p[1] - r[1]);
}
const qFromNumber = (v: number): Q => { let d = 1n, x = v; while (!Number.isInteger(x) && d < 1n << 60n) { x *= 2; d *= 2n; } return q(BigInt(Math.round(x)), d); };

// --- Adaptive Gauss–Kronrod (7–15) ---

const XK = [0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926, 0.741531185599394439863864773280788,
  0.586087235467691130294144845693013, 0.405845151377397166906606412076961, 0.207784955007898467600689403773245, 0];
const WK = [0.022935322010529224963732008058970, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518, 0.140653259715525918745189590510238,
  0.169004726639267902826583426598550, 0.190350578064785409913256402421014, 0.204432940075298892414161999234649, 0.209482141084727828012999174891714];
const WG = [0.129484966168869693270611432679082, 0.279705391489276667901467771423780, 0.381830050505118944950369775488975, 0.417959183673469387755102040816327];

function gk15(f: (t: number) => number, a: number, b: number): [number, number] {
  const c = (a + b) / 2, h = (b - a) / 2;
  const fc = f(c);
  let k = fc * WK[7], g = fc * WG[3];
  for (let j = 0; j < 7; j++) {
    const d = h * XK[j], f1 = f(c - d), f2 = f(c + d);
    k += WK[j] * (f1 + f2);
    if (j % 2 === 1) g += WG[(j - 1) / 2] * (f1 + f2);
  }
  return [k * h, Math.abs((k - g) * h)];
}

/** ∫ f over (a, b), ends may be infinite. Null when the integrand isn't finite or the error won't come down. */
export function quad(f: (t: number) => number, a: number, b: number): { value: number; error: number } | null {
  let g = f, lo = a, hi = b;
  if (!Number.isFinite(a) && !Number.isFinite(b)) { g = t => { const s = 1 - t * t; return f(t / s) * (1 + t * t) / (s * s); }; lo = -1; hi = 1; }
  else if (!Number.isFinite(b)) { g = t => f(a + t / (1 - t)) / ((1 - t) * (1 - t)); lo = 0; hi = 1; }
  else if (!Number.isFinite(a)) { g = t => f(b - (1 - t) / t) / (t * t); lo = 0; hi = 1; }
  const safe = (t: number) => { const v = g(t); return v; };
  type Seg = { a: number; b: number; v: number; e: number };
  const first = gk15(safe, lo, hi);
  const segs: Seg[] = [{ a: lo, b: hi, v: first[0], e: first[1] }];
  const sumSegs = (): [number, number, number] => {
    let total = 0, c = 0, err = 0, worst = 0;
    segs.forEach((s, k) => {
      const y = total + s.v;
      c += Math.abs(total) >= Math.abs(s.v) ? (total - y) + s.v : (s.v - y) + total;
      total = y;
      err += s.e;
      if (s.e > segs[worst].e) worst = k;
    });
    return [total + c, err, worst];
  };
  for (let it = 0; it < 3000; it++) {
    const [total, err, worst] = sumSegs();
    if (!Number.isFinite(total) || !Number.isFinite(err)) return null;
    if (err <= Math.max(1e-14, 1e-12 * Math.abs(total))) return { value: total, error: err };
    const s = segs[worst], m = (s.a + s.b) / 2;
    if (m === s.a || m === s.b) return err < 1e-6 * Math.max(1, Math.abs(total)) ? { value: total, error: err } : null;
    const l = gk15(safe, s.a, m), r = gk15(safe, m, s.b);
    segs.splice(worst, 1, { a: s.a, b: m, v: l[0], e: l[1] }, { a: m, b: s.b, v: r[0], e: r[1] });
  }
  const [total, err] = sumSegs();
  return err < 1e-6 * Math.max(1, Math.abs(total)) ? { value: total, error: err } : null;
}

