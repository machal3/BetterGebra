import { describe, expect, test } from 'vitest';
import { run, type Result } from '../src/cas/engine';

function card(q: string | Result, title?: string): string {
  const r = typeof q === 'string' ? run(q) : q;
  if (r.error) throw new Error(`${typeof q === 'string' ? q : ''}: ${r.error}`);
  const p = title ? r.pods.find(p => p.title === title || p.title.startsWith(title)) : r.pods[0];
  if (!p) throw new Error(`no card „${title}” in ${r.pods.map(p => p.title).join(', ')}`);
  return p.rows.map(r => r.text).join(' | ');
}

const first = (q: string) => {
  const r = run(q);
  if (r.error) throw new Error(`${q}: ${r.error}`);
  return r.pods[0];
};

const numbers = (s: string) =>
  [...s.replace(/−/g, '-').matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)].map(m => Number(m[0]));

describe('Special functions, orthogonal polynomials & combinatorics', () => {
  test('beta, heaviside and dirac functions and calculus rules', () => {
    expect(run('beta(3, 4)').ans).toBe('1/60');
    expect(run('beta(1/2, 1/2)').ans).toBe('π');
    expect(run('heaviside(5)').ans).toBe('1');
    expect(run('heaviside(-3)').ans).toBe('0');
    expect(run('heaviside(0)').ans).toBe('1/2');
    expect(run('dirac(2)').ans).toBe('0');
    expect(run('diff(heaviside(x), x)').ans).toBe('dirac(x)');
    expect(card('integrate(dirac(x), x)', 'Całka nieoznaczona')).toContain('heaviside(x)');
  });

  test('orthogonal polynomials: Legendre, Chebyshev T/U, Hermite, Laguerre', () => {
    expect(run('legendre(3, x)').ans).toBe('5x^3/2 − 3x/2');
    expect(run('legendre(2, 1)').ans).toBe('1');
    expect(run('chebyshevt(4, x)').ans).toBe('8x^4 − 8x^2 + 1');
    expect(run('chebyshevu(2, x)').ans).toBe('4x^2 − 1');
    expect(run('hermite(3, x)').ans).toBe('8x^3 − 12x');
    expect(run('laguerre(2, x)').ans).toBe('(x^2 − 4x + 2)/2');
  });

  test('Bernoulli numbers/polynomials, Stirling 1/2, Bell numbers, partitions', () => {
    expect(run('bernoulli(0)').ans).toBe('1');
    expect(run('bernoulli(1)').ans).toBe('−1/2');
    expect(run('bernoulli(6)').ans).toBe('1/42');
    expect(run('bernoulli(12)').ans).toBe('−691/2730');
    expect(run('bernoulli(2, x)').ans).toBe('x^2 − x + 1/6');
    expect(run('stirling1(4, 2)').ans).toBe('11');
    expect(run('stirling1(5, 2)').ans).toBe('−50');
    expect(run('stirling2(5, 3)').ans).toBe('25');
    expect(run('bell(6)').ans).toBe('203');
    expect(run('partitions(10)').ans).toBe('42');
    expect(run('partitions(100)').ans).toBe('190569292');
  });
});

describe('Multivariable & vector calculus', () => {
  test('gradient (symbolic, at a point, ∇ operator, and numeric vector)', () => {
    const g = first('gradient(x^2*y + y^3)');
    expect(g.rows[0].text).toBe('∇f = [2x·y; x^2 + 3y^2]');
    expect(g.plot).toBeDefined();
    const gAt = first('gradient(x^2 + y^2, [3, 4])');
    expect(gAt.rows.some(r => r.text === '∇f(3; 4) = [6; 8]')).toBe(true);
    expect(gAt.rows.some(r => r.text === '‖∇f(3; 4)‖ = 10')).toBe(true);
    expect(first('∇(x^2 + y^2)').rows[0].text).toBe('∇f = [2x; 2y]');
    expect(first('gradient([1, 4, 9, 16])').rows[0].text).toBe('∇y = [3; 4; 6; 7]');
  });

  test('divergence, curl (2D & 3D), potential and laplacian', () => {
    const divSol = first('divergence([y, -x, 0])');
    expect(divSol.rows[0].text).toBe('div F = ∇ · F = 0');
    expect(divSol.note).toMatch(/bezźródłowe/);

    const curl2 = first('curl([2*x*y, x^2])');
    expect(curl2.rows[0].text).toContain('= 0');
    expect(curl2.note).toMatch(/bezwirowe/);

    const curl3 = first('curl([-y, x, 0], [x, y, z])');
    expect(curl3.rows[0].text).toBe('rot F = ∇ × F = [0; 0; 2]');

    const pot = first('potential([2*x*y, x^2 + 3*y^2])');
    expect(pot.rows[0].text).toContain('x^2·y + y^3');
    expect(run('potential([-y, x])').error).toMatch(/nie jest potencjalne/);

    const lap = first('laplacian(x^3 - 3*x*y^2)');
    expect(lap.rows[0].text).toBe('Δf = ∇²f = 0');
    expect(lap.note).toMatch(/harmoniczna/);
  });

  test('jacobian, hessian, directional, tangentplane and 2D extrema', () => {
    const jac = first('jacobian([r*cos(t), r*sin(t)], [r, t])');
    expect(jac.rows.some(r => r.text === 'Wyznacznik (jakobian) det J = r')).toBe(true);

    const hes = first('hessian(x^2 + 2*y^2, [0, 0])');
    expect(hes.note).toMatch(/dodatnio określona/);

    const dir = first('directional(x^2 + y^2, [3, 4], [1, 2])');
    expect(dir.rows.at(-1)?.text).toBe('(∂f/∂u)(1; 2) = 22/5');

    const tp = first('tangentplane(x^2 + y^2, [1, 2])');
    expect(tp.rows[0].text).toBe('Płaszczyzna styczna z = 2x + 4y − 5');
    expect(tp.plot?.three).toBeDefined();

    const ext = run('extrema(x^2 + y^2 - 2*x - 4*y)');
    expect(ext.error).toBeUndefined();
    const stPod = ext.pods.find(p => p.title.startsWith('Punkty stacjonarne'));
    expect(stPod?.rows[0].text).toContain('(1; 2): f = −5');
    expect(stPod?.rows[0].note).toContain('minimum lokalne');
  });
});

describe('Multiple & line integrals, curves & Wronskian', () => {
  test('integral3, arclength, curvature, lineintegral and wronskian', () => {
    expect(card('integral3(x*y*z, 0, 1, 0, 2, 0, 3)')).toBe('9/2');
    expect(card('arclength([cos(t), sin(t)], 0, pi)')).toContain('L = π');

    const curv = first('curvature([cos(t), sin(t), t])');
    expect(curv.rows.some(r => r.text.includes('κ(t) = 1/2'))).toBe(true);
    expect(curv.rows.some(r => r.text.includes('τ(t) = 1/2'))).toBe(true);

    const liVec = first('lineintegral([-y, x], [cos(t), sin(t)], 0, 2*pi)');
    expect(liVec.rows.at(-1)?.text).toBe('Wartość całki = 2π');

    const liScal = first('lineintegral(1, [cos(t), sin(t)], 0, pi)');
    expect(liScal.rows.at(-1)?.text).toBe('Wartość całki = π');

    const wr = first('wronskian([sin(x), cos(x)])');
    expect(wr.rows[0].text).toBe('Wrońskian W(x) = det M = −1');
    expect(wr.note).toMatch(/liniowo niezależny/);
  });
});

describe('Integral transforms, Fourier series & LTI control systems', () => {
  test('Laplace & inverse Laplace transforms', () => {
    expect(run('laplace(t^2 * exp(-3*t))').ans).toBe('2/(s + 3)^3');
    expect(run('laplace(sin(2*t))').ans).toBe('2/(s^2 + 4)');
    expect(run('ilaplace(1/(s^2 + 2*s + 5))').ans).toBe('e^(−t)·sin(2t)/2');
    expect(run('ilaplace((s + 1)/(s*(s + 2)))').ans).toBe('e^(−2t)/2 + 1/2');
  });

  test('Z-transform & inverse Z-transform', () => {
    expect(run('ztrans((1/2)^n)').ans).toBe('z/(z − 1/2)');
    expect(run('ztrans(n)').ans).toBe('z/(z − 1)^2');
    expect(run('iztrans(z/(z - 2))').ans).toBe('2^n');
  });

  test('Fourier series and LTI control systems (bode, step, impulse, pzmap)', () => {
    const fs = first('fourierseries(x, pi, 3)');
    expect(fs.rows[0].text).toContain('2sin(x)');
    expect(fs.note).toMatch(/nieparzysta/);

    const st = first('step(1/(s^2 + 2*s + 2))');
    expect(st.rows.some(r => r.text === 'Wartość ustalona y(∞) = G(0) = 1/2')).toBe(true);
    expect(st.note).toMatch(/asymptotycznie stabilny/);

    const imp = first('impulse([1], [1, 3, 2])');
    expect(imp.rows[1].text).toContain('e^(−t) − e^(−2t)');

    const bd = run('bode(10/(s*(s + 2)*(s + 5)))');
    expect(bd.error).toBeUndefined();
    expect(bd.pods.length).toBe(3);
    expect(bd.pods[1].plot).toBeDefined();
    expect(bd.pods[2].plot).toBeDefined();

    const pz = first('pzmap(1/(s^2 + 2*s + 5))');
    expect(pz.plot?.marks.length).toBe(2);
  });
});

describe('Exact ODE extensions & systems in dsolve', () => {
  test('exact ODE, integrating factor, homogeneous ODE, and linear ODE systems', () => {
    const exOde = first("dsolve(2*t*y + (t^2 + 3*y^2)*y' = 0)");
    expect(exOde.note).toMatch(/zupełne/);

    const homOde = first("dsolve(y' = (y + t)/t)");
    expect(homOde.rows[0].text).toContain('ln(|t|)');

    const sysOde = run("dsolve([x' = y, y' = -x, x(0) = 1, y(0) = 0])");
    expect(sysOde.error).toBeUndefined();
    const partCard = sysOde.pods.find(p => p.title.includes('szczególne'));
    expect(partCard?.rows.map(r => r.text).join(' | ')).toBe('x(t) = cos(t) | y(t) = −sin(t)');
  });
});

describe('Advanced linear algebra, statistics & Polish phrases', () => {
  test('gramschmidt, sylvester, lyap, jordan, companion, schur, hess', () => {
    const gs = first('gramschmidt([1 1; 1 0; 0 1])');
    expect(gs.note).toMatch(/Qᵀ·Q = I/);

    const sylv = first('sylvester([1 2; 0 3], [4 0; 1 5], [1 2; 3 4])');
    expect(sylv.note).toMatch(/A·X \+ X·B = C/);

    const ly = first('lyap([-1 1; 0 -2], [1 0; 0 1])');
    expect(ly.note).toMatch(/A·X \+ X·Aᵀ \+ Q = 0/);

    const jor = first('jordan([5 4 2 1; 0 1 -1 -1; -1 -1 3 0; 1 1 -1 2])');
    expect(jor.note).toMatch(/A·V = V·J/);

    const comp = first('companion(x^3 - 6*x^2 + 11*x - 6)');
    expect(comp.rows[0].text).toContain('6, −11, 6');

    expect(first('schur([1 2; 3 4])').note).toMatch(/U·T·Uᵀ/);
    expect(first('hess([1 2 3; 4 5 6; 7 8 0])').note).toMatch(/P·H·Pᵀ/);
  });

  test('ttest, ttest2, pca and Polish natural language sugar', () => {
    const tt = first('ttest([10.2, 9.8, 10.5, 10.1, 9.9, 10.3], 10)');
    expect(numbers(tt.rows[1].text)[0]).toBeGreaterThan(0);
    expect(tt.rows.some(r => r.text.includes('95% przedział ufności'))).toBe(true);

    const tt2 = first('ttest2([12, 15, 14, 11, 13], [8, 9, 7, 10, 8])');
    expect(tt2.note).toMatch(/odrzucamy H₀/);

    const pcaRes = first('pca([1 2 3; 4 5 6; 7 8 10; 2 1 0])');
    expect(pcaRes.rows.some(r => r.text.includes('Wyjaśniona wariancja'))).toBe(true);
    expect(pcaRes.plot).toBeDefined();

    // Polish natural-language phrases
    expect(run('transformata laplace sin(t)').ans).toBe('1/(s^2 + 1)');
    expect(first('dywergencja [x, y, z]').rows[0].text).toBe('div F = ∇ · F = 3');
  });
});
