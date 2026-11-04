/**
 * Exact solutions of ODEs, as the Symbolic Toolbox's dsolve, for the classes that can be solved reliably: linear with
 * constant coefficients of any order (the right side by variation of parameters), Cauchy–Euler, first-order linear,
 * separable and Bernoulli equations. Every general solution is substituted back into the equation and dropped if it
 * does not satisfy it; initial conditions then fix the constants. Where none of this applies, the card says so and
 * points to ode45.
 */
import { E, Expr, ONE, ZERO, add, div, expand, fn, freeOf, isConstant, isNum, mapChildren, mul, neg, num, numDen, pow, sub, subst, sym, together, variables } from './expr';
import { Env, Value, evaluate, ex, shadow } from './evaluate';
import { diff } from './calculus';
import { compileDouble } from './fast';
import { complexParts, constSign } from './functions';
import { integrate } from './integrate';
import { Card, Linalg } from './linalg';
import * as LA from './matrix';
import { approx } from './numeric';
import type { Node } from './parse';
import { plotOf } from './plot';
import { coeffsOf, solvePoly } from './poly';
import { Q, Q0, fail, q, qadd, qmul } from './q';
import { cancel, simplify, zeroTest } from './simplify';
import { solveEquation } from './solve';
import { Equation, derivative, readEquation } from './ode';
import { toText } from './format';
import { ilaplaceOf, laplaceOf } from './transforms';

const tidy = (e: Expr) => { try { return simplify(e); } catch { return e; } };
const CONSTANTS = ['C₁', 'C₂', 'C₃', 'C₄', 'C₅', 'C₆'];
const has = (e: Expr, names: string[]) => variables(e).some(v => names.includes(v));
/** ln|t| as ln t: any μ with μ′/μ = p is an integrating factor, and on each interval the sign is fixed (the result is checked). */
const dropAbs = (e: Expr): Expr => (e.k === 'f' && e.n === 'abs' ? dropAbs(e.a[0]) : mapChildren(e, dropAbs));

/** Each y⁽ʲ⁾ in F replaced by the j-th derivative of u(t). */
function substitute(eq: Equation, u: Expr): Expr {
  let F = eq.F, d = u;
  for (let j = 0; j <= eq.order; j++) { F = subst(F, derivative(eq.y, j), d); d = diff(d, eq.t); }
  return F;
}
/** u satisfies the equation: F(t, u, u′, …) vanishes at sample points (with sample values of the constants). */
function satisfies(eq: Equation, u: Expr): boolean {
  let R: Expr;
  try { R = substitute(eq, u); } catch { return false; }
  const consts = variables(R).filter(v => CONSTANTS.includes(v));
  let good = 0;
  for (const [k, t] of [0.37, 1.23, 2.71, 0.81, 1.9, 3.3, 0.53].entries()) {
    const params: Record<string, number> = Object.fromEntries(consts.map((c, i) => [c, 0.7 + 0.37 * i + 0.11 * k]));
    const r = compileDouble(R, eq.t, params)(t), scale = Math.abs(compileDouble(eq.F, '\u0000', {})(0)) || 1;
    if (!Number.isFinite(r)) continue;
    if (Math.abs(r) > 1e-7 * Math.max(1, scale)) {
      // doubles lose to cancellation in long expressions: decide at high precision
      const z = approx(consts.reduce((e, c) => subst(e, c, num(Math.round(params[c] * 100), 100)), subst(R, eq.t, num(Math.round(t * 100), 100))));
      if (Math.hypot(z.re, z.im) > 1e-20) return false;
    }
    good++;
  }
  return good >= 3;
}

// --- Linear equations: coefficients a_j(t) and the right side g(t) ---

interface Linear { a: Expr[]; g: Expr }
function linear(eq: Equation): Linear | null {
  const Ys = Array.from({ length: eq.order + 1 }, (_, j) => derivative(eq.y, j));
  const a = Ys.map(Y => tidy(diff(eq.F, Y)));
  if (a.some(c => has(c, Ys))) return null;
  const rest = expand(sub(eq.F, add(...a.map((c, j) => mul(c, sym(Ys[j]))))));
  if (has(rest, Ys)) return null;
  return { a, g: tidy(neg(rest)) };
}
/** The roots of a polynomial with rational coefficients (lowest first), with multiplicities; null when one has no closed form. */
function roots(c: Q[]): { r: Expr; m: number }[] | null {
  const rs = solvePoly(c);
  if (rs.some(r => !r.exact)) return null;
  return rs.map(r => ({ r: tidy(r.exact!), m: r.mult }));
}
/** Real fundamental solutions from the roots: e^(rt) t^i, or e^(αt) t^i cos βt and sin βt for α ± βi (ln t for Euler). */
function fundamental(rs: { r: Expr; m: number }[], t: Expr, euler: boolean): Expr[] {
  const out: Expr[] = [];
  const grow = (alpha: Expr) => (euler ? pow(t, alpha) : pow(E, mul(alpha, t)));
  const inner = euler ? fn('ln', t) : t;
  for (const { r, m } of rs) {
    const [alpha, beta] = complexParts(r) ?? [r, ZERO];
    const sb = constSign(beta);
    if (sb !== null && sb < 0) continue; // the conjugate's pair is made from the other root
    for (let i = 0; i < m; i++) {
      const pw = i ? pow(inner, num(i)) : ONE;
      if (!sb) out.push(tidy(mul(pw, grow(alpha))));
      else { out.push(tidy(mul(pw, grow(alpha), fn('cos', mul(beta, inner))))); out.push(tidy(mul(pw, grow(alpha), fn('sin', mul(beta, inner))))); }
    }
  }
  return out;
}
/** A particular solution by variation of parameters: W(t)·u′ = (0, …, 0, g/aₙ), u = ∫u′. */
function particular(phi: Expr[], g: Expr, an: Expr, t: string): Expr | null {
  const n = phi.length;
  const W: Expr[][] = [];
  let row = phi.slice();
  for (let i = 0; i < n; i++) { W.push(row.map(tidy)); row = row.map(e => diff(e, t)); }
  let du: Expr[][];
  try { du = LA.leftSolve(W, Array.from({ length: n }, (_, i) => [i === n - 1 ? div(g, an) : ZERO])); } catch { return null; }
  const parts: Expr[] = [];
  for (let k = 0; k < n; k++) {
    const u = integrate(tidy(du[k][0]), t);
    if (!u) return null;
    parts.push(mul(u, phi[k]));
  }
  return tidy(add(...parts));
}

/** The general solution with its constants C₁ …, and how it was found; null for an equation of no known class. */
function general(eq: Equation): { y: Expr; method: string; implicit?: Expr } | null {
  const t = sym(eq.t), n = eq.order, L = linear(eq);
  if (L) {
    const { a, g } = L, an = a[n], C = CONSTANTS.slice(0, n).map(c => sym(c));
    const constant = a.every(c => freeOf(c, eq.t) && isConstant(c));
    const euler = !constant && a.every((c, j) => { const r = tidy(div(c, pow(t, num(j)))); return freeOf(r, eq.t) && isConstant(r); });
    if (constant || euler) {
      const cs = (euler ? a.map((c, j) => tidy(div(c, pow(t, num(j))))) : a);
      if (cs.every(isNum)) {
        // characteristic polynomial Σ aⱼ rʲ, or the indicial Σ cⱼ r(r − 1)…(r − j + 1) of Euler's equation
        let P: Q[] = [Q0];
        cs.forEach((c, j) => {
          let term: Q[] = [(c as { v: Q }).v];
          if (euler) for (let i = 0; i < j; i++) term = mulP(term, [q(-i), q(1)]);
          else term = [...Array(j).fill(Q0), (c as { v: Q }).v];
          P = addP(P, term);
        });
        const rs = roots(P);
        if (rs) {
          const phi = fundamental(rs, t, euler);
          if (phi.length === n) {
            let y: Expr = add(...phi.map((f, k) => mul(C[k], f)));
            if (constSign(g) !== 0 || !isConstant(g)) {
              const yp = particular(phi, g, an, eq.t);
              if (!yp) return null;
              y = add(yp, y);
            }
            return { y: tidy(y), method: euler ? 'równanie Eulera (Cauchy’ego–Eulera)' : n === 1 ? 'równanie liniowe o stałych współczynnikach' : `równanie liniowe rzędu ${n} o stałych współczynnikach` };
          }
        }
      }
    }
    if (n === 1) {
      // y′ + p y = q: the integrating factor e^∫p
      const p = tidy(div(a[0], a[1])), qq = tidy(div(g, a[1]));
      const P = integrate(p, eq.t);
      if (!P) return null;
      const mu = tidy(pow(E, dropAbs(P)));
      const Iq = constSign(qq) === 0 ? ZERO : integrate(tidy(mul(mu, qq)), eq.t);
      if (Iq === null) return null;
      return { y: tidy(div(add(Iq, sym(CONSTANTS[0])), mu)), method: 'równanie liniowe pierwszego rzędu (czynnik całkujący)' };
    }
    return null;
  }
  if (n !== 1) return null;
  // first order, not linear: y′ = R(t, y)
  const Y1 = derivative(eq.y, 1), a1 = diff(eq.F, Y1), rest = expand(sub(eq.F, mul(a1, sym(Y1))));
  if (!freeOf(a1, Y1) || !freeOf(rest, Y1)) return null;
  const R = tidy(div(neg(rest), a1)), y = eq.y;
  // separable: R(t, y) = g(t)·h(y) exactly when R(t, y)·R(t₀, y₀) = R(t, y₀)·R(t₀, y)
  const points: [Expr, Expr][] = [[num(1, 3), num(2, 7)], [num(3, 5), num(5, 3)], [num(7, 4), num(4, 9)]];
  const at = (tv: Expr, yv: Expr) => subst(subst(R, eq.t, tv), y, yv);
  const base = points.find(([tv, yv]) => { const z = approx(at(tv, yv)); return Number.isFinite(z.re) && Math.abs(z.re) > 1e-9 && Math.abs(z.im) < 1e-12; });
  if (base) {
    const [t0, y0] = base, R00 = at(t0, y0);
    const lhs = mul(R, R00), rhs = mul(subst(R, y, y0), subst(R, eq.t, t0));
    if (sameFunction(lhs, rhs, [eq.t, y])) {
      const h = tidy(subst(R, eq.t, t0)), gt = tidy(div(subst(R, y, y0), R00));
      const H = integrate(tidy(div(ONE, h)), y), G = integrate(gt, eq.t);
      if (H && G) {
        const implicit = tidy(sub(sub(H, G), sym(CONSTANTS[0])));
        // explicit solutions, those the equation accepts
        const explicit: Expr[] = [];
        try {
          const sols = solveEquation(implicit, y);
          if (sols.kind === 'list') for (const s of sols.sols) if (s.exact && !s.family && satisfies(eq, s.exact)) explicit.push(tidy(s.exact));
        } catch { /* implicit only */ }
        if (explicit.length === 1) return { y: explicit[0], method: 'równanie o zmiennych rozdzielonych', implicit };
        return { y: explicit[0] ?? ZERO, method: 'równanie o zmiennych rozdzielonych', implicit };
      }
    }
  }
  // Bernoulli: y′ = P(t) y + Q(t) yⁿ, through v = y^(1 − n)
  const c = coeffsOf(expand(R), y);
  if (c) {
    const terms = c.map((e, k) => [k, e] as const).filter(([, e]) => constSign(e) !== 0 || !isConstant(e));
    if (terms.length === 2 && terms[0][0] === 1 && terms[1][0] >= 2) {
      const [, P] = terms[0], [nn, Qt] = terms[1], k = 1 - nn;
      // v′ − k P v = k Q
      const p = tidy(neg(mul(num(k), P))), qq = tidy(mul(num(k), Qt));
      const Pi = integrate(p, eq.t);
      if (Pi) {
        const mu = tidy(pow(E, dropAbs(Pi))), Iq = integrate(tidy(mul(mu, qq)), eq.t);
        if (Iq) {
          const v = tidy(div(add(Iq, sym(CONSTANTS[0])), mu));
          return { y: tidy(pow(v, num(1, k))), method: `równanie Bernoulliego (podstawienie v = y^${k})` };
        }
      }
    }
  }
  // Exact ODE: M(t, y) + N(t, y) y′ = 0 with ∂M/∂y = ∂N/∂t (or with integrating factor μ(t) / μ(y))
  const exactSol = tryExactOde(eq, rest, a1, R);
  if (exactSol) return exactSol;
  // Homogeneous first-order ODE: y′ = f(y/t) via y = u·t
  const homSol = tryHomogeneousOde(eq, R);
  if (homSol) return homSol;
  return null;
}

type Solution = { y: Expr; method: string; implicit?: Expr };

function solveImplicit(eq: Equation, U: Expr, method: string): Solution {
  const implicit = tidy(sub(U, sym(CONSTANTS[0])));
  const explicit: Expr[] = [];
  try {
    const sols = solveEquation(implicit, eq.y);
    if (sols.kind === 'list') for (const s of sols.sols) if (s.exact && !s.family && satisfies(eq, s.exact)) explicit.push(tidy(s.exact));
  } catch { /* implicit only */ }
  return { y: explicit[0] ?? ZERO, method, implicit };
}

function potential2D(M: Expr, N: Expr, t: string, y: string): Expr | null {
  const dMy = tidy(diff(M, y)), dNt = tidy(diff(N, t));
  if (!sameFunction(dMy, dNt, [t, y])) return null;
  const U1 = integrate(M, t);
  if (!U1) return null;
  const rem = tidy(sub(N, diff(U1, y)));
  if (!freeOf(rem, t)) return null;
  const U2 = constSign(rem) === 0 ? ZERO : integrate(rem, y);
  if (U2 === null) return null;
  const U = tidy(add(U1, U2));
  if (!sameFunction(diff(U, t), M, [t, y]) || !sameFunction(diff(U, y), N, [t, y])) return null;
  return U;
}

function tryExactOde(eq: Equation, M0: Expr, N0: Expr, R: Expr): Solution | null {
  const { t, y } = eq;
  const [rNum, rDen] = numDen(together(R));
  const pairs: [Expr, Expr][] = [[tidy(M0), tidy(N0)], [tidy(neg(rNum)), tidy(rDen)]];
  for (const [M, N] of pairs) {
    if (constSign(N) === 0) continue;
    const U = potential2D(M, N, t, y);
    if (U) return solveImplicit(eq, U, 'równanie różniczkowe zupełne (∂M/∂y = ∂N/∂t)');
    const diffMN = tidy(sub(diff(M, y), diff(N, t)));
    // Integrating factor μ(t): (∂M/∂y − ∂N/∂t) / N depends only on t
    const pt = tidy(cancel(together(div(diffMN, N))));
    if (freeOf(pt, y)) {
      const P = integrate(pt, t);
      if (P) {
        const mu = tidy(pow(E, dropAbs(P)));
        const Umu = potential2D(tidy(mul(mu, M)), tidy(mul(mu, N)), t, y);
        if (Umu) return solveImplicit(eq, Umu, `równanie sprowadzalne do zupełnego (czynnik całkujący μ(${t}) = ${toText(mu)})`);
      }
    }
    // Integrating factor μ(y): (∂N/∂t − ∂M/∂y) / M depends only on y
    if (constSign(M) !== 0) {
      const qy = tidy(cancel(together(div(neg(diffMN), M))));
      if (freeOf(qy, t)) {
        const Qy = integrate(qy, y);
        if (Qy) {
          const mu = tidy(pow(E, dropAbs(Qy)));
          const Umu = potential2D(tidy(mul(mu, M)), tidy(mul(mu, N)), t, y);
          if (Umu) return solveImplicit(eq, Umu, `równanie sprowadzalne do zupełnego (czynnik całkujący μ(${y}) = ${toText(mu)})`);
        }
      }
    }
  }
  return null;
}

function tryHomogeneousOde(eq: Equation, R: Expr): Solution | null {
  const { t, y } = eq, u = '\u0001u';
  const fu = tidy(cancel(together(subst(R, y, mul(sym(u), sym(t))))));
  if (!freeOf(fu, t)) return null;
  const denom = tidy(sub(fu, sym(u)));
  if (constSign(denom) === 0) return { y: mul(sym(CONSTANTS[0]), sym(t)), method: 'równanie jednorodne y′ = y/t' };
  const Hu = integrate(tidy(div(ONE, denom)), u);
  if (!Hu) return null;
  const U = tidy(sub(subst(Hu, u, div(sym(y), sym(t))), fn('ln', sym(t))));
  return solveImplicit(eq, U, `równanie jednorodne y′ = f(${y}/${t}) (podstawienie u = ${y}/${t})`);
}
const sameFunction = (a: Expr, b: Expr, vars: string[]) => {
  for (const [s, base] of [0.41, 1.37, 2.13, 0.77].entries()) {
    const params = Object.fromEntries(vars.map((v, k) => [v, base + 0.29 * k * (s % 2 ? -1 : 1)]));
    const A = compileDouble(a, '\u0000', params)(0), B = compileDouble(b, '\u0000', params)(0);
    if (!Number.isFinite(A) || !Number.isFinite(B)) continue;
    if (Math.abs(A - B) > 1e-9 * Math.max(1, Math.abs(A))) return false;
  }
  return true;
};
const addP = (a: Q[], b: Q[]) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => qadd(a[i] ?? Q0, b[i] ?? Q0));
function mulP(a: Q[], b: Q[]): Q[] {
  const out: Q[] = Array(a.length + b.length - 1).fill(Q0);
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] = qadd(out[i + j], qmul(x, y)); }));
  return out;
}


// --- Initial conditions ---

interface Condition { order: number; t0: Expr; value: Expr }
/** y(0) = 1, y'(0) = 0 as typed (y(0) reads as y·(0) where y has no value). */
export function conditionOf(n: Node, y: string, env: Env): Condition {
  const bad = () => fail(`Warunek początkowy zapisz jak ${y}(0) = 1 albo ${y}'(0) = 0.`);
  if (n.t !== 'rel' || n.ops.length !== 1 || n.ops[0] !== '=') return bad();
  const [l, r] = n.parts;
  let base: Node, point: Node;
  if (l.t === 'op' && l.o === '*') [base, point] = [l.a, l.b];
  else if (l.t === 'index' && l.args.length === 1) [base, point] = [{ t: 'id', n: l.n }, l.args[0]];
  else return bad();
  let k = 0;
  while (base.t === 'post' && base.o === "'") { k++; base = base.a; }
  if (base.t !== 'id' || base.n !== y) return bad();
  const val = (m: Node): Expr => { const v = evaluate(m, env); if (v.t !== 'expr' || !isConstant(v.e)) fail('W warunku początkowym oczekuję liczb.'); return (v as { e: Expr }).e; };
  return { order: k, t0: val(point), value: val(r) };
}
/** The constants fixed by the conditions: a linear system when y is linear in them, else one equation. */
function fix(y: Expr, conds: Condition[], t: string): Expr | null {
  const C = CONSTANTS.filter(c => variables(y).includes(c));
  if (conds.length !== C.length) fail(`Rozwiązanie ma ${C.length} ${C.length === 1 ? 'stałą' : 'stałe'}, więc potrzeba ${C.length} ${C.length === 1 ? 'warunku' : 'warunków'} początkowych (podano ${conds.length}).`);
  const eqs = conds.map(c => { let d = y; for (let i = 0; i < c.order; i++) d = diff(d, t); return tidy(sub(subst(d, t, c.t0), c.value)); });
  const coef = eqs.map(e => C.map(c => tidy(diff(e, c))));
  if (coef.every(r => r.every(e => !has(e, C)))) {
    const rhs = eqs.map((e, i) => [tidy(neg(sub(e, add(...coef[i].map((k, j) => mul(k, sym(C[j]))))))) ]);
    let sol: Expr[][];
    try { sol = LA.leftSolve(coef, rhs); } catch { return null; }
    return tidy(C.reduce((acc, c, j) => subst(acc, c, sol[j][0]), y));
  }
  if (C.length === 1) {
    const s = solveEquation(eqs[0], C[0]);
    if (s.kind === 'list') for (const x of s.sols) if (x.exact && !x.family) return tidy(subst(y, C[0], x.exact));
  }
  return null;
}

// --- The command ---

function tryLinearSystem(args: Node[], env: Env): Linalg | null {
  // Check if at least 2 arguments are first-order ODEs in distinct dependent variables (e.g. x' = ..., y' = ...)
  const odeNodes: Node[] = [];
  const condNodes: Node[] = [];
  const depVars: string[] = [];
  for (const a of args) {
    if (a.t !== 'rel' || a.ops.length !== 1 || a.ops[0] !== '=') return null;
    const [l] = a.parts;
    if (l.t === 'post' && l.o === "'" && l.a.t === 'id') {
      odeNodes.push(a);
      depVars.push(l.a.n);
    } else {
      condNodes.push(a);
    }
  }
  const n = odeNodes.length;
  if (n < 2 || n > 3 || new Set(depVars).size !== n) return null;
  const sEnv = shadow(env, [...depVars, 't']);
  const rhsExprs = odeNodes.map(node => {
    const r = (node as { parts: Node[] }).parts[1];
    const v = evaluate(r, sEnv);
    return v.t === 'expr' ? v.e : null;
  });
  if (rhsExprs.some(e => !e)) return null;
  const rhs = rhsExprs as Expr[];
  const allVars = [...new Set(rhs.flatMap(e => variables(e)))].filter(v => !depVars.includes(v));
  if (allVars.length > 1) return null;
  const t = allVars[0] ?? 't';
  const S = sym('s');

  // Extract constant matrix A and forcing vector f(t): rhs_i = Σ_j A_{ij} x_j + f_i(t)
  const A: Expr[][] = [];
  const forcing: Expr[] = [];
  for (let i = 0; i < n; i++) {
    let rem = rhs[i];
    const row: Expr[] = [];
    for (let j = 0; j < n; j++) {
      const aij = tidy(diff(rem, depVars[j]));
      if (variables(aij).some(v => depVars.includes(v) || v === t)) return null;
      row.push(aij);
      rem = tidy(sub(rem, mul(aij, sym(depVars[j]))));
    }
    if (variables(rem).some(v => depVars.includes(v))) return null;
    A.push(row);
    forcing.push(rem);
  }

  // Compute (sI − A)⁻¹ and inverse Laplace transform to get Φ(t) = e^(At)
  const sImA = A.map((row, i) => row.map((aij, j) => (i === j ? sub(S, aij) : neg(aij))));
  let resolvent: Expr[][];
  try { resolvent = LA.inverse(sImA); } catch { return null; }

  const Phi: Expr[][] = [];
  for (let i = 0; i < n; i++) {
    const row: Expr[] = [];
    for (let j = 0; j < n; j++) {
      const phi_ij = ilaplaceOf(resolvent[i][j], 's', t);
      if (!phi_ij) return null;
      row.push(phi_ij);
    }
    Phi.push(row);
  }

  // Particular solution via Laplace transform of forcing F(s)
  const Fs: Expr[] = [];
  for (let i = 0; i < n; i++) {
    if (zeroTest(forcing[i])) { Fs.push(ZERO); continue; }
    const Lf = laplaceOf(forcing[i], t, 's');
    if (!Lf) return null;
    Fs.push(Lf);
  }
  const yp: Expr[] = [];
  for (let i = 0; i < n; i++) {
    const sumS = tidy(add(...resolvent[i].map((rij, j) => mul(rij, Fs[j]))));
    const ypi = zeroTest(sumS) ? ZERO : ilaplaceOf(sumS, 's', t);
    if (!ypi) return null;
    yp.push(ypi);
  }

  const Csyms = depVars.map((_, i) => sym(CONSTANTS[i]));
  const genSol = Phi.map((row, i) => tidy(add(yp[i], ...row.map((phi_ij, j) => mul(phi_ij, Csyms[j])))));

  // Verify general solution by substituting into X'(t) = A X(t) + f(t)
  for (let i = 0; i < n; i++) {
    const lhs = diff(genSol[i], t);
    let rhsCheck = rhs[i];
    for (let j = 0; j < n; j++) rhsCheck = subst(rhsCheck, depVars[j], genSol[j]);
    if (!sameFunction(lhs, rhsCheck, [t, ...CONSTANTS.slice(0, n)])) return null;
  }

  const rowsGen: [string, Value][] = depVars.map((v, i) => [`${v}(${t})`, ex(genSol[i])]);
  const cards: Card[] = [{
    title: 'Rozwiązanie ogólne układu równań różniczkowych',
    rows: rowsGen,
    note: `Układ liniowy o stałych współczynnikach (macierz fundamentalna e^(A·${t})). ${CONSTANTS.slice(0, n).join(', ')} — dowolne stałe; sprawdzone przez podstawienie.`,
  }];
  let outputs: Value[] = genSol.map(ex);

  if (condNodes.length) {
    if (condNodes.length !== n) fail(`dsolve: układ ${n} równań wymaga ${n} warunków początkowych.`);
    const conds = depVars.map(v => {
      const node = condNodes.find(cn => {
        const l = (cn as { parts: Node[] }).parts[0];
        return (l.t === 'op' && l.o === '*' && l.a.t === 'id' && l.a.n === v) || (l.t === 'index' && l.n === v);
      });
      if (!node) return fail(`dsolve: brakuje warunku początkowego dla funkcji ${v}(t₀).`);
      return conditionOf(node, v, env);
    });
    const eqs = conds.map((c, i) => tidy(sub(subst(genSol[i], t, c.t0), c.value)));
    const coef = eqs.map(e => CONSTANTS.slice(0, n).map(c => tidy(diff(e, c))));
    const rhsC = eqs.map((e, i) => [tidy(neg(sub(e, add(...coef[i].map((k, j) => mul(k, sym(CONSTANTS[j])))))))]);
    const solC = LA.leftSolve(coef, rhsC);
    const partSol = genSol.map(g => tidy(CONSTANTS.slice(0, n).reduce((acc, c, j) => subst(acc, c, solC[j][0]), g)));
    const t0 = approx(conds[0].t0).re;
    const plot = partSol.every(p => variables(p).every(v => v === t))
      ? plotOf(partSol, t, { range: [t0 - 1, t0 + 6], labels: depVars.map((v, i) => `${v}(${t}) = ${toText(partSol[i])}`) })
      : null;
    cards.push({
      title: 'Rozwiązanie szczególne układu',
      rows: depVars.map((v, i) => [`${v}(${t})`, ex(partSol[i])]),
      note: `${conds.map((c, i) => `${depVars[i]}(${toText(c.t0)}) = ${toText(c.value)}`).join(', ')}; sprawdzone.`,
      plot: plot ?? undefined,
    });
    outputs = partSol.map(ex);
  }
  return { cards, outputs };
}

export function dsolveCommand(args: Node[], env: Env): Linalg {
  const flatArgs = args.length === 1 && args[0].t === 'list' ? args[0].items : args;
  if (flatArgs.length >= 2) {
    const sys = tryLinearSystem(flatArgs, env);
    if (sys) return sys;
  }
  const eq = readEquation(args[0], env);
  if (!eq) fail("dsolve: zapisz równanie z pochodną, np. dsolve(y' = -2*y) albo dsolve(y'' + y = 0, y(0) = 1, y'(0) = 0).");
  const e = eq!;
  const g = general(e);
  if (!g) fail(`dsolve: tego równania nie umiem rozwiązać dokładnie. Rozwiązanie numeryczne da ode45, np. ode45(${toText(e.F).length < 60 ? `${toText(e.F)} = 0` : 'równanie'}, [0 5], …).`);
  const cards: Card[] = [];
  const name = `${e.y}(${e.t})`;
  const verified = g!.y && (g!.y !== ZERO || !g!.implicit) && satisfies(e, g!.y);
  if (!verified && !g!.implicit) fail('dsolve: znalezione rozwiązanie nie przeszło sprawdzenia, więc go nie podaję.');
  const consts = CONSTANTS.filter(c => variables(g!.implicit ?? g!.y).includes(c));
  const note = `${g!.method[0].toUpperCase()}${g!.method.slice(1)}. ${consts.length ? `${consts.join(', ')} — dowolne stałe. ` : ''}${verified ? 'Sprawdzone przez podstawienie do równania.' : 'Postać uwikłana (rozwiązania nie da się tu wyznaczyć jawnie); wynika z rozdzielenia zmiennych.'}`;
  const rows: [string, Value][] = verified ? [[name, ex(g!.y)]] : [];
  if (g!.implicit && !verified) rows.push(['0', ex(g!.implicit)]);
  cards.push({ title: 'Rozwiązanie ogólne', rows, note });
  let value: Value = ex(verified ? g!.y : g!.implicit!);
  const conds = args.slice(1).map(a => conditionOf(a, e.y, env));
  if (conds.length) {
    if (!verified) fail('dsolve: warunki początkowe stosuję tylko do rozwiązania w postaci jawnej.');
    const y = fix(g!.y, conds, e.t);
    if (!y || !satisfies(e, y)) fail('dsolve: nie umiem dobrać stałych do tych warunków.');
    const t0 = approx(conds[0].t0).re;
    const plot = variables(y!).length === 1 ? plotOf([y!], e.t, { range: [t0 - 1, t0 + 6], labels: [`${name} = ${toText(y!)}`] }) : null;
    cards.push({ title: 'Rozwiązanie z warunkami początkowymi', rows: [[name, ex(y!)]], note: `${conds.map(c => `${derivative(e.y, c.order)}(${toText(c.t0)}) = ${toText(c.value)}`).join(', ')}; sprawdzone.`, plot: plot ?? undefined });
    value = ex(y!);
  }
  return { cards, outputs: [value] };
}
