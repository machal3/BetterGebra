import { expect, test } from 'vitest';
import { run, type Result } from '../src/cas/engine';
import { compile } from '../src/math';

const ok = (q: string): Result => { const r = run(q); if (r.error) throw new Error(`${q}: ${r.error}`); return r; };
const value = (q: string) => ok(q).pods[0].rows[0].text;
const titles = (q: string) => ok(q).pods.map(p => p.title);
const pod = (q: string, title: string) => ok(q).pods.find(p => p.title === title);

test('round, fix, rem, nthroot, hypot and nchoosek as MATLAB has them', () => {
  expect(value('round(-2.5)')).toBe('−3');
  expect(value('round(2.5)')).toBe('3');
  expect(value('round(-7/2)')).toBe('−4');
  expect(value('fix(-2.7)')).toBe('−2');
  expect(value('rem(-7, 3)')).toBe('−1');
  expect(value('mod(-7, 3)')).toBe('2');
  expect(value('nthroot(-27, 3)')).toBe('−3');
  expect(value('hypot(3, 4)')).toBe('5');
  expect(value('nchoosek(5, 2)')).toBe('10');
  expect(value('quad(@(x) x.^2, 0, 1)')).toBe('1/3');
});

test('primes, sym2poly, poly2sym', () => {
  expect(value('primes(20)')).toBe('[2; 3; 5; 7; 11; 13; 17; 19]');
  expect(value('sym2poly(x^3 - 2x + 1)')).toBe('[1; 0; −2; 1]');
  expect(value('poly2sym([1 0 -2])')).toBe('x^2 − 2');
});

test('sqrtm and logm: exact where the spectrum allows, refused where the real root does not exist', () => {
  expect(value('sqrtm([4 0; 0 9])')).toBe('√A = [[2, 0], [0, 3]]');
  expect(value('sqrtm([2 1; 1 2])')).toBe('√A = [[(1 + √3)/2, (√3 − 1)/2], [(√3 − 1)/2, (1 + √3)/2]]');
  expect(value('logm([2 1; 0 2])')).toBe('ln A = [[ln(2), 1/2], [0, ln(2)]]');
  expect(value('logm(eye(2))')).toBe('ln A = [[0, 0], [0, 0]]');
  expect(run('sqrtm([1 2; 3 4])').error).toMatch(/wartość własną ujemną/);
  expect(ok('sqrtm([5 2; 1 4.5])').pods[0].note).toMatch(/Denmana–Beaversa|Dokładnie/);
});

test('a differential equation typed as it is goes to dsolve, and to ode45 when there is no exact solution', () => {
  expect(value("y' = y")).toBe('y(t) = C₁·e^t');
  expect(value("y'' + y = 0")).toBe('y(t) = C₁·cos(t) + C₂·sin(t)');
  expect(ok("y' = x*y, y(0) = 1").pods[1].rows[0].text).toBe('y(x) = e^(x^2/2)');
  const num = ok("y' = sin(y) + t, y(0) = 1");
  expect(num.pods[0].title).toBe('Rozwiązanie numeryczne (ode45)');
  expect(num.pods[0].note).toMatch(/ode45/);
  // a stored vector's prime stays its transpose
  const vars = ok('v = [1 2 3]').assigned!;
  expect(run("v'", { vars: vars as never }).pods[0].rows[0].text).toBe('[[1], [2], [3]]');
});

test('f(x, y) is drawn as surf and contour draw it; g(x, y) = … too', () => {
  expect(titles('x^2 + y^2')).toEqual(expect.arrayContaining(['Pochodne cząstkowe', 'Powierzchnia', 'Poziomice']));
  expect(pod('x^2 + y^2', 'Powierzchnia')!.plot!.three!.surfaces).toHaveLength(1);
  expect(titles('g = @(x, y) x^2 - y^2')).toEqual(expect.arrayContaining(['Powierzchnia', 'Poziomice']));
});

test('a polynomial shows its coefficient vector, offering roots', () => {
  const p = pod('x^3 - 2x + 1', 'Wektor współczynników')!;
  expect(p.rows[0].text).toBe('p = [1 0 −2 1]');
  expect(p.more!.query).toBe('roots([1 0 −2 1])');
  expect(run(p.more!.query).error).toBeUndefined();
});

test('a list gets mode, range and quartiles by MATLAB’s method', () => {
  const s = pod('[2 4 4 4 5 5 7 9]', 'Statystyki')!.rows.map(r => r.text);
  expect(s).toContain('dominanta (3 razy): 4');
  expect(s).toContain('rozstęp: 7');
  expect(pod('[2 4 4 4 5 5 7 9]', 'Kwartyle')!.rows.map(r => r.text)).toEqual(['Q₁ (25. percentyl): 4', 'Q₂ (mediana): 9/2', 'Q₃ (75. percentyl): 6', 'rozstęp międzykwartylowy: 2']);
});

test('a matrix shows its norms, condition number and definiteness', () => {
  expect(pod('[1 2; 3 4]', 'Normy i uwarunkowanie')!.rows.map(r => r.text)).toEqual(['‖A‖₁ = 6', '‖A‖₂ = (√26 + √34)/2', '‖A‖∞ = 7', '‖A‖F = √30', 'cond A = (15 + √221)/2']);
  expect(pod('[3 1; 1 3]', 'Określoność')!.rows[0].text).toBe('Macierz symetryczna dodatnio określona.');
  expect(pod('[3 1; 1 3]', 'Określoność')!.more!.query).toBe('chol([[3, 1], [1, 3]])');
  expect(pod('[-2 1; 1 -2]', 'Określoność')!.rows[0].text).toBe('Macierz symetryczna ujemnie określona.');
  expect(pod('[1 2; 2 1]', 'Określoność')!.rows[0].text).toBe('Macierz symetryczna nieokreślona.');
  expect(pod('[1 2; 3 4]', 'Określoność')).toBeUndefined();
});

test('next steps name MATLAB’s functions, on the answer as it was written', () => {
  expect(ok('[1 2; 3 4]').next!.map(s => s.query)).toEqual(['lu([1 2; 3 4])', 'qr([1 2; 3 4])', 'svd([1 2; 3 4])', 'expm([1 2; 3 4])']);
  expect(ok('A = [4 1; 1 3]').next!.map(s => s.query)[0]).toBe('lu(A)');
  expect(ok('rand(3)').next!.map(s => s.query)).toContain('eig(ans)');
  expect(ok('1:5').next!.map(s => s.query)).toEqual(['cumsum(1:5)', 'diff(1:5)', 'polyfit(1:5, 1:5, 1)', 'fft(1:5)', 'norm(1:5)']);
  expect(ok('lu([2 1; 1 2])').next).toBeUndefined();
  for (const q of ok('[1 2; 3 4]').next!.map(s => s.query)) expect(run(q).error, q).toBeUndefined();
});

test('the graph panel reads MATLAB’s element-wise operators and functions', () => {
  expect(compile('x.^2 + 2.*x ./ 4')(2)).toBe(5);
  expect(compile('fix(x)')(-2.7)).toBe(-2);
  expect(compile('rem(x, 3)')(-7)).toBe(-1);
  expect(compile('nthroot(x, 3)')(-27)).toBeCloseTo(-3, 12);
  expect(compile('hypot(x, 4)')(3)).toBe(5);
  expect(compile('round(x)')(-2.5)).toBe(-3);
});

test('everyday phrasing: limits first, percent, mod and choose written between numbers', () => {
  expect(value('całka od 0 do 1 x^2')).toBe('1/3');
  expect(value('całka od 0 do pi sin(x) dx')).toBe('2');
  expect(value('12 mod 5')).toBe('2');
  expect(value('10 choose 3')).toBe('120');
  expect(value('10 nad 3')).toBe('120');
  expect(value('20%')).toBe('1/5');
  expect(value('15% z 80')).toBe('12');
  expect(value('100 + 20%')).toBe('120');
});

test('a "Wynik" that only repeats the question is left out; exact Gaussian numbers get no decimals', () => {
  expect(titles('x^3 - 3x')[0]).toBe('Postać iloczynowa');
  expect(titles('7')[0]).toBe('Liczba pierwsza');
  expect(titles('2+2*2')[0]).toBe('Wynik');
  expect(titles('sqrt(-1)')).not.toContain('Postać dziesiętna');
  expect(ok('x^2 + 1 = 0').pods[0].rows.map(r => r.note)).toEqual([undefined, undefined]);
  expect(ok('x^3 = 8').pods[1].rows[0].note).toBe('≈ −1 − 1,73205080757i');
});

test('roots give up the square content of a sum; a curve in x and y is solved for y', () => {
  expect(pod('sqrt(576 - 144y^2)', 'Postać uproszczona')!.rows[0].text).toBe('12√(4 − y^2)');
  expect(pod('sqrt(4x + 8)', 'Postać uproszczona')!.rows[0].text).toBe('2√(x + 2)');
  expect(ok('x^2/9 + y^2/4 = 1').pods[0].rows.map(r => r.text)).toEqual(['y = −2√(9 − x^2)/3', 'y = 2√(9 − x^2)/3']);
  expect(value('2x + y = 5')).toBe('y = 5 − 2x');
});

test('the conditions of a differential equation are shown as y(0), not y·0', () => {
  expect(ok("y' = -2y, y(0) = 1").input!.ml).toContain('<mi>y</mi><mrow><mo stretchy="false">(</mo><mn>0</mn>');
  expect(ok('y*2').input!.ml).not.toContain('stretchy="false">(');
});
