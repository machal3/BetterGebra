/**
 * Equations, systems and inequalities in one or more real or complex unknowns. Polynomials are solved exactly
 * where a closed form exists (else to many digits); other equations by isolating the unknown (with the integer
 * families of periodic solutions) or by substituting a single kernel such as eˣ or sin x. Every solution is
 * substituted back and checked numerically; one that fails (an extraneous root of squaring, outside the domain)
 * is dropped.
 */
import {
  E, Expr, MINUS_ONE, ONE, PI, TWO, ZERO, add, children, div, expand, fn, freeOf, isConstant, isFn, isInt, isNum, isSym, isZero, mul, neg, num,
  mapChildren, numDen, pow, same, sqrt, sub, subst, sym, together, key, variables,
} from './expr';
import { compileDouble } from './fast';
import { approx, evalC, C } from './numeric';
import { coeffsOf, solvePoly } from './poly';
import { cancel, expandLog, factorExpr, simplify, trigExpand } from './simplify';
import { constSign } from './functions';
import { det, rref, nonzero } from './matrix';
import { CasError, Q, fail, q, qsign } from './q';
import { BZERO, bfDiv, bfFromNumber, bfSub, bfToNumber, top } from './bigfloat';
import { diff } from './calculus';

export interface Sol {
  exact: Expr | null;
  approx: C | null;
  mult: number;
  /** Contains the integer parameter k (a family of solutions). */
  family: boolean;
  /** Family members that are not solutions (x = kπ, k ≠ 0 for sin x / x = 0). */
  excludeK?: bigint[];
}
export type SolveResult =
  | { kind: 'list'; sols: Sol[]; note?: string; numericRange?: [number, number] }
  | { kind: 'all'; note?: string }
  | { kind: 'none'; note?: string };

export const K = sym('k');

const approxOf = (e: Expr): C | null => {
  if (!isConstant(e) || !freeOf(e, 'k')) return null;
  try { return evalC(e, 200); } catch { return null; }
};
const isRealC = (z: C) => !z.im.m || top(z.im) < Math.max(top(z.re), 0) - 150;

/** f = 0 for x. complex: also complex solutions of polynomials (always for polynomial equations). */
export function solveEquation(f: Expr, x: string): SolveResult {
  const t = cancel(together(f));
  if (isZero(t) || isZero(expand(t))) return { kind: 'all' };
  if (freeOf(t, x)) return { kind: 'none' };
  const [N, D] = numDen(t);
  let sols: Sol[] | null = null, note: string | undefined, numericRange: [number, number] | undefined;
  // polynomial in x
  // ponytail: exact and numeric roots up to degree 60 (~1 s); above, the root refinement alone runs past the time limit
  let coeffs = coeffsOf(N, x, 60), zeroMult = 0;
  if (!coeffs) {
    // x²⁰⁰, x¹⁹⁹·(x − 1): the power of x comes out as the root 0, what is left may be of low degree
    const all = coeffsOf(N, x, 10000);
    const k = all?.findIndex(c => !isZero(c)) ?? -1;
    if (all && k > 0 && all.every(isNum) && all.length - 1 - k <= 60) { zeroMult = k; coeffs = all.slice(k); }
  }
  if (coeffs) {
    if (coeffs.every(isNum)) {
      const p = coeffs.map(c => (c as { v: Q }).v);
      sols = solvePoly(p).map(r => ({ exact: r.exact, approx: r.approx, mult: r.mult, family: false }));
      if (zeroMult) {
        // in order: after the negative real roots, before the positive ones and the complex ones
        const at = sols.findIndex(r => !!r.approx && (!isRealC(r.approx) || bfToNumber(r.approx.re) > 0));
        sols.splice(at < 0 ? sols.length : at, 0, { exact: ZERO, approx: { re: BZERO, im: BZERO }, mult: zeroMult, family: false });
      }
    } else {
      sols = symbolicPoly(coeffs);
      // "no solutions" would be a false answer: it is only that this method doesn't reach them
      if (!sols) return fail('Wielomian stopnia powyżej 2 z parametrami: nie umiem go rozwiązać.');
      const lead = coeffs[coeffs.length - 1];
      if ((coeffs.length === 2 || coeffs.length === 3) && !isNum(lead)) note = `Przy założeniu, że ${textOf(lead)} ≠ 0.`;
    }
  } else {
    sols = transcendental(N, x);
    if (!sols) {
      // with parameters there is nothing to evaluate numerically: finding nothing wouldn't mean there is nothing
      if (variables(N).some(v => v !== x)) {
        fail('Nie umiem rozwiązać tego równania dokładnie, a z parametrami nie da się go rozwiązać numerycznie.');
      }
      const r = numericReal(N, x, -50, 50);
      sols = r;
      numericRange = [-50, 50];
      note = 'Nie znalazłem rozwiązania dokładnego; poniżej rozwiązania rzeczywiste znalezione numerycznie w przedziale ⟨−50; 50⟩ (mogą istnieć inne).';
    }
  }
  // drop what isn't a solution of the original equation (zeros of the denominator, extraneous roots)
  const checked = sols.filter(s => checkSolution(f, x, s, D));
  if (!checked.length) return { kind: 'none', note };
  return { kind: 'list', sols: dedupe(checked), note, numericRange };
}
const textOf = (e: Expr) => key(e);

function dedupe(sols: Sol[]): Sol[] {
  const out: Sol[] = [];
  for (const s of sols) {
    const same_ = out.find(o => (o.exact && s.exact && same(o.exact, s.exact)) || (!o.family && !s.family && o.approx && s.approx && closeC(o.approx, s.approx)));
    if (same_) { same_.mult = Math.max(same_.mult, s.mult); if (!same_.exact && s.exact) same_.exact = s.exact; continue; }
    out.push(s);
  }
  return out;
}
const closeC = (a: C, b: C) => {
  const dr = Math.abs(bfToNumber(a.re) - bfToNumber(b.re)), di = Math.abs(bfToNumber(a.im) - bfToNumber(b.im));
  const m = Math.max(1, Math.hypot(bfToNumber(a.re), bfToNumber(a.im)));
  return dr + di < 1e-12 * m;
};

/**
 * The solution makes the original f vanish and doesn't zero the denominator. A family is tested at k = −6…6: when
 * only odd (even) k work it becomes x(2k + 1) (x(2k)); one or two members that fail (sin x / x = 0 at k = 0,
 * sin x / (x − π) = 0 at k = 1) are left out of it; more failures reject it.
 */
function checkSolution(f: Expr, x: string, s: Sol, D: Expr): boolean {
  if (s.exact && s.family) {
    const failing = (e: Expr, ks: number[]) =>
      ks.filter(k => !checkSolution(f, x, { ...s, exact: subst(e, 'k', num(k)), family: false }, D));
    const ks = Array.from({ length: 13 }, (_, j) => j - 6);
    let e = s.exact, bad = failing(e, ks);
    const odd = (k: number) => Math.abs(k) % 2 === 1;
    if (bad.length > 2) {
      if (ks.filter(odd).every(k => !bad.includes(k))) e = subst(e, 'k', add(mul(TWO, K), ONE));
      else if (ks.filter(k => !odd(k) && k !== 0).every(k => !bad.includes(k))) e = subst(e, 'k', mul(TWO, K));
      else return false;
      bad = failing(e, ks.filter(k => Math.abs(k) <= 3));
      if (bad.length > 2) return false;
    }
    s.exact = e;
    s.approx = approxOf(e);
    if (bad.length) s.excludeK = bad.map(BigInt);
    return true;
  }
  const values: Expr[] = [];
  if (s.exact) values.push(s.exact);
  if (!values.length && s.approx) return checkNumeric(f, x, s.approx, D);
  for (const v of values) {
    if (!isConstant(v)) continue; // symbolic parameters: can't test here
    let z: C, zd: C;
    try {
      z = evalC(subst(f, x, v), 300);
      zd = evalC(subst(D, x, v), 300);
    } catch (err) { if (err instanceof CasError) return false; throw err; }
    if (!zd.re.m && !zd.im.m) return false;
    const mag = Math.max(top(z.re), top(z.im));
    if (mag > -200 + scaleOf(f, x, v)) return false;
  }
  return true;
}
/** Typical size of the terms of f at x = v, as a power of two, so a cancellation-limited zero isn't rejected. */
function scaleOf(f: Expr, x: string, v: Expr): number {
  const terms = f.k === '+' ? f.t : [f];
  let m = 0;
  for (const t of terms) { try { const z = evalC(subst(t, x, v), 120); m = Math.max(m, top(z.re), top(z.im)); } catch { /* skip */ } }
  return Math.max(0, m);
}
function checkNumeric(f: Expr, x: string, z: C, D: Expr): boolean {
  const g = compileDouble(f, x), d = compileDouble(D, x);
  if (z.im.m && top(z.im) > -100) return true; // complex root of a polynomial: refined already
  const v = bfToNumber(z.re), r = g(v);
  if (Number.isNaN(r)) return false;
  return Math.abs(r) < 1e-6 * Math.max(1, Math.abs(v)) && d(v) !== 0;
}

/** a₀ + a₁x (+ a₂x²) = 0 with symbolic coefficients. */
function symbolicPoly(c: Expr[]): Sol[] | null {
  const mk = (e: Expr): Sol => ({ exact: e, approx: approxOf(e), mult: 1, family: false });
  if (c.length === 2) return [mk(neg(div(c[0], c[1])))];
  if (c.length === 3) {
    const [cc, b, a] = c;
    const disc = expand(sub(pow(b, TWO), mul(num(4), a, cc)));
    if (isZero(disc)) return [{ ...mk(div(neg(b), mul(TWO, a))), mult: 2 }];
    const s = sqrt(disc);
    return [mk(div(sub(neg(b), s), mul(TWO, a))), mk(div(add(neg(b), s), mul(TWO, a)))];
  }
  return null;
}

// --- Transcendental equations ---

/** Number of places x occurs. */
function occurrences(e: Expr, x: string): number {
  if (isSym(e, x)) return 1;
  return children(e).reduce((s, c) => s + occurrences(c, x), 0);
}

function transcendental(N: Expr, x: string): Sol[] | null {
  // 1. x occurs once: peel operations off
  if (occurrences(N, x) === 1) return isolate(N, ZERO, x);
  // 2. a product: each factor = 0
  const fact = factorWithKernels(N, x);
  if (fact.k === '*' && fact.t.filter(f => !freeOf(f, x)).length > 1) {
    const out: Sol[] = [];
    for (const f of fact.t) {
      if (freeOf(f, x)) continue;
      const base = f.k === '^' && isNum(f.e) && qsign(f.e.v) > 0 ? f.b : f;
      const r = solveEquation(base, x);
      if (r.kind === 'list') out.push(...r.sols); else if (r.kind === 'all') return null;
    }
    return out;
  }
  // 3. a single kernel (eˣ, sin x, ln x …): a polynomial in it
  const viaKernel = kernelSubstitution(N, x);
  if (viaKernel) return viaKernel;
  // 4. trigonometric: rewrite multiple angles, then sin² ↔ cos² (and split products again), or a·sin(u) + b·cos(u) + d = 0
  if (hasTrig(N)) {
    const te = expand(trigExpand(N));
    const tf = factorWithKernels(te, x);
    if (tf.k === '*' && tf.t.filter(f => !freeOf(f, x)).length > 1) return transcendental(tf, x);
    for (const [from, to] of [['sin', 'cos'], ['cos', 'sin']] as const) {
      const r = kernelSubstitution(expand(replaceEven(te, from, to)), x);
      if (r) return r;
    }
    const linTrig = solveLinearTrig(te, x);
    if (linTrig) return linTrig;
  }
  // 5. products of powers on both sides: take logarithms
  const logs = logBothSides(N, x);
  if (logs) return logs;
  // 6. one square root: A + B√u = 0 ⇒ A² − B²u = 0, candidates checked against the original
  return radical(N, x);
}

/** Solve a·sin(u) + b·cos(u) + d = 0 where a, b, d are free of x and u is linear in x. */
function solveLinearTrig(e: Expr, x: string): Sol[] | null {
  const args = new Map<string, Expr>();
  const visit = (n: Expr) => {
    if (freeOf(n, x)) return;
    if (isFn(n, 'sin') || isFn(n, 'cos')) { args.set(key(n.a[0]), n.a[0]); return; }
    children(n).forEach(visit);
  };
  visit(e);
  if (args.size !== 1) return null;
  const [u] = args.values();
  const S = sym('ŝ'), C_ = sym('ĉ');
  const M = replaceAll(replaceAll(e, fn('sin', u), S), fn('cos', u), C_);
  if (!freeOf(M, x)) return null;
  const cs = coeffsOf(M, 'ŝ', 1);
  if (!cs || cs.length !== 2 || !freeOf(cs[1], 'ĉ')) return null;
  const cc = coeffsOf(cs[0], 'ĉ', 1);
  if (!cc || cc.length !== 2) return null;
  const a = cs[1], b = cc[1], d = cc[0];
  // a·sin(u) + b·cos(u) = R·sin(u + φ) = -d where R = √(a² + b²)
  const R2 = expand(add(pow(a, TWO), pow(b, TWO)));
  if (isZero(R2)) return null;
  const R = sqrt(R2);
  // When d = 0: tan(u) = -b/a
  if (isZero(d)) return isolate(fn('tan', u), neg(div(b, a)), x);
  const phi = isConstant(a) && constSign(a) === -1 ? add(fn('atan', div(b, a)), PI) : fn('atan', div(b, a));
  return isolate(fn('sin', add(u, phi)), div(neg(d), R), x);
}

/** Factors with every function call / exponential treated as a separate unknown: 2 sin x cos x − cos x = cos x (2 sin x − 1). */
function factorWithKernels(e: Expr, x: string): Expr {
  const hidden = new Map<string, { name: string; orig: Expr }>();
  const hide = (u: Expr): Expr => {
    if (freeOf(u, x)) return u;
    if (u.k === 'f' || (u.k === '^' && !freeOf(u.e, x)) || (u.k === '^' && isNum(u.e) && u.e.v.d !== 1n)) {
      const id = key(u);
      let h = hidden.get(id);
      if (!h) { h = { name: `ā${hidden.size}`, orig: u }; hidden.set(id, h); }
      return sym(h.name);
    }
    if (u.k === 'n' || u.k === 's') return u;
    return u.k === '+' ? add(...u.t.map(hide)) : u.k === '*' ? mul(...u.t.map(hide)) : pow(hide(u.b), u.e);
  };
  let f: Expr;
  try { f = factorExpr(hide(e)).e; } catch { return e; }
  for (const { name, orig } of hidden.values()) f = subst(f, name, orig);
  return f;
}

function radical(N: Expr, x: string): Sol[] | null {
  const roots = new Map<string, Expr>();
  const visit = (e: Expr) => {
    if (e.k === '^' && isNum(e.e) && e.e.v.d === 2n && !freeOf(e.b, x)) roots.set(key(e.b), e.b);
    children(e).forEach(visit);
  };
  visit(N);
  if (roots.size !== 1) return null;
  const [u] = roots.values();
  const T = sym('ŵ');
  const M = replaceAll(N, sqrt(u), T);
  const c = coeffsOf(M, 'ŵ', 40);
  if (!c) return null;
  const A = add(...c.map((ck, k) => (k % 2 ? ZERO : mul(ck, pow(u, num(k / 2)))))), B = add(...c.map((ck, k) => (k % 2 ? mul(ck, pow(u, num((k - 1) / 2))) : ZERO)));
  const squared = expand(sub(pow(A, TWO), mul(pow(B, TWO), u)));
  if (!freeOf(squared, 'ŵ')) return null;
  const r = solveEquation(squared, x);
  if (r.kind !== 'list') return r.kind === 'none' ? [] : null;
  return r.sols.filter(s => !s.approx || isRealC(s.approx));
}

const hasTrig = (e: Expr): boolean => (isFn(e, 'sin') || isFn(e, 'cos') || isFn(e, 'tan')) || children(e).some(hasTrig);
function replaceEven(e: Expr, from: 'sin' | 'cos', to: 'sin' | 'cos'): Expr {
  if (e.k === '^' && isFn(e.b, from) && isInt(e.e) && e.e.v.n >= 2n) {
    const n = e.e.v.n;
    return mul(pow(sub(ONE, pow(fn(to, e.b.a[0]), TWO)), num(n / 2n)), pow(e.b, num(n % 2n)));
  }
  if (e.k === 'n' || e.k === 's') return e;
  return e.k === '+' ? add(...e.t.map(t => replaceEven(t, from, to))) : e.k === '*' ? mul(...e.t.map(t => replaceEven(t, from, to))) : e.k === '^' ? pow(replaceEven(e.b, from, to), e.e) : e;
}

/** Solve g(x) = c with x occurring once in g. */
function isolate(g: Expr, c: Expr, x: string): Sol[] | null {
  const one = (e: Expr, family = false): Sol => ({ exact: e, approx: approxOf(e), mult: 1, family: family || !freeOf(e, 'k') });
  if (isSym(g, x)) return [one(c)];
  if (g.k === '+') {
    const inner = g.t.find(t => !freeOf(t, x))!;
    return isolate(inner, sub(c, sub(g, inner)), x);
  }
  if (g.k === '*') {
    const inner = g.t.find(t => !freeOf(t, x))!;
    const k = div(g, inner);
    return isolate(inner, div(c, k), x);
  }
  if (g.k === '^') {
    if (freeOf(g.e, x)) {
      const n = g.e;
      if (isNum(n) && n.v.d === 1n) {
        // real roots of h^n = c
        const N_ = n.v.n;
        if (N_ < 0n) return isolate(pow(g.b, num(-N_)), pow(c, MINUS_ONE), x);
        const s = constSign(c);
        if (N_ % 2n) return isolate(g.b, s !== null && s < 0 ? neg(pow(neg(c), num(q(1n, N_)))) : pow(c, num(q(1n, N_))), x);
        if (s === -1) return [];
        if (s === 0) return isolate(g.b, ZERO, x);
        const r = pow(c, num(q(1n, N_)));
        return [...(isolate(g.b, neg(r), x) ?? []), ...(isolate(g.b, r, x) ?? [])];
      }
      if (isNum(n)) {
        const p = n.v.n, q_ = n.v.d;
        if (p < 0n) return isolate(pow(g.b, num(q(-p, q_))), pow(c, MINUS_ONE), x);
        const s = constSign(c);
        if (q_ % 2n === 0n && s === -1) return [];
        if (p % 2n === 0n && s === -1) return [];
        if (s === 0) return isolate(g.b, ZERO, x);
        const r = s !== null && s < 0 ? neg(pow(neg(c), num(q(q_, p)))) : pow(c, num(q(q_, p)));
        if (p % 2n === 0n) return [...(isolate(g.b, neg(r), x) ?? []), ...(isolate(g.b, r, x) ?? [])];
        return isolate(g.b, r, x);
      }
      // h^n = c → h = c^(1/n) (checked afterwards)
      return isolate(g.b, pow(c, pow(n, MINUS_ONE)), x);
    }
    if (freeOf(g.b, x)) {
      const s = constSign(c);
      if (s !== null && s <= 0) return [];
      return isolate(g.e, isSym(g.b, 'e') ? fn('ln', c) : fn('log', g.b, c), x);
    }
    return null;
  }
  if (g.k === 'f' && g.a.length === 1) {
    const h = g.a[0];
    const both = (a: Expr[]) => a.flatMap(v => isolate(h, v, x) ?? []);
    const s = constSign(c);
    const between = (lo: number, hi: number) => { if (!isConstant(c)) return true; const v = approx(c); return Math.abs(v.im) < 1e-12 && v.re >= lo - 1e-15 && v.re <= hi + 1e-15; };
    switch (g.n) {
      case 'sin': if (!between(-1, 1)) return []; {
        if (isZero(c)) return both([mul(PI, K)]);
        const a = fn('asin', c);
        if (same(a, mul(num(1, 2), PI)) || same(a, mul(num(-1, 2), PI))) return both([add(a, mul(TWO, PI, K))]);
        return both([add(a, mul(TWO, PI, K)), add(sub(PI, a), mul(TWO, PI, K))]);
      }
      case 'cos': if (!between(-1, 1)) return []; {
        if (isZero(c)) return both([add(mul(num(1, 2), PI), mul(PI, K))]);
        const a = fn('acos', c);
        if (isZero(a) || same(a, PI)) return both([add(a, mul(TWO, PI, K))]);
        return both([add(neg(a), mul(TWO, PI, K)), add(a, mul(TWO, PI, K))]);
      }
      case 'tan': return both([add(fn('atan', c), mul(PI, K))]);
      case 'cot': return both([add(fn('acot', c), mul(PI, K))]);
      case 'ln': return both([pow(E, c)]);
      case 'asin': return between(-Math.PI / 2, Math.PI / 2) ? both([fn('sin', c)]) : [];
      case 'acos': return between(0, Math.PI) ? both([fn('cos', c)]) : [];
      case 'atan': return between(-Math.PI / 2 + 1e-300, Math.PI / 2 - 1e-300) ? both([fn('tan', c)]) : [];
      case 'sinh': return both([fn('asinh', c)]);
      case 'cosh': if (!between(1, Infinity)) return []; return both([neg(fn('acosh', c)), fn('acosh', c)]);
      case 'tanh': return between(-1, 1) ? both([fn('atanh', c)]) : [];
      case 'abs': if (s === -1) return []; if (s === 0) return both([ZERO]); return both([neg(c), c]);
      case 'sqrt': if (s === -1) return []; return both([pow(c, TWO)]);
    }
  }
  return null;
}

/** All x-dependence through one kernel u(x) (eˣ, 2ˣ, sin x, ln x, √x …): solve the polynomial in u, then u(x) = rootᵢ. */
function kernelSubstitution(N: Expr, x: string): Sol[] | null {
  // e^(a·x + b) with rational a: write as e^b·(e^(g·x))^(a/g)
  const exps: Q[] = [];
  let allLinear = true;
  const visit = (e: Expr) => {
    if (e.k === '^' && !freeOf(e.e, x) && freeOf(e.b, x)) {
      const c = coeffsOf(e.e, x, 1);
      if (c && c.length === 2 && isNum(c[1])) exps.push((c[1] as { v: Q }).v);
      else allLinear = false;
    }
    children(e).forEach(visit);
  };
  visit(N);
  let M = N;
  const bases = new Set<string>();
  const collectBases = (e: Expr) => { if (e.k === '^' && !freeOf(e.e, x) && freeOf(e.b, x)) bases.add(key(e.b)); children(e).forEach(collectBases); };
  collectBases(N);
  if (allLinear && exps.length && bases.size === 1) {
    const g = exps.reduce((a, b) => qGcd(a, b));
    const baseExpr = (() => { let b: Expr | null = null; const f = (e: Expr) => { if (!b && e.k === '^' && !freeOf(e.e, x) && freeOf(e.b, x)) b = e.b; children(e).forEach(f); }; f(N); return b as unknown as Expr; })();
    const kernel = pow(baseExpr, mul(num(g), sym(x)));
    const T = sym('ŵ');
    const rewrite = (e: Expr): Expr => {
      if (e.k === '^' && !freeOf(e.e, x) && freeOf(e.b, x)) {
        const c = coeffsOf(e.e, x, 1)!;
        return mul(pow(e.b, c[0]), pow(T, num(qDiv((c[1] as { v: Q }).v, g))));
      }
      if (e.k === 'n' || e.k === 's') return e;
      return e.k === '+' ? add(...e.t.map(rewrite)) : e.k === '*' ? mul(...e.t.map(rewrite)) : e.k === '^' ? pow(rewrite(e.b), e.e) : fn(e.n, ...e.a.map(rewrite));
    };
    M = rewrite(N);
    if (freeOf(M, x)) return viaKernel(M, 'ŵ', kernel, x);
  }
  // a single function kernel: sin x, ln x, √x …
  const kernels = new Map<string, Expr>();
  const findK = (e: Expr) => {
    if (freeOf(e, x)) return;
    if (isSym(e, x)) { kernels.set(x, e); return; }
    if (e.k === 'f' || (e.k === '^' && !(isNum(e.e) && e.e.v.d === 1n))) { kernels.set(key(e.k === '^' && isNum(e.e) ? pow(e.b, num(q(1n, e.e.v.d))) : e), e.k === '^' && isNum(e.e) ? pow(e.b, num(q(1n, e.e.v.d))) : e); return; }
    children(e).forEach(findK);
  };
  findK(N);
  if (kernels.size === 1) {
    const [k] = kernels.values();
    if (isSym(k, x)) return null;
    const T = sym('ŵ');
    const M2 = replaceAll(N, k, T);
    if (freeOf(M2, x)) return viaKernel(M2, 'ŵ', k, x);
  }
  return null;
}
function replaceAll(e: Expr, k: Expr, by: Expr): Expr {
  if (same(e, k)) return by;
  if (e.k === '^' && same(e.b, k)) return pow(by, e.e);
  if (k.k === '^' && e.k === '^' && same(e.b, k.b) && isNum(e.e) && isNum(k.e)) {
    const r = qDiv(e.e.v, k.e.v);
    if (r.d === 1n) return pow(by, num(r));
  }
  if (e.k === 'n' || e.k === 's') return e;
  return e.k === '+' ? add(...e.t.map(t => replaceAll(t, k, by))) : e.k === '*' ? mul(...e.t.map(t => replaceAll(t, k, by))) : e.k === '^' ? pow(replaceAll(e.b, k, by), replaceAll(e.e, k, by)) : fn(e.n, ...e.a.map(a => replaceAll(a, k, by)));
}
function viaKernel(M: Expr, t: string, kernel: Expr, x: string): Sol[] | null {
  const r = solveEquation(M, t);
  if (r.kind !== 'list') return r.kind === 'none' ? [] : null;
  const out: Sol[] = [];
  for (const s of r.sols) {
    const v = s.exact ?? (s.approx && isRealC(s.approx) ? numFromBF(s.approx) : null);
    if (!v) continue;
    // only real values of the kernel give real x here
    if (s.approx && !isRealC(s.approx)) continue;
    const sub_ = isolate(kernel, v, x);
    if (sub_) out.push(...sub_.map(z => ({ ...z, exact: s.exact ? z.exact : null, approx: z.approx ?? null })));
  }
  return out;
}
/** The real part as an exact rational (a BigFloat is m·2^e). */
const numFromBF = (z: C): Expr => num(z.re.e >= 0 ? q(z.re.m << BigInt(z.re.e)) : q(z.re.m, 1n << BigInt(-z.re.e)));
function qFromDouble(v: number): Q {
  let d = 1n, x = v;
  for (let k = 0; k < 64 && !Number.isInteger(x); k++) { x *= 2; d *= 2n; }
  return q(BigInt(Math.round(x)), d);
}
const qGcd = (a: Q, b: Q): Q => { const g = (m: bigint, n: bigint): bigint => (n ? g(n, m % n) : m < 0n ? -m : m); return q(g(a.n * b.d, b.n * a.d), a.d * b.d); };
const qDiv = (a: Q, b: Q): Q => q(a.n * b.d, a.d * b.n);

/** A·bᵘ = C·dᵛ (products of powers): ln both sides and solve the result. */
function logBothSides(N: Expr, x: string): Sol[] | null {
  if (N.k !== '+' || N.t.length !== 2) return null;
  const [a, b] = N.t;
  const ok = (t: Expr) => (t.k === '*' ? t.t : [t]).every(f => freeOf(f, x) || (f.k === '^' && freeOf(f.b, x)));
  if (!ok(a) || !ok(b)) return null;
  const lhs = a, rhs = neg(b);
  if (constSign(rhs) === -1 || !freeOf(rhs, 'i')) return null;
  const eq = sub(expandLog(fn('ln', lhs)), expandLog(fn('ln', rhs)));
  const c = coeffsOf(eq, x, 1);
  if (!c || c.length !== 2) return null;
  const v = neg(div(c[0], c[1]));
  return [{ exact: v, approx: approxOf(v), mult: 1, family: false }];
}

// --- Numeric real roots ---

/** Sign changes and touching zeros of f on [lo, hi], refined to ~90 digits. */
export function numericReal(f: Expr, x: string, lo: number, hi: number): Sol[] {
  const g = compileDouble(f, x);
  const n = 4000, h = (hi - lo) / n;
  const out: number[] = [];
  let prevX = lo, prevY = g(lo);
  for (let k = 1; k <= n; k++) {
    const X = lo + k * h, Y = g(X);
    if (Number.isFinite(prevY) && Number.isFinite(Y)) {
      if (prevY === 0) out.push(prevX);
      else if (Math.sign(prevY) !== Math.sign(Y) && Y !== 0) {
        // bisection, then reject poles (|f| growing as the bracket shrinks)
        let a = prevX, b = X, fa = prevY;
        for (let j = 0; j < 80; j++) { const m = (a + b) / 2, fm = g(m); if (!Number.isFinite(fm)) break; if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else b = m; }
        const m = (a + b) / 2;
        if (Math.abs(g(m)) < 1e-6 * Math.max(1, Math.abs(prevY), Math.abs(Y))) out.push(m);
      }
    }
    prevX = X; prevY = Y;
  }
  return out.map(v => ({ exact: null, approx: refineReal(f, x, v), mult: 1, family: false }));
}
function refineReal(f: Expr, x: string, v: number): C {
  // Newton in BigFloat on the exact expression and its exact derivative
  let z: C = { re: bfFromNumber(v), im: BZERO };
  let df: Expr;
  try { df = diff(f, x); } catch { return z; }
  for (let it = 0; it < 30; it++) {
    try {
      const xv = numFromBF(z);
      const a = evalC(subst(f, x, xv), 340), b = evalC(subst(df, x, xv), 340);
      if (!b.re.m) break;
      const step = bfDiv(a.re, b.re, 340);
      z = { re: bfSub(z.re, step, 340), im: BZERO };
      if (!step.m || top(step) < top(z.re) - 320) break;
    } catch { break; }
  }
  return z;
}

// --- Systems ---

/** A value of one parameter (a = 1) and what the system is then. */
export interface SystemCase { at: [string, Expr]; result: SystemResult }
export type SystemResult =
  | { kind: 'solutions'; list: Expr[][]; note?: string; when?: Expr; cases?: SystemCase[]; family?: boolean }
  | { kind: 'param'; values: Expr[]; free: string[]; note?: string; when?: Expr; cases?: SystemCase[] }
  | { kind: 'none'; note?: string; cases?: SystemCase[] }
  | { kind: 'unknown'; note: string };

/** Letters read as unknowns before the others, which are then parameters: x + y = a, x − y = b is solved for x, y. */
const UNKNOWN_LETTERS = ['x', 'y', 'z', 't', 'u', 'v', 'w'];
/**
 * The unknowns of a system written without them: every letter when there are no more letters than equations
 * (a + b = 3, a − b = 1), else x, y, z, t, u, v, w, topped up from the end of the alphabet when there are fewer of
 * them than equations. What is left are the parameters.
 */
export function chooseUnknowns(eqs: Expr[]): { unknowns: string[]; params: string[] } {
  const all = [...new Set(eqs.flatMap(e => variables(e)))].sort();
  if (all.length <= eqs.length) return { unknowns: all, params: [] };
  const unknowns = all.filter(v => UNKNOWN_LETTERS.includes(v));
  const others = all.filter(v => !unknowns.includes(v)).sort((a, b) => (a === 'k' ? -1 : b === 'k' ? 1 : a < b ? 1 : -1));
  while (unknowns.length < eqs.length && others.length) unknowns.push(others.shift()!);
  return { unknowns: all.filter(v => unknowns.includes(v)), params: all.filter(v => !unknowns.includes(v)) };
}

/**
 * Each equation is f = 0; vars are the unknowns, any other letter is a parameter. Returns value lists in the order
 * of vars. Fractions are cleared (a solution that zeroes a denominator is dropped); a linear system is solved by
 * elimination, a square one with parameters by Cramer's rule, with the parameter values where the determinant
 * vanishes discussed apart; a nonlinear one by substitution, by differences of equations, by branches of a
 * quadratic and, for two polynomial equations in two unknowns, by the resultant.
 */
export function solveSystem(eqs: Expr[], vars: string[]): SystemResult {
  const fs: Expr[] = [], dens: Expr[] = [];
  for (const e of eqs) {
    const [N, D] = numDen(cancel(together(e)));
    if (!vars.every(v => freeOf(D, v)) || !isNum(D)) dens.push(D);
    const n = expand(N);
    if (isZero(n)) continue;
    if (vars.every(v => freeOf(n, v)) && isConstant(n)) return { kind: 'none' };
    fs.push(n);
  }
  // an equation without unknowns (x − y = 2 when solving for a, b) is a condition on the parameters, not one to solve
  const conditions = fs.filter(f => vars.every(v => freeOf(f, v)));
  const rest = fs.filter(f => !conditions.includes(f));
  if (!rest.length) return { kind: 'param', values: vars.map(v => sym(v)), free: vars };
  const r = linearRows(rest, vars);
  const res = finish(r ? linearSystem(r, vars) : nonlinear(rest, vars), eqs.filter(e => !conditions.some(c => same(expand(numDen(cancel(together(e)))[0]), c))), dens, vars);
  if (!conditions.length || res.kind === 'unknown') return res;
  const note = `Przy warunku ${conditions.map(c => `${textU(c)} = 0`).join(', ')} (to równanie nie zawiera niewiadomych ${vars.join(', ')}).`;
  return { ...res, note: [note, res.note].filter(Boolean).join(' ') };
}

/** Rows [a₁ … aₙ | b] of a system linear in vars (coefficients may hold parameters), or null. */
function linearRows(fs: Expr[], vars: string[]): Expr[][] | null {
  const rows: Expr[][] = [];
  for (const f of fs) {
    const row: Expr[] = [];
    let rest = f;
    for (const v of vars) {
      const c = coeffsOf(rest, v, 1);
      if (!c || c.length > 2 || (c[1] && vars.some(w => !freeOf(c[1], w)))) return null;
      row.push(c[1] ?? ZERO);
      rest = c[0] ?? ZERO;
    }
    if (vars.some(w => !freeOf(rest, w))) return null;
    row.push(neg(rest));
    rows.push(row);
  }
  return rows;
}

/** Drops solutions that zero a denominator or don't satisfy the equations as written; keeps real ones when there are. */
function finish(r: SystemResult, eqs: Expr[], dens: Expr[], vars: string[]): SystemResult {
  if (r.kind === 'none' && r.cases) return r;
  const withCases = (x: SystemResult): SystemResult => ('cases' in x && x.cases ? { ...x, cases: x.cases.map(c => ({ ...c, result: finish(c.result, eqs.map(e => subst(e, c.at[0], c.at[1])), dens.map(d => subst(d, c.at[0], c.at[1])), vars) })) } : x);
  if (r.kind === 'param') return withCases({ ...r, values: r.values.map(tidyValue) });
  if (r.kind !== 'solutions') return withCases(r);
  const at = (e: Expr, sol: Expr[]) => vars.reduce((acc, v, j) => subst(acc, v, sol[j]), e);
  const ok = r.list.filter(sol => {
    try {
      if (dens.some(d => { const v = at(d, sol); return isConstant(v) ? isNearZero(v) : vanishes(v); })) return false;
      return eqs.every(e => { const v = at(e, sol); return isConstant(v) ? residualSmall(v) : true; });
    } catch (err) { if (err instanceof CasError) return false; throw err; }
  });
  if (!ok.length) return withCases(r.list.length ? { kind: 'none', note: 'Rozwiązania równań bez mianowników zerują mianownik, więc nie są rozwiązaniami.' } : r);
  const real = ok.filter(sol => sol.every(v => !isConstant(v) || !freeOf(v, 'k') || isRealValue(v)));
  const list = (real.length ? real : ok).map(sol => sol.map(v => tidyValue(r.family ? reduceK(v) : v)));
  const note = [r.note, real.length && real.length < ok.length ? `Pominięto rozwiązania zespolone (${ok.length - real.length}).` : '',
    !real.length && ok.some(sol => sol.every(v => isConstant(v))) ? 'Brak rozwiązań rzeczywistych; poniżej rozwiązania zespolone.' : ''].filter(Boolean).join(' ') || undefined;
  return withCases({ ...r, list, note });
}
/** The same value with fewer minus signs: (−2b − 1)/(−a − b) = (2b + 1)/(a + b), −(b − a)/2 = (a − b)/2. */
function tidyValue(e: Expr): Expr {
  const [n, d] = numDen(e);
  if (isNum(n) && isNum(d)) return e;
  const cands = [e, div(n, d)];
  if (!isNum(d)) { try { cands.push(div(expand(neg(n)), expand(neg(d)))); } catch { /* keep the others */ } }
  let best = e;
  for (const c of cands) if (minusSigns(c) < minusSigns(best)) best = c;
  return best;
}
function minusSigns(e: Expr): number {
  const own = (e.k === 'n' && e.v.n < 0n) || (e.k === '*' && e.t[0].k === 'n' && e.t[0].v.n < 0n) ? 1 : 0;
  return own + children(e).reduce((s, c) => s + minusSigns(c), 0);
}
/** sin(2kπ + a) = sin a, tg(kπ + a) = tg a, … for the integer k of a family of solutions. */
function reduceK(e: Expr): Expr {
  if (e.k === 'n' || e.k === 's') return e;
  const m = mapChildren(e, reduceK);
  if (m.k !== 'f' || m.a.length !== 1 || !['sin', 'cos', 'tan', 'cot', 'sec', 'csc'].includes(m.n)) return m;
  const period = m.n === 'tan' || m.n === 'cot' ? 1n : 2n;
  const terms = m.a[0].k === '+' ? m.a[0].t : [m.a[0]];
  const kept = terms.filter(t => {
    const c = coeffsOf(t, 'k', 1);
    if (!c || c.length !== 2 || !isZero(c[0])) return true;
    const r = cancel(div(c[1], PI));
    return !(isInt(r) && r.v.n % period === 0n);
  });
  return kept.length === terms.length ? m : fn(m.n, add(...kept));
}
function isRealValue(v: Expr): boolean {
  try { const z = evalC(v, 200); return !z.im.m || top(z.im) < Math.max(top(z.re), 0) - 120; } catch { return false; }
}
/** |e| tiny compared with 1 at 300 bits: a solution found to 100 digits passes, a wrong one doesn't. */
function residualSmall(e: Expr): boolean {
  if (isZero(e)) return true;
  try { const z = evalC(e, 300); return Math.max(top(z.re), top(z.im)) < -150; } catch { return false; }
}
/**
 * e ≡ 0 as a function of its letters, tested at generic rational points (k, the index of a family, at integers):
 * a symbolic solution with parameters is checked like this where it can't be by its value.
 */
function vanishes(e: Expr): boolean {
  if (isZero(e) || isZero(expand(e))) return true;
  const vs = variables(e);
  for (let s = 0; s < 4; s++) {
    const val = (v: string, j: number) => (v === 'k' ? num(s - 2) : num(q(BigInt(1371 + 613 * j + 97 * s), 1000n)));
    const at = vs.reduce((acc, v, j) => subst(acc, v, val(v, j)), e);
    try {
      const z = evalC(at, 300);
      if (Math.max(top(z.re), top(z.im)) > -200) return false;
    } catch (err) { if (err instanceof CasError) continue; throw err; }
  }
  return true;
}

function linearSystem(rows: Expr[][], vars: string[]): SystemResult {
  const n = vars.length;
  const params = [...new Set(rows.flatMap(r => r.flatMap(c => variables(c))))];
  if (params.length && rows.length === n && n <= 6) {
    const c = cramer(rows, vars);
    if (c) return c;
  }
  const { R, pivots } = rref(rows);
  if (pivots.includes(n)) return params.length ? inconsistent(rows, vars) : { kind: 'none' };
  const free = vars.filter((_, j) => !pivots.includes(j));
  const values: Expr[] = vars.map(v => sym(v));
  pivots.forEach((p, i) => {
    let v = R[i][n];
    for (let j = p + 1; j < n; j++) if (!pivots.includes(j) && nonzero(R[i][j])) v = sub(v, mul(R[i][j], sym(vars[j])));
    values[p] = simplify(v);
  });
  const note = params.length ? 'Dla ogólnych wartości parametrów (eliminacja dzieli przez wyrażenia z parametrami).' : undefined;
  if (free.length) return { kind: 'param', values, free, note };
  return { kind: 'solutions', list: [values], note };
}

/**
 * Elimination said "contradictory", but a parameter on the right may make it consistent: x + 2y = k, 2x + 4y = 3
 * has no solution unless k = 3/2. Eliminating on the coefficient columns only leaves rows 0 = c(k); with one
 * parameter the common zeros of those c are solved for, and the system is solved again there.
 */
function inconsistent(rows: Expr[][], vars: string[]): SystemResult {
  const n = vars.length, M = rows.map(r => r.slice());
  let row = 0;
  for (let col = 0; col < n && row < M.length; col++) {
    const p = M.findIndex((r, i) => i >= row && nonzero(r[col]));
    if (p < 0) continue;
    [M[p], M[row]] = [M[row], M[p]];
    for (let i = 0; i < M.length; i++) {
      if (i === row || !nonzero(M[i][col])) continue;
      const f = div(M[i][col], M[row][col]);
      M[i] = M[i].map((v, j) => cancel(together(sub(v, mul(f, M[row][j])))));
    }
    row++;
  }
  const conds = M.slice(row).map(r => r[n]).filter(nonzero);
  const ps = [...new Set(conds.flatMap(c => variables(c)))];
  if (!conds.length || conds.some(c => isConstant(c)) || ps.length !== 1) return { kind: 'none' };
  const p = ps[0];
  let zs: SolveResult;
  try { zs = solveEquation(conds[0], p); } catch (err) { if (err instanceof CasError) return { kind: 'none' }; throw err; }
  const cases: SystemCase[] = [];
  if (zs.kind === 'list') {
    for (const z of zs.sols) {
      if (!z.exact || z.family || !isRealValue(z.exact) || !conds.every(c => isNearZero(subst(c, p, z.exact!)))) continue;
      cases.push({ at: [p, z.exact], result: linearSystem(rows.map(r => r.map(c => simplify(subst(c, p, z.exact!)))), vars) });
    }
  }
  return cases.length ? { kind: 'none', cases, note: `Dla ${p} ∉ {${cases.map(c => textU(c.at[1])).join('; ')}}.` } : { kind: 'none' };
}

/**
 * Cramer's rule: x_j = W_j/W when W = det A ≠ 0. With one parameter, the values where W = 0 are solved for and the
 * system is solved again at each of them (no solutions or infinitely many: the discussion of a parametric system).
 */
function cramer(rows: Expr[][], vars: string[]): SystemResult | null {
  const n = vars.length;
  const A = rows.map(r => r.slice(0, n)), b = rows.map(r => r[n]);
  let W: Expr;
  try { W = det(A); } catch (err) { if (err instanceof CasError) return null; throw err; }
  if (!nonzero(W)) return null;
  const values = vars.map((_, j) => simplify(div(det(A.map((r, i) => r.map((c, k) => (k === j ? b[i] : c)))), W)));
  const params = variables(W);
  const cases: SystemCase[] = [];
  let when: Expr | undefined = params.length ? W : undefined;
  if (params.length === 1) {
    const p = params[0];
    let zeros: SolveResult;
    try { zeros = solveEquation(W, p); } catch (err) { if (err instanceof CasError) return { kind: 'solutions', list: [values], when: W }; throw err; }
    if (zeros.kind === 'list') {
      for (const s of zeros.sols) {
        if (!s.exact || s.family || !isRealValue(s.exact)) continue;
        const sub_ = rows.map(r => r.map(c => simplify(subst(c, p, s.exact!))));
        cases.push({ at: [p, s.exact], result: linearSystem(sub_, vars) });
      }
      // W = k² + 1 never vanishes for a real parameter: no condition to state
      if (!cases.length && zeros.sols.every(s => s.exact && !s.family && !isRealValue(s.exact))) when = undefined;
    } else if (zeros.kind === 'none') when = undefined;
  }
  return { kind: 'solutions', list: [values], when, cases: cases.length ? cases : undefined };
}

function nonlinear(fs: Expr[], vars: string[], depth = 0): SystemResult {
  if (depth > 6) return { kind: 'unknown', note: 'Układ jest zbyt złożony.' };
  if (vars.length === 1) {
    // all equations in one unknown: solve the first, keep common solutions
    const x = vars[0];
    let r: SolveResult;
    try { r = solveEquation(fs[0], x); } catch (err) { if (err instanceof CasError) return { kind: 'unknown', note: err.message }; throw err; }
    if (r.kind === 'none') return { kind: 'none' };
    if (r.kind === 'all') return fs.length > 1 ? nonlinear(fs.slice(1), vars, depth + 1) : { kind: 'param', values: [sym(x)], free: vars };
    const holds = (v: Expr) => fs.slice(1).every(f => { const g = subst(f, x, v); return isConstant(g) ? isNearZero(g) : vanishes(g); });
    const list: Expr[][] = [];
    let numeric = false;
    for (const s of r.sols) {
      let v = s.exact ?? (s.approx ? numFromBF(s.approx) : null);
      if (!v || (s.excludeK && s.excludeK.length)) continue;
      if (!s.exact) { const e = snap(fs[0], x, v); if (e) v = e; else numeric = true; }
      if (holds(v)) list.push([v]);
    }
    if (list.length) return { kind: 'solutions', list, note: r.numericRange && numeric ? r.note : undefined, family: r.sols.some(s => s.family) };
    return r.numericRange ? { kind: 'unknown', note: 'Nie znalazłem rozwiązań ani dokładnie, ani numerycznie w przedziale ⟨−50; 50⟩.' } : { kind: 'none' };
  }
  // an equation linear in some variable with a coefficient free of the unknowns → substitute
  for (let i = 0; i < fs.length; i++) {
    for (const v of vars) {
      const c = coeffsOf(fs[i], v, 1);
      if (!c || c.length !== 2 || isZero(c[1]) || vars.some(w => !freeOf(c[1], w)) || !nonzero(c[1])) continue;
      return eliminate(fs, vars, i, v, [neg(div(c[0], c[1]))], depth);
    }
  }
  // differences of equations may be linear (two circles)
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
    for (const sc of [ONE, MINUS_ONE]) {
      const d = expand(add(fs[i], mul(sc, fs[j])));
      for (const v of vars) {
        const c = coeffsOf(d, v, 1);
        if (!c || c.length !== 2 || isZero(c[1]) || vars.some(w => !freeOf(c[1], w))) continue;
        const nfs = fs.slice(); nfs[j] = d;
        return eliminate(nfs, vars, j, v, [neg(div(c[0], c[1]))], depth);
      }
    }
  }
  // an equation quadratic in some variable with a leading coefficient free of the unknowns: two branches
  for (let i = 0; i < fs.length; i++) {
    for (const v of vars) {
      const c = coeffsOf(fs[i], v, 2);
      if (!c || c.length !== 3 || vars.some(w => !freeOf(c[2], w))) continue;
      const [cc, b, a] = c;
      const s = sqrt(expand(sub(pow(b, TWO), mul(num(4), a, cc))));
      return eliminate(fs, vars, i, v, [div(sub(neg(b), s), mul(TWO, a)), div(add(neg(b), s), mul(TWO, a))], depth);
    }
  }
  if (vars.length === 2 && fs.length >= 2) {
    const r = viaResultant(fs, vars);
    if (r) return r;
  }
  return { kind: 'unknown', note: 'Nie umiem rozwiązać tego układu dokładnie.' };
}

/** A numeric root that is exactly a simple rational (√x + √(x − 5) = 5 at x = 9): that rational, else null. */
function snap(f: Expr, x: string, v: Expr): Expr | null {
  const t = approx(v).re;
  if (!Number.isFinite(t) || Math.abs(t) > 1e9) return null;
  for (let d = 1; d <= 12; d++) {
    const c = num(q(BigInt(Math.round(t * d)), BigInt(d)));
    if (Math.abs(approx(c).re - t) > 1e-12 * Math.max(1, Math.abs(t))) continue;
    try { const z = evalC(subst(f, x, c), 300); if (Math.max(top(z.re), top(z.im)) < -250) return c; } catch { /* not there */ }
  }
  return null;
}

/**
 * Two polynomial equations in x and y: the resultant in y is a polynomial in x alone whose roots are the x of every
 * common solution; each is put back and y solved from the first equation, kept when the others hold too.
 */
function viaResultant(fs: Expr[], vars: string[]): SystemResult | null {
  const [x, y] = vars;
  const [f, g] = fs;
  const cf = coeffsOf(f, y, 12), cg = coeffsOf(g, y, 12);
  if (!cf || !cg || cf.length < 2 || cg.length < 2 || !coeffsOf(f, x, 12) || !coeffsOf(g, x, 12)) return null;
  const m = cf.length - 1, n = cg.length - 1;
  if (m + n > 10) return null;
  const S: Expr[][] = [];
  for (let i = 0; i < n; i++) S.push(Array.from({ length: m + n }, (_, j) => (j - i >= 0 && j - i <= m ? cf[m - (j - i)] : ZERO)));
  for (let i = 0; i < m; i++) S.push(Array.from({ length: m + n }, (_, j) => (j - i >= 0 && j - i <= n ? cg[n - (j - i)] : ZERO)));
  let R: Expr;
  try { R = expand(det(S)); } catch (err) { if (err instanceof CasError) return null; throw err; }
  if (isZero(R) || freeOf(R, x)) return null;
  let rx: SolveResult;
  try { rx = solveEquation(R, x); } catch (err) { if (err instanceof CasError) return null; throw err; }
  if (rx.kind !== 'list') return rx.kind === 'none' ? { kind: 'none' } : null;
  const list: Expr[][] = [];
  for (const s of rx.sols) {
    const xv = s.exact ?? (s.approx ? numFromBF(s.approx) : null);
    if (!xv) continue;
    const others = fs.map(h => expand(subst(h, x, xv)));
    const first = others.find(h => !freeOf(h, y));
    if (!first) continue;
    let ry: SolveResult;
    try { ry = solveEquation(first, y); } catch (err) { if (err instanceof CasError) continue; throw err; }
    if (ry.kind !== 'list') continue;
    for (const t of ry.sols) {
      const yv = t.exact ?? (t.approx ? numFromBF(t.approx) : null);
      if (yv && others.every(h => { const v = subst(h, y, yv); return isConstant(v) ? residualSmall(v) || isNearZero(v) : vanishes(v); })) list.push([xv, yv]);
    }
  }
  const uniq: Expr[][] = [];
  for (const s of list) if (!uniq.some(u => u.every((e, k) => same(e, s[k]) || nearlySame(e, s[k])))) uniq.push(s);
  return uniq.length ? { kind: 'solutions', list: uniq } : { kind: 'none' };
}

/** v = each of `values` from equation i; solve the rest, then fill v back in. */
function eliminate(fs: Expr[], vars: string[], i: number, v: string, values: Expr[], depth: number): SystemResult {
  const rest = vars.filter(w => w !== v);
  const all: Expr[][] = [];
  let anyParam = false, unknownNote: string | null = null, family = false;
  const notes: string[] = [];
  for (const value of values) {
    let others: Expr[];
    try { others = fs.filter((_, j) => j !== i).map(f => expand(numDen(cancel(together(subst(f, v, value))))[0])).filter(f => !isZero(f)); } catch (err) { if (err instanceof CasError) continue; throw err; }
    // an equation left without unknowns either holds (for every value of the parameters) or rules this branch out
    if (others.some(f => rest.every(w => freeOf(f, w)) && !(isConstant(f) ? isNearZero(f) : vanishes(f)))) continue;
    const sub_ = others.filter(f => !rest.every(w => freeOf(f, w)));
    const r = sub_.length ? nonlinear(sub_, rest, depth + 1) : { kind: 'param' as const, values: rest.map(w => sym(w)), free: rest };
    if (r.kind === 'solutions') {
      if (r.note) notes.push(r.note);
      if (r.family) family = true;
      for (const sol of r.list) {
        const full: Expr[] = [];
        let vv = value;
        rest.forEach((w, k) => { vv = subst(vv, w, sol[k]); });
        vars.forEach(w => full.push(w === v ? expand(vv) : sol[rest.indexOf(w)]));
        if (full.every(e => isConstant(e))) {
          const z = full.map(e => approx(e));
          if (z.some(c => !Number.isFinite(c.re) || !Number.isFinite(c.im))) continue;
        }
        all.push(full);
      }
    } else if (r.kind === 'param') anyParam = true;
    else if (r.kind === 'unknown') unknownNote = r.note;
  }
  // a branch that couldn't be solved is not a branch without solutions: never claim "none" past it
  if (unknownNote !== null && !all.length) return { kind: 'unknown', note: unknownNote };
  if (!all.length) return anyParam ? { kind: 'unknown', note: 'Układ ma nieskończenie wiele rozwiązań.' } : { kind: 'none' };
  const uniq: Expr[][] = [];
  for (const s of all) if (!uniq.some(u => u.every((e, k) => same(e, s[k]) || nearlySame(e, s[k])))) uniq.push(s);
  const note = [...new Set(notes), ...(unknownNote !== null ? ['Części rozwiązań nie udało się wyznaczyć dokładnie; mogą istnieć inne.'] : [])].join(' ') || undefined;
  return { kind: 'solutions', list: uniq, note, family };
}
function nearlySame(a: Expr, b: Expr): boolean {
  if (!isConstant(a) || !isConstant(b)) return false;
  const x = approx(a), y = approx(b);
  return Math.abs(x.re - y.re) + Math.abs(x.im - y.im) < 1e-10 * Math.max(1, Math.abs(x.re));
}
function isNearZero(e: Expr): boolean {
  if (isZero(e) || isZero(expand(e))) return true;
  if (!isConstant(e)) return false;
  try { const z = evalC(e, 300); return Math.max(top(z.re), top(z.im)) < -240; } catch { return false; }
}

// --- Intervals ---

export interface Interval { lo: Expr | null; hi: Expr | null; loClosed: boolean; hiClosed: boolean }
export interface IntervalSet { parts: Interval[]; note?: string }

const val = (e: Expr | null, side: -1 | 1) => (e === null ? side * Infinity : approx(e).re);

/** Real solutions of f ⋚ 0 (op one of <, <=, >, >=, !=) as a union of intervals with exact ends. */
export function solveInequality(f: Expr, op: string, x: string): IntervalSet {
  const dom = domain(f, x);
  const t = cancel(together(f));
  const [N, D] = numDen(t);
  const pts: { e: Expr; v: number; zero: boolean }[] = [];
  const addPts = (g: Expr, zero: boolean) => {
    if (freeOf(g, x)) return;
    const r = solveEquation(g, x);
    if (r.kind === 'all') return;
    if (r.kind === 'list') {
      if (r.sols.some(s => s.family)) fail('Nierówności z rozwiązaniami okresowymi (np. trygonometryczne) nie rozwiązuję w całości.');
      if (r.numericRange) fail('Nie znalazłem wszystkich miejsc zerowych dokładnie, więc nie rozstrzygnę nierówności.');
      for (const s of r.sols) {
        if (!s.approx || !isRealC(s.approx)) continue;
        const v = bfToNumber(s.approx.re);
        const e = s.exact ?? numFromBF(s.approx);
        const at = pts.find(p => Math.abs(p.v - v) < 1e-12 * Math.max(1, Math.abs(v)));
        if (at) { at.zero ||= zero; } else pts.push({ e, v, zero });
      }
    }
  };
  addPts(N, true);
  addPts(D, false);
  for (const iv of dom.parts) {
    for (const [e] of [[iv.lo], [iv.hi]] as [Expr | null][]) {
      if (!e) continue;
      const v = approx(e).re;
      if (!pts.some(p => Math.abs(p.v - v) < 1e-12 * Math.max(1, Math.abs(v)))) pts.push({ e, v, zero: false });
    }
  }
  pts.sort((a, b) => a.v - b.v);
  const g = compileDouble(f, x);
  const holds = (y: number) => op === '<' ? y < 0 : op === '<=' ? y <= 0 : op === '>' ? y > 0 : op === '>=' ? y >= 0 : y !== 0;
  const inDom = (v: number) => dom.parts.some(iv => (v > val(iv.lo, -1) || (iv.loClosed && v === val(iv.lo, -1))) && (v < val(iv.hi, 1) || (iv.hiClosed && v === val(iv.hi, 1))));
  const sample = (v: number) => {
    const y = g(v);
    if (Number.isFinite(y) && Math.abs(y) > 1e-9) return y;
    // close to zero in double precision: decide at 100 digits
    try { const z = evalC(subst(f, x, num(qFromDouble(v))), 340); return bfToNumber(z.re); } catch { return NaN; }
  };
  const parts: Interval[] = [];
  const push = (iv: Interval) => {
    const last = parts[parts.length - 1];
    // glue (a, b) ∪ [b] ∪ (b, c)
    if (last && last.hi && iv.lo && same(last.hi, iv.lo) && (last.hiClosed || iv.loClosed)) { last.hi = iv.hi; last.hiClosed = iv.hiClosed; return; }
    parts.push(iv);
  };
  const edges = [null, ...pts.map(p => p.e), null];
  const evs = [-Infinity, ...pts.map(p => p.v), Infinity];
  for (let k = 0; k + 1 < edges.length; k++) {
    const a = evs[k], b = evs[k + 1];
    const mid = !Number.isFinite(a) ? (Number.isFinite(b) ? b - Math.max(1, Math.abs(b)) : 0) : !Number.isFinite(b) ? a + Math.max(1, Math.abs(a)) : (a + b) / 2;
    if (inDom(mid) && holds(sample(mid))) push({ lo: edges[k], hi: edges[k + 1], loClosed: false, hiClosed: false });
    // the point b itself
    if (k + 1 < edges.length - 1) {
      const p = pts[k];
      const ok = inDom(p.v) && (p.zero ? holds(0) && !(op === '!=') : holds(sample(p.v)));
      if (ok && (!(isZero(D)) && (() => { try { const z = evalC(subst(D, x, p.e), 200); return !!(z.re.m || z.im.m); } catch { return false; } })())) push({ lo: p.e, hi: p.e, loClosed: true, hiClosed: true });
    }
  }
  // merge touching neighbours: (a, b) then [b, b] then (b, c)
  const merged: Interval[] = [];
  for (const iv of parts) {
    const last = merged[merged.length - 1];
    if (last && last.hi && iv.lo && same(last.hi, iv.lo) && (last.hiClosed || iv.loClosed)) { last.hi = iv.hi; last.hiClosed = iv.hiClosed; }
    else merged.push({ ...iv });
  }
  return { parts: merged, note: dom.note };
}

/** The real domain of f as intervals, plus a note for periodic exclusions (tg, ctg). */
export function domain(f: Expr, x: string): IntervalSet {
  let parts: Interval[] = [{ lo: null, hi: null, loClosed: false, hiClosed: false }];
  const notes: string[] = [];
  const conds: [Expr, string][] = [];
  const visit = (e: Expr) => {
    if (freeOf(e, x)) return;
    if (e.k === '^') {
      if (isNum(e.e)) {
        if (e.e.v.d % 2n === 0n) conds.push([e.b, qsign(e.e.v) < 0 ? '>' : '>=']);
        else if (qsign(e.e.v) < 0) conds.push([e.b, '!=']);
      } else if (!freeOf(e.e, x) && !isSym(e.b, 'e') && !(isNum(e.b) && qsign(e.b.v) > 0)) conds.push([e.b, '>']);
    }
    if (e.k === 'f') {
      const u = e.a[0];
      switch (e.n) {
        case 'ln': conds.push([u, '>']); break;
        case 'asin': case 'acos': conds.push([sub(u, ONE), '<='], [add(u, ONE), '>=']); break;
        case 'acosh': conds.push([sub(u, ONE), '>=']); break;
        case 'atanh': conds.push([sub(ONE, pow(u, TWO)), '>']); break;
        case 'tan': case 'sec': if (!freeOf(u, x)) notes.push(`cos(${textU(u)}) ≠ 0`); break;
        case 'cot': case 'csc': if (!freeOf(u, x)) notes.push(`sin(${textU(u)}) ≠ 0`); break;
      }
    }
    children(e).forEach(visit);
  };
  visit(f);
  for (const [g, op] of conds) {
    const s = solveInequalityRaw(g, op, x);
    parts = intersect(parts, s);
  }
  return { parts, note: notes.length ? `Ponadto ${notes.join(', ')}.` : undefined };
}
let textU: (e: Expr) => string = e => key(e);
export function setDomainText(f: (e: Expr) => string) { textU = f; }

/** g op 0 for a condition of the domain (g itself is defined wherever this is asked). */
function solveInequalityRaw(g: Expr, op: string, x: string): Interval[] {
  return solveInequality(g, op, x).parts;
}

export function intersect(A: Interval[], B: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const a of A) for (const b of B) {
    const loA = val(a.lo, -1), loB = val(b.lo, -1), hiA = val(a.hi, 1), hiB = val(b.hi, 1);
    const lo = loA > loB ? a : loB > loA ? b : (a.loClosed ? b : a);
    const hi = hiA < hiB ? a : hiB < hiA ? b : (a.hiClosed ? b : a);
    const L = val(lo.lo, -1), H = val(hi.hi, 1);
    if (L > H || (L === H && !(lo.loClosed && hi.hiClosed))) continue;
    out.push({ lo: lo.lo, hi: hi.hi, loClosed: lo.loClosed, hiClosed: hi.hiClosed });
  }
  return out;
}

