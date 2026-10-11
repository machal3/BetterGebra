import { compiled } from '../model';
import { commit, state } from '../state';
import { $, fillRange, h } from './dom';

interface Row { el: HTMLElement; slider: HTMLInputElement; input: HTMLInputElement; error: HTMLElement }
const rows = new Map<string, Row>();
let onSlide: () => void = () => {};

/** The slider spans at least −10…10 and grows to include the typed value. */
function fitSlider(slider: HTMLInputElement, value: number): void {
  slider.min = String(Math.min(-10, Math.floor(value)));
  slider.max = String(Math.max(10, Math.ceil(value)));
  slider.value = String(value);
  fillRange(slider);
}

function createRow(name: string): Row {
  const id = `parameter-${name}`;
  const slider = h('input', { type: 'range', step: 0.1, 'aria-label': `Suwak parametru ${name}` });
  const input = h('input', { id, type: 'number', step: 'any', inputmode: 'decimal', 'aria-describedby': `${id}-error` });
  const error = h('p', { class: 'error', id: `${id}-error`, role: 'alert' });
  const el = h('div', { class: 'parameter' }, h('label', { for: id, class: 'parameter-name' }, h('i', {}, name), ' ='), slider, input, error);
  input.value = String(state.params[name]);
  fitSlider(slider, state.params[name]);
  const apply = (v: number) => { state.params[name] = v; onSlide(); commit('params'); };
  input.addEventListener('input', () => {
    const v = input.valueAsNumber, valid = Number.isFinite(v);
    input.setAttribute('aria-invalid', String(!valid));
    error.textContent = valid ? '' : 'Podaj liczbę. Wykres zachowuje ostatnią poprawną wartość.';
    if (!valid) return;
    fitSlider(slider, v);
    apply(v);
  });
  slider.addEventListener('input', () => {
    input.value = slider.value;
    input.setAttribute('aria-invalid', 'false');
    error.textContent = '';
    fillRange(slider);
    apply(slider.valueAsNumber);
  });
  return { el, slider, input, error };
}

/** Shows a slider for every parameter some function uses, in alphabetical order. */
export function syncParameters(): void {
  const names = [...new Set(state.functions.flatMap(f => compiled(f, state.mode, state.params).parameters))].sort();
  const container = $('parameter-list');
  for (const [name, row] of rows) if (!names.includes(name)) { row.el.remove(); rows.delete(name); }
  names.forEach((name, i) => {
    let row = rows.get(name);
    if (!row) { row = createRow(name); rows.set(name, row); }
    if (container.children[i] !== row.el) container.insertBefore(row.el, container.children[i] ?? null);
  });
  $('parameters-empty').hidden = names.length > 0;
}

export function initParameters(slide: () => void): void {
  onSlide = slide;
  syncParameters();
}
