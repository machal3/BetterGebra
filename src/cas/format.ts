/**
 * Expressions → MathML (typeset) and → plain text that the parser reads back. Sums are shown by falling degree
 * (x² + 2x + 1), products with their denominators as fractions, x^(1/2) as a root, i last (2πi).
 */
import { Expr, add, isNegative, isNum, isSym, mul, neg, num, numDen as splitFraction, pow, split, isOne } from './expr';
import { Q } from './q';

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const mi = (s: string, normal = false) => normal || s.length > 1 ? `<mi mathvariant="normal">${esc(s)}</mi>` : `<mi>${esc(s)}</mi>`;
const mn = (s: string) => `<mn>${esc(s)}</mn>`;
const mo = (s: string) => `<mo>${esc(s)}</mo>`;
const row = (...s: string[]) => `<mrow>${s.join('')}</mrow>`;
const tallRe = /<m(?:frac|sqrt|root|table)/;
const fence = (open: string, close: string, inner: string) => tallRe.test(inner)
  ? row(mo(open), inner, mo(close))
  : row(`<mo stretchy="false">${esc(open)}</mo>`, inner, `<mo stretchy="false">${esc(close)}</mo>`);
const paren = (inner: string) => fence('(', ')', inner);
const TIMES = '<mo>&#x2062;</mo>', APPLY = '<mo>&#x2061;</mo>';

export const FN_NAMES: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tg', cot: 'ctg', sec: 'sec', csc: 'cosec', asin: 'arcsin', acos: 'arccos', atan: 'arctg', acot: 'arcctg',
  asec: 'arcsec', acsc: 'arccosec', sinh: 'sinh', cosh: 'cosh', tanh: 'tgh', coth: 'ctgh', sech: 'sech', csch: 'csch',
  asinh: 'arsinh', acosh: 'arcosh', atanh: 'artgh', acoth: 'arctgh', ln: 'ln', sign: 'sgn', gamma: 'Γ', zeta: 'ζ', erf: 'erf', erfc: 'erfc',
  re: 'Re', im: 'Im', arg: 'arg', max: 'max', min: 'min', mod: 'mod', frac: 'frac', round: 'round',
};
const SYMBOLS: Record<string, string> = { pi: 'π', inf: '∞', gammaconst: 'γ' };

/** Decimal digits of a rational, or of a fraction with Polish comma. */
export const intText = (n: bigint) => n.toString();

/** e^(−x) stays a power in display; other negative powers go under a fraction bar. */
const expBase = (e: Expr) => e.k === '^' && isSym(e.b, 'e') && !isNum(e.e);
function numDen(e: Expr): [Expr, Expr] {
  if (e.k !== '*') return expBase(e) ? [e, mul()] : splitFraction(e);
  const keep = e.t.filter(expBase), rest = e.t.filter(f => !expBase(f));
  const [n, d] = splitFraction(mul(...rest));
  return [mul(n, ...keep), d];
}

/** (1 + √5)/2 rather than 1/2 + √5/2: a sum of constants over its common denominator. */
function commonDenominator(e: Expr & { t: readonly Expr[] }): [Expr, bigint] | null {
  if (!e.t.every(t => isConstantE(t))) return null;
  let D = 1n, fracs = 0;
  for (const t of e.t) {
    const [c] = split(t);
    if (c.d > 1n) { fracs++; D = D / gcdB(D, c.d) * c.d; }
  }
  if (D === 1n || fracs < 2) return null;
  const numer = add(...e.t.map(t => mul(num(D), t)));
  if (numer.k !== '+') return null;
  return [numer, D];
}
const gcdB = (a: bigint, b: bigint): bigint => (b ? gcdB(b, a % b) : a);
const isConstantE = (e: Expr): boolean => e.k === 's' ? ['pi', 'e', 'i'].includes(e.n) : e.k === 'n' || ((e.k === '+' || e.k === '*') ? e.t.every(isConstantE) : e.k === '^' ? isConstantE(e.b) && isConstantE(e.e) : e.a.every(isConstantE));

// --- Display order ---

function degree(t: Expr): number {
  if (t.k === 's') return isSym(t, 'pi') || isSym(t, 'e') || isSym(t, 'i') ? 0 : 1;
  if (t.k === '^') return t.e.k === 'n' ? degree(t.b) * Number(t.e.v.n) / Number(t.e.v.d) : 0.5;
  if (t.k === '*') return t.t.reduce((s, f) => s + degree(f), 0);
  if (t.k === 'f') return 0.25;
  if (t.k === '+') return Math.max(...t.t.map(degree));
  return 0;
}
/** Terms by falling degree; a leading minus is avoided when a plus term can go first (1 − x, not −x + 1). */
export function displayTerms(terms: readonly Expr[]): Expr[] {
  const out = [...terms].sort((a, b) => degree(b) - degree(a));
  if (out.length === 2 && isNegative(out[0]) && !isNegative(out[1])) out.reverse();
  return out;
}
/** i goes last, numeric roots right after the coefficient: 2√3·π·i. */
function displayFactors(fs: readonly Expr[]): Expr[] {
  const rank = (f: Expr) => isNum(f) ? 0 : f.k === '^' && isNum(f.b) ? 1 : isSym(f, 'i') ? 6 : f.k === '+' ? 5
    : f.k === 's' || (f.k === '^' && f.b.k === 's' && !isSym(f.b, 'e')) ? 2 : f.k === '^' && isSym(f.b, 'e') ? 3 : 4;
  return [...fs].sort((a, b) => rank(a) - rank(b));
}

// --- MathML ---

const PREC = { sum: 1, product: 2, unary: 3, power: 4, atom: 5 };
function prec(e: Expr): number {
  if (e.k === '+') return PREC.sum;
  if (e.k === 'n') return e.v.d !== 1n ? PREC.product : e.v.n < 0n ? PREC.unary : PREC.atom;
  if (e.k === '*') return isNegative(e) ? PREC.unary : PREC.product;
  if (e.k === '^') return isNegative(e.e) || (e.e.k === 'n' && e.e.v.d !== 1n && e.e.v.n === 1n) ? PREC.atom : PREC.power;
  return PREC.atom;
}

function numML(v: Q): string {
  const sign = v.n < 0n ? mo('−') : '';
  const n = v.n < 0n ? -v.n : v.n;
  if (v.d === 1n) return sign ? row(sign, mn(intText(n))) : mn(intText(n));
  return row(sign, `<mfrac>${mn(intText(n))}${mn(intText(v.d))}</mfrac>`);
}

export function toML(e: Expr): string {
  switch (e.k) {
    case 'n': return numML(e.v);
    case 's': return SYMBOLS[e.n] ? mi(SYMBOLS[e.n]) : mi(e.n);
    case '+': {
      const cd = commonDenominator(e);
      if (cd) return `<mfrac>${row(toML(cd[0]))}${mn(intText(cd[1]))}</mfrac>`;
      const terms = displayTerms(e.t);
      let out = toML(terms[0]);
      for (const t of terms.slice(1)) {
        if (isNegative(t)) out += mo('−') + wrapML(neg(t), PREC.sum + 1);
        else out += mo('+') + wrapML(t, PREC.sum + 1);
      }
      return row(out);
    }
    case '*': {
      if (isNegative(e)) return row(mo('−'), wrapML(neg(e), PREC.product));
      const [n, d] = numDen(e);
      if (!isOne(d)) return `<mfrac>${row(toML(n))}${row(toML(d))}</mfrac>`;
      const fs = displayFactors(e.t);
      let out = '';
      fs.forEach((f, j) => {
        const s = wrapML(f, PREC.product + (f.k === '*' ? 1 : 0));
        if (j) out += isNum(f) ? mo('·') : TIMES;
        out += s;
      });
      return row(out);
    }
    case '^': {
      if (isNegative(e.e) && !expBase(e)) return `<mfrac>${mn('1')}${row(toML(pow(e.b, neg(e.e))))}</mfrac>`;
      if (e.e.k === 'n' && e.e.v.d !== 1n && e.e.v.n === 1n) {
        return e.e.v.d === 2n ? `<msqrt>${toML(e.b)}</msqrt>` : `<mroot>${row(toML(e.b))}${mn(intText(e.e.v.d))}</mroot>`;
      }
      // sin²x
      if (e.b.k === 'f' && FN_NAMES[e.b.n] && e.e.k === 'n' && e.e.v.d === 1n && e.e.v.n > 0n) return fnML(e.b.n, e.b.a, toML(e.e));
      return `<msup>${row(wrapML(e.b, PREC.atom + (e.b.k === 'f' ? 1 : 0)))}${row(toML(e.e))}</msup>`;
    }
    case 'f': return fnML(e.n, e.a);
  }
}

function wrapML(e: Expr, need: number): string {
  return prec(e) < need ? paren(toML(e)) : toML(e);
}

function fnML(n: string, a: readonly Expr[], sup?: string): string {
  const [x, y] = a.map(toML);
  switch (n) {
    case 'abs': return fence('|', '|', x);
    case 'floor': return fence('⌊', '⌋', x);
    case 'ceil': return fence('⌈', '⌉', x);
    case 'factorial': return row(wrapML(a[0], PREC.atom), mo('!'));
    case 'binomial': return paren(`<mfrac linethickness="0">${row(x)}${row(y)}</mfrac>`);
    case 'conj': return `<mover>${row(x)}${mo('‾')}</mover>`;
  }
  const label = mi(FN_NAMES[n] ?? n, true);
  const head = sup ? `<msup>${label}${row(sup)}</msup>` : label;
  const simple = a.length === 1 && (a[0].k === 's' || (a[0].k === 'n' && a[0].v.d === 1n && a[0].v.n >= 0n)) && n !== 'gamma' && n !== 'zeta';
  const body = simple ? `<mspace width="0.17em"/>${x}` : paren(a.map(toML).join(mo(';')));
  return row(head, APPLY, body);
}

// --- Text (re-parsable) ---

const SYMBOL_TEXT: Record<string, string> = { pi: 'π', inf: '∞', gammaconst: 'γ' };
const TEXT_FN: Record<string, string> = { ...FN_NAMES, gamma: 'gamma', zeta: 'zeta', sign: 'sgn', re: 're', im: 'im', csc: 'csc' };

export function toText(e: Expr): string {
  switch (e.k) {
    case 'n': {
      const sign = e.v.n < 0n ? '−' : '', n = e.v.n < 0n ? -e.v.n : e.v.n;
      return e.v.d === 1n ? `${sign}${intText(n)}` : `${sign}${intText(n)}/${intText(e.v.d)}`;
    }
    case 's': return SYMBOL_TEXT[e.n] ?? e.n;
    case '+': {
      const cd = commonDenominator(e);
      if (cd) return `(${toText(cd[0])})/${intText(cd[1])}`;
      const terms = displayTerms(e.t);
      let out = toText(terms[0]);
      for (const t of terms.slice(1)) out += isNegative(t) ? ` − ${wrapText(neg(t), PREC.sum + 1)}` : ` + ${wrapText(t, PREC.sum + 1)}`;
      return out;
    }
    case '*': {
      if (isNegative(e)) return `−${wrapText(neg(e), PREC.product)}`;
      const [n, d] = numDen(e);
      if (!isOne(d)) return `${wrapText(n, PREC.product)}/${wrapText(d, PREC.unary)}`;
      const fs = displayFactors(e.t);
      let out = '';
      fs.forEach((f, j) => {
        const s = wrapText(f, PREC.product + (f.k === '*' ? 1 : 0));
        if (j) {
          const prev = fs[j - 1];
          // 2x, 2√3, kπ, 2πi: no dot where reading it back is unambiguous (not √3·i: √3i would be √(3i))
          const glue = (isNum(prev) && !/^\d/.test(s)) || ((isSym(f, 'pi') || isSym(f, 'i')) && (isNum(prev) || prev.k === 's')) || (isSym(prev, 'pi') && f.k === 's');
          out += glue ? '' : '·';
        }
        out += s;
      });
      return out;
    }
    case '^': {
      if (isNegative(e.e) && !expBase(e)) return `1/${wrapText(pow(e.b, neg(e.e)), PREC.unary)}`;
      if (e.e.k === 'n' && e.e.v.n === 1n && e.e.v.d === 2n) return `√${simpleArg(e.b) ? toText(e.b) : `(${toText(e.b)})`}`;
      if (e.e.k === 'n' && e.e.v.n === 1n && e.e.v.d === 3n) return `∛${simpleArg(e.b) ? toText(e.b) : `(${toText(e.b)})`}`;
      const exp = e.e.k === 'n' && e.e.v.d === 1n && e.e.v.n >= 0n || e.e.k === 's' ? toText(e.e) : `(${toText(e.e)})`;
      return `${wrapText(e.b, PREC.atom)}^${exp}`;
    }
    case 'f': {
      if (e.n === 'abs') return `|${toText(e.a[0])}|`;
      if (e.n === 'factorial') return `${wrapText(e.a[0], PREC.atom)}!`;
      return `${TEXT_FN[e.n] ?? e.n}(${e.a.map(toText).join('; ')})`;
    }
  }
}
const simpleArg = (e: Expr) => (e.k === 'n' && e.v.d === 1n && e.v.n >= 0n) || e.k === 's';
function precText(e: Expr): number {
  if (e.k === '^') {
    if (isNegative(e.e) && !expBase(e)) return PREC.product;
    if (e.e.k === 'n' && e.e.v.n === 1n && (e.e.v.d === 2n || e.e.v.d === 3n)) return PREC.unary;
    return PREC.power;
  }
  return prec(e);
}
function wrapText(e: Expr, need: number): string {
  return precText(e) < need ? `(${toText(e)})` : toText(e);
}

