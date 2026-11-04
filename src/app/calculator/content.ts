/** The calculator's examples by topic (query, what it shows) and the palette of templates under its field. */

export const EXAMPLES: [string, [string, string][]][] = [
  ['Liczby', [['2^200', 'potęga'], ['100!', 'silnia'], ['1/7 + 2/3', 'ułamki'], ['sqrt(72)', 'pierwiastek'], ['N(pi, 100)', '100 cyfr π'], ['(1+2i)/(3-i)', 'zespolone'], ['e^(i pi/4)', 'postać wykładnicza']]],
  ['Algebra', [['rozłóż x^4 - 5x^2 + 4', 'rozkład'], ['rozwiń (a + b)^5', 'rozwinięcie'], ['uprość (x^2 - 1)/(x + 1)', 'upraszczanie'], ['apart((3x + 1)/(x^2 - 1))', 'ułamki proste'], ['x^3 - 6x^2 + 11x - 6 = 0', 'wielomian'], ['x^3 - 3x + 1 = 0', 'wzory Viète’a']]],
  ['Analiza', [['pochodna x^x', 'pochodna'], ['całka x^2 e^x dx', 'całka'], ['całka e^(-x^2) od -inf do inf', 'całka Gaussa'], ['granica (1 + 1/n)^n przy n->inf', 'granica'], ['szereg tan x', 'szereg Taylora'], ['badanie funkcji x^3 - 3x', 'przebieg zmienności'], ['sum(1/k^2, k, 1, inf)', 'szereg']]],
  ['Wykresy', [['wykres sin x, cos x', 'dwie funkcje'], ['wykres x^2 + y^2 = 25, y = x - 1', 'okrąg i prosta'], ['x^2/9 + y^2/4 = 1', 'elipsa'], ['wykres [cos t, sin(2t)]', 'krzywa parametryczna'], ['badanie funkcji (x^2 + 1)/(x - 1)', 'asymptoty'], ['całka sin x od 0 do 2pi', 'pole ze znakiem']]],
  ['LaTeX', [[String.raw`\int_0^{\pi} \sin x \, dx`, 'całka'], [String.raw`\lim_{x \to 0} \frac{\sin x}{x}`, 'granica'], [String.raw`\sum_{k=1}^{\infty} \frac{1}{k^2}`, 'szereg'], [String.raw`\frac{d}{dx} x^x`, 'pochodna'], [String.raw`\begin{cases} x + y = 5 \\ x y = 6 \end{cases}`, 'układ'], [String.raw`\det\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}`, 'wyznacznik']]],
  ['Równania', [['sin(x) = 1/2', 'trygonometryczne'], ['2^x = 3^(x - 1)', 'wykładnicze'], ['sqrt(x + 3) = x - 3', 'z pierwiastkiem'], ['x + y = 5, x y = 6', 'układ'], ['(x - 1)/(x + 2) >= 0', 'nierówność'], ['x^5 - x - 1 = 0', 'numerycznie']]],
  ['Macierze', [['[2 1; 1 2]', 'macierz'], ['det([[a, b], [c, d]])', 'wyznacznik'], ['inverse([[1, 2, 3], [0, 1, 4], [5, 6, 0]])', 'odwrotna'], ['eigenvalues([[4, 1], [2, 3]])', 'wartości własne'], ['[2 1; 1 3] \\ [3; 5]', 'układ A\\b'], ['[1 0; 1 1; 1 2] \\ [1; 2; 2]', 'najmniejsze kwadraty']]],
  ['Rozkłady', [['lu([2 1 1; 4 -6 0; -2 7 2])', 'rozkład LU'], ['[Q, R] = qr([3 0; 4 5])', 'rozkład QR'], ['chol([4 2; 2 3])', 'Cholesky'], ['svd([1 2; 3 4; 5 6])', 'SVD'], ['eig(magic(4))', 'wartości własne'], ['expm([0 1; -1 0])', 'eksponenta macierzy'], ['sqrtm([2 1; 1 2])', 'pierwiastek macierzy'], ['cond(hilb(6))', 'uwarunkowanie']]],
  ['Numeryka', [["y' = -2y + sin(t), y(0) = 1", 'równanie różniczkowe wprost'], ["dsolve(y'' + y = 0, y(0) = 1, y'(0) = 0)", 'równanie różniczkowe dokładnie'], ["ode45(y'' = -y + sin(2t), [0 10], [1 0])", 'ode45'], ['ode45(@(t, y) [y(2); (1 - y(1)^2)*y(2) - y(1)], [0 20], [2; 0])', 'van der Pol, portret fazowy'], ['fzero(@(x) cos(x) - x, [0 1])', 'miejsce zerowe'], ['fminsearch(@(x) 100*(x(2) - x(1)^2)^2 + (1 - x(1))^2, [-1.2 1])', 'minimum (Rosenbrock)'], ['integral2(@(x, y) x + y, 0, 1, 0, @(x) x)', 'całka podwójna']]],
  ['3D i pola', [['x^2 - y^2', 'funkcja dwóch zmiennych'], ['surf(sin(x)*cos(y), [-3 3 -3 3])', 'powierzchnia'], ['mesh(x^2 - y^2, [-2 2 -2 2])', 'siodło'], ['plot3([cos(t), sin(t), t/5], [0 20])', 'linia śrubowa'], ['contour(x^2 + y^2/4, 8)', 'poziomice'], ['quiver([-y, x], [-2 2 -2 2])', 'pole wektorowe'], ['[X, Y] = meshgrid(-2:0.5:2)', 'siatka punktów']]],
  ['Sygnały', [['fft([1 2 3 4])', 'transformata dokładnie'], ['fft(sin(2*pi*5*(0:63)/64) + sin(2*pi*12*(0:63)/64)/2)', 'widmo dwóch tonów'], ['periodogram(sin(2*pi*50*(0:199)/1000), 1000)', 'periodogram'], ['filter(1, [1 -0.5], [1 0 0 0 0 0])', 'odpowiedź impulsowa'], ['filter(ones(1, 4)/4, 1, [1 5 2 8 3 9 4])', 'średnia ruchoma'], ['fftshift(0:7)', 'fftshift']]],
  ['Dane', [['polyfit([0 1 2 3 4], [1 1.8 3.3 4.5 6.3], 1)', 'prosta regresji'], ['x = 0:5; y = 2*exp(x/2); fit(x, y, a*exp(b*x))', 'dopasowanie modelu'], ['spline(0:4, [0 1 0 2 1])', 'funkcja sklejana'], ["interp1([1 2 4], [10 20 15], 3, 'pchip')", 'interpolacja'], ['roots([1 -6 11 -6])', 'pierwiastki wielomianu'], ['trapz(0:0.5:2, (0:0.5:2).^2)', 'metoda trapezów'], ['histogram([2 3 3 4 4 4 5 5 6 8], 4)', 'histogram']]],
  ['Tablice', [['magic(4)', 'kwadrat magiczny'], ['linspace(0, 1, 5)', 'równe odstępy'], ['reshape(1:6, 2, 3)', 'zmiana kształtu'], ['cumsum(1:10)', 'sumy częściowe'], ['sum(magic(4))', 'sumy kolumn'], ['v = [4 8 15 16 23 42]; v(v > 10)', 'wybór warunkiem']]],
  ['Zmienne', [['A = [4 1; 2 3]', 'zmienna'], ['f(x) = x^3 - 2x', 'funkcja'], ['g = @(x, y) x^2 + y^2', 'funkcja dwóch zmiennych'], ['n = 10; sum(1/k^2, k, 1, n)', 'kilka poleceń'], ['0:pi/4:pi', 'zakres'], ['[1 2; 3 4] .^ 2', 'potęga elementów']]],
  ['Teoria liczb', [['rozłóż 2^64 + 1', 'czynniki'], ['isprime(2^89 - 1)', 'pierwszość'], ['nwd(462, 1071)', 'NWD'], ['crt([2, 3, 2], [3, 5, 7])', 'kongruencje'], ['totient(10^12)', 'φ Eulera'], ['fibonacci(300)', 'Fibonacci']]],
  ['Statystyka', [['{2, 4, 4, 4, 5, 5, 7, 9}', 'statystyki'], ['prctile([2 4 4 4 5 5 7 9], [25 50 75])', 'kwartyle'], ['fitlm([1 2 3 4 5], [2.1 3.9 6.2 7.8 10.1])', 'regresja liniowa'], ['corrcoef([1 2 3 4 5], [2 4 5 4 5])', 'korelacja'], ['normcdf(1.96)', 'rozkład normalny'], ['tinv(0.975, 10)', 'kwantyl t-Studenta'], ['binopdf(0:4, 4, 1/2)', 'rozkład dwumianowy']]],
];

/** A key of the palette: how it looks (MathML, or a word), what it inserts (□ is a place to fill) and its name. */
export interface Key { label: string; text: string; name: string; word?: boolean; wide?: boolean }

/**
 * An empty place: a box the size of a letter. The empty <mi> beside it matters: a lone <mspace> is space-like,
 * and = between two of them would be read as a prefix and lose its spacing.
 */
export const BOX = '<mrow><mspace class="b-slot" width="0.6em" height="0.7em" depth="0.05em"/><mi></mi></mrow>';
const B = BOX;
const m = (s: string) => `<math displaystyle="true">${s}</math>`;
const key = (label: string, text: string, name: string, wide = false): Key => ({ label: m(label), text, name, wide });
/** sin □: the name, a thin space, the place for the argument; a long name takes two columns. */
const fn = (f: string, name = f, text = `${f}(□)`): Key => key(`<mi mathvariant="normal">${f}</mi><mspace width="0.17em"/>${B}`, text, name, f.length > 4);
const word = (label: string, text: string, name: string): Key => ({ label, text, name, word: true });
/**
 * The root keys are drawn: at a key's size Chromium sets a radical's bar apart from its √, half a pixel higher and
 * thicker, with a step where they meet. Here the √ and its bar are one stroke (its ascending stem heavy, as in the
 * math font); the index sits clear of the hook.
 */
const RADICAL = (index: boolean) => {
  const x = index ? 7 : 0, w = 30 + x;
  return `<svg class="b-key-svg" viewBox="0 0 ${w} 24" width="${w}" height="24" aria-hidden="true">${
    index ? '<text x="2" y="10.5" class="b-key-index">𝑛</text>' : ''
  }<path d="M${2 + x} 13.5 L${4.5 + x} 12 L${8.5 + x} 20.5 L${13.5 + x} 4 H${28.5 + x}" class="b-key-stroke"/><rect x="${16 + x}" y="6.5" width="9.5" height="11.5" rx="2" class="b-key-slot"/></svg>`;
};
const drawn = (label: string, text: string, name: string): Key => ({ label, text, name });
const mat = (rows: number, cols: number) => `<mrow><mo>[</mo><mtable columnspacing="0.3em" rowspacing="0.25em">${`<mtr>${`<mtd>${B}</mtd>`.repeat(cols)}</mtr>`.repeat(rows)}</mtable><mo>]</mo></mrow>`;
const cases = (n: number) => `<mrow><mo>{</mo><mtable columnalign="left" rowspacing="0.15em">${`<mtr><mtd style="text-align: left">${B}<mo>=</mo>${B}</mtd></mtr>`.repeat(n)}</mtable></mrow>`;

/** The palette under the field, by tab. Each template's text is what the parser reads; □ marks where to type. */
export const PALETTE: { id: string; name: string; keys: Key[] }[] = [
  { id: 'basic', name: 'Podstawowe', keys: [
    key(`<mfrac>${B}${B}</mfrac>`, '(□)/(□)', 'ułamek'),
    key(`<msup>${B}<mn>2</mn></msup>`, '□^2', 'kwadrat'),
    key(`<msup>${B}<mi>n</mi></msup>`, '□^(□)', 'potęga'),
    drawn(RADICAL(false), '√(□)', 'pierwiastek kwadratowy'),
    drawn(RADICAL(true), 'root(□, □)', 'pierwiastek stopnia n: najpierw stopień, potem liczba'),
    key(`<mrow><mo>|</mo>${B}<mo>|</mo></mrow>`, '|□|', 'wartość bezwzględna'),
    key(`<mrow><mo>(</mo>${B}<mo>)</mo></mrow>`, '(□)', 'nawias'),
    key(`<mrow>${B}<mo>!</mo></mrow>`, '□!', 'silnia'),
    key('<mi>π</mi>', 'π', 'liczba pi'),
    key('<mi>e</mi>', 'e', 'liczba e'),
    key('<mi>i</mi>', 'i', 'jednostka urojona'),
    key('<mi>∞</mi>', '∞', 'nieskończoność'),
    key('<mo>·</mo>', '·', 'mnożenie'),
    key('<mo>=</mo>', ' = ', 'równa się'),
    key('<mo>≤</mo>', ' ≤ ', 'mniejsze lub równe'),
    key('<mo>≥</mo>', ' ≥ ', 'większe lub równe'),
    key('<mo>≠</mo>', ' ≠ ', 'różne'),
    key(`<mrow>${B}<mo>°</mo></mrow>`, '□°', 'stopnie'),
  ] },
  { id: 'fn', name: 'Funkcje', keys: [
    ...['sin', 'cos', 'tg', 'ctg', 'arcsin', 'arccos', 'arctg'].map(f => fn(f)),
    fn('ln', 'logarytm naturalny'),
    key(`<msub><mi mathvariant="normal">log</mi><mi>b</mi></msub><mspace width="0.17em"/>${B}`, 'log_(□)(□)', 'logarytm: najpierw podstawa, potem liczba'),
    key('<msup><mi>e</mi><mi>x</mi></msup>', 'e^(□)', 'funkcja wykładnicza'),
    key('<msup><mn>10</mn><mi>x</mi></msup>', '10^(□)', 'potęga dziesiątki'),
    ...['sinh', 'cosh'].map(f => fn(f)),
    key(`<mrow><mo>⌊</mo>${B}<mo>⌋</mo></mrow>`, 'floor(□)', 'część całkowita'),
    key('<mrow><mo>(</mo><mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac><mo>)</mo></mrow>', 'binom(□, □)', 'symbol Newtona'),
    word('NWD', 'nwd(□, □)', 'największy wspólny dzielnik'),
    word('NWW', 'nww(□, □)', 'najmniejsza wspólna wielokrotność'),
    word('mod', 'mod(□, □)', 'reszta z dzielenia'),
  ] },
  { id: 'calc', name: 'Analiza', keys: [
    key(`<mfrac><mi>d</mi><mrow><mi>d</mi><mi>x</mi></mrow></mfrac>${B}`, 'pochodna □', 'pochodna'),
    key(`<mfrac><msup><mi>d</mi><mn>2</mn></msup><mrow><mi>d</mi><msup><mi>x</mi><mn>2</mn></msup></mrow></mfrac>${B}`, 'pochodna rzędu 2 □', 'druga pochodna'),
    key(`<mo>∫</mo>${B}<mi>d</mi><mi>x</mi>`, 'całka □ dx', 'całka nieoznaczona'),
    key(`<msubsup><mo>∫</mo><mi>a</mi><mi>b</mi></msubsup>${B}<mi>d</mi><mi>x</mi>`, 'całka □ dx od □ do □', 'całka oznaczona: funkcja, dolna i górna granica', true),
    key(`<munder><mi mathvariant="normal">lim</mi><mrow><mi>x</mi><mo>→</mo><mi>a</mi></mrow></munder>${B}`, 'granica □ przy x → □', 'granica: funkcja, potem punkt', true),
    // limits beside the sign, as in a line of text: above and below it they would not fit the key
    key(`<mstyle displaystyle="false"><munderover><mo>∑</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover></mstyle>${B}`, 'sum(□, k, □, □)', 'suma: wyraz, od, do', true),
    key(`<mstyle displaystyle="false"><munderover><mo>∏</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover></mstyle>${B}`, 'product(□, k, □, □)', 'iloczyn: wyraz, od, do', true),
    word('rozwiąż', 'rozwiąż □', 'rozwiąż równanie, nierówność lub układ'),
    word('uprość', 'uprość □', 'uprość wyrażenie'),
    word('rozłóż', 'rozłóż □', 'rozłóż na czynniki'),
    word('Taylor', 'szereg □', 'szereg Taylora'),
    word('badanie', 'badanie funkcji □', 'badanie przebiegu funkcji'),
    word('wykres', 'wykres □', 'wykres'),
  ] },
  { id: 'lin', name: 'Macierze i układy', keys: [
    key(cases(2), '□ = □\n□ = □', 'układ dwóch równań', true),
    key(cases(3), '□ = □\n□ = □\n□ = □', 'układ trzech równań', true),
    key(mat(2, 2), '[□ □; □ □]', 'macierz 2 × 2', true),
    key(mat(3, 3), '[□ □ □; □ □ □; □ □ □]', 'macierz 3 × 3', true),
    key(mat(2, 1), '[□; □]', 'wektor kolumnowy'),
    key(mat(1, 3), '[□ □ □]', 'wektor wierszowy', true),
    fn('det', 'wyznacznik'),
    key(`<msup>${B}<mrow><mo>−</mo><mn>1</mn></mrow></msup>`, 'inverse(□)', 'macierz odwrotna'),
    key(`<msup>${B}<mi mathvariant="normal">T</mi></msup>`, 'transpose(□)', 'transpozycja'),
    word('rząd', 'rank(□)', 'rząd macierzy'),
    word('wart. własne', 'eigenvalues(□)', 'wartości własne'),
  ] },
  { id: 'greek', name: 'Greckie', keys: ['α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'ρ', 'σ', 'ω'].map(g => key(`<mi>${g}</mi>`, g, `litera ${g}`)) },
];
