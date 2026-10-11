import type { Complex, Node, Params } from './ast';
import { CONST, FN, LANCZOS, factorial, mod, nthRoot } from './functions';
import { parse } from './parser';

export type ComplexFunction = (z: Complex) => Complex;

export const I: Complex = [0, 1];
const ONE: Complex = [1, 0];

export const add = ([a, b]: Complex, [c, d]: Complex): Complex => [a + c, b + d];
export const sub = ([a, b]: Complex, [c, d]: Complex): Complex => [a - c, b - d];
export const mul = ([a, b]: Complex, [c, d]: Complex): Complex => [a * c - b * d, a * d + b * c];
export const div = ([a, b]: Complex, [c, d]: Complex): Complex => { const n = c * c + d * d; return [(a * c + b * d) / n, (b * c - a * d) / n]; };
export const abs = (z: Complex) => Math.hypot(z[0], z[1]);
const real = (v: number): Complex => [v, 0];
const exp = ([a, b]: Complex): Complex => b === 0 ? [Math.exp(a), 0] : [Math.exp(a) * Math.cos(b), Math.exp(a) * Math.sin(b)];
const log = ([a, b]: Complex): Complex => [Math.log(Math.hypot(a, b)), Math.atan2(b, a)];
const sqrt = ([a, b]: Complex): Complex => { const r = Math.hypot(a, b); return [Math.sqrt((r + a) / 2), (b < 0 ? -1 : 1) * Math.sqrt((r - a) / 2)]; };

export function pow(z: Complex, w: Complex): Complex {
  // Integer powers by repeated squaring: exact at 0 and on the axes, where exp(w·log z) gives NaN or float noise.
  if (w[1] === 0 && Number.isInteger(w[0]) && Math.abs(w[0]) <= 1024) {
    let m = Math.abs(w[0]), out = ONE, base = z;
    while (m) {
      if (m & 1) out = mul(out, base);
      m >>= 1;
      if (m) base = mul(base, base);
    }
    return w[0] < 0 ? div(ONE, out) : out;
  }
  if (z[0] === 0 && z[1] === 0) return w[0] > 0 ? [0, 0] : [NaN, NaN];
  if (z[1] === 0 && w[1] === 0 && z[0] > 0) return [z[0] ** w[0], 0];
  return exp(mul(w, log(z)));
}

const sin = ([a, b]: Complex): Complex => [Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b)];
const cos = ([a, b]: Complex): Complex => [Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b)];
const sinh = ([a, b]: Complex): Complex => [Math.sinh(a) * Math.cos(b), Math.cosh(a) * Math.sin(b)];
const cosh = ([a, b]: Complex): Complex => [Math.cosh(a) * Math.cos(b), Math.sinh(a) * Math.sin(b)];
const reciprocal = (f: ComplexFunction): ComplexFunction => z => div(ONE, f(z));
const asin: ComplexFunction = z => mul([0, -1], log(add(mul(I, z), sqrt(sub(ONE, mul(z, z))))));
const atan: ComplexFunction = z => mul([0, 0.5], sub(log(sub(ONE, mul(I, z))), log(add(ONE, mul(I, z)))));

function gamma(z: Complex): Complex {
  if (z[0] < 0.5) return div([Math.PI, 0], mul(sin(mul([Math.PI, 0], z)), gamma(sub(ONE, z))));
  z = sub(z, ONE);
  let a: Complex = [LANCZOS[0], 0];
  const t = add(z, [7.5, 0]);
  for (let i = 1; i < 9; i++) a = add(a, div([LANCZOS[i], 0], add(z, [i, 0])));
  return mul(mul([Math.sqrt(2 * Math.PI), 0], pow(t, add(z, [0.5, 0]))), mul(exp([-t[0], -t[1]]), a));
}

type CFn = (...zs: Complex[]) => Complex;
// Principal values with the usual branch cuts. Functions only defined on the reals (min, max…) fall back to FN there.
const CFN: Record<string, CFn> = {
  sin, cos, tan: z => div(sin(z), cos(z)), cot: z => div(cos(z), sin(z)), sec: reciprocal(cos), csc: reciprocal(sin),
  asin, acos: z => sub([Math.PI / 2, 0], asin(z)), atan, acot: z => atan(div(ONE, z)),
  sinh, cosh, tanh: z => div(sinh(z), cosh(z)), coth: z => div(cosh(z), sinh(z)),
  asinh: z => log(add(z, sqrt(add(mul(z, z), ONE)))),
  acosh: z => log(add(z, mul(sqrt(add(z, ONE)), sqrt(sub(z, ONE))))),
  atanh: z => mul([0.5, 0], sub(log(add(ONE, z)), log(sub(ONE, z)))),
  sqrt, cbrt: z => z[1] === 0 ? [Math.cbrt(z[0]), 0] : pow(z, [1 / 3, 0]),
  root: (n, z) => z[1] === 0 && n[1] === 0 && Number.isFinite(nthRoot(n[0], z[0])) ? [nthRoot(n[0], z[0]), 0] : pow(z, div(ONE, n)),
  abs: z => [abs(z), 0],
  sign: z => { const r = abs(z); return r ? [z[0] / r, z[1] / r] : [0, 0]; },
  ln: log, exp,
  log: (a, b) => b === undefined ? div(log(a), [Math.LN10, 0]) : div(log(b), log(a)),
  log2: z => div(log(z), [Math.LN2, 0]),
  gamma,
  // Gaussian rounding: Re and Im separately, floor(2,5 + 1,7i) = 2 + i; mod(a; b) = a − b·floor(a/b) with it.
  floor: z => [Math.floor(z[0]), Math.floor(z[1])], ceil: z => [Math.ceil(z[0]), Math.ceil(z[1])], round: z => [Math.round(z[0]), Math.round(z[1])],
  mod: (a, b) => b[1] === 0 && a[1] === 0 ? [mod(a[0], b[0]), 0] : sub(a, mul(b, CFN.floor(div(a, b)))),
  re: z => [z[0], 0], im: z => [z[1], 0], arg: z => [z[0] || z[1] ? Math.atan2(z[1], z[0]) : NaN, 0], conj: z => [z[0], 0 - z[1]],
};
const onReals = (f: (...xs: number[]) => number): CFn => (...zs) => zs.every(z => z[1] === 0) ? [f(...zs.map(z => z[0])), 0] : [NaN, NaN];

/** On the complex plane i is the imaginary unit and z another name for the variable. */
export function buildComplex(n: Node, params: Params): ComplexFunction {
  switch (n.t) {
    case 'num': { const v = real(n.v); return () => v; }
    case 'x': return z => z;
    case 'const': { const v = real(CONST[n.n]); return () => v; }
    case 'param': {
      if (n.n === 'i') return () => I;
      if (n.n === 'z') return z => z;
      const name = n.n;
      return () => [Object.hasOwn(params, name) ? params[name] : 1, 0];
    }
    // 0 − 0 = +0 keeps ln(−1) = iπ rather than −iπ.
    case 'neg': { const a = buildComplex(n.a, params); return z => { const [u, v] = a(z); return [0 - u, 0 - v]; }; }
    case '!': { const a = buildComplex(n.a, params); return z => { const w = a(z); return w[1] === 0 ? [factorial(w[0]), 0] : gamma(add(w, ONE)); }; }
    case '°': { const a = buildComplex(n.a, params); return z => mul(a(z), [Math.PI / 180, 0]); }
    case 'call': {
      const f = CFN[n.n] ?? onReals(FN[n.n].f), args = n.args.map(g => buildComplex(g, params));
      if (args.length === 1) { const [a] = args; return z => f(a(z)); }
      return z => f(...args.map(g => g(z)));
    }
    default: {
      const a = buildComplex(n.a, params), b = buildComplex(n.b, params);
      switch (n.t) {
        case '+': return z => add(a(z), b(z));
        case '-': return z => sub(a(z), b(z));
        case '*': return z => mul(a(z), b(z));
        case '/': return z => div(a(z), b(z));
        case '^': return z => pow(a(z), b(z));
      }
    }
  }
}

export function compileComplex(input: string, params: Params = {}): ComplexFunction {
  return buildComplex(parse(input), params);
}
