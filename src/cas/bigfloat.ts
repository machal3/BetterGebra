/**
 * Arbitrary precision binary floating point on BigInt: a value is m·2^e. Every operation takes the precision p in
 * bits and rounds its result to p bits. Callers add guard bits; numericValue() in numeric.ts checks the digits it
 * prints by recomputing at a higher precision.
 */
import { CasError, bitLength, isqrt } from './q';

export interface BF { readonly m: bigint; readonly e: number }
export const BZERO: BF = { m: 0n, e: 0 };

const exponentGuard = (e: number) => { if (!Number.isFinite(e) || Math.abs(e) > 2 ** 40) throw new CasError('Liczba poza zakresem obliczeń numerycznych.'); return e; };

export function norm(m: bigint, e: number, p: number): BF {
  if (!m) return BZERO;
  const bl = bitLength(m), s = bl - p;
  if (s > 0) {
    // round half away from zero
    const S = BigInt(s), neg = m < 0n;
    let a = neg ? -m : m;
    a = (a + (1n << (S - 1n))) >> S;
    m = neg ? -a : a;
    e += s;
  }
  return { m, e: exponentGuard(e) };
}

export const bfInt = (n: bigint | number): BF => ({ m: BigInt(n), e: 0 });
export const bfNeg = (a: BF): BF => ({ m: -a.m, e: a.e });
export const bfAbs = (a: BF): BF => a.m < 0n ? bfNeg(a) : a;
export const bfSign = (a: BF) => a.m > 0n ? 1 : a.m < 0n ? -1 : 0;
export const bfMul2 = (a: BF, k: number): BF => a.m ? { m: a.m, e: exponentGuard(a.e + k) } : a;
/** Position of the leading bit: |a| ∈ [2^(top−1), 2^top). */
export const top = (a: BF) => a.m ? bitLength(a.m) + a.e : -Infinity;

export function bfAdd(a: BF, b: BF, p: number): BF {
  if (!a.m) return norm(b.m, b.e, p);
  if (!b.m) return norm(a.m, a.e, p);
  // A term more than p + 4 bits below the other only affects rounding; keep guard bits below the p-th bit of the larger term.
  if (top(a) - top(b) > p + 4) {
    const shift = Math.max(2, p + 4 - bitLength(a.m));
    return norm((a.m << BigInt(shift)) + BigInt(bfSign(b)), a.e - shift, p);
  }
  if (top(b) - top(a) > p + 4) {
    const shift = Math.max(2, p + 4 - bitLength(b.m));
    return norm((b.m << BigInt(shift)) + BigInt(bfSign(a)), b.e - shift, p);
  }
  return a.e >= b.e ? norm((a.m << BigInt(a.e - b.e)) + b.m, b.e, p) : norm(a.m + (b.m << BigInt(b.e - a.e)), a.e, p);
}
export function bfSum(xs: BF[], p: number): BF {
  const nz = xs.filter(x => x.m !== 0n);
  if (!nz.length) return BZERO;
  if (nz.length === 1) return norm(nz[0].m, nz[0].e, p);
  let minE = nz[0].e, maxTop = top(nz[0]);
  for (let i = 1; i < nz.length; i++) {
    if (nz[i].e < minE) minE = nz[i].e;
    const t = top(nz[i]);
    if (t > maxTop) maxTop = t;
  }
  // When the exponent span is moderate, sum all mantissas exactly in one BigInt addition before rounding once.
  if (maxTop - minE <= p + 256) {
    let total = 0n;
    for (const x of nz) total += x.e > minE ? x.m << BigInt(x.e - minE) : x.m;
    return norm(total, minE, p);
  }
  // Otherwise sort by magnitude descending so large cancelling terms annihilate before small terms are added.
  const sorted = [...nz].sort((a, b) => top(b) - top(a));
  const wp = p + 32;
  let acc = sorted[0];
  for (let i = 1; i < sorted.length; i++) acc = bfAdd(acc, sorted[i], wp);
  return norm(acc.m, acc.e, p);
}
export const bfSub = (a: BF, b: BF, p: number) => bfAdd(a, bfNeg(b), p);
export const bfMul = (a: BF, b: BF, p: number) => norm(a.m * b.m, a.e + b.e, p);
export function bfDiv(a: BF, b: BF, p: number): BF {
  if (!b.m) throw new CasError('Dzielenie przez zero.');
  if (!a.m) return BZERO;
  const shift = p + 2 + bitLength(b.m) - bitLength(a.m);
  const s = Math.max(0, shift);
  return norm((a.m << BigInt(s)) / b.m, a.e - b.e - s, p);
}
export function bfSqrt(a: BF, p: number): BF {
  if (a.m < 0n) throw new CasError('Pierwiastek z liczby ujemnej.');
  if (!a.m) return BZERO;
  let m = a.m, e = a.e;
  const want = 2 * p + 4 - bitLength(m);
  let s = Math.max(0, want);
  if ((e - s) % 2) s++;
  m <<= BigInt(s); e -= s;
  return norm(isqrt(m), e / 2, p);
}
export function bfCmp(a: BF, b: BF): number {
  return bfSign(bfSub(a, b, Math.max(bitLength(a.m), bitLength(b.m)) + Math.abs(a.e - b.e) + 2));
}
export function bfFromQ(n: bigint, d: bigint, p: number): BF {
  return bfDiv({ m: n, e: 0 }, { m: d, e: 0 }, p);
}
/** ⌊a⌋ exactly. */
export const bfFloor = (a: BF): bigint => a.e >= 0 ? a.m << BigInt(a.e) : a.m >> BigInt(-a.e);
export function bfToNumber(a: BF): number {
  if (!a.m) return 0;
  const bl = bitLength(a.m), s = Math.max(0, bl - 60);
  const m = Number(a.m >> BigInt(s)), e = a.e + s;
  if (e > 1100) return m > 0 ? Infinity : -Infinity;
  if (e < -1200) return 0;
  return m * 2 ** e;
}
export function bfFromNumber(x: number): BF {
  if (!Number.isFinite(x)) throw new CasError('Liczba poza zakresem.');
  if (x === 0) return BZERO;
  let e = 0;
  while (!Number.isInteger(x)) { x *= 2; e--; }
  return { m: BigInt(x), e };
}

// --- Constants (fixed point, cached at the largest precision asked for so far) ---

function cached(compute: (p: number) => BF): (p: number) => BF {
  let best: { p: number; v: BF } | null = null;
  return p => {
    if (!best || best.p < p) best = { p: p + 64, v: compute(p + 64) };
    return norm(best.v.m, best.v.e, p);
  };
}
/** Σ (−1)^k / ((2k+1) n^(2k+1)) in fixed point with P fractional bits: arctan(1/n), or artanh(1/n) when alt=false. */
function arcInv(n: bigint, P: number, alt: boolean): bigint {
  const one = 1n << BigInt(P);
  let power = one / n, sum = power, k = 1n;
  const n2 = n * n;
  for (;;) {
    power /= n2;
    const term = power / (2n * k + 1n);
    if (!term) break;
    sum += alt && k % 2n ? -term : term;
    k++;
  }
  return sum;
}
export const bfPi = cached(p => {
  const P = p + 32;
  // Machin: π = 16 arctan(1/5) − 4 arctan(1/239)
  return norm(16n * arcInv(5n, P, true) - 4n * arcInv(239n, P, true), -P, p);
});
export const bfLn2 = cached(p => {
  const P = p + 32;
  // ln 2 = 18 artanh(1/26) − 2 artanh(1/4801) + 8 artanh(1/8749)
  return norm(18n * arcInv(26n, P, false) - 2n * arcInv(4801n, P, false) + 8n * arcInv(8749n, P, false), -P, p);
});

// --- Elementary functions ---

export function bfExp(x: BF, p: number): BF {
  if (!x.m) return bfInt(1);
  const xf = bfToNumber(x);
  if (xf > 2 ** 36) throw new CasError('Wynik jest za duży dla obliczeń numerycznych.');
  if (xf < -(2 ** 36)) return BZERO; // below 2^(−10^10): indistinguishable from 0 at any precision we offer
  const k = Math.round(xf / Math.LN2);
  const s = Math.max(4, Math.ceil(Math.sqrt(p) / 2));
  const wp = p + s + 24 + Math.max(0, Math.ceil(Math.log2(Math.abs(k) + 1)));
  let r = bfSub(x, bfMul(bfInt(k), bfLn2(wp + 64), wp), wp);
  r = bfMul2(r, -s);
  // Taylor: Σ r^n/n!
  let term = bfInt(1), sum = bfInt(1);
  for (let n = 1; n < 100000; n++) {
    term = bfDiv(bfMul(term, r, wp), bfInt(n), wp);
    if (!term.m || top(term) < -wp - 4) break;
    sum = bfAdd(sum, term, wp);
  }
  for (let j = 0; j < s; j++) sum = bfMul(sum, sum, wp);
  return norm(sum.m, sum.e + k, p);
}

export function bfLn(x: BF, p: number): BF {
  if (x.m <= 0n) throw new CasError(x.m ? 'Logarytm liczby ujemnej (w liczbach rzeczywistych).' : 'Logarytm z zera nie istnieje.');
  const t = bitLength(x.m), k = x.e + t;      // x = f·2^k, f ∈ [1/2, 1)
  let f: BF = { m: x.m, e: -t };
  const s = Math.max(4, Math.ceil(Math.sqrt(p)));
  const wp = p + s + 24 + Math.ceil(Math.log2(Math.abs(k) + 1));
  for (let j = 0; j < s; j++) f = bfSqrt(f, wp);
  // ln f = 2^s · 2 artanh((f−1)/(f+1))
  const z = bfDiv(bfSub(f, bfInt(1), wp), bfAdd(f, bfInt(1), wp), wp), z2 = bfMul(z, z, wp);
  let power = z, sum = z;
  for (let n = 3; n < 1000000; n += 2) {
    power = bfMul(power, z2, wp);
    const term = bfDiv(power, bfInt(n), wp);
    if (!term.m || top(term) < top(sum) - wp - 4) break;
    sum = bfAdd(sum, term, wp);
  }
  const lnf = bfMul2(sum, s + 1);
  return bfAdd(lnf, bfMul(bfInt(k), bfLn2(wp), wp), p);
}

/** sin and cos together, after reducing x by multiples of π/2. */
export function bfSinCos(x: BF, p: number): [BF, BF] {
  if (!x.m) return [BZERO, bfInt(1)];
  const mag = Math.max(0, top(x));
  const wp = p + mag + 32;
  const halfPi = bfMul2(bfPi(wp), -1);
  const n = bfFloor(bfAdd(bfDiv(x, halfPi, wp), { m: 1n, e: -1 }, wp)); // round(x / (π/2))
  const r = bfSub(x, bfMul({ m: n, e: 0 }, halfPi, wp), wp);
  // Taylor of sin and cos at |r| ≤ π/4
  const r2 = bfMul(r, r, wp);
  let s = r, c = bfInt(1), ts = r, tc = bfInt(1);
  for (let k = 1; k < 100000; k++) {
    ts = bfNeg(bfDiv(bfMul(ts, r2, wp), bfInt((2 * k) * (2 * k + 1)), wp));
    tc = bfNeg(bfDiv(bfMul(tc, r2, wp), bfInt((2 * k - 1) * (2 * k)), wp));
    if ((!ts.m || top(ts) < -wp) && (!tc.m || top(tc) < -wp)) break;
    s = bfAdd(s, ts, wp); c = bfAdd(c, tc, wp);
  }
  const q = Number(((n % 4n) + 4n) % 4n);
  const out: [BF, BF] = q === 0 ? [s, c] : q === 1 ? [c, bfNeg(s)] : q === 2 ? [bfNeg(s), bfNeg(c)] : [bfNeg(c), s];
  return [norm(out[0].m, out[0].e, p), norm(out[1].m, out[1].e, p)];
}

export function bfAtan(x: BF, p: number): BF {
  if (!x.m) return BZERO;
  const wp = p + 40;
  if (bfCmp(bfAbs(x), bfInt(1)) > 0) {
    const half = bfMul2(bfPi(wp), -1);
    const v = bfSub(half, bfAtan(bfDiv(bfInt(1), bfAbs(x), wp), wp), wp);
    return norm(x.m < 0n ? -v.m : v.m, v.e, p);
  }
  // atan x = 2 atan(x / (1 + √(1 + x²))), k times, then Taylor.
  let y = x;
  const k = 8;
  for (let j = 0; j < k; j++) y = bfDiv(y, bfAdd(bfInt(1), bfSqrt(bfAdd(bfInt(1), bfMul(y, y, wp), wp), wp), wp), wp);
  const y2 = bfMul(y, y, wp);
  let power = y, sum = y;
  for (let n = 3; n < 1000000; n += 2) {
    power = bfNeg(bfMul(power, y2, wp));
    const term = bfDiv(power, bfInt(n), wp);
    if (!term.m || top(term) < top(sum) - wp - 4) break;
    sum = bfAdd(sum, term, wp);
  }
  return norm(sum.m, sum.e + k, p);
}

/** atan2(y, x) ∈ (−π, π]. */
export function bfAtan2(y: BF, x: BF, p: number): BF {
  const wp = p + 16;
  if (!x.m && !y.m) throw new CasError('Argument liczby 0 nie jest określony.');
  if (!x.m) return bfMul2(y.m > 0n ? bfPi(p) : bfNeg(bfPi(p)), -1);
  const a = bfAtan(bfDiv(y, x, wp), wp);
  if (x.m > 0n) return norm(a.m, a.e, p);
  return y.m >= 0n ? bfAdd(a, bfPi(wp), p) : bfSub(a, bfPi(wp), p);
}

// --- Decimal output ---

/** sign · d₁,d₂d₃…dₙ · 10^exp10 */
export interface Decimal { neg: boolean; digits: string; exp10: number }
/** a rounded (half up) to n significant decimal digits. */
export function bfToDecimal(a: BF, n: number): Decimal | null {
  if (!a.m) return null;
  const neg = a.m < 0n, m = neg ? -a.m : a.m;
  let E = Math.floor((bitLength(m) + a.e) * Math.log10(2)) + 1; // |a| < 10^E, give or take one
  for (let tries = 0; tries < 6; tries++) {
    const shift = n - E;  // round(|a|·10^shift) should have exactly n digits
    let num = m, den = 1n;
    if (shift >= 0) num *= 10n ** BigInt(shift); else den *= 10n ** BigInt(-shift);
    if (a.e >= 0) num <<= BigInt(a.e); else den <<= BigInt(-a.e);
    const s = ((2n * num + den) / (2n * den)).toString();
    if (s.length > n) { E++; continue; }
    if (s.length < n) { E--; continue; }
    return { neg, digits: s, exp10: E - 1 };
  }
  return null;
}
