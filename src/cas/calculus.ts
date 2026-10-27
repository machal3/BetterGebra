/**
 * Derivatives, truncated power series (Taylor/Laurent) with exact coefficients, and limits. A limit is taken
 * from the series' leading term when the expression has a Laurent expansion at the point; otherwise by
 * structural rules with l'Hôpital's rule; every answer is cross-checked numerically at 100 digits.
 */
import { E, Expr, MINUS_ONE, same, ONE, PI, TWO, ZERO, add, div, expand, fn, freeOf, infSign, isConstant, isInf, isNum, isSym, isZero, mul, neg, num, numDen, pow, sqrt, sub, subst, sym, together, mapChildren, isInt, HALF , children } from './expr';
import { evalC, approx } from './numeric';
import { compileDouble } from './fast';
import { CasError, Q, fail, q, qint, qsign } from './q';
import { bfToNumber, top } from './bigfloat';
import { lnPrimes } from './simplify';

// --- Derivatives ---

/** d/dx e. Fails (CasError) for functions without a derivative here (Γ, ζ, Re, …). */
export function diff(e: Expr, x: string): Expr {
  if (freeOf(e, x)) return ZERO;
  switch (e.k) {
    case 'n': return ZERO;
    case 's': return e.n === x ? ONE : ZERO;
    case '+': return add(...e.t.map(t => diff(t, x)));
    case '*': return add(...e.t.map((f, i) => mul(diff(f, x), ...e.t.filter((_, j) => j !== i))));
    case '^': {
      const { b, e: p } = e;
      if (freeOf(p, x)) return mul(p, pow(b, sub(p, ONE)), diff(b, x));
      if (freeOf(b, x)) return mul(e, fn('ln', b), diff(p, x));
      return mul(e, add(mul(diff(p, x), fn('ln', b)), mul(p, diff(b, x), pow(b, MINUS_ONE))));
    }
    case 'f': {
      if (e.a.length !== 1) {
        if (e.n === 'log') return diff(div(fn('ln', e.a[1]), fn('ln', e.a[0])), x);
        return fail(`Nie umiem obliczyć pochodnej funkcji ${e.n}.`);
      }
      const u = e.a[0], du = diff(u, x);
      if (isZero(du)) return ZERO;
      return mul(outer(e.n, u), du);
    }
  }
}

/** f′(u) for f(u). */
function outer(n: string, u: Expr): Expr {
  const u2 = pow(u, TWO);
  switch (n) {
    case 'sin': return fn('cos', u);
    case 'cos': return neg(fn('sin', u));
    case 'tan': return pow(fn('cos', u), num(-2));
    case 'cot': return neg(pow(fn('sin', u), num(-2)));
    case 'sec': return mul(fn('sec', u), fn('tan', u));
    case 'csc': return neg(mul(fn('csc', u), fn('cot', u)));
    case 'asin': return pow(sub(ONE, u2), num(-1, 2));
    case 'acos': return neg(pow(sub(ONE, u2), num(-1, 2)));
    case 'atan': return pow(add(ONE, u2), MINUS_ONE);
    case 'acot': return neg(pow(add(ONE, u2), MINUS_ONE));
    case 'asec': return pow(mul(fn('abs', u), sqrt(sub(u2, ONE))), MINUS_ONE);
    case 'acsc': return neg(pow(mul(fn('abs', u), sqrt(sub(u2, ONE))), MINUS_ONE));
    case 'sinh': return fn('cosh', u);
    case 'cosh': return fn('sinh', u);
    case 'tanh': return pow(fn('cosh', u), num(-2));
    case 'coth': return neg(pow(fn('sinh', u), num(-2)));
    case 'sech': return neg(mul(fn('sech', u), fn('tanh', u)));
    case 'csch': return neg(mul(fn('csch', u), fn('coth', u)));
    case 'asinh': return pow(add(u2, ONE), num(-1, 2));
    case 'acosh': return pow(mul(sqrt(sub(u, ONE)), sqrt(add(u, ONE))), MINUS_ONE);
    case 'atanh': case 'acoth': return pow(sub(ONE, u2), MINUS_ONE);
    case 'ln': return pow(u, MINUS_ONE);
    case 'abs': return mul(u, pow(fn('abs', u), MINUS_ONE));
    case 'sign': case 'floor': case 'ceil': case 'round': return ZERO;
    case 'frac': return ONE;
    case 'erf': return mul(TWO, pow(PI, num(-1, 2)), pow(E, neg(u2)));
    case 'erfc': return neg(mul(TWO, pow(PI, num(-1, 2)), pow(E, neg(u2))));
  }
  return fail(`Nie umiem obliczyć pochodnej funkcji ${n}.`);
}

export function diffN(e: Expr, x: string, n: number): Expr {
  for (let k = 0; k < n; k++) e = diff(e, x);
  return e;
}

// --- Truncated Laurent series in t at 0 ---

/** Σ c[k]·t^(v+k), known for exponents below o. */
export interface Ser { v: number; c: Expr[]; o: number }
class SeriesFail extends Error {}
const nope = (): never => { throw new SeriesFail(); };
const zeroTest = (e: Expr) => isZero(e) || isZero(expand(e)) || (isConstant(e) && (isZero(expand(together(e))) || isZero(expand(lnPrimes(e)))));

function sNorm(s: Ser): Ser {
  let k = 0;
  while (k < s.c.length && zeroTest(s.c[k])) k++;
  const c = s.c.slice(k).map(v => v);
  return { v: s.v + k, c, o: s.o };
}
const sConst = (e: Expr, o: number): Ser => sNorm({ v: 0, c: Array.from({ length: Math.max(0, o) }, (_, k) => k ? ZERO : e), o });
function sAdd(a: Ser, b: Ser): Ser {
  const o = Math.min(a.o, b.o), v = Math.min(a.v, b.v);
  const c: Expr[] = [];
  for (let e = v; e < o; e++) c.push(add(a.c[e - a.v] ?? ZERO, b.c[e - b.v] ?? ZERO));
  return sNorm({ v, c, o });
}
function sMul(a: Ser, b: Ser): Ser {
  const v = a.v + b.v, o = Math.min(a.o + b.v, b.o + a.v);
  const c: Expr[] = [];
  for (let e = v; e < o; e++) {
    const terms: Expr[] = [];
    for (let i = 0; i < a.c.length; i++) {
      const j = e - v - i;
      if (j >= 0 && j < b.c.length) terms.push(mul(a.c[i], b.c[j]));
    }
    c.push(expand(add(...terms)));
  }
  return sNorm({ v, c, o });
}
function sInv(a: Ser): Ser {
  if (!a.c.length) nope();
  const n = a.o - a.v, c0 = a.c[0], b: Expr[] = [pow(c0, MINUS_ONE)];
  for (let k = 1; k < n; k++) {
    const terms: Expr[] = [];
    for (let i = 1; i <= k; i++) if (a.c[i]) terms.push(mul(a.c[i], b[k - i]));
    b.push(expand(mul(MINUS_ONE, b[0], add(...terms))));
  }
  return sNorm({ v: -a.v, c: b, o: n - a.v });
}
function sScale(a: Ser, k: Expr): Ser { return sNorm({ v: a.v, c: a.c.map(c => expand(mul(k, c))), o: a.o }); }

/** f(a0 + u) = Σ f^(k)(a0)/k! u^k, with u of positive valuation. */
function sCompose(name: string | ((y: Expr) => Expr), a: Ser, o: number): Ser {
  if (a.v < 0) nope();
  const a0 = a.v === 0 ? a.c[0] : ZERO;
  const u = sAdd(a, sConst(neg(a0), a.o));
  const y = 'ŷ'; // a variable name that can't clash with input
  let f: Expr = typeof name === 'string' ? fn(name, sym(y)) : name(sym(y));
  const terms = u.v >= 1 ? Math.ceil(o / u.v) + 1 : o;
  let out = sConst(ZERO, o), uk = sConst(ONE, o);
  let fact = 1n;
  for (let k = 0; k <= terms; k++) {
    if (k) fact *= BigInt(k);
    let coef: Expr;
    try { coef = subst(f, y, a0); } catch (err) { if (err instanceof CasError) nope(); throw err; }
    if (!freeOf(coef, y) || isInf(coef)) nope();
    out = sAdd(out, sScale(uk, mul(coef, num(q(1n, fact)))));
    if (k < terms) { uk = sMul(uk, u); f = diff(f, y); }
    if (uk.v >= o) break;
  }
  return { ...out, o: Math.min(out.o, o) };
}

function sPow(a: Ser, r: Expr, o: number): Ser {
  if (!a.c.length) { if (isNum(r) && qsign(r.v) > 0) return { v: o, c: [], o }; nope(); }
  if (isNum(r) && qint(r.v)) {
    let n = r.v.n;
    let base = a;
    if (n < 0n) { base = sInv(a); n = -n; }
    let out = sConst(ONE, o);
    while (n) { if (n & 1n) out = sMul(out, base); n >>= 1n; if (n) base = sMul(base, base); }
    return out;
  }
  // a = c0 t^v (1 + w): a^r = c0^r t^(vr) (1 + w)^r, valid when v·r is an integer
  if (!isNum(r)) nope();
  const rv = r as { v: Q };
  const vr = q(BigInt(a.v) * rv.v.n, rv.v.d);
  if (!qint(vr)) nope();
  const c0 = a.c[0];
  const w = sScale({ v: 0, c: a.c, o: a.o - a.v }, pow(c0, MINUS_ONE));
  const body = sCompose(y => pow(y, r), w, o - Number(vr.n));
  return sScale({ v: body.v + Number(vr.n), c: body.c, o: body.o + Number(vr.n) }, pow(c0, r));
}

/** Series of e in t to absolute order o; throws SeriesFail when e has no Laurent expansion at 0. */
function series(e: Expr, t: string, o: number): Ser {
  // Negative valuations eat precision in products and quotients: recompute with more terms until o is reached.
  let slack = 0;
  for (let k = 0; k < 6; k++) {
    const s = seriesRaw(e, t, o + slack);
    if (s.o >= o) {
      const keep = Math.max(0, Math.min(s.c.length, o - s.v));
      return { v: s.v, c: s.c.slice(0, keep), o };
    }
    slack += o - s.o + 2;
  }
  return nope();
}
function seriesRaw(e: Expr, t: string, o: number): Ser {
  if (freeOf(e, t)) return sConst(e, o);
  switch (e.k) {
    case 's': return { v: 1, c: [ONE], o: Math.max(o, 1) };
    case '+': return e.t.map(x => series(x, t, o)).reduce(sAdd);
    case '*': return e.t.map(f => series(f, t, o)).reduce(sMul);
    case '^': {
      if (isSym(e.b, 'e')) return sExp(series(e.e, t, o), o);
      if (freeOf(e.e, t)) return sPow(series(e.b, t, o), e.e, o);
      // b^p = e^(p ln b)
      return series(pow(E, mul(e.e, fn('ln', e.b))), t, o);
    }
    case 'f': {
      if (e.a.length !== 1) nope();
      const a = series(e.a[0], t, o);
      // ln t, |t|, ⌊t⌋ … have no Laurent expansion at a zero / breakpoint of their argument
      if (e.n === 'ln' && a.v !== 0) nope();
      if ((e.n === 'abs' || e.n === 'sign') && (a.v !== 0 || constSignOf(a.c[0]) === null)) nope();
      if ((e.n === 'floor' || e.n === 'ceil' || e.n === 'frac') && (a.v !== 0 || !isConstant(a.c[0]) || isInt(a.c[0]) || !isInt(fn('floor', a.c[0])))) nope();
      if (e.n === 'round' && (a.v !== 0 || !isConstant(a.c[0]) || isInt(add(a.c[0], HALF)) || !isInt(fn('round', a.c[0])))) nope();
      return sCompose(e.n, a, o);
    }
    case 'n': return sConst(e, o);
  }
}
function sExp(a: Ser, o: number): Ser { return sCompose('exp', a, o); }

/** Taylor polynomial of e in x at a up to x^n (exact coefficients), or null when there's no such expansion. */
export function taylor(e: Expr, x: string, a: Expr, n: number): { terms: Expr[]; v: number } | null {
  const t = 'ţ';
  const shifted = infSign(a) ? subst(e, x, pow(sym(t), MINUS_ONE)) : subst(e, x, add(a, sym(t)));
  try {
    const s = series(shifted, t, n + 1);
    const out: Expr[] = [];
    const base = infSign(a) ? pow(sym(x), MINUS_ONE) : sub(sym(x), a);
    s.c.forEach((c, k) => {
      const exp = s.v + k;
      if (exp <= n) out.push(mul(c, pow(base, num(exp))));
    });
    return { terms: out, v: s.v };
  } catch (err) {
    if (err instanceof SeriesFail) return null;
    throw err;
  }
}

// --- Limits ---

export type Lim = { kind: 'fin'; v: Expr } | { kind: 'inf'; s: 1 | -1 } | { kind: 'none'; left?: Lim; right?: Lim } | { kind: 'bounded' };

const fin = (v: Expr): Lim => ({ kind: 'fin', v });

/**
 * lim e for x → a. dir: 0 two-sided, 1 from the right (x > a), −1 from the left. a may be ±∞.
 * Returns null when no method here decides it.
 */
export function limit(e: Expr, x: string, a: Expr, dir: -1 | 0 | 1 = 0): Lim | null {
  const s = infSign(a);
  if (s) return oneSided(e, x, a, s > 0 ? -1 : 1);
  if (dir) return oneSided(e, x, a, dir);
  // ln x at 0, √(1 − x) at 1: on one side there is no real function to have a limit, the other side decides
  const offL = offDomain(e, x, a, -1), offR = offDomain(e, x, a, 1);
  if (offL !== offR) return oneSided(e, x, a, offL ? 1 : -1);
  const r = oneSided(e, x, a, 1), l = oneSided(e, x, a, -1);
  if (!r || !l) return null;
  if (sameLim(l, r)) return r;
  if (l.kind === 'bounded' && r.kind === 'bounded') return r;
  return { kind: 'none', left: l, right: r };
}
/**
 * Near a on side dir, a logarithm, root or arc function inside e has no real value (acos x / √(1 − x) past 1).
 * Only their arguments are evaluated, in doubles: sin(sinh(3/x)) near 0 would take forever at high precision.
 */
function offDomain(e: Expr, x: string, a: Expr, dir: -1 | 1): boolean {
  if (!isConstant(a) || !freeOf(e, 'i')) return false;
  const A = approx(a).re;
  if (!Number.isFinite(A)) return false;
  const tests: ((x: number) => boolean)[] = [];
  const visit = (u: Expr) => {
    if (freeOf(u, x)) return;
    const arg = (v: Expr) => { try { return compileDouble(v, x); } catch { return null; } };
    if (u.k === '^' && !isInt(u.e)) {
      const b = arg(u.b);
      if (b) tests.push(t => b(t) < 0);
    } else if (u.k === 'f') {
      const g = arg(u.a[u.a.length - 1]);
      const bad: Record<string, (v: number) => boolean> = {
        ln: v => v <= 0, log: v => v <= 0, asin: v => Math.abs(v) > 1, acos: v => Math.abs(v) > 1, acosh: v => v < 1, atanh: v => Math.abs(v) >= 1,
      };
      if (g && bad[u.n]) tests.push(t => bad[u.n](g(t)));
    }
    children(u).forEach(visit);
  };
  visit(e);
  return tests.length > 0 && [1e-6, 1e-9, 1e-12].every(h => {
    const t = A + dir * h * Math.max(1, Math.abs(A));
    return t !== A && tests.some(test => test(t));
  });
}
function sameLim(a: Lim, b: Lim): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'fin' && b.kind === 'fin') return zeroTest(sub(a.v, b.v)) || closeConst(a.v, b.v);
  if (a.kind === 'inf' && b.kind === 'inf') return a.s === b.s;
  return false;
}
function closeConst(a: Expr, b: Expr): boolean {
  if (!isConstant(a) || !isConstant(b)) return false;
  try { const d = evalC(sub(a, b), 400); return (!d.re.m || top(d.re) < -350) && (!d.im.m || top(d.im) < -350); } catch { return false; }
}

/** One side: x = a + dir·t (or x = dir/t at infinity with dir = sign) and t → 0⁺. */
function oneSided(e: Expr, x: string, a: Expr, dir: -1 | 1): Lim | null {
  const t = 'ţ', T = sym(t);
  const inf = infSign(a);
  const sub0 = assumePositive(inf ? subst(e, x, div(num(inf), T)) : subst(e, x, add(a, mul(num(dir), T))), t);
  let result = viaSeries(sub0, t);
  if (!result) result = structural(sub0, t, 0);
  const check = numericLimit(sub0, t);
  if (result && check && !agrees(result, check)) {
    // the numeric evidence disagrees with the symbolic answer: trust neither
    return null;
  }
  return result;
}

/**
 * Rewrites valid because t > 0 near the limit: (t^a)^b = t^(ab), |u| = ±u and sgn u = ±1 when u keeps one sign
 * for small t.
 */
function assumePositive(e: Expr, t: string): Expr {
  if (e.k === 'n' || e.k === 's') return e;
  const m = mapChildren(e, c => assumePositive(c, t));
  if (m.k === '^' && m.b.k === '^' && isSym(m.b.b, t)) return pow(m.b.b, mul(m.b.e, m.e));
  if (m.k === 'f' && m.a.length === 1 && !freeOf(m.a[0], t)) {
    const u = m.a[0];
    if (m.n === 'abs' || m.n === 'sign') {
      const s = sideOf(u, t);
      if (s) return m.n === 'abs' ? mul(num(s), u) : num(s);
    }
    if (m.n === 'floor' || m.n === 'ceil' || m.n === 'frac' || m.n === 'round') {
      let c0: Expr | null = null;
      try { c0 = subst(u, t, ZERO); } catch { c0 = null; }
      if (c0 && freeOf(c0, t)) {
        if ((m.n === 'floor' || m.n === 'ceil' || m.n === 'frac') && isInt(c0)) {
          const s = sideOf(sub(u, c0), t);
          if (s === 1) return m.n === 'floor' ? c0 : m.n === 'ceil' ? add(c0, ONE) : sub(u, c0);
          if (s === -1) return m.n === 'floor' ? sub(c0, ONE) : m.n === 'ceil' ? c0 : add(sub(u, c0), ONE);
        }
        if (m.n === 'round' && isInt(add(c0, HALF))) {
          const s = sideOf(sub(u, c0), t);
          if (s === 1) return add(c0, HALF);
          if (s === -1) return sub(c0, HALF);
        }
      }
    }
  }
  return m;
}

/** Leading term of the Laurent series at t → 0⁺. */
function viaSeries(e: Expr, t: string): Lim | null {
  for (const o of [4, 8, 16]) {
    let s: Ser;
    try { s = series(e, t, o); } catch (err) { if (err instanceof SeriesFail || err instanceof CasError) return null; throw err; }
    if (!s.c.length) continue; // everything cancelled to this order
    if (s.v > 0) return fin(ZERO);
    if (s.v === 0) return fin(s.c[0]);
    const sg = constSignOf(s.c[0]);
    if (sg === null) return null;
    return { kind: 'inf', s: sg };
  }
  return null;
}
function constSignOf(e: Expr): 1 | -1 | null {
  if (!isConstant(e)) return null;
  const v = approx(e);
  if (!Number.isFinite(v.re) || Math.abs(v.im) > 1e-12 * Math.abs(v.re) || v.re === 0) return null;
  return v.re > 0 ? 1 : -1;
}

/** Structural rules at t → 0⁺, with l'Hôpital for 0/0 and ∞/∞. */
function structural(e: Expr, t: string, depth: number): Lim | null {
  if (depth > 12) return null;
  if (freeOf(e, t)) return fin(e);
  const rec = (f: Expr) => structural(f, t, depth + 1);
  if (isSym(e, t)) return fin(ZERO);
  if (e.k === '+') {
    const parts = e.t.map(rec);
    // ∞ − ∞ or a term out of reach: l'Hôpital on one fraction, and failing that the logarithms taken apart
    // (ln n!/n − ln n only cancels once ln n! is Stirling's sum)
    const hard = () => lhospital(e, t, depth) ?? safeRec(() => { const f = expand(splitLogs(e, t, depth)); return same(f, e) ? null : f; }, t, depth + 2);
    if (parts.some(p => !p || p.kind === 'none')) return hard();
    const infs = parts.filter(p => p!.kind === 'inf') as { kind: 'inf'; s: 1 | -1 }[];
    if (infs.length) {
      if (infs.every(p => p.s === infs[0].s)) return infs[0];
      return hard();
    }
    if (parts.some(p => p!.kind === 'bounded')) return { kind: 'bounded' };
    return fin(add(...parts.map(p => (p as { v: Expr }).v)));
  }
  if (e.k === '*' || (e.k === '^' && isNum(e.e) && qsign(e.e.v) < 0)) {
    const [n, d] = numDen(e);
    let r: Lim | null;
    if (!isNum(d)) {
      const ln = rec(n), ld = rec(d);
      r = !ln || !ld ? lhospital(e, t, depth) : quotient(ln, ld, n, d, t, depth);
    } else {
      const parts = (e.k === '*' ? e.t : [e]).map(rec);
      r = parts.some(p => !p) ? null : productOf(parts as Lim[], e, t, depth);
    }
    return r ?? viaLog(e, t, depth);
  }
  if (e.k === '^') {
    if (freeOf(e.e, t)) {
      const b = rec(e.b);
      if (!b) return null;
      const p = e.e;
      if (b.kind === 'fin') {
        if (isZero(b.v)) {
          const side = sideOf(e.b, t);
          if (isNum(p) && qsign(p.v) > 0) return fin(ZERO);
          if (isNum(p) && qsign(p.v) < 0) {
            if (side === null) return null;
            if (side > 0 || (qint(p.v) && p.v.n % 2n === 0n)) return { kind: 'inf', s: 1 };
            if (qint(p.v)) return { kind: 'inf', s: -1 };
            return null;
          }
          return null;
        }
        try { return fin(pow(b.v, p)); } catch { return null; }
      }
      if (b.kind === 'inf') {
        if (!isNum(p)) return null;
        if (qsign(p.v) < 0) return fin(ZERO);
        if (b.s > 0) return { kind: 'inf', s: 1 };
        if (qint(p.v)) return { kind: 'inf', s: p.v.n % 2n ? -1 : 1 };
        return null;
      }
      return null;
    }
    // b^p = e^(p ln b), with ln b taken apart (logOf) so that ln t terms can cancel
    const inner = rec(mul(e.e, fn('ln', e.b))) ?? safeRec(() => expand(mul(e.e, logOf(e.b, t, depth))), t, depth);
    if (!inner) return viaLog(e, t, depth);
    return applyFn('exp', inner, t, e);
  }
  if (e.k === 'f' && e.a.length === 1) {
    const inner = rec(e.a[0]);
    // ln n!, ln Γ(u), ln of a product whose factors run off differently: logOf takes them apart (Stirling for Γ)
    if (e.n === 'ln' && (!inner || inner.kind === 'inf')) {
      const l = safeRec(() => { const L = expand(logOf(e.a[0], t, depth)); return L.k === 'f' && L.n === 'ln' ? null : L; }, t, depth);
      if (l) return l;
    }
    if (!inner) return null;
    if (inner.kind === 'fin' && isZero(inner.v) && (e.n === 'ln')) {
      const side = sideOf(e.a[0], t);
      return side === 1 ? { kind: 'inf', s: -1 } : null;
    }
    return applyFn(e.n, inner, t, e);
  }
  return null;
}

/**
 * lim P = s·e^(lim ln|P|) for a product P of constant sign s near the limit. In ln|P| products become sums, powers
 * factors, e^u becomes u, and ln Γ(u) for u → +∞ becomes Stirling's u ln u − u − ½ ln u + ½ ln 2π (the difference
 * tends to 0, so it may stand in a sum): e^(−1/t²)/t¹⁰ and n!/nⁿ, where l'Hôpital only goes round in circles.
 */
/** structural() of an expression that may fail to build. */
function safeRec(build: () => Expr | null, t: string, depth: number): Lim | null {
  if (depth > 9) return null;
  let f: Expr | null;
  try { f = build(); } catch (err) { if (err instanceof CasError) return null; throw err; }
  return f ? structural(f, t, depth + 2) : null;
}
function viaLog(e: Expr, t: string, depth: number): Lim | null {
  if (depth > 8) return null;
  const s = signNear(e, t, depth);
  if (s === null) return null;
  let L: Expr;
  try { L = expand(logOf(e, t, depth)); } catch (err) { if (err instanceof CasError) return null; throw err; }
  if (L.k === 'f' && L.n === 'ln') return null; // nothing came apart
  const l = viaSeries(L, t) ?? structural(L, t, depth + 4);
  if (!l || l.kind === 'none' || l.kind === 'bounded') return null;
  if (l.kind === 'inf') return l.s < 0 ? fin(ZERO) : { kind: 'inf', s };
  return fin(mul(num(s), pow(E, l.v)));
}
/**
 * Sign of e for small t > 0, factor by factor: e^u, t^p, Γ(u → +∞) and powers of positive constants are positive
 * however far they over- or underflow, where evaluating e at t = 10⁻⁸⁰ (sideOf) can't tell.
 */
function signNear(e: Expr, t: string, depth: number): 1 | -1 | null {
  if (isNum(e)) return e.v.n > 0n ? 1 : e.v.n < 0n ? -1 : null;
  if (e.k === '*') {
    let s = 1;
    for (const f of e.t) { const g = signNear(f, t, depth); if (g === null) return null; s *= g; }
    return s as 1 | -1;
  }
  if (e.k === '^' && (isSym(e.b, 'e') || isSym(e.b, t) || (freeOf(e.b, t) && constSignOf(e.b) === 1))) return 1;
  if (e.k === '^') {
    const b = signNear(e.b, t, depth);
    if (b === 1) return 1;
    if (isNum(e.e) && qint(e.e.v)) return b === null ? null : e.e.v.n % 2n ? b : 1;
  }
  if (e.k === 'f' && e.n === 'binomial' && e.a.length === 2) {
    const up = (u: Expr) => { const l = structural(u, t, depth + 1); return !!l && l.kind === 'inf' && l.s > 0; };
    if (up(e.a[0]) && up(e.a[1]) && up(sub(e.a[0], e.a[1]))) return 1;
  }
  if (e.k === 'f' && (e.n === 'gamma' || e.n === 'factorial') && e.a.length === 1) {
    const l = structural(e.a[0], t, depth + 1);
    if (l && l.kind === 'inf' && l.s > 0) return 1;
  }
  if (freeOf(e, t)) return constSignOf(e);
  return sideOf(e, t);
}
function logOf(f: Expr, t: string, depth: number): Expr {
  if (isNum(f)) return fn('ln', num(f.v.n < 0n ? -f.v.n : f.v.n, f.v.d));
  if (f.k === '*') return add(...f.t.map(g => logOf(g, t, depth)));
  if (f.k === '^') return isSym(f.b, 'e') ? f.e : mul(f.e, logOf(f.b, t, depth));
  if (f.k === 'f' && f.n === 'abs') return logOf(f.a[0], t, depth);
  if (f.k === 'f' && f.n === 'binomial' && f.a.length === 2) {
    const [a, b] = f.a;
    return sub(logOf(fn('factorial', a), t, depth), add(logOf(fn('factorial', b), t, depth), logOf(fn('factorial', sub(a, b)), t, depth)));
  }
  if (f.k === 'f' && (f.n === 'gamma' || f.n === 'factorial') && f.a.length === 1) {
    const u = f.n === 'gamma' ? f.a[0] : add(f.a[0], ONE);
    const l = structural(u, t, depth + 1);
    if (l && l.kind === 'inf' && l.s > 0) return add(mul(sub(u, HALF), logOf(u, t, depth)), neg(u), mul(HALF, fn('ln', mul(TWO, PI))));
  }
  if (!freeOf(f, t)) {
    // ln(1/t + 1) = ln(1 + t) − ln t: the leading power of t comes out, so ln t terms elsewhere can cancel against it
    let v: number | null = null;
    try { const ser = series(f, t, 3); if (ser.c.length) v = ser.v; } catch (err) { if (!(err instanceof SeriesFail || err instanceof CasError)) throw err; }
    if (v) {
      const g = expand(mul(f, pow(sym(t), num(-v))));
      // g itself goes under ln as it is: split again, sin(t)/t would come back as ln t + ln sin t
      return add(mul(num(v), fn('ln', sym(t))), lnSigned(g, t));
    }
  }
  return lnSigned(f, t);
}
/** Every ln(u) in e with u depending on t taken apart by logOf. */
function splitLogs(e: Expr, t: string, depth: number): Expr {
  if (e.k === 'n' || e.k === 's' || freeOf(e, t)) return e;
  if (e.k === 'f' && e.n === 'ln' && e.a.length === 1) return logOf(e.a[0], t, depth);
  return mapChildren(e, c => splitLogs(c, t, depth));
}
function lnSigned(f: Expr, t: string): Expr {
  const s = freeOf(f, t) ? null : sideOf(f, t);
  return fn('ln', s === 1 ? f : s === -1 ? neg(f) : fn('abs', f));
}

function applyFn(name: string, inner: Lim, t: string, whole: Expr): Lim | null {
  if (inner.kind === 'fin') {
    if (whole.k === 'f' && whole.a.length === 1) {
      const u = whole.a[0];
      if ((name === 'floor' || name === 'ceil' || name === 'frac') && isInt(inner.v)) {
        const s = sideOf(sub(u, inner.v), t);
        if (s === null) return null;
        if (name === 'floor') return fin(s > 0 ? inner.v : sub(inner.v, ONE));
        if (name === 'ceil') return fin(s > 0 ? add(inner.v, ONE) : inner.v);
        return fin(s > 0 ? ZERO : ONE);
      }
      if (name === 'round' && isInt(add(inner.v, HALF))) {
        const s = sideOf(sub(u, inner.v), t);
        if (s === null) return null;
        return fin(s > 0 ? add(inner.v, HALF) : sub(inner.v, HALF));
      }
      if (name === 'sign' && isZero(inner.v)) {
        const s = sideOf(u, t);
        return s === null ? null : fin(num(s));
      }
    }
    try {
      const v = name === 'exp' ? pow(E, inner.v) : fn(name, inner.v);
      if (isInf(v)) return { kind: 'inf', s: infSign(v) as 1 | -1 };
      return fin(v);
    } catch (err) {
      if (!(err instanceof CasError)) throw err;
      // a pole: tan(π/2), ln 0 … decide by the side numerically
      const s = sideOf(whole, t);
      return s === null ? null : { kind: 'inf', s };
    }
  }
  if (inner.kind === 'bounded') return name === 'exp' || name === 'atan' || name === 'tanh' || name === 'sin' || name === 'cos' ? { kind: 'bounded' } : null;
  if (inner.kind === 'inf') {
    const s = inner.s;
    switch (name) {
      case 'exp': return s > 0 ? { kind: 'inf', s: 1 } : fin(ZERO);
      case 'ln': return s > 0 ? { kind: 'inf', s: 1 } : null;
      case 'sqrt': return s > 0 ? { kind: 'inf', s: 1 } : null;
      case 'atan': return fin(mul(num(s, 2), PI));
      case 'acot': return fin(s > 0 ? ZERO : PI);
      case 'tanh': return fin(num(s));
      case 'coth': return fin(num(s));
      case 'sinh': case 'asinh': return { kind: 'inf', s };
      case 'cosh': return { kind: 'inf', s: 1 };
      case 'acosh': return s > 0 ? { kind: 'inf', s: 1 } : null;
      case 'erf': return fin(num(s));
      case 'erfc': return fin(s > 0 ? ZERO : TWO);
      case 'abs': return { kind: 'inf', s: 1 };
      case 'sin': case 'cos': return { kind: 'bounded' };
      case 'sech': case 'csch': return fin(ZERO);
      case 'gamma': case 'factorial': return s > 0 ? { kind: 'inf', s: 1 } : null;
      case 'sign': return fin(num(s));
    }
  }
  return null;
}

function productOf(parts: Lim[], e: Expr, t: string, depth: number): Lim | null {
  let zero = false, infSign_ = 1, inf = false, bounded = false;
  const vals: Expr[] = [];
  for (const p of parts) {
    if (p.kind === 'none') return null;
    if (p.kind === 'bounded') { bounded = true; continue; }
    if (p.kind === 'inf') { inf = true; infSign_ *= p.s; continue; }
    if (isZero(p.v)) zero = true;
    vals.push(p.v);
  }
  if (zero && inf) return lhospital(e, t, depth);
  if (zero) return fin(ZERO);
  if (bounded) return inf ? null : { kind: 'bounded' };
  if (inf) {
    const c = vals.length ? mul(...vals) : ONE;
    const s = constSignOf(c);
    if (s === null) return null;
    return { kind: 'inf', s: (s * infSign_) as 1 | -1 };
  }
  return fin(mul(...vals));
}

function quotient(ln: Lim, ld: Lim, n: Expr, d: Expr, t: string, depth: number): Lim | null {
  if (ln.kind === 'none' || ld.kind === 'none') return null;
  if (ln.kind === 'bounded') {
    if (ld.kind === 'inf') return fin(ZERO);
    return null;
  }
  if (ld.kind === 'bounded') return null;
  const nz = ln.kind === 'fin' && isZero(ln.v), dz = ld.kind === 'fin' && isZero(ld.v);
  if ((nz && dz) || (ln.kind === 'inf' && ld.kind === 'inf')) return lhospital(mul(n, pow(d, MINUS_ONE)), t, depth, [n, d]);
  if (ld.kind === 'inf') return fin(ZERO);
  if (dz) {
    // c/0: the side of the denominator decides
    if (ln.kind === 'inf') { const s = sideOf(d, t); return s === null ? null : { kind: 'inf', s: (ln.s * s) as 1 | -1 }; }
    const sn = constSignOf(ln.v), sd = sideOf(d, t);
    if (sn === null || sd === null) return null;
    return { kind: 'inf', s: (sn * sd) as 1 | -1 };
  }
  if (ln.kind === 'inf') {
    const s = constSignOf((ld as { v: Expr }).v);
    return s === null ? null : { kind: 'inf', s: (ln.s * s) as 1 | -1 };
  }
  return fin(div(ln.v, (ld as { v: Expr }).v));
}

function lhospital(e: Expr, t: string, depth: number, nd?: [Expr, Expr]): Lim | null {
  if (depth > 10) return null;
  let [n, d] = nd ?? numDen(together(e));
  // 0·∞ or ∞ − ∞ arrive as one expression; as a single fraction they become 0/0 or ∞/∞ (or decidable).
  if (!nd) {
    if (isNum(d) || freeOf(d, t)) {
      // still not a fraction in t: try e = n with a factor moved down: f·g = f/(1/g)
      if (e.k === '*' && e.t.length >= 2) {
        // factors grouped by their limits: the vanishing ones go down, the rest stays on top (x·ln x = ln x / (1/x));
        // a constant factor (−t·ln t) is not one of the two groups
        const lims = e.t.map(f => structural(f, t, depth + 1));
        if (lims.some(l => !l)) return null;
        const zeros = e.t.filter((_, k) => lims[k]!.kind === 'fin' && isZero((lims[k] as { v: Expr }).v));
        if (!zeros.length || zeros.length === e.t.length) return null;
        n = mul(...e.t.filter(f => !zeros.includes(f)));
        d = pow(mul(...zeros), MINUS_ONE);
      } else return null;
    }
    const ln = structural(n, t, depth + 1), ld = structural(d, t, depth + 1);
    if (!ln || !ld) return null;
    const both0 = ln.kind === 'fin' && isZero(ln.v) && ld.kind === 'fin' && isZero(ld.v);
    const bothInf = ln.kind === 'inf' && ld.kind === 'inf';
    if (!both0 && !bothInf) return quotient(ln, ld, n, d, t, depth + 1);
  }
  let dn: Expr, dd: Expr;
  // n!, Γ, ζ have no derivative here: then another method has to decide
  try { dn = diff(n, t); dd = diff(d, t); } catch (err) { if (err instanceof CasError) return null; throw err; }
  if (isZero(dd)) return null;
  const next = together(mul(dn, pow(dd, MINUS_ONE)));
  return structural(next, t, depth + 1);
}

/** Sign of e for small t > 0, from its value at t = 10⁻²⁰, 10⁻⁴⁰ (both must agree). */
function sideOf(e: Expr, t: string): 1 | -1 | null {
  let s: number | null = null;
  for (const k of [20, 40, 80]) {
    try {
      const z = evalC(subst(e, t, num(q(1n, 10n ** BigInt(k)))), 400);
      if (z.im.m && (!z.re.m || top(z.im) > top(z.re) - 300)) return null;
      const v = z.re.m > 0n ? 1 : z.re.m < 0n ? -1 : 0;
      if (!v) return null;
      if (s !== null && s !== v) return null;
      s = v;
    } catch { return null; }
  }
  return s as 1 | -1 | null;
}

/** e at t = 10⁻¹⁵, 10⁻³⁰, 10⁻⁶⁰ (200 digits): finite and settling, or growing without bound. */
function numericLimit(e: Expr, t: string): { kind: 'fin'; v: number } | { kind: 'inf'; s: number } | null {
  const vals: number[] = [];
  for (const k of [15, 30, 60]) {
    try {
      const z = evalC(subst(e, t, num(q(1n, 10n ** BigInt(k)))), 700);
      if (z.im.m && top(z.im) > Math.max(-600, top(z.re) - 600)) return null;
      vals.push(bfToNumber(z.re));
    } catch { return null; }
  }
  const [a, b, c] = vals;
  if ([a, b, c].every(v => Number.isFinite(v)) && Math.abs(c - b) <= 1e-6 * Math.max(1, Math.abs(c)) * 10 && Math.abs(c - b) <= Math.abs(b - a) + 1e-9) return { kind: 'fin', v: c };
  if (Math.abs(c) > 1e12 && Math.abs(c) > 10 * Math.abs(b) && Math.abs(b) > Math.abs(a) && Math.sign(c) === Math.sign(b)) return { kind: 'inf', s: Math.sign(c) };
  return null;
}
function agrees(sym_: Lim, n: { kind: 'fin'; v: number } | { kind: 'inf'; s: number }): boolean {
  if (sym_.kind === 'fin' && n.kind === 'fin') {
    if (!isConstant(sym_.v)) return true;
    const v = approx(sym_.v);
    return Math.abs(v.re - n.v) <= 1e-4 * Math.max(1, Math.abs(n.v));
  }
  if (sym_.kind === 'inf' && n.kind === 'inf') return sym_.s === n.s;
  if (sym_.kind === 'fin' && n.kind === 'inf') return false;
  if (sym_.kind === 'inf' && n.kind === 'fin') return false;
  return true;
}

