/**
 * Linear algebra. Matrices of rationals go through exact fraction arithmetic; symbolic entries through
 * expressions, with a pivot accepted only when it is provably nonzero after expansion.
 */
import { Expr, ONE, ZERO, add, div, expand, isNum, isZero, mul, neg, num, same, sub, sym, together } from './expr';
import { cancel } from './simplify';
import { identityM } from './evaluate';
import { Q, Q0, Q1, fail, qadd, qdiv, qmul, qneg, qsub } from './q';

export type M = Expr[][];
const isQM = (m: M) => m.every(r => r.every(isNum));
const toQ = (m: M): Q[][] => m.map(r => r.map(e => (e as { v: Q }).v));
const fromQ = (m: Q[][]): M => m.map(r => r.map(v => num(v)));
export const nonzero = (e: Expr) => !isZero(e) && !isZero(expand(e)) && !isZero(cancel(together(e)));
export const clean = (e: Expr) => { const c = cancel(together(e)); return c; };

export function square(m: M, what: string): number {
  if (!m.length || !m[0]?.length) fail(`${what}: macierz jest pusta.`);
  const cols = m[0].length;
  if (m.some(r => r.length !== cols)) fail(`${what}: wiersze mają różne długości.`);
  if (m.length !== cols) fail(`${what}: macierz musi być kwadratowa (jest ${m.length}×${cols}).`);
  return m.length;
}
export const transpose = (A: M): M => A.length ? A[0].map((_, j) => A.map(r => r[j])) : [];

// --- Exact rational elimination ---

/** Reduced row echelon form over ℚ, with pivot columns and the determinant of the square part's elimination. */
export function rrefQ(A: Q[][]): { R: Q[][]; pivots: number[]; det: Q } {
  const R = A.map(r => r.slice());
  const n = R.length, m = R[0]?.length ?? 0, pivots: number[] = [];
  let det = Q1, row = 0;
  for (let col = 0; col < m && row < n; col++) {
    let p = row;
    while (p < n && !R[p][col].n) p++;
    if (p === n) { det = Q0; continue; }
    if (p !== row) { [R[p], R[row]] = [R[row], R[p]]; det = qneg(det); }
    const pv = R[row][col];
    det = qmul(det, pv);
    R[row] = R[row].map(v => qdiv(v, pv));
    for (let i = 0; i < n; i++) {
      if (i === row || !R[i][col].n) continue;
      const f = R[i][col];
      R[i] = R[i].map((v, j) => qsub(v, qmul(f, R[row][j])));
    }
    pivots.push(col);
    row++;
  }
  if (pivots.length < n) det = Q0;
  return { R, pivots, det };
}
/** The unique solution of A·x = b over ℚ, or null when A is singular. */
export function solveQ(A: Q[][], b: Q[]): Q[] | null {
  const n = A.length;
  const { R, pivots } = rrefQ(A.map((r, i) => [...r, b[i]]));
  if (pivots.length !== n || pivots.some((p, i) => p !== i)) return null;
  return R.map(r => r[n]);
}

// --- Generic elimination on expressions ---

export function rref(A: M): { R: M; pivots: number[] } {
  if (isQM(A)) { const { R, pivots } = rrefQ(toQ(A)); return { R: fromQ(R), pivots }; }
  const R = A.map(r => r.map(clean));
  const n = R.length, m = R[0]?.length ?? 0, pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < m && row < n; col++) {
    let p = row;
    while (p < n && !nonzero(R[p][col])) p++;
    if (p === n) continue;
    [R[p], R[row]] = [R[row], R[p]];
    const pv = R[row][col];
    R[row] = R[row].map(v => clean(div(v, pv)));
    for (let i = 0; i < n; i++) {
      if (i === row || !nonzero(R[i][col])) continue;
      const f = R[i][col];
      R[i] = R[i].map((v, j) => clean(sub(v, mul(f, R[row][j]))));
    }
    pivots.push(col);
    row++;
  }
  return { R, pivots };
}

export function det(A: M): Expr {
  const n = square(A, 'Wyznacznik');
  if (isQM(A)) return num(rrefQ(toQ(A)).det);
  if (n <= 6) return expand(laplace(A));
  // fraction-free elimination is not worth it for symbolic n > 6 here
  return fail('Wyznacznik macierzy symbolicznej liczę do rozmiaru 6×6.');
}
function laplace(A: M): Expr {
  const n = A.length;
  if (n === 1) return A[0][0];
  if (n === 2) return sub(mul(A[0][0], A[1][1]), mul(A[0][1], A[1][0]));
  // expand along the row with most zeros
  let best = 0, zeros = -1;
  A.forEach((r, i) => { const z = r.filter(isZero).length; if (z > zeros) { zeros = z; best = i; } });
  const terms: Expr[] = [];
  for (let j = 0; j < n; j++) {
    if (isZero(A[best][j])) continue;
    const minor = A.filter((_, i) => i !== best).map(r => r.filter((_, k) => k !== j));
    const sign = (best + j) % 2 ? -1 : 1;
    terms.push(mul(num(sign), A[best][j], laplace(minor)));
  }
  return add(...terms);
}

export function inverse(A: M): M {
  const n = square(A, 'Macierz odwrotna');
  const aug = A.map((r, i) => [...r, ...identityM(n)[i]]);
  const { R, pivots } = rref(aug);
  if (pivots.length < n || pivots[n - 1] !== n - 1) fail('Macierz jest osobliwa (wyznacznik 0), nie ma odwrotnej.');
  return R.map(r => r.slice(n));
}
export const rank = (A: M) => rref(A).pivots.length;
export function trace(A: M): Expr { square(A, 'Ślad'); return add(...A.map((r, i) => r[i])); }

/** A without row i and column j (both 0-based). */
export function minor(A: M, i: number, j: number): M {
  return A.filter((_, r) => r !== i).map(r => r.filter((_, c) => c !== j));
}

/** The cofactor matrix: Cᵢⱼ = (−1)ⁱ⁺ʲ det(minorᵢⱼ). */
export function cofactor(A: M): M {
  const n = square(A, 'Macierz dopełnień algebraicznych');
  if (n === 1) return [[ONE]];
  return A.map((row_, i) => row_.map((_, j) => {
    const d = det(minor(A, i, j));
    return (i + j) % 2 ? neg(d) : d;
  }));
}

/** The adjugate: the transposed cofactor matrix, A·adj(A) = det(A)·I. */
export function adjugate(A: M): M {
  const n = square(A, 'Macierz dołączona');
  if (n === 1) return [[ONE]];
  return transpose(cofactor(A));
}

/** Row echelon form (Gauss): pivots are 1, entries below a pivot are 0; above the pivots are not cleared. */
export function echelon(A: M): { R: M; pivots: number[] } {
  if (!A.length) return { R: [], pivots: [] };
  const { R, pivots } = eliminate(A, 'ref');
  return { R, pivots };
}

// --- Elimination with a record of the elementary row operations (for the "steps" view) ---

/** One elementary row operation: swap rows, divide row i by d, or add f·(row j) to row i. Rows are 0-based. */
export type RowOp =
  | { k: 'swap'; i: number; j: number }
  | { k: 'scale'; i: number; d: Expr }
  | { k: 'add'; i: number; j: number; f: Expr };
/** A group of row operations done together, the matrix after them and the rows they changed. */
export interface ElimStep { ops: RowOp[]; R: M; changed: number[] }

/**
 * Gaussian elimination that records every row operation. Modes:
 * - 'rref': Gauss–Jordan, pivots scaled to 1 and cleared above and below;
 * - 'ref': pivots scaled to 1, cleared only below (row echelon form);
 * - 'det': no scaling, cleared below (upper-triangular form for the determinant; `swaps` counts the sign flips).
 * The pivot is the first usable entry of the column, but (with `unitPivot`) an entry equal to ±1 is preferred (fewer fractions).
 * `stopAt` limits the columns used as pivots (an augmented matrix [A | B] is reduced on A's columns only).
 */
export function eliminate(A: M, mode: 'rref' | 'ref' | 'det', stopAt = A[0]?.length ?? 0, unitPivot = true): { R: M; pivots: number[]; steps: ElimStep[]; swaps: number } {
  const R = A.map(r => r.map(clean));
  const n = R.length, pivots: number[] = [], steps: ElimStep[] = [];
  const snap = () => R.map(r => r.slice());
  let row = 0, swaps = 0;
  const isUnit = (e: Expr) => isNum(e) && (e as { v: Q }).v.d === 1n && ((e as { v: Q }).v.n === 1n || (e as { v: Q }).v.n === -1n);
  for (let col = 0; col < stopAt && row < n; col++) {
    let p = -1;
    for (let i = row; i < n; i++) {
      if (!nonzero(R[i][col])) continue;
      if (p < 0) p = i;
      if (!unitPivot) break;
      if (isUnit(R[i][col])) { p = i; break; }
    }
    if (p < 0) continue;
    if (p !== row) {
      [R[p], R[row]] = [R[row], R[p]];
      swaps++;
      steps.push({ ops: [{ k: 'swap', i: row, j: p }], R: snap(), changed: [row, p] });
    }
    const pv = R[row][col];
    if (mode !== 'det' && !isZero(sub(pv, ONE))) {
      R[row] = R[row].map(v => clean(div(v, pv)));
      R[row][col] = ONE;
      steps.push({ ops: [{ k: 'scale', i: row, d: pv }], R: snap(), changed: [row] });
    }
    const ops: RowOp[] = [], changed: number[] = [];
    for (let i = mode === 'rref' ? 0 : row + 1; i < n; i++) {
      if (i === row || !nonzero(R[i][col])) continue;
      const f = clean(neg(mode === 'det' ? div(R[i][col], R[row][col]) : R[i][col]));
      R[i] = R[i].map((v, j) => clean(add(v, mul(f, R[row][j]))));
      R[i][col] = ZERO;
      ops.push({ k: 'add', i, j: row, f });
      changed.push(i);
    }
    if (ops.length) steps.push({ ops, R: snap(), changed });
    pivots.push(col);
    row++;
  }
  return { R, pivots, steps, swaps };
}

/** Cholesky: A = L·Lᵀ for a symmetric positive definite matrix of constants (L lower-triangular, positive diagonal). */
export function cholesky(A: M, positive: (e: Expr) => boolean, simp: (e: Expr) => Expr, root: (e: Expr) => Expr): M | null {
  const n = square(A, 'Rozkład Choleskiego');
  if (!isSymmetric(A)) return null;
  const L: M = Array.from({ length: n }, () => Array(n).fill(ZERO));
  for (let j = 0; j < n; j++) {
    const d = simp(sub(A[j][j], add(...L[j].slice(0, j).map(v => mul(v, v)))));
    if (!positive(d)) return null;
    L[j][j] = simp(root(d));
    for (let i = j + 1; i < n; i++) {
      const s = sub(A[i][j], add(...L[i].slice(0, j).map((v, k) => mul(v, L[j][k]))));
      L[i][j] = simp(div(s, L[j][j]));
    }
  }
  return L;
}

/** QR by Gram–Schmidt on the columns: A = Q·R, Q with orthonormal columns, R upper-triangular. Null when the columns are dependent. */
export function qr(A: M, simp: (e: Expr) => Expr, root: (e: Expr) => Expr): { Q: M; R: M } | null {
  if (!A.length) return null;
  const n = A.length, m = A[0].length;
  if (m > n) return null;
  const cols = transpose(A), qs: Expr[][] = [];
  const R: M = Array.from({ length: m }, () => Array(m).fill(ZERO));
  for (let k = 0; k < m; k++) {
    let u = cols[k];
    for (let j = 0; j < k; j++) {
      const c = simp(dot(qs[j], cols[k]));
      R[j][k] = c;
      u = u.map((v, i) => sub(v, mul(c, qs[j][i])));
    }
    u = u.map(simp);
    const len2 = simp(dot(u, u));
    if (!nonzero(len2)) return null;
    const len = simp(root(len2));
    R[k][k] = len;
    qs.push(u.map(v => simp(div(v, len))));
  }
  return { Q: transpose(qs), R };
}

/** Basis of the row space: the nonzero rows of the reduced echelon form. */
export function rowspace(A: M): M {
  const { R, pivots } = rref(A);
  return R.slice(0, pivots.length).map(r => r.map(clean));
}

/** Basis of the column space: the pivot columns of A itself. */
export function colspace(A: M): M {
  if (!A.length) return [];
  const { pivots } = rref(A);
  return pivots.map(j => A.map(r => clean(r[j])));
}

export function isSymmetric(A: M): boolean {
  if (!A.length || A.some(r => r.length !== A.length)) return false;
  return A.every((r, i) => r.every((v, j) => same(clean(v), clean(A[j][i]))));
}

export function isInvertible(A: M): boolean {
  const n = square(A, 'Odwracalność');
  return rank(A) === n;
}

export const isDiagonal = (A: M) => A.length === A[0]?.length && A.every((r, i) => r.every((v, j) => i === j || isZero(clean(v))));

export type LinearSolution =
  | { kind: 'none'; row: number; value: Expr; rankA: number; rankAug: number }
  | { kind: 'unique'; x: Expr[] }
  | { kind: 'inf'; x: Expr[]; free: number[]; params: string[] };

/** Exact solution of A·x = b, with free parameters t1, t2, … when the solution is not unique. */
export function linsolve(A: M, b: Expr[]): LinearSolution {
  if (!A.length) fail('Układ: macierz współczynników jest pusta.');
  const n = A.length, m = A[0].length;
  if (A.some(r => r.length !== m)) fail('Układ: wiersze macierzy mają różne długości.');
  if (b.length !== n) fail(`Układ: macierz ma ${n} wierszy, a wektor wyrazów wolnych ${b.length} liczb.`);
  const aug = A.map((r, i) => [...r, b[i]]);
  const { R, pivots } = rref(aug);
  if (pivots.includes(m)) {
    // the pivot in the last column is the row 0 = c that makes the system inconsistent
    const row = R.findIndex(r => r.slice(0, m).every(isZero) && !isZero(r[m]));
    return { kind: 'none', row, value: clean(R[row][m]), rankA: pivots.filter(p => p < m).length, rankAug: pivots.length };
  }
  const coeffPivots = pivots.filter(p => p < m);
  const free = [...Array(m).keys()].filter(j => !coeffPivots.includes(j));
  if (!free.length) {
    const x: Expr[] = Array(m).fill(ZERO);
    coeffPivots.forEach((p, i) => { x[p] = clean(R[i][m]); });
    return { kind: 'unique', x };
  }
  const params = free.map((_, k) => `t${k + 1}`);
  const x: Expr[] = Array(m).fill(ZERO);
  free.forEach((f, k) => { x[f] = sym(params[k]); });
  coeffPivots.forEach((p, i) => {
    let v = R[i][m];
    free.forEach((f, k) => { if (nonzero(R[i][f])) v = sub(v, mul(R[i][f], sym(params[k]))); });
    x[p] = clean(v);
  });
  return { kind: 'inf', x, free, params };
}

export interface LU { P: M; L: M; U: M }
/** P·A = L·U with a permutation P, unit lower-triangular L and upper-triangular U; null if A is singular. */
export function lu(A: M): LU | null {
  const n = square(A, 'Rozkład LU');
  const U = A.map(r => r.map(clean));
  const L = identityM(n).map(r => r.map(clean));
  const P = identityM(n);
  for (let col = 0; col < n; col++) {
    let p = col;
    while (p < n && !nonzero(U[p][col])) p++;
    if (p === n) return null;
    if (p !== col) {
      [U[p], U[col]] = [U[col], U[p]];
      [P[p], P[col]] = [P[col], P[p]];
      for (let k = 0; k < col; k++) [L[p][k], L[col][k]] = [L[col][k], L[p][k]];
    }
    const pv = U[col][col];
    for (let i = col + 1; i < n; i++) {
      if (!nonzero(U[i][col])) continue;
      const f = clean(div(U[i][col], pv));
      L[i][col] = f;
      U[i] = U[i].map((v, j) => clean(sub(v, mul(f, U[col][j]))));
    }
  }
  return { P, L, U };
}

/** Basis of {v : A v = 0}. */
export function nullspace(A: M): Expr[][] {
  const { R, pivots } = rref(A);
  const m = A[0].length, free = [...Array(m).keys()].filter(j => !pivots.includes(j));
  return free.map(f => {
    const v: Expr[] = Array(m).fill(ZERO);
    v[f] = ONE;
    pivots.forEach((p, i) => { v[p] = clean(neg(R[i][f])); });
    return v;
  });
}

/** det(λI − A) as an expression in the variable λ (named `name`). */
export function charpoly(A: M, name = 'λ'): Expr {
  const n = square(A, 'Wielomian charakterystyczny');
  const L = sym(name);
  if (isQM(A) && n <= 40) {
    // Faddeev–LeVerrier over ℚ: c_n = 1, M_k = A M_{k−1} + c_{n−k+1} I, c_{n−k} = −tr(A M_k)/k
    const Aq = toQ(A);
    const mm = (X: Q[][], Y: Q[][]) => X.map(r => Y[0].map((_, j) => r.reduce((s, v, k) => qadd(s, qmul(v, Y[k][j])), Q0)));
    const c: Q[] = Array(n + 1).fill(Q0);
    c[n] = Q1;
    let Mk: Q[][] = Aq.map((r, i) => r.map((_, j) => (i === j ? Q1 : Q0)));
    for (let k = 1; k <= n; k++) {
      const AM = mm(Aq, Mk);
      const tr = AM.reduce((s, r, i) => qadd(s, r[i]), Q0);
      c[n - k] = qdiv(qneg(tr), { n: BigInt(k), d: 1n });
      Mk = AM.map((r, i) => r.map((v, j) => (i === j ? qadd(v, c[n - k]) : v)));
    }
    return add(...c.map((v, k) => mul(num(v), k ? (k === 1 ? L : { k: '^', b: L, e: num(k) } as Expr) : ONE)));
  }
  return expand(det(A.map((r, i) => r.map((v, j) => (i === j ? sub(L, v) : neg(v))))));
}

export function dot(a: Expr[], b: Expr[]): Expr {
  if (a.length !== b.length) fail('Wektory mają różne długości.');
  return add(...a.map((v, i) => mul(v, b[i])));
}
export function cross(a: Expr[], b: Expr[]): Expr[] {
  if (a.length !== 3 || b.length !== 3) fail('Iloczyn wektorowy jest określony dla wektorów w ℝ³.');
  return [sub(mul(a[1], b[2]), mul(a[2], b[1])), sub(mul(a[2], b[0]), mul(a[0], b[2])), sub(mul(a[0], b[1]), mul(a[1], b[0]))];
}
