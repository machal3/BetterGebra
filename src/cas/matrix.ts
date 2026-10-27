/**
 * Linear algebra. Matrices of rationals go through exact fraction arithmetic; symbolic entries through
 * expressions, with a pivot accepted only when it is provably nonzero after expansion.
 */
import { Expr, ONE, ZERO, add, div, expand, fn, isConstant, isNum, isZero, mul, neg, num, sub, sym, together } from './expr';
import { cancel } from './simplify';
import { identityM, matMul } from './evaluate';
import { Q, Q0, Q1, fail, qadd, qdiv, qmul, qneg, qsub } from './q';

export type M = Expr[][];
export { matMul as matMulE };
const isQM = (m: M) => m.every(r => r.every(isNum));
const toQ = (m: M): Q[][] => m.map(r => r.map(e => (e as { v: Q }).v));
const fromQ = (m: Q[][]): M => m.map(r => r.map(v => num(v)));
export const nonzero = (e: Expr) => !isZero(e) && !isZero(expand(e)) && !isZero(cancel(together(e)));
const clean = (e: Expr) => { const c = cancel(together(e)); return c; };

export function square(m: M, what: string): number {
  if (m.length !== m[0].length) fail(`${what}: macierz musi być kwadratowa (jest ${m.length}×${m[0].length}).`);
  return m.length;
}

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
export const transpose = (A: M): M => A[0].map((_, j) => A.map(r => r[j]));

/**
 * X with A·X = B, exactly: A square and invertible, or with more rows than columns the least-squares solution from
 * the normal equations AᵀA·X = AᵀB (in exact arithmetic they lose nothing, unlike in floats).
 */
export function leftSolve(A: M, B: M): M {
  const n = A.length, m = A[0].length;
  if (n < m) fail('A\\b: równań jest mniej niż niewiadomych, więc rozwiązań jest nieskończenie wiele. Użyj rref albo solve.');
  let L = A, Rt = B;
  // Aᴴ: complex numbers conjugated, variables are real
  if (n > m) { const At = transpose(A).map(r => r.map(e => (isConstant(e) ? fn('conj', e) : e))); L = matMul(At, A); Rt = matMul(At, B); }
  const { R, pivots } = rref(L.map((r, i) => [...r, ...Rt[i]]));
  if (pivots.length < m || pivots[m - 1] !== m - 1) {
    fail(n > m ? 'A\\b: kolumny A są liniowo zależne, więc rozwiązanie najmniejszych kwadratów nie jest jednoznaczne.' : 'A\\b: macierz jest osobliwa (det = 0), układ nie ma jednoznacznego rozwiązania.');
  }
  return R.slice(0, m).map(r => r.slice(m).map(clean));
}
export const rank = (A: M) => rref(A).pivots.length;
export function trace(A: M): Expr { square(A, 'Ślad'); return add(...A.map((r, i) => r[i])); }

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

// --- Exact factorizations (MATLAB's lu, chol, qr, pinv where exact arithmetic can give them) ---

/** |e| roughly, to choose pivots as MATLAB does (the largest); 0 for an expression with letters. */
const magnitude = (e: Expr, approxAbs: (e: Expr) => number) => (isConstant(e) ? approxAbs(e) : 0);

/** P·A = L·U by elimination with the largest pivot of each column (provably nonzero), exactly. */
export function luExact(A: M, approxAbs: (e: Expr) => number): { L: M; U: M; P: M } {
  const n = A.length, m = A[0].length, k = Math.min(n, m);
  const W = A.map(r => r.map(clean)), L: M = Array.from({ length: n }, () => Array<Expr>(k).fill(ZERO));
  const perm = [...Array(n).keys()];
  for (let j = 0; j < k; j++) {
    let p = -1, best = -1;
    for (let i = j; i < n; i++) {
      if (!nonzero(W[i][j])) continue;
      const g = magnitude(W[i][j], approxAbs);
      if (p < 0 || g > best) { p = i; best = g; }
    }
    if (p < 0) continue;
    [W[p], W[j]] = [W[j], W[p]]; [L[p], L[j]] = [L[j], L[p]]; [perm[p], perm[j]] = [perm[j], perm[p]];
    for (let i = j + 1; i < n; i++) {
      if (!nonzero(W[i][j])) { W[i][j] = ZERO; continue; }
      const f = clean(div(W[i][j], W[j][j]));
      L[i][j] = f;
      W[i] = W[i].map((v, c) => (c < j ? v : c === j ? ZERO : clean(sub(v, mul(f, W[j][c])))));
    }
  }
  for (let i = 0; i < k; i++) L[i][i] = ONE;
  const U = W.slice(0, k).map((r, i) => r.map((v, j) => (j < i ? ZERO : v)));
  const P: M = perm.map(r => Array.from({ length: n }, (_, c) => (c === r ? ONE : ZERO)));
  return { L, U, P };
}

/**
 * A = Rᵀ·R for a symmetric matrix of rationals, through A = L·D·Lᵀ over ℚ: R = √D·Lᵀ, so each entry has one square
 * root at most. null when A is not positive definite.
 */
export function cholExact(A: M): M | null {
  if (!isQM(A)) fail('chol: dokładnie liczę dla macierzy liczb wymiernych.');
  const n = A.length, a = toQ(A);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) if (qsub(a[i][j], a[j][i]).n) fail('chol: macierz nie jest symetryczna.');
  const d: Q[] = [], L: Q[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? Q1 : Q0)));
  for (let j = 0; j < n; j++) {
    let dj = a[j][j];
    for (let k = 0; k < j; k++) dj = qsub(dj, qmul(qmul(L[j][k], L[j][k]), d[k]));
    if (dj.n <= 0n) return null;
    d.push(dj);
    for (let i = j + 1; i < n; i++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s = qsub(s, qmul(qmul(L[i][k], L[j][k]), d[k]));
      L[i][j] = qdiv(s, dj);
    }
  }
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (j < i ? ZERO : mul({ k: '^', b: num(d[i]), e: num(1, 2) } as Expr, num(L[j][i])))));
}

/**
 * The QR of the classroom, exactly: Gram–Schmidt on the columns of a rational matrix of full column rank, Q with
 * orthonormal columns (m×n), R upper triangular with a positive diagonal. null when the columns are dependent.
 */
export function qrExact(A: M): { Q: M; R: M } | null {
  if (!isQM(A)) return null;
  const a = toQ(A), m = a.length, n = a[0].length;
  const col = (j: number) => a.map(r => r[j]);
  const dotQ = (x: Q[], y: Q[]) => x.reduce((s, v, i) => qadd(s, qmul(v, y[i])), Q0);
  const vs: Q[][] = [], vv: Q[] = [];
  const R: M = Array.from({ length: n }, () => Array<Expr>(n).fill(ZERO));
  for (let j = 0; j < n; j++) {
    let v = col(j);
    for (let k = 0; k < j; k++) {
      const c = qdiv(dotQ(col(j), vs[k]), vv[k]);
      v = v.map((x, i) => qsub(x, qmul(c, vs[k][i])));
      // R(k, j) = aⱼ·qₖ = (aⱼ·vₖ)/‖vₖ‖
      R[k][j] = div(num(dotQ(col(j), vs[k])), { k: '^', b: num(vv[k]), e: num(1, 2) } as Expr);
    }
    const nn = dotQ(v, v);
    if (!nn.n) return null;
    vs.push(v); vv.push(nn);
    R[j][j] = { k: '^', b: num(nn), e: num(1, 2) } as Expr;
  }
  const Q: M = Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => div(num(vs[j][i]), { k: '^', b: num(vv[j]), e: num(1, 2) } as Expr)));
  return { Q, R };
}

/** Aᴴ: transposed, complex numbers conjugated (variables are real). */
export const adjoint = (A: M): M => transpose(A).map(r => r.map(e => (isConstant(e) ? fn('conj', e) : e)));

/**
 * The Moore–Penrose inverse, exactly, from a full-rank factorization A = F·G (F the pivot columns, G the rows of the
 * reduced echelon form): A⁺ = Gᴴ(G·Gᴴ)⁻¹(Fᴴ·F)⁻¹Fᴴ.
 */
export function pinvExact(A: M): M {
  const { R, pivots } = rref(A);
  const n = A.length, m = A[0].length, r = pivots.length;
  if (!r) return Array.from({ length: m }, () => Array<Expr>(n).fill(ZERO));
  const F = A.map(row => pivots.map(p => row[p])), G = R.slice(0, r);
  const X = matMul(matMul(matMul(adjoint(G), inverse(matMul(G, adjoint(G)))), inverse(matMul(adjoint(F), F))), adjoint(F));
  return X.map(row => row.map(clean));
}
/** Whether X is the Moore–Penrose inverse of A: the four Penrose equations, checked exactly. */
export function isPinv(A: M, X: M): boolean {
  const eq = (P: M, Q: M) => P.every((row, i) => row.every((v, j) => !nonzero(sub(v, Q[i][j]))));
  const AX = matMul(A, X), XA = matMul(X, A);
  return eq(matMul(AX, A), A) && eq(matMul(XA, X), X) && eq(adjoint(AX), AX) && eq(adjoint(XA), XA);
}
