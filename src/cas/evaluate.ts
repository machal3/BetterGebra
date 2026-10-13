/**
 * Syntax tree → values: expressions, lists, matrices and relations. Commands nested inside expressions
 * (diff(x³; x) + 1) are run through the hook the engine installs.
 */
import { E, Expr, I, INF, ONE, PI, TWO, add, div, fn, isNum, mul, neg, num, pow, sqrt, sub, sym, variables } from './expr';
import { diff } from './calculus';
import { COMMANDS, FUNCTIONS, Node } from './parse';
import { fail, parseDecimal } from './q';

export type Value =
  | { t: 'expr'; e: Expr }
  | { t: 'list'; items: Value[]; set: boolean }
  | { t: 'matrix'; rows: Expr[][] }
  | { t: 'rel'; ops: string[]; parts: Expr[] };

export const ex = (e: Expr): Value => ({ t: 'expr', e });

export interface Env {
  ans: Expr | null;
  /** Runs a command found inside an expression; returns its value. */
  command: (name: string, args: Node[], env: Env) => Value;
}

export function evaluate(n: Node, env: Env): Value {
  switch (n.t) {
    case 'num': return ex(num(parseDecimal(n.v)));
    case 'id': return ex(identifier(n.n, env));
    case 'neg': return arith('neg', evaluate(n.a, env));
    case 'op': return arith(n.o, evaluate(n.a, env), evaluate(n.b, env));
    case 'post': {
      const a = scalar(evaluate(n.a, env), n.o === '!' ? 'Silnia' : n.o === '°' ? 'Stopnie' : 'Pochodna');
      if (n.o === '!') return ex(fn('factorial', a));
      if (n.o === '°') return ex(mul(a, div(PI, num(180))));
      const vs = variables(a);
      if (vs.length > 1) fail(`Pochodna z ′ jest niejednoznaczna: zmienne ${vs.join(', ')}. Użyj diff(f; x).`);
      return ex(vs.length ? diff(a, vs[0]) : num(0));
    }
    case 'call': {
      if (Object.hasOwn(FUNCTIONS, n.n)) {
        const args = n.args.map(a => scalar(evaluate(a, env), n.n));
        return ex(fn(n.n, ...args));
      }
      if (Object.hasOwn(COMMANDS, n.n)) return env.command(n.n, n.args, env);
      return fail(`Nie znam funkcji ${n.n}.`);
    }
    case 'list': {
      const items = n.items.map(i => evaluate(i, env));
      // [[1, 2], [3, 4]]: a list of equally long lists of scalars is a matrix
      if (n.bracket === '[' && items.length && items.every(i => i.t === 'list' && !i.set && i.items.length && i.items.every(v => v.t === 'expr'))) {
        const rows = items.map(i => (i as { items: Value[] }).items.map(v => (v as { e: Expr }).e));
        if (rows.every(r => r.length === rows[0].length)) return { t: 'matrix', rows };
        fail('Wiersze macierzy muszą mieć tyle samo elementów.');
      }
      return { t: 'list', items, set: n.bracket === '{' };
    }
    case 'rel': {
      const parts = n.parts.map(p => scalar(evaluate(p, env), 'Równanie'));
      return { t: 'rel', ops: n.ops, parts };
    }
  }
}

function identifier(n: string, env: Env): Expr {
  switch (n) {
    case 'pi': return PI;
    case 'e': return E;
    case 'i': return I;
    case 'inf': return INF;
    case 'tau': return mul(TWO, PI);
    case 'phi': return mul(num(1, 2), add(ONE, sqrt(num(5))));
    case 'ans':
      if (!env.ans) fail('ans to poprzedni wynik, a jeszcze żadnego nie ma.');
      return env.ans!;
  }
  return sym(n);
}

export function scalar(v: Value, what: string): Expr {
  if (v.t === 'expr') return v.e;
  if (v.t === 'matrix' && v.rows.length === 1 && v.rows[0].length === 1) return v.rows[0][0];
  return fail(`${what}: oczekuję wyrażenia, a nie ${v.t === 'list' ? 'listy' : v.t === 'matrix' ? 'macierzy' : 'równania'}.`);
}

// --- Arithmetic on values (scalars, matrices, lists elementwise) ---

type Op = '+' | '-' | '*' | '/' | '^' | 'neg';

export function arith(op: Op, a: Value, b?: Value): Value {
  if (op === 'neg') return mapValue(a, neg);
  if (a.t === 'rel' || b!.t === 'rel') return fail('Na równaniach nie wykonuję działań. Zapisz je osobno.');
  if (a.t === 'expr' && b!.t === 'expr') return ex(scalarOp(op, a.e, b!.e));
  if (a.t === 'matrix' || b!.t === 'matrix') return matrixOp(op, a, b!);
  // lists: elementwise, or a scalar with each element
  if (a.t === 'list' && b!.t === 'list') {
    if (a.items.length !== b!.items.length) fail('Listy mają różne długości.');
    return { t: 'list', items: a.items.map((x, k) => arith(op, x, (b as { items: Value[] }).items[k])), set: false };
  }
  if (a.t === 'list') return { t: 'list', items: a.items.map(x => arith(op, x, b!)), set: false };
  if (b!.t === 'list') return { t: 'list', items: b!.items.map(y => arith(op, a, y)), set: false };
  return fail('Nieobsługiwane działanie.');
}
function scalarOp(op: Exclude<Op, 'neg'>, a: Expr, b: Expr): Expr {
  switch (op) {
    case '+': return add(a, b);
    case '-': return sub(a, b);
    case '*': return mul(a, b);
    case '/': return div(a, b);
    case '^': return pow(a, b);
  }
}
function mapValue(v: Value, f: (e: Expr) => Expr): Value {
  switch (v.t) {
    case 'expr': return ex(f(v.e));
    case 'list': return { ...v, items: v.items.map(i => mapValue(i, f)) };
    case 'matrix': return { t: 'matrix', rows: v.rows.map(r => r.map(f)) };
    case 'rel': return fail('Na równaniach nie wykonuję działań.');
  }
}

// --- Matrices ---

export const dims = (m: Expr[][]): [number, number] => [m.length, m[0]?.length ?? 0];
export function matMul(a: Expr[][], b: Expr[][]): Expr[][] {
  const [n, k] = dims(a), [k2, m] = dims(b);
  if (k !== k2) fail(`Nie da się pomnożyć macierzy ${n}×${k} przez ${k2}×${m}.`);
  return Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => add(...Array.from({ length: k }, (_, l) => mul(a[i][l], b[l][j])))));
}
export const identityM = (n: number): Expr[][] => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? ONE : num(0))));

let inverseHook: (m: Expr[][]) => Expr[][] = () => fail('Odwracanie macierzy niedostępne.');
export function setInverse(f: typeof inverseHook) { inverseHook = f; }

function matrixOp(op: Exclude<Op, 'neg'>, a: Value, b: Value): Value {
  const isM = (v: Value): v is { t: 'matrix'; rows: Expr[][] } => v.t === 'matrix';
  const vec = (v: Value): Expr[][] | null => v.t === 'list' && v.items.every(i => i.t === 'expr') ? v.items.map(i => [(i as { e: Expr }).e]) : null;
  if (op === '+' || op === '-') {
    if (isM(a) && isM(b)) {
      const [n, m] = dims(a.rows);
      const [n2, m2] = dims(b.rows);
      if (n !== n2 || m !== m2) fail(`Nie da się dodać macierzy ${n}×${m} i ${n2}×${m2}.`);
      return { t: 'matrix', rows: a.rows.map((r, i) => r.map((x, j) => op === '+' ? add(x, b.rows[i][j]) : sub(x, b.rows[i][j]))) };
    }
    return fail('Do macierzy można dodać tylko macierz tego samego wymiaru.');
  }
  if (op === '*') {
    if (isM(a) && isM(b)) return { t: 'matrix', rows: matMul(a.rows, b.rows) };
    if (isM(a) && b.t === 'expr') return { t: 'matrix', rows: a.rows.map(r => r.map(x => mul(x, b.e))) };
    if (a.t === 'expr' && isM(b)) return { t: 'matrix', rows: b.rows.map(r => r.map(x => mul(a.e, x))) };
    // matrix · vector given as a list
    if (isM(a) && vec(b)) return { t: 'list', items: matMul(a.rows, vec(b)!).map(r => ex(r[0])), set: false };
    return fail('Tych obiektów nie da się pomnożyć.');
  }
  if (op === '/') {
    if (isM(a) && b.t === 'expr') return { t: 'matrix', rows: a.rows.map(r => r.map(x => div(x, b.e))) };
    if (isM(b)) return matrixOp('*', a, { t: 'matrix', rows: inverseHook(b.rows) });
    return fail('Tego dzielenia nie wykonam.');
  }
  // power: integer exponents of square matrices
  if (isM(a) && b.t === 'expr') {
    const [n, m] = dims(a.rows);
    if (n !== m) fail('Potęgować można tylko macierze kwadratowe.');
    if (!isNum(b.e) || b.e.v.d !== 1n) fail('Wykładnik potęgi macierzy musi być liczbą całkowitą.');
    let k = (b.e as { v: { n: bigint } }).v.n;
    let base = a.rows;
    if (k < 0n) { base = inverseHook(base); k = -k; }
    if (k > 100000n) fail('Za duży wykładnik.');
    let out = identityM(n);
    while (k) { if (k & 1n) out = matMul(out, base); k >>= 1n; if (k) base = matMul(base, base); }
    return { t: 'matrix', rows: out };
  }
  return fail('Tego działania na macierzach nie wykonam.');
}

