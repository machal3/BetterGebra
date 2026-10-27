/**
 * Symbolic expressions in automatically simplified form (after Cohen, "Computer Algebra and Symbolic Computation").
 * Every constructor returns a canonical expression: sums and products are flat, sorted, with like terms and like
 * bases combined; numbers are exact rationals; roots of rationals are pulled apart (√12 → 2√3, 1/√2 → √2/2).
 * Subtraction is a + (−1)·b, division a·b^(−1), √x is x^(1/2). Expressions are immutable and may share subtrees.
 */
import { Q, Q0, Q1, QHALF, QM1, MAX_BITS, bitLength, extractPower, fail, iroot, q, qadd, qcmp, qdiv, qeq, qfloor, qint, qmul, qpow, qsign, qsub } from './q';

export type Expr = Num | Sym | Add | Mul | Pow | Fn;
export interface Num { readonly k: 'n'; readonly v: Q }
/** Variables, and the constants pi, e, i, inf. */
export interface Sym { readonly k: 's'; readonly n: string }
export interface Add { readonly k: '+'; readonly t: readonly Expr[] }
export interface Mul { readonly k: '*'; readonly t: readonly Expr[] }
export interface Pow { readonly k: '^'; readonly b: Expr; readonly e: Expr }
export interface Fn { readonly k: 'f'; readonly n: string; readonly a: readonly Expr[] }

export const num = (v: Q | number | bigint, d: number | bigint = 1): Num => ({ k: 'n', v: typeof v === 'object' ? v : q(v, d) });
export const sym = (n: string): Sym => ({ k: 's', n });
export const ZERO = num(0), ONE = num(1), MINUS_ONE = num(-1), TWO = num(2), HALF: Num = { k: 'n', v: QHALF };
export const PI = sym('pi'), E = sym('e'), I = sym('i'), INF = sym('inf');
export const CONSTANTS = new Set(['pi', 'e', 'i', 'inf']);

export const isNum = (e: Expr): e is Num => e.k === 'n';
export const isInt = (e: Expr): e is Num & { readonly v: { readonly d: 1n } } => e.k === 'n' && e.v.d === 1n;
export const isZero = (e: Expr) => e.k === 'n' && e.v.n === 0n;
export const isOne = (e: Expr) => e.k === 'n' && e.v.n === 1n && e.v.d === 1n;
// The name is part of the guarded type, so a failed isFn(x, 'sin') doesn't rule out every other call.
export const isSym = <N extends string>(e: Expr, n?: N): e is Sym & { readonly n: N } => e.k === 's' && (n === undefined || e.n === n);
export const isFn = <N extends string>(e: Expr, n?: N): e is Fn & { readonly n: N } => e.k === 'f' && (n === undefined || e.n === n);
export const isInf = (e: Expr) => isSym(e, 'inf') || (e.k === '*' && e.t.length === 2 && isNum(e.t[0]) && isSym(e.t[1], 'inf'));
/** +1 for ∞, −1 for −∞, 0 otherwise. */
export const infSign = (e: Expr) => isSym(e, 'inf') ? 1 : isInf(e) ? qsign((e as Mul).t[0].k === 'n' ? ((e as Mul).t[0] as Num).v : Q1) : 0;

// --- Canonical key and order ---

const keys = new WeakMap<Expr, string>();
/** A string that is equal for equal canonical expressions. */
export function key(e: Expr): string {
  let s = keys.get(e);
  if (s !== undefined) return s;
  switch (e.k) {
    case 'n': s = e.v.d === 1n ? `${e.v.n}` : `${e.v.n}/${e.v.d}`; break;
    case 's': s = e.n; break;
    case '+': s = `(+ ${e.t.map(key).join(' ')})`; break;
    case '*': s = `(* ${e.t.map(key).join(' ')})`; break;
    case '^': s = `(^ ${key(e.b)} ${key(e.e)})`; break;
    case 'f': s = `(${e.n} ${e.a.map(key).join(' ')})`; break;
  }
  keys.set(e, s);
  return s;
}
export const same = (a: Expr, b: Expr) => a === b || key(a) === key(b);

/** Cohen's order: numbers first, then by structure. Used to sort operands, so equal sums come out identical. */
export function less(u: Expr, v: Expr): boolean {
  if (u.k === 'n' && v.k === 'n') return qcmp(u.v, v.v) < 0;
  if (u.k === 'n') return true;
  if (v.k === 'n') return false;
  if (u.k === 's' && v.k === 's') return u.n < v.n;
  if ((u.k === '+' && v.k === '+') || (u.k === '*' && v.k === '*')) return lessList(u.t, v.t, true);
  if (u.k === '^' && v.k === '^') return same(u.b, v.b) ? less(u.e, v.e) : less(u.b, v.b);
  if (u.k === 'f' && v.k === 'f') return u.n !== v.n ? u.n < v.n : lessList(u.a, v.a, false);
  if (u.k === '*' && (v.k === '^' || v.k === '+' || v.k === 'f' || v.k === 's')) return lessList(u.t, [v], true);
  if (u.k === '^' && (v.k === '+' || v.k === 'f' || v.k === 's')) return same(u.b, v) ? less(u.e, ONE) : less(u.b, v);
  if (u.k === '+' && (v.k === 'f' || v.k === 's')) return lessList(u.t, [v], true);
  if (u.k === 'f' && v.k === 's') return u.n === v.n ? false : u.n < v.n;
  return !same(u, v) && !less(v, u);
}
function lessList(a: readonly Expr[], b: readonly Expr[], fromEnd: boolean): boolean {
  const m = Math.min(a.length, b.length);
  for (let j = 0; j < m; j++) {
    const x = fromEnd ? a[a.length - 1 - j] : a[j], y = fromEnd ? b[b.length - 1 - j] : b[j];
    if (!same(x, y)) return less(x, y);
  }
  return a.length < b.length;
}
const order = (a: Expr, b: Expr) => same(a, b) ? 0 : less(a, b) ? -1 : 1;

// --- Constructors ---

/** Splits a term into its rational coefficient and the rest: 3x²y → [3, x²y]. */
export function split(t: Expr): [Q, Expr] {
  if (t.k === 'n') return [t.v, ONE];
  if (t.k === '*' && t.t[0].k === 'n') return [t.t[0].v, t.t.length === 2 ? t.t[1] : { k: '*', t: t.t.slice(1) }];
  return [Q1, t];
}

export function add(...xs: Expr[]): Expr {
  const flat: Expr[] = [];
  const push = (x: Expr) => {
    if (x.k === '+') for (const t of x.t) push(t);
    // a number times a sum is spread out inside a sum, so A − A cancels: 2(x + 1) − 2x → 2
    else if (x.k === '*' && x.t.length === 2 && x.t[0].k === 'n' && x.t[1].k === '+') for (const t of x.t[1].t) push(mul(x.t[0], t));
    else flat.push(x);
  };
  for (const x of xs) push(x);
  let c = Q0, inf = 0;
  const groups = new Map<string, { rest: Expr; c: Q }>();
  for (const t of flat) {
    if (t.k === 'n') { c = qadd(c, t.v); continue; }
    const s = infSign(t);
    if (s) { if (inf && inf !== s) fail('Wyrażenie ∞ − ∞ jest nieokreślone.'); inf = s; continue; }
    const [k, rest] = split(t), id = key(rest), g = groups.get(id);
    if (g) g.c = qadd(g.c, k); else groups.set(id, { rest, c: k });
  }
  if (inf) return inf > 0 ? INF : mulRaw([MINUS_ONE, INF]);
  const terms: Expr[] = [];
  for (const { rest, c: k } of groups.values()) if (k.n) terms.push(qeq(k, Q1) ? rest : mul(num(k), rest));
  terms.sort(order);
  if (c.n) terms.unshift(num(c));
  return terms.length === 0 ? ZERO : terms.length === 1 ? terms[0] : { k: '+', t: terms };
}

const mulRaw = (t: Expr[]): Expr => ({ k: '*', t });

export function mul(...xs: Expr[]): Expr {
  let list: Expr[] = [];
  for (const x of xs) if (x.k === '*') list.push(...x.t); else list.push(x);
  let c = Q1, inf = 0;
  for (let round = 0; ; round++) {
    const groups = new Map<string, { base: Expr; exps: Expr[]; first: Expr }>();
    const other: Expr[] = [];
    for (const f of list) {
      if (f.k === 'n') { c = qmul(c, f.v); continue; }
      if (isSym(f, 'inf')) { inf++; continue; }
      const base = f.k === '^' ? f.b : f, exp = f.k === '^' ? f.e : ONE, id = key(base), g = groups.get(id);
      if (g) g.exps.push(exp); else groups.set(id, { base, exps: [exp], first: f });
    }
    if (inf) {
      if (!c.n) fail('Wyrażenie 0 · ∞ jest nieokreślone.');
      if (groups.size) fail('Nie mnożę ∞ przez wyrażenie: to ma sens tylko jako granica.');
      return qsign(c) > 0 ? INF : mulRaw([MINUS_ONE, INF]);
    }
    if (!c.n) return ZERO;
    let again = false;
    for (const { base, exps, first } of groups.values()) {
      // A lone factor is already canonical (re-powering a kept root like 3^(1/2) would loop).
      const p = exps.length === 1 ? first : pow(base, add(...exps));
      if (p.k === 'n') c = qmul(c, p.v);
      else if (p.k === '*') { other.push(...p.t); again = true; }
      else other.push(p);
    }
    // √2·√3 → √6: numeric bases under the same fractional exponent multiply together.
    const roots = new Map<string, { exp: Expr; bases: Q[] }>();
    const rest: Expr[] = [];
    for (const f of other) {
      if (f.k === '^' && f.b.k === 'n' && f.e.k === 'n' && qsign(f.b.v) > 0) {
        const id = key(f.e), g = roots.get(id);
        if (g) g.bases.push(f.b.v); else roots.set(id, { exp: f.e, bases: [f.b.v] });
      } else if (f.k === 'n') c = qmul(c, f.v);
      else rest.push(f);
    }
    for (const { exp, bases } of roots.values()) {
      if (bases.length === 1) { rest.push({ k: '^', b: num(bases[0]), e: exp }); continue; }
      const p = pow(num(bases.reduce(qmul)), exp);
      if (p.k === 'n') c = qmul(c, p.v); else if (p.k === '*') { rest.push(...p.t); again = true; } else rest.push(p);
    }
    if (!again || round > 8) {
      if (!c.n) return ZERO;
      // a sum among other factors gives up its rational content: 2x·(1/4 + √5/4) = x·(1 + √5)/2
      if (rest.length > 1 || !qeq(c, Q1)) {
        for (let j = 0; j < rest.length; j++) {
          const f = rest[j];
          if (f.k !== '+') continue;
          const g = content(f);
          if (qeq(g, Q1)) continue;
          c = qmul(c, g);
          rest[j] = add(...f.t.map(t => mul(num(q(g.d, g.n)), t)));
        }
      }
      rest.sort(order);
      // −(a + b) → −a − b
      if (qeq(c, QM1) && rest.length === 1 && rest[0].k === '+') return add(...rest[0].t.map(t => mul(MINUS_ONE, t)));
      if (!qeq(c, Q1)) rest.unshift(num(c));
      return rest.length === 0 ? num(c) : rest.length === 1 ? rest[0] : { k: '*', t: rest };
    }
    list = rest.concat(c === Q1 ? [] : [num(c)]);
    c = Q1;
  }
}

/** gcd of the numerators over the lcm of the denominators of a sum's rational coefficients (positive). */
function content(s: Add): Q {
  let n = 0n, d = 1n;
  for (const t of s.t) {
    const [k] = split(t);
    let a = k.n < 0n ? -k.n : k.n, b = n;
    while (b) [a, b] = [b, a % b];
    n = a;
    let x = d, y = k.d;
    while (y) [x, y] = [y, x % y];
    d = d / x * k.d;
  }
  return n ? q(n, d) : Q1;
}

export const neg = (a: Expr) => mul(MINUS_ONE, a);
export const sub = (a: Expr, b: Expr) => add(a, neg(b));
export const div = (a: Expr, b: Expr) => {
  if (isZero(b)) fail('Dzielenie przez zero.');
  return mul(a, pow(b, MINUS_ONE));
};
export const inv = (a: Expr) => pow(a, MINUS_ONE);
export const sqrt = (a: Expr) => pow(a, HALF);

/** Exact a^(p/q): integer part times a reduced root, with the denominator rationalised. */
function numericPow(a: Q, e: Q): Expr {
  if (qint(e)) {
    // (1 + 10⁻³⁰)^(10³⁰) has no room as a fraction, but it is a number: kept as a power, its digits still come out
    const bits = Math.max(bitLength(a.n < 0n ? -a.n : a.n), bitLength(a.d));
    if (a.n && !(bits <= 1 && a.d === 1n) && bits * Math.abs(Number(e.n)) > MAX_BITS) return { k: '^', b: num(a), e: num(e) };
    return num(qpow(a, e.n));
  }
  if (!a.n) { if (qsign(e) > 0) return ZERO; return fail('Dzielenie przez zero (0 do potęgi ujemnej).'); }
  if (qeq(a, Q1)) return ONE;
  const k = qfloor(e), r = qsub(e, q(k));        // e = k + r, 0 < r < 1
  const whole = num(qpow(a, k));
  const Qd = r.d;
  const factors: Expr[] = [whole];
  let n = a.n, d = a.d;
  if (n < 0n) {
    n = -n;
    if (Qd % 2n) { if (r.n % 2n) factors.push(MINUS_ONE); }          // odd root of a negative stays real
    else factors.push(Qd === 2n ? (r.n % 4n === 1n ? I : neg(I)) : { k: '^', b: MINUS_ONE, e: num(r) });
  }
  // n^(r) · d^(−r) = n^r · d^(1−r) / d
  factors.push(num(q(1n, d === 1n ? 1n : d)));
  factors.push(rootOf(n, r));
  if (d !== 1n) factors.push(rootOf(d, qsub(Q1, r)));
  return mul(...factors);
}

/** m^(s/t) for 0 < s/t < 1 with the largest t-th power pulled out and the root index lowered when possible. */
function rootOf(m: bigint, e: Q): Expr {
  if (m === 1n) return ONE;
  const s = e.n, t = e.d;
  if (t > 10000n) return { k: '^', b: num(m), e: num(e) };
  const [out, rest] = extractPower(m, Number(t));       // m = out^t · rest
  const outside = num(out ** s);
  if (rest === 1n) return outside;
  // 4^(3/4) = 2^(3/2) = 2√2: the rest may be a perfect power whose index divides t.
  for (let j = t; j >= 2n; j--) {
    if (t % j) continue;
    const r = iroot(rest, Number(j));
    if (r ** j === rest) return mul(outside, pow(num(r), num(q(s * j, t))));
  }
  return mul(outside, { k: '^', b: num(rest), e: num(e) });
}

export function pow(b: Expr, e: Expr): Expr {
  if (e.k === 'n') {
    if (!e.v.n) {
      if (isZero(b)) fail('Wyrażenie 0⁰ jest nieokreślone.');
      return ONE;
    }
    if (qeq(e.v, Q1)) return b;
    if (b.k === 'n') return numericPow(b.v, e.v);
    const s = infSign(b);
    if (s) {
      if (qsign(e.v) < 0) return ZERO;
      if (s > 0) return INF;
      if (qint(e.v)) return e.v.n % 2n ? mul(MINUS_ONE, INF) : INF;
      fail('Potęga −∞ o wykładniku ułamkowym jest nieokreślona.');
    }
    if (isSym(b, 'i') && qint(e.v)) {
      const m = Number(((e.v.n % 4n) + 4n) % 4n);
      return [ONE, I, MINUS_ONE, neg(I)][m];
    }
    // √(3 + 2√2) = 1 + √2, ∛(2 + √5) = (1 + √5)/2
    if (b.k === '+' && (qeq(e.v, QHALF) || qeq(e.v, q(1, 3)))) {
      const d = denest(b, e.v.d === 2n ? 2 : 3);
      if (d) return d;
    }
    if (b.k === '^' && qint(e.v)) return pow(b.b, mul(b.e, e));
    // (x^a)^r = x^(ar) also for fractional r when the base is positive and a real number: (e^2)^(1/2) = e.
    if (b.k === '^' && b.e.k === 'n' && positiveConstant(b.b)) return pow(b.b, mul(b.e, e));
    // variables are real: √(r²) = |r|, √(x⁴) = x², the even power of a real number is never negative
    if (b.k === '^' && b.e.k === 'n' && qint(b.e.v) && b.e.v.n % 2n === 0n && qeq(e.v, QHALF) && b.b.k !== 'n' && !hasI(b.b)) {
      const m = b.e.v.n / 2n;
      return m % 2n ? pow(fn('abs', b.b), num(m)) : pow(b.b, num(m));
    }
    if (b.k === '*') {
      if (qint(e.v)) return mul(...b.t.map(f => pow(f, e)));
      // (4x)^(1/2) = 2·x^(1/2): a positive factor comes out of any power.
      const pos = b.t.filter(positiveConstant);
      if (pos.length) {
        const restFactors = b.t.filter(f => !positiveConstant(f));
        const restPow = !restFactors.length ? ONE : pow(restFactors.length === 1 ? restFactors[0] : mulRaw(restFactors), e);
        return mul(...pos.map(f => pow(f, e)), restPow);
      }
    }
  } else {
    if (isOne(b)) return ONE;
    // principal value i^w = e^(iπw/2): i^i = e^(−π/2)
    if (isSym(b, 'i') && variables(e).length === 0) return pow(E, mul(HALF, I, PI, e));
    if (isSym(b, 'e')) {
      const special = expRules(e);
      if (special) return special;
    }
    if (b.k === '^' && isSym(b.b, 'e') && b.e.k === 'n') return pow(E, mul(b.e, e));
  }
  if (isInf(e)) fail('Potęga o wykładniku nieskończonym ma sens tylko jako granica.');
  return { k: '^', b, e };
}

/** r + s√c with rationals r, s and a squarefree natural c > 1, or null. */
function quadraticSurd(b: Expr): [Q, Q, bigint] | null {
  if (b.k !== '+' || b.t.length !== 2 || b.t[0].k !== 'n') return null;
  const [s, rest] = split(b.t[1]);
  if (rest.k !== '^' || rest.b.k !== 'n' || !qint(rest.b.v) || !qeq((rest.e as Num).v ?? Q0, QHALF)) return null;
  return [b.t[0].v, s, rest.b.v.n];
}
/**
 * √(r + s√c) = √x ± √y when r² − s²c is a rational square (x, y = (r ± √(r² − s²c))/2), and ∛(r + s√c) = u + v√c
 * when r² − s²c = m³ and 4u³ − 3mu = r has a rational root. The result is checked by raising it back.
 */
function denest(b: Expr, k: 2 | 3): Expr | null {
  const z = quadraticSurd(b);
  if (!z) return null;
  const [r, s, c] = z, C = num(c), disc = qsub(qmul(r, r), qmul(qmul(s, s), q(c)));
  const exactRoot = (v: Q, j: number): Q | null => {
    if (qsign(v) < 0 && j % 2 === 0) return null;
    const neg_ = qsign(v) < 0, n = neg_ ? -v.n : v.n, rn = iroot(n, j), rd = iroot(v.d, j);
    return rn ** BigInt(j) === n && rd ** BigInt(j) === v.d ? q(neg_ ? -rn : rn, rd) : null;
  };
  let out: Expr | null = null;
  if (k === 2) {
    const w = exactRoot(disc, 2);
    if (!w || qsign(r) <= 0) return null;
    const x = q((r.n * w.d + w.n * r.d), 2n * r.d * w.d), y = qsub(r, x);
    if (qsign(y) < 0) return null;
    out = add(pow(num(x), HALF), mul(num(qsign(s)), pow(num(y), HALF)));
  } else {
    const m = exactRoot(disc, 3);
    if (!m) return null;
    // u is the mean of the two real cube roots ∛(r ± s√c); its denominator divides 4·den(m)·den(r) (4u³ − 3mu = r)
    const t = s.n * s.n * c > 0n ? Math.abs(qToNumberLite(s)) * Math.sqrt(Number(c)) : 0, rr = qToNumberLite(r);
    const uApprox = (Math.cbrt(rr + t) + Math.cbrt(rr - t)) / 2;
    if (!Number.isFinite(uApprox)) return null;
    for (const den of [1n, 2n, 4n, m.d, 2n * m.d, 4n * m.d, r.d, 2n * r.d, 4n * r.d]) {
      if (!Number.isFinite(uApprox * Number(den))) continue;
      const u = q(BigInt(Math.round(uApprox * Number(den))), den);
      for (const uu of [u]) {
        const v2 = qdiv(qsub(qmul(uu, uu), m), q(c));
        const v = exactRoot(v2, 2);
        if (!v) continue;
        const cand = add(num(uu), mul(num(qsign(s) < 0 ? q(-v.n, v.d) : v), pow(C, HALF)));
        if (keyOf(expandCube(cand)) === keyOf(b)) return cand;
      }
    }
    return null;
  }
  return out;
}
const qToNumberLite = (v: Q) => Number(v.n) / Number(v.d);
const keyOf = (e: Expr) => key(e);
function expandCube(e: Expr): Expr { return expand(mul(e, e, e)); }

const hasI = (e: Expr): boolean => isSym(e, 'i') || children(e).some(hasI);

/** Numbers > 0 and the constants π and e; used where pulling a factor out of a root is only valid for positives. */
export function positiveConstant(f: Expr): boolean {
  return (f.k === 'n' && qsign(f.v) > 0) || isSym(f, 'pi') || isSym(f, 'e') || (f.k === '^' && positiveConstant(f.b) && f.e.k === 'n');
}

/** e^(ln u) = u, e^(c·ln u) = u^c, e^(a + ln b) = b·e^a, e^(iπr) = cos rπ + i sin rπ. */
function expRules(e: Expr): Expr | null {
  if (isFn(e, 'ln')) return e.a[0];
  if (e.k === '*' && e.t.length === 2 && e.t[0].k === 'n' && isFn(e.t[1], 'ln')) return pow(e.t[1].a[0], e.t[0]);
  if (e.k === '+') {
    const logs = e.t.filter(t => isFn(t, 'ln') || (t.k === '*' && t.t.length === 2 && t.t[0].k === 'n' && isFn(t.t[1], 'ln')));
    if (logs.length) return mul(...logs.map(t => pow(E, t)), pow(E, add(...e.t.filter(t => !logs.includes(t)))));
  }
  // i·π·r with rational r
  const [c, rest] = split(e);
  if (rest.k === '*' && rest.t.length === 2 && isSym(rest.t[0], 'i') && isSym(rest.t[1], 'pi')) {
    const cosv = RULES.cos?.([mul(num(c), PI)]), sinv = RULES.sin?.([mul(num(c), PI)]);
    if (cosv && sinv && !isFn(cosv, 'cos') && !isFn(sinv, 'sin')) return add(cosv, mul(I, sinv));
  }
  return null;
}

/**
 * Exact rules for named functions, filled in by functions.ts: given simplified arguments, return a simpler
 * equivalent, or null to keep the call as it is.
 */
export const RULES: Record<string, (a: Expr[]) => Expr | null> = {};
export function fn(n: string, ...a: Expr[]): Expr {
  const rule = RULES[n];
  const r = rule ? rule(a) : null;
  return r ?? { k: 'f', n, a };
}

// --- Traversal ---

/** Rebuilds e with every child mapped through f, re-simplifying on the way up. */
export function mapChildren(e: Expr, f: (c: Expr) => Expr): Expr {
  switch (e.k) {
    case 'n': case 's': return e;
    case '+': return add(...e.t.map(f));
    case '*': return mul(...e.t.map(f));
    case '^': return pow(f(e.b), f(e.e));
    case 'f': return fn(e.n, ...e.a.map(f));
  }
}

export const children = (e: Expr): readonly Expr[] => e.k === '+' || e.k === '*' ? e.t : e.k === '^' ? [e.b, e.e] : e.k === 'f' ? e.a : [];

export function freeOf(e: Expr, x: string | Expr): boolean {
  if (typeof x === 'string') return e.k === 's' ? e.n !== x : children(e).every(c => freeOf(c, x));
  if (same(e, x)) return false;
  return children(e).every(c => freeOf(c, x));
}

/** Replaces the variable (or any subexpression) `from` by `to`, re-simplifying. */
export function subst(e: Expr, from: string | Expr, to: Expr): Expr {
  if (typeof from === 'string' ? isSym(e, from) : same(e, from)) return to;
  if (e.k === 'n' || e.k === 's') return e;
  if (typeof from === 'string' ? freeOf(e, from) : freeOf(e, from)) return e;
  return mapChildren(e, c => subst(c, from, to));
}

/** Free variables, sorted (constants π, e, i, ∞ excluded). */
export function variables(e: Expr, out = new Set<string>()): string[] {
  if (e.k === 's') { if (!CONSTANTS.has(e.n)) out.add(e.n); }
  else for (const c of children(e)) variables(c, out);
  return [...out].sort();
}

export const isConstant = (e: Expr) => variables(e).length === 0;
export const hasSym = (e: Expr, n: string): boolean => e.k === 's' ? e.n === n : children(e).some(c => hasSym(c, n));

/** Number of nodes; the measure "simpler" compares. */
export function size(e: Expr): number {
  let s = 1;
  for (const c of children(e)) s += size(c);
  if (e.k === 'n' && e.v.d !== 1n) s += 1;
  if (e.k === 'n') s += Math.floor(e.v.n.toString().length / 6);
  return s;
}

// --- Algebraic rewriting ---

const MAX_TERMS = 20000;
/** Distributes products over sums and expands positive integer powers of sums, everywhere. */
export function expand(e: Expr): Expr {
  switch (e.k) {
    case 'n': case 's': return e;
    case '+': return add(...e.t.map(expand));
    case '*': return e.t.map(expand).reduce(expandProduct, ONE);
    case '^': {
      const b = expand(e.b), x = expand(e.e);
      if (b.k === '+' && isInt(x) && x.v.n > 1n) {
        if (Number(x.v.n) * b.t.length > 400 && b.t.length ** Math.min(Number(x.v.n), 12) > MAX_TERMS * 50) fail('Rozwinięcie byłoby za duże.');
        let out: Expr = ONE;
        for (let k = 0n; k < x.v.n; k++) out = expandProduct(out, b);
        return out;
      }
      if (b.k === '+' && isInt(x) && x.v.n < -1n) return pow(expand(pow(b, num(-x.v.n))), MINUS_ONE);
      return pow(b, x);
    }
    case 'f': return fn(e.n, ...e.a.map(expand));
  }
}
function expandProduct(a: Expr, b: Expr): Expr {
  if (a.k === '+') {
    if (b.k === '+' && a.t.length * b.t.length > MAX_TERMS) fail('Rozwinięcie byłoby za duże.');
    return add(...a.t.map(t => expandProduct(t, b)));
  }
  if (b.k === '+') return add(...b.t.map(t => expandProduct(a, t)));
  return mul(a, b);
}

/** Numerator and denominator of a term (as written: negative powers go down). */
export function numDen(e: Expr): [Expr, Expr] {
  if (e.k === 'n') return [num(e.v.n), num(e.v.d)];
  if (e.k === '^' && isNegative(e.e)) return [ONE, pow(e.b, neg(e.e))];
  if (e.k === '*') {
    const n: Expr[] = [], d: Expr[] = [];
    for (const f of e.t) { const [a, b] = numDen(f); n.push(a); d.push(b); }
    return [mul(...n), mul(...d)];
  }
  return [e, ONE];
}

/** A numeric coefficient below zero: −3, −x, −2x², x^(−1) exponent −1. */
export function isNegative(e: Expr): boolean {
  if (e.k === 'n') return qsign(e.v) < 0;
  if (e.k === '*') return e.t[0].k === 'n' && qsign(e.t[0].v) < 0;
  return false;
}

/**
 * One fraction over a common denominator: a/b + c/d → (ad + cb)/(bd), with common factors of the denominators
 * shared (the lcm is built factor by factor). Doesn't cancel; see cancel() in poly.ts.
 */
export function together(e: Expr): Expr {
  if (e.k === 'n' || e.k === 's') return e;
  if (e.k !== '+') {
    const m = mapChildren(e, together);
    return m;
  }
  const parts = e.t.map(t => numDen(together(t)));
  if (parts.every(([, d]) => isOne(d))) return e;
  // lcm of the denominators: for each base the largest exponent.
  const bases = new Map<string, { base: Expr; exp: Q }>();
  let numericLcm = 1n;
  const factorsOf = (d: Expr): [Expr, Q][] => (d.k === '*' ? d.t : [d]).map(f =>
    f.k === '^' && f.e.k === 'n' ? [f.b, f.e.v] : [f, Q1]);
  for (const [, d] of parts) {
    for (const [base, exp] of factorsOf(d)) {
      if (base.k === 'n') { numericLcm = lcmBig(numericLcm, base.v.n ** (qint(exp) ? exp.n : 1n)); continue; }
      const id = `${key(base)}#${exp.d}`, g = bases.get(id);
      if (!g) bases.set(id, { base, exp }); else if (qcmp(exp, g.exp) > 0) g.exp = exp;
    }
  }
  const L = mul(num(numericLcm), ...[...bases.values()].map(({ base, exp }) => pow(base, num(exp))));
  const numer = add(...parts.map(([n, d]) => expand(mul(n, div(L, d)))));
  return mul(numer, pow(L, MINUS_ONE));
}
const lcmBig = (a: bigint, b: bigint) => { let x = a, y = b; while (y) [x, y] = [y, x % y]; return a / x * b; };

export const isRationalNumber = (e: Expr): e is Num => e.k === 'n';
export const qOf = (e: Expr): Q | null => e.k === 'n' ? e.v : null;
