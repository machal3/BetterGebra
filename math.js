const fn = (f, show, min = 1, max = min) => ({ f, show, min, max });
function gamma(z) {
  if (z < .5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z -= 1; let a = c[0]; const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (z + i);
  return Math.sqrt(2 * Math.PI) * t ** (z + .5) * Math.exp(-t) * a;
}
function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) return gamma(n + 1);
  let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
}
const FN = {
  sin: fn(Math.sin), cos: fn(Math.cos), tan: fn(Math.tan, 'tg'), cot: fn(x => 1 / Math.tan(x), 'ctg'), sec: fn(x => 1 / Math.cos(x)), csc: fn(x => 1 / Math.sin(x)),
  asin: fn(Math.asin, 'arcsin'), acos: fn(Math.acos, 'arccos'), atan: fn(Math.atan, 'arctg'), acot: fn(x => Math.PI / 2 - Math.atan(x), 'arcctg'),
  sinh: fn(Math.sinh), cosh: fn(Math.cosh), tanh: fn(Math.tanh), coth: fn(x => 1 / Math.tanh(x)),
  asinh: fn(Math.asinh, 'arsinh'), acosh: fn(Math.acosh, 'arcosh'), atanh: fn(Math.atanh, 'artanh'),
  sqrt: fn(Math.sqrt), cbrt: fn(Math.cbrt), root: fn((n, x) => x < 0 && Number.isInteger(n) && n % 2 ? -((-x) ** (1 / n)) : x ** (1 / n), 'root', 2),
  abs: fn(Math.abs), sign: fn(Math.sign, 'sgn'), floor: fn(Math.floor), ceil: fn(Math.ceil), round: fn(Math.round),
  ln: fn(Math.log), log: fn((a, b) => b === undefined ? Math.log10(a) : Math.log(b) / Math.log(a), 'log', 1, 2), log2: fn(Math.log2, 'log₂'), exp: fn(Math.exp),
  min: fn(Math.min, 'min', 2, Infinity), max: fn(Math.max, 'max', 2, Infinity), mod: fn((a, b) => ((a % b) + b) % b, 'mod', 2), gamma: fn(gamma, 'Γ'),
};
const ALIAS = { tg: 'tan', ctg: 'cot', cotg: 'cot', cosec: 'csc', arcsin: 'asin', arccos: 'acos', arctan: 'atan', arctg: 'atan', arccot: 'acot', arcctg: 'acot',
  arsinh: 'asinh', arcsinh: 'asinh', arcosh: 'acosh', arccosh: 'acosh', artanh: 'atanh', arctanh: 'atanh', tgh: 'tanh', ctgh: 'coth', sgn: 'sign', lg: 'log', ld: 'log2', nroot: 'root' };
for (const [name, f] of Object.entries(FN)) f.show ??= name;
const INVERSE = { sin: 'asin', cos: 'acos', tan: 'atan', cot: 'acot', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' };
const CONST = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2 };
const NAMES = [...Object.keys(FN), ...Object.keys(ALIAS), ...Object.keys(CONST), 'frac', 'x'].sort((a, b) => b.length - a.length);
const OPEN = ['(', '[', '{'], CLOSE = [')', ']', '}'];
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };

function tokenize(input) {
  const source = input.toLowerCase().replace(/^\s*(?:y|[a-z]\s*\(\s*x\s*\))\s*=/, '')
    .replace(/\\(?:cdot|times)/g, '*').replace(/\\div/g, '/').replace(/\\(?:left|right)|\\[,;:! ]/g, '').replace(/\\/g, '')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, s => `^(${[...s].map(c => SUP[c]).join('')})`)
    .replace(/π/g, 'pi').replace(/τ/g, 'tau').replace(/[φϕ]/g, 'phi').replace(/√/g, 'sqrt').replace(/∛/g, 'cbrt')
    .replace(/[·⋅∙×]/g, '*').replace(/[÷:]/g, '/').replace(/[−–]/g, '-').replace(/\*\*/g, '^').trim();
  if (!source || source.length > 300) throw Error('Wpisz funkcję, np. x^2 lub sin(x).');
  const raw = source.match(/(?:\d+,\d+|\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?|[a-z]+|[+\-*/^()[\]{}|,;!°_]/g) || [];
  if (raw.join('') !== source.replace(/\s/g, '')) throw Error('Nieznany znak. Użyj liter, liczb i działań matematycznych.');
  // Split letter runs into known names, e.g. "2pix" → 2 pi x, "sinx" → sin x, "ab" → a b.
  return raw.flatMap((t, k) => {
    if (!/^[a-z]+$/.test(t)) return [t];
    const out = []; let unknown = 0;
    for (let i = 0; i < t.length;) {
      const name = NAMES.find(n => t.startsWith(n, i)) || t[i];
      if (name.length === 1 && name !== 'x' && name !== 'e') unknown++;
      out.push(ALIAS[name] || name); i += name.length;
    }
    if (unknown > 3 || (unknown > 1 && OPEN.includes(raw[k + 1]))) throw Error(`Nie rozpoznaję „${t}”. Między parametrami wstaw *, np. a*b.`);
    return out;
  });
}
const isParam = t => /^[a-z]$/.test(t) && t !== 'x' && t !== 'e';
const isNum = t => /^\.?\d/.test(t ?? '');
export function parameterNames(input) {
  if (!input.trim()) return [];
  return [...new Set(tokenize(input).filter(isParam))].sort();
}

function parse(input) {
  const tokens = tokenize(input);
  let i = 0, absDepth = 0;
  const peek = () => tokens[i], take = () => tokens[i++];
  const close = () => { if (!CLOSE.includes(take())) throw Error('Brakuje zamykającego nawiasu.'); };
  const startsAtom = t => t !== undefined && (isNum(t) || /^[a-z]/.test(t) || OPEN.includes(t) || (t === '|' && !absDepth));
  const simple = t => isNum(t) || t === 'x' || isParam(t) || Object.hasOwn(CONST, t);
  function call(name) {
    const args = []; let power = null;
    if (name === 'sqrt' && peek() === '[') { take(); args.push(sum()); if (take() !== ']') throw Error('Brakuje ] w stopniu pierwiastka.'); name = 'root'; }
    if (name === 'log' && peek() === '_') { take(); args.push(atom()); }
    if (peek() === '^') { take(); power = unary(); }
    if (power?.t === 'neg' && power.a.t === 'num' && power.a.v === 1 && INVERSE[name]) { name = INVERSE[name]; power = null; }
    if (OPEN.includes(peek())) {
      take(); args.push(sum());
      while (peek() === ',' || peek() === ';') { take(); args.push(sum()); }
      close();
    } else {
      if (!startsAtom(peek())) throw Error(`Uzupełnij argument: ${name}(x).`);
      // sin 2x → sin(2x); stops at the next function, so 2 sin x cos x works.
      let arg = unary(); while (simple(peek())) arg = { t: '*', a: arg, b: pow() };
      args.push(arg);
    }
    const { min, max, show } = FN[name];
    if (args.length < min || args.length > max) throw Error(`${show} przyjmuje ${min === max ? min : `${min}–${max === Infinity ? 'n' : max}`} ${min === 1 && max === 1 ? 'argument' : 'argumenty'}. Argumenty oddziel średnikiem, np. max(x; 1).`);
    const node = { t: 'call', n: name, args };
    return power ? { t: '^', a: node, b: power, fn: true } : node;
  }
  function atom() {
    const t = take();
    if (OPEN.includes(t)) { const e = sum(); close(); return e; }
    if (t === '|') { absDepth++; const e = sum(); if (take() !== '|') throw Error('Brakuje zamykającej kreski |.'); absDepth--; return { t: 'call', n: 'abs', args: [e] }; }
    if (t === 'x') return { t: 'x' };
    if (Object.hasOwn(CONST, t)) return { t: 'const', n: t };
    if (isParam(t)) return { t: 'param', n: t };
    if (t === 'frac') return { t: '/', a: atom(), b: atom() };
    if (Object.hasOwn(FN, t)) return call(t);
    if (isNum(t)) return { t: 'num', v: Number(t.replace(',', '.')), s: t };
    throw Error(t ? `Nie rozpoznaję „${t}”. Sprawdź zapis funkcji.` : 'Uzupełnij wyrażenie.');
  }
  function pow() {
    let base = atom();
    while (peek() === '!' || peek() === '°') base = { t: take(), a: base };
    if (peek() === '^') { take(); return { t: '^', a: base, b: unary() }; }
    return base;
  }
  function unary() {
    if (peek() === '+') { take(); return unary(); }
    if (peek() === '-') { take(); return { t: 'neg', a: unary() }; }
    return pow();
  }
  function product() {
    let left = unary();
    for (;;) {
      if (peek() === '*' || peek() === '/') left = { t: take(), a: left, b: unary() };
      else if (startsAtom(peek())) left = { t: '*', a: left, b: pow() };
      else return left;
    }
  }
  function sum() { let left = product(); while (peek() === '+' || peek() === '-') left = { t: take(), a: left, b: product() }; return left; }
  const ast = sum();
  if (i < tokens.length) { const t = tokens[i]; throw Error(CLOSE.includes(t) || t === '|' ? 'Sprawdź nawiasy w wyrażeniu.' : `Nieoczekiwany znak „${t}”.`); }
  return ast;
}

function build(n, p) {
  const a = n.a && build(n.a, p), b = n.b && build(n.b, p);
  switch (n.t) {
    case 'num': return () => n.v;
    case 'x': return x => x;
    case 'const': return () => CONST[n.n];
    case 'param': return () => Object.hasOwn(p, n.n) ? p[n.n] : 1;
    case 'neg': return x => -a(x);
    case '+': return x => a(x) + b(x);
    case '-': return x => a(x) - b(x);
    case '*': return x => a(x) * b(x);
    case '/': return x => a(x) / b(x);
    case '^': return x => a(x) ** b(x);
    case '!': return x => factorial(a(x));
    case '°': return x => a(x) * Math.PI / 180;
    case 'call': { const f = FN[n.n].f, args = n.args.map(g => build(g, p)); return args.length === 1 ? x => f(args[0](x)) : x => f(...args.map(g => g(x))); }
  }
}
export function compile(input, parameters = {}) { return build(parse(input), parameters); }

// --- MathML formatting ---
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const mi = s => `<mi>${esc(s)}</mi>`, mo = s => `<mo>${esc(s)}</mo>`, row = s => `<mrow>${s}</mrow>`;
const paren = s => row(`${mo('(')}${s}${mo(')')}`);
const prec = n => ({ '+': 1, '-': 1, '*': 2, neg: 3, '^': 4, '!': 5, '°': 5 })[n.t] ?? 6;
const startsNum = n => n.t === 'num' || (['*', '+', '-', '^', '!', '°'].includes(n.t) && startsNum(n.a));
const endsNum = n => n.t === 'num' || (['*', '+', '-'].includes(n.t) && endsNum(n.b));
const atomic = n => ['num', 'x', 'param', 'const'].includes(n.t);
const radical = n => n.t === 'call' && ['sqrt', 'cbrt', 'root', 'abs'].includes(n.n);
const wrap = (n, need) => need ? paren(render(n)) : render(n);
function callMathML(n, sup) {
  const [x, y] = n.args.map(render);
  if (!sup) {
    if (n.n === 'abs') return row(`${mo('|')}${x}${mo('|')}`);
    if (n.n === 'floor') return row(`${mo('⌊')}${x}${mo('⌋')}`);
    if (n.n === 'ceil') return row(`${mo('⌈')}${x}${mo('⌉')}`);
    if (n.n === 'sqrt') return `<msqrt>${x}</msqrt>`;
    if (n.n === 'cbrt') return `<mroot>${row(x)}<mn>3</mn></mroot>`;
    if (n.n === 'root') return `<mroot>${row(y)}${row(x)}</mroot>`;
    if (n.n === 'exp') return `<msup>${mi('e')}${row(x)}</msup>`;
    if (n.n === 'log' && y) return row(`<msub>${mi('log')}${row(x)}</msub>${paren(y)}`);
  }
  const name = `<mi mathvariant="normal">${esc(FN[n.n].show)}</mi>`, head = sup ? `<msup>${name}${row(sup)}</msup>` : name;
  const body = n.args.length === 1 && atomic(n.args[0]) ? `<mspace width="0.17em"/>${x}` : paren(n.args.map(render).join(mo(',')));
  return row(`${head}<mo>&#x2061;</mo>${body}`);
}
function render(n) {
  switch (n.t) {
    case 'num': return `<mn>${esc(n.s.replace('.', ','))}</mn>`;
    case 'x': return mi('x');
    case 'param': return mi(n.n);
    case 'const': return mi({ pi: 'π', tau: 'τ', phi: 'φ', e: 'e' }[n.n]);
    case 'neg': return row(mo('−') + wrap(n.a, n.a.t === 'neg' || prec(n.a) <= 1));
    case '+': case '-': return row(render(n.a) + mo(n.t === '+' ? '+' : '−') + wrap(n.b, prec(n.b) <= 1 || n.b.t === 'neg'));
    case '*': {
      const right = prec(n.b) <= 3, dot = !right && (startsNum(n.b) || (n.b.t === '/' && endsNum(n.a)));
      return row(wrap(n.a, prec(n.a) <= 1) + (dot ? mo('·') : '<mo>&#x2062;</mo>') + wrap(n.b, right));
    }
    case '/': return `<mfrac>${row(render(n.a))}${row(render(n.b))}</mfrac>`;
    case '^':
      if (n.fn && !radical(n.a) && !['exp', 'log'].includes(n.a.n)) return callMathML(n.a, render(n.b));
      return `<msup>${row(wrap(n.a, prec(n.a) < 6 || n.a.t === '/' || radical(n.a) && n.a.n !== 'abs'))}${row(render(n.b))}</msup>`;
    case '!': case '°': return row(wrap(n.a, prec(n.a) < 6 || n.a.t === '/') + mo(n.t));
    case 'call': return callMathML(n);
  }
}
export function toMathML(input) { return `<math>${mi('y')}${mo('=')}${render(parse(input))}</math>`; }

// Replace e.g. 1.9999999999999998 with 2 when the rounder value is at least as good a root.
function snap(fn, x, tol) {
  const candidates = [0, ...[1, 2, 3, 4, 6, 8, 12].map(d => Math.round(x * d) / d), ...Array.from({ length: 12 }, (_, k) => Number(x.toFixed(k + 1)))];
  return candidates.find(c => Math.abs(c - x) <= tol && Math.abs(fn(c)) <= Math.abs(fn(x))) ?? x;
}
export function roots(fn, min, max) {
  const N = 4000, step = (max - min) / N, found = [];
  const add = x => { x = snap(fn, x, step * 1e-3); if (!found.some(r => Math.abs(r - x) < step / 2)) found.push(x); };
  const ys = Array.from({ length: N + 1 }, (_, i) => fn(min + i * step)), abs = Math.abs;
  for (let i = 0; i <= N && found.length < 50; i++) {
    const x = min + i * step, y = ys[i], prev = ys[i - 1], next = ys[i + 1];
    if (y === 0) { if (prev !== 0) add(x); continue; } // a run of zeros (floor x on [0; 1)) reports only its start
    if (i && prev !== 0 && Number.isFinite(prev) && Number.isFinite(y) && Math.sign(prev) !== Math.sign(y)) {
      let a = x - step, b = x, fa = prev;
      for (let m = (a + b) / 2; m > a && m < b; m = (a + b) / 2) { const fm = fn(m); if (fm === 0) { a = b = m; break; } if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else b = m; }
      // Poles (1/x, tan x) change sign too, but there |f| grows while bisecting instead of shrinking.
      const r = abs(fn(a)) < abs(fn(b)) ? a : b;
      if (abs(fn(r)) <= Math.min(abs(prev), abs(y))) add(r);
    }
    // Touching roots (x², sin²x) never change sign: look for a local minimum of |f| that reaches ~0.
    if (i && i < N && abs(y) < abs(prev) && abs(y) <= abs(next) && Math.sign(prev) === Math.sign(y) && Math.sign(next) === Math.sign(y)) {
      let a = x - step, b = x + step;
      for (let k = 0; k < 200 && b - a > 1e-15 * Math.max(1, abs(x)); k++) {
        const c = b - (b - a) * .618034, d = a + (b - a) * .618034;
        if (abs(fn(c)) < abs(fn(d))) b = d; else a = c;
      }
      const m = (a + b) / 2;
      // ponytail: fixed relative tolerance, so x²+1e-13 counts as touching the axis; fine at graphing precision.
      if (abs(fn(m)) < 1e-12 * Math.max(1, abs(prev), abs(next))) add(m);
    }
  }
  return found.sort((a, b) => a - b);
}
export function intersections(f, g, min, max) {
  return roots(x => f(x) - g(x), min, max).map(x => ({ x, y: f(x) }));
}
// Recognise simple closed forms: p/d, pπ/d, p√k/d with d ≤ 12.
export function exact(v) {
  if (!Number.isFinite(v)) return null;
  if (v === 0) return '0';
  const units = [[1, ''], [Math.PI, 'π'], ...[2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23].map(k => [Math.sqrt(k), `√${k}`])];
  for (const [u, name] of units) for (let d = 1; d <= 12; d++) {
    const p = Math.round(v / u * d);
    if (p && Math.abs(p * u / d - v) < 1e-10 * Math.max(1, Math.abs(v)) && (name || Math.abs(p) < 1e6)) {
      const n = Math.abs(p), num = name ? (n === 1 ? name : `${n}${name}`) : String(n);
      return `${p < 0 ? '−' : ''}${num}${d > 1 ? `/${d}` : ''}`;
    }
  }
  return null;
}
