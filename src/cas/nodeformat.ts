/**
 * The input as the user wrote it (before any simplification), typeset: d/dx, ∫ with limits, lim, Σ, Π are drawn
 * as such, other commands by their Polish names.
 */
import type { Node } from './parse';
import { FN_NAMES } from './format';

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const mi = (s: string, normal = false) => normal || s.length > 1 ? `<mi mathvariant="normal">${esc(s)}</mi>` : `<mi>${esc(s)}</mi>`;
const mn = (s: string) => `<mn>${esc(s)}</mn>`;
const mo = (s: string) => `<mo>${esc(s)}</mo>`;
const row = (...s: string[]) => `<mrow>${s.join('')}</mrow>`;
const tall = (s: string) => /<m(?:frac|sqrt|root|table|under|over)/.test(s);
const fence = (o: string, c: string, s: string) => tall(s) ? row(mo(o), s, mo(c)) : row(`<mo stretchy="false">${esc(o)}</mo>`, s, `<mo stretchy="false">${esc(c)}</mo>`);
const paren = (s: string) => fence('(', ')', s);
const TIMES = '<mo>&#x2062;</mo>', APPLY = '<mo>&#x2061;</mo>';

export const COMMAND_NAMES: Record<string, string> = {
  simplify: 'uprość', expand: 'rozwiń', factor: 'rozłóż', together: 'wspólny mianownik', apart: 'ułamki proste', cancel: 'skróć',
  numer: 'licznik', denom: 'mianownik', solve: 'rozwiąż', roots: 'pierwiastki', approx: 'przybliżenie', subst: 'podstaw',
  domain: 'dziedzina', analyze: 'badanie funkcji', tangent: 'styczna', extrema: 'ekstrema', isprime: 'czy pierwsza', nextprime: 'następna pierwsza',
  prevprime: 'poprzednia pierwsza', prime: 'liczba pierwsza nr', primepi: 'π', factorint: 'rozkład', gcd: 'NWD', lcm: 'NWW', divisors: 'dzielniki',
  totient: 'φ', sigma: 'σ', mobius: 'μ', fibonacci: 'F', lucas: 'L', catalan: 'C', powmod: 'potęga modulo', modinv: 'odwrotność modulo',
  crt: 'chińskie twierdzenie o resztach', base: 'w systemie', digits: 'cyfry', contfrac: 'ułamek łańcuchowy', rationalize: 'przybliżenie wymierne',
  det: 'det', inverse: 'odwrotna', transpose: 'transpozycja', rank: 'rząd', rref: 'postać schodkowa', trace: 'ślad', eigenvalues: 'wartości własne',
  eigenvectors: 'wektory własne', charpoly: 'wielomian charakterystyczny', nullspace: 'jądro', dot: 'iloczyn skalarny', cross: 'iloczyn wektorowy',
  norm: 'norma', identity: 'macierz jednostkowa', mean: 'średnia', median: 'mediana', variance: 'wariancja', stdev: 'odchylenie standardowe',
  sort: 'sortuj', total: 'suma', degree: 'stopień', coeffs: 'współczynniki', discriminant: 'Δ', quotient: 'iloraz', remainder: 'reszta',
  polygcd: 'NWD', resultant: 'rugownik', trigexpand: 'rozwiń trygonometrycznie', trigreduce: 'linearyzuj', expandlog: 'rozwiń logarytmy',
  clear: 'usuń zmienne', who: 'zmienne', sum: 'sum', product: 'prod', dsolve: 'dsolve',
};
const ID: Record<string, string> = { pi: 'π', inf: '∞', phi: 'φ', tau: 'τ', ans: 'ans' };
const PREC: Record<string, number> = { rel: 0, '+': 1, '-': 1, '*': 2, '/': 2, '.*': 2, './': 2, '\\': 2, neg: 3, '^': 4, '.^': 4, post: 5 };
const prec = (n: Node): number => n.t === 'op' ? PREC[n.o] : n.t === 'neg' ? 3 : n.t === 'rel' || n.t === 'range' || n.t === 'lambda' || n.t === 'assign' || n.t === 'massign' ? 0 : n.t === 'post' ? 5 : n.t === 'num' && n.v.startsWith('-') ? 3 : 6;
const wrap = (n: Node, need: number) => (prec(n) < need ? paren(ml(n)) : ml(n));
const startsNum = (n: Node): boolean => n.t === 'num' || (n.t === 'op' && (n.o === '*' || n.o === '^') && startsNum(n.a)) || (n.t === 'post' && startsNum(n.a));

/** Names as the input wrote them (A, Dane): the parser reads small letters only. */
export function spelling(raw: string, fallback: (n: string) => string | undefined = () => undefined): (n: string) => string {
  return n => (n === 'e' || n === 'i' ? n : raw.match(new RegExp(String.raw`(?<![\p{L}\d_])${n}(?![\p{L}\d_])`, 'iu'))?.[0] ?? fallback(n) ?? n);
}
let spell = (n: string) => n;
export function nodeML(n: Node, spelled?: (n: string) => string): string {
  spell = spelled ?? (s => s);
  // statements (a = 1; b = a + 1) one after another, not a set in braces
  const body = n.t === 'list' && n.items.some(i => i.t === 'assign' || i.t === 'massign') ? n.items.map(ml).join(`${mo(';')}<mspace width="0.6em"/>`) : null;
  try { return `<math display="block">${body ?? ml(n)}</math>`; } finally { spell = s => s; }
}

function ml(n: Node): string {
  switch (n.t) {
    case 'num': return mn(n.v.replace('.', ','));
    case 'id': return mi(ID[n.n] ?? spell(n.n));
    case 'neg': return row(mo('−'), wrap(n.a, 3));
    case 'post':
      if (n.tr) return `<msup>${row(wrap(n.a, 6))}${mi('T')}</msup>`;
      return n.o === "'" ? `<msup>${row(wrap(n.a, 6))}${mo('′')}</msup>` : n.o === ".'" ? ml(n.a) : row(wrap(n.a, 6), mo(n.o));
    case 'range': return row(...[n.a, ...(n.step ? [n.step] : []), n.b].map(p => wrap(p, 1)).flatMap((p, k) => (k ? [mo(':'), p] : [p])));
    case 'index': return row(mi(spell(n.n)), paren(n.args.map(ml).join(mo(','))));
    case 'colon': return mo(':');
    case 'end': return mi('end', true);
    case 'lambda': return row(paren(n.params.map(p => mi(p)).join(mo(','))), mo('↦'), ml(n.body));
    case 'assign': return row(mi(spell(n.name)), n.params ? paren(n.params.map(p => mi(spell(p))).join(mo(','))) : '', mo(n.op === ':=' ? '≔' : '='), ml(n.value));
    case 'massign': return row(fence('[', ']', n.names.map(p => mi(spell(p))).join(mo(','))), mo('='), ml(n.value));
    case 'str': return `<mtext>‘${esc(n.v)}’</mtext>`;
    case 'rel': return row(n.parts.map((p, k) => (k ? mo(relSym(n.ops[k - 1])) : '') + ml(p)).join(''));
    case 'list': {
      if (n.items.length && n.items.every(i => i.t === 'list') && n.bracket === '[') {
        const rows = n.items.map(r => `<mtr>${(r as { items: Node[] }).items.map(c => `<mtd>${ml(c)}</mtd>`).join('')}</mtr>`).join('');
        return fence('[', ']', `<mtable>${rows}</mtable>`);
      }
      const inner = n.items.map(ml).join(mo(';'));
      return n.bracket === '{' ? fence('{', '}', inner) : fence('[', ']', inner);
    }
    case 'op': {
      switch (n.o) {
        case '+': return row(ml(n.a), mo('+'), wrap(n.b, 2));
        case '-': return row(ml(n.a), mo('−'), wrap(n.b, 2));
        case '/': case './': return `<mfrac>${row(ml(n.a))}${row(ml(n.b))}</mfrac>`;
        case '.*': return row(wrap(n.a, 2), mo('∘'), wrap(n.b, 3));
        case '\\': return row(wrap(n.a, 2), mo('\\'), wrap(n.b, 3));
        case '.^': return `<msup>${row(wrap(n.a, 6))}${row(ml(n.b))}</msup>`;
        case '*': {
          const dot = startsNum(n.b) || (n.b.t === 'op' && n.b.o === '/');
          return row(wrap(n.a, 2), dot ? mo('·') : TIMES, wrap(n.b, 3));
        }
        case '^': {
          if (n.a.t === 'call' && FN_NAMES[n.a.n] && n.a.args.length === 1) return call(n.a.n, n.a.args, ml(n.b));
          return `<msup>${row(wrap(n.a, 6))}${row(ml(n.b))}</msup>`;
        }
      }
    }
    // falls through for calls
    case 'call': return call((n as { n: string }).n, (n as { args: Node[] }).args);
  }
}
const relSym = (op: string) => ({ '<=': '≤', '>=': '≥', '!=': '≠', '->': '→' } as Record<string, string>)[op] ?? op;

function dOf(v: string, k?: string): string {
  const d = mi('d');
  return k ? `<mfrac><msup>${d}${mn(k)}</msup><mrow>${d}<msup>${mi(v)}${mn(k)}</msup></mrow></mfrac>` : `<mfrac>${d}<mrow>${d}${mi(v)}</mrow></mfrac>`;
}

function call(name: string, args: Node[], sup?: string): string {
  const a = args.map(ml);
  const v = (k: number) => (args[k]?.t === 'id' ? (args[k] as { n: string }).n : null);
  switch (name) {
    case 'sqrt': return `<msqrt>${a[0]}</msqrt>`;
    case 'cbrt': return `<mroot>${row(a[0])}${mn('3')}</mroot>`;
    case 'root': return `<mroot>${row(a[1])}${row(a[0])}</mroot>`;
    case 'abs': return fence('|', '|', a[0]);
    case 'floor': return fence('⌊', '⌋', a[0]);
    case 'ceil': return fence('⌈', '⌉', a[0]);
    case 'exp': return `<msup>${mi('e')}${row(a[0])}</msup>`;
    case 'factorial': return row(wrap(args[0], 6), mo('!'));
    case 'binomial': return paren(`<mfrac linethickness="0">${row(a[0])}${row(a[1])}</mfrac>`);
    case 'log': if (a.length === 2) return row(`<msub>${mi('log', true)}${row(a[0])}</msub>`, APPLY, paren(a[1])); break;
    case 'log10': return row(mi('log', true), APPLY, paren(a[0]));
    case 'log2': return row(`<msub>${mi('log', true)}${mn('2')}</msub>`, APPLY, paren(a[0]));
    case 'conj': return `<mover>${row(a[0])}${mo('‾')}</mover>`;
    case 'diff': {
      const x = v(1) ?? 'x', k = args[2]?.t === 'num' ? (args[2] as { v: string }).v : undefined;
      return row(dOf(x, k && k !== '1' ? k : undefined), wrap(args[0], 3));
    }
    case 'integrate': {
      const x = v(1) ?? 'x';
      const body = row(wrap(args[0], 2), '<mspace width="0.17em"/>', mi('d'), mi(x));
      if (args.length >= 4) return row(`<msubsup>${mo('∫')}${row(a[2])}${row(a[3])}</msubsup>`, body);
      return row(mo('∫'), body);
    }
    case 'limit': {
      let x: string, at: string, dirNode: Node | undefined;
      const r = args[1];
      if (r?.t === 'rel') { x = ml(r.parts[0]); at = ml(r.parts[1]); dirNode = args[2]; }
      else { x = a[1] ?? mi('x'); at = a[2] ?? mn('0'); dirNode = args[3]; }
      const side = dirNode?.t === 'num' ? '+' : dirNode?.t === 'neg' ? '−' : '';
      const point = side ? `<msup>${row(at)}${mo(side)}</msup>` : at;
      return row(`<munder>${mi('lim', true)}${row(x, mo('→'), point)}</munder>`, wrap(args[0], 2));
    }
    case 'sum': case 'product': {
      const op = name === 'sum' ? '∑' : '∏';
      if (args.length >= 4) return row(`<munderover>${mo(op)}${row(a[1], mo('='), a[2])}${row(a[3])}</munderover>`, wrap(args[0], 2));
      break;
    }
  }
  const label = FN_NAMES[name] ?? COMMAND_NAMES[name] ?? name;
  const head = sup ? `<msup>${mi(label, true)}${row(sup)}</msup>` : mi(label, true);
  return row(head, APPLY, paren(a.join(mo(';'))));
}
