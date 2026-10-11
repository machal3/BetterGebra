import type { ConstName } from './ast';

export interface RealFn {
  f: (...args: number[]) => number;
  /** Name as typeset (Polish conventions: tg, ctg, arctg…). */
  show: string;
  min: number;
  max: number;
}

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export { LANCZOS };

export function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * a;
}

export function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) return gamma(n + 1);
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/** n-th root; odd roots of negatives stay real. */
export const nthRoot = (n: number, x: number) => x < 0 && Number.isInteger(n) && n % 2 ? -((-x) ** (1 / n)) : x ** (1 / n);
export const mod = (a: number, b: number) => ((a % b) + b) % b;

const def = (f: RealFn['f'], show: string, min = 1, max = min): RealFn => ({ f, show, min, max });

export const FN: Record<string, RealFn> = {
  sin: def(Math.sin, 'sin'), cos: def(Math.cos, 'cos'), tan: def(Math.tan, 'tg'), cot: def(x => 1 / Math.tan(x), 'ctg'),
  sec: def(x => 1 / Math.cos(x), 'sec'), csc: def(x => 1 / Math.sin(x), 'csc'),
  asin: def(Math.asin, 'arcsin'), acos: def(Math.acos, 'arccos'), atan: def(Math.atan, 'arctg'), acot: def(x => Math.PI / 2 - Math.atan(x), 'arcctg'),
  sinh: def(Math.sinh, 'sinh'), cosh: def(Math.cosh, 'cosh'), tanh: def(Math.tanh, 'tanh'), coth: def(x => 1 / Math.tanh(x), 'coth'),
  asinh: def(Math.asinh, 'arsinh'), acosh: def(Math.acosh, 'arcosh'), atanh: def(Math.atanh, 'artanh'),
  sqrt: def(Math.sqrt, 'sqrt'), cbrt: def(Math.cbrt, 'cbrt'), root: def(nthRoot, 'root', 2),
  abs: def(Math.abs, 'abs'), sign: def(Math.sign, 'sgn'), floor: def(Math.floor, 'floor'), ceil: def(Math.ceil, 'ceil'), round: def(Math.round, 'round'),
  ln: def(Math.log, 'ln'), log: def((a, b) => b === undefined ? Math.log10(a) : Math.log(b) / Math.log(a), 'log', 1, 2),
  log2: def(Math.log2, 'log₂'), exp: def(Math.exp, 'exp'),
  // On the reals: Re x = x, Im x = 0, arg x ∈ {0, π}. The complex versions live in complex.ts.
  re: def(x => x, 'Re'), im: def(x => 0 * x, 'Im'), arg: def(x => x > 0 ? 0 : x < 0 ? Math.PI : NaN, 'arg'), conj: def(x => x, 'conj'),
  min: def(Math.min, 'min', 2, Infinity), max: def(Math.max, 'max', 2, Infinity), mod: def(mod, 'mod', 2), gamma: def(gamma, 'Γ'),
};

export const ALIAS: Record<string, string> = {
  tg: 'tan', ctg: 'cot', cotg: 'cot', cosec: 'csc', arcsin: 'asin', arccos: 'acos', arctan: 'atan', arctg: 'atan', arccot: 'acot', arcctg: 'acot',
  arsinh: 'asinh', arcsinh: 'asinh', arcosh: 'acosh', arccosh: 'acosh', artanh: 'atanh', arctanh: 'atanh', tgh: 'tanh', ctgh: 'coth',
  sgn: 'sign', lg: 'log', ld: 'log2', nroot: 'root',
};

/** sin^-1 x = asin x. */
export const INVERSE: Record<string, string> = { sin: 'asin', cos: 'acos', tan: 'atan', cot: 'acot', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' };

export const CONST: Record<ConstName, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2 };
export const CONST_SYMBOL: Record<ConstName, string> = { pi: 'π', e: 'e', tau: 'τ', phi: 'φ' };
export const isConst = (s: string): s is ConstName => Object.hasOwn(CONST, s);
