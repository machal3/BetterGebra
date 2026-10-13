/**
 * Univariate polynomials with exact rational coefficients (lowest degree first), and the step from expressions
 * to polynomials and back. Factoring over ℚ: square-free decomposition, rational roots, then Kronecker's method
 * for factors of higher degree (with a budget; a result past it is flagged as possibly incomplete).
 */
import { BZERO, bfFromQ, bfToNumber, bfFromNumber, top } from './bigfloat';
import { Expr, HALF, I, PI, TWO, ZERO, add, div, expand, fn, freeOf, isNum, isSym, mul, neg, num, pow, sqrt, sub, size } from './expr';
import { C, approx, cadd, cdiv, cmul, csub, cabs } from './numeric';
import { divisorsCapped } from './ntheory';
import { Q, Q0, Q1, fail, gcd, lcm, q, qabs, qadd, qcmp, qdiv, qint, qmul, qneg, qsign, qsub } from './q';

export type P = Q[];

export function trim(p: P): P {
  let n = p.length;
  while (n && !p[n - 1].n) n--;
  return n === p.length ? p : p.slice(0, n);
}
export const deg = (p: P) => p.length - 1;
export const lc = (p: P) => p[p.length - 1];
export const isZeroP = (p: P) => !p.length;

export function padd(a: P, b: P): P {
  const out: Q[] = [];
  for (let k = 0; k < Math.max(a.length, b.length); k++) out.push(qadd(a[k] ?? Q0, b[k] ?? Q0));
  return trim(out);
}
export const pneg = (a: P): P => a.map(qneg);
export const psub = (a: P, b: P) => padd(a, pneg(b));
export const pscale = (a: P, c: Q): P => c.n ? a.map(x => qmul(x, c)) : [];
export function pmul(a: P, b: P): P {
  if (!a.length || !b.length) return [];
  const out: Q[] = Array(a.length + b.length - 1).fill(Q0);
  for (let i = 0; i < a.length; i++) if (a[i].n) for (let j = 0; j < b.length; j++) out[i + j] = qadd(out[i + j], qmul(a[i], b[j]));
  return trim(out);
}
export function pdivmod(a: P, b: P): [P, P] {
  if (!b.length) fail('Dzielenie wielomianu przez zero.');
  let r = a.slice();
  const out: Q[] = Array(Math.max(0, a.length - b.length + 1)).fill(Q0), L = lc(b);
  while (r.length >= b.length && r.length) {
    const k = r.length - b.length, c = qdiv(lc(r), L);
    out[k] = c;
    for (let j = 0; j < b.length; j++) r[j + k] = qsub(r[j + k], qmul(c, b[j]));
    r = trim(r);
  }
  return [trim(out), r];
}
export const pmonic = (a: P): P => a.length ? pscale(a, qdiv(Q1, lc(a))) : a;
export function pgcd(a: P, b: P): P {
  while (b.length) [a, b] = [b, pdivmod(a, b)[1]];
  return pmonic(a);
}
export const pderiv = (a: P): P => trim(a.slice(1).map((c, k) => qmul(c, q(k + 1))));
export function peval(a: P, x: Q): Q {
  let r = Q0;
  for (let k = a.length - 1; k >= 0; k--) r = qadd(qmul(r, x), a[k]);
  return r;
}
export function ppow(a: P, n: number): P {
  let out: P = [Q1];
  for (let k = 0; k < n; k++) out = pmul(out, a);
  return out;
}
/** p(q(x)) */
export function pcompose(p: P, inner: P): P {
  let out: P = [];
  for (let k = p.length - 1; k >= 0; k--) out = padd(pmul(out, inner), [p[k]]);
  return out;
}

/** p = content · prim with prim having coprime integer coefficients and a positive leading one. */
export function primitive(p: P): [Q, bigint[]] {
  if (!p.length) return [Q0, []];
  const L = p.reduce((m, c) => lcm(m, c.d), 1n);
  let ints = p.map(c => c.n * (L / c.d));
  let g = ints.reduce((m, c) => gcd(m, c), 0n);
  if (ints[ints.length - 1] < 0n) g = -g;
  ints = ints.map(c => c / g);
  return [q(g, L), ints];
}
export const fromInts = (a: bigint[]): P => trim(a.map(c => q(c)));

/** Yun's square-free decomposition: p = c · Π f_k^k with f_k monic, square-free, pairwise coprime. */
export function squarefree(p: P): [P, number][] {
  const out: [P, number][] = [];
  if (deg(p) < 1) return out;
  const a = pmonic(p), d = pderiv(a);
  const b = pgcd(a, d);
  let c = pdivmod(a, b)[0], dd = psub(pdivmod(d, b)[0], pderiv(c));
  for (let k = 1; deg(c) > 0; k++) {
    const g = pgcd(c, dd);
    if (deg(g) > 0) out.push([g, k]);
    c = pdivmod(c, g)[0];
    dd = psub(pdivmod(dd, g)[0], pderiv(c));
  }
  return out;
}

// --- Expressions ↔ polynomials ---

/** Coefficients in x (free of x), lowest first, or null when e isn't a polynomial in x. */
export function coeffsOf(e: Expr, x: string, maxDegree = 10000): Expr[] | null {
  const ex = expand(e);
  const terms = ex.k === '+' ? ex.t : [ex];
  const out: Expr[][] = [];
  for (const t of terms) {
    const factors = t.k === '*' ? t.t : [t];
    let k = 0;
    const rest: Expr[] = [];
    for (const f of factors) {
      if (isSym(f, x)) k += 1;
      else if (f.k === '^' && isSym(f.b, x) && isNum(f.e) && f.e.v.d === 1n && f.e.v.n > 0n) {
        if (f.e.v.n > BigInt(maxDegree)) return null;
        k += Number(f.e.v.n);
      } else if (freeOf(f, x)) rest.push(f);
      else return null;
    }
    (out[k] ??= []).push(mul(...rest));
  }
  const res: Expr[] = [];
  for (let k = 0; k < out.length; k++) res.push(out[k] ? add(...out[k]) : ZERO);
  while (res.length && res[res.length - 1].k === 'n' && !(res[res.length - 1] as { v: Q }).v.n) res.pop();
  return res;
}
/** Rational coefficients, or null. */
export function polyOf(e: Expr, x: string, maxDegree = 10000): P | null {
  const c = coeffsOf(e, x, maxDegree);
  if (!c || !c.every(isNum)) return null;
  return trim(c.map(v => (v as { v: Q }).v));
}
export function polyToExpr(p: P, x: Expr): Expr {
  return add(...p.map((c, k) => mul(num(c), pow(x, num(k)))));
}
export const coeffsToExpr = (cs: Expr[], x: Expr) => add(...cs.map((c, k) => mul(c, pow(x, num(k)))));

// --- Rational roots ---

const evalInt = (f: bigint[], a: bigint, b: bigint): bigint => {
  // b^n · f(a/b)
  let r = 0n, bp = 1n;
  const n = f.length - 1, pw: bigint[] = [];
  for (let k = 0; k <= n; k++) { pw.push(bp); bp *= b; }
  let ap = 1n;
  for (let k = 0; k <= n; k++) { r += f[k] * ap * pw[n - k]; ap *= a; }
  return r;
};

/** Distinct rational roots of p. */
export function rationalRoots(p: P): Q[] {
  const [, f0] = primitive(p);
  let f = f0;
  const roots: Q[] = [];
  while (f.length > 1 && f[0] === 0n) { if (!roots.length) roots.push(Q0); f = f.slice(1); }
  if (f.length < 2) return roots;
  const n = f.length - 1;
  const ps = divisorsCapped(f[0], 4000), qs = divisorsCapped(f[n], 4000);
  const tested = new Set<string>();
  const test = (a: bigint, b: bigint) => {
    const g = gcd(a, b);
    a /= g; b /= g;
    if (b < 0n) { a = -a; b = -b; }
    const id = `${a}/${b}`;
    if (tested.has(id)) return;
    tested.add(id);
    if (!evalInt(f, a, b)) roots.push(q(a, b));
  };
  if (ps && qs && ps.length * qs.length <= 60000) {
    for (const a of ps) for (const b of qs) { test(a, b); test(-a, b); }
  } else {
    // Too many candidates: take the real roots numerically and try the rationals close to them.
    for (const r of numericRootsDouble(f.map(c => Number(c)))) {
      if (Math.abs(r.im) > 1e-6 * Math.max(1, Math.abs(r.re))) continue;
      for (const c of convergents(r.re)) test(c.n, c.d);
    }
  }
  return roots.sort(qcmp);
}
function convergents(v: number): Q[] {
  const out: Q[] = [];
  let h0 = 0n, h1 = 1n, k0 = 1n, k1 = 0n, r = v;
  for (let i = 0; i < 40 && Number.isFinite(r); i++) {
    const a = BigInt(Math.floor(r));
    [h0, h1, k0, k1] = [h1, a * h1 + h0, k1, a * k1 + k0];
    out.push(q(h1, k1));
    const frac = r - Math.floor(r);
    if (frac < 1e-15) break;
    r = 1 / frac;
  }
  return out;
}

// --- Factoring over ℚ ---

export interface PolyFactorization { content: Q; factors: [bigint[], number][]; complete: boolean }

function divideInt(f: bigint[], g: bigint[]): bigint[] | null {
  const [quo, rem] = pdivmod(fromInts(f), fromInts(g));
  if (rem.length || !quo.every(qint)) return null;
  return quo.map(c => c.n);
}

/** Kronecker: an irreducible factor of degree d of the primitive square-free f, or null. */
function kroneckerFactor(f: bigint[], d: number, budget: { left: number }): bigint[] | null {
  const pts: { x: bigint; v: bigint; divs: bigint[] }[] = [];
  for (let x = 0; x <= 40 && pts.length < 3 * (d + 1); x = x > 0 ? -x : -x + 1) {
    const X = BigInt(x), v = evalInt(f, X, 1n);
    if (!v) continue;
    const divs = divisorsCapped(v, 600);
    if (divs) pts.push({ x: X, v, divs });
  }
  if (pts.length < d + 1) return null;
  pts.sort((a, b) => a.divs.length - b.divs.length);
  const use = pts.slice(0, d + 1);
  const lcF = f[f.length - 1];
  const choice: bigint[] = Array(d + 1).fill(0n);
  let found: bigint[] | null = null;
  const rec = (j: number): boolean => {
    if (budget.left-- <= 0) return true;
    if (j === d + 1) {
      const g = interpolate(use.map(u => u.x), choice);
      if (!g || g.length !== d + 1 || !g[d] || lcF % g[d]) return false;
      const quo = divideInt(f, g);
      if (quo) { found = g; return true; }
      return false;
    }
    for (const dv of use[j].divs) {
      for (const s of j === 0 ? [1n] : [1n, -1n]) {
        choice[j] = s * dv;
        if (rec(j + 1)) return true;
      }
    }
    return false;
  };
  rec(0);
  if (found) { const [, prim] = primitive(fromInts(found)); return prim; }
  return null;
}
/** Integer coefficients of the polynomial through (x_k, y_k), or null when they aren't integers. */
function interpolate(xs: bigint[], ys: bigint[]): bigint[] | null {
  // Newton divided differences over ℚ
  const n = xs.length;
  const c: Q[] = ys.map(y => q(y));
  for (let j = 1; j < n; j++) for (let k = n - 1; k >= j; k--) c[k] = qdiv(qsub(c[k], c[k - 1]), q(xs[k] - xs[k - j]));
  let p: P = [c[n - 1]];
  for (let k = n - 2; k >= 0; k--) p = padd(pmul(p, [q(-xs[k]), Q1]), [c[k]]);
  if (!p.every(qint)) return null;
  const out = p.map(v => v.n);
  while (out.length < n) out.push(0n);
  return out.slice(0, n);
}

export function factorPoly(p: P): PolyFactorization {
  const factors: [bigint[], number][] = [];
  let complete = true;
  const budget = { left: 400000 };
  for (const [g, mult] of squarefree(p)) {
    let [, f] = primitive(g);
    for (const r of rationalRoots(fromInts(f))) {
      const lin = [-r.n, r.d];
      factors.push([lin, mult]);
      f = divideInt(f, lin)!;
    }
    // f has no linear factors left; degrees 2 and 3 are then irreducible.
    const stack = [f];
    while (stack.length) {
      const h = stack.pop()!;
      if (h.length < 2) continue;
      const n = h.length - 1;
      let split = false;
      for (let d = 2; d <= n / 2 && n >= 4; d++) {
        const g2 = kroneckerFactor(h, d, budget);
        if (budget.left <= 0) { complete = false; break; }
        if (g2) { stack.push(g2, divideInt(h, g2)!); split = true; break; }
      }
      if (!split) factors.push([h, mult]);
    }
  }
  factors.sort((a, b) => a[0].length - b[0].length || (a[0].join() < b[0].join() ? -1 : 1));
  // p = content · Π f^m with every f primitive with a positive leading coefficient
  const prod = factors.reduce((acc, [f, m]) => pmul(acc, ppow(fromInts(f), m)), [Q1] as P);
  return { content: qdiv(lcOrOne(p), lcOrOne(prod)), factors, complete };
}
const lcOrOne = (p: P) => p.length ? lc(p) : Q1;

// --- Solving ---

export interface Root { exact: Expr | null; approx: C; mult: number }

/** All complex roots of p with multiplicities; exact where a closed form is known here. */
export function solvePoly(p: P): Root[] {
  if (deg(p) < 1) return [];
  const out: Root[] = [];
  for (const [g, mult] of squarefree(p)) {
    const [, f0] = primitive(g);
    let f = f0;
    for (const r of rationalRoots(fromInts(f))) {
      out.push({ exact: num(r), approx: { re: bfFromQ(r.n, r.d, 200), im: BZERO }, mult });
      f = divideInt(f, [-r.n, r.d])!;
    }
    if (f.length < 2) continue;
    // split what is left with Kronecker (quadratic factors give exact roots)
    const pieces: bigint[][] = [];
    const stack = [f];
    const budget = { left: 200000 };
    while (stack.length) {
      const h = stack.pop()!;
      const n = h.length - 1;
      let split = false;
      for (let d = 2; d <= n / 2 && n >= 4; d++) {
        const g2 = kroneckerFactor(h, d, budget);
        if (g2) { stack.push(g2, divideInt(h, g2)!); split = true; break; }
        if (budget.left <= 0) break;
      }
      if (!split) pieces.push(h);
    }
    for (const h of pieces) for (const r of solveIrreducible(h)) out.push({ ...r, mult });
  }
  return out.sort(rootOrder);
}
function rootOrder(a: Root, b: Root): number {
  const ar = bfToNumber(a.approx.re), br = bfToNumber(b.approx.re), ai = bfToNumber(a.approx.im), bi = bfToNumber(b.approx.im);
  const aReal = Math.abs(ai) < 1e-30, bReal = Math.abs(bi) < 1e-30;
  if (aReal !== bReal) return aReal ? -1 : 1;
  return ar - br || ai - bi;
}

/** Roots of an irreducible integer polynomial of degree ≥ 2 (no rational roots). */
function solveIrreducible(h: bigint[]): Omit<Root, 'mult'>[] {
  const n = h.length - 1;
  const P_ = fromInts(h);
  const approxAll = refineRoots(P_, numericRootsDouble(h.map(c => Number(c))));
  const withApprox = (exacts: Expr[]): Omit<Root, 'mult'>[] => {
    // pair each closed form with the refined numeric root closest to it
    const used = new Set<number>();
    return exacts.map(ex0 => {
      // (4 − 2√3)/2 → 2 − √3 when the expanded form is no bigger
      const ex1 = expand(ex0);
      const ex = size(ex1) <= size(ex0) ? ex1 : ex0;
      const v = approx(ex);
      let best = 0, bestD = Infinity;
      approxAll.forEach((z, k) => {
        if (used.has(k)) return;
        const d = Math.hypot(bfToNumber(z.re) - v.re, bfToNumber(z.im) - v.im);
        if (d < bestD) { bestD = d; best = k; }
      });
      used.add(best);
      return { exact: ex, approx: approxAll[best] };
    });
  };
  const x = (k: number) => q(h[k]);
  if (n === 2) {
    const [c, b, a] = [x(0), x(1), x(2)];
    const disc = qsub(qmul(b, b), qmul(q(4), qmul(a, c)));
    const s = sqrt(num(disc)), A2 = num(qmul(q(2), a)), mb = num(qneg(b));
    return withApprox([div(sub(mb, s), A2), div(add(mb, s), A2)]);
  }
  // x^n = c (binomial): c^(1/n)·e^(iπ(2k + [c<0])/n)
  if (h.slice(1, n).every(c => !c)) {
    const c = q(-h[0], h[n]);
    const r = pow(num(qabs(c)), num(q(1, n)));
    const exacts: Expr[] = [];
    for (let k = 0; k < n; k++) {
      const angle = mul(num(q(2 * k + (qsign(c) < 0 ? 1 : 0), n)), PI);
      exacts.push(mul(r, add(fn('cos', angle), mul(I, fn('sin', angle)))));
    }
    return withApprox(exacts.map(expand));
  }
  // biquadratic a x⁴ + c x² + e
  if (n === 4 && !h[1] && !h[3]) {
    const [e, , c, , a] = h.map(v => q(v));
    const disc = qsub(qmul(c, c), qmul(q(4), qmul(a, e)));
    const s = sqrt(num(disc)), A2 = num(qmul(q(2), a));
    const ys = [div(sub(num(qneg(c)), s), A2), div(add(num(qneg(c)), s), A2)];
    const exacts: Expr[] = [];
    for (const y of ys) { const r = sqrt(y); exacts.push(neg(r), r); }
    return withApprox(exacts);
  }
  if (n === 3) return withApprox(cardano(h.map(v => q(v)) as [Q, Q, Q, Q]));
  return approxAll.map(z => ({ exact: null, approx: z }));
}

/** Cardano / Viète for a cubic with no rational roots. */
function cardano([d, c, b, a]: [Q, Q, Q, Q]): Expr[] {
  // x = t − b/(3a): t³ + pt + q = 0
  const B = qdiv(b, a), C_ = qdiv(c, a), D = qdiv(d, a);
  const p = qsub(C_, qdiv(qmul(B, B), q(3)));
  const qq = qadd(qsub(qdiv(qmul(q(2), qmul(B, qmul(B, B))), q(27)), qdiv(qmul(B, C_), q(3))), D);
  const shift = num(qneg(qdiv(B, q(3))));
  const delta = qadd(qmul(qdiv(qq, q(2)), qdiv(qq, q(2))), qmul(qdiv(p, q(3)), qmul(qdiv(p, q(3)), qdiv(p, q(3)))));
  if (qsign(delta) > 0) {
    const sd = sqrt(num(delta)), mq2 = num(qneg(qdiv(qq, q(2))));
    const u = pow(add(mq2, sd), num(1, 3)), v = pow(sub(mq2, sd), num(1, 3));
    const t1 = add(u, v);
    const re = mul(num(-1, 2), add(u, v)), im = mul(HALF, sqrt(num(3)), sub(u, v), I);
    return [add(t1, shift), add(re, im, shift), sub(add(re, shift), im)];
  }
  // three real roots: t_k = 2√(−p/3) cos(⅓ arccos(3q/(2p)·√(−3/p)) − 2πk/3)
  const m = mul(TWO, sqrt(num(qneg(qdiv(p, q(3))))));
  const theta = mul(num(1, 3), fn('acos', mul(num(qdiv(qmul(q(3), qq), qmul(q(2), p))), sqrt(num(qneg(qdiv(q(3), p)))))));
  return [0, 1, 2].map(k => add(mul(m, fn('cos', sub(theta, mul(num(2 * k, 3), PI)))), shift));
}


// --- Numeric roots ---

type Cx = { re: number; im: number };
/** Aberth–Ehrlich iteration in double precision: all complex roots of a polynomial (coefficients lowest first). */
export function numericRootsDouble(coef: number[]): Cx[] {
  let c = coef.slice();
  while (c.length > 1 && c[c.length - 1] === 0) c.pop();
  const n = c.length - 1;
  if (n < 1) return [];
  const scale = Math.max(...c.map(Math.abs));
  c = c.map(v => v / scale);
  const L = c[n];
  // initial points on a circle of radius from the Cauchy bound
  const R = 1 + Math.max(...c.slice(0, n).map(v => Math.abs(v / L)));
  let z: Cx[] = Array.from({ length: n }, (_, k) => ({ re: R * Math.cos(2 * Math.PI * k / n + 0.4), im: R * Math.sin(2 * Math.PI * k / n + 0.4) }));
  const ev = (x: Cx): [Cx, Cx] => {
    let p: Cx = { re: c[n], im: 0 }, d: Cx = { re: 0, im: 0 };
    for (let k = n - 1; k >= 0; k--) {
      d = { re: d.re * x.re - d.im * x.im + p.re, im: d.re * x.im + d.im * x.re + p.im };
      p = { re: p.re * x.re - p.im * x.im + c[k], im: p.re * x.im + p.im * x.re };
    }
    return [p, d];
  };
  const dv = (a: Cx, b: Cx): Cx => { const m = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / m, im: (a.im * b.re - a.re * b.im) / m }; };
  for (let it = 0; it < 500; it++) {
    let moved = 0;
    z = z.map((zi, i) => {
      const [p, d] = ev(zi);
      const ratio = dv(p, d);
      let s: Cx = { re: 0, im: 0 };
      for (let j = 0; j < n; j++) if (j !== i) { const w = dv({ re: 1, im: 0 }, { re: zi.re - z[j].re, im: zi.im - z[j].im }); s = { re: s.re + w.re, im: s.im + w.im }; }
      const den = { re: 1 - (ratio.re * s.re - ratio.im * s.im), im: -(ratio.re * s.im + ratio.im * s.re) };
      const step = dv(ratio, den);
      if (!Number.isFinite(step.re) || !Number.isFinite(step.im)) return zi;
      moved = Math.max(moved, Math.hypot(step.re, step.im) / Math.max(1, Math.hypot(zi.re, zi.im)));
      return { re: zi.re - step.re, im: zi.im - step.im };
    });
    if (moved < 1e-15) break;
  }
  return z;
}

/** Newton in BigFloat (≈ 300 bits) from double approximations; exact rational coefficients. */
export function refineRoots(p: P, approx: Cx[], bits = 320): C[] {
  const coefs = p.map(c => ({ re: bfFromQ(c.n, c.d, bits), im: BZERO }));
  const dcoefs = pderiv(p).map(c => ({ re: bfFromQ(c.n, c.d, bits), im: BZERO }));
  const evalP = (cs: C[], z: C): C => {
    let r: C = { re: BZERO, im: BZERO };
    for (let k = cs.length - 1; k >= 0; k--) r = cadd(cmul(r, z, bits), cs[k], bits);
    return r;
  };
  return approx.map(a => {
    let z: C = { re: bfFromNumber(a.re), im: bfFromNumber(Math.abs(a.im) < 1e-14 * Math.max(1, Math.abs(a.re)) ? 0 : a.im) };
    for (let it = 0; it < 60; it++) {
      const d = evalP(dcoefs, z);
      if (!d.re.m && !d.im.m) break;
      const step = cdiv(evalP(coefs, z), d, bits);
      z = csub(z, step, bits);
      const sz = cabs(step, 64), zz = cabs(z, 64);
      if (!sz.m || top(sz) < top(zz) - bits + 8) break;
    }
    // a real polynomial's real root keeps no imaginary dust
    if (z.im.m && top(z.im) < top(z.re) - bits + 16) z = { re: z.re, im: BZERO };
    return z;
  });
}

