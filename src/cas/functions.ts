/**
 * Exact simplification rules of the named functions: special values (sin(π/5) = √(10 − 2√5)/4, arctg(2 − √3) = π/12,
 * Γ(7/2) = 15√π/8, ζ(4) = π⁴/90), symmetries, periodicity and inverse compositions. A rule returns null to leave
 * the call unevaluated; it never returns an approximation.
 */
import {
  E, Expr, HALF, I, INF, MINUS_ONE, ONE, PI, RULES, TWO, ZERO, add, div, expand, fn, freeOf, infSign, isConstant, isFn, isInt, isNegative, isNum, isOne,
  isSym, isZero, key, mul, neg, num, pow, same, split, sqrt, sub,
} from './expr';
import { signOf, evalC } from './numeric';
import { Q, Q1, QHALF, fail, q, qadd, qcmp, qfloor, qmul, qneg, qsign, qsub, qeq, MAX_BITS, bitLength } from './q';
import { bfFloor, bfAdd } from './bigfloat';

const raw = (n: string, ...a: Expr[]): Expr => ({ k: 'f', n, a });
const S = (k: number) => sqrt(num(k));
const qv = (n: number, d = 1) => q(n, d);

// --- Trigonometric tables: cos(rπ) for r ∈ [0, 1/2], tan(rπ) for r ∈ [0, 1/2) ---

let COS: Map<string, Expr> | null = null, TAN: Map<string, Expr> | null = null;
const rk = (r: Q) => `${r.n}/${r.d}`;
function tables() {
  if (COS && TAN) return;
  COS = new Map(); TAN = new Map();
  const c: [Q, Expr][] = [
    [qv(0), ONE],
    [qv(1, 12), mul(num(1, 4), add(S(6), S(2)))],
    [qv(1, 10), mul(num(1, 4), sqrt(add(num(10), mul(TWO, S(5)))))],
    [qv(1, 8), mul(HALF, sqrt(add(TWO, S(2))))],
    [qv(1, 6), mul(HALF, S(3))],
    [qv(1, 5), mul(num(1, 4), add(ONE, S(5)))],
    [qv(1, 4), mul(HALF, S(2))],
    [qv(3, 10), mul(num(1, 4), sqrt(sub(num(10), mul(TWO, S(5)))))],
    [qv(1, 3), HALF],
    [qv(3, 8), mul(HALF, sqrt(sub(TWO, S(2))))],
    [qv(2, 5), mul(num(1, 4), sub(S(5), ONE))],
    [qv(5, 12), mul(num(1, 4), sub(S(6), S(2)))],
    [qv(1, 2), ZERO],
  ];
  for (const [r, v] of c) COS.set(rk(r), v);
  const t: [Q, Expr][] = [
    [qv(0), ZERO],
    [qv(1, 12), sub(TWO, S(3))],
    [qv(1, 10), mul(num(1, 5), sqrt(sub(num(25), mul(num(10), S(5)))))],
    [qv(1, 8), sub(S(2), ONE)],
    [qv(1, 6), mul(num(1, 3), S(3))],
    [qv(1, 5), sqrt(sub(num(5), mul(TWO, S(5))))],
    [qv(1, 4), ONE],
    [qv(3, 10), mul(num(1, 5), sqrt(add(num(25), mul(num(10), S(5)))))],
    [qv(1, 3), S(3)],
    [qv(3, 8), add(S(2), ONE)],
    [qv(2, 5), sqrt(add(num(5), mul(TWO, S(5))))],
    [qv(5, 12), add(TWO, S(3))],
  ];
  for (const [r, v] of t) TAN.set(rk(r), v);
}
/** r reduced into [lo, lo + period). */
function reduce(r: Q, period: Q, lo: Q): Q {
  const k = qfloor(qdivQ(qsub(r, lo), period));
  return qsub(r, qmul(q(k), period));
}
const qdivQ = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);

/** cos(rπ), exact when the table has it; otherwise the canonical unevaluated form. */
function cosPi(r: Q): Expr {
  tables();
  r = reduce(r, qv(2), qv(0));                         // [0, 2)
  if (qcmp(r, Q1) > 0) r = qsub(qv(2), r);             // cos is even about π: [0, 1]
  if (qcmp(r, QHALF) > 0) return neg(cosPi(qsub(Q1, r)));
  return COS!.get(rk(r)) ?? raw('cos', mul(num(r), PI));
}
function sinPi(r: Q): Expr {
  r = reduce(r, qv(2), qv(0));                         // [0, 2)
  if (qcmp(r, Q1) > 0) return neg(sinPi(qsub(r, Q1)));  // sin(π + t) = −sin t
  if (qcmp(r, QHALF) > 0) r = qsub(Q1, r);             // sin(π − x) = sin x
  tables();
  const v = COS!.get(rk(qsub(QHALF, r)));
  return v ?? raw('sin', mul(num(r), PI));
}
function tanPi(r: Q): Expr {
  tables();
  r = reduce(r, Q1, qv(-1, 2));                         // [−1/2, 1/2)
  if (qeq(r, qv(-1, 2))) return fail('tg nie jest określony w π/2 + kπ.');
  if (qsign(r) < 0) return neg(tanPi(qneg(r)));
  return TAN!.get(rk(r)) ?? raw('tan', mul(num(r), PI));
}
function cotPi(r: Q): Expr {
  r = reduce(r, Q1, qv(0));
  if (!r.n) return fail('ctg nie jest określony w kπ.');
  return tanPi(qsub(QHALF, r));
}

/** arg = c·π + rest; c is the rational coefficient of the π term. */
function piPart(arg: Expr): [Q, Expr] {
  const terms = arg.k === '+' ? arg.t : [arg];
  for (const t of terms) {
    const [c, rest] = split(t);
    if (isSym(rest, 'pi')) return [c, arg.k === '+' ? add(...arg.t.filter(x => x !== t)) : ZERO];
  }
  return [qv(0), arg];
}
/** The argument with an imaginary factor taken off: i·u → u. */
function imaginaryFactor(arg: Expr): Expr | null {
  if (arg.k === '*' && arg.t.some(f => isSym(f, 'i'))) return div(arg, I);
  if (isSym(arg, 'i')) return ONE;
  return null;
}

const ONE_MINUS_SQ = (u: Expr) => sqrt(sub(ONE, pow(u, TWO)));
const ONE_PLUS_SQ = (u: Expr) => sqrt(add(ONE, pow(u, TWO)));

/** 1/(u ± v) with u², v² rational → (u ∓ v)/(u² − v²): keeps tables of sec and csc free of root denominators. */
export function reciprocal(x: Expr): Expr {
  const ex = expand(x);
  if (ex.k === '+' && ex.t.length === 2) {
    const [u, v] = ex.t, u2 = expand(pow(u, TWO)), v2 = expand(pow(v, TWO));
    if (isNum(u2) && isNum(v2) && !same(u2, v2)) return expand(div(sub(u, v), sub(u2, v2)));
  }
  return pow(x, MINUS_ONE);
}

RULES.sin = ([x]) => {
  const [c, rest] = piPart(x);
  if (isZero(rest)) return sinPi(c);
  if (c.n) {
    const m = reduce(c, qv(2), qv(0));
    const k = rk(m);
    if (k === '0/1') return fn('sin', rest);
    if (k === '1/1') return neg(fn('sin', rest));
    if (k === '1/2') return fn('cos', rest);
    if (k === '3/2') return neg(fn('cos', rest));
    if (!qeq(m, c)) return fn('sin', add(mul(num(m), PI), rest));
  }
  if (isNegative(x)) return neg(fn('sin', neg(x)));
  if (isFn(x, 'asin')) return x.a[0];
  if (isFn(x, 'acos')) return ONE_MINUS_SQ(x.a[0]);
  if (isFn(x, 'atan')) return div(x.a[0], ONE_PLUS_SQ(x.a[0]));
  const u = imaginaryFactor(x);
  if (u) return mul(I, fn('sinh', u));
  return null;
};
RULES.cos = ([x]) => {
  const [c, rest] = piPart(x);
  if (isZero(rest)) return cosPi(c);
  if (c.n) {
    const m = reduce(c, qv(2), qv(0));
    const k = rk(m);
    if (k === '0/1') return fn('cos', rest);
    if (k === '1/1') return neg(fn('cos', rest));
    if (k === '1/2') return neg(fn('sin', rest));
    if (k === '3/2') return fn('sin', rest);
    if (!qeq(m, c)) return fn('cos', add(mul(num(m), PI), rest));
  }
  if (isNegative(x)) return fn('cos', neg(x));
  if (isFn(x, 'acos')) return x.a[0];
  if (isFn(x, 'asin')) return ONE_MINUS_SQ(x.a[0]);
  if (isFn(x, 'atan')) return pow(ONE_PLUS_SQ(x.a[0]), MINUS_ONE);
  const u = imaginaryFactor(x);
  if (u) return fn('cosh', u);
  return null;
};
RULES.tan = ([x]) => {
  const [c, rest] = piPart(x);
  if (isZero(rest)) return tanPi(c);
  if (c.n) {
    const m = reduce(c, Q1, qv(0)), k = rk(m);
    if (k === '0/1') return fn('tan', rest);
    if (k === '1/2') return neg(fn('cot', rest));
    if (!qeq(m, c)) return fn('tan', add(mul(num(m), PI), rest));
  }
  if (isNegative(x)) return neg(fn('tan', neg(x)));
  if (isFn(x, 'atan')) return x.a[0];
  if (isFn(x, 'asin')) return div(x.a[0], ONE_MINUS_SQ(x.a[0]));
  if (isFn(x, 'acos')) return div(ONE_MINUS_SQ(x.a[0]), x.a[0]);
  const u = imaginaryFactor(x);
  if (u) return mul(I, fn('tanh', u));
  return null;
};
RULES.cot = ([x]) => {
  const [c, rest] = piPart(x);
  if (isZero(rest)) return cotPi(c);
  if (c.n) {
    const m = reduce(c, Q1, qv(0)), k = rk(m);
    if (k === '0/1') return fn('cot', rest);
    if (k === '1/2') return neg(fn('tan', rest));
    if (!qeq(m, c)) return fn('cot', add(mul(num(m), PI), rest));
  }
  if (isNegative(x)) return neg(fn('cot', neg(x)));
  if (isFn(x, 'acot')) return x.a[0];
  if (isFn(x, 'atan')) return pow(x.a[0], MINUS_ONE);
  return null;
};
const viaReciprocal = (base: 'cos' | 'sin', name: string) => ([x]: Expr[]): Expr | null => {
  const v = fn(base, x);
  // Still unevaluated, possibly with a sign pulled out or the argument reduced: keep sec/csc in the same shape.
  const [c, rest] = split(v);
  if (isFn(rest, base)) return same(rest.a[0], x) && qeq(c, Q1) ? null : mul(num(c), raw(name, rest.a[0]));
  if (isZero(v)) return fail(`${name} nie jest określony w tym punkcie.`);
  return reciprocal(v);
};
RULES.sec = viaReciprocal('cos', 'sec');
RULES.csc = viaReciprocal('sin', 'csc');

// --- Inverse trigonometric ---

let ASIN: Map<string, Q> | null = null, ACOS: Map<string, Q> | null = null, ATAN: Map<string, Q> | null = null;
const DENOMS = [1, 2, 3, 4, 5, 6, 8, 10, 12];
function inverseTables() {
  if (ASIN && ACOS && ATAN) return;
  ASIN = new Map(); ACOS = new Map(); ATAN = new Map();
  const seen = new Set<string>();
  for (const d of DENOMS) for (let n = -d; n <= 2 * d; n++) {
    const r = q(n, d), id = rk(r);
    if (seen.has(id)) continue;
    seen.add(id);
    if (qcmp(r, qv(-1, 2)) >= 0 && qcmp(r, QHALF) <= 0) ASIN.set(key(expand(sinPi(r))), r);
    if (qsign(r) >= 0 && qcmp(r, Q1) <= 0) ACOS.set(key(expand(cosPi(r))), r);
    if (qcmp(r, qv(-1, 2)) > 0 && qcmp(r, QHALF) < 0) ATAN.set(key(expand(tanPi(r))), r);
  }
}
const lookup = (table: () => Map<string, Q> | null, x: Expr) => {
  inverseTables();
  const r = table()!.get(key(expand(x)));
  return r === undefined ? null : mul(num(r), PI);
};
RULES.asin = ([x]) => lookup(() => ASIN, x) ?? (isNegative(x) ? neg(fn('asin', neg(x))) : null);
RULES.acos = ([x]) => lookup(() => ACOS, x) ?? (isNegative(x) ? sub(PI, fn('acos', neg(x))) : null);
RULES.atan = ([x]) => {
  const s = infSign(x);
  if (s) return mul(num(s, 2), PI);
  return lookup(() => ATAN, x) ?? (isNegative(x) ? neg(fn('atan', neg(x))) : null);
};
RULES.acot = ([x]) => {
  // arcctg x = π/2 − arctg x, with values in (0, π).
  if (isZero(x)) return mul(HALF, PI);
  const a = fn('atan', x);
  return isFn(a, 'atan') ? null : sub(mul(HALF, PI), a);
};
RULES.asec = ([x]) => isZero(x) ? fail('arcsec 0 nie istnieje.') : fn('acos', reciprocal(x));
RULES.acsc = ([x]) => isZero(x) ? fail('arccsc 0 nie istnieje.') : fn('asin', reciprocal(x));

// --- Hyperbolic ---

const odd = (name: string) => ([x]: Expr[]) => isZero(x) ? ZERO : isNegative(x) ? neg(fn(name, neg(x))) : null;
RULES.sinh = ([x]) => {
  if (isFn(x, 'asinh')) return x.a[0];
  const u = imaginaryFactor(x);
  if (u) return mul(I, fn('sin', u));
  return odd('sinh')([x]);
};
RULES.cosh = ([x]) => {
  if (isZero(x)) return ONE;
  if (isFn(x, 'acosh')) return x.a[0];
  const u = imaginaryFactor(x);
  if (u) return fn('cos', u);
  return isNegative(x) ? fn('cosh', neg(x)) : null;
};
RULES.tanh = ([x]) => isFn(x, 'atanh') ? x.a[0] : odd('tanh')([x]);
RULES.coth = ([x]) => isZero(x) ? fail('cth 0 nie istnieje.') : isNegative(x) ? neg(fn('coth', neg(x))) : null;
RULES.sech = ([x]) => isZero(x) ? ONE : isNegative(x) ? fn('sech', neg(x)) : null;
RULES.csch = ([x]) => isZero(x) ? fail('csch 0 nie istnieje.') : isNegative(x) ? neg(fn('csch', neg(x))) : null;
RULES.asinh = odd('asinh');
RULES.acosh = ([x]) => isOne(x) ? ZERO : null;
RULES.atanh = ([x]) => {
  if (isOne(x) || (isNum(x) && qeq(x.v, qv(-1)))) return fail('artgh ±1 nie istnieje (biegun).');
  return odd('atanh')([x]);
};
RULES.acoth = ([x]) => (isOne(x) || (isNum(x) && qeq(x.v, qv(-1)))) ? fail('arcth ±1 nie istnieje (biegun).') : isNegative(x) ? neg(fn('acoth', neg(x))) : null;

// --- Exponential and logarithms ---

RULES.exp = ([x]) => pow(E, x);
RULES.ln = ([x]) => {
  if (isZero(x)) return fail('ln 0 nie istnieje.');
  if (isOne(x)) return ZERO;
  if (isSym(x, 'e')) return ONE;
  if (infSign(x) > 0) return INF;
  if (isSym(x, 'i')) return mul(HALF, I, PI);
  // variables are real: ln(e^u) = u for any u without i
  if (x.k === '^' && isSym(x.b, 'e') && freeOf(x.e, 'i')) return x.e;
  if (isNum(x)) {
    if (qsign(x.v) < 0) return add(fn('ln', num(qneg(x.v))), mul(I, PI));
    if (x.v.n === 1n) return neg(fn('ln', num(x.v.d)));
  }
  if (x.k === '*' && x.t.length === 2 && isNum(x.t[0]) && qeq(x.t[0].v, qv(-1)) && isSym(x.t[1], 'i')) return mul(num(-1, 2), I, PI);
  return null;
};

/** b^t = x for rationals: the exact logarithm when there is a rational t. */
function exactLog(b: Q, x: Q): Q | null {
  if (qsign(b) <= 0 || qsign(x) <= 0 || qeq(b, Q1)) return null;
  if (qeq(x, Q1)) return qv(0);
  // Both are powers of one rational base r: b = r^m, x = r^k ⇒ t = k/m. Find r as the smallest root of b.
  const [r, m] = minimalBase(b);
  const sign = qcmp(x, Q1) === qcmp(r, Q1) ? 1n : -1n;
  let v = sign > 0n ? x : q(x.d, x.n), k = 0n;
  // v = r^k for some k ≥ 1
  while (qcmp(v, Q1) !== 0 && k < 4000n) {
    const nv = q(v.n * r.d, v.d * r.n);
    if (bitLength(nv.n) + bitLength(nv.d) > bitLength(v.n) + bitLength(v.d)) return null;
    v = nv; k++;
  }
  if (qcmp(v, Q1) !== 0) return null;
  return q(sign * k, m);
}
function minimalBase(b: Q): [Q, bigint] {
  for (let j = 64; j >= 2; j--) {
    const rn = iRootExact(b.n, j), rd = iRootExact(b.d, j);
    if (rn !== null && rd !== null) { const [r, m] = minimalBase(q(rn, rd)); return [r, m * BigInt(j)]; }
  }
  return [b, 1n];
}
function iRootExact(n: bigint, k: number): bigint | null {
  if (n < 0n) return null;
  if (n < 2n) return n;
  const guess = BigInt(Math.round(Math.pow(Number(n), 1 / k)));
  for (const g of [guess - 1n, guess, guess + 1n]) if (g > 0n && g ** BigInt(k) === n) return g;
  return null;
}

/** log(b; x) = ln x / ln b, exact when x is a rational power of b. */
RULES.log = ([b, x]) => {
  if (x === undefined) return fn('log', num(10), b);
  if (isZero(x)) return fail('Logarytm z zera nie istnieje.');
  if (isOne(b) || isZero(b)) return fail('Podstawa logarytmu musi być dodatnia i różna od 1.');
  if (isNum(b) && isNum(x)) {
    const t = exactLog(b.v, x.v);
    if (t) return num(t);
  }
  if (same(b, x)) return ONE;
  if (x.k === '^' && same(x.b, b)) return x.e;
  if (isSym(b, 'e')) return fn('ln', x);
  return div(fn('ln', x), fn('ln', b));
};
RULES.log2 = ([x]) => fn('log', TWO, x);
RULES.log10 = ([x]) => fn('log', num(10), x);
RULES.sqrt = ([x]) => sqrt(x);
RULES.cbrt = ([x]) => pow(x, num(1, 3));
RULES.root = ([n, x]) => {
  if (!isInt(n) || n.v.n < 2n) return fail('Stopień pierwiastka musi być liczbą naturalną ≥ 2.');
  return pow(x, num(q(1n, n.v.n)));
};

// --- Absolute value, sign, rounding ---

/** Splits a constant into real and imaginary parts when i occurs only linearly: [Re, Im]. */
export function complexParts(e: Expr): [Expr, Expr] | null {
  const ex = expand(e);
  const terms = ex.k === '+' ? ex.t : [ex];
  const re: Expr[] = [], im: Expr[] = [];
  for (const t of terms) {
    const factors = t.k === '*' ? t.t : [t];
    const iCount = factors.filter(f => isSym(f, 'i')).length;
    const restHasI = factors.some(f => !isSym(f, 'i') && !freeOf(f, 'i'));
    if (restHasI) return null;
    if (iCount === 1) im.push(div(t, I)); else re.push(t);
  }
  return [add(...re), add(...im)];
}

/** −1, 0 or 1 for a real constant whose sign is certain at 100 digits; null otherwise. */
export function constSign(e: Expr): -1 | 0 | 1 | null {
  if (isNum(e)) return qsign(e.v) as -1 | 0 | 1;
  if (!isConstant(e) || !freeOf(e, 'i')) return null;
  return signOf(e);
}

RULES.abs = ([x]) => {
  if (isNum(x)) return num(qsign(x.v) < 0 ? qneg(x.v) : x.v);
  if (infSign(x)) return INF;
  if (isFn(x, 'abs')) return x;
  if (isSym(x, 'i')) return ONE;
  if (x.k === '*' && isNum(x.t[0])) return mul(num(qsign(x.t[0].v) < 0 ? qneg(x.t[0].v) : x.t[0].v), fn('abs', mul(...x.t.slice(1))));
  if (x.k === '*' && x.t.some(f => isSym(f, 'i'))) return fn('abs', div(x, I));
  if (isConstant(x)) {
    const parts = complexParts(x);
    if (parts && !isZero(parts[1])) {
      const [a, b] = parts;
      if (constSign(a) !== null && constSign(b) !== null) return sqrt(add(pow(a, TWO), pow(b, TWO)));
    }
    const s = constSign(x);
    if (s === 1 || s === 0) return s ? x : ZERO;
    if (s === -1) return neg(x);
  }
  if (positiveReal(x)) return x;
  if (x.k === '^' && isNum(x.e) && x.e.v.d === 1n && x.e.v.n % 2n === 0n && freeOf(x.b, 'i')) return x;
  return null;
};

/**
 * Certainly > 0 for real values of the variables: positive numbers, π, e, e^u, even powers plus a positive
 * constant, and sums and products of such.
 */
export function positiveReal(e: Expr): boolean {
  return pos(e) === 2;
}
/** 2: positive, 1: nonnegative, 0: unknown. */
function pos(e: Expr): number {
  if (isNum(e)) return qsign(e.v) > 0 ? 2 : qsign(e.v) === 0 ? 1 : 0;
  if (isSym(e, 'pi') || isSym(e, 'e')) return 2;
  if (e.k === '^') {
    if (isSym(e.b, 'e') && freeOf(e.e, 'i')) return 2;
    if (isNum(e.e) && e.e.v.d === 1n && e.e.v.n % 2n === 0n && freeOf(e.b, 'i')) return e.e.v.n > 0n ? 1 : 0;
    const b = pos(e.b);
    return b === 2 && freeOf(e.e, 'i') ? 2 : 0;
  }
  if (isFn(e, 'abs')) return 1;
  if (isFn(e, 'cosh')) return freeOf(e.a[0], 'i') ? 2 : 0;
  if (e.k === '+') {
    const ps = e.t.map(pos);
    if (ps.some(p => !p)) return 0;
    return ps.some(p => p === 2) ? 2 : 1;
  }
  if (e.k === '*') {
    const ps = e.t.map(pos);
    if (ps.some(p => !p)) return 0;
    return ps.every(p => p === 2) ? 2 : 1;
  }
  return 0;
}
RULES.sign = ([x]) => {
  if (isNum(x)) return num(qsign(x.v));
  const s = constSign(x);
  if (s !== null) return num(s);
  if (x.k === '*' && isNum(x.t[0])) return mul(num(qsign(x.t[0].v)), fn('sign', mul(...x.t.slice(1))));
  return null;
};

/** ⌊x⌋ of a real constant: exact when x is at least 2^(−300) away from every integer. */
function floorOf(x: Expr): bigint | null {
  if (isNum(x)) return qfloor(x.v);
  if (!isConstant(x) || !freeOf(x, 'i')) return null;
  try {
    const z = evalC(x, 400);
    if (z.im.m) return null;
    const f = bfFloor(z.re), up = bfFloor(bfAdd(z.re, { m: 1n, e: -300 }, 500)), down = bfFloor(bfAdd(z.re, { m: -1n, e: -300 }, 500));
    return f === up && f === down ? f : null;
  } catch { return null; }
}
RULES.floor = ([x]) => { const f = floorOf(x); return f === null ? (isInt(x) ? x : null) : num(f); };
RULES.ceil = ([x]) => { const f = floorOf(neg(x)); return f === null ? null : num(-f); };
RULES.round = ([x]) => { const f = floorOf(add(x, HALF)); return f === null ? null : num(f); };
RULES.frac = ([x]) => { const f = floorOf(x); return f === null ? null : sub(x, num(f)); };

// --- Γ, factorial, binomial, ζ, erf ---

const MAX_FACTORIAL = 20000n;
export function factorialBig(n: bigint): bigint {
  if (n > MAX_FACTORIAL) fail(`Silnia większa niż ${MAX_FACTORIAL}! jest za duża do obliczenia dokładnie.`);
  // product tree: much faster than a running product for big n
  const prod = (a: bigint, b: bigint): bigint => b - a < 8n ? (() => { let r = 1n; for (let i = a; i <= b; i++) r *= i; return r; })() : (() => { const m = (a + b) / 2n; return prod(a, m) * prod(m + 1n, b); })();
  return n < 2n ? 1n : prod(2n, n);
}
RULES.factorial = ([x]) => {
  if (isInt(x)) {
    if (x.v.n < 0n) return fail('Silnia liczby całkowitej ujemnej nie istnieje.');
    return num(factorialBig(x.v.n));
  }
  if (isNum(x) && x.v.d === 2n) return fn('gamma', add(x, ONE));
  return null;
};
RULES.gamma = ([x]) => {
  if (isInt(x)) {
    if (x.v.n <= 0n) return fail('Γ ma bieguny w zerze i liczbach całkowitych ujemnych.');
    return num(factorialBig(x.v.n - 1n));
  }
  if (isNum(x) && x.v.d === 2n) {
    // Γ(n + 1/2) = (2n)! √π / (4^n n!), and Γ(1/2 − n) = (−4)^n n! √π / (2n)!
    const n = (x.v.n - 1n) / 2n;
    if (n >= 0n) return mul(num(q(factorialBig(2n * n), 4n ** n * factorialBig(n))), sqrt(PI));
    const m = -n;
    return mul(num(q((-4n) ** m * factorialBig(m), factorialBig(2n * m))), sqrt(PI));
  }
  return null;
};
RULES.binomial = ([n, k]) => {
  if (isInt(k)) {
    if (k.v.n < 0n) return ZERO;
    if (k.v.n > 100000n) return null;
    if (isInt(n)) return num(binomialBig(n.v.n, k.v.n));
    // generalised: n(n−1)…(n−k+1)/k!
    if (k.v.n <= 30n) {
      let out: Expr = ONE;
      for (let j = 0n; j < k.v.n; j++) out = mul(out, sub(n, num(j)));
      return mul(num(q(1n, factorialBig(k.v.n))), out);
    }
  }
  return null;
};
export function binomialBig(n: bigint, k: bigint): bigint {
  if (k < 0n) return 0n;
  if (n >= 0n && k > n) return 0n;
  if (n >= 0n && k > n - k) k = n - k;
  let r = 1n;
  for (let j = 1n; j <= k; j++) {
    r = r * (n - k + j) / j;
    if (bitLength(r) > MAX_BITS) fail('Wynik jest za duży.');
  }
  return r;
}

/** Bernoulli numbers B₀…B_n (B₁ = −1/2), exact. */
const BERNOULLI: Q[] = [Q1];
export function bernoulli(n: number): Q {
  if (n > 2000) fail('Liczby Bernoulliego obliczam do indeksu 2000.');
  while (BERNOULLI.length <= n) {
    const m = BERNOULLI.length;
    // Σ_{j=0}^{m} C(m+1, j) B_j = 0
    let s = qv(0);
    for (let j = 0; j < m; j++) if (j === 1 || j % 2 === 0) s = qadd(s, qmul(q(binomialBig(BigInt(m + 1), BigInt(j))), BERNOULLI[j]));
    BERNOULLI.push(m > 1 && m % 2 ? qv(0) : q(-s.n, s.d * BigInt(m + 1)));
  }
  return BERNOULLI[n];
}
RULES.zeta = ([s]) => {
  if (!isInt(s)) return null;
  const n = Number(s.v.n);
  if (n === 1) return fail('ζ(1) nie istnieje (szereg harmoniczny jest rozbieżny).');
  if (n === 0) return num(-1, 2);
  if (n < 0) {
    if (n < -2000) return null;
    // ζ(−n) = (−1)^n B_{n+1}/(n+1)
    const m = -n, b = bernoulli(m + 1);
    return num(qmul(b, q(m % 2 ? -1n : 1n, BigInt(m + 1))));
  }
  if (n % 2 === 0 && n <= 1000) {
    // ζ(2k) = (−1)^(k+1) B_2k (2π)^2k / (2 (2k)!)
    const k = n / 2, b = bernoulli(n);
    const c = qmul(qmul(b, q((k + 1) % 2 ? -1n : 1n)), q(2n ** BigInt(n), 2n * factorialBig(BigInt(n))));
    return mul(num(c), pow(PI, num(n)));
  }
  return null;
};
RULES.erf = ([x]) => isZero(x) ? ZERO : infSign(x) ? num(infSign(x)) : isNegative(x) ? neg(fn('erf', neg(x))) : null;
RULES.erfc = ([x]) => isZero(x) ? ONE : null;

// --- Complex parts ---

RULES.re = ([x]) => { if (!isConstant(x)) return null; const p = complexParts(x); return p && constSign(p[0]) !== null && constSign(p[1]) !== null ? p[0] : null; };
RULES.im = ([x]) => { if (!isConstant(x)) return null; const p = complexParts(x); return p && constSign(p[0]) !== null && constSign(p[1]) !== null ? p[1] : null; };
RULES.conj = ([x]) => { if (!isConstant(x)) return null; const p = complexParts(x); return p && constSign(p[0]) !== null && constSign(p[1]) !== null ? sub(p[0], mul(I, p[1])) : null; };
RULES.arg = ([x]) => {
  if (!isConstant(x)) return null;
  const p = complexParts(x);
  if (!p) return null;
  const [a, b] = p, sa = constSign(a), sb = constSign(b);
  if (sa === null || sb === null) return null;
  if (!sa && !sb) return fail('Argument liczby 0 nie jest określony.');
  if (!sa) return mul(num(sb, 2), PI);
  if (!sb) return sa > 0 ? ZERO : PI;
  const t = fn('atan', div(b, a));
  if (sa > 0) return t;
  return sb > 0 ? add(t, PI) : sub(t, PI);
};

// --- min, max, mod ---

function extreme(xs: Expr[], dir: 1 | -1): Expr | null {
  let best = xs[0];
  for (const x of xs.slice(1)) {
    const s = constSign(sub(x, best));
    if (s === null) return null;
    if (s === dir) best = x;
  }
  return best;
}
RULES.max = xs => xs.every(isConstant) ? extreme(xs, 1) : null;
RULES.min = xs => xs.every(isConstant) ? extreme(xs, -1) : null;
RULES.mod = ([a, b]) => {
  if (isNum(a) && isNum(b)) {
    if (!b.v.n) return fail('mod: dzielnik nie może być zerem.');
    return num(qsub(a.v, qmul(b.v, q(qfloor(qdivQ(a.v, b.v))))));
  }
  return null;
};

