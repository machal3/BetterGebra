import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, roots, parameterNames } from './math.js';

test('parameters default to one and update all compiled expressions', () => {
  const parameters = { a: 1, b: 1 };
  const line = compile('ax+b', parameters), parabola = compile('a*x^2+b', parameters);
  assert.equal(compile('a*x+b')(2), 3);
  assert.equal(line(2), 3);
  parameters.a = -2.5; parameters.b = 0;
  assert.equal(line(2), -5);
  assert.equal(parabola(2), -10);
  assert.deepEqual(roots(line, -10, 10), [0]);
  assert.equal(compile('a*sin(b*x)', { a: 2, b: Math.PI / 2 })(1), 2);
});

test('parameter discovery handles unfinished expressions and excludes reserved names', () => {
  assert.deepEqual(parameterNames('y = A*x + b + a'), ['a', 'b']);
  assert.deepEqual(parameterNames('ax+b+'), ['a', 'b']);
  assert.deepEqual(parameterNames('sin(x)+cos(x)+tan(x)+asin(x)+acos(x)+atan(x)+sqrt(x)+abs(x)+ln(e)+log(x)+exp(x)+floor(x)+ceil(x)+pi+π+1e3'), []);
  assert.deepEqual(parameterNames(''), []);
  assert.deepEqual(parameterNames('c+y'), ['c', 'y']);
});
test('operator precedence, powers and implicit multiplication', () => {
  assert.equal(compile('-x^2')(3), -9);
  assert.equal(compile('2x + 3(x+1)')(2), 13);
  assert.equal(compile('2^3^2')(0), 512);
  assert.equal(compile('x^-2')(2), .25);
  assert.equal(compile('y = x² − 2')(3), 7);
  assert.equal(compile('2(x+1)(x-1)')(3), 16);
});
test('constants, functions and domains', () => {
  assert.ok(Math.abs(compile('sin(pi/2)')(0) - 1) < 1e-10);
  assert.equal(compile('ln(e)')(0), 1);
  assert.equal(compile('sqrt(x)')(4), 2);
  assert.ok(Number.isNaN(compile('ln(x)')(-1)));
  assert.equal(compile('exp(-x^2)')(0), 1);
});
test('invalid and executable input is rejected', () => {
  for (const expr of ['', 'x+', 'sin x', '(x+2', 'x)', 'alert(1)', 'x;alert(1)', 'globalThis', 'x**2']) assert.throws(() => compile(expr), expr);
});
test('roots respect discontinuities', () => {
  assert.deepEqual(roots(compile('x^2'), -10, 10), [0]);
  assert.deepEqual(roots(compile('1/x'), -10, 10), []);
  const r = roots(compile('x^2-2'), -10, 10);
  assert.equal(r.length, 2); assert.ok(Math.abs(r[1] - Math.SQRT2) < 1e-6);
});
