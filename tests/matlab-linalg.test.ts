import { expect, test } from 'vitest';
import { run, type Result, type Saved } from '../src/cas/engine';

/** The rows of the card with this title (the first card without one). */
function card(q: string | Result, title?: string): string {
  const r = typeof q === 'string' ? run(q) : q;
  if (r.error) throw new Error(`${typeof q === 'string' ? q : ''}: ${r.error}`);
  const p = title ? r.pods.find(p => p.title === title) : r.pods[0];
  if (!p) throw new Error(`no card „${title}” in ${r.pods.map(p => p.title).join(', ')}`);
  return p.rows.map(r => r.text).join(' | ');
}
const noteOf = (q: string | Result, title?: string) => {
  const r = typeof q === 'string' ? run(q) : q;
  return (title ? r.pods.find(p => p.title === title) : r.pods[0])?.note ?? '';
};
/** Every number in a text, read back. */
const numbers = (s: string) => [...s.replace(/−/g, '-').matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map(m => Number(m[0]));
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

test('lu: exact, pivoting as MATLAB, and its outputs', () => {
  expect(card('lu([1 2; 3 4])')).toBe('L = [[1, 0], [1/3, 1]] | U = [[3, 4], [0, 2/3]] | P = [[0, 1], [1, 0]]');
  const { ask, vars } = session();
  ask('A = [2 1 1; 4 -6 0; -2 7 2]');
  ask('[L, U, P] = lu(A)');
  expect(Object.keys(vars).sort()).toEqual(['a', 'l', 'p', 'u']);
  expect(card(ask('P*A - L*U'))).toBe('[[0, 0, 0], [0, 0, 0], [0, 0, 0]]');
  // two outputs: L with its rows permuted back, so that A = L·U
  ask('[L2, U2] = lu(A)');
  expect(card(ask('L2*U2 - A'))).toBe('[[0, 0, 0], [0, 0, 0], [0, 0, 0]]');
  // approximate input: in floating point, checked
  expect(noteOf('lu(double([1 2; 3 4]))')).toMatch(/sprawdzone: ‖P·A − L·U‖\/‖A‖ ≈/);
});

test('chol and qr: exact for rationals', () => {
  expect(card('chol([4 2; 2 3])')).toBe('R = [[2, 1], [0, √2]]');
  expect(run('chol([1 2; 2 1])').error).toMatch(/dodatnio określona/);
  expect(run('chol([1 2; 3 4])').error).toMatch(/symetryczna/);
  expect(card('qr([3 0; 4 5])')).toBe('Q = [[3/5, −4/5], [4/5, 3/5]] | R = [[5, 4], [0, 3]]');
  const { ask } = session();
  ask('[Q, R] = qr([3 0; 4 5])');
  expect(card(ask('Q*R'))).toBe('[[3, 0], [4, 5]]');
  expect(card(ask("Q'*Q"))).toBe('[[1, 0], [0, 1]]');
  // dependent columns: Householder, numerically
  expect(noteOf('qr([1 2; 2 4])')).toMatch(/sprawdzone/);
});

test('svd: exact singular values where they exist, a checked decomposition always', () => {
  expect(card('svd([3 0; 0 -4])', 'Wartości szczególne')).toBe('σ = [[4], [3]]');
  expect(card('svd([1 1; 0 1])', 'Wartości szczególne')).toContain('√5');
  expect(noteOf('svd([1 2; 3 4; 5 6])', 'Rozkład A = U·Σ·Vᵀ')).toMatch(/sprawdzone/);
  const { ask } = session();
  ask('A = [1 2 3; 4 5 6; 7 8 10]');
  ask('[U, S, V] = svd(A)');
  const err = numbers(card(ask("norm(U*S*V' - A)")))[0];
  expect(err).toBeLessThan(1e-13);
  // s = svd(A): one output, the singular values
  ask('s = svd(A)');
  expect(card(ask('size(s)'))).toBe('[3; 1]');
});

test('eig: exact eigenvalues and vectors, numeric ones checked by their residual', () => {
  expect(card('eig([2 1; 1 2])', 'Wartości własne')).toBe('λ = [[1], [3]]');
  expect(card('eig([0 -1; 1 0])', 'Wartości własne')).toBe('λ = [[−i], [i]]');
  expect(card('eig(magic(4))', 'Wartości własne')).toBe('λ = [[−4√5], [0], [4√5], [34]]');
  const { ask } = session();
  ask('[V, D] = eig([2 1; 1 2])');
  expect(card(ask('V'))).toBe('[[−1, 1], [1, 1]]');
  expect(card(ask('[2 1; 1 2]*V - V*D'))).toBe('[[0, 0], [0, 0]]');
  // no closed form: Jacobi for a symmetric matrix
  const sym = run('eig([4 1 2 0 1; 1 3 0 2 1; 2 0 5 1 1; 0 2 1 6 2; 1 1 1 2 7])');
  expect(noteOf(sym, 'Wartości własne')).toMatch(/sprawdzone/);
  expect(numbers(card(sym, 'Wartości własne')).reduce((s, x) => s + x, 0)).toBeCloseTo(25, 10); // the trace
  // complex pairs of an approximate matrix
  const c = card('eig(double([1 2 0; -2 1 0; 0 0 3]))', 'Wartości własne');
  expect(c).toMatch(/1 − 2i/);
  expect(c).toMatch(/1 \+ 2i/);
  expect(card('eig([1 1; 0 1])', 'Wektory własne')).toBe('');
  expect(noteOf('eig([1 1; 0 1])', 'Wektory własne')).toMatch(/nie jest diagonalizowalna/);
});

test('cond, norm, pinv: exact where they can be', () => {
  expect(card('cond([1 0; 0 2])')).toBe('cond A = 2');
  expect(card('cond(hilb(4), 1)')).toBe('cond A = 28375');
  expect(card('cond([1 2; 2 4])')).toBe('cond A = ∞');
  expect(noteOf('cond(hilb(8))')).toMatch(/stracić około 10 cyfr/);
  expect(card('norm([3 4])')).toBe('‖A‖ = 5');
  expect(card('norm([3 4], 1)')).toBe('‖A‖ = 7');
  expect(card('norm([3 -4], inf)')).toBe('‖A‖ = 4');
  expect(card('norm([1 2; 3 4], 1)')).toBe('‖A‖ = 6');
  expect(card('norm([1 2; 3 4], inf)')).toBe('‖A‖ = 7');
  expect(card("norm([1 2; 3 4], 'fro')")).toBe('‖A‖ = √30');
  expect(card('norm([1 2; 3 4])')).toBe('‖A‖ = (√26 + √34)/2'); // √(15 + √221), denested
  expect(card('norm([x, y])')).toMatch(/x\^2 \+ y\^2|y\^2 \+ x\^2/);
  expect(card('pinv([1 2; 2 4])')).toBe('A⁺ = [[1/25, 2/25], [2/25, 4/25]]');
  expect(card('pinv([1 0; 0 1; 1 1])')).toBe('A⁺ = [[2/3, −1/3, 1/3], [−1/3, 2/3, 1/3]]');
  expect(noteOf('pinv([1 2; 2 4])')).toMatch(/Penrose/);
});

test('expm: exact by interpolation, Padé otherwise', () => {
  expect(card('expm([1 1; 0 1])')).toBe('e^A = [[e, e], [0, e]]');
  expect(card('expm([0 1; 0 0])')).toBe('e^A = [[1, 1], [0, 1]]');
  expect(card('expm([2 0; 0 3])')).toBe('e^A = [[e^2, 0], [0, e^3]]');
  const rot = numbers(card('expm([0 1; -1 0])'));
  expect(rot[0]).toBeCloseTo(Math.cos(1), 15);
  expect(rot[1]).toBeCloseTo(Math.sin(1), 15);
  expect(noteOf('expm([0 1; -1 0])')).toMatch(/Padé/);
});

test('approximate numbers: double, arithmetic that stays approximate, a warning for ill conditioning', () => {
  expect(card('double(1/3)')).toBe('0.3333333333333333');
  expect(run('double(1/3)').pods[0].note).toMatch(/podwójnej precyzji/);
  expect(card('double(1/3) * 3', 'Wynik')).toBe('1');
  const { ask, vars } = session();
  ask('A = double([1 2; 3 4])');
  expect(vars.a.code.startsWith('double(')).toBe(true);
  expect(vars.a.label).toBe('macierz 2×2 ≈');
  expect(card(ask('A * A'), 'Macierz')).toBe('[[7, 10], [15, 22]]');
  expect(card(ask('A(2, 2)'))).toBe('4');
  expect(numbers(card(ask('det(A)')))[0]).toBeCloseTo(-2, 14);
  expect(card(ask('rank(double([1 2; 2 4]))'))).toBe('rank A = 1');
  expect(numbers(card(ask('inv(A)'))).slice(0, 4).map(x => Math.round(x * 1e12) / 1e12)).toEqual([-2, 1, 1.5, -0.5]);
  // exactly, hilb(3)\ones is [3, −24, 30]; in floating point hilb(12) loses digits and says so
  expect(card('hilb(3) \\ [1; 1; 1]')).toBe('x1 = 3 | x2 = −24 | x3 = 30');
  expect(noteOf('double(hilb(12)) \\ ones(12, 1)')).toMatch(/źle uwarunkowana/);
  // approximate numbers don't mix with letters
  expect(run('double(2) * x').error).toMatch(/nie łączą się z literami/);
});

test('several outputs: [m, k] = max(v), size, sort', () => {
  const { ask, vars } = session();
  ask('[m, k] = max([3 9 2])');
  expect([vars.m.preview, vars.k.preview]).toEqual(['9', '2']);
  ask('[r, c] = size(zeros(2, 3))');
  expect([vars.r.preview, vars.c.preview]).toEqual(['2', '3']);
  ask('[s, idx] = sort([3 1 2])');
  expect([vars.s.preview, vars.idx.preview]).toEqual(['[1, 2, 3]', '[2, 3, 1]']);
  expect(ask('[a, b] = det([1 2; 3 4])').error).toMatch(/Kilka wyników naraz/);
  // lu and qr are still l·u and q·r where they aren't called
  expect(card('expand(qr*q)', 'Postać rozwinięta')).toBe('q^2·r');
});
