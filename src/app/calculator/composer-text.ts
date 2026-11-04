/**
 * The calculator field's text, DOM-free: lines joined into one query, symbols typed the long way made pretty
 * (<= → ≤, pi → π), and templates with empty places (slots) that Tab walks through. The parser reads every
 * pretty symbol back (parse.ts normalize), so what is shown is what is computed.
 */

/** The field's lines as one query: a new line inside ( ) or { } is a comma, elsewhere a semicolon (a row of a matrix, the next equation of a system). */
export function oneLine(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let out = lines[0] ?? '';
  for (const line of lines.slice(1)) {
    const stack: string[] = [];
    for (const c of out) {
      if ('([{'.includes(c)) stack.push(c);
      else if (')]}'.includes(c)) stack.pop();
    }
    const top = stack[stack.length - 1];
    // a line that already ends or begins with a separator, or right after an opening bracket, needs none
    const sep = /[,;([{]$/.test(out) || /^[,;)\]}]/.test(line) ? ' ' : top === '(' || top === '{' ? ', ' : '; ';
    out += sep + line;
  }
  return out;
}

/** An automatic replacement, so Backspace right after it can give the typed text back. */
export interface Replacement { at: number; from: string; to: string }

const SYMBOLS: [string, string][] = [['<=', '≤'], ['>=', '≥'], ['!=', '≠'], ['->', '→']];
const WORDS: Record<string, string> = { pi: 'π', inf: '∞', sqrt: '√', alpha: 'α', beta: 'β', theta: 'θ', lambda: 'λ', omega: 'ω' };
const WORD = new RegExp(String.raw`(^|[^\p{L}_\\])(${Object.keys(WORDS).join('|')})([^\p{L}\d_])$`, 'u');

/**
 * After one character typed at `caret`: the long spelling just finished, made pretty. Words are replaced only once
 * they end (pierwiastek stays a word); LaTeX and text in quotes are left alone.
 */
export function prettify(text: string, caret: number): { text: string; caret: number; undo: Replacement } | null {
  const before = text.slice(0, caret);
  if (/^\s*\\/.test(text) || (before.match(/"/g)?.length ?? 0) % 2) return null;
  const swap = (at: number, from: string, to: string) => ({ text: text.slice(0, at) + to + text.slice(at + from.length), caret: caret - from.length + to.length, undo: { at, from, to } });
  for (const [from, to] of SYMBOLS) if (before.endsWith(from)) return swap(caret - 2, from, to);
  // x*y → x·y; not .* (element by element) and not a second * (** is a power)
  if (before.endsWith('*') && !/[.*·]$/.test(before.slice(0, -1))) return swap(caret - 1, '*', '·');
  const m = before.match(WORD);
  if (m) return swap(caret - m[2].length - m[3].length, m[2], WORDS[m[2]]);
  return null;
}

const SUPER: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
const sup = (s: string) => [...s].map(c => SUPER[c]).join('');

/**
 * A formula written as text (a plot's legend, "Rozumiem jako: …") the way it is read: x^3 - 1 → x³ − 1,
 * 2*x → 2·x, sqrt(x) → √(x), <= → ≤. Only whole integer powers become superscripts; x^(1/2) stays as it is.
 */
export function prettyText(text: string): string {
  return text
    .replace(/\^\(?(-?\d{1,3})\)?(?![\d.(/])/g, (_, n: string) => sup(n))
    .replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/!=/g, '≠').replace(/->/g, '→')
    .replace(/(?<![.*])\*(?!\*)/g, '·')
    .replace(/-/g, '−')
    .replace(/(?<![\p{L}\\_])sqrt(?![\p{L}\d_])/gu, '√')
    .replace(/(?<![\p{L}\\_])pi(?![\p{L}\d_])/gu, 'π')
    .replace(/(?<![\p{L}\\_])inf(?![\p{L}\d_])/gu, '∞');
}

/** The placeholder of a template: an empty place still to be filled; Tab selects the next one. */
export const SLOT = '□';

/**
 * A template at the caret: the selection goes into its first slot. A template that starts with a slot (□^2) takes
 * what stands just before the caret instead, when there is something (x → x²). Returns the text to insert and the
 * range to select in it (the first slot left empty), relative to the start of the insertion.
 */
export function fillTemplate(template: string, selected: string, before = ''): { text: string; select: [number, number] } {
  if (template.startsWith(SLOT) && !selected && /[\p{L}\d)\]}|!'²³]$/u.test(before)) template = template.slice(1);
  let text = template;
  const first = text.indexOf(SLOT);
  if (selected && first >= 0) {
    // x + 1 into □^2 is (x + 1)^2; into √(□) or a function's argument it needs nothing
    const enclosed = /[([{|]$/.test(text.slice(0, first)) || /^(\s|$)/.test(text.slice(first + 1));
    const piece = !enclosed && !/^[\p{L}\d.]+$/u.test(selected) && !/^\(.*\)$/.test(selected) ? `(${selected})` : selected;
    text = text.slice(0, first) + piece + text.slice(first + 1);
    const next = text.indexOf(SLOT, first + piece.length);
    return { text, select: next >= 0 ? [next, next + 1] : [text.length, text.length] };
  }
  if (!selected && /[\p{L}\d]$/u.test(before) && /^\p{L}{2}/u.test(text)) text = ` ${text}`;
  const at = text.indexOf(SLOT);
  return { text, select: at >= 0 ? [at, at + 1] : [text.length, text.length] };
}

/** The next empty slot after the selection (or the one before it), round the end; null when there is none. */
export function nextSlot(text: string, from: number, to: number, back = false): number | null {
  if (!text.includes(SLOT)) return null;
  if (back) {
    const k = text.lastIndexOf(SLOT, from - 1);
    return k >= 0 ? k : text.lastIndexOf(SLOT);
  }
  const k = text.indexOf(SLOT, to);
  return k >= 0 ? k : text.indexOf(SLOT);
}

/** A name the preview reads in an empty slot; it is drawn as an empty box. */
export const SLOT_NAME = 'slotbox';
/** The text with its empty slots read as the placeholder name, for the preview only. */
export const withSlots = (text: string) => text.replaceAll(SLOT, ` ${SLOT_NAME} `);
