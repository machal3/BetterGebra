const funcs = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil };
function tokenize(input) {
  const source = input.toLowerCase().replace(/^\s*y\s*=/, '').replace(/π/g, 'pi').replace(/²/g, '^2').replace(/³/g, '^3').replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/').trim();
  if (!source || source.length > 300) throw Error('Wpisz funkcję, np. x^2 lub sin(x).');
  const tokens = source.match(/(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?|[a-z]+|[+\-*/^()]/g) || [];
  if (tokens.join('') !== source.replace(/\s/g, '')) throw Error('Nieznany znak. Użyj liter, liczb i działań matematycznych.');
  // Accept the common shorthand ax, while keeping unknown function names invalid.
  return tokens.flatMap(t => /^[a-z]x$/.test(t) ? [...t] : [t]);
}
export function parameterNames(input) {
  if (!input.trim()) return [];
  return [...new Set(tokenize(input).filter(t => /^[a-z]$/.test(t) && !['x', 'e'].includes(t)))].sort();
}
export function compile(input, parameters = {}) {
  const tokens = tokenize(input);
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  function atom() {
    const t = take();
    if (t === '(') { const expr = sum(); if (take() !== ')') throw Error('Brakuje zamykającego nawiasu.'); return expr; }
    if (t === 'x') return x => x;
    if (t === 'pi') return () => Math.PI;
    if (t === 'e') return () => Math.E;
    if (t && /^[a-z]$/.test(t)) return () => Object.hasOwn(parameters, t) ? parameters[t] : 1;
    if (Object.hasOwn(funcs, t)) { if (take() !== '(') throw Error(`Zapisz ${t}(x), używając nawiasów.`); const arg = sum(); if (take() !== ')') throw Error('Brakuje zamykającego nawiasu.'); return x => funcs[t](arg(x)); }
    if (t && !Number.isNaN(Number(t))) return () => Number(t);
    throw Error(t ? `Nie rozpoznaję „${t}”. Sprawdź zapis funkcji.` : 'Uzupełnij wyrażenie.');
  }
  function power() { const left = atom(); if (peek() === '^') { take(); const right = unary(); return x => left(x) ** right(x); } return left; }
  function unary() { if (peek() === '+') { take(); return unary(); } if (peek() === '-') { take(); const expr = unary(); return x => -expr(x); } return power(); }
  function product() {
    let left = unary();
    while (peek() === '*' || peek() === '/' || (peek() && !['+', '-', ')', '^'].includes(peek()))) {
      const op = ['*', '/'].includes(peek()) ? take() : '*'; const a = left, b = unary(); left = op === '*' ? x => a(x) * b(x) : x => a(x) / b(x);
    } return left;
  }
  function sum() { let left = product(); while (peek() === '+' || peek() === '-') { const op = take(), a = left, b = product(); left = op === '+' ? x => a(x) + b(x) : x => a(x) - b(x); } return left; }
  const fn = sum(); if (i !== tokens.length) throw Error('Sprawdź nawiasy w wyrażeniu.'); return fn;
}
export function roots(fn, min, max) {
  const found = []; const add = x => { if (Number.isFinite(fn(x)) && Math.abs(fn(x)) < 1e-6 && !found.some(r => Math.abs(r - x) < 1e-4)) found.push(x); };
  const step = (max - min) / 2000;
  for (let i = 0; i <= 2000; i++) {
    const x = min + i * step, y = fn(x); if (Math.abs(y) < 1e-8) add(x);
    if (i && y * fn(x - step) < 0) { let a = x - step, b = x; for (let j = 0; j < 45; j++) { const m = (a + b) / 2; if (fn(a) * fn(m) <= 0) b = m; else a = m; } add((a + b) / 2); }
    if (found.length >= 20) break;
  } return found;
}
