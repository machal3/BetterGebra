/**
 * MATLAB's numerical analysis: fzero (Brent, then the exact root or certain digits where the engine can give them),
 * fminbnd (Brent's golden section with parabolas, then the exact critical point when there is one), fminsearch
 * (Nelder–Mead as MATLAB's, restarted once), fsolve (Levenberg–Marquardt on the residuals) and integral2 (exact by
 * iterated antiderivatives when they exist, else nested Gauss–Kronrod). Each result is checked before it is shown.
 */
import { Expr, ONE, ZERO, add, div, fn, isConstant, mul, num, pow, sqrt, sub, subst, sym, variables } from './expr';
import { Value, approxValue, component, ex, scalar } from './evaluate';
import { grid, valueOf } from './arrays';
import { diff } from './calculus';
import * as D from './dense';
import { compileDouble } from './fast';
import { toText } from './format';
import { definite, integrate, quad } from './integrate';
import { Card, Linalg, tiny } from './linalg';
import { det } from './matrix';
import { approx } from './numeric';
import { fmt } from './plot';
import { fail, qFromDouble } from './q';
import { simplify, zeroTest } from './simplify';
import { solveEquation } from './solve';

const tidy = (e: Expr) => { try { return simplify(e); } catch { return e; } };
const dbl = (x: number) => num(qFromDouble(x));
const approxNum = (x: number): Value => approxValue(ex(dbl(x)));
const card = (title: string, rows: [string, Value][], note?: string): Card => ({ title, rows, note });

// --- Functions given as @(x) …, a defined f, or an expression ---

/** A function of named real variables: its outputs as expressions, and the names in order. */
export interface Fun { vars: string[]; outs: Expr[] }
/** The function a value stands for; n: how many variables (components of a vector argument) it should take. */
export function funOf(v: Value, n: number, what: string): Fun {
  const outsOf = (b: Value): Expr[] => b.t === 'expr' ? [b.e] : b.t === 'list' ? b.items.map(i => scalar(i, what)) : b.t === 'matrix' ? b.rows.flat() : fail(`${what}: funkcja ma dawać liczbę albo wektor.`);
  if (v.t === 'fn') {
    const outs = outsOf(v.body);
    // @(v) v(1)^2 + v(2)^2: a function of a vector, its components v_1, v_2 …
    if (v.params.length === 1) {
      const p = v.params[0], used = outs.some(e => variables(e).some(s => s.startsWith(`${p}_`)));
      if (used) return { vars: Array.from({ length: n }, (_, k) => component(p, k + 1)), outs };
    }
    if (v.params.length !== n) fail(`${what}: funkcja ma ${v.params.length} ${v.params.length === 1 ? 'parametr' : 'parametry'}, a potrzeba ${n}.`);
    return { vars: v.params, outs };
  }
  const outs = outsOf(v), vars = [...new Set(outs.flatMap(e => variables(e)))].sort();
  if (vars.length > n) fail(`${what}: wyrażenie ma zmienne ${vars.join(', ')}, a potrzeba ${n}. Zapisz funkcję jako @(…) …`);
  const std = ['x', 'y', 'z', 't'].slice(0, n);
  if ((n === 2 || n === 3) && vars.every(c => std.includes(c))) return { vars: std, outs };
  // a constant, or fewer letters than needed: the rest are named after x
  for (const c of ['x', 'y', 'z', 't']) if (vars.length < n && !vars.includes(c)) vars.push(c);
  return { vars: vars.slice(0, n), outs };
}
/** The function in doubles: values of the variables in, outputs out. */
export function numericFun(f: Fun): (x: number[]) => number[] {
  const params: Record<string, number> = Object.fromEntries(f.vars.map(v => [v, 0]));
  const fs = f.outs.map(e => compileDouble(e, '\u0000', params));
  return x => { f.vars.forEach((v, k) => { params[v] = x[k]; }); return fs.map(g => g(0)); };
}
const vectorOf = (v: Value, what: string): number[] => grid(v, what).flat().map(e => { const z = approx(e); if (Math.abs(z.im) > 1e-12) fail(`${what}: oczekuję liczb rzeczywistych.`); return z.re; });

// --- Brent: a zero in a bracket, a minimum in an interval ---

function brentZero(f: (x: number) => number, a: number, b: number, fa: number, fb: number): number {
  let c = a, fc = fa, d = b - a, e = d;
  for (let it = 0; it < 300; it++) {
    if (Math.sign(fb) === Math.sign(fc)) { c = a; fc = fa; d = e = b - a; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol = 2 * D.EPS * Math.abs(b) + 1e-300, m = 0.5 * (c - b);
    if (Math.abs(m) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      let p: number, q: number;
      const s = fb / fa;
      if (a === c) { p = 2 * m * s; q = 1 - s; }
      else { const qq = fa / fc, r = fb / fc; p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1)); q = (qq - 1) * (r - 1) * (s - 1); }
      if (p > 0) q = -q; else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) { e = d; d = p / q; } else { d = m; e = m; }
    } else { d = m; e = m; }
    a = b; fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = f(b);
  }
  return b;
}
function brentMin(f: (x: number) => number, a: number, b: number): { x: number; fx: number } {
  const c = (3 - Math.sqrt(5)) / 2;
  let v = a + c * (b - a), w = v, x = v, e = 0, d = 0;
  let fx = f(x), fv = fx, fw = fx;
  for (let it = 0; it < 1000; it++) {
    const m = 0.5 * (a + b), tol = 1e-11 * Math.abs(x) + 1e-14, t2 = 2 * tol;
    if (Math.abs(x - m) <= t2 - 0.5 * (b - a)) break;
    let p = 0, q = 0, r = 0;
    if (Math.abs(e) > tol) {
      r = (x - w) * (fx - fv); q = (x - v) * (fx - fw); p = (x - v) * q - (x - w) * r; q = 2 * (q - r);
      if (q > 0) p = -p; else q = -q;
      r = e; e = d;
    }
    if (Math.abs(p) < Math.abs(0.5 * q * r) && p > q * (a - x) && p < q * (b - x)) {
      d = p / q;
      const u = x + d;
      if (u - a < t2 || b - u < t2) d = x < m ? tol : -tol;
    } else { e = (x < m ? b : a) - x; d = c * e; }
    const u = x + (Math.abs(d) >= tol ? d : d > 0 ? tol : -tol), fu = f(u);
    if (fu <= fx) { if (u < x) b = x; else a = x; v = w; fv = fw; w = x; fw = fx; x = u; fx = fu; }
    else {
      if (u < x) a = u; else b = u;
      if (fu <= fw || w === x) { v = w; fv = fw; w = u; fw = fu; } else if (fu <= fv || v === x || v === w) { v = u; fv = fu; }
    }
  }
  return { x, fx };
}

// --- Nelder–Mead, as MATLAB's fminsearch ---

function nelderMead(f: (x: number[]) => number, x0: number[], restarts = 1): { x: number[]; fx: number; iterations: number } {
  const n = x0.length;
  let best = x0.slice(), iterations = 0;
  for (let round = 0; round <= restarts; round++) {
    // MATLAB's start: 5 % along each axis, 0.00025 where the coordinate is 0
    let S = [best.slice(), ...best.map((v, i) => best.map((w, j) => (i === j ? (v ? v * 1.05 : 0.00025) : w)))];
    let F = S.map(f);
    for (let it = 0; it < 400 * n + 400; it++, iterations++) {
      const order = F.map((_, i) => i).sort((i, j) => F[i] - F[j]);
      S = order.map(i => S[i]); F = order.map(i => F[i]);
      const spread = Math.max(...F.map(v => Math.abs(v - F[0]))), size = Math.max(...S.map(p => Math.max(...p.map((v, j) => Math.abs(v - S[0][j])))));
      if (spread <= 1e-13 * (1 + Math.abs(F[0])) && size <= 1e-11 * (1 + Math.max(...S[0].map(Math.abs)))) break;
      const bar = S[0].map((_, j) => S.slice(0, n).reduce((s, p) => s + p[j], 0) / n), worst = S[n];
      const at = (t: number) => bar.map((v, j) => v + t * (v - worst[j]));
      const xr = at(1), fr = f(xr);
      if (fr < F[0]) { const xe = at(2), fe = f(xe); [S[n], F[n]] = fe < fr ? [xe, fe] : [xr, fr]; continue; }
      if (fr < F[n - 1]) { S[n] = xr; F[n] = fr; continue; }
      const outside = fr < F[n], xc = at(outside ? 0.5 : -0.5), fc = f(xc);
      if (outside ? fc <= fr : fc < F[n]) { S[n] = xc; F[n] = fc; continue; }
      // shrink towards the best point
      S = S.map((p, i) => (i ? p.map((v, j) => S[0][j] + 0.5 * (v - S[0][j])) : p));
      F = S.map((p, i) => (i ? f(p) : F[0]));
    }
    const k = F.indexOf(Math.min(...F));
    best = S[k];
  }
  return { x: best, fx: f(best), iterations };
}

/** Levenberg–Marquardt on residuals F(x): a root of a system, or its least-squares point. */
function solveSystem(F: (x: number[]) => number[], x0: number[]): { x: number[]; norm: number } {
  let x = x0.slice(), r = F(x), s = r.reduce((t, v) => t + v * v, 0), lam = 1e-3;
  const n = x.length;
  for (let it = 0; it < 500 && s > 0; it++) {
    const J = r.map(() => Array<number>(n).fill(0));
    for (let k = 0; k < n; k++) {
      const h = 1e-7 * Math.max(1, Math.abs(x[k])), q = x.slice(); q[k] += h;
      F(q).forEach((v, i) => { J[i][k] = (v - r[i]) / h; });
    }
    const JT = D.transpose(J), A = D.mul(JT, J), g = JT.map(row => row.reduce((t, v, i) => t + v * r[i], 0));
    let moved = false;
    for (let tries = 0; tries < 30; tries++) {
      const M = A.map((row, i) => row.map((v, j) => v + (i === j ? lam * Math.max(A[i][i], 1e-12) : 0)));
      const d = D.solve(M, g.map(v => [-v]));
      if (!d) { lam *= 10; continue; }
      const q = x.map((v, k) => v + d[k][0]), rq = F(q), sq = rq.reduce((t, v) => t + v * v, 0);
      if (Number.isFinite(sq) && sq < s) {
        const small = Math.max(...d.map((v, k) => Math.abs(v[0]) / (1e-12 + Math.abs(q[k]))));
        x = q; r = rq; s = sq; lam = Math.max(lam / 5, 1e-15); moved = true;
        if (small < 1e-15) return { x, norm: Math.sqrt(s) };
        break;
      }
      lam *= 4;
    }
    if (!moved) break;
  }
  return { x, norm: Math.sqrt(s) };
}

// --- The commands ---

type Command = (args: Value[], nout: number) => Linalg | null;
const scalarFun = (v: Value, what: string) => { const f = funOf(v, 1, what); const g = numericFun(f); return { f, g: (x: number) => g([x])[0] }; };

export const NUMERICS: Record<string, Command> = {
  fzero: ([fv, x0v]) => {
    const { f, g } = scalarFun(fv, 'fzero'), e = f.outs[0], x = f.vars[0];
    const start = vectorOf(x0v, 'fzero');
    let a: number, b: number;
    if (start.length === 2) {
      [a, b] = start;
      if (Math.sign(g(a)) === Math.sign(g(b)) && g(a) !== 0) fail(`fzero: na końcach przedziału ⟨${fmt(a)}; ${fmt(b)}⟩ funkcja ma ten sam znak.`);
    } else {
      // from x0 outwards until the sign changes, as MATLAB searches
      const x0 = start[0];
      let dx = x0 ? Math.abs(x0) / 50 : 1 / 50;
      [a, b] = [x0, x0];
      for (;;) {
        if (g(a) === 0 || g(b) === 0 || Math.sign(g(a)) !== Math.sign(g(b))) break;
        dx *= Math.SQRT2;
        [a, b] = [x0 - dx, x0 + dx];
        if (dx > 1e12 || !Number.isFinite(g(a)) && !Number.isFinite(g(b))) fail('fzero: nie znalazłem zmiany znaku w okolicy punktu startowego.');
      }
    }
    const fa = g(a), fb = g(b), r = fa === 0 ? a : fb === 0 ? b : brentZero(g, a, b, fa, fb);
    // a sign change where f doesn't vanish is a pole (tan x at π/2), not a zero
    const scale = Math.max(Math.abs(fa), Math.abs(fb), 1);
    const fr = g(r);
    if (!(Math.abs(fr) <= 1e-8 * scale)) fail(`fzero: w x ≈ ${fmt(r)} funkcja zmienia znak, ale się nie zeruje (|f| ≈ ${tiny(Math.abs(fr))}); to raczej biegun.`);
    // the exact root, or digits that are certain, from the engine's own solver
    const lo = Math.min(a, b), hi = Math.max(a, b);
    let exact: Expr | null = null;
    try {
      const sols = solveEquation(e, x);
      if (sols.kind === 'list') for (const s of sols.sols) if (s.exact && !s.family && isConstant(s.exact) && Math.abs(approx(s.exact).re - r) <= 1e-9 * (1 + Math.abs(r)) && Math.abs(approx(s.exact).im) < 1e-12) exact = tidy(s.exact);
    } catch { exact = null; }
    if (exact) return { cards: [card('Miejsce zerowe', [[x, ex(exact)]], `Dokładnie; f zmienia znak w ⟨${fmt(lo)}; ${fmt(hi)}⟩. ≈ ${fmt(r)}`)], outputs: [ex(exact)] };
    return { cards: [card('Miejsce zerowe', [[x, approxNum(r)]], `Numerycznie (metoda Brenta); f zmienia znak w ⟨${fmt(lo)}; ${fmt(hi)}⟩, |f(x)| ≈ ${tiny(Math.abs(fr))}.`)], outputs: [approxNum(r)] };
  },
  fminbnd: ([fv, av, bv], nout) => {
    const { f, g } = scalarFun(fv, 'fminbnd'), e = f.outs[0], x = f.vars[0];
    const a = vectorOf(av, 'fminbnd')[0], b = vectorOf(bv, 'fminbnd')[0];
    if (!(a < b)) fail('fminbnd: przedział ⟨a; b⟩ musi mieć a < b.');
    const m = brentMin(g, a, b);
    // checked: nothing lower nearby, nor at the ends
    const h = 1e-6 * (b - a), worse = [m.x - h, m.x + h].filter(t => t >= a && t <= b).some(t => g(t) < m.fx - 1e-12 * (1 + Math.abs(m.fx)));
    if (worse || !Number.isFinite(m.fx)) fail('fminbnd: nie znalazłem minimum (funkcja nieciągła albo nieokreślona w przedziale?).');
    const edge = Math.min(m.x - a, b - m.x) < 1e-6 * (b - a);
    // the exact critical point, when f′ = 0 has a closed form there
    let xe: Expr | null = null;
    if (!edge) {
      try {
        const sols = solveEquation(diff(e, x), x);
        if (sols.kind === 'list') for (const s of sols.sols) if (s.exact && !s.family && isConstant(s.exact) && Math.abs(approx(s.exact).re - m.x) <= 1e-6 * (1 + Math.abs(m.x))) xe = tidy(s.exact);
      } catch { xe = null; }
    }
    const xv = xe ? ex(xe) : approxNum(m.x), fval = xe ? ex(tidy(subst(e, x, xe))) : approxNum(m.fx);
    const note = `${xe ? 'Dokładnie: miejsce zerowe pochodnej.' : 'Numerycznie (złoty podział i interpolacja paraboliczna).'}${edge ? ' Minimum leży na brzegu przedziału.' : ' Minimum lokalne w przedziale.'}`;
    return { cards: [card(`Minimum w przedziale ⟨${fmt(a)}; ${fmt(b)}⟩`, [[x, xv], [`f(${x})`, fval]], note)], outputs: nout >= 2 ? [xv, fval] : [xv] };
  },
  fminsearch: ([fv, x0v], nout) => {
    const x0 = vectorOf(x0v, 'fminsearch'), f = funOf(fv, x0.length, 'fminsearch');
    if (f.outs.length !== 1) fail('fminsearch: funkcja ma dawać jedną liczbę.');
    const g = numericFun(f), h = (x: number[]) => { const v = g(x)[0]; return Number.isFinite(v) ? v : Infinity; };
    const r = nelderMead(h, x0);
    if (!Number.isFinite(r.fx)) fail('fminsearch: funkcja nie ma skończonych wartości w okolicy punktu startowego.');
    // checked along each axis
    const lower = r.x.some((v, k) => [-1, 1].some(s => { const q = r.x.slice(); q[k] = v + s * 1e-5 * (1 + Math.abs(v)); return h(q) < r.fx - 1e-9 * (1 + Math.abs(r.fx)); }));
    const xv = approxValue(r.x.length === 1 ? ex(dbl(r.x[0])) : valueOf([r.x.map(dbl)])), fval = approxNum(r.fx);
    const names = f.vars.length === r.x.length ? f.vars : r.x.map((_, k) => `x${k + 1}`);
    return {
      cards: [card('Minimum (Nelder–Mead)', [['x', xv], ['f(x)', fval]], `Numerycznie: metoda Neldera–Meada (jak fminsearch w MATLAB-ie), ${r.iterations} kroków, z ponownym startem. ${lower ? 'Uwaga: w pobliżu są niższe wartości, więc to może nie być minimum.' : 'Sprawdzone: wzdłuż każdej osi wartości w pobliżu nie są niższe (minimum lokalne).'} Zmienne: ${names.join(', ')}.`)],
      outputs: nout >= 2 ? [xv, fval] : [xv],
    };
  },
  fsolve: ([fv, x0v]) => {
    const x0 = vectorOf(x0v, 'fsolve'), f = funOf(fv, x0.length, 'fsolve'), g = numericFun(f);
    const r = solveSystem(g, x0), scale = Math.max(1, ...g(x0).map(Math.abs));
    if (!(r.norm <= 1e-9 * scale)) fail(`fsolve: nie znalazłem rozwiązania (najmniejsze ‖F(x)‖ ≈ ${tiny(r.norm)}). Spróbuj innego punktu startowego.`);
    const xv = approxValue(r.x.length === 1 ? ex(dbl(r.x[0])) : valueOf([r.x.map(dbl)]));
    return { cards: [card('Rozwiązanie układu F(x) = 0', [['x', xv]], `Numerycznie (Levenberg–Marquardt z jakobianem z różnic); sprawdzone: ‖F(x)‖ ≈ ${tiny(r.norm)}.`)], outputs: [xv] };
  },
  integral2: ([fv, xa, xb, ya, yb]) => {
    const f = funOf(fv, 2, 'integral2'), [x, y] = f.vars, e = f.outs[0];
    const bound = (v: Value, what: string): Expr => {
      if (v.t === 'fn') {
        const body = v.params.length === 1 && v.body.t === 'expr' ? v.body.e : fail(`${what}: granica to liczba albo funkcja x.`);
        return subst(body, v.params[0], sym(x));
      }
      const b = scalar(v, what);
      return variables(b).length === 1 && variables(b)[0] !== x ? subst(b, variables(b)[0], sym(x)) : b;
    };
    const [x0, x1] = [scalar(xa, 'Granica x'), scalar(xb, 'Granica x')], [y0, y1] = [bound(ya, 'Granica y'), bound(yb, 'Granica y')];
    if (!isConstant(x0) || !isConstant(x1)) fail('integral2: granice x muszą być liczbami.');
    // numerically: an inner integral in y for each x of the outer one
    const fy = (xv: number) => { const params: Record<string, number> = { [x]: xv }; return compileDouble(e, y, params); };
    const Y0 = compileDouble(y0, x), Y1 = compileDouble(y1, x);
    let err = 0;
    const outer = quad(t => { const r = quad(fy(t), Y0(t), Y1(t)); if (!r) return NaN; err += r.error; return r.value; }, approx(x0).re, approx(x1).re);
    if (!outer || !Number.isFinite(outer.value)) fail('integral2: całka numeryczna się nie zbiegła.');
    // exactly, by iterated antiderivatives, when they exist and agree with the numbers
    try {
      const F = integrate(e, y);
      if (F) {
        const G = tidy(sub(subst(F, y, y1), subst(F, y, y0)));
        const d = definite(G, x, x0, x1);
        if (d.exact) {
          const v = tidy(d.exact), z = approx(v);
          if (Math.abs(z.re - outer!.value) <= 1e-7 * (1 + Math.abs(outer!.value)) && Math.abs(z.im) < 1e-12) {
            return { cards: [card('Całka podwójna', [['', ex(v)]], `Dokładnie: całki iterowane, najpierw po ${y}, potem po ${x}; zgodne z całkowaniem numerycznym (≈ ${fmt(outer!.value)}).`)], outputs: [ex(v)] };
          }
        }
      }
    } catch { /* numbers only */ }
    const total = outer!.error + err;
    return { cards: [card('Całka podwójna', [['', approxNum(outer!.value)]], `Numerycznie: zagnieżdżona kwadratura Gaussa–Kronroda; szacowany błąd ${tiny(total)}.`)], outputs: [approxNum(outer!.value)] };
  },
  integral3: (args) => integral3Cmd(args),
  arclength: (args) => arclengthCmd(args),
  curvature: (args) => curvatureCmd(args),
  lineintegral: (args) => lineIntegralCmd(args),
  wronskian: (args, nout) => wronskianCmd(args, nout),
};
/** integral(f, a, b): the integrand and its variable, for the engine's own definite integral. */
export function integrand(v: Value): { e: Expr; x: string } {
  const f = funOf(v, 1, 'integral');
  if (f.outs.length !== 1) fail('integral: funkcja ma dawać jedną liczbę.');
  return { e: f.outs[0], x: f.vars[0] };
}


// --- Triple integral, arc length, curvature, line integrals, Wronskian ---

// 8-point Gauss-Legendre nodes & weights on [-1, 1] for fast 3D quadrature verification & fallback
const GL8_X = [-0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498, 0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363];
const GL8_W = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];

function gl1D(f: (t: number) => number, a: number, b: number, panels = 1): number {
  if (a === b) return 0;
  const h = (b - a) / panels;
  let total = 0;
  for (let p = 0; p < panels; p++) {
    const lo = a + p * h, hi = lo + h, mid = 0.5 * (lo + hi), half = 0.5 * (hi - lo);
    let s = 0;
    for (let i = 0; i < 8; i++) s += GL8_W[i] * f(mid + half * GL8_X[i]);
    total += half * s;
  }
  return total;
}

function integral3Cmd([fv, xa, xb, ya, yb, za, zb]: Value[]): Linalg {
  const f = funOf(fv, 3, 'integral3'), [x, y, z] = f.vars, e = f.outs[0];
  const bound1 = (v: Value, what: string): Expr => {
    if (v.t === 'fn') {
      const body = v.params.length === 1 && v.body.t === 'expr' ? v.body.e : fail(`${what}: granica to liczba albo funkcja ${x}.`);
      return subst(body, v.params[0], sym(x));
    }
    const b = scalar(v, what), vs = variables(b);
    return vs.length === 1 && vs[0] !== x ? subst(b, vs[0], sym(x)) : b;
  };
  const bound2 = (v: Value, what: string): Expr => {
    if (v.t === 'fn') {
      const body = v.params.length <= 2 && v.body.t === 'expr' ? v.body.e : fail(`${what}: granica to liczba albo funkcja (${x}, ${y}).`);
      let out = body;
      if (v.params[0]) out = subst(out, v.params[0], sym(x));
      if (v.params[1]) out = subst(out, v.params[1], sym(y));
      return out;
    }
    return scalar(v, what);
  };
  const [x0, x1] = [scalar(xa, 'Granica x'), scalar(xb, 'Granica x')];
  if (!isConstant(x0) || !isConstant(x1)) fail('integral3: zewnętrzne granice x muszą być liczbami.');
  const [y0, y1] = [bound1(ya, 'Granica y'), bound1(yb, 'Granica y')];
  const [z0, z1] = [bound2(za, 'Granica z'), bound2(zb, 'Granica z')];

  const params: Record<string, number> = { [x]: 0, [y]: 0 };
  const fz = compileDouble(e, z, params);
  const Y0 = compileDouble(y0, x), Y1 = compileDouble(y1, x);
  const Z0 = compileDouble(z0, y, params), Z1 = compileDouble(z1, y, params);
  const ax0 = approx(x0).re, ax1 = approx(x1).re;
  const eval3D = (panels: number) => gl1D(xv => {
    params[x] = xv;
    return gl1D(yv => {
      params[y] = yv;
      return gl1D(zv => fz(zv), Z0(yv), Z1(yv), panels);
    }, Y0(xv), Y1(xv), panels);
  }, ax0, ax1, panels);

  const coarse = eval3D(1);
  if (!Number.isFinite(coarse)) fail('integral3: całka numeryczna się nie zbiegła.');

  try {
    const Fz = integrate(e, z);
    if (Fz) {
      const Gz = tidy(sub(subst(Fz, z, z1), subst(Fz, z, z0)));
      const Fy = integrate(Gz, y);
      if (Fy) {
        const Gy = tidy(sub(subst(Fy, y, y1), subst(Fy, y, y0)));
        const d = definite(Gy, x, x0, x1);
        if (d.exact) {
          const v = tidy(d.exact), zv = approx(v);
          if (Math.abs(zv.re - coarse) <= 1e-5 * (1 + Math.abs(coarse)) && Math.abs(zv.im) < 1e-12) {
            return {
              cards: [card('Całka potrójna', [['', ex(v)]], `Dokładnie: całki iterowane po ${z}, ${y}, ${x}; zgodne z kwadraturą 3D (≈ ${fmt(zv.re)}).`)],
              outputs: [ex(v)],
            };
          }
        }
      }
    }
  } catch { /* fallback to numerical quadrature */ }

  const fine = eval3D(3);
  if (!Number.isFinite(fine)) fail('integral3: całka numeryczna się nie zbiegła.');
  const err = Math.abs(fine - coarse);
  return {
    cards: [card('Całka potrójna', [['', approxNum(fine)]], `Numerycznie: zagnieżdżona kwadratura Gaussa–Legendre’a 3D; szacowany błąd ${tiny(err)}.`)],
    outputs: [approxNum(fine)],
  };
}

function curveParts(v: Value, varArg: Value | undefined, what: string): { comps: Expr[]; t: string; explicit: boolean } {
  const comps = v.t === 'list' ? v.items.map(i => scalar(i, what))
    : v.t === 'matrix' && (v.rows.length === 1 || v.rows[0]?.length === 1) ? v.rows.flat()
    : v.t === 'fn' ? funOf(v, v.params.length, what).outs
    : [scalar(v, what)];
  let t: string | null = null;
  if (varArg && varArg.t === 'expr' && varArg.e.k === 's' && !['pi', 'e', 'i', 'inf'].includes(varArg.e.n)) {
    t = varArg.e.n;
  } else if (v.t === 'fn' && v.params.length === 1) {
    t = v.params[0];
  } else {
    const vs = [...new Set(comps.flatMap(c => variables(c)))];
    if (vs.length > 1) fail(`${what}: krzywa powinna zależeć od jednego parametru (znaleziono: ${vs.join(', ')}).`);
    t = vs[0] ?? (comps.length > 1 ? 't' : 'x');
  }
  return { comps, t, explicit: comps.length === 1 };
}

function arclengthCmd(args: Value[]): Linalg {
  // arclength(f), arclength(f, a, b), arclength(f, x, a, b)
  const hasVar = args.length === 4;
  const { comps, t, explicit } = curveParts(args[0], hasVar ? args[1] : undefined, 'arclength');
  const derivs = comps.map(c => tidy(diff(c, t)));
  const ds2 = explicit ? add(ONE, pow(derivs[0], num(2))) : add(...derivs.map(d => pow(d, num(2))));
  const ds = tidy(sqrt(tidy(ds2)));
  const rows: [string, Value][] = [['Element łuku ds/d' + t, ex(ds)]];
  if (args.length === 1) {
    const F = (() => { try { return integrate(ds, t); } catch { return null; } })();
    if (F) rows.push(['Funkcja długości łuku s(' + t + ')', ex(tidy(F))]);
    return { cards: [card('Element długości łuku', rows, `Zmienna: ${t}. Podaj przedział [a, b], np. arclength(${toText(comps[0])}, 0, 1).`)], outputs: [ex(ds)] };
  }
  const aVal = hasVar ? args[2] : args[1], bVal = hasVar ? args[3] : args[2];
  if (!aVal || !bVal) fail('arclength: podaj początek i koniec przedziału, np. arclength(f, a, b).');
  const a = scalar(aVal, 'Początek przedziału'), b = scalar(bVal, 'Koniec przedziału');
  const d = definite(ds, t, a, b);
  if (d.exact) {
    const v = tidy(d.exact);
    rows.push(['Długość łuku L', ex(v)]);
    return { cards: [card(`Długość łuku dla ${t} ∈ ⟨${toText(a)}; ${toText(b)}⟩`, rows, `Dokładnie${d.numeric ? ` (≈ ${fmt(d.numeric.value)})` : ''}.`)], outputs: [ex(v)] };
  }
  if (d.numeric && Number.isFinite(d.numeric.value)) {
    const v = approxNum(d.numeric.value);
    rows.push(['Długość łuku L', v]);
    return { cards: [card(`Długość łuku dla ${t} ∈ ⟨${toText(a)}; ${toText(b)}⟩`, rows, `Numerycznie (kwadratura Gaussa–Kronroda, błąd ≈ ${tiny(d.numeric.error)}).`)], outputs: [v] };
  }
  return fail('arclength: nie udało się obliczyć całki długości łuku.');
}

function curvatureCmd(args: Value[]): Linalg {
  // curvature(f), curvature(f, t0), curvature(f, t, t0)
  const hasVar = args.length === 3 || (args.length === 2 && args[1].t === 'expr' && args[1].e.k === 's' && !['pi', 'e', 'i', 'inf'].includes(args[1].e.n) && variables(args[0].t === 'expr' ? args[0].e : ZERO).includes(args[1].e.n));
  const { comps, t, explicit } = curveParts(args[0], hasVar ? args[1] : undefined, 'curvature');
  const ptVal = args.length === 3 ? args[2] : (!hasVar && args.length === 2 ? args[1] : undefined);
  const t0 = ptVal ? scalar(ptVal, 'Punkt') : null;

  let kappa: Expr;
  let torsion: Expr | null = null;
  if (explicit) {
    const y1 = tidy(diff(comps[0], t)), y2 = tidy(diff(y1, t));
    kappa = tidy(div(fn('abs', y2), pow(add(ONE, pow(y1, num(2))), num(3, 2))));
  } else if (comps.length === 2) {
    const [x1, y1] = comps.map(c => tidy(diff(c, t)));
    const [x2, y2] = [x1, y1].map(c => tidy(diff(c, t)));
    const cross2 = tidy(sub(mul(x1, y2), mul(y1, x2)));
    const speed2 = tidy(add(pow(x1, num(2)), pow(y1, num(2))));
    if (zeroTest(speed2)) fail('curvature: krzywa ma zerową prędkość r′(t) = 0.');
    kappa = tidy(div(fn('abs', cross2), pow(speed2, num(3, 2))));
  } else if (comps.length === 3) {
    const r1 = comps.map(c => tidy(diff(c, t)));
    const r2 = r1.map(c => tidy(diff(c, t)));
    const r3 = r2.map(c => tidy(diff(c, t)));
    const cx = tidy(sub(mul(r1[1], r2[2]), mul(r1[2], r2[1])));
    const cy = tidy(sub(mul(r1[2], r2[0]), mul(r1[0], r2[2])));
    const cz = tidy(sub(mul(r1[0], r2[1]), mul(r1[1], r2[0])));
    const crossNorm2 = tidy(add(pow(cx, num(2)), pow(cy, num(2)), pow(cz, num(2))));
    const speed2 = tidy(add(pow(r1[0], num(2)), pow(r1[1], num(2)), pow(r1[2], num(2))));
    if (zeroTest(speed2)) fail('curvature: krzywa ma zerową prędkość r′(t) = 0.');
    kappa = tidy(div(sqrt(crossNorm2), pow(speed2, num(3, 2))));
    if (!zeroTest(crossNorm2)) {
      const triple = tidy(add(mul(cx, r3[0]), mul(cy, r3[1]), mul(cz, r3[2])));
      torsion = tidy(div(triple, crossNorm2));
    } else {
      torsion = ZERO;
    }
  } else {
    return fail('curvature: podaj funkcję y = f(x) albo krzywą parametryczną 2D/3D.');
  }

  const radius = zeroTest(kappa) ? sym('inf') : tidy(div(ONE, kappa));
  const rows: [string, Value][] = [
    ['Krzywizna κ(' + t + ')', ex(kappa)],
    ['Promień krzywizny R = 1/κ', ex(radius)],
  ];
  if (torsion) rows.push(['Skręcenie (torsja) τ(' + t + ')', ex(torsion)]);

  let out = kappa;
  if (t0) {
    const kAt = tidy(subst(kappa, t, t0));
    const rAt = zeroTest(kAt) ? sym('inf') : tidy(div(ONE, kAt));
    rows.push([`κ(${toText(t0)})`, ex(kAt)], [`R(${toText(t0)})`, ex(rAt)]);
    if (torsion) rows.push([`τ(${toText(t0)})`, ex(tidy(subst(torsion, t, t0)))]);
    out = kAt;
  }
  return { cards: [card('Krzywizna krzywej', rows, `Parametr: ${t}.`)], outputs: [ex(out)] };
}

function lineIntegralCmd(args: Value[]): Linalg {
  // lineintegral(F, [x(t), y(t)], a, b) or lineintegral(F, [x(t), y(t)], t, a, b)
  if (args.length < 4) fail('lineintegral: podaj pole, krzywą parametryczną [x(t), y(t)] oraz przedział [a, b].');
  const hasVar = args.length === 5;
  const { comps: r, t } = curveParts(args[1], hasVar ? args[2] : undefined, 'lineintegral');
  if (r.length < 2 || r.length > 3) fail('lineintegral: krzywa parametryczna musi mieć 2 albo 3 składowe, np. [cos(t), sin(t)].');
  const a = scalar(hasVar ? args[3] : args[2], 'Początek przedziału');
  const b = scalar(hasVar ? args[4] : args[3], 'Koniec przedziału');
  const F = args[0].t === 'list' ? args[0].items.map(i => scalar(i, 'Pole'))
    : args[0].t === 'matrix' && (args[0].rows.length === 1 || args[0].rows[0]?.length === 1) ? args[0].rows.flat()
    : args[0].t === 'fn' ? funOf(args[0], r.length, 'lineintegral').outs
    : [scalar(args[0], 'Pole')];
  const coordVars = args[0].t === 'fn' && args[0].params.length === r.length ? args[0].params : ['x', 'y', 'z'].slice(0, r.length);
  const subCurve = (e: Expr) => {
    // substitute via temporary symbols so x(t) containing y doesn't collide
    const tmps = coordVars.map((_, i) => `\u0001c${i}`);
    let out = e;
    coordVars.forEach((v, i) => { out = subst(out, v, sym(tmps[i])); });
    tmps.forEach((tmp, i) => { out = subst(out, tmp, r[i]); });
    return tidy(out);
  };
  const dr = r.map(c => tidy(diff(c, t)));

  let integrandExpr: Expr;
  let kindTitle: string;
  if (F.length === 1) {
    // Scalar line integral ∫_C f ds
    const ds = tidy(sqrt(tidy(add(...dr.map(d => pow(d, num(2)))))));
    integrandExpr = tidy(mul(subCurve(F[0]), ds));
    kindTitle = 'Całka krzywoliniowa nieskierowana (I rodzaju) ∫_C f ds';
  } else {
    if (F.length !== r.length) fail(`lineintegral: wymiar pola (${F.length}) musi być równy wymiarowi krzywej (${r.length}).`);
    // Vector line integral ∫_C F · dr
    const Fsub = F.map(subCurve);
    integrandExpr = tidy(add(...Fsub.map((fi, i) => mul(fi, dr[i]))));
    kindTitle = 'Całka krzywoliniowa skierowana (II rodzaju) ∫_C F · dr';
  }

  const rows: [string, Value][] = [
    ['Funkcja podcałkowa po ' + t, ex(integrandExpr)],
  ];
  const d = definite(integrandExpr, t, a, b);
  if (d.exact) {
    const v = tidy(d.exact);
    rows.push(['Wartość całki', ex(v)]);
    return { cards: [card(kindTitle, rows, `Dokładnie dla ${t} ∈ ⟨${toText(a)}; ${toText(b)}⟩${d.numeric ? ` (≈ ${fmt(d.numeric.value)})` : ''}.`)], outputs: [ex(v)] };
  }
  if (d.numeric && Number.isFinite(d.numeric.value)) {
    const v = approxNum(d.numeric.value);
    rows.push(['Wartość całki', v]);
    return { cards: [card(kindTitle, rows, `Numerycznie dla ${t} ∈ ⟨${toText(a)}; ${toText(b)}⟩ (błąd ≈ ${tiny(d.numeric.error)}).`)], outputs: [v] };
  }
  return fail('lineintegral: nie udało się obliczyć całki krzywoliniowej.');
}

function wronskianCmd(args: Value[], nout: number): Linalg {
  const fs = args[0].t === 'list' ? args[0].items.map(i => scalar(i, 'wronskian'))
    : args[0].t === 'matrix' && (args[0].rows.length === 1 || args[0].rows[0]?.length === 1) ? args[0].rows.flat()
    : [scalar(args[0], 'wronskian')];
  if (!fs.length) fail('wronskian: podaj listę funkcji, np. wronskian([sin(x), cos(x)]).');
  let x = 'x';
  if (args[1]) {
    const v = scalar(args[1], 'Zmienna');
    if (v.k !== 's') return fail('wronskian: drugi argument musi być nazwą zmiennej.');
    x = v.n;
  } else {
    const vs = [...new Set(fs.flatMap(f => variables(f)))];
    if (vs.length === 1) x = vs[0];
    else if (vs.includes('x')) x = 'x';
    else if (vs.includes('t')) x = 't';
    else if (vs.length) x = vs[0];
  }
  const n = fs.length;
  const W: Expr[][] = [fs.map(tidy)];
  for (let i = 1; i < n; i++) W.push(W[i - 1].map(f => tidy(diff(f, x))));
  const detW = tidy(det(W));
  const indep = !zeroTest(detW);
  const Wval: Value = { t: 'matrix', rows: W };
  const rows: [string, Value][] = [
    ['Wrońskian W(' + x + ') = det M', ex(detW)],
    ['Macierz Wrońskiego M', Wval],
  ];
  const note = indep
    ? `W(${x}) ≠ 0 — układ funkcji [${fs.map(toText).join('; ')}] jest liniowo niezależny.`
    : `W(${x}) ≡ 0 — wrońskian znika tożsamościowo (funkcje są liniowo zależne na każdym przedziale, na którym są analityczne).`;
  return { cards: [card('Wrońskian', rows, note)], outputs: nout >= 2 ? [ex(detW), Wval] : [ex(detW)] };
}
