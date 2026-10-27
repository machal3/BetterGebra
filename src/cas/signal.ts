/**
 * MATLAB's signals: fft and ifft (exact for short signals whose roots of unity have closed forms, else radix-2 or
 * Bluestein in doubles, checked by transforming back), fftshift, ifftshift, filter (the difference equation, exact
 * for exact data) and periodogram (the power spectral density, one-sided for real signals, as MATLAB's).
 */
import { Expr, I, PI, ZERO, add, div, fn, isConstant, mul, num, sub } from './expr';
import { Value, approxValue, isApprox } from './evaluate';
import { grid, valueOf } from './arrays';
import { Card, Linalg, tiny } from './linalg';
import { approx } from './numeric';
import { dataPlot, fmt } from './plot';
import { fail, qFromDouble } from './q';
import { simplify } from './simplify';

type Command = (args: Value[], nout: number) => Linalg | null;
const tidy = (e: Expr) => { try { return simplify(e); } catch { return e; } };
const card = (title: string, rows: [string, Value][], note?: string, plot?: ReturnType<typeof dataPlot>): Card => ({ title, rows, note, plot: plot ?? undefined });
const MAX = 1 << 20;

/** A signal's samples, and whether it was a column (the result keeps the shape). */
function samples(v: Value | undefined, what: string): { xs: Expr[]; column: boolean } {
  if (!v) return fail(`${what}: brak argumentu.`);
  const m = grid(v, what);
  if (m.length > 1 && m[0].length > 1) fail(`${what}: oczekuję wektora (sygnału), a nie macierzy.`);
  if (m.flat().some(e => !isConstant(e))) fail(`${what}: sygnał to liczby.`);
  return { xs: m.flat(), column: m.length > 1 };
}
const shaped = (es: Expr[], column: boolean): Value => (column ? { t: 'matrix', rows: es.map(e => [e]) } : valueOf([es]));
const readable = (e: Expr): boolean => e.k !== 'f' && (e.k === 'n' || e.k === 's' || (e.k === '^' ? readable(e.b) && readable(e.e) : e.k === '+' || e.k === '*' ? e.t.every(readable) : false));

// --- The FFT in doubles ---

type Cx = { re: number[]; im: number[] };
/** In-place iterative radix-2 FFT (n a power of 2); sign −1 forward, +1 inverse (unscaled). */
function radix2(re: number[], im: number[], sign: number): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = sign * 2 * Math.PI / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}
/** The DFT of any length: radix-2 when it is a power of 2, else Bluestein's chirp-z through a power-of-2 convolution. */
function dft({ re, im }: Cx, sign: number): Cx {
  const n = re.length;
  if (!(n & (n - 1))) { const r = re.slice(), i = im.slice(); radix2(r, i, sign); return { re: r, im: i }; }
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;
  // chirp w_k = e^(sign·iπk²/n), k² taken mod 2n so the angle stays exact
  const cr = Array.from({ length: n }, (_, k) => Math.cos(sign * Math.PI * ((k * k) % (2 * n)) / n));
  const ci = Array.from({ length: n }, (_, k) => Math.sin(sign * Math.PI * ((k * k) % (2 * n)) / n));
  const ar = Array<number>(m).fill(0), ai = Array<number>(m).fill(0), br = Array<number>(m).fill(0), bi = Array<number>(m).fill(0);
  for (let k = 0; k < n; k++) { ar[k] = re[k] * cr[k] - im[k] * ci[k]; ai[k] = re[k] * ci[k] + im[k] * cr[k]; }
  br[0] = cr[0]; bi[0] = -ci[0];
  for (let k = 1; k < n; k++) { br[k] = br[m - k] = cr[k]; bi[k] = bi[m - k] = -ci[k]; }
  radix2(ar, ai, -1); radix2(br, bi, -1);
  for (let k = 0; k < m; k++) { const r = ar[k] * br[k] - ai[k] * bi[k], i = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; ai[k] = i; }
  radix2(ar, ai, 1);
  const out: Cx = { re: [], im: [] };
  for (let k = 0; k < n; k++) {
    const r = ar[k] / m, i = ai[k] / m;
    out.re.push(r * cr[k] - i * ci[k]); out.im.push(r * ci[k] + i * cr[k]);
  }
  return out;
}
function toCx(xs: Expr[]): Cx {
  const out: Cx = { re: [], im: [] };
  for (const e of xs) { const z = approx(e); if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) fail('Sygnał ma wartości nieskończone.'); out.re.push(z.re); out.im.push(z.im); }
  return out;
}
const dbl = (x: number) => num(qFromDouble(x));
const cxExpr = (re: number, im: number) => (im ? add(dbl(re), mul(I, dbl(im))) : dbl(re));
const scale = (z: Cx, s: number): Cx => ({ re: z.re.map(v => v * s), im: z.im.map(v => v * s) });
const relDiff = (a: Cx, b: Cx) => { let d = 0, s = 0; a.re.forEach((v, k) => { d += (v - b.re[k]) ** 2 + (a.im[k] - b.im[k]) ** 2; s += v * v + a.im[k] ** 2; }); return Math.sqrt(d / (s || 1)); };

/** X(k) = Σ x(j)·e^(∓2πijk/n): exactly for a short exact signal when every value reads well, else null. */
function exactDft(xs: Expr[], inverse: boolean): Expr[] | null {
  const n = xs.length;
  if (n > 16) return null;
  const out: Expr[] = [];
  for (let k = 0; k < n; k++) {
    const terms = xs.map((x, j) => {
      const a = mul(num(2 * ((j * k) % n), n), PI);
      return mul(x, add(fn('cos', a), mul(I, inverse ? fn('sin', a) : mul(num(-1), fn('sin', a)))));
    });
    const v = tidy(inverse ? div(add(...terms), num(n)) : add(...terms));
    if (!readable(v)) return null;
    out.push(v);
  }
  return out;
}

/** fft or ifft: exact, or in doubles and checked by the opposite transform. */
function transform(v: Value, n0: Value | undefined, inverse: boolean): { values: Value; exact: boolean; note: string; spectrum: number[] } {
  const what = inverse ? 'ifft' : 'fft';
  let { xs, column } = samples(v, what);
  if (n0) {
    // fft(x, n): cut or padded with zeros to n points
    const e = n0.t === 'expr' ? approx(n0.e).re : NaN;
    if (!Number.isInteger(e) || e < 1) fail(`${what}(x, n): n to liczba całkowita dodatnia.`);
    xs = e <= xs.length ? xs.slice(0, e) : [...xs, ...Array<Expr>(e - xs.length).fill(ZERO)];
  }
  if (!xs.length) fail(`${what}: sygnał jest pusty.`);
  if (xs.length > MAX) fail(`${what}: najwyżej ${MAX} próbek.`);
  const exact = !isApprox(v) ? exactDft(xs, inverse) : null;
  const z = toCx(xs);
  const Z = inverse ? scale(dft(z, 1), 1 / z.re.length) : dft(z, -1);
  const back = inverse ? dft(Z, -1) : scale(dft(Z, 1), 1 / Z.re.length);
  const err = relDiff(z, back);
  if (err > 1e-10) fail(`${what}: przekształcenie nie przeszło sprawdzenia (odwrotne daje błąd ≈ ${tiny(err)}).`);
  const spectrum = Z.re.map((r, k) => Math.hypot(r, Z.im[k]));
  if (exact) {
    // the exact values agree with the numbers before they are shown
    if (!exact.every((e, k) => { const w = approx(e); return Math.hypot(w.re - Z.re[k], w.im - Z.im[k]) <= 1e-9 * (1 + spectrum[k]); })) fail(`${what}: wyniki dokładny i numeryczny się różnią.`);
    return { values: shaped(exact, column), exact: true, note: `Dokładnie: pierwiastki z jedności mają tu postać zamkniętą (${xs.length} próbek).`, spectrum };
  }
  const n = xs.length, algo = !(n & (n - 1)) ? 'radix-2' : 'Bluestein (chirp-z)';
  // parts below the rounding error of the whole transform are 0 within what the numbers can tell
  const floor = 16 * n * 2 ** -52 * Math.max(...spectrum, ...z.re.map(Math.abs), ...z.im.map(Math.abs));
  const clean = (x: number) => (Math.abs(x) <= floor ? 0 : x);
  const cleared = Z.re.some((r, k) => (r && !clean(r)) || (Z.im[k] && !clean(Z.im[k])));
  return {
    values: approxValue(shaped(Z.re.map((r, k) => cxExpr(clean(r), clean(Z.im[k]))), column)), exact: false, spectrum,
    note: `Numerycznie (${algo}); sprawdzone przekształceniem odwrotnym: błąd ≈ ${tiny(err)}.${cleared ? ` Części mniejsze niż błąd zaokrągleń (≈ ${tiny(floor)}) pokazuję jako 0.` : ''}`,
  };
}

export const SIGNAL: Record<string, Command> = {
  fft: ([v, n0]) => {
    const r = transform(v, n0, false), N = r.spectrum.length;
    const ks = r.spectrum.map((_, k) => k);
    const plot = N > 1 ? dataPlot([{ xs: ks, ys: r.spectrum, label: '|X(k)|', style: 'stems' }]) : null;
    const peak = r.spectrum.slice(1, Math.floor(N / 2) + 1).reduce((b, v, k, a) => (v > a[b] ? k : b), 0) + 1;
    const hint = N > 2 ? ` Największy prążek (poza k = 0) przy k = ${peak}, |X| ≈ ${fmt(r.spectrum[peak])}; dla sygnału rzeczywistego widmo jest symetryczne: |X(k)| = |X(N − k)|.` : '';
    return { cards: [card('Dyskretna transformata Fouriera', [['X', r.values]], `${r.note}${hint} Indeks k liczony od 0 (w MATLAB-ie X(k + 1)).`, plot)], outputs: [r.values] };
  },
  ifft: ([v, n0]) => {
    const r = transform(v, n0, true);
    return { cards: [card('Odwrotna transformata Fouriera', [['x', r.values]], r.note)], outputs: [r.values] };
  },
  fftshift: ([v]) => shift(v, false),
  ifftshift: ([v]) => shift(v, true),
  filter: ([b0, a0, x0]) => {
    const b = samples(b0, 'filter').xs, a = samples(a0, 'filter').xs, { xs, column } = samples(x0, 'filter');
    if (approx(a[0]).re === 0 && approx(a[0]).im === 0) fail('filter: pierwszy współczynnik a nie może być zerem.');
    const ap = isApprox(b0) || isApprox(a0) || isApprox(x0);
    // a(1)y(n) = Σ b(k)x(n−k) − Σ a(k)y(n−k), as direct form II transposed; exact arithmetic for exact data
    const N = Math.max(a.length, b.length), A = [...a, ...Array<Expr>(N - a.length).fill(ZERO)].map(c => div(c, a[0])), B = [...b, ...Array<Expr>(N - b.length).fill(ZERO)].map(c => div(c, a[0]));
    let z = Array<Expr>(N).fill(ZERO);
    const y: Expr[] = [];
    for (const x of xs) {
      const out = tidy(add(mul(B[0], x), z[0]));
      const next = Array<Expr>(N).fill(ZERO);
      for (let k = 1; k < N; k++) next[k - 1] = tidy(sub(add(mul(B[k], x), z[k]), mul(A[k], out)));
      z = next;
      y.push(out);
    }
    const value = ap ? approxValue(shaped(y, column)) : shaped(y, column);
    const t = xs.map((_, k) => k), plot = dataPlot([{ xs: t, ys: xs.map(e => approx(e).re), label: 'wejście', style: 'stems' }, { xs: t, ys: y.map(e => approx(e).re), label: 'wyjście', style: 'stems' }]);
    return { cards: [card('Sygnał po filtrze', [['y', value]], `y(n) = Σ b(k)·x(n − k) − Σ a(k)·y(n − k), a(1) = 1 po normalizacji (jak filter w MATLAB-ie); ${ap ? 'z liczb przybliżonych' : 'dokładnie'}.`, plot)], outputs: [value] };
  },
  periodogram: ([v, fs0], nout) => {
    const { xs } = samples(v, 'periodogram'), n = xs.length;
    if (n < 2) fail('periodogram: potrzeba co najmniej dwóch próbek.');
    const z = toCx(xs), real = z.im.every(x => x === 0);
    const fs = fs0 ? approx((fs0 as { e: Expr }).e).re : null;
    if (fs0 && !(fs! > 0)) fail('periodogram: częstotliwość próbkowania musi być dodatnia.');
    const Z = dft(z, -1), P = Z.re.map((r, k) => (r * r + Z.im[k] ** 2) / (n * (fs ?? 2 * Math.PI)));
    // one-sided for a real signal: frequencies up to the Nyquist one, the others doubled
    const top = real ? Math.floor(n / 2) : n - 1;
    const pxx = P.slice(0, top + 1).map((p, k) => (real && k > 0 && !(n % 2 === 0 && k === n / 2) ? 2 * p : p));
    const f = pxx.map((_, k) => (fs ? k * fs / n : 2 * Math.PI * k / n));
    const peak = pxx.reduce((b, p, k) => (p > pxx[b] ? k : b), 0);
    const plot = dataPlot([{ xs: f, ys: pxx, label: 'P(f)', style: 'line' }]);
    const unit = fs ? 'Hz' : 'rad/próbkę';
    const pv = approxValue(valueOf([pxx.map(dbl)])), fv = approxValue(valueOf([f.map(dbl)]));
    return {
      cards: [card('Periodogram (gęstość widmowa mocy)', [['P', pv]], `${real ? 'Jednostronny (sygnał rzeczywisty)' : 'Dwustronny'}, ${pxx.length} częstotliwości od 0 do ${fmt(f[f.length - 1])} ${unit}. Najsilniejsza składowa: ${fmt(f[peak])} ${unit}.`, plot)],
      outputs: nout >= 2 ? [pv, fv] : [pv],
    };
  },
};

/** fftshift: the zero frequency moved to the middle (ifftshift undoes it, also for an odd length). */
function shift(v: Value, back: boolean): Linalg {
  const { xs, column } = samples(v, back ? 'ifftshift' : 'fftshift'), n = xs.length;
  const k = back ? Math.ceil(n / 2) : Math.floor(n / 2);
  const out = xs.map((_, i) => xs[(i - k + n * 2) % n]);
  const value = isApprox(v) ? approxValue(shaped(out, column)) : shaped(out, column);
  return { cards: [card(back ? 'Przesunięcie odwrotne do fftshift' : 'Widmo z zerową częstotliwością pośrodku', [['', value]])], outputs: [value] };
}
