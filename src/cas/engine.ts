/**
 * The calculator: one line of input → a list of result cards ("pods"), like a computational search engine.
 * Plain expressions get their exact value, decimal digits and properties; equations their solutions; commands
 * (Polish or English, with or without parentheses) their own cards. Everything here runs in the worker.
 */
import './functions';
import { bfSign, bfToNumber } from './bigfloat';
import { diff, diffN, limit, Lim, taylor } from './calculus';
import { Env, Value, evaluate, ex, scalar, setInverse, dims, matMul } from './evaluate';
import { Expr, I, INF, ONE, TWO, ZERO, add, div, expand, fn, freeOf, infSign, isConstant, isInt, isNum, isSym, isZero, mul, neg, num, numDen, pow, same, size, sqrt, sub, subst, sym, together, variables, isFn } from './expr';
import { compileDouble } from './fast';
import { matrixTable, systemML, toML, toText } from './format';
import { complexParts, constSign, binomialBig } from './functions';
import { definite, integrate, partialFractions } from './integrate';
import * as LA from './matrix';
import * as MS from './matsteps';
import type { Step } from './matsteps';
import { nodeML } from './nodeformat';
import * as NT from './ntheory';
import { Decimal } from './bigfloat';
import { C, approx, evalC, numericValue } from './numeric';
import { COMMANDS, Node, parse } from './parse';
import { sugar } from './sugar';
export { sugar };
import { coeffsOf, polyOf, polyToExpr, pdivmod, pgcd, solvePoly, P, deg } from './poly';
import { CasError, Q, fail, q, qsign, qabs, qfloor, qsub, bitLength, gcd as bgcd } from './q';
import { cancel, expandLog, factorExpr, simplify, trigExpand, trigLinearize } from './simplify';
import { Interval, LinearInfo, Sol, domain, setDomainText, solveEquation, solveInequality, solveSystem, intersect } from './solve';
import { product as prodOf, sum as sumOf, ratioHint } from './sums';
import { type HandoffRow, type MarkKind, type Plot, argandPlot, combine, curveRow, features, fmt, graphText, implicitPlot, matrixPlot, parametricSeries, plotOf, regionPlot, rootsPlot, sequencePlot, statsPlot, zText } from './plot';
export type { Bar, Fill, Handoff, HandoffRow, Mark, MarkKind, PanelMode, Plot, Ref, Series, Shape, Vector } from './plot';

setInverse(LA.inverse);
setDomainText(toText);

// --- Result shape (plain JSON: crosses the worker boundary) ---

export interface Row { ml: string; text: string; note?: string }
/** `steps`: a worked solution, shown folded under the card's rows. */
export interface Pod { title: string; rows: Row[]; note?: string; plot?: Plot; more?: { label: string; query: string }; steps?: Step[] }
export type { Step };
export interface Result { input: Row | null; pods: Pod[]; error?: string; ans?: string; interpreted?: string }

const M = (inner: string) => `<math display="block">${inner}</math>`;
// parentheses at their natural size: f(x) next to a tall fraction must not stretch
const mo = (s: string) => s === '(' || s === ')' ? `<mo stretchy="false">${s}</mo>` : `<mo>${s}</mo>`;
/** −∞ / +∞ as one tight symbol. */
const INF_ML = (sign: string) => `<mrow><mo form="prefix" lspace="0" rspace="0">${sign}</mo><mi>∞</mi></mrow>`;
const mi = (s: string) => `<mi>${s}</mi>`;
const mtext = (s: string) => `<mtext>${s.replace(/[&<>]/g, c => `&#${c.charCodeAt(0)};`)}</mtext>`;
const row = (e: Expr, note?: string): Row => ({ ml: M(toML(e)), text: toText(e), note });
const eqRow = (lhsML: string, lhsText: string, e: Expr, note?: string): Row => ({ ml: M(`${lhsML}${mo('=')}${toML(e)}`), text: `${lhsText} = ${toText(e)}`, note });
const textRow = (s: string): Row => ({ ml: M(mtext(s)), text: s });

let digitsDefault = 25;

// --- Entry ---

export interface RunOptions { digits?: number; ans?: string | null }

export function run(rawInput: string, opts: RunOptions = {}): Result {
  digitsDefault = Math.min(5000, Math.max(5, opts.digits ?? 25));
  let ans: Expr | null = null;
  if (opts.ans) { try { ans = scalar(evaluate(parse(opts.ans), baseEnv(null)), 'ans'); } catch { ans = null; } }
  const env = baseEnv(ans);
  const interpreted = sugar(rawInput);
  let node: Node;
  try { node = parse(interpreted); } catch (err) { return { input: null, pods: [], error: message(err), interpreted }; }
  const input: Row = { ml: nodeML(node), text: rawInput };
  try {
    const { pods, value } = top(node, env);
    const ansText = value && value.t === 'expr' ? toText(value.e) : undefined;
    return { input, pods, ans: ansText, interpreted: interpreted !== rawInput.trim() ? interpreted : undefined };
  } catch (err) {
    return { input, pods: [], error: message(err), interpreted };
  }
}
const message = (err: unknown) => err instanceof CasError ? err.message : `Błąd wewnętrzny: ${(err as Error)?.message ?? String(err)}`;

function baseEnv(ans: Expr | null): Env {
  return { ans, command: (name, args, env) => { const r = command(name, args, env); if (!r.value) fail(`Polecenia ${name} nie można użyć wewnątrz wyrażenia.`); return r.value!; } };
}

interface Out { pods: Pod[]; value?: Value }

function top(node: Node, env: Env): Out {
  if (node.t === 'call' && Object.hasOwn(COMMANDS, node.n)) return command(node.n, node.args, env);
  if (node.t === 'rel') return relation(node, env, null);
  if (node.t === 'list' && node.items.length && node.items.every(i => i.t === 'rel')) return system(node.items, env, null);
  const v = evaluate(node, env);
  return valuePods(v);
}

function valuePods(v: Value): Out {
  switch (v.t) {
    case 'expr': return { pods: isConstant(v.e) ? numberPods(v.e) : expressionPods(v.e), value: v };
    case 'matrix': return { pods: matrixPods(v.rows), value: v };
    case 'list': return { pods: listPods(v), value: v };
    case 'rel': return fail('Nieoczekiwane równanie.');
  }
}

// --- Decimal numbers ---

function decimalText(d: Decimal | null, exact = false): { text: string; ml: string } {
  if (!d) return { text: '0', ml: '<mn>0</mn>' };
  let digits = d.digits;
  if (exact) digits = digits.replace(/0+$/, '') || '0';
  const sign = d.neg ? '−' : '', E_ = d.exp10;
  const group = (s: string) => s.replace(/(\d{5})(?=\d)/g, '$1 ');
  if (E_ >= -6 && E_ < 24) {
    let int: string, frac: string;
    if (E_ >= 0) { int = digits.slice(0, E_ + 1).padEnd(E_ + 1, '0'); frac = digits.slice(E_ + 1); }
    else { int = '0'; frac = '0'.repeat(-E_ - 1) + digits; }
    const intG = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return { text: `${sign}${int}${frac ? '.' + frac : ''}`, ml: `${d.neg ? mo('−') : ''}<mn>${intG}${frac ? ',' + group(frac) : ''}</mn>` };
  }
  const mant = digits.length > 1 ? `${digits[0]},${group(digits.slice(1))}` : digits;
  return {
    text: `${sign}${digits[0]}${digits.length > 1 ? '.' + digits.slice(1) : ''}e${E_}`,
    ml: `${d.neg ? mo('−') : ''}<mn>${mant}</mn>${mo('·')}<msup><mn>10</mn><mn>${E_}</mn></msup>`,
  };
}

/** ≈ value of a constant: a row with correct digits only. */
function decimalRow(e: Expr, digits = digitsDefault): Row | null {
  let v;
  try { v = numericValue(e, digits); } catch { return null; }
  // a rational part is printed without its trailing zeros (0,5 not 0,500…)
  const parts = complexParts(e);
  const reExact = !!parts && isNum(parts[0]), imExact = !!parts && isNum(parts[1]);
  const re = v.re ? decimalText(v.re, reExact) : null, im = v.im ? decimalText({ ...v.im, neg: false }, imExact) : null;
  if (!re && !im) return { ml: M(`${mo('≈')}<mn>0</mn>`), text: '0', note: v.reZeroBelow ? `|wartość| < 10^−${v.reZeroBelow}` : undefined };
  let ml = '', text = '';
  if (re) { ml += re.ml; text += re.text; }
  if (im) {
    ml += re ? mo(v.im!.neg ? '−' : '+') : v.im!.neg ? mo('−') : '';
    ml += `${im.ml}${mi('i')}`;
    text += `${re ? (v.im!.neg ? ' − ' : ' + ') : v.im!.neg ? '−' : ''}${im.text}i`;
  }
  const notes: string[] = [];
  if (v.reZeroBelow && im) notes.push(`część rzeczywista: |Re| < 10^−${v.reZeroBelow}`);
  if (v.imZeroBelow && re) notes.push(`część urojona: |Im| < 10^−${v.imZeroBelow}`);
  return { ml: M(`${mo('≈')}${ml}`), text, note: notes.join('; ') || undefined };
}
const shortApprox = (e: Expr): string => {
  try {
    const v = numericValue(e, 12);
    const p = (d: Decimal | null) => decimalText(d).text.replace('.', ',');
    if (v.im) return `≈ ${v.re ? p(v.re) + (v.im.neg ? ' − ' : ' + ') : v.im.neg ? '−' : ''}${p({ ...v.im, neg: false })}i`;
    return `≈ ${p(v.re)}`;
  } catch { return ''; }
};
const isRationalE = (e: Expr) => isNum(e);

// --- Numbers ---

function numberPods(e0: Expr): Pod[] {
  const pods: Pod[] = [];
  if (isInf(e0)) return [{ title: 'Wynik', rows: [row(e0)] }];
  const s0 = safe(() => simplify(e0));
  const e = s0 && size(s0) < size(e0) ? s0 : e0;
  const parts = complexParts(e);
  const isComplex = parts && !isZero(parts[1]);
  pods.push({ title: 'Wynik', rows: [row(e)] });
  if (isNum(e)) {
    if (e.v.d === 1n) pods.push(...integerPods(e.v.n));
    else pods.push(...rationalPods(e.v));
    return pods;
  }
  const s = simplify(e);
  if (!same(s, e) && size(s) < size(e)) pods.push({ title: 'Postać uproszczona', rows: [row(s)] });
  const d = decimalRow(e);
  if (d) pods.push({ title: 'Postać dziesiętna', rows: [d], more: { label: 'Więcej cyfr', query: `N(${toText(e)}, ${Math.min(5000, digitsDefault * 4)})` } });
  if (isComplex && parts) pods.push(...complexPods(e, parts));
  else if (d) {
    const cf = numericContinuedFraction(e, 14);
    if (cf) pods.push({ title: 'Ułamek łańcuchowy', rows: [cf] });
  }
  return pods;
}

function complexPods(e: Expr, [a, b]: [Expr, Expr]): Pod[] {
  const pods: Pod[] = [];
  const r = simplify(sqrt(add(pow(a, TWO), pow(b, TWO))));
  let phi: Expr | null = null;
  try { phi = fn('arg', e); if (isFn(phi, 'arg')) phi = null; } catch { phi = null; }
  pods.push({ title: 'Postać algebraiczna', rows: [eqRow(mi('z'), 'z', add(a, mul(b, I)))] });
  pods.push({ title: 'Moduł i argument', rows: [eqRow(`<mo stretchy="false" lspace="0" rspace="0">|</mo>${mi('z')}<mo stretchy="false" lspace="0" rspace="0">|</mo>`, '|z|', r, isRationalE(r) ? undefined : shortApprox(r)), ...(phi ? [eqRow(`<mi mathvariant="normal">arg</mi><mspace width="0.17em"/>${mi('z')}`, 'arg z', phi, isRationalE(phi) ? undefined : shortApprox(phi))] : [])] });
  if (phi) {
    const rML = isOneE(r) ? '' : toML(r), rText = isOneE(r) ? '' : `${toText(r)}·`;
    pods.push({
      title: 'Postać trygonometryczna i wykładnicza',
      rows: [
        { ml: M(`${mi('z')}${mo('=')}${rML}<mrow>${mo('(')}<mi mathvariant="normal">cos</mi>${wrapArg(phi)}${mo('+')}${mi('i')}<mi mathvariant="normal">sin</mi>${wrapArg(phi)}${mo(')')}</mrow>`), text: `z = ${rText}(cos(${toText(phi)}) + i·sin(${toText(phi)}))` },
        { ml: M(`${mi('z')}${mo('=')}${rML}<msup>${mi('e')}<mrow>${mi('i')}${toML(phi)}</mrow></msup>`), text: `z = ${rText}e^(i·${toText(phi)})` },
      ],
    });
  }
  pods.push({ title: 'Sprzężenie', rows: [eqRow(`<mover>${mi('z')}${mo('‾')}</mover>`, 'z̄', sub(a, mul(b, I)))] });
  const A = approx(a).re, B = approx(b).re;
  if (Number.isFinite(A) && Number.isFinite(B)) pods.push({ title: 'Płaszczyzna zespolona', rows: [], plot: argandPlot(A, B, { z: toText(e), conj: toText(sub(a, mul(b, I))), r: toText(r) }) });
  return pods;
}
const wrapArg = (e: Expr) => `${mo('(')}${toML(e)}${mo(')')}`;

function integerPods(n: bigint): Pod[] {
  const pods: Pod[] = [];
  const an = n < 0n ? -n : n;
  const digitsCount = an.toString().length;
  if (an > 1n) {
    const f = NT.factorInteger(an, 2_000_000);
    const isPrime = f.factors.length === 1 && f.factors[0][1] === 1 && !f.unfactored.length;
    const terms = f.factors.map(([p, e]) => (e > 1 ? `<msup><mn>${p}</mn><mn>${e}</mn></msup>` : `<mn>${p}</mn>`));
    const textTerms = f.factors.map(([p, e]) => (e > 1 ? `${p}^${e}` : `${p}`));
    for (const u of f.unfactored) { terms.push(`<mn>${u}</mn>`); textTerms.push(`${u}`); }
    const notes: string[] = [];
    if (f.unfactored.length) notes.push('Ostatni czynnik jest złożony, ale nie udało się go rozłożyć w limicie czasu.');
    if (f.probable.length) notes.push('Czynniki większe od 3,3·10²⁴ są pierwsze według testu BPSW (nie znaleziono dotąd liczby, która by go oszukała).');
    pods.push({
      title: isPrime ? 'Liczba pierwsza' : 'Rozkład na czynniki pierwsze',
      rows: [{ ml: M(`${n < 0n ? `${mo('−')}` : ''}${terms.join(mo('·'))}`), text: `${n < 0n ? '−' : ''}${textTerms.join(' · ')}` }],
      note: notes.join(' ') || (isPrime ? `${an} jest liczbą pierwszą.` : undefined),
    });
    // properties
    const props: string[] = [n % 2n ? 'nieparzysta' : 'parzysta'];
    if (!isPrime && !f.unfactored.length) props.push('złożona');
    if (!f.unfactored.length && f.factors.length) {
      const g = f.factors.reduce((acc, [, e]) => { let a = acc, b = e; while (b) [a, b] = [b, a % b]; return a; }, 0);
      if (g > 1) props.push(`potęga: ${f.factors.reduce((acc, [p, e]) => acc * p ** BigInt(e / g), 1n)}^${g}`);
    }
    if (!f.unfactored.length && an < 10n ** 30n) {
      const sig = f.factors.reduce((s, [p, e]) => s * ((p ** BigInt(e + 1) - 1n) / (p - 1n)), 1n);
      if (sig === 2n * an) props.push('doskonała');
      const tau = f.factors.reduce((s, [, e]) => s * BigInt(e + 1), 1n);
      const phi = f.factors.reduce((s, [p, e]) => s * (p - 1n) * p ** BigInt(e - 1), 1n);
      pods.push({
        title: 'Dzielniki',
        rows: [
          { ml: M(`<mi>τ</mi>${mo('(')}<mn>${an}</mn>${mo(')')}${mo('=')}<mn>${tau}</mn>`), text: `liczba dzielników: ${tau}` },
          { ml: M(`<mi>σ</mi>${mo('(')}<mn>${an}</mn>${mo(')')}${mo('=')}<mn>${sig}</mn>`), text: `suma dzielników: ${sig}` },
          { ml: M(`<mi>φ</mi>${mo('(')}<mn>${an}</mn>${mo(')')}${mo('=')}<mn>${phi}</mn>`), text: `funkcja Eulera: ${phi}` },
          ...(tau <= 64n ? [{ ml: M(mtext(NT.divisors(an).join(', '))), text: NT.divisors(an).join(', ') }] : []),
        ],
      });
    }
    pods.push({ title: 'Własności', rows: [textRow(props.join(', '))] });
  }
  if (digitsCount > 6) pods.push({ title: 'Liczba cyfr', rows: [textRow(`${digitsCount}`)] });
  if (an < 1n << 512n) {
    pods.push({
      title: 'W innych systemach',
      rows: [[2, 'dwójkowym'], [8, 'ósemkowym'], [16, 'szesnastkowym']].map(([b, name]) => {
        const s = NT.toBase(n, b as number);
        return { ml: M(`<msub><mn>${s}</mn><mn>${b}</mn></msub>`), text: s, note: `w systemie ${name}` };
      }),
    });
  }
  return pods;
}

function rationalPods(v: Q): Pod[] {
  const pods: Pod[] = [];
  const a = qabs(v), whole = qfloor(a);
  if (whole > 0n) {
    const rest = qsub(a, q(whole));
    pods.push({ title: 'Liczba mieszana', rows: [{ ml: M(`${v.n < 0n ? mo('−') : ''}<mn>${whole}</mn><mfrac><mn>${rest.n}</mn><mn>${rest.d}</mn></mfrac>`), text: `${v.n < 0n ? '−' : ''}${whole} ${rest.n}/${rest.d}` }] });
  }
  const ex_ = NT.decimalExpansion(v, 10, 3000);
  if (ex_.periodLength !== null) {
    const frac = ex_.period ? `${ex_.pre}(${ex_.period})` : ex_.pre;
    const ml = `<mn>${ex_.int.replace('−', '')},${ex_.pre}</mn>${ex_.period ? `${mo('(')}<mn>${ex_.period}</mn>${mo(')')}` : ''}`;
    pods.push({
      title: ex_.period ? 'Rozwinięcie dziesiętne okresowe' : 'Rozwinięcie dziesiętne',
      rows: [{ ml: M(`${ex_.int.startsWith('−') ? mo('−') : ''}${ml}`), text: `${ex_.int},${frac}`, note: ex_.period ? `okres długości ${ex_.period.length}` : 'skończone' }],
    });
  } else {
    const d = decimalRow(num(v));
    if (d) pods.push({ title: 'Postać dziesiętna', rows: [d], note: 'Okres ma ponad 3000 cyfr.' });
  }
  const cf = NT.continuedFraction(v);
  pods.push({ title: 'Ułamek łańcuchowy', rows: [cfRow(cf, false)] });
  return pods;
}
function cfRow(a: bigint[], open: boolean): Row {
  const head = a[0], rest = a.slice(1);
  return { ml: M(`${mo('[')}<mn>${head}</mn>${rest.length ? mo(';') + rest.map(x => `<mn>${x}</mn>`).join(mo(',')) : ''}${open ? mo(',') + mo('…') : ''}${mo(']')}`), text: `[${head}${rest.length ? '; ' + rest.join(', ') : ''}${open ? ', …' : ''}]` };
}
/** Terms of the continued fraction that agree at two precisions. */
function numericContinuedFraction(e: Expr, max: number): Row | null {
  const at = (bits: number) => {
    const z = evalC(e, bits);
    if (z.im.m) return null;
    const out: bigint[] = [];
    let x = z.re; // walk with exact rationals from the BigFloat
    let n = x.e >= 0 ? x.m << BigInt(x.e) : x.m, d = x.e >= 0 ? 1n : 1n << BigInt(-x.e);
    for (let k = 0; k < max + 2 && d; k++) {
      let a = n / d;
      if (n % d && (n < 0n) !== (d < 0n)) a--;
      out.push(a);
      [n, d] = [d, n - a * d];
    }
    void x;
    return out;
  };
  try {
    const a = at(300), b = at(500);
    if (!a || !b) return null;
    const common: bigint[] = [];
    for (let k = 0; k < Math.min(a.length, b.length, max); k++) { if (a[k] !== b[k]) break; common.push(a[k]); }
    if (common.length < 3) return null;
    return cfRow(common, true);
  } catch { return null; }
}

// --- Expressions with variables ---

function mainVar(e: Expr, hint?: string | null): string {
  if (hint) return hint;
  const vs = variables(e).filter(v => v !== 'k' || variables(e).length === 1);
  if (!vs.length) return 'x';
  if (vs.includes('x')) return 'x';
  if (vs.length === 1) return vs[0];
  for (const v of ['t', 'z', 'y']) if (vs.includes(v)) return v;
  return vs[0];
}

function expressionPods(e: Expr): Pod[] {
  const pods: Pod[] = [];
  const vs = variables(e);
  const x = mainVar(e);
  const X = sym(x);
  const forms: [string, Expr][] = [];
  const s = safe(() => simplify(e));
  if (s && !same(s, e)) forms.push(['Postać uproszczona', s]);
  const best = s ?? e;
  pods.push({ title: 'Wynik', rows: [row(e)] });
  const ex_ = safe(() => expand(e));
  if (ex_ && !same(ex_, e) && !same(ex_, best) && size(ex_) < 400) forms.push(['Postać rozwinięta', ex_]);
  const fa = safe(() => factorExpr(e));
  if (fa && !same(fa.e, e) && !same(fa.e, best) && !(ex_ && same(fa.e, ex_))) forms.push(['Postać iloczynowa', fa.e]);
  const tg = safe(() => cancel(together(e)));
  if (tg && !forms.some(([, f]) => same(f, tg)) && !same(tg, e) && numDen(tg)[1].k !== 'n') forms.push(['Wspólny mianownik', tg]);
  for (const [t, f] of forms) pods.push({ title: t, rows: [row(f)] });
  if (vs.length === 1) {
    const plot = safe(() => plotOf([best], x, { at: interestingPoints(best, x).map(v => ({ x: v, kind: 'zero' as const })), find: [['zero', 'max', 'min', 'inflection']], labels: [`y = ${toText(best)}`] }));
    if (plot && x === 'z') {
      // z names a complex variable: the whole plane, coloured by f(z), is in Zespolone
      const t = zText(best, 'z');
      if (t) plot.open = { mode: 'complex', rows: [{ expr: t, series: 0, color: 0 }] };
    }
    if (plot) pods.push({ title: x === 'z' ? 'Wykres dla rzeczywistych z' : 'Wykres', rows: [], plot, note: plot?.open?.mode === 'complex' ? 'Całą płaszczyznę zespoloną, z kolorem według f(z), pokazują Zespolone.' : undefined });
    const d = safe(() => simplify(diff(e, x)));
    if (d) pods.push({ title: 'Pochodna', rows: [eqRow(derivML(x, `<mrow>${mo('(')}${toML(e)}${mo(')')}</mrow>`), `d/d${x} (${toText(e)})`, polyForm(d, x))] });
    const F = size(e) < 200 ? safe(() => integrate(e, x)) : null;
    if (F) { const G = antiderivativeForm(simplify(F), x); pods.push({ title: 'Całka nieoznaczona', rows: [{ ml: M(`${mo('∫')}${toML(e)}<mspace width="0.17em"/><mi mathvariant="normal">d</mi>${mi(x)}${mo('=')}${toML(G)}${mo('+')}<mi>C</mi>`), text: `${toText(G)} + C` }] }); }
    const z = safe(() => solveEquation(e, x));
    if (z && z.kind === 'list') {
      const real = z.sols.filter(s => !s.approx || isRealSol(s));
      if (real.length) pods.push({ title: 'Miejsca zerowe', rows: solutionRows(real.slice(0, 16), x), note: z.note ?? (real.length > 16 ? `Pokazano 16 z ${real.length}.` : undefined) });
    }
    const dom = safe(() => domain(e, x));
    if (dom && !(dom.parts.length === 1 && !dom.parts[0].lo && !dom.parts[0].hi)) pods.push({ title: 'Dziedzina', rows: [intervalRow(dom.parts, x)], note: dom.note });
    else if (dom?.note) pods.push({ title: 'Dziedzina', rows: [intervalRow(dom.parts, x)], note: dom.note });
    if (!polyOf(e, x)) {
      const t = safe(() => taylor(e, x, ZERO, 5));
      if (t && t.terms.length) pods.push({ title: `Szereg Taylora w ${x} = 0`, rows: [seriesRow(t.terms, X, 6, ZERO)] });
    }
  } else if (vs.length >= 2 && vs.length <= 4) {
    const rows: Row[] = [];
    for (const v of vs) {
      const d = safe(() => simplify(diff(e, v)));
      if (d) rows.push({ ml: M(`<mfrac><mo>∂</mo><mrow><mo>∂</mo>${mi(v)}</mrow></mfrac>${mo('=')}${toML(d)}`), text: `∂/∂${v}: ${toText(d)}` });
    }
    if (rows.length) pods.push({ title: 'Pochodne cząstkowe', rows });
  }
  return pods;
}
/** Polynomials read best expanded: x³/3 − 5x²/2 + 6x rather than x(2x² − 15x + 36)/6. */
function polyForm(e: Expr, x: string): Expr {
  const p = safe(() => polyOf(e, x));
  return p ? polyToExpr(p, sym(x)) : e;
}
/** An antiderivative that is a polynomial: expanded and without its constant term, unless it is c·(ax + b)ⁿ. */
function antiderivativeForm(F: Expr, x: string): Expr {
  const lin = (b: Expr) => { const c = coeffsOf(b, x, 1); return !!c && c.length === 2; };
  if (F.k === '*' && F.t.length === 2 && isNum(F.t[0]) && F.t[1].k === '^' && lin(F.t[1].b)) return F;
  if (F.k === '^' && lin(F.b)) return F;
  const p = safe(() => polyOf(F, x));
  if (!p) return F;
  return polyToExpr(p.map((c, k) => (k ? c : q(0))), sym(x));
}
function safe<T>(f: () => T): T | null {
  try { return f(); } catch (err) { if (err instanceof CasError || err instanceof RangeError) return null; throw err; }
}
const derivML = (x: string, body: string, k?: number) =>
  k && k > 1 ? `<mfrac><msup><mi mathvariant="normal">d</mi><mn>${k}</mn></msup><mrow><mi mathvariant="normal">d</mi><msup>${mi(x)}<mn>${k}</mn></msup></mrow></mfrac>${body}` : `<mfrac><mi mathvariant="normal">d</mi><mrow><mi mathvariant="normal">d</mi>${mi(x)}</mrow></mfrac>${body}`;
const isRealSol = (s: Sol) => !s.approx || !s.approx.im.m || bfToNumber(s.approx.im) === 0 || Math.abs(bfToNumber(s.approx.im)) < 1e-30 * Math.max(1, Math.abs(bfToNumber(s.approx.re)));

/** Sum shown by rising powers, with + O(xⁿ). */
function seriesRow(all: Expr[], X: Expr, order: number, at: Expr): Row {
  const terms = all.filter(t => !isZero(t));
  if (!terms.length) terms.push(ZERO);
  const base = isZero(at) ? X : sub(X, at);
  const ml = terms.map((t, k) => {
    const m = toML(t);
    if (k === 0) return m;
    return t.k === '*' && t.t[0].k === 'n' && qsign(t.t[0].v) < 0 ? `${mo('−')}${toML(neg(t))}` : `${mo('+')}${m}`;
  }).join('');
  const big = `${mo('+')}<mi mathvariant="script">O</mi>${mo('(')}<msup>${isZero(at) ? toML(X) : `<mrow>${mo('(')}${toML(base)}${mo(')')}</mrow>`}<mn>${order}</mn></msup>${mo(')')}`;
  return { ml: M(`${ml}${big}`), text: terms.map(toText).join(' + ').replace(/\+ −/g, '− ') + ` + O(${toText(pow(base, num(order)))})` };
}

// --- Solutions ---

function solutionRows(sols: Sol[], x: string): Row[] {
  return sols.map(s => {
    const lhs = mi(x);
    if (s.exact) {
      const e = s.exact;
      const fam = s.family;
      const shown = fam ? familyOrder(e) : toML(e);
      const famML = fam ? `${mo(',')}<mspace width="0.4em"/>${mi('k')}${mo('∈')}<mi mathvariant="normal">ℤ</mi>${s.excludeK?.length ? `${mo('∖')}${mo('{')}${s.excludeK.map(k => k < 0n ? `${mo('−')}<mn>${-k}</mn>` : `<mn>${k}</mn>`).join(mo(','))}${mo('}')}` : ''}` : '';
      const note = [s.mult > 1 ? `pierwiastek ${s.mult}-krotny` : '', !fam && !isNum(e) && isConstant(e) ? shortApprox(e) : ''].filter(Boolean).join(', ');
      return { ml: M(`${lhs}${mo('=')}${shown}${famML}`), text: `${x} = ${toText(e)}${fam ? `, k ∈ ℤ${s.excludeK?.length ? ` ∖ {${s.excludeK.map(k => String(k).replace('-', '−')).join(', ')}}` : ''}` : ''}`, note: note || undefined };
    }
    const z = s.approx!;
    const d = complexDecimal(z, 20);
    return { ml: M(`${lhs}${mo('≈')}${d.ml}`), text: `${x} ≈ ${d.text}`, note: s.mult > 1 ? `pierwiastek ${s.mult}-krotny` : undefined };
  });
}
/** π/6 + 2kπ: the k terms last. */
function familyOrder(e: Expr): string {
  if (e.k !== '+') return toML(e);
  const withK = e.t.filter(t => !freeOf(t, 'k')), rest = e.t.filter(t => freeOf(t, 'k'));
  const ml = [...rest, ...withK].map((t, i) => {
    const neg_ = t.k === '*' && t.t[0].k === 'n' && qsign(t.t[0].v) < 0;
    if (i === 0) return toML(t);
    return neg_ ? `${mo('−')}${toML(neg(t))}` : `${mo('+')}${toML(t)}`;
  }).join('');
  return `<mrow>${ml}</mrow>`;
}
function complexDecimal(z: C, digits: number): { ml: string; text: string } {
  const re = Math.abs(bfToNumber(z.re)) > 0 ? z.re : null;
  const tiny = (v: typeof z.im) => !v.m || (re && bfToNumber(v) !== 0 && Math.abs(bfToNumber(v)) < 1e-40 * Math.abs(bfToNumber(re)));
  const fmt = (b: typeof z.re) => {
    const n = bfToNumber(b);
    if (!b.m) return decimalText(null);
    // a BigFloat refined well beyond `digits`: print by the exact rational
    const dec = numericValue(num(b.e >= 0 ? q(b.m << BigInt(b.e)) : q(b.m, 1n << BigInt(-b.e))), digits).re;
    void n;
    return decimalText(dec);
  };
  const r = fmt(z.re);
  if (tiny(z.im)) return r;
  const imAbs = { m: z.im.m < 0n ? -z.im.m : z.im.m, e: z.im.e };
  const i = fmt(imAbs);
  const sign = z.im.m < 0n ? '−' : '+';
  if (!z.re.m) return { ml: `${z.im.m < 0n ? mo('−') : ''}${i.ml}${mi('i')}`, text: `${z.im.m < 0n ? '−' : ''}${i.text}i` };
  return { ml: `${r.ml}${mo(sign)}${i.ml}${mi('i')}`, text: `${r.text} ${sign} ${i.text}i` };
}

function intervalRow(parts: Interval[], x: string): Row {
  if (!parts.length) return { ml: M(`${mi(x)}${mo('∈')}${mo('∅')}`), text: `${x} ∈ ∅` };
  const one = (iv: Interval) => {
    if (iv.lo && iv.hi && same(iv.lo, iv.hi)) return { ml: `${mo('{')}${toML(iv.lo)}${mo('}')}`, text: `{${toText(iv.lo)}}` };
    const l = iv.lo ? toML(iv.lo) : INF_ML('−'), h = iv.hi ? toML(iv.hi) : INF_ML('+');
    const lt = iv.lo ? toText(iv.lo) : '−∞', ht = iv.hi ? toText(iv.hi) : '+∞';
    return {
      ml: `<mrow><mo stretchy="false">${iv.loClosed ? '⟨' : '('}</mo>${l}${mo(';')}${h}<mo stretchy="false">${iv.hiClosed ? '⟩' : ')'}</mo></mrow>`,
      text: `${iv.loClosed ? '⟨' : '('}${lt}; ${ht}${iv.hiClosed ? '⟩' : ')'}`,
    };
  };
  const ps = parts.map(one);
  if (parts.length === 1 && !parts[0].lo && !parts[0].hi) return { ml: M(`${mi(x)}${mo('∈')}<mi mathvariant="normal">ℝ</mi>`), text: `${x} ∈ ℝ` };
  return { ml: M(`${mi(x)}${mo('∈')}${ps.map(p => p.ml).join(mo('∪'))}`), text: `${x} ∈ ${ps.map(p => p.text).join(' ∪ ')}` };
}

// --- Relations ---

function relation(node: Extract<Node, { t: 'rel' }>, env: Env, varsHint: string[] | null): Out {
  const parts = node.parts.map(p => scalar(evaluate(p, env), 'Równanie'));
  const ops = node.ops;
  if (ops.includes('->')) fail('Strzałka → ma sens w granicy: limit(f; x->a).');
  if (ops.length === 1 && ops[0] === '=') {
    const [l, r] = parts;
    const vs = variables(sub(l, r));
    // y = f(x): a function to look at, not an equation to solve
    if (!varsHint && isSym(l) && vs.length === 2 && vs.includes(l.n) && freeOf(r, l.n) && l.n !== 'x' && variables(r).length === 1) {
      const pods = expressionPods(r);
      return { pods, value: ex(r) };
    }
    const x = varsHint?.[0] ?? mainVar(sub(l, r));
    if (varsHint && varsHint.length > 1) return systemFromExprs([sub(l, r)], varsHint);
    return equationPods(l, r, x);
  }
  // a condition on two variables: the region of the plane where it holds
  if (!varsHint && variables(add(...parts)).length === 2 && !ops.includes('=')) {
    const [vx, vy] = twoVars(add(...parts));
    const SYMBOL: Record<string, string> = { '<=': '≤', '>=': '≥', '!=': '≠' };
    const text = parts.map((e, k) => (k ? ` ${SYMBOL[ops[k - 1]] ?? ops[k - 1]} ` : '') + toText(e)).join('');
    const row = { ml: M(parts.map((e, k) => (k ? mo(SYMBOL[ops[k - 1]] ?? ops[k - 1]) : '') + toML(e)).join('')), text };
    const plot = safe(() => regionPlot(parts, ops, vx, vy, text));
    return { pods: [{ title: 'Obszar', rows: [row], note: `Zbiór punktów (${vx}; ${vy}) spełniających warunek.` }, ...(plot ? [{ title: 'Wykres', rows: [], plot, note: 'Zacieniowany obszar; brzeg przerywany, gdy nierówność jest ostra, więc brzeg do obszaru nie należy.' }] : [])] };
  }
  // chains like 1 < x < 3 and single inequalities
  const x = varsHint?.[0] ?? mainVar(add(...parts));
  let res: Interval[] | null = null;
  let note: string | undefined;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op === '=') fail('Łańcuch z równością: rozdziel go na osobne warunki.');
    const r = solveInequality(sub(parts[k], parts[k + 1]), op, x);
    note = note ?? r.note;
    res = res ? intersect(res, r.parts) : r.parts;
  }
  const pods: Pod[] = [{ title: 'Rozwiązanie', rows: [intervalRow(res!, x)], note }];
  if (parts.length === 2) {
    const zero = isZero(parts[1]);
    const plot = safe(() => plotOf(zero ? [parts[0]] : [parts[0], parts[1]], x, {
      hints: res!.flatMap(iv => [iv.lo, iv.hi]).filter(Boolean).map(e => approx(e!).re),
      bands: res!.map(iv => [iv.lo ? approx(iv.lo).re : -Infinity, iv.hi ? approx(iv.hi).re : Infinity]),
      find: zero ? [['zero']] : [], crossings: !zero,
      labels: zero ? [`y = ${toText(parts[0])}`] : [`lewa strona: y = ${toText(parts[0])}`, `prawa strona: y = ${toText(parts[1])}`],
    }));
    if (plot) pods.push({ title: 'Wykres', rows: [], plot, note: 'Zacieniowane: przedziały, na których nierówność jest spełniona.' });
  }
  return { pods };
}

function equationPods(l: Expr, r: Expr, x: string): Out {
  const f = sub(l, r);
  const res = solveEquation(f, x);
  const pods: Pod[] = [];
  if (res.kind === 'all') pods.push({ title: 'Rozwiązanie', rows: [textRow(`Równanie jest tożsamością: spełnia je każde ${x} z dziedziny.`)], note: res.note });
  else if (res.kind === 'none') pods.push({ title: 'Rozwiązanie', rows: [textRow('Brak rozwiązań.')], note: res.note });
  else {
    const real = res.sols.filter(isRealSol), complex = res.sols.filter(s => !isRealSol(s));
    if (real.length) pods.push({ title: complex.length ? 'Rozwiązania rzeczywiste' : 'Rozwiązania', rows: solutionRows(real.slice(0, 30), x), note: res.note ?? (real.length > 30 ? `Pokazano 30 z ${real.length}.` : undefined) });
    if (complex.length) pods.push({ title: real.length ? 'Rozwiązania zespolone' : 'Rozwiązania (zespolone)', rows: solutionRows(complex, x), note: real.length ? undefined : res.note });
    if (!real.length && !complex.length) pods.push({ title: 'Rozwiązanie', rows: [textRow('Brak rozwiązań.')] });
  }
  if (variables(f).length === 1) {
    const marks = res.kind === 'list' ? res.sols.filter(s => isRealSol(s) && !s.family && s.approx).map(s => bfToNumber(s.approx!.re)) : [];
    const zero = isZero(r), kind: MarkKind = zero ? 'zero' : 'cross';
    const plot = safe(() => plotOf(zero ? [l] : [l, r], x, {
      at: marks.map(v => ({ x: v, kind })), find: zero ? [['zero']] : [], crossings: !zero,
      labels: zero ? [`y = ${toText(l)}`] : [`lewa strona: y = ${toText(l)}`, `prawa strona: y = ${toText(r)}`],
    }));
    if (plot) pods.push({ title: 'Wykres', rows: [], plot, note: zero ? undefined : 'Rozwiązania to miejsca, w których przecinają się wykresy obu stron.' });
    // complex solutions: where they lie on the plane
    if (res.kind === 'list' && res.sols.some(s => !isRealSol(s)) && res.sols.every(s => s.approx && !s.family)) {
      const zs = res.sols.map((s, k) => {
        const re = bfToNumber(s.approx!.re), im = bfToNumber(s.approx!.im);
        return { re, im, label: `${x}${res.sols.length > 1 ? subscript(k + 1) : ''} ≈ ${fmt(re)}${im < 0 ? ' − ' : ' + '}${fmt(Math.abs(im))}i` };
      });
      const L = zText(l, x), R = zText(r, x);
      const rp = safe(() => rootsPlot(zs, L && R ? `${L} = ${R}` : undefined));
      if (rp) pods.push({ title: 'Rozwiązania na płaszczyźnie zespolonej', rows: [], plot: rp });
    }
  } else if (variables(f).length === 2) {
    const [vx, vy] = twoVars(f);
    const plot = safe(() => implicitPlot([f], vx, vy, [`${toText(l)} = ${toText(r)}`], [], [[l, r]]));
    if (plot) pods.push({ title: 'Krzywa', rows: [], plot, note: `Wszystkie punkty (${vx}; ${vy}) spełniające równanie.` });
  }
  const p = polyOf(f, x);
  if (p && deg(p) >= 2) {
    const fa = safe(() => factorExpr(f));
    if (fa && !same(fa.e, expand(f))) pods.push({ title: 'Postać iloczynowa', rows: [{ ml: M(`${toML(fa.e)}${mo('=')}<mn>0</mn>`), text: `${toText(fa.e)} = 0` }] });
    if (deg(p) === 2) {
      const [c, b, a] = p.map(v => num(v));
      const delta = sub(pow(b, TWO), mul(num(4), a, c));
      pods.push({ title: 'Wyróżnik', rows: [eqRow('<mi>Δ</mi>', 'Δ', delta)] });
    }
  }
  return { pods };
}

function system(items: Node[], env: Env, varsHint: string[] | null): Out {
  const exprs = items.map(n => {
    if (n.t !== 'rel' || n.ops.length !== 1 || n.ops[0] !== '=') fail('Układ składa się z równań (ze znakiem =).');
    const [l, r] = (n as { parts: Node[] }).parts.map(p => scalar(evaluate(p, env), 'Równanie'));
    return sub(l, r);
  });
  return systemFromExprs(exprs, varsHint);
}
function systemFromExprs(exprs: Expr[], varsHint: string[] | null): Out {
  // x, y, z, u, v, w are the usual unknowns; when at least two of them occur, other
  // letters act as parameters (a x + y = 1). solve([...], [x, y, ...]) overrides this.
  const all = variables(add(...exprs.map(e => mul(e, e)))).filter(v => v !== 'k');
  const standard = all.filter(v => 'xyzuvw'.includes(v));
  const vs = varsHint ?? (standard.length >= 2 ? standard : all);
  if (!vs.length) fail('Układ nie ma niewiadomych.');
  if (vs.length === 1) {
    const pods: Pod[] = [];
    const r = solveSystem(exprs, vs);
    pods.push(systemPod(r, vs));
    return { pods };
  }
  const r = solveSystem(exprs, vs);
  const first = systemPod(r, vs);
  // The matrix view of a linear system, and the same elimination steps under its solution card.
  const lin = r.linear;
  if (lin) {
    const ls = safe(() => LA.linsolve(lin.A, lin.b));
    if (ls && stepsFit(lin.augmented)) first.steps = steps(() => MS.linsolveSteps(lin.A, lin.b, ls, simp, vs));
  }
  const pods = [first, ...(lin ? safe(() => systemMatrixPods(lin, vs)) ?? [] : [])];
  if (vs.length === 2) {
    const [vx, vy] = vs.includes('x') && vs.includes('y') ? ['x', 'y'] : vs;
    const pts: [number, number][] = r.kind === 'solutions' ? r.list.flatMap(sol => {
      const z = sol.map(v => safe(() => approx(v)));
      const [a, b] = vx === vs[0] ? z : [z[1], z[0]];
      return a && b && Math.abs(a.im) < 1e-12 && Math.abs(b.im) < 1e-12 ? [[a.re, b.re] as [number, number]] : [];
    }) : [];
    const plot = safe(() => implicitPlot(exprs, vx, vy, exprs.map(e => `${toText(e)} = 0`), pts));
    if (plot) pods.push({ title: 'Wykres', rows: [], plot, note: 'Rozwiązania układu to punkty wspólne krzywych.' });
  }
  return { pods };
}
const subscript = (k: number) => String(k).replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[+d]);
/** The two variables of e as (horizontal, vertical): x and y when present, else in order. */
function twoVars(e: Expr): [string, string] {
  const vs = variables(e);
  if (vs.includes('x') && vs.includes('y')) return ['x', 'y'];
  if (vs.includes('y')) return [vs.find(v => v !== 'y')!, 'y'];
  return [vs[0], vs[1]];
}
function systemPod(r: ReturnType<typeof solveSystem>, vs: string[]): Pod {
  if (r.kind === 'none') {
    const c = r.linear?.contradiction;
    if (!r.linear || !c) return { title: 'Układ sprzeczny', rows: [textRow('Brak rozwiązań.')] };
    const rows: Row[] = [
      { ml: M(`${mo('0')}${mo('=')}${toML(c.value)}`), text: `0 = ${toText(c.value)}` },
      textRow(`rząd A = ${r.linear.rankA}, rząd [A | b] = ${r.linear.rankAug}`),
    ];
    const note = `Wiersz ${c.row + 1} daje sprzeczność 0 = ${toText(c.value)}. Rząd A jest mniejszy niż rząd [A | b], więc układ nie ma rozwiązań (twierdzenie Kroneckera–Capellego).`;
    return { title: 'Układ sprzeczny', rows, note };
  }
  if (r.kind === 'unknown') return { title: 'Rozwiązanie', rows: [textRow(r.note)] };
  if (r.kind === 'param') {
    const lines: [string, string, string][] = vs.map((v, k) => r.free.includes(v) ? [mi(v), '∈', '<mi mathvariant="normal">ℝ</mi>'] : [mi(v), '=', toML(r.values[k])]);
    const text = vs.map((v, k) => r.free.includes(v) ? `${v} ∈ ℝ` : `${v} = ${toText(r.values[k])}`).join(', ');
    const rank = r.linear ? ` rząd A = ${r.linear.rankA} < ${vs.length} niewiadomych.` : '';
    return { title: 'Rozwiązanie', rows: [{ ml: M(systemML(lines)), text }], note: `Nieskończenie wiele rozwiązań (parametr${r.free.length > 1 ? 'y' : ''}: ${r.free.join(', ')}).${rank}` };
  }
  const rows = r.list.map(sol => ({
    ml: M(systemML(sol.map((v, k) => [mi(vs[k]), '=', toML(v)]))),
    text: sol.map((v, k) => `${vs[k]} = ${toText(v)}`).join(', '),
    note: sol.some(v => isConstant(v) && !isNum(v)) ? sol.map((v, k) => (isNum(v) ? '' : `${vs[k]} ${shortApprox(v)}`)).filter(Boolean).join(', ') : undefined,
  }));
  return { title: r.list.length > 1 ? 'Rozwiązania' : 'Rozwiązanie', rows };
}

/** A linear system in matrix form: A·x = b, the augmented matrix, ranks and Cramer's rule when it applies. */
function systemMatrixPods(lin: LinearInfo, vs: string[]): Pod[] {
  const [m, n] = dims(lin.A);
  const b = lin.b.map(v => [v]);
  const x = vs.map(v => [sym(v)]);
  const rows: Row[] = [
    {
      ml: M(`${matML(lin.A)}${mo('·')}${matML(x)}${mo('=')}${matML(b)}`),
      text: `${matText(lin.A)}·[${vs.join(', ')}] = [${lin.b.map(toText).join(', ')}]`,
    },
    matRow(lin.A, '<mi>A</mi>', 'A'),
    matRow(b, '<mi>b</mi>', 'b'),
    {
      ml: M(`${mo('[')}<mi>A</mi>${mo('|')}<mi>b</mi>${mo(']')}${mo('=')}${MS.matML(lin.augmented, { bar: n })}`),
      text: `[A | b] = ${MS.matText(lin.augmented, n)}`,
    },
  ];
  const pods: Pod[] = [{
    title: 'Postać macierzowa',
    rows,
    note: `A·x = b, gdzie x = (${vs.join(', ')})ᵀ. Macierz A ma wymiar ${m}×${n}, a wektor b ma długość ${m}.`,
    more: { label: 'Rozwiąż macierzowo', query: `linsolve(${matText(lin.A)}, [${lin.b.map(toText).join(', ')}])` },
  }];
  const rankRows: Row[] = [
    textRow(`rząd A = ${lin.rankA}`),
    textRow(`rząd [A | b] = ${lin.rankAug}`),
  ];
  if (!lin.contradiction) rankRows.push(textRow(`niewiadome: ${n}, stopnie swobody: ${n - lin.rankA}`));
  if (lin.contradiction) {
    rankRows.unshift({ ml: M(`<mn>0</mn>${mo('=')}${toML(lin.contradiction.value)}`), text: `0 = ${toText(lin.contradiction.value)} (wiersz ${lin.contradiction.row + 1})` });
  }
  const free = lin.free.map(j => vs[j]);
  const rankNote = lin.contradiction
    ? 'Rząd A jest mniejszy niż rząd [A | b] — układ jest sprzeczny.'
    : free.length
      ? `Rząd A jest mniejszy niż liczba niewiadomych: rozwiązanie ma ${free.length} ${free.length === 1 ? 'stopień swobody' : free.length < 5 ? 'stopnie swobody' : 'stopni swobody'} (zmienne wolne: ${free.join(', ')}).`
      : 'Rząd A równa się liczbie niewiadomych — rozwiązanie jest dokładnie jedno.';
  pods.push({ title: 'Rząd i zmienne wolne', rows: rankRows, note: rankNote });

  // Cramer's rule for a square, non-singular system: xᵢ = det Aᵢ / det A.
  if (m === n && lin.rankA === n && n >= 2 && n <= 4 && stepsFit(lin.A)) {
    const detA = safe(() => simp(LA.det(lin.A)));
    const ls = safe(() => LA.linsolve(lin.A, lin.b));
    if (detA && !isZero(expand(detA)) && ls?.kind === 'unique') {
      const row2 = (f: string, k?: number) => `<mrow><mi>${f}</mi><mspace width="0.17em"/>${k ? `<msub><mi>A</mi><mn>${k}</mn></msub>` : '<mi>A</mi>'}</mrow>`;
      const cramer: Row[] = [eqRow('<mi>det</mi><mi>A</mi>', 'det A', detA)];
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const Ai = lin.A.map((r, j) => r.map((v, k) => (k === i ? lin.b[j] : v)));
        const di = safe(() => simp(LA.det(Ai)));
        if (!di) { ok = false; break; }
        const xi = simp(div(di, detA));
        if (!same(xi, simp(ls.x[i]))) { ok = false; break; }
        const pT = (e: Expr) => { const t = toText(e); return /^[\d/]+$/.test(t) ? t : `(${t})`; };
        cramer.push({
          ml: M(`${mi(vs[i])}${mo('=')}<mfrac>${row2('det', i + 1)}${row2('det')}</mfrac>${mo('=')}<mfrac>${toML(di)}${toML(detA)}</mfrac>${mo('=')}${toML(xi)}`),
          text: `${vs[i]} = det A${subscript(i + 1)} / det A = ${pT(di)} / ${pT(detA)} = ${toText(xi)}`,
        });
      }
      if (ok) pods.push({ title: 'Wzory Cramera', rows: cramer, note: `Aᵢ to macierz A z i-tą kolumną zastąpioną przez b (kolejność niewiadomych: ${vs.join(', ')}). Zakładamy, że det A ≠ 0.` });
    }
  }
  return pods;
}

// --- Matrices and lists ---

function matML(m: Expr[][]): string {
  return matrixTable(m.map(r => `<mtr>${r.map(c => `<mtd>${toML(c)}</mtd>`).join('')}</mtr>`).join(''));
}
const matText = (m: Expr[][]) => `[${m.map(r => `[${r.map(toText).join(', ')}]`).join(', ')}]`;
const matRow = (m: Expr[][], lhs = '', lhsText = ''): Row => ({ ml: M(`${lhs}${lhs ? mo('=') : ''}${matML(m)}`), text: `${lhsText ? lhsText + ' = ' : ''}${matText(m)}` });

const simp = (e: Expr): Expr => safe(() => simplify(e)) ?? e;
const simpM = (m: Expr[][]): Expr[][] => m.map(r => r.map(simp));
/** Worked solutions only where they stay readable: numeric matrices up to 8×9, symbolic up to 3×4. */
const stepsFit = (m: Expr[][]) => { const [n, k] = dims(m); return m.flat().every(isNum) ? n <= 8 && k <= 9 : n <= 3 && k <= 4; };
const steps = (f: () => Step[] | null): Step[] | undefined => safe(f) ?? undefined;
const SUP_T = '<msup><mi>A</mi><mi>T</mi></msup>', A_INV = '<msup><mi>A</mi><mn>−1</mn></msup>';

function matrixPods(m: Expr[][]): Pod[] {
  const [n, k] = dims(m);
  const constant = m.flat().every(isConstant), numeric = m.flat().every(isNum);
  const pods: Pod[] = [{ title: 'Macierz', rows: [matRow(simpM(m))], note: `wymiar ${n}×${k}${n === k ? ' (kwadratowa)' : ''}` }];
  const props = safe(() => MS.properties(m, simp));
  if (props && props.tags.length) {
    const rows = props.tags.map(t => textRow(t));
    if (props.minors) rows.push({ ml: M(`${mtext('minory wiodące')}${mo(':')}<mspace width="0.4em"/>${props.minors.map((d, i) => `<msub><mi>D</mi><mn>${i + 1}</mn></msub>${mo('=')}${toML(d)}`).join(`${mo(',')}<mspace width="0.5em"/>`)}`), text: `minory wiodące: ${props.minors.map((d, i) => `D${subscript(i + 1)} = ${toText(d)}`).join(', ')}` });
    pods.push({ title: 'Własności', rows });
  }
  const ech = safe(() => LA.echelon(m));
  const rk = ech ? ech.pivots.length : null;
  if (rk !== null) pods.push({ title: 'Rząd', rows: [textRow(String(rk))], note: `liczba niezerowych wierszy postaci schodkowej${n === k ? (rk === n ? ' — rząd pełny' : ` — brakuje ${n - rk} do pełnego`) : ''}` });
  if (n === k) {
    const d = safe(() => LA.det(m));
    if (d) {
      const dv = simp(d);
      pods.push({ title: 'Wyznacznik', rows: [row(dv, isConstant(d) && !isNum(d) ? shortApprox(d) : undefined)], steps: stepsFit(m) && n >= 2 ? steps(() => MS.detSteps(m, dv, simp)) : undefined });
    }
    pods.push({ title: 'Ślad', rows: [row(simp(LA.trace(m)))], note: 'suma elementów przekątnej = suma wartości własnych' });
    if (d && !isZero(expand(d)) && n <= 8) {
      const inv = safe(() => simpM(LA.inverse(m)));
      if (inv) pods.push({ title: 'Macierz odwrotna', rows: [matRow(inv, A_INV, 'A⁻¹')], steps: (numeric ? n <= 6 : n <= 3) ? steps(() => MS.inverseSteps(m, inv, simp)) : undefined });
    } else if (d) pods.push({ title: 'Macierz odwrotna', rows: [textRow('Nie istnieje: macierz jest osobliwa (det A = 0).')], note: 'Dla macierzy osobliwej układ A·x = b może być sprzeczny albo mieć nieskończenie wiele rozwiązań — zależy to od wektora b.' });
    if (n >= 2 && n <= 5 && (n <= 4 || constant)) {
      const adj = safe(() => simpM(LA.adjugate(m)));
      if (adj) pods.push({ title: 'Macierz dołączona', rows: [matRow(adj, '<mi>adj</mi><mo>(</mo><mi>A</mi><mo>)</mo>', 'adj(A)')], note: 'transponowana macierz dopełnień algebraicznych; A·adj(A) = det(A)·I' });
    }
    if (n <= 10) {
      const cp = safe(() => LA.charpoly(m));
      if (cp) {
        pods.push({ title: 'Wielomian charakterystyczny', rows: [{ ml: M(`<mi>det</mi>${mo('(')}<mi>λ</mi><mi>I</mi>${mo('−')}<mi>A</mi>${mo(')')}${mo('=')}${toML(cp)}`), text: toText(cp) }] });
        const ev = eigen(m, cp);
        if (ev) pods.push(...ev);
        if (n >= 2 && n <= 6) {
          const dg = safe(() => MS.diagonalize(m, cp, simp));
          if (typeof dg === 'string') pods.push({ title: 'Diagonalizacja', rows: [textRow(dg)] });
          else if (dg && !LA.isDiagonal(m)) {
            const rows = [matRow(dg.D, '<mi>D</mi>', 'D'), matRow(dg.P, '<mi>P</mi>', 'P')];
            if (dg.Pinv) rows.push(matRow(dg.Pinv, '<msup><mi>P</mi><mn>−1</mn></msup>', 'P⁻¹'));
            pods.push({ title: 'Diagonalizacja', rows, note: `A = P·D·P⁻¹${dg.complex ? ' (nad ℂ)' : ''}: na przekątnej D są wartości własne, w kolumnach P odpowiadające im wektory własne.` });
          }
        }
      }
    }
  }
  // forms of the matrix reached by row operations, with the operations themselves
  if (ech) pods.push({ title: 'Postać schodkowa (Gauss)', rows: [matRow(simpM(ech.R))], steps: stepsFit(m) ? steps(() => MS.echelonSteps(m, 'ref', ech.R)) : undefined });
  const rr = safe(() => LA.rref(m));
  if (rr) pods.push({ title: 'Postać schodkowa zredukowana', rows: [matRow(rr.R)], steps: stepsFit(m) ? steps(() => MS.echelonSteps(m, 'rref', rr.R)) : undefined });
  if (n === k && n >= 2 && n <= 6 && constant) {
    const dec = safe(() => LA.lu(m));
    if (dec) pods.push({ ...luPod(dec), steps: stepsFit(m) ? steps(() => MS.luSteps(m, dec)) : undefined });
    const ch = safe(() => MS.choleskyOf(m, simp));
    if (ch) pods.push({ title: 'Rozkład Choleskiego', rows: [matRow(ch, '<mi>L</mi>', 'L')], note: 'A = L·Lᵀ (macierz symetryczna dodatnio określona, L dolnotrójkątna z dodatnią przekątną).' });
  }
  if (constant && n >= 2 && n <= 4 && k >= 2 && k <= n) {
    const f = safe(() => MS.qrOf(m, simp));
    if (f) pods.push({ title: 'Rozkład QR', rows: [matRow(f.Q, '<mi>Q</mi>', 'Q'), matRow(f.R, '<mi>R</mi>', 'R')], note: 'A = Q·R (Gram–Schmidt): kolumny Q są ortonormalne, R jest górnotrójkątna.' });
  }
  if (rk !== null && n >= 1 && k >= 1 && n <= 8 && k <= 8) {
    const ns = safe(() => (rk < k ? LA.nullspace(m) : []));
    if (ns && ns.length) {
      const rows = ns.map(v => ({ ml: M(matML(v.map(c => [simp(c)]))), text: `(${v.map(c => toText(simp(c))).join(', ')})` }));
      pods.push({ title: `Jądro (wymiar ${ns.length})`, rows, note: 'Baza rozwiązań A·x = 0.', steps: stepsFit(m) ? steps(() => MS.nullspaceSteps(m, ns)) : undefined });
    }
  }
  if (rk !== null && n <= 8 && k <= 8 && (rk < n || rk < k)) {
    const rs = safe(() => LA.rowspace(m));
    const cs = safe(() => LA.colspace(m));
    if (rs && cs) {
      const rows: Row[] = [
        { ml: M(`${mtext('baza wierszy')}${mo(':')}<mspace width="0.4em"/>${matML(rs)}`), text: `baza wierszy: ${matText(rs)}` },
        { ml: M(`${mtext('baza kolumn')}${mo(':')}<mspace width="0.4em"/>${matML(LA.transpose(cs))}`), text: `baza kolumn: ${matText(LA.transpose(cs))}` },
      ];
      pods.push({ title: 'Podprzestrzenie', rows, note: `rząd ${rk}, defekt ${k - rk}.` });
    }
  }
  if (n === 2 && k === 2 && constant) {
    const v = m.flat().map(c => safe(() => approx(c)));
    if (v.every(z => z && Math.abs(z.im) < 1e-12)) {
      const plot = safe(() => matrixPlot(v[0]!.re, v[1]!.re, v[2]!.re, v[3]!.re));
      if (plot) pods.push({ title: 'Przekształcenie płaszczyzny', rows: [], plot, note: 'Obraz kwadratu jednostkowego, wektorów bazy i prostych własnych (kierunków, które A tylko rozciąga).' });
    }
  }
  pods.push({ title: 'Macierz transponowana', rows: [matRow(LA.transpose(m), SUP_T, 'Aᵀ')] });
  if (n === k && n <= 6) {
    const sq = safe(() => simpM(matMul(m, m)));
    if (sq) pods.push({ title: 'Kwadrat macierzy', rows: [matRow(sq, '<msup><mi>A</mi><mn>2</mn></msup>', 'A²')] });
  }
  return pods;
}

function luPod(dec: LA.LU): Pod {
  const rows: Row[] = [matRow(simpM(dec.L), '<mi>L</mi>', 'L'), matRow(simpM(dec.U), '<mi>U</mi>', 'U')];
  const pIdentity = dec.P.every((r, i) => r.every((v, j) => isZero(sub(v, i === j ? ONE : ZERO))));
  if (!pIdentity) rows.unshift(matRow(simpM(dec.P), '<mi>P</mi>', 'P'));
  return { title: 'Rozkład LU', rows, note: pIdentity ? 'A = L·U (L jednostkowa dolnotrójkątna z mnożnikami eliminacji, U górnotrójkątna).' : 'P·A = L·U (P to permutacja wierszy).' };
}
function eigen(m: Expr[][], cp: Expr): Pod[] | null {
  const p = polyOf(cp, 'λ');
  if (!p) return null;
  const roots = solvePoly(p);
  const rows: Row[] = [], vecRows: Row[] = [];
  for (const r of roots) {
    const lam = r.exact;
    rows.push(lam ? { ml: M(`<mi>λ</mi>${mo('=')}${toML(lam)}`), text: `λ = ${toText(lam)}`, note: [r.mult > 1 ? `krotność ${r.mult}` : '', !isNum(lam) ? shortApprox(lam) : ''].filter(Boolean).join(', ') || undefined }
      : { ml: M(`<mi>λ</mi>${mo('≈')}${complexDecimal(r.approx, 16).ml}`), text: `λ ≈ ${complexDecimal(r.approx, 16).text}`, note: r.mult > 1 ? `krotność ${r.mult}` : undefined });
    if (lam && (isNum(lam) || size(lam) < 12)) {
      const shifted = m.map((row_, i) => row_.map((v, j) => (i === j ? sub(v, lam) : v)));
      const ns = safe(() => LA.nullspace(shifted));
      if (ns && ns.length) {
        for (const v of ns) {
          // check A v = λ v numerically before showing it
          const Av = matMul(m, v.map(c => [c])).map(c => c[0]);
          const ok = Av.every((c, i) => { const d = approx(sub(c, mul(lam, v[i]))); return Math.hypot(d.re, d.im) < 1e-9; });
          if (ok) vecRows.push({ ml: M(`<mi>λ</mi>${mo('=')}${toML(lam)}${mo(':')}<mspace width="0.5em"/>${matML(v.map(c => [simplify(c)]))}`), text: `λ = ${toText(lam)}: (${v.map(c => toText(simplify(c))).join(', ')})` });
        }
      }
    }
  }
  const out: Pod[] = [{ title: 'Wartości własne', rows }];
  if (vecRows.length) out.push({ title: 'Wektory własne', rows: vecRows });
  return out;
}

function listPods(v: Extract<Value, { t: 'list' }>): Pod[] {
  const items = v.items;
  if (!items.every(i => i.t === 'expr')) return [{ title: 'Lista', rows: [textRow(items.map(valueText).join('; '))] }];
  const xs = items.map(i => (i as { e: Expr }).e);
  const pods: Pod[] = [{ title: v.set ? 'Zbiór' : 'Lista', rows: [{ ml: M(`${mo(v.set ? '{' : '[')}${xs.map(toML).join(mo(';'))}${mo(v.set ? '}' : ']')}`), text: `${v.set ? '{' : '['}${xs.map(toText).join('; ')}${v.set ? '}' : ']'}` }] }];
  if (xs.length >= 2 && xs.every(isConstant) && xs.every(x => constSign(x) !== null)) pods.push(...statsPods(xs));
  return pods;
}
const valueText = (v: Value): string => v.t === 'expr' ? toText(v.e) : v.t === 'list' ? `{${v.items.map(valueText).join('; ')}}` : v.t === 'matrix' ? matText(v.rows) : v.parts.map(toText).join(` ${v.ops[0]} `);

function sortedConst(xs: Expr[]): Expr[] {
  return [...xs].sort((a, b) => constSign(sub(a, b)) ?? 0);
}
function statsPods(xs: Expr[]): Pod[] {
  const n = xs.length;
  const total = add(...xs), mean = div(total, num(n));
  const sorted = sortedConst(xs);
  const median = n % 2 ? sorted[(n - 1) / 2] : div(add(sorted[n / 2 - 1], sorted[n / 2]), TWO);
  const ss = add(...xs.map(x => pow(sub(x, mean), TWO)));
  const varPop = simplify(div(ss, num(n))), varSample = simplify(div(ss, num(n - 1)));
  const r = (title: string, e: Expr) => ({ ml: M(`${mtext(title)}${mo(':')}<mspace width="0.4em"/>${toML(e)}`), text: `${title}: ${toText(e)}`, note: isNum(e) ? undefined : shortApprox(e) });
  return [{
    title: 'Statystyki',
    rows: [
      r('liczba elementów', num(n)), r('suma', simplify(total)), r('średnia', simplify(mean)), r('mediana', simplify(median)),
      r('minimum', sorted[0]), r('maksimum', sorted[n - 1]),
      r('wariancja (populacji)', varPop), r('wariancja (próby)', varSample),
      r('odchylenie standardowe (populacji)', simplify(sqrt(varPop))), r('odchylenie standardowe (próby)', simplify(sqrt(varSample))),
    ],
  }, { title: 'Posortowane', rows: [{ ml: M(sorted.map(toML).join(mo('≤'))), text: sorted.map(toText).join(' ≤ ') }] }, ...histogram(xs)];
}
function histogram(xs: Expr[]): Pod[] {
  const plot = safe(() => statsPlot(xs.map(x => approx(x).re)));
  return plot ? [{ title: 'Histogram', rows: [], plot, note: 'Zacieniowany pas: średnia ± odchylenie standardowe (populacji).' }] : [];
}

// --- Plots ---

function interestingPoints(e: Expr, x: string): number[] {
  const out: number[] = [];
  const z = safe(() => solveEquation(e, x));
  if (z && z.kind === 'list') for (const s of z.sols) if (!s.family && s.approx && isRealSol(s)) out.push(bfToNumber(s.approx.re));
  return out.filter(v => Number.isFinite(v) && Math.abs(v) < 1e6);
}

// --- Commands ---

/** An argument naming a variable (x), or null. */
const varArg = (n: Node | undefined): string | null => n?.t === 'id' && n.n.length === 1 ? n.n : null;
const exprArg = (n: Node, env: Env, what = 'Argument') => scalar(evaluate(n, env), what);
const intArg = (n: Node | undefined, env: Env, what: string, fallback?: number): number => {
  if (!n) { if (fallback === undefined) fail(`${what}: brak argumentu.`); return fallback!; }
  const e = exprArg(n, env, what);
  if (!isInt(e) || bitLength(e.v.n) > 50) fail(`${what}: oczekuję liczby całkowitej.`);
  return Number((e as { v: Q }).v.n);
};
const bigArg = (n: Node, env: Env, what: string): bigint => {
  const e = exprArg(n, env, what);
  if (!isInt(e)) fail(`${what}: oczekuję liczby całkowitej.`);
  return (e as { v: Q }).v.n;
};
const listArg = (n: Node, env: Env): Expr[] => {
  const v = evaluate(n, env);
  if (v.t === 'list') return v.items.map(i => scalar(i, 'Lista'));
  if (v.t === 'matrix') return v.rows.flat();
  return [scalar(v, 'Lista')];
};
const matArg = (n: Node, env: Env): Expr[][] => {
  const v = evaluate(n, env);
  if (v.t === 'matrix') return v.rows;
  if (v.t === 'list' && v.items.every(i => i.t === 'expr')) return [v.items.map(i => (i as { e: Expr }).e)];
  return fail('Oczekuję macierzy, np. [[1, 2], [3, 4]].');
};
const vecArg = (n: Node, env: Env): Expr[] => {
  const v = evaluate(n, env);
  if (v.t === 'list') return v.items.map(i => scalar(i, 'Wektor'));
  if (v.t === 'matrix' && (v.rows.length === 1 || v.rows[0].length === 1)) return v.rows.flat();
  return fail('Oczekuję wektora, np. [1, 2, 3].');
};
const statsArgs = (args: Node[], env: Env) => args.length === 1 ? listArg(args[0], env) : args.map(a => exprArg(a, env));
const one = (title: string, e: Expr, note?: string): Out => ({ pods: [{ title, rows: [row(e, note ?? (isConstant(e) && !isNum(e) ? shortApprox(e) : undefined))] }], value: ex(e) });

function matOut(title: string, m: Expr[][], lhs = '', lhsText = '', note?: string): Out {
  const s = m.map(r => r.map(c => safe(() => simplify(c)) ?? c));
  return { pods: [{ title, rows: [matRow(s, lhs, lhsText)], note }], value: { t: 'matrix', rows: s } };
}
function vecOut(title: string, vs: Expr[], note?: string): Out {
  const s = vs.map(v => safe(() => simplify(v)) ?? v);
  return { pods: [{ title, rows: [{ ml: M(`${mo('[')}${s.map(toML).join(mo(','))}${mo(']')}`), text: `[${s.map(toText).join(', ')}]` }], note }], value: { t: 'list', items: s.map(ex), set: false } };
}
const indexArg = (n: Node | undefined, env: Env, what: string, len: number): number => {
  const k = intArg(n, env, what);
  if (k < 1 || k > len) fail(`${what}: numer od 1 do ${len}.`);
  return k - 1;
};
function diagMatrix(vals: Expr[]): Out {
  if (!vals.length) fail('Diagonala: potrzebuję co najmniej jednej wartości.');
  if (vals.length > 30) fail('Diagonala: najwyżej 30 elementów.');
  const m = vals.map((v, i) => vals.map((_, j) => (i === j ? v : ZERO)));
  return matOut('Macierz diagonalna', m, '', '', `wymiar ${vals.length}×${vals.length}`);
}

function command(name: string, args: Node[], env: Env): Out {
  switch (name) {
    case 'simplify': { const e = simplify(exprArg(args[0], env)); return one('Postać uproszczona', e); }
    case 'expand': { const e = expand(exprArg(args[0], env)); return one('Postać rozwinięta', e); }
    case 'together': { const e = together(exprArg(args[0], env)); return one('Wspólny mianownik', e); }
    case 'cancel': { const e = cancel(together(exprArg(args[0], env))); return one('Po skróceniu', e); }
    case 'numer': return one('Licznik', numDen(together(exprArg(args[0], env)))[0]);
    case 'denom': return one('Mianownik', numDen(together(exprArg(args[0], env)))[1]);
    case 'trigexpand': return one('Rozwinięcie trygonometryczne', simplify(trigExpand(exprArg(args[0], env))));
    case 'trigreduce': return one('Postać liniowa (bez potęg sin i cos)', trigLinearize(exprArg(args[0], env)));
    case 'expandlog': return one('Rozwinięte logarytmy', expandLog(exprArg(args[0], env)), 'Dla dodatnich argumentów logarytmów.');
    case 'factor': return factorCommand(args, env);
    case 'apart': return apartCommand(args, env);
    case 'solve': case 'roots': return solveCommand(args, env);
    case 'diff': return diffCommand(args, env);
    case 'integrate': return integrateCommand(args, env);
    case 'limit': return limitCommand(args, env);
    case 'taylor': return taylorCommand(args, env);
    case 'sum': case 'product': return sumCommand(name, args, env);
    case 'approx': {
      const e = exprArg(args[0], env);
      const d = intArg(args[1], env, 'Liczba cyfr', digitsDefault);
      if (d < 1 || d > 5000) fail('Liczba cyfr musi być od 1 do 5000.');
      if (!isConstant(e)) fail('Przybliżenie dziesiętne liczę dla wyrażeń bez zmiennych.');
      const r = decimalRow(e, d);
      if (!r) fail('Tego wyrażenia nie da się obliczyć numerycznie.');
      return { pods: [{ title: `Wartość z dokładnością do ${d} cyfr znaczących`, rows: [r!] }], value: ex(e) };
    }
    case 'subst': {
      const e = exprArg(args[0], env);
      let v: string, to: Expr;
      if (args[1].t === 'rel' && args[1].ops[0] === '=') { v = varArg(args[1].parts[0]) ?? fail('Podstawienie: zapisz je jako x = wartość.'); to = exprArg(args[1].parts[1], env); }
      else { v = varArg(args[1]) ?? fail('Drugim argumentem ma być zmienna.'); to = exprArg(args[2] ?? fail('Brak wartości do podstawienia.'), env); }
      const r = subst(e, v, to);
      const s = safe(() => simplify(r)) ?? r;
      if (isConstant(s)) return { pods: numberPods(s), value: ex(s) };
      return one('Po podstawieniu', s);
    }
    case 'domain': {
      const e = exprArg(args[0], env), x = varArg(args[1]) ?? mainVar(e);
      const d = domain(e, x);
      return { pods: [{ title: 'Dziedzina', rows: [intervalRow(d.parts, x)], note: d.note }] };
    }
    case 'analyze': return analyzeCommand(args, env);
    case 'plot': return plotCommand(args, env);
    case 'extrema': return analyzeCommand(args, env, true);
    case 'tangent': {
      const e = exprArg(args[0], env);
      const x = args.length === 3 ? varArg(args[1]) ?? 'x' : mainVar(e);
      const at = exprArg(args[args.length - 1], env, 'Punkt');
      const y0 = simplify(subst(e, x, at)), k = simplify(subst(diff(e, x), x, at));
      const line = simplify(add(mul(k, sub(sym(x), at)), y0));
      const A = approx(at).re;
      const plot = safe(() => plotOf([e, line], x, { at: [{ x: A, kind: 'point', label: `punkt styczności (${fmt(A)}; ${fmt(approx(y0).re)})` }], dash: [false, true], labels: [`y = ${toText(e)}`, `styczna: y = ${toText(line)}`] }));
      return { pods: [{ title: 'Styczna', rows: [eqRow(mi('y'), 'y', line)], note: `Punkt styczności: (${toText(at)}; ${toText(y0)}), współczynnik kierunkowy ${toText(k)}.` }, ...(plot ? [{ title: 'Wykres', rows: [], plot }] : [])], value: ex(line) };
    }
    // number theory
    case 'isprime': {
      const n = bigArg(args[0], env, 'Liczba');
      const p = NT.primality(n);
      const txt = p === 'prime' ? `${n} jest liczbą pierwszą.` : p === 'probable' ? `${n} jest liczbą pierwszą według testu BPSW (nie znaleziono liczby złożonej, która by go przeszła).` : `${n} nie jest liczbą pierwszą.`;
      const pods: Pod[] = [{ title: 'Czy pierwsza?', rows: [textRow(p === 'composite' ? 'Nie' : 'Tak')], note: txt }];
      if (p === 'composite' && n > 1n) pods.push(...integerPods(n).slice(0, 1));
      return { pods };
    }
    case 'nextprime': return one('Następna liczba pierwsza', num(NT.nextPrime(bigArg(args[0], env, 'Liczba'))));
    case 'prevprime': return one('Poprzednia liczba pierwsza', num(NT.prevPrime(bigArg(args[0], env, 'Liczba'))));
    case 'prime': return one('Liczba pierwsza o tym numerze', num(NT.nthPrime(intArg(args[0], env, 'Numer'))));
    case 'primepi': return one('Liczba liczb pierwszych ≤ x', num(NT.primePi(bigArg(args[0], env, 'Liczba'))));
    case 'factorint': return { pods: integerPods(bigArg(args[0], env, 'Liczba')).slice(0, 1) };
    case 'gcd': case 'lcm': return gcdCommand(name, args, env);
    case 'divisors': {
      const n = bigArg(args[0], env, 'Liczba');
      const ds = NT.divisors(n);
      return { pods: [{ title: `Dzielniki (${ds.length})`, rows: [textRow(ds.join(', '))] }], value: { t: 'list', items: ds.map(d => ex(num(d))), set: true } };
    }
    case 'totient': return one('Funkcja φ Eulera', num(NT.totient(bigArg(args[0], env, 'Liczba'))));
    case 'sigma': return one('Suma dzielników σ', num(NT.sigma(bigArg(args[0], env, 'Liczba'), args[1] ? bigArg(args[1], env, 'Wykładnik') : 1n)));
    case 'mobius': return one('Funkcja Möbiusa μ', num(NT.mobius(bigArg(args[0], env, 'Liczba'))));
    case 'fibonacci': return one('Liczba Fibonacciego', num(NT.fibonacci(bigArg(args[0], env, 'Numer'))));
    case 'lucas': return one('Liczba Lucasa', num(NT.lucas(bigArg(args[0], env, 'Numer'))));
    case 'catalan': { const n = bigArg(args[0], env, 'Numer'); if (n < 0n) fail('Numer musi być nieujemny.'); return one('Liczba Catalana', num(binomialBig(2n * n, n) / (n + 1n))); }
    case 'powmod': {
      const [a, b, m] = args.map((x, k) => bigArg(x, env, ['Podstawa', 'Wykładnik', 'Moduł'][k]));
      if (m <= 0n) fail('Moduł musi być dodatni.');
      return one(`Potęga modulo ${m}`, num(NT.modpow(a, b, m)));
    }
    case 'modinv': { const [a, m] = args.map(x => bigArg(x, env, 'Liczba')); return one(`Odwrotność modulo ${m}`, num(NT.modinv(a, m))); }
    case 'crt': {
      const as = listArg(args[0], env), ms = listArg(args[1], env);
      const toB = (e: Expr) => { if (!isInt(e)) fail('CRT: reszty i moduły muszą być całkowite.'); return (e as { v: Q }).v.n; };
      const [x, Mod] = NT.crt(as.map(toB), ms.map(toB));
      return { pods: [{ title: 'Rozwiązanie układu kongruencji', rows: [{ ml: M(`<mi>x</mi><mo>≡</mo><mn>${x}</mn><mspace width="0.4em"/><mo>(</mo><mi mathvariant="normal">mod</mi><mspace width="0.2em"/><mn>${Mod}</mn><mo>)</mo>`), text: `x ≡ ${x} (mod ${Mod})` }] }], value: ex(num(x)) };
    }
    case 'base': {
      const e = exprArg(args[0], env);
      const b = intArg(args[1], env, 'Podstawa');
      if (isInt(e)) return { pods: [{ title: `W systemie o podstawie ${b}`, rows: [{ ml: M(`<msub><mn>${NT.toBase(e.v.n, b)}</mn><mn>${b}</mn></msub>`), text: NT.toBase(e.v.n, b) }] }] };
      if (isNum(e)) {
        const d = NT.decimalExpansion(e.v, b, 2000);
        const frac = d.period ? `${d.pre}(${d.period})` : d.pre;
        return { pods: [{ title: `W systemie o podstawie ${b}`, rows: [textRow(`${d.int}${frac ? ',' + frac : ''}`)], note: d.periodLength === null ? 'Rozwinięcie ucięte po 2000 cyfrach.' : undefined }] };
      }
      return fail('Zamiana systemu: podaj liczbę wymierną.');
    }
    case 'digits': {
      const n = bigArg(args[0], env, 'Liczba');
      const b = args[1] ? intArg(args[1], env, 'Podstawa') : 10;
      const s = NT.toBase(n < 0n ? -n : n, b);
      const sum_ = [...s].reduce((acc, c) => acc + parseInt(c, 36), 0);
      return { pods: [{ title: 'Cyfry', rows: [textRow(s.split('').join(', ')), textRow(`liczba cyfr: ${s.length}, suma cyfr: ${sum_}`)] }] };
    }
    case 'contfrac': {
      const e = exprArg(args[0], env);
      if (isNum(e)) return { pods: [{ title: 'Ułamek łańcuchowy', rows: [cfRow(NT.continuedFraction(e.v), false)] }] };
      const r = numericContinuedFraction(e, args[1] ? intArg(args[1], env, 'Liczba wyrazów') : 20);
      if (!r) fail('Nie udało się obliczyć ułamka łańcuchowego.');
      return { pods: [{ title: 'Ułamek łańcuchowy', rows: [r!], note: 'Wyrazy policzone numerycznie, potwierdzone przy dwóch precyzjach.' }] };
    }
    case 'rationalize': {
      const e = exprArg(args[0], env);
      const maxDen = args[1] ? bigArg(args[1], env, 'Największy mianownik') : 1000n;
      const z = evalC(e, 400);
      const n0 = z.re.e >= 0 ? q(z.re.m << BigInt(z.re.e)) : q(z.re.m, 1n << BigInt(-z.re.e));
      const cf = NT.continuedFraction(n0);
      let best = q(cf[0]);
      for (let k = 1; k <= cf.length; k++) { const c = NT.fromContinuedFraction(cf.slice(0, k)); if (c.d > maxDen) break; best = c; }
      return one(`Najlepsze przybliżenie wymierne (mianownik ≤ ${maxDen})`, num(best), `błąd ${shortApprox(sub(num(best), e)).replace('≈ ', '')}`);
    }
    // linear algebra
    case 'det': {
      const m = matArg(args[0], env);
      const d = simplify(LA.det(m));
      const out = one('Wyznacznik', d);
      if (stepsFit(m) && m.length >= 2) out.pods[0].steps = steps(() => MS.detSteps(m, d, simp));
      return out;
    }
    case 'inverse': {
      const A = matArg(args[0], env);
      const m = simpM(LA.inverse(A));
      return { pods: [{ title: 'Macierz odwrotna', rows: [matRow(m, A_INV, 'A⁻¹')], steps: (A.flat().every(isNum) ? A.length <= 6 : A.length <= 3) ? steps(() => MS.inverseSteps(A, m, simp)) : undefined }], value: { t: 'matrix', rows: m } };
    }
    case 'transpose': { const m = LA.transpose(matArg(args[0], env)); return { pods: [{ title: 'Macierz transponowana', rows: [matRow(m)] }], value: { t: 'matrix', rows: m } }; }
    case 'rank': {
      const A = matArg(args[0], env);
      const e = LA.echelon(A);
      const out = one('Rząd macierzy', num(e.pivots.length));
      if (stepsFit(A)) out.pods[0].steps = steps(() => MS.echelonSteps(A, 'ref', e.R));
      return out;
    }
    case 'rref': case 'echelon': {
      const A = matArg(args[0], env);
      const mode = name === 'rref' ? 'rref' : 'ref';
      const m = mode === 'rref' ? LA.rref(A).R : LA.echelon(A).R;
      const s = stepsFit(A) ? steps(() => MS.echelonSteps(A, mode, m)) : undefined;
      return { pods: [{ title: mode === 'rref' ? 'Postać schodkowa zredukowana' : 'Postać schodkowa (Gauss)', rows: [matRow(simpM(m))], steps: s }], value: { t: 'matrix', rows: m } };
    }
    case 'trace': return one('Ślad', LA.trace(matArg(args[0], env)));
    case 'charpoly': {
      const m = matArg(args[0], env);
      const v = varArg(args[1]) ?? 'λ';
      return one('Wielomian charakterystyczny', LA.charpoly(m, v));
    }
    case 'eigenvalues': case 'eigenvectors': {
      const m = matArg(args[0], env);
      return { pods: eigen(m, LA.charpoly(m)) ?? [] };
    }
    case 'nullspace': {
      const A = matArg(args[0], env);
      const ns = LA.nullspace(A);
      const s = stepsFit(A) ? steps(() => MS.nullspaceSteps(A, ns)) : undefined;
      if (!ns.length) return { pods: [{ title: 'Jądro', rows: [textRow('Tylko wektor zerowy.')], steps: s }] };
      return { pods: [{ title: `Baza jądra (wymiar ${ns.length})`, rows: ns.map(v => ({ ml: M(matML(v.map(c => [c]))), text: `(${v.map(toText).join(', ')})` })), steps: s }] };
    }
    case 'dot': return one('Iloczyn skalarny', simplify(LA.dot(vecArg(args[0], env), vecArg(args[1], env))));
    case 'cross': {
      const v = LA.cross(vecArg(args[0], env), vecArg(args[1], env)).map(c => simplify(c));
      return { pods: [{ title: 'Iloczyn wektorowy', rows: [{ ml: M(`${mo('[')}${v.map(toML).join(mo(','))}${mo(']')}`), text: `[${v.map(toText).join(', ')}]` }] }], value: { t: 'list', items: v.map(ex), set: false } };
    }
    case 'norm': { const v = vecArg(args[0], env); return one('Norma euklidesowa', simplify(sqrt(add(...v.map(c => pow(fn('abs', c), TWO)))))); }
    case 'identity': { const n = intArg(args[0], env, 'Rozmiar'); if (n < 1 || n > 20) fail('Rozmiar od 1 do 20.'); const m = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? ONE : ZERO))); return { pods: [{ title: 'Macierz jednostkowa', rows: [matRow(m)] }], value: { t: 'matrix', rows: m } }; }
    case 'adjugate': return matOut('Macierz dołączona', LA.adjugate(matArg(args[0], env)), '<mi>adj</mi><mo>(</mo><mi>A</mi><mo>)</mo>', 'adj(A)', 'A·adj(A) = det(A)·I.');
    case 'cofactor': return matOut('Macierz dopełnień algebraicznych', LA.cofactor(matArg(args[0], env)));
    case 'minor': {
      const m = matArg(args[0], env);
      const i = indexArg(args[1], env, 'Numer wiersza', m.length);
      const j = indexArg(args[2], env, 'Numer kolumny', m[0].length);
      return matOut(`Minor (${i + 1}, ${j + 1})`, LA.minor(m, i, j));
    }
    case 'diag': {
      if (args.length === 1) {
        const v = evaluate(args[0], env);
        if (v.t === 'matrix') {
          const n = Math.min(v.rows.length, v.rows[0].length);
          return vecOut('Przekątna macierzy', v.rows.slice(0, n).map((r, i) => r[i]));
        }
        if (v.t === 'list') return diagMatrix(v.items.map(i => scalar(i, 'Diagonala')));
        return diagMatrix([scalar(v, 'Diagonala')]);
      }
      return diagMatrix(args.map(a => exprArg(a, env, 'Diagonala')));
    }
    case 'dimensions': {
      const [r, c] = dims(matArg(args[0], env));
      return {
        pods: [{ title: 'Wymiar macierzy', rows: [textRow(`${r} × ${c}`)], note: 'wiersze × kolumny' }],
        value: { t: 'list', items: [ex(num(r)), ex(num(c))], set: false },
      };
    }
    case 'element': {
      const m = matArg(args[0], env);
      const i = indexArg(args[1], env, 'Numer wiersza', m.length);
      const j = indexArg(args[2], env, 'Numer kolumny', m[0].length);
      return one(`Element (${i + 1}, ${j + 1})`, m[i][j]);
    }
    case 'submatrix': {
      const m = matArg(args[0], env);
      const [n, k] = dims(m);
      const r1 = indexArg(args[1], env, 'Pierwszy wiersz', n), r2 = indexArg(args[2], env, 'Ostatni wiersz', n);
      const c1 = indexArg(args[3], env, 'Pierwsza kolumna', k), c2 = indexArg(args[4], env, 'Ostatnia kolumna', k);
      if (r1 > r2 || c1 > c2) fail('Podmacierz: początek zakresu nie może być za końcem.');
      return matOut('Podmacierz', m.slice(r1, r2 + 1).map(r => r.slice(c1, c2 + 1)), '', '', `wiersze ${r1 + 1}–${r2 + 1}, kolumny ${c1 + 1}–${c2 + 1}`);
    }
    case 'augment': {
      const A = matArg(args[0], env);
      const b = evaluate(args[1], env);
      const B: Expr[][] = b.t === 'list' && b.items.every(i => i.t === 'expr') && b.items.length === A.length
        ? b.items.map(i => [(i as { e: Expr }).e])
        : matArg(args[1], env);
      if (A.length !== B.length) fail(`Dołączenie: macierze mają ${A.length} i ${B.length} wierszy.`);
      return matOut('Macierz dołączona', A.map((r, i) => [...r, ...B[i]]));
    }
    case 'hadamard': {
      const A = matArg(args[0], env), B = matArg(args[1], env);
      const [n, k] = dims(A), [n2, k2] = dims(B);
      if (n !== n2 || k !== k2) fail(`Iloczyn Hadamarda: wymiary ${n}×${k} i ${n2}×${k2} są różne.`);
      return matOut('Iloczyn Hadamarda', A.map((r, i) => r.map((v, j) => mul(v, B[i][j]))));
    }
    case 'linsolve': {
      const A = matArg(args[0], env), b = vecArg(args[1], env);
      const sol = LA.linsolve(A, b);
      const s = stepsFit(A) ? steps(() => MS.linsolveSteps(A, b, sol, simp)) : undefined;
      const eqs = MS.equationsML(A, b);
      const system: Pod = { title: 'Układ równań', rows: [{ ml: M(eqs.ml), text: eqs.text }], note: 'A·x = b zapisane jako równania.' };
      if (sol.kind === 'none') {
        const rows: Row[] = [
          { ml: M(`${mo('0')}${mo('=')}${toML(sol.value)}`), text: `0 = ${toText(sol.value)}` },
          { ml: M(`${mtext('rząd A')}${mo('=')}<mn>${sol.rankA}</mn>${mo(',')}<mspace width="0.5em"/>${mtext('rząd [A | b]')}${mo('=')}<mn>${sol.rankAug}</mn>`), text: `rząd A = ${sol.rankA}, rząd [A | b] = ${sol.rankAug}` },
        ];
        const note = `Wiersz ${sol.row + 1} daje sprzeczność 0 = ${toText(sol.value)}. Rząd A jest mniejszy niż rząd [A | b], więc układ nie ma rozwiązań (twierdzenie Kroneckera–Capellego).`;
        return { pods: [{ title: 'Układ sprzeczny', rows, note, steps: s }, system] };
      }
      const xs = sol.x.map(v => simplify(v));
      const rows: Row[] = [{
        ml: M(systemML(xs.map((v, i) => [`<msub><mi>x</mi><mn>${i + 1}</mn></msub>`, '=', toML(v)]))),
        text: xs.map((v, i) => `x${subscript(i + 1)} = ${toText(v)}`).join(', '),
      }];
      const note = sol.kind === 'inf' ? `Nieskończenie wiele rozwiązań (parametry: ${sol.params.join(', ')}).` : undefined;
      return { pods: [{ title: 'Rozwiązanie układu', rows, note, steps: s }, system], value: { t: 'list', items: sol.x.map(v => ex(simplify(v))), set: false } };
    }
    case 'lu': {
      const A = matArg(args[0], env);
      const dec = LA.lu(A);
      if (!dec) return { pods: [{ title: 'Rozkład LU', rows: [textRow('Nie istnieje: macierz jest osobliwa.')] }] };
      const pod = luPod(dec);
      if (stepsFit(A)) pod.steps = steps(() => MS.luSteps(A, dec));
      return { pods: [pod], value: { t: 'matrix', rows: simpM(dec.U) } };
    }
    case 'cholesky': {
      const A = matArg(args[0], env);
      LA.square(A, 'Rozkład Choleskiego');
      const L = MS.choleskyOf(A, simp);
      if (!L) return { pods: [{ title: 'Rozkład Choleskiego', rows: [textRow('Nie istnieje: rozkład L·Lᵀ ma tylko macierz symetryczna dodatnio określona (o stałych elementach).')] }] };
      return { pods: [{ title: 'Rozkład Choleskiego', rows: [matRow(L, '<mi>L</mi>', 'L')], note: 'A = L·Lᵀ.' }], value: { t: 'matrix', rows: L } };
    }
    case 'qr': {
      const A = matArg(args[0], env);
      const f = MS.qrOf(A, simp);
      if (!f) return { pods: [{ title: 'Rozkład QR', rows: [textRow('Nie wyznaczę: potrzebuję macierzy liczbowej o liniowo niezależnych kolumnach (co najwyżej tylu, ile wierszy).')] }] };
      return { pods: [{ title: 'Rozkład QR', rows: [matRow(f.Q, '<mi>Q</mi>', 'Q'), matRow(f.R, '<mi>R</mi>', 'R')], note: 'A = Q·R (Gram–Schmidt): kolumny Q są ortonormalne, R jest górnotrójkątna.' }] };
    }
    case 'diagonalize': {
      const A = matArg(args[0], env);
      LA.square(A, 'Diagonalizacja');
      const dg = MS.diagonalize(A, LA.charpoly(A), simp);
      if (typeof dg === 'string') return { pods: [{ title: 'Diagonalizacja', rows: [textRow(dg)] }] };
      if (!dg) return { pods: [{ title: 'Diagonalizacja', rows: [textRow('Nie wyznaczę dokładnie: wartości własnych nie da się zapisać dokładnie albo wektory własne są zbyt złożone.')] }] };
      const rows = [matRow(dg.D, '<mi>D</mi>', 'D'), matRow(dg.P, '<mi>P</mi>', 'P')];
      if (dg.Pinv) rows.push(matRow(dg.Pinv, '<msup><mi>P</mi><mn>−1</mn></msup>', 'P⁻¹'));
      return { pods: [{ title: 'Diagonalizacja', rows, note: `A = P·D·P⁻¹${dg.complex ? ' (nad ℂ)' : ''}.` }], value: { t: 'matrix', rows: dg.D } };
    }
    case 'properties': {
      const A = matArg(args[0], env);
      const pr = MS.properties(A, simp);
      const rows = pr.tags.length ? pr.tags.map(t => textRow(t)) : [textRow('Brak szczególnych własności.')];
      if (pr.minors) rows.push(textRow(`minory wiodące: ${pr.minors.map((d, i) => `D${subscript(i + 1)} = ${toText(d)}`).join(', ')}`));
      return { pods: [{ title: 'Własności', rows }] };
    }
    case 'isinvertible': {
      const m = matArg(args[0], env);
      const [n, k] = dims(m);
      if (n !== k) return { pods: [{ title: 'Czy macierz jest odwracalna?', rows: [textRow('Nie')], note: `Tylko macierz kwadratowa może mieć odwrotną (ta jest ${n}×${k}).` }], value: ex(ZERO) };
      const ok = LA.isInvertible(m);
      return { pods: [{ title: 'Czy macierz jest odwracalna?', rows: [textRow(ok ? 'Tak' : 'Nie')], note: ok ? `det ≠ 0 (macierz ${n}×${n}).` : 'Macierz jest osobliwa (det = 0).' }], value: ex(num(ok ? 1 : 0)) };
    }
    case 'issymmetric': {
      const m = matArg(args[0], env);
      const ok = LA.isSymmetric(m);
      return { pods: [{ title: 'Czy macierz jest symetryczna?', rows: [textRow(ok ? 'Tak' : 'Nie')], note: ok ? 'Aᵀ = A.' : 'Aᵀ ≠ A.' }], value: ex(num(ok ? 1 : 0)) };
    }
    case 'rowspace': {
      const basis = LA.rowspace(matArg(args[0], env));
      if (!basis.length) return { pods: [{ title: 'Baza przestrzeni wierszy', rows: [textRow('Tylko wektor zerowy.')] }] };
      return matOut(`Baza przestrzeni wierszy (wymiar ${basis.length})`, basis);
    }
    case 'colspace': {
      const basis = LA.colspace(matArg(args[0], env));
      if (!basis.length) return { pods: [{ title: 'Baza przestrzeni kolumn', rows: [textRow('Tylko wektor zerowy.')] }] };
      return matOut(`Baza przestrzeni kolumn (wymiar ${basis.length})`, basis, '', '', 'Wektory bazy wypisane wierszami.');
    }
    // statistics
    case 'mean': case 'median': case 'variance': case 'stdev': case 'sort': case 'total': {
      const xs = statsArgs(args, env);
      if (!xs.length) fail('Pusta lista.');
      if (name === 'total') return one('Suma', simplify(add(...xs)));
      if (name === 'mean') return one('Średnia arytmetyczna', simplify(div(add(...xs), num(xs.length))));
      if (!xs.every(isConstant)) fail('Te statystyki liczę dla liczb.');
      const s = sortedConst(xs);
      if (name === 'sort') return { pods: [{ title: 'Posortowane', rows: [{ ml: M(s.map(toML).join(mo('≤'))), text: s.map(toText).join(' ≤ ') }] }] };
      if (name === 'median') { const n = s.length; return one('Mediana', n % 2 ? s[(n - 1) / 2] : simplify(div(add(s[n / 2 - 1], s[n / 2]), TWO))); }
      if (xs.length < 2) fail('Potrzeba co najmniej dwóch wartości.');
      const mean = div(add(...xs), num(xs.length));
      const ss = add(...xs.map(x => pow(sub(x, mean), TWO)));
      const v = simplify(div(ss, num(xs.length - 1)));
      return name === 'variance' ? one('Wariancja (próby, mianownik n − 1)', v) : one('Odchylenie standardowe (próby)', simplify(sqrt(v)));
    }
    // polynomials
    case 'degree': { const e = exprArg(args[0], env), x = varArg(args[1]) ?? mainVar(e); const c = coeffsOf(e, x); if (!c) fail(`To nie jest wielomian zmiennej ${x}.`); return one('Stopień', num(c!.length - 1)); }
    case 'coeffs': {
      const e = exprArg(args[0], env), x = varArg(args[1]) ?? mainVar(e);
      const c = coeffsOf(e, x);
      if (!c) fail(`To nie jest wielomian zmiennej ${x}.`);
      return { pods: [{ title: 'Współczynniki (od najwyższej potęgi)', rows: c!.slice().reverse().map((v, k) => ({ ...row(v), note: `przy ${x}^${c!.length - 1 - k}` })) }], value: { t: 'list', items: c!.slice().reverse().map(ex), set: false } };
    }
    case 'discriminant': {
      const e = exprArg(args[0], env), x = varArg(args[1]) ?? mainVar(e);
      const c = coeffsOf(e, x);
      if (!c || c.length < 3) fail('Wyróżnik liczę dla wielomianu stopnia ≥ 2.');
      if (c!.length === 3) return one('Wyróżnik Δ = b² − 4ac', simplify(sub(pow(c![1], TWO), mul(num(4), c![2], c![0]))));
      // discriminant = (−1)^(n(n−1)/2) Res(p, p′)/lc
      const n = c!.length - 1;
      const res = resultantOf(e, diff(e, x), x);
      return one('Wyróżnik', simplify(mul(num((n * (n - 1) / 2) % 2 ? -1 : 1), div(res, c![n]))));
    }
    case 'quotient': case 'remainder': {
      const a = exprArg(args[0], env), b = exprArg(args[1], env), x = varArg(args[2]) ?? mainVar(add(a, b));
      const pa = polyOf(a, x), pb = polyOf(b, x);
      if (!pa || !pb) fail('Dzielę wielomiany o współczynnikach wymiernych.');
      const [qq, rr] = pdivmod(pa!, pb!);
      const X = sym(x);
      return {
        pods: [{ title: 'Dzielenie wielomianów', rows: [eqRow(mtext('iloraz'), 'iloraz', polyToExpr(qq, X)), eqRow(mtext('reszta'), 'reszta', polyToExpr(rr, X))] }],
        value: ex(polyToExpr(name === 'quotient' ? qq : rr, X)),
      };
    }
    case 'polygcd': {
      const a = exprArg(args[0], env), b = exprArg(args[1], env), x = varArg(args[2]) ?? mainVar(add(a, b));
      const pa = polyOf(a, x), pb = polyOf(b, x);
      if (!pa || !pb) fail('NWD liczę dla wielomianów o współczynnikach wymiernych.');
      return one('NWD wielomianów (unormowany)', polyToExpr(pgcd(pa!, pb!), sym(x)));
    }
    case 'resultant': {
      const a = exprArg(args[0], env), b = exprArg(args[1], env), x = varArg(args[2]) ?? fail('Podaj zmienną rugowaną.');
      return one('Rugownik', simplify(resultantOf(a, b, x!)));
    }
  }
  return fail(`Polecenie ${name} nie jest jeszcze obsługiwane.`);
}

function resultantOf(a: Expr, b: Expr, x: string): Expr {
  const ca = coeffsOf(a, x), cb = coeffsOf(b, x);
  if (!ca || !cb) fail('Rugownik liczę dla wielomianów.');
  const m = ca!.length - 1, n = cb!.length - 1;
  if (m + n > 12) fail('Rugownik liczę dla wielomianów o łącznym stopniu do 12.');
  // Sylvester matrix
  const S: Expr[][] = [];
  for (let i = 0; i < n; i++) S.push(Array.from({ length: m + n }, (_, j) => ca![m - (j - i)] ?? ZERO).map((v, j) => (j - i >= 0 && j - i <= m ? v : ZERO)));
  for (let i = 0; i < m; i++) S.push(Array.from({ length: m + n }, (_, j) => (j - i >= 0 && j - i <= n ? cb![n - (j - i)] : ZERO)));
  return LA.det(S);
}

function factorCommand(args: Node[], env: Env): Out {
  const e = exprArg(args[0], env);
  if (isInt(e)) return { pods: integerPods(e.v.n).slice(0, 1), value: ex(e) };
  if (isNum(e)) {
    const f = (n: bigint) => NT.factorInteger(n).factors.map(([p, k]) => (k > 1 ? `<msup><mn>${p}</mn><mn>${k}</mn></msup>` : `<mn>${p}</mn>`)).join(mo('·')) || '<mn>1</mn>';
    return { pods: [{ title: 'Rozkład na czynniki pierwsze', rows: [{ ml: M(`${e.v.n < 0n ? mo('−') : ''}<mfrac><mrow>${f(e.v.n < 0n ? -e.v.n : e.v.n)}</mrow><mrow>${f(e.v.d)}</mrow></mfrac>`), text: toText(e) }] }], value: ex(e) };
  }
  if (isConstant(e)) return one('Postać iloczynowa', factorExpr(e).e);
  const r = factorExpr(e);
  return { pods: [{ title: 'Postać iloczynowa', rows: [row(r.e)], note: r.complete ? 'Rozkład nad liczbami wymiernymi.' : 'Rozkład może nie być pełny.' }], value: ex(r.e) };
}

function apartCommand(args: Node[], env: Env): Out {
  const e = exprArg(args[0], env), x = varArg(args[1]) ?? mainVar(e);
  const [n, d] = numDen(together(e));
  const pn = polyOf(n, x), pd = polyOf(d, x);
  if (!pn || !pd) fail('Rozkład na ułamki proste: funkcja wymierna o współczynnikach wymiernych.');
  const pf = partialFractions(pn!, pd!);
  if (!pf) fail('Nie udało się rozłożyć mianownika na czynniki stopnia ≤ 2.');
  const X = sym(x);
  const terms: Expr[] = [polyToExpr(pf!.poly, X)];
  for (const t of pf!.terms) terms.push(div(polyToExpr(t.num, X), pow(polyToExpr(t.factor.map(v => q(v)), X), num(t.power))));
  const sum_ = add(...terms);
  return one('Rozkład na ułamki proste', sum_);
}

function gcdCommand(name: 'gcd' | 'lcm', args: Node[], env: Env): Out {
  const xs = args.length === 1 ? listArg(args[0], env) : args.map(a => exprArg(a, env));
  if (xs.every(isInt)) {
    const vals = xs.map(v => (v as { v: Q }).v.n);
    const r = name === 'gcd' ? vals.reduce((a, b) => bgcd(a, b)) : vals.reduce((a, b) => (a && b ? (a / bgcd(a, b)) * b : 0n));
    const res = num(r < 0n ? -r : r);
    return one(name === 'gcd' ? 'Największy wspólny dzielnik' : 'Najmniejsza wspólna wielokrotność', res);
  }
  // polynomials in one variable
  const x = mainVar(add(...xs));
  const ps = xs.map(v => polyOf(v, x));
  if (ps.some(p => !p)) fail(`${name === 'gcd' ? 'NWD' : 'NWW'}: podaj liczby całkowite albo wielomiany.`);
  let g = ps[0]!;
  for (const p of ps.slice(1)) g = name === 'gcd' ? pgcd(g, p!) : lcmPoly(g, p!);
  return one(name === 'gcd' ? 'NWD wielomianów' : 'NWW wielomianów', polyToExpr(g, sym(x)));
}
function lcmPoly(a: P, b: P): P {
  const g = pgcd(a, b);
  const prod = pdivmod(mulP(a, b), g)[0];
  const lead = prod[prod.length - 1];
  return prod.map(c => q(c.n * lead.d, c.d * lead.n));
}
const mulP = (a: P, b: P): P => { const out: Q[] = Array(a.length + b.length - 1).fill(q(0)); a.forEach((x, i) => b.forEach((y, j) => { out[i + j] = q(out[i + j].n * x.d * y.d + x.n * y.n * out[i + j].d, out[i + j].d * x.d * y.d); })); return out; };

function solveCommand(args: Node[], env: Env): Out {
  let vars: string[] | null = null;
  if (args[1]) {
    const v = args[1];
    if (v.t === 'id') vars = [v.n];
    else if (v.t === 'list') vars = v.items.map(i => varArg(i) ?? fail('Niewiadome podaj jako litery, np. {x, y}.'));
    else fail('Drugim argumentem są niewiadome, np. x albo {x, y}.');
  }
  const a = args[0];
  if (a.t === 'list') {
    if (a.items.every(i => i.t === 'rel')) return system(a.items, env, vars);
    const es = a.items.map(i => exprArg(i, env));
    return systemFromExprs(es, vars);
  }
  if (a.t === 'rel') return relation(a, env, vars);
  // an expression: = 0
  const e = exprArg(a, env);
  const x = vars?.[0] ?? mainVar(e);
  return equationPods(e, ZERO, x);
}

function diffCommand(args: Node[], env: Env): Out {
  const e = exprArg(args[0], env);
  let x = varArg(args[1]) ?? mainVar(e);
  let k = 1;
  const pods: Pod[] = [];
  // diff(f, x, n) or diff(f, x, y) (mixed partial)
  if (args[2]) {
    const y = varArg(args[2]);
    if (y && args[2].t === 'id' && !/^\d/.test(y)) {
      const d = simplify(diff(diff(e, x), y));
      return { pods: [{ title: 'Pochodna mieszana', rows: [{ ml: M(`<mfrac><mrow><msup><mo>∂</mo><mn>2</mn></msup></mrow><mrow><mo>∂</mo>${mi(y)}<mo>∂</mo>${mi(x)}</mrow></mfrac>${mo('=')}${toML(d)}`), text: toText(d) }] }], value: ex(d) };
    }
    k = intArg(args[2], env, 'Rząd pochodnej');
    if (k < 0 || k > 60) fail('Rząd pochodnej od 0 do 60.');
  }
  if (args[1] && !varArg(args[1])) {
    // diff(f, 3): order without a variable
    k = intArg(args[1], env, 'Rząd pochodnej');
    x = mainVar(e);
  }
  const d = diffN(e, x, k);
  const s = simplify(d);
  pods.push({ title: k === 1 ? 'Pochodna' : `Pochodna rzędu ${k}`, rows: [eqRow(derivML(x, `<mrow>${mo('(')}${toML(e)}${mo(')')}</mrow>`, k), `d/d${x}`, s)] });
  const alt = safe(() => factorExpr(s).e);
  if (alt && !same(alt, s) && size(alt) <= size(s) + 4) pods.push({ title: 'Inna postać', rows: [row(alt)] });
  const ex_ = safe(() => expand(s));
  if (ex_ && !same(ex_, s) && !(alt && same(ex_, alt)) && size(ex_) < 200) pods.push({ title: 'Postać rozwinięta', rows: [row(ex_)] });
  if (variables(e).length === 1) {
    const prime = k === 1 ? 'f′' : k === 2 ? 'f″' : `f⁽${k}⁾`;
    const plot = safe(() => plotOf([e, s], x, { labels: [`f(${x}) = ${toText(e)}`, `${prime}(${x}) = ${toText(s)}`], find: k === 1 ? [['max', 'min'], ['zero']] : [[], ['zero']] }));
    if (plot) pods.push({ title: 'Wykres funkcji i pochodnej', rows: [], plot, note: k === 1 ? 'Gdzie f′ = 0, f ma ekstremum lub punkt stacjonarny; gdzie f′ > 0, f rośnie.' : undefined });
  }
  return { pods, value: ex(s) };
}

function integrateCommand(args: Node[], env: Env): Out {
  const e = exprArg(args[0], env);
  let x = varArg(args[1]) ?? mainVar(e);
  let a: Expr | null = null, b: Expr | null = null;
  if (args.length === 3 && args[1].t === 'rel') fail('Granice zapisz jako integrate(f; x; a; b).');
  if (args.length >= 3) {
    if (args.length === 3) { x = mainVar(e); a = exprArg(args[1], env, 'Granica'); b = exprArg(args[2], env, 'Granica'); }
    else { a = exprArg(args[2], env, 'Granica'); b = exprArg(args[3], env, 'Granica'); }
  }
  const body = `${toML(e)}<mspace width="0.17em"/><mi mathvariant="normal">d</mi>${mi(x)}`;
  if (!a || !b) {
    const F = integrate(e, x);
    if (!F) return { pods: [{ title: 'Całka nieoznaczona', rows: [textRow('Nie znalazłem funkcji pierwotnej w postaci elementarnej.')], note: 'Całki takie jak ∫ eˣ/x dx czy ∫ sin(x²) dx nie mają postaci elementarnej.' }] };
    const s = antiderivativeForm(simplify(F), x);
    const pods: Pod[] = [{ title: 'Całka nieoznaczona', rows: [{ ml: M(`${mo('∫')}${body}${mo('=')}${toML(s)}${mo('+')}<mi>C</mi>`), text: `${toText(s)} + C` }], note: 'Sprawdzone różniczkowaniem.' }];
    const alt = safe(() => expand(s));
    if (alt && !same(alt, s) && size(alt) < size(s) * 1.5) pods.push({ title: 'Inna postać', rows: [row(alt)] });
    if (variables(e).length === 1) {
      const plot = safe(() => plotOf([e, s], x, { labels: [`f(${x}) = ${toText(e)}`, `F(${x}) = ${toText(s)}`], find: [['zero'], ['max', 'min']] }));
      if (plot) pods.push({ title: 'Wykres funkcji i funkcji pierwotnej (C = 0)', rows: [], plot, note: 'Miejsca zerowe f to ekstrema F, bo F′ = f.' });
    }
    return { pods, value: ex(s) };
  }
  if (!isConstant(a) || !isConstant(b)) {
    const F = integrate(e, x);
    if (!F) fail('Nie znalazłem funkcji pierwotnej.');
    const v = simplify(sub(subst(F!, x, b), subst(F!, x, a)));
    return one('Całka oznaczona', v);
  }
  const lim = `<msubsup>${mo('∫')}${toML(a)}${toML(b)}</msubsup>`;
  const d = definite(e, x, a, b);
  const pods: Pod[] = [];
  if (d.divergent) {
    pods.push({ title: 'Całka oznaczona', rows: [textRow(d.divergent === 'yes' ? 'Całka jest rozbieżna.' : `Całka jest rozbieżna do ${d.divergent > 0 ? '+∞' : '−∞'}.`)], note: 'Funkcja ma osobliwość w przedziale całkowania lub na jego końcu, a granica funkcji pierwotnej jest nieskończona.' });
    return { pods };
  }
  if (d.exact) {
    const v = simplify(d.exact);
    pods.push({ title: 'Całka oznaczona', rows: [{ ml: M(`${lim}${body}${mo('=')}${toML(v)}`), text: toText(v) }], note: 'Z funkcji pierwotnej; zgodne z całkowaniem numerycznym.' });
    const dr = !isNum(v) || v.v.d !== 1n ? decimalRow(v) : null;
    if (dr) pods.push({ title: 'Postać dziesiętna', rows: [dr], more: { label: 'Więcej cyfr', query: `N(${toText(v)}, ${Math.min(5000, digitsDefault * 4)})` } });
    if (d.antiderivative) pods.push({ title: 'Funkcja pierwotna', rows: [{ ml: M(`${mo('∫')}${body}${mo('=')}${toML(simplify(d.antiderivative))}${mo('+')}<mi>C</mi>`), text: toText(d.antiderivative) }] });
    if (d.note) pods[0].note = d.note;
    const v2 = exactValue(v);
    return { pods: [...pods, ...areaPlot(e, x, a, b, toText(v))], value: ex(v2) };
  }
  if (d.numeric) {
    const sig = Math.max(3, Math.min(14, Math.floor(-Math.log10(Math.max(d.numeric.error, 1e-300) / Math.max(1e-300, Math.abs(d.numeric.value)))) - 1));
    const valText = Number(d.numeric.value.toPrecision(sig)).toString();
    pods.push({ title: 'Całka oznaczona', rows: [{ ml: M(`${lim}${body}${mo('≈')}<mn>${valText.replace('.', ',').replace('-', '−')}</mn>`), text: valText }], note: (d.note ? d.note + ' ' : '') + `Wartość numeryczna (kwadratura Gaussa–Kronroda), ${sig} cyfr znaczących; szacowany błąd ${d.numeric.error.toExponential(1).replace('.', ',')}.` });
    if (!d.antiderivative) pods.push({ title: 'Funkcja pierwotna', rows: [textRow('Brak postaci elementarnej (lub nie została znaleziona).')] });
    return { pods: [...pods, ...areaPlot(e, x, a, b, `≈ ${valText}`)] };
  }
  return { pods: [{ title: 'Całka oznaczona', rows: [textRow('Nie udało się obliczyć tej całki.')], note: d.note }] };
}
const exactValue = (v: Expr) => v;
function areaPlot(e: Expr, x: string, a: Expr, b: Expr, value: string): Pod[] {
  if (variables(e).length !== 1) return [];
  const A = approx(a).re, B = approx(b).re;
  if (!Number.isFinite(A) || !Number.isFinite(B)) return [];
  const p = safe(() => plotOf([e], x, {
    range: [Math.min(A, B) - Math.max(Math.abs(B - A), 1) * 0.25, Math.max(A, B) + Math.max(Math.abs(B - A), 1) * 0.25],
    fills: [{ a: Math.min(A, B), b: Math.max(A, B), label: `całka = ${value}` }], find: [['zero']], labels: [`y = ${toText(e)}`],
    refs: [{ x: A, label: `${x} = ${toText(a)}` }, { x: B, label: `${x} = ${toText(b)}` }],
  }));
  return p ? [{ title: 'Pole pod wykresem', rows: [], plot: p, note: 'Pole nad osią liczy się ze znakiem +, pod osią ze znakiem −.' }] : [];
}

function limitArgs(args: Node[], env: Env): { e: Expr; x: string; at: Expr; dir: -1 | 0 | 1 } {
  const e = exprArg(args[0], env);
  let x: string, at: Expr, dirNode: Node | undefined;
  if (args[1]?.t === 'rel' && args[1].ops[0] === '->') {
    x = varArg(args[1].parts[0]) ?? fail('Zapisz granicę jako limit(f; x->a).');
    at = exprArg(args[1].parts[1], env, 'Punkt');
    dirNode = args[2];
  } else if (args[1]?.t === 'rel' && args[1].ops[0] === '=') {
    x = varArg(args[1].parts[0]) ?? fail('Zapisz granicę jako limit(f; x->a).');
    at = exprArg(args[1].parts[1], env, 'Punkt');
    dirNode = args[2];
  } else {
    x = varArg(args[1]) ?? mainVar(e);
    at = args[2] ? exprArg(args[2], env, 'Punkt') : ZERO;
    dirNode = args[3];
  }
  const dv = dirNode ? exprArg(dirNode, env, 'Kierunek') : ZERO;
  const dir = (isNum(dv) ? qsign(dv.v) : 0) as -1 | 0 | 1;
  return { e, x, at, dir };
}
function limText(l: Lim | null): { ml: string; text: string; value?: Expr } {
  if (!l) return { ml: mtext('nie udało się wyznaczyć'), text: '?' };
  if (l.kind === 'fin') { const v = simplify(l.v); return { ml: toML(v), text: toText(v), value: v }; }
  if (l.kind === 'inf') return { ml: INF_ML(l.s > 0 ? '+' : '−'), text: l.s > 0 ? '+∞' : '−∞', value: l.s > 0 ? INF : neg(INF) };
  if (l.kind === 'bounded') return { ml: mtext('nie istnieje (oscyluje)'), text: 'nie istnieje' };
  return { ml: mtext('nie istnieje'), text: 'nie istnieje' };
}
function limitCommand(args: Node[], env: Env): Out {
  const { e, x, at, dir } = limitArgs(args, env);
  const head = (d: number) => `<munder><mi mathvariant="normal">lim</mi><mrow>${mi(x)}${mo('→')}${d ? `<msup><mrow>${toML(at)}</mrow>${mo(d > 0 ? '+' : '−')}</msup>` : toML(at)}</mrow></munder>`;
  const r = limit(e, x, at, dir);
  const pods: Pod[] = [];
  if (r && r.kind === 'none' && r.left && r.right) {
    const L = limText(r.left), R = limText(r.right);
    pods.push({ title: 'Granica', rows: [textRow('Granica nie istnieje: granice jednostronne są różne.')] });
    pods.push({ title: 'Granice jednostronne', rows: [{ ml: M(`${head(-1)}${toML(e)}${mo('=')}${L.ml}`), text: `lewostronna: ${L.text}` }, { ml: M(`${head(1)}${toML(e)}${mo('=')}${R.ml}`), text: `prawostronna: ${R.text}` }] });
  } else {
    const t = limText(r);
    pods.push({ title: 'Granica', rows: [{ ml: M(`${head(dir)}${toML(e)}${mo('=')}${t.ml}`), text: t.text, note: t.value && isConstant(t.value) && !isNum(t.value) && !infSign(t.value) ? shortApprox(t.value) : undefined }], note: r ? 'Wynik sprawdzony numerycznie.' : 'Żadna z metod (szereg, reguła de l’Hospitala) nie rozstrzygnęła tej granicy.' });
    pods.push(...limitPlot(e, x, at, [[dir, r]]));
    if (t.value) return { pods, value: ex(t.value) };
    return { pods };
  }
  pods.push(...limitPlot(e, x, at, [[-1, r!.left ?? null], [1, r!.right ?? null]]));
  return { pods };
}

/** The function near the point, with where it tends: a hole at a finite limit, an asymptote at an infinite one. */
function limitPlot(e: Expr, x: string, at: Expr, sides: [number, Lim | null][]): Pod[] {
  if (variables(e).length !== 1) return [];
  const s = infSign(at), A = s ? 0 : approx(at).re;
  if (!Number.isFinite(A)) return [];
  const holes: { x: number; y: number; kind: MarkKind; label: string }[] = [], vlines: number[] = [], refs: { x?: number; y?: number; label: string }[] = [];
  for (const [d, l] of sides) {
    if (!l) continue;
    const L = l.kind === 'fin' ? approx(simplify(l.v)).re : NaN, side = d < 0 ? 'lewostronna ' : d > 0 ? 'prawostronna ' : '';
    if (s && Number.isFinite(L)) refs.push({ y: L, label: `y = ${fmt(L)}` });
    else if (!s && Number.isFinite(L)) holes.push({ x: A, y: L, kind: 'hole', label: `granica ${side}= ${fmt(L)}` });
    else if (!s && l.kind === 'inf' && !vlines.length) vlines.push(A);
  }
  const f = compileDouble(e, x), value = s ? NaN : f(A);
  const shown = Number.isFinite(value) && !holes.some(h => Math.abs(h.y - value) < 1e-9 * (1 + Math.abs(h.y)));
  const p = safe(() => plotOf([e], x, {
    range: s > 0 ? [-1, 30] : s < 0 ? [-30, 1] : [A - 4, A + 4], labels: [`y = ${toText(e)}`],
    at: [...holes, ...(shown ? [{ x: A, kind: 'point' as const, label: `wartość f(${fmt(A)}) = ${fmt(value)}` }] : [])],
    vlines, refs: [...refs, ...(s ? [] : [{ x: A, label: '' }])],
  }));
  return p ? [{ title: 'Wykres', rows: [], plot: p, note: holes.length ? 'Pusty punkt: wartość, do której zbliża się funkcja.' : undefined }] : [];
}

function taylorCommand(args: Node[], env: Env): Out {
  const e = exprArg(args[0], env);
  const x = varArg(args[1]) ?? mainVar(e);
  const at = args[2] ? exprArg(args[2], env, 'Punkt') : ZERO;
  const n = args[3] ? intArg(args[3], env, 'Rząd') : 6;
  if (n < 0 || n > 40) fail('Rząd szeregu od 0 do 40.');
  const t = taylor(e, x, at, n);
  if (!t) fail('Ta funkcja nie ma w tym punkcie rozwinięcia w szereg potęgowy (Laurenta).');
  const terms = t!.terms.map(c => simplify(c));
  const pods: Pod[] = [{ title: infSign(at) ? 'Rozwinięcie asymptotyczne' : t!.v < 0 ? `Szereg Laurenta w ${x} = ${toText(at)}` : `Szereg Taylora w ${x} = ${toText(at)}`, rows: [seriesRow(terms, sym(x), n + 1, at)] }];
  const poly = add(...terms);
  if (variables(e).length === 1 && !infSign(at)) {
    const A = approx(at).re, nz = terms.filter(t => !isZero(t));
    // a few shorter partial sums show the approximation getting better
    const cuts = [...new Set([Math.ceil(nz.length / 3), Math.ceil(2 * nz.length / 3)])].filter(j => j >= 1 && j < nz.length);
    const words = (j: number) => `${j} ${j === 1 ? 'wyraz' : j % 10 >= 2 && j % 10 <= 4 && (j % 100 < 12 || j % 100 > 14) ? 'wyrazy' : 'wyrazów'}`;
    const es = [e, poly, ...cuts.map(j => add(...nz.slice(0, j)))];
    const plot = safe(() => plotOf(es, x, {
      range: [A - 4, A + 4], at: [{ x: A, kind: 'point', label: `punkt rozwinięcia ${x} = ${fmt(A)}` }],
      labels: [`y = ${toText(e)}`, `wielomian Taylora (${words(nz.length)})`, ...cuts.map(j => `suma częściowa (${words(j)})`)],
      dash: [false, true, true, true], faint: [false, false, true, true],
    }));
    if (plot) pods.push({ title: 'Funkcja i wielomian Taylora', rows: [], plot, note: 'Im więcej wyrazów, tym dalej od punktu rozwinięcia wielomian pokrywa się z funkcją.' });
  }
  return { pods, value: ex(poly) };
}

function sumCommand(name: 'sum' | 'product', args: Node[], env: Env): Out {
  const e = exprArg(args[0], env);
  const k = varArg(args[1]) ?? (variables(e).includes('k') ? 'k' : variables(e).includes('n') ? 'n' : mainVar(e));
  if (args.length < 4) fail(`Zapisz: ${name}(wyraz; ${k}; od; do), np. sum(1/k^2; k; 1; ∞).`);
  const a = exprArg(args[2], env, 'Dolna granica'), b = exprArg(args[3], env, 'Górna granica');
  const head = `<munderover>${mo(name === 'sum' ? '∑' : '∏')}<mrow>${mi(k)}${mo('=')}${toML(a)}</mrow>${infSign(b) ? mo('∞') : toML(b)}</munderover>${toML(e)}`;
  if (name === 'product') {
    const r = prodOf(e, k, a, b);
    if (!r) fail('Nie znalazłem postaci zamkniętej tego iloczynu.');
    const v = simplify(r!);
    return { pods: [{ title: 'Iloczyn', rows: [{ ml: M(`${head}${mo('=')}${toML(v)}`), text: toText(v), note: isConstant(v) && !isNum(v) ? shortApprox(v) : undefined }] }], value: ex(v) };
  }
  const r = sumOf(e, k, a, b);
  const seq = (total?: number): Pod[] => {
    if (!isInt(a) || variables(e).some(v => v !== k) || bitLength(a.v.n) > 40) return [];
    const k0 = Number(a.v.n), k1 = infSign(b) > 0 ? Infinity : isInt(b) ? Number(b.v.n) : NaN;
    if (!(k1 >= k0)) return [];
    const p = safe(() => sequencePlot(compileDouble(e, k), k0, k1, total, `${toText(e)}`));
    return p ? [{ title: 'Wyrazy i sumy częściowe', rows: [], plot: p, note: k1 - k0 > 59 ? 'Pokazano pierwsze 60 wyrazów.' : undefined }] : [];
  };
  if (r.value) {
    const v = simplify(r.value);
    const note = r.ratio ? `Dla |${toText(r.ratio)}| < 1.` : undefined;
    const pods: Pod[] = [{ title: 'Suma', rows: [{ ml: M(`${head}${mo('=')}${toML(v)}`), text: toText(v), note: isConstant(v) && !isNum(v) ? shortApprox(v) : undefined }], note }];
    if (isConstant(v) && !isNum(v)) { const d = decimalRow(v); if (d) pods.push({ title: 'Postać dziesiętna', rows: [d] }); }
    pods.push(...seq(isConstant(v) ? approx(v).re : undefined));
    return { pods, value: ex(v) };
  }
  if (r.divergent) return { pods: [{ title: 'Suma', rows: [textRow('Szereg jest rozbieżny.')], note: r.note }, ...seq()] };
  // numeric fallback for infinite sums with geometric decay
  if (infSign(b) > 0 && isInt(a) && variables(e).length <= 1) {
    const ratio = ratioHint(e, k);
    if (ratio !== null && ratio < 0.95) {
      const f = compileDouble(e, k);
      let s = 0, c = 0, j = Number(a.v.n);
      for (let it = 0; it < 100000; it++, j++) {
        const t = f(j);
        if (!Number.isFinite(t)) break;
        const y = s + t;
        c += Math.abs(s) >= Math.abs(t) ? (s - y) + t : (t - y) + s;
        s = y;
        if (Math.abs(t) < 1e-17 * Math.max(1, Math.abs(s + c))) break;
      }
      const total = s + c;
      return { pods: [{ title: 'Suma', rows: [{ ml: M(`${head}${mo('≈')}<mn>${String(Number(total.toPrecision(14))).replace('.', ',')}</mn>`), text: String(total) }], note: 'Nie znalazłem postaci zamkniętej; wartość numeryczna (wyrazy maleją jak ciąg geometryczny, więc reszta jest pomijalna).' }, ...seq(total)] };
    }
  }
  return { pods: [{ title: 'Suma', rows: [textRow('Nie znalazłem postaci zamkniętej tej sumy.')], note: r.note }] };
}

// --- Plots on request: functions, curves F(x, y) = 0 and (x(t); y(t)) in one view ---

function plotCommand(args: Node[], env: Env): Out {
  const fns: Expr[] = [], parts: Plot[] = [], labels: string[] = [], curves: { f: Expr; vx: string; vy: string }[] = [];
  const partRows: (HandoffRow[] | undefined)[] = [];
  for (const a of args) {
    if (a.t === 'rel') {
      if (a.ops.length !== 1 || a.ops[0] !== '=') fail('Rysuję równania (ze znakiem =), np. x^2 + y^2 = 25.');
      const [l, r] = a.parts.map(p => scalar(evaluate(p, env), 'Równanie'));
      if (isSym(l, 'y') && !variables(r).includes('y') && variables(r).length <= 1) { fns.push(r); labels.push(`y = ${toText(r)}`); continue; }
      const f = sub(l, r), vs = variables(f);
      if (vs.length > 2 || !vs.length) fail('Równanie krzywej ma mieć jedną lub dwie zmienne, np. x^2 + y^2 = 25.');
      const [vx, vy] = vs.length === 2 ? twoVars(f) : vs[0] === 'y' ? ['x', 'y'] : [vs[0], 'y'];
      const p = implicitPlot([f], vx, vy, [`${toText(l)} = ${toText(r)}`], [], [[l, r]]);
      if (!p) fail(`Nie znalazłem punktów krzywej ${toText(l)} = ${toText(r)}.`);
      parts.push(p!);
      partRows.push(p!.open?.rows);
      curves.push({ f, vx, vy });
      continue;
    }
    const v = evaluate(a, env);
    if (v.t === 'list' && v.items.length === 2 && v.items.every(i => i.t === 'expr')) {
      const [ex_, ey] = v.items.map(i => (i as { e: Expr }).e), t = mainVar(add(ex_, ey));
      const periodic = /sin|cos|tan|cot/.test(toText(ex_) + toText(ey));
      const s = parametricSeries(ex_, ey, t, periodic ? 0 : -10, periodic ? 2 * Math.PI : 10, `(${toText(ex_)}; ${toText(ey)}), ${t} ∈ ${periodic ? '⟨0; 2π⟩' : '⟨−10; 10⟩'}`, 0);
      if (!s.segs.length) fail('Krzywa parametryczna nie ma punktów rzeczywistych.');
      const pts = s.segs.flat(), xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2);
      const w = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1) * 0.65, cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      parts.push({ x: [cx - w, cx + w], y: [cy - w, cy + w], equal: true, series: [s], marks: [], bands: [], vlines: [], hlines: [], refs: [], fills: [], vectors: [], shapes: [], bars: [] });
      const row = curveRow(ex_, ey, t, periodic ? 0 : -10, periodic ? 2 * Math.PI : 10, 0);
      partRows.push(row && [row]);
      continue;
    }
    const e = scalar(v, 'Wykres');
    if (variables(e).length > 1) fail(`${toText(e)} ma kilka zmiennych. Narysuję funkcję jednej zmiennej albo krzywą z równania, np. x^2 + y^2 = 25.`);
    fns.push(e);
    labels.push(`y = ${toText(e)}`);
  }
  const x = fns.length ? mainVar(add(...fns.map(f => mul(f, f)))) : 'x';
  if (fns.some(f => variables(f).some(v => v !== x))) fail('Wszystkie funkcje na jednym wykresie muszą mieć tę samą zmienną.');
  const range = parts.length ? [Math.min(...parts.map(p => p.x[0])), Math.max(...parts.map(p => p.x[1]))] as [number, number] : undefined;
  // one function: its notable points; two: where they meet; more would only clutter
  const explicit = fns.length ? plotOf(fns, x, { range, labels, find: fns.length === 1 && !curves.length ? [['zero', 'max', 'min']] : [], crossings: fns.length === 2 }) : null;
  // a graph y = g(x) meets a curve F(x, y) = 0 where F(x, g(x)) = 0
  if (explicit && range) for (const c of curves) {
    if (c.vx !== x || c.vy !== 'y') continue;
    fns.forEach((g, k) => {
      const h = compileDouble(subst(c.f, 'y', g), x), gy = compileDouble(g, x);
      for (const pt of features(h, range[0], range[1], ['zero'], 1)) {
        const Y = gy(pt.x);
        if (Number.isFinite(Y)) explicit.marks.push({ x: pt.x, y: Y, kind: 'cross', label: `punkt wspólny (${fmt(pt.x)}; ${fmt(Y)})`, color: k, series: k });
      }
    });
  }
  const plot = parts.length ? combine(explicit ? [...parts, { ...explicit, y: parts[0].y }] : parts) : explicit;
  if (!plot) fail('Nie ma czego narysować: brak wartości rzeczywistych w pobliżu zera.');
  if (parts.length && plot) {
    // series are numbered in combine's order: the pieces first, then the functions
    let base = 0;
    const rows: (HandoffRow | undefined)[] = [];
    parts.forEach((part, k) => { rows.push(...(partRows[k] ?? [undefined]).map(r => r && { ...r, series: r.series === undefined ? undefined : r.series + base, color: r.series === undefined ? r.color : r.series + base })); base += part.series.length; });
    fns.forEach((g, k) => {
      // a graph stays a graph y = f(x) next to the curves: Wykresy draws both
      const t = graphText(g, x);
      rows.push(t ? { expr: t, series: base + k, color: base + k } : undefined);
    });
    if (rows.every(Boolean)) plot.open = { mode: 'graph', rows: rows as HandoffRow[] };
  }
  return { pods: [{ title: 'Wykres', rows: [], plot: plot!, note: fns.length === 2 && !parts.length ? 'Zaznaczone są też punkty wspólne obu wykresów.' : undefined }] };
}

// --- Function analysis (badanie przebiegu zmienności funkcji) ---

function analyzeCommand(args: Node[], env: Env, onlyExtrema = false): Out {
  const e = exprArg(args[0], env, 'Funkcja');
  const x = varArg(args[1]) ?? mainVar(e);
  if (variables(e).length > 1) fail('Badam funkcje jednej zmiennej (bez parametrów).');
  const X = sym(x);
  const pods: Pod[] = [];
  const fML = `<mi>f</mi>${mo('(')}${mi(x)}${mo(')')}`;
  if (!onlyExtrema) pods.push({ title: 'Funkcja', rows: [{ ml: M(`${fML}${mo('=')}${toML(e)}`), text: `f(${x}) = ${toText(e)}` }] });
  const dom = domain(e, x);
  const inDom = (v: number) => dom.parts.some(iv => (iv.lo ? (iv.loClosed ? v >= approx(iv.lo).re : v > approx(iv.lo).re) : true) && (iv.hi ? (iv.hiClosed ? v <= approx(iv.hi).re : v < approx(iv.hi).re) : true));
  if (!onlyExtrema) pods.push({ title: 'Dziedzina', rows: [intervalRow(dom.parts, x)], note: dom.note });
  const marks: { x: number; kind: MarkKind }[] = [];
  const vlines: number[] = [], hlines: number[] = [], oblique: Expr[] = [];
  if (!onlyExtrema) {
    // zeros and the y-intercept
    const z = safe(() => solveEquation(e, x));
    const rows: Row[] = [];
    if (z && z.kind === 'list') rows.push(...solutionRows(z.sols.filter(isRealSol).filter(s => s.family || !s.approx || inDom(bfToNumber(s.approx.re))).slice(0, 12), x));
    if (z?.kind === 'list') z.sols.forEach(s => { if (!s.family && s.approx && isRealSol(s)) marks.push({ x: bfToNumber(s.approx.re), kind: 'zero' }); });
    pods.push({ title: 'Miejsca zerowe', rows: rows.length ? rows : [textRow('Brak.')], note: z?.kind === 'list' ? z.note : undefined });
    if (inDom(0)) { const y0 = safe(() => simplify(subst(e, x, ZERO))); if (y0) pods.push({ title: 'Punkt przecięcia z osią Oy', rows: [{ ml: M(`<mi>f</mi>${mo('(')}<mn>0</mn>${mo(')')}${mo('=')}${toML(y0)}`), text: `f(0) = ${toText(y0)}` }] }); }
    // parity
    const fm = subst(e, x, neg(X));
    const even = safe(() => isZero(expand(cancel(together(sub(fm, e)))))), odd = safe(() => isZero(expand(cancel(together(add(fm, e))))));
    const symDom = dom.parts.every(iv => dom.parts.some(jv => (iv.lo ? jv.hi && same(simplify(neg(iv.lo)), jv.hi) : !jv.hi) && (iv.hi ? jv.lo && same(simplify(neg(iv.hi)), jv.lo) : !jv.lo)));
    pods.push({ title: 'Parzystość', rows: [textRow(!symDom ? 'Ani parzysta, ani nieparzysta (dziedzina nie jest symetryczna).' : even ? 'Funkcja parzysta: f(−x) = f(x).' : odd ? 'Funkcja nieparzysta: f(−x) = −f(x).' : 'Ani parzysta, ani nieparzysta.')] });
    // limits at the ends and asymptotes
    const asym: Row[] = [];
    const ends: Row[] = [];
    for (const s of [-1, 1] as const) {
      const unbounded = dom.parts.some(iv => (s < 0 ? !iv.lo : !iv.hi));
      if (!unbounded) continue;
      const L = safe(() => limit(e, x, s > 0 ? INF : neg(INF)));
      const t = limText(L);
      ends.push({ ml: M(`<munder><mi mathvariant="normal">lim</mi><mrow>${mi(x)}${mo('→')}${INF_ML(s > 0 ? '+' : '−')}</mrow></munder>${fML}${mo('=')}${t.ml}`), text: `x → ${s > 0 ? '+' : '−'}∞: ${t.text}` });
      if (L?.kind === 'fin') { asym.push({ ml: M(`<mi>y</mi>${mo('=')}${toML(simplify(L.v))}`), text: `y = ${toText(simplify(L.v))}`, note: `pozioma w ${s > 0 ? '+' : '−'}∞` }); hlines.push(approx(simplify(L.v)).re); }
      else if (L?.kind === 'inf') {
        const a = safe(() => limit(div(e, X), x, s > 0 ? INF : neg(INF)));
        if (a?.kind === 'fin' && !isZero(a.v)) {
          const b = safe(() => limit(sub(e, mul(a.v, X)), x, s > 0 ? INF : neg(INF)));
          if (b?.kind === 'fin') { const line = simplify(add(mul(a.v, X), b.v)); asym.push({ ml: M(`<mi>y</mi>${mo('=')}${toML(line)}`), text: `y = ${toText(line)}`, note: `ukośna w ${s > 0 ? '+' : '−'}∞` }); if (!oblique.some(o => same(o, line))) oblique.push(line); }
        }
      }
    }
    // vertical: finite ends of the domain and excluded points
    const pts = new Map<string, Expr>();
    for (const iv of dom.parts) for (const p of [iv.lo, iv.hi]) if (p) pts.set(toText(p), p);
    for (const p of pts.values()) {
      for (const side of [-1, 1] as const) {
        const v = approx(p).re + side * 1e-9;
        if (!inDom(v)) continue;
        const L = safe(() => limit(e, x, p, side));
        const t = limText(L);
        ends.push({ ml: M(`<munder><mi mathvariant="normal">lim</mi><mrow>${mi(x)}${mo('→')}<msup><mrow>${toML(p)}</mrow>${mo(side > 0 ? '+' : '−')}</msup></mrow></munder>${fML}${mo('=')}${t.ml}`), text: `x → ${toText(p)}${side > 0 ? '⁺' : '⁻'}: ${t.text}` });
        if (L?.kind === 'inf' && !asym.some(r => r.text === `x = ${toText(p)}`)) { asym.push({ ml: M(`${mi('x')}${mo('=')}${toML(p)}`), text: `x = ${toText(p)}`, note: 'pionowa' }); vlines.push(approx(p).re); }
      }
    }
    if (ends.length) pods.push({ title: 'Granice na krańcach dziedziny', rows: ends });
    pods.push({ title: 'Asymptoty', rows: asym.length ? asym : [textRow('Brak.')] });
  }
  // first derivative: monotonicity and extrema
  const d1 = simplify(diff(e, x));
  pods.push({ title: 'Pochodna', rows: [{ ml: M(`<msup><mi>f</mi><mo>′</mo></msup>${mo('(')}${mi(x)}${mo(')')}${mo('=')}${toML(d1)}`), text: `f′(${x}) = ${toText(d1)}` }] });
  const inc = safe(() => intersect(solveInequality(d1, '>', x).parts, dom.parts));
  const dec = safe(() => intersect(solveInequality(d1, '<', x).parts, dom.parts));
  if (inc && dec) {
    pods.push({ title: 'Monotoniczność', rows: [
      { ...intervalRow(inc, x), note: 'rosnąca (f′ > 0)' }, { ...intervalRow(dec, x), note: 'malejąca (f′ < 0)' },
    ], note: 'Na każdym z przedziałów osobno.' });
  }
  const crit = safe(() => solveEquation(d1, x));
  const extrema: Row[] = [];
  if (crit && crit.kind === 'list') {
    for (const s of crit.sols) {
      if (s.family || !s.approx || !isRealSol(s)) continue;
      const v = bfToNumber(s.approx.re);
      if (!inDom(v)) continue;
      const h = 1e-6 * Math.max(1, Math.abs(v));
      const g = compileDouble(d1, x);
      let l = g(v - h), r = g(v + h);
      // f′ of x⁶⁰ at ±10⁻⁶ is 0 in doubles (underflow): then its exact sign there
      if (s.exact && (!l || !r || !Number.isFinite(l) || !Number.isFinite(r))) {
        const sign = (t: Expr) => safe(() => bfSign(evalC(subst(d1, x, t), 200).re)) ?? 0;
        const H = num(q(1n, 1000000n));
        l = sign(sub(s.exact, H)); r = sign(add(s.exact, H));
      }
      let kind = '';
      if (l > 0 && r < 0) kind = 'maksimum lokalne'; else if (l < 0 && r > 0) kind = 'minimum lokalne'; else continue;
      const at = s.exact ?? null;
      const y = at ? safe(() => simplify(subst(e, x, at))) : null;
      marks.push({ x: v, kind: kind.startsWith('maks') ? 'max' : 'min' });
      extrema.push(at && y
        ? { ml: M(`${mi(x)}${mo('=')}${toML(at)}${mo(',')}<mspace width="0.4em"/><mi>f</mi>${mo('(')}${toML(at)}${mo(')')}${mo('=')}${toML(y)}`), text: `${kind}: ${x} = ${toText(at)}, f = ${toText(y)}`, note: kind + (isNum(y) ? '' : ` (${shortApprox(y)})`) }
        : { ml: M(`${mi(x)}${mo('≈')}<mn>${v.toPrecision(12).replace('.', ',')}</mn>`), text: `${kind}: x ≈ ${v}`, note: kind });
    }
  }
  pods.push({ title: 'Ekstrema lokalne', rows: extrema.length ? extrema : [textRow('Brak.')] });
  if (!onlyExtrema) {
    const d2 = safe(() => simplify(diff(d1, x)));
    if (d2) {
      pods.push({ title: 'Druga pochodna', rows: [{ ml: M(`<msup><mi>f</mi><mo>″</mo></msup>${mo('(')}${mi(x)}${mo(')')}${mo('=')}${toML(d2)}`), text: `f″(${x}) = ${toText(d2)}` }] });
      const cu = safe(() => intersect(solveInequality(d2, '>', x).parts, dom.parts));
      const cd = safe(() => intersect(solveInequality(d2, '<', x).parts, dom.parts));
      if (cu && cd) pods.push({ title: 'Wypukłość', rows: [{ ...intervalRow(cu, x), note: 'wypukła (f″ > 0)' }, { ...intervalRow(cd, x), note: 'wklęsła (f″ < 0)' }] });
      const infl = safe(() => solveEquation(d2, x));
      const rows: Row[] = [];
      if (infl && infl.kind === 'list') {
        const g = compileDouble(d2, x);
        for (const s of infl.sols) {
          if (s.family || !s.approx || !isRealSol(s)) continue;
          const v = bfToNumber(s.approx.re);
          if (!inDom(v)) continue;
          const h = 1e-6 * Math.max(1, Math.abs(v));
          if (Math.sign(g(v - h)) === Math.sign(g(v + h))) continue;
          marks.push({ x: v, kind: 'inflection' });
          rows.push(s.exact ? { ml: M(`${mi(x)}${mo('=')}${toML(s.exact)}`), text: `${x} = ${toText(s.exact)}`, note: isNum(s.exact) ? undefined : shortApprox(s.exact) } : { ml: M(`${mi(x)}${mo('≈')}<mn>${v.toPrecision(12).replace('.', ',')}</mn>`), text: `${x} ≈ ${v}` });
        }
      }
      pods.push({ title: 'Punkty przegięcia', rows: rows.length ? rows : [textRow('Brak.')] });
    }
  }
  const plot = safe(() => plotOf([e, ...oblique], x, {
    at: marks, vlines, hlines: hlines.filter(Number.isFinite), find: [['zero', 'max', 'min']],
    labels: [`f(${x}) = ${toText(e)}`, ...oblique.map(o => `asymptota ukośna y = ${toText(o)}`)], dash: [false, ...oblique.map(() => true)],
  }));
  if (plot) pods.push({ title: 'Wykres', rows: [], plot, note: 'Zaznaczone: miejsca zerowe, ekstrema, punkty przegięcia i asymptoty.' });
  if (!onlyExtrema) {
    const d2 = safe(() => simplify(diff(d1, x)));
    const dp = safe(() => plotOf(d2 ? [d1, d2] : [d1], x, { range: plot?.x, find: [['zero'], ['zero']], labels: [`f′(${x}) = ${toText(d1)}`, ...(d2 ? [`f″(${x}) = ${toText(d2)}`] : [])] }));
    if (dp) pods.push({ title: 'Wykres pochodnych', rows: [], plot: dp, note: 'Znak f′ mówi, gdzie f rośnie, a gdzie maleje; znak f″ – gdzie jest wypukła, a gdzie wklęsła.' });
  }
  return { pods };
}

const isInf = (e: Expr) => infSign(e) !== 0;
const isOneE = (e: Expr) => isNum(e) && e.v.n === 1n && e.v.d === 1n;
