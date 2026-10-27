/**
 * Linear algebra. Matrices of rationals go through exact fraction arithmetic; symbolic entries through
 * expressions, with a pivot accepted only when it is provably nonzero after expansion.
 */
import { Expr, ONE, ZERO, add, div, expand, fn, isConstant, isNum, isZero, mul, neg, num, sub, sym, together } from './expr';
import { cancel } from './simplify';
import { identityM, matMul } from './evaluate';
import { Q, Q0, Q1, fail, qadd, qdiv, qmul, qneg, qsub } from './q';

export type M = Expr[][];
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
