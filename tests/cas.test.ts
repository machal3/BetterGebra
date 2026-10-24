import { expect, test } from 'vitest';
import { run } from '../src/cas/engine';

function findPod(q: string, title: string) {
  const r = run(q);
  if (r.error) throw new Error(`${q}: ${r.error}`);
  const p = r.pods.find(p => p.title === title);
  if (!p) throw new Error(`${q}: no card „${title}” in ${r.pods.map(p => p.title).join(', ')}`);
  return p;
}
/** text of the first row of the card with this title */
const card = (q: string, title: string): string => findPod(q, title).rows.map(r => r.text).join(' | ');

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

test('matrices: more operations and automatic cards', () => {
  expect(card('adjugate([[1,2],[3,4]])', 'Macierz dołączona')).toBe('adj(A) = [[4, −2], [−3, 1]]');
  expect(card('det([[5]])', 'Wyznacznik')).toBe('5');
  expect(card('transpose([[1,2]])', 'Macierz transponowana')).toBe('[[1], [2]]');
  expect(card('[[1,2]]', 'Macierz')).toBe('[[1, 2]]');
  expect(card('cofactor([[1,2],[3,4]])', 'Macierz dopełnień algebraicznych')).toBe('[[4, −3], [−2, 1]]');
  expect(card('minor([[1,2,3],[4,5,6],[7,8,9]], 1, 2)', 'Minor (1, 2)')).toBe('[[4, 6], [7, 9]]');
  expect(card('diag([[1,2],[3,4]])', 'Przekątna macierzy')).toBe('[1, 4]');
  expect(card('diag(1, 2, 3)', 'Macierz diagonalna')).toBe('[[1, 0, 0], [0, 2, 0], [0, 0, 3]]');
  expect(card('dimensions([[1,2,3],[4,5,6]])', 'Wymiar macierzy')).toBe('2 × 3');
  expect(card('element([[1,2],[3,4]], 2, 1)', 'Element (2, 1)')).toBe('3');
  expect(card('submatrix([[1,2,3],[4,5,6],[7,8,9]], 2, 3, 1, 2)', 'Podmacierz')).toBe('[[4, 5], [7, 8]]');
  expect(card('augment([[1,2],[3,4]], [[5],[6]])', 'Macierz dołączona')).toBe('[[1, 2, 5], [3, 4, 6]]');
  expect(card('hadamard([[1,2],[3,4]], [[5,6],[7,8]])', 'Iloczyn Hadamarda')).toBe('[[5, 12], [21, 32]]');
  expect(card('linsolve([[2,1],[1,-1]], [5,1])', 'Rozwiązanie układu')).toBe('x₁ = 2, x₂ = 1');
  expect(card('linsolve([[1,2],[2,4]], [3,6])', 'Rozwiązanie układu')).toBe('x₁ = 3 − 2t1, x₂ = t1');
  expect(card('linsolve([[1,2],[2,4]], [3,7])', 'Układ sprzeczny')).toBe('0 = 1 | rząd A = 1, rząd [A | b] = 2');
  expect(card('isinvertible([[1,2],[3,4]])', 'Czy macierz jest odwracalna?')).toBe('Tak');
  expect(card('issymmetric([[1,2],[2,3]])', 'Czy macierz jest symetryczna?')).toBe('Tak');
  expect(card('echelon([[1,2,3],[4,5,6],[7,8,10]])', 'Postać schodkowa (Gauss)')).toBe('[[1, 2, 3], [0, 1, 2], [0, 0, 1]]');
  expect(card('rowspace([[1,2,3],[2,4,6]])', 'Baza przestrzeni wierszy (wymiar 1)')).toBe('[[1, 2, 3]]');
  expect(card('colspace([[1,2,3],[2,4,6]])', 'Baza przestrzeni kolumn (wymiar 1)')).toBe('[[1, 2]]');
  expect(card('[[1,2],[3,4]] * [5,6]', 'Lista')).toBe('[17; 39]');
  expect(card('[1,2] * [[1,2],[3,4]]', 'Lista')).toBe('[7; 10]');
  // a singular matrix brings its kernel and row/column bases
  expect(card('[[1,2],[2,4]]', 'Jądro (wymiar 1)')).toBe('(−2, 1)');
  expect(card('[[1,2],[2,4]]', 'Podprzestrzenie')).toBe('baza wierszy: [[1, 2]] | baza kolumn: [[1], [2]]');
  // and the LU decomposition of a numeric matrix
  expect(card('[[1,2],[3,4]]', 'Rozkład LU')).toBe('L = [[1, 0], [3, 1]] | U = [[1, 2], [0, −2]]');
});

test('matrices: worked solutions and further forms', () => {
  // determinant: the formula, then the arithmetic
  expect(findPod('det([[1,2],[3,4]])', 'Wyznacznik').steps?.map(s => s.text)).toEqual(['det A = 1·4 − 2·3', '= 4 − 6 = −2']);
  expect(findPod('det([[1,2,3],[4,5,6],[7,8,10]])', 'Wyznacznik').steps?.[0].text).toBe('det A = 1·5·10 + 2·6·7 + 3·4·8 − 3·5·7 − 1·6·8 − 2·4·10');
  // inverse: [A | I] reduced to [I | A⁻¹], the 2×2 formula, and a check
  const inv = findPod('inverse([[1,2],[3,4]])', 'Macierz odwrotna');
  expect(inv.steps?.[0].text).toBe('[[1, 2 | 1, 0], [3, 4 | 0, 1]]');
  expect(inv.steps?.some(s => s.text === 'A⁻¹ = [[−2, 1], [3/2, −1/2]]')).toBe(true);
  expect(inv.steps?.at(-1)?.op).toBe('Sprawdzenie: A·A⁻¹ = I');
  // row operations end with the rank and the pivot columns
  const ech = findPod('echelon([[1,2,3],[4,5,6],[7,8,10]])', 'Postać schodkowa (Gauss)');
  expect(ech.steps?.some(s => s.op.startsWith('Postać schodkowa: 3 niezerowe wiersze'))).toBe(true);
  // A·x = b: augmented matrix, the free variable, and the check
  const sol = findPod('linsolve([[1,2],[2,4]], [3,6])', 'Rozwiązanie układu');
  expect(sol.steps?.some(s => s.text === 'x₁ = 3 − 2t1, x₂ = t1')).toBe(true);
  expect(sol.steps?.at(-1)?.op).toBe('Sprawdzenie: A·x = b dla każdego wiersza ✓');
  // the kernel ends with the basis vector built from the free variable
  const ker = findPod('nullspace([[1,2],[2,4]])', 'Baza jądra (wymiar 1)');
  expect(ker.steps?.at(-1)?.text).toBe('(−2, 1)');
  // automatic matrix cards carry the same steps where they fit
  expect(findPod('[[1,2],[3,4]]', 'Wyznacznik').steps?.length).toBe(2);
  expect(findPod('[[1,2],[3,4]]', 'Postać schodkowa (Gauss)').steps?.length).toBeGreaterThan(2);
  expect(findPod('[[1,2],[3,4]]', 'Macierz odwrotna').steps?.length).toBeGreaterThan(3);

  // further decompositions and properties
  expect(card('lu([[1,2],[3,4]])', 'Rozkład LU')).toBe('L = [[1, 0], [3, 1]] | U = [[1, 2], [0, −2]]');
  expect(card('cholesky([[4,2],[2,3]])', 'Rozkład Choleskiego')).toBe('L = [[2, 0], [1, √2]]');
  expect(card('qr([[1,0],[0,1]])', 'Rozkład QR')).toBe('Q = [[1, 0], [0, 1]] | R = [[1, 0], [0, 1]]');
  expect(card('diagonalize([[2,1],[1,2]])', 'Diagonalizacja')).toBe('D = [[1, 0], [0, 3]] | P = [[−1, 1], [1, 1]] | P⁻¹ = [[−1/2, 1/2], [1/2, 1/2]]');
  expect(card('properties([[2,1],[1,2]])', 'Własności')).toContain('dodatnio określona');
  expect(card('properties([[1,2],[2,4]])', 'Własności')).toContain('osobliwa (det A = 0');
  expect(card('[[1,2],[2,4]]', 'Macierz odwrotna')).toContain('osobliwa (det A = 0)');
  expect(card('properties([[1,2,3],[4,5,6]])', 'Własności')).toBe('prostokątna 2×3 (więcej kolumn niż wierszy)');
  expect(card('diagonalize([[1,1],[0,1]])', 'Diagonalizacja')).toContain('nie jest diagonalizowalna');
  expect(card('lu([[1,2],[2,4]])', 'Rozkład LU')).toBe('Nie istnieje: macierz jest osobliwa.');
});

test('systems: matrix form, ranks and Cramer', () => {
  const q = 'x + y = 5, x - y = 1';
  expect(card(q, 'Rozwiązanie')).toBe('x = 3, y = 2');
  expect(card(q, 'Postać macierzowa')).toBe('[[1, 1], [1, −1]]·[x, y] = [5, 1] | A = [[1, 1], [1, −1]] | b = [[5], [1]] | [A | b] = [[1, 1 | 5], [1, −1 | 1]]');
  expect(card(q, 'Rząd i zmienne wolne')).toBe('rząd A = 2 | rząd [A | b] = 2 | niewiadome: 2, stopnie swobody: 0');
  expect(card(q, 'Wzory Cramera')).toBe('det A = −2 | x = det A₁ / det A = (−6) / (−2) = 3 | y = det A₂ / det A = (−4) / (−2) = 2');
  expect(findPod(q, 'Postać macierzowa').more?.query).toBe('linsolve([[1, 1], [1, −1]], [5, 1])');
  const steps = findPod(q, 'Rozwiązanie').steps;
  expect(steps?.some(s => s.text === 'x = 3, y = 2')).toBe(true);
  expect(steps?.at(-1)?.op).toBe('Sprawdzenie: A·x = b dla każdego wiersza ✓');

  // an inconsistent system names the contradictory row instead of only saying "no solutions"
  const bad = 'x + y = 1, x + y = 2';
  expect(card(bad, 'Układ sprzeczny')).toBe('0 = 1 | rząd A = 1, rząd [A | b] = 2');
  expect(card(bad, 'Rząd i zmienne wolne')).toBe('0 = 1 (wiersz 2) | rząd A = 1 | rząd [A | b] = 2');

  // a free variable in a 2×3 system, and the same elimination steps
  const under = 'x + y + z = 1, x - y = 0';
  expect(card(under, 'Rozwiązanie')).toBe('x = (1 − z)/2, y = (1 − z)/2, z ∈ ℝ');
  expect(card(under, 'Postać macierzowa')).toBe('[[1, 1, 1], [1, −1, 0]]·[x, y, z] = [1, 0] | A = [[1, 1, 1], [1, −1, 0]] | b = [[1], [0]] | [A | b] = [[1, 1, 1 | 1], [1, −1, 0 | 0]]');
  expect(card(under, 'Rząd i zmienne wolne')).toBe('rząd A = 2 | rząd [A | b] = 2 | niewiadome: 3, stopnie swobody: 1');
  expect(findPod(under, 'Rozwiązanie').steps?.some(s => s.text === 'x = 1/2 − t1/2, y = 1/2 − t1/2, z = t1')).toBe(true);

  // a symbolic coefficient is a parameter when x and y are present; Cramer works exactly
  const sym = 'a x + y = 1, x + y = 2';
  expect(card(sym, 'Rozwiązanie')).toBe('x = −1/(a − 1), y = (2a − 1)/(a − 1)');
  expect(card(sym, 'Wzory Cramera')).toBe('det A = a − 1 | x = det A₁ / det A = (−1) / (a − 1) = −1/(a − 1) | y = det A₂ / det A = (2a − 1) / (a − 1) = (2a − 1)/(a − 1)');
  expect(findPod(sym, 'Postać macierzowa').more?.query).toBe('linsolve([[a, 1], [1, 1]], [1, 2])');

  // a system is written under a brace, one equation per line, in the input, the solution and the steps
  const brace = (ml: string) => /<mtable class="sys">/.test(ml) && /class="sys-brace"/.test(ml);
  expect(brace(run(q).input!.ml)).toBe(true);
  expect((run(q).input!.ml.match(/<mtr>/g) ?? []).length).toBe(2);
  expect(brace(findPod(q, 'Rozwiązanie').rows[0].ml)).toBe(true);
  expect(findPod(q, 'Rozwiązanie').steps?.[0]).toMatchObject({ op: 'Układ równań', text: 'x + y = 5, x − y = 1' });
  expect(card('linsolve([[2,1],[1,-1]], [5,1])', 'Układ równań')).toBe('2x₁ + x₂ = 5, x₁ − x₂ = 1');
  expect(card('linsolve([[1,-2,0],[0,1/2,-1]], [0,3])', 'Układ równań')).toBe('x₁ − 2x₂ = 0, (1/2)x₂ − x₃ = 3');
  // matrices are bracketed by CSS borders, not by stretchy operators that need a math font
  expect(findPod('[[1,2],[3,4]]', 'Macierz').rows[0].ml).toContain('<mtable class="mat">');
  expect(run('[[1,2],[3,4]]').input!.ml).not.toContain('<mo>[</mo>');

  // no matrix cards for a genuinely nonlinear system
  const nonlin = run('x^2 + y^2 = 25, y = x - 1');
  expect(nonlin.error).toBeFalsy();
  expect(nonlin.pods.some(p => p.title === 'Postać macierzowa')).toBe(false);
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
