import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, roots, parameterNames, toMathML, intersections, exact, endpoint, holes } from './math.js';

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
  for (const expr of ['', 'x+', 'sin', '(x+2', 'x)', 'alert(1)', 'x;alert(1)', 'globalThis', 'foo(x)', '|x', 'max(1)', 'x_1', '<x>']) assert.throws(() => compile(expr), expr);
});
test('roots respect discontinuities', () => {
  assert.deepEqual(roots(compile('x^2'), -10, 10), [0]);
  assert.deepEqual(roots(compile('1/x'), -10, 10), []);
  const r = roots(compile('x^2-2'), -10, 10);
  assert.equal(r.length, 2); assert.ok(Math.abs(r[1] - Math.SQRT2) < 1e-6);
});
test('rich math syntax', () => {
  const near = (expr, x, want) => assert.ok(Math.abs(compile(expr)(x) - want) < 1e-9, `${expr} at ${x}: ${compile(expr)(x)} ≠ ${want}`);
  near('sin x', 1, Math.sin(1));
  near('sinx', 1, Math.sin(1));
  near('sin 2x', 1, Math.sin(2));
  near('2 sin x cos x', 1, Math.sin(2));
  near('sin²x + cos²x', 0.7, 1);
  near('sin^-1(x)', .5, Math.asin(.5));
  near('tg x', 1, Math.tan(1));
  near('ctg(x)', 1, 1 / Math.tan(1));
  near('arctg x', 1, Math.PI / 4);
  near('|x - 3|', 1, 2);
  near('||x|-1|', -3, 2);
  near('|x||x|', -2, 4);
  near('x!', 5, 120);
  near('x!', .5, Math.sqrt(Math.PI) / 2);
  near('90°', 0, Math.PI / 2);
  near('sin(30°)', 0, .5);
  near('√x', 9, 3);
  near('√(x+7)', 9, 4);
  near('∛x', -8, -2);
  near('root(3; x)', -27, -3);
  near('log_2(x)', 8, 3);
  near('log(2, x)', 8, 3);
  near('log x', 100, 2);
  near('lg x', 100, 2);
  near('ln x', Math.E, 1);
  near('2pix', 1, 2 * Math.PI);
  near('τ', 0, 2 * Math.PI);
  near('φ', 0, (1 + Math.sqrt(5)) / 2);
  near('max(x; 1; 2)', 0, 2);
  near('min(x, 1)', 0, 0);
  near('mod(x; 3)', -1, 2);
  near('2,5x', 2, 5);
  near('x**2', 3, 9);
  near('x³', 2, 8);
  near('x⁻¹', 4, .25);
  near('6 : x', 2, 3);
  near('[x+1]{x-1}', 3, 8);
  near('f(x) = x^2', 3, 9);
  near(String.raw`\frac{1}{x}`, 4, .25);
  near(String.raw`\sqrt[3]{x}`, 8, 2);
  near(String.raw`\left(x \cdot 2\right)^{2}`, 1, 4);
  near('e^{-x^2}', 0, 1);
  near('sinh x', 1, Math.sinh(1));
  near('sgn(x)', -5, -1);
  near('round(x)', 2.6, 3);
  assert.deepEqual(parameterNames('a sin(bx) + c'), ['a', 'b', 'c']);
});
test('MathML formatting', () => {
  const m = expr => toMathML(expr);
  assert.match(m('1/x'), /<mfrac><mrow><mn>1<\/mn><\/mrow><mrow><mi>x<\/mi><\/mrow><\/mfrac>/);
  assert.match(m('sqrt(x+1)'), /<msqrt>/);
  assert.match(m('root(3; x)'), /<mroot><mrow><mi>x<\/mi><\/mrow><mrow><mn>3<\/mn><\/mrow><\/mroot>/);
  assert.match(m('x^2'), /<msup><mrow><mi>x<\/mi><\/mrow><mrow><mn>2<\/mn><\/mrow><\/msup>/);
  assert.match(m('(x+1)^2'), /<msup><mrow><mrow><mo>\(<\/mo>/);
  assert.match(m('|x|'), /<mo>\|<\/mo><mi>x<\/mi><mo>\|<\/mo>/);
  assert.match(m('tan x'), />tg</);
  assert.match(m('sin^2(x)'), /<msup><mi mathvariant="normal">sin<\/mi><mrow><mn>2<\/mn><\/mrow><\/msup>/);
  assert.match(m('x*2'), /<mo>·<\/mo>/);
  assert.doesNotMatch(m('2x'), /·/);
  assert.match(m('2.5'), /<mn>2,5<\/mn>/);
  assert.match(m('x-(x+1)'), /<mo>−<\/mo><mrow><mo>\(<\/mo>/);
  assert.match(m('pi'), /π/);
  assert.match(m('exp(x)'), /<msup><mi>e<\/mi>/);});
test('accurate roots: exact values, touching roots, poles', () => {
  const r = expr => roots(compile(expr), -10, 10);
  assert.deepEqual(r('x^2'), [0]);
  assert.deepEqual(r('(x-1)^2'), [1]);
  assert.deepEqual(r('x^2-4'), [-2, 2]);
  assert.deepEqual(r('x^3-x'), [-1, 0, 1]);
  assert.deepEqual(r('1/x'), []);
  assert.deepEqual(r('tan(x)').length, 7);
  assert.deepEqual(r('x^2+1'), []);
  assert.deepEqual(r('sin(x)^2').map(exact), ['−3π', '−2π', '−π', '0', 'π', '2π', '3π']);
  assert.equal(r('x^2-2')[1], Math.SQRT2);
  assert.equal(r('cos x - x')[0].toFixed(12), '0.739085133215');
  assert.deepEqual(r('|x|-3'), [-3, 3]);
  assert.deepEqual(r('floor(x)'), [0]);
});
test('intersections and exact forms', () => {
  const pts = intersections(compile('x^2'), compile('x+2'), -10, 10);
  assert.deepEqual(pts, [{ x: -1, y: 1 }, { x: 2, y: 4 }]);
  assert.deepEqual(intersections(compile('x^2'), compile('2x-1'), -10, 10), [{ x: 1, y: 1 }]);
  assert.deepEqual(intersections(compile('sin x'), compile('cos x'), 0, 3).map(p => exact(p.x)), ['π/4']);
  assert.deepEqual([0, 2, -3, .5, 1 / 3, Math.SQRT2, -Math.SQRT1_2, Math.PI / 2, 2 * Math.sqrt(3), 0.7390851332].map(exact),
    ['0', '2', '−3', '1/2', '1/3', '√2', '−√2/2', 'π/2', '2√3', null]);
});
test('endpoints: closed when the point belongs to the graph, open when only approached', () => {
  const tol = .01, ends = (expr, a, b) => endpoint(compile(expr), a, b, tol).dots.map(({ x, y, closed }) => [x, +y.toFixed(6), closed]);
  assert.deepEqual(ends('sqrt(x)', -.013, .007), [[0, 0, true]]);
  assert.deepEqual(ends('acos(x)', .995, 1.004), [[1, 0, true]]);
  assert.deepEqual(ends('floor(x)', 2.99, 3.01), [[3, 3, true], [3, 2, false]]);
  assert.deepEqual(ends('ceil(x)', 2.99, 3.01), [[3, 3, true], [3, 4, false]]);
  assert.deepEqual(ends('sign(x)', -.01, .02), [[0, 0, true], [0, -1, false], [0, 1, false]]);
  assert.deepEqual(ends('sqrt(x)/sqrt(x)', -.01, .02), [[0, 1, false]]);
  assert.deepEqual(ends('ln(x)', -.01, .02), []);
  assert.deepEqual(ends('1/x', -.01, .02), []);
  const [edge] = endpoint(compile('sqrt(2-x^2)'), 1.41, 1.42, tol).dots;
  assert.ok(edge.closed && Math.abs(edge.x - Math.SQRT2) < 1e-12 && Math.abs(edge.y) < 1e-6);
});
test('holes: removable gaps are found as open dots', () => {
  const tol = .01, h = expr => holes(compile(expr), -10, 10, tol).map(({ x, y, closed }) => [x, +y.toFixed(6), closed]);
  assert.deepEqual(h('sin(x)/x'), [[0, 1, false]]);
  assert.deepEqual(h('(x^2-1)/(x-1)'), [[1, 2, false]]);
  assert.deepEqual(h('x/x'), [[0, 1, false]]);
  assert.deepEqual(h('1/x'), []);
  assert.deepEqual(h('ln(x)'), []);
  assert.deepEqual(h('x^2'), []);
});
test('endpoints: where each side of the graph is joined', () => {
  const join = (expr, a, b, tol = .01) => { const e = endpoint(compile(expr), a, b, tol); return [e.x, e.left, e.right]; };
  assert.deepEqual(join('sqrt(x)', -.013, .007), [0, NaN, 0]);
  assert.deepEqual(join('sqrt(x)', -1e-6, 1e-6, 5e-8), [0, NaN, 0]);   // heavy zoom: still reaches exactly (0; 0)
  assert.deepEqual(join('-sqrt(1-x)', .99, 1.01), [1, -0, NaN]);
  assert.deepEqual(join('floor(x)', 2.99, 3.01), [3, 2, 3]);
  assert.deepEqual(join('floor(1000x)/1000', .00099, .00101, 1e-6), [.001, 0, .001]);   // jump at a decimal, zoomed in
  assert.deepEqual(endpoint(compile('floor(1000x)/1000'), .00099, .00101, 1e-6).dots.map(d => [d.y, d.closed]), [[.001, true], [0, false]]);
  assert.deepEqual(join('ln(x)', -.01, .02), [0, NaN, -Infinity]);
  assert.deepEqual(join('1/x', -.01, .02), [0, -Infinity, Infinity]);
  assert.deepEqual(join('-1/x^2', -.01, .02), [0, -Infinity, -Infinity]);
  const t = endpoint(compile('tan(x)'), 1.57, 1.58, .01);
  assert.ok(Math.abs(t.x - Math.PI / 2) < 1e-15 && t.left === Infinity && t.right === -Infinity && t.dots.length === 0);
  const steep = endpoint(compile('1000000x'), -1e-6, 1e-6, .01);
  assert.ok(steep.left === steep.right && steep.dots.length === 0);  // continuous: joined, nothing to mark
});
