import type { Node } from './ast';
import { CONST_SYMBOL, FN } from './functions';
import { parse } from './parser';

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const mi = (s: string) => `<mi>${esc(s)}</mi>`;
const mo = (s: string) => `<mo>${esc(s)}</mo>`;
const row = (s: string) => `<mrow>${s}</mrow>`;
const paren = (s: string) => row(`${mo('(')}${s}${mo(')')}`);
const INVISIBLE_TIMES = '<mo>&#x2062;</mo>', APPLY = '<mo>&#x2061;</mo>';

const PRECEDENCE: Partial<Record<Node['t'], number>> = { '+': 1, '-': 1, '*': 2, neg: 3, '^': 4, '!': 5, '°': 5 };
const prec = (n: Node) => PRECEDENCE[n.t] ?? 6;
const startsWithNumber = (n: Node): boolean => n.t === 'num' || (['*', '+', '-', '^', '!', '°'].includes(n.t) && 'a' in n && startsWithNumber(n.a));
const endsWithNumber = (n: Node): boolean => n.t === 'num' || ((n.t === '*' || n.t === '+' || n.t === '-') && endsWithNumber(n.b));
const atomic = (n: Node) => n.t === 'num' || n.t === 'x' || n.t === 'param' || n.t === 'const';
const radical = (n: Node) => n.t === 'call' && ['sqrt', 'cbrt', 'root', 'abs'].includes(n.n);
const wrap = (n: Node, parens: boolean) => parens ? paren(render(n)) : render(n);

function call(n: Extract<Node, { t: 'call' }>, sup?: string): string {
  const [x, y] = n.args.map(render);
  if (!sup) {
    switch (n.n) {
      case 'abs': return row(`${mo('|')}${x}${mo('|')}`);
      case 'floor': return row(`${mo('⌊')}${x}${mo('⌋')}`);
      case 'ceil': return row(`${mo('⌈')}${x}${mo('⌉')}`);
      case 'sqrt': return `<msqrt>${x}</msqrt>`;
      case 'cbrt': return `<mroot>${row(x)}<mn>3</mn></mroot>`;
      case 'root': return `<mroot>${row(y)}${row(x)}</mroot>`;
      case 'exp': return `<msup>${mi('e')}${row(x)}</msup>`;
      case 'log': if (y) return row(`<msub>${mi('log')}${row(x)}</msub>${paren(y)}`);
    }
  }
  const name = `<mi mathvariant="normal">${esc(FN[n.n].show)}</mi>`;
  const head = sup ? `<msup>${name}${row(sup)}</msup>` : name;
  const body = n.args.length === 1 && atomic(n.args[0]) ? `<mspace width="0.17em"/>${x}` : paren(n.args.map(render).join(mo(',')));
  return row(`${head}${APPLY}${body}`);
}

function render(n: Node): string {
  switch (n.t) {
    case 'num': return `<mn>${esc(n.s.replace('.', ','))}</mn>`;
    case 'x': return mi('x');
    case 'param': return mi(n.n);
    case 'const': return mi(CONST_SYMBOL[n.n]);
    case 'neg': return row(mo('−') + wrap(n.a, n.a.t === 'neg' || prec(n.a) <= 1));
    case '+': case '-': return row(render(n.a) + mo(n.t === '+' ? '+' : '−') + wrap(n.b, prec(n.b) <= 1 || n.b.t === 'neg'));
    case '*': {
      const right = prec(n.b) <= 3, dot = !right && (startsWithNumber(n.b) || (n.b.t === '/' && endsWithNumber(n.a)));
      return row(wrap(n.a, prec(n.a) <= 1) + (dot ? mo('·') : INVISIBLE_TIMES) + wrap(n.b, right));
    }
    case '/': return `<mfrac>${row(render(n.a))}${row(render(n.b))}</mfrac>`;
    case '^':
      // sin²x, but (√x)², e^x and log keep the power on the whole thing.
      if (n.fn && n.a.t === 'call' && !radical(n.a) && n.a.n !== 'exp' && n.a.n !== 'log') return call(n.a, render(n.b));
      return `<msup>${row(wrap(n.a, prec(n.a) < 6 || n.a.t === '/' || (radical(n.a) && !(n.a.t === 'call' && n.a.n === 'abs'))))}${row(render(n.b))}</msup>`;
    case '!': case '°': return row(wrap(n.a, prec(n.a) < 6 || n.a.t === '/') + mo(n.t));
    case 'call': return call(n);
  }
}

export function toMathML(input: string): string {
  return `<math>${mi('y')}${mo('=')}${render(parse(input))}</math>`;
}

/** A condition like |z − 1| ≤ 2 or 1 < Re z < 3: sides at even indices, relations at odd. */
export const RELATION = /(<=|>=|!=|≤|≥|≠|<|>|=)/;
export const relationSymbol = (op: string) => ({ '<=': '≤', '>=': '≥', '!=': '≠' } as Record<string, string>)[op] ?? op;
export function relationMathML(input: string): string {
  return `<math>${input.split(RELATION).map((part, k) => k % 2 ? mo(relationSymbol(part)) : render(parse(part))).join('')}</math>`;
}
/** MathML of an expression alone, without "y =". */
export function expressionMathML(input: string): string {
  return `<math>${render(parse(input))}</math>`;
}
