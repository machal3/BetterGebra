import { expect, test } from 'vitest';
import { run } from '../src/cas/engine';

/** text of the first row of the card with this title */
function card(q: string, title: string): string {
  const r = run(q);
  if (r.error) throw new Error(`${q}: ${r.error}`);
  const p = r.pods.find(p => p.title === title);
  if (!p) throw new Error(`${q}: no card „${title}” in ${r.pods.map(p => p.title).join(', ')}`);
  return p.rows.map(r => r.text).join(' | ');
}

test('exact arithmetic', () => {
  expect(card('2^100', 'Wynik')).toBe('1267650600228229401496703205376');
  expect(card('1/7 + 2/3', 'Wynik')).toBe('17/21');
  expect(card('1/7', 'Rozwinięcie dziesiętne okresowe')).toBe('0,(142857)');
  expect(card('sqrt(72)', 'Wynik')).toBe('6√2');
  expect(card('(1+2i)/(3-i)', 'Wynik')).toBe('(1 + 7i)/10');
  expect(card('e^(i pi/3)', 'Wynik')).toBe('(1 + √3i)/2'.replace('√3i', '√3·i'));
  expect(card('0.1 + 0.2', 'Wynik')).toBe('3/10');
});

test('digits are correct, not float noise', () => {
  expect(card('N(pi, 50)', 'Wartość z dokładnością do 50 cyfr znaczących')).toBe('3.1415926535897932384626433832795028841971693993751');
  expect(card('N(e^(pi sqrt(163)) - 262537412640768744, 10)', 'Wartość z dokładnością do 10 cyfr znaczących')).toBe('-7.499274028e-13'.replace('-', '−'));
  expect(card('sqrt(2)', 'Postać dziesiętna')).toBe('1.414213562373095048801689');
});

test('number theory', () => {
  expect(card('rozłóż 360', 'Rozkład na czynniki pierwsze')).toBe('2^3 · 3^2 · 5');
  expect(card('2^64 + 1', 'Rozkład na czynniki pierwsze')).toBe('274177 · 67280421310721');
  expect(card('isprime(2^89 - 1)', 'Czy pierwsza?')).toBe('Tak');
  expect(card('isprime(561)', 'Czy pierwsza?')).toBe('Nie'); // Carmichael number
  expect(card('nwd(462, 1071)', 'Największy wspólny dzielnik')).toBe('21');
  expect(card('crt([2,3,2],[3,5,7])', 'Rozwiązanie układu kongruencji')).toBe('x ≡ 23 (mod 105)');
  expect(card('fibonacci(100)', 'Liczba Fibonacciego')).toBe('354224848179261915075');
});

test('algebra', () => {
  expect(card('rozłóż x^4 - 1', 'Postać iloczynowa')).toBe('(x − 1)·(x + 1)·(x^2 + 1)');
  expect(card('factor(x^4 + 4)', 'Postać iloczynowa')).toBe('(x^2 − 2x + 2)·(x^2 + 2x + 2)');
  expect(card('factor(x^2 - y^2)', 'Postać iloczynowa')).toBe('(x + y)·(x − y)');
  expect(card('expand((a+b)^3)', 'Postać rozwinięta')).toBe('a^3 + 3a^2·b + 3a·b^2 + b^3');
  expect(card('apart(1/(x^2-1))', 'Rozkład na ułamki proste')).toBe('1/(2(x − 1)) − 1/(2(x + 1))');
});

test('equations', () => {
  expect(card('x^2 - 5x + 6 = 0', 'Rozwiązania')).toBe('x = 2 | x = 3');
  expect(card('x^3 - 3x + 1 = 0', 'Rozwiązania')).toBe('x = −2cos(π/9) | x = 2cos(4π/9) | x = 2cos(2π/9)');
  expect(card('sqrt(x+3) = x - 3', 'Rozwiązania')).toBe('x = 6');
  expect(card('2^x = 8', 'Rozwiązania')).toBe('x = 3');
  expect(card('sin(x) = 1/2', 'Rozwiązania')).toBe('x = 2kπ + π/6, k ∈ ℤ | x = 2kπ + 5π/6, k ∈ ℤ');
  expect(card('x/(x-1) = 1/(x-1)', 'Rozwiązanie')).toBe('Brak rozwiązań.');
  expect(card('x^2 + 1 = 0', 'Rozwiązania (zespolone)')).toBe('x = −i | x = i');
  expect(card('x + y = 5, x y = 6', 'Rozwiązania')).toBe('x = 3, y = 2 | x = 2, y = 3');
  expect(card('(x - 1)/(x + 2) >= 0', 'Rozwiązanie')).toBe('x ∈ (−∞; −2) ∪ ⟨1; +∞)');
});

test('calculus', () => {
  expect(card('granica sin(x)/x przy x->0', 'Granica')).toBe('1');
  expect(card('limit((1+1/n)^n, n->inf)', 'Granica')).toBe('e');
  expect(card('limit(1/x, x->0)', 'Granica')).toBe('Granica nie istnieje: granice jednostronne są różne.');
  expect(card('całka x^2 e^x dx', 'Całka nieoznaczona')).toBe('x^2·e^x − 2x·e^x + 2e^x + C');
  expect(card('całka 1/(1+x^2) od 0 do inf', 'Całka oznaczona')).toBe('π/2');
  expect(card('całka e^(-x^2) od -inf do inf', 'Całka oznaczona')).toBe('√π');
  expect(card('integrate(1/x^2, x, -1, 1)', 'Całka oznaczona')).toBe('Całka jest rozbieżna do +∞.');
  // biquadratics irreducible over ℚ split over ℝ into quadratics with surd coefficients (denested: √((3 − √5)/2) = (√5 − 1)/2)
  expect(card('integrate(1/(x^4+1), x)', 'Całka nieoznaczona')).toBe('(2√2·arctg(√2·x − 1) + 2√2·arctg(√2·x + 1) + √2·ln(x^2 + √2·x + 1) − √2·ln(x^2 − √2·x + 1))/8 + C');
  expect(card('integrate(x^2/(x^4+1), x)', 'Całka nieoznaczona')).toBe('(2√2·arctg(√2·x − 1) + 2√2·arctg(√2·x + 1) − √2·ln(x^2 + √2·x + 1) + √2·ln(x^2 − √2·x + 1))/8 + C');
  expect(card('integrate(1/(x^4+2), x)', 'Całka nieoznaczona')).toBe('(2·2^(3/4)·arctg(2^(1/4)·x − 1) + 2·2^(3/4)·arctg(2^(1/4)·x + 1) + 2^(3/4)·ln(x^2 + 2^(3/4)·x + √2) − 2^(3/4)·ln(x^2 − 2^(3/4)·x + √2))/16 + C');
  expect(card('integrate(1/(x^4+3x^2+1), x)', 'Całka nieoznaczona')).toBe('√5·arctg(x·(1 + √5)/2)·(1 + √5)/10 − √5·arctg(x·(√5 − 1)/2)·(√5 − 1)/10 + C');
  expect(card('integrate(1/(x^4+1), x, 0, 1)', 'Postać dziesiętna')).toBe('0.8669729873399110375739952');
  expect(card('sum(1/k^2, k, 1, inf)', 'Suma')).toBe('π^2/6');
  expect(card('sum(k^3, k, 1, n)', 'Suma')).toMatch(/n\^2·\(n \+ 1\)\^2\/4|\(n\^4 \+ 2n\^3 \+ n\^2\)\/4/);
  expect(card('szereg sin x', 'Szereg Taylora w x = 0')).toBe('x − x^3/6 + x^5/120 + O(x^7)');
});

test('matrices and statistics', () => {
  expect(card('det([[a,b],[c,d]])', 'Wyznacznik')).toBe('a·d − b·c');
  expect(card('[[1,2],[3,4]]', 'Macierz odwrotna')).toBe('A⁻¹ = [[−2, 1], [3/2, −1/2]]');
  expect(card('eigenvalues([[2,1],[1,2]])', 'Wartości własne')).toBe('λ = 1 | λ = 3');
  expect(card('{2, 4, 4, 4, 5, 5, 7, 9}', 'Statystyki')).toContain('średnia: 5');
});

test('bad input is a readable error, never a crash', () => {
  for (const q of ['', '(', 'x +', '1/0', 'sin(', '0^0', 'foo bar baz quux', 'det([[1,2]])', '2^(10^10)']) {
    const r = run(q);
    expect(r.error, q).toBeTruthy();
    expect(r.error, q).not.toMatch(/wewnętrzny/);
  }
});

test('fixes from the audit stay fixed', () => {
  expect(card('atan2(1, 1)', 'Wynik')).toBe('π/4');
  expect(card('granica 1/x gdy x dąży do 0+', 'Granica')).toBe('+∞');
  expect(card('limit(frac(x), x->1, -1)', 'Granica')).toBe('1');
  expect(card('solve(sin(x) / (x - pi) = 0)', 'Rozwiązania')).toBe('x = kπ, k ∈ ℤ ∖ {1}');
  expect(card('solve(sin(x) / (1 - cos(x)) = 0)', 'Rozwiązania')).toBe('x = π·(2k + 1), k ∈ ℤ');
  expect(card('integrate(sec(x)^3, x)', 'Całka nieoznaczona')).toContain('ln(|sec(x) + tg(x)|)/2');
  expect(card('integrate((x^2 + x + 1)^30, x)', 'Całka nieoznaczona')).toMatch(/^x\^61\/61 \+ /);
  // finding nothing numerically with a parameter in the way is not "no solutions"
  expect(run('solve(e^(a*x) + e^x = 2, x)').error).toMatch(/parametrami/);
  expect(run('foo').error).toMatch(/Nie rozpoznaję „foo”/);
});

test('wrong answers fixed: factor, simplify, log2/log10', () => {
  // x^(n + 1) was read as a polynomial of degree 0 and became 1
  expect(card('integrate(x^n, x)', 'Całka nieoznaczona')).toBe('x^(n + 1)/(n + 1) + C');
  expect(card('simplify(x^(n+1)/(n+1))', 'Postać uproszczona')).toBe('x^(n + 1)/(n + 1)');
  expect(card('log2(1024)', 'Wynik')).toBe('10');
  expect(card('log10(0.001)', 'Wynik')).toBe('−3');
  expect(card('ln(4) - 2 ln(2)', 'Wynik')).toBe('0');
  expect(card('ln(8)/ln(2)', 'Wynik')).toBe('3');
  expect(card('ln(12) - ln(3)', 'Wynik')).toBe('2ln(2)');
  expect(card('taylor(x^x, x, 1, 3)', 'Szereg Taylora w x = 1')).toBe('1 + (x − 1) + (x − 1)^2 + (x − 1)^3/2 + O((x − 1)^4)');
  expect(card('diff(e^(x^2), x, 3)', 'Pochodna rzędu 3')).toBe('d^3/dx^3 (e^(x^2)) = 8x^3·e^(x^2) + 12x·e^(x^2)');
});

test('exact constants: denesting, hyperbolic of ln, i^i', () => {
  expect(card('sqrt(3+2sqrt(2))', 'Wynik')).toBe('1 + √2');
  expect(card('sqrt(5+2sqrt(6))', 'Wynik')).toBe('√2 + √3');
  expect(card('sqrt(2-sqrt(3))', 'Wynik')).toBe('(√6 − √2)/2');
  expect(card('sqrt(1+sqrt(2))', 'Wynik')).toBe('√(1 + √2)');
  expect(card('cbrt(2+sqrt(5)) + cbrt(2-sqrt(5))', 'Wynik')).toBe('1');
  expect(card('cbrt(26+15sqrt(3))', 'Wynik')).toBe('2 + √3');
  expect(card('sinh(ln 2)', 'Wynik')).toBe('3/4');
  expect(card('tanh(ln 2)', 'Wynik')).toBe('3/5');
  expect(card('i^i', 'Wynik')).toBe('e^(−π/2)');
});

test('limits: exponents, essential singularities, factorials (Stirling)', () => {
  expect(card('limit(x^(1/x), x->inf)', 'Granica')).toBe('1');
  expect(card('limit(n^(1/n), n->inf)', 'Granica')).toBe('1');
  expect(card('limit(e^(-1/x^2)/x^10, x->0)', 'Granica')).toBe('0');
  expect(card('limit(n^100/2^n, n->inf)', 'Granica')).toBe('0');
  expect(card('limit(e^x/x^1000, x->inf)', 'Granica')).toBe('+∞');
  expect(card('limit(n!/n^n, n->inf)', 'Granica')).toBe('0');
  expect(card('limit((n!)^(1/n)/n, n->inf)', 'Granica')).toBe('1/e');
  expect(card('limit(ln(n!)/n - ln(n), n->inf)', 'Granica')).toBe('−1');
  expect(card('limit(sqrt(n) binomial(2n,n)/4^n, n->inf)', 'Granica')).toBe('1/√π');
  expect(card('limit((1+1/x)^(x^2) e^(-x), x->inf)', 'Granica')).toBe('1/√e');
});

test('integrals: parameters, roots of quadratics, Weierstrass, hyperbolic, trig powers', () => {
  const F = (q: string) => card(q, 'Całka nieoznaczona');
  expect(F('integrate(1/(x^2+a^2), x)')).toBe('arctg(x/a)/a + C');
  expect(F('integrate(1/(x^2-a^2), x)')).toBe('(ln(|x − a|) − ln(|a + x|))/(2a) + C');
  expect(F('integrate(x^2/sqrt(x^2+1), x)')).toBe('(x·√(x^2 + 1) − ln(|x + √(x^2 + 1)|))/2 + C');
  expect(F('integrate(x^2 sqrt(4-x^2), x)')).toBe('√(4 − x^2)·(x^3 − 2x)/4 + 2arcsin(x/2) + C');
  expect(F('integrate(sqrt(x^2-4)/x, x)')).toBe('√(x^2 − 4) − 2arctg(√(x^2 − 4)/2) + C');
  expect(F('integrate(1/(2+cos x), x)')).toBe('2√3·arctg(√3·tg(x/2)/3)/3 + C');
  expect(F('integrate(sinh(x)^2, x)')).toBe('(sinh(2x) − 2x)/4 + C');
  expect(F('integrate(cosh(x)^3, x)')).toBe('sinh(x)^3/3 + sinh(x) + C');
  expect(F('integrate(x^2 e^(-x^2), x)')).toBe('√π·erf(x)/4 − x·e^(−x^2)/2 + C');
  expect(F('integrate(sin(x)^2 cos(x)^2, x)')).toBe('x/8 − sin(4x)/32 + C');
  expect(F('integrate(sin(x)^3 cos(x)^2, x)')).toBe('cos(x)^5/5 − cos(x)^3/3 + C');
  expect(F('integrate(sin(3x) cos(5x), x)')).toBe('cos(2x)/4 − cos(8x)/16 + C');
  // the antiderivative jumps at x = π (tg(x/2)): the interval is cut there
  expect(card('integrate(1/(2+cos x), x, 0, 2pi)', 'Całka oznaczona')).toBe('2√3·π/3');
  expect(card('integrate(x^2 e^(-x^2), x, -inf, inf)', 'Całka oznaczona')).toBe('√π/2');
  expect(card('integrate(1/(1+x^4), x, 0, inf)', 'Całka oznaczona')).toBe('√2·π/4');
  // a hopeless integrand gives up in time
  const t = Date.now();
  run('integrate(1/(x^2 sqrt(x^2+1)), x)');
  expect(Date.now() - t).toBeLessThan(2500);
});

test('series: convergence tests, P(k)·r^k, binomial sums, telescoping products', () => {
  expect(card('sum(1/k, k, 1, inf)', 'Suma')).toBe('Szereg jest rozbieżny.');
  expect(card('sum(k/(k+1), k, 1, inf)', 'Suma')).toBe('Szereg jest rozbieżny.');
  expect(card('sum(1/k^(3/2), k, 1, inf)', 'Suma')).toBe('zeta(3/2)');
  expect(Number(card('sum(1/(k^2+1), k, 0, inf)', 'Suma'))).toBeCloseTo((1 + Math.PI / Math.tanh(Math.PI)) / 2, 11);
  expect(card('sum(k^2 x^k, k, 0, inf)', 'Suma')).toBe('−x·(x + 1)/(x − 1)^3');
  expect(card('sum(k^2/3^k, k, 0, inf)', 'Suma')).toBe('3/2');
  expect(card('sum(k 2^k, k, 1, n)', 'Suma')).toBe('2·2^n·(n − 1) + 2');
  expect(card('sum(binomial(n,k), k, 0, n)', 'Suma')).toBe('2^n');
  expect(card('sum(binomial(n,k) x^k, k, 0, n)', 'Suma')).toBe('(x + 1)^n');
  expect(card('product(1-1/k^2, k, 2, inf)', 'Iloczyn')).toBe('1/2');
  expect(card('product((k+1)/k, k, 1, n)', 'Iloczyn')).toBe('n + 1');
});

test('systems: unknowns vs parameters, discussion, fractions, families', () => {
  const pods = (q: string) => { const r = run(q); if (r.error) throw new Error(r.error); return r.pods; };
  // x, y are the unknowns; a, b parameters
  expect(card('x + y = a, x - y = b', 'Rozwiązanie')).toBe('x = (a + b)/2, y = (a − b)/2');
  expect(card('a x + b y = 1, x - y = 2', 'Rozwiązanie')).toBe('x = (2b + 1)/(a + b), y = (1 − 2a)/(a + b)');
  expect(pods('a x + b y = 1, x - y = 2')[0].note).toMatch(/Gdy a \+ b ≠ 0/);
  expect(card('a + b = 3, a - b = 1', 'Rozwiązanie')).toBe('a = 2, b = 1');
  expect(card('solve({a x + b y = 1, x - y = 2}, {a, b})', 'Rozwiązanie')).toContain('a = ');
  // the discussion of a parametric system: Cramer, then the values with W = 0
  expect(card('a x + y = 1, x + a y = 1', 'Rozwiązanie')).toBe('x = 1/(a + 1), y = 1/(a + 1)');
  expect(card('a x + y = 1, x + a y = 1', 'Przypadki szczególne')).toBe('a = −1: układ sprzeczny (brak rozwiązań) | a = 1: nieskończenie wiele rozwiązań: x = 1 − y, y ∈ ℝ');
  expect(card('a x + y + z = 1, x + a y + z = 1, x + y + a z = 1', 'Przypadki szczególne')).toMatch(/^a = −2: układ sprzeczny/);
  expect(card('x + 2y = k, 2x + 4y = 3', 'Przypadki szczególne')).toBe('k = 3/2: nieskończenie wiele rozwiązań: x = 3/2 − 2y, y ∈ ℝ');
  expect(card('x + y + z = a, x - y = b, y - z = c', 'Rozwiązanie')).toBe('x = (a + 2b + c)/3, y = (a − b + c)/3, z = (a − b − 2c)/3');
  // nonlinear with parameters, fractions, periodic families
  expect(card('x^2 + y^2 = r^2, y = x', 'Rozwiązania')).toBe('x = −√2·|r|/2, y = −√2·|r|/2 | x = √2·|r|/2, y = √2·|r|/2');
  expect(card('1/x + 1/y = 5, 1/x - 1/y = 1', 'Rozwiązanie')).toBe('x = 1/3, y = 1/2');
  expect(card('sin(x) + y = 1, y = 0', 'Rozwiązanie')).toBe('x = 2kπ + π/2, y = 0, k ∈ ℤ');
  expect(card('sqrt(x) + sqrt(y) = 5, x - y = 5', 'Rozwiązanie')).toBe('x = 9, y = 4');
  expect(pods('x^2 + y^2 = 1, x + y = 2')[0].note).toMatch(/Brak rozwiązań rzeczywistych/);
  // still right without parameters
  expect(card('x + y + z = 6, x - y + z = 2, 2x + y - z = 1', 'Rozwiązanie')).toBe('x = 1, y = 2, z = 3');
  expect(card('x + 2y = 3, 2x + 4y = 7', 'Rozwiązanie')).toBe('Układ jest sprzeczny: brak rozwiązań.');
});
