import { expect, test } from 'vitest';
import { run } from '../src/cas/engine';
import { calculatorQuery } from '../src/calculator-query';
import type { FnState, Mode } from '../src/state';

const fn = (expression: string): FnState => ({ id: 1, expression, color: '#000000', visible: true, from: -Infinity, to: Infinity, fromOpen: false, toOpen: false, width: 2, dash: '' });
const ask = (expression: string, mode: Mode, params: Record<string, number> = {}) => calculatorQuery(fn(expression), mode, params);

test('a graph goes to the calculator for a study, with the sliders’ values in place of parameters', () => {
  const q = ask('y = a·sin(b·x)', 'graph', { a: 2, b: 3 })!;
  expect(q.label).toBe('Zbadaj w kalkulatorze');
  const r = run(q.query);
  expect(r.error).toBeUndefined();
  expect(r.pods.find(p => p.title === 'Funkcja')!.rows[0].text).toBe('f(x) = 2sin(3x)');
  expect(run(ask('2,5x^2', 'graph')!.query).error).toBeUndefined();
});

test('Zespolone and the sets of Wykresy ask for zeros, solutions, curves and regions', () => {
  const zeros = run(ask('z^2 + 1', 'complex')!.query);
  expect(zeros.pods.map(p => p.rows.map(r => r.text).join('; '))).toContainEqual(expect.stringContaining('z = −i'));
  const eq = ask('z^3 = 8', 'graph')!;
  expect(eq.label).toBe('Rozwiąż w kalkulatorze');
  expect(run(eq.query).error).toBeUndefined();
  // curves and regions in x and y: the calculator draws them, with the sliders' values put in
  const circle = ask('x^2 + y^2 = r^2', 'graph', { r: 5 })!;
  expect(circle.query).toBe('x ^ 2 + y ^ 2 = ( 5 ) ^ 2'.replace(/ /g, ' ').replace('( 5 )', '(5)'));
  expect(run(circle.query).pods.map(p => p.title)).toContain('Krzywa');
  const region = ask('y > x^2', 'graph', { y: 7 })!;
  expect(region.label).toBe('Obszar w kalkulatorze');
  expect(run(region.query).pods.map(p => p.title)).toContain('Obszar');
  // conditions on z and numbers with unknowns stay in Wykresy
  expect(ask('|z - 1| <= 2', 'graph')).toBeNull();
  expect(ask('t + 2i', 'graph')).toBeNull();
  expect(ask('z = t + 2i', 'graph')).toBeNull();
});
