/**
 * MATLAB's numerical analysis: fzero (Brent, then the exact root or certain digits where the engine can give them),
 * fminbnd (Brent's golden section with parabolas, then the exact critical point when there is one), fminsearch
 * (Nelder–Mead as MATLAB's, restarted once), fsolve (Levenberg–Marquardt on the residuals) and integral2 (exact by
 * iterated antiderivatives when they exist, else nested Gauss–Kronrod). Each result is checked before it is shown.
 */
import { Expr, isConstant, num, sub, subst, sym, variables } from './expr';
import { Value, approxValue, component, ex, scalar } from './evaluate';
import { grid, valueOf } from './arrays';
import { diff } from './calculus';
import * as D from './dense';
import { compileDouble } from './fast';
import { definite, integrate, quad } from './integrate';
import { Card, Linalg, tiny } from './linalg';
import { approx } from './numeric';
import { fmt } from './plot';
import { fail, qFromDouble } from './q';
import { simplify } from './simplify';
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
};
/** integral(f, a, b): the integrand and its variable, for the engine's own definite integral. */
export function integrand(v: Value): { e: Expr; x: string } {
  const f = funOf(v, 1, 'integral');
  if (f.outs.length !== 1) fail('integral: funkcja ma dawać jedną liczbę.');
  return { e: f.outs[0], x: f.vars[0] };
}
