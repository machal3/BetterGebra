/**
 * LaTeX → the calculator's own notation, before anything else reads the input: \frac{a}{b} → (a/b),
 * \int_a^b f\,dx → integrate(f, x, a, b), \sum, \prod, \lim, \frac{d}{dx}, \binom, matrices and systems
 * (cases). Input without LaTeX passes unchanged, so plain braces keep meaning a set: {2, 4, 4}.
 */

const GREEK = 'alpha α beta β gamma γ delta δ epsilon ε varepsilon ε zeta ζ eta η theta θ vartheta θ iota ι kappa κ lambda λ mu μ nu ν xi ξ rho ρ sigma σ varsigma σ upsilon υ chi χ psi ψ omega ω Delta Δ Theta Θ Lambda Λ Xi Ξ Sigma Σ Phi Φ Psi Ψ Omega Ω';
const WORDS: Record<string, string> = {
  ...Object.fromEntries(GREEK.split(' ').reduce<string[][]>((out, w, i, all) => (i % 2 ? out : [...out, [w, all[i + 1]]]), [])),
  // the parser reads these words as the constants τ = 2π and φ = golden ratio; in LaTeX they are usually variables
  pi: ' pi ', tau: 'τ', phi: 'φ', varphi: 'φ', Gamma: ' gamma', infty: ' inf ', infin: ' inf ',
  cdot: '*', times: '*', ast: '*', div: '/', colon: '/',
  le: '<=', leq: '<=', leqslant: '<=', ge: '>=', geq: '>=', geqslant: '>=', ne: '!=', neq: '!=', lt: '<', gt: '>',
  to: '->', rightarrow: '->', longrightarrow: '->', mapsto: '->',
  circ: '°', degree: '°', partial: 'd', lfloor: ' floor(', rfloor: ')', lceil: ' ceil(', rceil: ')', vert: '|', lvert: '|', rvert: '|', mid: '|',
  quad: ' ', qquad: ' ', displaystyle: '', textstyle: '', scriptstyle: '', limits: '', nolimits: '', cdots: '', ldots: '', dots: '',
  big: '', Big: '', bigg: '', Bigg: '', bigl: '', bigr: '', Bigl: '', Bigr: '', biggl: '', biggr: '', middle: '',
  tg: ' tan', ctg: ' cot', cotg: ' cot', arctg: ' atan', arcctg: ' acot', sgn: ' sign', exp: ' exp',
};
/** One-character commands: spacing, escaped braces, the \[ … \] and \( … \) delimiters, row breaks. */
const SYMBOL: Record<string, string> = { ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', '{': '{', '}': '}', '|': '|', '[': '', ']': '', '(': '', ')': '', '\\': ', ', '%': '%' };
/** Commands whose group is plain text: \mathrm{d}, \operatorname{sgn}, \text{…}. */
const TEXT = new Set(['text', 'textrm', 'textit', 'textbf', 'mathrm', 'mathit', 'mathbf', 'mathsf', 'mathtt', 'mathbb', 'mathcal', 'boldsymbol', 'operatorname', 'mbox']);
const MATRIX = new Set(['matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix', 'array']);
const LINES = new Set(['cases', 'aligned', 'align', 'align*', 'gather', 'gathered', 'split', 'eqnarray', 'system', 'alignat']);

export const looksLikeLatex = (s: string) => /\\[a-zA-Z,;:! {}|[\]()]|\$|\{,\}/.test(s);

export function fromLatex(input: string): string {
  if (!looksLikeLatex(input)) return input;
  return convert(input.replace(/\$/g, '')).replace(/\^\s*\(?\s*°\s*\)?/g, '°').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}

/** A reader over one level of LaTeX source. */
class Reader {
  i = 0;
  constructor(readonly s: string) {}
  get done() { return this.i >= this.s.length; }
  peek(k = 0) { return this.s[this.i + k] ?? ''; }
  skipSpace() { while (/\s/.test(this.peek())) this.i++; }
  /** The inside of a {…} group starting here (the reader is on '{'). */
  group(): string {
    let depth = 0;
    const start = this.i + 1;
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i];
      if (c === '\\') { this.i++; continue; }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { this.i++; return this.s.slice(start, this.i - 1); }
    }
    return this.s.slice(start);
  }
  /** One argument: a group, a command, or a single character. */
  arg(): string {
    this.skipSpace();
    const c = this.peek();
    if (c === '{') return this.group();
    if (c === '\\') { const m = /^\\([a-zA-Z]+|.)/.exec(this.s.slice(this.i))!; this.i += m[0].length; return m[0]; }
    this.i++;
    return c;
  }
  /** The rest of this level up to a relation, a comma or a row break: the body of \sum, \lim, \int, d/dx. */
  term(): string {
    const start = this.i;
    let depth = 0;
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i], rest = this.s.slice(this.i);
      if (c === '\\') {
        if (depth === 0 && /^\\(?:le|leq|ge|geq|ne|neq|lt|gt|leqslant|geqslant|\\)(?![a-zA-Z])/.test(rest)) break;
        this.i++;
        continue;
      }
      if ('{(['.includes(c)) depth++;
      else if ('})]'.includes(c)) { if (depth === 0) break; depth--; }
      else if (depth === 0 && '=<>,;&'.includes(c)) break;
    }
    return this.s.slice(start, this.i);
  }
}

/** Short enough to need no parentheses around it: 2, x, 10, π. */
const simple = (s: string) => /^\s*(?:[\w.]+|[α-ωΑ-Ω])\s*$/.test(s);
const paren = (s: string) => (simple(s) ? s.trim() : `(${s.trim()})`);

function convert(src: string): string {
  const r = new Reader(src);
  let out = '';
  while (!r.done) {
    const c = r.peek();
    if (c === '\\') { out += command(r); continue; }
    if (c === '{') {
      const inner = r.group();
      out += inner.trim() === ',' ? '.' : `(${convert(inner)})`; // 2{,}5: a decimal comma
      continue;
    }
    if (c === '^' || c === '_') {
      r.i++;
      const raw = r.arg(), v = convert(raw).trim();
      out += v === '°' && c === '^' ? '°' : `${c}${raw.length > 1 && !simple(v) ? `(${v})` : v}`;
      continue;
    }
    if (c === '&') { r.i++; out += ' '; continue; }
    if (c === '}') { r.i++; continue; }
    out += c;
    r.i++;
  }
  return out;
}

function command(r: Reader): string {
  const m = /^\\([a-zA-Z]+\*?|.)/.exec(r.s.slice(r.i));
  if (!m) { r.i++; return ''; }
  r.i += m[0].length;
  const name = m[1];
  if (name.length === 1 && !/[a-zA-Z]/.test(name)) return SYMBOL[name] ?? name;
  switch (name) {
    case 'frac': case 'dfrac': case 'tfrac': case 'cfrac': {
      const a = r.arg(), b = r.arg();
      const d = derivative(a, b);
      if (d) { const body = convert(r.term()); return ` diff(${body.trim()}, ${d.v}${d.n > 1 ? `, ${d.n}` : ''})`; }
      return `(${paren(convert(a))}/${paren(convert(b))})`;
    }
    case 'sqrt': {
      r.skipSpace();
      let n = '';
      if (r.peek() === '[') { const end = r.s.indexOf(']', r.i); n = r.s.slice(r.i + 1, end); r.i = end + 1; }
      const a = convert(r.arg());
      return n ? ` root(${convert(n).trim()}, ${a.trim()})` : ` sqrt(${a.trim()})`;
    }
    case 'binom': case 'dbinom': case 'tbinom': { const n = convert(r.arg()), k = convert(r.arg()); return ` binomial(${n.trim()}, ${k.trim()})`; }
    case 'int': case 'iint': case 'oint': return integral(r);
    case 'sum': case 'prod': return series(r, name === 'sum' ? 'sum' : 'product');
    case 'lim': return limit(r);
    case 'log': case 'ln': case 'lg': {
      // \log_{2} x keeps its base for the parser: log_(2) x
      return ` ${name}`;
    }
    case 'left': case 'right': {
      r.skipSpace();
      if (r.peek() === '.') r.i++; // \left. … \right| : an invisible bracket
      // \left\{ \begin{array} … : the brace of a system, not a set
      else if (/^\\\{\s*\\begin\{/.test(r.s.slice(r.i))) r.i += 2;
      return '';
    }
    case 'begin': return environment(r);
    case 'end': r.arg(); return '';
    case 'not': return '!';
  }
  if (TEXT.has(name)) { const t = convert(r.arg()).trim(); return name === 'operatorname' ? ` ${t}` : ` ${t} `; }
  if (Object.hasOwn(WORDS, name)) return WORDS[name];
  // \sin, \arccos, \max, \det, \gcd…: the parser knows the word
  return ` ${name}`;
}

/** d/dx, d²/dx², ∂/∂x as the numerator and denominator of \frac: the variable and the order. */
function derivative(a: string, b: string): { v: string; n: number } | null {
  const clean = (s: string) => s.replace(/\\(?:mathrm|operatorname|text)\s*\{\s*d\s*\}/g, 'd').replace(/\\partial/g, 'd').replace(/[{}\s]|\\[,;:!]/g, '');
  const top = /^d(?:\^(\d+))?$/.exec(clean(a)), bottom = /^d(\\?[a-zA-Z]+|[α-ω])(?:\^(\d+))?$/.exec(clean(b));
  if (!top || !bottom) return null;
  const v = bottom[1].startsWith('\\') ? (WORDS[bottom[1].slice(1)] ?? bottom[1].slice(1)) : bottom[1];
  if (v.length !== 1) return null;
  return { v, n: Number(top[1] ?? bottom[2] ?? 1) };
}

/** _{low}^{high} after \int, \sum, \lim (in either order), raw. */
function limits(r: Reader): { low?: string; high?: string } {
  const out: { low?: string; high?: string } = {};
  for (;;) {
    r.skipSpace();
    if (r.s.startsWith('\\limits', r.i)) { r.i += 7; continue; }
    const c = r.peek();
    if (c === '_' && out.low === undefined) { r.i++; out.low = r.arg(); }
    else if (c === '^' && out.high === undefined) { r.i++; out.high = r.arg(); }
    else return out;
  }
}

/** \int_a^b f \, dx → integrate(f, x, a, b); without dx the calculator picks the variable. */
function integral(r: Reader): string {
  const { low, high } = limits(r);
  const body = r.term();
  // the differential: d, \mathrm{d} or \,d before the variable, not part of a longer word
  const re = /(^|[^a-zA-Z\\])(?:\\(?:mathrm|operatorname|text)\s*\{\s*d\s*\}|d)\s*(\\[a-zA-Z]+|[a-zA-Z])(?![a-zA-Z])/g;
  let found: RegExpExecArray | null = null;
  for (let m = re.exec(body); m; m = re.exec(body)) found = m; // the last one: x·dx in "x dx"
  let f = body, v = '', after = '';
  if (found) {
    const at = found.index + found[1].length;
    f = body.slice(0, at);
    after = body.slice(found.index + found[0].length);
    v = found[2].startsWith('\\') ? (WORDS[found[2].slice(1)] ?? found[2].slice(1)) : found[2];
  }
  const fx = convert(f).trim() || '1';
  const lim = low !== undefined && high !== undefined ? [convert(low).trim(), convert(high).trim()] : [];
  return ` integrate(${[fx, ...(v ? [v] : []), ...lim].join(', ')})${convert(after)}`;
}

/** \sum_{k=1}^{n} a_k → sum(a_k, k, 1, n). */
function series(r: Reader, name: 'sum' | 'product'): string {
  const { low, high } = limits(r);
  const body = convert(r.term()).trim();
  const m = low !== undefined ? /^\s*([^=]+?)\s*=\s*(.+)$/s.exec(low) : null;
  if (!m || high === undefined) return ` ${name}(${body})`;
  return ` ${name}(${body}, ${convert(m[1]).trim()}, ${convert(m[2]).trim()}, ${convert(high).trim()})`;
}

/** \lim_{x \to a^+} f → limit(f, x->a, 1). */
function limit(r: Reader): string {
  const { low } = limits(r);
  const body = convert(r.term()).trim();
  if (low === undefined) return ` limit(${body})`;
  const [v, at = ''] = convert(low).split('->').map(s => s.trim());
  // one-sided: a^+, a^{+}, a^-, a⁺
  const side = /\^\s*\(?\s*([+-])\s*\)?$|([⁺⁻])$/.exec(at);
  const point = side ? at.slice(0, side.index).trim() : at;
  const dir = side ? ((side[1] ?? side[2]) === '+' || side[2] === '⁺' ? ', 1' : ', -1') : '';
  return ` limit(${body}, ${v}->${point}${dir})`;
}

/** \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix} → [[1, 2], [3, 4]]; vmatrix is the determinant; cases is a system. */
function environment(r: Reader): string {
  const env = r.arg().trim();
  if (env === 'array') { r.skipSpace(); if (r.peek() === '{') r.group(); } // column spec {cc}
  const endTag = `\\end{${env}}`, start = r.i;
  let depth = 0, end = r.s.length;
  for (let j = r.i; j < r.s.length; j++) {
    if (r.s.startsWith(`\\begin{${env}}`, j)) depth++;
    else if (r.s.startsWith(endTag, j)) { if (depth === 0) { end = j; break; } depth--; }
  }
  const inner = r.s.slice(start, end);
  r.i = Math.min(r.s.length, end + endTag.length);
  const rows = splitTop(inner, '\\\\').map(s => s.trim()).filter(Boolean);
  // an array of equations is a system, written with array instead of cases
  const system = rows.some(row => /=|<|>|\\(?:le|ge|leq|geq|neq)(?![a-zA-Z])/.test(row));
  if (MATRIX.has(env) && !system) {
    const m = `[${rows.map(row => `[${splitTop(row, '&').map(c => convert(c).trim()).join(', ')}]`).join(', ')}]`;
    // in parentheses, so \det\begin{bmatrix}… reads as det([[…]]), not as det with one argument per row
    return env === 'vmatrix' ? ` det(${m})` : env === 'Vmatrix' ? ` norm(${m})` : `(${m})`;
  }
  if (LINES.has(env) || system) return rows.map(row => convert(row.replace(/&/g, ' ')).trim()).join(', ');
  return convert(inner);
}

/** Splits at a separator outside {…}. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && !s.startsWith(sep, j)) { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && s.startsWith(sep, j)) { out.push(s.slice(from, j)); from = j + sep.length; j += sep.length - 1; }
  }
  out.push(s.slice(from));
  return out;
}
