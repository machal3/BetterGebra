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
  // biquadratics irreducible over ℚ split over ℝ into quadratics with surd coefficients
  expect(card('integrate(1/(x^4+1), x)', 'Całka nieoznaczona')).toBe('(2√2·arctg(√2·x − 1) + 2√2·arctg(√2·x + 1) + √2·ln(x^2 + √2·x + 1) − √2·ln(x^2 − √2·x + 1))/8 + C');
  expect(card('integrate(x^2/(x^4+1), x)', 'Całka nieoznaczona')).toBe('(2√2·arctg(√2·x − 1) + 2√2·arctg(√2·x + 1) − √2·ln(x^2 + √2·x + 1) + √2·ln(x^2 − √2·x + 1))/8 + C');
  expect(card('integrate(1/(x^4+2), x)', 'Całka nieoznaczona')).toBe('(2·2^(3/4)·arctg(2^(1/4)·x − 1) + 2·2^(3/4)·arctg(2^(1/4)·x + 1) + 2^(3/4)·ln(x^2 + 2^(3/4)·x + √2) − 2^(3/4)·ln(x^2 − 2^(3/4)·x + √2))/16 + C');
  expect(card('integrate(1/(x^4+3x^2+1), x)', 'Całka nieoznaczona')).toBe('2√5·arctg(2x/√(6 − 2√5))/(5√(6 − 2√5)) − 2√5·arctg(2x/√(6 + 2√5))/(5√(6 + 2√5)) + C');
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
