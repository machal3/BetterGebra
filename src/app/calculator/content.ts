/** The calculator's examples by topic (query, what it shows) and its symbol keys (label, inserted text, name). */

export const EXAMPLES: [string, [string, string][]][] = [
  ['Liczby', [['2^200', 'potęga'], ['100!', 'silnia'], ['1/7 + 2/3', 'ułamki'], ['sqrt(72)', 'pierwiastek'], ['N(pi, 100)', '100 cyfr π'], ['(1+2i)/(3-i)', 'zespolone'], ['e^(i pi/4)', 'postać wykładnicza']]],
  ['Algebra', [['rozłóż x^4 - 5x^2 + 4', 'rozkład'], ['rozwiń (a + b)^5', 'rozwinięcie'], ['uprość (x^2 - 1)/(x + 1)', 'upraszczanie'], ['apart((3x + 1)/(x^2 - 1))', 'ułamki proste'], ['x^3 - 6x^2 + 11x - 6 = 0', 'wielomian'], ['x^3 - 3x + 1 = 0', 'wzory Viète’a']]],
  ['Analiza', [['pochodna x^x', 'pochodna'], ['całka x^2 e^x dx', 'całka'], ['całka e^(-x^2) od -inf do inf', 'całka Gaussa'], ['granica (1 + 1/n)^n przy n->inf', 'granica'], ['szereg tan x', 'szereg Taylora'], ['badanie funkcji x^3 - 3x', 'przebieg zmienności'], ['sum(1/k^2, k, 1, inf)', 'szereg']]],
  ['Wykresy', [['wykres sin x, cos x', 'dwie funkcje'], ['wykres x^2 + y^2 = 25, y = x - 1', 'okrąg i prosta'], ['x^2/9 + y^2/4 = 1', 'elipsa'], ['wykres [cos t, sin(2t)]', 'krzywa parametryczna'], ['badanie funkcji (x^2 + 1)/(x - 1)', 'asymptoty'], ['całka sin x od 0 do 2pi', 'pole ze znakiem']]],
  ['LaTeX', [[String.raw`\int_0^{\pi} \sin x \, dx`, 'całka'], [String.raw`\lim_{x \to 0} \frac{\sin x}{x}`, 'granica'], [String.raw`\sum_{k=1}^{\infty} \frac{1}{k^2}`, 'szereg'], [String.raw`\frac{d}{dx} x^x`, 'pochodna'], [String.raw`\begin{cases} x + y = 5 \\ x y = 6 \end{cases}`, 'układ'], [String.raw`\det\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}`, 'wyznacznik']]],
  ['Równania', [['sin(x) = 1/2', 'trygonometryczne'], ['2^x = 3^(x - 1)', 'wykładnicze'], ['sqrt(x + 3) = x - 3', 'z pierwiastkiem'], ['x + y = 5, x y = 6', 'układ'], ['(x - 1)/(x + 2) >= 0', 'nierówność'], ['x^5 - x - 1 = 0', 'numerycznie']]],
  ['Macierze', [['[2 1; 1 2]', 'macierz'], ['det([[a, b], [c, d]])', 'wyznacznik'], ['inverse([[1, 2, 3], [0, 1, 4], [5, 6, 0]])', 'odwrotna'], ['eigenvalues([[4, 1], [2, 3]])', 'wartości własne'], ['[2 1; 1 3] \\ [3; 5]', 'układ A\\b'], ['[1 0; 1 1; 1 2] \\ [1; 2; 2]', 'najmniejsze kwadraty']]],
  ['Tablice', [['magic(4)', 'kwadrat magiczny'], ['linspace(0, 1, 5)', 'równe odstępy'], ['reshape(1:6, 2, 3)', 'zmiana kształtu'], ['cumsum(1:10)', 'sumy częściowe'], ['sum(magic(4))', 'sumy kolumn'], ['v = [4 8 15 16 23 42]; v(v > 10)', 'wybór warunkiem']]],
  ['Zmienne', [['A = [4 1; 2 3]', 'zmienna'], ['f(x) = x^3 - 2x', 'funkcja'], ['g = @(x, y) x^2 + y^2', 'funkcja dwóch zmiennych'], ['n = 10; sum(1/k^2, k, 1, n)', 'kilka poleceń'], ['0:pi/4:pi', 'zakres'], ['[1 2; 3 4] .^ 2', 'potęga elementów']]],
  ['Teoria liczb', [['rozłóż 2^64 + 1', 'czynniki'], ['isprime(2^89 - 1)', 'pierwszość'], ['nwd(462, 1071)', 'NWD'], ['crt([2, 3, 2], [3, 5, 7])', 'kongruencje'], ['totient(10^12)', 'φ Eulera'], ['fibonacci(300)', 'Fibonacci']]],
  ['Statystyka', [['{2, 4, 4, 4, 5, 5, 7, 9}', 'statystyki'], ['median(3, 1, 4, 1, 5, 9, 2, 6)', 'mediana']]],
];

/** Symbol keys in groups; a divider goes between groups. */
export const KEYS: [string, string, string][][] = [
  [['√', 'sqrt()', 'pierwiastek'], ['^', '^', 'potęga'], ['|x|', '||', 'wartość bezwzględna'], ['n!', '!', 'silnia']],
  [['π', 'π', 'pi'], ['e', 'e', 'liczba e'], ['i', 'i', 'jednostka urojona'], ['∞', '∞', 'nieskończoność']],
  [['≤', '<=', 'mniejsze lub równe'], ['≥', '>=', 'większe lub równe'], ['→', '->', 'dąży do (granica)']],
  [['d/dx', 'pochodna ', 'pochodna'], ['∫', 'całka ', 'całka'], ['lim', 'granica ', 'granica'], ['Σ', 'sum(, k, 1, n)', 'suma'], ['[ ]', '[[, ], [, ]]', 'macierz']],
];
