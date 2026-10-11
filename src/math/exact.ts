/**
 * Closed forms. `exact` only guesses one from a float (shown with ≈ when not proven). `exactPoint` / `exactValue`
 * prove it: the expression is evaluated again in exact arithmetic, where a number is r + s√k (r, s rational
 * BigInt fractions, k squarefree) or a rational multiple of π. Values outside that (sin 1, ln 2, e) are skipped.
 */
import type { Node, Params } from './ast';
import { parse } from './parser';

// --- Guessing from a float ---

const GUESS_ROOTS = [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23];
/**
 * p/d with d ≤ 100, pπ/d and p√k/d with d ≤ 12; larger denominators read worse than the decimal. Matches only to
 * float rounding (1e-14 relative): a looser match would show 1.41421356237663 (a root of x² − 2.00000000001) as √2.
 */
export function exact(v: number): string | null {
  if (!Number.isFinite(v)) return null;
  if (v === 0) return '0';
  const units: [number, string][] = [[1, ''], [Math.PI, 'π'], ...GUESS_ROOTS.map((k): [number, string] => [Math.sqrt(k), `√${k}`])];
  for (const [unit, name] of units) {
    for (let d = 1; d <= (name ? 12 : 100); d++) {
      const p = Math.round(v / unit * d);
      if (!p || Math.abs(p * unit / d - v) >= 1e-14 * Math.abs(v) || (!name && Math.abs(p) >= 1e6)) continue;
      const n = Math.abs(p), numerator = name ? (n === 1 ? name : `${n}${name}`) : String(n);
      return `${p < 0 ? '−' : ''}${numerator}${d > 1 ? `/${d}` : ''}`;
    }
  }
  return null;
}

// --- Exact arithmetic ---

/** Not representable here (sin 1, e): the value can't be proven. */
const SKIP = Symbol('skip');
/** The expression is undefined at this point (1/0, √−1, ln 0). */
const UNDEFINED = Symbol('undefined');
const CAP = 10n ** 400n;

interface Q { n: bigint; d: bigint }
/** r + s√k, or a rational multiple of π. */
type X = { r: Q; s: Q; k: bigint; pi?: undefined } | { pi: Q };

const babs = (v: bigint) => v < 0n ? -v : v;
const gcd = (a: bigint, b: bigint) => { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; };
function q(n: bigint, d = 1n): Q {
  if (!d) throw UNDEFINED;
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  n /= g; d /= g;
  if (babs(n) > CAP || d > CAP) throw SKIP;
  return { n, d };
}
const Q0 = q(0n), Q1 = q(1n), HALF = q(1n, 2n);
const qadd = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const qmul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
const qdiv = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);
const qneg = (a: Q): Q => ({ n: -a.n, d: a.d });
const qsign = (a: Q) => a.n > 0n ? 1 : a.n < 0n ? -1 : 0;

const surd = (r: Q, s: Q = Q0, k = 1n): X => !s.n ? { r, s: Q0, k: 1n } : k === 1n ? { r: qadd(r, s), s: Q0, k: 1n } : { r, s, k };
const piTimes = (p: Q): X => p.n ? { pi: p } : surd(Q0);
const int = (n: number | bigint) => surd(q(BigInt(n)));
const rational = (x: X) => !x.pi && !x.s.n ? x.r : null;
const toNumber = (x: X) => {
  const f = (r: Q) => Number(r.n) / Number(r.d);
  return x.pi ? f(x.pi) * Math.PI : f(x.r) + f(x.s) * Math.sqrt(Number(x.k));
};

function sign(x: X): number {
  if (x.pi) return qsign(x.pi);
  const a = qsign(x.r), b = qsign(x.s);
  if (!a || !b || a === b) return a || b;
  // r and s√k of opposite signs: the larger of r² and s²k wins (never equal, √k is irrational).
  return qsign(qadd(qmul(x.r, x.r), qneg(qmul(qmul(x.s, x.s), q(x.k))))) > 0 ? a : b;
}
const neg = (x: X): X => x.pi ? piTimes(qneg(x.pi)) : surd(qneg(x.r), qneg(x.s), x.k);
function add(x: X, y: X): X {
  if (x.pi || y.pi) {
    if (x.pi && y.pi) return piTimes(qadd(x.pi, y.pi));
    const other = x.pi ? y : x;
    if (!sign(other)) return x.pi ? x : y;
    throw SKIP;
  }
  if (x.s.n && y.s.n && x.k !== y.k) throw SKIP;
  return surd(qadd(x.r, y.r), qadd(x.s, y.s), x.s.n ? x.k : y.k);
}
const sub = (x: X, y: X) => add(x, neg(y));
function mul(x: X, y: X): X {
  if (x.pi || y.pi) {
    const [p, o] = x.pi ? [x, y] : [y, x];
    const r = rational(o);
    if (!r || !p.pi) throw SKIP;
    return piTimes(qmul(p.pi, r));
  }
  if (x.s.n && y.s.n && x.k !== y.k) throw SKIP;
  const k = x.s.n ? x.k : y.k;
  return surd(qadd(qmul(x.r, y.r), qmul(qmul(x.s, y.s), q(k))), qadd(qmul(x.r, y.s), qmul(x.s, y.r)), k);
}
function div(x: X, y: X): X {
  if (x.pi && y.pi) return surd(qdiv(x.pi, y.pi));
  if (y.pi) { if (!sign(x)) return x; throw SKIP; }
  // 1/(r + s√k) = (r − s√k)/(r² − s²k); that denominator is 0 only when y = 0.
  const den = qadd(qmul(y.r, y.r), qneg(qmul(qmul(y.s, y.s), q(y.k))));
  return mul(x, surd(qdiv(y.r, den), qneg(qdiv(y.s, den)), y.k));
}
/** Equal, or certainly different: r + s√2 and r' + s'√3 with s, s' ≠ 0 never are, so SKIP means "different". */
function equal(x: X, y: X): boolean {
  try { return !sign(sub(x, y)); } catch (e) { if (e === SKIP) return false; throw e; }
}
function power(x: X, e: X): X {
  const r = rational(e);
  if (!r || r.d !== 1n || babs(r.n) > 10000n) throw SKIP;
  let m = babs(r.n), out = int(1), base = r.n < 0n ? div(int(1), x) : x;
  while (m) {
    if (m & 1n) out = mul(out, base);
    m >>= 1n;
    if (m) base = mul(base, base);
  }
  return out;
}
function floor(x: X): X {
  if (x.pi) throw SKIP;
  if (!x.s.n) { const { n, d } = x.r; return int(n / d - (n % d < 0n ? 1n : 0n)); } // BigInt division rounds toward 0
  const guess = Math.floor(toNumber(x));
  if (!Number.isFinite(guess)) throw SKIP;
  let n = BigInt(guess);
  while (sign(sub(x, int(n))) < 0) n--;
  while (sign(sub(x, int(n + 1n))) >= 0) n++;
  return int(n);
}
function sqrt(x: X): X {
  const r = rational(x);
  if (!r) throw SKIP;
  if (r.n < 0n) throw UNDEFINED;
  if (!r.n) return int(0); // otherwise 1·√0, shown as "√0"
  // √(n/d) = √(nd)/d; nd = square · squarefree by trial division.
  const m = r.n * r.d;
  if (m > 10n ** 10n) throw SKIP;
  let rest = Number(m), out = 1;
  for (let p = 2; p * p <= rest; p++) while (rest % (p * p) === 0) { rest /= p * p; out *= p; }
  return surd(Q0, q(BigInt(out), r.d), BigInt(rest));
}

/** sin(mπ/12) where it has a closed form here: multiples of 30° and 45°. */
function sinTwelfths(m: number): X {
  m = ((m % 24) + 24) % 24;
  const table: (X | undefined)[] = [surd(Q0), undefined, surd(HALF), surd(Q0, HALF, 2n), surd(Q0, HALF, 3n), undefined, int(1)];
  const v = table[m % 12 > 6 ? 12 - m % 12 : m % 12];
  if (!v) throw SKIP;
  return m >= 12 ? neg(v) : v;
}
function twelfths(x: X): number {
  if (!x.pi) { if (!sign(x)) return 0; throw SKIP; }
  const t = x.pi.n * 12n;
  if (t % x.pi.d) throw SKIP;
  return Number((t / x.pi.d) % 24n);
}
const sinX = (x: X) => sinTwelfths(twelfths(x));
const cosX = (x: X) => sinTwelfths(twelfths(x) + 6);
/** Inverse trig: try each nice angle in the function's range. */
function inverse(f: (m: number) => X, angles: number[], v: X): X {
  for (const m of angles) {
    let y: X;
    try { y = f(m); } catch (e) { if (e === SKIP || e === UNDEFINED) continue; throw e; }
    if (equal(y, v)) return piTimes(q(BigInt(m), 12n));
  }
  throw SKIP;
}
const absX = (x: X) => sign(x) < 0 ? neg(x) : x;
const beyondOne = (v: X) => sign(sub(absX(v), int(1))) > 0;
function logBase(base: X, v: X): X {
  if (sign(v) <= 0 || sign(base) <= 0 || equal(base, int(1))) throw UNDEFINED;
  const n = Math.round(Math.log(toNumber(v)) / Math.log(toNumber(base)));
  if (Number.isFinite(n) && Math.abs(n) <= 1000 && equal(power(base, int(n)), v)) return int(n);
  throw SKIP;
}
const atanX = (v: X) => inverse(m => div(sinTwelfths(m), sinTwelfths(m + 6)), [-4, -3, -2, 0, 2, 3, 4], v);

const EXACT_FN: Record<string, (...xs: X[]) => X> = {
  sin: sinX, cos: cosX, tan: x => div(sinX(x), cosX(x)), cot: x => div(cosX(x), sinX(x)),
  sec: x => div(int(1), cosX(x)), csc: x => div(int(1), sinX(x)),
  asin: v => { if (beyondOne(v)) throw UNDEFINED; return inverse(sinTwelfths, [-6, -4, -3, -2, 0, 2, 3, 4, 6], v); },
  acos: v => { if (beyondOne(v)) throw UNDEFINED; return inverse(m => sinTwelfths(m + 6), [0, 2, 3, 4, 6, 8, 9, 10, 12], v); },
  atan: atanX, acot: v => sub(piTimes(HALF), atanX(v)),
  sqrt, root: (n, x) => { if (equal(n, int(2))) return sqrt(x); throw SKIP; },
  abs: absX, sign: x => int(sign(x)), floor, ceil: x => neg(floor(neg(x))), round: x => floor(add(x, surd(HALF))),
  exp: x => { if (!sign(x)) return int(1); throw SKIP; },
  ln: x => { if (sign(x) <= 0) throw UNDEFINED; if (equal(x, int(1))) return int(0); throw SKIP; },
  log: (a, b) => b === undefined ? logBase(int(10), a) : logBase(a, b), log2: x => logBase(int(2), x),
  min: (...xs) => xs.reduce((a, b) => sign(sub(b, a)) < 0 ? b : a),
  max: (...xs) => xs.reduce((a, b) => sign(sub(b, a)) > 0 ? b : a),
  mod: (a, b) => sub(a, mul(b, floor(div(a, b)))),
};

/** Exact value of a decimal literal: "2,5", ".5", "1e-3". */
function decimal(s: string): X {
  const m = s.replace(',', '.').match(/^([+-]?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i);
  if (!m) throw SKIP;
  const e = BigInt(m[4] ?? 0) - BigInt(m[3].length), n = BigInt(`${m[1]}${m[2]}${m[3]}0`) / 10n;
  if (babs(e) > 400n) throw SKIP;
  return surd(e < 0n ? q(n, 10n ** -e) : q(n * 10n ** e));
}

function evaluate(n: Node, x: X, params: Params): X {
  const ev = (m: Node) => evaluate(m, x, params);
  switch (n.t) {
    case 'num': return decimal(n.s);
    case 'x': return x;
    case 'const':
      if (n.n === 'pi') return piTimes(Q1);
      if (n.n === 'tau') return piTimes(q(2n));
      if (n.n === 'phi') return surd(HALF, HALF, 5n);
      throw SKIP;
    case 'param': return decimal(String(Object.hasOwn(params, n.n) ? params[n.n] : 1));
    case 'neg': return neg(ev(n.a));
    case '+': return add(ev(n.a), ev(n.b));
    case '-': return sub(ev(n.a), ev(n.b));
    case '*': return mul(ev(n.a), ev(n.b));
    case '/': return div(ev(n.a), ev(n.b));
    case '^': {
      const e = ev(n.b);
      if (n.a.t === 'const' && !sign(e)) return int(1); // e⁰ = 1
      return power(ev(n.a), e);
    }
    case '°': return mul(ev(n.a), piTimes(q(1n, 180n)));
    case '!': {
      const r = rational(ev(n.a));
      if (!r || r.d !== 1n || r.n < 0n || r.n > 170n) throw SKIP;
      let out = 1n;
      for (let i = 2n; i <= r.n; i++) out *= i;
      return surd(q(out));
    }
    case 'call': {
      const f = EXACT_FN[n.n];
      if (!f) throw SKIP;
      return f(...n.args.map(ev));
    }
  }
}

const CANDIDATE_ROOTS = [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23, 26, 29, 30];
/** Closed forms within 1e-6 of v worth checking: rationals (continued fractions), pπ/d, (p + s√k)/d. */
function candidates(v: number): X[] {
  const out: X[] = [], near = (c: number) => Math.abs(c - v) <= 1e-6 * Math.max(1, Math.abs(v));
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0, r = v;
  for (let i = 0; i < 40 && Number.isFinite(r); i++) {
    const a = Math.floor(r);
    [h0, h1, k0, k1] = [h1, a * h1 + h0, k1, a * k1 + k0];
    if (k1 > 10000 || !Number.isSafeInteger(h1)) break;
    if (near(h1 / k1)) out.push(surd(q(BigInt(h1), BigInt(k1))));
    if (r === a) break;
    r = 1 / (r - a);
  }
  for (let d = 1; d <= 12; d++) {
    const p = Math.round(v / Math.PI * d);
    if (p && near(p * Math.PI / d)) out.push(piTimes(q(BigInt(p), BigInt(d))));
  }
  for (const k of CANDIDATE_ROOTS) for (let d = 1; d <= 12; d++) for (let s = -12; s <= 12; s++) {
    const p = Math.round(v * d - s * Math.sqrt(k));
    if (s && Number.isSafeInteger(p) && near((p + s * Math.sqrt(k)) / d)) out.push(surd(q(BigInt(p), BigInt(d)), q(BigInt(s), BigInt(d)), BigInt(k)));
  }
  return out;
}

/** Text of a closed form, or null when it would read worse than a decimal. */
function show(x: X): string | null {
  const small = (...ns: bigint[]) => ns.every(n => babs(n) <= 10n ** 12n);
  const times = (n: bigint, unit: string) => `${babs(n) === 1n && unit ? '' : babs(n)}${unit}`;
  const minus = (n: bigint) => n < 0n ? '−' : '';
  if (x.pi) {
    const { n, d } = x.pi;
    return d <= 1000n && small(n) ? `${minus(n)}${times(n, 'π')}${d > 1n ? `/${d}` : ''}` : null;
  }
  const D = x.r.d * x.s.d / gcd(x.r.d, x.s.d), A = x.r.n * D / x.r.d, B = x.s.n * D / x.s.d;
  if (D > 1000n || !small(A, B)) return null;
  const over = D > 1n ? `/${D}` : '';
  if (!B) return `${minus(A)}${babs(A)}${over}`;
  const root = times(B, `√${x.k}`);
  if (!A) return `${minus(B)}${root}${over}`;
  const body = `${minus(A)}${babs(A)} ${B < 0n ? '−' : '+'} ${root}`;
  return D > 1n ? `(${body})${over}` : body;
}

function attempt<T>(f: () => T): T | typeof SKIP | typeof UNDEFINED {
  try { return f(); } catch (e) { if (e === SKIP || e === UNDEFINED) return e; throw e; }
}

export interface ExactPoint { x: string | null; y: string | null }

/**
 * A proven point near x where all the given expressions take the same value (for a root pass the function and '0').
 * ponytail: accepts a closed form within 1e-6 of x; two different roots closer than that could swap labels.
 */
export function exactPoint(inputs: string[], params: Params, x: number): ExactPoint | null {
  let trees: Node[];
  try { trees = inputs.map(parse); } catch { return null; }
  for (const c of candidates(x)) {
    const ys = attempt(() => trees.map(t => evaluate(t, c, params)));
    if (Array.isArray(ys) && ys.every(y => equal(y, ys[0]))) return { x: show(c), y: show(ys[0]) };
  }
  return null;
}

/** f(x) at a decimal x: closed form, null if it can't be proven, undefined if f isn't defined there. */
export function exactValue(input: string, params: Params, x: number): string | null | undefined {
  let tree: Node;
  try { tree = parse(input); } catch { return null; }
  const y = attempt(() => evaluate(tree, decimal(String(x)), params));
  return y === UNDEFINED ? undefined : y === SKIP ? null : show(y);
}
