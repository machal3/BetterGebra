/**
 * Expressions compiled to plain double-precision closures of one variable, for plots, numeric quadrature and
 * sign scans. Not for printed digits: those come from numeric.ts.
 */
import type { Expr } from './expr';
import { gamma } from '../math/functions';
import { qToNumber } from './q';

export type RealFn = (x: number) => number;

function erf(x: number): number {
  const ax = Math.abs(x);
  if (ax < 3) {
    // Taylor series, fine to ~1e-16 here
    let sum = x, term = x;
    const x2 = x * x;
    for (let n = 1; n < 200; n++) {
      term *= -x2 / n;
      const t = term / (2 * n + 1);
      sum += t;
      if (Math.abs(t) < 1e-17 * Math.abs(sum)) break;
    }
    return 2 / Math.sqrt(Math.PI) * sum;
  }
  // continued fraction for erfc
  let f = 0;
  for (let n = 60; n >= 1; n--) f = n / 2 / (ax + f);
  const erfc = Math.exp(-ax * ax) / Math.sqrt(Math.PI) / (ax + f);
  return x > 0 ? 1 - erfc : erfc - 1;
}

const F1: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, cot: x => 1 / Math.tan(x), sec: x => 1 / Math.cos(x), csc: x => 1 / Math.sin(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan, acot: x => x === 0 ? Math.PI / 2 : Math.atan(1 / x) + (x < 0 ? Math.PI : 0),
  asec: x => Math.acos(1 / x), acsc: x => Math.asin(1 / x),
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, coth: x => 1 / Math.tanh(x), sech: x => 1 / Math.cosh(x), csch: x => 1 / Math.sinh(x),
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh, acoth: x => Math.atanh(1 / x),
  ln: x => x > 0 ? Math.log(x) : x === 0 ? -Infinity : NaN, abs: Math.abs, sign: Math.sign, floor: Math.floor, ceil: Math.ceil,
  round: x => Math.sign(x) * Math.round(Math.abs(x)), frac: x => x - Math.floor(x),
  gamma, factorial: x => gamma(x + 1), erf, erfc: x => 1 - erf(x), re: x => x, im: () => 0, conj: x => x,
  arg: x => x > 0 ? 0 : x < 0 ? Math.PI : NaN,
};

/** A closure computing e at x = v; NaN where e is undefined or not real. */
export function compileDouble(e: Expr, x: string, params: Record<string, number> = {}): RealFn {
  switch (e.k) {
    case 'n': { const v = qToNumber(e.v); return () => v; }
    case 's': {
      if (e.n === x) return v => v;
      if (e.n === 'pi') return () => Math.PI;
      if (e.n === 'e') return () => Math.E;
      if (e.n === 'inf') return () => Infinity;
      if (Object.hasOwn(params, e.n)) { const v = params[e.n]; return () => v; }
      return () => NaN;
    }
    case '+': {
      const fs = e.t.map(t => compileDouble(t, x, params));
      return v => {
        let s = 0, c = 0;
        for (const f of fs) {
          const y = f(v), t = s + y;
          if (Number.isFinite(t)) c += Math.abs(s) >= Math.abs(y) ? (s - t) + y : (y - t) + s;
          s = t;
        }
        return Number.isFinite(s) ? s + c : s;
      };
    }
    case '*': {
      const fs = e.t.map(t => compileDouble(t, x, params));
      return v => { let s = 1; for (const f of fs) s *= f(v); return s; };
    }
    case '^': {
      const b = compileDouble(e.b, x, params), p = compileDouble(e.e, x, params);
      if (e.e.k === 'n') {
        const ev = qToNumber(e.e.v), odd = e.e.v.d % 2n === 1n && e.e.v.d !== 1n, oddNum = e.e.v.n % 2n !== 0n;
        if (e.e.v.d === 1n) return v => b(v) ** ev;
        // real odd roots: (−8)^(1/3) = −2, (−8)^(2/3) = 4
        if (odd) return v => { const B = b(v); return B < 0 ? (oddNum ? -1 : 1) * (-B) ** ev : B ** ev; };
        return v => { const B = b(v); return B < 0 ? NaN : B ** ev; };
      }
      return v => { const B = b(v), P = p(v); return B < 0 && !Number.isInteger(P) ? NaN : B ** P; };
    }
    case 'f': {
      const args = e.a.map(a => compileDouble(a, x, params));
      if (e.n === 'max' || e.n === 'min') { const m = Math[e.n]; return v => m(...args.map(f => f(v))); }
      if (e.n === 'mod') return v => { const a = args[0](v), b = args[1](v); return ((a % b) + b) % b; };
      if (e.n === 'binomial') return v => { const n = args[0](v), k = args[1](v); return gamma(n + 1) / (gamma(k + 1) * gamma(n - k + 1)); };
      const f = F1[e.n];
      if (!f) return () => NaN;
      const [a] = args;
      return v => f(a(v));
    }
  }
}

