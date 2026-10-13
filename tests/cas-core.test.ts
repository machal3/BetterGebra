import { expect, test } from 'vitest';
import { add, mul, pow, num, sym, sqrt, div, sub, fn, PI, I, E, expand, toText, toML } from '../src/cas';
import { numericValue } from '../src/cas/numeric';

const x = sym('x');
test('core canonical forms', () => {
  expect(toText(sqrt(num(12)))).toBe('2√3');
  expect(toText(div(num(1), sqrt(num(2))))).toBe('√2/2');
  expect(toText(mul(sqrt(num(2)), sqrt(num(6))))).toBe('2√3');
  expect(toText(pow(num(8), num(2, 3)))).toBe('4');
  expect(toText(pow(num(4), num(3, 4)))).toBe('2√2');
  expect(toText(pow(num(-8), num(1, 3)))).toBe('−2');
  expect(toText(sqrt(num(-4)))).toBe('2i');
  expect(toText(add(x, x, num(1)))).toBe('2x + 1');
  expect(toText(expand(pow(add(x, num(1)), num(2))))).toBe('x^2 + 2x + 1');
  expect(toText(sub(expand(pow(add(x, num(1)), num(3))), expand(pow(add(x, num(1)), num(3)))))).toBe('0');
  expect(toText(mul(I, I))).toBe('−1');
  expect(toText(fn('sin', div(PI, num(5))))).toBe('√(10 − 2√5)/4');
  expect(toText(fn('cos', div(PI, num(12))))).toBe('(√2 + √6)/4');
  expect(toText(fn('atan', sub(num(2), sqrt(num(3)))))).toBe('π/12');
  expect(toText(pow(E, mul(I, PI)))).toBe('−1');
  expect(toText(fn('gamma', num(7, 2)))).toBe('15√π/8');
  expect(toText(fn('zeta', num(4)))).toBe('π^4/90');
  expect(toText(fn('log', num(2), num(1024)))).toBe('10');
  expect(toText(fn('abs', sub(num(1), sqrt(num(2)))))).toBe('√2 − 1');
  expect(toText(fn('floor', mul(num(100), PI)))).toBe('314');
});
test('numeric digits', () => {
  const v = numericValue(PI, 50);
  expect(v.re!.digits).toBe('31415926535897932384626433832795028841971693993751');
  expect(numericValue(sqrt(num(2)), 30).re!.digits).toBe('141421356237309504880168872421');
  expect(numericValue(E, 30).re!.digits).toBe('271828182845904523536028747135');
  expect(numericValue(fn('ln', num(10)), 25).re!.digits).toBe('2302585092994045684017991');
  expect(numericValue(fn('sin', num(1)), 25).re!.digits).toBe('8414709848078965066525023');
  expect(numericValue(fn('atan', num(1, 3)), 20).re!.digits).toBe('32175055439664219340');
  expect(numericValue(fn('gamma', num(1, 3)), 20).re!.digits).toBe('26789385347077476337');
  expect(numericValue(fn('erf', num(1)), 20).re!.digits).toBe('84270079294971486934');
  expect(numericValue(fn('zeta', num(3)), 20).re!.digits).toBe('12020569031595942854');
  const big = numericValue(sub(pow(E, mul(PI, sqrt(num(163)))), num(262537412640768744n)), 10);
  expect(big.re!.neg).toBe(true);
  expect(big.re!.digits).toBe('7499274028');
});
test('mathml smoke', () => {
  expect(toML(div(add(x, num(1)), num(2)))).toContain('<mfrac>');
});
