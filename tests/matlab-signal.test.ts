import { expect, test } from 'vitest';
import { run, type Result } from '../src/cas/engine';

function card(q: string | Result, title?: string): string {
  const r = typeof q === 'string' ? run(q) : q;
  if (r.error) throw new Error(`${typeof q === 'string' ? q : ''}: ${r.error}`);
  const p = title ? r.pods.find(p => p.title === title) : r.pods[0];
  if (!p) throw new Error(`no card „${title}” in ${r.pods.map(p => p.title).join(', ')}`);
  return p.rows.map(r => r.text).join(' | ');
}
const first = (q: string) => { const r = run(q); if (r.error) throw new Error(`${q}: ${r.error}`); return r.pods[0]; };
/** The complex numbers of a list text, read back: "1.5 − 2i" etc. */
function complexes(s: string): [number, number][] {
  return s.replace(/^[^[]*\[/, '').replace(/\]$/, '').split('; ').map(t => {
    const u = t.replace(/−/g, '-').replace(/\s/g, '');
    const m = u.match(/^(-?[\d.e-]+?)?(?:([+-][\d.e-]*)i)?$/) ?? u.match(/^(-?[\d.e-]*)i$/);
    if (u.endsWith('i') && !/[\d.]([+-])/.test(u.slice(1))) return [0, Number(u.slice(0, -1) || '1')];
    return [Number(m?.[1] ?? 0), m?.[2] !== undefined ? Number(m[2] === '+' || m[2] === '-' ? `${m[2]}1` : m[2]) : 0];
  });
}
/** The DFT by its definition, for checking. */
function naive(x: number[]): [number, number][] {
  const n = x.length;
  return x.map((_, k) => x.reduce<[number, number]>(([r, i], v, j) => [r + v * Math.cos(-2 * Math.PI * j * k / n), i + v * Math.sin(-2 * Math.PI * j * k / n)], [0, 0]));
}

test('fft and ifft: exact for short signals, checked numbers otherwise', () => {
  const f = first('fft([1 2 3 4])');
  expect(f.rows[0].text).toBe('X = [10; 2i − 2; −2; −2 − 2i]'); // the engine writes −2 + 2i as 2i − 2
  expect(f.note).toMatch(/Dokładnie/);
  expect(card('fft([1 0 0 0 0])')).toBe('X = [1; 1; 1; 1; 1]');
  expect(card('ifft([10, -2 + 2i, -2, -2 - 2i])')).toBe('x = [1; 2; 3; 4]');
  // 7 points: no closed form for cos(2π/7), so Bluestein, checked against the definition
  const x = [3, -1, 4, 1, -5, 9, 2];
  const seven = first(`fft([${x.join(' ')}])`);
  expect(seven.note).toMatch(/Bluestein/);
  const got = complexes(seven.rows[0].text.replace(/^X = /, '')), want = naive(x);
  got.forEach(([r, i], k) => { expect(r).toBeCloseTo(want[k][0], 9); expect(i).toBeCloseTo(want[k][1], 9); });
  // a sine of 5 periods in 100 samples: the peaks at k = 5 and 95, of height 50
  const s = first('fft(sin(2*pi*5*(0:99)/100))');
  expect(s.note).toMatch(/radix-2|Bluestein/);
  expect(s.note).toMatch(/k = 5, \|X\| ≈ 50/);
  expect(s.plot?.series[0].style).toBe('stems');
  expect(card('fft([1 2 3], 4)')).toBe('X = [6; −2 − 2i; 2; 2i − 2]');
});

test('fftshift, ifftshift, angle', () => {
  expect(card('fftshift([1 2 3 4 5])')).toBe('[4; 5; 1; 2; 3]');
  expect(card('ifftshift([4 5 1 2 3])')).toBe('[1; 2; 3; 4; 5]');
  expect(card('fftshift([1 2 3 4])')).toBe('[3; 4; 1; 2]');
  expect(card('angle(1 + i)', 'Wynik')).toBe('π/4');
});

test('filter: the difference equation, exact', () => {
  expect(card('filter(1, [1 -0.5], [1 0 0 0])')).toBe('y = [1; 1/2; 1/4; 1/8]');
  expect(card('filter([1 1]/2, 1, [2 4 6])')).toBe('y = [1; 3; 5]');
  expect(card('filter([1 1], [2], [2 4 6])')).toBe('y = [1; 3; 5]');
  expect(run('filter(1, [0 1], [1 2])').error).toMatch(/pierwszy współczynnik/);
});

test('periodogram: the strongest frequency of a sampled sine', () => {
  const p = first('periodogram(sin(2*pi*10*(0:99)/100), 100)');
  expect(p.note).toMatch(/Najsilniejsza składowa: 10 Hz/);
  expect(p.note).toMatch(/Jednostronny/);
  expect(p.rows[0].note).toBe('51 elementów');
});
