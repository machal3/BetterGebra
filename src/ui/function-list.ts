/**
 * The list of function cards. Rows are keyed by function id and reused, so typing never loses focus or caret,
 * and every visual detail is derived from state in sync() — handlers only change state and commit.
 */
import { expressionMathML, relationMathML } from '../math';
import { compiled } from '../model';
import { domainText } from '../format';
import { MAX_FUNCTIONS, PALETTE, addFunction, commit, removeFunction, setActive, state, type Dash, type FnState } from '../state';
import { $, ICONS, fillRange, h, setHTML, toast } from './dom';

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
let openSettings: number | null = null;
const list = () => $<HTMLOListElement>('function-list');

const PREFIX = { graph: 'y =', trig: 'y =', complex: 'f(z) =', set: '' };
const PLACEHOLDER = {
  graph: ['np. x^2 − 2', 'np. sin(x)'], trig: ['np. sin(x)', 'np. 2cos(x/2)'],
  complex: ['np. z^2 + 1', 'np. exp(z)'], set: ['np. |z − 1| <= 2', 'np. t + 2i'],
};

export function addAndFocus(after?: FnState): void {
  const f = addFunction('', {}, after);
  if (!f) { toast(`Możesz porównywać do ${MAX_FUNCTIONS} funkcji naraz.`); return; }
  syncList();
  rows.get(f.id)?.input.focus();
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
  const more = h('button', { class: 'icon-button small fn-more', type: 'button', 'aria-expanded': 'false', 'aria-controls': `fn-settings-${f.id}`, html: ICONS.sliders, title: 'Dziedzina, kolor, linia' });
  const removeButton = h('button', { class: 'icon-button small fn-remove', type: 'button', html: ICONS.trash, title: 'Usuń' });
  const error = h('p', { class: 'fn-error', id: `fn-error-${f.id}`, role: 'alert' });
  const domain = h('p', { class: 'fn-domain' });
  const settings = h('div', { class: 'fn-settings', id: `fn-settings-${f.id}`, hidden: true });
  const field = h('label', { class: 'fn-field' }, prefix, input, math);
  const el = h('li', { class: 'fn-card', 'data-id': f.id }, h('div', { class: 'fn-main' }, swatch, field, more, removeButton), error, domain, settings);
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
  more.addEventListener('click', () => {
    openSettings = openSettings === f.id ? null : f.id;
    if (openSettings === f.id) setActive(f.id);
    syncList();
  });
  // Clicking anywhere on the card makes it the analysed one.
  el.addEventListener('pointerdown', () => setActive(f.id));
  return row;
}

/** Inline settings: domain, colour, line. Built on first open. */
function buildSettings(f: FnState, row: Row): void {
  const id = (s: string) => `fn-${f.id}-${s}`;
  const endInput = (which: 'from' | 'to') => {
    const input = h('input', { type: 'number', step: 'any', inputmode: 'decimal', id: id(which), placeholder: which === 'from' ? '−∞' : '+∞' });
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
  row.settings.append(domain, colors, line, h('div', { class: 'setting-actions' }, duplicate, del));

  const readEnds = () => {
    const a = from.value === '' ? -Infinity : from.valueAsNumber, b = to.value === '' ? Infinity : to.valueAsNumber;
    const valid = !Number.isNaN(a) && !Number.isNaN(b) && a < b;
    domainError.textContent = valid ? '' : 'Początek przedziału musi być mniejszy niż koniec.';
    if (valid) { f.from = a; f.to = b; commit('style'); }
  };
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
    const copy = addFunction(expression, { from: a, to: b, fromOpen, toOpen, width: w, dash }, f);
    if (!copy) toast(`Możesz porównywać do ${MAX_FUNCTIONS} funkcji naraz.`);
  });
  del.addEventListener('click', () => remove(f));

  row.sync = () => {
    const mode = state.mode, c = compiled(f, mode, state.params);
    const unknowns = c.set?.kind === 'parametric' ? c.set.unknowns : null;
    domain.hidden = mode === 'complex' || (mode === 'set' && !unknowns?.length);
    line.hidden = mode === 'complex'; // the plane is coloured, no line is drawn
    domainTitle.textContent = mode === 'set' ? `Zakres ${unknowns?.join(', ') ?? ''}` : 'Dziedzina';
    preview.value = domainText(f, mode === 'set' ? unknowns?.join(', ') ?? 't' : 'x');
    // Don't overwrite what's being typed (e.g. "-" or "1e").
    if (document.activeElement !== from) from.value = Number.isFinite(f.from) ? String(f.from) : '';
    if (document.activeElement !== to) to.value = Number.isFinite(f.to) ? String(f.to) : '';
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
  row.prefix.textContent = PREFIX[mode];
  row.prefix.hidden = !PREFIX[mode];
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
    try { math = mode === 'set' ? relationMathML(f.expression) : expressionMathML(f.expression); } catch { math = ''; }
  }
  row.el.classList.toggle('typeset', !!math);
  setHTML(row.math, math);
  const unknowns = c.set?.kind === 'parametric' ? c.set.unknowns : null;
  const bounded = Number.isFinite(f.from) || Number.isFinite(f.to);
  row.domain.textContent = !bounded || mode === 'complex' || (mode === 'set' && !unknowns?.length) ? '' : domainText(f, unknowns?.join(', ') ?? 'x');
  const open = openSettings === f.id;
  row.more.setAttribute('aria-expanded', String(open));
  row.more.setAttribute('aria-label', `Ustawienia funkcji ${index}`);
  row.el.querySelector('.fn-remove')!.setAttribute('aria-label', `Usuń funkcję ${index}`);
  row.el.classList.toggle('expanded', open);
  if (open && !row.sync) buildSettings(f, row);
  row.settings.hidden = !open;
  if (open) row.sync!();
}

/** Reconciles the DOM with state.functions: creates, removes and orders rows without rebuilding existing ones. */
export function syncList(): void {
  const ol = list(), ids = new Set(state.functions.map(f => f.id));
  for (const [id, row] of rows) if (!ids.has(id)) { row.el.remove(); rows.delete(id); if (openSettings === id) openSettings = null; }
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

