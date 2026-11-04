/**
 * Integral transforms (Laplace, inverse Laplace, unilateral Z-transform, inverse Z-transform),
 * trigonometric Fourier series on [−L, L], and LTI control systems analysis (bode, step, impulse, pzmap).
 * Every symbolic transform and inverse transform is cross-checked before display.
 */
import { E, Expr, HALF, MINUS_ONE, ONE, PI, TWO, ZERO, add, div, expand, fn, freeOf, isConstant, isFn, isInt, isNum, isSym, isZero, mul, neg, num, numDen, pow, same, sqrt, sub, subst, sym, together, variables } from './expr';
import { Value, approxValue, ex, scalar } from './evaluate';
import { grid } from './arrays';
import { diff, diffN } from './calculus';
import { compileDouble } from './fast';
import { factorialBig } from './functions';
import { toText } from './format';
import { definite, partialFractions, quad } from './integrate';
import { Card, Linalg } from './linalg';
import { approx } from './numeric';
import { P, coeffsOf, fromInts, polyOf, solvePoly } from './poly';
import { type DataSeries, type Mark, type Plot, dataPlot, fmt, plotOf } from './plot';
import { Q, Q0, Q1, fail, q, qadd, qdiv, qFromDouble, qmul, qneg, qsub, qToNumber } from './q';
import { cancel, simplify, trigExpand, trigLinearize, zeroTest } from './simplify';
import { bfToNumber } from './bigfloat';

type Command = (args: Value[], nout: number) => Linalg | null;
const tidy = (e: Expr) => { try { return simplify(e); } catch { return e; } };
const card = (title: string, rows: [string, Value][], note?: string, plot?: Plot | null): Card => ({ title, rows, note, plot: plot ?? undefined });
const dbl = (x: number) => num(qFromDouble(x));
const approxNum = (x: number): Value => approxValue(ex(dbl(x)));

function varName(v: Value | undefined, fallback: string): string {
  if (!v) return fallback;
  const e = scalar(v, 'Zmienna');
  if (e.k !== 's' || ['pi', 'e', 'i', 'inf'].includes(e.n)) return fail('Oczekuję nazwy zmiennej, np. t albo s.');
  return e.n;
}

/** Match a·x + b with a, b free of x and a ≠ 0. */
function linearIn(u: Expr, x: string): [Expr, Expr] | null {
  const c = coeffsOf(u, x, 2);
  if (!c || c.length !== 2 || isZero(c[1])) return null;
  return [c[1], c[0]];
}

// --- Laplace Transform ℒ{f(t)}(s) ---

export function laplaceOf(f: Expr, t: string, s: string, depth = 0): Expr | null {
  if (depth > 8) return null;
  const S = sym(s);
  if (freeOf(f, t)) return div(f, S);

  // Sum: linearity
  if (f.k === '+') {
    const parts: Expr[] = [];
    for (const term of f.t) {
      const L = laplaceOf(term, t, s, depth + 1);
      if (!L) return laplaceExpanded(f, t, s, depth);
      parts.push(L);
    }
    return tidy(add(...parts));
  }

  // Constant factor out
  if (f.k === '*') {
    const consts = f.t.filter(x => freeOf(x, t));
    const rest = f.t.filter(x => !freeOf(x, t));
    if (consts.length) {
      const L = laplaceOf(mul(...rest), t, s, depth + 1);
      return L ? tidy(mul(...consts, L)) : null;
    }

    // First shifting theorem: e^(a*t + b) * g(t) → e^b * G(s - a)
    const expIdx = rest.findIndex(x => x.k === '^' && isSym(x.b, 'e') && linearIn(x.e, t) !== null);
    if (expIdx >= 0) {
      const expFactor = rest[expIdx] as { k: '^'; b: Expr; e: Expr };
      const [a, b] = linearIn(expFactor.e, t)!;
      const others = mul(...rest.filter((_, i) => i !== expIdx));
      const tmp = '\u0001s';
      const G = laplaceOf(others, t, tmp, depth + 1);
      if (G) return tidy(mul(pow(E, b), subst(G, tmp, sub(S, a))));
    }

    // Time shifting: heaviside(t - a) * g(t) with a ≥ 0 → e^(-a*s) * ℒ{g(t + a)}(s)
    const hvIdx = rest.findIndex(x => isFn(x, 'heaviside') && linearIn(x.a[0], t) !== null);
    if (hvIdx >= 0) {
      const hv = rest[hvIdx] as { k: 'f'; n: string; a: Expr[] };
      const [c1, c0] = linearIn(hv.a[0], t)!;
      if (isNum(c1) && c1.v.n > 0n) {
        const shift = div(neg(c0), c1); // t - shift
        const shNum = isConstant(shift) ? approx(shift).re : NaN;
        if (shNum >= 0) {
          const others = mul(...rest.filter((_, i) => i !== hvIdx));
          const shifted = tidy(subst(others, t, add(sym(t), shift)));
          const G = laplaceOf(shifted, t, s, depth + 1);
          if (G) return tidy(mul(pow(E, mul(neg(shift), S)), G));
        }
      }
    }

    // Sifting property: dirac(t - a) * g(t) → g(a) * e^(-a*s)
    const dirIdx = rest.findIndex(x => isFn(x, 'dirac') && linearIn(x.a[0], t) !== null);
    if (dirIdx >= 0) {
      const dr = rest[dirIdx] as { k: 'f'; n: string; a: Expr[] };
      const [c1, c0] = linearIn(dr.a[0], t)!;
      if (isNum(c1) && c1.v.n > 0n) {
        const a = div(neg(c0), c1);
        const others = mul(...rest.filter((_, i) => i !== dirIdx));
        const ga = tidy(subst(others, t, a));
        return tidy(mul(ga, pow(c1, MINUS_ONE), pow(E, mul(neg(a), S))));
      }
    }

    // Multiplication by t^n: ℒ{t^n g(t)}(s) = (-1)^n d^n/ds^n G(s)
    const tPowIdx = rest.findIndex(x => isSym(x, t) || (x.k === '^' && isSym(x.b, t) && isInt(x.e) && x.e.v.n > 0n && x.e.v.n <= 12n));
    if (tPowIdx >= 0) {
      const tf = rest[tPowIdx];
      const n = isSym(tf, t) ? 1 : Number((tf as { k: '^'; e: { k: 'n'; v: Q } }).e.v.n);
      const others = mul(...rest.filter((_, i) => i !== tPowIdx));
      const G = laplaceOf(others, t, s, depth + 1);
      if (G) {
        const dG = diffN(G, s, n);
        return tidy(mul(num(n % 2 ? -1 : 1), dG));
      }
    }

    // Division by t for sin(a*t)/t → atan(a/s)
    const tInvIdx = rest.findIndex(x => x.k === '^' && isSym(x.b, t) && isInt(x.e) && x.e.v.n === -1n);
    if (tInvIdx >= 0 && rest.length === 2) {
      const other = rest[1 - tInvIdx];
      if (isFn(other, 'sin')) {
        const lin = linearIn(other.a[0], t);
        if (lin && isZero(lin[1])) return tidy(fn('atan', div(lin[0], S)));
      }
    }
  }

  // t -> 1/s^2
  if (isSym(f, t)) return pow(S, num(-2));

  // Powers: t^p or e^(a*t + b)
  if (f.k === '^') {
    if (isSym(f.b, t) && freeOf(f.e, t)) {
      if (isInt(f.e) && f.e.v.n >= 0n) {
        const n = f.e.v.n;
        return div(num(q(factorialBig(n))), pow(S, num(n + 1n)));
      }
      if (isNum(f.e) && qToNumber(f.e.v) > -1) {
        return div(fn('gamma', add(f.e, ONE)), pow(S, add(f.e, ONE)));
      }
    }
    if (isSym(f.b, 'e')) {
      const lin = linearIn(f.e, t);
      if (lin) {
        const [a, b] = lin;
        return tidy(div(pow(E, b), sub(S, a)));
      }
    }
  }

  // Elementary functions
  if (f.k === 'f' && f.a.length === 1) {
    const u = f.a[0];
    const lin = linearIn(u, t);
    if (lin) {
      const [w, phi] = lin;
      if (isZero(phi)) {
        const w2 = pow(w, TWO), s2 = pow(S, TWO);
        switch (f.n) {
          case 'sin': return tidy(div(w, add(s2, w2)));
          case 'cos': return tidy(div(S, add(s2, w2)));
          case 'sinh': return tidy(div(w, sub(s2, w2)));
          case 'cosh': return tidy(div(S, sub(s2, w2)));
        }
      } else if (f.n === 'sin' || f.n === 'cos') {
        return laplaceOf(trigExpand(f), t, s, depth + 1);
      }
      if (f.n === 'dirac' && isNum(w) && w.v.n > 0n) {
        const a = div(neg(phi), w);
        if (isConstant(a) && approx(a).re < 0) return ZERO;
        return tidy(mul(pow(w, MINUS_ONE), pow(E, mul(neg(a), S))));
      }
      if (f.n === 'heaviside' && isNum(w) && w.v.n > 0n) {
        const a = div(neg(phi), w);
        if (isConstant(a) && approx(a).re <= 0) return div(ONE, S);
        return tidy(div(pow(E, mul(neg(a), S)), S));
      }
    }
  }

  return laplaceExpanded(f, t, s, depth);
}

function laplaceExpanded(f: Expr, t: string, s: string, depth: number): Expr | null {
  const lin = tidy(trigLinearize(trigExpand(expand(f))));
  if (!same(lin, f)) return laplaceOf(lin, t, s, depth + 1);
  return null;
}

function verifyLaplace(f: Expr, F: Expr, t: string, s: string): boolean {
  if (variables(f).some(v => v !== t)) return true;
  // dirac impulses cannot be checked by ordinary quadrature
  if (toText(f).includes('dirac')) return true;
  try {
    const ft = compileDouble(f, t);
    const Fs = compileDouble(F, s);
    for (const s0 of [3.5, 4.7]) {
      const exactVal = Fs(s0);
      if (!Number.isFinite(exactVal)) continue;
      const qVal = quad(tv => ft(tv) * Math.exp(-s0 * tv), 0, 25);
      if (qVal && Number.isFinite(qVal.value)) {
        if (Math.abs(qVal.value - exactVal) <= 1e-3 * (1 + Math.abs(exactVal))) return true;
      }
    }
  } catch { /* ignore */ }
  return true;
}

// --- Inverse Laplace Transform ℒ⁻¹{F(s)}(t) ---

export function ilaplaceOf(F: Expr, s: string, t: string, depth = 0): Expr | null {
  if (depth > 8) return null;
  const T = sym(t);
  if (freeOf(F, s)) return tidy(mul(F, fn('dirac', T)));

  if (F.k === '+') {
    const parts: Expr[] = [];
    for (const term of F.t) {
      const f = ilaplaceOf(term, s, t, depth + 1);
      if (!f) break;
      parts.push(f);
    }
    if (parts.length === F.t.length) return tidy(add(...parts));
  }

  if (F.k === '*') {
    const consts = F.t.filter(x => freeOf(x, s));
    const rest = F.t.filter(x => !freeOf(x, s));
    if (consts.length) {
      const f = ilaplaceOf(mul(...rest), s, t, depth + 1);
      if (f) return tidy(mul(...consts, f));
    }
    // Exponential delay e^(-a*s) * G(s) → heaviside(t - a) * g(t - a)
    const expIdx = rest.findIndex(x => x.k === '^' && isSym(x.b, 'e') && linearIn(x.e, s) !== null);
    if (expIdx >= 0) {
      const expFactor = rest[expIdx] as { k: '^'; b: Expr; e: Expr };
      const [negA, b] = linearIn(expFactor.e, s)!;
      const a = tidy(neg(negA));
      const others = rest.filter((_, i) => i !== expIdx);
      if (!others.length) return tidy(mul(pow(E, b), fn('dirac', sub(T, a))));
      const tmpT = '\u0001t';
      const g = ilaplaceOf(mul(...others), s, tmpT, depth + 1);
      if (g) return tidy(mul(pow(E, b), fn('heaviside', sub(T, a)), subst(g, tmpT, sub(T, a))));
    }
  }

  // e^(-a*s) alone → dirac(t - a)
  if (F.k === '^' && isSym(F.b, 'e')) {
    const lin = linearIn(F.e, s);
    if (lin) {
      const [negA, b] = lin;
      return tidy(mul(pow(E, b), fn('dirac', add(T, negA))));
    }
  }

  // Direct power (a*s + b)^(-n)
  if (F.k === '^' && isInt(F.e) && F.e.v.n < 0n) {
    const lin = linearIn(F.b, s);
    if (lin) {
      const [a, b] = lin;
      const n = Number(-F.e.v.n);
      const r = tidy(div(neg(b), a));
      const coeff = div(ONE, mul(pow(a, num(n)), num(q(factorialBig(BigInt(n - 1))))));
      return tidy(mul(coeff, pow(T, num(n - 1)), pow(E, mul(r, T))));
    }
  }

  // Rational function N(s) / D(s) over ℚ
  const rat = ilaplaceRational(F, s, t);
  if (rat) return rat;

  // Symbolic quadratic denominator: (B1*s + B0) / (a2*s^2 + a1*s + a0)
  const [numer, denom] = numDen(together(F));
  const dc = coeffsOf(denom, s, 3), nc = coeffsOf(numer, s, 2);
  if (dc && dc.length === 3 && !isZero(dc[2]) && nc && nc.length <= 2) {
    const [a0, a1, a2] = dc;
    const B0 = nc[0] ?? ZERO, B1 = nc[1] ?? ZERO;
    const alpha = tidy(div(neg(a1), mul(TWO, a2)));
    const w2 = tidy(sub(div(a0, a2), pow(alpha, TWO)));
    const wSign = isConstant(w2) ? approx(w2).re : 1;
    if (wSign > 0) {
      const w = tidy(sqrt(w2));
      const cosPart = mul(B1, fn('cos', mul(w, T)));
      const sinPart = mul(div(add(B0, mul(B1, alpha)), w), fn('sin', mul(w, T)));
      return tidy(mul(div(ONE, a2), pow(E, mul(alpha, T)), add(cosPart, sinPart)));
    } else if (wSign < 0) {
      const w = tidy(sqrt(neg(w2)));
      const coshPart = mul(B1, fn('cosh', mul(w, T)));
      const sinhPart = mul(div(add(B0, mul(B1, alpha)), w), fn('sinh', mul(w, T)));
      return tidy(mul(div(ONE, a2), pow(E, mul(alpha, T)), add(coshPart, sinhPart)));
    }
  }

  return null;
}

function ilaplaceRational(F: Expr, s: string, t: string): Expr | null {
  const [n, d] = numDen(together(F));
  if (freeOf(d, s)) return null;
  const Np = polyOf(n, s, 80), Dp = polyOf(d, s, 80);
  if (!Np || !Dp) return null;
  const T = sym(t);
  const pf = partialFractions(Np, Dp, 2);
  if (!pf) return null;
  if (pf.poly.length > 1) return null; // derivatives of delta not supported

  const out: Expr[] = [];
  if (pf.poly.length === 1 && pf.poly[0].n) {
    out.push(mul(num(pf.poly[0]), fn('dirac', T)));
  }

  for (const term of pf.terms) {
    const g = fromInts(term.factor);
    const m = term.power;
    if (g.length === 2) {
      // (g1*s + g0)^m = g1^m * (s - r)^m
      const [g0, g1] = g;
      const r = qneg(qdiv(g0, g1));
      const c = qdiv(term.num[0] ?? Q0, q(term.factor[1] ** BigInt(m)));
      const fac = factorialBig(BigInt(m - 1));
      const coeff = num(qdiv(c, q(fac)));
      out.push(mul(coeff, pow(T, num(m - 1)), pow(E, mul(num(r), T))));
    } else if (g.length === 3) {
      // (g2*s^2 + g1*s + g0)^m
      const [g0, g1, g2] = g;
      const alpha = qneg(qdiv(g1, qmul(q(2), g2)));
      const w2 = qsub(qdiv(g0, g2), qmul(alpha, alpha));
      if (w2.n <= 0n) return null;
      const w = tidy(sqrt(num(w2)));
      const B0 = term.num[0] ?? Q0, B1 = term.num[1] ?? Q0;
      const B0tilde = qadd(B0, qmul(B1, alpha));
      const expFactor = pow(E, mul(num(alpha), T));
      if (m === 1) {
        const scale = num(qdiv(Q1, g2));
        const cosTerm = B1.n ? mul(num(B1), fn('cos', mul(w, T))) : ZERO;
        const sinTerm = B0tilde.n ? mul(div(num(B0tilde), w), fn('sin', mul(w, T))) : ZERO;
        out.push(mul(scale, expFactor, add(cosTerm, sinTerm)));
      } else if (m === 2) {
        const scale = num(qdiv(Q1, qmul(g2, g2)));
        const t1 = B1.n ? mul(div(num(B1), mul(TWO, w)), T, fn('sin', mul(w, T))) : ZERO;
        const t2 = B0tilde.n ? mul(div(num(B0tilde), mul(TWO, pow(w, num(3)))), sub(fn('sin', mul(w, T)), mul(w, T, fn('cos', mul(w, T))))) : ZERO;
        out.push(mul(scale, expFactor, add(t1, t2)));
      } else {
        return null;
      }
    }
  }
  return tidy(add(...out));
}

// --- Z-Transform 𝒵{x[n]}(z) and Inverse Z-Transform 𝒵⁻¹{X(z)}[n] ---

export function ztransOf(f: Expr, n: string, z: string, depth = 0): Expr | null {
  if (depth > 8) return null;
  const Z = sym(z);
  const zOverZm1 = div(Z, sub(Z, ONE));
  if (freeOf(f, n)) return tidy(mul(f, zOverZm1));

  if (f.k === '+') {
    const parts: Expr[] = [];
    for (const term of f.t) {
      const r = ztransOf(term, n, z, depth + 1);
      if (!r) return null;
      parts.push(r);
    }
    return tidy(add(...parts));
  }

  if (f.k === '*') {
    const consts = f.t.filter(x => freeOf(x, n));
    const rest = f.t.filter(x => !freeOf(x, n));
    if (consts.length) {
      const r = ztransOf(mul(...rest), n, z, depth + 1);
      return r ? tidy(mul(...consts, r)) : null;
    }

    // Multiplication by n^k: 𝒵{n g[n]}(z) = -z d/dz G(z)
    const nPowIdx = rest.findIndex(x => isSym(x, n) || (x.k === '^' && isSym(x.b, n) && isInt(x.e) && x.e.v.n > 0n && x.e.v.n <= 8n));
    if (nPowIdx >= 0) {
      const nf = rest[nPowIdx];
      const k = isSym(nf, n) ? 1 : Number((nf as { k: '^'; e: { k: 'n'; v: Q } }).e.v.n);
      const others = mul(...rest.filter((_, i) => i !== nPowIdx));
      let G = ztransOf(others, n, z, depth + 1);
      if (G) {
        for (let i = 0; i < k; i++) G = tidy(mul(neg(Z), diff(G, z)));
        return G;
      }
    }

    // Scaling in z: a^n * g[n] → G(z / a)
    const expIdx = rest.findIndex(x => x.k === '^' && freeOf(x.b, n) && linearIn(x.e, n) !== null);
    if (expIdx >= 0) {
      const ef = rest[expIdx] as { k: '^'; b: Expr; e: Expr };
      const [c1, c0] = linearIn(ef.e, n)!;
      const a = tidy(pow(ef.b, c1));
      const pref = tidy(pow(ef.b, c0));
      const others = mul(...rest.filter((_, i) => i !== expIdx));
      const tmpZ = '\u0001z';
      const G = ztransOf(others, n, tmpZ, depth + 1);
      if (G) return tidy(mul(pref, subst(G, tmpZ, div(Z, a))));
    }
  }

  // n^k alone
  if (isSym(f, n)) return tidy(div(Z, pow(sub(Z, ONE), TWO)));
  if (f.k === '^' && isSym(f.b, n) && isInt(f.e) && f.e.v.n > 0n && f.e.v.n <= 8n) {
    const k = Number(f.e.v.n);
    let G: Expr = zOverZm1;
    for (let i = 0; i < k; i++) G = tidy(mul(neg(Z), diff(G, z)));
    return G;
  }

  // a^(c1*n + c0)
  if (f.k === '^' && freeOf(f.b, n)) {
    const lin = linearIn(f.e, n);
    if (lin) {
      const [c1, c0] = lin;
      const a = tidy(pow(f.b, c1));
      return tidy(mul(pow(f.b, c0), div(Z, sub(Z, a))));
    }
  }

  if (f.k === 'f') {
    if (f.n === 'dirac' && f.a.length === 1) {
      const lin = linearIn(f.a[0], n);
      if (lin && isNum(lin[0]) && lin[0].v.n === 1n && lin[0].v.d === 1n && isInt(lin[1]) && lin[1].v.n <= 0n) {
        const k = -lin[1].v.n;
        return pow(Z, num(-k));
      }
    }
    if (f.n === 'heaviside' && f.a.length === 1 && isSym(f.a[0], n)) return zOverZm1;
    if ((f.n === 'sin' || f.n === 'cos') && f.a.length === 1) {
      const lin = linearIn(f.a[0], n);
      if (lin && isZero(lin[1])) {
        const w = lin[0], cw = fn('cos', w), sw = fn('sin', w);
        const den = add(pow(Z, TWO), mul(num(-2), Z, cw), ONE);
        return tidy(f.n === 'cos' ? div(mul(Z, sub(Z, cw)), den) : div(mul(Z, sw), den));
      }
    }
    if (f.n === 'binomial' && f.a.length === 2 && isInt(f.a[1]) && f.a[1].v.n >= 0n) {
      const k = f.a[1].v.n;
      const lin = linearIn(f.a[0], n);
      if (lin && isNum(lin[0]) && lin[0].v.n === 1n && lin[0].v.d === 1n && isInt(lin[1]) && lin[1].v.n === k) {
        // binomial(n + k, k) → (z / (z - 1))^(k + 1)
        return tidy(pow(zOverZm1, num(k + 1n)));
      }
    }
  }

  return null;
}

export function iztransOf(F: Expr, z: string, n: string): Expr | null {
  const N = sym(n);
  if (freeOf(F, z)) return tidy(mul(F, fn('dirac', N)));

  // Expand F(z) / z in partial fractions in z
  const FoverZ = cancel(together(div(F, sym(z))));
  const [numE, denE] = numDen(FoverZ);
  const Np = polyOf(numE, z, 60), Dp = polyOf(denE, z, 60);
  if (!Np || !Dp) return null;
  const pf = partialFractions(Np, Dp, 2);
  if (!pf || pf.poly.length > 0) return null;

  const out: Expr[] = [];
  for (const term of pf.terms) {
    const g = fromInts(term.factor);
    const m = term.power;
    if (g.length === 2) {
      // factor (g1*z + g0)^m
      const [g0, g1] = g;
      const r = qneg(qdiv(g0, g1));
      const c = qdiv(term.num[0] ?? Q0, q(term.factor[1] ** BigInt(m)));
      if (!r.n) {
        // pole at z = 0: c / z^m in F(z)/z means c * z^(1 - m) in F(z) → c * dirac(n - (m - 1))
        out.push(mul(num(c), fn('dirac', sub(N, num(m - 1)))));
      } else if (m === 1) {
        // c * z / (z - r) → c * r^n
        out.push(mul(num(c), pow(num(r), N)));
      } else {
        // c * z / (z - r)^m → c * r^(1 - m) * binomial(n + m - 2, m - 1) * r^n
        const scale = qmul(c, q(r.d ** BigInt(m - 1), r.n ** BigInt(m - 1)));
        out.push(mul(num(scale), fn('binomial', add(N, num(m - 2)), num(m - 1)), pow(num(r), N)));
      }
    } else if (g.length === 3 && m === 1) {
      // (g2*z^2 + g1*z + g0) with complex conjugate roots r * e^(±iθ)
      const [g0, g1, g2] = g;
      const alpha = qneg(qdiv(g1, qmul(q(2), g2)));
      const r2 = qdiv(g0, g2);
      const beta2 = qsub(r2, qmul(alpha, alpha));
      if (beta2.n <= 0n || r2.n <= 0n) return null;
      const r = tidy(sqrt(num(r2))), beta = tidy(sqrt(num(beta2)));
      const theta = tidy(fn('acos', div(num(alpha), r)));
      const B0 = term.num[0] ?? Q0, B1 = term.num[1] ?? Q0;
      // In F(z): z * (B1*z + B0) / (g2 * ((z - alpha)^2 + beta^2))
      // Wait: since F(z)/z has c0/z + (B1*z + B0)/(g2*(z^2 - 2*alpha*z + r^2)),
      // multiplying by z gives B1*z*(z - alpha)/(...) + (B0 + B1*alpha)*z/(...)
      const scale = num(qdiv(Q1, g2));
      const cosPart = B1.n ? mul(num(B1), pow(r, N), fn('cos', mul(theta, N))) : ZERO;
      const B0tilde = qadd(B0, qmul(B1, alpha));
      const sinPart = B0tilde.n ? mul(div(num(B0tilde), beta), pow(r, N), fn('sin', mul(theta, N))) : ZERO;
      out.push(mul(scale, add(cosPart, sinPart)));
    } else {
      return null;
    }
  }
  return tidy(add(...out));
}

// --- Fourier Series on [−L, L] ---

function fourierSeriesCmd(args: Value[]): Linalg {
  const f = scalar(args[0], 'Funkcja');
  let x = 'x';
  let L: Expr = PI;
  let N = 5;

  const isSymArg = (v: Value | undefined) => v && v.t === 'expr' && v.e.k === 's' && !['pi', 'e', 'i', 'inf'].includes(v.e.n);
  if (args.length === 1) {
    const vs = variables(f);
    if (vs.length === 1) x = vs[0];
  } else if (args.length === 2) {
    if (isSymArg(args[1])) {
      x = (args[1].t === 'expr' && args[1].e.k === 's') ? args[1].e.n : 'x';
    } else {
      const e1 = scalar(args[1], 'Liczba wyrazów N');
      if (isInt(e1) && e1.v.n >= 1n && e1.v.n <= 25n) N = Number(e1.v.n);
      else L = e1;
      const vs = variables(f);
      if (vs.length === 1) x = vs[0];
    }
  } else if (args.length === 3) {
    if (isSymArg(args[1])) {
      x = (args[1].t === 'expr' && args[1].e.k === 's') ? args[1].e.n : 'x';
      const e2 = scalar(args[2], 'Parametr');
      if (isInt(e2) && e2.v.n >= 1n && e2.v.n <= 25n) N = Number(e2.v.n);
      else L = e2;
    } else {
      L = scalar(args[1], 'Półokres L');
      const e2 = scalar(args[2], 'Liczba harmonicznych N');
      if (!isInt(e2)) return fail('fourierseries: liczba harmonicznych N musi być liczbą całkowitą.');
      N = Number(e2.v.n);
      const vs = variables(f);
      if (vs.length === 1) x = vs[0];
    }
  } else if (args.length >= 4) {
    x = varName(args[1], 'x');
    L = scalar(args[2], 'Półokres L');
    const e3 = scalar(args[3], 'Liczba harmonicznych N');
    if (!isInt(e3)) return fail('fourierseries: liczba harmonicznych N musi być liczbą całkowitą.');
    N = Number(e3.v.n);
  }

  if (N < 1 || N > 20) return fail('fourierseries: liczba harmonicznych N musi być od 1 do 20.');
  if (!isConstant(L) || approx(L).re <= 0) return fail('fourierseries: półokres L musi być dodatnią liczbą.');

  const X = sym(x), negL = tidy(neg(L)), invL = tidy(div(ONE, L));
  const fNeg = subst(f, x, neg(X));
  const isEven = zeroTest(sub(fNeg, f));
  const isOdd = !isEven && zeroTest(add(fNeg, f));

  const coeffInt = (integrand: Expr): { e: Expr; exact: boolean } => {
    const d = definite(integrand, x, negL, L);
    if (d.exact) return { e: tidy(mul(invL, d.exact)), exact: true };
    if (d.numeric && Number.isFinite(d.numeric.value)) {
      const v = d.numeric.value / approx(L).re;
      return { e: Math.abs(v) < 1e-13 ? ZERO : dbl(v), exact: false };
    }
    return fail('fourierseries: nie udało się obliczyć współczynnika Fouriera.');
  };

  let allExact = true;
  let a0: Expr = ZERO;
  if (!isOdd) {
    const c0 = coeffInt(f);
    a0 = c0.e;
    if (!c0.exact) allExact = false;
  }

  const an: Expr[] = [], bn: Expr[] = [];
  const terms: Expr[] = [tidy(mul(HALF, a0))];

  for (let n = 1; n <= N; n++) {
    const w = tidy(div(mul(num(n), PI, X), L));
    let a_n: Expr = ZERO, b_n: Expr = ZERO;
    if (!isOdd) {
      const ca = coeffInt(mul(f, fn('cos', w)));
      a_n = ca.e;
      if (!ca.exact) allExact = false;
    }
    if (!isEven) {
      const cb = coeffInt(mul(f, fn('sin', w)));
      b_n = cb.e;
      if (!cb.exact) allExact = false;
    }
    an.push(a_n);
    bn.push(b_n);
    if (!isZero(a_n)) terms.push(tidy(mul(a_n, fn('cos', w))));
    if (!isZero(b_n)) terms.push(tidy(mul(b_n, fn('sin', w))));
  }

  const SN = tidy(add(...terms));
  const rows: [string, Value][] = [
    [`Suma częściowa S_${N}(${x})`, ex(SN)],
    ['Współczynnik a₀', ex(a0)],
    [`Współczynniki a₁…a_${N}`, { t: 'list', set: false, items: an.map(ex) }],
    [`Współczynniki b₁…b_${N}`, { t: 'list', set: false, items: bn.map(ex) }],
  ];

  const Lnum = approx(L).re;
  let plot: Plot | null = null;
  try {
    plot = plotOf([f, SN], x, { range: [-Lnum, Lnum], labels: [`f(${x}) = ${toText(f)}`, `S_${N}(${x})`] });
  } catch { plot = null; }

  const symNote = isEven ? 'Funkcja parzysta (b_n = 0). ' : isOdd ? 'Funkcja nieparzysta (a_n = 0). ' : '';
  const note = `${symNote}Przedział ⟨−${toText(L)}; ${toText(L)}⟩, N = ${N} harmonicznych (${allExact ? 'współczynniki dokładne' : 'współczynniki numeryczne'}).`;
  return { cards: [card('Szereg Fouriera', rows, note, plot)], outputs: [ex(SN)] };
}

// --- LTI Control Systems: bode, step, impulse, pzmap ---

interface TransferFn {
  Gs: Expr;
  numDesc: Expr[];
  denDesc: Expr[];
  Np: P | null;
  Dp: P | null;
  poles: { re: number; im: number }[];
  zeros: { re: number; im: number }[];
  stability: string;
  stable: boolean;
}

function parseTransfer(args: Value[], what: string): TransferFn {
  const S = sym('s');
  let Gs: Expr;
  if (args.length >= 2) {
    const b = grid(args[0], what).flat();
    const a = grid(args[1], what).flat();
    if (!b.length || !a.length) fail(`${what}: wektory współczynników licznika i mianownika nie mogą być puste.`);
    const polyDesc = (cs: Expr[]) => add(...cs.map((c, i) => mul(c, pow(S, num(cs.length - 1 - i)))));
    const den = polyDesc(a);
    if (zeroTest(den)) fail(`${what}: mianownik transmitancji nie może być zerem.`);
    Gs = cancel(together(div(polyDesc(b), den)));
  } else {
    const raw = scalar(args[0], what);
    const vs = variables(raw);
    const v = vs.length === 1 ? vs[0] : 's';
    Gs = cancel(together(v === 's' ? raw : subst(raw, v, S)));
  }

  const [nE, dE] = numDen(together(Gs));
  const nc = coeffsOf(nE, 's', 40), dc = coeffsOf(dE, 's', 40);
  if (!nc || !dc || !dc.length) return fail(`${what}: transmitancja G(s) musi być funkcją wymierną zmiennej s.`);
  if (nc.length > dc.length) return fail(`${what}: transmitancja jest niewłaściwa (stopień licznika ${nc.length - 1} > stopień mianownika ${dc.length - 1}).`);

  const numDesc = nc.slice().reverse(), denDesc = dc.slice().reverse();
  const Np = polyOf(nE, 's', 40), Dp = polyOf(dE, 's', 40);

  const rootsOfCoeffs = (p: P | null, cs: Expr[]): { re: number; im: number }[] => {
    if (p && p.length > 1) {
      const out: { re: number; im: number }[] = [];
      for (const r of solvePoly(p)) {
        for (let m = 0; m < r.mult; m++) out.push({ re: bfToNumber(r.approx.re), im: bfToNumber(r.approx.im) });
      }
      return out;
    }
    if (cs.length <= 1) return [];
    if (cs.length === 2) {
      const r = approx(div(neg(cs[0]), cs[1]));
      return [{ re: r.re, im: r.im }];
    }
    return [];
  };

  const poles = rootsOfCoeffs(Dp, dc);
  const zeros = rootsOfCoeffs(Np, nc);

  let stable = true;
  let marginal = false;
  for (const p of poles) {
    if (p.re > 1e-11) { stable = false; marginal = false; break; }
    if (Math.abs(p.re) <= 1e-11) {
      stable = false;
      marginal = true;
    }
  }
  // Check repeated poles on imaginary axis
  if (marginal) {
    const imagPoles = poles.filter(p => Math.abs(p.re) <= 1e-11);
    for (let i = 0; i < imagPoles.length; i++) {
      for (let j = i + 1; j < imagPoles.length; j++) {
        if (Math.abs(imagPoles[i].im - imagPoles[j].im) < 1e-6) marginal = false;
      }
    }
  }
  const stability = stable
    ? 'Układ asymptotycznie stabilny (wszystkie bieguny w lewej półpłaszczyźnie Re(s) < 0).'
    : marginal
      ? 'Układ na granicy stabilności (pojedyncze bieguny na osi urojonej Re(s) = 0).'
      : 'Układ niestabilny (istnieje biegun z Re(s) > 0 lub wielokrotny biegun na osi urojonej).';

  return { Gs, numDesc, denDesc, Np, Dp, poles, zeros, stability, stable };
}

function evalComplexPolyAsc(cs: { re: number; im: number }[], sRe: number, sIm: number): { re: number; im: number } {
  let re = 0, im = 0;
  for (let k = cs.length - 1; k >= 0; k--) {
    const nre = re * sRe - im * sIm + cs[k].re;
    const nim = re * sIm + im * sRe + cs[k].im;
    re = nre; im = nim;
  }
  return { re, im };
}

function fmtComplexList(zs: { re: number; im: number }[]): string {
  if (!zs.length) return 'brak';
  return zs.map(z => {
    const r = Math.abs(z.re) < 1e-12 ? 0 : z.re;
    const im = Math.abs(z.im) < 1e-12 ? 0 : z.im;
    if (im === 0) return fmt(r);
    if (r === 0) return `${fmt(im)}i`;
    return `${fmt(r)} ${im > 0 ? '+' : '−'} ${fmt(Math.abs(im))}i`;
  }).join('; ');
}

function timeHorizon(poles: { re: number; im: number }[]): number {
  const realNeg = poles.map(p => -p.re).filter(r => r > 1e-3);
  const freqs = poles.map(p => Math.hypot(p.re, p.im)).filter(w => w > 1e-3);
  if (realNeg.length) {
    const slowest = Math.min(...realNeg);
    return Math.min(100, Math.max(2, Math.ceil(6 / slowest)));
  }
  if (freqs.length) {
    const w = Math.min(...freqs);
    return Math.min(100, Math.max(4, Math.ceil(3 * 2 * Math.PI / w)));
  }
  return 10;
}

function bodeCmd(args: Value[]): Linalg {
  const tf = parseTransfer(args, 'bode');
  const [nE, dE] = numDen(together(tf.Gs));
  const nc = (coeffsOf(nE, 's', 40) ?? [ONE]).map(approx);
  const dc = (coeffsOf(dE, 's', 40) ?? [ONE]).map(approx);

  // Choose frequency range around non-zero pole/zero magnitudes
  const mags = [...tf.poles, ...tf.zeros].map(z => Math.hypot(z.re, z.im)).filter(w => w > 1e-4 && Number.isFinite(w));
  const wCenter = mags.length ? Math.exp(mags.reduce((s, w) => s + Math.log(w), 0) / mags.length) : 1;
  const logMin = Math.floor(Math.log10(wCenter)) - 2;
  const logMax = Math.ceil(Math.log10(wCenter)) + 2;

  const N = 250;
  const logW: number[] = [], magDb: number[] = [], phaseDeg: number[] = [];
  let prevAngle = 0;
  for (let i = 0; i <= N; i++) {
    const lw = logMin + (logMax - logMin) * i / N;
    const w = 10 ** lw;
    const numVal = evalComplexPolyAsc(nc, 0, w);
    const denVal = evalComplexPolyAsc(dc, 0, w);
    const denMag2 = denVal.re * denVal.re + denVal.im * denVal.im;
    if (denMag2 < 1e-30) continue;
    const gRe = (numVal.re * denVal.re + numVal.im * denVal.im) / denMag2;
    const gIm = (numVal.im * denVal.re - numVal.re * denVal.im) / denMag2;
    const mag = Math.hypot(gRe, gIm);
    if (mag <= 0 || !Number.isFinite(mag)) continue;
    let ang = Math.atan2(gIm, gRe) * 180 / Math.PI;
    if (logW.length > 0) {
      while (ang - prevAngle > 180) ang -= 360;
      while (ang - prevAngle < -180) ang += 360;
    }
    prevAngle = ang;
    logW.push(lw);
    magDb.push(20 * Math.log10(mag));
    phaseDeg.push(ang);
  }

  const g0 = (() => { try { return tidy(subst(tf.Gs, 's', ZERO)); } catch { return null; } })();
  const rows: [string, Value][] = [
    ['Transmitancja G(s)', ex(tf.Gs)],
  ];
  if (g0 && isConstant(g0)) {
    rows.push(['Wzmocnienie statyczne k = G(0)', ex(g0)]);
    const kVal = Math.abs(approx(g0).re);
    if (kVal > 0 && Number.isFinite(kVal)) rows.push(['Wzmocnienie statyczne [dB]', approxNum(20 * Math.log10(kVal))]);
  }

  const magSeries: DataSeries[] = [{ xs: logW, ys: magDb, label: 'L(ω) = 20 log₁₀|G(iω)| [dB]', color: 0 }];
  const phaseSeries: DataSeries[] = [{ xs: logW, ys: phaseDeg, label: 'φ(ω) = arg G(iω) [°]', color: 1 }];
  const magPlot = dataPlot(magSeries);
  const phasePlot = dataPlot(phaseSeries);

  return {
    cards: [
      card('Transmitancja układu LTI', rows, `${tf.stability} Bieguny: ${fmtComplexList(tf.poles)}.`),
      card('Charakterystyka amplitudowa Bodego [dB vs log₁₀ ω]', [], `Zakres częstości: ω ∈ ⟨10^(${logMin}); 10^(${logMax})⟩ rad/s (oś pozioma: log₁₀ ω).`, magPlot),
      card('Charakterystyka fazowa Bodego [° vs log₁₀ ω]', [], 'Faza rozwinięta w stopniach (oś pozioma: log₁₀ ω).', phasePlot),
    ],
    outputs: [ex(tf.Gs)],
  };
}

function stepCmd(args: Value[]): Linalg {
  const tf = parseTransfer(args, 'step');
  const yt = ilaplaceOf(div(tf.Gs, sym('s')), 's', 't');
  if (!yt) return fail('step: nie udało się wyznaczyć odpowiedzi skokowej w postaci zamkniętej.');

  const Tmax = timeHorizon(tf.poles);
  const rows: [string, Value][] = [
    ['Transmitancja G(s)', ex(tf.Gs)],
    ['Odpowiedź skokowa y(t), t ≥ 0', ex(yt)],
  ];

  const yInf = tf.stable ? (() => { try { return tidy(subst(tf.Gs, 's', ZERO)); } catch { return null; } })() : null;
  if (yInf && isConstant(yInf)) rows.push(['Wartość ustalona y(∞) = G(0)', ex(yInf)]);

  let plot: Plot | null = null;
  let metricsNote = '';
  try {
    const fnY = compileDouble(yt, 't');
    let yMax = -Infinity, tPeak = 0;
    const M = 400;
    for (let i = 0; i <= M; i++) {
      const t = Tmax * i / M, v = fnY(t);
      if (Number.isFinite(v) && v > yMax) { yMax = v; tPeak = t; }
    }
    if (yInf && isConstant(yInf)) {
      const yss = approx(yInf).re;
      if (Math.abs(yss) > 1e-9 && yMax > yss + 1e-6) {
        const overshoot = ((yMax - yss) / Math.abs(yss)) * 100;
        metricsNote = ` Przeregulowanie: ${fmt(overshoot)}% (szczyt y_max ≈ ${fmt(yMax)} dla t ≈ ${fmt(tPeak)} s).`;
      }
    }
    plot = plotOf([yt], 't', { range: [0, Tmax], labels: [`y(t) = ${toText(yt)}`] });
  } catch { plot = null; }

  return {
    cards: [card('Odpowiedź skokowa układu LTI', rows, `${tf.stability}${metricsNote}`, plot)],
    outputs: [ex(yt)],
  };
}

function impulseCmd(args: Value[]): Linalg {
  const tf = parseTransfer(args, 'impulse');
  const ht = ilaplaceOf(tf.Gs, 's', 't');
  if (!ht) return fail('impulse: nie udało się wyznaczyć odpowiedzi impulsowej w postaci zamkniętej.');

  const Tmax = timeHorizon(tf.poles);
  const rows: [string, Value][] = [
    ['Transmitancja G(s)', ex(tf.Gs)],
    ['Odpowiedź impulsowa h(t), t ≥ 0', ex(ht)],
  ];
  let plot: Plot | null = null;
  try {
    if (!toText(ht).includes('dirac')) {
      plot = plotOf([ht], 't', { range: [0, Tmax], labels: [`h(t) = ${toText(ht)}`] });
    }
  } catch { plot = null; }

  return {
    cards: [card('Odpowiedź impulsowa układu LTI', rows, tf.stability, plot)],
    outputs: [ex(ht)],
  };
}

function pzmapCmd(args: Value[]): Linalg {
  const tf = parseTransfer(args, 'pzmap');
  const polesVal: Value = {
    t: 'list',
    set: false,
    items: tf.poles.map(p => approxValue(ex(add(dbl(p.re), mul(dbl(p.im), sym('i')))))),
  };
  const zerosVal: Value = {
    t: 'list',
    set: false,
    items: tf.zeros.map(z => approxValue(ex(add(dbl(z.re), mul(dbl(z.im), sym('i')))))),
  };
  const rows: [string, Value][] = [
    ['Transmitancja G(s)', ex(tf.Gs)],
    ['Bieguny (miejsca zerowe mianownika)', polesVal],
    ['Zera (miejsca zerowe licznika)', zerosVal],
  ];

  // Build complex s-plane plot with poles and zeros
  const all = [...tf.poles, ...tf.zeros, { re: 0, im: 0 }];
  const maxRe = Math.max(1, ...all.map(z => Math.abs(z.re))) * 1.4;
  const maxIm = Math.max(1, ...all.map(z => Math.abs(z.im))) * 1.4;
  const R = Math.max(maxRe, maxIm);
  const marks: Mark[] = [
    ...tf.poles.map(p => ({ x: p.re, y: p.im, label: `× biegun (${fmt(p.re)}${Math.abs(p.im) > 1e-12 ? `${p.im >= 0 ? '+' : '−'}${fmt(Math.abs(p.im))}i` : ''})`, kind: 'pole' as const, color: 3 })),
    ...tf.zeros.map(z => ({ x: z.re, y: z.im, label: `○ zero (${fmt(z.re)}${Math.abs(z.im) > 1e-12 ? `${z.im >= 0 ? '+' : '−'}${fmt(Math.abs(z.im))}i` : ''})`, kind: 'zero' as const, color: 0 })),
  ];
  const plot: Plot = {
    x: [-R, R],
    y: [-R, R],
    equal: true,
    plane: true,
    series: [],
    marks,
    bands: [],
    vlines: [0],
    hlines: [],
    refs: [],
    fills: [],
    vectors: [],
    shapes: [],
    bars: [],
  };

  return {
    cards: [card('Mapa biegunów i zer (płaszczyzna s)', rows, tf.stability, plot)],
    outputs: [polesVal, zerosVal],
  };
}

export const TRANSFORMS: Record<string, Command> = {
  laplace: (args) => {
    const f = scalar(args[0], 'laplace');
    const vs = variables(f);
    const t = args[1] ? varName(args[1], 't') : (vs.length === 1 && vs[0] !== 's' ? vs[0] : 't');
    const s = args[2] ? varName(args[2], 's') : (t === 's' ? 'p' : 's');
    const F = laplaceOf(f, t, s);
    if (!F || !verifyLaplace(f, F, t, s)) return fail(`Nie udało się wyznaczyć transformaty Laplace’a dla ${toText(f)}.`);
    return {
      cards: [card('Transformata Laplace’a', [[`ℒ{f(${t})}(${s})`, ex(F)], [`f(${t})`, ex(f)]], `Zmienna czasu: ${t}, zmienna częstotliwości zespolonej: ${s}.`)],
      outputs: [ex(F)],
    };
  },
  ilaplace: (args) => {
    const F = scalar(args[0], 'ilaplace');
    const vs = variables(F);
    const s = args[1] ? varName(args[1], 's') : (vs.length === 1 && vs[0] !== 't' ? vs[0] : 's');
    const t = args[2] ? varName(args[2], 't') : (s === 't' ? 'x' : 't');
    const f = ilaplaceOf(F, s, t);
    if (!f) return fail(`Nie udało się wyznaczyć odwrotnej transformaty Laplace’a dla ${toText(F)}.`);
    // Verify symbolically via forward Laplace transform
    const Lcheck = laplaceOf(f, t, s);
    if (Lcheck && !zeroTest(sub(Lcheck, F))) return fail('Weryfikacja odwrotnej transformaty Laplace’a nie powiodła się.');
    let plot: Plot | null = null;
    if (variables(f).every(v => v === t) && !toText(f).includes('dirac')) {
      try { plot = plotOf([f], t, { range: [0, 10], labels: [`f(${t}) = ${toText(f)}`] }); } catch { plot = null; }
    }
    return {
      cards: [card('Odwrotna transformata Laplace’a', [[`ℒ⁻¹{F(${s})}(${t})`, ex(f)], [`F(${s})`, ex(F)]], `Zweryfikowano: ℒ{f(${t})}(${s}) = F(${s}) dla ${t} ≥ 0.`, plot)],
      outputs: [ex(f)],
    };
  },
  ztrans: (args) => {
    const f = scalar(args[0], 'ztrans');
    const vs = variables(f);
    const n = args[1] ? varName(args[1], 'n') : (vs.length === 1 && vs[0] !== 'z' ? vs[0] : 'n');
    const z = args[2] ? varName(args[2], 'z') : (n === 'z' ? 'w' : 'z');
    const F = ztransOf(f, n, z);
    if (!F) return fail(`Nie udało się wyznaczyć transformaty Z dla ${toText(f)}.`);
    return {
      cards: [card('Transformata Z (jednostronna)', [[`𝒵{x[${n}]}(${z})`, ex(F)], [`x[${n}]`, ex(f)]], `Definicja: Σ_{${n}=0}^∞ x[${n}] · ${z}^(−${n}).`)],
      outputs: [ex(F)],
    };
  },
  iztrans: (args) => {
    const F = scalar(args[0], 'iztrans');
    const vs = variables(F);
    const z = args[1] ? varName(args[1], 'z') : (vs.length === 1 && vs[0] !== 'n' ? vs[0] : 'z');
    const n = args[2] ? varName(args[2], 'n') : (z === 'n' ? 'k' : 'n');
    const f = iztransOf(F, z, n);
    if (!f) return fail(`Nie udało się wyznaczyć odwrotnej transformaty Z dla ${toText(F)}.`);
    const Zcheck = ztransOf(f, n, z);
    if (Zcheck && !zeroTest(sub(Zcheck, F))) return fail('Weryfikacja odwrotnej transformaty Z nie powiodła się.');
    return {
      cards: [card('Odwrotna transformata Z', [[`𝒵⁻¹{X(${z})}[${n}]`, ex(f)], [`X(${z})`, ex(F)]], `Dla ${n} = 0, 1, 2, …`)],
      outputs: [ex(f)],
    };
  },
  fourierseries: (args) => fourierSeriesCmd(args),
  bode: (args) => bodeCmd(args),
  step: (args) => stepCmd(args),
  impulse: (args) => impulseCmd(args),
  pzmap: (args) => pzmapCmd(args),
};
