/**
 * Syntax tree → values: expressions, lists, matrices, relations and functions (@(x) …, f(x) = …). Commands nested
 * inside expressions (diff(x³; x) + 1) are run through the hook the engine installs; variables come from the
 * workspace the engine hands over. MATLAB's notation reads as MATLAB means it: a:h:b, A(2, :), A', A .* B, A\b.
 */
import { E, Expr, HALF, I, INF, MINUS_ONE, ONE, PI, TWO, add, div, fn, infSign, isConstant, isInt, isNum, mul, neg, num, pow, sqrt, sub, subst, sym, variables } from './expr';
import * as D from './dense';
import { diff } from './calculus';
import { complexParts, constSign } from './functions';
import { approx } from './numeric';
import { COMMANDS, FUNCTIONS, Node } from './parse';
import { fail, parseDecimal, qFromDouble, qToNumber, qdiv, qfloor, qsub } from './q';

/**
 * approx: numbers computed in floating point (svd of a 5×5 matrix, double(A)), as MATLAB's doubles. Their entries are
 * the doubles' exact values; what is computed from them is rounded to doubles again and stays approximate.
 */
export type Value =
  | { t: 'expr'; e: Expr; approx?: true }
  /** logical: the 0 and 1 of a comparison (v > 2); as an index it picks the places of its 1s */
  | { t: 'list'; items: Value[]; set: boolean; logical?: boolean; approx?: true }
  | { t: 'matrix'; rows: Expr[][]; logical?: boolean; approx?: true }
  | { t: 'rel'; ops: string[]; parts: Expr[] }
  /** @(x, y) body, f(x) = body: the body is an expression, or a list or matrix of them */
  | { t: 'fn'; params: string[]; body: Value }
  /** 'spline', 'fro': an option of a command */
  | { t: 'str'; s: string };
export type FnValue = Extract<Value, { t: 'fn' }>;

export const ex = (e: Expr): Value => ({ t: 'expr', e });
const listOf = (es: Expr[]): Value => ({ t: 'list', items: es.map(ex), set: false });
/** Rows as a value: one row is a list (a row vector, like [1 2 3]); more, a matrix. */
export const fromRows = (rows: Expr[][]): Value => rows.length === 1 ? listOf(rows[0]) : { t: 'matrix', rows };

/**
 * What the input asks of its variables that building it may simplify away: x/x is 1 and (√x)² is x, yet x = 0
 * and x < 0 stay outside. Each is kept as it was written (a 1/u, √u, ln u …), unsimplified; the engine clears the
 * list per question and keeps solutions, intervals and domains within them.
 */
export const hidden: Expr[] = [];
const note = (e: Expr) => { if (variables(e).length) hidden.push(e); };
/** Functions defined on part of the line, with the argument condition domain() reads off them. */
const PARTIAL: Record<string, (a: readonly Expr[]) => Expr> = {
  ln: a => ({ k: 'f', n: 'ln', a: [a[0]] }),
  log: a => ({ k: 'f', n: 'ln', a: [a[a.length - 1]] }),
  log10: a => ({ k: 'f', n: 'ln', a: [a[0]] }),
  log2: a => ({ k: 'f', n: 'ln', a: [a[0]] }),
  sqrt: a => ({ k: '^', b: a[0], e: HALF }),
  asin: a => ({ k: 'f', n: 'asin', a: [a[0]] }),
  acos: a => ({ k: 'f', n: 'acos', a: [a[0]] }),
  acosh: a => ({ k: 'f', n: 'acosh', a: [a[0]] }),
  atanh: a => ({ k: 'f', n: 'atanh', a: [a[0]] }),
};

/** The workspace as the evaluator reads it. */
export interface Vars { get(name: string): Value | undefined }

export interface Env {
  ans: Value | null;
  /** Runs a command found inside an expression; returns its value. */
  command: (name: string, args: Node[], env: Env) => Value;
  vars?: Vars;
  /** The length of the dimension an index is read in: what end means. */
  end?: number;
}

/** env without these names: the x of diff(f, x) and a function's parameters stay symbols. */
export function shadow(env: Env, names: readonly string[]): Env {
  const vars = env.vars;
  if (!vars || !names.length) return env;
  return { ...env, vars: { get: n => (names.includes(n) ? undefined : vars.get(n)) } };
}

export function evaluate(n: Node, env: Env): Value {
  switch (n.t) {
    case 'num': return ex(num(parseDecimal(n.v)));
    case 'id': return env.vars?.get(n.n) ?? identifier(n.n, env);
    case 'neg': return arith('neg', evaluate(n.a, env));
    case 'op': {
      const a = evaluate(n.a, env), b = evaluate(n.b, env);
      if (n.o === '.*' || n.o === './' || n.o === '.^') return elementwise(n.o, a, b);
      if (n.o === '\\') return leftDivide(a, b);
      return arith(n.o, a, b);
    }
    case 'post': {
      if (n.o === "'" || n.o === ".'") {
        const v = evaluate(n.a, env);
        if (v.t === 'list' || v.t === 'matrix') return transposed(v, n.o === "'");
        if (n.o === ".'") return v;
      }
      const a = scalar(evaluate(n.a, env), n.o === '!' ? 'Silnia' : n.o === '°' ? 'Stopnie' : 'Pochodna');
      if (n.o === '!') return ex(fn('factorial', a));
      if (n.o === '°') return ex(mul(a, div(PI, num(180))));
      const vs = variables(a);
      if (vs.length > 1) fail(`Pochodna z ′ jest niejednoznaczna: zmienne ${vs.join(', ')}. Użyj diff(f; x).`);
      return ex(vs.length ? diff(a, vs[0]) : num(0));
    }
    case 'call': {
      if (Object.hasOwn(FUNCTIONS, n.n)) {
        const vals = n.args.map(a => evaluate(a, env));
        if (vals.some(isApprox)) return approxValue(functionOf(n.n, vals.map(exactly)));
        return functionOf(n.n, vals);
      }
      if (Object.hasOwn(COMMANDS, n.n)) return env.command(n.n, n.args, env);
      return fail(`Nie znam funkcji ${n.n}.`);
    }
    case 'list': return listValue(n, env);
    case 'rel': {
      const vals = n.parts.map(p => evaluate(p, env));
      // v > 2 of a list or matrix: 1 where it holds, 0 where not, as in MATLAB
      if (vals.some(v => v.t === 'list' || v.t === 'matrix')) return compareEach(n.ops, vals);
      const parts = vals.map(v => scalar(v, 'Równanie'));
      return { t: 'rel', ops: n.ops, parts };
    }
    case 'range': return rangeValue(n, env);
    case 'index': {
      // a letter this input names without a value (x in x(2 + x) = 0): x(…) is a product, as always
      const v = env.vars?.get(n.n) ?? identifier(n.n, env);
      return indexValue(n.n, v, n.args, env);
    }
    case 'colon': return fail('Sam dwukropek działa tylko w indeksie, np. A(:, 1).');
    case 'end': return env.end !== undefined ? ex(num(env.end)) : fail('end działa tylko w nawiasie zmiennej, np. v(end).');
    case 'lambda': {
      const body = evaluate(n.body, shadow(env, n.params));
      if (body.t === 'fn' || body.t === 'rel' || body.t === 'str') fail('Wartość funkcji to wyrażenie, lista albo macierz.');
      return { t: 'fn', params: n.params, body };
    }
    case 'assign': case 'massign': return fail('Przypisanie zapisz na początku, np. a = 2; a + 1.');
    case 'str': return { t: 'str', s: n.v };
  }
}

/** sin(A), abs(v), max(v): a function of the input's elements. */
function functionOf(name: string, vals: Value[]): Value {
  // max(v): the largest element; of a matrix, the largest of each column, as in MATLAB
  if ((name === 'max' || name === 'min') && vals.length === 1 && (vals[0].t === 'list' || vals[0].t === 'matrix')) {
    const v = vals[0];
    if (v.t === 'list') return ex(fn(name, ...v.items.map(x => scalar(x, name))));
    if (v.rows.length === 1) return ex(fn(name, ...v.rows[0]));
    return listOf(transpose(v.rows).map(col => fn(name, ...col)));
  }
  return broadcast(vals, args => {
    if (Object.hasOwn(PARTIAL, name)) note(PARTIAL[name](args));
    return fn(name, ...args);
  }, name);
}

function identifier(n: string, env: Env): Value {
  switch (n) {
    case 'pi': return ex(PI);
    case 'e': return ex(E);
    case 'i': return ex(I);
    case 'inf': return ex(INF);
    case 'tau': return ex(mul(TWO, PI));
    case 'phi': return ex(mul(num(1, 2), add(ONE, sqrt(num(5)))));
    case 'ans':
      if (!env.ans) fail('ans to poprzedni wynik, a jeszcze żadnego nie ma.');
      return env.ans!;
  }
  return ex(sym(n));
}

export function scalar(v: Value, what: string): Expr {
  if (v.t === 'expr') return v.e;
  if (v.t === 'matrix' && v.rows.length === 1 && v.rows[0].length === 1) return v.rows[0][0];
  const kind = { list: 'listy', matrix: 'macierzy', rel: 'równania', fn: 'funkcji', str: 'napisu' }[v.t];
  return fail(`${what}: oczekuję wyrażenia, a nie ${kind}.`);
}

// --- Arithmetic on values (scalars, matrices, lists elementwise) ---

type Op = '+' | '-' | '*' | '/' | '^' | 'neg';

export function arith(op: Op, a: Value, b?: Value): Value {
  if (!isApprox(a) && !(b && isApprox(b))) return arithExact(op, a, b);
  // approximate matrices multiply, divide and take powers in floating point, as MATLAB does
  if (b && (a.t === 'matrix' || b.t === 'matrix')) { const r = denseOp(op, a, b); if (r) return r; }
  return approxValue(arithExact(op, exactly(a), b && exactly(b)));
}
function arithExact(op: Op, a: Value, b?: Value): Value {
  for (const v of b ? [a, b] : [a]) {
    if (v.t === 'fn') fail('Funkcję wywołaj z argumentem, np. f(2); działania wykonuję na jej wartościach.');
    if (v.t === 'str') fail(`Napis '${v.s}' to nazwa opcji polecenia, nie liczba.`);
  }
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
    case '/': note({ k: '^', b, e: MINUS_ONE }); return div(a, b);
    case '^':
      // x^(1/2), x^(−1): a root or a reciprocal, written as a power
      if (isNum(b) && (!isInt(b) || b.v.n < 0n)) note({ k: '^', b: a, e: b });
      return pow(a, b);
  }
}
function mapValue(v: Value, f: (e: Expr) => Expr): Value {
  switch (v.t) {
    case 'expr': return ex(f(v.e));
    case 'list': return { ...v, items: v.items.map(i => mapValue(i, f)) };
    case 'matrix': return { t: 'matrix', rows: v.rows.map(r => r.map(f)) };
    case 'fn': return { ...v, body: mapValue(v.body, f) };
    case 'rel': return fail('Na równaniach nie wykonuję działań.');
    case 'str': return fail('Na napisach nie wykonuję działań.');
  }
}

/** f applied to the elements of lists and matrices of one shape, numbers taken as they are. */
function broadcast(vals: Value[], f: (es: Expr[]) => Expr, what: string): Value {
  const shaped = vals.find(v => v.t === 'list' || v.t === 'matrix');
  if (!shaped) return ex(f(vals.map(v => scalar(v, what))));
  if (shaped.t === 'list') {
    return {
      t: 'list', set: false, items: shaped.items.map((_, k) => broadcast(vals.map(v => {
        if (v.t !== 'list') return v;
        if (v.items.length !== shaped.items.length) fail('Listy mają różne długości.');
        return v.items[k];
      }), f, what)),
    };
  }
  const [n, m] = dims(shaped.rows);
  return {
    t: 'matrix', rows: shaped.rows.map((row, i) => row.map((_, j) => f(vals.map(v => {
      if (v.t === 'matrix') {
        const [n2, m2] = dims(v.rows);
        if (n2 !== n || m2 !== m) fail(`Macierze ${n}×${m} i ${n2}×${m2} mają różne wymiary.`);
        return v.rows[i][j];
      }
      if (v.t === 'list') return fail('Lista i macierz razem: zapisz listę jako macierz albo wiersz macierzy.');
      return scalar(v, what);
    })))),
  };
}

/** A .* B, A ./ B, A .^ 2: element by element (for numbers and lists the same as *, /, ^). */
function elementwise(op: '.*' | './' | '.^', a: Value, b: Value): Value {
  if (isApprox(a) || isApprox(b)) return approxValue(elementwise(op, exactly(a), exactly(b)));
  const o = op === '.*' ? '*' : op === './' ? '/' : '^';
  if (a.t !== 'matrix' && b.t !== 'matrix') return arith(o, a, b);
  const asMatrix = (v: Value): Value => v.t === 'list' ? { t: 'matrix', rows: [v.items.map(i => scalar(i, 'Element'))] } : v;
  return broadcast([asMatrix(a), asMatrix(b)], ([x, y]) => scalarOp(o, x, y), 'Działanie');
}

const transpose = (m: Expr[][]): Expr[][] => (m[0] ?? []).map((_, j) => m.map(r => r[j]));
/** x̄ of an entry; variables are real, so only i changes sign. */
function conj(e: Expr): Expr {
  const p = complexParts(e);
  return p ? sub(p[0], mul(I, p[1])) : fn('conj', e);
}
/** A' (with conjugation, as in MATLAB) and A.' (without). */
function transposed(v: Extract<Value, { t: 'list' | 'matrix' }>, conjugate: boolean): Value {
  const rows = v.t === 'matrix' ? v.rows : [v.items.map(i => scalar(i, 'Transpozycja'))];
  const t = transpose(rows);
  const out = fromRows(conjugate ? t.map(r => r.map(conj)) : t);
  return isApprox(v) ? approxValue(out) : out;
}

const HOLDS: Record<string, (s: number) => boolean> = { '=': s => s === 0, '!=': s => s !== 0, '<': s => s < 0, '>': s => s > 0, '<=': s => s <= 0, '>=': s => s >= 0 };
function compareEach(ops: string[], vals: Value[]): Value {
  if (ops.length !== 1 || !Object.hasOwn(HOLDS, ops[0])) fail('Elementy porównuję jednym znakiem: v > 2, A == B, v != 0.');
  const holds = HOLDS[ops[0]];
  const v = broadcast(vals, ([a, b]) => {
    const s = constSign(sub(a, b));
    if (s === null) fail('Porównuję elementy, które są liczbami rzeczywistymi.');
    return holds(s!) ? ONE : num(0);
  }, 'Porównanie');
  return v.t === 'list' || v.t === 'matrix' ? { ...v, logical: true } : v;
}


// --- Approximate values (≈) ---

export const isApprox = (v: Value): boolean =>
  v.t === 'expr' || v.t === 'matrix' ? !!v.approx : v.t === 'list' ? !!v.approx || v.items.some(isApprox) : false;
/** The value with its approximate mark taken off (its entries are exact values of doubles already). */
function exactly(v: Value): Value {
  if (v.t === 'expr' || v.t === 'matrix') { const { approx: _, ...rest } = v; return rest as Value; }
  if (v.t === 'list') { const { approx: _, ...rest } = v; return { ...rest, items: v.items.map(exactly) }; }
  return v;
}
/** The double nearest to a real constant. */
export function toNumber(e: Expr, what = 'Liczba'): number {
  if (isNum(e)) return qToNumber(e.v);
  const s = infSign(e);
  if (s) return s * Infinity;
  if (!isConstant(e)) return fail(`${what}: numerycznie liczę liczby, nie wyrażenia z literami.`);
  const z = approx(e);
  if (Math.abs(z.im) > 1e-12 * (1 + Math.abs(z.re))) fail(`${what}: numerycznie liczę tu tylko liczby rzeczywiste.`);
  return z.re;
}
const fromDouble = (x: number): Expr => {
  if (Number.isNaN(x)) return fail('Wynik numeryczny jest nieokreślony (NaN).');
  return Number.isFinite(x) ? num(qFromDouble(x)) : x > 0 ? INF : neg(INF);
};
/** e rounded to doubles (both parts of a complex number), kept as the doubles' exact values. */
export function rounded(e: Expr): Expr {
  if (isNum(e)) return fromDouble(qToNumber(e.v));
  if (infSign(e)) return e;
  if (!isConstant(e)) return fail('Liczby przybliżone (≈) nie łączą się z literami; najpierw podstaw liczby.');
  const z = approx(e);
  const re = fromDouble(z.re);
  return Math.abs(z.im) > 1e-300 && Math.abs(z.im) > 1e-15 * Math.abs(z.re) ? add(re, mul(I, fromDouble(z.im))) : re;
}
/** Every number of the value rounded to a double and marked approximate. */
export function approxValue(v: Value): Value {
  switch (v.t) {
    case 'expr': return { t: 'expr', e: rounded(v.e), approx: true };
    case 'list': return { ...v, items: v.items.map(approxValue), approx: true };
    case 'matrix': return { ...v, rows: v.rows.map(r => r.map(rounded)), approx: true };
    default: return v;
  }
}
export const toMat = (rows: Expr[][], what = 'Macierz'): D.Mat => rows.map(r => r.map(e => toNumber(e, what)));
/** Doubles as an approximate value: one row a list, 1×1 a number. */
export function fromMat(M: D.Mat): Value {
  if (M.length === 1 && M[0].length === 1) return { t: 'expr', e: fromDouble(M[0][0]), approx: true };
  const v = fromRows(M.map(r => r.map(fromDouble)));
  return v.t === 'list' ? { ...v, items: v.items.map(i => ({ ...i, approx: true as const })), approx: true } : { ...v, approx: true } as Value;
}
const matOf = (v: Value, what: string): D.Mat =>
  v.t === 'matrix' ? toMat(v.rows, what) : v.t === 'list' ? [v.items.map(i => toNumber(scalar(i, what), what))] : [[toNumber(scalar(v, what), what)]];

/** A·B, A/B and A^k with an approximate matrix: in floating point. null for what goes element by element. */
function denseOp(op: Op, a: Value, b: Value): Value | null {
  if (op === '*' && a.t === 'matrix' && b.t === 'matrix') return fromMat(D.mul(matOf(a, 'Macierz'), matOf(b, 'Macierz')));
  if (op === '/' && b.t === 'matrix') {
    const Bi = D.inverse(matOf(b, 'Macierz'));
    if (!Bi) fail('Macierz jest (numerycznie) osobliwa, nie ma odwrotnej.');
    return a.t === 'expr' ? fromMat(Bi!.map(r => r.map(x => x * toNumber(a.e)))) : fromMat(D.mul(matOf(a, 'Macierz'), Bi!));
  }
  if (op === '^' && a.t === 'matrix' && b.t === 'expr') {
    if (!isInt(b.e)) fail('Wykładnik potęgi macierzy musi być liczbą całkowitą.');
    let k = (b.e as { v: { n: bigint } }).v.n, base = matOf(a, 'Macierz');
    if (base.length !== base[0].length) fail('Potęgować można tylko macierze kwadratowe.');
    if (k < 0n) { const inv = D.inverse(base); if (!inv) fail('Macierz jest (numerycznie) osobliwa, nie ma odwrotnej.'); base = inv!; k = -k; }
    if (k > 100000n) fail('Za duży wykładnik.');
    let out = D.eye(base.length);
    while (k) { if (k & 1n) out = D.mul(out, base); k >>= 1n; if (k) base = D.mul(base, base); }
    return fromMat(out);
  }
  return null;
}
/** A\b with approximate numbers: LU for a square A, least squares through QR for a tall one. */
function denseSolve(a: Value, b: Value): Value {
  const A = matOf(a, 'Macierz układu');
  const B = b.t === 'list' ? b.items.map(i => [toNumber(scalar(i, 'Prawa strona'))]) : b.t === 'matrix' ? toMat(b.rows, 'Prawa strona') : [[toNumber(scalar(b, 'Prawa strona'))]];
  const [n, m] = [A.length, A[0].length];
  if (B.length !== n) fail(`A\\b: A ma ${n} ${n === 1 ? 'wiersz' : 'wierszy'}, a b ${B.length}.`);
  if (n < m) fail('A\\b: równań jest mniej niż niewiadomych, więc rozwiązań jest nieskończenie wiele.');
  const X = n === m ? D.solve(A, B) : D.leastSquares(A, B);
  if (!X) fail(n === m ? 'A\\b: macierz jest (numerycznie) osobliwa.' : 'A\\b: kolumny A są (numerycznie) liniowo zależne.');
  return b.t === 'list' ? fromMat([X!.map(r => r[0])]) : fromMat(X!);
}

// --- Matrices written out: [1 2; 3 4], [A B; C D], [v w] ---

/** A value as a block of a matrix: a number is 1×1, a list a row. */
function block(v: Value): Expr[][] | null {
  if (v.t === 'expr') return [[v.e]];
  if (v.t === 'matrix') return v.rows;
  if (v.t === 'list' && !v.set && v.items.every(i => i.t === 'expr')) return v.items.length ? [v.items.map(i => (i as { e: Expr }).e)] : [];
  return null;
}
function beside(blocks: Expr[][][]): Expr[][] {
  const bs = blocks.filter(b => b.length);
  if (!bs.length) return [];
  const h = bs[0].length;
  if (bs.some(b => b.length !== h)) fail('Części łączone obok siebie muszą mieć tyle samo wierszy.');
  return Array.from({ length: h }, (_, r) => bs.flatMap(b => b[r]));
}
function below(blocks: Expr[][][]): Expr[][] {
  const bs = blocks.filter(b => b.length);
  if (bs.some(b => b[0].length !== bs[0][0].length)) fail('Części łączone jedna pod drugą muszą mieć tyle samo kolumn.');
  return bs.flat();
}

function listValue(n: Extract<Node, { t: 'list' }>, env: Env): Value {
  let ap = false;
  const out = listOfItems(n, c => { const v = evaluate(c, env); if (isApprox(v)) { ap = true; return exactly(v); } return v; });
  return ap ? approxValue(out) : out;
}
function listOfItems(n: Extract<Node, { t: 'list' }>, evaluate: (n: Node) => Value): Value {
  // rows written out: [[1, 2], [3, 4]], [1 2; 3 4], [A B; C D]; each row's elements as they are, not yet laid side by side
  if (n.bracket === '[' && n.items.length && n.items.every(i => i.t === 'list' && i.bracket === '[' && i.items.length)) {
    const rows = n.items.map(r => (r as Extract<Node, { t: 'list' }>).items.map(c => evaluate(c)));
    if (rows.every(r => r.every(v => v.t === 'expr'))) {
      const m = rows.map(r => r.map(v => (v as { e: Expr }).e));
      if (m.every(r => r.length === m[0].length)) return { t: 'matrix', rows: m };
      fail('Wiersze macierzy muszą mieć tyle samo elementów.');
    }
    const blocks = rows.map(r => r.map(block));
    if (blocks.every(r => r.every(b => b))) {
      const m = below(blocks.map(r => beside(r as Expr[][][])));
      return m.length ? fromRows(m) : { t: 'list', items: [], set: false };
    }
  }
  const items = n.items.map(i => evaluate(i));
  if (n.bracket === '[' && items.length) {
    // [A B], [v 4]: a matrix or a list computed (not written out) is laid in the row whole
    if (items.some((v, k) => v.t === 'matrix' || (v.t === 'list' && !v.set && n.items[k].t !== 'list'))) {
      const blocks = items.map(block);
      if (blocks.every(b => b)) {
        const m = beside(blocks as Expr[][][]);
        return m.length ? fromRows(m) : { t: 'list', items: [], set: false };
      }
    }
  }
  return { t: 'list', items, set: n.bracket === '{' };
}

// --- a:h:b ---

const MAX_RANGE = 100_000;
function rangeValue(n: Extract<Node, { t: 'range' }>, env: Env): Value {
  const vals = [evaluate(n.a, env), evaluate(n.b, env), ...(n.step ? [evaluate(n.step, env)] : [])];
  const [a, b] = vals.map(v => scalar(v, 'Zakres')), h = n.step ? scalar(vals[2], 'Krok zakresu') : ONE;
  const ap = vals.some(isApprox);
  if (![a, b, h].every(isConstant)) fail('Zakres a:h:b potrzebuje liczb, np. 0:0.5:3.');
  let count: number;
  if (isNum(a) && isNum(b) && isNum(h)) {
    if (!h.v.n) fail('Krok zakresu nie może być zerem.');
    const steps = qdiv(qsub(b.v, a.v), h.v);
    const whole = steps.n < 0n ? -1n : qfloor(steps);
    if (whole >= BigInt(MAX_RANGE)) fail('Zakres ma ponad 100 000 elementów.');
    count = Number(whole) + 1;
  } else {
    const [A, B, H] = [a, b, h].map(approx);
    if ([A, B, H].some(z => Math.abs(z.im) > 1e-12 || !Number.isFinite(z.re))) fail('Zakres a:h:b potrzebuje liczb rzeczywistych.');
    if (H.re === 0) fail('Krok zakresu nie może być zerem.');
    // 0:pi/4:pi ends at π although the float sum may fall just short of it
    const steps = (B.re - A.re) / H.re;
    count = steps < -1e-10 ? 0 : Math.floor(steps + 1e-10) + 1;
    if (count > MAX_RANGE) fail('Zakres ma ponad 100 000 elementów.');
  }
  const out = listOf(Array.from({ length: count }, (_, k) => add(a, mul(num(k), h))));
  return ap ? approxValue(out) : out;
}

// --- A(i, j), v(k), f(x) ---

/** f applied to arguments; f(1:3) to each element when its value is a number. */
export function apply(f: FnValue, args: Value[], name = 'Funkcja'): Value {
  if (args.some(isApprox)) return approxValue(apply(f, args.map(exactly), name));
  if (args.length !== f.params.length) fail(`${name} przyjmuje ${f.params.length} ${f.params.length === 1 ? 'argument' : 'argumenty'}: ${name}(${f.params.join(', ')}).`);
  // all at once: f(x, y) at (y, x) swaps them
  const marks = f.params.map((_, k) => sym(`#${k}`));
  const at = (es: Expr[]) => (e: Expr) => {
    let out = f.params.reduce((acc, p, k) => subst(acc, p, marks[k]), e);
    es.forEach((v, k) => { out = subst(out, marks[k], v); });
    return out;
  };
  if (f.body.t === 'expr') { const body = f.body.e; return broadcast(args, es => at(es)(body), name); }
  return mapValue(f.body, at(args.map(a => scalar(a, name))));
}

function indexValue(name: string, v: Value, args: Node[], env: Env): Value {
  if (isApprox(v)) return approxValue(indexValue(name, exactly(v), args, env));
  if (v.t === 'fn') return apply(v, args.map(a => evaluate(a, env)), name);
  if (v.t === 'expr') {
    // n(2) of a number: a product, as it was before there were variables
    if (args.length === 1 && args[0].t !== 'colon') return arith('*', v, evaluate(args[0], env));
    return fail(`${name} to liczba, a nie macierz: nie ma indeksów.`);
  }
  const rows = v.t === 'matrix' ? v.rows
    : v.t === 'list' && !v.set && v.items.every(i => i.t === 'expr') ? [v.items.map(i => (i as { e: Expr }).e)]
    : fail(`Tej wartości (${name}) nie da się indeksować.`);
  const [R, C] = dims(rows);
  const pick = (arg: Node, size: number): number[] => {
    if (arg.t === 'colon') return Array.from({ length: size }, (_, k) => k);
    const val = evaluate(arg, { ...env, end: size });
    // an index matrix is read down its columns, like everything in MATLAB
    const ks = val.t === 'list' ? val.items.map(x => scalar(x, 'Indeks')) : val.t === 'matrix' ? transpose(val.rows).flat() : [scalar(val, 'Indeks')];
    if ((val.t === 'list' || val.t === 'matrix') && val.logical) {
      // v(v > 2): the places where the comparison holds
      if (ks.length !== size) fail(`Maska ma ${ks.length} elementów, a indeksowany wymiar ${size}.`);
      return ks.flatMap((k, i) => (isNum(k) && k.v.n ? [i] : []));
    }
    return ks.map(k => {
      if (!isInt(k)) fail('Indeks to liczba całkowita dodatnia; liczymy od 1.');
      const j = Number((k as { v: { n: bigint } }).v.n);
      if (j < 1 || j > size) fail(size ? `Indeks ${j} poza zakresem 1…${size}.` : `${name} jest puste.`);
      return j - 1;
    });
  };
  if (args.length === 1) {
    // one index: places counted down the columns, as in MATLAB (for a row, simply left to right)
    const flat = Array.from({ length: R * C }, (_, k) => rows[k % R][Math.floor(k / R)]);
    const ks = pick(args[0], flat.length), out = ks.map(k => flat[k]);
    if (args[0].t === 'colon') return out.length === 1 ? ex(out[0]) : { t: 'matrix', rows: out.map(e => [e]) };
    return out.length === 1 && args[0].t !== 'range' ? ex(out[0]) : listOf(out);
  }
  if (args.length === 2) {
    const out = pick(args[0], R).map(r => pick(args[1], C).map(c => rows[r][c]));
    if (out.length === 1 && out[0].length === 1) return ex(out[0][0]);
    return fromRows(out);
  }
  return fail('Indeksy: jeden, v(3), albo dwa, A(2, 3).');
}

// --- Matrices ---

export const dims = (m: Expr[][]): [number, number] => [m.length, m[0]?.length ?? 0];
export function matMul(a: Expr[][], b: Expr[][]): Expr[][] {
  const [n, k] = dims(a), [k2, m] = dims(b);
  if (k !== k2) fail(`Nie da się pomnożyć macierzy ${n}×${k} przez ${k2}×${m}.`);
  return Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => add(...Array.from({ length: k }, (_, l) => mul(a[i][l], b[l][j])))));
}
export const identityM = (n: number): Expr[][] => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? ONE : num(0))));

/** Linear algebra the engine installs (matrix.ts depends on this file). */
const hooks = {
  inverse: (_: Expr[][]): Expr[][] => fail('Odwracanie macierzy niedostępne.'),
  leftSolve: (_: Expr[][], __: Expr[][]): Expr[][] => fail('Rozwiązywanie układów niedostępne.'),
};
export function setInverse(f: typeof hooks.inverse) { hooks.inverse = f; }
export function setLeftSolve(f: typeof hooks.leftSolve) { hooks.leftSolve = f; }

/** A\b: the x of A·x = b (a\b of numbers is b/a). */
function leftDivide(a: Value, b: Value): Value {
  if (a.t === 'expr') return arith('/', b, a);
  if (isApprox(a) || isApprox(b)) return denseSolve(a, b);
  if (a.t !== 'matrix') return fail('A\\b: po lewej stronie macierz układu, np. [2 1; 1 3]\\[3; 5].');
  const B = b.t === 'matrix' ? b.rows
    : b.t === 'list' ? b.items.map(i => [scalar(i, 'Prawa strona')])
    : [[scalar(b, 'Prawa strona')]];
  if (B.length !== a.rows.length) fail(`A\\b: A ma ${a.rows.length} ${a.rows.length === 1 ? 'wiersz' : 'wierszy'}, a b ${B.length}.`);
  const X = hooks.leftSolve(a.rows, B);
  // b given as a list gets its x as a list
  return b.t === 'list' && X[0]?.length === 1 ? listOf(X.map(r => r[0])) : { t: 'matrix', rows: X };
}

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
    // matrix · vector given as a list; a column times a row (v' * v) is their outer product
    if (isM(a) && vec(b) && dims(a.rows)[1] === 1 && vec(b)!.length !== 1) return { t: 'matrix', rows: matMul(a.rows, [vec(b)!.map(r => r[0])]) };
    if (isM(a) && vec(b)) return { t: 'list', items: matMul(a.rows, vec(b)!).map(r => ex(r[0])), set: false };
    // a row (a list) times a matrix, as in [1 2]*A
    if (isM(b) && vec(a)) {
      const r = matMul([vec(a)!.map(c => c[0])], b.rows);
      // v * v' is a number
      return r[0].length === 1 ? ex(r[0][0]) : fromRows(r);
    }
    return fail('Tych obiektów nie da się pomnożyć.');
  }
  if (op === '/') {
    if (isM(a) && b.t === 'expr') return { t: 'matrix', rows: a.rows.map(r => r.map(x => div(x, b.e))) };
    if (isM(b)) return matrixOp('*', a, { t: 'matrix', rows: hooks.inverse(b.rows) });
    return fail('Tego dzielenia nie wykonam.');
  }
  // power: integer exponents of square matrices
  if (isM(a) && b.t === 'expr') {
    const [n, m] = dims(a.rows);
    if (n !== m) fail('Potęgować można tylko macierze kwadratowe.');
    if (!isNum(b.e) || b.e.v.d !== 1n) fail('Wykładnik potęgi macierzy musi być liczbą całkowitą.');
    let k = (b.e as { v: { n: bigint } }).v.n;
    let base = a.rows;
    if (k < 0n) { base = hooks.inverse(base); k = -k; }
    if (k > 100000n) fail('Za duży wykładnik.');
    let out = identityM(n);
    while (k) { if (k & 1n) out = matMul(out, base); k >>= 1n; if (k) base = matMul(base, base); }
    return { t: 'matrix', rows: out };
  }
  return fail('Tego działania na macierzach nie wykonam.');
}
