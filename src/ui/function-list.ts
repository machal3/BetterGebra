/**
 * The list of function cards. Rows are keyed by function id and reused, so typing never loses focus or caret,
 * and every visual detail is derived from state in sync() — handlers only change state and commit.
 */
import { RELATION, constant, expressionMathML, relationMathML, type Params } from '../math';
import { tokenize } from '../math/parser';
import { compiled, rowKind } from '../model';
import { domainText, symbolic } from '../format';
import { MAX_FUNCTIONS, PALETTE, addFunction, commit, removeFunction, setActive, state, type Dash, type FnState, type Mode } from '../state';
import { $, FI, ICONS, fillRange, h, setHTML, toast } from './dom';

interface Row {
  el: HTMLLIElement;
  input: HTMLInputElement;
  prefix: HTMLElement;
  math: HTMLElement;
  swatch: HTMLButtonElement;
  more: HTMLButtonElement;
  error: HTMLElement;
  domain: HTMLElement;
  settings: HTMLElement;
  editing: boolean;
  sync?: () => void;
}

const rows = new Map<number, Row>();
const list = () => $<HTMLOListElement>('function-list');

const PREFIX = { graph: 'y =', complex: 'f(z) =' };
/** The second row on suggests what else Wykresy draws: sets in x and y, and on the complex plane. */
const PLACEHOLDER = {
  graph: ['np. x^2 − 2', 'np. sin(x), y > x^2, |z − 1| <= 2'],
  complex: ['np. z^2 + 1', 'np. exp(z)'],
};

export function addAndFocus(after?: FnState): void {
  const f = addFunction('', {}, after);
  if (!f) { toast(`Możesz porównywać do ${MAX_FUNCTIONS} funkcji naraz.`); return; }
  syncList();
  rows.get(f.id)?.input.focus();
}

/**
 * The row in the calculator's notation: parameters replaced by their slider values (a·sin(b·x) with a = 2, b = 3
 * → (2) sin((3) x)), decimal commas as points, the "y =" prefix dropped. The calculator works without parameters.
 */
function calculatorText(expression: string, params: Params, keep: string[]): string {
  return tokenize(expression.replace(/^\s*(?:y|[a-z]\s*\(\s*x\s*\))\s*=/i, ''))
    .map(t => /^\d+,\d+$/.test(t) ? t.replace(',', '.') : /^[a-z]$/.test(t) && ![...keep, 'e', 'i'].includes(t) && Object.hasOwn(params, t) ? `(${params[t]})` : t)
    .join(' ');
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
      return { label: 'Miejsca zerowe w kalkulatorze', title: 'Dokładne rozwiązania f(z) = 0, także zespolone, z wykresem na płaszczyźnie', query: `${calculatorText(text.replace(/^\s*(?:w|f\s*\(\s*z\s*\))\s*=/i, ''), params, ['z'])} = 0` };
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
    if (parts.length !== 3 || parts[1] !== '=' || /\||\b(?:re|im|arg|conj)\b/i.test(kind.text)) return null;
    if (!/z/i.test(parts[0]) || !/z/i.test(kind.text.replace(/^\s*z\s*=/i, ''))) return null;
    return { label: 'Rozwiąż w kalkulatorze', title: 'Dokładne rozwiązania równania, także zespolone', query: `${calculatorText(parts[0], params, ['z'])} = ${calculatorText(parts[2], params, ['z'])}` };
  } catch {
    return null;
  }
}

function remove(f: FnState): void {
  const index = state.functions.indexOf(f), wasFocused = rows.get(f.id)?.el.contains(document.activeElement);
  removeFunction(f.id);
  syncList();
  if (wasFocused) {
    const next = state.functions[Math.max(0, index - 1)];
    rows.get(next.id)?.input.focus();
  }
}

function focusRow(index: number): void {
  const f = state.functions[index];
  if (!f) return;
  const input = rows.get(f.id)!.input;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function createRow(f: FnState): Row {
  const input = h('input', { class: 'fn-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'next', 'aria-describedby': `fn-error-${f.id}` });
  input.value = f.expression;
  const prefix = h('span', { class: 'fn-prefix', 'aria-hidden': 'true' });
  const math = h('div', { class: 'fn-math', 'aria-hidden': 'true' });
  const swatch = h('button', { class: 'fn-swatch', type: 'button' });
  const more = h('button', { class: 'icon-button small fn-more', type: 'button', popovertarget: `fn-settings-${f.id}`, html: ICONS.sliders, title: 'Dziedzina, kolor, linia' });
  const removeButton = h('button', { class: 'icon-button small fn-remove', type: 'button', html: ICONS.trash, title: 'Usuń' });
  const error = h('p', { class: 'fn-error', id: `fn-error-${f.id}`, role: 'alert' });
  const domain = h('p', { class: 'fn-domain' });
  // A popover in the top layer: light-dismissed by a click outside or Esc. Lives in <body>, so moving rows never closes it.
  const settings = h('div', { class: 'popover fn-settings', id: `fn-settings-${f.id}`, popover: 'auto', role: 'dialog' });
  document.body.append(settings);
  const field = h('label', { class: 'fn-field' }, prefix, input, math);
  const el = h('li', { class: 'fn-card', 'data-id': f.id }, h('div', { class: 'fn-main' }, swatch, field, more, removeButton), error, domain);
  const row: Row = { el, input, prefix, math, swatch, more, error, domain, settings, editing: false };

  // Clicking the typeset formula opens the raw text with the caret at the end, not wherever the hidden text was hit.
  field.addEventListener('mousedown', e => {
    if (!el.classList.contains('typeset')) return;
    e.preventDefault();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  input.addEventListener('input', () => { f.expression = input.value; commit('expr'); });
  input.addEventListener('focus', () => { row.editing = true; setActive(f.id); syncRow(f); });
  input.addEventListener('blur', () => { row.editing = false; syncRow(f); });
  input.addEventListener('keydown', e => {
    const index = state.functions.indexOf(f);
    if (e.key === 'Escape') input.blur();
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (index === state.functions.length - 1 && input.value.trim() && state.functions.length < MAX_FUNCTIONS) addAndFocus();
      else if (index < state.functions.length - 1) focusRow(index + 1);
      else input.blur();
    } else if (e.key === 'ArrowDown' && index < state.functions.length - 1) { e.preventDefault(); focusRow(index + 1); }
    else if (e.key === 'ArrowUp' && index > 0) { e.preventDefault(); focusRow(index - 1); }
    else if (e.key === 'Backspace' && !input.value && state.functions.length > 1) { e.preventDefault(); remove(f); }
  });
  swatch.addEventListener('click', () => { f.visible = !f.visible; commit('style'); });
  removeButton.addEventListener('click', () => remove(f));
  settings.addEventListener('beforetoggle', e => {
    if ((e as ToggleEvent).newState !== 'open') return;
    if (!row.sync) buildSettings(f, row);
    row.sync!();
    setActive(f.id);
  });
  settings.addEventListener('toggle', e => {
    more.classList.toggle('open', (e as ToggleEvent).newState === 'open');
    if ((e as ToggleEvent).newState === 'open') placeSettings(settings, more);
  });
  // Clicking anywhere on the card makes it the analysed one.
  el.addEventListener('pointerdown', () => setActive(f.id));
  return row;
}

/** Next to the button: to the right of the sidebar on wide screens, below it otherwise; always inside the window. */
function placeSettings(pop: HTMLElement, anchor: HTMLElement): void {
  if (matchMedia('(max-width: 760px)').matches) { pop.style.left = pop.style.top = ''; return; } // bottom sheet in CSS
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, hgt = pop.offsetHeight, gap = 8;
  const edge = anchor.closest('.sidebar')?.getBoundingClientRect().right ?? r.right;
  const right = edge + gap + w <= innerWidth - gap;
  const left = right ? edge + gap : Math.max(gap, Math.min(r.left, innerWidth - w - gap));
  const top = right ? r.top - 8 : r.bottom + 6;
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(gap, Math.min(top, innerHeight - hgt - gap))}px`;
}

/** An interval end as typed back into its field: π/2, −√2, 0.75; empty when unbounded. */
const endText = (v: number) => !Number.isFinite(v) ? '' : symbolic(v) ?? String(v);

/** Settings popover: domain, colour, line. Built on first open. */
function buildSettings(f: FnState, row: Row): void {
  const id = (s: string) => `fn-${f.id}-${s}`;
  const endInput = (which: 'from' | 'to') => {
    // Text, not type=number: ends can be constants like pi/2, −e or √2.
    const input = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', id: id(which), placeholder: which === 'from' ? '−∞' : '+∞', title: 'Liczba lub stała, np. 2, pi/2, −e, √2' });
    return input;
  };
  const bracket = (which: 'from' | 'to') => {
    const name = id(`${which}-end`), [closed, open] = which === 'from' ? ['⟨', '('] : ['⟩', ')'];
    return h('div', { class: 'brackets', role: 'radiogroup', 'aria-label': which === 'from' ? 'Początek przedziału' : 'Koniec przedziału' },
      h('label', { title: 'Domknięty: należy do przedziału' }, h('input', { type: 'radio', name, value: 'closed', 'aria-label': 'Domknięty' }), closed),
      h('label', { title: 'Otwarty: nie należy do przedziału' }, h('input', { type: 'radio', name, value: 'open', 'aria-label': 'Otwarty' }), open));
  };
  const from = endInput('from'), to = endInput('to'), fromEnds = bracket('from'), toEnds = bracket('to');
  const preview = h('output', { class: 'domain-preview' });
  const domainError = h('p', { class: 'error', role: 'alert' });
  const domainTitle = h('h4', { class: 'subhead' });
  const domain = h('div', { class: 'setting domain' },
    h('div', { class: 'setting-head' }, domainTitle, preview),
    h('div', { class: 'interval' }, h('label', { for: id('from') }, 'od'), from, fromEnds, h('label', { for: id('to') }, 'do'), to, toEnds),
    domainError);

  const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Kolor' },
    ...PALETTE.map(color => {
      const b = h('button', { type: 'button', class: 'color', 'data-color': color, 'aria-label': `Kolor ${color}`, style: `--sw:${color}` });
      b.addEventListener('click', () => { f.color = color; commit('style'); });
      return b;
    }));
  const custom = h('input', { type: 'color', 'aria-label': 'Własny kolor', title: 'Własny kolor' });
  const colors = h('div', { class: 'setting' }, h('h4', { class: 'subhead' }, 'Kolor'), h('div', { class: 'colors' }, swatches, h('label', { class: 'custom-color' }, custom)));

  const dashes = h('div', { class: 'dashes', role: 'radiogroup', 'aria-label': 'Styl linii' },
    ...([['', 'Ciągła'], ['8 6', 'Przerywana'], ['1 5', 'Kropkowana']] as [Dash, string][]).map(([value, label]) =>
      h('label', { title: label }, h('input', { type: 'radio', name: id('dash'), value, 'aria-label': label }),
        h('span', { html: `<svg viewBox="0 0 48 12" aria-hidden="true"><path d="M4 6h40" stroke-dasharray="${value}"/></svg>` }))));
  const width = h('input', { type: 'range', min: 1, max: 6, step: 0.25, 'aria-label': 'Grubość linii' });
  const widthValue = h('input', { type: 'number', min: 0.25, max: 20, step: 'any', 'aria-label': 'Grubość linii (liczba)' });
  const line = h('div', { class: 'setting' }, h('h4', { class: 'subhead' }, 'Linia'), dashes, h('div', { class: 'width-row' }, width, widthValue));

  const duplicate = h('button', { type: 'button', class: 'text-button', html: `${ICONS.copy}<span>Duplikuj</span>` });
  const del = h('button', { type: 'button', class: 'text-button danger', html: `${ICONS.trash}<span>Usuń</span>` });
  // The calculator studies the function exactly: zeros, extrema, asymptotes, monotonicity, with its own plots.
  const study = h('button', { type: 'button', class: 'text-button', title: 'Pełne badanie przebiegu zmienności w kalkulatorze', html: `${FI.search}<span>Zbadaj w kalkulatorze</span>` });
  row.settings.append(domain, colors, line, h('div', { class: 'setting-actions' }, study, duplicate, del));

  // Empty = unbounded. While a value is unfinished ("pi/", "2*") the graph keeps the last valid interval.
  const read = (input: HTMLInputElement, empty: number): number | string => {
    if (!input.value.trim()) return empty;
    try { return constant(input.value); } catch (e) { return (e as Error).message; }
  };
  const readEnds = () => {
    const a = read(from, -Infinity), b = read(to, Infinity);
    from.setAttribute('aria-invalid', String(typeof a === 'string'));
    to.setAttribute('aria-invalid', String(typeof b === 'string'));
    const problem = typeof a === 'string' ? a : typeof b === 'string' ? b : a < b ? '' : 'Początek przedziału musi być mniejszy niż koniec.';
    domainError.textContent = problem;
    if (!problem) { f.from = a as number; f.to = b as number; commit('style'); }
  };
  // On leaving a valid field, show the value in its tidy form (pi/2 → π/2).
  // Not while the interval is wrong: then the field keeps what was typed, so it can be fixed.
  const tidy = (input: HTMLInputElement, v: number) => { if (!domainError.textContent) input.value = endText(v); };
  from.addEventListener('blur', () => tidy(from, f.from));
  to.addEventListener('blur', () => tidy(to, f.to));
  from.addEventListener('input', readEnds);
  to.addEventListener('input', readEnds);
  fromEnds.addEventListener('change', e => { f.fromOpen = (e.target as HTMLInputElement).value === 'open'; commit('style'); });
  toEnds.addEventListener('change', e => { f.toOpen = (e.target as HTMLInputElement).value === 'open'; commit('style'); });
  custom.addEventListener('input', () => { f.color = custom.value; commit('style'); });
  dashes.addEventListener('change', e => { f.dash = (e.target as HTMLInputElement).value as Dash; commit('style'); });
  width.addEventListener('input', () => { f.width = width.valueAsNumber; fillRange(width); commit('style'); });
  // Typing allows thicker lines than the slider reaches; out-of-range values wait for blur, then snap back.
  widthValue.addEventListener('input', () => { const w = widthValue.valueAsNumber; if (w >= 0.25 && w <= 20) { f.width = w; commit('style'); } });
  widthValue.addEventListener('change', () => { widthValue.value = String(Number(f.width.toFixed(2))); });
  duplicate.addEventListener('click', () => {
    const { expression, from: a, to: b, fromOpen, toOpen, width: w, dash } = f;
    row.settings.hidePopover();
    const copy = addFunction(expression, { from: a, to: b, fromOpen, toOpen, width: w, dash }, f);
    if (!copy) toast(`Możesz porównywać do ${MAX_FUNCTIONS} funkcji naraz.`);
  });
  del.addEventListener('click', () => remove(f));
  study.addEventListener('click', () => {
    const q = calculatorQuery(f, state.mode, state.params);
    if (!q) return;
    row.settings.hidePopover();
    location.hash = `#kalkulator?q=${encodeURIComponent(q.query)}`;
  });

  row.sync = () => {
    const mode = state.mode, c = compiled(f, mode, state.params);
    const unknowns = c.set?.kind === 'parametric' ? c.set.unknowns : null;
    // a graph has a domain in x; a number with unknowns (t + 2i) a range of them; a condition neither
    domain.hidden = mode === 'complex' || (!!c.set && !unknowns?.length);
    line.hidden = mode === 'complex'; // the plane is coloured, no line is drawn
    domainTitle.textContent = c.set ? `Zakres ${unknowns?.join(', ') ?? ''}` : 'Dziedzina';
    preview.value = domainText(f, c.set ? unknowns?.join(', ') ?? 't' : 'x');
    // Don't overwrite what's being typed (e.g. "-" or "1e").
    if (document.activeElement !== from && !domainError.textContent) from.value = endText(f.from);
    if (document.activeElement !== to && !domainError.textContent) to.value = endText(f.to);
    for (const [end, group] of [['from', fromEnds], ['to', toEnds]] as const) {
      const finite = Number.isFinite(f[end]), open = !finite || f[`${end}Open`];
      for (const r of group.querySelectorAll('input')) { r.disabled = !finite; r.checked = (r.value === 'open') === open; }
      group.title = finite ? '' : 'Nieskończoność: zawsze otwarty';
    }
    for (const b of swatches.children) (b as HTMLElement).setAttribute('aria-pressed', String((b as HTMLElement).dataset.color === f.color));
    custom.value = f.color;
    for (const r of dashes.querySelectorAll('input')) r.checked = r.value === f.dash;
    width.value = String(Math.min(6, f.width)); fillRange(width);
    if (document.activeElement !== widthValue) widthValue.value = String(Number(f.width.toFixed(2)));
    duplicate.disabled = state.functions.length >= MAX_FUNCTIONS;
    // only a plain y = f(x): the calculator studies functions without parameters
    // the calculator's own view of this row: exact study, zeros of f(z), an equation solved
    const q = c.ok ? calculatorQuery(f, mode, state.params) : null;
    study.hidden = !q;
    if (q) { study.querySelector('span')!.textContent = q.label; study.title = q.title; }
  };
}

function syncRow(f: FnState): void {
  const row = rows.get(f.id);
  if (!row) return;
  const mode = state.mode, c = compiled(f, mode, state.params), index = state.functions.indexOf(f) + 1;
  row.el.style.setProperty('--c', f.color);
  row.el.classList.toggle('active', f.id === state.activeId);
  row.el.classList.toggle('invalid', !!c.error);
  row.el.classList.toggle('hidden-fn', !f.visible);
  // "y =" only in front of a graph: a set (y > x², |z| ≤ 1) is written in full
  const prefix = c.set ? '' : PREFIX[mode];
  row.prefix.textContent = prefix;
  row.prefix.hidden = !prefix;
  row.input.placeholder = PLACEHOLDER[mode][index === 1 ? 0 : 1];
  row.input.setAttribute('aria-label', `Funkcja ${index}`);
  row.input.setAttribute('aria-invalid', String(!!c.error));
  if (row.input.value !== f.expression) row.input.value = f.expression;
  row.swatch.setAttribute('aria-pressed', String(f.visible));
  row.swatch.setAttribute('aria-label', f.visible ? `Ukryj wykres ${index}` : `Pokaż wykres ${index}`);
  row.swatch.title = f.visible ? 'Ukryj wykres' : 'Pokaż wykres';
  row.error.textContent = c.error;
  // Typeset formula when finished; the raw text while editing, empty or invalid.
  let math = '';
  if (c.ok && !row.editing) {
    try { math = c.set ? relationMathML(f.expression) : expressionMathML(f.expression); } catch { math = ''; }
  }
  row.el.classList.toggle('typeset', !!math);
  setHTML(row.math, math);
  const unknowns = c.set?.kind === 'parametric' ? c.set.unknowns : null;
  const bounded = Number.isFinite(f.from) || Number.isFinite(f.to);
  row.domain.textContent = !bounded || mode === 'complex' || (!!c.set && !unknowns?.length) ? '' : domainText(f, unknowns?.join(', ') ?? 'x');
  row.more.setAttribute('aria-label', `Ustawienia funkcji ${index}`);
  row.el.querySelector('.fn-remove')!.setAttribute('aria-label', `Usuń funkcję ${index}`);
  row.settings.setAttribute('aria-label', `Ustawienia funkcji ${index}`);
  row.settings.style.setProperty('--c', f.color);
  if (row.settings.matches(':popover-open')) row.sync!();
}

/** Reconciles the DOM with state.functions: creates, removes and orders rows without rebuilding existing ones. */
export function syncList(): void {
  const ol = list(), ids = new Set(state.functions.map(f => f.id));
  for (const [id, row] of rows) if (!ids.has(id)) { row.el.remove(); row.settings.remove(); rows.delete(id); }
  state.functions.forEach((f, i) => {
    let row = rows.get(f.id);
    if (!row) { row = createRow(f); rows.set(f.id, row); }
    if (ol.children[i] !== row.el) ol.insertBefore(row.el, ol.children[i] ?? null);
    syncRow(f);
  });
  $('function-count').textContent = `${state.functions.length} / ${MAX_FUNCTIONS}`;
  $<HTMLButtonElement>('add-function').disabled = state.functions.length >= MAX_FUNCTIONS;
}

export function initFunctionList(): void {
  $('add-function').addEventListener('click', () => addAndFocus());
  syncList();
}

