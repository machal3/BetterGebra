import { expect, test } from 'vitest';
import { run, type Result, type Saved } from '../src/cas/engine';
import { EXAMPLES } from '../src/app/calculator/content';

/** Questions asked one after another, the workspace and ans carried over as the page carries them. */
function session() {
  const vars: Record<string, Saved> = {};
  let ans: string | null = null;
  const ask = (q: string): Result => {
    const r = run(q, { vars: { ...vars }, ans });
    for (const [k, v] of Object.entries(r.assigned ?? {})) { if (v) vars[k] = v; else delete vars[k]; }
    if (r.ansCode) ans = r.ansCode;
    return r;
  };
  return { ask, vars };
}
/** The rows of the card with this title. */
function card(r: Result, title: string): string {
  if (r.error) throw new Error(r.error);
  const p = r.pods.find(p => p.title === title);
  if (!p) throw new Error(`no card „${title}” in ${r.pods.map(p => p.title).join(', ')}`);
  return p.rows.map(r => r.text).join(' | ');
}
const first = (r: Result) => { if (r.error) throw new Error(r.error); return r.pods[0].rows.map(r => r.text).join(' | '); };

test('matrices written as in MATLAB, with spaces and semicolons', () => {
  expect(card(run('[1 2; 3 4]'), 'Macierz')).toBe('[[1, 2], [3, 4]]');
  expect(card(run('[1 -2]'), 'Lista')).toBe('[1; −2]');
  expect(card(run('[1 - 2]'), 'Wynik')).toBe('−1');
  expect(card(run('[sin x, cos x]'), 'Lista')).toBe('[sin(x); cos(x)]');
  // with commas a space is still a product, as before
  expect(card(run('[2 x, 3]'), 'Lista')).toBe('[2x; 3]');
  expect(card(run('[1;2;3]'), 'Macierz')).toBe('[[1], [2], [3]]');
  expect(card(run('[[1, 2], [3, 4]]'), 'Macierz odwrotna')).toBe('A⁻¹ = [[−2, 1], [3/2, −1/2]]');
});

test('ranges a:b and a:h:b, exact', () => {
  expect(card(run('1:5'), 'Lista')).toBe('[1; 2; 3; 4; 5]');
  expect(card(run('0:0.5:2'), 'Lista')).toBe('[0; 1/2; 1; 3/2; 2]');
  expect(card(run('0:pi/2:pi'), 'Lista')).toBe('[0; π/2; π]');
  expect(card(run('5:-2:0'), 'Lista')).toBe('[5; 3; 1]');
  expect(run('1:0:5').error).toMatch(/zerem/);
  expect(run('1:10^6').error).toMatch(/100 000/);
});

test('elementwise operations, transpose and functions on lists', () => {
  expect(card(run('[1, 2] .* [3, 4]'), 'Lista')).toBe('[3; 8]');
  expect(card(run('[1 2; 3 4] .* [1 0; 0 1]'), 'Macierz')).toBe('[[1, 0], [0, 4]]');
  expect(card(run('[1 2; 3 4] .^ 2'), 'Macierz')).toBe('[[1, 4], [9, 16]]');
  expect(card(run('[1 2; 3 4] ./ [1 2; 3 4]'), 'Macierz')).toBe('[[1, 1], [1, 1]]');
  expect(card(run("[1 2; 3 4]'"), 'Macierz')).toBe('[[1, 3], [2, 4]]');
  expect(card(run("[1 2 3]'"), 'Macierz')).toBe('[[1], [2], [3]]');
  expect(card(run("[1+i, 2]'"), 'Macierz')).toBe('[[1 − i], [2]]');
  expect(card(run("[1+i, 2].'"), 'Macierz')).toBe('[[1 + i], [2]]');
  // ' after an expression is still the derivative
  expect(card(run("(x^3)'"), 'Wynik')).toBe('3x^2');
  expect(card(run('sin([0, pi/2])'), 'Lista')).toBe('[0; 1]');
  expect(card(run('max([3, 1, 4])'), 'Największy element')).toBe('4');
  expect(run('min([3, 1, 4, 1])').pods[0].rows[0].note).toBe('na miejscu 2');
  expect(card(run('[1 2] * [1 2; 3 4]'), 'Lista')).toBe('[7; 10]');
  expect(card(run("(1:3)' * (1:3)"), 'Macierz')).toBe('[[1, 2, 3], [2, 4, 6], [3, 6, 9]]');
  expect(card(run("(1:3) * (1:3)'"), 'Wynik')).toBe('14');
});

test('A\\b: exact solutions, least squares, singular matrices', () => {
  expect(card(run('[1 2; 3 4] \\ [5, 6]'), 'Rozwiązanie układu A·x = b')).toBe('x1 = −4 | x2 = 9/2');
  const ls = run('[1 0; 1 1; 1 2] \\ [1; 2; 2]');
  expect(card(ls, 'Rozwiązanie układu A·x = b')).toBe('x1 = 7/6 | x2 = 1/2');
  expect(card(run('[1 0; 0 2] \\ [1 2; 3 4]'), 'Rozwiązanie układu A·X = B')).toBe('X = [[1, 2], [3/2, 2]]');
  expect(ls.pods[0].note).toMatch(/najmniejszych kwadratów/);
  expect(run('[1 2; 2 4] \\ [1, 2]').error).toMatch(/osobliwa/);
  expect(run('[1 2 3] \\ [1]').error).toBeTruthy();
  // LaTeX still reads as LaTeX
  expect(card(run('\\frac{1}{2} + \\frac{1}{3}'), 'Wynik')).toBe('5/6');
});

test('variables: assigned, used, indexed, shown and removed', () => {
  const { ask, vars } = session();
  expect(first(ask('A = [1 2; 3 4]'))).toBe('A = [[1, 2], [3, 4]]');
  expect(vars.a.display).toBe('A');
  // the spelling of a whole name, not of a letter inside another one
  expect(first(run('XA = 1; a = 2'))).toBe('XA = 1 | a = 2');
  expect(vars.a.kind).toBe('matrix');
  expect(vars.a.label).toBe('macierz 2×2');
  expect(card(ask("A'"), 'Macierz')).toBe('[[1, 3], [2, 4]]');
  expect(card(ask('A(2, 1)'), 'Wynik')).toBe('3');
  expect(card(ask('A(:, 2)'), 'Macierz')).toBe('[[2], [4]]');
  expect(card(ask('A(end, :)'), 'Lista')).toBe('[3; 4]');
  expect(card(ask('A(3)'), 'Wynik')).toBe('2'); // down the columns
  expect(ask('A(3, 1)').error).toMatch(/poza zakresem/);
  expect(card(ask('[A A]'), 'Macierz')).toBe('[[1, 2, 1, 2], [3, 4, 3, 4]]');
  expect(card(ask('[A; 5 6]'), 'Macierz')).toBe('[[1, 2], [3, 4], [5, 6]]');
  const used = ask('det(A)');
  expect(card(used, 'Wyznacznik')).toBe('−2');
  expect(used.used).toBe('A (macierz 2×2)');

  expect(first(ask('wynik = 3*4'))).toBe('wynik = 12');
  expect(card(ask('wynik + 1'), 'Wynik')).toBe('13');
  expect(card(ask('n = 10; sum(k, k, 1, n)'), 'Suma')).toBe('55');

  // a letter with a value is substituted, but stays the variable of diff and integrate
  ask('x = 5');
  expect(card(ask('x^2'), 'Wynik')).toBe('25');
  expect(card(ask('diff(x^2, x)'), 'Pochodna')).toContain('2x');
  expect(card(ask('integrate(x, x, 0, 2)'), 'Całka oznaczona')).toContain('2');

  expect(card(ask('who'), 'Zmienne')).toContain('wynik = 12');
  ask('clear x');
  expect(vars.x).toBeUndefined();
  ask('clear');
  expect(Object.keys(vars)).toEqual([]);
});

test('functions: f(x) = …, @(x) …, applied to numbers and lists', () => {
  const { ask, vars } = session();
  expect(first(ask('f(x) = x^2 + 1'))).toBe('f(x) = x^2 + 1');
  expect(vars.f.kind).toBe('fn');
  expect(card(ask('f(3)'), 'Wynik')).toBe('10');
  expect(card(ask('f(1:3)'), 'Lista')).toBe('[2; 5; 10]');
  expect(card(ask('f(a + 1)'), 'Wynik')).toBe('(a + 1)^2 + 1');
  ask('g = @(x, y) x*y - y');
  expect(card(ask('g(2, 3)'), 'Wynik')).toBe('3');
  // all at once: g(y, x) is not g(x, x)
  expect(card(ask('g(y, x)'), 'Wynik')).toBe('x·y − x');
  expect(ask('g(1)').error).toMatch(/2 argumenty/);
});

test('= stays an equation when the right side has free letters', () => {
  const { ask, vars } = session();
  expect(ask('y = 2x + 1').pods[0].title).not.toBe('Zapisana zmienna');
  expect(Object.keys(vars)).toEqual([]);
  expect(card(ask('x + y = 5, x y = 6'), 'Rozwiązania')).toBe('x = 3, y = 2 | x = 2, y = 3');
  expect(card(ask('x^2 - 5x + 6 = 0'), 'Rozwiązania')).toBe('x = 2 | x = 3');
  // := always assigns, also an expression with letters in it
  expect(first(ask('p := x^2 - 1'))).toBe('p = x^2 − 1');
  expect(card(ask('factor(p)'), 'Postać iloczynowa')).toBe('(x − 1)·(x + 1)');
  // ans carries matrices too
  ask('[1 2; 3 4]');
  expect(card(ask('ans * 2'), 'Macierz')).toBe('[[2, 4], [6, 8]]');
});

test('every example of the page still gives an answer', () => {
  for (const [, items] of EXAMPLES) for (const [q] of items) {
    const r = run(q);
    expect(r.error, q).toBeUndefined();
    expect(r.pods.length, q).toBeGreaterThan(0);
  }
}, 60_000);

test('new syntax errors are readable', () => {
  for (const q of ["'abc'", 'end + 1', '@(x', 'sin = 3', 'A(:)', '[1 2; 3]']) {
    const r = run(q);
    expect(r.error, q).toBeTruthy();
    expect(r.error, q).not.toMatch(/wewnętrzny/);
  }
});
