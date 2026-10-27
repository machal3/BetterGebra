import { expect, test } from 'vitest';
import { run, type Result, type Saved } from '../src/cas/engine';
import { parseTable, tableVariables } from '../src/app/calculator/csv';

/** The rows of the card with this title (the first card without one). */
function card(q: string | Result, title?: string): string {
  const r = typeof q === 'string' ? run(q) : q;
  if (r.error) throw new Error(`${typeof q === 'string' ? q : ''}: ${r.error}`);
  const p = title ? r.pods.find(p => p.title === title) : r.pods[0];
  if (!p) throw new Error(`no card „${title}” in ${r.pods.map(p => p.title).join(', ')}`);
  return p.rows.map(r => r.text).join(' | ');
}
/** The value of the first row: its decimals (the note of an exact irrational, or the number itself). */
function value(q: string): number {
  const r = run(q);
  if (r.error) throw new Error(`${q}: ${r.error}`);
  const row = r.pods[0].rows[0], s = (row.note ?? row.text).replace(/−/g, '-').replace(/(\d),(\d)/g, '$1.$2');
  const frac = !row.note && s.match(/(-?\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const m = s.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g);
  return Number(m![m!.length - 1]);
}
function session(vars: Record<string, Saved> = {}) {
  return (q: string): Result => {
    const r = run(q, { vars: { ...vars } });
    for (const [k, v] of Object.entries(r.assigned ?? {})) { if (v) vars[k] = v; else delete vars[k]; }
    return r;
  };
}

test('descriptive statistics, exact, MATLAB’s definitions', () => {
  expect(card('mode([1 2 2 3 3])')).toBe('2');
  expect(card('range([3 9 1])')).toBe('8');
  expect(card('prctile([1 2 3 4], 50)')).toBe('5/2');
  expect(card('prctile([1 2 3 4], [25 75])')).toBe('[3/2; 7/2]');
  expect(card('prctile([1 2 3 4], 0)')).toBe('1');
  expect(card('quantile([1 2 3 4], 0.5)')).toBe('5/2');
  expect(card('iqr([1 2 3 4])')).toBe('2');
  expect(value('skewness([1 2 3 10])')).toBeCloseTo(1.01823, 4);
  expect(value('kurtosis([1 2 3 10])')).toBeCloseTo(2.23040, 4);
  expect(card('zscore([1 2 3])')).toBe('[−1; 0; 1]');
  expect(card('var([1 2; 3 4])')).toBe('[2; 2]');
  expect(card('var([1 2 3 4], 1)')).toBe('5/4');
  expect(card('std([1 2 3 4], 1)')).toBe('√5/2');
  // the old forms still work
  expect(card('variance(1, 2, 3, 4)', 'Wariancja (próby, mianownik n − 1)')).toBe('5/3');
  expect(card('cov([1 2 3], [1 2 4])')).toBe('[[1, 3/2], [3/2, 7/3]]');
  expect(card('corrcoef([1 2 3], [2 4 6])', 'Współczynnik korelacji Pearsona')).toBe('r = 1');
  expect(value('corrcoef([1 2 3], [1 2 4])')).toBeCloseTo(0.98198, 4);
  expect(card('histcounts([1 2 2 3 3 3], 3)').split(' | ')[0]).toBe('liczności = [1; 2; 3]');
});

test('distributions: exact where they have a closed form, checked doubles otherwise', () => {
  expect(value('normpdf(0)')).toBeCloseTo(0.3989422804014327, 10);
  expect(value('normcdf(1.96)')).toBeCloseTo(0.9750021048517795, 10);
  expect(value('norminv(0.975)')).toBeCloseTo(1.959963984540054, 9);
  expect(value('norminv(0.5, 10, 2)')).toBeCloseTo(10, 9);
  expect(value('tcdf(2, 5)')).toBeCloseTo(0.9490302605850709, 10);
  expect(value('tinv(0.975, 10)')).toBeCloseTo(2.228138851986274, 9);
  expect(value('chi2inv(0.95, 1)')).toBeCloseTo(3.841458820694124, 8);
  expect(value('finv(0.95, 2, 10)')).toBeCloseTo(4.102821015130399, 8);
  expect(card('binopdf(2, 4, 1/2)')).toBe('3/8');
  expect(card('binocdf(2, 4, 1/2)')).toBe('11/16');
  expect(value('poisspdf(2, 3)')).toBeCloseTo(0.22404180765538775, 12);
  expect(value('poisscdf(1, 2)')).toBeCloseTo(0.40600584970983811, 12);
  expect(card('expinv(0.5, 1)')).toBe('ln(2)');
  expect(card('unifcdf(0.3)')).toBe('3/10');
  expect(value('gamcdf(1, 1)')).toBeCloseTo(1 - Math.exp(-1), 12);
  expect(value('betacdf(0.5, 2, 2)')).toBeCloseTo(0.5, 12);
  expect(value('betainv(0.5, 2, 2)')).toBeCloseTo(0.5, 9);
  expect(card('normcdf([0 1])')).toMatch(/^\[1\/2;/);
  expect(run('norminv(2)').error).toMatch(/od 0 do 1/);
});

test('fitlm: exact coefficients, standard errors, t and p, R²', () => {
  const r = run('fitlm([1 2 3 4], [3 5 7 10])');
  expect(card(r, 'Model regresji liniowej')).toBe('y = 0,5 + 2,3·x');
  expect(r.pods[0].note).toMatch(/R² ≈ 0,9888/);
  expect(r.pods[0].plot?.series.length).toBe(2);
  const rows = card(r, 'Współczynniki');
  expect(rows).toMatch(/^b₀: 0,5 {3}SE ≈/);
  expect(rows).toMatch(/b₁: 2,3 {3}SE ≈ 0,1732 {3}t ≈ 13,28 {3}p ≈ 0,0056/);
});

test('random numbers: in range, repeatable after rng, the state hidden', () => {
  const vars: Record<string, Saved> = {}, ask = session(vars);
  ask('rng(42)');
  const a = card(ask('rand(1, 3)'));
  ask('rng(42)');
  expect(card(ask('rand(1, 3)'))).toBe(a);
  const next = card(ask('rand(1, 3)'));
  expect(next).not.toBe(a);
  for (const v of a.replace(/[[\]]/g, '').split('; ')) { expect(Number(v)).toBeGreaterThan(0); expect(Number(v)).toBeLessThan(1); }
  const dice = card(ask('randi([1 6], 1, 200)')).replace(/[[\]]/g, '').split('; ').map(Number);
  expect(dice.every(d => Number.isInteger(d) && d >= 1 && d <= 6)).toBe(true);
  expect(new Set(dice).size).toBe(6);
  ask('z = randn(1, 500)');
  expect(Math.abs(Number(card(ask('mean(z)')).replace('−', '-')))).toBeLessThan(0.2);
  expect(card(ask('who'))).not.toMatch(/#rng/);
  expect(Object.keys(vars)).toContain('#rng');
});

test('a table pasted from a spreadsheet becomes variables', () => {
  const t = parseTable('czas;temperatura\n0;12,5\n1;13,1\n2;14');
  expect(t.header).toBe(true);
  expect(t.separator).toBe('średnik');
  expect(t.columns.map(c => c.name)).toEqual(['czas', 'temperatura']);
  const { vars } = tableVariables(t);
  expect(Object.keys(vars)).toEqual(['czas', 'temperatura', 'dane']);
  expect(vars.dane.label).toBe('macierz 3×2');
  expect(card(run('mean(temperatura)', { vars }))).toBe('66/5');
  expect(card(run('size(dane)', { vars }))).toBe('[3; 2]');
  // commas between columns and dots for decimals; no header; names made legal
  expect(parseTable('x,y\n1,2.5\n2,3.5').columns.map(c => c.values)).toEqual([['1', '2'], ['2.5', '3.5']]);
  expect(parseTable('1 2\n3 4').columns.map(c => c.name)).toEqual(['kol1', 'kol2']);
  expect(parseTable('Średnia wartość\tsin\n1\t2').columns.map(c => c.name)).toEqual(['srednia_wartosc', 'sin_']);
  const bad = parseTable('a;b\n1;x\n2;3');
  expect(bad.columns.map(c => c.name)).toEqual(['a']);
  expect(bad.problems[0]).toMatch(/Pomijam kolumnę b/);
});

test('a fraction becomes the nearest double, so stored approximate numbers come back the same', async () => {
  const { qToNumber, parseDecimal } = await import('../src/cas/q');
  for (const s of ['0.41409165340890175', '0.1', '1e-300', '123456789012345678901234567890', '2.2250738585072014e-308', '0.30000000000000004']) {
    expect(qToNumber(parseDecimal(s))).toBe(Number(s));
  }
});
