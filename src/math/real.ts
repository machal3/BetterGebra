import type { Node, Params } from './ast';
import { CONST, FN, factorial } from './functions';
import { MathError, parameterNames, parse } from './parser';

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

const usesX = (n: Node): boolean => n.t === 'x' || Object.values(n).some(v =>
  Array.isArray(v) ? v.some(c => usesX(c as Node)) : typeof v === 'object' && v !== null && 't' in v && usesX(v as Node));

/**
 * A number written as an expression without variables: "pi/2", "-e", "2√3", "1e-3", and "∞" / "-inf".
 * For interval ends. Throws a MathError with a readable message otherwise.
 */
export function constant(input: string): number {
  const infinity = input.trim().match(/^([+\-−]?)\s*(?:∞|inf(?:inity)?)$/i);
  if (infinity) return infinity[1] === '-' || infinity[1] === '−' ? -Infinity : Infinity;
  const ast = parse(input);
  if (usesX(ast)) throw new MathError('Granica nie może zależeć od x. Wpisz liczbę lub stałą, np. pi/2.');
  const names = parameterNames(input);
  if (names.length) throw new MathError(`„${names[0]}” nie jest stałą. Użyj liczb i stałych: pi, e, tau, phi.`);
  const v = buildReal(ast, {})(0);
  if (Number.isNaN(v)) throw new MathError('To wyrażenie nie ma wartości liczbowej.');
  return v;
}
