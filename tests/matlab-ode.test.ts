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
const first = (q: string) => { const r = run(q); if (r.error) throw new Error(`${q}: ${r.error}`); return r.pods[0]; };
const numbers = (s: string) => [...s.replace(/−/g, '-').matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map(m => Number(m[0]));
function session() {
  const vars: Record<string, Saved> = {};
  return (q: string): Result => {
    const r = run(q, { vars: { ...vars } });
    for (const [k, v] of Object.entries(r.assigned ?? {})) { if (v) vars[k] = v; else delete vars[k]; }
    return r;
  };
}

test('functions of a vector: @(v) v(1)^2 + v(2)^2', () => {
  const ask = session();
  ask('g = @(v) v(1)^2 + v(2)^2');
  expect(card(ask('g([3 4])'), 'Wynik')).toBe('25');
  expect(ask('g([3])').error).toMatch(/poza zakresem/);
});

test('fzero: exact roots where they exist, Brent otherwise, no poles', () => {
  expect(card('fzero(x^2 - 2, 1)')).toBe('x = √2');
  expect(numbers(card('fzero(@(x) cos(x) - x, [0 1])'))[0]).toBeCloseTo(0.7390851332151607, 15);
  expect(numbers(card('fzero(x^5 - x - 1, 1)'))[0]).toBeCloseTo(1.1673039782614187, 14);
  expect(run('fzero(tan(x), [1 2])').error).toMatch(/biegun/);
  expect(run('fzero(x^2 + 1, 0)').error).toMatch(/zmiany znaku/);
  // the workspace's x doesn't spoil the function's x
  const ask = session();
  ask('x = 5');
  expect(card(ask('fzero(x^2 - 2, 1)'))).toBe('x = √2');
});

test('minima: fminbnd exactly at a critical point, fminsearch as MATLAB’s', () => {
  expect(card('fminbnd(x^2 - 2x, 0, 3)')).toBe('x = 1 | f(x) = −1');
  expect(card('fminbnd(@(x) x.^3 - 2*x - 5, 0, 2)')).toContain('√6');
  expect(first('fminbnd(x, 0, 1)').note).toMatch(/brzegu/);
  const p = numbers(card('fminsearch(@(v) (v(1) - 1)^2 + (v(2) - 2)^2, [0 0])'));
  expect(p[0]).toBeCloseTo(1, 7);
  expect(p[1]).toBeCloseTo(2, 7);
  // MATLAB's own example: Rosenbrock's banana from (−1.2, 1)
  const b = numbers(card('fminsearch(@(x) 100*(x(2) - x(1)^2)^2 + (1 - x(1))^2, [-1.2 1])'));
  expect(b[0]).toBeCloseTo(1, 5);
  expect(b[1]).toBeCloseTo(1, 5);
});

test('fsolve: systems by Levenberg–Marquardt, checked by the residual', () => {
  const s = numbers(card('fsolve(@(x) [x(1)^2 + x(2)^2 - 4; x(1) - x(2)], [1 1])'));
  expect(s[0]).toBeCloseTo(Math.SQRT2, 10);
  expect(s[1]).toBeCloseTo(Math.SQRT2, 10);
  expect(run('fsolve(@(x) x^2 + 1, 1)').error).toMatch(/nie znalazłem/);
});

test('integral and integral2: exact where they can be', () => {
  expect(card('integral(@(x) x.^2, 0, 1)', 'Całka oznaczona')).toBe('1/3');
  expect(card('integral(@(x) exp(-x.^2), -inf, inf)', 'Całka oznaczona')).toBe('√π');
  expect(card('integral2(@(x, y) x.*y, 0, 1, 0, 2)')).toBe('1');
  expect(card('integral2(@(x, y) x + y, 0, 1, 0, @(x) x)')).toBe('1/2');
  expect(numbers(card('integral2(@(x, y) sin(x*y), 0, 1, 0, 1)'))[0]).toBeCloseTo(0.2398117420005647, 9);
});

test('ode45, ode23: checked by a second run, systems, second order, a phase portrait', () => {
  const decay = first('ode45(@(t, y) -2*y, [0 1], 1)');
  expect(numbers(decay.rows[0].text).at(-1)!).toBeCloseTo(Math.exp(-2), 9);
  expect(decay.note).toMatch(/zgadzają się w dwóch obliczeniach/);
  expect(decay.plot?.series.length).toBe(1);
  const osc = first("ode45(y'' = -y, [0 pi], [1 0])");
  expect(numbers(osc.rows[0].text).at(-1)!).toBeCloseTo(-1, 8);
  expect(Math.abs(numbers(osc.rows[1].text).at(-1)!)).toBeLessThan(1e-8);
  const sys = run('ode23(@(t, y) [y(2); -y(1)], [0 2*pi], [1; 0])');
  expect(numbers(sys.pods[0].rows[0].text).at(-1)!).toBeCloseTo(1, 7);
  expect(sys.pods[0].title).toBe('Rozwiązanie numeryczne (ode23)');
  expect(sys.pods.find(p => p.title === 'Portret fazowy')?.plot?.vectors.length).toBeGreaterThan(50);
  // [t, y] = ode45(…): the times and the values
  const ask = session();
  ask('[t, y] = ode45(@(t, y) -y, [0 1], 1)');
  expect(card(ask('size(t, 2)'))).toBe('1');
});

test('a stiff equation goes to ode15s; a solution that blows up is not continued', () => {
  const stiff = first('ode45(@(t, y) -1e6*(y - cos(t)), [0 1], 0)');
  expect(stiff.title).toBe('Rozwiązanie numeryczne (ode15s)');
  expect(stiff.note).toMatch(/sztywne/);
  expect(Math.abs(numbers(stiff.rows[0].text).at(-1)! - Math.cos(1))).toBeLessThan(1e-5);
  expect(run('ode45(@(t, y) y^2, [0 2], 1)').error).toMatch(/nie istnieje dalej niż do t ≈ 1/);
});

test('dsolve: exact solutions of the classic classes, checked by substitution', () => {
  const decay = first("dsolve(y' = -2*y)");
  expect(decay.rows[0].text).toMatch(/C₁/);
  expect(decay.rows[0].text).toMatch(/e\^\(−2t\)/);
  expect(decay.note).toMatch(/podstawienie/);
  expect(card("dsolve(y'' + y = 0, y(0) = 1, y'(0) = 0)", 'Rozwiązanie z warunkami początkowymi')).toBe('y(t) = cos(t)');
  expect(card("dsolve(y'' - 3y' + 2y = 0)")).toMatch(/e\^\(2t\)/);
  expect(card("dsolve(y'' + 2y' + y = 0)")).toMatch(/e\^\(−t\).*C₂·t|C₂·t.*e\^\(−t\)/);
  expect(card("dsolve(y'' + y = t)")).toMatch(/t/);
  // sinh t, in some form
  expect(card("dsolve(y' + y = e^t, y(0) = 0)", 'Rozwiązanie z warunkami początkowymi')).toMatch(/e\^\(2t\)|e\^t|sinh/);
  expect(card("dsolve(y' = t*y)")).toMatch(/e\^\(t\^2\/2\)/);
  expect(card("dsolve(y' = y^2)")).toMatch(/C₁/);
  expect(first("dsolve(y' = y/t + t^2*y^2)").note).toMatch(/Bernoulliego/);
  expect(first("dsolve(t^2*y'' - 2*t*y' + 2*y = 0)").note).toMatch(/Eulera/);
  expect(run("dsolve(y'' = y'^2 + y*t)").error).toMatch(/ode45/);
  expect(run("dsolve(y'' + y = 0, y(0) = 1)").error).toMatch(/2 warunków/);
});
