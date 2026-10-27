import { expect, test } from 'vitest';
import { run } from '../src/cas/engine';
import { fromLatex } from '../src/cas/latex';

/** The first row of the first card that has one. */
function answer(q: string): string {
  const r = run(q);
  if (r.error) throw new Error(`${q}: ${r.error}`);
  return r.pods.find(p => p.rows.length)!.rows[0].text;
}

test('plain input is left alone, braces stay a set', () => {
  for (const q of ['x^2 - 4 = 0', '{2, 4, 4, 5}', 'całka x^2 dx', '2^{10}']) expect(fromLatex(q)).toBe(q);
});

test('LaTeX turns into the calculator’s notation', () => {
  expect(fromLatex(String.raw`\frac{1}{2} + \frac{x-1}{x+2}`)).toBe('(1/2) + ((x-1)/(x+2))');
  expect(fromLatex(String.raw`\int_0^1 x^2 \, dx`)).toBe('integrate(x^2, x, 0, 1)');
  expect(fromLatex(String.raw`\sum_{k=1}^{\infty} \frac{1}{k^2}`)).toBe('sum((1/(k^2)), k, 1, inf)');
  expect(fromLatex(String.raw`\lim_{x \to 0^+} \ln x`)).toBe('limit(ln x, x->0, 1)');
  expect(fromLatex(String.raw`\frac{d^2}{dx^2} \sin x`)).toBe('diff(sin x, x, 2)');
  expect(fromLatex(String.raw`\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}`)).toBe('([[1, 2], [3, 4]])');
  expect(fromLatex(String.raw`\begin{cases} x + y = 5 \\ x y = 6 \end{cases}`)).toBe('x + y = 5, x y = 6');
  expect(fromLatex(String.raw`$\alpha \leq \beta$`)).toBe('α <= β');
});

test('LaTeX questions get their answers', () => {
  expect(answer(String.raw`\frac{1}{2} + \frac{2}{3}`)).toBe('7/6');
  expect(answer(String.raw`\sqrt[3]{27}`)).toBe('3');
  expect(answer(String.raw`e^{i\pi}`)).toBe('−1');
  expect(answer(String.raw`\int x^2 \, dx`)).toBe('x^3/3 + C');
  expect(answer(String.raw`\int_{0}^{\pi} \sin x \,\mathrm{d}x`)).toBe('2');
  expect(answer(String.raw`\[ \int_0^\infty e^{-x^2}\, dx \]`)).toBe('√π/2');
  expect(answer(String.raw`\sum_{k=1}^{\infty} \frac{1}{k^2}`)).toBe('π^2/6');
  expect(answer(String.raw`\prod_{k=1}^{5} k`)).toBe('120');
  expect(answer(String.raw`\lim_{x\to\infty}\left(1+\frac{1}{x}\right)^x`)).toBe('e');
  expect(answer(String.raw`\frac{\mathrm{d}}{\mathrm{d}x}\left(x^2 e^x\right)`)).toBe('d/dx (x^2·e^x) = x^2·e^x + 2x·e^x');
  expect(answer(String.raw`\frac{x-1}{x+2} \geq 0`)).toBe('x ∈ (−∞; −2) ∪ ⟨1; +∞)');
  expect(answer(String.raw`\det\begin{bmatrix} a & b \\ c & d \end{bmatrix}`)).toBe('a·d − b·c');
  expect(answer(String.raw`\begin{vmatrix} 1 & 2 \\ 3 & 4 \end{vmatrix}`)).toBe('−2');
  expect(answer(String.raw`\left\{\begin{array}{l} 2x - y = 1 \\ x + y = 5 \end{array}\right.`)).toBe('x = 2, y = 3');
  expect(answer(String.raw`\binom{10}{3}`)).toBe('120');
  expect(answer(String.raw`\log_{2} 8`)).toBe('3');
  expect(answer(String.raw`\sin 30^{\circ}`)).toBe('1/2');
  expect(answer(String.raw`2{,}5 + 1`)).toBe('7/2');
  expect(answer(String.raw`\lfloor 3.7 \rfloor + \lceil 2.1 \rceil`)).toBe('6');
  expect(answer(String.raw`\tg \frac{\pi}{4}`)).toBe('1');
  expect(answer(String.raw`\operatorname{sgn}(-2)`)).toBe('−1');
  expect(answer(String.raw`\mathrm{e}^{x}`)).toBe('e^x');
});
