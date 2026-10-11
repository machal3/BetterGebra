import { expect, test } from 'vitest';
import { MathError, compile, compileComplex, exactPoint, exactValue, parameterNames, relationMathML, roots, toMathML, extrema } from '../src/math';

test('bad input fails with a readable MathError, never anything else', () => {
  for (const s of ['', '   ', 'x'.repeat(301), 'x+', '2**', 'sin(', '|', '()', '1..2', 'max(1,2)']) {
    expect(() => compile(s), s).toThrow(MathError);
  }
  expect(parameterNames('x+')).toEqual([]);
});

test('square roots of zero and perfect squares read as plain numbers', () => {
  expect(exactValue('sqrt(1-x^2)', {}, 1)).toBe('0');
  expect(exactValue('sqrt(x)', {}, 0)).toBe('0');
  expect(exactValue('sqrt(x)', {}, 2.25)).toBe('3/2');
  expect(exactValue('sqrt(x)', {}, 8)).toBe('2√2');
});

test('exact helpers tolerate unparsable input', () => {
  expect(exactValue('x+', {}, 1)).toBeNull();
  expect(exactPoint(['x+', '0'], {}, 1)).toBeNull();
});

test('division by zero and huge values stay numbers, no throws', () => {
  expect(compile('1/x')(0)).toBe(Infinity);
  expect(Number.isNaN(compile('0/x')(0))).toBe(true);
  expect(compile('x!')(171)).toBe(Infinity);
  expect(roots(compile('1/x'), -1, 1)).toEqual([]);
});

test('roots and extrema at extreme zoom levels', () => {
  expect(roots(compile('x^2-1e-8'), -1e-3, 1e-3).map(x => Math.abs(x).toPrecision(6))).toEqual(['0.000100000', '0.000100000']);
  expect(roots(compile('x-5e6'), 0, 1e7)).toEqual([5e6]);
  expect(extrema(compile('(x-1e6)^2'), 0, 2e6).map(p => p.x)).toEqual([1e6]);
});

test('complex unit and variable names', () => {
  expect(compileComplex('i')([0, 0])).toEqual([0, 1]);
  expect(compileComplex('z')([2, 3])).toEqual([2, 3]);
  expect(compileComplex('a z', { a: 2 })([1, 1])).toEqual([2, 2]);
});

test('MathML escapes relations and typesets inverse functions', () => {
  expect(relationMathML('|z| < 2')).toContain('<mo>&#60;</mo>');
  expect(toMathML('sin^-1 x')).toContain('arcsin');
  expect(toMathML('a<b'.replace('<', '+'))).toContain('<mi>a</mi>');
});
