/**
 * MATLAB's statistics: mode, range, prctile, quantile, iqr, skewness, kurtosis, zscore, var and std of matrices,
 * cov, corrcoef, histcounts; the probability distributions (…pdf, …cdf, …inv); fitlm; rand, randn, randi and rng.
 * Exact for exact data, as the rest of the engine: a percentile of rationals is a rational, normcdf is (1 + erf)/2.
 * The distribution functions without a closed form (tcdf, chi2cdf, …) use the regularized incomplete gamma and beta
 * functions in doubles, and every inverse is checked: cdf(inv(p)) = p.
 */
import { E, Expr, ONE, PI, ZERO, add, div, fn, isConstant, isNum, mul, neg, num, pow, sqrt, sub } from './expr';
import { Value, approxValue, ex, isApprox } from './evaluate';
import { grid, valueOf } from './arrays';
import { constSign } from './functions';
import { Card, Linalg, tiny } from './linalg';
import * as LA from './matrix';
import { approx } from './numeric';
import { dataPlot, fmt } from './plot';
import { Q, fail, qFromDouble } from './q';
import { simplify } from './simplify';
import { toText } from './format';

type Command = (args: Value[], nout: number) => Linalg | null;
const tidy = (e: Expr) => { try { return simplify(e); } catch { return e; } };
const dbl = (x: number) => num(qFromDouble(x));
const card = (title: string, rows: [string, Value][], note?: string, plot?: ReturnType<typeof dataPlot>): Card => ({ title, rows, note, plot: plot ?? undefined });
const text = (s: string): Value => ({ t: 'str', s });

function vector(v: Value | undefined, what: string): Expr[] {
  if (!v) return fail(`${what}: brak argumentu.`);
  const m = grid(v, what);
  if (m.length > 1 && m[0].length > 1) fail(`${what}: oczekuję wektora, a nie macierzy.`);
  return m.flat();
}
/** The columns of a matrix, or the one vector (MATLAB: statistics go down the columns). */
function columns(v: Value, what: string): { cols: Expr[][]; matrix: boolean } {
  const m = grid(v, what);
  if (m.length > 1 && m[0].length > 1) return { cols: m[0].map((_, j) => m.map(r => r[j])), matrix: true };
  return { cols: [m.flat()], matrix: false };
}
const sign = (e: Expr) => { const s = constSign(e); if (s === null) fail('Statystyki liczę dla liczb rzeczywistych.'); return s!; };
const sortE = (xs: Expr[]) => [...xs].sort((a, b) => sign(sub(a, b)));
const meanE = (xs: Expr[]) => div(add(...xs), num(xs.length));
const moment = (xs: Expr[], k: number) => { const m = meanE(xs); return div(add(...xs.map(x => pow(sub(x, m), num(k)))), num(xs.length)); };
const varE = (xs: Expr[], w: 0 | 1) => { if (xs.length < 2 && !w) fail('Wariancja próby potrzebuje co najmniej dwóch wartości.'); const m = meanE(xs); return div(add(...xs.map(x => pow(sub(x, m), num(2)))), num(xs.length - (w ? 0 : 1))); };
/** MATLAB's percentile: sorted values at 100(i − ½)/n, linear in between, the ends beyond them. */
function percentile(xs: Expr[], p: Expr): Expr {
  const s = sortE(xs), n = s.length;
  if (!n) fail('Percentyl pustej listy nie istnieje.');
  if (sign(p) < 0 || sign(sub(p, num(100))) > 0) fail('Percentyl: p od 0 do 100.');
  const pos = sub(div(mul(p, num(n)), num(100)), num(1, 2)); // 0-based place
  if (sign(pos) <= 0) return s[0];
  if (sign(sub(pos, num(n - 1))) >= 0) return s[n - 1];
  const k = Math.floor(approx(pos).re + 1e-12), frac = sub(pos, num(k));
  return tidy(add(s[k], mul(frac, sub(s[k + 1], s[k]))));
}
/** f of each column: a number for a vector, a row for a matrix; approximate in, approximate out. */
function perColumn(v: Value, what: string, f: (xs: Expr[]) => Expr): Value {
  const { cols } = columns(v, what), out = valueOf([cols.map(c => tidy(f(c)))]);
  return isApprox(v) ? approxValue(out) : out;
}
const one = (title: string, value: Value, note?: string): Linalg => ({ cards: [card(title, [['', value]], note)], outputs: [value] });

// --- Special functions in doubles: log Γ, the regularized incomplete gamma and beta ---

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
/** P(a, x) = γ(a, x)/Γ(a): a series below a + 1, a continued fraction above (Numerical Recipes). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a, del = sum;
    for (let n = 1; n < 1000; n++) { del *= x / (a + n); sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-16) break; }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
function betacf(a: number, b: number, x: number): number {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 1000; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}
/** I_x(a, b), the regularized incomplete beta function. */
export function betaI(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? front * betacf(a, b, x) / a : 1 - front * betacf(b, a, 1 - x) / b;
}
const tcdfN = (t: number, v: number) => { const i = betaI(v / 2, 0.5, v / (v + t * t)); return t > 0 ? 1 - i / 2 : i / 2; };
/** The x with cdf(x) = p: a bracket grown from [lo, hi], then bisection to the last bit, then checked. */
function invert(cdf: (x: number) => number, p: number, lo: number, hi: number, what: string): number {
  if (!(p >= 0 && p <= 1)) fail(`${what}: prawdopodobieństwo p od 0 do 1.`);
  if (p === 0) return lo === 0 ? 0 : -Infinity;
  if (p === 1) return Infinity;
  for (let k = 0; cdf(lo) > p && k < 200; k++) lo = lo < 0 ? lo * 2 : lo - 1;
  for (let k = 0; cdf(hi) < p && k < 200; k++) hi = hi > 0 ? hi * 2 : hi + 1;
  for (let k = 0; k < 400 && hi - lo > 1e-15 * Math.max(1, Math.abs(lo), Math.abs(hi)); k++) { const m = (lo + hi) / 2; if (cdf(m) < p) lo = m; else hi = m; }
  const x = (lo + hi) / 2;
  if (Math.abs(cdf(x) - p) > 1e-10 * Math.max(p, 1 - p, 1e-300) + 1e-14) fail(`${what}: odwrotność nie przeszła sprawdzenia.`);
  return x;
}

// --- Distributions: exact expressions where they exist, checked doubles otherwise ---

const arg = (v: Value | undefined, fallback: Expr | null, what: string): Expr => {
  if (!v) { if (!fallback) fail(`${what}: brak argumentu.`); return fallback!; }
  if (v.t !== 'expr' || !isConstant(v.e)) return fail(`${what}: oczekuję liczby.`);
  return v.e;
};
const real = (e: Expr) => approx(e).re;
const positive = (e: Expr, what: string) => { if (!(real(e) > 0)) fail(`${what} musi być dodatni.`); return e; };
/** f of each x (a number or a vector), the result in x's shape. */
function each(xv: Value, f: (x: Expr) => Expr): Value {
  const m = grid(xv, 'x'), out = m.map(r => r.map(x => { if (!isConstant(x)) fail('Rozkłady liczę dla liczb.'); return tidy(f(x)); }));
  const v = valueOf(out);
  return isApprox(xv) ? approxValue(v) : v;
}
/** f in doubles of each x, approximate. */
const eachN = (xv: Value, f: (x: number) => number): Value => approxValue(valueOf(grid(xv, 'x').map(r => r.map(x => dbl(f(real(x)))))));
const binom = (n: Expr, k: number) => fn('binomial', n, num(k));
const intOf = (e: Expr, what: string) => { if (!isNum(e) || e.v.d !== 1n) fail(`${what}: oczekuję liczby całkowitej.`); return Number((e as { v: Q }).v.n); };
const gammaE = (e: Expr) => fn('gamma', e);
const step = (cond: boolean, e: Expr) => (cond ? e : ZERO);

const DISTRIBUTIONS: Record<string, (a: Value[]) => Value> = {
  normpdf: ([x, m0, s0]) => { const m = arg(m0, ZERO, 'μ'), s = positive(arg(s0, ONE, 'σ'), 'σ'); return each(x, t => div(pow(E, neg(div(pow(sub(t, m), num(2)), mul(num(2), pow(s, num(2)))))), mul(s, sqrt(mul(num(2), PI))))); },
  normcdf: ([x, m0, s0]) => { const m = arg(m0, ZERO, 'μ'), s = positive(arg(s0, ONE, 'σ'), 'σ'); return each(x, t => div(add(ONE, fn('erf', div(sub(t, m), mul(s, sqrt(num(2)))))), num(2))); },
  norminv: ([p, m0, s0]) => {
    const m = real(arg(m0, ZERO, 'μ')), s = real(positive(arg(s0, ONE, 'σ'), 'σ'));
    const cdf = (x: number) => { const z = approx(div(add(ONE, fn('erf', div(dbl(x), sqrt(num(2))))), num(2))); return z.re; };
    return eachN(p, q => m + s * invert(cdf, q, -10, 10, 'norminv'));
  },
  tpdf: ([x, v0]) => { const v = positive(arg(v0, null, 'ν'), 'Liczba stopni swobody'); const h = div(add(v, ONE), num(2)); return each(x, t => mul(div(gammaE(h), mul(sqrt(mul(v, PI)), gammaE(div(v, num(2))))), pow(add(ONE, div(pow(t, num(2)), v)), neg(h)))); },
  tcdf: ([x, v0]) => { const v = real(positive(arg(v0, null, 'ν'), 'Liczba stopni swobody')); return eachN(x, t => tcdfN(t, v)); },
  tinv: ([p, v0]) => { const v = real(positive(arg(v0, null, 'ν'), 'Liczba stopni swobody')); return eachN(p, q => invert(t => tcdfN(t, v), q, -10, 10, 'tinv')); },
  chi2pdf: ([x, k0]) => { const k = positive(arg(k0, null, 'k'), 'Liczba stopni swobody'); return each(x, t => step(real(t) >= 0, div(mul(pow(t, sub(div(k, num(2)), ONE)), pow(E, neg(div(t, num(2))))), mul(pow(num(2), div(k, num(2))), gammaE(div(k, num(2))))))); },
  chi2cdf: ([x, k0]) => { const k = real(positive(arg(k0, null, 'k'), 'Liczba stopni swobody')); return eachN(x, t => gammaP(k / 2, t / 2)); },
  chi2inv: ([p, k0]) => { const k = real(positive(arg(k0, null, 'k'), 'Liczba stopni swobody')); return eachN(p, q => invert(t => gammaP(k / 2, t / 2), q, 0, Math.max(1, k * 2), 'chi2inv')); },
  fpdf: ([x, a0, b0]) => {
    const d1 = positive(arg(a0, null, 'd₁'), 'd₁'), d2 = positive(arg(b0, null, 'd₂'), 'd₂');
    const B = div(mul(gammaE(div(d1, num(2))), gammaE(div(d2, num(2)))), gammaE(div(add(d1, d2), num(2))));
    return each(x, t => step(real(t) > 0, div(sqrt(div(mul(pow(mul(d1, t), d1), pow(d2, d2)), pow(add(mul(d1, t), d2), add(d1, d2)))), mul(t, B))));
  },
  fcdf: ([x, a0, b0]) => { const d1 = real(positive(arg(a0, null, 'd₁'), 'd₁')), d2 = real(positive(arg(b0, null, 'd₂'), 'd₂')); return eachN(x, t => (t <= 0 ? 0 : betaI(d1 / 2, d2 / 2, d1 * t / (d1 * t + d2)))); },
  finv: ([p, a0, b0]) => { const d1 = real(positive(arg(a0, null, 'd₁'), 'd₁')), d2 = real(positive(arg(b0, null, 'd₂'), 'd₂')); return eachN(p, q => invert(t => (t <= 0 ? 0 : betaI(d1 / 2, d2 / 2, d1 * t / (d1 * t + d2))), q, 0, 10, 'finv')); },
  binopdf: ([k0, n0, p0]) => { const n = arg(n0, null, 'n'), p = arg(p0, null, 'p'); intOf(n, 'n'); return each(k0, k => { const kk = real(k); return Number.isInteger(kk) && kk >= 0 && kk <= real(n) ? mul(binom(n, kk), pow(p, k), pow(sub(ONE, p), sub(n, k))) : ZERO; }); },
  binocdf: ([k0, n0, p0]) => { const n = arg(n0, null, 'n'), p = arg(p0, null, 'p'), nn = intOf(n, 'n'); return each(k0, k => { const top = Math.min(nn, Math.floor(real(k) + 1e-12)); return top < 0 ? ZERO : add(...Array.from({ length: top + 1 }, (_, i) => mul(binom(n, i), pow(p, num(i)), pow(sub(ONE, p), num(nn - i))))); }); },
  poisspdf: ([k0, l0]) => { const l = positive(arg(l0, null, 'λ'), 'λ'); return each(k0, k => { const kk = real(k); return Number.isInteger(kk) && kk >= 0 ? div(mul(pow(E, neg(l)), pow(l, k)), fn('factorial', k)) : ZERO; }); },
  poisscdf: ([k0, l0]) => { const l = positive(arg(l0, null, 'λ'), 'λ'); return each(k0, k => { const top = Math.floor(real(k) + 1e-12); if (top > 2000) fail('poisscdf: k do 2000.'); return top < 0 ? ZERO : mul(pow(E, neg(l)), add(...Array.from({ length: top + 1 }, (_, i) => div(pow(l, num(i)), fn('factorial', num(i)))))); }); },
  exppdf: ([x, m0]) => { const m = positive(arg(m0, ONE, 'μ'), 'μ'); return each(x, t => step(real(t) >= 0, div(pow(E, neg(div(t, m))), m))); },
  expcdf: ([x, m0]) => { const m = positive(arg(m0, ONE, 'μ'), 'μ'); return each(x, t => step(real(t) >= 0, sub(ONE, pow(E, neg(div(t, m)))))); },
  expinv: ([p, m0]) => { const m = positive(arg(m0, ONE, 'μ'), 'μ'); return each(p, q => { if (!(real(q) >= 0 && real(q) < 1)) fail('expinv: p od 0 do 1.'); return neg(mul(m, fn('ln', sub(ONE, q)))); }); },
  unifpdf: ([x, a0, b0]) => { const a = arg(a0, ZERO, 'a'), b = arg(b0, ONE, 'b'); return each(x, t => step(real(t) >= real(a) && real(t) <= real(b), div(ONE, sub(b, a)))); },
  unifcdf: ([x, a0, b0]) => { const a = arg(a0, ZERO, 'a'), b = arg(b0, ONE, 'b'); return each(x, t => (real(t) <= real(a) ? ZERO : real(t) >= real(b) ? ONE : div(sub(t, a), sub(b, a)))); },
  unifinv: ([p, a0, b0]) => { const a = arg(a0, ZERO, 'a'), b = arg(b0, ONE, 'b'); return each(p, q => add(a, mul(q, sub(b, a)))); },
  gampdf: ([x, a0, b0]) => { const a = positive(arg(a0, null, 'a'), 'a'), b = positive(arg(b0, ONE, 'b'), 'b'); return each(x, t => step(real(t) >= 0, div(mul(pow(t, sub(a, ONE)), pow(E, neg(div(t, b)))), mul(gammaE(a), pow(b, a))))); },
  gamcdf: ([x, a0, b0]) => { const a = real(positive(arg(a0, null, 'a'), 'a')), b = real(positive(arg(b0, ONE, 'b'), 'b')); return eachN(x, t => gammaP(a, t / b)); },
  gaminv: ([p, a0, b0]) => { const a = real(positive(arg(a0, null, 'a'), 'a')), b = real(positive(arg(b0, ONE, 'b'), 'b')); return eachN(p, q => b * invert(t => gammaP(a, t), q, 0, Math.max(1, 2 * a), 'gaminv')); },
  betapdf: ([x, a0, b0]) => { const a = positive(arg(a0, null, 'a'), 'a'), b = positive(arg(b0, null, 'b'), 'b'); return each(x, t => step(real(t) > 0 && real(t) < 1, div(mul(pow(t, sub(a, ONE)), pow(sub(ONE, t), sub(b, ONE)), gammaE(add(a, b))), mul(gammaE(a), gammaE(b))))); },
  betacdf: ([x, a0, b0]) => { const a = real(positive(arg(a0, null, 'a'), 'a')), b = real(positive(arg(b0, null, 'b'), 'b')); return eachN(x, t => betaI(a, b, t)); },
  betainv: ([p, a0, b0]) => { const a = real(positive(arg(a0, null, 'a'), 'a')), b = real(positive(arg(b0, null, 'b'), 'b')); return eachN(p, q => invert(t => betaI(a, b, t), q, 0, 1, 'betainv')); },
};
const NAMES: Record<string, string> = { norm: 'normalnego', t: 't-Studenta', chi2: 'chi-kwadrat', f: 'F Snedecora', bino: 'dwumianowego', poiss: 'Poissona', exp: 'wykładniczego', unif: 'jednostajnego', gam: 'gamma', beta: 'beta' };
function distributionCard(name: string, v: Value): Linalg {
  const [, family, kind] = name.match(/^(norm|t|chi2|f|bino|poiss|exp|unif|gam|beta)(pdf|cdf|inv)$/)!;
  const title = `${kind === 'pdf' ? (family === 'bino' || family === 'poiss' ? 'Prawdopodobieństwo' : 'Gęstość') : kind === 'cdf' ? 'Dystrybuanta' : 'Kwantyl'} rozkładu ${NAMES[family]}`;
  const note = isApprox(v) && !['inv'].includes(kind) && ['t', 'chi2', 'f', 'gam', 'beta'].includes(family) ? 'Numerycznie: funkcje niekompletne Γ i B (podwójna precyzja).' : kind === 'inv' && family !== 'exp' && family !== 'unif' ? 'Numerycznie; sprawdzone: dystrybuanta w tym punkcie daje p.' : undefined;
  return { cards: [card(title, [['', v]], note)], outputs: [v] };
}

// --- Random numbers: xoshiro128**, its state kept between questions ---

interface Gen { next(): number; state(): number[] }
const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
/** xoshiro128** from its state (four 32-bit words), or from a seed through splitmix32. */
function generator(state: number[] | null, seed?: number): Gen {
  let s = state?.length === 4 ? state.map(v => v >>> 0) : (() => {
    let z = (seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;
    return Array.from({ length: 4 }, () => { z = (z + 0x9e3779b9) >>> 0; let t = z ^ (z >>> 16); t = Math.imul(t, 0x21f0aaad); t ^= t >>> 15; t = Math.imul(t, 0x735a2d97); return (t ^ (t >>> 15)) >>> 0; });
  })();
  if (s.every(v => !v)) s = [1, 2, 3, 4];
  const u32 = () => {
    const r = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0, t = (s[1] << 9) >>> 0;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 11);
    s = s.map(v => v >>> 0);
    return r;
  };
  // 53 random bits: uniform on (0, 1)
  return { next() { let x: number; do x = ((u32() >>> 5) * 67108864 + (u32() >>> 6)) / 9007199254740992; while (x === 0); return x; }, state: () => s.slice() };
}
/** The random numbers of one question: the generator goes on from where the last question left it. */
export class RandomSource {
  used = false;
  private g: Gen;
  constructor(state: number[] | null) { this.g = generator(state); }
  next(): number { this.used = true; return this.g.next(); }
  reseed(seed: number) { this.used = true; this.g = generator(null, seed); }
  get state() { return this.g.state(); }
}
let random: RandomSource | null = null;
/** The engine hands the generator of the question in. */
export function setRandom(src: RandomSource | null) { random = src; }
function shape(args: Value[], from: number, what: string): [number, number] {
  const ints = args.slice(from).map(v => { const e = v.t === 'expr' ? v.e : null; if (!e || !isNum(e) || e.v.d !== 1n || e.v.n < 0n) fail(`${what}: rozmiar to liczby całkowite.`); return Number((e as { v: Q }).v.n); });
  const [n, m] = ints.length === 0 ? [1, 1] : ints.length === 1 ? [ints[0], ints[0]] : [ints[0], ints[1]];
  if (n * m > 100_000) fail(`${what}: najwyżej 100 000 liczb naraz.`);
  return [n, m];
}
const draws = (n: number, m: number, f: () => Expr) => valueOf(Array.from({ length: n }, () => Array.from({ length: m }, f)));
const RANDOM_NOTE = 'Liczby pseudolosowe (generator xoshiro128**); po rng(ziarno) ciąg da się powtórzyć.';

// --- The commands ---

export const STATS: Record<string, Command> = {
  mode: ([v]) => one('Dominanta', perColumn(v, 'mode', xs => {
    const s = sortE(xs);
    let best = s[0], count = 0;
    for (let i = 0; i < s.length;) { let j = i; while (j < s.length && sign(sub(s[j], s[i])) === 0) j++; if (j - i > count) { count = j - i; best = s[i]; } i = j; }
    return best;
  }), 'Najczęstsza wartość; przy remisie najmniejsza (jak w MATLAB-ie).'),
  range: ([v]) => one('Rozstęp', perColumn(v, 'range', xs => { const s = sortE(xs); return sub(s[s.length - 1], s[0]); })),
  prctile: ([v, p]) => {
    const ps = grid(p, 'prctile').flat(), { cols } = columns(v, 'prctile');
    const out = valueOf(cols.length === 1 ? [ps.map(pp => percentile(cols[0], pp))] : ps.map(pp => cols.map(c => percentile(c, pp))));
    return one('Percentyle', isApprox(v) ? approxValue(out) : out, 'Metoda MATLAB-a: posortowane wartości w punktach 100(i − ½)/n, liniowo pomiędzy.');
  },
  quantile: ([v, p]) => {
    const ps = grid(p, 'quantile').flat(), { cols } = columns(v, 'quantile');
    const out = valueOf(cols.length === 1 ? [ps.map(pp => percentile(cols[0], mul(pp, num(100))))] : ps.map(pp => cols.map(c => percentile(c, mul(pp, num(100))))));
    return one('Kwantyle', isApprox(v) ? approxValue(out) : out, 'Metoda MATLAB-a (jak prctile, q od 0 do 1).');
  },
  iqr: ([v]) => one('Rozstęp międzykwartylowy', perColumn(v, 'iqr', xs => sub(percentile(xs, num(75)), percentile(xs, num(25)))), 'Q₃ − Q₁, kwartyle metodą MATLAB-a.'),
  skewness: ([v]) => one('Skośność', perColumn(v, 'skewness', xs => div(moment(xs, 3), pow(moment(xs, 2), num(3, 2)))), 'm₃/m₂^(3/2), wersja obciążona (domyślna w MATLAB-ie).'),
  kurtosis: ([v]) => one('Kurtoza', perColumn(v, 'kurtosis', xs => div(moment(xs, 4), pow(moment(xs, 2), num(2)))), 'm₄/m₂² (rozkład normalny ma 3; to nie jest kurtoza nadwyżkowa).'),
  zscore: ([v]) => {
    const xs = vector(v, 'zscore'), m = meanE(xs), s = sqrt(varE(xs, 0));
    const out = valueOf([xs.map(x => tidy(div(sub(x, m), s)))]);
    return one('Standaryzacja', isApprox(v) ? approxValue(out) : out, '(x − średnia)/odchylenie standardowe próby.');
  },
  variance: (args) => {
    // var(A) of a matrix by columns, var(v, 1) of the population; var(1, 2, 3) of numbers as before
    const [v, w0] = args;
    const matrix = v && (v.t === 'matrix' && v.rows.length > 1 && v.rows[0].length > 1);
    const w = w0?.t === 'expr' && isNum(w0.e) && (w0.e.v.n === 0n || w0.e.v.n === 1n) && w0.e.v.d === 1n ? Number(w0.e.v.n) as 0 | 1 : null;
    if (!(args.length === 1 && matrix) && !(args.length === 2 && w !== null && (v.t === 'list' || v.t === 'matrix'))) return null;
    return one(w ? 'Wariancja populacji' : matrix ? 'Wariancje kolumn (próby)' : 'Wariancja próby', perColumn(v, 'var', xs => varE(xs, w ?? 0)), w ? 'Mianownik n.' : 'Mianownik n − 1.');
  },
  stdev: (args) => {
    const [v, w0] = args;
    const matrix = v && (v.t === 'matrix' && v.rows.length > 1 && v.rows[0].length > 1);
    const w = w0?.t === 'expr' && isNum(w0.e) && (w0.e.v.n === 0n || w0.e.v.n === 1n) && w0.e.v.d === 1n ? Number(w0.e.v.n) as 0 | 1 : null;
    if (!(args.length === 1 && matrix) && !(args.length === 2 && w !== null && (v.t === 'list' || v.t === 'matrix'))) return null;
    return one(w ? 'Odchylenie standardowe populacji' : matrix ? 'Odchylenia standardowe kolumn' : 'Odchylenie standardowe próby', perColumn(v, 'std', xs => sqrt(varE(xs, w ?? 0))), w ? 'Mianownik n.' : 'Mianownik n − 1.');
  },
  cov: ([a, b]) => {
    const cols = b ? [vector(a, 'cov'), vector(b, 'cov')] : columns(a, 'cov').cols;
    if (cols.some(c => c.length !== cols[0].length)) fail('cov: dane mają różne długości.');
    if (cols[0].length < 2) fail('cov: potrzeba co najmniej dwóch obserwacji.');
    const means = cols.map(meanE), n = cols[0].length;
    const C = cols.map((x, i) => cols.map((y, j) => tidy(div(add(...x.map((xi, k) => mul(sub(xi, means[i]), sub(y[k], means[j])))), num(n - 1)))));
    const out = C.length === 1 ? ex(C[0][0]) : ({ t: 'matrix', rows: C } as Value);
    return one(C.length === 1 ? 'Wariancja' : 'Macierz kowariancji', isApprox(a) || (!!b && isApprox(b)) ? approxValue(out) : out, 'Kowariancje próby (mianownik n − 1); na przekątnej wariancje.');
  },
  corrcoef: ([a, b]) => {
    const cols = b ? [vector(a, 'corrcoef'), vector(b, 'corrcoef')] : columns(a, 'corrcoef').cols;
    if (cols.length < 2) fail('corrcoef: podaj dwa wektory albo macierz o kilku kolumnach.');
    if (cols.some(c => c.length !== cols[0].length)) fail('corrcoef: dane mają różne długości.');
    const means = cols.map(meanE);
    const S = cols.map((x, i) => cols.map((y, j) => add(...x.map((xi, k) => mul(sub(xi, means[i]), sub(y[k], means[j]))))));
    if (S.some((r, i) => sign(r[i]) === 0)) fail('corrcoef: jedna ze zmiennych jest stała, korelacja nie istnieje.');
    const R = S.map((r, i) => r.map((v, j) => (i === j ? ONE : tidy(div(v, sqrt(mul(S[i][i], S[j][j])))))));
    const ap = isApprox(a) || (!!b && isApprox(b));
    const out: Value = { t: 'matrix', rows: R };
    const plot = cols.length === 2 ? dataPlot([{ xs: cols[0].map(real), ys: cols[1].map(real), label: 'dane', style: 'dots' }]) : null;
    const r = R[0][1], rv = real(r);
    return {
      cards: [card('Współczynnik korelacji Pearsona', [['r', ap ? approxValue(ex(r)) : ex(r)]], `${Math.abs(rv) > 0.9 ? 'Bardzo silna' : Math.abs(rv) > 0.7 ? 'Silna' : Math.abs(rv) > 0.4 ? 'Umiarkowana' : Math.abs(rv) > 0.2 ? 'Słaba' : 'Bardzo słaba lub brak'} zależność liniowa${rv > 0 ? ', dodatnia' : rv < 0 ? ', ujemna' : ''}.`, plot), card('Macierz korelacji', [['R', ap ? approxValue(out) : out]])],
      outputs: [ap ? approxValue(out) : out],
    };
  },
  histcounts: ([v, n0], nout) => {
    const xs = vector(v, 'histcounts').map(real), n = n0 ? Number((n0 as { e: Expr }).e && real((n0 as { e: Expr }).e)) : Math.ceil(Math.log2(xs.length) + 1);
    if (!Number.isInteger(n) || n < 1) fail('histcounts: liczba przedziałów to liczba całkowita dodatnia.');
    const lo = Math.min(...xs), hi = Math.max(...xs), w = (hi - lo) / n || 1, start = hi > lo ? lo : lo - 0.5;
    const counts = Array<number>(n).fill(0);
    for (const t of xs) counts[Math.min(n - 1, Math.floor((t - start) / w))]++;
    const cv = valueOf([counts.map(c => num(c))]), ev = approxValue(valueOf([Array.from({ length: n + 1 }, (_, i) => dbl(start + i * w))]));
    return { cards: [card('Liczności w przedziałach', [['liczności', cv], ['krawędzie', ev]])], outputs: nout >= 2 ? [cv, ev] : [cv] };
  },
  fitlm: ([X0, y0]) => fitlm(X0, y0),
  rand: (args) => {
    if (!random) fail('Generator liczb losowych jest niedostępny.');
    const [n, m] = shape(args, 0, 'rand');
    const v = approxValue(draws(n, m, () => dbl(random!.next())));
    return { cards: [card('Liczby losowe z rozkładu jednostajnego na (0; 1)', [['', v]], RANDOM_NOTE)], outputs: [v] };
  },
  randn: (args) => {
    if (!random) fail('Generator liczb losowych jest niedostępny.');
    const [n, m] = shape(args, 0, 'randn');
    // Marsaglia's polar method
    let spare: number | null = null;
    const normal = () => { if (spare !== null) { const s = spare; spare = null; return s; } for (;;) { const u = 2 * random!.next() - 1, w = 2 * random!.next() - 1, s = u * u + w * w; if (s > 0 && s < 1) { const f = Math.sqrt(-2 * Math.log(s) / s); spare = w * f; return u * f; } } };
    const v = approxValue(draws(n, m, () => dbl(normal())));
    return { cards: [card('Liczby losowe z rozkładu normalnego N(0; 1)', [['', v]], RANDOM_NOTE)], outputs: [v] };
  },
  randi: (args) => {
    if (!random) fail('Generator liczb losowych jest niedostępny.');
    const lim = grid(args[0], 'randi').flat().map(e => { if (!isNum(e) || e.v.d !== 1n) fail('randi: granice to liczby całkowite.'); return Number((e as { v: Q }).v.n); });
    const [a, b] = lim.length === 1 ? [1, lim[0]] : [lim[0], lim[1]];
    if (b < a) fail('randi: górna granica mniejsza od dolnej.');
    const [n, m] = shape(args, 1, 'randi');
    const v = draws(n, m, () => num(a + Math.floor(random!.next() * (b - a + 1))));
    return { cards: [card(`Losowe liczby całkowite od ${a} do ${b}`, [['', v]], RANDOM_NOTE)], outputs: [v] };
  },
  rng: ([s]) => {
    if (!random) fail('Generator liczb losowych jest niedostępny.');
    const seed = s?.t === 'str' ? (s.s === 'shuffle' ? Math.floor(Math.random() * 2 ** 32) : s.s === 'default' ? 0 : fail("rng: ziarno to liczba całkowita, 'default' albo 'shuffle'.")) : (() => { const e = s?.t === 'expr' ? s.e : null; if (!e || !isNum(e) || e.v.d !== 1n || e.v.n < 0n) return fail('rng: ziarno to liczba całkowita nieujemna.'); return Number(e.v.n % (1n << 32n)); })();
    random!.reseed(seed);
    return { cards: [card('Generator liczb losowych', [['', text(s?.t === 'str' && s.s === 'shuffle' ? 'Losowe ziarno' : `Ziarno: ${seed}`)]], 'Kolejne rand, randn i randi dadzą ten sam ciąg po tym samym ziarnie.')], outputs: [] };
  },
};
for (const name of Object.keys(DISTRIBUTIONS)) STATS[name] = args => distributionCard(name, DISTRIBUTIONS[name](args));

/** Ordinary least squares with an intercept: coefficients (exact for exact data), their errors, t and p, R², F. */
function fitlm(X0: Value, y0: Value): Linalg {
  const y = vector(y0, 'fitlm'), m = grid(X0, 'fitlm');
  const Xc = m.length === 1 || m[0].length === 1 ? [m.flat()] : m[0].map((_, j) => m.map(r => r[j]));
  const n = y.length, p = Xc.length + 1;
  if (Xc.some(c => c.length !== n)) fail('fitlm: X i y mają różną liczbę obserwacji.');
  if (n <= p) fail(`fitlm: ${p} współczynniki potrzebują więcej niż ${p} obserwacji.`);
  const X = y.map((_, i) => [ONE, ...Xc.map(c => c[i])]);
  const exact = !isApprox(X0) && !isApprox(y0);
  let b: Expr[];
  try { b = LA.leftSolve(X, y.map(v => [v])).map(r => tidy(r[0])); } catch { return fail('fitlm: zmienne objaśniające są liniowo zależne.'); }
  const fitted = X.map(r => add(...r.map((x, j) => mul(x, b[j]))));
  const sse = real(add(...y.map((v, i) => pow(sub(v, fitted[i]), num(2))))), ybar = real(meanE(y));
  const sst = y.reduce((s, v) => s + (real(v) - ybar) ** 2, 0);
  const mse = sse / (n - p), XtXi = LA.inverse(LA.matMulE(LA.transpose(X), X));
  const se = XtXi.map((r, j) => Math.sqrt(mse * real(r[j])));
  const ts = b.map((c, j) => real(c) / se[j]), ps = ts.map(t => (Number.isFinite(t) ? 2 * (1 - tcdfN(Math.abs(t), n - p)) : 0));
  const r2 = sst > 0 ? 1 - sse / sst : 1, adj = 1 - (1 - r2) * (n - 1) / (n - p);
  const F = ((sst - sse) / (p - 1)) / mse, pF = Number.isFinite(F) ? 1 - betaI((p - 1) / 2, (n - p) / 2, (p - 1) * F / ((p - 1) * F + (n - p))) : 0;
  const short = (e: Expr) => toText(e).length <= 16;
  // a coefficient with a finite decimal expansion (data written with decimals) reads as a decimal: −3682,37, not −368237/100
  const decimal = (c: Expr): string | null => {
    if (!isNum(c)) return null;
    for (let k = 0; k <= 12; k++) {
      const p10 = 10n ** BigInt(k);
      if (p10 % c.v.d) continue;
      const n = c.v.n * (p10 / c.v.d), neg = n < 0n, digits = (neg ? -n : n).toString().padStart(k + 1, '0');
      return `${neg ? '−' : ''}${k ? `${digits.slice(0, -k)},${digits.slice(-k)}` : digits}`;
    }
    return null;
  };
  const coef = (c: Expr) => (exact && isNum(c) ? decimal(c) ?? (short(c) ? toText(c) : fmt(real(c))) : fmt(real(c)));
  const names = ['b₀', ...Xc.map((_, j) => (Xc.length === 1 ? 'b₁' : `b${String(j + 1).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]).join('')}`))];
  const model = `y = ${coef(b[0])}${b.slice(1).map((c, j) => ` ${real(c) < 0 ? '−' : '+'} ${coef(real(c) < 0 ? neg(c) : c)}·${Xc.length === 1 ? 'x' : `x${j + 1}`}`).join('')}`;
  const pv = (x: number) => (x < 1e-4 ? tiny(x) : fmt(x));
  const rows: [string, Value][] = names.map((nm, j) => [nm, text(`${coef(b[j])}   SE ≈ ${fmt(se[j])}   t ≈ ${fmt(ts[j])}   p ≈ ${pv(ps[j])}`)]);
  const plot = Xc.length === 1 ? dataPlot([{ xs: Xc[0].map(real), ys: y.map(real), label: 'dane', style: 'dots' }], { curve: { f: t => real(b[0]) + real(b[1]) * t, label: model } }) : null;
  const bv = exact ? ({ t: 'matrix', rows: b.map(c => [c]) } as Value) : approxValue({ t: 'matrix', rows: b.map(c => [c]) });
  return {
    cards: [
      card('Model regresji liniowej', [['', text(model)]], `${n} obserwacji, ${p} współczynniki. R² ≈ ${fmt(r2)}, skorygowany R² ≈ ${fmt(adj)}, błąd standardowy reszt ≈ ${fmt(Math.sqrt(mse))}.`, plot),
      card('Współczynniki', rows, `Test t: czy współczynnik różni się od zera (p < 0,05 zwykle uznaje się za istotne). Test F całego modelu: F ≈ ${fmt(F)}, p ≈ ${pv(pF)}.${exact ? ' Współczynniki dokładne (najmniejsze kwadraty nad ℚ).' : ''}`),
    ],
    outputs: [bv],
  };
}
