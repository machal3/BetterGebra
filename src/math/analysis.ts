import type { Complex } from './ast';
import type { RealFunction } from './real';
import type { ComplexFunction } from './complex';
import { div, sub } from './complex';

const finite = Number.isFinite;
const GOLDEN = 0.618034;

/** Rounder values near x worth trying: 0, simple fractions, then x cut to fewer decimals. */
const roundCandidates = (x: number) =>
  [0, ...[1, 2, 3, 4, 6, 8, 12].map(d => Math.round(x * d) / d), ...Array.from({ length: 12 }, (_, k) => Number(x.toFixed(k + 1)))];

/** 1.9999999999999998 → 2 when the rounder value scores at least as well (score = |f| for a root). */
function snap(score: (x: number) => number, x: number, tol: number): number {
  return roundCandidates(x).find(c => Math.abs(c - x) <= tol && score(c) <= score(x)) ?? x;
}

/** Minimises g on [a; b] by golden-section search. */
function goldenMin(g: (x: number) => number, a: number, b: number, scale: number): number {
  for (let k = 0; k < 200 && b - a > 1e-15 * Math.max(1, Math.abs(scale)); k++) {
    const c = b - (b - a) * GOLDEN, d = a + (b - a) * GOLDEN;
    if (g(c) < g(d)) b = d; else a = c;
  }
  return (a + b) / 2;
}

export function roots(fn: RealFunction, min: number, max: number): number[] {
  const N = 4000, step = (max - min) / N, found: number[] = [], abs = Math.abs;
  const add = (x: number) => {
    x = snap(t => abs(fn(t)), x, step * 1e-3);
    if (!found.some(r => abs(r - x) < step / 2)) found.push(x);
  };
  const ys = Array.from({ length: N + 1 }, (_, i) => fn(min + i * step));
  for (let i = 0; i <= N && found.length < 50; i++) {
    const x = min + i * step, y = ys[i], prev = ys[i - 1], next = ys[i + 1];
    // A run of zeros (floor x on [0; 1)) reports only its start.
    if (y === 0) { if (prev !== 0) add(x); continue; }
    if (i && prev !== 0 && finite(prev) && finite(y) && Math.sign(prev) !== Math.sign(y)) {
      let a = x - step, b = x, fa = prev;
      for (let m = (a + b) / 2; m > a && m < b; m = (a + b) / 2) {
        const fm = fn(m);
        if (fm === 0) { a = b = m; break; }
        if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else b = m;
      }
      // Poles (1/x, tan x) change sign too, but there |f| grows while bisecting instead of shrinking.
      // A sample can land ~1e-16 from the root (sin(x°) at 180), so float-noise |f(r)| still counts.
      const r = abs(fn(a)) < abs(fn(b)) ? a : b, fr = abs(fn(r));
      if (fr <= Math.min(abs(prev), abs(y)) || fr <= 1e-9 * Math.max(abs(prev), abs(y))) add(r);
    }
    // Touching roots (x², sin²x) never change sign: a local minimum of |f| that reaches ~0.
    if (i && i < N && abs(y) < abs(prev) && abs(y) <= abs(next) && Math.sign(prev) === Math.sign(y) && Math.sign(next) === Math.sign(y)) {
      const m = goldenMin(t => abs(fn(t)), x - step, x + step, x);
      // ponytail: fixed relative tolerance, so x² + 1e-13 counts as touching the axis; fine at graphing precision.
      if (abs(fn(m)) < 1e-12 * Math.max(1, abs(prev), abs(next))) add(m);
    }
  }
  return found.sort((a, b) => a - b);
}

export interface Point { x: number; y: number }

/** Local minima and maxima on [min; max]: a sample above (below) both neighbours, refined by golden section. */
export function extrema(fn: RealFunction, min: number, max: number): Point[] {
  const N = 2000, step = (max - min) / N, found: Point[] = [];
  const ys = Array.from({ length: N + 1 }, (_, i) => fn(min + i * step));
  for (let i = 1; i < N && found.length < 50; i++) {
    const p = ys[i - 1], y = ys[i], n = ys[i + 1];
    const s = y > p && y > n ? -1 : y < p && y < n ? 1 : 0;
    if (!s || !finite(p) || !finite(n)) continue;
    const g = (t: number) => s * fn(t); // minimised
    const a = min + (i - 1) * step;
    const x = snap(g, goldenMin(g, a, min + (i + 1) * step, a), step * 1e-3), v = fn(x);
    // ponytail: a pole (1/x²) also peaks between samples; refining a smooth peak gains less than the samples' drop.
    if (!finite(v) || Math.abs(v - y) > Math.abs(y - p) + Math.abs(y - n)) continue;
    if (!found.some(e => Math.abs(e.x - x) < step / 2)) found.push({ x, y: v });
  }
  return found;
}

export function intersections(f: RealFunction, g: RealFunction, min: number, max: number): Point[] {
  return roots(x => f(x) - g(x), min, max).map(x => ({ x, y: f(x) }));
}

/** v when it is a simple multiple of 1 or π, or a short decimal; null otherwise. */
function nice(v: number): number | null {
  for (const unit of [1, Math.PI]) for (let d = 1; d <= 12; d++) {
    const c = Math.round(v / unit * d) * unit / d;
    if (Math.abs(c - v) < 1e-9 * Math.max(1, Math.abs(v))) return c + 0; // + 0 turns −0 into 0
  }
  // Short decimals (0.001, 2.75): a bisected jump of floor(1000x) lands an ulp below 0.001.
  for (let k = 1; k <= 15; k++) {
    const c = Number(v.toPrecision(k));
    if (Math.abs(c - v) <= 1e-12 * Math.abs(v)) return c;
  }
  return null;
}

/** One-sided limit at c, or NaN when it doesn't exist or diverges. tol = what counts as equal in y. */
function limit(fn: RealFunction, c: number, dir: 1 | -1, tol: number): number {
  const h = 1e-9 * Math.max(1, Math.abs(c)), near = fn(c + dir * h), far = fn(c + dir * h * 1e3);
  return finite(near) && finite(far) && Math.abs(near - far) < tol ? near : NaN;
}

export interface Dot { x: number; y: number; closed: boolean }
export interface Endpoint {
  x: number;
  /** Where the piece on each side ends: f(c), a limit, ±Infinity, or NaN when the graph doesn't continue there. */
  left: number;
  right: number;
  dots: Dot[];
}

/**
 * A piece of the graph ends somewhere in (a; b): a domain edge or a jump. Pin it down and return its dots:
 * closed = the value f(c) itself, open = a one-sided limit the graph approaches but doesn't reach.
 */
export function endpoint(fn: RealFunction, a: number, b: number, tol: number): Endpoint {
  // Keep the half with more variation: ≈ the jump at a jump, huge at a pole (even −1/x², whose endpoint values
  // hide it), shrinking to 0 where f is continuous.
  const variation = (u: number, v: number) => {
    const ys = [fn(u), fn((u + v) / 2), fn(v)], ok = ys.filter(finite).length;
    return ok === 0 ? 0 : ok < 3 ? Infinity : Math.abs(ys[0] - ys[1]) + Math.abs(ys[1] - ys[2]);
  };
  for (let m = (a + b) / 2; m > a && m < b; m = (a + b) / 2) if (variation(a, m) >= variation(m, b)) b = m; else a = m;
  const c = nice(a) ?? nice(b) ?? (finite(fn(a)) ? a : b), fc = fn(c), dots: Dot[] = [];
  // Close enough that √-type ends (|f(c±h) − f(c)| ~ √h) are within tol: h ≤ tol²/4.
  const h = Math.max(Math.min(1e-9 * Math.max(1, Math.abs(c)), tol * tol / 4), 4e-16 * Math.abs(c), 1e-300);
  const side = (dir: 1 | -1) => {
    const near = fn(c + dir * h), mid = fn(c + dir * h * 1e3), far = fn(c + dir * h * 1e6);
    if (!finite(near)) return NaN;
    if (finite(fc) && Math.abs(near - fc) < tol) return fc;
    if (finite(mid) && Math.abs(near - mid) < tol) { dots.push({ x: c, y: near, closed: false }); return near; }
    // ponytail: "|f| keeps growing over 3 scales" = divergence; a wild oscillation (sin(1/x)) could fool it.
    if (finite(far) && Math.sign(near) === Math.sign(far) && Math.abs(near) > Math.abs(mid) && Math.abs(mid) > Math.abs(far) && Math.abs(near) > 2 * Math.abs(far)) {
      return near > 0 ? Infinity : -Infinity;
    }
    return near;
  };
  const left = side(-1), right = side(1);
  // No dot when both sides reach f(c) (continuous, just steep), nor when neither does and one diverges: then
  // f(c) is a float artefact like tan(π/2) = 1.6e16. sgn(0) = 0 keeps its dot (finite limits).
  const reached = left === fc || right === fc, diverges = Math.abs(left) === Infinity || Math.abs(right) === Infinity;
  if (finite(fc) && !(left === fc && right === fc) && (reached || !diverges)) dots.unshift({ x: c, y: fc, closed: true });
  return { x: c, left, right, dots };
}

/**
 * Removable gaps the sampler can't see (sin(x)/x, (x²−1)/(x−1)): undefined at one point, same limit both sides.
 * ponytail: only checks multiples of 1/4 and π/4 (skipped when > 1000 are in view); add candidates if others matter.
 */
export function holes(fn: RealFunction, min: number, max: number, tol: number): Dot[] {
  const out: Dot[] = [];
  for (const s of [1, 0.5, 0.25, Math.PI / 4]) {
    if ((max - min) / s > 1000) continue;
    for (let k = Math.ceil(min / s); k * s <= max; k++) {
      const c = k * s;
      if (finite(fn(c)) || out.some(p => Math.abs(p.x - c) < 1e-9)) continue;
      const l = limit(fn, c, -1, tol), r = limit(fn, c, 1, tol);
      if (finite(l) && finite(r) && Math.abs(l - r) < tol) out.push({ x: c, y: (l + r) / 2, closed: false });
    }
  }
  return out;
}

// --- Complex zeros ---

const size = (z: Complex) => Math.hypot(z[0], z[1]);

function newton(f: ComplexFunction, z: Complex): Complex | null {
  for (let k = 0; k < 100; k++) {
    const w = f(z), h = 1e-7 * Math.max(1, size(z));
    if (w[0] === 0 && w[1] === 0) return z;
    const step = div(w, div(sub(f([z[0] + h, z[1]]), w), [h, 0]));
    if (!finite(step[0]) || !finite(step[1])) return null;
    z = sub(z, step);
    if (size(step) <= 1e-15 * Math.max(1, size(z))) break;
  }
  return z;
}

/** Like snap(): 1,9999999 + 3,0000001i → 2 + 3i, and a double zero Newton only gets to ~1e-9 → 0. */
function polish(f: ComplexFunction, z: Complex): Complex {
  const tol = 1e-6 * Math.max(1, size(z)), score = (w: Complex) => size(f(w));
  for (const k of [0, 1] as const) {
    const best = score(z), at = (c: number): Complex => k ? [z[0], c] : [c, z[1]];
    const c = roundCandidates(z[k]).find(c => Math.abs(c - z[k]) <= tol && score(at(c)) <= best);
    if (c !== undefined) z = at(c);
  }
  return z;
}

/**
 * Zeros of f in [x0; x1] × [y0; y1]. The argument of f turns once around each zero and back around each pole
 * (argument principle): count the turns around every cell of a cols × rows grid, then polish with Newton.
 * ponytail: zeros closer together than a cell are reported once; raise cols/rows if that matters.
 */
export function complexRoots(f: ComplexFunction, x0: number, x1: number, y0: number, y1: number, cols = 64, rows = 48): Complex[] {
  const N = 4, W = cols * N + 1, H = rows * N + 1, dx = (x1 - x0) / (W - 1), dy = (y1 - y0) / (H - 1);
  // Shifted by an odd fraction of a step, so a zero like 0 or i never sits exactly on a sample.
  const at = (i: number, j: number): Complex => [x0 + (i + 0.37) * dx, y0 + (j + 0.41) * dy];
  const arg = new Float64Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const [u, v] = f(at(i, j)); arg[j * W + i] = Math.atan2(v, u); }
  const turn = (i: number, j: number, k: number, l: number) => {
    const d = arg[l * W + k] - arg[j * W + i];
    return d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
  };
  const found: Complex[] = [];
  for (let cj = 0; cj < rows; cj++) for (let ci = 0; ci < cols && found.length < 50; ci++) {
    const i0 = ci * N, j0 = cj * N;
    let s = 0;
    for (let t = 0; t < N; t++) {
      s += turn(i0 + t, j0, i0 + t + 1, j0) + turn(i0 + N, j0 + t, i0 + N, j0 + t + 1)
        - turn(i0 + t, j0 + N, i0 + t + 1, j0 + N) - turn(i0, j0 + t, i0, j0 + t + 1);
    }
    if (!(Math.round(s / (2 * Math.PI)) > 0)) continue;
    const c = at(i0 + N / 2, j0 + N / 2), z = newton(f, c);
    if (!z || Math.abs(z[0] - c[0]) > N * dx || Math.abs(z[1] - c[1]) > N * dy) continue;
    const r = polish(f, z);
    if (!found.some(w => Math.abs(w[0] - r[0]) < dx && Math.abs(w[1] - r[1]) < dy)) found.push(r);
  }
  return found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/**
 * True for an isolated zero of h at z (z² + 1 at i): |h| is about the same all round it. On a curve of zeros
 * (|z| − 1) some of the 16 points around come much closer to 0; near exp(1/z) at 0 it swings wildly.
 */
export function isolated(h: ComplexFunction, z: Complex, r: number): boolean {
  const sizes = Array.from({ length: 16 }, (_, k) => size(h([z[0] + r * Math.cos(k * Math.PI / 8), z[1] + r * Math.sin(k * Math.PI / 8)])));
  return Math.min(...sizes) > 0.5 * Math.max(...sizes);
}
