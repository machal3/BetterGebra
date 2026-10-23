/**
 * Worked solutions for linear algebra: the elementary row operations of an elimination, the determinant by
 * formula / Sarrus / Laplace / triangular form, the inverse from [A | I], A·x = b from [A | b], and further
 * forms of a matrix (diagonalization, Cholesky, QR, a list of properties). Every result shown here is
 * checked against the independently computed one and dropped when it does not match.
 */
import { Expr, ONE, ZERO, add, div, expand, isConstant, isNum, isZero, mul, neg, num, sqrt, sub } from './expr';
import { matMul, identityM } from './evaluate';
import { toML, toText } from './format';
import { constSign } from './functions';
import * as LA from './matrix';
import { approx } from './numeric';
import { polyOf, solvePoly } from './poly';
import { CasError, type Q } from './q';

type M = Expr[][];
/** One line of a worked solution: what was done, and the result (MathML + plain text). */
export interface Step { op: string; ml?: string; text?: string; note?: string }

const ML = (inner: string) => `<math display="block">${inner}</math>`;
const mo = (s: string) => s === '(' || s === ')' ? `<mo stretchy="false">${s}</mo>` : `<mo>${s}</mo>`;
const mi = (s: string) => `<mi>${s}</mi>`;
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const subscript = (k: number) => String(k).replace(/\d/g, d => SUB[+d]);
const w = (i: number) => `w${subscript(i + 1)}`;
const safe = <T>(f: () => T): T | null => { try { return f(); } catch (err) { if (err instanceof CasError || err instanceof RangeError) return null; throw err; } };
const isUnitNum = (e: Expr, v: bigint) => isNum(e) && (e as { v: Q }).v.d === 1n && (e as { v: Q }).v.n === v;
const DET_A = `${mi('det')}<mspace width="0.2em"/>${mi('A')}`;
const A_INV = '<msup><mi>A</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup>';

/** A matrix in brackets; `bar` puts a vertical line before that column, `hl` highlights rows that just changed. */
export function matML(m: M, opts: { bar?: number; hl?: number[] } = {}): string {
  const rows = m.map((r, i) => `<mtr${opts.hl?.includes(i) ? ' class="mat-hl"' : ''}>${r.map((c, j) => `<mtd${opts.bar !== undefined && j === opts.bar ? ' class="mat-bar"' : ''}>${toML(c)}</mtd>`).join('')}</mtr>`);
  return `<mrow>${mo('[')}<mtable>${rows.join('')}</mtable>${mo(']')}</mrow>`;
}
export function matText(m: M, bar?: number): string {
  const r = (row: Expr[]) => bar === undefined ? row.map(toText).join(', ') : `${row.slice(0, bar).map(toText).join(', ')} | ${row.slice(bar).map(toText).join(', ')}`;
  return `[${m.map(row => `[${r(row)}]`).join(', ')}]`;
}

// --- Factors in products: (−3), (a + b), 1/2 ---

const compound = (t: string) => /\s[+−-]\s/.test(t);
/** Text of a factor, in parentheses when it is negative, a sum or a fraction. */
const pText = (e: Expr) => { const t = toText(e); return /^[−-]/.test(t) || compound(t) || t.includes('/') ? `(${t})` : t; };
/** MathML of a factor, in parentheses when it is negative or a sum (fractions are drawn as fractions). */
const pML = (e: Expr) => { const t = toText(e); return /^[−-]/.test(t) || compound(t) ? `<mrow>${mo('(')}${toML(e)}${mo(')')}</mrow>` : toML(e); };
/** The terms t₀ ± t₁ ± …: a term with its own leading minus is written with "−" in place of "+". */
function signedSum(terms: { e: Expr; sign: 1 | -1 }[], ml: (e: Expr) => string, text: (e: Expr) => string): { ml: string; text: string } {
  let m = '', t = '';
  terms.forEach(({ e, sign }, k) => {
    let s = sign, x = e;
    const tx = toText(e);
    if (/^[−-]/.test(tx) && !compound(tx)) { s = -s as 1 | -1; x = neg(e); }
    if (k === 0) { m += s < 0 ? mo('−') : ''; t += s < 0 ? '−' : ''; }
    else { m += mo(s < 0 ? '−' : '+'); t += s < 0 ? ' − ' : ' + '; }
    m += ml(x); t += text(x);
  });
  return { ml: m, text: t };
}

// --- Row operations ---

export function opText(op: LA.RowOp): string {
  switch (op.k) {
    case 'swap': return `${w(op.i)} ↔ ${w(op.j)}`;
    case 'scale': {
      if (isUnitNum(op.d, -1n)) return `${w(op.i)} ← −${w(op.i)}`;
      const d = op.d as { v?: Q };
      if (isNum(op.d) && d.v!.d !== 1n) {
        // dividing by a fraction reads better as multiplying by its reciprocal
        const r = div(ONE, op.d), rt = toText(r);
        return `${w(op.i)} ← ${rt.includes('/') ? `(${rt})` : rt}·${w(op.i)}`;
      }
      return `${w(op.i)} ← ${w(op.i)} / ${pText(op.d)}`;
    }
    case 'add': {
      const t = toText(op.f);
      let sign = '+', mag = op.f;
      if (/^[−-]/.test(t) && !compound(t)) { sign = '−'; mag = neg(op.f); }
      const mt = toText(mag);
      const coef = mt === '1' ? '' : `${compound(mt) || mt.includes('/') ? `(${mt})` : mt}·`;
      return `${w(op.i)} ← ${w(op.i)} ${sign} ${coef}${w(op.j)}`;
    }
  }
}

const detNote = (ops: LA.RowOp[]): string =>
  ops[0].k === 'swap' ? 'Zamiana wierszy zmienia znak wyznacznika.' : 'Dodanie wielokrotności innego wiersza nie zmienia wyznacznika.';

/** The elimination as steps: the starting matrix, then every group of row operations with the matrix after it. */
export function elimSteps(A: M, mode: 'rref' | 'ref' | 'det', opts: { bar?: number; start?: string; stopAt?: number; unitPivot?: boolean; detNotes?: boolean } = {}) {
  const r = LA.eliminate(A, mode, opts.stopAt, opts.unitPivot ?? true);
  const steps: Step[] = [{ op: opts.start ?? 'Macierz wyjściowa', ml: ML(matML(A, { bar: opts.bar })), text: matText(A, opts.bar) }];
  for (const s of r.steps) {
    const op = s.ops.map(opText).join(';  ');
    steps.push({
      op,
      ml: ML(`${mo('∼')}${matML(s.R, { bar: opts.bar, hl: s.changed })}`),
      text: `${op}: ${matText(s.R, opts.bar)}`,
      note: opts.detNotes ? detNote(s.ops) : undefined,
    });
  }
  return { ...r, steps };
}

const equal = (a: Expr, b: Expr) => isZero(expand(sub(a, b))) || isZero(LA.clean(sub(a, b)));
const equalM = (a: M, b: M) => a.length === b.length && a.every((r, i) => r.length === b[i].length && r.every((v, j) => equal(v, b[i][j])));

/** Numeric agreement of two matrices (for entries with radicals, where exact zero tests may fail). */
export function closeM(a: M, b: M): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) => r.length === b[i].length && r.every((v, j) => {
    const x = approx(v), y = approx(b[i][j]);
    return Math.hypot(x.re - y.re, x.im - y.im) <= 1e-9 * Math.max(1, Math.hypot(y.re, y.im));
  }));
}

// --- Determinant ---

export function detSteps(A: M, d: Expr, simp: (e: Expr) => Expr): Step[] | null {
  const n = A.length;
  if (n === 2) {
    const [[a, b], [c, e]] = A;
    const p1 = simp(mul(a, e)), p2 = simp(mul(b, c));
    if (!equal(sub(p1, p2), d)) return null;
    return [
      { op: 'Wzór dla macierzy 2×2: det A = a₁₁·a₂₂ − a₁₂·a₂₁', ml: ML(`${DET_A}${mo('=')}${pML(a)}${mo('·')}${pML(e)}${mo('−')}${pML(b)}${mo('·')}${pML(c)}`), text: `det A = ${pText(a)}·${pText(e)} − ${pText(b)}·${pText(c)}` },
      { op: 'Obliczenie', ml: ML(`${mo('=')}${toML(p1)}${mo('−')}${pML(p2)}${mo('=')}${toML(d)}`), text: `= ${toText(p1)} − ${pText(p2)} = ${toText(d)}` },
    ];
  }
  if (n === 3) {
    const idx: [number, number][][] = [
      [[0, 0], [1, 1], [2, 2]], [[0, 1], [1, 2], [2, 0]], [[0, 2], [1, 0], [2, 1]],
      [[0, 2], [1, 1], [2, 0]], [[0, 0], [1, 2], [2, 1]], [[0, 1], [1, 0], [2, 2]],
    ];
    const prods = idx.map(t => t.map(([i, j]) => A[i][j]));
    const vals = prods.map(p => simp(mul(...p)));
    const total = simp(add(...vals.slice(0, 3), ...vals.slice(3).map(neg)));
    if (!equal(total, d)) return null;
    const pm = prods.map(p => p.map(pML).join(mo('·'))), pt = prods.map(p => p.map(pText).join('·'));
    const sign = (k: number) => (k < 3 ? '+' : '−');
    const first = pm.map((m, k) => (k ? mo(sign(k)) : '') + m).join('');
    const firstT = pt.map((t, k) => (k ? ` ${sign(k)} ` : '') + t).join('');
    const sum = signedSum(vals.map((e, k) => ({ e, sign: k < 3 ? 1 : -1 })), pML, pText);
    return [
      { op: 'Reguła Sarrusa: iloczyny wzdłuż trzech przekątnych „w dół” ze znakiem +, „w górę” ze znakiem −', ml: ML(`${DET_A}${mo('=')}${first}`), text: `det A = ${firstT}` },
      { op: 'Obliczenie', ml: ML(`${mo('=')}${sum.ml}${mo('=')}${toML(d)}`), text: `= ${sum.text} = ${toText(d)}` },
    ];
  }
  if (n >= 4 && A.flat().every(isNum)) {
    const r = elimSteps(A, 'det', { start: 'Sprowadzamy macierz do postaci trójkątnej górnej', detNotes: true });
    const diag = r.R.map((row, i) => row[i]);
    const sign = r.swaps % 2 ? -1 : 1;
    const value = simp(mul(num(sign), ...diag));
    if (!equal(value, d)) return null;
    const signML = sign < 0 ? `${mo('−')}` : '', signT = sign < 0 ? '−' : '';
    r.steps.push({
      op: `Wyznacznik macierzy trójkątnej to iloczyn elementów przekątnej${r.swaps ? ` (${r.swaps} ${r.swaps === 1 ? 'zamiana' : r.swaps < 5 ? 'zamiany' : 'zamian'} wierszy: znak ${sign < 0 ? '−' : '+'})` : ''}`,
      ml: ML(`${DET_A}${mo('=')}${signML}${diag.map(pML).join(mo('·'))}${mo('=')}${toML(d)}`),
      text: `det A = ${signT}${diag.map(pText).join('·')} = ${toText(d)}`,
    });
    return r.steps;
  }
  if (n === 4) {
    // Laplace along the row with the most zeros
    let best = 0, zeros = -1;
    A.forEach((r, i) => { const z = r.filter(isZero).length; if (z > zeros) { zeros = z; best = i; } });
    const terms = A[best].map((a, j) => ({ a, j })).filter(t => !isZero(t.a));
    const parts = terms.map(({ a, j }) => {
      const minor = LA.minor(A, best, j);
      return { e: a, sign: ((best + j) % 2 ? -1 : 1) as 1 | -1, minor };
    });
    const total = simp(add(...parts.map(p => mul(num(p.sign), p.e, LA.det(p.minor)))));
    if (!equal(total, d)) return null;
    let ml = '', text = '';
    parts.forEach((p, k) => {
      const s = p.sign < 0 ? '−' : '+';
      if (k || p.sign < 0) { ml += mo(s); text += k ? ` ${s} ` : '−'; }
      ml += `${pML(p.e)}${mo('·')}${mi('det')}${matML(p.minor)}`;
      text += `${pText(p.e)}·det${matText(p.minor)}`;
    });
    return [
      { op: `Rozwinięcie Laplace’a względem wiersza ${best + 1} (najwięcej zer): det A = Σ (−1)^(i+j)·aᵢⱼ·det Mᵢⱼ`, ml: ML(`${DET_A}${mo('=')}${ml || '<mn>0</mn>'}`), text: `det A = ${text || '0'}` },
      { op: 'Obliczenie wyznaczników 3×3 (reguła Sarrusa)', ml: ML(`${mo('=')}${toML(d)}`), text: `= ${toText(d)}` },
    ];
  }
  return null;
}

// --- Inverse ---

export function inverseSteps(A: M, inv: M, simp: (e: Expr) => Expr): Step[] | null {
  const n = A.length;
  const aug = A.map((r, i) => [...r, ...identityM(n)[i]]);
  const r = elimSteps(aug, 'rref', { bar: n, start: 'Macierz rozszerzona [A | I]', stopAt: n });
  const left = r.R.map(row => row.slice(0, n)), right = r.R.map(row => row.slice(n));
  if (!equalM(left, identityM(n)) || !equalM(right, inv)) return null;
  const steps = r.steps;
  steps.push({ op: 'Po lewej stronie jest macierz jednostkowa, więc po prawej stoi A⁻¹', ml: ML(`${A_INV}${mo('=')}${matML(inv)}`), text: `A⁻¹ = ${matText(inv)}` });
  if (n === 2) {
    const [[a, b], [c, e]] = A;
    const d = simp(sub(mul(a, e), mul(b, c)));
    const adj = [[e, simp(neg(b))], [simp(neg(c)), a]];
    if (equalM(adj.map(row => row.map(v => simp(div(v, d)))), inv)) {
      steps.push({
        op: 'To samo ze wzoru dla 2×2: A⁻¹ = (1/det A)·[[a₂₂, −a₁₂], [−a₂₁, a₁₁]]',
        ml: ML(`${A_INV}${mo('=')}<mfrac><mn>1</mn>${toML(d)}</mfrac>${mo('·')}${matML(adj)}`),
        text: `A⁻¹ = 1/${pText(d)}·${matText(adj)}`,
      });
    }
  }
  const check = safe(() => matMul(A, inv).map(row => row.map(simp)));
  if (check && equalM(check, identityM(n))) steps.push({ op: 'Sprawdzenie: A·A⁻¹ = I', ml: ML(`${mi('A')}${mo('·')}${A_INV}${mo('=')}${matML(identityM(n))}`), text: `A·A⁻¹ = ${matText(identityM(n))}` });
  return steps;
}

// --- Echelon forms, rank ---

export function echelonSteps(A: M, mode: 'rref' | 'ref', expected: M): Step[] | null {
  const r = elimSteps(A, mode);
  if (!equalM(r.R, expected)) return null;
  const rk = r.pivots.length;
  r.steps.push({
    op: `${mode === 'rref' ? 'Postać schodkowa zredukowana' : 'Postać schodkowa'}: ${rk} ${rk === 1 ? 'niezerowy wiersz' : rk < 5 && rk > 1 ? 'niezerowe wiersze' : 'niezerowych wierszy'}, więc rząd A = ${rk}; elementy wiodące w kolumnach ${r.pivots.map(p => p + 1).join(', ') || '—'}`,
  });
  return r.steps;
}

/** The elimination behind P·A = L·U: no scaling, a row swap only for a zero pivot; the multipliers (with the sign flipped) are L. */
export function luSteps(A: M, dec: LA.LU): Step[] | null {
  const r = elimSteps(A, 'det', { start: 'Eliminacja w dół bez skalowania wierszy', unitPivot: false });
  if (!equalM(r.R, dec.U)) return null;
  r.steps.push({ op: 'Otrzymana macierz trójkątna to U; liczba ℓᵢⱼ w L to mnożnik, przez który odejmowaliśmy wiersz j od wiersza i (wᵢ ← wᵢ − ℓᵢⱼ·wⱼ)' });
  return r.steps;
}

// --- A·x = b ---

const xName = (j: number) => ({ ml: `<msub><mi>x</mi><mn>${j + 1}</mn></msub>`, text: `x${subscript(j + 1)}` });

export function linsolveSteps(A: M, b: Expr[], sol: LA.LinearSolution, simp: (e: Expr) => Expr, names?: string[]): Step[] | null {
  const m = A[0].length;
  const aug = A.map((r, i) => [...r, b[i]]);
  const r = elimSteps(aug, 'rref', { bar: m, start: 'Macierz rozszerzona [A | b]', stopAt: m });
  const name = (j: number) => names?.[j]
    ? { ml: `<mi>${names[j]}</mi>`, text: names[j] }
    : xName(j);
  const steps = r.steps;
  const rankA = r.pivots.length;
  const bad = r.R.findIndex(row => row.slice(0, m).every(isZero) && !isZero(row[m]));
  if (sol.kind === 'none') {
    if (bad < 0) return null;
    steps.push({
      op: `Wiersz ${bad + 1} oznacza równanie 0 = ${toText(r.R[bad][m])}: sprzeczność. Rząd A = ${rankA}, rząd [A | b] = ${rankA + 1} (twierdzenie Kroneckera–Capellego), brak rozwiązań.`,
    });
    return steps;
  }
  if (bad >= 0) return null;
  const xs = sol.x.map(v => simp(v));
  const rows = xs.map((v, j) => `${name(j).ml}${mo('=')}${toML(v)}`).join(`${mo(',')}<mspace width="0.6em"/>`);
  const rowsT = xs.map((v, j) => `${name(j).text} = ${toText(v)}`).join(', ');
  if (sol.kind === 'unique') {
    steps.push({ op: `Rząd A = rząd [A | b] = ${rankA} = liczba niewiadomych: dokładnie jedno rozwiązanie, odczytane z ostatniej kolumny`, ml: ML(rows), text: rowsT });
  } else {
    const free = sol.free.map((f, k) => `${name(f).text} = ${sol.params[k]}`).join(', ');
    steps.push({ op: `Rząd A = rząd [A | b] = ${rankA} < ${m} niewiadomych: ${m - rankA} ${m - rankA === 1 ? 'zmienna wolna' : 'zmienne wolne'} (${free}), pozostałe wyznaczamy z wierszy`, ml: ML(rows), text: rowsT });
  }
  // the solution satisfies every equation
  if (!A.every((row, i) => equal(add(...row.map((a, j) => mul(a, xs[j]))), b[i]))) return null;
  steps.push({ op: 'Sprawdzenie: A·x = b dla każdego wiersza ✓' });
  return steps;
}

export function nullspaceSteps(A: M, basis: M): Step[] | null {
  const r = elimSteps(A, 'rref', { start: 'Rozwiązujemy A·x = 0: eliminacja Gaussa–Jordana' });
  const m = A[0].length;
  const free = [...Array(m).keys()].filter(j => !r.pivots.includes(j));
  if (free.length !== basis.length) return null;
  // every vector we show must really satisfy A·v = 0
  if (!basis.every(v => A.every(row => equal(add(...row.map((a, j) => mul(a, v[j]))), ZERO)))) return null;
  if (!free.length) { r.steps.push({ op: 'Każda kolumna ma element wiodący: jedynym rozwiązaniem jest x = 0' }); return r.steps; }
  r.steps.push({
    op: `Zmienne wolne: ${free.map(f => xName(f).text).join(', ')}. Każdej z nich po kolei nadajemy wartość 1 (pozostałym wolnym 0) i z wierszy odczytujemy resztę — tak powstają wektory bazy`,
  });
  basis.forEach((v, k) => r.steps.push({
    op: `Wektor bazowy ${k + 1}: ${xName(free[k]).text} = 1, pozostałe zmienne wolne = 0`,
    ml: ML(matML(v.map(c => [c]))),
    text: `(${v.map(toText).join(', ')})`,
  }));
  return r.steps;
}

// --- Further forms ---

export interface Diagonal { P: M; D: M; Pinv: M | null; complex: boolean }
/** A = P·D·P⁻¹ from exact eigenvalues and eigenvectors; a string explains why it is impossible (exact rational case only). */
export function diagonalize(A: M, cp: Expr, simp: (e: Expr) => Expr): Diagonal | string | null {
  const n = A.length;
  const p = polyOf(cp, 'λ');
  if (!p) return null;
  const roots = solvePoly(p);
  if (roots.some(r => !r.exact)) return null;
  const cols: Expr[][] = [], ds: Expr[] = [];
  for (const r of roots) {
    const lam = r.exact!;
    const shifted = A.map((row, i) => row.map((v, j) => (i === j ? sub(v, lam) : v)));
    const ns = safe(() => LA.nullspace(shifted));
    if (!ns) return null;
    if (ns.length < r.mult) {
      if (!isNum(lam) || !A.flat().every(isNum)) return null;
      return `λ = ${toText(lam)} ma krotność ${r.mult}, ale tylko ${ns.length} ${ns.length === 1 ? 'niezależny wektor własny' : 'niezależne wektory własne'}: macierz nie jest diagonalizowalna.`;
    }
    for (const v of ns) { cols.push(v.map(simp)); ds.push(simp(lam)); }
  }
  if (cols.length !== n) return null;
  const P = LA.transpose(cols), D = ds.map((v, i) => ds.map((_, j) => (i === j ? v : ZERO)));
  if (!safe(() => closeM(matMul(A, P), matMul(P, D)))) return null;
  const Pinv = safe(() => LA.inverse(P).map(r => r.map(simp)));
  const complex = ds.some(v => { const z = safe(() => approx(v)); return !!z && Math.abs(z.im) > 1e-12; });
  return { P, D, Pinv, complex };
}

export function choleskyOf(A: M, simp: (e: Expr) => Expr): M | null {
  if (!A.flat().every(isConstant)) return null;
  const L = LA.cholesky(A, e => constSign(e) === 1, simp, sqrt);
  if (!L) return null;
  return safe(() => closeM(matMul(L, LA.transpose(L)), A)) ? L : null;
}

export function qrOf(A: M, simp: (e: Expr) => Expr): { Q: M; R: M } | null {
  if (!A.flat().every(isConstant)) return null;
  // Gram–Schmidt as written works for real entries
  if (!A.flat().every(v => { const z = safe(() => approx(v)); return !!z && Math.abs(z.im) < 1e-12; })) return null;
  const r = LA.qr(A, simp, sqrt);
  if (!r) return null;
  return safe(() => closeM(matMul(r.Q, r.R), A)) ? r : null;
}

/** Leading principal minors D₁, …, Dₙ. */
export const leadingMinors = (A: M, simp: (e: Expr) => Expr): Expr[] => A.map((_, k) => simp(LA.det(A.slice(0, k + 1).map(r => r.slice(0, k + 1)))));

/** Names of the special kinds of matrix A is, and the leading principal minors when they decide definiteness. */
export function properties(A: M, simp: (e: Expr) => Expr): { tags: string[]; minors?: Expr[] } {
  const n = A.length, k = A[0]?.length ?? 0, tags: string[] = [];
  const zeroE = (e: Expr) => isZero(e) || equal(e, ZERO);
  if (n !== k) {
    tags.push(n < k ? `prostokątna ${n}×${k} (więcej kolumn niż wierszy)` : `prostokątna ${n}×${k} (więcej wierszy niż kolumn)`);
    if (A.every(r => r.every(zeroE))) tags.push('zerowa');
    return { tags };
  }
  const T = LA.transpose(A);
  const all = (f: (v: Expr, i: number, j: number) => boolean) => A.every((r, i) => r.every((v, j) => f(v, i, j)));
  if (all(zeroE)) return { tags: n === k ? ['zerowa', 'osobliwa (det A = 0 — brak macierzy odwrotnej)'] : ['zerowa'] };
  if (all((v, i, j) => equal(v, i === j ? ONE : ZERO))) tags.push('jednostkowa');
  else if (all((v, i, j) => i === j || zeroE(v))) tags.push('diagonalna');
  else if (all((v, i, j) => i <= j || zeroE(v))) tags.push('górnotrójkątna');
  else if (all((v, i, j) => i >= j || zeroE(v))) tags.push('dolnotrójkątna');
  const sym = equalM(A, T);
  if (sym) tags.push('symetryczna (Aᵀ = A)');
  else if (all((v, i, j) => equal(v, neg(T[i][j])))) tags.push('antysymetryczna (Aᵀ = −A)');
  const isC = A.flat().every(isConstant);
  const A2 = safe(() => matMul(A, A).map(r => r.map(simp)));
  if (isC && safe(() => equalM(matMul(T, A).map(r => r.map(simp)), identityM(n)))) tags.push('ortogonalna (Aᵀ·A = I)');
  if (A2 && !tags.includes('jednostkowa')) {
    if (equalM(A2, A)) tags.push('idempotentna (A² = A)');
    else if (equalM(A2, identityM(n))) tags.push('inwolucja (A² = I)');
    else {
      let P: M | null = A2;
      for (let p = 2; p < n && P; p++) { const X: M = P; P = safe(() => matMul(X, A).map(r => r.map(simp))); }
      if (P && P.every(r => r.every(zeroE))) tags.push(`nilpotentna (Aⁿ = 0 dla n = ${n})`);
    }
  }
  if (n <= 8) {
    const det = safe(() => LA.det(A));
    if (det && equal(det, ZERO)) tags.push('osobliwa (det A = 0 — brak macierzy odwrotnej)');
  }
  let minors: Expr[] | undefined;
  if (sym && isC && n <= 6) {
    const ds = safe(() => leadingMinors(A, simp));
    const signs = ds?.map(constSign);
    if (ds && signs && signs.every(s => s !== null)) {
      minors = ds;
      if (signs.every(s => s === 1)) tags.push('dodatnio określona (wszystkie minory wiodące > 0, kryterium Sylvestera)');
      else if (signs.every((s, i) => s === (i % 2 ? 1 : -1))) tags.push('ujemnie określona (minory wiodące na przemian < 0, > 0)');
    }
  }
  return { tags, minors };
}
