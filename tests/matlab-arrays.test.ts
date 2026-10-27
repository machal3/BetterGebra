import { expect, test } from 'vitest';
import { run, type Result, type Saved } from '../src/cas/engine';

/** The rows of the card with this title (the first card when no title is given). */
function card(q: string | Result, title?: string): string {
  const r = typeof q === 'string' ? run(q) : q;
  if (r.error) throw new Error(`${typeof q === 'string' ? q : ''}: ${r.error}`);
  const p = title ? r.pods.find(p => p.title === title) : r.pods[0];
  if (!p) throw new Error(`no card „${title}” in ${r.pods.map(p => p.title).join(', ')}`);
  return p.rows.map(r => r.text).join(' | ');
}
/** Questions asked one after another, the workspace carried over. */
function session() {
  const vars: Record<string, Saved> = {};
  return (q: string): Result => {
    const r = run(q, { vars: { ...vars } });
    for (const [k, v] of Object.entries(r.assigned ?? {})) { if (v) vars[k] = v; else delete vars[k]; }
    return r;
  };
}

test('building matrices', () => {
  expect(card('zeros(2, 3)', 'Macierz zerowa')).toBe('[[0, 0, 0], [0, 0, 0]]');
  expect(card('ones(2)', 'Macierz jedynek')).toBe('[[1, 1], [1, 1]]');
  expect(card('ones(1, 3)')).toBe('[1; 1; 1]');
  expect(card('eye(2, 3)', 'Macierz jednostkowa')).toBe('[[1, 0, 0], [0, 1, 0]]');
  expect(card('zeros([2 2])')).toBe('[[0, 0], [0, 0]]');
  expect(card('diag([1 2 3])', 'Macierz przekątniowa')).toBe('[[1, 0, 0], [0, 2, 0], [0, 0, 3]]');
  expect(card('diag([1 2], 1)')).toBe('[[0, 1, 0], [0, 0, 2], [0, 0, 0]]');
  expect(card('diag([1 2; 3 4])', 'Przekątna')).toBe('[[1], [4]]');
  expect(card('hilb(3)', 'Macierz Hilberta')).toBe('[[1, 1/2, 1/3], [1/2, 1/3, 1/4], [1/3, 1/4, 1/5]]');
  expect(card('vander([1 2 3])')).toBe('[[1, 1, 1], [4, 2, 1], [9, 3, 1]]');
  expect(card('toeplitz([1 2 3])')).toBe('[[1, 2, 3], [2, 1, 2], [3, 2, 1]]');
  expect(card('toeplitz([1 2 3], [1 5 6])')).toBe('[[1, 5, 6], [2, 1, 5], [3, 2, 1]]');
  expect(card('kron([1 2], [1; 1])')).toBe('[[1, 2], [1, 2]]');
  expect(card('repmat([1 2], 2, 2)')).toBe('[[1, 2, 1, 2], [1, 2, 1, 2]]');
  expect(run('zeros(1000, 1000)').error).toMatch(/elementów/);
});

test('linspace and logspace are exact', () => {
  expect(card('linspace(0, 1, 5)', '5 równo rozłożonych punktów')).toBe('[0; 1/4; 1/2; 3/4; 1]');
  expect(card('linspace(0, pi, 3)')).toBe('[0; π/2; π]');
  expect(run('linspace(0, 1)').pods[0].note).toBe('100 elementów');
  expect(card('logspace(0, 2, 3)')).toBe('[1; 10; 100]');
});

test('magic squares are MATLAB’s and magic', () => {
  expect(card('magic(3)')).toBe('[[8, 1, 6], [3, 5, 7], [4, 9, 2]]');
  expect(card('magic(4)')).toBe('[[16, 2, 3, 13], [5, 11, 10, 8], [9, 7, 6, 12], [4, 14, 15, 1]]');
  expect(card('magic(6)')).toBe('[[35, 1, 6, 26, 19, 24], [3, 32, 7, 21, 23, 25], [31, 9, 2, 22, 27, 20], [8, 28, 33, 17, 10, 15], [30, 5, 34, 12, 14, 16], [4, 36, 29, 13, 18, 11]]');
  expect(card('magic(2)')).toBe('[[4, 3], [1, 2]]');
  // every row, column and both diagonals add up to n(n² + 1)/2
  for (const n of [5, 8, 10, 12]) {
    const ask = session();
    ask(`M = magic(${n})`);
    const target = String(n * (n * n + 1) / 2);
    expect(card(ask('sum(M)'))).toBe(`[${Array(n).fill(target).join('; ')}]`);
    expect(card(ask('sum(M, 2)'))).toBe(`[${Array(n).fill(`[${target}]`).join(', ')}]`);
    expect(card(ask('sum(diag(M))'))).toBe(target);
    expect(card(ask('sum(diag(fliplr(M)))'))).toBe(target);
    expect(card(ask('sort(reshape(M, 1, numel(M)))'))).toBe(`[${Array.from({ length: n * n }, (_, k) => k + 1).join('; ')}]`);
  }
});

test('reshaping goes down the columns', () => {
  expect(card('reshape(1:6, 2, 3)')).toBe('[[1, 3, 5], [2, 4, 6]]');
  expect(card('reshape([1 2; 3 4], 1, 4)')).toBe('[1; 3; 2; 4]');
  expect(run('reshape(1:6, 4, 2)').error).toMatch(/6 elementów/);
  expect(card('triu(magic(3))')).toBe('[[8, 1, 6], [0, 5, 7], [0, 0, 2]]');
  expect(card('tril(magic(3), -1)')).toBe('[[0, 0, 0], [3, 0, 0], [4, 9, 0]]');
  expect(card('fliplr([1 2 3])')).toBe('[3; 2; 1]');
  expect(card('flipud([1 2; 3 4])')).toBe('[[3, 4], [1, 2]]');
  expect(card('circshift([1 2 3 4], 1)')).toBe('[4; 1; 2; 3]');
  expect(card('circshift([1 2 3 4], -1)')).toBe('[2; 3; 4; 1]');
});

test('sizes and questions', () => {
  expect(card('size([1 2 3; 4 5 6])', 'Rozmiar')).toBe('[2; 3]');
  expect(run('size([1 2 3; 4 5 6])').pods[0].note).toBe('2 wiersze, 3 kolumny');
  expect(card('size(1:5, 2)')).toBe('5');
  expect(card('numel(magic(4))')).toBe('16');
  expect(card('length(zeros(3, 7))')).toBe('7');
  expect(card('isempty([])')).toBe('1');
  expect(card('size([])')).toBe('[0; 0]');
  expect(card('find([0 3 0 5])')).toBe('[2; 4]');
  expect(card('find([0 1; 1 1])')).toBe('[[2], [3], [4]]');
  expect(card('find([1 1 1 1], 2)')).toBe('[1; 2]');
  expect(card('any([0 0 1])')).toBe('1');
  expect(card('all([1 2 0])')).toBe('0');
  expect(card('all([1 2; 3 0])')).toBe('[1; 0]');
});

test('sums, products, differences: MATLAB’s on vectors, Σ and d/dx on expressions', () => {
  expect(card('sum([1 2 3 4])', 'Suma')).toBe('10');
  expect(card('sum([1 2; 3 4])', 'Sumy kolumn')).toBe('[4; 6]');
  expect(card('sum([1 2; 3 4], 2)', 'Sumy wierszy')).toBe('[[3], [7]]');
  expect(card('prod(1:5)', 'Iloczyn')).toBe('120');
  expect(card('cumsum(1:4)', 'Sumy częściowe')).toBe('[1; 3; 6; 10]');
  expect(card('cumsum([1 2; 3 4])')).toBe('[[1, 2], [4, 6]]');
  expect(card('cumprod([1 2 3])')).toBe('[1; 2; 6]');
  expect(card('diff([1 4 9 16])', 'Różnice kolejnych elementów')).toBe('[3; 5; 7]');
  expect(card('diff([1 4 9 16], 2)')).toBe('[2; 2]');
  expect(card('diff([1 2; 4 8])')).toBe('[3; 6]');
  expect(card('mean([1 2; 3 4])', 'Średnie kolumn')).toBe('[2; 3]');
  expect(card('mean([1 2 3 4])')).toBe('5/2');
  expect(card('median([3 1 2; 6 5 4; 9 8 7])')).toBe('[6; 5; 4]');
  expect(card('sort([3 1 2])', 'Posortowane')).toBe('[1; 2; 3]');
  expect(card("sort([3 1 2], 'descend')", 'Posortowane malejąco')).toBe('[3; 2; 1]');
  expect(card('sort([pi, 3, sqrt(10)])')).toBe('[3; π; √10]');
  expect(card('sum(1/2^(0:10))')).toBe('2047/1024');
  // the meanings from before stay
  expect(card('sum(1/k^2, k, 1, inf)', 'Suma')).toBe('π^2/6');
  expect(card('diff(x^3, x)', 'Pochodna')).toContain('3x^2');
  expect(card('mean(1, 2, 6)', 'Średnia arytmetyczna')).toBe('3');
  expect(run('sort([x, 1])').error).toMatch(/liczby rzeczywiste/);
});

test('comparisons of elements and logical indexing', () => {
  expect(card('[1 5 3 8] > 2', 'Porównanie element po elemencie')).toBe('[0; 1; 1; 1]');
  expect(card('[1 2; 3 4] == [1 0; 3 0]')).toBe('[[1, 0], [1, 0]]');
  const ask = session();
  ask('v = [1 5 3 8 2]');
  expect(card(ask('v(v > 2)'))).toBe('[5; 3; 8]');
  expect(card(ask('sum(v > 2)'))).toBe('3');
  expect(card(ask('find(v > 2)'))).toBe('[2; 3; 4]');
  expect(card(ask('v(end)'))).toBe('2');
  ask('A = magic(3)');
  // a logical matrix picks down the columns
  expect(card(ask('A(A > 5)'))).toBe('[8; 9; 6; 7]');
  expect(ask('v([1 0 1])').error).toMatch(/poza zakresem|Indeks/);
  // scalar comparisons are still inequalities to solve
  expect(card('x^2 < 4', 'Rozwiązanie')).toBe('x ∈ (−2; 2)');
});
