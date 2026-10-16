import type { Node } from './ast';
import { ALIAS, CONST, FN, INVERSE, isConst } from './functions';

export class MathError extends Error {}
const fail = (message: string): never => { throw new MathError(message); };

const MAX_LENGTH = 300;
/** Every multi-letter word the lexer knows, longest first, so "sinh" wins over "sin" and "phi" over "pi". */
const WORDS = [...Object.keys(FN), ...Object.keys(ALIAS), ...Object.keys(CONST), 'frac', 'x'].sort((a, b) => b.length - a.length);
const OPEN = ['(', '[', '{'], CLOSE = [')', ']', '}'];
const SUPERSCRIPT: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };
const TOKEN = /(?:\d+,\d+|\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?|[a-z]+|[+\-*/^()[\]{}|,;!°_]/g;

/** Unicode, LaTeX and the "y =" / "f(x) =" prefix rewritten to the plain ASCII the tokenizer reads. */
function normalize(input: string): string {
  return input.toLowerCase()
    .replace(/^\s*(?:y|[a-z]\s*\(\s*x\s*\))\s*=/, '')
    .replace(/\\(?:cdot|times)/g, '*').replace(/\\div/g, '/').replace(/\\(?:left|right)|\\[,;:! ]/g, '').replace(/\\/g, '')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, s => `^(${[...s].map(c => SUPERSCRIPT[c]).join('')})`)
    .replace(/π/g, 'pi').replace(/τ/g, 'tau').replace(/[φϕ]/g, 'phi').replace(/√/g, 'sqrt').replace(/∛/g, 'cbrt')
    .replace(/[·⋅∙×]/g, '*').replace(/[÷:]/g, '/').replace(/[−–]/g, '-').replace(/\*\*/g, '^')
    .trim();
}

export function tokenize(input: string): string[] {
  const source = normalize(input);
  if (!source || source.length > MAX_LENGTH) fail('Wpisz funkcję, np. x^2 lub sin(x).');
  // "1..2" or "1.2.3" would otherwise read as an implicit product of 1. and .2.
  if (/\.\d*\./.test(source)) fail('Liczba ma za dużo kropek.');
  const raw = source.match(TOKEN) ?? [];
  if (raw.join('') !== source.replace(/\s/g, '')) fail('Nieznany znak. Użyj liter, liczb i działań matematycznych.');
  // A run of letters is split into known words and single-letter parameters: "2pix" → 2 pi x, "sinx" → sin x, "ab" → a b.
  return raw.flatMap((token, k) => {
    if (!/^[a-z]+$/.test(token)) return [token];
    const out: string[] = [];
    let unknown = 0;
    for (let i = 0; i < token.length;) {
      const word = WORDS.find(w => token.startsWith(w, i)) ?? token[i];
      if (word.length === 1 && word !== 'x' && word !== 'e') unknown++;
      out.push(ALIAS[word] ?? word);
      i += word.length;
    }
    // "alert", "foo(x)": too many unknown letters to be a product of parameters.
    if (unknown > 3 || (unknown > 1 && OPEN.includes(raw[k + 1]))) fail(`Nie rozpoznaję „${token}”. Między parametrami wstaw *, np. a*b.`);
    return out;
  });
}

const isParam = (t: string | undefined): boolean => t !== undefined && /^[a-z]$/.test(t) && t !== 'x' && t !== 'e';
const isNumber = (t: string | undefined) => t !== undefined && /^\.?\d/.test(t);

/** Single letters other than x and e, which get a slider. */
export function parameterNames(input: string): string[] {
  if (!input.trim()) return [];
  return [...new Set(tokenize(input).filter(isParam))].sort();
}

export function parse(input: string): Node {
  const tokens = tokenize(input);
  let i = 0, absDepth = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  const close = () => { if (!CLOSE.includes(take())) fail('Brakuje zamykającego nawiasu.'); };
  // Inside |…| a bar closes, so it can't start an implicit product there.
  const startsAtom = (t: string | undefined) => t !== undefined && (isNumber(t) || /^[a-z]/.test(t) || OPEN.includes(t) || (t === '|' && !absDepth));
  const simple = (t: string | undefined) => isNumber(t) || t === 'x' || isParam(t) || (t !== undefined && isConst(t));

  function call(name: string): Node {
    const args: Node[] = [];
    let power: Node | null = null;
    if (name === 'sqrt' && peek() === '[') {
      take(); args.push(sum());
      if (take() !== ']') fail('Brakuje ] w stopniu pierwiastka.');
      name = 'root';
    }
    if (name === 'log' && peek() === '_') { take(); args.push(atom()); }
    if (peek() === '^') { take(); power = unary(); }
    if (power?.t === 'neg' && power.a.t === 'num' && power.a.v === 1 && INVERSE[name]) { name = INVERSE[name]; power = null; }
    if (OPEN.includes(peek())) {
      take(); args.push(sum());
      while (peek() === ',' || peek() === ';') { take(); args.push(sum()); }
      close();
    } else {
      if (!startsAtom(peek()) && peek() !== '-') fail(`Uzupełnij argument: ${name}(x).`);
      // sin 2x → sin(2x). It stops at the next function, so 2 sin x cos x is a product of two.
      let arg = unary();
      while (simple(peek())) arg = { t: '*', a: arg, b: pow() };
      args.push(arg);
    }
    const { min, max, show } = FN[name];
    if (args.length < min || args.length > max) {
      const count = min === max ? `${min}` : `${min}–${max === Infinity ? 'n' : max}`;
      fail(`${show} przyjmuje ${count} ${min === 1 && max === 1 ? 'argument' : 'argumenty'}. Argumenty oddziel średnikiem, np. max(x; 1).`);
    }
    const node: Node = { t: 'call', n: name, args };
    return power ? { t: '^', a: node, b: power, fn: true } : node;
  }

  function atom(): Node {
    const t = take();
    if (t === undefined) return fail('Uzupełnij wyrażenie.');
    if (OPEN.includes(t)) { const e = sum(); close(); return e; }
    if (t === '|') {
      absDepth++;
      const e = sum();
      if (take() !== '|') fail('Brakuje zamykającej kreski |.');
      absDepth--;
      return { t: 'call', n: 'abs', args: [e] };
    }
    if (t === 'x') return { t: 'x' };
    if (isConst(t)) return { t: 'const', n: t };
    if (isParam(t)) return { t: 'param', n: t };
    if (t === 'frac') return { t: '/', a: atom(), b: atom() };
    if (Object.hasOwn(FN, t)) return call(t);
    if (isNumber(t)) return { t: 'num', v: Number(t.replace(',', '.')), s: t };
    return fail(`Nie rozpoznaję „${t}”. Sprawdź zapis funkcji.`);
  }

  function pow(): Node {
    let base = atom();
    while (peek() === '!' || peek() === '°') base = { t: take() as '!' | '°', a: base };
    if (peek() === '^') { take(); return { t: '^', a: base, b: unary() }; }
    return base;
  }

  function unary(): Node {
    if (peek() === '+') { take(); return unary(); }
    if (peek() === '-') { take(); return { t: 'neg', a: unary() }; }
    return pow();
  }

  function product(): Node {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t === '*' || t === '/') { take(); left = { t, a: left, b: unary() }; }
      else if (startsAtom(t)) left = { t: '*', a: left, b: pow() };
      else return left;
    }
  }

  function sum(): Node {
    let left = product();
    for (let t = peek(); t === '+' || t === '-'; t = peek()) { take(); left = { t, a: left, b: product() }; }
    return left;
  }

  const ast = sum();
  if (i < tokens.length) {
    const t = tokens[i];
    fail(CLOSE.includes(t) || t === '|' ? 'Sprawdź nawiasy w wyrażeniu.' : `Nieoczekiwany znak „${t}”.`);
  }
  return ast;
}
