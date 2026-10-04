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
      // A sample can also land ~1e-16 from the root (sin(x°) at 180), so a float-noise |f(r)| still counts.
      const r = abs(fn(a)) < abs(fn(b)) ? a : b, fr = abs(fn(r));
      if (fr <= Math.min(abs(prev), abs(y)) || fr <= 1e-9 * Math.max(abs(prev), abs(y))) add(r);
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
const finite = Number.isFinite;
function nice(v) {
  for (const u of [1, Math.PI]) for (let d = 1; d <= 12; d++) {
    const c = Math.round(v / u * d) * u / d;
    if (Math.abs(c - v) < 1e-9 * Math.max(1, Math.abs(v))) return c + 0; // + 0 turns -0 into 0
  }
  // Short decimals (0.001, 2.75): a bisected jump of floor(1000x) lands an ulp below 0.001, where f still has the old value.
  for (let k = 1; k <= 15; k++) { const c = Number(v.toPrecision(k)); if (Math.abs(c - v) <= 1e-12 * Math.abs(v)) return c; }
  return null;
}
// One-sided limit at c, or NaN when it doesn't exist or diverges (ln x, 1/x at 0). tol = what counts as "equal" in y.
function limit(fn, c, dir, tol) {
  const h = 1e-9 * Math.max(1, Math.abs(c)), near = fn(c + dir * h), far = fn(c + dir * h * 1e3);
  return finite(near) && finite(far) && Math.abs(near - far) < tol ? near : NaN;
}
// A piece of the graph ends somewhere in (a; b): a domain edge or a jump. Pin the point down and return its dots:
// closed = the value f(c) itself, open = a one-sided limit the graph approaches but doesn't reach.
export function endpoint(fn, a, b, tol) {
  // Keep the half with more variation (3-point estimate): it stays ≈ the jump at a jump, blows up at a pole
  // (even −1/x², whose endpoint values hide it), and shrinks to 0 where f is continuous.
  const variation = (u, v) => {
    const ys = [fn(u), fn((u + v) / 2), fn(v)], ok = ys.filter(finite).length;
    return ok === 0 ? 0 : ok < 3 ? Infinity : Math.abs(ys[0] - ys[1]) + Math.abs(ys[1] - ys[2]);
  };
  for (let m = (a + b) / 2; m > a && m < b; m = (a + b) / 2) if (variation(a, m) >= variation(m, b)) b = m; else a = m;
  const c = nice(a) ?? nice(b) ?? (finite(fn(a)) ? a : b), fc = fn(c), dots = [];
  // Probe close enough that even √-type ends (|f(c±h) − f(c)| ~ √h) are within tol: h ≤ tol²/4.
  const h = Math.max(Math.min(1e-9 * Math.max(1, Math.abs(c)), tol * tol / 4), 4e-16 * Math.abs(c), 1e-300);
  // Where the piece on this side ends: f(c) if it reaches it, its limit if it only approaches, ±∞ if it diverges,
  // NaN if the graph doesn't continue on that side.
  const side = dir => {
    const near = fn(c + dir * h), mid = fn(c + dir * h * 1e3), far = fn(c + dir * h * 1e6);
    if (!finite(near)) return NaN;
    if (finite(fc) && Math.abs(near - fc) < tol) return fc;
    if (finite(mid) && Math.abs(near - mid) < tol) { dots.push({ x: c, y: near, closed: false }); return near; }
    // ponytail: "|f| keeps growing over 3 scales" = divergence; a wild oscillation (sin(1/x)) could fool it.
    if (finite(far) && Math.sign(near) === Math.sign(far) && Math.abs(near) > Math.abs(mid) && Math.abs(mid) > Math.abs(far) && Math.abs(near) > 2 * Math.abs(far)) return near > 0 ? Infinity : -Infinity;
    return near;
  };
  const left = side(-1), right = side(1);
  // No dot when both sides reach f(c) (continuous, just steep), nor when no side reaches it and one diverges:
  // then f(c) is a float artefact like tan(π/2) = 1.6e16, not a point of the graph. sgn(0) = 0 stays (finite limits).
  const reached = left === fc || right === fc, diverges = [left, right].some(v => Math.abs(v) === Infinity);
  if (finite(fc) && !(left === fc && right === fc) && (reached || !diverges)) dots.unshift({ x: c, y: fc, closed: true });
  return { x: c, left, right, dots };
}
// Removable gaps the sampler can't see, e.g. sin(x)/x or (x²−1)/(x−1): undefined at one point, same limit on both sides.
// ponytail: only checks multiples of 1/4 and π/4 (skipped when > 1000 of them are in view); add candidates if other holes matter.
export function holes(fn, min, max, tol) {
  const out = [];
  for (const s of [1, .5, .25, Math.PI / 4]) {
    if ((max - min) / s > 1000) continue;
    for (let k = Math.ceil(min / s); k * s <= max; k++) {
      const c = k * s; if (finite(fn(c)) || out.some(p => Math.abs(p.x - c) < 1e-9)) continue;
      const l = limit(fn, c, -1, tol), r = limit(fn, c, 1, tol);
      if (finite(l) && finite(r) && Math.abs(l - r) < tol) out.push({ x: c, y: (l + r) / 2, closed: false });
    }
  }
  return out;
}
export function intersections(f, g, min, max) {
  return roots(x => f(x) - g(x), min, max).map(x => ({ x, y: f(x) }));
}
// Recognise simple closed forms: p/d with d ≤ 100, pπ/d and p√k/d with d ≤ 12. Larger denominators read worse than the decimal.
// Match only to float rounding (1e-14 relative, ~45 ulp): a looser match would show 1.41421356237663 (root of x² − 2.00000000001) as √2.
export function exact(v) {
  if (!Number.isFinite(v)) return null;
  if (v === 0) return '0';
  const units = [[1, ''], [Math.PI, 'π'], ...[2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23].map(k => [Math.sqrt(k), `√${k}`])];
  for (const [u, name] of units) for (let d = 1; d <= (name ? 12 : 100); d++) {
    const p = Math.round(v / u * d);
    if (p && Math.abs(p * u / d - v) < 1e-14 * Math.abs(v) && (name || Math.abs(p) < 1e6)) {
      const n = Math.abs(p), num = name ? (n === 1 ? name : `${n}${name}`) : String(n);
      return `${p < 0 ? '−' : ''}${num}${d > 1 ? `/${d}` : ''}`;
    }
  }
  return null;
}

// --- Proven closed forms ---
// exact() above only guesses from a float. Here a guess is checked by re-evaluating the expression in exact arithmetic:
// a number is r + s√k (r, s rational BigInt fractions, k squarefree) or a rational multiple of π. A value that doesn't
// fit (sin 1, ln 2, e) throws SKIP, a point where the expression is undefined throws NONE; both mean "not proven".
const SKIP = Symbol('skip'), NONE = Symbol('undefined'), CAP = 10n ** 400n;
const babs = v => v < 0n ? -v : v;
const gcd = (a, b) => { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; };
function q(n, d = 1n) {
  if (!d) throw NONE;
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d); n /= g; d /= g;
  if (babs(n) > CAP || d > CAP) throw SKIP;
  return { n, d };
}
const ZERO = q(0n), ONE = q(1n), HALF = q(1n, 2n);
const qadd = (a, b) => q(a.n * b.d + b.n * a.d, a.d * b.d), qmul = (a, b) => q(a.n * b.n, a.d * b.d), qdiv = (a, b) => q(a.n * b.d, a.d * b.n);
const qneg = a => ({ n: -a.n, d: a.d }), qsign = a => a.n > 0n ? 1 : a.n < 0n ? -1 : 0;
const num = (r, s = ZERO, k = 1n) => !s.n ? { r, s: ZERO, k: 1n } : k === 1n ? { r: qadd(r, s), s: ZERO, k: 1n } : { r, s, k };
const pim = p => p.n ? { pi: p } : num(ZERO);
const int = n => num(q(BigInt(n)));
const toNumber = x => { const f = r => Number(r.n) / Number(r.d); return x.pi ? f(x.pi) * Math.PI : f(x.r) + f(x.s) * Math.sqrt(Number(x.k)); };
function sgn(x) {
  if (x.pi) return qsign(x.pi);
  const a = qsign(x.r), b = qsign(x.s);
  if (!a || !b || a === b) return a || b;
  // r and s√k have opposite signs: the larger of r² and s²k wins (never equal, √k is irrational).
  return qsign(qadd(qmul(x.r, x.r), qneg(qmul(qmul(x.s, x.s), q(x.k))))) > 0 ? a : b;
}
const neg = x => x.pi ? pim(qneg(x.pi)) : num(qneg(x.r), qneg(x.s), x.k);
function add(x, y) {
  if (x.pi || y.pi) {
    if (x.pi && y.pi) return pim(qadd(x.pi, y.pi));
    if (!sgn(x.pi ? y : x)) return x.pi ? x : y;
    throw SKIP;
  }
  if (x.s.n && y.s.n && x.k !== y.k) throw SKIP;
  return num(qadd(x.r, y.r), qadd(x.s, y.s), x.s.n ? x.k : y.k);
}
function mul(x, y) {
  if (x.pi || y.pi) {
    const [p, o] = x.pi ? [x, y] : [y, x];
    if (o.pi || o.s.n) throw SKIP;
    return pim(qmul(p.pi, o.r));
  }
  if (x.s.n && y.s.n && x.k !== y.k) throw SKIP;
  const k = x.s.n ? x.k : y.k;
  return num(qadd(qmul(x.r, y.r), qmul(qmul(x.s, y.s), q(k))), qadd(qmul(x.r, y.s), qmul(x.s, y.r)), k);
}
function div(x, y) {
  if (x.pi && y.pi) return num(qdiv(x.pi, y.pi));
  if (y.pi) { if (!sgn(x)) return x; throw SKIP; }
  // 1/(r + s√k) = (r − s√k)/(r² − s²k); the denominator is 0 only when y = 0.
  const den = qadd(qmul(y.r, y.r), qneg(qmul(qmul(y.s, y.s), q(y.k))));
  return mul(x, num(qdiv(y.r, den), qneg(qdiv(y.s, den)), y.k));
}
const sub = (x, y) => add(x, neg(y));
// Equal, or certainly different: r + s√2 and r' + s'√3 with s, s' ≠ 0 are never equal, so SKIP means "different" here.
function eq(x, y) { try { return !sgn(sub(x, y)); } catch (e) { if (e === SKIP) return false; throw e; } }
function pow(x, e) {
  if (e.pi || e.s.n || e.r.d !== 1n || babs(e.r.n) > 10000n) throw SKIP;
  let m = babs(e.r.n), out = int(1), base = e.r.n < 0n ? div(int(1), x) : x;
  while (m) { if (m & 1n) out = mul(out, base); m >>= 1n; if (m) base = mul(base, base); }
  return out;
}
function floorX(x) {
  if (x.pi) throw SKIP;
  if (!x.s.n) { const { n, d } = x.r; return int(n / d - (n % d < 0n ? 1n : 0n)); } // BigInt / rounds toward 0
  const guess = Math.floor(toNumber(x)); if (!Number.isFinite(guess)) throw SKIP;
  let n = BigInt(guess);
  while (sgn(sub(x, int(n))) < 0) n--;
  while (sgn(sub(x, int(n + 1n))) >= 0) n++;
  return int(n);
}
function sqrtX(x) {
  if (x.pi || x.s.n) throw SKIP;
  if (x.r.n < 0n) throw NONE;
  // √(n/d) = √(nd)/d; split nd into square · squarefree by trial division.
  const m = x.r.n * x.r.d; if (m > 10n ** 10n) throw SKIP;
  let rest = Number(m), out = 1;
  for (let p = 2; p * p <= rest; p++) while (rest % (p * p) === 0) { rest /= p * p; out *= p; }
  return num(ZERO, q(BigInt(out), x.r.d), BigInt(rest));
}
// sin(mπ/12) where it has a closed form here: multiples of 30° and 45°.
function sinT(m) {
  m = ((m % 24) + 24) % 24;
  const v = [num(ZERO), , num(HALF), num(ZERO, HALF, 2n), num(ZERO, HALF, 3n), , int(1)][m % 12 > 6 ? 12 - m % 12 : m % 12];
  if (!v) throw SKIP;
  return m >= 12 ? neg(v) : v;
}
function twelfths(x) {
  if (!x.pi) { if (!sgn(x)) return 0; throw SKIP; }
  const t = x.pi.n * 12n; if (t % x.pi.d) throw SKIP;
  return Number((t / x.pi.d) % 24n);
}
const sinX = x => sinT(twelfths(x)), cosX = x => sinT(twelfths(x) + 6);
// Inverse trig: try each nice angle in the function's range.
function inverse(f, ms, v) {
  for (const m of ms) {
    let y; try { y = f(m); } catch (e) { if (e === SKIP || e === NONE) continue; throw e; }
    if (eq(y, v)) return pim(q(BigInt(m), 12n));
  }
  throw SKIP;
}
const absX = x => sgn(x) < 0 ? neg(x) : x;
const beyondOne = v => sgn(sub(absX(v), int(1))) > 0;
function logBase(base, v) {
  if (sgn(v) <= 0 || sgn(base) <= 0 || eq(base, int(1))) throw NONE;
  const n = Math.round(Math.log(toNumber(v)) / Math.log(toNumber(base)));
  if (Number.isFinite(n) && Math.abs(n) <= 1000 && eq(pow(base, int(n)), v)) return int(n);
  throw SKIP;
}
const EXACT_FN = {
  sin: sinX, cos: cosX, tan: x => div(sinX(x), cosX(x)), cot: x => div(cosX(x), sinX(x)), sec: x => div(int(1), cosX(x)), csc: x => div(int(1), sinX(x)),
  asin: v => { if (beyondOne(v)) throw NONE; return inverse(sinT, [-6, -4, -3, -2, 0, 2, 3, 4, 6], v); },
  acos: v => { if (beyondOne(v)) throw NONE; return inverse(m => sinT(m + 6), [0, 2, 3, 4, 6, 8, 9, 10, 12], v); },
  atan: v => inverse(m => div(sinT(m), sinT(m + 6)), [-4, -3, -2, 0, 2, 3, 4], v),
  acot: v => sub(pim(HALF), EXACT_FN.atan(v)),
  sqrt: sqrtX, root: (n, x) => { if (eq(n, int(2))) return sqrtX(x); throw SKIP; },
  abs: absX, sign: x => int(sgn(x)), floor: floorX, ceil: x => neg(floorX(neg(x))), round: x => floorX(add(x, num(HALF))),
  exp: x => { if (!sgn(x)) return int(1); throw SKIP; },
  ln: x => { if (sgn(x) <= 0) throw NONE; if (eq(x, int(1))) return int(0); throw SKIP; },
  log: (a, b) => b === undefined ? logBase(int(10), a) : logBase(a, b), log2: x => logBase(int(2), x),
  min: (...xs) => xs.reduce((a, b) => sgn(sub(b, a)) < 0 ? b : a), max: (...xs) => xs.reduce((a, b) => sgn(sub(b, a)) > 0 ? b : a),
  mod: (a, b) => sub(a, mul(b, floorX(div(a, b)))),
};
// Exact value of a decimal literal: "2,5", ".5", "1e-3".
function decimal(s) {
  const m = s.replace(',', '.').match(/^([+-]?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i);
  if (!m) throw SKIP;
  const e = BigInt(m[4] ?? 0) - BigInt(m[3].length), n = BigInt(`${m[1]}${m[2]}${m[3]}0`) / 10n;
  if (babs(e) > 400n) throw SKIP;
  return num(e < 0n ? q(n, 10n ** -e) : q(n * 10n ** e));
}
function evaluate(n, x, p) {
  const ev = m => evaluate(m, x, p);
  switch (n.t) {
    case 'num': return decimal(n.s);
    case 'x': return x;
    case 'const': if (n.n === 'pi') return pim(ONE); if (n.n === 'tau') return pim(q(2n)); if (n.n === 'phi') return num(HALF, HALF, 5n); throw SKIP;
    case 'param': return decimal(String(Object.hasOwn(p, n.n) ? p[n.n] : 1));
    case 'neg': return neg(ev(n.a));
    case '+': return add(ev(n.a), ev(n.b));
    case '-': return sub(ev(n.a), ev(n.b));
    case '*': return mul(ev(n.a), ev(n.b));
    case '/': return div(ev(n.a), ev(n.b));
    case '^': { const e = ev(n.b); if (n.a.t === 'const' && !sgn(e)) return int(1); return pow(ev(n.a), e); } // e⁰ = 1
    case '°': return mul(ev(n.a), pim(q(1n, 180n)));
    case '!': {
      const a = ev(n.a);
      if (a.pi || a.s.n || a.r.d !== 1n || a.r.n < 0n || a.r.n > 170n) throw SKIP;
      let r = 1n; for (let i = 2n; i <= a.r.n; i++) r *= i;
      return num(q(r));
    }
    case 'call': if (!EXACT_FN[n.n]) throw SKIP; return EXACT_FN[n.n](...n.args.map(ev));
  }
}
// Closed forms close to v worth checking: rationals (continued fractions), pπ/d, (p + s√k)/d.
function candidates(v) {
  const out = [], near = c => Math.abs(c - v) <= 1e-6 * Math.max(1, Math.abs(v));
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0, r = v;
  for (let i = 0; i < 40 && Number.isFinite(r); i++) {
    const a = Math.floor(r);
    [h0, h1, k0, k1] = [h1, a * h1 + h0, k1, a * k1 + k0];
    if (k1 > 10000 || !Number.isSafeInteger(h1)) break;
    if (near(h1 / k1)) out.push(num(q(BigInt(h1), BigInt(k1))));
    if (r === a) break;
    r = 1 / (r - a);
  }
  for (let d = 1; d <= 12; d++) { const p = Math.round(v / Math.PI * d); if (p && near(p * Math.PI / d)) out.push(pim(q(BigInt(p), BigInt(d)))); }
  for (const k of [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23, 26, 29, 30]) for (let d = 1; d <= 12; d++) for (let s = -12; s <= 12; s++) {
    const p = Math.round(v * d - s * Math.sqrt(k));
    if (s && Number.isSafeInteger(p) && near((p + s * Math.sqrt(k)) / d)) out.push(num(q(BigInt(p), BigInt(d)), q(BigInt(s), BigInt(d)), BigInt(k)));
  }
  return out;
}
// Text of a closed form, or null when it would read worse than a decimal.
function show(x) {
  const small = (...ns) => ns.every(n => babs(n) <= 10n ** 12n);
  const times = (n, unit) => `${babs(n) === 1n && unit ? '' : babs(n)}${unit}`;
  const sign = n => n < 0n ? '−' : '';
  if (x.pi) { const { n, d } = x.pi; return d <= 1000n && small(n) ? `${sign(n)}${times(n, 'π')}${d > 1n ? `/${d}` : ''}` : null; }
  const D = x.r.d * x.s.d / gcd(x.r.d, x.s.d), A = x.r.n * D / x.r.d, B = x.s.n * D / x.s.d;
  if (D > 1000n || !small(A, B)) return null;
  if (!B) return `${sign(A)}${babs(A)}${D > 1n ? `/${D}` : ''}`;
  const root = times(B, `√${x.k}`);
  if (!A) return `${sign(B)}${root}${D > 1n ? `/${D}` : ''}`;
  const body = `${sign(A)}${babs(A)} ${B < 0n ? '−' : '+'} ${root}`;
  return D > 1n ? `(${body})/${D}` : body;
}
function attempt(f) { try { return f(); } catch (e) { if (e === SKIP || e === NONE) return e; throw e; } }
// Proven point near x where all the given expressions take the same value (for a root, pass the function and '0').
// ponytail: accepts a closed form within 1e-6 of x; two different roots closer than that could swap labels.
export function exactPoint(inputs, parameters, x) {
  const trees = inputs.map(parse);
  for (const c of candidates(x)) {
    const ys = attempt(() => trees.map(t => evaluate(t, c, parameters)));
    if (Array.isArray(ys) && ys.every(y => eq(y, ys[0]))) return { x: show(c), y: show(ys[0]) };
  }
  return null;
}
// f(x) at a decimal x: closed form, null if it can't be proven, undefined if f isn't defined there.
export function exactValue(input, parameters, x) {
  const y = attempt(() => evaluate(parse(input), decimal(String(x)), parameters));
  return y === NONE ? undefined : y === SKIP ? null : show(y);
}
