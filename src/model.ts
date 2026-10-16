/** Turns a function row into what the renderer and the analysis need. Pure apart from registering new parameters. */
import { MathError, RELATION, buildComplex, compile, compileComplex, parameterNames, parse, relationSymbol } from './math';
import type { Complex, ComplexFunction, Node, Params, RealFunction } from './math';
import type { FnState, Mode } from './state';

export interface ConditionSet { kind: 'condition'; sides: ComplexFunction[]; ops: string[] }
/** A number with real unknowns (t + 2i, a + bi): no unknown = a point, one = a curve, two = a region. */
export interface ParametricSet { kind: 'parametric'; unknowns: string[]; at: (...ts: number[]) => Complex }

export interface Compiled {
  /** Readable error, '' when the row is fine or empty. */
  error: string;
  ok: boolean;
  /** Letters that get a slider. */
  parameters: string[];
  /** y = f(x), restricted to the row's domain. Graph mode. */
  fn: RealFunction | null;
  /** f(z). Complex mode. */
  cfn: ComplexFunction | null;
  /** The expression read on the real axis (z → x), or null when it needs i. Used for exact values. */
  real: string | null;
  set: ConditionSet | ParametricSet | null;
  /** A condition in x and y (x² + y² ≤ 25): its points are (x; y), not complex numbers z. */
  xy: boolean;
}

const EMPTY: Compiled = { error: '', ok: false, parameters: [], fn: null, cfn: null, real: null, set: null, xy: false };

/** "y =" or "f(x) =" in front of a graph y = f(x); not a comparison like y >= x. */
const GRAPH_PREFIX = /^\s*(?:y|[a-z]\s*\(\s*x\s*\))\s*=(?![=<>])/i;
const COMPLEX_PREFIX = /^\s*(?:[wy]|[a-z]\s*\(\s*[xz]\s*\))\s*=(?![=<>])/i;
/** Whether some side mentions z or i (a half-typed side is judged by its letters). */
const usesZ = (text: string) => text.split(RELATION).some((part, k) => {
  if (k % 2 || !part.trim()) return false;
  try { const n = parameterNames(part); return n.includes('i') || n.includes('z'); } catch { return /(?<![a-z])[zi](?![a-z])/i.test(part); }
});
const usesY = (text: string) => {
  try { return parameterNames(text).includes('y'); } catch { return /(?<![a-z])y(?![a-z])/i.test(text); }
};

/**
 * What a row of the Wykresy panel is. A graph: y = f(x), f(x) = …, or an expression in x (other letters get
 * sliders). A set: a condition or equation (|z − 1| ≤ 2, z² = −1, y > x², x = 2), or a number with real unknowns
 * (t + 2i). With z or i it lives on the complex plane as before; without them x and y are the coordinates.
 */
export function rowKind(expression: string): { kind: 'graph' } | { kind: 'set'; text: string; xy: boolean } {
  const body = expression.replace(GRAPH_PREFIX, '');
  if (body !== expression && !RELATION.test(body) && !usesY(body)) return usesZ(body) ? { kind: 'set', text: body, xy: false } : { kind: 'graph' };
  if (RELATION.test(expression)) return { kind: 'set', text: expression, xy: !usesZ(expression) };
  return usesZ(expression) ? { kind: 'set', text: expression, xy: false } : { kind: 'graph' };
}

/** Map an AST in (x, y) to one on z = x + yi: x → Re z, y → Im z. */
function xyNode(n: Node): Node {
  switch (n.t) {
    case 'x': return { t: 'call', n: 're', args: [{ t: 'param', n: 'z' }] };
    case 'param': return n.n === 'y' ? { t: 'call', n: 'im', args: [{ t: 'param', n: 'z' }] } : n;
    case 'num': case 'const': return n;
    case 'neg': case '!': case '°': return { ...n, a: xyNode(n.a) };
    case 'call': return { ...n, args: n.args.map(xyNode) };
    default: return { ...n, a: xyNode(n.a), b: xyNode(n.b) };
  }
}

const mentions = (n: Node, t: Node['t']): boolean => n.t === t || Object.values(n).some(v =>
  Array.isArray(v) ? v.some(c => mentions(c as Node, t)) : typeof v === 'object' && v !== null && 't' in v && mentions(v as Node, t));

function register(params: Params, names: string[]): void {
  for (const n of names) if (!Object.hasOwn(params, n)) params[n] = 1;
}

/** Outside the chosen interval the graph doesn't exist: plot, roots and hover all see NaN there. */
function restrict(f: FnState, fn: RealFunction): RealFunction {
  return x => x < f.from || x > f.to || (f.fromOpen && x === f.from) || (f.toOpen && x === f.to) ? NaN : fn(x);
}

export function compileRow(f: FnState, mode: Mode, params: Params): Compiled {
  const expression = f.expression;
  if (!expression.trim()) return EMPTY;
  try {
    if (mode === 'graph') {
      // Wykresy holds graphs and sets alike: each row says which it is
      const kind = rowKind(expression);
      if (kind.kind === 'set') return { ...compileSet(kind.text, params, kind.xy), xy: kind.xy };
    }
    if (mode === 'complex') {
      const clean = expression.replace(COMPLEX_PREFIX, '');
      const names = parameterNames(clean);
      const parameters = names.filter(n => n !== 'i' && n !== 'z');
      register(params, parameters);
      // Without i, z is just the variable: tan(z) is tan(x) on the real axis, so its values there can be proven.
      const real = names.includes('i') ? null : clean.replace(/z/gi, 'x');
      return { ...EMPTY, ok: true, parameters, cfn: compileComplex(clean, params), real };
    }
    const names = parameterNames(expression);
    register(params, names);
    return { ...EMPTY, ok: true, parameters: names, fn: restrict(f, compile(expression, params)), real: expression };
  } catch (e) {
    return { ...EMPTY, error: e instanceof MathError ? e.message : 'Nie udało się odczytać wyrażenia.' };
  }
}

/**
 * A set of complex numbers: a condition on z (|z − 1| ≤ 2, 1 < Re z < 3, z² = −1), or a number with real unknowns
 * (t + 2i, z = a + a²i, a + bi) showing everywhere it can land. Other letters in a condition get sliders.
 */
function compileSet(expression: string, params: Params, xy = false): Compiled {
  let parts = expression.split(RELATION).map(s => s.trim());
  if (!xy && parts.length === 3 && /^z$/i.test(parts[0]) && parts[1] === '=' && !parameterNames(parts[2]).includes('z')) parts = [parts[2]];
  const sides = parts.filter((_, k) => k % 2 === 0);
  if (sides.some(p => !p)) throw new MathError('Uzupełnij obie strony warunku, np. |z − 1| ≤ 2.');
  if (parts.length === 1) {
    const node = parse(parts[0]), names = parameterNames(parts[0]).filter(n => n !== 'i');
    if (names.includes('z')) throw new MathError('Dopisz warunek dla z, np. |z − 1| ≤ 2, albo wpisz liczbę z niewiadomymi, np. t + 2i.');
    // x is an unknown too (x + yi). It is the expression's variable, so its value goes in as the argument.
    const usesX = mentions(node, 'x'), unknowns = usesX ? ['x', ...names] : names;
    if (unknowns.length > 2) throw new MathError('Najwyżej dwie niewiadome, np. a + bi.');
    const values: Params = {}, cf = buildComplex(node, values);
    const at = (...ts: number[]) => {
      names.forEach((n, k) => { values[n] = ts[k + (usesX ? 1 : 0)]; });
      return cf([usesX ? ts[0] : 0, 0]);
    };
    return { ...EMPTY, ok: true, set: { kind: 'parametric', unknowns, at } };
  }
  const parameters = [...new Set(sides.flatMap(parameterNames))].filter(n => n !== 'i' && n !== 'z' && (!xy || n !== 'y'));
  register(params, parameters);
  return {
    ...EMPTY, ok: true, parameters,
    set: {
      kind: 'condition',
      sides: sides.map(s => xy ? buildComplex(xyNode(parse(s)), params) : compileComplex(s, params)),
      ops: parts.filter((_, k) => k % 2).map(relationSymbol),
    },
  };
}

/** Cache: recompiles a row only when its expression or the mode changes. */
const cache = new Map<number, { key: string; compiled: Compiled }>();
export function compiled(f: FnState, mode: Mode, params: Params): Compiled {
  const key = `${mode}\u0000${f.expression}\u0000${f.from}\u0000${f.to}\u0000${f.fromOpen}\u0000${f.toOpen}`, hit = cache.get(f.id);
  if (hit?.key === key) return hit.compiled;
  const c = compileRow(f, mode, params);
  cache.set(f.id, { key, compiled: c });
  return c;
}
export function forget(ids: Set<number>): void {
  for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
}
