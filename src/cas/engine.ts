/**
 * The calculator: one line of input → a list of result cards ("pods"), like a computational search engine.
 * Plain expressions get their exact value, decimal digits and properties; equations their solutions; commands
 * (Polish or English, with or without parentheses) their own cards. Everything here runs in the worker.
 */
import './functions';
import { bfSign, bfToNumber } from './bigfloat';
import { diff, diffN, limit, Lim, taylor } from './calculus';
import { Env, Value, approxValue as approxValueOf, evaluate, ex, hidden, isApprox, scalar, setInverse, setLeftSolve, shadow, toMat, dims, matMul, type FnValue } from './evaluate';
import { LINALG, tiny, type Linalg } from './linalg';
import { DATAFIT, plotData } from './datafit';
import * as DN from './dense';
import { MAX_VARS, Saved, Workspace, freeSymbols, save } from './workspace';
export type { Saved } from './workspace';
import { Expr, I, INF, ONE, TWO, ZERO, add, div, expand, fn, freeOf, infSign, isConstant, isInt, isNum, isSym, isZero, mul, neg, num, numDen, pow, same, size, sqrt, sub, subst, sym, together, variables, isFn } from './expr';
import { compileDouble } from './fast';
import { toML, toText } from './format';
import { complexParts, constSign, binomialBig } from './functions';
import { definite, integrate, partialFractions } from './integrate';
import * as LA from './matrix';
import { ARRAYS, arrayReading, placeOf, sortPlaces } from './arrays';
import { nodeML, spelling } from './nodeformat';
import * as NT from './ntheory';
import { Decimal } from './bigfloat';
import { C, approx, evalC, numericValue } from './numeric';
import { COMMANDS, Node, parse, reserved } from './parse';
import { sugar } from './sugar';
export { sugar };
import { coeffsOf, polyOf, polyToExpr, pdivmod, pgcd, solvePoly, P, deg } from './poly';
import { CasError, Q, fail, q, qsign, qabs, qfloor, qsub, qToNumber, bitLength, gcd as bgcd } from './q';
import { cancel, expandLog, factorExpr, simplify, trigExpand, trigLinearize } from './simplify';
import { Interval, IntervalSet, Sol, SolveResult, SystemResult, chooseUnknowns, domain as domainOf, setDomainText, solveEquation, solveInequality, solveSystem, intersect, within, zeroIntervals } from './solve';
import { product as prodOf, sum as sumOf, ratioHint, numericSum } from './sums';
import { type HandoffRow, type MarkKind, type Plot, argandPlot, combine, curveRow, features, fmt, graphText, implicitPlot, matrixPlot, parametricSeries, plotOf, regionPlot, rootsPlot, sequencePlot, statsPlot, zText } from './plot';
export type { Bar, Fill, Handoff, HandoffRow, Mark, MarkKind, PanelMode, Plot, Ref, Series, Shape, Vector } from './plot';

setInverse(LA.inverse);
setLeftSolve(LA.leftSolve);
setDomainText(toText);

// --- Result shape (plain JSON: crosses the worker boundary) ---

/** A row of a card; grid: a matrix too large to typeset, shown as a table of its entries. */
export interface Row { ml: string; text: string; note?: string; grid?: string[][] }
export interface Pod { title: string; rows: Row[]; note?: string; plot?: Plot; more?: { label: string; query: string } }
export interface Result {
  input: Row | null; pods: Pod[]; error?: string; interpreted?: string;
  /** The answer as text (for the next steps), and as code for the next question's ans. */
  ans?: string; ansCode?: string;
  /** Variables this input set (null: removed), and the stored ones it used, for the heading. */
  assigned?: Record<string, Saved | null>; used?: string;
}

const M = (inner: string) => `<math display="block">${inner}</math>`;
// parentheses at their natural size: f(x) next to a tall fraction must not stretch
const mo = (s: string) => s === '(' || s === ')' ? `<mo stretchy="false">${s}</mo>` : `<mo>${s}</mo>`;
/** −∞ / +∞ as one tight symbol. */
const INF_ML = (sign: string) => `<mrow><mo form="prefix" lspace="0" rspace="0">${sign}</mo><mi>∞</mi></mrow>`;
const mi = (s: string) => `<mi>${s}</mi>`;
const mtext = (s: string) => `<mtext>${s.replace(/[&<>]/g, c => `&#${c.charCodeAt(0)};`)}</mtext>`;
const row = (e: Expr, note?: string): Row => ({ ml: M(toML(e)), text: toText(e), note });
const eqRow = (lhsML: string, lhsText: string, e: Expr, note?: string): Row => ({ ml: M(`${lhsML}${mo('=')}${toML(e)}`), text: `${lhsText} = ${toText(e)}`, note });
const textRow = (s: string): Row => ({ ml: M(mtext(s)), text: s });

let digitsDefault = 25;

// --- Entry ---

export interface RunOptions { digits?: number; ans?: string | null; vars?: Record<string, Saved> }

/** The variables of the question being answered (the engine answers one at a time). */
let ws = new Workspace({}, () => baseEnv(null));
let assigned: Record<string, Saved | null> = {};
/** A name as the question wrote it: A = [1 2; 3 4] shows A, though names don't depend on the case of letters. */
let spelled = (n: string) => n;
/** name = … read as an equation after all: its right side has free letters (y = 2x + 1). */
class NotAssignment extends Error {}

export function run(rawInput: string, opts: RunOptions = {}): Result {
  digitsDefault = Math.min(5000, Math.max(5, opts.digits ?? 25));
  hidden.length = 0;
  ws = new Workspace(opts.vars ?? {}, () => baseEnv(null));
  assigned = {};
  let ans: Value | null = null;
  if (opts.ans) { try { ans = evaluate(parse(opts.ans, { limit: 60_000, assign: false }), baseEnv(null)); } catch { ans = null; } }
  const env: Env = { ...baseEnv(ans), vars: ws };
  spelled = spelling(rawInput, n => ws.saved[n]?.display);
  const interpreted = sugar(rawInput);
  const names = ws.kinds();
  let node: Node;
  try { node = parse(interpreted, { names }); } catch (err) { return { input: null, pods: [], error: message(err), interpreted }; }
  let input: Row = { ml: nodeML(node, spelled), text: rawInput };
  try {
    let out: Out;
    try { out = top(node, env); } catch (err) {
      if (!(err instanceof NotAssignment)) throw err;
      node = parse(interpreted, { names, assign: false });
      input = { ml: nodeML(node, spelled), text: rawInput };
      ws.reset(); hidden.length = 0; assigned = {};
      out = top(node, env);
    }
    const { pods, value } = out;
    const ansText = value && value.t === 'expr' ? toText(value.e) : undefined;
    const ansCode = value && value.t !== 'fn' && value.t !== 'str' && value.t !== 'rel' ? safe(() => save(value, baseEnv(null)).code) ?? undefined : undefined;
    const used = usedText();
    return {
      input, pods, ans: ansText, ansCode, interpreted: interpreted !== rawInput.trim() ? interpreted : undefined,
      ...(Object.keys(assigned).length ? { assigned } : {}), ...(used ? { used } : {}),
    };
  } catch (err) {
    return { input, pods: [], error: message(err), interpreted };
  }
}
/** "n = 10, A (macierz 2×2)": the stored variables the answer used. */
function usedText(): string {
  return [...ws.used].filter(n => !ws.local.has(n)).map(n => {
    const s = ws.saved[n];
    const d = s.display ?? n;
    return s.kind === 'scalar' && s.preview.length <= 24 ? `${d} = ${s.preview}` : `${d} (${s.label})`;
  }).join(', ');
}
/** What the input asks of x that its simplified form doesn't show (x/x: x ≠ 0). */
const guardOf = (x: string) => hidden.filter(g => variables(g).every(v => v === x));
/** The domain of e, within what the input itself asks of x. */
function domain(e: Expr, x: string): IntervalSet {
  const d = domainOf(e, x), g = guardOf(x);
  if (!g.length) return d;
  const h = domainOf({ k: '+', t: g }, x);
  return { parts: intersect(d.parts, h.parts), note: d.note ?? h.note };
}
/** The zeros of e (solutions of e = 0) that the input allows. */
const zerosOf = (e: Expr, x: string): SolveResult => within(solveEquation(e, x), x, guardOf(x));
const message = (err: unknown) => err instanceof CasError ? err.message : `Błąd wewnętrzny: ${(err as Error)?.message ?? String(err)}`;

function baseEnv(ans: Value | null): Env {
  return { ans, command: (name, args, env) => { const r = command(name, args, env); if (!r.value) fail(`Polecenia ${name} nie można użyć wewnątrz wyrażenia.`); return r.value!; } };
}

/** outputs: what [a, b, …] = f(…) assigns (lu, svd, size, sort …). */
interface Out { pods: Pod[]; value?: Value; outputs?: Value[] }

function top(node: Node, env: Env): Out {
  if (node.t === 'assign' || node.t === 'massign') return statements([node], env);
  if (node.t === 'list' && node.items.some(i => i.t === 'assign' || i.t === 'massign')) return statements(node.items, env);
  if (node.t === 'call' && Object.hasOwn(COMMANDS, node.n)) return command(node.n, node.args, env);
  if (node.t === 'op' && node.o === '\\') return leftDivisionPods(node.a, node.b, env);
  if (node.t === 'call' && (node.n === 'max' || node.n === 'min') && node.args.length === 1) {
    // max(v): the value and where it is
    const v = evaluate(node.args[0], env), k = placeOf(v, node.n);
    if (k !== null) {
      const e = simplify(scalar(evaluate(node, env), node.n));
      return { pods: [{ title: node.n === 'max' ? 'Największy element' : 'Najmniejszy element', rows: [row(e, `na miejscu ${k}`)] }], value: ex(e) };
    }
  }
  if (node.t === 'rel') {
    // v > 2 of a list: 1 where it holds, 0 where not; an equation otherwise
    const v = node.ops.length === 1 ? safe(() => evaluate(node, env)) : null;
    if (v && v.t !== 'rel') return { pods: [{ ...valuePods(v).pods[0], title: 'Porównanie element po elemencie', note: '1 tam, gdzie zachodzi, 0 tam, gdzie nie. Jako indeks wybiera te miejsca: v(v > 2).' }], value: v };
    return relation(node, env, null);
  }
  if (node.t === 'list' && node.items.length && node.items.every(i => i.t === 'rel')) return system(node.items, env, null);
  const v = evaluate(node, env);
  return valuePods(v);
}

function valuePods(v: Value): Out {
  switch (v.t) {
    case 'expr': return { pods: v.approx ? approxNumberPods(v.e) : isConstant(v.e) ? numberPods(v.e) : expressionPods(v.e), value: v };
    case 'matrix': return { pods: v.approx ? approxMatrixPods(v.rows) : matrixPods(v.rows), value: v };
    case 'list': return { pods: listPods(v), value: v };
    case 'fn': return { pods: fnPods(v), value: v };
    case 'rel': return fail('Nieoczekiwane równanie.');
    case 'str': return fail(`'${v.s}' to napis: nazwa opcji polecenia, np. norm(A, 'fro').`);
  }
}

// --- Variables ---

/** The value name = … gives the variable, or null when = is an equation after all (y = 2x + 1). */
function assignedValue(n: Extract<Node, { t: 'assign' }>, env: Env): Value | null {
  if (reserved(n.name)) fail(`${n.name} to nazwa funkcji lub stałej; wybierz inną nazwę zmiennej.`);
  const params = n.params ?? [];
  const v = evaluate(n.value, shadow(env, params));
  if (v.t === 'rel' || v.t === 'str') return null;
  if (n.params && v.t === 'fn') fail(`Zapisz funkcję jako ${n.name}(${params.join(', ')}) = wyrażenie albo ${n.name} = @(${params.join(', ')}) wyrażenie.`);
  const value: Value = n.params ? { t: 'fn', params, body: v } : v;
  // = with letters left free is an equation (y = 2x + 1); := always assigns, a matrix or @(x) … always is an assignment
  if (n.op === '=' && (value.t === 'expr' || n.params) && freeSymbols(value).length) return null;
  return value;
}

function statements(items: Node[], env: Env): Out {
  const done: [string, Value][] = [];
  let last: Out | null = null;
  const shown: Pod[] = [];
  items.forEach((item, k) => {
    if (item.t === 'massign') {
      // [L, U, P] = lu(A): each name gets its output
      const out = multiple(item.value, item.names.length, env);
      item.names.forEach((n, j) => { ws.local.set(n, out.outputs![j]); done.push([n, out.outputs![j]]); });
      shown.push(...out.pods);
      return;
    }
    if (item.t !== 'assign') {
      if (k !== items.length - 1) throw new NotAssignment();
      last = top(item, env);
      return;
    }
    const v = assignedValue(item, env);
    if (!v) throw new NotAssignment();
    ws.local.set(item.name, v);
    done.push([item.name, v]);
  });
  const total = new Set([...Object.keys(ws.saved), ...done.map(([n]) => n)]).size;
  if (total > MAX_VARS) fail(`Zmiennych może być najwyżej ${MAX_VARS}. Usuń niepotrzebne poleceniem clear.`);
  for (const [n, v] of done) { const s = save(v, baseEnv(null)), d = spelled(n); assigned[n] = d !== n ? { ...s, display: d } : s; }
  const pods: Pod[] = [{ title: done.length > 1 ? 'Zapisane zmienne' : 'Zapisana zmienna', rows: done.map(([n, v]) => assignRow(spelled(n), v)), note: assignNote(done.map(([n, v]) => [spelled(n), v])) }];
  const end = last as Out | null;
  if (end) pods.push(...end.pods);
  else if (shown.length) {
    // [Q, R] = qr(A): a card that only repeats the variables gives its note (what was checked) and goes
    const body = (t: string) => t.replace(/^[^=≈]*[=≈] /, '');
    const saved = new Set(pods[0].rows.map(r => body(r.text)));
    for (const p of shown) {
      if (p.rows.length && p.rows.every(r => saved.has(body(r.text)))) { if (p.note) pods[0].note = `${p.note} ${pods[0].note ?? ''}`.trim(); }
      else pods.push(p);
    }
  }
  else if (done.length === 1) pods.push(...(safe(() => valuePods(done[0][1]).pods.slice(1)) ?? []));
  return { pods, value: end?.value ?? done[done.length - 1][1] };
}
/** [a, b] = f(…): the outputs of a command that gives several. */
function multiple(node: Node, count: number, env: Env): Out {
  const which = 'Kilka wyników naraz dają: lu, qr, svd, eig, size, sort, max i min.';
  if (node.t !== 'call') return fail(which);
  let out: Out;
  if (node.n === 'max' || node.n === 'min') {
    // [m, k] = max(v): the value and its place
    const v = evaluate(node.args[0], env), k = placeOf(v, node.n);
    if (node.args.length !== 1 || k === null) fail(`[wartość, miejsce] = ${node.n}(v): v ma być wektorem liczb.`);
    const e = simplify(scalar(evaluate(node, env), node.n));
    out = { pods: [], outputs: [ex(e), ex(num(k!))] };
  } else if (Object.hasOwn(COMMANDS, node.n)) out = command(node.n, node.args, env, count);
  else return fail(which);
  if (!out.outputs || out.outputs.length < count) fail(`${node.n} daje ${out.outputs?.length ?? 1} ${out.outputs?.length === 1 || !out.outputs ? 'wynik' : 'wyniki'}, a nazw jest ${count}. ${which}`);
  return out;
}
const nameML = (n: string) => n.length > 1 ? `<mi mathvariant="normal">${n}</mi>` : mi(n);
function valueML(v: Value): string {
  switch (v.t) {
    case 'expr': return v.approx ? approxML(v.e) : toML(v.e);
    case 'matrix': return v.approx ? matML(v.rows, approxML) : matML(v.rows);
    // ; between elements, as in the list cards: a comma is the decimal separator
    case 'list': return `${mo(v.set ? '{' : '[')}${v.items.map(valueML).join(mo(';'))}${mo(v.set ? '}' : ']')}`;
    case 'fn': return `${mo('(')}${v.params.map(nameML).join(mo(','))}${mo(')')}${mo('↦')}${valueML(v.body)}`;
    default: return '';
  }
}
function assignRow(n: string, v: Value): Row {
  if (v.t === 'fn') return { ml: M(`${nameML(n)}${mo('(')}${v.params.map(nameML).join(mo(','))}${mo(')')}${mo('=')}${valueML(v.body)}`), text: `${n}(${v.params.join(', ')}) = ${valueText(v.body)}` };
  if (v.t === 'matrix' && tooLarge(v.rows)) return { ...matRow(v.rows, '', '', !!v.approx), text: `${n} = ${valueText(v)}` };
  return { ml: M(`${nameML(n)}${mo(isApprox(v) ? '≈' : '=')}${valueML(v)}`), text: `${n} = ${valueText(v)}` };
}
function assignNote(done: [string, Value][]): string {
  const names = done.map(([n]) => n);
  // a letter given a number may have been meant as an equation (x = 5), a short name as a product (xy = 6)
  const one = done.find(([n, v]) => n.length === 1 && v.t === 'expr')?.[0];
  const glued = done.find(([n, v]) => n.length > 1 && n.length <= 3 && /^[a-z]+$/i.test(n) && v.t === 'expr')?.[0];
  return [
    `Od teraz ${names.length > 1 ? 'te nazwy oznaczają te wartości' : `${names[0]} oznacza tę wartość`} w kolejnych obliczeniach; zmienne są w części Zmienne.`,
    one ? `Równanie rozwiążesz poleceniem solve(${one} = …).` : '',
    glued ? `Iloczyn zapisz ze znakiem mnożenia: ${[...glued].join('*')}.` : '',
  ].filter(Boolean).join(' ');
}
function fnPods(f: FnValue): Pod[] {
  const pods: Pod[] = [{ title: 'Funkcja', rows: [{ ml: M(valueML(f)), text: `(${f.params.join(', ')}) ↦ ${valueText(f.body)}` }] }];
  const body = f.body;
  if (f.params.length === 1 && body.t === 'expr' && !freeSymbols(f).length) pods.push(...(safe(() => expressionPods(subst(body.e, f.params[0], sym('x'))).slice(1)) ?? []));
  return pods;
}
/** clear, clear x A: the names to remove (all of them without arguments). */
function clearCommand(args: Node[]): Out {
  const names: string[] = [];
  const walk = (n: Node): void => {
    if (n.t === 'id' || n.t === 'index') names.push(n.n);
    else if (n.t === 'op' && n.o === '*') { walk(n.a); walk(n.b); }
    else if (n.t === 'list') n.items.forEach(walk);
    else fail('clear: podaj nazwy zmiennych, np. clear A x.');
  };
  args.forEach(walk);
  const all = Object.keys(ws.saved);
  const gone = args.length ? names : all;
  for (const n of gone) if (!all.includes(n)) fail(`Nie ma zmiennej ${n}.`);
  for (const n of gone) assigned[n] = null;
  return { pods: [{ title: 'Usunięte zmienne', rows: [textRow(gone.length ? gone.map(n => ws.saved[n].display ?? n).join(', ') : 'Nie było żadnych zmiennych.')] }] };
}
function whoCommand(): Out {
  const all = Object.entries(ws.saved);
  if (!all.length) return { pods: [{ title: 'Zmienne', rows: [textRow('Nie ma jeszcze zmiennych. Zapisz je tak: A = [1 2; 3 4], n = 10, f(x) = x^2.')] }] };
  return { pods: [{ title: 'Zmienne', rows: all.map(([n, s]) => ({ ml: M(`${nameML(s.display ?? n)}${s.params ? `${mo('(')}${s.params.map(nameML).join(mo(','))}${mo(')')}` : ''}${mo('=')}${mtext(s.preview)}`), text: `${s.display ?? n} = ${s.preview}`, note: s.label })) }] };
}

/** A\b: the solution of A·x = b, exact; with more equations than unknowns, the least-squares one. */
function leftDivisionPods(a: Node, b: Node, env: Env): Out {
  const A = evaluate(a, env);
  const v = evaluate({ t: 'op', o: '\\', a, b }, env);
  if (A.t !== 'matrix') return valuePods(v);
  const [n, m] = dims(A.rows);
  let note = n > m ? 'Równań jest więcej niż niewiadomych: to rozwiązanie najmniejszych kwadratów (minimalizuje ‖A·x − b‖), z równań normalnych AᵀA·x = Aᵀb, dokładne.' : 'Jedyne rozwiązanie, dokładne.';
  if (isApprox(A) || isApprox(evaluate(b, env))) {
    const S = DN.svd(toMat(A.rows)).S, c = S[S.length - 1] > 0 ? S[0] / S[S.length - 1] : Infinity;
    note = `${n > m ? 'Najmniejsze kwadraty przez rozkład QR' : 'Rozkład LU z wyborem elementu głównego'}, numerycznie.${c > 1e8 ? ` Uwaga: macierz jest źle uwarunkowana (cond ≈ ${tiny(c)}), więc ${c >= 1e15 ? 'wynik może nie mieć ani jednej pewnej cyfry' : `około ${Math.round(Math.log10(c))} z 16 cyfr wyniku może być niepewnych`}. Dokładny wynik: ta sama macierz bez double.` : ''}`;
  }
  // one right-hand side (a list, or a column as MATLAB writes it): x₁, x₂, … one per row
  const column = v.t === 'list' ? v.items.map(i => scalar(i, 'Rozwiązanie')) : v.t === 'matrix' && v.rows[0]?.length === 1 ? v.rows.map(r => r[0]) : null;
  if (column) {
    const xs = isApprox(v) ? column : column.map(x => simplify(x));
    const value: Value = isApprox(v) ? v : v.t === 'list' ? { t: 'list', items: xs.map(ex), set: false } : { t: 'matrix', rows: xs.map(x => [x]) };
    const xRow = (x: Expr, k: number): Row => isApprox(v)
      ? { ml: M(`<msub>${mi('x')}<mn>${k + 1}</mn></msub>${mo('≈')}${approxML(x)}`), text: `x${k + 1} = ${approxText(x, true)}` }
      : eqRow(`<msub>${mi('x')}<mn>${k + 1}</mn></msub>`, `x${k + 1}`, x, isConstant(x) && !isNum(x) ? shortApprox(x) : undefined);
    return { pods: [{ title: 'Rozwiązanie układu A·x = b', rows: xs.map(xRow), note }], value };
  }
  if (v.t !== 'matrix') return valuePods(v);
  if (v.approx) return { pods: [{ title: 'Rozwiązanie układu A·X = B', rows: [matRow(v.rows, mi('X'), 'X', true)], note }], value: v };
  const X = v.rows.map(r => r.map(c => simplify(c)));
  return { pods: [{ title: 'Rozwiązanie układu A·X = B', rows: [matRow(X, mi('X'), 'X')], note }], value: { t: 'matrix', rows: X } };
}


// --- Decimal numbers ---

function decimalText(d: Decimal | null, exact = false): { text: string; ml: string } {
  if (!d) return { text: '0', ml: '<mn>0</mn>' };
  let digits = d.digits;
  if (exact) digits = digits.replace(/0+$/, '') || '0';
  const sign = d.neg ? '−' : '', E_ = d.exp10;
  const group = (s: string) => s.replace(/(\d{5})(?=\d)/g, '$1 ');
  if (E_ >= -6 && E_ < 24) {
    let int: string, frac: string;
    if (E_ >= 0) { int = digits.slice(0, E_ + 1).padEnd(E_ + 1, '0'); frac = digits.slice(E_ + 1); }
    else { int = '0'; frac = '0'.repeat(-E_ - 1) + digits; }
    const intG = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return { text: `${sign}${int}${frac ? '.' + frac : ''}`, ml: `${d.neg ? mo('−') : ''}<mn>${intG}${frac ? ',' + group(frac) : ''}</mn>` };
  }
  const mant = digits.length > 1 ? `${digits[0]},${group(digits.slice(1))}` : digits;
  return {
    text: `${sign}${digits[0]}${digits.length > 1 ? '.' + digits.slice(1) : ''}e${E_}`,
    ml: `${d.neg ? mo('−') : ''}<mn>${mant}</mn>${mo('·')}<msup><mn>10</mn><mn>${E_}</mn></msup>`,
  };
}

/** ≈ value of a constant: a row with correct digits only. */
function decimalRow(e: Expr, digits = digitsDefault): Row | null {
  let v;
  try { v = numericValue(e, digits); } catch { return null; }
  // a rational part is printed without its trailing zeros (0,5 not 0,500…)
  const parts = complexParts(e);
  const reExact = !!parts && isNum(parts[0]), imExact = !!parts && isNum(parts[1]);
  const re = v.re ? decimalText(v.re, reExact) : null, im = v.im ? decimalText({ ...v.im, neg: false }, imExact) : null;
  if (!re && !im) return { ml: M(`${mo('≈')}<mn>0</mn>`), text: '0', note: v.reZeroBelow ? `|wartość| < 10^−${v.reZeroBelow}` : undefined };
  let ml = '', text = '';
  if (re) { ml += re.ml; text += re.text; }
  if (im) {
    ml += re ? mo(v.im!.neg ? '−' : '+') : v.im!.neg ? mo('−') : '';
    ml += `${im.ml}${mi('i')}`;
    text += `${re ? (v.im!.neg ? ' − ' : ' + ') : v.im!.neg ? '−' : ''}${im.text}i`;
  }
  const notes: string[] = [];
  if (v.reZeroBelow && im) notes.push(`część rzeczywista: |Re| < 10^−${v.reZeroBelow}`);
  if (v.imZeroBelow && re) notes.push(`część urojona: |Im| < 10^−${v.imZeroBelow}`);
  return { ml: M(`${mo('≈')}${ml}`), text, note: notes.join('; ') || undefined };
}
const shortApprox = (e: Expr): string => {
  try {
    const v = numericValue(e, 12);
    const p = (d: Decimal | null) => decimalText(d).text.replace('.', ',');
    if (v.im) return `≈ ${v.re ? p(v.re) + (v.im.neg ? ' − ' : ' + ') : v.im.neg ? '−' : ''}${p({ ...v.im, neg: false })}i`;
    return `≈ ${p(v.re)}`;
  } catch { return ''; }
};
const isRationalE = (e: Expr) => isNum(e);

// --- Numbers ---

function numberPods(e0: Expr): Pod[] {
  const pods: Pod[] = [];
  if (isInf(e0)) return [{ title: 'Wynik', rows: [row(e0)] }];
  const s0 = safe(() => simplify(e0));
  const e = s0 && size(s0) < size(e0) ? s0 : e0;
  const parts = complexParts(e);
  const isComplex = parts && !isZero(parts[1]);
  pods.push({ title: 'Wynik', rows: [row(e)] });
  if (isNum(e)) {
    if (e.v.d === 1n) pods.push(...integerPods(e.v.n));
    else pods.push(...rationalPods(e.v));
    return pods;
  }
  const s = simplify(e);
  if (!same(s, e) && size(s) < size(e)) pods.push({ title: 'Postać uproszczona', rows: [row(s)] });
  const d = decimalRow(e);
  if (d) pods.push({ title: 'Postać dziesiętna', rows: [d], more: { label: 'Więcej cyfr', query: `N(${toText(e)}, ${Math.min(5000, digitsDefault * 4)})` } });
  if (isComplex && parts) pods.push(...complexPods(e, parts));
  else if (d) {
    const cf = numericContinuedFraction(e, 14);
    if (cf) pods.push({ title: 'Ułamek łańcuchowy', rows: [cf] });
  }
  return pods;
}

function complexPods(e: Expr, [a, b]: [Expr, Expr]): Pod[] {
  const pods: Pod[] = [];
  const r = simplify(sqrt(add(pow(a, TWO), pow(b, TWO))));
  let phi: Expr | null = null;
  try { phi = fn('arg', e); if (isFn(phi, 'arg')) phi = null; } catch { phi = null; }
  pods.push({ title: 'Postać algebraiczna', rows: [eqRow(mi('z'), 'z', add(a, mul(b, I)))] });
  pods.push({ title: 'Moduł i argument', rows: [eqRow(`<mo stretchy="false" lspace="0" rspace="0">|</mo>${mi('z')}<mo stretchy="false" lspace="0" rspace="0">|</mo>`, '|z|', r, isRationalE(r) ? undefined : shortApprox(r)), ...(phi ? [eqRow(`<mi mathvariant="normal">arg</mi><mspace width="0.17em"/>${mi('z')}`, 'arg z', phi, isRationalE(phi) ? undefined : shortApprox(phi))] : [])] });
  if (phi) {
    const rML = isOneE(r) ? '' : toML(r), rText = isOneE(r) ? '' : `${toText(r)}·`;
    pods.push({
      title: 'Postać trygonometryczna i wykładnicza',
      rows: [
        { ml: M(`${mi('z')}${mo('=')}${rML}<mrow>${mo('(')}<mi mathvariant="normal">cos</mi>${wrapArg(phi)}${mo('+')}${mi('i')}<mi mathvariant="normal">sin</mi>${wrapArg(phi)}${mo(')')}</mrow>`), text: `z = ${rText}(cos(${toText(phi)}) + i·sin(${toText(phi)}))` },
        { ml: M(`${mi('z')}${mo('=')}${rML}<msup>${mi('e')}<mrow>${mi('i')}${toML(phi)}</mrow></msup>`), text: `z = ${rText}e^(i·${toText(phi)})` },
      ],
    });
  }
  pods.push({ title: 'Sprzężenie', rows: [eqRow(`<mover>${mi('z')}${mo('‾')}</mover>`, 'z̄', sub(a, mul(b, I)))] });
  const A = approx(a).re, B = approx(b).re;
  if (Number.isFinite(A) && Number.isFinite(B)) pods.push({ title: 'Płaszczyzna zespolona', rows: [], plot: argandPlot(A, B, { z: toText(e), conj: toText(sub(a, mul(b, I))), r: toText(r) }) });
  return pods;
}
const wrapArg = (e: Expr) => `${mo('(')}${toML(e)}${mo(')')}`;

function integerPods(n: bigint): Pod[] {
  const pods: Pod[] = [];
  const an = n < 0n ? -n : n;
  const digitsCount = an.toString().length;
  if (an > 1n) {
    const f = NT.factorInteger(an, 2_000_000);
    const isPrime = f.factors.length === 1 && f.factors[0][1] === 1 && !f.unfactored.length;
    const terms = f.factors.map(([p, e]) => (e > 1 ? `<msup><mn>${p}</mn><mn>${e}</mn></msup>` : `<mn>${p}</mn>`));
    const textTerms = f.factors.map(([p, e]) => (e > 1 ? `${p}^${e}` : `${p}`));
    for (const u of f.unfactored) { terms.push(`<mn>${u}</mn>`); textTerms.push(`${u}`); }
    const notes: string[] = [];
    if (f.unfactored.length) notes.push('Ostatni czynnik jest złożony, ale nie udało się go rozłożyć w limicie czasu.');
    if (f.probable.length) notes.push('Czynniki większe od 3,3·10²⁴ są pierwsze według testu BPSW (nie znaleziono dotąd liczby, która by go oszukała).');
    pods.push({
      // primes are positive: −2 is −1 times the prime 2
      title: isPrime && n > 0n ? 'Liczba pierwsza' : 'Rozkład na czynniki pierwsze',
      rows: [{ ml: M(`${n < 0n ? `${mo('−')}` : ''}${terms.join(mo('·'))}`), text: `${n < 0n ? '−' : ''}${textTerms.join(' · ')}` }],
      note: notes.join(' ') || (isPrime ? `${an} jest liczbą pierwszą.` : undefined) || (n < 0n ? `Liczby pierwsze i złożone są dodatnie; to rozkład ${an}.` : undefined),
    });
    // properties
    const props: string[] = [n % 2n ? 'nieparzysta' : 'parzysta'];
    if (!isPrime && !f.unfactored.length && n > 0n) props.push('złożona');
    if (!f.unfactored.length && f.factors.length) {
      const g = f.factors.reduce((acc, [, e]) => { let a = acc, b = e; while (b) [a, b] = [b, a % b]; return a; }, 0);
      if (g > 1) props.push(`potęga: ${f.factors.reduce((acc, [p, e]) => acc * p ** BigInt(e / g), 1n)}^${g}`);
    }
    if (!f.unfactored.length && an < 10n ** 30n) {
      const sig = f.factors.reduce((s, [p, e]) => s * ((p ** BigInt(e + 1) - 1n) / (p - 1n)), 1n);
      if (sig === 2n * an) props.push('doskonała');
      const tau = f.factors.reduce((s, [, e]) => s * BigInt(e + 1), 1n);
      const phi = f.factors.reduce((s, [p, e]) => s * (p - 1n) * p ** BigInt(e - 1), 1n);
      pods.push({
        title: 'Dzielniki',
        rows: [
          { ml: M(`<mi>τ</mi>${mo('(')}<mn>${an}</mn>${mo(')')}${mo('=')}<mn>${tau}</mn>`), text: `liczba dzielników: ${tau}` },
          { ml: M(`<mi>σ</mi>${mo('(')}<mn>${an}</mn>${mo(')')}${mo('=')}<mn>${sig}</mn>`), text: `suma dzielników: ${sig}` },
          { ml: M(`<mi>φ</mi>${mo('(')}<mn>${an}</mn>${mo(')')}${mo('=')}<mn>${phi}</mn>`), text: `funkcja Eulera: ${phi}` },
          ...(tau <= 64n ? [{ ml: M(mtext(NT.divisors(an).join(', '))), text: NT.divisors(an).join(', ') }] : []),
        ],
      });
    }
    pods.push({ title: 'Własności', rows: [textRow(props.join(', '))] });
  }
  if (digitsCount > 6) pods.push({ title: 'Liczba cyfr', rows: [textRow(`${digitsCount}`)] });
  if (an < 1n << 512n) {
    pods.push({
      title: 'W innych systemach',
      rows: [[2, 'dwójkowym'], [8, 'ósemkowym'], [16, 'szesnastkowym']].map(([b, name]) => {
        const s = NT.toBase(n, b as number);
        return { ml: M(`<msub><mn>${s}</mn><mn>${b}</mn></msub>`), text: s, note: `w systemie ${name}` };
      }),
    });
  }
  return pods;
}

function rationalPods(v: Q): Pod[] {
  const pods: Pod[] = [];
  const a = qabs(v), whole = qfloor(a);
  if (whole > 0n) {
    const rest = qsub(a, q(whole));
    pods.push({ title: 'Liczba mieszana', rows: [{ ml: M(`${v.n < 0n ? mo('−') : ''}<mn>${whole}</mn><mfrac><mn>${rest.n}</mn><mn>${rest.d}</mn></mfrac>`), text: `${v.n < 0n ? '−' : ''}${whole} ${rest.n}/${rest.d}` }] });
  }
  const ex_ = NT.decimalExpansion(v, 10, 3000);
  if (ex_.periodLength !== null) {
    const frac = ex_.period ? `${ex_.pre}(${ex_.period})` : ex_.pre;
    const ml = `<mn>${ex_.int.replace('−', '')},${ex_.pre}</mn>${ex_.period ? `${mo('(')}<mn>${ex_.period}</mn>${mo(')')}` : ''}`;
    pods.push({
      title: ex_.period ? 'Rozwinięcie dziesiętne okresowe' : 'Rozwinięcie dziesiętne',
      rows: [{ ml: M(`${ex_.int.startsWith('−') ? mo('−') : ''}${ml}`), text: `${ex_.int},${frac}`, note: ex_.period ? `okres długości ${ex_.period.length}` : 'skończone' }],
    });
  } else {
    const d = decimalRow(num(v));
    if (d) pods.push({ title: 'Postać dziesiętna', rows: [d], note: 'Okres ma ponad 3000 cyfr.' });
  }
  const cf = NT.continuedFraction(v);
  pods.push({ title: 'Ułamek łańcuchowy', rows: [cfRow(cf, false)] });
  return pods;
}
function cfRow(a: bigint[], open: boolean): Row {
  const head = String(a[0]).replace('-', '−'), rest = a.slice(1);
  return { ml: M(`${mo('[')}<mn>${head}</mn>${rest.length ? mo(';') + rest.map(x => `<mn>${x}</mn>`).join(mo(',')) : ''}${open ? mo(',') + mo('…') : ''}${mo(']')}`), text: `[${head}${rest.length ? '; ' + rest.join(', ') : ''}${open ? ', …' : ''}]` };
}
/** Terms of the continued fraction that agree at two precisions. */
function numericContinuedFraction(e: Expr, max: number): Row | null {
  const at = (bits: number) => {
    const z = evalC(e, bits);
    if (z.im.m) return null;
    const out: bigint[] = [];
    let x = z.re; // walk with exact rationals from the BigFloat
    let n = x.e >= 0 ? x.m << BigInt(x.e) : x.m, d = x.e >= 0 ? 1n : 1n << BigInt(-x.e);
    for (let k = 0; k < max + 2 && d; k++) {
      let a = n / d;
      if (n % d && (n < 0n) !== (d < 0n)) a--;
      out.push(a);
      [n, d] = [d, n - a * d];
    }
    void x;
    return out;
  };
  try {
    const a = at(300), b = at(500);
    if (!a || !b) return null;
    const common: bigint[] = [];
    for (let k = 0; k < Math.min(a.length, b.length, max); k++) { if (a[k] !== b[k]) break; common.push(a[k]); }
    if (common.length < 3) return null;
    return cfRow(common, true);
  } catch { return null; }
}

// --- Expressions with variables ---

function mainVar(e: Expr, hint?: string | null): string {
  if (hint) return hint;
  const vs = variables(e).filter(v => v !== 'k' || variables(e).length === 1);
  if (!vs.length) return 'x';
  if (vs.includes('x')) return 'x';
  if (vs.length === 1) return vs[0];
  for (const v of ['t', 'z', 'y']) if (vs.includes(v)) return v;
  return vs[0];
}

function expressionPods(e: Expr): Pod[] {
  const pods: Pod[] = [];
  const vs = variables(e);
  const x = mainVar(e);
  const X = sym(x);
  const forms: [string, Expr][] = [];
  const s = safe(() => simplify(e));
  if (s && !same(s, e)) forms.push(['Postać uproszczona', s]);
  const best = s ?? e;
  pods.push({ title: 'Wynik', rows: [row(e)] });
  const ex_ = safe(() => expand(e));
  if (ex_ && !same(ex_, e) && !same(ex_, best) && size(ex_) < 400) forms.push(['Postać rozwinięta', ex_]);
  const fa = safe(() => factorExpr(e));
  if (fa && !same(fa.e, e) && !same(fa.e, best) && !(ex_ && same(fa.e, ex_))) forms.push(['Postać iloczynowa', fa.e]);
  const tg = safe(() => cancel(together(e)));
  if (tg && !forms.some(([, f]) => same(f, tg)) && !same(tg, e) && numDen(tg)[1].k !== 'n') forms.push(['Wspólny mianownik', tg]);
  for (const [t, f] of forms) pods.push({ title: t, rows: [row(f)] });
  if (vs.length === 1) {
    const plot = safe(() => plotOf([best], x, { at: interestingPoints(best, x).map(v => ({ x: v, kind: 'zero' as const })), find: [['zero', 'max', 'min', 'inflection']], labels: [`y = ${toText(best)}`] }));
    if (plot && x === 'z') {
      // z names a complex variable: the whole plane, coloured by f(z), is in Zespolone
      const t = zText(best, 'z');
      if (t) plot.open = { mode: 'complex', rows: [{ expr: t, series: 0, color: 0 }] };
    }
    if (plot) pods.push({ title: x === 'z' ? 'Wykres dla rzeczywistych z' : 'Wykres', rows: [], plot, note: plot?.open?.mode === 'complex' ? 'Całą płaszczyznę zespoloną, z kolorem według f(z), pokazują Zespolone.' : undefined });
    const d = safe(() => simplify(diff(e, x)));
    if (d) pods.push({ title: 'Pochodna', rows: [eqRow(derivML(x, `<mrow>${mo('(')}${toML(e)}${mo(')')}</mrow>`), `d/d${x} (${toText(e)})`, polyForm(d, x))] });
    const F = size(e) < 200 ? safe(() => integrate(e, x)) : null;
    if (F) { const G = antiderivativeForm(simplify(F), x); pods.push({ title: 'Całka nieoznaczona', rows: [{ ml: M(`${mo('∫')}${toML(e)}<mspace width="0.17em"/><mi mathvariant="normal">d</mi>${mi(x)}${mo('=')}${toML(G)}${mo('+')}<mi>C</mi>`), text: `${toText(G)} + C` }] }); }
    const set = safe(() => zeroIntervals(e, x));
    const z = set ? null : safe(() => zerosOf(e, x));
    if (set) pods.push({ title: 'Miejsca zerowe', rows: [intervalRow(set, x)] });
    if (z && z.kind === 'list') {
      const real = z.sols.filter(s => !s.approx || isRealSol(s));
      if (real.length) pods.push({ title: 'Miejsca zerowe', rows: solutionRows(real.slice(0, 16), x), note: z.note ?? (real.length > 16 ? `Pokazano 16 z ${real.length}.` : undefined) });
    }
    const dom = safe(() => domain(e, x));
    if (dom && !(dom.parts.length === 1 && !dom.parts[0].lo && !dom.parts[0].hi)) pods.push({ title: 'Dziedzina', rows: [intervalRow(dom.parts, x)], note: dom.note });
    else if (dom?.note) pods.push({ title: 'Dziedzina', rows: [intervalRow(dom.parts, x)], note: dom.note });
    if (!polyOf(e, x)) {
      const t = safe(() => taylor(e, x, ZERO, 5));
      if (t && t.terms.length) pods.push({ title: `Szereg Taylora w ${x} = 0`, rows: [seriesRow(t.terms, X, 6, ZERO)] });
    }
  } else if (vs.length >= 2 && vs.length <= 4) {
    const rows: Row[] = [];
    for (const v of vs) {
      const d = safe(() => simplify(diff(e, v)));
      if (d) rows.push({ ml: M(`<mfrac><mo>∂</mo><mrow><mo>∂</mo>${mi(v)}</mrow></mfrac>${mo('=')}${toML(d)}`), text: `∂/∂${v}: ${toText(d)}` });
    }
    if (rows.length) pods.push({ title: 'Pochodne cząstkowe', rows });
  }
  return pods;
}
/** Polynomials read best expanded: x³/3 − 5x²/2 + 6x rather than x(2x² − 15x + 36)/6. */
function polyForm(e: Expr, x: string): Expr {
  const p = safe(() => polyOf(e, x));
  return p ? polyToExpr(p, sym(x)) : e;
}
/** An antiderivative that is a polynomial: expanded and without its constant term, unless it is c·(ax + b)ⁿ. */
function antiderivativeForm(F: Expr, x: string): Expr {
  const lin = (b: Expr) => { const c = coeffsOf(b, x, 1); return !!c && c.length === 2; };
  if (F.k === '*' && F.t.length === 2 && isNum(F.t[0]) && F.t[1].k === '^' && lin(F.t[1].b)) return F;
  if (F.k === '^' && lin(F.b)) return F;
  const p = safe(() => polyOf(F, x));
  if (!p) return F;
  return polyToExpr(p.map((c, k) => (k ? c : q(0))), sym(x));
}
function safe<T>(f: () => T): T | null {
  try { return f(); } catch (err) { if (err instanceof CasError || err instanceof RangeError) return null; throw err; }
}
const derivML = (x: string, body: string, k?: number) =>
  k && k > 1 ? `<mfrac><msup><mi mathvariant="normal">d</mi><mn>${k}</mn></msup><mrow><mi mathvariant="normal">d</mi><msup>${mi(x)}<mn>${k}</mn></msup></mrow></mfrac>${body}` : `<mfrac><mi mathvariant="normal">d</mi><mrow><mi mathvariant="normal">d</mi>${mi(x)}</mrow></mfrac>${body}`;
const isRealSol = (s: Sol) => !s.approx || !s.approx.im.m || bfToNumber(s.approx.im) === 0 || Math.abs(bfToNumber(s.approx.im)) < 1e-30 * Math.max(1, Math.abs(bfToNumber(s.approx.re)));

/** Sum shown by rising powers, with + O(xⁿ). */
function seriesRow(all: Expr[], X: Expr, order: number, at: Expr): Row {
  const terms = all.filter(t => !isZero(t));
  if (!terms.length) terms.push(ZERO);
  const base = isZero(at) ? X : sub(X, at);
  // around a ≠ 0 a term can be a sum, (x − 1): bracketed, or 1 + x − 1 + … reads as something else
  const paren = (t: Expr) => terms.length > 1 && t.k === '+';
  const ml = terms.map((t, k) => {
    const m = paren(t) ? `<mrow>${mo('(')}${toML(t)}${mo(')')}</mrow>` : toML(t);
    if (k === 0) return m;
    return t.k === '*' && t.t[0].k === 'n' && qsign(t.t[0].v) < 0 ? `${mo('−')}${toML(neg(t))}` : `${mo('+')}${m}`;
  }).join('');
  const big = `${mo('+')}<mi mathvariant="script">O</mi>${mo('(')}<msup>${isZero(at) ? toML(X) : `<mrow>${mo('(')}${toML(base)}${mo(')')}</mrow>`}<mn>${order}</mn></msup>${mo(')')}`;
  return { ml: M(`${ml}${big}`), text: terms.map(t => (paren(t) ? `(${toText(t)})` : toText(t))).join(' + ').replace(/\+ −/g, '− ') + ` + O(${toText(pow(base, num(order)))})` };
}

// --- Solutions ---

function solutionRows(sols: Sol[], x: string): Row[] {
  return sols.map(s => {
    const lhs = mi(x);
    if (s.exact) {
      const e = s.exact;
      const fam = s.family;
      const shown = fam ? familyOrder(e) : toML(e);
      const kML = (k: bigint) => k < 0n ? `${mo('−')}<mn>${-k}</mn>` : `<mn>${k}</mn>`, kText = (k: bigint) => String(k).replace('-', '−');
      // k ≥ 0 for x = ln(kπ + π/2)
      const bound = s.kMin !== undefined ? ['≥', s.kMin] as const : s.kMax !== undefined ? ['≤', s.kMax] as const : null;
      const famML = fam ? `${mo(',')}<mspace width="0.4em"/>${mi('k')}${mo('∈')}<mi mathvariant="normal">ℤ</mi>${s.excludeK?.length ? `${mo('∖')}${mo('{')}${s.excludeK.map(kML).join(mo(','))}${mo('}')}` : ''}${bound ? `${mo(',')}<mspace width="0.4em"/>${mi('k')}${mo(bound[0])}${kML(bound[1])}` : ''}` : '';
      const note = [s.mult > 1 ? `pierwiastek ${s.mult}-krotny` : '', !fam && !isNum(e) && isConstant(e) ? shortApprox(e) : ''].filter(Boolean).join(', ');
      return { ml: M(`${lhs}${mo('=')}${shown}${famML}`), text: `${x} = ${toText(e)}${fam ? `, k ∈ ℤ${s.excludeK?.length ? ` ∖ {${s.excludeK.map(kText).join(', ')}}` : ''}${bound ? `, k ${bound[0]} ${kText(bound[1])}` : ''}` : ''}`, note: note || undefined };
    }
    const z = s.approx!;
    const d = complexDecimal(z, 20);
    return { ml: M(`${lhs}${mo('≈')}${d.ml}`), text: `${x} ≈ ${d.text}`, note: s.mult > 1 ? `pierwiastek ${s.mult}-krotny` : undefined };
  });
}
/** π/6 + 2kπ: the k terms last. */
function familyOrder(e: Expr): string {
  if (e.k !== '+') return toML(e);
  const withK = e.t.filter(t => !freeOf(t, 'k')), rest = e.t.filter(t => freeOf(t, 'k'));
  const ml = [...rest, ...withK].map((t, i) => {
    const neg_ = t.k === '*' && t.t[0].k === 'n' && qsign(t.t[0].v) < 0;
    if (i === 0) return toML(t);
    return neg_ ? `${mo('−')}${toML(neg(t))}` : `${mo('+')}${toML(t)}`;
  }).join('');
  return `<mrow>${ml}</mrow>`;
}
function complexDecimal(z: C, digits: number): { ml: string; text: string } {
  const re = Math.abs(bfToNumber(z.re)) > 0 ? z.re : null;
  const tiny = (v: typeof z.im) => !v.m || (re && bfToNumber(v) !== 0 && Math.abs(bfToNumber(v)) < 1e-40 * Math.abs(bfToNumber(re)));
  const fmt = (b: typeof z.re) => {
    const n = bfToNumber(b);
    if (!b.m) return decimalText(null);
    // a BigFloat refined well beyond `digits`: print by the exact rational
    const dec = numericValue(num(b.e >= 0 ? q(b.m << BigInt(b.e)) : q(b.m, 1n << BigInt(-b.e))), digits).re;
    void n;
    return decimalText(dec);
  };
  const r = fmt(z.re);
  if (tiny(z.im)) return r;
  const imAbs = { m: z.im.m < 0n ? -z.im.m : z.im.m, e: z.im.e };
  const i = fmt(imAbs);
  const sign = z.im.m < 0n ? '−' : '+';
  if (!z.re.m) return { ml: `${z.im.m < 0n ? mo('−') : ''}${i.ml}${mi('i')}`, text: `${z.im.m < 0n ? '−' : ''}${i.text}i` };
  return { ml: `${r.ml}${mo(sign)}${i.ml}${mi('i')}`, text: `${r.text} ${sign} ${i.text}i` };
}

function intervalRow(parts: Interval[], x: string): Row {
  if (!parts.length) return { ml: M(`${mi(x)}${mo('∈')}${mo('∅')}`), text: `${x} ∈ ∅` };
  const one = (iv: Interval) => {
    if (iv.lo && iv.hi && same(iv.lo, iv.hi)) return { ml: `${mo('{')}${toML(iv.lo)}${mo('}')}`, text: `{${toText(iv.lo)}}` };
    const l = iv.lo ? toML(iv.lo) : INF_ML('−'), h = iv.hi ? toML(iv.hi) : INF_ML('+');
    const lt = iv.lo ? toText(iv.lo) : '−∞', ht = iv.hi ? toText(iv.hi) : '+∞';
    return {
      ml: `<mrow><mo stretchy="false">${iv.loClosed ? '⟨' : '('}</mo>${l}${mo(';')}${h}<mo stretchy="false">${iv.hiClosed ? '⟩' : ')'}</mo></mrow>`,
      text: `${iv.loClosed ? '⟨' : '('}${lt}; ${ht}${iv.hiClosed ? '⟩' : ')'}`,
    };
  };
  const ps = parts.map(one);
  if (parts.length === 1 && !parts[0].lo && !parts[0].hi) return { ml: M(`${mi(x)}${mo('∈')}<mi mathvariant="normal">ℝ</mi>`), text: `${x} ∈ ℝ` };
  return { ml: M(`${mi(x)}${mo('∈')}${ps.map(p => p.ml).join(mo('∪'))}`), text: `${x} ∈ ${ps.map(p => p.text).join(' ∪ ')}` };
}

// --- Relations ---

function relation(node: Extract<Node, { t: 'rel' }>, env: Env, varsHint: string[] | null): Out {
  const parts = node.parts.map(p => scalar(evaluate(p, env), 'Równanie'));
  const ops = node.ops;
  if (ops.includes('->')) fail('Strzałka → ma sens w granicy: limit(f; x->a).');
  if (ops.length === 1 && ops[0] === '=') {
    const [l, r] = parts;
    const vs = variables(sub(l, r));
    // y = f(x): a function to look at, not an equation to solve
    if (!varsHint && isSym(l) && vs.length === 2 && vs.includes(l.n) && freeOf(r, l.n) && l.n !== 'x' && variables(r).length === 1) {
      const pods = expressionPods(r);
      return { pods, value: ex(r) };
    }
    const x = varsHint?.[0] ?? mainVar(sub(l, r));
    if (varsHint && varsHint.length > 1) return systemFromExprs([sub(l, r)], varsHint);
    return equationPods(l, r, x);
  }
  // a condition on two variables: the region of the plane where it holds
  if (!varsHint && variables(add(...parts)).length === 2 && !ops.includes('=')) {
    const [vx, vy] = twoVars(add(...parts));
    const SYMBOL: Record<string, string> = { '<=': '≤', '>=': '≥', '!=': '≠' };
    const text = parts.map((e, k) => (k ? ` ${SYMBOL[ops[k - 1]] ?? ops[k - 1]} ` : '') + toText(e)).join('');
    const row = { ml: M(parts.map((e, k) => (k ? mo(SYMBOL[ops[k - 1]] ?? ops[k - 1]) : '') + toML(e)).join('')), text };
    const plot = safe(() => regionPlot(parts, ops, vx, vy, text));
    return { pods: [{ title: 'Obszar', rows: [row], note: `Zbiór punktów (${vx}; ${vy}) spełniających warunek.` }, ...(plot ? [{ title: 'Wykres', rows: [], plot, note: 'Zacieniowany obszar; brzeg przerywany, gdy nierówność jest ostra, więc brzeg do obszaru nie należy.' }] : [])] };
  }
  // chains like 1 < x < 3 and single inequalities
  const x = varsHint?.[0] ?? mainVar(add(...parts));
  let res: Interval[] | null = null;
  let note: string | undefined;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op === '=') fail('Łańcuch z równością: rozdziel go na osobne warunki.');
    const r = solveInequality(sub(parts[k], parts[k + 1]), op, x);
    note = note ?? r.note;
    res = res ? intersect(res, r.parts) : r.parts;
    // (x − 1)/(x − 1) > 0 is 1 > 0 once built, but not at x = 1
    if (guardOf(x).length) res = intersect(res, domain(ONE, x).parts);
  }
  const pods: Pod[] = [{ title: 'Rozwiązanie', rows: [intervalRow(res!, x)], note }];
  if (parts.length === 2) {
    const zero = isZero(parts[1]);
    const plot = safe(() => plotOf(zero ? [parts[0]] : [parts[0], parts[1]], x, {
      hints: res!.flatMap(iv => [iv.lo, iv.hi]).filter(Boolean).map(e => approx(e!).re),
      bands: res!.map(iv => [iv.lo ? approx(iv.lo).re : -Infinity, iv.hi ? approx(iv.hi).re : Infinity]),
      find: zero ? [['zero']] : [], crossings: !zero,
      labels: zero ? [`y = ${toText(parts[0])}`] : [`lewa strona: y = ${toText(parts[0])}`, `prawa strona: y = ${toText(parts[1])}`],
    }));
    if (plot) pods.push({ title: 'Wykres', rows: [], plot, note: 'Zacieniowane: przedziały, na których nierówność jest spełniona.' });
  }
  return { pods };
}

function equationPods(l: Expr, r: Expr, x: string): Out {
  const f = sub(l, r);
  const set = zeroIntervals(f, x);
  if (set) return { pods: [{ title: 'Rozwiązanie', rows: [intervalRow(set, x)] }] };
  const res = zerosOf(f, x);
  const pods: Pod[] = [];
  if (res.kind === 'all') pods.push({ title: 'Rozwiązanie', rows: [textRow(`Równanie jest tożsamością: spełnia je każde ${x} z dziedziny.`)], note: res.note });
  else if (res.kind === 'none') pods.push({ title: 'Rozwiązanie', rows: [textRow('Brak rozwiązań.')], note: res.note });
  else {
    const real = res.sols.filter(isRealSol), complex = res.sols.filter(s => !isRealSol(s));
    if (real.length) pods.push({ title: complex.length ? 'Rozwiązania rzeczywiste' : 'Rozwiązania', rows: solutionRows(real.slice(0, 30), x), note: res.note ?? (real.length > 30 ? `Pokazano 30 z ${real.length}.` : undefined) });
    if (complex.length) pods.push({ title: real.length ? 'Rozwiązania zespolone' : 'Rozwiązania (zespolone)', rows: solutionRows(complex, x), note: real.length ? undefined : res.note });
    if (!real.length && !complex.length) pods.push({ title: 'Rozwiązanie', rows: [textRow('Brak rozwiązań.')] });
  }
  if (variables(f).length === 1) {
    const marks = res.kind === 'list' ? res.sols.filter(s => isRealSol(s) && !s.family && s.approx).map(s => bfToNumber(s.approx!.re)) : [];
    const zero = isZero(r), kind: MarkKind = zero ? 'zero' : 'cross';
    const plot = safe(() => plotOf(zero ? [l] : [l, r], x, {
      at: marks.map(v => ({ x: v, kind })), find: zero ? [['zero']] : [], crossings: !zero,
      labels: zero ? [`y = ${toText(l)}`] : [`lewa strona: y = ${toText(l)}`, `prawa strona: y = ${toText(r)}`],
    }));
    if (plot) pods.push({ title: 'Wykres', rows: [], plot, note: zero ? undefined : 'Rozwiązania to miejsca, w których przecinają się wykresy obu stron.' });
    // complex solutions: where they lie on the plane
    if (res.kind === 'list' && res.sols.some(s => !isRealSol(s)) && res.sols.every(s => s.approx && !s.family)) {
      const zs = res.sols.map((s, k) => {
        const re = bfToNumber(s.approx!.re), im = bfToNumber(s.approx!.im);
        return { re, im, label: `${x}${res.sols.length > 1 ? subscript(k + 1) : ''} ≈ ${fmt(re)}${im < 0 ? ' − ' : ' + '}${fmt(Math.abs(im))}i` };
      });
      const L = zText(l, x), R = zText(r, x);
      const rp = safe(() => rootsPlot(zs, L && R ? `${L} = ${R}` : undefined));
      if (rp) pods.push({ title: 'Rozwiązania na płaszczyźnie zespolonej', rows: [], plot: rp });
    }
  } else if (variables(f).length === 2) {
    const [vx, vy] = twoVars(f);
    const plot = safe(() => implicitPlot([f], vx, vy, [`${toText(l)} = ${toText(r)}`], [], [[l, r]]));
    if (plot) pods.push({ title: 'Krzywa', rows: [], plot, note: `Wszystkie punkty (${vx}; ${vy}) spełniające równanie.` });
  }
  const p = polyOf(f, x);
  if (p && deg(p) >= 2) {
    const fa = safe(() => factorExpr(f));
    if (fa && !same(fa.e, expand(f))) pods.push({ title: 'Postać iloczynowa', rows: [{ ml: M(`${toML(fa.e)}${mo('=')}<mn>0</mn>`), text: `${toText(fa.e)} = 0` }] });
    if (deg(p) === 2) {
      const [c, b, a] = p.map(v => num(v));
      const delta = sub(pow(b, TWO), mul(num(4), a, c));
      pods.push({ title: 'Wyróżnik', rows: [eqRow('<mi>Δ</mi>', 'Δ', delta)] });
    }
  }
  return { pods };
}

function system(items: Node[], env: Env, varsHint: string[] | null): Out {
  const exprs = items.map(n => {
    if (n.t !== 'rel' || n.ops.length !== 1 || n.ops[0] !== '=') fail('Układ składa się z równań (ze znakiem =).');
    const [l, r] = (n as { parts: Node[] }).parts.map(p => scalar(evaluate(p, env), 'Równanie'));
    return sub(l, r);
  });
  return systemFromExprs(exprs, varsHint);
}
function systemFromExprs(exprs: Expr[], varsHint: string[] | null): Out {
  const chosen = chooseUnknowns(exprs);
  const vs = varsHint ?? chosen.unknowns;
  const params = [...new Set(exprs.flatMap(e => variables(e)))].filter(v => !vs.includes(v)).sort();
  if (!vs.length) fail('Układ nie ma niewiadomych.');
  const r = solveSystem(exprs, vs);
  const pods = systemPods(r, vs, params);
  if (vs.length === 2 && !params.length) {
    const [vx, vy] = vs.includes('x') && vs.includes('y') ? ['x', 'y'] : vs;
    const pts: [number, number][] = r.kind === 'solutions' ? r.list.flatMap(sol => {
      const z = sol.map(v => safe(() => approx(v)));
      const [a, b] = vx === vs[0] ? z : [z[1], z[0]];
      return a && b && Math.abs(a.im) < 1e-12 && Math.abs(b.im) < 1e-12 ? [[a.re, b.re] as [number, number]] : [];
    }) : [];
    const plot = safe(() => implicitPlot(exprs, vx, vy, exprs.map(e => `${toText(e)} = 0`), pts));
    if (plot) pods.push({ title: 'Wykres', rows: [], plot, note: 'Rozwiązania układu to punkty wspólne krzywych.' });
  }
  return { pods };
}
const subscript = (k: number) => String(k).replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[+d]);
/** The two variables of e as (horizontal, vertical): x and y when present, else in order. */
function twoVars(e: Expr): [string, string] {
  const vs = variables(e);
  if (vs.includes('x') && vs.includes('y')) return ['x', 'y'];
  if (vs.includes('y')) return [vs.find(v => v !== 'y')!, 'y'];
  return [vs[0], vs[1]];
}
/** The solution card, the parametric discussion (special values of a parameter) and which letters are which. */
function systemPods(r: SystemResult, vs: string[], params: string[]): Pod[] {
  const main = systemPod(r, vs, params);
  const notes = [main.note];
  if (params.length) notes.push(`Niewiadome: ${vs.join(', ')}; parametr${params.length > 1 ? 'y' : ''}: ${params.join(', ')}. Inne niewiadome wskażesz tak: solve(…; {${params.slice(0, 2).join(', ')}}).`);
  const cases = 'cases' in r ? r.cases ?? [] : [];
  const when = 'when' in r ? r.when : undefined;
  if (when) {
    const [p] = variables(when);
    const W = toText(factorExpr(when).e), alt = toText(factorExpr(neg(when)).e), cond = alt.length < W.length ? alt : W;
    notes.unshift(cases.length && variables(when).length === 1
      ? `Dla ${p} ∉ {${cases.map(c => toText(c.at[1])).join('; ')}} (wtedy wyznacznik główny W = ${W} ≠ 0).`
      : `Gdy ${cond} ≠ 0 (wyznacznik główny układu).`);
  }
  main.note = notes.filter(Boolean).join(' ') || undefined;
  const pods = [main];
  if (cases.length) {
    pods.push({
      title: 'Przypadki szczególne',
      rows: cases.map(c => {
        const sub_ = systemPod(c.result, vs, params);
        const head = `${c.at[0]} = ${toText(c.at[1])}`;
        const body = c.result.kind === 'none' ? 'układ sprzeczny (brak rozwiązań)'
          : c.result.kind === 'param' ? `nieskończenie wiele rozwiązań: ${sub_.rows.map(r => r.text).join(', ')}`
          : sub_.rows.map(r => r.text).join('; ');
        return textRow(`${head}: ${body}`);
      }),
      note: 'Wartości parametru, przy których ogólny wzór nie działa (wyznacznik główny W = 0 albo sprzeczność znika); układ rozwiązany dla nich osobno.',
    });
  }
  return pods;
}
function systemPod(r: SystemResult, vs: string[], params: string[] = []): Pod {
  if (r.kind === 'none') return { title: 'Rozwiązanie', rows: [textRow('Układ jest sprzeczny: brak rozwiązań.')], note: r.note };
  if (r.kind === 'unknown') return { title: 'Rozwiązanie', rows: [textRow(r.note)] };
  if (r.kind === 'param') {
    const rows = vs.map((v, k) => r.free.includes(v) ? { ml: M(`${mi(v)}${mo('∈')}<mi mathvariant="normal">ℝ</mi>`), text: `${v} ∈ ℝ` } : eqRow(mi(v), v, r.values[k]));
    return { title: 'Rozwiązanie', rows, note: [`Nieskończenie wiele rozwiązań (zmienn${r.free.length > 1 ? 'e swobodne' : 'a swobodna'}: ${r.free.join(', ')}).`, r.note].filter(Boolean).join(' ') };
  }
  // k is the index of a family of periodic solutions unless it is one of the letters of the system
  const family = !vs.includes('k') && !params.includes('k') && r.list.some(sol => sol.some(v => !freeOf(v, 'k')));
  const kML = `${mo(',')}<mspace width="0.6em"/>${mi('k')}${mo('∈')}<mi mathvariant="normal">ℤ</mi>`;
  const rows = r.list.map(sol => {
    const fam = family && sol.some(v => !freeOf(v, 'k'));
    return {
      ml: M(sol.map((v, k) => `${mi(vs[k])}${mo('=')}${toML(v)}`).join(`${mo(',')}<mspace width="0.6em"/>`) + (fam ? kML : '')),
      text: sol.map((v, k) => `${vs[k]} = ${toText(v)}`).join(', ') + (fam ? ', k ∈ ℤ' : ''),
      note: sol.some(v => isConstant(v) && !isNum(v)) ? sol.map((v, k) => (isNum(v) || !isConstant(v) ? '' : `${vs[k]} ${shortApprox(v)}`)).filter(Boolean).join(', ') : undefined,
    };
  });
  return { title: r.list.length > 1 ? 'Rozwiązania' : 'Rozwiązanie', rows, note: r.note };
}

// --- Matrices and lists ---

function matML(m: Expr[][], cell: (e: Expr) => string = toML): string {
  return `<mrow>${mo('[')}<mtable>${m.map(r => `<mtr>${r.map(c => `<mtd>${cell(c)}</mtd>`).join('')}</mtr>`).join('')}</mtable>${mo(']')}</mrow>`;
}
const matText = (m: Expr[][], cell: (e: Expr) => string = toText) => `[${m.map(r => `[${r.map(cell).join(', ')}]`).join(', ')}]`;
/** More than 8 columns, 10 rows or 64 entries: a table of entries, not a typeset matrix that would run off the card. */
const tooLarge = (m: Expr[][]) => m.length > 10 || (m[0]?.length ?? 0) > 8 || m.length * (m[0]?.length ?? 0) > 64;
const GRID_ROWS = 200;
/** A matrix as a row of a card; ap: its entries are approximate (≈, MATLAB's short format, full digits when copied). */
const matRow = (m: Expr[][], lhs = '', lhsText = '', ap = false): Row => {
  const rel = ap ? '≈' : '=', text = `${lhsText ? `${lhsText} ${rel} ` : ''}${matText(m, ap ? e => approxText(e, true) : toText)}`;
  if (tooLarge(m)) return { ml: '', text, grid: m.slice(0, GRID_ROWS).map(r => r.map(ap ? e => approxText(e) : toText)), note: `${m.length}×${m[0].length}${ap ? ', ≈' : ''}${m.length > GRID_ROWS ? `, pokazuję ${GRID_ROWS} pierwszych wierszy` : ''}` };
  return { ml: M(`${lhs}${lhs || ap ? mo(rel) : ''}${matML(m, ap ? approxML : toML)}`), text };
};

// --- Approximate numbers (≈): shown as MATLAB's short format, copied with all their digits ---

const APPROX_NOTE = 'Wartości przybliżone: liczone w arytmetyce zmiennoprzecinkowej podwójnej precyzji, jak w MATLAB-ie.';
/** The real and imaginary part of an approximate number, as doubles. */
function doubles(e: Expr): [number, number] {
  if (isNum(e)) return [qToNumber(e.v), 0];
  const s = infSign(e);
  if (s) return [s * Infinity, 0];
  const p = complexParts(e);
  if (p && isNum(p[0]) && isNum(p[1])) return [qToNumber(p[0].v), qToNumber(p[1].v)];
  const z = approx(e);
  return [z.re, z.im];
}
/** 5 significant digits (all of them with full), small and large numbers with a power of ten. */
function shortNum(x: number, full = false): { text: string; ml: string } {
  if (Number.isNaN(x)) return { text: 'NaN', ml: mi('NaN') };
  if (!Number.isFinite(x)) return { text: x > 0 ? '∞' : '−∞', ml: x > 0 ? mi('∞') : INF_ML('−') };
  if (x === 0) return { text: '0', ml: '<mn>0</mn>' };
  const neg = x < 0, ax = Math.abs(x);
  let mant: string, exp = 0;
  if (full) {
    const s = String(ax), k = s.indexOf('e');
    [mant, exp] = k < 0 ? [s, 0] : [s.slice(0, k), Number(s.slice(k + 1))];
  } else if (Number.isInteger(ax) && ax < 1e10) mant = String(ax);
  else if (ax >= 1e-4 && ax < 1e5) mant = String(Number(ax.toPrecision(5)));
  else { const [m, e] = ax.toExponential(4).split('e'); mant = String(Number(m)); exp = Number(e); }
  return {
    text: `${neg ? '−' : ''}${mant}${exp ? `e${exp}` : ''}`,
    ml: `${neg ? mo('−') : ''}<mn>${mant.replace('.', ',')}</mn>${exp ? `${mo('·')}<msup><mn>10</mn><mn>${String(exp).replace('-', '−')}</mn></msup>` : ''}`,
  };
}
function approxText(e: Expr, full = false): string {
  const [re, im] = doubles(e);
  if (!im) return shortNum(re, full).text;
  const r = shortNum(re, full).text, i = shortNum(Math.abs(im), full).text;
  return `${re ? `${r} ${im < 0 ? '−' : '+'} ` : im < 0 ? '−' : ''}${i}i`;
}
function approxML(e: Expr): string {
  const [re, im] = doubles(e);
  if (!im) return shortNum(re).ml;
  return `<mrow>${re ? `${shortNum(re).ml}${mo(im < 0 ? '−' : '+')}` : im < 0 ? mo('−') : ''}${shortNum(Math.abs(im)).ml}${mi('i')}</mrow>`;
}
function approxNumberPods(e: Expr): Pod[] {
  const short = approxText(e), full = approxText(e, true);
  return [{ title: 'Wynik', rows: [{ ml: M(`${mo('≈')}${approxML(e)}`), text: full, note: short !== full ? `dokładniej ${full}` : undefined }], note: APPROX_NOTE }];
}
function approxMatrixPods(m: Expr[][]): Pod[] {
  const [n, k] = dims(m);
  const pods: Pod[] = [{ title: 'Macierz', rows: [matRow(m, '', '', true)], note: `wymiar ${n}×${k}. ${APPROX_NOTE}` }];
  const M_ = safe(() => toMat(m));
  if (!M_) return pods;
  const S = DN.svd(M_).S, r = DN.rank(M_, S);
  const rows: Row[] = [{ ml: M(`${mtext('rząd (numeryczny)')}${mo(':')}<mspace width="0.4em"/><mn>${r}</mn>`), text: `rząd (numeryczny): ${r}` }];
  if (n === k) {
    rows.push({ ml: M(`${mtext('wyznacznik')}${mo(':')}<mspace width="0.4em"/>${mo('≈')}${shortNum(DN.det(M_)).ml}`), text: `wyznacznik: ${shortNum(DN.det(M_), true).text}` });
    const c = S[S.length - 1] > 0 ? S[0] / S[S.length - 1] : Infinity;
    rows.push({ ml: M(`${mtext('wskaźnik uwarunkowania')}${mo(':')}<mspace width="0.4em"/>${Number.isFinite(c) ? mo('≈') : ''}${shortNum(c).ml}`), text: `wskaźnik uwarunkowania: ${shortNum(c, true).text}` });
  }
  pods.push({ title: 'Własności (numerycznie)', rows });
  return pods;
}

/** The cards of a matrix function (linalg.ts), each row name = value. */
function linalgOut(r: Linalg): Out {
  const valueRow = (lhs: string, v: Value): Row => {
    const ap = isApprox(v), rel = ap ? '≈' : '=';
    const lhsML = !lhs ? '' : lhs.length === 1 ? mi(lhs) : `<mi mathvariant="normal">${lhs.replace(/[&<>]/g, c => `&#${c.charCodeAt(0)};`)}</mi>`;
    if (v.t === 'matrix') {
      const r = matRow(v.rows, lhsML, lhs, ap), flat = v.rows.flat();
      // exact roots and the like: their decimals beside them, for a sense of size
      if (!ap && !r.grid && flat.length <= 8 && flat.every(isConstant) && flat.some(e => !isNum(e))) r.note = `≈ [${v.rows.map(row => row.map(e => approxText(e).replace('.', ',')).join(' ')).join('; ')}]`;
      return r;
    }
    if (v.t === 'expr') return { ml: M(`${lhsML}${lhs || ap ? mo(rel) : ''}${ap ? approxML(v.e) : toML(v.e)}`), text: `${lhs ? `${lhs} ${rel} ` : ''}${ap ? approxText(v.e, true) : toText(v.e)}` };
    return { ml: M(`${lhsML}${lhs || ap ? mo(rel) : ''}${valueML(v)}`), text: `${lhs ? `${lhs} ${rel} ` : ''}${valueText(v)}` };
  };
  return { pods: r.cards.map(c => ({ title: c.title, rows: c.rows.map(([lhs, v]) => valueRow(lhs, v)), note: c.note, ...(c.plot ? { plot: c.plot } : {}) })), value: r.outputs[0], outputs: r.outputs };
}

function matrixPods(m: Expr[][]): Pod[] {
  const [n, k] = dims(m);
  const pods: Pod[] = [{ title: 'Macierz', rows: [matRow(m.map(r => r.map(c => safe(() => simplify(c)) ?? c)))], note: `wymiar ${n}×${k}` }];
  const rk = safe(() => LA.rank(m));
  if (rk !== null) pods.push({ title: 'Rząd', rows: [textRow(String(rk))] });
  if (n === k) {
    const d = safe(() => LA.det(m));
    if (d) pods.push({ title: 'Wyznacznik', rows: [row(simplify(d), isConstant(d) && !isNum(d) ? shortApprox(d) : undefined)] });
    pods.push({ title: 'Ślad', rows: [row(simplify(LA.trace(m)))] });
    if (d && !isZero(expand(d)) && n <= 8) {
      const inv = safe(() => LA.inverse(m));
      if (inv) pods.push({ title: 'Macierz odwrotna', rows: [matRow(inv.map(r => r.map(c => safe(() => simplify(c)) ?? c)), '<msup><mi>A</mi><mn>−1</mn></msup>', 'A⁻¹')] });
    } else if (d) pods.push({ title: 'Macierz odwrotna', rows: [textRow('Nie istnieje: macierz jest osobliwa (det = 0).')] });
    if (n <= 10) {
      const cp = safe(() => LA.charpoly(m));
      if (cp) {
        pods.push({ title: 'Wielomian charakterystyczny', rows: [{ ml: M(`<mi>det</mi>${mo('(')}<mi>λ</mi><mi>I</mi>${mo('−')}<mi>A</mi>${mo(')')}${mo('=')}${toML(cp)}`), text: toText(cp) }] });
        const ev = eigen(m, cp);
        if (ev) pods.push(...ev);
      }
    }
  }
  if (n === 2 && k === 2 && m.flat().every(isConstant)) {
    const v = m.flat().map(c => safe(() => approx(c)));
    if (v.every(z => z && Math.abs(z.im) < 1e-12)) {
      const plot = safe(() => matrixPlot(v[0]!.re, v[1]!.re, v[2]!.re, v[3]!.re));
      if (plot) pods.push({ title: 'Przekształcenie płaszczyzny', rows: [], plot, note: 'Obraz kwadratu jednostkowego, wektorów bazy i prostych własnych (kierunków, które A tylko rozciąga).' });
    }
  }
  pods.push({ title: 'Macierz transponowana', rows: [matRow(LA.transpose(m), '<msup><mi>A</mi><mi>T</mi></msup>', 'Aᵀ')] });
  const r = safe(() => LA.rref(m));
  if (r) pods.push({ title: 'Postać schodkowa zredukowana', rows: [matRow(r.R)] });
  return pods;
}

function eigen(m: Expr[][], cp: Expr): Pod[] | null {
  const p = polyOf(cp, 'λ');
  if (!p) return null;
  const roots = solvePoly(p);
  const rows: Row[] = [], vecRows: Row[] = [];
  for (const r of roots) {
    const lam = r.exact;
    rows.push(lam ? { ml: M(`<mi>λ</mi>${mo('=')}${toML(lam)}`), text: `λ = ${toText(lam)}`, note: [r.mult > 1 ? `krotność ${r.mult}` : '', !isNum(lam) ? shortApprox(lam) : ''].filter(Boolean).join(', ') || undefined }
      : { ml: M(`<mi>λ</mi>${mo('≈')}${complexDecimal(r.approx, 16).ml}`), text: `λ ≈ ${complexDecimal(r.approx, 16).text}`, note: r.mult > 1 ? `krotność ${r.mult}` : undefined });
    if (lam && (isNum(lam) || size(lam) < 12)) {
      const shifted = m.map((row_, i) => row_.map((v, j) => (i === j ? sub(v, lam) : v)));
      const ns = safe(() => LA.nullspace(shifted));
      if (ns && ns.length) {
        for (const v of ns) {
          // check A v = λ v numerically before showing it
          const Av = matMul(m, v.map(c => [c])).map(c => c[0]);
          const ok = Av.every((c, i) => { const d = approx(sub(c, mul(lam, v[i]))); return Math.hypot(d.re, d.im) < 1e-9; });
          if (ok) vecRows.push({ ml: M(`<mi>λ</mi>${mo('=')}${toML(lam)}${mo(':')}<mspace width="0.5em"/>${matML(v.map(c => [simplify(c)]))}`), text: `λ = ${toText(lam)}: (${v.map(c => toText(simplify(c))).join(', ')})` });
        }
      }
    }
  }
  const out: Pod[] = [{ title: 'Wartości własne', rows }];
  if (vecRows.length) out.push({ title: 'Wektory własne', rows: vecRows });
  return out;
}

const LIST_SHOWN = 40;
function listPods(v: Extract<Value, { t: 'list' }>): Pod[] {
  const items = v.items;
  if (!items.every(i => i.t === 'expr')) return [{ title: 'Lista', rows: [textRow(items.map(valueText).join('; '))] }];
  const xs = items.map(i => (i as { e: Expr }).e), ap = isApprox(v);
  const ml = ap ? approxML : toML, text = ap ? (e: Expr) => approxText(e, true) : toText;
  // a long list (1:1000) is shown by its beginning and end; all of it is in the copied text
  const shown = xs.length > LIST_SHOWN ? [...xs.slice(0, LIST_SHOWN - 4).map(ml), mi('…'), ...xs.slice(-3).map(ml)] : xs.map(ml);
  const note = [xs.length > LIST_SHOWN ? `${xs.length} elementów` : '', ap ? APPROX_NOTE : ''].filter(Boolean).join('. ') || undefined;
  const pods: Pod[] = [{ title: v.set ? 'Zbiór' : 'Lista', rows: [{ ml: M(`${ap ? mo('≈') : ''}${mo(v.set ? '{' : '[')}${shown.join(mo(';'))}${mo(v.set ? '}' : ']')}`), text: `${v.set ? '{' : '['}${xs.map(text).join('; ')}${v.set ? '}' : ']'}` }], note }];
  if (!ap && !v.logical && xs.length >= 2 && xs.length <= 5000 && xs.every(isConstant) && xs.every(x => constSign(x) !== null)) pods.push(...statsPods(xs));
  return pods;
}
const valueText = (v: Value): string => v.t === 'expr' ? (v.approx ? approxText(v.e, true) : toText(v.e)) : v.t === 'list' ? `${v.set ? '{' : '['}${v.items.map(valueText).join('; ')}${v.set ? '}' : ']'}` : v.t === 'matrix' ? matText(v.rows, v.approx ? e => approxText(e, true) : toText)
  : v.t === 'fn' ? `(${v.params.join(', ')}) ↦ ${valueText(v.body)}` : v.t === 'str' ? `'${v.s}'` : v.parts.map(toText).join(` ${v.ops[0]} `);

function sortedConst(xs: Expr[]): Expr[] {
  return [...xs].sort((a, b) => constSign(sub(a, b)) ?? 0);
}
function statsPods(xs: Expr[]): Pod[] {
  const n = xs.length;
  const total = add(...xs), mean = div(total, num(n));
  const sorted = sortedConst(xs);
  const median = n % 2 ? sorted[(n - 1) / 2] : div(add(sorted[n / 2 - 1], sorted[n / 2]), TWO);
  const ss = add(...xs.map(x => pow(sub(x, mean), TWO)));
  const varPop = simplify(div(ss, num(n))), varSample = simplify(div(ss, num(n - 1)));
  const r = (title: string, e: Expr) => ({ ml: M(`${mtext(title)}${mo(':')}<mspace width="0.4em"/>${toML(e)}`), text: `${title}: ${toText(e)}`, note: isNum(e) ? undefined : shortApprox(e) });
  return [{
    title: 'Statystyki',
    rows: [
      r('liczba elementów', num(n)), r('suma', simplify(total)), r('średnia', simplify(mean)), r('mediana', simplify(median)),
      r('minimum', sorted[0]), r('maksimum', sorted[n - 1]),
      r('wariancja (populacji)', varPop), r('wariancja (próby)', varSample),
      r('odchylenie standardowe (populacji)', simplify(sqrt(varPop))), r('odchylenie standardowe (próby)', simplify(sqrt(varSample))),
    ],
  }, { title: 'Posortowane', rows: [{ ml: M(sorted.map(toML).join(mo('≤'))), text: sorted.map(toText).join(' ≤ ') }] }, ...histogram(xs)];
}
function histogram(xs: Expr[]): Pod[] {
  const plot = safe(() => statsPlot(xs.map(x => approx(x).re)));
  return plot ? [{ title: 'Histogram', rows: [], plot, note: 'Zacieniowany pas: średnia ± odchylenie standardowe (populacji).' }] : [];
}

// --- Plots ---

function interestingPoints(e: Expr, x: string): number[] {
  const out: number[] = [];
  const z = safe(() => solveEquation(e, x));
  if (z && z.kind === 'list') for (const s of z.sols) if (!s.family && s.approx && isRealSol(s)) out.push(bfToNumber(s.approx.re));
  return out.filter(v => Number.isFinite(v) && Math.abs(v) < 1e6);
}

// --- Commands ---

/** An argument naming a variable (x), or null. */
const varArg = (n: Node | undefined): string | null => n?.t === 'id' && n.n.length === 1 ? n.n : null;
const exprArg = (n: Node, env: Env, what = 'Argument') => scalar(evaluate(n, env), what);
const intArg = (n: Node | undefined, env: Env, what: string, fallback?: number): number => {
  if (!n) { if (fallback === undefined) fail(`${what}: brak argumentu.`); return fallback!; }
  const e = exprArg(n, env, what);
  if (!isInt(e) || bitLength(e.v.n) > 50) fail(`${what}: oczekuję liczby całkowitej.`);
  return Number((e as { v: Q }).v.n);
};
const bigArg = (n: Node, env: Env, what: string): bigint => {
  const e = exprArg(n, env, what);
  if (!isInt(e)) fail(`${what}: oczekuję liczby całkowitej.`);
  return (e as { v: Q }).v.n;
};
const listArg = (n: Node, env: Env): Expr[] => {
  const v = evaluate(n, env);
  if (v.t === 'list') return v.items.map(i => scalar(i, 'Lista'));
  if (v.t === 'matrix') return v.rows.flat();
  return [scalar(v, 'Lista')];
};
const matArg = (n: Node, env: Env): Expr[][] => {
  const v = evaluate(n, env);
  if (v.t === 'matrix') return v.rows;
  if (v.t === 'list' && v.items.every(i => i.t === 'expr')) return [v.items.map(i => (i as { e: Expr }).e)];
  return fail('Oczekuję macierzy, np. [[1, 2], [3, 4]].');
};
const vecArg = (n: Node, env: Env): Expr[] => {
  const v = evaluate(n, env);
  if (v.t === 'list') return v.items.map(i => scalar(i, 'Wektor'));
  if (v.t === 'matrix' && (v.rows.length === 1 || v.rows[0].length === 1)) return v.rows.flat();
  return fail('Oczekuję wektora, np. [1, 2, 3].');
};
const statsArgs = (args: Node[], env: Env) => args.length === 1 ? listArg(args[0], env) : args.map(a => exprArg(a, env));
const one = (title: string, e: Expr, note?: string): Out => ({ pods: [{ title, rows: [row(e, note ?? (isConstant(e) && !isNum(e) ? shortApprox(e) : undefined))] }], value: ex(e) });

/** The argument a command binds as its variable: the x of diff(f, x), integrate(f, x, 0, 1), sum(f, k, 1, n). */
const BINDS: Record<string, number> = { diff: 1, integrate: 1, limit: 1, taylor: 1, sum: 1, product: 1, solve: 1, roots: 1, subst: 1, analyze: 1, extrema: 1, domain: 1 };
/** The variables a command binds: they stay symbols even when the workspace gives the letter a value. */
function bound(name: string, args: Node[]): string[] {
  const out: string[] = [];
  const walk = (n: Node | undefined) => {
    if (!n) return;
    if (n.t === 'id') out.push(n.n);
    else if (n.t === 'rel' && n.parts[0].t === 'id') out.push(n.parts[0].n);
    else if (n.t === 'list') n.items.forEach(walk);
  };
  if (Object.hasOwn(BINDS, name)) walk(args[BINDS[name]]);
  return out;
}

/** MATLAB's functions on vectors and matrices (arrays.ts); null when sum, diff, mean … mean what they meant before (Σ, d/dx). */
function arrayCommand(name: string, args: Node[], env: Env, nout: number): Out | null {
  const overloaded = ['sum', 'product', 'diff', 'mean', 'median', 'sort'].includes(name);
  const vals = overloaded ? safe(() => args.map(a => evaluate(a, env))) : args.map(a => evaluate(a, env));
  if (!vals || !arrayReading(name, vals)) return null;
  const r = ARRAYS[name](vals);
  // computed from approximate numbers, approximate; sizes, places and answers yes/no are counts
  const value = vals.some(isApprox) && !['size', 'numel', 'length', 'isempty', 'find', 'any', 'all'].includes(name) ? approxOf(r.value) : r.value;
  const first = valuePods(value).pods[0];
  const outputs = nout < 2 ? [value] : name === 'size' ? (grid_(value).flat().map(e => ex(e))) : name === 'sort' ? [value, sortPlaces(vals)] : [value];
  return { pods: [{ ...first, title: r.title, note: r.note ?? first.note }], value, outputs };
}
const approxOf = (v: Value): Value => (v.t === 'expr' || v.t === 'list' || v.t === 'matrix' ? approxValueOf(v) : v);
const grid_ = (v: Value): Expr[][] => (v.t === 'list' ? [v.items.map(i => (i as { e: Expr }).e)] : v.t === 'matrix' ? v.rows : v.t === 'expr' ? [[v.e]] : []);

function command(name: string, args: Node[], env0: Env, nout = 1): Out {
  const env = shadow(env0, bound(name, args));
  if (Object.hasOwn(ARRAYS, name)) {
    const r = arrayCommand(name, args, env, nout);
    if (r) return r;
  }
  if (Object.hasOwn(LINALG, name)) {
    const r = LINALG[name](args.map(a => evaluate(a, env)), nout);
    if (r) return linalgOut(r);
  }
  if (Object.hasOwn(DATAFIT, name)) {
    // fit(x, y, a*exp(b*x)): the model's letters are its own (x and the parameters), whatever the workspace holds
    const read = (a: Node, k: number) => evaluate(a, name === 'fit' && k === 2 ? shadow(env, letters(a)) : env);
    const vals = name === 'roots' ? safe(() => args.map(read)) : args.map(read);
    const r = vals && DATAFIT[name](vals, nout);
    if (r) return linalgOut(r);
  }
  switch (name) {
    case 'clear': return clearCommand(args);
    case 'who': return whoCommand();
    case 'simplify': { const e = simplify(exprArg(args[0], env)); return one('Postać uproszczona', e); }
    case 'expand': { const e = expand(exprArg(args[0], env)); return one('Postać rozwinięta', e); }
    case 'together': { const e = together(exprArg(args[0], env)); return one('Wspólny mianownik', e); }
    case 'cancel': { const e = cancel(together(exprArg(args[0], env))); return one('Po skróceniu', e); }
    case 'numer': return one('Licznik', numDen(together(exprArg(args[0], env)))[0]);
    case 'denom': return one('Mianownik', numDen(together(exprArg(args[0], env)))[1]);
    case 'trigexpand': return one('Rozwinięcie trygonometryczne', simplify(trigExpand(exprArg(args[0], env))));
    case 'trigreduce': return one('Postać liniowa (bez potęg sin i cos)', trigLinearize(exprArg(args[0], env)));
    case 'expandlog': return one('Rozwinięte logarytmy', expandLog(exprArg(args[0], env)), 'Dla dodatnich argumentów logarytmów.');
    case 'factor': return factorCommand(args, env);
    case 'apart': return apartCommand(args, env);
    case 'solve': case 'roots': return solveCommand(args, env);
    case 'diff': return diffCommand(args, env);
    case 'integrate': return integrateCommand(args, env);
    case 'limit': return limitCommand(args, env);
    case 'taylor': return taylorCommand(args, env);
    case 'sum': case 'product': return sumCommand(name, args, env);
    case 'approx': {
      const e = exprArg(args[0], env);
      const d = intArg(args[1], env, 'Liczba cyfr', digitsDefault);
      if (d < 1 || d > 5000) fail('Liczba cyfr musi być od 1 do 5000.');
      if (!isConstant(e)) fail('Przybliżenie dziesiętne liczę dla wyrażeń bez zmiennych.');
      const r = decimalRow(e, d);
      if (!r) fail('Tego wyrażenia nie da się obliczyć numerycznie.');
      return { pods: [{ title: `Wartość z dokładnością do ${d} cyfr znaczących`, rows: [r!] }], value: ex(e) };
    }
    case 'subst': {
      const e = exprArg(args[0], env);
      let v: string, to: Expr;
      if (args[1].t === 'rel' && args[1].ops[0] === '=') { v = varArg(args[1].parts[0]) ?? fail('Podstawienie: zapisz je jako x = wartość.'); to = exprArg(args[1].parts[1], env); }
      else { v = varArg(args[1]) ?? fail('Drugim argumentem ma być zmienna.'); to = exprArg(args[2] ?? fail('Brak wartości do podstawienia.'), env); }
      const r = subst(e, v, to);
      const s = safe(() => simplify(r)) ?? r;
      if (isConstant(s)) return { pods: numberPods(s), value: ex(s) };
      return one('Po podstawieniu', s);
    }
    case 'domain': {
      const e = exprArg(args[0], env), x = varArg(args[1]) ?? mainVar(e);
      const d = domain(e, x);
      return { pods: [{ title: 'Dziedzina', rows: [intervalRow(d.parts, x)], note: d.note }] };
    }
    case 'analyze': return analyzeCommand(args, env);
    case 'plot': return plotCommand(args, env);
    case 'extrema': return analyzeCommand(args, env, true);
    case 'tangent': {
      const e = exprArg(args[0], env);
      const x = args.length === 3 ? varArg(args[1]) ?? 'x' : mainVar(e);
      const at = exprArg(args[args.length - 1], env, 'Punkt');
      const y0 = simplify(subst(e, x, at)), k = simplify(subst(diff(e, x), x, at));
      const line = simplify(add(mul(k, sub(sym(x), at)), y0));
      const A = approx(at).re;
      const plot = safe(() => plotOf([e, line], x, { at: [{ x: A, kind: 'point', label: `punkt styczności (${fmt(A)}; ${fmt(approx(y0).re)})` }], dash: [false, true], labels: [`y = ${toText(e)}`, `styczna: y = ${toText(line)}`] }));
      return { pods: [{ title: 'Styczna', rows: [eqRow(mi('y'), 'y', line)], note: `Punkt styczności: (${toText(at)}; ${toText(y0)}), współczynnik kierunkowy ${toText(k)}.` }, ...(plot ? [{ title: 'Wykres', rows: [], plot }] : [])], value: ex(line) };
    }
    // number theory
    case 'isprime': {
      const n = bigArg(args[0], env, 'Liczba');
      const p = NT.primality(n);
      const txt = p === 'prime' ? `${n} jest liczbą pierwszą.` : p === 'probable' ? `${n} jest liczbą pierwszą według testu BPSW (nie znaleziono liczby złożonej, która by go przeszła).` : `${n} nie jest liczbą pierwszą.`;
      const pods: Pod[] = [{ title: 'Czy pierwsza?', rows: [textRow(p === 'composite' ? 'Nie' : 'Tak')], note: txt }];
      if (p === 'composite' && n > 1n) pods.push(...integerPods(n).slice(0, 1));
      return { pods };
    }
    case 'nextprime': return one('Następna liczba pierwsza', num(NT.nextPrime(bigArg(args[0], env, 'Liczba'))));
    case 'prevprime': return one('Poprzednia liczba pierwsza', num(NT.prevPrime(bigArg(args[0], env, 'Liczba'))));
    case 'prime': return one('Liczba pierwsza o tym numerze', num(NT.nthPrime(intArg(args[0], env, 'Numer'))));
    case 'primepi': return one('Liczba liczb pierwszych ≤ x', num(NT.primePi(bigArg(args[0], env, 'Liczba'))));
    case 'factorint': return { pods: integerPods(bigArg(args[0], env, 'Liczba')).slice(0, 1) };
    case 'gcd': case 'lcm': return gcdCommand(name, args, env);
    case 'divisors': {
      const n = bigArg(args[0], env, 'Liczba');
      const ds = NT.divisors(n);
      return { pods: [{ title: `Dzielniki (${ds.length})`, rows: [textRow(ds.join(', '))] }], value: { t: 'list', items: ds.map(d => ex(num(d))), set: true } };
    }
    case 'totient': return one('Funkcja φ Eulera', num(NT.totient(bigArg(args[0], env, 'Liczba'))));
    case 'sigma': return one('Suma dzielników σ', num(NT.sigma(bigArg(args[0], env, 'Liczba'), args[1] ? bigArg(args[1], env, 'Wykładnik') : 1n)));
    case 'mobius': return one('Funkcja Möbiusa μ', num(NT.mobius(bigArg(args[0], env, 'Liczba'))));
    case 'fibonacci': return one('Liczba Fibonacciego', num(NT.fibonacci(bigArg(args[0], env, 'Numer'))));
    case 'lucas': return one('Liczba Lucasa', num(NT.lucas(bigArg(args[0], env, 'Numer'))));
    case 'catalan': { const n = bigArg(args[0], env, 'Numer'); if (n < 0n) fail('Numer musi być nieujemny.'); return one('Liczba Catalana', num(binomialBig(2n * n, n) / (n + 1n))); }
    case 'powmod': {
      const [a, b, m] = args.map((x, k) => bigArg(x, env, ['Podstawa', 'Wykładnik', 'Moduł'][k]));
      if (m <= 0n) fail('Moduł musi być dodatni.');
      return one(`Potęga modulo ${m}`, num(NT.modpow(a, b, m)));
    }
    case 'modinv': { const [a, m] = args.map(x => bigArg(x, env, 'Liczba')); return one(`Odwrotność modulo ${m}`, num(NT.modinv(a, m))); }
    case 'crt': {
      const as = listArg(args[0], env), ms = listArg(args[1], env);
      const toB = (e: Expr) => { if (!isInt(e)) fail('CRT: reszty i moduły muszą być całkowite.'); return (e as { v: Q }).v.n; };
      const [x, Mod] = NT.crt(as.map(toB), ms.map(toB));
      return { pods: [{ title: 'Rozwiązanie układu kongruencji', rows: [{ ml: M(`<mi>x</mi><mo>≡</mo><mn>${x}</mn><mspace width="0.4em"/><mo>(</mo><mi mathvariant="normal">mod</mi><mspace width="0.2em"/><mn>${Mod}</mn><mo>)</mo>`), text: `x ≡ ${x} (mod ${Mod})` }] }], value: ex(num(x)) };
    }
    case 'base': {
      const e = exprArg(args[0], env);
      const b = intArg(args[1], env, 'Podstawa');
      if (isInt(e)) return { pods: [{ title: `W systemie o podstawie ${b}`, rows: [{ ml: M(`<msub><mn>${NT.toBase(e.v.n, b)}</mn><mn>${b}</mn></msub>`), text: NT.toBase(e.v.n, b) }] }] };
      if (isNum(e)) {
        const d = NT.decimalExpansion(e.v, b, 2000);
        const frac = d.period ? `${d.pre}(${d.period})` : d.pre;
        return { pods: [{ title: `W systemie o podstawie ${b}`, rows: [textRow(`${d.int}${frac ? ',' + frac : ''}`)], note: d.periodLength === null ? 'Rozwinięcie ucięte po 2000 cyfrach.' : undefined }] };
      }
      return fail('Zamiana systemu: podaj liczbę wymierną.');
    }
    case 'digits': {
      const n = bigArg(args[0], env, 'Liczba');
      const b = args[1] ? intArg(args[1], env, 'Podstawa') : 10;
      const s = NT.toBase(n < 0n ? -n : n, b);
      const sum_ = [...s].reduce((acc, c) => acc + parseInt(c, 36), 0);
      return { pods: [{ title: 'Cyfry', rows: [textRow(s.split('').join(', ')), textRow(`liczba cyfr: ${s.length}, suma cyfr: ${sum_}`)] }] };
    }
    case 'contfrac': {
      const e = exprArg(args[0], env);
      if (isNum(e)) return { pods: [{ title: 'Ułamek łańcuchowy', rows: [cfRow(NT.continuedFraction(e.v), false)] }] };
      const r = numericContinuedFraction(e, args[1] ? intArg(args[1], env, 'Liczba wyrazów') : 20);
      if (!r) fail('Nie udało się obliczyć ułamka łańcuchowego.');
      return { pods: [{ title: 'Ułamek łańcuchowy', rows: [r!], note: 'Wyrazy policzone numerycznie, potwierdzone przy dwóch precyzjach.' }] };
    }
    case 'rationalize': {
      const e = exprArg(args[0], env);
      const maxDen = args[1] ? bigArg(args[1], env, 'Największy mianownik') : 1000n;
      const z = evalC(e, 400);
      const n0 = z.re.e >= 0 ? q(z.re.m << BigInt(z.re.e)) : q(z.re.m, 1n << BigInt(-z.re.e));
      const cf = NT.continuedFraction(n0);
      let best = q(cf[0]);
      for (let k = 1; k <= cf.length; k++) { const c = NT.fromContinuedFraction(cf.slice(0, k)); if (c.d > maxDen) break; best = c; }
      return one(`Najlepsze przybliżenie wymierne (mianownik ≤ ${maxDen})`, num(best), `błąd ${shortApprox(sub(num(best), e)).replace('≈ ', '')}`);
    }
    // linear algebra
    case 'det': return one('Wyznacznik', simplify(LA.det(matArg(args[0], env))));
    case 'inverse': { const m = LA.inverse(matArg(args[0], env)).map(r => r.map(c => simplify(c))); return { pods: [{ title: 'Macierz odwrotna', rows: [matRow(m)] }], value: { t: 'matrix', rows: m } }; }
    case 'transpose': { const m = LA.transpose(matArg(args[0], env)); return { pods: [{ title: 'Macierz transponowana', rows: [matRow(m)] }], value: { t: 'matrix', rows: m } }; }
    case 'rank': return one('Rząd macierzy', num(LA.rank(matArg(args[0], env))));
    case 'rref': { const m = LA.rref(matArg(args[0], env)).R; return { pods: [{ title: 'Postać schodkowa zredukowana', rows: [matRow(m)] }], value: { t: 'matrix', rows: m } }; }
    case 'trace': return one('Ślad', LA.trace(matArg(args[0], env)));
    case 'charpoly': {
      const m = matArg(args[0], env);
      const v = varArg(args[1]) ?? 'λ';
      return one('Wielomian charakterystyczny', LA.charpoly(m, v));
    }
    case 'eigenvalues': case 'eigenvectors': {
      const m = matArg(args[0], env);
      return { pods: eigen(m, LA.charpoly(m)) ?? [] };
    }
    case 'nullspace': {
      const ns = LA.nullspace(matArg(args[0], env));
      if (!ns.length) return { pods: [{ title: 'Jądro', rows: [textRow('Tylko wektor zerowy.')] }] };
      return { pods: [{ title: `Baza jądra (wymiar ${ns.length})`, rows: ns.map(v => ({ ml: M(matML(v.map(c => [c]))), text: `(${v.map(toText).join(', ')})` })) }] };
    }
    case 'dot': return one('Iloczyn skalarny', simplify(LA.dot(vecArg(args[0], env), vecArg(args[1], env))));
    case 'cross': {
      const v = LA.cross(vecArg(args[0], env), vecArg(args[1], env)).map(c => simplify(c));
      return { pods: [{ title: 'Iloczyn wektorowy', rows: [{ ml: M(`${mo('[')}${v.map(toML).join(mo(','))}${mo(']')}`), text: `[${v.map(toText).join(', ')}]` }] }], value: { t: 'list', items: v.map(ex), set: false } };
    }
    case 'identity': { const n = intArg(args[0], env, 'Rozmiar'); if (n < 1 || n > 20) fail('Rozmiar od 1 do 20.'); const m = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? ONE : ZERO))); return { pods: [{ title: 'Macierz jednostkowa', rows: [matRow(m)] }], value: { t: 'matrix', rows: m } }; }
    // statistics
    case 'mean': case 'median': case 'variance': case 'stdev': case 'sort': case 'total': {
      const xs = statsArgs(args, env);
      if (!xs.length) fail('Pusta lista.');
      if (name === 'total') return one('Suma', simplify(add(...xs)));
      if (name === 'mean') return one('Średnia arytmetyczna', simplify(div(add(...xs), num(xs.length))));
      if (!xs.every(isConstant)) fail('Te statystyki liczę dla liczb.');
      const s = sortedConst(xs);
      if (name === 'sort') return { pods: [{ title: 'Posortowane', rows: [{ ml: M(s.map(toML).join(mo('≤'))), text: s.map(toText).join(' ≤ ') }] }] };
      if (name === 'median') { const n = s.length; return one('Mediana', n % 2 ? s[(n - 1) / 2] : simplify(div(add(s[n / 2 - 1], s[n / 2]), TWO))); }
      if (xs.length < 2) fail('Potrzeba co najmniej dwóch wartości.');
      const mean = div(add(...xs), num(xs.length));
      const ss = add(...xs.map(x => pow(sub(x, mean), TWO)));
      const v = simplify(div(ss, num(xs.length - 1)));
      return name === 'variance' ? one('Wariancja (próby, mianownik n − 1)', v) : one('Odchylenie standardowe (próby)', simplify(sqrt(v)));
    }
    // polynomials
    case 'degree': { const e = exprArg(args[0], env), x = varArg(args[1]) ?? mainVar(e); const c = coeffsOf(e, x); if (!c) fail(`To nie jest wielomian zmiennej ${x}.`); return one('Stopień', num(c!.length - 1)); }
    case 'coeffs': {
      const e = exprArg(args[0], env), x = varArg(args[1]) ?? mainVar(e);
      const c = coeffsOf(e, x);
      if (!c) fail(`To nie jest wielomian zmiennej ${x}.`);
      return { pods: [{ title: 'Współczynniki (od najwyższej potęgi)', rows: c!.slice().reverse().map((v, k) => ({ ...row(v), note: `przy ${x}^${c!.length - 1 - k}` })) }], value: { t: 'list', items: c!.slice().reverse().map(ex), set: false } };
    }
    case 'discriminant': {
      const e = exprArg(args[0], env), x = varArg(args[1]) ?? mainVar(e);
      const c = coeffsOf(e, x);
      if (!c || c.length < 3) fail('Wyróżnik liczę dla wielomianu stopnia ≥ 2.');
      if (c!.length === 3) return one('Wyróżnik Δ = b² − 4ac', simplify(sub(pow(c![1], TWO), mul(num(4), c![2], c![0]))));
      // discriminant = (−1)^(n(n−1)/2) Res(p, p′)/lc
      const n = c!.length - 1;
      const res = resultantOf(e, diff(e, x), x);
      return one('Wyróżnik', simplify(mul(num((n * (n - 1) / 2) % 2 ? -1 : 1), div(res, c![n]))));
    }
    case 'quotient': case 'remainder': {
      const a = exprArg(args[0], env), b = exprArg(args[1], env), x = varArg(args[2]) ?? mainVar(add(a, b));
      const pa = polyOf(a, x), pb = polyOf(b, x);
      if (!pa || !pb) fail('Dzielę wielomiany o współczynnikach wymiernych.');
      const [qq, rr] = pdivmod(pa!, pb!);
      const X = sym(x);
      return {
        pods: [{ title: 'Dzielenie wielomianów', rows: [eqRow(mtext('iloraz'), 'iloraz', polyToExpr(qq, X)), eqRow(mtext('reszta'), 'reszta', polyToExpr(rr, X))] }],
        value: ex(polyToExpr(name === 'quotient' ? qq : rr, X)),
      };
    }
    case 'polygcd': {
      const a = exprArg(args[0], env), b = exprArg(args[1], env), x = varArg(args[2]) ?? mainVar(add(a, b));
      const pa = polyOf(a, x), pb = polyOf(b, x);
      if (!pa || !pb) fail('NWD liczę dla wielomianów o współczynnikach wymiernych.');
      return one('NWD wielomianów (unormowany)', polyToExpr(pgcd(pa!, pb!), sym(x)));
    }
    case 'resultant': {
      const a = exprArg(args[0], env), b = exprArg(args[1], env), x = varArg(args[2]) ?? fail('Podaj zmienną rugowaną.');
      return one('Rugownik', simplify(resultantOf(a, b, x!)));
    }
  }
  return fail(`Polecenie ${name} nie jest jeszcze obsługiwane.`);
}

function resultantOf(a: Expr, b: Expr, x: string): Expr {
  const ca = coeffsOf(a, x), cb = coeffsOf(b, x);
  if (!ca || !cb) fail('Rugownik liczę dla wielomianów.');
  const m = ca!.length - 1, n = cb!.length - 1;
  if (m + n > 12) fail('Rugownik liczę dla wielomianów o łącznym stopniu do 12.');
  // Sylvester matrix
  const S: Expr[][] = [];
  for (let i = 0; i < n; i++) S.push(Array.from({ length: m + n }, (_, j) => ca![m - (j - i)] ?? ZERO).map((v, j) => (j - i >= 0 && j - i <= m ? v : ZERO)));
  for (let i = 0; i < m; i++) S.push(Array.from({ length: m + n }, (_, j) => (j - i >= 0 && j - i <= n ? cb![n - (j - i)] : ZERO)));
  return LA.det(S);
}

function factorCommand(args: Node[], env: Env): Out {
  const e = exprArg(args[0], env);
  if (isInt(e)) return { pods: integerPods(e.v.n).slice(0, 1), value: ex(e) };
  if (isNum(e)) {
    const f = (n: bigint) => NT.factorInteger(n).factors.map(([p, k]) => (k > 1 ? `<msup><mn>${p}</mn><mn>${k}</mn></msup>` : `<mn>${p}</mn>`)).join(mo('·')) || '<mn>1</mn>';
    return { pods: [{ title: 'Rozkład na czynniki pierwsze', rows: [{ ml: M(`${e.v.n < 0n ? mo('−') : ''}<mfrac><mrow>${f(e.v.n < 0n ? -e.v.n : e.v.n)}</mrow><mrow>${f(e.v.d)}</mrow></mfrac>`), text: toText(e) }] }], value: ex(e) };
  }
  if (isConstant(e)) return one('Postać iloczynowa', factorExpr(e).e);
  const r = factorExpr(e);
  return { pods: [{ title: 'Postać iloczynowa', rows: [row(r.e)], note: r.complete ? 'Rozkład nad liczbami wymiernymi.' : 'Rozkład może nie być pełny.' }], value: ex(r.e) };
}

function apartCommand(args: Node[], env: Env): Out {
  const e = exprArg(args[0], env), x = varArg(args[1]) ?? mainVar(e);
  const [n, d] = numDen(together(e));
  const pn = polyOf(n, x), pd = polyOf(d, x);
  if (!pn || !pd) fail('Rozkład na ułamki proste: funkcja wymierna o współczynnikach wymiernych.');
  const pf = partialFractions(pn!, pd!);
  if (!pf) fail('Nie udało się rozłożyć mianownika na czynniki stopnia ≤ 2.');
  const X = sym(x);
  const terms: Expr[] = [polyToExpr(pf!.poly, X)];
  for (const t of pf!.terms) terms.push(div(polyToExpr(t.num, X), pow(polyToExpr(t.factor.map(v => q(v)), X), num(t.power))));
  const sum_ = add(...terms);
  return one('Rozkład na ułamki proste', sum_);
}

function gcdCommand(name: 'gcd' | 'lcm', args: Node[], env: Env): Out {
  const xs = args.length === 1 ? listArg(args[0], env) : args.map(a => exprArg(a, env));
  if (xs.every(isInt)) {
    const vals = xs.map(v => (v as { v: Q }).v.n);
    const r = name === 'gcd' ? vals.reduce((a, b) => bgcd(a, b)) : vals.reduce((a, b) => (a && b ? (a / bgcd(a, b)) * b : 0n));
    const res = num(r < 0n ? -r : r);
    return one(name === 'gcd' ? 'Największy wspólny dzielnik' : 'Najmniejsza wspólna wielokrotność', res);
  }
  // polynomials in one variable
  const x = mainVar(add(...xs));
  const ps = xs.map(v => polyOf(v, x));
  if (ps.some(p => !p)) fail(`${name === 'gcd' ? 'NWD' : 'NWW'}: podaj liczby całkowite albo wielomiany.`);
  let g = ps[0]!;
  for (const p of ps.slice(1)) g = name === 'gcd' ? pgcd(g, p!) : lcmPoly(g, p!);
  return one(name === 'gcd' ? 'NWD wielomianów' : 'NWW wielomianów', polyToExpr(g, sym(x)));
}
function lcmPoly(a: P, b: P): P {
  const g = pgcd(a, b);
  const prod = pdivmod(mulP(a, b), g)[0];
  const lead = prod[prod.length - 1];
  return prod.map(c => q(c.n * lead.d, c.d * lead.n));
}
const mulP = (a: P, b: P): P => { const out: Q[] = Array(a.length + b.length - 1).fill(q(0)); a.forEach((x, i) => b.forEach((y, j) => { out[i + j] = q(out[i + j].n * x.d * y.d + x.n * y.n * out[i + j].d, out[i + j].d * x.d * y.d); })); return out; };

function solveCommand(args: Node[], env: Env): Out {
  let vars: string[] | null = null;
  if (args[1]) {
    const v = args[1];
    if (v.t === 'id') vars = [v.n];
    else if (v.t === 'list') vars = v.items.map(i => varArg(i) ?? fail('Niewiadome podaj jako litery, np. {x, y}.'));
    else fail('Drugim argumentem są niewiadome, np. x albo {x, y}.');
  }
  const a = args[0];
  if (a.t === 'list') {
    if (a.items.every(i => i.t === 'rel')) return system(a.items, env, vars);
    const es = a.items.map(i => exprArg(i, env));
    return systemFromExprs(es, vars);
  }
  if (a.t === 'rel') return relation(a, env, vars);
  // an expression: = 0
  const e = exprArg(a, env);
  const x = vars?.[0] ?? mainVar(e);
  return equationPods(e, ZERO, x);
}

function diffCommand(args: Node[], env: Env): Out {
  const e = exprArg(args[0], env);
  let x = varArg(args[1]) ?? mainVar(e);
  let k = 1;
  const pods: Pod[] = [];
  // diff(f, x, n) or diff(f, x, y) (mixed partial)
  if (args[2]) {
    const y = varArg(args[2]);
    if (y && args[2].t === 'id' && !/^\d/.test(y)) {
      const d = simplify(diff(diff(e, x), y));
      return { pods: [{ title: 'Pochodna mieszana', rows: [{ ml: M(`<mfrac><mrow><msup><mo>∂</mo><mn>2</mn></msup></mrow><mrow><mo>∂</mo>${mi(y)}<mo>∂</mo>${mi(x)}</mrow></mfrac>${mo('=')}${toML(d)}`), text: toText(d) }] }], value: ex(d) };
    }
    k = intArg(args[2], env, 'Rząd pochodnej');
    if (k < 0 || k > 60) fail('Rząd pochodnej od 0 do 60.');
  }
  if (args[1] && !varArg(args[1])) {
    // diff(f, 3): order without a variable
    k = intArg(args[1], env, 'Rząd pochodnej');
    x = mainVar(e);
  }
  const d = diffN(e, x, k);
  const s = simplify(d);
  pods.push({ title: k === 1 ? 'Pochodna' : `Pochodna rzędu ${k}`, rows: [eqRow(derivML(x, `<mrow>${mo('(')}${toML(e)}${mo(')')}</mrow>`, k), `${k === 1 ? 'd' : `d^${k}`}/d${x}${k === 1 ? '' : `^${k}`} (${toText(e)})`, s)] });
  const alt = safe(() => factorExpr(s).e);
  if (alt && !same(alt, s) && size(alt) <= size(s) + 4) pods.push({ title: 'Inna postać', rows: [row(alt)] });
  const ex_ = safe(() => expand(s));
  if (ex_ && !same(ex_, s) && !(alt && same(ex_, alt)) && size(ex_) < 200) pods.push({ title: 'Postać rozwinięta', rows: [row(ex_)] });
  if (variables(e).length === 1) {
    const prime = k === 1 ? 'f′' : k === 2 ? 'f″' : `f⁽${k}⁾`;
    const plot = safe(() => plotOf([e, s], x, { labels: [`f(${x}) = ${toText(e)}`, `${prime}(${x}) = ${toText(s)}`], find: k === 1 ? [['max', 'min'], ['zero']] : [[], ['zero']] }));
    if (plot) pods.push({ title: 'Wykres funkcji i pochodnej', rows: [], plot, note: k === 1 ? 'Gdzie f′ = 0, f ma ekstremum lub punkt stacjonarny; gdzie f′ > 0, f rośnie.' : undefined });
  }
  return { pods, value: ex(s) };
}

function integrateCommand(args: Node[], env: Env): Out {
  const e = exprArg(args[0], env);
  let x = varArg(args[1]) ?? mainVar(e);
  let a: Expr | null = null, b: Expr | null = null;
  if (args.length === 3 && args[1].t === 'rel') fail('Granice zapisz jako integrate(f; x; a; b).');
  if (args.length >= 3) {
    if (args.length === 3) { x = mainVar(e); a = exprArg(args[1], env, 'Granica'); b = exprArg(args[2], env, 'Granica'); }
    else { a = exprArg(args[2], env, 'Granica'); b = exprArg(args[3], env, 'Granica'); }
  }
  const body = `${toML(e)}<mspace width="0.17em"/><mi mathvariant="normal">d</mi>${mi(x)}`;
  if (!a || !b) {
    const F = integrate(e, x);
    if (!F) return { pods: [{ title: 'Całka nieoznaczona', rows: [textRow('Nie znalazłem funkcji pierwotnej w postaci elementarnej.')], note: 'Całki takie jak ∫ eˣ/x dx czy ∫ sin(x²) dx nie mają postaci elementarnej.' }] };
    const s = antiderivativeForm(simplify(F), x);
    const pods: Pod[] = [{ title: 'Całka nieoznaczona', rows: [{ ml: M(`${mo('∫')}${body}${mo('=')}${toML(s)}${mo('+')}<mi>C</mi>`), text: `${toText(s)} + C` }], note: 'Sprawdzone różniczkowaniem.' }];
    const alt = safe(() => expand(s));
    if (alt && !same(alt, s) && size(alt) < size(s) * 1.5) pods.push({ title: 'Inna postać', rows: [row(alt)] });
    if (variables(e).length === 1) {
      const plot = safe(() => plotOf([e, s], x, { labels: [`f(${x}) = ${toText(e)}`, `F(${x}) = ${toText(s)}`], find: [['zero'], ['max', 'min']] }));
      if (plot) pods.push({ title: 'Wykres funkcji i funkcji pierwotnej (C = 0)', rows: [], plot, note: 'Miejsca zerowe f to ekstrema F, bo F′ = f.' });
    }
    return { pods, value: ex(s) };
  }
  if (!isConstant(a) || !isConstant(b)) {
    const F = integrate(e, x);
    if (!F) fail('Nie znalazłem funkcji pierwotnej.');
    const v = simplify(sub(subst(F!, x, b), subst(F!, x, a)));
    return one('Całka oznaczona', v);
  }
  const lim = `<msubsup>${mo('∫')}${toML(a)}${toML(b)}</msubsup>`;
  const d = definite(e, x, a, b);
  const pods: Pod[] = [];
  if (d.divergent) {
    pods.push({ title: 'Całka oznaczona', rows: [textRow(d.divergent === 'yes' ? 'Całka jest rozbieżna.' : `Całka jest rozbieżna do ${d.divergent > 0 ? '+∞' : '−∞'}.`)], note: 'Przy osobliwości w przedziale całkowania lub na jego końcu (albo w nieskończoności) funkcja nie maleje dość szybko, by pole było skończone.' });
    return { pods };
  }
  if (d.exact) {
    const v = simplify(d.exact);
    pods.push({ title: 'Całka oznaczona', rows: [{ ml: M(`${lim}${body}${mo('=')}${toML(v)}`), text: toText(v) }], note: 'Z funkcji pierwotnej; zgodne z całkowaniem numerycznym.' });
    const dr = !isNum(v) || v.v.d !== 1n ? decimalRow(v) : null;
    if (dr) pods.push({ title: 'Postać dziesiętna', rows: [dr], more: { label: 'Więcej cyfr', query: `N(${toText(v)}, ${Math.min(5000, digitsDefault * 4)})` } });
    if (d.antiderivative) pods.push({ title: 'Funkcja pierwotna', rows: [{ ml: M(`${mo('∫')}${body}${mo('=')}${toML(simplify(d.antiderivative))}${mo('+')}<mi>C</mi>`), text: toText(d.antiderivative) }] });
    if (d.note) pods[0].note = d.note;
    const v2 = exactValue(v);
    return { pods: [...pods, ...areaPlot(e, x, a, b, toText(v))], value: ex(v2) };
  }
  if (d.numeric) {
    const sig = Math.max(3, Math.min(14, Math.floor(-Math.log10(Math.max(d.numeric.error, 1e-300) / Math.max(1e-300, Math.abs(d.numeric.value)))) - 1));
    const valText = Number(d.numeric.value.toPrecision(sig)).toString();
    pods.push({ title: 'Całka oznaczona', rows: [{ ml: M(`${lim}${body}${mo('≈')}<mn>${valText.replace('.', ',').replace('-', '−')}</mn>`), text: valText }], note: (d.note ? d.note + ' ' : '') + `Wartość numeryczna (kwadratura Gaussa–Kronroda), ${sig} cyfr znaczących; szacowany błąd ${d.numeric.error.toExponential(1).replace('.', ',')}.` });
    if (!d.antiderivative) pods.push({ title: 'Funkcja pierwotna', rows: [textRow('Brak postaci elementarnej (lub nie została znaleziona).')] });
    return { pods: [...pods, ...areaPlot(e, x, a, b, `≈ ${valText}`)] };
  }
  return { pods: [{ title: 'Całka oznaczona', rows: [textRow('Nie udało się obliczyć tej całki.')], note: d.note }] };
}
const exactValue = (v: Expr) => v;
function areaPlot(e: Expr, x: string, a: Expr, b: Expr, value: string): Pod[] {
  if (variables(e).length !== 1) return [];
  const A = approx(a).re, B = approx(b).re;
  if (!Number.isFinite(A) || !Number.isFinite(B)) return [];
  const p = safe(() => plotOf([e], x, {
    range: [Math.min(A, B) - Math.max(Math.abs(B - A), 1) * 0.25, Math.max(A, B) + Math.max(Math.abs(B - A), 1) * 0.25],
    fills: [{ a: Math.min(A, B), b: Math.max(A, B), label: `całka = ${value}` }], find: [['zero']], labels: [`y = ${toText(e)}`],
    refs: [{ x: A, label: `${x} = ${toText(a)}` }, { x: B, label: `${x} = ${toText(b)}` }],
  }));
  return p ? [{ title: 'Pole pod wykresem', rows: [], plot: p, note: 'Pole nad osią liczy się ze znakiem +, pod osią ze znakiem −.' }] : [];
}

function limitArgs(args: Node[], env: Env): { e: Expr; x: string; at: Expr; dir: -1 | 0 | 1 } {
  const e = exprArg(args[0], env);
  let x: string, at: Expr, dirNode: Node | undefined;
  if (args[1]?.t === 'rel' && args[1].ops[0] === '->') {
    x = varArg(args[1].parts[0]) ?? fail('Zapisz granicę jako limit(f; x->a).');
    at = exprArg(args[1].parts[1], env, 'Punkt');
    dirNode = args[2];
  } else if (args[1]?.t === 'rel' && args[1].ops[0] === '=') {
    x = varArg(args[1].parts[0]) ?? fail('Zapisz granicę jako limit(f; x->a).');
    at = exprArg(args[1].parts[1], env, 'Punkt');
    dirNode = args[2];
  } else {
    x = varArg(args[1]) ?? mainVar(e);
    at = args[2] ? exprArg(args[2], env, 'Punkt') : ZERO;
    dirNode = args[3];
  }
  const dv = dirNode ? exprArg(dirNode, env, 'Kierunek') : ZERO;
  const dir = (isNum(dv) ? qsign(dv.v) : 0) as -1 | 0 | 1;
  return { e, x, at, dir };
}
function limText(l: Lim | null): { ml: string; text: string; value?: Expr } {
  if (!l) return { ml: mtext('nie udało się wyznaczyć'), text: '?' };
  if (l.kind === 'fin') { const v = simplify(l.v); return { ml: toML(v), text: toText(v), value: v }; }
  if (l.kind === 'inf') return { ml: INF_ML(l.s > 0 ? '+' : '−'), text: l.s > 0 ? '+∞' : '−∞', value: l.s > 0 ? INF : neg(INF) };
  if (l.kind === 'bounded') return { ml: mtext('nie istnieje (oscyluje)'), text: 'nie istnieje' };
  return { ml: mtext('nie istnieje'), text: 'nie istnieje' };
}
function limitCommand(args: Node[], env: Env): Out {
  const { e, x, at, dir } = limitArgs(args, env);
  const head = (d: number) => `<munder><mi mathvariant="normal">lim</mi><mrow>${mi(x)}${mo('→')}${d ? `<msup><mrow>${toML(at)}</mrow>${mo(d > 0 ? '+' : '−')}</msup>` : toML(at)}</mrow></munder>`;
  const r = limit(e, x, at, dir);
  const pods: Pod[] = [];
  if (r && r.kind === 'none' && r.left && r.right) {
    const L = limText(r.left), R = limText(r.right);
    pods.push({ title: 'Granica', rows: [textRow('Granica nie istnieje: granice jednostronne są różne.')] });
    pods.push({ title: 'Granice jednostronne', rows: [{ ml: M(`${head(-1)}${toML(e)}${mo('=')}${L.ml}`), text: `lewostronna: ${L.text}` }, { ml: M(`${head(1)}${toML(e)}${mo('=')}${R.ml}`), text: `prawostronna: ${R.text}` }] });
  } else {
    const t = limText(r);
    pods.push({ title: 'Granica', rows: [{ ml: M(`${head(dir)}${toML(e)}${mo('=')}${t.ml}`), text: t.text, note: t.value && isConstant(t.value) && !isNum(t.value) && !infSign(t.value) ? shortApprox(t.value) : undefined }], note: r ? 'Wynik sprawdzony numerycznie.' : 'Żadna z metod (szereg, reguła de l’Hospitala) nie rozstrzygnęła tej granicy.' });
    pods.push(...limitPlot(e, x, at, [[dir, r]]));
    if (t.value) return { pods, value: ex(t.value) };
    return { pods };
  }
  pods.push(...limitPlot(e, x, at, [[-1, r!.left ?? null], [1, r!.right ?? null]]));
  return { pods };
}

/** The function near the point, with where it tends: a hole at a finite limit, an asymptote at an infinite one. */
function limitPlot(e: Expr, x: string, at: Expr, sides: [number, Lim | null][]): Pod[] {
  if (variables(e).length !== 1) return [];
  const s = infSign(at), A = s ? 0 : approx(at).re;
  if (!Number.isFinite(A)) return [];
  const holes: { x: number; y: number; kind: MarkKind; label: string }[] = [], vlines: number[] = [], refs: { x?: number; y?: number; label: string }[] = [];
  for (const [d, l] of sides) {
    if (!l) continue;
    const L = l.kind === 'fin' ? approx(simplify(l.v)).re : NaN, side = d < 0 ? 'lewostronna ' : d > 0 ? 'prawostronna ' : '';
    if (s && Number.isFinite(L)) refs.push({ y: L, label: `y = ${fmt(L)}` });
    else if (!s && Number.isFinite(L)) holes.push({ x: A, y: L, kind: 'hole', label: `granica ${side}= ${fmt(L)}` });
    else if (!s && l.kind === 'inf' && !vlines.length) vlines.push(A);
  }
  const f = compileDouble(e, x), value = s ? NaN : f(A);
  const shown = Number.isFinite(value) && !holes.some(h => Math.abs(h.y - value) < 1e-9 * (1 + Math.abs(h.y)));
  const p = safe(() => plotOf([e], x, {
    range: s > 0 ? [-1, 30] : s < 0 ? [-30, 1] : [A - 4, A + 4], labels: [`y = ${toText(e)}`],
    at: [...holes, ...(shown ? [{ x: A, kind: 'point' as const, label: `wartość f(${fmt(A)}) = ${fmt(value)}` }] : [])],
    vlines, refs: [...refs, ...(s ? [] : [{ x: A, label: '' }])],
  }));
  return p ? [{ title: 'Wykres', rows: [], plot: p, note: holes.length ? 'Pusty punkt: wartość, do której zbliża się funkcja.' : undefined }] : [];
}

function taylorCommand(args: Node[], env: Env): Out {
  const e = exprArg(args[0], env);
  const x = varArg(args[1]) ?? mainVar(e);
  const at = args[2] ? exprArg(args[2], env, 'Punkt') : ZERO;
  const n = args[3] ? intArg(args[3], env, 'Rząd') : 6;
  if (n < 0 || n > 40) fail('Rząd szeregu od 0 do 40.');
  const t = taylor(e, x, at, n);
  if (!t) fail('Ta funkcja nie ma w tym punkcie rozwinięcia w szereg potęgowy (Laurenta).');
  const terms = t!.terms.map(c => simplify(c));
  const pods: Pod[] = [{ title: infSign(at) ? 'Rozwinięcie asymptotyczne' : t!.v < 0 ? `Szereg Laurenta w ${x} = ${toText(at)}` : `Szereg Taylora w ${x} = ${toText(at)}`, rows: [seriesRow(terms, sym(x), n + 1, at)] }];
  const poly = add(...terms);
  if (variables(e).length === 1 && !infSign(at)) {
    const A = approx(at).re, nz = terms.filter(t => !isZero(t));
    // a few shorter partial sums show the approximation getting better
    const cuts = [...new Set([Math.ceil(nz.length / 3), Math.ceil(2 * nz.length / 3)])].filter(j => j >= 1 && j < nz.length);
    const words = (j: number) => `${j} ${j === 1 ? 'wyraz' : j % 10 >= 2 && j % 10 <= 4 && (j % 100 < 12 || j % 100 > 14) ? 'wyrazy' : 'wyrazów'}`;
    const es = [e, poly, ...cuts.map(j => add(...nz.slice(0, j)))];
    const plot = safe(() => plotOf(es, x, {
      range: [A - 4, A + 4], at: [{ x: A, kind: 'point', label: `punkt rozwinięcia ${x} = ${fmt(A)}` }],
      labels: [`y = ${toText(e)}`, `wielomian Taylora (${words(nz.length)})`, ...cuts.map(j => `suma częściowa (${words(j)})`)],
      dash: [false, true, true, true], faint: [false, false, true, true],
    }));
    if (plot) pods.push({ title: 'Funkcja i wielomian Taylora', rows: [], plot, note: 'Im więcej wyrazów, tym dalej od punktu rozwinięcia wielomian pokrywa się z funkcją.' });
  }
  return { pods, value: ex(poly) };
}

function sumCommand(name: 'sum' | 'product', args: Node[], env: Env): Out {
  const e = exprArg(args[0], env);
  const k = varArg(args[1]) ?? (variables(e).includes('k') ? 'k' : variables(e).includes('n') ? 'n' : mainVar(e));
  if (args.length < 4) fail(`Zapisz: ${name}(wyraz; ${k}; od; do), np. sum(1/k^2; k; 1; ∞).`);
  const a = exprArg(args[2], env, 'Dolna granica'), b = exprArg(args[3], env, 'Górna granica');
  const head = `<munderover>${mo(name === 'sum' ? '∑' : '∏')}<mrow>${mi(k)}${mo('=')}${toML(a)}</mrow>${infSign(b) ? mo('∞') : toML(b)}</munderover>${toML(e)}`;
  if (name === 'product') {
    const r = prodOf(e, k, a, b);
    if (!r) fail('Nie znalazłem postaci zamkniętej tego iloczynu.');
    const v = simplify(r!);
    return { pods: [{ title: 'Iloczyn', rows: [{ ml: M(`${head}${mo('=')}${toML(v)}`), text: toText(v), note: isConstant(v) && !isNum(v) ? shortApprox(v) : undefined }] }], value: ex(v) };
  }
  const r = sumOf(e, k, a, b);
  const seq = (total?: number): Pod[] => {
    if (!isInt(a) || variables(e).some(v => v !== k) || bitLength(a.v.n) > 40) return [];
    const k0 = Number(a.v.n), k1 = infSign(b) > 0 ? Infinity : isInt(b) ? Number(b.v.n) : NaN;
    if (!(k1 >= k0)) return [];
    const p = safe(() => sequencePlot(compileDouble(e, k), k0, k1, total, `${toText(e)}`));
    return p ? [{ title: 'Wyrazy i sumy częściowe', rows: [], plot: p, note: k1 - k0 > 59 ? 'Pokazano pierwsze 60 wyrazów.' : undefined }] : [];
  };
  if (r.value) {
    const v = simplify(r.value);
    const note = r.ratio ? `Dla |${toText(r.ratio)}| < 1.` : undefined;
    const pods: Pod[] = [{ title: 'Suma', rows: [{ ml: M(`${head}${mo('=')}${toML(v)}`), text: toText(v), note: isConstant(v) && !isNum(v) ? shortApprox(v) : undefined }], note }];
    if (isConstant(v) && !isNum(v)) { const d = decimalRow(v); if (d) pods.push({ title: 'Postać dziesiętna', rows: [d] }); }
    pods.push(...seq(isConstant(v) ? approx(v).re : undefined));
    return { pods, value: ex(v) };
  }
  if (r.divergent) return { pods: [{ title: 'Suma', rows: [textRow('Szereg jest rozbieżny.')], note: r.note }, ...seq()] };
  if (r.converges && isInt(a) && variables(e).length <= 1) {
    const v = safe(() => numericSum(e, k, a.v.n));
    if (v) {
      const sig = Math.max(3, Math.min(13, Math.floor(-Math.log10(Math.max(v.error, 1e-300) / Math.max(1e-300, Math.abs(v.value)))) - 1));
      const t = String(Number(v.value.toPrecision(sig)));
      return { pods: [{ title: 'Suma', rows: [{ ml: M(`${head}${mo('≈')}<mn>${t.replace('.', ',').replace('-', '−')}</mn>`), text: t }], note: `Szereg jest zbieżny (bezwzględnie: wyrazy maleją co najmniej jak 1/${k}²). Nie znalazłem postaci zamkniętej; wartość numeryczna (wzór Eulera–Maclaurina), ${sig} cyfr znaczących.` }, ...seq(v.value)] };
    }
    return { pods: [{ title: 'Suma', rows: [textRow('Szereg jest zbieżny.')], note: `Wyrazy maleją co najmniej jak 1/${k}², ale nie znalazłem postaci zamkniętej.` }, ...seq()] };
  }
  // numeric fallback for infinite sums with geometric decay
  if (infSign(b) > 0 && isInt(a) && variables(e).length <= 1) {
    const ratio = ratioHint(e, k);
    if (ratio !== null && ratio < 0.95) {
      const f = compileDouble(e, k);
      let s = 0, c = 0, j = Number(a.v.n);
      for (let it = 0; it < 100000; it++, j++) {
        const t = f(j);
        if (!Number.isFinite(t)) break;
        const y = s + t;
        c += Math.abs(s) >= Math.abs(t) ? (s - y) + t : (t - y) + s;
        s = y;
        if (Math.abs(t) < 1e-17 * Math.max(1, Math.abs(s + c))) break;
      }
      const total = s + c;
      return { pods: [{ title: 'Suma', rows: [{ ml: M(`${head}${mo('≈')}<mn>${String(Number(total.toPrecision(14))).replace('.', ',')}</mn>`), text: String(total) }], note: 'Nie znalazłem postaci zamkniętej; wartość numeryczna (wyrazy maleją jak ciąg geometryczny, więc reszta jest pomijalna).' }, ...seq(total)] };
    }
  }
  return { pods: [{ title: 'Suma', rows: [textRow('Nie znalazłem postaci zamkniętej tej sumy.')], note: r.note }] };
}

// --- Plots on request: functions, curves F(x, y) = 0 and (x(t); y(t)) in one view ---

/** The letters named in a piece of input. */
function letters(n: Node, out: string[] = []): string[] {
  if (n.t === 'id') out.push(n.n);
  else if (n.t === 'op') { letters(n.a, out); letters(n.b, out); }
  else if (n.t === 'neg' || n.t === 'post') letters(n.a, out);
  else if (n.t === 'call' || n.t === 'index') n.args.forEach(a => letters(a, out));
  else if (n.t === 'list') n.items.forEach(a => letters(a, out));
  return out;
}

function plotCommand(args: Node[], env: Env): Out {
  // plot(x, y), plot(y): data
  const vals = safe(() => args.map(a => evaluate(a, env)));
  const data = vals && plotData(vals);
  if (data) return linalgOut(data);
  const fns: Expr[] = [], parts: Plot[] = [], labels: string[] = [], curves: { f: Expr; vx: string; vy: string }[] = [];
  const partRows: (HandoffRow[] | undefined)[] = [];
  for (const a of args) {
    if (a.t === 'rel') {
      if (a.ops.length !== 1 || a.ops[0] !== '=') fail('Rysuję równania (ze znakiem =), np. x^2 + y^2 = 25.');
      const [l, r] = a.parts.map(p => scalar(evaluate(p, env), 'Równanie'));
      if (isSym(l, 'y') && !variables(r).includes('y') && variables(r).length <= 1) { fns.push(r); labels.push(`y = ${toText(r)}`); continue; }
      const f = sub(l, r), vs = variables(f);
      if (vs.length > 2 || !vs.length) fail('Równanie krzywej ma mieć jedną lub dwie zmienne, np. x^2 + y^2 = 25.');
      const [vx, vy] = vs.length === 2 ? twoVars(f) : vs[0] === 'y' ? ['x', 'y'] : [vs[0], 'y'];
      const p = implicitPlot([f], vx, vy, [`${toText(l)} = ${toText(r)}`], [], [[l, r]]);
      if (!p) fail(`Nie znalazłem punktów krzywej ${toText(l)} = ${toText(r)}.`);
      parts.push(p!);
      partRows.push(p!.open?.rows);
      curves.push({ f, vx, vy });
      continue;
    }
    const v = evaluate(a, env);
    if (v.t === 'list' && v.items.length === 2 && v.items.every(i => i.t === 'expr')) {
      const [ex_, ey] = v.items.map(i => (i as { e: Expr }).e), t = mainVar(add(ex_, ey));
      const periodic = /sin|cos|tan|cot/.test(toText(ex_) + toText(ey));
      const s = parametricSeries(ex_, ey, t, periodic ? 0 : -10, periodic ? 2 * Math.PI : 10, `(${toText(ex_)}; ${toText(ey)}), ${t} ∈ ${periodic ? '⟨0; 2π⟩' : '⟨−10; 10⟩'}`, 0);
      if (!s.segs.length) fail('Krzywa parametryczna nie ma punktów rzeczywistych.');
      const pts = s.segs.flat(), xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2);
      const w = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1) * 0.65, cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      parts.push({ x: [cx - w, cx + w], y: [cy - w, cy + w], equal: true, series: [s], marks: [], bands: [], vlines: [], hlines: [], refs: [], fills: [], vectors: [], shapes: [], bars: [] });
      const row = curveRow(ex_, ey, t, periodic ? 0 : -10, periodic ? 2 * Math.PI : 10, 0);
      partRows.push(row && [row]);
      continue;
    }
    const e = scalar(v, 'Wykres');
    if (variables(e).length > 1) fail(`${toText(e)} ma kilka zmiennych. Narysuję funkcję jednej zmiennej albo krzywą z równania, np. x^2 + y^2 = 25.`);
    fns.push(e);
    labels.push(`y = ${toText(e)}`);
  }
  const x = fns.length ? mainVar(add(...fns.map(f => mul(f, f)))) : 'x';
  if (fns.some(f => variables(f).some(v => v !== x))) fail('Wszystkie funkcje na jednym wykresie muszą mieć tę samą zmienną.');
  const range = parts.length ? [Math.min(...parts.map(p => p.x[0])), Math.max(...parts.map(p => p.x[1]))] as [number, number] : undefined;
  // one function: its notable points; two: where they meet; more would only clutter
  const explicit = fns.length ? plotOf(fns, x, { range, labels, find: fns.length === 1 && !curves.length ? [['zero', 'max', 'min']] : [], crossings: fns.length === 2 }) : null;
  // a graph y = g(x) meets a curve F(x, y) = 0 where F(x, g(x)) = 0
  if (explicit && range) for (const c of curves) {
    if (c.vx !== x || c.vy !== 'y') continue;
    fns.forEach((g, k) => {
      const h = compileDouble(subst(c.f, 'y', g), x), gy = compileDouble(g, x);
      for (const pt of features(h, range[0], range[1], ['zero'], 1)) {
        const Y = gy(pt.x);
        if (Number.isFinite(Y)) explicit.marks.push({ x: pt.x, y: Y, kind: 'cross', label: `punkt wspólny (${fmt(pt.x)}; ${fmt(Y)})`, color: k, series: k });
      }
    });
  }
  const plot = parts.length ? combine(explicit ? [...parts, { ...explicit, y: parts[0].y }] : parts) : explicit;
  if (!plot) fail('Nie ma czego narysować: brak wartości rzeczywistych w pobliżu zera.');
  if (parts.length && plot) {
    // series are numbered in combine's order: the pieces first, then the functions
    let base = 0;
    const rows: (HandoffRow | undefined)[] = [];
    parts.forEach((part, k) => { rows.push(...(partRows[k] ?? [undefined]).map(r => r && { ...r, series: r.series === undefined ? undefined : r.series + base, color: r.series === undefined ? r.color : r.series + base })); base += part.series.length; });
    fns.forEach((g, k) => {
      // a graph stays a graph y = f(x) next to the curves: Wykresy draws both
      const t = graphText(g, x);
      rows.push(t ? { expr: t, series: base + k, color: base + k } : undefined);
    });
    if (rows.every(Boolean)) plot.open = { mode: 'graph', rows: rows as HandoffRow[] };
  }
  return { pods: [{ title: 'Wykres', rows: [], plot: plot!, note: fns.length === 2 && !parts.length ? 'Zaznaczone są też punkty wspólne obu wykresów.' : undefined }] };
}

// --- Function analysis (badanie przebiegu zmienności funkcji) ---

function analyzeCommand(args: Node[], env: Env, onlyExtrema = false): Out {
  const e = exprArg(args[0], env, 'Funkcja');
  const x = varArg(args[1]) ?? mainVar(e);
  if (variables(e).length > 1) fail('Badam funkcje jednej zmiennej (bez parametrów).');
  const X = sym(x);
  const pods: Pod[] = [];
  const fML = `<mi>f</mi>${mo('(')}${mi(x)}${mo(')')}`;
  if (!onlyExtrema) pods.push({ title: 'Funkcja', rows: [{ ml: M(`${fML}${mo('=')}${toML(e)}`), text: `f(${x}) = ${toText(e)}` }] });
  const dom = domain(e, x);
  const inDom = (v: number) => dom.parts.some(iv => (iv.lo ? (iv.loClosed ? v >= approx(iv.lo).re : v > approx(iv.lo).re) : true) && (iv.hi ? (iv.hiClosed ? v <= approx(iv.hi).re : v < approx(iv.hi).re) : true));
  if (!onlyExtrema) pods.push({ title: 'Dziedzina', rows: [intervalRow(dom.parts, x)], note: dom.note });
  const marks: { x: number; kind: MarkKind }[] = [];
  const vlines: number[] = [], hlines: number[] = [], oblique: Expr[] = [];
  if (!onlyExtrema) {
    // zeros and the y-intercept
    const set = safe(() => zeroIntervals(e, x));
    const z = set ? null : safe(() => zerosOf(e, x));
    const rows: Row[] = set ? [intervalRow(set, x)] : [];
    if (z && z.kind === 'list') rows.push(...solutionRows(z.sols.filter(isRealSol).filter(s => s.family || !s.approx || inDom(bfToNumber(s.approx.re))).slice(0, 12), x));
    if (z?.kind === 'list') z.sols.forEach(s => { if (!s.family && s.approx && isRealSol(s)) marks.push({ x: bfToNumber(s.approx.re), kind: 'zero' }); });
    // no answer from the solver is not the answer "none"
    pods.push({ title: 'Miejsca zerowe', rows: rows.length ? rows : [textRow(z || set ? 'Brak.' : 'Nie udało się ich wyznaczyć.')], note: z && z.kind !== 'all' ? z.note : undefined });
    if (inDom(0)) { const y0 = safe(() => simplify(subst(e, x, ZERO))); if (y0) pods.push({ title: 'Punkt przecięcia z osią Oy', rows: [{ ml: M(`<mi>f</mi>${mo('(')}<mn>0</mn>${mo(')')}${mo('=')}${toML(y0)}`), text: `f(0) = ${toText(y0)}` }] }); }
    // parity
    const fm = subst(e, x, neg(X));
    const even = safe(() => isZero(expand(cancel(together(sub(fm, e)))))), odd = safe(() => isZero(expand(cancel(together(add(fm, e))))));
    const symDom = dom.parts.every(iv => dom.parts.some(jv => (iv.lo ? jv.hi && same(simplify(neg(iv.lo)), jv.hi) : !jv.hi) && (iv.hi ? jv.lo && same(simplify(neg(iv.hi)), jv.lo) : !jv.lo)));
    pods.push({ title: 'Parzystość', rows: [textRow(!symDom ? 'Ani parzysta, ani nieparzysta (dziedzina nie jest symetryczna).' : even ? 'Funkcja parzysta: f(−x) = f(x).' : odd ? 'Funkcja nieparzysta: f(−x) = −f(x).' : 'Ani parzysta, ani nieparzysta.')] });
    // limits at the ends and asymptotes
    const asym: Row[] = [];
    const ends: Row[] = [];
    for (const s of [-1, 1] as const) {
      const unbounded = dom.parts.some(iv => (s < 0 ? !iv.lo : !iv.hi));
      if (!unbounded) continue;
      const L = safe(() => limit(e, x, s > 0 ? INF : neg(INF)));
      const t = limText(L);
      ends.push({ ml: M(`<munder><mi mathvariant="normal">lim</mi><mrow>${mi(x)}${mo('→')}${INF_ML(s > 0 ? '+' : '−')}</mrow></munder>${fML}${mo('=')}${t.ml}`), text: `x → ${s > 0 ? '+' : '−'}∞: ${t.text}` });
      if (L?.kind === 'fin') { asym.push({ ml: M(`<mi>y</mi>${mo('=')}${toML(simplify(L.v))}`), text: `y = ${toText(simplify(L.v))}`, note: `pozioma w ${s > 0 ? '+' : '−'}∞` }); hlines.push(approx(simplify(L.v)).re); }
      else if (L?.kind === 'inf') {
        const a = safe(() => limit(div(e, X), x, s > 0 ? INF : neg(INF)));
        if (a?.kind === 'fin' && !isZero(a.v)) {
          const b = safe(() => limit(sub(e, mul(a.v, X)), x, s > 0 ? INF : neg(INF)));
          if (b?.kind === 'fin') { const line = simplify(add(mul(a.v, X), b.v)); asym.push({ ml: M(`<mi>y</mi>${mo('=')}${toML(line)}`), text: `y = ${toText(line)}`, note: `ukośna w ${s > 0 ? '+' : '−'}∞` }); if (!oblique.some(o => same(o, line))) oblique.push(line); }
        }
      }
    }
    // vertical: finite ends of the domain and excluded points
    const pts = new Map<string, Expr>();
    for (const iv of dom.parts) for (const p of [iv.lo, iv.hi]) if (p) pts.set(toText(p), p);
    for (const p of pts.values()) {
      for (const side of [-1, 1] as const) {
        const v = approx(p).re + side * 1e-9;
        if (!inDom(v)) continue;
        const L = safe(() => limit(e, x, p, side));
        const t = limText(L);
        ends.push({ ml: M(`<munder><mi mathvariant="normal">lim</mi><mrow>${mi(x)}${mo('→')}<msup><mrow>${toML(p)}</mrow>${mo(side > 0 ? '+' : '−')}</msup></mrow></munder>${fML}${mo('=')}${t.ml}`), text: `x → ${toText(p)}${side > 0 ? '⁺' : '⁻'}: ${t.text}` });
        if (L?.kind === 'inf' && !asym.some(r => r.text === `x = ${toText(p)}`)) { asym.push({ ml: M(`${mi('x')}${mo('=')}${toML(p)}`), text: `x = ${toText(p)}`, note: 'pionowa' }); vlines.push(approx(p).re); }
      }
    }
    if (ends.length) pods.push({ title: 'Granice na krańcach dziedziny', rows: ends });
    pods.push({ title: 'Asymptoty', rows: asym.length ? asym : [textRow('Brak.')] });
  }
  // first derivative: monotonicity and extrema
  const d1 = simplify(diff(e, x));
  pods.push({ title: 'Pochodna', rows: [{ ml: M(`<msup><mi>f</mi><mo>′</mo></msup>${mo('(')}${mi(x)}${mo(')')}${mo('=')}${toML(d1)}`), text: `f′(${x}) = ${toText(d1)}` }] });
  const inc = safe(() => intersect(solveInequality(d1, '>', x).parts, dom.parts));
  const dec = safe(() => intersect(solveInequality(d1, '<', x).parts, dom.parts));
  if (inc && dec) {
    pods.push({ title: 'Monotoniczność', rows: [
      { ...intervalRow(inc, x), note: 'rosnąca (f′ > 0)' }, { ...intervalRow(dec, x), note: 'malejąca (f′ < 0)' },
    ], note: 'Na każdym z przedziałów osobno.' });
  }
  const crit = safe(() => solveEquation(d1, x));
  const extrema: Row[] = [];
  if (crit && crit.kind === 'list') {
    for (const s of crit.sols) {
      if (s.family || !s.approx || !isRealSol(s)) continue;
      const v = bfToNumber(s.approx.re);
      if (!inDom(v)) continue;
      const h = 1e-6 * Math.max(1, Math.abs(v));
      const g = compileDouble(d1, x);
      let l = g(v - h), r = g(v + h);
      // f′ of x⁶⁰ at ±10⁻⁶ is 0 in doubles (underflow): then its exact sign there
      if (s.exact && (!l || !r || !Number.isFinite(l) || !Number.isFinite(r))) {
        const sign = (t: Expr) => safe(() => bfSign(evalC(subst(d1, x, t), 200).re)) ?? 0;
        const H = num(q(1n, 1000000n));
        l = sign(sub(s.exact, H)); r = sign(add(s.exact, H));
      }
      let kind = '';
      if (l > 0 && r < 0) kind = 'maksimum lokalne'; else if (l < 0 && r > 0) kind = 'minimum lokalne'; else continue;
      const at = s.exact ?? null;
      const y = at ? safe(() => simplify(subst(e, x, at))) : null;
      marks.push({ x: v, kind: kind.startsWith('maks') ? 'max' : 'min' });
      extrema.push(at && y
        ? { ml: M(`${mi(x)}${mo('=')}${toML(at)}${mo(',')}<mspace width="0.4em"/><mi>f</mi>${mo('(')}${toML(at)}${mo(')')}${mo('=')}${toML(y)}`), text: `${kind}: ${x} = ${toText(at)}, f = ${toText(y)}`, note: kind + (isNum(y) ? '' : ` (${shortApprox(y)})`) }
        : { ml: M(`${mi(x)}${mo('≈')}<mn>${v.toPrecision(12).replace('.', ',')}</mn>`), text: `${kind}: x ≈ ${v}`, note: kind });
    }
  }
  pods.push({ title: 'Ekstrema lokalne', rows: extrema.length ? extrema : [textRow('Brak.')] });
  if (!onlyExtrema) {
    const d2 = safe(() => simplify(diff(d1, x)));
    if (d2) {
      pods.push({ title: 'Druga pochodna', rows: [{ ml: M(`<msup><mi>f</mi><mo>″</mo></msup>${mo('(')}${mi(x)}${mo(')')}${mo('=')}${toML(d2)}`), text: `f″(${x}) = ${toText(d2)}` }] });
      const cu = safe(() => intersect(solveInequality(d2, '>', x).parts, dom.parts));
      const cd = safe(() => intersect(solveInequality(d2, '<', x).parts, dom.parts));
      if (cu && cd) pods.push({ title: 'Wypukłość', rows: [{ ...intervalRow(cu, x), note: 'wypukła (f″ > 0)' }, { ...intervalRow(cd, x), note: 'wklęsła (f″ < 0)' }] });
      const infl = safe(() => solveEquation(d2, x));
      const rows: Row[] = [];
      if (infl && infl.kind === 'list') {
        const g = compileDouble(d2, x);
        for (const s of infl.sols) {
          if (s.family || !s.approx || !isRealSol(s)) continue;
          const v = bfToNumber(s.approx.re);
          if (!inDom(v)) continue;
          const h = 1e-6 * Math.max(1, Math.abs(v));
          if (Math.sign(g(v - h)) === Math.sign(g(v + h))) continue;
          marks.push({ x: v, kind: 'inflection' });
          rows.push(s.exact ? { ml: M(`${mi(x)}${mo('=')}${toML(s.exact)}`), text: `${x} = ${toText(s.exact)}`, note: isNum(s.exact) ? undefined : shortApprox(s.exact) } : { ml: M(`${mi(x)}${mo('≈')}<mn>${v.toPrecision(12).replace('.', ',')}</mn>`), text: `${x} ≈ ${v}` });
        }
      }
      pods.push({ title: 'Punkty przegięcia', rows: rows.length ? rows : [textRow('Brak.')] });
    }
  }
  const plot = safe(() => plotOf([e, ...oblique], x, {
    at: marks, vlines, hlines: hlines.filter(Number.isFinite), find: [['zero', 'max', 'min']],
    labels: [`f(${x}) = ${toText(e)}`, ...oblique.map(o => `asymptota ukośna y = ${toText(o)}`)], dash: [false, ...oblique.map(() => true)],
  }));
  if (plot) pods.push({ title: 'Wykres', rows: [], plot, note: 'Zaznaczone: miejsca zerowe, ekstrema, punkty przegięcia i asymptoty.' });
  if (!onlyExtrema) {
    const d2 = safe(() => simplify(diff(d1, x)));
    const dp = safe(() => plotOf(d2 ? [d1, d2] : [d1], x, { range: plot?.x, find: [['zero'], ['zero']], labels: [`f′(${x}) = ${toText(d1)}`, ...(d2 ? [`f″(${x}) = ${toText(d2)}`] : [])] }));
    if (dp) pods.push({ title: 'Wykres pochodnych', rows: [], plot: dp, note: 'Znak f′ mówi, gdzie f rośnie, a gdzie maleje; znak f″ – gdzie jest wypukła, a gdzie wklęsła.' });
  }
  return { pods };
}

const isInf = (e: Expr) => infSign(e) !== 0;
const isOneE = (e: Expr) => isNum(e) && e.v.n === 1n && e.v.d === 1n;
