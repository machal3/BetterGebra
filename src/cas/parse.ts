/**
 * Input of the calculator → syntax tree. Hand-written recursive descent; nothing typed is ever executed as code.
 * Accepts the app's conventions (implicit multiplication, sin x, sin²x, |x|, x², π, √) plus lists, matrices,
 * relations and command calls such as solve(x^2 = 2; x). Commas and semicolons both separate arguments;
 * the decimal separator is the dot.
 */
import { fail } from './q';

export type Node =
  | { t: 'num'; v: string }
  | { t: 'id'; n: string }
  | { t: 'op'; o: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'neg'; a: Node }
  | { t: 'post'; o: '!' | '°' | "'"; a: Node }
  | { t: 'call'; n: string; args: Node[] }
  | { t: 'list'; items: Node[]; bracket: '[' | '{' }
  | { t: 'rel'; ops: string[]; parts: Node[] };

/** Canonical function names with their arities. */
export const FUNCTIONS: Record<string, [number, number]> = {
  sin: [1, 1], cos: [1, 1], tan: [1, 1], cot: [1, 1], sec: [1, 1], csc: [1, 1],
  asin: [1, 1], acos: [1, 1], atan: [1, 1], acot: [1, 1], asec: [1, 1], acsc: [1, 1],
  sinh: [1, 1], cosh: [1, 1], tanh: [1, 1], coth: [1, 1], sech: [1, 1], csch: [1, 1],
  asinh: [1, 1], acosh: [1, 1], atanh: [1, 1], acoth: [1, 1],
  sqrt: [1, 1], cbrt: [1, 1], root: [2, 2], exp: [1, 1], ln: [1, 1], log: [1, 2], log2: [1, 1], log10: [1, 1],
  abs: [1, 1], sign: [1, 1], floor: [1, 1], ceil: [1, 1], round: [1, 1], frac: [1, 1],
  gamma: [1, 1], factorial: [1, 1], binomial: [2, 2], zeta: [1, 1], erf: [1, 1], erfc: [1, 1],
  re: [1, 1], im: [1, 1], conj: [1, 1], arg: [1, 1], atan2: [2, 2], max: [1, Infinity], min: [1, Infinity], mod: [2, 2],
};

/** Commands: canonical name → [min args, max args]. Their arguments may be equations, lists, variable names. */
export const COMMANDS: Record<string, [number, number]> = {
  simplify: [1, 1], expand: [1, 1], factor: [1, 2], together: [1, 1], apart: [1, 2], cancel: [1, 1], numer: [1, 1], denom: [1, 1],
  solve: [1, 2], roots: [1, 2], diff: [1, 3], integrate: [1, 4], limit: [1, 4], taylor: [1, 4], sum: [1, 4], product: [1, 4],
  approx: [1, 2], subst: [2, 3], domain: [1, 2], analyze: [1, 2], tangent: [2, 3], extrema: [1, 2],
  isprime: [1, 1], nextprime: [1, 1], prevprime: [1, 1], prime: [1, 1], primepi: [1, 1], factorint: [1, 1],
  gcd: [1, Infinity], lcm: [1, Infinity], divisors: [1, 1], totient: [1, 1], sigma: [1, 2], mobius: [1, 1],
  fibonacci: [1, 1], lucas: [1, 1], catalan: [1, 1], powmod: [3, 3], modinv: [2, 2], crt: [2, 2], base: [2, 3], digits: [1, 2],
  contfrac: [1, 2], rationalize: [1, 2],
  det: [1, 1], inverse: [1, 1], transpose: [1, 1], rank: [1, 1], rref: [1, 1], trace: [1, 1], eigenvalues: [1, 1],
  eigenvectors: [1, 1], charpoly: [1, 2], nullspace: [1, 1], dot: [2, 2], cross: [2, 2], norm: [1, 1], identity: [1, 1],
  adjugate: [1, 1], cofactor: [1, 1], minor: [3, 3], diag: [1, Infinity], dimensions: [1, 1], element: [3, 3],
  submatrix: [5, 5], augment: [2, 2], hadamard: [2, 2], linsolve: [2, 2], isinvertible: [1, 1], issymmetric: [1, 1],
  echelon: [1, 1], rowspace: [1, 1], colspace: [1, 1], lu: [1, 1], qr: [1, 1], cholesky: [1, 1], diagonalize: [1, 1], properties: [1, 1],
  mean: [1, Infinity], median: [1, Infinity], variance: [1, Infinity], stdev: [1, Infinity], sort: [1, Infinity], total: [1, Infinity],
  degree: [1, 2], coeffs: [1, 2], discriminant: [1, 2], quotient: [2, 3], remainder: [2, 3], polygcd: [2, 3], resultant: [3, 3],
  trigexpand: [1, 1], trigreduce: [1, 1], expandlog: [1, 1],
  plot: [1, 8],
};

/** Every alias (Polish with and without diacritics, English, the app's spellings) → canonical name. */
export const ALIAS: Record<string, string> = {
  tg: 'tan', ctg: 'cot', cotg: 'cot', cosec: 'csc', arcsin: 'asin', arccos: 'acos', arctan: 'atan', arctg: 'atan', arccot: 'acot', arcctg: 'acot',
  atantwo: 'atan2', arcsec: 'asec', arccsc: 'acsc', arccosec: 'acsc', arsinh: 'asinh', arcsinh: 'asinh', arcosh: 'acosh', arccosh: 'acosh', artanh: 'atanh', arctanh: 'atanh',
  arcoth: 'acoth', arccoth: 'acoth', artgh: 'atanh', arctgh: 'atanh', arctgh2: 'acoth', tgh: 'tanh', ctgh: 'coth', cth: 'coth',
  sgn: 'sign', lg: 'log10', ld: 'log2', nroot: 'root', entier: 'floor', calosc: 'floor', silnia: 'factorial', fact: 'factorial',
  binom: 'binomial', newton: 'binomial', choose: 'binomial', nck: 'binomial', abs: 'abs', modul: 'abs', sprzezenie: 'conj', conjugate: 'conj',
  uprosc: 'simplify', upraszczaj: 'simplify', simplify: 'simplify', rozwin: 'expand', wymnoz: 'expand', expand: 'expand',
  rozloz: 'factor', faktoryzuj: 'factor', factor: 'factor', factorize: 'factor', czynniki: 'factor',
  wspolnymianownik: 'together', together: 'together', ulamkiproste: 'apart', apart: 'apart', partialfractions: 'apart',
  skroc: 'cancel', cancel: 'cancel', licznik: 'numer', numerator: 'numer', numer: 'numer', mianownik: 'denom', denominator: 'denom', denom: 'denom',
  rozwiaz: 'solve', solve: 'solve', pierwiastki: 'roots', zera: 'roots', roots: 'roots', zeros: 'roots', miejscazerowe: 'roots',
  pochodna: 'diff', rozniczkuj: 'diff', diff: 'diff', derivative: 'diff', derive: 'diff',
  calka: 'integrate', calkuj: 'integrate', integrate: 'integrate', integral: 'integrate', int: 'integrate',
  granica: 'limit', limit: 'limit', lim: 'limit', taylor: 'taylor', szereg: 'taylor', series: 'taylor', maclaurin: 'taylor',
  suma: 'sum', sum: 'sum', iloczyn: 'product', product: 'product', prod: 'product',
  approx: 'approx', numerycznie: 'approx', przyblizenie: 'approx', przybliz: 'approx', numeric: 'approx', nval: 'approx', evalf: 'approx',
  podstaw: 'subst', subst: 'subst', substitute: 'subst', replace: 'subst',
  dziedzina: 'domain', domain: 'domain', zbadaj: 'analyze', badanie: 'analyze', analyze: 'analyze', analiza: 'analyze',
  styczna: 'tangent', tangent: 'tangent', ekstrema: 'extrema', extrema: 'extrema',
  wykres: 'plot', wykresy: 'plot', narysuj: 'plot', rysuj: 'plot', plot: 'plot', graph: 'plot',
  pierwsza: 'isprime', czypierwsza: 'isprime', isprime: 'isprime', primeq: 'isprime', nextprime: 'nextprime', nastepnapierwsza: 'nextprime',
  prevprime: 'prevprime', poprzedniapierwsza: 'prevprime', prime: 'prime', liczbapierwsza: 'prime', primepi: 'primepi',
  factorint: 'factorint',
  nwd: 'gcd', gcd: 'gcd', nww: 'lcm', lcm: 'lcm', dzielniki: 'divisors', divisors: 'divisors', totient: 'totient', eulerphi: 'totient', tocjent: 'totient',
  sigma: 'sigma', divisorsigma: 'sigma', mobius: 'mobius', moebius: 'mobius',   fib: 'fibonacci', fibonacci: 'fibonacci', lucas: 'lucas', catalan: 'catalan',
  powmod: 'powmod', modpow: 'powmod', potegamodulo: 'powmod', modinv: 'modinv', invmod: 'modinv', odwrotnoscmodulo: 'modinv',
  crt: 'crt', chinskie: 'crt', chinese: 'crt', base: 'base', system: 'base', baza: 'base', cyfry: 'digits', digits: 'digits',
  contfrac: 'contfrac', ulamekl: 'contfrac', lancuchowy: 'contfrac', continuedfraction: 'contfrac', wymierna: 'rationalize', rationalize: 'rationalize',
  det: 'det', wyznacznik: 'det', inv: 'inverse', inverse: 'inverse', odwrotna: 'inverse', transpose: 'transpose', transpozycja: 'transpose', transponuj: 'transpose',
  rank: 'rank', rzad: 'rank', rref: 'rref', schodkowa: 'rref', trace: 'trace', slad: 'trace',   eigenvalues: 'eigenvalues', wartosciwlasne: 'eigenvalues', eigenvectors: 'eigenvectors', wektorywlasne: 'eigenvectors',
  charpoly: 'charpoly', wielomiancharakterystyczny: 'charpoly', nullspace: 'nullspace', jadro: 'nullspace', kernel: 'nullspace',
  adjugate: 'adjugate', adj: 'adjugate', dopelnienie: 'adjugate', macierzdopelniona: 'adjugate', cofactor: 'cofactor', kofaktor: 'cofactor', dopelnieniealgebraiczne: 'cofactor',
  minor: 'minor', dimensions: 'dimensions', wymiar: 'dimensions', wymiary: 'dimensions', dim: 'dimensions',
  element: 'element', wpis: 'element', entry: 'element', submatrix: 'submatrix', podmacierz: 'submatrix',
  augment: 'augment', dolacz: 'augment', hstack: 'augment', sklej: 'augment', hadamard: 'hadamard', iloczynelementowy: 'hadamard', elementwise: 'hadamard',
  diag: 'diag', diagonal: 'diag', diagonalna: 'diag', linsolve: 'linsolve', linearsolve: 'linsolve', ukladmacierzowy: 'linsolve',
  isinvertible: 'isinvertible', odwracalna: 'isinvertible', invertible: 'isinvertible', niesobliwa: 'isinvertible',
  issymmetric: 'issymmetric', symetryczna: 'issymmetric', symmetric: 'issymmetric',
  echelon: 'echelon', gauss: 'echelon', rowspace: 'rowspace', przestrzenwierszy: 'rowspace', colspace: 'colspace', przestrzenkolumn: 'colspace',
  lu: 'lu', rozkladlu: 'lu', qr: 'qr', rozkladqr: 'qr', cholesky: 'cholesky', choleski: 'cholesky', rozkladcholeskiego: 'cholesky',
  diagonalize: 'diagonalize', diagonalizuj: 'diagonalize', diagonalizacja: 'diagonalize', properties: 'properties', wlasnosci: 'properties', wlasciwosci: 'properties',
  dot: 'dot', iloczynskalarny: 'dot', cross: 'cross', iloczynwektorowy: 'cross', norm: 'norm', norma: 'norm', dlugosc: 'norm',
  identity: 'identity', jednostkowa: 'identity',   mean: 'mean', srednia: 'mean', average: 'mean', median: 'median', mediana: 'median', variance: 'variance', wariancja: 'variance',
  stdev: 'stdev', std: 'stdev', odchylenie: 'stdev', sort: 'sort', sortuj: 'sort', total: 'total',
  degree: 'degree', stopien: 'degree', coeffs: 'coeffs', wspolczynniki: 'coeffs', discriminant: 'discriminant', wyroznik: 'discriminant', delta: 'discriminant',
  quotient: 'quotient', iloraz: 'quotient', remainder: 'remainder', reszta: 'remainder', polygcd: 'polygcd', resultant: 'resultant', rugownik: 'resultant',
  trigexpand: 'trigexpand', trigreduce: 'trigreduce', expandlog: 'expandlog', rozwinlog: 'expandlog',
};
for (const f of Object.keys(FUNCTIONS)) ALIAS[f] ??= f;
for (const c of Object.keys(COMMANDS)) ALIAS[c] ??= c;

const CONSTANT_WORDS: Record<string, string> = { pi: 'pi', inf: 'inf', infinity: 'inf', oo: 'inf', nieskonczonosc: 'inf', ans: 'ans', phi: 'phi', tau: 'tau' };
/** Words the lexer splits letter runs into, longest first ("sinh" before "sin", "phi" before "pi"). */
const WORDS = [...new Set([...Object.keys(ALIAS), ...Object.keys(CONSTANT_WORDS)])].sort((a, b) => b.length - a.length);

const SUPERSCRIPT: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };
const PL: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

export const MAX_INPUT = 2000;

export function normalize(input: string): string {
  if (input.length > MAX_INPUT) fail(`Wpis jest za długi (ponad ${MAX_INPUT} znaków).`);
  return input
    .replace(/\bN\s*\[/g, 'approx[').replace(/\bN\s*\(/g, 'approx(')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, c => PL[c])
    .replace(/\b(?:atan|arctan|arctg)2(?=\s*\()/g, 'atantwo') // a digit would split the word: atan 2·(…)
    .replace(/\\(?:cdot|times)/g, '*').replace(/\\div/g, '/').replace(/\\(?:left|right)|\\[,;:! ]/g, '').replace(/\\(?=[a-z])/g, '')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, s => `^(${[...s].map(c => SUPERSCRIPT[c]).join('')})`)
    .replace(/π/g, ' pi ').replace(/τ/g, ' tau ').replace(/[φϕ]/g, ' phi ').replace(/∞/g, ' inf ')
    .replace(/√/g, ' sqrt ').replace(/∛/g, ' cbrt ').replace(/∑/g, ' sum ').replace(/∏/g, ' product ').replace(/∫/g, ' integrate ')
    .replace(/[·⋅∙×]/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-').replace(/\*\*/g, '^')
    .replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=').replace(/→|⟶/g, '->').replace(/==/g, '=').replace(/[′’]/g, "'")
    .replace(/[⟨〈]/g, '[').replace(/[⟩〉]/g, ']')
    .trim();
}

const TOKEN = /\d*\.\d+(?:e[+-]?\d+)?|\d+(?:\.(?!\.)\d*)?(?:e[+-]?\d+(?![a-z]))?|[a-z]+|[α-ωΑ-Ω]|<=|>=|!=|->|[+\-*/^()[\]{}|,;!°_=<>']/g;

export function tokenize(source: string): string[] {
  if (!source) fail('Wpisz wyrażenie, równanie albo polecenie.');
  if (/\d\.\d*\./.test(source)) fail('Liczba ma za dużo kropek.');
  const raw = source.match(TOKEN) ?? [];
  const stripped = source.replace(/\s/g, '');
  if (raw.join('') !== stripped) {
    // find the first character no token covers
    let at = 0;
    for (const t of raw) { const k = stripped.indexOf(t, at); if (k !== at) break; at += t.length; }
    fail(`Nieznany znak „${stripped[at] ?? '?'}”.`);
  }
  return raw.flatMap(token => {
    if (!/^[a-z]+$/.test(token)) return [token];
    const out: string[] = [];
    // Three or more letters with no known word in them (foo, quux) are a typo, not a product of variables.
    if (token.length >= 3 && !WORDS.some(w => w.length > 1 && w !== 'oo' && token.includes(w))) {
      fail(`Nie rozpoznaję „${token}”. Iloczyn zmiennych zapisz ze znakiem mnożenia, np. ${[...token].join('*')}.`);
    }
    for (let i = 0; i < token.length;) {
      // oo is ∞ only on its own: foo is f·o·o, not f·∞
      const word = WORDS.find(w => token.startsWith(w, i) && (w !== 'oo' || token === 'oo')) ?? token[i];
      out.push(word);
      i += word.length;
    }
    return out;
  });
}

const OPEN = ['(', '[', '{'], CLOSE = [')', ']', '}'];
const RELATIONS = ['=', '<', '>', '<=', '>=', '!=', '->'];
const isNumber = (t: string | undefined) => t !== undefined && /^\.?\d/.test(t);
const isWord = (t: string | undefined) => t !== undefined && /^[a-zα-ω]/i.test(t);
const known = (t: string) => Object.hasOwn(ALIAS, t);

export function parse(input: string): Node {
  const tokens = tokenize(normalize(input));
  let i = 0, absDepth = 0;
  const peek = (k = 0) => tokens[i + k];
  const take = () => tokens[i++];
  const expect = (t: string, message: string) => { if (take() !== t) fail(message); };
  const startsAtom = (t: string | undefined) => t !== undefined && (isNumber(t) || isWord(t) || OPEN.includes(t) || (t === '|' && !absDepth));
  const simple = (t: string | undefined) => t !== undefined && (isNumber(t) || (isWord(t) && !known(t)) || t === 'pi');

  function args(): Node[] {
    const out: Node[] = [];
    const open = take(), close = CLOSE[OPEN.indexOf(open)];
    if (peek() === close) { take(); return out; }
    out.push(relation());
    while (peek() === ',' || peek() === ';') { take(); out.push(relation()); }
    expect(close, 'Brakuje nawiasu zamykającego.');
    return out;
  }

  function call(word: string): Node {
    const name = ALIAS[word];
    const isCommand = Object.hasOwn(COMMANDS, name) && !Object.hasOwn(FUNCTIONS, name);
    let power: Node | null = null;
    let list: Node[] = [];
    if (name === 'log' && peek() === '_') {
      take();
      const base = OPEN.includes(peek()) ? (() => { take(); const b = sum(); if (!CLOSE.includes(take())) fail('Brakuje nawiasu zamykającego.'); return b; })() : atom();
      list.push(base);
    }
    if (name === 'sqrt' && peek() === '[') { // \sqrt[3]{x}
      take(); const n = sum(); expect(']', 'Brakuje ] w stopniu pierwiastka.');
      list.push(n);
      const inner = atomOrArgs();
      return { t: 'call', n: 'root', args: [n, inner] };
    }
    if (peek() === '^' && !isCommand) { take(); power = unary(); }
    let fname = name;
    if (power?.t === 'neg' && power.a.t === 'num' && power.a.v === '1' && INVERSE[name]) { fname = INVERSE[name]; power = null; }
    if (OPEN.includes(peek())) {
      list = list.concat(args());
    } else if (isCommand) {
      // A command word without parentheses takes the rest of the input as its single argument: "rozłóż 360".
      if (i >= tokens.length) fail(`Po poleceniu „${word}” wpisz, co obliczyć.`);
      list.push(relation());
      while (peek() === ',' || peek() === ';') { take(); list.push(relation()); }
    } else {
      if (!startsAtom(peek()) && peek() !== '-') fail(`Uzupełnij argument: ${word}(x).`);
      // sin 2x → sin(2x); it stops at the next function, so 2 sin x cos x is a product.
      let a = unary();
      while (simple(peek())) a = { t: 'op', o: '*', a, b: power0() };
      list.push(a);
    }
    const [min, max] = FUNCTIONS[fname] ?? COMMANDS[fname];
    if (list.length < min || list.length > max) {
      const count = min === max ? `${min}` : max === Infinity ? `co najmniej ${min}` : `od ${min} do ${max}`;
      fail(`${word} przyjmuje ${count} ${min === 1 && max === 1 ? 'argument' : 'argumenty'}.`);
    }
    // atan2(y, x) is the argument of x + yi (variables are real)
    if (fname === 'atan2') return { t: 'call', n: 'arg', args: [{ t: 'op', o: '+', a: list[1], b: { t: 'op', o: '*', a: list[0], b: { t: 'id', n: 'i' } } }] };
    const node: Node = { t: 'call', n: fname, args: list };
    return power ? { t: 'op', o: '^', a: node, b: power } : node;
  }
  function atomOrArgs(): Node {
    if (OPEN.includes(peek())) { take(); const e = sum(); if (!CLOSE.includes(take())) fail('Brakuje nawiasu zamykającego.'); return e; }
    return atom();
  }

  function bracket(open: string): Node {
    const close = CLOSE[OPEN.indexOf(open)];
    if (peek() === close) { take(); return { t: 'list', items: [], bracket: open === '{' ? '{' : '[' }; }
    const first = relation();
    if (open === '(' || (peek() !== ',' && peek() !== ';')) {
      expect(close, 'Brakuje nawiasu zamykającego.');
      // (a, b) is a pair only with a comma; [a] and {a} really are a one-element list and set.
      if (open === '(') return first;
      return { t: 'list', items: [first], bracket: open === '{' ? '{' : '[' };
    }
    // [1, 2; 3, 4] — rows split by semicolons
    const rows: Node[][] = [[first]];
    while (peek() === ',' || peek() === ';') {
      const sep = take();
      if (sep === ';' && open === '[') rows.push([]);
      rows[rows.length - 1].push(relation());
    }
    expect(close, 'Brakuje nawiasu zamykającego.');
    const b = open === '{' ? '{' : '[';
    if (rows.length === 1) return { t: 'list', items: rows[0], bracket: b };
    return { t: 'list', items: rows.map(r => ({ t: 'list', items: r, bracket: '[' } as Node)), bracket: '[' };
  }

  function atom(): Node {
    const t = take();
    if (t === undefined) return fail('Wyrażenie urywa się. Uzupełnij je.');
    if (OPEN.includes(t)) return bracket(t);
    if (t === '|') {
      absDepth++;
      const e = sum();
      expect('|', 'Brakuje zamykającej kreski |.');
      absDepth--;
      return { t: 'call', n: 'abs', args: [e] };
    }
    if (isNumber(t)) return { t: 'num', v: t };
    if (t === 'frac' && peek() === '{') { const a = atomOrArgs(), b = atomOrArgs(); return { t: 'op', o: '/', a, b }; }
    if (Object.hasOwn(CONSTANT_WORDS, t)) return { t: 'id', n: CONSTANT_WORDS[t] };
    if (known(t)) return call(t);
    if (isWord(t) && t.length === 1) return { t: 'id', n: t };
    return fail(`Nie rozpoznaję „${t}”.`);
  }

  function post(): Node {
    let base = atom();
    while (peek() === '!' || peek() === '°' || peek() === "'") base = { t: 'post', o: take() as '!' | '°' | "'", a: base };
    return base;
  }
  function power0(): Node {
    const base = post();
    if (peek() === '^') { take(); return { t: 'op', o: '^', a: base, b: unary() }; }
    return base;
  }
  function unary(): Node {
    if (peek() === '+') { take(); return unary(); }
    if (peek() === '-') { take(); return { t: 'neg', a: unary() }; }
    return power0();
  }
  function product(): Node {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t === '*' || t === '/') { take(); left = { t: 'op', o: t, a: left, b: unary() }; }
      else if (startsAtom(t)) left = { t: 'op', o: '*', a: left, b: power0() };
      else return left;
    }
  }
  function sum(): Node {
    let left = product();
    for (let t = peek(); t === '+' || t === '-'; t = peek()) { take(); left = { t: 'op', o: t, a: left, b: product() }; }
    return left;
  }
  function relation(): Node {
    const parts = [sum()], ops: string[] = [];
    while (RELATIONS.includes(peek())) { ops.push(take()); parts.push(sum()); }
    return ops.length ? { t: 'rel', ops, parts } : parts[0];
  }

  const tree = relation();
  const top: Node[] = [tree];
  // A list at the top level without brackets: "x + y = 3, x − y = 1".
  while (peek() === ',' || peek() === ';') { take(); top.push(relation()); }
  if (i < tokens.length) {
    const t = tokens[i];
    fail(CLOSE.includes(t) || t === '|' ? 'Sprawdź nawiasy.' : `Nieoczekiwany znak „${t}”.`);
  }
  return top.length === 1 ? tree : { t: 'list', items: top, bracket: '{' };
}

const INVERSE: Record<string, string> = { sin: 'asin', cos: 'acos', tan: 'atan', cot: 'acot', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' };
