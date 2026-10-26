/**
 * What the calculator can do with a row of the Wykresy panel, written in the calculator's notation. Pure: the
 * Wykresy panel offers it, tests check it against the engine.
 */
import { RELATION, type Params } from './math';
import { tokenize } from './math/parser';
import { rowKind } from './model';
import type { FnState, Mode } from './state';

/**
 * The row in the calculator's notation: parameters replaced by their slider values (a·sin(b·x) with a = 2, b = 3
 * → (2) sin 3 x), decimal commas as points, the "y =" prefix dropped. The calculator works without parameters.
 */
function calculatorText(expression: string, params: Params, keep: string[]): string {
  const toks = tokenize(expression.replace(/^\s*(?:[wy]|[a-z]\s*\(\s*[xz]\s*\))\s*=(?![=<>])/i, ''));
  return toks.map((t, i) => {
    if (/^\d+,\d+(?:e[+-]?\d+)?$/i.test(t)) return t.replace(',', '.');
    if (/^[a-z]$/.test(t) && ![...keep, 'e', 'i'].includes(t) && Object.hasOwn(params, t)) {
      const v = params[t];
      const prev = toks[i - 1];
      // right after a function name, (3) would be read as its whole argument: sin ax → sin 3 x, not sin(3)·x
      if (prev && /^[a-z]{2,}$/.test(prev)) return String(v);
      return `(${v})`;
    }
    return t;
  }).join(' ');
}
/** Each side in the calculator's notation, the comparisons between them kept. */
const sidesText = (text: string, params: Params, keep: string[]) =>
  text.split(RELATION).map((part, k) => (k % 2 ? ` ${part} ` : calculatorText(part.trim(), params, keep))).join('');

/**
 * What the calculator can do with a row, or null: study a graph y = f(x); draw a curve or region in x and y with
 * its points (x² + y² = 25, y > x²); find the zeros of f(z); solve an equation in z (z² = −1).
 */
export function calculatorQuery(f: FnState, mode: Mode, params: Params): { label: string; title: string; query: string } | null {
  const text = f.expression.trim();
  if (!text) return null;
  try {
    if (mode === 'complex') {
      return { label: 'Miejsca zerowe w kalkulatorze', title: 'Dokładne rozwiązania f(z) = 0, także zespolone, z wykresem na płaszczyźnie', query: `${calculatorText(text, params, ['z'])} = 0` };
    }
    const kind = rowKind(text);
    if (kind.kind === 'graph') {
      return { label: 'Zbadaj w kalkulatorze', title: 'Pełne badanie przebiegu zmienności: dziedzina, granice, asymptoty, monotoniczność, ekstrema, wypukłość — dokładnie', query: `badanie funkcji ${calculatorText(text, params, ['x'])}` };
    }
    if (kind.xy) {
      const equation = !/<|>|≤|≥|≠/.test(text);
      return {
        label: equation ? 'Rozwiąż w kalkulatorze' : 'Obszar w kalkulatorze',
        title: equation ? 'Krzywa z dokładnymi rozwiązaniami równania' : 'Obszar spełniający nierówność, z brzegiem',
        query: sidesText(kind.text, params, ['x', 'y']),
      };
    }
    // a set in z: only an equation (z² = −1); not inequalities, |z|, Re, Im, nor numbers with unknowns (t + 2i)
    const parts = kind.text.split(RELATION).map(t => t.trim());
    if (parts.length !== 3 || parts[1] !== '=' || text.includes('|')) return null;
    const allToks = [...tokenize(parts[0]), ...tokenize(parts[2])];
    if (allToks.some(t => ['re', 'im', 'arg', 'conj', 'abs'].includes(t))) return null;
    if (!allToks.includes('z')) return null;
    if (/^z$/i.test(parts[0]) && !tokenize(parts[2]).includes('z')) return null;
    if (/^z$/i.test(parts[2]) && !tokenize(parts[0]).includes('z')) return null;
    return { label: 'Rozwiąż w kalkulatorze', title: 'Dokładne rozwiązania równania, także zespolone', query: `${calculatorText(parts[0], params, ['z'])} = ${calculatorText(parts[2], params, ['z'])}` };
  } catch {
    return null;
  }
}
