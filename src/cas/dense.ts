/**
 * Numerical linear algebra in double precision, for what has no exact answer worth having (the singular values of a
 * 5×5 matrix of integers) and for values that are approximate already. Algorithms after Golub & Van Loan: LU with
 * partial pivoting, Householder QR, Cholesky, one-sided Jacobi SVD, Jacobi for symmetric eigenproblems, balancing,
 * Hessenberg reduction and Francis double-shift QR for the rest, inverse iteration for eigenvectors, Padé 13 with
 * scaling and squaring for expm. Pure, DOM-free; every caller checks a residual before showing a result.
 */
import { fail } from './q';

export type Mat = number[][];
export const EPS = 2 ** -52;

export const zeros = (n: number, m: number): Mat => Array.from({ length: n }, () => Array.from({ length: m }, () => 0));
export const eye = (n: number, m = n): Mat => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j): number => (i === j ? 1 : 0)));
export const copy = (A: Mat): Mat => A.map(r => r.slice());
export const transpose = (A: Mat): Mat => (A[0] ?? []).map((_, j) => A.map(r => r[j]));
export function mul(A: Mat, B: Mat): Mat {
  const n = A.length, k = B.length, m = B[0]?.length ?? 0;
  if ((A[0]?.length ?? 0) !== k) fail(`Nie da się pomnożyć macierzy ${n}×${A[0]?.length ?? 0} przez ${k}×${m}.`);
  const C = zeros(n, m);
  for (let i = 0; i < n; i++) for (let l = 0; l < k; l++) { const a = A[i][l]; if (a) for (let j = 0; j < m; j++) C[i][j] += a * B[l][j]; }
  return C;
}
export const minus = (A: Mat, B: Mat): Mat => A.map((r, i) => r.map((x, j) => x - B[i][j]));
export const normFro = (A: Mat) => Math.sqrt(A.reduce((s, r) => s + r.reduce((t, x) => t + x * x, 0), 0));
export const norm1 = (A: Mat) => Math.max(0, ...transpose(A).map(c => c.reduce((s, x) => s + Math.abs(x), 0)));
export const normInf = (A: Mat) => Math.max(0, ...A.map(r => r.reduce((s, x) => s + Math.abs(x), 0)));
const hypot = (v: number[]) => { let s = 0, t = 0; for (const x of v) { const a = Math.abs(x); if (a > s) { t = 1 + t * (s / a) ** 2; s = a; } else if (a) t += (a / s) ** 2; } return s * Math.sqrt(t); };
const sign = (x: number) => (x < 0 ? -1 : 1);
/** ‖A − B‖_F / ‖A‖_F (or the absolute difference when A is zero). */
export const relErr = (A: Mat, B: Mat) => { const d = normFro(minus(A, B)), a = normFro(A); return a ? d / a : d; };

// --- LU with partial pivoting: P·A = L·U ---

export interface LU { L: Mat; U: Mat; P: Mat; perm: number[]; swaps: number }
export function lu(A0: Mat): LU {
  const A = copy(A0), n = A.length, m = A[0]?.length ?? 0, k = Math.min(n, m);
  const perm = Array.from({ length: n }, (_, i) => i);
  let swaps = 0;
  for (let j = 0; j < k; j++) {
    let p = j;
    for (let i = j + 1; i < n; i++) if (Math.abs(A[i][j]) > Math.abs(A[p][j])) p = i;
    if (p !== j) { [A[p], A[j]] = [A[j], A[p]]; [perm[p], perm[j]] = [perm[j], perm[p]]; swaps++; }
    const piv = A[j][j];
    if (piv === 0) continue;
    for (let i = j + 1; i < n; i++) {
      const f = (A[i][j] /= piv);
      if (f) for (let c = j + 1; c < m; c++) A[i][c] -= f * A[j][c];
    }
  }
  const L = zeros(n, k), U = zeros(k, m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    if (j < i && j < k) L[i][j] = A[i][j];
    else if (i < k) U[i][j] = A[i][j];
  }
  for (let i = 0; i < k; i++) L[i][i] = 1;
  const P = zeros(n, n);
  perm.forEach((r, i) => { P[i][r] = 1; });
  return { L, U, P, perm, swaps };
}
export function det(A: Mat): number {
  const { U, swaps } = lu(A);
  return U.reduce((d, r, i) => d * r[i], swaps % 2 ? -1 : 1);
}
/** X with A·X = B for square A; null when a pivot vanishes. */
export function solve(A: Mat, B: Mat): Mat | null {
  const { L, U, perm } = lu(A), n = A.length, m = B[0].length;
  const X = perm.map(r => B[r].slice());
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) { let s = X[i][j]; for (let k = 0; k < i; k++) s -= L[i][k] * X[k][j]; X[i][j] = s; }
    for (let i = n - 1; i >= 0; i--) {
      if (U[i][i] === 0) return null;
      let s = X[i][j]; for (let k = i + 1; k < n; k++) s -= U[i][k] * X[k][j]; X[i][j] = s / U[i][i];
    }
  }
  return X;
}
export const inverse = (A: Mat): Mat | null => solve(A, eye(A.length));

// --- Householder QR: A = Q·R ---

export function qr(A0: Mat): { Q: Mat; R: Mat } {
  const R = copy(A0), n = R.length, m = R[0]?.length ?? 0;
  const Q = eye(n);
  for (let k = 0; k < Math.min(n - 1, m); k++) {
    const x = R.slice(k).map(r => r[k]), nx = hypot(x);
    if (nx === 0) continue;
    const v = x.slice();
    v[0] += sign(x[0]) * nx;
    const nv = hypot(v);
    for (let i = 0; i < v.length; i++) v[i] /= nv;
    for (let j = k; j < m; j++) {
      let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * R[k + i][j];
      for (let i = 0; i < v.length; i++) R[k + i][j] -= 2 * s * v[i];
    }
    for (let i = 0; i < n; i++) {
      let s = 0; for (let l = 0; l < v.length; l++) s += Q[i][k + l] * v[l];
      for (let l = 0; l < v.length; l++) Q[i][k + l] -= 2 * s * v[l];
    }
    for (let i = k + 1; i < n; i++) R[i][k] = 0;
  }
  return { Q, R };
}
/** The least-squares X of A·X ≈ B (A with more rows than columns, of full column rank), through QR. */
export function leastSquares(A: Mat, B: Mat): Mat | null {
  const { Q, R } = qr(A), n = A[0].length;
  const C = mul(transpose(Q), B).slice(0, n);
  const X = zeros(n, B[0].length);
  const tol = Math.max(A.length, n) * EPS * Math.abs(R[0]?.[0] ?? 0);
  for (let j = 0; j < B[0].length; j++) for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(R[i][i]) <= tol) return null;
    let s = C[i][j]; for (let k = i + 1; k < n; k++) s -= R[i][k] * X[k][j]; X[i][j] = s / R[i][i];
  }
  return X;
}

// --- Cholesky: A = Rᵀ·R ---

/** The upper triangular R, or null when A is not symmetric positive definite. */
export function chol(A: Mat): Mat | null {
  const n = A.length;
  if (relErr(A, transpose(A)) > 64 * EPS) return null;
  const R = zeros(n, n);
  for (let j = 0; j < n; j++) {
    let s = A[j][j];
    for (let k = 0; k < j; k++) s -= R[k][j] * R[k][j];
    if (!(s > 0)) return null;
    R[j][j] = Math.sqrt(s);
    for (let i = j + 1; i < n; i++) {
      let t = A[j][i];
      for (let k = 0; k < j; k++) t -= R[k][j] * R[k][i];
      R[j][i] = t / R[j][j];
    }
  }
  return R;
}

// --- SVD by one-sided Jacobi: A = U·Σ·Vᵀ ---

/** Orthonormal columns added to Q (m×k) until it is m×m: Gram–Schmidt, twice, on the unit vectors. */
function complete(Q: Mat, m: number): Mat {
  const cols = transpose(Q).filter(c => hypot(c) > 0.5);
  for (let e = 0; e < m && cols.length < m; e++) {
    let v = Array.from({ length: m }, (_, i): number => (i === e ? 1 : 0));
    for (let pass = 0; pass < 2; pass++) for (const c of cols) { const d = c.reduce((s, x, i) => s + x * v[i], 0); v = v.map((x, i) => x - d * c[i]); }
    const nv = hypot(v);
    if (nv > 1e-8) cols.push(v.map(x => x / nv));
  }
  return transpose(cols);
}
export interface SVD { U: Mat; S: number[]; V: Mat }
/** Full SVD: U m×m, the singular values falling, V n×n. */
export function svd(A: Mat): SVD {
  const m = A.length, n = A[0]?.length ?? 0;
  if (m < n) { const t = svd(transpose(A)); return { U: t.V, S: t.S, V: t.U }; }
  const U = copy(A), V = eye(n);
  for (let sweep = 0; sweep < 80; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      let a = 0, b = 0, g = 0;
      for (let i = 0; i < m; i++) { a += U[i][p] ** 2; b += U[i][q] ** 2; g += U[i][p] * U[i][q]; }
      if (Math.abs(g) <= EPS * Math.sqrt(a * b) || g === 0) continue;
      rotated = true;
      const z = (b - a) / (2 * g), t = sign(z) / (Math.abs(z) + Math.sqrt(1 + z * z)), c = 1 / Math.sqrt(1 + t * t), s = c * t;
      for (let i = 0; i < m; i++) { const x = U[i][p], y = U[i][q]; U[i][p] = c * x - s * y; U[i][q] = s * x + c * y; }
      for (let i = 0; i < n; i++) { const x = V[i][p], y = V[i][q]; V[i][p] = c * x - s * y; V[i][q] = s * x + c * y; }
    }
    if (!rotated) break;
  }
  const S = transpose(U).map(hypot);
  const order = S.map((_, j) => j).sort((i, j) => S[j] - S[i]);
  const Us = zeros(m, n), Vs = zeros(n, n);
  order.forEach((j, k) => {
    for (let i = 0; i < m; i++) Us[i][k] = S[j] ? U[i][j] / S[j] : 0;
    for (let i = 0; i < n; i++) Vs[i][k] = V[i][j];
  });
  return { U: complete(Us, m), S: order.map(j => S[j]), V: Vs };
}
/** The numerical rank: singular values above max(m, n)·eps·σ₁, MATLAB's tolerance. */
export function rank(A: Mat, S = svd(A).S): number {
  const tol = Math.max(A.length, A[0]?.length ?? 0) * EPS * (S[0] ?? 0);
  return S.filter(s => s > tol).length;
}
export function pinv(A: Mat): Mat {
  const { U, S, V } = svd(A), r = rank(A, S), m = A.length, n = A[0].length;
  const X = zeros(n, m);
  for (let k = 0; k < r; k++) for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) X[i][j] += V[i][k] * U[j][k] / S[k];
  return X;
}

// --- Eigenvalues ---

/** Symmetric A: eigenvalues rising and orthonormal eigenvectors (columns), by cyclic Jacobi rotations. */
export function eigSym(A0: Mat): { values: number[]; vectors: Mat } {
  const A = copy(A0), n = A.length, V = eye(n);
  const scale = normFro(A) || 1;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] ** 2;
    if (Math.sqrt(off) <= EPS * scale * 0.5) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) <= 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = sign(th) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const x = A[k][p], y = A[k][q]; A[k][p] = c * x - s * y; A[k][q] = s * x + c * y; }
      for (let k = 0; k < n; k++) { const x = A[p][k], y = A[q][k]; A[p][k] = c * x - s * y; A[q][k] = s * x + c * y; }
      for (let k = 0; k < n; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
    }
  }
  const order = A.map((_, i) => i).sort((i, j) => A[i][i] - A[j][j]);
  return { values: order.map(i => A[i][i]), vectors: V.map(r => order.map(i => r[i])) };
}

/** Rows and columns scaled by powers of 2 so their norms match (Parlett–Reinsch): same eigenvalues, better accuracy. */
function balance(a: Mat): void {
  const n = a.length, RADIX = 2, SQR = RADIX * RADIX;
  for (let done = false; !done;) {
    done = true;
    for (let i = 0; i < n; i++) {
      let r = 0, c = 0;
      for (let j = 0; j < n; j++) if (j !== i) { c += Math.abs(a[j][i]); r += Math.abs(a[i][j]); }
      if (!c || !r) continue;
      let g = r / RADIX, f = 1;
      const s = c + r;
      while (c < g) { f *= RADIX; c *= SQR; }
      g = r * RADIX;
      while (c > g) { f /= RADIX; c /= SQR; }
      if ((c + r) / f < 0.95 * s) {
        done = false;
        for (let j = 0; j < n; j++) a[i][j] /= f;
        for (let j = 0; j < n; j++) a[j][i] *= f;
      }
    }
  }
}
/** Upper Hessenberg form by Householder reflections (similar to A). */
function hessenberg(H: Mat): void {
  const n = H.length;
  for (let k = 0; k < n - 2; k++) {
    const x = H.slice(k + 1).map(r => r[k]), nx = hypot(x);
    if (nx === 0) continue;
    const v = x.slice();
    v[0] += sign(x[0]) * nx;
    const nv = hypot(v);
    for (let i = 0; i < v.length; i++) v[i] /= nv;
    for (let j = 0; j < n; j++) {
      let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * H[k + 1 + i][j];
      for (let i = 0; i < v.length; i++) H[k + 1 + i][j] -= 2 * s * v[i];
    }
    for (let i = 0; i < n; i++) {
      let s = 0; for (let l = 0; l < v.length; l++) s += H[i][k + 1 + l] * v[l];
      for (let l = 0; l < v.length; l++) H[i][k + 1 + l] -= 2 * s * v[l];
    }
    for (let i = k + 2; i < n; i++) H[i][k] = 0;
  }
}
/**
 * Eigenvalues of an upper Hessenberg matrix by the Francis double-shift QR iteration (EISPACK's hqr, as in
 * Numerical Recipes), on 1-based copies so the indices read as in the original.
 */
function hqr(h: Mat): { re: number[]; im: number[] } {
  const n = h.length;
  const a: Mat = [Array.from({ length: n + 1 }, () => 0), ...h.map(r => [0, ...r])];
  const wr = Array.from({ length: n + 1 }, () => 0), wi = Array.from({ length: n + 1 }, () => 0);
  let anorm = 0;
  for (let i = 1; i <= n; i++) for (let j = Math.max(i - 1, 1); j <= n; j++) anorm += Math.abs(a[i][j]);
  let nn = n, t = 0;
  while (nn >= 1) {
    let its = 0, l: number;
    do {
      for (l = nn; l >= 2; l--) {
        let s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (s === 0) s = anorm;
        if (Math.abs(a[l][l - 1]) <= EPS * s) { a[l][l - 1] = 0; break; }
      }
      let x = a[nn][nn];
      if (l === nn) { wr[nn] = x + t; wi[nn--] = 0; }
      else {
        let y = a[nn - 1][nn - 1], w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          const p = 0.5 * (y - x), q = p * p + w;
          let z = Math.sqrt(Math.abs(q));
          x += t;
          if (q >= 0) {
            z = p + (p >= 0 ? Math.abs(z) : -Math.abs(z));
            wr[nn - 1] = wr[nn] = x + z;
            if (z) wr[nn] = x - w / z;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = x + p;
            wi[nn - 1] = -(wi[nn] = z);
          }
          nn -= 2;
        } else {
          if (its === 60) fail('Wartości własne: iteracja QR nie zbiegła się.');
          if (its === 10 || its === 20 || its === 40) {
            t += x;
            for (let i = 1; i <= nn; i++) a[i][i] -= x;
            const s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            y = x = 0.75 * s;
            w = -0.4375 * s * s;
          }
          ++its;
          let m: number, p = 0, q = 0, r = 0, z: number;
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m];
            r = x - z;
            const s0 = y - z;
            p = (r * s0 - w) / a[m + 1][m] + a[m][m + 1];
            q = a[m + 1][m + 1] - z - r - s0;
            r = a[m + 2][m + 1];
            const s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s; q /= s; r /= s;
            if (m === l) break;
            const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            const v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u <= EPS * v) break;
          }
          for (let i = m + 2; i <= nn; i++) { a[i][i - 2] = 0; if (i !== m + 2) a[i][i - 3] = 0; }
          for (let k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = a[k][k - 1]; q = a[k + 1][k - 1]; r = 0;
              if (k !== nn - 1) r = a[k + 2][k - 1];
              x = Math.abs(p) + Math.abs(q) + Math.abs(r);
              if (x !== 0) { p /= x; q /= x; r /= x; }
            }
            const s = (p >= 0 ? 1 : -1) * Math.sqrt(p * p + q * q + r * r);
            if (s !== 0) {
              if (k === m) { if (l !== m) a[k][k - 1] = -a[k][k - 1]; }
              else a[k][k - 1] = -s * x;
              p += s; x = p / s; y = q / s; z = r / s; q /= p; r /= p;
              for (let j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j];
                if (k !== nn - 1) { p += r * a[k + 2][j]; a[k + 2][j] -= p * z; }
                a[k + 1][j] -= p * y;
                a[k][j] -= p * x;
              }
              const mmin = nn < k + 3 ? nn : k + 3;
              for (let i = l; i <= mmin; i++) {
                p = x * a[i][k] + y * a[i][k + 1];
                if (k !== nn - 1) { p += z * a[i][k + 2]; a[i][k + 2] -= p * r; }
                a[i][k + 1] -= p * q;
                a[i][k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  return { re: wr.slice(1), im: wi.slice(1) };
}

/** A complex number as [re, im]. */
export type C = [number, number];
/** Eigenvalues of a real square matrix, complex ones in conjugate pairs. */
export function eigenvalues(A: Mat): C[] {
  if (A.length === 0) return [];
  const H = copy(A);
  balance(H);
  hessenberg(H);
  const { re, im } = hqr(H);
  return re.map((x, i) => [x, im[i]] as C);
}

// --- Complex linear solves, for eigenvectors by inverse iteration ---

const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const cabs = (a: C) => Math.hypot(a[0], a[1]);
/** x with (A − μI)·x = b; a vanishing pivot is replaced by a tiny one, as inverse iteration wants. */
function shiftedSolve(A: Mat, mu: C, b: C[]): C[] {
  const n = A.length, scale = normFro(A) || 1;
  const M: C[][] = A.map((r, i) => r.map((x, j) => (i === j ? [x - mu[0], -mu[1]] : [x, 0]) as C));
  const x = b.map(v => [...v] as C);
  for (let j = 0; j < n; j++) {
    let p = j;
    for (let i = j + 1; i < n; i++) if (cabs(M[i][j]) > cabs(M[p][j])) p = i;
    [M[p], M[j]] = [M[j], M[p]]; [x[p], x[j]] = [x[j], x[p]];
    if (cabs(M[j][j]) < EPS * scale) M[j][j] = [EPS * scale, 0];
    for (let i = j + 1; i < n; i++) {
      const f = cdiv(M[i][j], M[j][j]);
      for (let c = j; c < n; c++) { const t = cmul(f, M[j][c]); M[i][c] = [M[i][c][0] - t[0], M[i][c][1] - t[1]]; }
      const t = cmul(f, x[j]); x[i] = [x[i][0] - t[0], x[i][1] - t[1]];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let c = i + 1; c < n; c++) { const t = cmul(M[i][c], x[c]); s = [s[0] - t[0], s[1] - t[1]]; }
    x[i] = cdiv(s, M[i][i]);
  }
  return x;
}
/** Unit eigenvectors for the given eigenvalues (the largest entry made real and positive), with their residuals. */
export function eigenvectors(A: Mat, values: C[]): { vectors: C[][]; residual: number } {
  const n = A.length, scale = normFro(A) || 1;
  const vectors: C[][] = [];
  let residual = 0;
  values.forEach((lam, k) => {
    // eigenvalues met before: start elsewhere and keep away from the vectors found for them
    const twins = vectors.filter((_, j) => cabs([values[j][0] - lam[0], values[j][1] - lam[1]]) <= 1e-8 * scale);
    let x: C[] = Array.from({ length: n }, (_, i) => [1 + ((i * 7 + k * 3) % 5) / 10, 0] as C);
    for (let it = 0; it < 4; it++) {
      x = shiftedSolve(A, lam, x);
      for (const w of twins) {
        let d: C = [0, 0];
        for (let i = 0; i < n; i++) d = [d[0] + w[i][0] * x[i][0] + w[i][1] * x[i][1], d[1] + w[i][0] * x[i][1] - w[i][1] * x[i][0]];
        x = x.map((v, i) => { const t = cmul(d, w[i]); return [v[0] - t[0], v[1] - t[1]] as C; });
      }
      const nx = Math.sqrt(x.reduce((s, v) => s + v[0] * v[0] + v[1] * v[1], 0)) || 1;
      x = x.map(v => [v[0] / nx, v[1] / nx] as C);
    }
    // a fixed phase: the largest entry real and positive
    const big = x.reduce((b, v, i) => (cabs(v) > cabs(x[b]) ? i : b), 0);
    const ph: C = [x[big][0] / cabs(x[big]), -x[big][1] / cabs(x[big])];
    x = x.map(v => cmul(v, ph));
    x = x.map(v => [v[0], Math.abs(v[1]) < 1e-15 ? 0 : v[1]] as C);
    for (let i = 0; i < n; i++) {
      let s: C = [-lam[0] * x[i][0] + lam[1] * x[i][1], -lam[0] * x[i][1] - lam[1] * x[i][0]];
      for (let j = 0; j < n; j++) s = [s[0] + A[i][j] * x[j][0], s[1] + A[i][j] * x[j][1]];
      residual = Math.max(residual, cabs(s) / scale);
    }
    vectors.push(x);
  });
  return { vectors, residual };
}

// --- expm: Padé 13 with scaling and squaring (Higham 2005) ---

const PADE13 = [64764752532480000, 32382376266240000, 7771770303897600, 1187353796428800, 129060195264000, 10559470521600, 670442572800, 33522128640, 1323241920, 40840800, 960960, 16380, 182, 1];
const plus = (...ms: [number, Mat][]): Mat => ms[0][1].map((r, i) => r.map((_, j) => ms.reduce((s, [c, M]) => s + c * M[i][j], 0)));
export function expm(A0: Mat): Mat {
  const n = A0.length, b = PADE13, I = eye(n);
  const s = Math.max(0, Math.ceil(Math.log2(norm1(A0) / 5.371920351148152)));
  if (s > 1000) fail('expm: elementy macierzy są za duże.');
  const A = A0.map(r => r.map(x => x / 2 ** s));
  const A2 = mul(A, A), A4 = mul(A2, A2), A6 = mul(A4, A2);
  const U = mul(A, plus([1, mul(A6, plus([b[13], A6], [b[11], A4], [b[9], A2]))], [b[7], A6], [b[5], A4], [b[3], A2], [b[1], I]));
  const V = plus([1, mul(A6, plus([b[12], A6], [b[10], A4], [b[8], A2]))], [b[6], A6], [b[4], A4], [b[2], A2], [b[0], I]);
  let X = solve(minus(V, U), plus([1, V], [1, U]));
  if (!X) fail('expm: obliczenie nie powiodło się.');
  for (let k = 0; k < s; k++) X = mul(X!, X!);
  return X!;
}
