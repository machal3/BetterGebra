/**
 * MATLAB's functions that build, reshape, ask about and reduce vectors and matrices: zeros, linspace, magic,
 * reshape, size, find, sum, cumsum, sort … Exact: entries stay rationals, roots and π, as the rest of the engine.
 * A list is a row (1×n), a matrix with one column a column; reductions follow MATLAB: a vector to a number, a matrix
 * column by column (or along the dimension asked for).
 */
import { Expr, ONE, ZERO, add, div, isInt, isNum, mul, num, pow, sub } from './expr';
import { Value, ex, fromRows } from './evaluate';
import { constSign } from './functions';
import { fail } from './q';

type Grid = Expr[][];
interface Done { value: Value; title: string; note?: string }

const MAX_CELLS = 100_000;
const transpose = (m: Grid): Grid => (m[0] ?? []).map((_, j) => m.map(r => r[j]));

/** A value as rows of entries: a number is 1×1, a list one row, [] is 0×0. */
export function grid(v: Value, what: string): Grid {
  if (v.t === 'expr') return [[v.e]];
  if (v.t === 'matrix') return v.rows;
  if (v.t === 'list' && v.items.every(i => i.t === 'expr')) return v.items.length ? [v.items.map(i => (i as { e: Expr }).e)] : [];
  return fail(`${what}: oczekuję liczby, wektora albo macierzy.`);
}
/** Rows as a value: 1×1 a number, one row a list, nothing an empty list. */
export function valueOf(m: Grid): Value {
  if (!m.length || !m[0].length) return { t: 'list', items: [], set: false };
  if (m.length === 1 && m[0].length === 1) return ex(m[0][0]);
  return fromRows(m);
}
const dims = (m: Grid): [number, number] => [m.length, m[0]?.length ?? 0];

function int(v: Value | undefined, what: string, min = 0, fallback?: number): number {
  if (!v) { if (fallback === undefined) fail(`${what}: brak argumentu.`); return fallback!; }
  const e = v.t === 'expr' ? v.e : null;
  if (!e || !isInt(e) || e.v.n > 10n ** 9n || e.v.n < -(10n ** 9n)) return fail(`${what}: oczekuję liczby całkowitej.`);
  const k = Number((e as { v: { n: bigint } }).v.n);
  if (k < min) fail(`${what}: najmniej ${min}.`);
  return k;
}
/** The size of zeros(n), zeros(n, m), zeros([n m]). */
function size2(vals: Value[], what: string): [number, number] {
  if (vals.length === 1 && vals[0].t === 'list') {
    const [a, b] = vals[0].items;
    if (vals[0].items.length !== 2) fail(`${what}: rozmiar to [wiersze kolumny].`);
    return [int(a, 'Liczba wierszy'), int(b, 'Liczba kolumn')];
  }
  const n = int(vals[0], 'Liczba wierszy'), m = vals[1] ? int(vals[1], 'Liczba kolumn') : n;
  if (n * m > MAX_CELLS) fail(`Macierz ma ponad ${MAX_CELLS.toLocaleString('pl-PL')} elementów.`);
  return [n, m];
}
const filled = (n: number, m: number, f: (i: number, j: number) => Expr): Grid => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => f(i, j)));

/** The dimension a reduction runs along: the one asked for, else the first longer than 1 (MATLAB's rule). */
function dimOf(m: Grid, v: Value | undefined): 1 | 2 {
  if (v) { const d = int(v, 'Wymiar', 1); if (d > 2) fail('Wymiar: 1 (kolumny) albo 2 (wiersze).'); return d as 1 | 2; }
  return m.length === 1 ? 2 : 1;
}
/** f of each column (dim 1) or row (dim 2): a vector gives a number, a matrix a row of results. */
function reduce(m: Grid, dim: 1 | 2, f: (xs: Expr[]) => Expr): Value {
  if (!m.length) return valueOf([[f([])]]);
  return valueOf(dim === 1 ? [transpose(m).map(f)] : m.map(r => [f(r)]));
}
/** f applied along each column or row, keeping the shape (cumsum, sort, diff shortens it). */
function along(m: Grid, dim: 1 | 2, f: (xs: Expr[]) => Expr[]): Value {
  if (!m.length) return valueOf([]);
  if (dim === 2) return valueOf(m.map(f));
  const cols = transpose(m).map(f);
  return cols[0].length ? valueOf(transpose(cols)) : valueOf([]);
}

/** The sign of a − b, or an error: comparing needs real numbers. */
function compare(a: Expr, b: Expr): number {
  const s = constSign(sub(a, b));
  if (s === null) fail('Porównuję tylko liczby rzeczywiste.');
  return s!;
}
const truth = (x: Expr): boolean => {
  const s = constSign(x);
  if (s === null) fail('Prawda i fałsz: oczekuję liczb (0 to fałsz).');
  return s !== 0;
};
const sorted = (xs: Expr[], descend = false) => [...xs].sort((a, b) => (descend ? -1 : 1) * compare(a, b));
const median = (xs: Expr[]) => {
  if (!xs.length) fail('Mediana pustej listy nie istnieje.');
  const s = sorted(xs), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : div(add(s[n / 2 - 1], s[n / 2]), num(2));
};
/** Places counted down the columns, as MATLAB's A(k) and find count them. */
const columnMajor = (m: Grid): Expr[] => transpose(m).flat();

// --- Magic squares, as MATLAB builds them ---

function magic(n: number): Grid {
  if (n === 1) return [[ONE]];
  if (n % 2) {
    // odd: the siamese method, MATLAB's mod(I + J − (n + 3)/2, n)·n + mod(I + 2J − 2, n) + 1
    return filled(n, n, (i, j) => num(n * (((i + j + 2 - (n + 3) / 2) % n + n) % n) + ((i + 1 + 2 * (j + 1) - 2) % n) + 1));
  }
  if (n % 4 === 0) {
    // doubly even: 1 … n² row by row, the cells where ⌊(i mod 4)/2⌋ = ⌊(j mod 4)/2⌋ reflected to n² + 1 − k
    return filled(n, n, (i, j) => {
      const k = i * n + j + 1, flip = Math.floor(((i + 1) % 4) / 2) === Math.floor(((j + 1) % 4) / 2);
      return num(flip ? n * n + 1 - k : k);
    });
  }
  // singly even: four magic squares of n/2 (LUX), then MATLAB's exchanges of columns
  const p = n / 2, A = magic(p).map(r => r.map(e => Number((e as { v: { n: bigint } }).v.n)));
  const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    const a = A[i % p][j % p];
    return i < p ? (j < p ? a : a + 2 * p * p) : (j < p ? a + 3 * p * p : a + p * p);
  }));
  const k = (n - 2) / 4;
  const cols = [...Array.from({ length: k }, (_, c) => c), ...Array.from({ length: Math.max(0, k - 1) }, (_, c) => n - k + 1 + c)];
  for (let i = 0; i < p; i++) for (const j of cols) [M[i][j], M[i + p][j]] = [M[i + p][j], M[i][j]];
  for (const j of new Set([0, k])) [M[k][j], M[k + p][j]] = [M[k + p][j], M[k][j]];
  return M.map(r => r.map(x => num(x)));
}

// --- The commands ---

type Command = (vals: Value[]) => Done;
const done = (value: Value, title: string, note?: string): Done => ({ value, title, note });

export const ARRAYS: Record<string, Command> = {
  zeros: v => { const [n, m] = size2(v, 'zeros'); return done(valueOf(filled(n, m, () => ZERO)), 'Macierz zerowa'); },
  ones: v => { const [n, m] = size2(v, 'ones'); return done(valueOf(filled(n, m, () => ONE)), 'Macierz jedynek'); },
  eye: v => { const [n, m] = size2(v, 'eye'); return done(valueOf(filled(n, m, (i, j) => (i === j ? ONE : ZERO))), 'Macierz jednostkowa'); },
  diag: ([v, k0]) => {
    const m = grid(v, 'diag'), k = k0 ? int(k0, 'Przesunięcie przekątnej', -MAX_CELLS) : 0;
    const [r, c] = dims(m);
    if (r === 1 || c === 1) {
      // a vector: the matrix with it on the diagonal (k above it, −k below)
      const xs = m.flat(), n = xs.length + Math.abs(k);
      if (n * n > MAX_CELLS) fail('Macierz byłaby za duża.');
      return done(valueOf(filled(n, n, (i, j) => (j - i === k ? xs[Math.min(i, j)] : ZERO))), 'Macierz przekątniowa');
    }
    const d: Expr[] = [];
    for (let i = Math.max(0, -k); i < r && i + k < c; i++) d.push(m[i][i + k]);
    return done(valueOf(d.map(x => [x])), 'Przekątna');
  },
  linspace: ([a0, b0, n0]) => {
    const a = scalarOf(a0, 'Początek'), b = scalarOf(b0, 'Koniec'), n = int(n0, 'Liczba punktów', 1, 100);
    if (n > MAX_CELLS) fail('Za dużo punktów.');
    const h = n === 1 ? ZERO : div(sub(b, a), num(n - 1));
    return done(valueOf([Array.from({ length: n }, (_, k) => (n === 1 ? b : k === n - 1 ? b : add(a, mul(num(k), h))))]), `${n} równo rozłożonych punktów`);
  },
  logspace: ([a0, b0, n0]) => {
    const a = scalarOf(a0, 'Początek'), b = scalarOf(b0, 'Koniec'), n = int(n0, 'Liczba punktów', 1, 50);
    if (n > 10_000) fail('Za dużo punktów.');
    const h = n === 1 ? ZERO : div(sub(b, a), num(n - 1));
    return done(valueOf([Array.from({ length: n }, (_, k) => pow(num(10), n === 1 ? b : add(a, mul(num(k), h))))]), `${n} punktów rozłożonych logarytmicznie`);
  },
  magic: ([n0]) => {
    const n = int(n0, 'Rozmiar', 1);
    if (n > 100) fail('Kwadrat magiczny buduję do rozmiaru 100.');
    return done(valueOf(magic(n)), 'Kwadrat magiczny', n === 2 ? 'Kwadrat magiczny 2×2 nie istnieje; to macierz, którą w tym miejscu daje MATLAB.' : `Każdy wiersz, kolumna i przekątna sumuje się do ${n * (n * n + 1) / 2}.`);
  },
  hilb: ([n0]) => {
    const n = int(n0, 'Rozmiar', 1);
    if (n * n > MAX_CELLS) fail('Za duża macierz.');
    return done(valueOf(filled(n, n, (i, j) => num(1, i + j + 1))), 'Macierz Hilberta', 'Liczona dokładnie: numerycznie to klasyczny przykład złego uwarunkowania.');
  },
  vander: ([v]) => {
    const xs = grid(v, 'vander').flat(), n = xs.length;
    if (n * n > MAX_CELLS) fail('Za duża macierz.');
    return done(valueOf(filled(n, n, (i, j) => pow(xs[i], num(n - 1 - j)))), 'Macierz Vandermonde’a');
  },
  toeplitz: ([c0, r0]) => {
    const c = grid(c0, 'toeplitz').flat(), r = r0 ? grid(r0, 'toeplitz').flat() : c;
    if (c.length * r.length > MAX_CELLS) fail('Za duża macierz.');
    const note = r0 && compare(c[0], r[0]) !== 0 ? 'Pierwszy element kolumny i wiersza się różnią; na przekątnej jest ten z kolumny (jak w MATLAB-ie).' : undefined;
    return done(valueOf(filled(c.length, r.length, (i, j) => (i >= j ? c[i - j] : r[j - i]))), 'Macierz Toeplitza', note);
  },
  repmat: ([v, n0, m0]) => {
    const A = grid(v, 'repmat'), [r, c] = dims(A);
    const [n, m] = m0 ? [int(n0, 'Powtórzenia w pionie'), int(m0, 'Powtórzenia w poziomie')] : n0.t === 'list' ? size2([n0], 'repmat') : [int(n0, 'Powtórzenia'), int(n0, 'Powtórzenia')];
    if (r * c * n * m > MAX_CELLS) fail('Za duża macierz.');
    return done(valueOf(filled(r * n, c * m, (i, j) => A[i % r][j % c])), 'Powielona macierz');
  },
  reshape: ([v, n0, m0]) => {
    const A = grid(v, 'reshape'), xs = columnMajor(A);
    const [n, m] = m0 ? [int(n0, 'Liczba wierszy'), int(m0, 'Liczba kolumn')] : size2([n0], 'reshape');
    if (n * m !== xs.length) fail(`reshape: ${xs.length} elementów nie da się ułożyć w ${n}×${m}.`);
    // elements taken and laid down the columns, as in MATLAB
    return done(valueOf(filled(n, m, (i, j) => xs[j * n + i])), `Macierz ${n}×${m}`);
  },
  kron: ([a, b]) => {
    const A = grid(a, 'kron'), B = grid(b, 'kron'), [p, q] = dims(B);
    if (A.length * dims(A)[1] * p * q > MAX_CELLS) fail('Za duża macierz.');
    return done(valueOf(filled(A.length * p, dims(A)[1] * q, (i, j) => mul(A[Math.floor(i / p)][Math.floor(j / q)], B[i % p][j % q]))), 'Iloczyn Kroneckera');
  },
  triu: ([v, k0]) => { const A = grid(v, 'triu'), k = k0 ? int(k0, 'Przesunięcie', -MAX_CELLS) : 0; return done(valueOf(A.map((r, i) => r.map((x, j) => (j - i >= k ? x : ZERO)))), 'Część trójkątna górna'); },
  tril: ([v, k0]) => { const A = grid(v, 'tril'), k = k0 ? int(k0, 'Przesunięcie', -MAX_CELLS) : 0; return done(valueOf(A.map((r, i) => r.map((x, j) => (j - i <= k ? x : ZERO)))), 'Część trójkątna dolna'); },
  fliplr: ([v]) => done(valueOf(grid(v, 'fliplr').map(r => [...r].reverse())), 'Odbicie lewo–prawo'),
  flipud: ([v]) => done(valueOf([...grid(v, 'flipud')].reverse()), 'Odbicie góra–dół'),
  circshift: ([v, k0, d0]) => {
    const A = grid(v, 'circshift'), k = int(k0, 'Przesunięcie', -MAX_CELLS), dim = d0 ? dimOf(A, d0) : A.length === 1 ? 2 : 1;
    const shift = <T>(xs: T[]) => xs.map((_, i) => xs[(((i - k) % xs.length) + xs.length) % xs.length]);
    return done(along(A, dim, shift), 'Przesunięcie cykliczne');
  },

  size: ([v, d0]) => {
    const [n, m] = dims(grid(v, 'size'));
    if (d0) { const d = int(d0, 'Wymiar', 1); return done(ex(num(d === 1 ? n : d === 2 ? m : 1)), `Rozmiar w wymiarze ${d}`); }
    return done(valueOf([[num(n), num(m)]]), 'Rozmiar', `${n} ${n === 1 ? 'wiersz' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'wiersze' : 'wierszy'}, ${m} ${m === 1 ? 'kolumna' : m % 10 >= 2 && m % 10 <= 4 && (m % 100 < 10 || m % 100 >= 20) ? 'kolumny' : 'kolumn'}`);
  },
  numel: ([v]) => { const [n, m] = dims(grid(v, 'numel')); return done(ex(num(n * m)), 'Liczba elementów'); },
  length: ([v]) => { const [n, m] = dims(grid(v, 'length')); return done(ex(num(n && m ? Math.max(n, m) : 0)), 'Długość (największy wymiar)'); },
  isempty: ([v]) => done(ex(grid(v, 'isempty').length ? ZERO : ONE), 'Czy pusta? (1 = tak)'),
  find: ([v, k0]) => {
    const A = grid(v, 'find'), k = k0 ? int(k0, 'Ile', 1) : Infinity;
    const at: Expr[] = [];
    columnMajor(A).forEach((x, i) => { if (at.length < k && truth(x)) at.push(num(i + 1)); });
    // a row gives a row, anything else a column (MATLAB)
    const value = A.length <= 1 ? valueOf([at]) : valueOf(at.map(x => [x]));
    return done(value, 'Miejsca niezerowych elementów', at.length ? 'Liczone od 1; w macierzy w dół kolumn.' : 'Żaden element nie jest różny od zera.');
  },
  any: ([v, d0]) => { const A = grid(v, 'any'); return done(reduce(A, dimOf(A, d0), xs => (xs.some(truth) ? ONE : ZERO)), 'Czy któryś niezerowy? (1 = tak)'); },
  all: ([v, d0]) => { const A = grid(v, 'all'); return done(reduce(A, dimOf(A, d0), xs => (xs.every(truth) ? ONE : ZERO)), 'Czy wszystkie niezerowe? (1 = tak)'); },

  sum: ([v, d0]) => { const A = grid(v, 'sum'), d = dimOf(A, d0); return done(reduce(A, d, xs => add(...xs)), titleOf(A, d, ['Suma', 'Sumy kolumn', 'Sumy wierszy'])); },
  product: ([v, d0]) => { const A = grid(v, 'prod'), d = dimOf(A, d0); return done(reduce(A, d, xs => mul(...xs)), titleOf(A, d, ['Iloczyn', 'Iloczyny kolumn', 'Iloczyny wierszy'])); },
  cumsum: ([v, d0]) => { const A = grid(v, 'cumsum'); return done(along(A, dimOf(A, d0), xs => { let s: Expr = ZERO; return xs.map(x => (s = add(s, x))); }), 'Sumy częściowe'); },
  cumprod: ([v, d0]) => { const A = grid(v, 'cumprod'); return done(along(A, dimOf(A, d0), xs => { let s: Expr = ONE; return xs.map(x => (s = mul(s, x))); }), 'Iloczyny częściowe'); },
  diff: ([v, n0]) => {
    const A = grid(v, 'diff'), n = int(n0, 'Rząd różnicy', 1, 1);
    let out = along(A, dimOf(A, undefined), xs => xs.slice(1).map((x, i) => sub(x, xs[i])));
    for (let k = 1; k < n; k++) { const B = grid(out, 'diff'); out = B.length ? along(B, dimOf(B, undefined), xs => xs.slice(1).map((x, i) => sub(x, xs[i]))) : out; }
    return done(out, n > 1 ? `Różnice rzędu ${n}` : 'Różnice kolejnych elementów');
  },
  mean: ([v, d0]) => {
    const A = grid(v, 'mean');
    if (!A.length) fail('Średnia pustej listy nie istnieje.');
    const d = dimOf(A, d0);
    return done(reduce(A, d, xs => div(add(...xs), num(xs.length))), titleOf(A, d, ['Średnia arytmetyczna', 'Średnie kolumn', 'Średnie wierszy']));
  },
  median: ([v, d0]) => { const A = grid(v, 'median'), d = dimOf(A, d0); return done(reduce(A, d, median), titleOf(A, d, ['Mediana', 'Mediany kolumn', 'Mediany wierszy'])); },
  sort: ([v, o]) => {
    const descend = o?.t === 'str' && /^(descend|malejaco)$/.test(o.s);
    if (o && !descend && !(o.t === 'str' && /^(ascend|rosnaco)$/.test(o.s))) fail("sort: kierunek to 'ascend' albo 'descend'.");
    const A = grid(v, 'sort');
    return done(along(A, dimOf(A, undefined), xs => sorted(xs, descend)), descend ? 'Posortowane malejąco' : 'Posortowane');
  },
};

/** One result for a vector, one per column or row of a matrix. */
function titleOf(A: Grid, dim: 1 | 2, [one, cols, rows]: [string, string, string]): string {
  const [n, m] = dims(A);
  return (dim === 1 ? m : n) > 1 && (dim === 1 ? n : m) > 1 ? (dim === 1 ? cols : rows) : one;
}

function scalarOf(v: Value | undefined, what: string): Expr {
  if (!v || v.t !== 'expr') return fail(`${what}: oczekuję liczby.`);
  return v.e;
}

/** Which of these commands MATLAB's reading takes: sum(v) of a list or matrix, not Σ; diff(v), not d/dx. */
export function arrayReading(name: string, vals: Value[]): boolean {
  if (!Object.hasOwn(ARRAYS, name)) return false;
  if (!['sum', 'product', 'diff', 'mean', 'median', 'sort'].includes(name)) return true;
  const [first, second] = vals;
  if (first?.t !== 'list' && first?.t !== 'matrix') return false;
  if (first.t === 'list' && first.set) return false;
  // sum(v), sum(A, 2), sort(v, 'descend'), diff(v, 2)
  return vals.length === 1 || (vals.length === 2 && (second.t === 'str' || (second.t === 'expr' && isNum(second.e))));
}

/** Where max(v) and min(v) are (the first place, counted from 1). */
export function placeOf(v: Value, which: 'max' | 'min'): number | null {
  if (v.t !== 'list' || !v.items.length || !v.items.every(i => i.t === 'expr')) return null;
  const xs = v.items.map(i => (i as { e: Expr }).e);
  try {
    let best = 0;
    xs.forEach((x, k) => { if ((which === 'max' ? 1 : -1) * compare(x, xs[best]) > 0) best = k; });
    return best + 1;
  } catch { return null; }
}
