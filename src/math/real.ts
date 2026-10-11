import type { Node, Params } from './ast';
import { CONST, FN, factorial } from './functions';
import { parse } from './parser';

export type RealFunction = (x: number) => number;

/** AST → closure. Parameters are read from `params` on every call, so moving a slider needs no recompiling. */
export function buildReal(n: Node, params: Params): RealFunction {
  switch (n.t) {
    case 'num': { const v = n.v; return () => v; }
    case 'x': return x => x;
    case 'const': { const v = CONST[n.n]; return () => v; }
    case 'param': { const name = n.n; return () => Object.hasOwn(params, name) ? params[name] : 1; }
    case 'neg': { const a = buildReal(n.a, params); return x => -a(x); }
    case '!': { const a = buildReal(n.a, params); return x => factorial(a(x)); }
    case '°': { const a = buildReal(n.a, params); return x => a(x) * Math.PI / 180; }
    case 'call': {
      const f = FN[n.n].f, args = n.args.map(g => buildReal(g, params));
      if (args.length === 1) { const [a] = args; return x => f(a(x)); }
      if (args.length === 2) { const [a, b] = args; return x => f(a(x), b(x)); }
      return x => f(...args.map(g => g(x)));
    }
    default: {
      const a = buildReal(n.a, params), b = buildReal(n.b, params);
      switch (n.t) {
        case '+': return x => a(x) + b(x);
        case '-': return x => a(x) - b(x);
        case '*': return x => a(x) * b(x);
        case '/': return x => a(x) / b(x);
        case '^': return x => a(x) ** b(x);
      }
    }
  }
}

export function compile(input: string, params: Params = {}): RealFunction {
  return buildReal(parse(input), params);
}
