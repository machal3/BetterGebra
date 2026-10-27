import { expect, test } from 'vitest';
import * as D from '../src/cas/dense';

/** A seeded generator (mulberry32): the same "random" matrices on every run. */
function seeded(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = seeded(12345);
const random = (n: number, m = n) => Array.from({ length: n }, () => Array.from({ length: m }, () => rnd() * 2 - 1));
const isOrthogonal = (Q: D.Mat) => D.relErr(D.eye(Q[0].length), D.mul(D.transpose(Q), Q)) < 1e-13;

test('LU: P·A = L·U on random matrices, square and not', () => {
  for (const [n, m] of [[1, 1], [3, 3], [8, 8], [30, 30], [5, 3], [3, 5]]) {
    const A = random(n, m), { L, U, P } = D.lu(A);
    expect(D.relErr(D.mul(P, A), D.mul(L, U))).toBeLessThan(1e-14);
    L.forEach((r, i) => r.forEach((x, j) => { if (j > i) expect(x).toBe(0); if (i === j) expect(x).toBe(1); expect(Math.abs(x)).toBeLessThanOrEqual(1); }));
  }
  expect(D.det([[1, 2], [3, 4]])).toBeCloseTo(-2, 14);
  const A = random(10), X = D.solve(A, D.eye(10))!;
  expect(D.relErr(D.eye(10), D.mul(A, X))).toBeLessThan(1e-12);
  expect(D.solve([[1, 2], [2, 4]], [[1], [2]])).toBeNull();
});

test('QR: A = Q·R with Q orthogonal and R upper triangular', () => {
  for (const [n, m] of [[4, 4], [20, 20], [7, 3], [3, 7]]) {
    const A = random(n, m), { Q, R } = D.qr(A);
    expect(isOrthogonal(Q)).toBe(true);
    expect(D.relErr(A, D.mul(Q, R))).toBeLessThan(1e-14);
    R.forEach((r, i) => r.forEach((x, j) => { if (j < i) expect(x).toBe(0); }));
  }
  // least squares through QR: the line through (0,1), (1,2), (2,2)
  const X = D.leastSquares([[1, 0], [1, 1], [1, 2]], [[1], [2], [2]])!;
  expect(X[0][0]).toBeCloseTo(7 / 6, 14);
  expect(X[1][0]).toBeCloseTo(1 / 2, 14);
});

test('Cholesky: only for symmetric positive definite matrices', () => {
  const B = random(6), A = D.mul(D.transpose(B), B).map((r, i) => r.map((x, j) => x + (i === j ? 1 : 0)));
  const R = D.chol(A)!;
  expect(D.relErr(A, D.mul(D.transpose(R), R))).toBeLessThan(1e-14);
  expect(D.chol([[1, 2], [2, 1]])).toBeNull(); // indefinite
  expect(D.chol([[2, 1], [0, 2]])).toBeNull(); // not symmetric
});

test('SVD: A = U·Σ·Vᵀ, falling singular values, the rank of rank-deficient matrices', () => {
  for (const [n, m] of [[4, 4], [12, 12], [6, 3], [3, 6], [1, 5]]) {
    const A = random(n, m), { U, S, V } = D.svd(A);
    expect(isOrthogonal(U)).toBe(true);
    expect(isOrthogonal(V)).toBe(true);
    const Sig = D.zeros(n, m); S.forEach((s, k) => { Sig[k][k] = s; });
    expect(D.relErr(A, D.mul(D.mul(U, Sig), D.transpose(V)))).toBeLessThan(1e-13);
    for (let k = 1; k < S.length; k++) expect(S[k]).toBeLessThanOrEqual(S[k - 1]);
  }
  expect(D.svd([[3, 0], [0, -4]]).S).toEqual([4, 3]);
  // rank 2: the third row is the sum of the first two
  const A = [[1, 2, 3], [4, 5, 6], [5, 7, 9]];
  expect(D.rank(A)).toBe(2);
  const X = D.pinv(A);
  expect(D.relErr(A, D.mul(D.mul(A, X), A))).toBeLessThan(1e-13);
  // Hilbert 10×10: σ_min / σ_max is about 1/(1.6·10¹³) and the SVD still finds it
  const H = Array.from({ length: 10 }, (_, i) => Array.from({ length: 10 }, (_, j) => 1 / (i + j + 1)));
  const s = D.svd(H).S;
  expect(s[0] / s[9]).toBeGreaterThan(1e13);
  expect(s[0] / s[9]).toBeLessThan(2e13);
});

test('symmetric eigenproblems by Jacobi', () => {
  const { values } = D.eigSym([[2, 1], [1, 2]]);
  expect(values[0]).toBeCloseTo(1, 14);
  expect(values[1]).toBeCloseTo(3, 14);
  const B = random(15), A = D.mul(D.transpose(B), B);
  const e = D.eigSym(A);
  const L = D.zeros(15, 15); e.values.forEach((v, i) => { L[i][i] = v; });
  expect(D.relErr(D.mul(A, e.vectors), D.mul(e.vectors, L))).toBeLessThan(1e-13);
  expect(isOrthogonal(e.vectors)).toBe(true);
});

test('general eigenvalues: real, complex pairs, companion matrices, and their eigenvectors', () => {
  const sorted = (cs: D.C[]) => cs.map(([r, i]) => [Math.round(r * 1e9) / 1e9, Math.round(i * 1e9) / 1e9]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  expect(sorted(D.eigenvalues([[0, -1], [1, 0]]))).toEqual([[0, -1], [0, 1]]);
  expect(sorted(D.eigenvalues([[4, 1], [2, 3]]))).toEqual([[2, 0], [5, 0]]);
  // the companion matrix of (x − 1)(x − 2)(x − 3)(x − 4)
  expect(sorted(D.eigenvalues([[10, -35, 50, -24], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]))).toEqual([[1, 0], [2, 0], [3, 0], [4, 0]]);
  for (const n of [3, 6, 10, 25]) {
    const A = random(n), lams = D.eigenvalues(A);
    // the sum is the trace, the product the determinant
    const tr = A.reduce((s, r, i) => s + r[i], 0);
    expect(lams.reduce((s, l) => s + l[0], 0)).toBeCloseTo(tr, 10);
    expect(Math.abs(lams.reduce((s, l) => s + l[1], 0))).toBeLessThan(1e-10);
    const { residual } = D.eigenvectors(A, lams);
    expect(residual).toBeLessThan(1e-12);
  }
  // a defective matrix: one eigenvalue 1, twice, and one eigenvector
  expect(sorted(D.eigenvalues([[1, 1], [0, 1]]))).toEqual([[1, 0], [1, 0]]);
});

test('expm: Padé 13 with scaling and squaring', () => {
  const R = D.expm([[0, 1], [-1, 0]]);
  expect(R[0][0]).toBeCloseTo(Math.cos(1), 14);
  expect(R[0][1]).toBeCloseTo(Math.sin(1), 14);
  expect(D.expm([[1, 1], [0, 1]])[0][1]).toBeCloseTo(Math.E, 14);
  // a symmetric matrix of norm about 30: expm(A) = V·e^Λ·Vᵀ
  const B = random(6), A = D.mul(D.transpose(B), B).map(r => r.map(x => x * 3));
  const { values, vectors: V } = D.eigSym(A);
  const E = D.mul(D.mul(V, values.map((v, i) => values.map((_, j) => (i === j ? Math.exp(v) : 0)))), D.transpose(V));
  expect(D.relErr(E, D.expm(A))).toBeLessThan(1e-12);
});
