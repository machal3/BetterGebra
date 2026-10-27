/**
 * MATLAB's matrix functions: lu, qr, chol, svd, eig, cond, norm, pinv, expm, null, orth, double, and det, inv, rank
 * of approximate matrices. Exact where exact arithmetic gives the answer (LU, LDLᵀ-Cholesky and Gram–Schmidt over ℚ,
 * pinv from a full-rank factorization, singular values and eigenvalues from the characteristic polynomial, expm by
 * Hermite interpolation); in floating point otherwise (dense.ts). Each numeric result is checked by its residual and
 * not shown when the check fails; each exact one is checked against the numeric one where they could disagree.
 */
import { E, Expr, I, INF, ONE, ZERO, add, children, div, fn, hasSym, infSign, isConstant, isNum, mul, num, pow, size, sub } from './expr';
import { Value, approxValue, ex, fromMat, isApprox, toMat } from './evaluate';
import { grid, valueOf } from './arrays';
import * as D from './dense';
import * as LA from './matrix';
import { approx } from './numeric';
import { polyOf, solvePoly } from './poly';
import { fail } from './q';
import { simplify } from './simplify';

/** A card: rows of name = value, and what was checked. */
export interface Card { title: string; rows: [string, Value][]; note?: string }
/** cards to show; outputs as [a, b, …] = f(A) assigns them, the first one also the value of f(A). */
export interface Linalg { cards: Card[]; outputs: Value[] }
type Command = (args: Value[], nout: number) => Linalg | null;

const tidy = (e: Expr) => { try { return simplify(e); } catch { return e; } };
const exactOf = (m: Expr[][]): Value => valueOf(m.map(r => r.map(tidy)));
/** A matrix as a value that stays a matrix (a 1×n result too, as the rows of a decomposition). */
const asMatrix = (m: Expr[][], approxed = false): Value => (approxed ? { t: 'matrix', rows: m, approx: true } : { t: 'matrix', rows: m.map(r => r.map(tidy)) });
const numMatrix = (M: D.Mat): Value => {
  const v = fromMat(M);
  return v.t === 'matrix' ? v : { t: 'matrix', rows: [(v.t === 'list' ? v.items.map(i => (i as { e: Expr }).e) : [(v as { e: Expr }).e])], approx: true };
};
const column = (es: Expr[], approxed: boolean): Value => (approxed ? approxValue({ t: 'matrix', rows: es.map(e => [e]) }) : { t: 'matrix', rows: es.map(e => [tidy(e)]) });
const absOf = (e: Expr) => { if (isNum(e)) return Math.abs(Number(e.v.n) / Number(e.v.d)); const z = approx(e); return Math.hypot(z.re, z.im); };
const dims = (m: Expr[][]): [number, number] => [m.length, m[0]?.length ?? 0];

/** The entries of a value that is a matrix of numbers known exactly; null for approximate or symbolic ones. */
function exactMatrix(v: Value): Expr[][] | null {
  if (isApprox(v) || (v.t !== 'matrix' && v.t !== 'list')) return null;
  const m = grid(v, 'Macierz');
  return m.length && m.every(r => r.every(isConstant)) ? m : null;
}
const isRational = (m: Expr[][]) => m.every(r => r.every(isNum));
function numeric(v: Value, what: string): D.Mat {
  const m = grid(v, what);
  if (!m.length) fail(`${what}: macierz jest pusta.`);
  return toMat(m, what);
}
function square(m: unknown[][], what: string) {
  if (m.length !== (m[0]?.length ?? 0)) fail(`${what}: macierz musi być kwadratowa (jest ${m.length}×${m[0]?.length ?? 0}).`);
}
const SUP: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
/** 2.2e-16 as "2·10⁻¹⁶", for the notes. */
export function tiny(x: number): string {
  if (x === 0) return '0';
  if (x >= 0.01 && x < 1000) return String(Number(x.toPrecision(2))).replace('.', ',');
  const [m, e] = x.toExponential(0).split('e');
  return `${m}·10${[...String(Number(e))].map(c => SUP[c]).join('')}`;
}
const checked = (what: string, err: number, tol: number) => {
  if (!(err <= tol)) fail(`Wynik numeryczny nie przeszedł sprawdzenia (${what} ≈ ${tiny(err)}), więc go nie podaję.`);
  return `Numerycznie (podwójna precyzja); sprawdzone: ${what} ≈ ${tiny(err)}.`;
};
const sigmaMat = (S: number[], n: number, m: number): D.Mat => D.zeros(n, m).map((r, i) => r.map((_, j) => (i === j ? S[i] ?? 0 : 0)));

// --- Exact spectra from the characteristic polynomial ---

/** Readable: numbers and roots, short; not cos(arccos(…)/3), which MATLAB's users want as digits. */
const readable = (e: Expr): boolean => size(e) <= 40 && (function plain(x: Expr): boolean { return x.k !== 'f' && children(x).every(plain); })(e);
/**
 * The eigenvalues of an exact square matrix, each as often as it is a root, or null when one has no readable closed
 * form (eigenvalues(A) gives those too).
 */
function exactEigenvalues(A: Expr[][]): Expr[] | null {
  if (A.length > 8) return null;
  let p;
  try { p = polyOf(LA.charpoly(A, 'λ'), 'λ'); } catch { return null; }
  if (!p) return null;
  const roots = solvePoly(p);
  if (roots.some(r => !r.exact || !readable(r.exact))) return null;
  const key = (e: Expr) => { const z = approx(e); return [z.re, z.im]; };
  return roots.flatMap(r => Array<Expr>(r.mult).fill(r.exact!)).map(tidy).sort((a, b) => { const [p1, q1] = key(a), [p2, q2] = key(b); return p1 - p2 || q1 - q2; });
}
/** Singular values exactly (√ of the eigenvalues of AᴴA), when the numbers agree with the numeric ones. */
function exactSingular(A: Expr[][], S: number[]): Expr[] | null {
  const [n, m] = dims(A);
  if (Math.min(n, m) > 6) return null;
  const B = n >= m ? LA.matMulE(LA.adjoint(A), A) : LA.matMulE(A, LA.adjoint(A));
  const lams = exactEigenvalues(B);
  if (!lams) return null;
  const sig = lams.map(l => tidy(pow(l, num(1, 2)))).sort((a, b) => absOf(b) - absOf(a));
  if (!sig.every(readable)) return null;
  const scale = S[0] || 1;
  return sig.every((s, k) => { const z = approx(s); return Math.abs(z.im) < 1e-12 * scale && Math.abs(z.re - (S[k] ?? 0)) <= 1e-9 * scale; }) ? sig : null;
}

// --- The commands ---

export const LINALG: Record<string, Command> = {
  lu: ([v], nout) => {
    const A = exactMatrix(v);
    let L: Value, U: Value, P: Value, note: string, PtL: Value;
    if (A) {
      const r = LA.luExact(A, absOf);
      [L, U, P] = [asMatrix(r.L), asMatrix(r.U), asMatrix(r.P)];
      PtL = asMatrix(LA.matMulE(LA.transpose(r.P), r.L));
      note = 'Dokładnie: P·A = L·U, w każdej kolumnie element główny o największym module (jak w MATLAB-ie).';
    } else {
      const M = numeric(v, 'lu'), r = D.lu(M);
      note = checked('‖P·A − L·U‖/‖A‖', D.relErr(D.mul(r.P, M), D.mul(r.L, r.U)), 1e-12);
      [L, U, P] = [numMatrix(r.L), numMatrix(r.U), asMatrix(r.P.map(row => row.map(x => num(x))))];
      PtL = numMatrix(D.mul(D.transpose(r.P), r.L));
    }
    return { cards: [{ title: 'Rozkład LU z wyborem elementu głównego', rows: [['L', L], ['U', U], ['P', P]], note }], outputs: nout >= 3 ? [L, U, P] : nout === 2 ? [PtL, U] : [U] };
  },
  qr: ([v], nout) => {
    const A = exactMatrix(v);
    const e = A && isRational(A) && A.length * A[0].length <= 36 ? LA.qrExact(A) : null;
    if (e) {
      const [Q, R] = [asMatrix(e.Q), asMatrix(e.R)];
      return { cards: [{ title: 'Rozkład QR', rows: [['Q', Q], ['R', R]], note: 'Dokładnie (Gram–Schmidt): kolumny Q są ortonormalne, R jest górna trójkątna z dodatnią przekątną. To rozkład ekonomiczny; MATLAB daje go poleceniem qr(A, 0), z dokładnością do znaków.' }], outputs: nout >= 2 ? [Q, R] : [R] };
    }
    const M = numeric(v, 'qr'), { Q, R } = D.qr(M);
    const note = checked('‖A − Q·R‖/‖A‖', Math.max(D.relErr(M, D.mul(Q, R)), D.relErr(D.eye(Q.length), D.mul(D.transpose(Q), Q))), 1e-12);
    const [Qv, Rv] = [numMatrix(Q), numMatrix(R)];
    return { cards: [{ title: 'Rozkład QR (Householder)', rows: [['Q', Qv], ['R', Rv]], note: `${note} Q jest ortogonalna; znaki kolumn mogą się różnić od MATLAB-a.` }], outputs: nout >= 2 ? [Qv, Rv] : [Rv] };
  },
  chol: ([v]) => {
    const A = exactMatrix(v);
    if (A) square(A, 'chol');
    if (A && isRational(A)) {
      const R = LA.cholExact(A);
      if (!R) fail('chol: macierz nie jest dodatnio określona (A = Rᵀ·R nie istnieje).');
      const Rv = asMatrix(R!);
      return { cards: [{ title: 'Rozkład Choleskiego A = Rᵀ·R', rows: [['R', Rv]], note: 'Dokładnie, przez A = L·D·Lᵀ nad ℚ: R = √D·Lᵀ.' }], outputs: [Rv] };
    }
    const M = numeric(v, 'chol');
    square(M, 'chol');
    const R = D.chol(M);
    if (!R) fail('chol: macierz nie jest symetryczna i dodatnio określona.');
    const Rv = numMatrix(R!);
    return { cards: [{ title: 'Rozkład Choleskiego A = Rᵀ·R', rows: [['R', Rv]], note: checked('‖A − Rᵀ·R‖/‖A‖', D.relErr(M, D.mul(D.transpose(R!), R!)), 1e-12) }], outputs: [Rv] };
  },
  svd: ([v], nout) => {
    const M = numeric(v, 'svd'), [n, m] = [M.length, M[0].length];
    const { U, S, V } = D.svd(M);
    const note = checked('‖A − U·Σ·Vᵀ‖/‖A‖', D.relErr(M, D.mul(D.mul(U, sigmaMat(S, n, m)), D.transpose(V))), 1e-12);
    const A = exactMatrix(v), sig = A ? exactSingular(A, S) : null;
    const values = sig ? column(sig, false) : column(S.map(fromNum), true);
    const [Uv, Sv, Vv] = [numMatrix(U), numMatrix(sigmaMat(S, n, m)), numMatrix(V)];
    return {
      cards: [
        { title: 'Wartości szczególne', rows: [['σ', values]], note: sig ? 'Dokładnie: pierwiastki wartości własnych AᵀA, zgodne z obliczeniem numerycznym.' : undefined },
        { title: 'Rozkład A = U·Σ·Vᵀ', rows: [['U', Uv], ['Σ', Sv], ['V', Vv]], note: `${note} Kolumny U i V są ortonormalne; ich znaki mogą się różnić od MATLAB-a.` },
      ],
      outputs: nout >= 3 ? [Uv, Sv, Vv] : [values],
    };
  },
  eig: ([v], nout) => {
    const A = exactMatrix(v);
    if (A) {
      square(A, 'eig');
      const lams = exactEigenvalues(A);
      if (lams) {
        const values = column(lams, false);
        const Vm = exactEigenvectors(A, lams);
        const cards: Card[] = [{ title: 'Wartości własne', rows: [['λ', values]], note: 'Dokładnie: pierwiastki wielomianu charakterystycznego, z krotnościami.' }];
        if (Vm) {
          const Dm = lams.map((l, i) => lams.map((_, j) => (i === j ? l : ZERO)));
          cards.push({ title: 'Wektory własne: A·V = V·D', rows: [['V', asMatrix(Vm)], ['D', asMatrix(Dm)]], note: 'Kolumny V to wektory własne (dokładne, nieunormowane; MATLAB normuje je do długości 1).' });
          return { cards, outputs: nout >= 2 ? [asMatrix(Vm), asMatrix(Dm)] : [values] };
        }
        if (nout < 2) return { cards: [...cards, { title: 'Wektory własne', rows: [], note: 'Macierz nie jest diagonalizowalna: wektorów własnych jest mniej niż wymiar.' }], outputs: [values] };
      }
    }
    const M = numeric(v, 'eig');
    square(M, 'eig');
    const n = M.length;
    let lams: D.C[], vecs: D.C[][], residual: number;
    if (D.relErr(M, D.transpose(M)) === 0) {
      const e = D.eigSym(M);
      lams = e.values.map(x => [x, 0]);
      vecs = D.transpose(e.vectors).map(c => c.map(x => [x, 0] as D.C));
      residual = Math.max(0, ...vecs.map((x, k) => Math.hypot(...M.map((row, i) => row.reduce((s, a, j) => s + a * x[j][0], 0) - lams[k][0] * x[i][0])))) / (D.normFro(M) || 1);
    } else {
      lams = D.eigenvalues(M).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      ({ vectors: vecs, residual } = D.eigenvectors(M, lams));
    }
    const note = checked('max ‖A·v − λ·v‖/‖A‖', residual, 1e-10);
    const cnum = ([re, im]: D.C): Expr => (Math.abs(im) > 1e-14 * Math.max(1, Math.abs(re)) ? add(fromNum(re), mul(I, fromNum(im))) : fromNum(re));
    const values = column(lams.map(cnum), true);
    const Vm = Array.from({ length: n }, (_, i) => vecs.map(x => cnum(x[i])));
    const Dm = lams.map((l, i) => lams.map((_, j) => (i === j ? cnum(l) : ZERO)));
    const [Vv, Dv] = [approxValue({ t: 'matrix', rows: Vm }), approxValue({ t: 'matrix', rows: Dm })];
    return {
      cards: [
        { title: 'Wartości własne', rows: [['λ', values]], note },
        { title: 'Wektory własne: A·V = V·D', rows: [['V', Vv], ['D', Dv]], note: 'Kolumny V mają długość 1; największa współrzędna jest dodatnia.' },
      ],
      outputs: nout >= 2 ? [Vv, Dv] : [values],
    };
  },
  cond: ([v, p0]) => {
    const p = normKind(p0);
    const A = exactMatrix(v);
    if (A && (p === '1' || p === 'inf' || p === 'fro')) {
      square(A, 'cond');
      let inv: Expr[][];
      try { inv = LA.inverse(A); } catch { return condOf(ex(INF), false, 'Macierz jest osobliwa: wskaźnik uwarunkowania jest nieskończony.'); }
      return condOf(ex(tidy(mul(matrixNorm(A, p), matrixNorm(inv, p)))), false, `Dokładnie: ‖A‖·‖A⁻¹‖ w normie ${p === 'fro' ? 'Frobeniusa' : p === '1' ? 1 : '∞'}.`);
    }
    const M = numeric(v, 'cond'), S = D.svd(M).S, k = Math.min(M.length, M[0].length);
    if (p !== '2') {
      square(M, 'cond');
      const inv = D.inverse(M);
      if (!inv) return condOf(ex(INF), false, 'Macierz jest (numerycznie) osobliwa.');
      const nn = (X: D.Mat) => (p === '1' ? D.norm1(X) : p === 'inf' ? D.normInf(X) : D.normFro(X));
      return condOf(ex(fromNum(nn(M) * nn(inv))), true);
    }
    const sig = A ? exactSingular(A, S) : null;
    if (sig) {
      if (absOf(sig[k - 1]) === 0) return condOf(ex(INF), false, 'Macierz jest osobliwa (najmniejsza wartość szczególna to 0).');
      return condOf(ex(tidy(div(sig[0], sig[k - 1]))), false, 'Dokładnie: σ_max/σ_min.');
    }
    const ratio = S[k - 1] > 0 ? S[0] / S[k - 1] : Infinity;
    return condOf(ex(Number.isFinite(ratio) ? fromNum(ratio) : INF), Number.isFinite(ratio), Number.isFinite(ratio) ? undefined : 'Macierz jest (numerycznie) osobliwa.');
  },
  norm: ([v, p0]) => {
    const p = normKind(p0);
    const m = grid(v, 'norm'), ap = isApprox(v), vector = m.length === 1 || m[0]?.length === 1;
    if (!m.length) return normOf(ex(ZERO), false);
    if (vector) {
      const xs = m.flat().map(x => fn('abs', x));
      // |x|² is x² for a variable (variables are real)
      const squares = m.flat().map(x => (isConstant(x) || hasSym(x, 'i') ? pow(fn('abs', x), num(2)) : pow(x, num(2))));
      const e = p === '1' ? add(...xs) : p === 'inf' ? fn('max', ...xs) : p === '-inf' ? fn('min', ...xs) : p === '2' || p === 'fro' ? pow(add(...squares), num(1, 2))
        : pow(add(...xs.map(x => pow(x, p as Expr))), div(ONE, p as Expr));
      return normOf(ap ? approxValue(ex(tidy(e))) : ex(tidy(e)), ap);
    }
    if (p !== '2' && typeof p !== 'string') fail("norm macierzy: 1, 2, inf albo 'fro'.");
    if (p === '-inf') fail("norm macierzy: 1, 2, inf albo 'fro'.");
    if (p !== '2') { const e = tidy(matrixNorm(m, p as '1' | 'inf' | 'fro')); return normOf(ap ? approxValue(ex(e)) : ex(e), ap); }
    const S = D.svd(numeric(v, 'norm')).S, A = exactMatrix(v), sig = A ? exactSingular(A, S) : null;
    return sig ? normOf(ex(sig[0]), false, 'Dokładnie: największa wartość szczególna.') : normOf(ex(fromNum(S[0])), true, 'Największa wartość szczególna.');
  },
  pinv: ([v]) => {
    const A = exactMatrix(v);
    if (A) {
      const X = LA.pinvExact(A);
      if (LA.isPinv(A, X)) {
        const Xv = exactOf(X);
        return { cards: [{ title: 'Pseudoodwrotność Moore’a–Penrose’a', rows: [['A⁺', Xv]], note: 'Dokładnie, z rozkładu A = F·G; spełnia cztery równania Penrose’a (sprawdzone dokładnie).' }], outputs: [Xv] };
      }
    }
    const M = numeric(v, 'pinv'), X = D.pinv(M);
    const note = checked('‖A·A⁺·A − A‖/‖A‖', D.relErr(M, D.mul(D.mul(M, X), M)), 1e-10);
    const Xv = fromMat(X);
    return { cards: [{ title: 'Pseudoodwrotność Moore’a–Penrose’a', rows: [['A⁺', Xv]], note }], outputs: [Xv] };
  },
  expm: ([v]) => {
    const M = numeric(v, 'expm');
    square(M, 'expm');
    const E = D.expm(M), A = exactMatrix(v);
    const exact = A && isRational(A) && A.length <= 4 ? exactExpm(A, E) : null;
    if (exact) {
      const Ev = asMatrix(exact);
      return { cards: [{ title: 'Eksponenta macierzy', rows: [['e^A', Ev]], note: 'Dokładnie: e^A = p(A), gdzie p interpoluje eᶻ w wartościach własnych (z krotnościami); zgodne z obliczeniem numerycznym.' }], outputs: [Ev] };
    }
    const half = D.expm(M.map(r => r.map(x => x / 2)));
    const note = checked('różnica e^A i (e^(A/2))², względnie', D.relErr(E, D.mul(half, half)), 1e-8);
    const Ev = numMatrix(E);
    return { cards: [{ title: 'Eksponenta macierzy', rows: [['e^A', Ev]], note: `${note} Metoda: aproksymacja Padé stopnia 13 ze skalowaniem i potęgowaniem.` }], outputs: [Ev] };
  },
  null: ([v]) => {
    const A = exactMatrix(v);
    if (A) {
      const ns = LA.nullspace(A);
      if (!ns.length) return { cards: [{ title: 'Jądro', rows: [], note: 'Jądro jest zerowe: kolumny są liniowo niezależne.' }], outputs: [{ t: 'list', items: [], set: false }] };
      const B = asMatrix(Array.from({ length: A[0].length }, (_, i) => ns.map(c => c[i])));
      return { cards: [{ title: `Baza jądra (wymiar ${ns.length})`, rows: [['N', B]], note: 'Dokładnie: baza wymierna, A·N = 0 (jak null(A, "r") w MATLAB-ie; null(A) daje bazę ortonormalną).' }], outputs: [B] };
    }
    const M = numeric(v, 'null'), { S, V } = D.svd(M), r = D.rank(M, S), m = M[0].length;
    if (r === m) return { cards: [{ title: 'Jądro', rows: [], note: 'Jądro jest (numerycznie) zerowe.' }], outputs: [{ t: 'list', items: [], set: false }] };
    const N = V.map(row => row.slice(r));
    const B = numMatrix(N);
    return { cards: [{ title: `Ortonormalna baza jądra (wymiar ${m - r})`, rows: [['N', B]], note: checked('‖A·N‖/‖A‖', D.normFro(D.mul(M, N)) / (D.normFro(M) || 1), 1e-12) }], outputs: [B] };
  },
  orth: ([v]) => {
    const M = numeric(v, 'orth'), { U, S } = D.svd(M), r = D.rank(M, S);
    const B = numMatrix(U.map(row => row.slice(0, r)));
    return { cards: [{ title: `Ortonormalna baza przestrzeni kolumn (wymiar ${r})`, rows: [['Q', B]], note: 'Numerycznie, z rozkładu SVD: pierwsze kolumny U.' }], outputs: [B] };
  },
  double: ([v]) => {
    if (v.t === 'fn' || v.t === 'str' || v.t === 'rel') fail('double: oczekuję liczby, wektora albo macierzy.');
    const out = approxValue(v);
    return { cards: [{ title: 'Wartość przybliżona (double)', rows: [['', out]], note: 'Dalej liczona jak w MATLAB-ie: w arytmetyce zmiennoprzecinkowej podwójnej precyzji.' }], outputs: [out] };
  },
  // det, inv, rank of approximate matrices; exact ones go on as before (null: not handled here)
  det: ([v]) => {
    if (!isApprox(v)) return null;
    const M = numeric(v, 'det'); square(M, 'Wyznacznik');
    const d = ex(fromNum(D.det(M)));
    return { cards: [{ title: 'Wyznacznik', rows: [['det A', approxValue(d)]], note: 'Numerycznie, z rozkładu LU.' }], outputs: [approxValue(d)] };
  },
  inverse: ([v]) => {
    if (!isApprox(v)) return null;
    const M = numeric(v, 'inv'); square(M, 'Macierz odwrotna');
    const X = D.inverse(M);
    if (!X) fail('Macierz jest (numerycznie) osobliwa, nie ma odwrotnej.');
    const S = D.svd(M).S, c = S[0] / S[S.length - 1];
    const note = checked('‖A·X − I‖', D.normFro(D.minus(D.mul(M, X!), D.eye(M.length))), 1e-8 * Math.max(1, c * D.EPS * 1e8));
    return { cards: [{ title: 'Macierz odwrotna', rows: [['A⁻¹', numMatrix(X!)]], note: c > 1e10 ? `${note} Uwaga: macierz jest źle uwarunkowana (cond ≈ ${tiny(c)}), więc część cyfr może być niedokładna.` : note }], outputs: [numMatrix(X!)] };
  },
  rank: ([v]) => {
    if (!isApprox(v)) return null;
    const M = numeric(v, 'rank');
    return { cards: [{ title: 'Rząd (numeryczny)', rows: [['rank A', ex(num(D.rank(M)))]], note: 'Liczba wartości szczególnych większych od max(m, n)·eps·σ₁, jak w MATLAB-ie.' }], outputs: [ex(num(D.rank(M)))] };
  },
};

const fromNum = (x: number): Expr => (fromMat([[x]]) as { e: Expr }).e;
const condOf = (v: Value, ap: boolean, note?: string): Linalg => {
  const out = ap ? approxValue(v) : v;
  const big = v.t === 'expr' && isConstant(v.e) ? approx(v.e).re : NaN;
  const hint = Number.isFinite(big) && big >= 100 ? ` Rozwiązując A·x = b w arytmetyce zmiennoprzecinkowej, można stracić około ${Math.round(Math.log10(big))} cyfr dokładności.` : '';
  return { cards: [{ title: 'Wskaźnik uwarunkowania', rows: [['cond A', out]], note: `${note ?? 'Numerycznie: σ_max/σ_min.'}${hint}` }], outputs: [out] };
};
const normOf = (v: Value, ap: boolean, note?: string): Linalg => {
  const out = ap ? approxValue(v) : v;
  return { cards: [{ title: 'Norma', rows: [['‖A‖', out]], note }], outputs: [out] };
};

type NormKind = '1' | '2' | 'inf' | '-inf' | 'fro' | Expr;
function normKind(p: Value | undefined): NormKind {
  if (!p) return '2';
  if (p.t === 'str') {
    if (p.s === 'fro') return 'fro';
    if (p.s === 'inf') return 'inf';
    return fail("Rodzaj normy: 1, 2, inf, -inf, liczba p albo 'fro'.");
  }
  if (p.t !== 'expr') return fail("Rodzaj normy: 1, 2, inf, -inf, liczba p albo 'fro'.");
  const e = p.e;
  if (infSign(e)) return infSign(e) > 0 ? 'inf' : '-inf';
  if (isNum(e) && e.v.d === 1n && (e.v.n === 1n || e.v.n === 2n)) return e.v.n === 1n ? '1' : '2';
  if (!isConstant(e) || !(approx(e).re > 0)) fail('Norma p: p musi być liczbą dodatnią.');
  return e;
}
/** ‖A‖₁ (largest column sum), ‖A‖∞ (largest row sum), ‖A‖_F, exactly. */
function matrixNorm(A: Expr[][], p: '1' | 'inf' | 'fro'): Expr {
  if (p === 'fro') return pow(add(...A.flat().map(x => pow(fn('abs', x), num(2)))), num(1, 2));
  const lines = p === '1' ? LA.transpose(A) : A;
  return fn('max', ...lines.map(l => add(...l.map(x => fn('abs', x)))));
}

/** Eigenvectors for exact eigenvalues, when there are as many as the size (the matrix is diagonalizable). */
function exactEigenvectors(A: Expr[][], lams: Expr[]): Expr[][] | null {
  const n = A.length, cols: Expr[][] = [];
  const seen: Expr[] = [];
  for (const l of lams) {
    if (seen.some(s => !LA.nonzero(sub(s, l)))) continue;
    seen.push(l);
    let ns: Expr[][];
    try { ns = LA.nullspace(A.map((r, i) => r.map((x, j) => (i === j ? sub(x, l) : x)))); } catch { return null; }
    const mult = lams.filter(x => !LA.nonzero(sub(x, l))).length;
    if (ns.length !== mult) return null;
    for (const v of ns) {
      // A·v = λ·v, numerically, before it is shown
      const Av = LA.matMulE(A, v.map(c => [c])).map(c => c[0]);
      if (!Av.every((c, i) => { const z = approx(sub(c, mul(l, v[i]))); return Math.hypot(z.re, z.im) < 1e-9; })) return null;
      cols.push(v.map(tidy));
    }
  }
  return cols.length === n ? Array.from({ length: n }, (_, i) => cols.map(c => c[i])) : null;
}

/**
 * e^A exactly for a small rational matrix: the polynomial p of degree < n with p⁽ʲ⁾(λ) = e^λ for each eigenvalue λ
 * and j below its multiplicity, then e^A = p(A). null when an eigenvalue has no closed form, the result is not real,
 * or it disagrees with the numeric E.
 */
function exactExpm(A: Expr[][], En: D.Mat): Expr[][] | null {
  const n = A.length, lams = exactEigenvalues(A);
  if (!lams) return null;
  const distinct: [Expr, number][] = [];
  for (const l of lams) { const d = distinct.find(([x]) => !LA.nonzero(sub(x, l))); if (d) d[1]++; else distinct.push([l, 1]); }
  const fall = (k: number, j: number) => { let f = 1; for (let i = 0; i < j; i++) f *= k - i; return f; };
  const rows: Expr[][] = [], rhs: Expr[][] = [];
  for (const [l, mult] of distinct) for (let j = 0; j < mult; j++) {
    rows.push(Array.from({ length: n }, (_, k) => (k < j ? ZERO : k === j ? num(fall(k, j)) : mul(num(fall(k, j)), pow(l, num(k - j))))));
    rhs.push([pow(E, l)]);
  }
  let c: Expr[][];
  try { c = LA.leftSolve(rows, rhs); } catch { return null; }
  let P: Expr[][] = A.map((_, i) => A.map((__, j) => (i === j ? ONE : ZERO)));
  let out: Expr[][] = P.map(r => r.map(() => ZERO));
  for (let k = 0; k < n; k++) {
    out = out.map((r, i) => r.map((x, j) => add(x, mul(c[k][0], P[i][j]))));
    P = LA.matMulE(P, A);
  }
  out = out.map(r => r.map(tidy));
  if (out.some(r => r.some(x => hasSym(x, 'i')))) return null;
  return out.every((r, i) => r.every((x, j) => { const z = approx(x); return Math.abs(z.im) < 1e-12 && Math.abs(z.re - En[i][j]) <= 1e-9 * (1 + Math.abs(En[i][j])); })) ? out : null;
}
