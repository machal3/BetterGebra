import { expect, test } from 'vitest';
import { compileRow, rowKind } from '../src/model';
import type { FnState } from '../src/state';

const fn = (expression: string): FnState => ({ id: 1, expression, color: '#000000', visible: true, from: -Infinity, to: Infinity, fromOpen: false, toOpen: false, width: 2, dash: '' });

test('each row of Wykresy says whether it is a graph or a set', () => {
  const kind = (s: string) => { const k = rowKind(s); return k.kind === 'graph' ? 'graph' : k.xy ? 'xy' : 'z'; };
  for (const s of ['x^2', 'y = x^2', 'f(x) = sin x', 'a x + b', 'x^2 + y^2', '3']) expect(kind(s), s).toBe('graph');
  for (const s of ['y > x^2', 'x = 2', 'x^2 + y^2 <= 25', '1 < x < 3', 'y = x^2 = 1', 'y^2 = x', 'y = x + y^2', 'y > sin 2x']) expect(kind(s), s).toBe('xy');
  for (const s of ['|z - 1| <= 2', '1 < Re z < 3', 'z^2 = -1', 't + 2i', 'a + bi', 'z = t + 2i', 'y = x + 2i']) expect(kind(s), s).toBe('z');
});

test('graphs keep everything they had: parameters, the domain, y = and f(x) =', () => {
  const params: Record<string, number> = {};
  const c = compileRow({ ...fn('y = a·sin(x)'), from: 0, to: 3 }, 'graph', params);
  params.a = 2;
  expect(c.fn!(Math.PI / 2)).toBe(2);
  expect(c.fn!(-1)).toBeNaN();
  expect(c.parameters).toEqual(['a']);
});

test('a condition in x and y is a set of points (x; y); other letters are sliders', () => {
  const params: Record<string, number> = {};
  const c = compileRow(fn('x^2 + y^2 <= r^2'), 'graph', params);
  expect(c.xy).toBe(true);
  expect(c.parameters).toEqual(['r']);
  expect(c.set?.kind).toBe('condition');
  if (c.set?.kind !== 'condition') return;
  expect(c.set.ops).toEqual(['≤']);
  expect(c.set.sides[0]([3, 4])).toEqual([25, 0]);
  params.r = 5;
  expect(c.set.sides[1]([0, 0])).toEqual([25, 0]);
});

test('sets on the complex plane read as they did in Zbiory', () => {
  const c = compileRow(fn('|z - 1| <= 2'), 'graph', {});
  expect(c.xy).toBe(false);
  if (c.set?.kind !== 'condition') throw new Error('not a condition');
  expect(c.set.sides[0]([1, 2])).toEqual([2, 0]);
  const t = compileRow({ ...fn('t + 2i'), from: 0, to: 1 }, 'graph', {});
  expect(t.set?.kind === 'parametric' && t.set.unknowns).toEqual(['t']);
  // Zespolone stays as it was: f(z) coloured
  expect(compileRow(fn('z^2 + 1'), 'complex', {}).cfn!([0, 1])).toEqual([0, 0]);
});

test('a condition in x and y keeps juxtaposed arguments: y > sin 2x is y > sin(2x)', () => {
  const c = compileRow(fn('y > sin 2x'), 'graph', {});
  const [lhs, rhs] = (c.set as { sides: ((z: [number, number]) => [number, number])[] }).sides;
  expect(rhs([1, 0.5])[0]).toBeCloseTo(Math.sin(2));
  expect(lhs([1, 0.5])[0]).toBeCloseTo(0.5);
});
