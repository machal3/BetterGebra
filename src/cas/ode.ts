/**
 * Numerical solutions of ODEs as MATLAB's ode45 (Dormand–Prince 5(4)), ode23 (Bogacki–Shampine 3(2)) and ode15s (here
 * the Rosenbrock method of MATLAB's ode23s, for stiff equations). The equation comes as @(t, y) …, as y' = … or as
 * y'' = … (turned into a first-order system). Every solution is computed twice, the second time with tolerances a
 * hundred times tighter, and only the digits of y(t_end) the two agree on are given.
 */
import { Expr, div, expand, freeOf, isConstant, mul, neg, num, sub, sym, variables } from './expr';
import { Env, Value, approxValue, component, evaluate, ex, shadow, scalar } from './evaluate';
import { grid, valueOf } from './arrays';
import * as D from './dense';
import { compileDouble } from './fast';
import { Card, Linalg, tiny } from './linalg';
import { approx } from './numeric';
import type { Node } from './parse';
import { dataPlot, fmt } from './plot';
import { fail, qFromDouble } from './q';
import { diff } from './calculus';

export type Rhs = (t: number, y: number[]) => number[];
export interface Trajectory { t: number[]; y: number[][]; f: number[][]; failure?: 'steps' | 'small' | 'nan' }

// --- Integrators ---

const rms = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0) / Math.max(1, v.length));
const scaled = (e: number[], y: number[], yn: number[], rtol: number, atol: number) => rms(e.map((v, i) => v / (atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yn[i])))));
/** A first step of the right size (Hairer, Nørsett & Wanner). */
function firstStep(f: Rhs, t0: number, y0: number[], f0: number[], dir: number, span: number, order: number, rtol: number, atol: number): number {
  const sc = y0.map(v => atol + rtol * Math.abs(v)), d0 = rms(y0.map((v, i) => v / sc[i])), d1 = rms(f0.map((v, i) => v / sc[i]));
  const h0 = d0 < 1e-5 || d1 < 1e-5 ? 1e-6 : 0.01 * d0 / d1;
  const f1 = f(t0 + dir * h0, y0.map((v, i) => v + dir * h0 * f0[i]));
  const d2 = rms(f1.map((v, i) => (v - f0[i]) / sc[i])) / h0;
  const h1 = Math.max(d1, d2) <= 1e-15 ? Math.max(1e-6, h0 * 1e-3) : (0.01 / Math.max(d1, d2)) ** (1 / (order + 1));
  return Math.min(100 * h0, h1, span);
}

interface Tableau { c: number[]; a: number[][]; b: number[]; e: number[]; order: number }
const DP: Tableau = {
  c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
  a: [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]],
  b: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
  e: [35 / 384 - 5179 / 57600, 0, 500 / 1113 - 7571 / 16695, 125 / 192 - 393 / 640, -2187 / 6784 + 92097 / 339200, 11 / 84 - 187 / 2100, -1 / 40],
  order: 4,
};
const BS: Tableau = {
  c: [0, 1 / 2, 3 / 4, 1],
  a: [[], [1 / 2], [0, 3 / 4], [2 / 9, 1 / 3, 4 / 9]],
  b: [2 / 9, 1 / 3, 4 / 9, 0],
  e: [2 / 9 - 7 / 24, 1 / 3 - 1 / 4, 4 / 9 - 1 / 3, -1 / 8],
  order: 2,
};

/** An explicit embedded Runge–Kutta pair with step control (its last stage is the next step's first). */
function explicitRK(T: Tableau, f: Rhs, t0: number, tf: number, y0: number[], rtol: number, atol: number, maxSteps: number): Trajectory {
  const dir = Math.sign(tf - t0) || 1, s = T.c.length;
  let t = t0, y = y0.slice(), k0 = f(t, y);
  const out: Trajectory = { t: [t], y: [y], f: [k0] };
  let h = firstStep(f, t0, y0, k0, dir, Math.abs(tf - t0), T.order, rtol, atol), rejected = false;
  for (let step = 0; ; step++) {
    if (step > maxSteps) return { ...out, failure: 'steps' };
    if (Math.abs(tf - t) <= h) h = Math.abs(tf - t);
    const hs = h * dir, K = [k0];
    for (let i = 1; i < s; i++) K.push(f(t + T.c[i] * hs, y.map((v, j) => v + hs * T.a[i].reduce((acc, a, l) => acc + a * K[l][j], 0))));
    const yn = y.map((v, j) => v + hs * T.b.reduce((acc, b, l) => acc + b * K[l][j], 0));
    const err = y.map((_, j) => hs * T.e.reduce((acc, e, l) => acc + e * K[l][j], 0));
    const en = scaled(err, y, yn, rtol, atol);
    if (!Number.isFinite(en) || yn.some(v => !Number.isFinite(v))) {
      h /= 4;
      if (h < 16 * D.EPS * Math.max(1, Math.abs(t))) return { ...out, failure: 'nan' };
      continue;
    }
    if (en <= 1) {
      t = Math.abs(tf - (t + hs)) <= 1e-14 * Math.max(1, Math.abs(tf)) ? tf : t + hs;
      y = yn;
      k0 = T.c[s - 1] === 1 && T.b[s - 1] === 0 && T.a[s - 1].every((a, l) => a === T.b[l]) ? K[s - 1] : f(t, y);
      out.t.push(t); out.y.push(y); out.f.push(k0);
      if (t === tf) return out;
    }
    const factor = Math.min(rejected || en > 1 ? 1 : 5, Math.max(0.2, 0.9 * en ** (-1 / (T.order + 1))));
    rejected = en > 1;
    h *= factor;
    if (h < 16 * D.EPS * Math.max(1, Math.abs(t))) return { ...out, failure: 'small' };
  }
}

/** The Rosenbrock (2,3) pair of MATLAB's ode23s, with a numerical Jacobian: steps that stay stable on stiff equations. */
function rosenbrock(f: Rhs, t0: number, tf: number, y0: number[], rtol: number, atol: number, maxSteps: number): Trajectory {
  const n = y0.length, dir = Math.sign(tf - t0) || 1, d = 1 / (2 + Math.SQRT2), e32 = 6 + Math.SQRT2;
  let t = t0, y = y0.slice(), F0 = f(t, y);
  const out: Trajectory = { t: [t], y: [y], f: [F0] };
  let h = firstStep(f, t0, y0, F0, dir, Math.abs(tf - t0), 2, rtol, atol);
  for (let step = 0; ; step++) {
    if (step > maxSteps) return { ...out, failure: 'steps' };
    if (Math.abs(tf - t) <= h) h = Math.abs(tf - t);
    const hs = h * dir;
    const J = D.zeros(n, n);
    for (let k = 0; k < n; k++) {
      const dk = 1e-8 * Math.max(1, Math.abs(y[k])), q = y.slice(); q[k] += dk;
      f(t, q).forEach((v, i) => { J[i][k] = (v - F0[i]) / dk; });
    }
    const dt = 1e-8 * Math.max(1, Math.abs(t)), T = f(t + dt, y).map((v, i) => (v - F0[i]) / dt);
    const W = J.map((r, i) => r.map((v, j) => (i === j ? 1 : 0) - hs * d * v));
    const solveW = (b: number[]) => D.solve(W, b.map(v => [v]))?.map(r => r[0]) ?? null;
    const k1 = solveW(F0.map((v, i) => v + hs * d * T[i]));
    const F1 = k1 && f(t + 0.5 * hs, y.map((v, i) => v + 0.5 * hs * k1[i]));
    const k2p = k1 && F1 && solveW(F1.map((v, i) => v - k1[i]));
    const k2 = k2p && k1 ? k2p.map((v, i) => v + k1[i]) : null;
    const yn = k2 ? y.map((v, i) => v + hs * k2[i]) : null;
    const F2 = yn && f(t + hs, yn);
    const k3 = F2 && k1 && k2 && F1 && solveW(F2.map((v, i) => v - e32 * (k2[i] - F1[i]) - 2 * (k1[i] - F0[i]) + hs * d * T[i]));
    const en = k3 && yn && k1 && k2 ? scaled(k1.map((v, i) => hs / 6 * (v - 2 * k2[i] + k3[i])), y, yn, rtol, atol) : NaN;
    if (!Number.isFinite(en)) { h /= 4; if (h < 16 * D.EPS * Math.max(1, Math.abs(t))) return { ...out, failure: 'nan' }; continue; }
    if (en <= 1) {
      t = Math.abs(tf - (t + hs)) <= 1e-14 * Math.max(1, Math.abs(tf)) ? tf : t + hs;
      y = yn!; F0 = F2!;
      out.t.push(t); out.y.push(y); out.f.push(F0);
      if (t === tf) return out;
    }
    h *= Math.min(5, Math.max(0.2, 0.9 * en ** (-1 / 3)));
    if (h < 16 * D.EPS * Math.max(1, Math.abs(t))) return { ...out, failure: 'small' };
  }
}

export type Method = 'ode45' | 'ode23' | 'ode15s';
export function integrateOde(method: Method, f: Rhs, t0: number, tf: number, y0: number[], rtol: number, atol: number, maxSteps = 60_000): Trajectory {
  if (method === 'ode15s') return rosenbrock(f, t0, tf, y0, rtol, atol, maxSteps);
  return explicitRK(method === 'ode45' ? DP : BS, f, t0, tf, y0, rtol, atol, maxSteps);
}
/** The solution at time s, by cubic Hermite interpolation between the steps. */
export function at(tr: Trajectory, s: number): number[] {
  const { t, y, f } = tr, up = t[t.length - 1] >= t[0];
  let k = 0;
  while (k < t.length - 2 && (up ? s > t[k + 1] : s < t[k + 1])) k++;
  const h = t[k + 1] - t[k];
  if (!h) return y[k].slice();
  const u = (s - t[k]) / h, h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
  return y[k].map((v, i) => h00 * v + h10 * h * f[k][i] + h01 * y[k + 1][i] + h11 * h * f[k + 1][i]);
}

// --- The equation, from what was typed ---

/** The letters of a piece of input. */
function letters(n: Node, out: string[] = []): string[] {
  if (n.t === 'id') out.push(n.n);
  else if (n.t === 'op') { letters(n.a, out); letters(n.b, out); }
  else if (n.t === 'neg' || n.t === 'post') letters(n.a, out);
  else if (n.t === 'call' || n.t === 'index') n.args.forEach(a => letters(a, out));
  else if (n.t === 'list' || n.t === 'rel') (n.t === 'list' ? n.items : n.parts).forEach(a => letters(a, out));
  return out;
}
/** y, y′ … y⁽ᵏ⁾ as symbols: y, y', y''. */
export const derivative = (y: string, k: number) => `${y}${"'".repeat(k)}`;
/** The primes of y′′ written in a node, and the letter they are on. */
function primes(n: Node): { y: string; k: number } | null {
  let k = 0, m: Node = n;
  while (m.t === 'post' && m.o === "'") { k++; m = m.a; }
  return k && m.t === 'id' && m.n.length === 1 ? { y: m.n, k } : null;
}
/** The node with y′, y′′ … turned into letters of their own; the function's name and highest order. */
function withDerivatives(n: Node, found: { y?: string; k: number }): Node {
  const p = primes(n);
  if (p) {
    if (found.y && found.y !== p.y) fail(`Równanie ma pochodne dwóch funkcji: ${found.y} i ${p.y}.`);
    found.y = p.y; found.k = Math.max(found.k, p.k);
    return { t: 'id', n: derivative(p.y, p.k) };
  }
  switch (n.t) {
    case 'op': return { ...n, a: withDerivatives(n.a, found), b: withDerivatives(n.b, found) };
    case 'neg': case 'post': return { ...n, a: withDerivatives(n.a, found) } as Node;
    case 'call': case 'index': return { ...n, args: n.args.map(a => withDerivatives(a, found)) } as Node;
    case 'list': return { ...n, items: n.items.map(a => withDerivatives(a, found)) };
    case 'rel': return { ...n, parts: n.parts.map(a => withDerivatives(a, found)) };
    default: return n;
  }
}
export interface Equation { y: string; t: string; order: number; F: Expr }
/** y′′ + y = 0 as F(t, y, y′, y′′) = 0, or null when no derivative is written. */
export function readEquation(node: Node, env: Env): Equation | null {
  const found: { y?: string; k: number } = { k: 0 };
  const m = withDerivatives(node, found);
  if (!found.y) return null;
  const y = found.y, names = [...letters(node), ...Array.from({ length: found.k + 1 }, (_, k) => derivative(y, k))];
  const v = evaluate(m, shadow(env, names));
  let F: Expr;
  if (v.t === 'rel') {
    if (v.ops.length !== 1 || v.ops[0] !== '=') fail('Równanie różniczkowe zapisz ze znakiem =, np. y\' = -2*y.');
    F = sub(v.parts[0], v.parts[1]);
  } else F = scalar(v, 'Równanie');
  const others = variables(F).filter(s => s !== y && !new RegExp(`^${y}'+$`).test(s));
  const t = others.includes('t') ? 't' : others.includes('x') ? 'x' : 't';
  const extra = others.filter(s => s !== t);
  if (extra.length) fail(`Równanie ma litery ${extra.join(', ')} bez wartości; nadaj im wartości albo zapisz je liczbami.`);
  return { y, t, order: found.k, F };
}
/** y⁽ᵏ⁾ = R(t, y, …, y⁽ᵏ⁻¹⁾), when F is linear in the highest derivative. */
export function highest(eq: Equation): Expr {
  const Yk = derivative(eq.y, eq.order), a = diff(eq.F, Yk), rest = expand(sub(eq.F, mul(a, sym(Yk))));
  if (!freeOf(a, Yk) || !freeOf(rest, Yk)) fail(`Nie umiem wyznaczyć ${Yk} z tego równania.`);
  if (isConstant(a) && approx(a).re === 0 && approx(a).im === 0) fail(`W równaniu brakuje ${Yk}.`);
  return div(neg(rest), a);
}

// --- The commands ---

const dbl = (x: number) => num(qFromDouble(x));
/** b with the decimals it shares with a (an absolute agreement: y′(π) ≈ 0 is 0 to 11 places, not a doubtful 1e−13). */
function shared(a: number, b: number): string {
  const places = Math.max(0, Math.min(15, Math.floor(-Math.log10(Math.max(Math.abs(a - b), 1e-300)))));
  const sig = Math.abs(b) >= 1 ? Math.floor(Math.log10(Math.abs(b))) + 1 + places : places;
  const text = sig > 16 ? String(Number(b.toPrecision(15))) : b.toFixed(places);
  return text.replace('-', '−').replace('.', ',');
}

/** ode45(f, [t0 tf], y0) and its siblings; args as typed, so that y' = … can be read before evaluating. */
export function odeCommand(method: Method, args: Node[], env: Env, nout: number): Linalg {
  if (args.length < 3) fail(`${method}(f, [t0 tf], y0): potrzebne równanie, przedział czasu i warunek początkowy.`);
  const tspan = grid(evaluate(args[1], env), 'Przedział czasu').flat().map(e => approx(e).re);
  const y0 = grid(evaluate(args[2], env), 'Warunek początkowy').flat().map(e => approx(e).re);
  if (tspan.length < 2 || tspan.some(v => !Number.isFinite(v))) fail(`${method}: przedział czasu to [t0 tf] liczb.`);
  if (y0.some(v => !Number.isFinite(v))) fail(`${method}: warunek początkowy to liczby.`);
  let f: Rhs, labels: string[], tName = 't';
  const eq = readEquation(args[0], env);
  if (eq) {
    // y′′ = R(t, y, y′): the system Y = (y, y′, …), Y′ = (y′, …, R)
    const R = highest(eq), names = Array.from({ length: eq.order }, (_, k) => derivative(eq.y, k));
    if (y0.length !== eq.order) fail(`Równanie rzędu ${eq.order} potrzebuje ${eq.order} ${eq.order === 1 ? 'warunku' : 'warunków'} początkowych: [${names.map(n => `${n}(t0)`).join(', ')}].`);
    const params: Record<string, number> = Object.fromEntries([eq.t, ...names].map(n => [n, 0]));
    const g = compileDouble(R, '\u0000', params);
    f = (t, Y) => { params[eq.t] = t; names.forEach((n, k) => { params[n] = Y[k]; }); return [...Y.slice(1), g(0)]; };
    labels = names.map(n => `${n}(${eq.t})`);
    tName = eq.t;
  } else {
    // @(t, y) …, y a number or a vector (y(1), y(2) …); or an expression in t and y
    const v = evaluate(args[0], shadow(env, letters(args[0])));
    const n = y0.length;
    let vars: string[], outs: Expr[];
    const outsOf = (b: Value): Expr[] => b.t === 'expr' ? [b.e] : b.t === 'list' ? b.items.map(i => scalar(i, method)) : b.t === 'matrix' ? b.rows.flat() : fail(`${method}: f ma dawać liczbę albo wektor.`);
    if (v.t === 'fn') {
      if (v.params.length !== 2) fail(`${method}: funkcja ma mieć dwa parametry, @(t, y) …`);
      const [tp, yp] = v.params;
      outs = outsOf(v.body);
      const vector = outs.some(e => variables(e).some(s => s.startsWith(`${yp}_`)));
      if (!vector && n > 1) fail(`${method}: warunek początkowy ma ${n} składowe, a funkcja nie używa ${yp}(1), ${yp}(2) …`);
      vars = [tp, ...(vector ? Array.from({ length: n }, (_, k) => component(yp, k + 1)) : [yp])];
      tName = tp;
    } else {
      outs = outsOf(v);
      vars = ['t', 'y'];
      if (n > 1) fail(`${method}: dla układu zapisz @(t, y) [… ; …] z y(1), y(2) …`);
    }
    if (outs.length !== n) fail(`${method}: f daje ${outs.length} ${outs.length === 1 ? 'wartość' : 'wartości'}, a warunek początkowy ma ${n}.`);
    const params: Record<string, number> = Object.fromEntries(vars.map(x => [x, 0]));
    const gs = outs.map(e => compileDouble(e, '\u0000', params));
    f = (t, Y) => { params[vars[0]] = t; Y.forEach((v, k) => { params[vars[k + 1]] = v; }); return gs.map(g => g(0)); };
    labels = n === 1 ? ['y(t)'] : Array.from({ length: n }, (_, k) => `y${k + 1}(t)`);
  }

  const [t0, tf] = [tspan[0], tspan[tspan.length - 1]];
  const tol = method === 'ode15s' ? [1e-6, 1e-8] : [1e-8, 1e-10];
  let used: Method = method, switched = false;
  let A = integrateOde(used, f, t0, tf, y0, tol[0], tol[1]);
  if (A.failure === 'steps' && method !== 'ode15s') {
    // too many small steps: a stiff equation; the stiff solver takes over
    used = 'ode15s'; switched = true;
    A = integrateOde(used, f, t0, tf, y0, 1e-6, 1e-8);
  }
  if (A.failure) fail(A.failure === 'steps' ? `${used}: za dużo kroków; równanie wygląda na bardzo sztywne.` : `${used}: rozwiązanie nie istnieje dalej niż do t ≈ ${fmt(A.t[A.t.length - 1])} (ucieka do nieskończoności albo traci sens).`);
  const tighter = used === 'ode15s' ? [tol[0] / 100, tol[1] / 100].map(v => Math.max(v, 1e-10)) : [1e-10, 1e-12];
  const B = integrateOde(used, f, t0, tf, y0, tighter[0], tighter[1], 200_000);
  if (B.failure) fail(`${used}: drugie obliczenie (dokładniejsze) się nie powiodło, więc wyniku nie podaję.`);
  const ya = A.y[A.y.length - 1], yb = B.y[B.y.length - 1];
  // the two runs agree to within a thousandth of each component's size along the way, or nothing is shown
  const sizes = yb.map((_, i) => Math.max(...B.y.map(Y => Math.abs(Y[i])), 1e-300));
  if (yb.some((v, i) => Math.abs(ya[i] - v) > 1e-3 * sizes[i])) fail(`${used}: dwa obliczenia z różnymi tolerancjami dają różne wyniki; rozwiązanie jest numerycznie niepewne.`);

  // the curve: from the finer run, every step (or evenly when there are many)
  const n = yb.length, N = Math.min(B.t.length, 400);
  const ts = Array.from({ length: N }, (_, k) => (N === B.t.length ? B.t[k] : t0 + (tf - t0) * k / (N - 1)));
  const Ys = ts.map((s, k) => (N === B.t.length ? B.y[k] : at(B, s)));
  const plot = dataPlot(Array.from({ length: n }, (_, i) => ({ xs: ts, ys: Ys.map(Y => Y[i]), label: labels[i], style: 'line' as const })));
  const end: [string, Value][] = yb.map((v, i) => [labels[i].replace(`(${tName})`, `(${fmt(tf)})`), approxValue(ex(dbl(v)))]);
  const precise = yb.map((v, i) => `${labels[i].replace(`(${tName})`, `(${fmt(tf)})`)} ≈ ${shared(ya[i], v)}`).join('; ');
  const cards: Card[] = [{
    title: `Rozwiązanie numeryczne (${used})`,
    rows: end,
    note: `${switched ? `${method} potrzebował zbyt wielu kroków (równanie sztywne), więc liczy ${used}. ` : ''}${precise} — te cyfry zgadzają się w dwóch obliczeniach z tolerancjami ${tiny(tol[0])} i ${tiny(tighter[0])}; ${B.t.length - 1} kroków.`,
    plot: plot ?? undefined,
  }];
  if (n === 2) {
    // a system of two: its path in the plane, with the direction field when it doesn't depend on t
    const phase = dataPlot([{ xs: Ys.map(Y => Y[0]), ys: Ys.map(Y => Y[1]), label: 'trajektoria', style: 'line' }]);
    if (phase) {
      const autonomous = [[0.3, 0.7], [-1.1, 2.2]].every(([a, b]) => f(t0, [a, b]).every((v, i) => Math.abs(v - f(t0 + 1.7, [a, b])[i]) <= 1e-12 * (1 + Math.abs(v))));
      if (autonomous) {
        const [x0, x1] = phase.x, [z0, z1] = phase.y, m = 13;
        for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
          const p = [x0 + (x1 - x0) * (i + 0.5) / m, z0 + (z1 - z0) * (j + 0.5) / m], d = f(t0, p), len = Math.hypot(d[0], d[1]);
          if (!len || !Number.isFinite(len)) continue;
          const s = 0.4 * Math.min((x1 - x0), (z1 - z0)) / m / len;
          phase.vectors.push({ x1: p[0] - d[0] * s, y1: p[1] - d[1] * s, x2: p[0] + d[0] * s, y2: p[1] + d[1] * s, label: '', color: 1, dash: false });
        }
      }
      cards.push({ title: 'Portret fazowy', rows: [], note: autonomous ? 'Strzałki: pole kierunków (y₁′, y₂′).' : undefined, plot: phase });
    }
  }
  // [t, y] = ode45(…): the times and the values (at most 200 rows); at the times asked for when tspan has more of them
  const outT = tspan.length > 2 ? tspan : Array.from({ length: Math.min(200, N) }, (_, k) => (Math.min(200, N) === 1 ? t0 : t0 + (tf - t0) * k / (Math.min(200, N) - 1)));
  const outY = outT.map(s => at(B, s));
  const tv = approxValue({ t: 'matrix', rows: outT.map(s => [dbl(s)]) }), yv = approxValue({ t: 'matrix', rows: outY.map(Y => Y.map(dbl)) });
  const final = approxValue(n === 1 ? ex(dbl(yb[0])) : valueOf([yb.map(dbl)]));
  return { cards, outputs: nout >= 2 ? [tv, yv] : [final] };
}
