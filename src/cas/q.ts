/**
 * Exact rationals on BigInt, and the integer helpers the rest of the engine leans on.
 * Every value here is exact; nothing is rounded.
 */

/** A message for the user (Polish). Anything else thrown is a bug. */
export class CasError extends Error {}
export const fail = (message: string): never => { throw new CasError(message); };

/** n/d with d > 0 and gcd(n, d) = 1. */
export interface Q { readonly n: bigint; readonly d: bigint }

/** Integers past this many bits are refused: 2^(10^9) would freeze the tab long before the timeout. */
export const MAX_BITS = 1_000_000;

export const babs = (v: bigint) => v < 0n ? -v : v;
export function gcd(a: bigint, b: bigint): bigint {
  a = babs(a); b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
export const lcm = (a: bigint, b: bigint) => a && b ? babs(a / gcd(a, b) * b) : 0n;

export function bitLength(v: bigint): number {
  v = babs(v);
  if (!v) return 0;
  // toString(16) is linear; good enough and exact.
  const hex = v.toString(16);
  return (hex.length - 1) * 4 + (32 - Math.clz32(parseInt(hex[0], 16)));
}

function guard(v: bigint): bigint {
  if (bitLength(v) > MAX_BITS) fail('Liczba jest za duża (ponad milion bitów).');
  return v;
}

export function q(n: bigint | number, d: bigint | number = 1n): Q {
  let N = BigInt(n), D = BigInt(d);
  if (!D) fail('Dzielenie przez zero.');
  if (D < 0n) { N = -N; D = -D; }
  const g = gcd(N, D);
  if (g > 1n) { N /= g; D /= g; }
  return { n: guard(N), d: guard(D) };
}

export const Q0 = q(0), Q1 = q(1), QM1 = q(-1), QHALF = q(1, 2);
export const qadd = (a: Q, b: Q) => a.d === b.d ? q(a.n + b.n, a.d) : q(a.n * b.d + b.n * a.d, a.d * b.d);
export const qsub = (a: Q, b: Q) => qadd(a, qneg(b));
export const qmul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
export const qdiv = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);
export const qneg = (a: Q): Q => ({ n: -a.n, d: a.d });
export const qinv = (a: Q) => q(a.d, a.n);
export const qabs = (a: Q): Q => a.n < 0n ? qneg(a) : a;
export const qsign = (a: Q) => a.n > 0n ? 1 : a.n < 0n ? -1 : 0;
export const qcmp = (a: Q, b: Q) => { const v = a.n * b.d - b.n * a.d; return v > 0n ? 1 : v < 0n ? -1 : 0; };
export const qeq = (a: Q, b: Q) => a.n === b.n && a.d === b.d;
export const qint = (a: Q) => a.d === 1n;
export const qfloor = (a: Q) => { const f = a.n / a.d; return a.n < 0n && f * a.d !== a.n ? f - 1n : f; };
export const qceil = (a: Q) => -qfloor(qneg(a));
/** Rounds half away from zero. */
export const qround = (a: Q) => a.n < 0n ? -qfloor(qadd(qneg(a), QHALF)) : qfloor(qadd(a, QHALF));

/** a^k for an integer k, refused before it would exceed MAX_BITS. */
export function qpow(a: Q, k: bigint): Q {
  if (k < 0n) { if (!a.n) fail('Dzielenie przez zero.'); return qpow(qinv(a), -k); }
  if (!k) return Q1;
  if (!a.n || (babs(a.n) === 1n && a.d === 1n)) return a.n < 0n && k % 2n === 0n ? Q1 : a;
  const bits = Math.max(bitLength(a.n), bitLength(a.d));
  if (bits * Number(k) > MAX_BITS || k > BigInt(MAX_BITS)) fail('Wynik jest za duży (ponad milion bitów).');
  return { n: a.n ** k, d: a.d ** k };
}

/** A float approximation that survives numerators and denominators far beyond 1e308. */
export function qToNumber(a: Q): number {
  let { n, d } = a;
  const shift = Math.max(bitLength(n), bitLength(d)) - 1000;
  if (shift > 0) { n >>= BigInt(shift); d >>= BigInt(shift); if (!d) return n < 0n ? -Infinity : Infinity; }
  return Number(n) / Number(d);
}

/** Exact value of a decimal literal: "2.5", ".5", "1e-3", "1,5". */
export function parseDecimal(s: string): Q {
  const m = s.replace(',', '.').match(/^(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i);
  if (!m) return fail(`Niepoprawna liczba „${s}”.`);
  const e = Number(m[3] ?? 0) - m[2].length;
  if (Math.abs(e) > 100000) fail('Wykładnik liczby jest za duży.');
  const n = BigInt(`${m[1]}${m[2]}` || '0');
  return e < 0 ? q(n, 10n ** BigInt(-e)) : q(n * 10n ** BigInt(e));
}

/** ⌊√n⌋ for n ≥ 0. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) fail('Pierwiastek z liczby ujemnej.');
  if (n < 2n) return n;
  // Newton from above: the iterates fall monotonically to ⌊√n⌋.
  let x = 1n << BigInt(Math.ceil(bitLength(n) / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** ⌊n^(1/k)⌋ for n ≥ 0. */
export function iroot(n: bigint, k: number): bigint {
  if (k === 1 || n < 2n) return n;
  if (k === 2) return isqrt(n);
  const K = BigInt(k);
  let x = 1n << BigInt(Math.ceil(bitLength(n) / k) + 1);
  for (;;) {
    const y = ((K - 1n) * x + n / x ** (K - 1n)) / K;
    if (y >= x) break;
    x = y;
  }
  while (x ** K > n) x--;
  while ((x + 1n) ** K <= n) x++;
  return x;
}

const SMALL_PRIMES: number[] = [];
for (let p = 2; SMALL_PRIMES.length < 1229; p++) if (SMALL_PRIMES.every(s => s * s > p || p % s)) SMALL_PRIMES.push(p);

/**
 * n = out^k · rest with as much as can be found pulled out: trial division by primes below 10⁴, then a check
 * whether what is left is itself a perfect k-th power. rest may still hide a k-th power of a large prime; the
 * result is then less simplified, never wrong.
 */
export function extractPower(n: bigint, k: number): [bigint, bigint] {
  let out = 1n, rest = n;
  const K = BigInt(k);
  for (const sp of SMALL_PRIMES) {
    const p = BigInt(sp), pk = p ** K;
    if (pk > rest) break;
    while (rest % pk === 0n) { rest /= pk; out *= p; }
  }
  const r = iroot(rest, k);
  if (r ** K === rest) return [out * r, 1n];
  return [out, rest];
}
