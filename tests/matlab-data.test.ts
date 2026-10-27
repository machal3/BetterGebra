import { expect, test } from 'vitest';
import { run, type Result } from '../src/cas/engine';

/** The rows of the card with this title (the first card without one). */
function card(q: string | Result, title?: string): string {
  const r = typeof q === 'string' ? run(q) : q;
  if (r.error) throw new Error(`${typeof q === 'string' ? q : ''}: ${r.error}`);
  const p = title ? r.pods.find(p => p.title === title) : r.pods[0];
  if (!p) throw new Error(`no card „${title}” in ${r.pods.map(p => p.title).join(', ')}`);
  return p.rows.map(r => r.text).join(' | ');
}
const first = (q: string) => { const r = run(q); if (r.error) throw new Error(`${q}: ${r.error}`); return r.pods[0]; };
const numbers = (s: string) => [...s.replace(/−/g, '-').matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map(m => Number(m[0]));

test('polynomials as coefficient vectors, highest power first', () => {
  expect(card('roots([1 -6 11 -6])')).toBe('[[3], [2], [1]]');
  expect(card('roots([1 0 -2])')).toBe('[[√2], [−√2]]');
  expect(card('roots([1 0 0])')).toBe('[[0], [0]]');
  const q = first('roots([1 2 3 4 5 6])');
  expect(q.note).toMatch(/macierzy towarzyszącej/);
  expect(q.rows[0].text.split('], [').length).toBe(5);
  expect(card('poly([1 2 3])')).toBe('[1; −6; 11; −6]');
  expect(card('poly([1 2; 3 4])')).toBe('[1; −5; −2]');
  expect(card('polyval([1 -3 2], 4)')).toBe('6');
  expect(card('polyval([1 -3 2], [0 1 2])')).toBe('[2; 0; 0]');
  expect(card('polyval([1 -3 2], x)')).toBe('x^2 − 3x + 2');
  expect(card('polyder([1 -3 2])')).toBe('[2; −3]');
  expect(card('polyder([1 1], [1 -1])')).toBe('[2; 0]');
  expect(card('polyint([3 2 1])')).toBe('[1; 1; 1; 0]');
  expect(card('conv([1 1], [1 -1])')).toBe('[1; 0; −1]');
  expect(card('deconv([1 0 -1], [1 1])')).toBe('q = [1; −1] | r = [0; 0; 0]');
  // roots of an expression still go to solve
  expect(card('roots(x^2 - 4)', 'Rozwiązania')).toBe('x = −2 | x = 2');
});

test('residue: partial fractions exactly, repeated poles in MATLAB’s order', () => {
  expect(card('residue([1], [1 -3 2])')).toBe('r = [[1], [−1]] | p = [[2], [1]] | k = []');
  expect(card('residue([1 0], [1 -2 1])')).toBe('r = [[1], [1]] | p = [[1], [1]] | k = []');
  expect(card('residue([1 0 0], [1 -1])')).toBe('r = 1 | p = 1 | k = [1; 1]');
});

test('polyfit: exact for rational data, through QR otherwise', () => {
  const line = first('polyfit([0 1 2], [1 2 2], 1)');
  expect(line.rows[0].text).toBe('p = [1/2; 7/6]');
  expect(line.rows[1].text).toBe('p(x) = x/2 + 7/6');
  expect(line.note).toMatch(/równań normalnych nad ℚ/);
  expect(line.plot?.series.map(s => s.style)).toEqual(['dots', undefined]);
  expect(card('polyfit([0 1 2], [1 3 7], 2)').split(' | ')[0]).toBe('p = [1; 1; 1]');
  expect(card('polyfit([1 2 3], [2 4 6], 1)')).toContain('R² = 1');
  const approx = numbers(card('polyfit(double([0 1 2]), [1 2 2], 1)').split(' | ')[0]);
  expect(approx[0]).toBeCloseTo(0.5, 14);
  expect(approx[1]).toBeCloseTo(7 / 6, 14);
  expect(run('polyfit([1 2], [1 2], 3)').error).toMatch(/co najmniej 4 punktów/);
});

test('fit: a model with parameters by Levenberg–Marquardt, x the data’s own', () => {
  const r = run('x = 0:5; y = 2*exp(x/2); fit(x, y, a*exp(b*x))');
  const c = card(r, 'Dopasowanie modelu (najmniejsze kwadraty)');
  const [a, b] = numbers(c);
  expect(a).toBeCloseTo(2, 8);
  expect(b).toBeCloseTo(0.5, 8);
  expect(run('fit([1 2 3], [1 2 3], x^2)').error).toMatch(/nie ma parametrów/);
});

test('interp1: linear, nearest and the rest, exact, no silent extrapolation', () => {
  expect(card('interp1([1 2 3], [10 20 30], 2.5)')).toBe('25');
  expect(card('interp1([1 2 3], [10 20 30], [1.5 2.5])')).toBe('[15; 25]');
  expect(card("interp1([1 2 3], [10 20 30], 1.6, 'nearest')")).toBe('20');
  expect(card("interp1([1 2 3], [10 20 30], 2.5, 'previous')")).toBe('20');
  expect(run('interp1([1 2 3], [10 20 30], 4)').error).toMatch(/poza danymi/);
  expect(card("interp1([1 2 3], [10 20 30], 4, 'linear', 'extrap')")).toBe('40');
  // unsorted data are sorted first
  expect(card('interp1([3 1 2], [30 10 20], 2.5)')).toBe('25');
  expect(numbers(card('interp1(double([1 2]), [0 1], 1.5)'))[0]).toBe(0.5);
});

test('spline and pchip: MATLAB’s not-a-knot spline reproduces cubics; pchip keeps monotone data monotone', () => {
  // not-a-knot reproduces a cubic exactly: x³ at 2.5 is 125/8
  expect(card('spline(0:4, [0 1 8 27 64], 2.5)')).toBe('125/8');
  expect(card("interp1(0:4, [0 1 8 27 64], 2.5, 'spline')")).toBe('125/8');
  // three points: the parabola through them
  expect(card('spline([0 1 2], [0 1 4], 1.5)')).toBe('9/4');
  // clamped: y with the end slopes around it; x² with slopes 0 and 4 is x² again
  expect(card('spline([0 1 2], [0 0 1 4 4], 0.5)')).toBe('1/4');
  // the textbook's natural spline, through (0,0), (1,1), (2,0): the middle slope is 0
  expect(card("spline([0 1 2], [0 1 0], 'natural')")).toContain('na ⟨0; 1⟩ = ');
  expect(card('pchip([1 2 3 4], [1 1 2 2], 2.5)')).toBe('3/2');
  expect(card('pchip([1 2 3 4], [1 1 2 2], 1.5)')).toBe('1');
  const pieces = first('spline(0:3, [0 1 0 1])');
  expect(pieces.rows.length).toBe(3);
  expect(pieces.plot).toBeTruthy();
});

test('trapz and cumtrapz', () => {
  expect(card('trapz([1 2 3])')).toBe('4');
  expect(card('trapz([0 1 2], [0 1 4])')).toBe('3');
  expect(card('cumtrapz([1 2 3])')).toBe('[0; 3/2; 4]');
});

test('plots of data', () => {
  const p = first('plot([1 2 3], [4 5 6])');
  expect(p.title).toBe('Wykres danych');
  expect(p.plot?.series[0].segs).toEqual([[1, 4, 2, 5, 3, 6]]);
  expect(first('plot([4 5 6])').plot?.series[0].segs).toEqual([[1, 4, 2, 5, 3, 6]]);
  expect(first('scatter([1 2], [3 4])').plot?.series[0].style).toBe('dots');
  expect(first('stem([1 -2 3])').plot?.series[0].style).toBe('stems');
  expect(first('bar([3 1 2])').plot?.bars.length).toBe(3);
  const h = first('histogram([1 2 2 3 3 3], 3)');
  expect(h.rows[0].text).toBe('liczności = [1; 2; 3]');
  expect(h.plot?.bars.length).toBe(3);
  expect(first('errorbar([1 2 3], [2 3 4], [0.5 0.5 1])').plot?.vectors.length).toBe(3);
  const polar = first('polarplot(1 + cos(t))');
  expect(polar.plot?.equal).toBe(true);
  expect(polar.plot?.series[0].segs.length).toBeGreaterThan(0);
  // a function is still drawn as a function
  expect(run('plot(sin x)').pods[0].plot?.series[0].expr).toBe('sin(x)');
});
