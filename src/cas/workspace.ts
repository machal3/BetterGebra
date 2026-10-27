/**
 * The calculator's variables (A = [1 2; 3 4], f(x) = x², n = 10) as they cross the worker boundary and live in
 * localStorage: each value written in the parser's own notation, kept only if reading it back gives the same value.
 * The worker holds nothing between questions (a newer question ends it), so the page sends the workspace with each.
 */
import { Expr, isNum, same, variables } from './expr';
import { Env, Value, Vars, evaluate, isApprox } from './evaluate';
import { toCode, toText } from './format';
import { VarKind, parse } from './parse';
import { fail, qToNumber } from './q';
import { approx as approxNum } from './numeric';

export interface Saved {
  kind: VarKind;
  /** The value (of a function, its body) in the parser's notation. */
  code: string;
  params?: string[];
  /** What it is, for the list of variables: "macierz 2×3", "funkcja (x)". */
  label: string;
  /** How it reads, shortened. */
  preview: string;
  /** The name as it was written (A; the parser reads names in small letters). */
  display?: string;
}

const MAX_CODE = 60_000;
export const MAX_VARS = 100;

const kindOf = (v: Value): VarKind => v.t === 'fn' ? 'fn' : v.t === 'matrix' ? 'matrix' : v.t === 'list' ? 'list' : 'scalar';

/**
 * An entry in the parser's notation. An approximate number goes as the shortest decimal of its double: double(…)
 * rounds it back to the very same double, in a fraction of the length of its exact binary fraction.
 */
const entry = (e: Expr, ap: boolean) => (ap && isNum(e) ? String(qToNumber(e.v)) : toCode(e));
function code(v: Value, ap = isApprox(v)): string {
  switch (v.t) {
    case 'expr': return entry(v.e, ap);
    case 'list': {
      if (v.items.some(i => i.t === 'list' || i.t === 'matrix')) fail('Listy list nie umiem zapamiętać jako zmiennej.');
      const inner = v.items.map(i => code(i, ap)).join(', ');
      return v.set ? `{${inner}}` : `[${inner}]`;
    }
    // rows split by ; so that a column [a; b] reads back as a column, not as the list [a, b]
    case 'matrix': return `[${v.rows.map(r => r.map(e => entry(e, ap)).join(', ')).join('; ')}]`;
    default: return fail('Tej wartości nie umiem zapamiętać jako zmiennej.');
  }
}

/** The value a stored variable holds. */
export function load(s: Saved, env: Env): Value {
  const params = s.params ?? [];
  // the parameters, and the components v_1, v_2 of a vector parameter, are names of their own
  const names = [...params, ...(s.code.match(/[a-z][a-z0-9]*_\d+/g) ?? [])];
  const v = evaluate(parse(s.code, { limit: MAX_CODE, assign: false, names: Object.fromEntries(names.map(p => [p, 'scalar' as const])) }), env);
  return s.kind === 'fn' ? { t: 'fn', params, body: v } : v;
}

function sameValue(a: Value, b: Value): boolean {
  if (a.t === 'expr' && b.t === 'expr') return same(a.e, b.e);
  if (a.t === 'list' && b.t === 'list') return a.set === b.set && a.items.length === b.items.length && a.items.every((x, k) => sameValue(x, b.items[k]));
  // a matrix of one row is the list of its entries (a row vector)
  if (a.t === 'matrix' && a.rows.length === 1 && b.t === 'list') return sameValue({ t: 'list', items: a.rows[0].map(e => ({ t: 'expr', e })), set: false }, b);
  if (a.t === 'matrix' && b.t === 'matrix') return a.rows.length === b.rows.length && a.rows.every((r, i) => r.length === b.rows[i].length && r.every((x, j) => same(x, b.rows[i][j])));
  if (a.t === 'fn' && b.t === 'fn') return a.params.join() === b.params.join() && sameValue(a.body, b.body);
  return false;
}

const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** An approximate number as MATLAB's short format shows it. */
const approxShort = (e: Expr) => { const z = approxNum(e); const f = (x: number) => (Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(5)))); return z.im ? `${f(z.re)}${z.im < 0 ? '−' : '+'}${f(Math.abs(z.im))}i` : f(z.re); };
function textOf(v: Value): string {
  if (isApprox(v)) {
    if (v.t === 'expr') return approxShort(v.e);
    if (v.t === 'list') return `[${v.items.slice(0, 12).map(i => (i.t === 'expr' ? approxShort(i.e) : '…')).join(', ')}${v.items.length > 12 ? ', …' : ''}]`;
    if (v.t === 'matrix') return `[${v.rows.slice(0, 4).map(r => r.slice(0, 6).map(approxShort).join(' ') + (r.length > 6 ? ' …' : '')).join('; ')}${v.rows.length > 4 ? '; …' : ''}]`;
  }
  switch (v.t) {
    case 'expr': return toText(v.e);
    case 'list': return `${v.set ? '{' : '['}${v.items.slice(0, 12).map(textOf).join(', ')}${v.items.length > 12 ? ', …' : ''}${v.set ? '}' : ']'}`;
    case 'matrix': return `[${v.rows.slice(0, 4).map(r => r.slice(0, 6).map(toText).join(' ') + (r.length > 6 ? ' …' : '')).join('; ')}${v.rows.length > 4 ? '; …' : ''}]`;
    case 'fn': return textOf(v.body);
    default: return '';
  }
}
function labelOf(v: Value): string {
  switch (v.t) {
    case 'expr': return variables(v.e).length ? 'wyrażenie' : 'liczba';
    case 'list': return v.set ? `zbiór, ${v.items.length} el.` : `wektor 1×${v.items.length}`;
    case 'matrix': return `macierz ${v.rows.length}×${v.rows[0]?.length ?? 0}`;
    case 'fn': return `funkcja (${v.params.join(', ')})`;
    default: return '';
  }
}

/** The value as stored, or an error saying why it can't be. */
export function save(v: Value, env: Env): Saved {
  const params = v.t === 'fn' ? v.params : undefined;
  // an approximate value is stored as double(…) of the doubles' exact values, and read back approximate
  const body = code(v.t === 'fn' ? v.body : v);
  const s: Saved = { kind: kindOf(v), code: isApprox(v) ? `double(${body})` : body, ...(params ? { params } : {}), label: labelOf(v) + (isApprox(v) ? ' ≈' : ''), preview: short(textOf(v)) };
  if (s.code.length > MAX_CODE) fail('Ta wartość jest za duża, by ją zapamiętać jako zmienną.');
  let back: Value | null = null;
  try { back = load(s, env); } catch { back = null; }
  if (!back || !sameValue(back, v)) fail('Tej wartości nie umiem zapamiętać jako zmiennej.');
  return s;
}

/** The workspace of one question: the stored variables, read when first used, and those this input assigns. */
export class Workspace implements Vars {
  readonly local = new Map<string, Value>();
  readonly used = new Set<string>();
  private cache = new Map<string, Value>();
  constructor(readonly saved: Readonly<Record<string, Saved>>, private env: () => Env) {}
  get(name: string): Value | undefined {
    if (this.local.has(name)) return this.local.get(name);
    const s = Object.hasOwn(this.saved, name) ? this.saved[name] : undefined;
    if (!s) return undefined;
    this.used.add(name);
    if (!this.cache.has(name)) this.cache.set(name, load(s, this.env()));
    return this.cache.get(name);
  }
  kinds(): Record<string, VarKind> {
    return Object.fromEntries(Object.entries(this.saved).filter(([n]) => !n.startsWith('#')).map(([n, s]) => [n, s.kind]));
  }
  reset() { this.local.clear(); this.used.clear(); }
}

/** The symbols left free in a value (a function's parameters are its own). */
export function freeSymbols(v: Value): string[] {
  const out = new Set<string>();
  const walk = (w: Value, bound: string[]) => {
    if (w.t === 'expr') { for (const s of variables(w.e)) if (!bound.includes(s)) out.add(s); }
    else if (w.t === 'list') w.items.forEach(i => walk(i, bound));
    else if (w.t === 'matrix') w.rows.flat().forEach((e: Expr) => walk({ t: 'expr', e }, bound));
    else if (w.t === 'fn') walk(w.body, [...bound, ...w.params]);
  };
  walk(v, []);
  return [...out];
}
