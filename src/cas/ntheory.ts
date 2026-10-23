/**
 * Number theory on BigInt. Primality: deterministic Miller–Rabin below 3.3·10²⁴ (proven), BPSW above (no known
 * counterexample; reported as such). Factoring: trial division, then Pollard–Brent; a factor it can't split in
 * its budget is reported as unfactored, never guessed.
 */
import { babs, bitLength, fail, gcd, isqrt, Q, q } from './q';

export function modpow(b: bigint, e: bigint, m: bigint): bigint {
  if (m === 1n) return 0n;
  if (e < 0n) { b = modinv(b, m); e = -e; }
  let r = 1n;
  b = ((b % m) + m) % m;
  while (e) {
    if (e & 1n) r = r * b % m;
    e >>= 1n;
    if (e) b = b * b % m;
  }
  return r;
}

/** [g, x, y] with ax + by = g = gcd(a, b). */
export function egcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  let [r0, r1, s0, s1, t0, t1] = [a, b, 1n, 0n, 0n, 1n];
  while (r1) {
    const k = r0 / r1;
    [r0, r1] = [r1, r0 - k * r1];
    [s0, s1] = [s1, s0 - k * s1];
    [t0, t1] = [t1, t0 - k * t1];
  }
  return r0 < 0n ? [-r0, -s0, -t0] : [r0, s0, t0];
}
export function modinv(a: bigint, m: bigint): bigint {
  if (m <= 0n) fail('Moduł musi być dodatni.');
  const [g, x] = egcd(((a % m) + m) % m, m);
  if (g !== 1n) fail(`${a} nie ma odwrotności modulo ${m} (NWD = ${g}).`);
  return ((x % m) + m) % m;
}

const SMALL = (() => {
  const out: bigint[] = [];
  const sieve = new Uint8Array(10001);
  for (let p = 2; p <= 10000; p++) if (!sieve[p]) { out.push(BigInt(p)); for (let k = p * p; k <= 10000; k += p) sieve[k] = 1; }
  return out;
})();

function strongProbablePrime(n: bigint, a: bigint): boolean {
  let d = n - 1n, s = 0;
  while (!(d & 1n)) { d >>= 1n; s++; }
  let x = modpow(a, d, n);
  if (x === 1n || x === n - 1n) return true;
  for (let r = 1; r < s; r++) {
    x = x * x % n;
    if (x === n - 1n) return true;
    if (x === 1n) return false;
  }
  return false;
}
function jacobi(a: bigint, n: bigint): number {
  a = ((a % n) + n) % n;
  let t = 1;
  while (a) {
    while (!(a & 1n)) { a >>= 1n; const r = n % 8n; if (r === 3n || r === 5n) t = -t; }
    [a, n] = [n, a];
    if (a % 4n === 3n && n % 4n === 3n) t = -t;
    a %= n;
  }
  return n === 1n ? t : 0;
}
/** Strong Lucas probable prime test with Selfridge's parameters. */
function strongLucas(n: bigint): boolean {
  const r = isqrt(n);
  if (r * r === n) return false;
  let D = 5n;
  for (;;) {
    const j = jacobi(D, n);
    if (j === -1) break;
    if (j === 0 && babs(D) !== n) return false;
    D = D > 0n ? -(D + 2n) : -D + 2n;
  }
  const P = 1n, Qp = (1n - D) / 4n;
  let d = n + 1n, s = 0;
  while (!(d & 1n)) { d >>= 1n; s++; }
  const mod = (x: bigint) => ((x % n) + n) % n;
  const half = (x: bigint) => { x = mod(x); return (x & 1n ? x + n : x) / 2n; };
  // binary method for U_d, V_d
  let U = 1n, V = P, Qk = mod(Qp);
  const bits = d.toString(2);
  for (let b = 1; b < bits.length; b++) {
    U = mod(U * V); V = mod(V * V - 2n * Qk); Qk = mod(Qk * Qk);
    if (bits[b] === '1') {
      const U2 = half(P * U + V), V2 = half(D * U + P * V);
      U = U2; V = V2; Qk = mod(Qk * Qp);
    }
  }
  if (U === 0n || V === 0n) return true;
  for (let r2 = 1; r2 < s; r2++) {
    V = mod(V * V - 2n * Qk); Qk = mod(Qk * Qk);
    if (V === 0n) return true;
  }
  return false;
}

const DETERMINISTIC_LIMIT = 3317044064679887385961981n;
export type Primality = 'prime' | 'composite' | 'probable';
export function primality(n: bigint): Primality {
  if (n < 2n) return 'composite';
  for (const p of SMALL) {
    if (n === p) return 'prime';
    if (n % p === 0n) return 'composite';
  }
  if (n < 100000000n) return 'prime'; // no factor below 10⁴
  if (n < DETERMINISTIC_LIMIT) {
    for (const a of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n]) if (!strongProbablePrime(n, a)) return 'composite';
    return 'prime';
  }
  if (!strongProbablePrime(n, 2n) || !strongLucas(n)) return 'composite';
  return 'probable';
}
export const isPrime = (n: bigint) => primality(n) !== 'composite';

function pollardBrent(n: bigint, budget: { steps: number }): bigint | null {
  if (!(n & 1n)) return 2n;
  for (let c = 1n; c < 40n; c++) {
    let y = 2n, r = 1, qv = 1n, g = 1n, x = 0n, ys = 0n;
    const m = 128;
    const f = (v: bigint) => (v * v + c) % n;
    do {
      x = y;
      for (let i = 0; i < r; i++) y = f(y);
      let k = 0;
      do {
        ys = y;
        for (let i = 0; i < Math.min(m, r - k); i++) { y = f(y); qv = qv * babs(x - y) % n; }
        g = gcd(qv, n);
        k += m;
        budget.steps -= m;
        if (budget.steps < 0) return null;
      } while (k < r && g === 1n);
      r *= 2;
    } while (g === 1n);
    if (g === n) {
      do { ys = f(ys); g = gcd(babs(x - ys), n); } while (g === 1n);
    }
    if (g !== n) return g;
  }
  return null;
}

export interface Factorization { factors: [bigint, number][]; unfactored: bigint[]; probable: bigint[] }
/** n = ± Π p^e. Primes above 3.3·10²⁴ are BPSW-probable (listed in `probable`). */
export function factorInteger(n: bigint, steps = 3_000_000): Factorization {
  const out = new Map<bigint, number>(), unfactored: bigint[] = [], probable: bigint[] = [];
  n = babs(n);
  if (n < 2n) return { factors: [], unfactored, probable };
  const addF = (p: bigint, e = 1) => out.set(p, (out.get(p) ?? 0) + e);
  for (const p of SMALL) {
    if (p * p > n) break;
    while (n % p === 0n) { n /= p; addF(p); }
  }
  const budget = { steps };
  const stack = n > 1n ? [n] : [];
  while (stack.length) {
    const m = stack.pop()!;
    if (m === 1n) continue;
    const pr = primality(m);
    if (pr !== 'composite') { addF(m); if (pr === 'probable') probable.push(m); continue; }
    // perfect powers first: Pollard is slow on p²
    const pp = perfectPower(m);
    if (pp) { for (let k = 0; k < pp[1]; k++) stack.push(pp[0]); continue; }
    const f = pollardBrent(m, budget);
    if (!f) { unfactored.push(m); continue; }
    stack.push(f, m / f);
  }
  return { factors: [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)), unfactored, probable };
}
export function perfectPower(n: bigint): [bigint, number] | null {
  for (let k = Math.min(64, bitLength(n)); k >= 2; k--) {
    const r = irootB(n, k);
    if (r ** BigInt(k) === n) return [r, k];
  }
  return null;
}
function irootB(n: bigint, k: number): bigint {
  let x = 1n << BigInt(Math.ceil(bitLength(n) / k) + 1);
  const K = BigInt(k);
  for (;;) { const y = ((K - 1n) * x + n / x ** (K - 1n)) / K; if (y >= x) break; x = y; }
  while (x ** K > n) x--;
  return x;
}

function fullFactor(n: bigint): [bigint, number][] {
  const f = factorInteger(n);
  if (f.unfactored.length) fail(`Nie udało się rozłożyć liczby ${n} na czynniki w rozsądnym czasie.`);
  return f.factors;
}

export function divisors(n: bigint, cap = 100000): bigint[] {
  n = babs(n);
  if (!n) fail('Zero ma nieskończenie wiele dzielników.');
  let out = [1n];
  for (const [p, e] of fullFactor(n)) {
    const next: bigint[] = [];
    for (const d of out) { let pk = 1n; for (let k = 0; k <= e; k++) { next.push(d * pk); pk *= p; } }
    out = next;
    if (out.length > cap) fail(`Liczba ma ponad ${cap} dzielników.`);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
/** Divisors of n if there are at most `cap`, else null (for searches that just give up). */
export function divisorsCapped(n: bigint, cap: number, effort = 200000): bigint[] | null {
  n = babs(n);
  if (!n) return null;
  const f = factorInteger(n, effort);
  if (f.unfactored.length) return null;
  let count = 1;
  for (const [, e] of f.factors) count *= e + 1;
  if (count > cap) return null;
  let out = [1n];
  for (const [p, e] of f.factors) {
    const next: bigint[] = [];
    for (const d of out) { let pk = 1n; for (let k = 0; k <= e; k++) { next.push(d * pk); pk *= p; } }
    out = next;
  }
  return out;
}

export function totient(n: bigint): bigint {
  if (n < 1n) fail('Funkcja φ Eulera jest określona dla liczb naturalnych.');
  let r = n;
  for (const [p] of fullFactor(n)) r = r / p * (p - 1n);
  return r;
}
export function sigma(n: bigint, k = 1n): bigint {
  if (n < 1n) fail('Funkcja σ jest określona dla liczb naturalnych.');
  let r = 1n;
  for (const [p, e] of fullFactor(n)) {
    let s = 0n, pk = 1n;
    const step = p ** k;
    for (let j = 0; j <= e; j++) { s += pk; pk *= step; }
    r *= s;
  }
  return r;
}
export function mobius(n: bigint): number {
  if (n < 1n) fail('Funkcja Möbiusa jest określona dla liczb naturalnych.');
  const f = fullFactor(n);
  if (f.some(([, e]) => e > 1)) return 0;
  return f.length % 2 ? -1 : 1;
}

export function nextPrime(n: bigint): bigint {
  if (n < 2n) return 2n;
  let m = n + 1n;
  if (m > 2n && !(m & 1n)) m++;
  while (!isPrime(m)) m += m === 2n ? 1n : 2n;
  return m;
}
export function prevPrime(n: bigint): bigint {
  if (n <= 2n) fail('Nie ma liczby pierwszej mniejszej od 2.');
  let m = n - 1n;
  if (m > 2n && !(m & 1n)) m--;
  while (!isPrime(m)) m -= m === 3n ? 1n : 2n;
  return m;
}

/** Odd-only sieve: isComposite[(k−1)/2] for odd k. */
function sieveOdd(limit: number): Uint8Array {
  const size = Math.floor((limit - 1) / 2) + 1, comp = new Uint8Array(size);
  for (let i = 1; (2 * i + 1) * (2 * i + 1) <= limit; i++) {
    if (comp[i]) continue;
    const p = 2 * i + 1;
    for (let j = (p * p - 1) / 2; j < size; j += p) comp[j] = 1;
  }
  return comp;
}
/** The n-th prime, n ≤ 5·10⁶. */
export function nthPrime(n: number): bigint {
  if (!Number.isInteger(n) || n < 1) fail('Numer liczby pierwszej musi być liczbą naturalną.');
  if (n > 5_000_000) fail('Obliczam n-tą liczbę pierwszą dla n ≤ 5 000 000.');
  if (n === 1) return 2n;
  const ln = Math.log(n), limit = Math.max(30, Math.ceil(n * (ln + Math.log(ln))) + 10);
  const comp = sieveOdd(limit);
  let count = 1;
  for (let i = 1; i < comp.length; i++) if (!comp[i] && ++count === n) return BigInt(2 * i + 1);
  return fail('Błąd sita.');
}
/** π(x): the number of primes ≤ x, by a segmented sieve (x ≤ 10⁹). */
export function primePi(x: bigint): bigint {
  if (x < 2n) return 0n;
  if (x > 1_000_000_000n) fail('Liczę π(x) dla x ≤ 10⁹.');
  const X = Number(x), root = Math.floor(Math.sqrt(X)) + 1;
  const small: number[] = [];
  const base = sieveOdd(root);
  for (let i = 1; i < base.length; i++) if (!base[i]) small.push(2 * i + 1);
  let count = 1; // the prime 2
  const SEG = 1 << 20;
  const seg = new Uint8Array(SEG);
  for (let lo = 3; lo <= X; lo += 2 * SEG) {
    // segment holds odd numbers lo, lo+2, …
    seg.fill(0);
    const hi = Math.min(X, lo + 2 * SEG - 2);
    for (const p of small) {
      if (p * p > hi) break;
      let start = Math.max(p * p, Math.ceil(lo / p) * p);
      if (!(start & 1)) start += p;
      for (let m = start; m <= hi; m += 2 * p) seg[(m - lo) >> 1] = 1;
    }
    for (let k = 0, v = lo; v <= hi; k++, v += 2) if (!seg[k]) count++;
  }
  return BigInt(count);
}

/** F(n) and L(n) by fast doubling (negative n by F(−n) = (−1)^(n+1) F(n)). */
export function fibonacci(n: bigint): bigint {
  if (n < 0n) { const f = fibonacci(-n); return (-n) % 2n ? f : -f; }
  if (n > 5_000_000n) fail('Obliczam liczby Fibonacciego do n = 5 000 000.');
  const fd = (k: bigint): [bigint, bigint] => {
    if (!k) return [0n, 1n];
    const [a, b] = fd(k >> 1n), c = a * (2n * b - a), d = a * a + b * b;
    return k & 1n ? [d, c + d] : [c, d];
  };
  return fd(n)[0];
}
export function lucas(n: bigint): bigint {
  if (n < 0n) { const l = lucas(-n); return (-n) % 2n ? -l : l; }
  return fibonacci(n - 1n) + fibonacci(n + 1n);
}

/** x ≡ a_k (mod m_k) for all k; moduli need not be coprime. Returns [x, M] or fails when inconsistent. */
export function crt(as: bigint[], ms: bigint[]): [bigint, bigint] {
  if (as.length !== ms.length || !as.length) fail('CRT: podaj tyle samo reszt co modułów.');
  let x = 0n, M = 1n;
  for (let k = 0; k < as.length; k++) {
    const a = as[k], m = ms[k];
    if (m <= 0n) fail('Moduły muszą być dodatnie.');
    const [g, p] = egcd(M, m);
    if ((a - x) % g) fail('Ten układ kongruencji jest sprzeczny.');
    const l = M / g * m;
    x = ((x + M * ((a - x) / g * p % (m / g))) % l + l) % l;
    M = l;
  }
  return [x, M];
}

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function toBase(n: bigint, b: number): string {
  if (!Number.isInteger(b) || b < 2 || b > 36) fail('Podstawa systemu musi być liczbą od 2 do 36.');
  if (!n) return '0';
  const neg = n < 0n;
  let m = babs(n), s = '';
  const B = BigInt(b);
  while (m) { s = DIGITS[Number(m % B)] + s; m /= B; }
  return (neg ? '−' : '') + s;
}

/** Decimal expansion of a rational: integer part, pre-period and period (empty when it terminates). */
export function decimalExpansion(v: Q, base = 10, maxDigits = 2000): { int: string; pre: string; period: string; periodLength: bigint | null } {
  const B = BigInt(base), neg = v.n < 0n;
  let n = babs(v.n);
  const d = v.d;
  const int = (neg ? '−' : '') + toBase(n / d, base);
  n %= d;
  // long division; a remainder seen before starts the period
  let rem = n, steps = 0, digits = '';
  const seen = new Map<bigint, number>();
  while (rem && steps < maxDigits) {
    if (seen.has(rem)) {
      const at = seen.get(rem)!;
      return { int, pre: digits.slice(0, at), period: digits.slice(at), periodLength: BigInt(digits.length - at) };
    }
    seen.set(rem, steps);
    rem *= B;
    digits += DIGITS[Number(rem / d)];
    rem %= d;
    steps++;
  }
  if (!rem) return { int, pre: digits, period: '', periodLength: 0n };
  return { int, pre: digits, period: '', periodLength: null };
}

/** Continued fraction of a rational. */
export function continuedFraction(v: Q): bigint[] {
  const out: bigint[] = [];
  let n = v.n, d = v.d;
  while (d) {
    let a = n / d;
    if (n % d && (n < 0n) !== (d < 0n)) a--; // floor
    out.push(a);
    [n, d] = [d, n - a * d];
  }
  return out;
}
export function fromContinuedFraction(a: bigint[]): Q {
  let n = 1n, d = 0n;
  for (let k = a.length - 1; k >= 0; k--) [n, d] = [a[k] * n + d, n];
  return q(n, d);
}
