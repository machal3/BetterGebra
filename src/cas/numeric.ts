/**
 * Numeric evaluation of constant expressions at any precision, on complex BigFloats. numericValue() returns only
 * digits that came out the same at two different working precisions, so a printed digit is a correct digit
 * (barring a coincidence of both runs), and catastrophic cancellation shows up as fewer digits, not wrong ones.
 */
import {
  BF, BZERO, Decimal, bfAbs, bfAdd, bfAtan, bfAtan2, bfCmp, bfDiv, bfExp, bfFloor, bfFromQ, bfInt, bfLn, bfMul, bfMul2, bfNeg,
  bfPi, bfSign, bfSinCos, bfSqrt, bfSub, bfSum, bfToDecimal, bfToNumber, norm, top,
} from './bigfloat';
import type { Expr } from './expr';
import { CasError, qint } from './q';

export interface C { re: BF; im: BF }
const real = (re: BF): C => ({ re, im: BZERO });
const C1 = real(bfInt(1));
const isReal = (z: C) => !z.im.m;

export const cadd = (a: C, b: C, p: number): C => ({ re: bfAdd(a.re, b.re, p), im: bfAdd(a.im, b.im, p) });
export const csum = (xs: C[], p: number): C => ({ re: bfSum(xs.map(x => x.re), p), im: bfSum(xs.map(x => x.im), p) });
export const csub = (a: C, b: C, p: number): C => ({ re: bfSub(a.re, b.re, p), im: bfSub(a.im, b.im, p) });
export function cmul(a: C, b: C, p: number): C {
  if (isReal(a) && isReal(b)) return real(bfMul(a.re, b.re, p));
  return { re: bfSub(bfMul(a.re, b.re, p + 4), bfMul(a.im, b.im, p + 4), p), im: bfAdd(bfMul(a.re, b.im, p + 4), bfMul(a.im, b.re, p + 4), p) };
}
export function cdiv(a: C, b: C, p: number): C {
  if (isReal(b)) return { re: bfDiv(a.re, b.re, p), im: bfDiv(a.im, b.re, p) };
  const d = bfAdd(bfMul(b.re, b.re, p + 8), bfMul(b.im, b.im, p + 8), p + 8);
  const re = bfAdd(bfMul(a.re, b.re, p + 8), bfMul(a.im, b.im, p + 8), p + 8);
  const im = bfSub(bfMul(a.im, b.re, p + 8), bfMul(a.re, b.im, p + 8), p + 8);
  return { re: bfDiv(re, d, p), im: bfDiv(im, d, p) };
}
const cneg = (a: C): C => ({ re: bfNeg(a.re), im: bfNeg(a.im) });
export const cabs = (a: C, p: number) => isReal(a) ? bfAbs(a.re) : bfSqrt(bfAdd(bfMul(a.re, a.re, p + 4), bfMul(a.im, a.im, p + 4), p + 4), p);
const isZeroC = (a: C) => !a.re.m && !a.im.m;

export function cexp(z: C, p: number): C {
  const r = bfExp(z.re, p + 8);
  if (!z.im.m) return real(norm(r.m, r.e, p));
  const [s, c] = bfSinCos(z.im, p + 8);
  return { re: bfMul(r, c, p), im: bfMul(r, s, p) };
}
export function cln(z: C, p: number): C {
  if (isZeroC(z)) throw new CasError('Logarytm z zera nie istnieje.');
  if (isReal(z) && z.re.m > 0n) return real(bfLn(z.re, p));
  return { re: bfLn(cabs(z, p + 8), p), im: bfAtan2(z.im, z.re, p) };
}
export function csqrt(z: C, p: number): C {
  if (isReal(z)) return z.re.m >= 0n ? real(bfSqrt(z.re, p)) : { re: BZERO, im: bfSqrt(bfNeg(z.re), p) };
  const r = cabs(z, p + 8);
  const re = bfSqrt(bfMul2(bfAdd(r, z.re, p + 8), -1), p);
  const im = bfSqrt(bfMul2(bfSub(r, z.re, p + 8), -1), p);
  return { re, im: z.im.m < 0n ? bfNeg(im) : im };
}
function cpowInt(z: C, n: bigint, p: number): C {
  if (n < 0n) return cdiv(C1, cpowInt(z, -n, p + 8), p);
  let out = C1, base = z;
  const wp = p + 2 * bitLen(n) + 8;
  while (n) {
    if (n & 1n) out = cmul(out, base, wp);
    n >>= 1n;
    if (n) base = cmul(base, base, wp);
  }
  return { re: norm(out.re.m, out.re.e, p), im: norm(out.im.m, out.im.e, p) };
}
const bitLen = (n: bigint) => n.toString(2).length;
export function cpow(z: C, w: C, p: number): C {
  if (isZeroC(z)) {
    if (w.re.m > 0n) return real(BZERO);
    throw new CasError('Zero do potęgi niedodatniej jest nieokreślone.');
  }
  const extra = Math.max(0, top(w.re), top(w.im)) + Math.max(0, Math.ceil(Math.log2(Math.abs(bfToNumber(cabs(cln(z, 64), 64))) + 1)));
  return cexp(cmul(w, cln(z, p + extra + 16), p + extra + 16), p);
}
function csinCos(z: C, p: number): [C, C] {
  const wp = p + 16;
  const [s, c] = bfSinCos(z.re, wp);
  if (!z.im.m) return [real(norm(s.m, s.e, p)), real(norm(c.m, c.e, p))];
  const ep = bfExp(z.im, wp), em = bfDiv(bfInt(1), ep, wp);
  const ch = bfMul2(bfAdd(ep, em, wp), -1), sh = bfMul2(bfSub(ep, em, wp), -1);
  return [
    { re: bfMul(s, ch, p), im: bfMul(c, sh, p) },
    { re: bfMul(c, ch, p), im: bfNeg(bfMul(s, sh, p)) },
  ];
}
const I_C: C = { re: BZERO, im: bfInt(1) };
const timesI = (z: C): C => ({ re: bfNeg(z.im), im: z.re });
const half = (z: C): C => ({ re: bfMul2(z.re, -1), im: bfMul2(z.im, -1) });

/** Bernoulli numbers B_2k as exact fractions [n, d], cached. */
const B2: [bigint, bigint][] = [];
function bernoulli2(k: number): [bigint, bigint] {
  // B_0..B_m by the standard recurrence, kept as fractions over a common denominator per entry
  const all: [bigint, bigint][] = BERN;
  while (all.length <= 2 * k) {
    const m = all.length;
    let sn = 0n, sd = 1n, c = 1n; // c = C(m+1, j)
    for (let j = 0; j < m; j++) {
      const [bn, bd] = all[j];
      if (bn) { sn = sn * bd + c * bn * sd; sd *= bd; const g = gcdB(sn, sd); sn /= g; sd /= g; }
      c = c * BigInt(m + 1 - j) / BigInt(j + 1);
    }
    // B_m = −S/(m+1)
    let n = -sn, d = sd * BigInt(m + 1);
    const g = gcdB(n, d); n /= g; d /= g;
    if (d < 0n) { n = -n; d = -d; }
    all.push(m > 1 && m % 2 ? [0n, 1n] : [n, d]);
  }
  return B2[k] ??= all[2 * k];
}
const BERN: [bigint, bigint][] = [[1n, 1n]];
const gcdB = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };

/**
 * Γ(z) by Stirling's series at w = z + N (N chosen so |w| is large), then Γ(z) = Γ(w)/(z(z+1)…(z+N−1));
 * reflection below Re z = 1/2.
 */
export function cgamma(z: C, p: number): C {
  const wp = p + 40;
  if (bfToNumber(z.re) < 0.5) {
    if (isReal(z) && isIntBF(z.re)) throw new CasError('Funkcja Γ ma bieguny w zerze i liczbach całkowitych ujemnych.');
    // Γ(z) = π / (sin(πz) Γ(1 − z))
    const pi = real(bfPi(wp));
    const [s] = csinCos(cmul(pi, z, wp), wp);
    return cdiv(pi, cmul(s, cgamma(csub(C1, z, wp), wp), wp), p);
  }
  const W = Math.max(12, Math.ceil(wp * 0.16));
  const N = Math.max(0, Math.ceil(W - bfToNumber(z.re)));
  const w = cadd(z, real(bfInt(N)), wp);
  // ln Γ(w) = (w − ½) ln w − w + ½ ln 2π + Σ B_2k / (2k(2k−1) w^(2k−1))
  const lw = cln(w, wp);
  let sum = csub(cmul(csub(w, real({ m: 1n, e: -1 }), wp), lw, wp), w, wp);
  sum = cadd(sum, real(bfMul2(bfLn(bfMul2(bfPi(wp), 1), wp), -1)), wp);
  const w2 = cmul(w, w, wp);
  let wpow = w; // w^(2k−1)
  for (let k = 1; k < 2000; k++) {
    const [bn, bd] = bernoulli2(k);
    const term = cdiv(real(bfFromQ(bn, bd * BigInt(2 * k * (2 * k - 1)), wp)), wpow, wp);
    const mag = Math.max(top(term.re), top(term.im));
    sum = cadd(sum, term, wp);
    if (mag < -wp) break;
    wpow = cmul(wpow, w2, wp);
  }
  // divide by z(z+1)…(z+N−1)
  let prod = C1;
  for (let j = 0; j < N; j++) prod = cmul(prod, cadd(z, real(bfInt(j)), wp), wp);
  return cdiv(cexp(sum, wp), prod, p);
}
const isIntBF = (x: BF) => x.e >= 0 || (x.m & ((1n << BigInt(-x.e)) - 1n)) === 0n;

/** erf z = 2/√π Σ (−1)^n z^(2n+1) / (n!(2n+1)); guard bits cover the cancellation (about |z|²·log₂e). */
export function cerf(z: C, p: number): C {
  const mag = bfToNumber(cabs(z, 64));
  if (mag > 200) {
    if (isReal(z)) return real(bfInt(z.re.m > 0n ? 1 : -1));
    throw new CasError('erf dla tak dużych argumentów zespolonych nie jest obliczana.');
  }
  const wp = p + Math.ceil(mag * mag * 1.45) + 32;
  const z2 = cmul(z, z, wp);
  let term = z, sum = z;
  for (let n = 1; n < 1000000; n++) {
    term = cdiv(cneg(cmul(term, z2, wp)), real(bfInt(n)), wp);
    const t = cdiv(term, real(bfInt(2 * n + 1)), wp);
    if (Math.max(top(t.re), top(t.im)) < -wp + Math.max(0, top(sum.re))) break;
    sum = cadd(sum, t, wp);
  }
  return cmul(sum, real(bfDiv(bfInt(2), bfSqrt(bfPi(wp), wp), wp)), p);
}

/** ζ(s) for Re s > ... by Borwein's alternating-series algorithm (s ≠ 1). */
export function czeta(s: C, p: number): C {
  if (isReal(s) && bfCmp(s.re, bfInt(1)) === 0) throw new CasError('ζ(1) nie istnieje (biegun).');
  if (bfToNumber(s.re) < 0.5) {
    // ζ(s) = 2^s π^(s−1) sin(πs/2) Γ(1−s) ζ(1−s)
    const wp = p + 32, pi = real(bfPi(wp));
    if (isReal(s) && isIntBF(s.re) && bfToNumber(s.re) < 0 && !(bfFloor(s.re) % 2n)) return real(BZERO); // trivial zeros
    const one = csub(C1, s, wp);
    const f = cmul(cmul(cpow(real(bfInt(2)), s, wp), cpow(pi, csub(s, C1, wp), wp), wp), csinCos(half(cmul(pi, s, wp)), wp)[0], wp);
    return cmul(cmul(f, cgamma(one, wp), wp), czeta(one, wp), p);
  }
  const n = Math.ceil(p * 0.4) + 10 + Math.ceil(Math.abs(bfToNumber(s.im)) * 1.2);
  const wp = p + 2 * n + 32;
  // d_k = n Σ_{i=0}^{k} (n+i−1)! 4^i / ((n−i)! (2i)!)
  const d: bigint[] = [];
  let acc = 0n, termNum = 1n; // term_i = (n+i−1)! 4^i n / ((n−i)!(2i)!) as an integer
  // term_0 = n·(n−1)!/n! = 1
  for (let i = 0; i <= n; i++) {
    if (i === 0) termNum = 1n;
    else termNum = termNum * BigInt(n + i - 1) * BigInt(n - i + 1) * 4n / (BigInt(2 * i - 1) * BigInt(2 * i));
    acc += termNum;
    d.push(acc);
  }
  let sum = real(BZERO);
  const intS = isReal(s) && isIntBF(s.re) && bfToNumber(s.re) > 0 && bfToNumber(s.re) < 4000 ? BigInt(bfToNumber(s.re)) : null;
  for (let k = 0; k < n; k++) {
    const coef = bfInt((k % 2 ? -1n : 1n) * (d[k] - d[n]));
    // (k+1)^s exactly when s is a positive integer: no exp/ln per term
    const pw = intS !== null ? real(bfInt(BigInt(k + 1) ** intS)) : cpow(real(bfInt(k + 1)), s, wp);
    sum = cadd(sum, cdiv(real(coef), pw, wp), wp);
  }
  const denom = cmul(real(bfInt(d[n])), csub(C1, cpow(real(bfInt(2)), csub(C1, s, wp), wp), wp), wp);
  return cneg(cdiv(sum, denom, p));
}

// --- Expressions ---

type Ctx = { p: number; retried?: boolean };

/** Value of a constant expression at precision p bits. Throws CasError on free variables or undefined points. */
export function evalC(e: Expr, p: number): C {
  return ev(e, { p });
}
/** The variable evalAt binds, while it runs. */
let bound: { x: string; v: BF } | null = null;
/**
 * Value of e at x = v, a real BigFloat, without substituting it: building e with a 300-bit rational simplifies at that
 * size (xˣ near 47 as (p/q)^(p/q) takes a third of a second), evaluating it is a few milliseconds.
 */
export function evalAt(e: Expr, x: string, v: BF, p: number): C {
  const outer = bound;
  bound = { x, v };
  try { return ev(e, { p }); } finally { bound = outer; }
}

function ev(e: Expr, ctx: Ctx): C {
  const p = ctx.p, wp = p + 16;
  switch (e.k) {
    case 'n': return real(bfFromQ(e.v.n, e.v.d, p));
    case 's':
      if (e.n === 'pi') return real(bfPi(p));
      if (e.n === 'e') return real(bfExp(bfInt(1), p));
      if (e.n === 'i') return I_C;
      if (bound && e.n === bound.x) return real(norm(bound.v.m, bound.v.e, p));
      if (e.n === 'inf') throw new CasError('Nieskończoność nie ma wartości liczbowej.');
      throw new CasError(`Zmienna ${e.n} nie ma wartości liczbowej.`);
    case '+': {
      // Terms may cancel: evaluate them with extra bits, sum without intermediate rounding, and boost precision if bits cancelled.
      const terms = e.t.map(t => ev(t, { p: wp, retried: ctx.retried }));
      const s = csum(terms, wp);
      if (!ctx.retried) {
        let maxT = -Infinity;
        for (const t of terms) maxT = Math.max(maxT, top(t.re), top(t.im));
        const curT = Math.max(top(s.re), top(s.im));
        if (maxT > -Infinity) {
          const lost = maxT - Math.max(curT, maxT - wp);
          if (lost > 12 && lost <= 2048) {
            const hp = wp + lost + 16;
            return csum(e.t.map(t => ev(t, { p: hp, retried: true })), p);
          }
        }
      }
      return s;
    }
    case '*': {
      let s = ev(e.t[0], { p: wp });
      for (let j = 1; j < e.t.length; j++) s = cmul(s, ev(e.t[j], { p: wp }), wp);
      return s;
    }
    case '^': {
      if (e.e.k === 'n' && qint(e.e.v)) return cpowInt(ev(e.b, { p: wp + 2 * bitLen(e.e.v.n) }), e.e.v.n, p);
      if (e.b.k === 's' && e.b.n === 'e') return cexp(ev(e.e, { p: wp + 16 }), p);
      const b = ev(e.b, { p: wp + 16 });
      // Odd roots of negative reals stay real (the convention of the exact engine): (−8)^(1/3) = −2.
      if (e.e.k === 'n' && e.e.v.d % 2n && isReal(b) && b.re.m < 0n) {
        const r = cpow(real(bfNeg(b.re)), real(bfFromQ(e.e.v.n, e.e.v.d, wp)), p);
        return e.e.v.n % 2n ? cneg(r) : r;
      }
      if (e.e.k === 'n' && e.e.v.d === 2n && e.e.v.n === 1n) return csqrt(b, p);
      return cpow(b, ev(e.e, { p: wp + 16 }), p);
    }
    case 'f': return evFn(e.n, e.a.map(a => ev(a, { p: wp + 16 })), p);
  }
}

const needReal = (z: C, name: string) => { if (!isReal(z)) throw new CasError(`${name} jest określona tylko dla liczb rzeczywistych.`); return z.re; };

function evFn(n: string, a: C[], p: number): C {
  const wp = p + 32, [z] = a;
  switch (n) {
    case 'sin': return csinCos(z, p)[0];
    case 'cos': return csinCos(z, p)[1];
    case 'tan': { const [s, c] = csinCos(z, wp); return cdiv(s, c, p); }
    case 'cot': { const [s, c] = csinCos(z, wp); return cdiv(c, s, p); }
    case 'sec': return cdiv(C1, csinCos(z, wp)[1], p);
    case 'csc': return cdiv(C1, csinCos(z, wp)[0], p);
    case 'asin':
      if (isReal(z) && bfCmp(bfAbs(z.re), bfInt(1)) <= 0) return real(bfAtan2(z.re, bfSqrt(bfSub(bfInt(1), bfMul(z.re, z.re, wp), wp), wp), p));
      // −i ln(iz + √(1 − z²))
      return cmul(cneg(I_C), cln(cadd(timesI(z), csqrt(csub(C1, cmul(z, z, wp), wp), wp), wp), wp), p);
    case 'acos': return csub(real(bfMul2(bfPi(wp), -1)), evFn('asin', [z], wp), p);
    case 'atan':
      if (isReal(z)) return real(bfAtan(z.re, p));
      return cmul(half(I_C), csub(cln(csub(C1, timesI(z), wp), wp), cln(cadd(C1, timesI(z), wp), wp), wp), p);
    case 'acot': return isReal(z) && z.re.m ? real(bfAtan(bfDiv(bfInt(1), z.re, wp), p)) : evFn('atan', [cdiv(C1, z, wp)], p);
    case 'asec': return evFn('acos', [cdiv(C1, z, wp)], p);
    case 'acsc': return evFn('asin', [cdiv(C1, z, wp)], p);
    case 'sinh': case 'cosh': case 'tanh': case 'coth': case 'sech': case 'csch': {
      const ep = cexp(z, wp), em = cdiv(C1, ep, wp);
      const sh = half(csub(ep, em, wp)), ch = half(cadd(ep, em, wp));
      return n === 'sinh' ? sh : n === 'cosh' ? ch : n === 'tanh' ? cdiv(sh, ch, p) : n === 'coth' ? cdiv(ch, sh, p) : n === 'sech' ? cdiv(C1, ch, p) : cdiv(C1, sh, p);
    }
    case 'asinh': return cln(cadd(z, csqrt(cadd(cmul(z, z, wp), C1, wp), wp), wp), p);
    case 'acosh': return cln(cadd(z, cmul(csqrt(cadd(z, C1, wp), wp), csqrt(csub(z, C1, wp), wp), wp), wp), p);
    case 'atanh': return half(csub(cln(cadd(C1, z, wp), wp), cln(csub(C1, z, wp), wp), p));
    case 'acoth': return evFn('atanh', [cdiv(C1, z, wp)], p);
    case 'ln': return cln(z, p);
    case 'abs': return real(cabs(z, p));
    case 'sign': { if (isZeroC(z)) return real(BZERO); const r = cabs(z, wp); return cdiv(z, real(r), p); }
    case 're': return real(z.re);
    case 'im': return real(z.im);
    case 'conj': return { re: z.re, im: bfNeg(z.im) };
    case 'arg': return real(bfAtan2(z.im, z.re, p));
    case 'floor': return real(bfInt(bfFloor(needReal(z, 'Część całkowita'))));
    case 'ceil': return real(bfInt(-bfFloor(bfNeg(needReal(z, 'Sufit')))));
    case 'round': return real(bfInt(bfFloor(bfAdd(needReal(z, 'Zaokrąglenie'), { m: 1n, e: -1 }, wp))));
    case 'frac': { const r = needReal(z, 'Część ułamkowa'); return real(bfSub(r, bfInt(bfFloor(r)), p)); }
    case 'mod': {
      const x = needReal(a[0], 'mod'), y = needReal(a[1], 'mod');
      if (!y.m) throw new CasError('mod: dzielnik nie może być zerem.');
      const qf = bfInt(bfFloor(bfDiv(x, y, wp)));
      return real(bfSub(x, bfMul(y, qf, wp), p));
    }
    case 'binomial': {
      const [u, v] = a;
      return cdiv(cgamma(cadd(u, C1, wp), wp), cmul(cgamma(cadd(v, C1, wp), wp), cgamma(cadd(csub(u, v, wp), C1, wp), wp), wp), p);
    }
    case 'gamma': return cgamma(z, p);
    case 'factorial': return cgamma(cadd(z, C1, wp), p);
    case 'erf': return cerf(z, p);
    case 'erfc': return csub(C1, cerf(z, wp), p);
    case 'zeta': return czeta(z, p);
    case 'max': case 'min': {
      const xs = a.map(v => needReal(v, n === 'max' ? 'max' : 'min'));
      return real(xs.reduce((m, v) => (bfCmp(v, m) > 0) === (n === 'max') ? v : m));
    }
  }
  throw new CasError(`Nie umiem obliczyć numerycznie funkcji ${n}.`);
}

// --- Correct digits ---

export interface NumericValue { re: Decimal | null; im: Decimal | null; digits: number; reZeroBelow?: number; imZeroBelow?: number }

const decimalsEqual = (a: Decimal | null, b: Decimal | null) => (!a && !b) || (!!a && !!b && a.neg === b.neg && a.digits === b.digits && a.exp10 === b.exp10);

/**
 * The value of a constant expression to `digits` significant digits, recomputed at rising precision until two runs
 * agree. A part that keeps shrinking with precision is reported as zero below 10^(−k) rather than as noise.
 */
export function numericValue(e: Expr, digits: number): NumericValue {
  const bits = (d: number) => Math.ceil(d * 3.33) + 24;
  let prev: C | null = null, prevP = 0;
  for (let p = bits(digits) + 32, round = 0; round < 6; p = p * 2 + 64, round++) {
    const z = evalC(e, p);
    if (prev) {
      const part = (a: BF, b: BF): { d: Decimal | null; zeroBelow?: number; ok: boolean } => {
        const da = bfToDecimal(a, digits), db = bfToDecimal(b, digits);
        if (decimalsEqual(da, db)) return { d: da, ok: true };
        // Both tiny compared to the precision used: it's a zero we can't prove; report the bound.
        const ta = top(a), tb = top(b);
        const scale = Math.max(top(z.re), top(z.im), 0);
        if ((ta === -Infinity || ta < scale - prevP + 40) && (tb === -Infinity || tb < scale - p + 40)) {
          return { d: null, zeroBelow: Math.floor((-Math.max(ta, tb === -Infinity ? -p : tb) + 1) * Math.log10(2)), ok: true };
        }
        return { d: null, ok: false };
      };
      const re = part(prev.re, z.re), im = part(prev.im, z.im);
      if (re.ok && im.ok) return { re: re.d, im: im.d, digits, reZeroBelow: re.zeroBelow, imZeroBelow: im.zeroBelow };
    }
    prev = z; prevP = p;
  }
  throw new CasError('Nie udało się ustalić cyfr wyniku (zbyt duże znoszenie się składników).');
}

/** Quick double-precision value (for plots, sign tests and sanity checks); NaN where undefined. */
export function approx(e: Expr): { re: number; im: number } {
  try {
    const z = evalC(e, 80);
    return { re: bfToNumber(z.re), im: bfToNumber(z.im) };
  } catch (err) {
    if (err instanceof CasError) return { re: NaN, im: NaN };
    throw err;
  }
}

/** Sign of a real constant, decided at ~100 digits; null when it is too close to zero to tell or not real. */
export function signOf(e: Expr): -1 | 0 | 1 | null {
  try {
    const z = evalC(e, 340);
    if (z.im.m && top(z.im) > -300) return null;
    if (!z.re.m) return z.im.m ? null : 0;
    if (top(z.re) < -300) return null;
    return bfSign(z.re) as -1 | 1;
  } catch (err) {
    if (err instanceof CasError) return null;
    throw err;
  }
}

export { bfCmp, bfToNumber, bfToDecimal, top as bfTop };
