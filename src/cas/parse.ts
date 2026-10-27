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
  | { t: 'op'; o: '+' | '-' | '*' | '/' | '^' | '.*' | './' | '.^' | '\\'; a: Node; b: Node }
  | { t: 'neg'; a: Node }
  /** tr: written after a matrix or a list, so ' is the transpose and not the derivative */
  | { t: 'post'; o: '!' | '°' | "'" | ".'"; a: Node; tr?: boolean }
  | { t: 'call'; n: string; args: Node[] }
  | { t: 'list'; items: Node[]; bracket: '[' | '{' }
  | { t: 'rel'; ops: string[]; parts: Node[] }
  /** a:b and a:h:b */
  | { t: 'range'; a: Node; step: Node | null; b: Node }
  /** A(i, j) of a variable: an element, a row, a value of a function */
  | { t: 'index'; n: string; args: Node[] }
  /** the whole dimension (:) and its last place (end), inside an index */
  | { t: 'colon' } | { t: 'end' }
  | { t: 'lambda'; params: string[]; body: Node }
  /** name = value, f(x, y) = body; = is an assignment only when the engine finds the right side defined */
  | { t: 'assign'; name: string; params: string[] | null; op: '=' | ':='; value: Node }
  /** [L, U, P] = lu(A): the outputs of a command, one name each */
  | { t: 'massign'; names: string[]; value: Node }
  | { t: 'str'; v: string };

/** What a name of the workspace holds, as far as reading the input needs to know. */
export type VarKind = 'scalar' | 'list' | 'matrix' | 'fn';
export interface ParseOptions {
  /** The workspace: its names are read as words, A(…) of a matrix, list or function is an index. */
  names?: Readonly<Record<string, VarKind>>;
  /** false: name = … is an equation, as before there were variables. */
  assign?: boolean;
  /** Longest input accepted (stored values are longer than what is typed). */
  limit?: number;
}

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
  eigenvectors: [1, 1], charpoly: [1, 2], nullspace: [1, 1], dot: [2, 2], cross: [2, 2], norm: [1, 2], identity: [1, 1],
  mean: [1, Infinity], median: [1, Infinity], variance: [1, Infinity], stdev: [1, Infinity], sort: [1, Infinity], total: [1, Infinity],
  degree: [1, 2], coeffs: [1, 2], discriminant: [1, 2], quotient: [2, 3], remainder: [2, 3], polygcd: [2, 3], resultant: [3, 3],
  trigexpand: [1, 1], trigreduce: [1, 1], expandlog: [1, 1],
  plot: [1, 8],
  clear: [0, Infinity], who: [0, 0],
  zeros: [1, 2], ones: [1, 2], eye: [1, 2], diag: [1, 2], linspace: [2, 3], logspace: [2, 3], magic: [1, 1], hilb: [1, 1],
  vander: [1, 1], toeplitz: [1, 2], repmat: [2, 3], reshape: [2, 3], kron: [2, 2], triu: [1, 2], tril: [1, 2], fliplr: [1, 1],
  flipud: [1, 1], circshift: [2, 3], size: [1, 2], numel: [1, 1], length: [1, 1], isempty: [1, 1], find: [1, 2], any: [1, 2],
  all: [1, 2], cumsum: [1, 2], cumprod: [1, 2],
  lu: [1, 1], qr: [1, 1], chol: [1, 1], svd: [1, 1], eig: [1, 1], cond: [1, 2], pinv: [1, 1], expm: [1, 1], null: [1, 1], orth: [1, 1],
  double: [1, 1],
  poly: [1, 1], polyval: [2, 2], polyder: [1, 2], polyint: [1, 2], conv: [2, 2], deconv: [2, 2], residue: [2, 2], polyfit: [3, 3],
  fit: [3, 3], interp1: [3, 5], spline: [2, 3], pchip: [2, 3], trapz: [1, 2], cumtrapz: [1, 2], scatter: [2, 2], stem: [1, 2],
  bar: [1, 2], histogram: [1, 2], errorbar: [3, 3], polarplot: [1, 2],
  fzero: [2, 2], fminbnd: [3, 3], fminsearch: [2, 2], fsolve: [2, 2], integral2: [5, 5], ode45: [3, 3], ode23: [3, 3], ode15s: [3, 3],
  dsolve: [1, 7],
  mode: [1, 1], range: [1, 1], prctile: [2, 2], quantile: [2, 2], iqr: [1, 1], skewness: [1, 1], kurtosis: [1, 1], zscore: [1, 1],
  cov: [1, 2], corrcoef: [1, 2], histcounts: [1, 2], fitlm: [2, 2], rand: [0, 2], randn: [0, 2], randi: [1, 3], rng: [1, 1],
  normpdf: [1, 3], normcdf: [1, 3], norminv: [1, 3], tpdf: [2, 2], tcdf: [2, 2], tinv: [2, 2], chi2pdf: [2, 2], chi2cdf: [2, 2], chi2inv: [2, 2],
  fpdf: [3, 3], fcdf: [3, 3], finv: [3, 3], binopdf: [3, 3], binocdf: [3, 3], poisspdf: [2, 2], poisscdf: [2, 2], exppdf: [1, 2], expcdf: [1, 2],
  expinv: [1, 2], unifpdf: [1, 3], unifcdf: [1, 3], unifinv: [1, 3], gampdf: [2, 3], gamcdf: [2, 3], gaminv: [2, 3], betapdf: [3, 3],
  betacdf: [3, 3], betainv: [3, 3],
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
  rozwiaz: 'solve', solve: 'solve', pierwiastki: 'roots', zera: 'roots', roots: 'roots', miejscazerowe: 'roots',
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
  dot: 'dot', iloczynskalarny: 'dot', cross: 'cross', iloczynwektorowy: 'cross', norm: 'norm', norma: 'norm', dlugosc: 'norm',
  identity: 'identity', jednostkowa: 'identity',   mean: 'mean', srednia: 'mean', average: 'mean', median: 'median', mediana: 'median', variance: 'variance', wariancja: 'variance',
  stdev: 'stdev', std: 'stdev', odchylenie: 'stdev', sort: 'sort', sortuj: 'sort', total: 'total',
  degree: 'degree', stopien: 'degree', coeffs: 'coeffs', wspolczynniki: 'coeffs', discriminant: 'discriminant', wyroznik: 'discriminant', delta: 'discriminant',
  quotient: 'quotient', iloraz: 'quotient', remainder: 'remainder', reszta: 'remainder', polygcd: 'polygcd', resultant: 'resultant', rugownik: 'resultant',
  trigexpand: 'trigexpand', trigreduce: 'trigreduce', expandlog: 'expandlog', rozwinlog: 'expandlog',
  clear: 'clear', usun: 'clear', who: 'who', whos: 'who', zmienne: 'who',
  zerowa: 'zeros', jedynki: 'ones', diagonalna: 'diag', przekatna: 'diag', magiczny: 'magic', hilbert: 'hilb', vandermonde: 'vander',
  kronecker: 'kron', powiel: 'repmat', przeksztalc: 'reshape', rozmiar: 'size', wymiar: 'size', znajdz: 'find', pusta: 'isempty',
  sumyczesciowe: 'cumsum', przesun: 'circshift',
  rozkladlu: 'lu', rozkladqr: 'qr', cholesky: 'chol', rozkladsvd: 'svd', wartosciszczegolne: 'svd', uwarunkowanie: 'cond',
  pseudoodwrotna: 'pinv', przyblizona: 'double',
  hist: 'histogram', dopasuj: 'fit', interpoluj: 'interp1', splot: 'conv', trapezy: 'trapz', sklejana: 'spline', punktowy: 'scatter',
  slupkowy: 'bar', biegunowy: 'polarplot', quadgk: 'integrate',
  dominanta: 'mode', rozstep: 'range', percentyl: 'prctile', kwantyl: 'quantile', skosnosc: 'skewness', kurtoza: 'kurtosis',
  kowariancja: 'cov', korelacja: 'corrcoef', regresja: 'fitlm', var: 'variance',
};
for (const f of Object.keys(FUNCTIONS)) ALIAS[f] ??= f;
for (const c of Object.keys(COMMANDS)) ALIAS[c] ??= c;

const CONSTANT_WORDS: Record<string, string> = { pi: 'pi', inf: 'inf', infinity: 'inf', oo: 'inf', nieskonczonosc: 'inf', ans: 'ans', phi: 'phi', tau: 'tau' };
/** Words the lexer splits letter runs into, longest first ("sinh" before "sin", "phi" before "pi"). */
const WORDS = [...new Set([...Object.keys(ALIAS), ...Object.keys(CONSTANT_WORDS), 'end'])].sort((a, b) => b.length - a.length);
/** Words a variable can't be called: functions, commands, constants. */
export const reserved = (name: string) => Object.hasOwn(ALIAS, name) || Object.hasOwn(CONSTANT_WORDS, name) || ['e', 'i', 'end'].includes(name);

const SUPERSCRIPT: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };
const PL: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

export const MAX_INPUT = 2000;
const NAME = /^[a-z][a-z0-9_]*$/;

export function normalize(input: string, limit = MAX_INPUT, names: ReadonlySet<string> = new Set()): string {
  if (input.length > limit) fail(`Wpis jest za długi (ponad ${limit} znaków).`);
  return input
    .replace(/\bN\s*\[/g, 'approx[').replace(/\bN\s*\(/g, 'approx(')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, c => PL[c])
    .replace(/\b(?:atan|arctan|arctg)2(?=\s*\()/g, 'atantwo') // a digit would split the word: atan 2·(…)
    .replace(/\blog(2|10)(?![\d.])/g, (_, b: string) => (b === '2' ? 'ld' : 'lg')) // likewise log2 x is log₂ x, not log(2)·x
    .replace(/\\(?:cdot|times)/g, '*').replace(/\\div/g, '/').replace(/\\(?:left|right)|\\[,;:!]/g, '')
    // a leftover LaTeX command loses its backslash; A\b (one letter, or a variable's name) is a left division
    .replace(/\\(?=([a-z]{2,}))/g, (m, w: string) => (names.has(w) ? m : ''))
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, s => `^(${[...s].map(c => SUPERSCRIPT[c]).join('')})`)
    .replace(/π/g, ' pi ').replace(/τ/g, ' tau ').replace(/[φϕ]/g, ' phi ').replace(/∞/g, ' inf ')
    .replace(/√/g, ' sqrt ').replace(/∛/g, ' cbrt ').replace(/∑/g, ' sum ').replace(/∏/g, ' product ').replace(/∫/g, ' integrate ')
    .replace(/[·⋅∙×]/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-').replace(/\*\*/g, '^')
    .replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=').replace(/→|⟶/g, '->').replace(/==/g, '=').replace(/[′’]/g, "'")
    .replace(/[⟨〈]/g, '[').replace(/[⟩〉]/g, ']')
    .trim();
}

const TOKEN = /\.[*/^']|\d*\.\d+(?:e[+-]?\d+)?|\d+(?:\.(?![.*/^'])\d*)?(?:e[+-]?\d+(?![a-z]))?|[a-z]+|[α-ωΑ-Ω]|<=|>=|!=|->|:=|[+\-*/^()[\]{}|,;:!°_=<>'\\@]/y;
/** A string token: '"' and its text ('spline', "fro"). */
export const isStr = (t: string | undefined) => t !== undefined && t[0] === '"';
/** Tokens after which ' is a prime or a transpose; elsewhere it opens a string, as in MATLAB. */
const endsOperand = (t: string | undefined) => t !== undefined && !isStr(t) && (/^\.?\d|^[a-zα-ω]/i.test(t) || [')', ']', '}', "'", ".'", '!', '°'].includes(t));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** MATLAB's names with a digit in them, read whole (interp1 is not interp·1). */
const DIGIT_WORDS = /(?:interp1|integral2|integral3|ode45|ode23|ode15s|chi2pdf|chi2cdf|chi2inv)(?![a-z0-9_])/y;

/** Tokens, each with whether a space came before it (inside [ ] a space can separate elements). */
function lex(source: string, names: readonly string[]): { toks: string[]; space: boolean[] } {
  if (!source) fail('Wpisz wyrażenie, równanie albo polecenie.');
  if (/\d\.\d*\.(?![*/^'])/.test(source)) fail('Liczba ma za dużo kropek.');
  const raw: string[] = [], before: boolean[] = [];
  const named = names.filter(n => n.length > 1);
  const nameRe = named.length ? new RegExp(`(?:${[...named].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![a-z0-9_])`, 'y') : null;
  let pos = 0, sp = false;
  while (pos < source.length) {
    const c = source[pos];
    if (/\s/.test(c)) { sp = true; pos++; continue; }
    if (c === '"' || (c === "'" && (sp || !endsOperand(raw[raw.length - 1])))) {
      const close = source.indexOf(c, pos + 1);
      if (close < 0) fail('Brakuje apostrofu zamykającego napis.');
      raw.push(`"${source.slice(pos + 1, close)}`);
      before.push(sp); sp = false; pos = close + 1;
      continue;
    }
    let m: RegExpExecArray | null = null;
    if (nameRe && !/[a-z0-9_]/.test(source[pos - 1] ?? '')) { nameRe.lastIndex = pos; m = nameRe.exec(source); }
    if (!m && !/[a-z0-9_]/.test(source[pos - 1] ?? '')) { DIGIT_WORDS.lastIndex = pos; m = DIGIT_WORDS.exec(source); }
    if (!m) { TOKEN.lastIndex = pos; m = TOKEN.exec(source); }
    if (!m) return fail(`Nieznany znak „${c}”.`);
    raw.push(m[0]); before.push(sp); sp = false; pos += m[0].length;
  }
  const words = named.length ? [...new Set([...named, ...WORDS])].sort((a, b) => b.length - a.length) : WORDS;
  const toks: string[] = [], space: boolean[] = [];
  raw.forEach((token, k) => {
    if (!/^[a-z]+$/.test(token) || named.includes(token)) { toks.push(token); space.push(before[k]); return; }
    // Three or more letters with no known word in them (foo, quux) are a typo, not a product of variables.
    if (token.length >= 3 && !words.some(w => w.length > 1 && w !== 'oo' && token.includes(w))) {
      fail(`Nie rozpoznaję „${token}”. Iloczyn zmiennych zapisz ze znakiem mnożenia, np. ${[...token].join('*')}.`);
    }
    for (let i = 0; i < token.length;) {
      // oo is ∞ only on its own: foo is f·o·o, not f·∞
      const word = words.find(w => token.startsWith(w, i) && (w !== 'oo' || token === 'oo')) ?? token[i];
      toks.push(word); space.push(i === 0 && before[k]);
      i += word.length;
    }
  });
  return { toks, space };
}

export function tokenize(source: string): string[] { return lex(source, []).toks; }

/** The input split at the commas and semicolons outside brackets. */
function statements(src: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if ((c === ',' || c === ';') && !depth) { out.push(src.slice(from, k)); from = k + 1; }
  }
  out.push(src.slice(from));
  return out;
}
const HEAD = /^\s*([a-z][a-z0-9_]*)\s*(?:\(([^()]*)\))?\s*:?=(?![=>])/;
/** [L, U, P] = … at the start of a statement. */
const MULTI = /^\s*\[([a-z0-9_,\s]*)\]\s*:?=(?![=>])/;
const nameList = (s: string) => s.split(',').map(p => p.trim()).filter(p => NAME.test(p));
/** Names the input itself defines: a = 1; b = a + 1, f(x) = …, @(t, y) …; their words must be read whole. */
function definedNames(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/@\s*\(([^()]*)\)/g)) out.push(...nameList(m[1]));
  const first = src.match(HEAD);
  if ((first && !reserved(first[1])) || MULTI.test(src)) {
    for (const piece of statements(src)) {
      const m = piece.match(HEAD), many = piece.match(MULTI);
      if (m) out.push(m[1], ...(m[2] ? nameList(m[2]) : []));
      if (many) out.push(...many[1].split(/[\s,]+/).filter(p => NAME.test(p)));
    }
  }
  return out.filter(n => !reserved(n));
}

const OPEN = ['(', '[', '{'], CLOSE = [')', ']', '}'];
const RELATIONS = ['=', '<', '>', '<=', '>=', '!=', '->'];
const isNumber = (t: string | undefined) => t !== undefined && /^\.?\d/.test(t);
const isWord = (t: string | undefined) => t !== undefined && /^[a-zα-ω]/i.test(t);
const isAlias = (t: string) => Object.hasOwn(ALIAS, t);

export function parse(input: string, opts: ParseOptions = {}): Node {
  const kinds = opts.names ?? {};
  const src = normalize(input, opts.limit, new Set(Object.keys(kinds)));
  const known = new Set([...Object.keys(kinds), ...(opts.assign === false ? [] : definedNames(src))]);
  const { toks: tokens, space } = lex(src, [...known]);
  let i = 0, absDepth = 0, indexDepth = 0;
  // the brackets open around the current token; '[ ' is a matrix written MATLAB's way, with spaces between elements
  const ctx: string[] = [];
  const peek = (k = 0) => tokens[i + k];
  const take = () => tokens[i++];
  const expect = (t: string, message: string) => { if (take() !== t) fail(message); };
  const startsAtom = (t: string | undefined) => t !== undefined && (isNumber(t) || isWord(t) || OPEN.includes(t) || (t === '|' && !absDepth));
  const simple = (t: string | undefined) => t !== undefined && (isNumber(t) || (isWord(t) && !isAlias(t)) || t === 'pi');
  /** The current token, after a space in [1 2 3], begins the next element. */
  const spaced = () => ctx[ctx.length - 1] === '[ ' && space[i];
  const nested = <T>(open: string, f: () => T): T => { ctx.push(open); try { return f(); } finally { ctx.pop(); } };

  function args(): Node[] {
    const out: Node[] = [];
    const open = take(), close = CLOSE[OPEN.indexOf(open)];
    if (peek() === close) { take(); return out; }
    return nested('(', () => {
      out.push(relation());
      while (peek() === ',' || peek() === ';') { take(); out.push(relation()); }
      expect(close, 'Brakuje nawiasu zamykającego.');
      return out;
    });
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
      if (i >= tokens.length) { if (COMMANDS[fname][0] > 0) fail(`Po poleceniu „${word}” wpisz, co obliczyć.`); }
      else {
        list.push(relation());
        while (peek() === ',' || peek() === ';') { take(); list.push(relation()); }
      }
    } else {
      if (!startsAtom(peek()) && peek() !== '-') fail(`Uzupełnij argument: ${word}(x).`);
      // sin 2x → sin(2x); it stops at the next function, so 2 sin x cos x is a product.
      let a = unary();
      while (simple(peek()) && !spaced()) a = { t: 'op', o: '*', a, b: power0() };
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

  /** [ 1 2; 3 4 ] has no comma outside inner brackets: its spaces separate elements, as in MATLAB. */
  function spacedMatrix(): boolean {
    let depth = 0;
    for (let k = i; k < tokens.length; k++) {
      const t = tokens[k];
      if (OPEN.includes(t)) depth++;
      else if (CLOSE.includes(t)) { if (!depth) return true; depth--; }
      else if (t === ',' && !depth) return false;
    }
    return true;
  }
  function bracket(open: string): Node {
    const close = CLOSE[OPEN.indexOf(open)];
    if (peek() === close) { take(); return { t: 'list', items: [], bracket: open === '{' ? '{' : '[' }; }
    return nested(open === '[' && spacedMatrix() ? '[ ' : open, () => {
      const next = () => peek() !== undefined && peek() !== close && peek() !== ',' && peek() !== ';' && spaced();
      const first = relation();
      if (open === '(' || (peek() !== ',' && peek() !== ';' && !next())) {
        expect(close, 'Brakuje nawiasu zamykającego.');
        // (a, b) is a pair only with a comma; otherwise grouping.
        return first;
      }
      // [1, 2; 3, 4] and [1 2; 3 4] — rows split by semicolons
      const rows: Node[][] = [[first]];
      for (;;) {
        if (next()) { rows[rows.length - 1].push(relation()); continue; }
        if (peek() !== ',' && peek() !== ';') break;
        const sep = take();
        if (peek() === close) break; // [1 2;] as MATLAB allows
        if (sep === ';' && open === '[') rows.push([]);
        rows[rows.length - 1].push(relation());
      }
      expect(close, 'Brakuje nawiasu zamykającego.');
      const b = open === '{' ? '{' : '[';
      if (rows.length === 1) return { t: 'list', items: rows[0], bracket: b };
      return { t: 'list', items: rows.map(r => ({ t: 'list', items: r, bracket: '[' } as Node)), bracket: '[' };
    });
  }

  /** (i, j) after a variable: indices, : for a whole dimension, end for the last place. */
  function indexArgs(): Node[] {
    take();
    if (peek() === ')') { take(); return []; }
    indexDepth++;
    try {
      return nested('(', () => {
        const out: Node[] = [];
        for (;;) {
          if (peek() === ':' && (peek(1) === ',' || peek(1) === ')')) { take(); out.push({ t: 'colon' }); }
          else out.push(relation());
          if (peek() !== ',' && peek() !== ';') break;
          take();
        }
        expect(')', 'Brakuje nawiasu zamykającego.');
        return out;
      });
    } finally { indexDepth--; }
  }

  function lambda(): Node {
    expect('(', 'Po @ wpisz parametry w nawiasie, np. @(x) x^2.');
    const params: string[] = [];
    while (peek() !== ')') {
      const p = take();
      if (!p || !NAME.test(p) || reserved(p)) fail('Parametry funkcji to nazwy, np. @(x, y) x*y.');
      params.push(p);
      if (peek() === ',') take(); else break;
    }
    expect(')', 'Brakuje nawiasu zamykającego parametry funkcji.');
    if (new Set(params).size !== params.length) fail('Parametry funkcji muszą mieć różne nazwy.');
    return { t: 'lambda', params, body: nested('(', range) };
  }

  function atom(): Node {
    const t = take();
    if (t === undefined) return fail('Wyrażenie urywa się. Uzupełnij je.');
    if (isStr(t)) return { t: 'str', v: t.slice(1) };
    if (OPEN.includes(t)) return bracket(t);
    if (t === '|') {
      absDepth++;
      const e = nested('|', sum);
      expect('|', 'Brakuje zamykającej kreski |.');
      absDepth--;
      return { t: 'call', n: 'abs', args: [e] };
    }
    if (t === '@') return lambda();
    if (isNumber(t)) return { t: 'num', v: t };
    if (t === 'frac' && peek() === '{') { const a = atomOrArgs(), b = atomOrArgs(); return { t: 'op', o: '/', a, b }; }
    if (t === 'end') {
      if (!indexDepth) fail('end oznacza ostatnie miejsce i działa tylko w nawiasie zmiennej, np. v(end).');
      return { t: 'end' };
    }
    if (known.has(t)) {
      // a variable: A(2, 3) of a matrix, list or function is an index; a number's n(2) stays n·2
      if (peek() === '(' && kinds[t] !== 'scalar') return { t: 'index', n: t, args: indexArgs() };
      return { t: 'id', n: t };
    }
    if (Object.hasOwn(CONSTANT_WORDS, t)) return { t: 'id', n: CONSTANT_WORDS[t] };
    // lu and qr are decompositions only when called: elsewhere l·u, q·r as before
    if ((t === 'lu' || t === 'qr') && peek() !== '(') return { t: 'op', o: '*', a: { t: 'id', n: t[0] }, b: { t: 'id', n: t[1] } };
    if (isAlias(t)) return call(t);
    if (isWord(t) && t.length === 1) return { t: 'id', n: t };
    return fail(`Nie rozpoznaję „${t}”.`);
  }

  const transposable = (n: Node): boolean => n.t === 'list' || n.t === 'range' || (n.t === 'post' && !!n.tr) || ((n.t === 'id' || n.t === 'index') && (kinds[n.n] === 'matrix' || kinds[n.n] === 'list'));
  function post(): Node {
    let base = atom();
    for (let t = peek(); t === '!' || t === '°' || t === "'" || t === ".'"; t = peek()) {
      const o = take() as '!' | '°' | "'" | ".'";
      base = { t: 'post', o, a: base, ...(o === ".'" || (o === "'" && transposable(base)) ? { tr: true } : {}) };
    }
    return base;
  }
  function power0(): Node {
    const base = post();
    if (peek() === '^' || peek() === '.^') { const o = take() as '^' | '.^'; return { t: 'op', o, a: base, b: unary() }; }
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
      if (t === '*' || t === '/' || t === '.*' || t === './' || t === '\\') { take(); left = { t: 'op', o: t, a: left, b: unary() }; }
      else if (startsAtom(t) && !spaced()) left = { t: 'op', o: '*', a: left, b: power0() };
      else return left;
    }
  }
  function sum(): Node {
    let left = product();
    for (let t = peek(); t === '+' || t === '-'; t = peek()) {
      // [1 -2] is two elements, [1 - 2] one
      if (spaced() && !space[i + 1]) break;
      take(); left = { t: 'op', o: t, a: left, b: product() };
    }
    return left;
  }
  function range(): Node {
    const a = sum();
    if (peek() !== ':') return a;
    take();
    const b = sum();
    if (peek() !== ':') return { t: 'range', a, step: null, b };
    take();
    return { t: 'range', a, step: b, b: sum() };
  }
  function relation(): Node {
    const parts = [range()], ops: string[] = [];
    while (RELATIONS.includes(peek())) { ops.push(take()); parts.push(range()); }
    return ops.length ? { t: 'rel', ops, parts } : parts[0];
  }
  /** [a, b, c] = f(…), or null (the input read from where it was). */
  function multiAssign(): Node | null {
    const save = i, names: string[] = [];
    take();
    while (peek() !== undefined && NAME.test(peek()!) && !reserved(peek()!)) { names.push(take()); if (peek() === ',') take(); }
    if (names.length && peek() === ']') {
      take();
      if ((peek() === '=' || peek() === ':=') && i + 1 < tokens.length) {
        take();
        const value = range();
        if (i >= tokens.length || peek() === ',' || peek() === ';') {
          if (new Set(names).size !== names.length) fail('Nazwy po lewej stronie muszą być różne.');
          return { t: 'massign', names, value };
        }
      }
    }
    i = save;
    return null;
  }
  /** name = value, f(x, y) = body, name := value; anything else is a relation. */
  function statement(): Node {
    if (opts.assign !== false && peek() === '[') { const m = multiAssign(); if (m) return m; }
    const name = peek();
    if (opts.assign === false || !name || !NAME.test(name) || reserved(name)) return relation();
    const save = i;
    take();
    let params: string[] | null = null, ok = true;
    if (peek() === '(') {
      take();
      params = [];
      for (;;) {
        const p = take();
        if (!p || !NAME.test(p) || reserved(p)) { ok = false; break; }
        params.push(p);
        if (peek() === ',') { take(); continue; }
        if (take() !== ')') ok = false;
        break;
      }
      if (new Set(params).size !== params.length) ok = false;
    }
    if (ok && (peek() === '=' || peek() === ':=') && i + 1 < tokens.length) {
      const op = take() as '=' | ':=';
      const value = range();
      if (i >= tokens.length || peek() === ',' || peek() === ';') return { t: 'assign', name, params, op, value };
    }
    i = save;
    return relation();
  }

  const top: Node[] = [statement()];
  // A list at the top level without brackets: "x + y = 3, x − y = 1"; statements "a = 1; b = a + 1"; a closing ; is allowed.
  while (peek() === ',' || peek() === ';') { take(); if (i >= tokens.length) break; top.push(statement()); }
  if (i < tokens.length) {
    const t = tokens[i];
    fail(CLOSE.includes(t) || t === '|' ? 'Sprawdź nawiasy.' : `Nieoczekiwany znak „${isStr(t) ? `'${t.slice(1)}'` : t}”.`);
  }
  return top.length === 1 ? top[0] : { t: 'list', items: top, bracket: '{' };
}

const INVERSE: Record<string, string> = { sin: 'asin', cos: 'acos', tan: 'atan', cot: 'acot', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' };
