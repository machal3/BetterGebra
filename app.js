import { compile, roots, extrema, parameterNames, toMathML, intersections, exact, exactPoint, exactValue, endpoint, holes, compileComplex, complexRoots, RELATION, relationSymbol, relationMathML } from './math.js';
const parameters = Object.create(null);
const $ = id => document.getElementById(id);
const MAX = 8;
const palette = ['#2f5fd0', '#d4421e', '#1f8a5b', '#c98a0b', '#7a4cc2', '#0f8a9a', '#c43a7a', '#6f8a1a'];
const removeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
const settingsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>';
let functions = [], nextId = 1, activeId = null, marks = [], snaps = [];
let view = { min: -10, max: 10, cy: 0, ratio: 1 }, width = 0, height = 0, drag = null, pointer = null, theme = {};
const canvas = $('plot'), ctx = canvas.getContext('2d'), hoverCtx = $('hover').getContext('2d');
const format = (n, digits = 5) => Math.abs(n) < 1e-8 ? '0' : Number(n.toPrecision(digits)).toLocaleString('pl-PL', { maximumFractionDigits: digits });
// Values shown without ≈ are proven in exact arithmetic (exactPoint, exactValue). Otherwise: ≈ a recognisable form or 8 digits.
const approx = n => `≈ ${exact(n) ?? format(n, 8)}`;
// Shows fractions like 5/13 or (1 + √5)/2 stacked (MathML). Only for our own number strings.
const stacked = s => s.replace(/\(([^()]+)\)\/(\d+)|([\dπ√]+)\/(\d+)/g, (_, a, b, c, d) => `<math><mfrac><mn>${a ?? c}</mn><mn>${b ?? d}</mn></mfrac></math>`);
const list = (items, max = 6) => items.slice(0, max).join(';  ') + (items.length > max ? ';  …' : '');
// view.ratio = y units per x unit on screen: 1 draws both axes to the same scale, 1000 fits 1000x² next to x.
const scale = () => width / (view.max - view.min), yscale = () => scale() / view.ratio;
const px = x => (x - view.min) * scale();
const py = y => height / 2 - (y - view.cy) * yscale();
const fromX = x => view.min + x / scale();
const fromY = y => view.cy + (height / 2 - y) / yscale();
// Keeps both visible ranges where floats still draw them cleanly.
const fits = (range, ratio) => { const ys = height * range * ratio / width; return range >= 1e-4 && range <= 1e7 && ys >= 1e-4 && ys <= 1e12; };
const active = () => functions.find(f => f.id === activeId);
const plotted = () => functions.filter(f => f.visible && f.fn);
const complexMode = () => $('axes-mode').elements.mode.value === 'complex', setMode = () => $('axes-mode').elements.mode.value === 'set';
const mathOf = f => setMode() ? relationMathML(f.expression) : toMathML(f.expression);
// a + bi; parts as recognisable forms (√2, π/4) when exact() finds one.
function complexText([a, b], part = v => exact(v) ?? format(v, 8)) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const tiny = 1e-12 * Math.max(Math.abs(a), Math.abs(b)); if (Math.abs(a) <= tiny) a = 0; if (Math.abs(b) <= tiny) b = 0;
  const im = Math.abs(b) === 1 ? 'i' : `${part(Math.abs(b))}i`;
  return !b ? part(a) : !a ? `${b < 0 ? '−' : ''}${im}` : `${part(a)} ${b < 0 ? '−' : '+'} ${im}`;
}
// Without ≈ only when both parts are integers, i.e. float arithmetic had nothing to round.
const complexValue = (z, sure = z.every(Number.isInteger)) => { const t = complexText(z); return t === null ? 'nie istnieje' : sure ? t : `≈ ${t}`; };

// Slider fill: where the thumb (--p) and zero (--z) sit along the range, for the CSS track gradient.
const fillRange = el => {
  const at = v => Math.min(1, Math.max(0, (v - el.min) / (el.max - el.min) || 0));
  el.style.setProperty('--p', at(el.value)); el.style.setProperty('--z', at(0));
};
document.addEventListener('input', e => { if (e.target.type === 'range') fillRange(e.target); });
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').classList.remove('visible'), 2600); }
function readTheme() { const s = getComputedStyle(document.documentElement); for (const k of ['plot-bg', 'grid-minor', 'grid-major', 'axis', 'label']) theme[k] = s.getPropertyValue(`--${k}`).trim(); }

// --- Function list ---
function setExpression(f, expression) {
  f.expression = expression;
  f.parameters = [];
  if (!expression.trim()) { f.fn = null; f.error = ''; return; }
  try {
    if (setMode()) return defineSet(f, expression);
    // On the complex plane i is the imaginary unit and z the variable, not parameters.
    const names = parameterNames(expression); f.complex = names.some(n => n === 'i' || n === 'z');
    f.parameters = complexMode() ? names.filter(n => n !== 'i' && n !== 'z') : names;
    f.cfn = compileComplex(expression, parameters);
    // Without i, z is just the variable: tan(z) is tan(x) on the real axis, so real values and zeros can be proven from it.
    f.real = complexMode() && !names.includes('i') ? expression.replace(/z/gi, 'x') : expression;
    for (const name of f.parameters) if (!Object.hasOwn(parameters, name)) parameters[name] = 1;
    // Outside the chosen interval the graph doesn't exist: plot, roots and hover all see NaN there.
    const fn = compile(f.real, parameters); f.fn = x => x < f.from || x > f.to || (f.fromOpen && x === f.from) || (f.toOpen && x === f.to) ? NaN : fn(x); f.error = '';
  } catch (e) { f.fn = null; f.error = e.message; }
}
// A set of complex numbers: a condition on z (|z − 1| ≤ 2, 1 < Re z < 3, z² = −1)
// or a number with real unknowns (t + 2i, z = a + a²i, a + bi) showing everywhere it can land.
function defineSet(f, expression) {
  let parts = expression.split(RELATION).map(s => s.trim());
  if (parts.length === 3 && /^z$/i.test(parts[0]) && parts[1] === '=' && !parameterNames(parts[2]).includes('z')) parts = [parts[2]];
  const sides = parts.filter((_, k) => k % 2 === 0);
  if (sides.some(p => !p)) throw Error('Uzupełnij obie strony warunku, np. |z − 1| ≤ 2.');
  if (parts.length === 1) {
    const names = parameterNames(parts[0]).filter(n => n !== 'i'), values = {}, cf = compileComplex(parts[0], values);
    if (names.includes('z')) throw Error('Dopisz warunek dla z, np. |z − 1| ≤ 2, albo wpisz liczbę z niewiadomymi, np. t + 2i.');
    // x is an unknown too (x + yi). It is the expression's variable, so its value goes in as cf's argument.
    const usesX = String(cf([0, 0])) !== String(cf([1.3, 0])), unknowns = usesX ? ['x', ...names] : names;
    if (unknowns.length > 2) throw Error('Najwyżej dwie niewiadome, np. a + bi.');
    f.set = { unknowns, at: (...ts) => { names.forEach((n, k) => values[n] = ts[k + usesX]); return cf([usesX ? ts[0] : 0, 0]); } };
  } else {
    // Other letters stay parameters with sliders: |z − a| < r.
    f.parameters = [...new Set(sides.flatMap(parameterNames))].filter(n => n !== 'i' && n !== 'z');
    for (const name of f.parameters) if (!Object.hasOwn(parameters, name)) parameters[name] = 1;
    f.set = { sides: sides.map(p => compileComplex(p, parameters)), ops: parts.filter((_, k) => k % 2).map(relationSymbol) };
  }
  f.fn = () => NaN; f.error = ''; // fn only marks the row as valid: sets are drawn from f.set
}
function renderParameters() {
  const names = [...new Set(functions.flatMap(f => f.parameters))].sort();
  $('parameter-empty').hidden = names.length > 0;
  $('parameter-list').replaceChildren(...names.map(name => {
    const row = document.createElement('div'); row.className = 'parameter';
    const label = document.createElement('label'); label.htmlFor = `parameter-${name}`; label.textContent = `${name} =`;
    const input = document.createElement('input');
    Object.assign(input, { id: `parameter-${name}`, type: 'number', step: 'any', value: parameters[name] });
    input.setAttribute('aria-label', `Wartość parametru ${name}`);
    const error = document.createElement('p'); error.className = 'error'; error.id = `parameter-error-${name}`; error.setAttribute('role', 'alert');
    input.setAttribute('aria-describedby', error.id);
    const slider = document.createElement('input');
    slider.type = 'range'; slider.step = '0.1';
    slider.setAttribute('aria-label', `Suwak parametru ${name}`);
    const fitSlider = value => { slider.min = Math.min(-10, Math.floor(value)); slider.max = Math.max(10, Math.ceil(value)); slider.value = value; fillRange(slider); };
    fitSlider(parameters[name]);
    const apply = value => { parameters[name] = value; settle(); schedule({ insights: true }); };
    input.oninput = () => {
      const value = input.valueAsNumber, valid = Number.isFinite(value);
      input.setAttribute('aria-invalid', String(!valid));
      error.textContent = valid ? '' : 'Podaj liczbę. Wykres zachowuje ostatnią poprawną wartość.';
      if (!valid) return;
      fitSlider(value); apply(value);
    };
    slider.oninput = () => {
      input.value = slider.value; input.setAttribute('aria-invalid', 'false'); error.textContent = '';
      apply(slider.valueAsNumber);
    };
    row.append(label, slider, input, error); return row;
  }));
}
function addFunction(expression = '', focus = true, settings = {}) {
  if (functions.length >= MAX) return toast('Możesz porównywać do 8 funkcji naraz.');
  const f = { id: nextId++, color: palette.find(c => !functions.some(g => g.color === c)), visible: true, from: -Infinity, to: Infinity, fromOpen: false, toOpen: false, width: 2.25, dash: '', ...settings };
  setExpression(f, expression); functions.push(f); activeId = f.id;
  renderList(); refresh(); if (focus) rowInput(f.id).focus();
}
function removeFunction(id) {
  const index = functions.findIndex(f => f.id === id);
  functions.splice(index, 1);
  if (!functions.length) return addFunction();
  if (activeId === id) activeId = functions[Math.max(0, index - 1)].id;
  if (menuFn?.id === id) $('fn-menu').hidePopover();
  renderList(); refresh();
}
// --- Function settings menu ---
let menuFn = null, menuClosedAt = 0;
$('fn-colors').append(...palette.map(color => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'color'; b.style.setProperty('--sw', color); b.dataset.color = color;
  b.setAttribute('aria-label', `Kolor ${color}`); b.onclick = () => setColor(menuFn, color); return b;
}));
function syncMenu() {
  $('fn-colors').querySelectorAll('.color').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === menuFn.color)));
  $('fn-custom-color').value = menuFn.color; $('fn-visible').checked = menuFn.visible;
  $('fn-from').value = Number.isFinite(menuFn.from) ? menuFn.from : ''; $('fn-to').value = Number.isFinite(menuFn.to) ? menuFn.to : '';
  $('fn-domain-error').textContent = ''; $('fn-menu').style.setProperty('--c', menuFn.color);
  $('fn-dash').querySelector(`[value="${menuFn.dash}"]`).checked = true; $('fn-width').value = menuFn.width; fillRange($('fn-width')); syncWidth();
  syncBrackets();
}
// An infinite end is always open; a finite one is ⟨ (closed, the point belongs) or ( (open).
function syncBrackets() {
  for (const end of ['from', 'to']) {
    const finite = Number.isFinite(menuFn[end]), isOpen = !finite || menuFn[`${end}Open`];
    for (const r of document.getElementsByName(`fn-${end}-end`)) { r.disabled = !finite; r.checked = (r.value === 'open') === isOpen; }
    $(`fn-${end}-ends`).title = finite ? '' : 'Nieskończoność: zawsze otwarty';
  }
  $('fn-domain-preview').value = domainText(menuFn);
}
const domainText = f => `x ∈ ${Number.isFinite(f.from) ? `${f.fromOpen ? '(' : '⟨'}${format(f.from)}` : '(−∞'}; ${Number.isFinite(f.to) ? `${format(f.to)}${f.toOpen ? ')' : '⟩'}` : '+∞)'}`;
function setColor(f, color) {
  f.color = color; document.querySelector(`[data-id="${f.id}"]`).style.setProperty('--c', color);
  syncMenu(); updateInsights();
}
function openMenu(f, anchor) {
  const menu = $('fn-menu');
  if (menu.matches(':popover-open') && menuFn === f) return menu.hidePopover();
  if (menuFn === f && performance.now() - menuClosedAt < 300) return; // this click's pointerdown already light-dismissed it
  menuFn = f; syncMenu(); menu.showPopover();
  if (activeId !== f.id) { activeId = f.id; functions.forEach(syncRow); updateInsights(); }
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 8)}px`;
}
$('fn-custom-color').oninput = e => setColor(menuFn, e.target.value);
$('fn-visible').onchange = e => { menuFn.visible = e.target.checked; syncRow(menuFn); updateInsights(); };
$('fn-dash').onchange = e => { menuFn.dash = e.target.value; draw(); };
const syncWidth = () => { $('fn-width-value').value = Number(menuFn.width.toFixed(2)); };
$('fn-width').oninput = e => { menuFn.width = e.target.valueAsNumber; syncWidth(); draw(); };
// Typing allows thicker lines than the slider (1–6) reaches; the slider just parks at its end. A value out of range waits for blur, then snaps back.
$('fn-width-value').oninput = e => {
  const w = e.target.valueAsNumber;
  if (!(w >= .25 && w <= 20)) return;
  menuFn.width = w; $('fn-width').value = w; fillRange($('fn-width')); draw();
};
$('fn-width-value').onchange = syncWidth;
const domainInputs = [$('fn-from'), $('fn-to')];
for (const input of domainInputs) input.oninput = () => {
  const [from, to] = domainInputs.map((el, i) => el.value === '' ? (i ? Infinity : -Infinity) : el.valueAsNumber);
  const valid = from < to;
  $('fn-domain-error').textContent = valid ? '' : 'Początek przedziału musi być mniejszy niż koniec.';
  if (valid) { Object.assign(menuFn, { from, to }); syncBrackets(); syncRow(menuFn); updateInsights(); }
};
for (const end of ['from', 'to']) $(`fn-${end}-ends`).onchange = e => { menuFn[`${end}Open`] = e.target.value === 'open'; syncBrackets(); syncRow(menuFn); updateInsights(); };
$('fn-duplicate').onclick = () => {
  const { expression, from, to, fromOpen, toOpen, width, dash } = menuFn; $('fn-menu').hidePopover();
  addFunction(expression, false, { from, to, fromOpen, toOpen, width, dash });
};
$('fn-delete').onclick = () => removeFunction(menuFn.id);
$('fn-menu').addEventListener('toggle', e => { if (e.newState === 'closed') menuClosedAt = performance.now(); });
$('fn-menu').addEventListener('toggle', e => document.querySelectorAll('.settings-button').forEach(s => s.setAttribute('aria-expanded', String(e.newState === 'open' && s.closest('.fn').dataset.id === String(menuFn.id)))));
const rowInput = id => document.querySelector(`[data-id="${id}"] input`);
function syncRow(f) {
  const row = document.querySelector(`[data-id="${f.id}"]`);
  row.classList.toggle('active', f.id === activeId);
  row.classList.toggle('invalid', !!f.error);
  row.classList.toggle('hidden-fn', !f.visible);
  const swatch = row.querySelector('.swatch');
  swatch.setAttribute('aria-pressed', String(f.visible)); swatch.title = f.visible ? 'Ukryj wykres' : 'Pokaż wykres';
  const bounded = Number.isFinite(f.from) || Number.isFinite(f.to);
  const names = f.set?.unknowns?.join(', ');
  row.querySelector('.fn-domain').textContent = !bounded || (f.set && !names) ? '' : names ? domainText(f).replace(/^x/, names) : domainText(f); // a condition on z has no interval
  row.querySelector('input').setAttribute('aria-invalid', String(!!f.error));
  row.querySelector('.error').textContent = f.error;
  // Typeset formula when finished; just the raw text while editing (or while empty/invalid).
  const editing = f.editing || !f.fn, math = f.fn ? mathOf(f) : '';
  row.classList.toggle('editing', editing);
  row.querySelector('.fn-math').innerHTML = editing ? '' : math;
}
function renderList() {
  $('function-list').replaceChildren(...functions.map((f, i) => {
    const row = document.createElement('li'); row.className = 'fn'; row.dataset.id = f.id; row.style.setProperty('--c', f.color);
    const swatch = document.createElement('button'); swatch.type = 'button'; swatch.className = 'swatch';
    swatch.setAttribute('aria-label', `Pokaż wykres ${i + 1}`);
    swatch.onclick = () => { f.visible = !f.visible; if (menuFn === f) syncMenu(); syncRow(f); updateInsights(); };
    const field = document.createElement('label'); field.className = 'fn-field';
    const prefix = document.createElement('span'); prefix.textContent = setMode() ? '' : 'y =';
    const input = document.createElement('input');
    Object.assign(input, { value: f.expression, placeholder: setMode() ? (i ? 'np. t + 2i' : 'np. |z - 1| <= 2') : i ? 'np. sin(x)' : 'np. x^2 - 2', autocomplete: 'off', spellcheck: false });
    input.setAttribute('aria-label', `Funkcja ${i + 1}`); input.setAttribute('aria-describedby', `err-${f.id}`);
    input.oninput = () => { setExpression(f, input.value); syncRow(f); renderParameters(); settle(); schedule({ insights: true }); };
    input.onfocus = () => { f.editing = true; if (activeId !== f.id) { activeId = f.id; functions.forEach(syncRow); updateInsights(); } else syncRow(f); };
    input.onblur = () => { f.editing = false; syncRow(f); };
    input.onkeydown = e => {
      const index = functions.indexOf(f);
      if (e.key === 'Escape') input.blur();
      else if (e.key === 'Enter') { e.preventDefault(); if (index === functions.length - 1 && input.value.trim() && functions.length < MAX) addFunction(); else input.blur(); }
      else if (e.key === 'ArrowDown' && functions[index + 1]) { e.preventDefault(); rowInput(functions[index + 1].id).focus(); }
      else if (e.key === 'ArrowUp' && index > 0) { e.preventDefault(); rowInput(functions[index - 1].id).focus(); }
      else if (e.key === 'Backspace' && !input.value && functions.length > 1) { e.preventDefault(); removeFunction(f.id); rowInput(activeId).focus(); }
    };
    const math = document.createElement('div'); math.className = 'fn-math'; math.setAttribute('aria-hidden', 'true');
    field.append(prefix, input, math);
    const settings = document.createElement('button'); settings.type = 'button'; settings.className = 'icon settings-button'; settings.innerHTML = settingsIcon;
    settings.setAttribute('aria-label', `Ustawienia funkcji ${i + 1}`); settings.setAttribute('aria-haspopup', 'dialog'); settings.setAttribute('aria-expanded', 'false');
    settings.title = 'Przedział, kolor, linia'; settings.onclick = () => openMenu(f, settings);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon remove'; remove.innerHTML = removeIcon;
    remove.setAttribute('aria-label', `Usuń funkcję ${i + 1}`); remove.onclick = () => removeFunction(f.id);
    const error = document.createElement('p'); error.className = 'error'; error.id = `err-${f.id}`; error.setAttribute('role', 'alert');
    const domain = document.createElement('p'); domain.className = 'fn-domain';
    row.append(swatch, field, settings, remove, domain, error);
    return row;
  }));
  functions.forEach(syncRow);
  $('function-count').textContent = `${functions.length} / ${MAX}`;
  $('add-function').disabled = functions.length >= MAX;
}

// --- Analysis ---
function updateInsights() {
  const f = active(), fn = f?.fn;
  const target = $('analysis-target'); target.style.setProperty('--c', fn ? f.color : 'transparent');
  target.innerHTML = ''; const label = document.createElement('span'); if (fn) label.innerHTML = mathOf(f); else label.textContent = 'brak funkcji'; target.append(label);
  $('stats').classList.toggle('set', setMode());
  for (const [id, x] of [['value-zero', 0], ['value-one', 1]]) {
    if (setMode()) { $(id).textContent = '—'; continue; }
    if (fn && complexMode() && (f.real === f.expression && f.complex || !Number.isFinite(fn(x)))) { $(id).innerHTML = stacked(complexValue(f.cfn([x, 0]))); continue; }
    const proven = fn && exactValue(f.real, parameters, x);
    $(id).innerHTML = !fn ? '—' : proven === undefined || !Number.isFinite(fn(x)) ? 'nie istnieje' : stacked(proven ?? approx(fn(x)));
  }
  marks = []; snaps = [];
  if (!fn) { $('roots').textContent = $('intersections').textContent = '—'; return draw(); }
  if (complexMode()) return complexInsights(f);
  if (setMode()) return setInsights(f);
  const zeroOnView = h => Array.from({ length: 31 }, (_, i) => h(view.min + (view.max - view.min) * i / 30)).every(y => y === 0);
  const allZero = zeroOnView(fn), values = allZero ? [] : roots(fn, view.min, view.max);
  const rootMarks = values.map(x => ({ x, y: 0, label: exactPoint([f.expression, '0'], parameters, x) }));
  $('roots').innerHTML = allZero ? 'cały widoczny zakres' : values.length ? stacked(`x = ${list(rootMarks.map(m => m.label?.x ?? approx(m.x)))}`) : 'brak';
  const others = plotted().filter(g => g !== f && !zeroOnView(x => fn(x) - g.fn(x)));
  const crossings = others.flatMap(g => intersections(fn, g.fn, view.min, view.max).map(p => ({ ...p, label: exactPoint([f.expression, g.expression], parameters, p.x) }))).sort((a, b) => a.x - b.x)
    .filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y); // two graphs crossing at one point: list it once
  $('intersections').innerHTML = !others.length ? '—' : crossings.length ? stacked(list(crossings.map(p => `(${p.label?.x ?? approx(p.x)}; ${p.label?.y ?? approx(p.y)})`), 4)) : 'brak';
  if (f.visible) marks = [...rootMarks, ...crossings];
  // Not drawn, but the cursor sticks to them: every graph's extrema and where it crosses the y axis.
  snaps = plotted().flatMap(g => [...extrema(g.fn, view.min, view.max), ...(Number.isFinite(g.fn(0)) ? [{ x: 0, y: g.fn(0) }] : [])]
    .map(p => ({ ...p, color: g.color, label: p.x === 0 ? { x: '0', y: exactValue(g.real, parameters, 0) } : null })));
  draw();
}
// Zeros and crossings anywhere in the visible part of the plane, e.g. ±i for z² + 1.
function complexInsights(f) {
  // A real zero has |g| about equal all round it; near an essential singularity (exp(1/z) at 0) |g| can be 1e-49
  // without being 0, and there it swings wildly instead. The circle stays well clear of neighbouring zeros.
  const zeros = g => {
    const all = complexRoots(g, view.min, view.max, fromY(height), fromY(0), 64, Math.max(8, Math.round(64 * height / width)));
    return all.filter(z => isolated(g, z, Math.min(6 / scale(), ...all.filter(w => w !== z).map(w => Math.hypot(w[0] - z[0], w[1] - z[1]) / 3))));
  };
  const plain = g => g.real !== g.expression || !g.complex;
  const label = (g, z, expressions) => {
    const proven = z[1] === 0 && plain(f) && plain(g) && exactPoint(expressions, parameters, z[0]);
    const w = g.cfn(z);
    return proven ? proven.x : complexValue(z, z.every(Number.isInteger) && w[0] === 0 && w[1] === 0);
  };
  const rootMarks = zeros(f.cfn).map(z => ({ x: z[0], y: z[1], text: label(f, z, [f.real, '0']) }));
  $('roots').innerHTML = rootMarks.length ? stacked(`z = ${list(rootMarks.map(m => m.text))}`) : 'brak';
  const others = plotted().filter(g => g !== f);
  const crossings = others.flatMap(g => {
    const h = { complex: g.complex, real: g.real, expression: g.expression, cfn: z => { const [a, b] = f.cfn(z), [c, d] = g.cfn(z); return [a - c, b - d]; } };
    return zeros(h.cfn).map(z => ({ x: z[0], y: z[1], text: label(h, z, [f.real, g.real]) }));
  });
  $('intersections').innerHTML = !others.length ? '—' : crossings.length ? stacked(`z = ${list(crossings.map(m => m.text), 4)}`) : 'brak';
  if (f.visible) marks = [...rootMarks, ...crossings];
  draw();
}
// True for an isolated zero of h (z² + 1 at i): |h| is about the same all round it. On a curve of zeros (|z| − 1)
// some of the 16 points around come much closer to 0 than others.
const isolated = (h, z, r) => {
  const size = Array.from({ length: 16 }, (_, k) => Math.hypot(...h([z[0] + r * Math.cos(k * Math.PI / 8), z[1] + r * Math.sin(k * Math.PI / 8)])));
  return Math.min(...size) > .5 * Math.max(...size);
};
function setInsights(f) {
  const { unknowns, ops } = f.set;
  let text;
  if (unknowns) {
    const range = Number.isFinite(f.from) || Number.isFinite(f.to) ? domainText(f).slice(1) : ' ∈ ℝ';
    text = !unknowns.length ? `z = ${complexValue(f.set.at())}` : `${unknowns.length > 1 ? 'obszar' : 'krzywa'}: ${unknowns.join(', ')}${range}`;
  } else {
    // An equation's isolated solutions (z² = −1) are listed and marked; the rest is described from what was drawn.
    if (ops.length === 1 && ops[0] === '=') marks = equationPoints(f).map(({ z, sure }) => ({ x: z[0], y: z[1], text: complexValue(z, sure) }));
    if (!f.visible) marks = [];
    draw();
    const found = f.visible && f.found, equation = ops.includes('=');
    const edge = ops.every(o => o === '≤' || o === '≥') ? ', brzeg należy' : ops.every(o => o === '<' || o === '>' || o === '≠') ? ', brzeg nie należy' : '';
    if (found?.dot && !marks.length) marks = [{ x: found.dot.z[0], y: found.dot.z[1], text: complexValue(found.dot.z, found.dot.sure && found.dot.z.every(Number.isInteger)) }];
    text = marks.length ? `z = ${list(marks.map(m => m.text))}` : !found ? '—'
      : found.all || (!equation && found.inside === found.valid && !found.lines) ? 'cała widoczna płaszczyzna'
      : equation ? (found.lines ? 'krzywa' : 'brak punktów w widocznym zakresie')
      : found.inside ? `obszar${edge}` : 'brak punktów w widocznym zakresie';
  }
  $('roots').innerHTML = stacked(text);
  if (unknowns) { if (!f.visible) marks = []; draw(); }
}
function syncRange() {
  const bottom = fromY(height), top = fromY(0), short = v => Number(v.toPrecision(7));
  [$('x-min').value, $('x-max').value, $('y-min').value, $('y-max').value] = [view.min, view.max, bottom, top].map(short);
  $('scale-label').textContent = `x ∈ [${format(view.min)}; ${format(view.max)}]   y ∈ [${format(bottom)}; ${format(top)}]`;
}
function refresh() { renderParameters(); draw(); updateInsights(); syncRange(); }

// --- Plot ---
// 1.5707… → π/2, 6.2831… → 2π; denominators up to 12, otherwise 0,05π.
function piLabel(x) {
  const k = x / Math.PI, d = [1, 2, 3, 4, 6, 12].find(d => Math.abs(k * d - Math.round(k * d)) < 1e-6);
  if (!d) return `${format(k)}π`;
  const n = Math.round(k * d), a = Math.abs(n);
  return `${n < 0 ? '-' : ''}${a === 1 ? '' : a}π${d > 1 ? `/${d}` : ''}`;
}
const tick = unit => { const raw = 70 / unit, magnitude = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map(v => v * magnitude).find(v => v >= raw); };
// Trigonometric: x ticks at π/12 … π/2, π, 2π, 5π…; below π/20 back to decimal multiples of π.
const piTick = unit => Math.PI * ([1 / 12, 1 / 6, 1 / 4, 1 / 3, 1 / 2].find(v => v >= 70 / unit / Math.PI && 70 / unit / Math.PI > .05) ?? tick(unit * Math.PI));
const trigMode = () => $('axes-mode').elements.mode.value === 'trig';
// Minor lines on round values: 1 → 0,2; 2 → 0,5 (not 0,4, so 1 is a line); 5 → 1.
const minorOf = major => major / (Math.round(major / 10 ** Math.floor(Math.log10(major))) === 2 ? 4 : 5);
const xStep = () => trigMode() ? piTick(scale()) : tick(scale()), minorX = () => trigMode() ? xStep() / 2 : minorOf(xStep());
function draw() {
  if (!width || !height) return;
  ctx.fillStyle = theme['plot-bg']; ctx.fillRect(0, 0, width, height);
  const current = active();
  if (complexMode() && current?.visible && current.cfn) paintDomain(current.cfn);
  const bottom = fromY(height), top = fromY(0);
  const mode = $('axes-mode').elements.mode.value, trig = mode === 'trig', complex = mode === 'complex', plane = complex || mode === 'set';
  const step = xStep(), ystep = tick(yscale());
  const xLabel = trig ? piLabel : format, yLabel = plane ? y => ({ 1: 'i', '-1': '-i' })[format(y)] ?? `${format(y)}i` : format;
  function grid(sx, sy, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = Math.ceil(view.min / sx) * sx; x <= view.max; x += sx) { const p = Math.round(px(x)) + .5; ctx.moveTo(p, 0); ctx.lineTo(p, height); }
    for (let y = Math.ceil(bottom / sy) * sy; y <= top; y += sy) { const p = Math.round(py(y)) + .5; ctx.moveTo(0, p); ctx.lineTo(width, p); }
    ctx.stroke();
  }
  if ($('grid-toggle').checked) { if (!complex) grid(minorX(), minorOf(ystep), theme['grid-minor']); grid(step, ystep, theme['grid-major']); }
  if ($('axes-toggle').checked) {
    ctx.strokeStyle = theme.axis; ctx.lineWidth = 1.25; ctx.beginPath();
    ctx.moveTo(Math.round(px(0)) + .5, 0); ctx.lineTo(Math.round(px(0)) + .5, height); ctx.moveTo(0, Math.round(py(0)) + .5); ctx.lineTo(width, Math.round(py(0)) + .5); ctx.stroke();
    ctx.fillStyle = theme.label; ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    // Over the colours of the complex plane labels get a halo in the background colour.
    ctx.strokeStyle = theme['plot-bg']; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    const text = (s, x, y) => { if (complex) ctx.strokeText(s, x, y); ctx.fillText(s, x, y); };
    const ys = []; for (let y = Math.ceil(bottom / ystep) * ystep; y < top; y += ystep) if (Math.abs(y) > ystep / 100) ys.push(y);
    // Long y labels (485 165 195) push the pinned axis right instead of running off the canvas.
    const labelWidth = Math.max(0, ...ys.map(y => ctx.measureText(yLabel(y)).width));
    const axisY = Math.max(14, Math.min(height - 40, py(0))), axisX = Math.max(labelWidth + 14, Math.min(width - 12, px(0)));
    ctx.textAlign = 'center';
    for (let x = Math.ceil(view.min / step) * step; x < view.max; x += step) if (Math.abs(x) > step / 100 && px(x) > 16 && px(x) < width - 24) text(xLabel(x), px(x), axisY + 16);
    ctx.textAlign = 'right';
    for (const y of ys) text(yLabel(y), axisX - 8, py(y) + 4);
    if (axisX === px(0) && axisY === py(0)) text('0', axisX - 8, axisY + 16); // origin label only where the axes really cross
    ctx.font = 'italic 16px Newsreader, Georgia, serif'; text(plane ? 'Re' : 'x', width - 14, axisY - 8); ctx.textAlign = 'left'; text(plane ? 'Im' : 'y', axisX + 8, 18);
  }
  ctx.lineJoin = ctx.lineCap = 'round';
  const ends = [];
  if (mode === 'set') for (const f of [...plotted().filter(f => f !== current), ...(current?.visible && current.fn ? [current] : [])]) {
    ctx.setLineDash(f.dash ? f.dash.split(' ').map(n => n * f.width / 2) : []);
    if (f.set.sides) paintCondition(f); else drawParametric(f);
  }
  else if (!complex) for (const f of [...plotted().filter(f => f !== current), ...(current?.visible && current.fn ? [current] : [])]) {
    ctx.beginPath(); ctx.lineWidth = f.width + (f === current ? .5 : 0); ctx.strokeStyle = f.color;
    ctx.setLineDash(f.dash ? f.dash.split(' ').map(n => n * f.width / 2) : []);
    for (const e of plot(f.fn)) ends.push({ ...e, color: f.color });
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Roots and intersections: small neutral dots, so they don't read as hollow endpoints.
  for (const m of marks) dot(m.x, m.y, 3.5, theme.label, theme['plot-bg']);
  // Where a piece ends: filled = the point belongs to the graph, hollow = only approached.
  for (const e of ends) dot(e.x, e.y, 4, e.closed ? e.color : theme['plot-bg'], e.color);
  drawHover();
}
// Domain colouring: every point z of the plane gets the colour of f(z). Hue = argument (red: positive real,
// cyan: negative real), dark = |f| near 0, light = near a pole (log scale), a faint ring wherever |f| doubles.
// So all values show at once: a zero is where every colour meets around a dark point.
const offscreen = document.createElement('canvas');
function paintDomain(cf) {
  const s = drag || moving ? 4 : 2, w = Math.ceil(width / s), h = Math.ceil(height / s); // coarser while dragging, zooming, sliding
  offscreen.width = w; offscreen.height = h;
  const c = offscreen.getContext('2d'), img = c.createImageData(w, h), d = img.data, above = new Float64Array(w).fill(NaN);
  for (let j = 0; j < h; j++) {
    const y = fromY((j + .5) * s);
    let left = NaN;
    for (let i = 0; i < w; i++) {
      const [u, v] = cf([fromX((i + .5) * s), y]), k = 4 * (j * w + i);
      if (!Number.isFinite(u) || !Number.isFinite(v)) { left = above[i] = NaN; continue; } // undefined: leave the background
      const r = Math.hypot(u, v), t = Math.log2(r), frac = Number.isFinite(t) ? t - Math.floor(t) : 0;
      // How far log2|f| moves per sample. The ring's sharp drop is spread over one sample (no stair steps), and rings
      // closer than ~8 samples (Γ(z) far right) would alias into jagged stripes, so they fade out there.
      const step = Math.max(Math.abs(t - left) || 0, Math.abs(t - above[i]) || 0), fade = Number.isFinite(step) ? Math.max(0, 1 - 8 * step) : 1;
      const e = Math.min(.5, Math.max(.001, step)), ring = frac < 1 - e ? frac : (1 - frac) * (1 - e) / e;
      left = above[i] = t;
      const l = (.5 + .32 * Math.tanh(Math.log(r) / 3)) * (.86 + .14 * (fade * ring + (1 - fade) * .5)), a = Math.min(l, 1 - l), hue = 6 * Math.atan2(v, u) / Math.PI + 12;
      for (const [n, o] of [[0, 0], [8, 1], [4, 2]]) { const q = (n + hue) % 12; d[k + o] = 255 * (l - a * Math.max(-1, Math.min(q - 3, 9 - q, 1))); }
      d[k + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(offscreen, 0, 0, width, height);
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
// Lines where a grid of values (nodes every s px, w × h) crosses 0, by marching squares, joined into polylines in px.
// A sign change that isn't a zero (arg z jumping from π to −π) is dropped: there the value at the crossing isn't near 0.
function contour(v, w, h, s, value) {
  const points = new Map(), segments = [];
  const cross = (id, k0, k1, x0, y0, x1, y1) => {
    if (points.has(id)) return points.get(id);
    const a = v[k0], b = v[k1]; let p = null;
    if (Number.isFinite(a) && Number.isFinite(b) && (a >= 0) !== (b >= 0)) {
      const t = a / (a - b); p = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
      if (!(Math.abs(value(...p)) <= .1 * Math.abs(a - b))) p = null;
    }
    points.set(id, p); return p;
  };
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const k = j * w + i, x = i * s, y = j * s, pos = v[k] >= 0;
    // Almost every cell has all four corners on one side (NaN counts as below): no edge crosses it.
    if ((v[k + 1] >= 0) === pos && (v[k + w] >= 0) === pos && (v[k + w + 1] >= 0) === pos) continue;
    const edges = [[2 * k, k, k + 1, x, y, x + s, y], [2 * (k + 1) + 1, k + 1, k + w + 1, x + s, y, x + s, y + s], [2 * (k + w), k + w, k + w + 1, x, y + s, x + s, y + s], [2 * k + 1, k, k + w, x, y, x, y + s]]
      .filter(e => cross(...e)).map(e => e[0]);
    if (edges.length === 2) segments.push(edges);
    else if (edges.length === 4) { // saddle: the centre decides which corners are joined
      const centre = (v[k] + v[k + 1] + v[k + w] + v[k + w + 1]) / 4;
      if ((centre >= 0) === (v[k] >= 0)) segments.push([edges[0], edges[1]], [edges[2], edges[3]]); else segments.push([edges[0], edges[3]], [edges[1], edges[2]]);
    }
  }
  const ends = new Map(), used = new Uint8Array(segments.length), lines = [];
  segments.forEach((seg, n) => { for (const e of seg) { if (!ends.has(e)) ends.set(e, []); ends.get(e).push(n); } });
  for (let n = 0; n < segments.length; n++) {
    if (used[n]) continue; used[n] = 1;
    const halves = [[segments[n][1]], [segments[n][0]]];
    for (const half of halves) for (;;) {
      const tip = half.at(-1), next = ends.get(tip).find(m => !used[m]);
      if (next === undefined) break;
      used[next] = 1; const [a, b] = segments[next]; half.push(a === tip ? b : a);
    }
    lines.push([...halves[1].reverse(), ...halves[0]].map(e => points.get(e)));
  }
  return lines;
}
// Isolated solutions of an equation left = right (z² = −1), not a curve of them (|z| = 1).
function equationPoints(f) {
  const { sides, ops } = f.set;
  if (ops.length !== 1 || ops[0] !== '=') return [];
  const h = z => { const [a, b] = sides[0](z), [c, d] = sides[1](z); return [a - c, b - d]; };
  return complexRoots(h, view.min, view.max, fromY(height), fromY(0), 64, Math.max(8, Math.round(64 * height / width)))
    .filter(z => isolated(h, z, 6 / scale())).map(z => ({ z, sure: z.every(Number.isInteger) && h(z).every(v => v === 0) }));
}
// Where h (left − right of an equation) is 0 for an equation contour() can't trace: (z² = |z|²) has neither part 0
// everywhere, so keep the stretches of each part's zero lines where the other part is 0 too.
const bothZero = (lines, other, tol) => lines.flatMap(line => {
  const runs = [[]];
  for (const p of line) if (Math.abs(other(...p)) <= tol) runs.at(-1).push(p); else if (runs.at(-1).length) runs.push([]);
  return runs.filter(r => r.length > 1);
});
// A condition on z, evaluated on a grid of nodes every 2 px. Each inequality gives a margin (> 0 where it holds):
// inside = the smallest margin > 0, filled translucent. Its edge and the curve of an equation are traced as lines
// and stroked like a graph: solid for ≤ ≥ =, dashed for < > ≠. Records what it found in f.found for the analysis.
function paintCondition(f) {
  const s = drag || moving ? 4 : 2, w = Math.ceil(width / s) + 1, h = Math.ceil(height / s) + 1, n = w * h, { sides, ops } = f.set;
  const real = ([a, b]) => Math.abs(b) <= 1e-9 * (1 + Math.abs(a)); // complex numbers aren't ordered: < needs real sides
  // m: smallest inequality margin (Infinity without inequalities); c: the same, signed for ≠ between reals
  // (|z| ≠ 3 is 0 on the circle and > 0 on both sides, so its edge can only be traced from |z| − 3);
  // strict: whether that one is < > ≠; eq: left − right of the first equation.
  const judgeZ = z => {
    const v = sides.map(g => g(z));
    let m = Infinity, c = Infinity, strict = false, eq = null;
    ops.forEach((op, o) => {
      const a = v[o], b = v[o + 1];
      if (op === '=') { eq ??= [a[0] - b[0], a[1] - b[1]]; return; }
      const d = op === '≠' ? Math.hypot(a[0] - b[0], a[1] - b[1]) : !real(a) || !real(b) ? NaN : op === '<' || op === '≤' ? b[0] - a[0] : a[0] - b[0];
      if (Number.isNaN(d) || Number.isNaN(m)) m = c = NaN;
      else if (d < m) { m = d; c = op === '≠' && real(a) && real(b) ? a[0] - b[0] : d; strict = op === '<' || op === '>' || op === '≠'; }
    });
    return { m, c, strict, eq };
  };
  const judge = (x, y) => judgeZ([fromX(x), fromY(y)]);
  const margin = new Float64Array(n), edge = new Float64Array(n), eqRe = new Float64Array(n), eqIm = new Float64Array(n);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, r = judge(i * s, j * s);
    margin[k] = r.m; edge[k] = r.c; if (r.eq) [eqRe[k], eqIm[k]] = r.eq; else eqRe[k] = eqIm[k] = NaN;
  }
  const top = a => { let m = 0; for (const v of a) if (Math.abs(v) > m && Number.isFinite(v)) m = Math.abs(v); return m; };
  const equation = ops.includes('='), re = top(eqRe), im = top(eqIm), all = equation && re === 0 && im === 0 && eqRe.some(Number.isFinite); // z = z
  // Fill, one pixel per node, centred on it.
  offscreen.width = w; offscreen.height = h;
  const c = offscreen.getContext('2d'), img = c.createImageData(w, h), d = img.data, [r, g, b] = rgb(f.color);
  let inside = 0, valid = 0;
  for (let k = 0; k < n; k++) {
    const yes = all ? Number.isFinite(eqRe[k]) : !equation && margin[k] > 0;
    if (yes) { d.set([r, g, b, 70], 4 * k); inside++; }
    if (all ? Number.isFinite(eqRe[k]) : Number.isFinite(margin[k])) valid++;
  }
  c.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(offscreen, -s / 2, -s / 2, w * s, h * s);
  ctx.save(); ctx.lineWidth = f.width; ctx.strokeStyle = f.color; ctx.lineJoin = 'round';
  const stroke = (lines, strict) => {
    for (const line of lines) {
      const dashed = strict(line);
      ctx.lineWidth = f.width; ctx.strokeStyle = f.color; // dot() may have changed them
      ctx.setLineDash(dashed ? [2.5 * f.width + 2, 2 * f.width + 2] : f.dash ? f.dash.split(' ').map(n => n * f.width / 2) : []);
      ctx.lineCap = dashed ? 'butt' : 'round';
      ctx.beginPath(); ctx.moveTo(...line[0]); for (const p of line.slice(1)) ctx.lineTo(...p); ctx.stroke();
    }
  };
  // A value that only touches 0 instead of crossing it: |z − 1| + |z + 1| − 2 on the segment from −1 to 1, |z − 6i|,
  // Re(z)² — no line to trace. Draw the nodes where |value| is within ¾ node of 0 by its steepest slope, as a thick
  // line (translucent if it doesn't belong to the set). A few nodes together are a single point: a dot, snapped to a
  // rounder z when that's at least as close to 0, returned for the analysis.
  let dot2 = null;
  const touching = (a, strict, value) => {
    const at = (i, j) => Math.abs(a[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))]), hit = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = at(i, j), slope = Math.max(0, ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => Math.abs(at(i + di, j + dj) - v)).filter(Number.isFinite));
      if (Number.isFinite(v) && v < .75 * slope) hit.push([i * s, j * s]);
    }
    if (!hit.length) return null;
    lines = [[]];
    ctx.fillStyle = f.color; ctx.globalAlpha = strict ? .45 : 1;
    if (hit.length > 12) {
      ctx.beginPath(); for (const [x, y] of hit) { ctx.moveTo(x + f.width / 2, y); ctx.arc(x, y, f.width / 2, 0, 2 * Math.PI); } ctx.fill();
      ctx.globalAlpha = 1; return null;
    }
    let z = [fromX(hit.reduce((t, p) => t + p[0], 0) / hit.length), fromY(hit.reduce((t, p) => t + p[1], 0) / hit.length)];
    const size = q => Math.hypot(...value(q)), cell = s / scale();
    for (const k of [0, 1]) {
      const v = z[k], c = [1, 2, 3, 4, 6, 8, 12, 100].map(d => Math.round(v * d) / d).find(c => Math.abs(c - v) <= cell && size(k ? [z[0], c] : [c, z[1]]) <= size(z));
      if (c !== undefined) z = k ? [z[0], c] : [c, z[1]];
    }
    ctx.globalAlpha = 1; dot(z[0], z[1], 4.5, strict ? theme['plot-bg'] : f.color, strict ? f.color : theme['plot-bg']);
    return { z, sure: size(z) === 0 };
  };
  let lines = [], points = [];
  if (equation && !all) {
    // left − right is a real curve when one of its parts is 0 everywhere (|z + i| − 3 is real, z̄ − z imaginary).
    const part = im <= 1e-9 * re ? 0 : re <= 1e-9 * im ? 1 : -1, at = k => (x, y) => judge(x, y).eq[k];
    if (part >= 0) lines = contour(part ? eqIm : eqRe, w, h, s, at(part));
    else {
      lines = [...bothZero(contour(eqRe, w, h, s, at(0)), at(1), 1e-6 * im), ...bothZero(contour(eqIm, w, h, s, at(1)), at(0), 1e-6 * re)];
      points = equationPoints(f); // single points (z² = −4)
      for (const { z } of points) dot(z[0], z[1], 4.5, f.color, theme['plot-bg']);
    }
    if (!lines.length && !points.length) dot2 = touching(Float64Array.from(eqRe, (v, k) => Math.hypot(v, eqIm[k])), false, z => judgeZ(z).eq);
    else stroke(lines, () => false);
  } else if (!equation) {
    lines = contour(edge, w, h, s, (x, y) => judge(x, y).c);
    if (lines.length) stroke(lines, line => judge(...line[line.length >> 1]).strict);
    else {
      // Only where it means something: a curve cut out of a region (Re(z)² > 0) or the whole set (|z − 1| ≤ 0),
      // not |z| ≥ 0 (all of the plane) or |z| < 0 (empty).
      const strict = ops.every(o => o === '<' || o === '>' || o === '≠');
      if (strict ? inside > 0 : inside === 0) { const p = touching(edge, strict, z => [judgeZ(z).c, 0]); if (!strict) dot2 = p; }
    }
    // z ≠ 0, z ≠ 1 + i: the excluded single points, as hollow dots.
    ops.forEach((op, o) => {
      if (op !== '≠') return;
      const hz = z => { const [a, b] = sides[o](z), [c2, d2] = sides[o + 1](z); return [a - c2, b - d2]; };
      for (const z of complexRoots(hz, view.min, view.max, fromY(height), fromY(0), 64, Math.max(8, Math.round(64 * height / width))).filter(z => isolated(hz, z, 6 / scale()))) dot(z[0], z[1], 4.5, theme['plot-bg'], f.color);
    });
  }
  f.found = { all, inside, valid, lines: lines.length, points: points.length, dot: dot2 };
  ctx.restore();
}
// Values for the unknowns: the interval from the function's settings, or all reals (t = sinh s: dense near 0).
// ponytail: "all reals" stops at 100 × the visible range; enough for t + 2i or a + a²i to leave the view, while
// cos t + i sin t doesn't go round thousands of times. Set an interval if a curve needs larger t.
function unknownValues(f, n) {
  const bounded = Number.isFinite(f.from) && Number.isFinite(f.to), R = 100 * Math.max(1, ...[view.min, view.max, fromY(0), fromY(height)].map(Math.abs));
  const lo = bounded ? f.from : Math.asinh(Math.max(-R, f.from)), hi = bounded ? f.to : Math.asinh(Math.min(R, f.to));
  return Array.from({ length: n + 1 }, (_, k) => bounded ? lo + (hi - lo) * k / n : Math.sinh(lo + (hi - lo) * k / n));
}
// Where a number with unknowns can be: no unknown = a point, one = a curve, two = a filled region.
function drawParametric(f) {
  // Canvas drops a whole path with a point ~1e65 px away (e^((0,15 + i)t) spiralling out), so points beyond ~20 screens
  // count as missing: the curve's pen lifts there (its refined neighbours reach well past the screen edge anyway).
  const L = 20 * (width + height), { unknowns, at } = f.set, P = z => [px(z[0]), py(z[1])], ok = p => Math.abs(p[0]) < L && Math.abs(p[1]) < L;
  ctx.strokeStyle = ctx.fillStyle = f.color; ctx.lineWidth = f.width;
  if (!unknowns.length) { const z = at(); dot(z[0], z[1], 5, f.color, theme['plot-bg']); return; }
  if (unknowns.length === 1) {
    ctx.beginPath(); let pen = false;
    const point = p => { if (pen) ctx.lineTo(...p); else ctx.moveTo(...p); pen = true; };
    // Halve each step until it is under 4 px on screen; one that stays long after 10 halvings is a jump (1/t at 0): lift the pen.
    const segment = (t0, p0, t1, p1, depth) => {
      if (!ok(p0) || !ok(p1)) { if (ok(p1)) { pen = false; point(p1); } else pen = false; return; }
      const offscreen = (p0[0] < 0 && p1[0] < 0) || (p0[0] > width && p1[0] > width) || (p0[1] < 0 && p1[1] < 0) || (p0[1] > height && p1[1] > height);
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 4 && !offscreen) {
        if (depth) { const tm = (t0 + t1) / 2, pm = P(at(tm)); segment(t0, p0, tm, pm, depth - 1); segment(tm, pm, t1, p1, depth - 1); return; }
        pen = false;
      }
      point(p1);
    };
    const ts = unknownValues(f, 4000);
    let p0 = P(at(ts[0])); if (ok(p0)) point(p0);
    for (let k = 1; k < ts.length; k++) { const p1 = P(at(ts[k])); segment(ts[k - 1], p0, ts[k], p1, 10); p0 = p1; }
    ctx.stroke(); ctx.setLineDash([]);
    // Ends of a finite interval, like a graph's domain: filled when the end belongs, hollow when open.
    for (const [end, open] of [[f.from, f.fromOpen], [f.to, f.toOpen]]) if (Number.isFinite(end)) { const z = at(end); dot(z[0], z[1], 4, open ? theme['plot-bg'] : f.color, f.color); }
    return;
  }
  // Two unknowns: fill the image of every cell of a 160 × 160 grid of their values. All cells are added with the
  // same orientation, so where the image folds over itself the overlaps don't cancel out.
  // ponytail: 160 steps per unknown; a strongly curved region shows facets when zoomed in.
  const ts = unknownValues(f, 160), grid = ts.map(a => ts.map(b => P(at(a, b))));
  ctx.beginPath();
  for (let i = 0; i < 160; i++) for (let j = 0; j < 160; j++) {
    // Region cells keep far corners, clamped: a big cell (when zoomed far in) must still cover the screen.
    let q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
    if (!q.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
    q = q.map(p => p.map(v => Math.max(-L, Math.min(L, v))));
    const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
    if (Math.max(...xs) < 0 || Math.min(...xs) > width || Math.max(...ys) < 0 || Math.min(...ys) > height) continue;
    if (q.reduce((sum, p, k) => sum + p[0] * q[(k + 1) % 4][1] - q[(k + 1) % 4][0] * p[1], 0) < 0) q = q.reverse();
    ctx.moveTo(...q[0]); for (const p of q.slice(1)) ctx.lineTo(...p); ctx.closePath();
  }
  ctx.globalAlpha = .3; ctx.fill(); ctx.globalAlpha = 1;
  if (!Number.isFinite(f.from) || !Number.isFinite(f.to)) return;
  // A bounded interval: outline the image of the parameter square's four edges, dashed where the interval is open.
  const lo = f.from, hi = f.to, along = k => lo + (hi - lo) * k / 400;
  for (const [edge, open] of [[k => at(along(k), lo), f.fromOpen], [k => at(hi, along(k)), f.toOpen], [k => at(along(k), hi), f.toOpen], [k => at(lo, along(k)), f.fromOpen]]) {
    ctx.setLineDash(open ? [2.5 * f.width + 2, 2 * f.width + 2] : []); ctx.beginPath();
    for (let k = 0; k <= 400; k++) { const p = P(edge(k)); if (ok(p)) ctx.lineTo(...p); }
    ctx.stroke();
  }
}
// The cursor dot lives on its own canvas layer: moving the mouse redraws only this, never the graphs,
// so it keeps up with the cursor. It follows the graph nearest to the cursor and is recomputed after
// every redraw, so it stays right after panning or zooming too.
// Grid lines nearest v, roundest first: the major line, then a minor line that is a multiple of 1, 0,5, 0,2…
// (with lines every 0,5 between 0 and 2: 2, then 1, then 0,5). Snapping takes the first one in reach.
function roundNear(v, major) {
  const e = Math.floor(Math.log10(major)), minor = minorOf(major), onGrid = s => Math.abs(s / minor - Math.round(s / minor)) < 1e-9;
  const steps = [major, ...[e, e - 1].flatMap(k => [5, 2, 1].map(m => m * 10 ** k)).filter(s => s < major && s > minor && onGrid(s)), minor];
  return [...new Set(steps.map(s => Number((Math.round(v / s) * s).toPrecision(12))))];
}
// The point of fn's graph nearest the cursor, in px: the graph sampled every 1 px within 24 px of the cursor,
// as a polyline the cursor is projected onto. A segment whose middle sample isn't between its ends spans a
// jump or an asymptote (tan x), not the graph, so it is skipped.
function nearestOnGraph(fn) {
  let best, a = null;
  for (let i = -24; i <= 24; i++) {
    const b = [pointer.x + i, py(fn(fromX(pointer.x + i)))];
    if (!Number.isFinite(b[1])) { a = null; continue; }
    const mid = a && py(fn(fromX(pointer.x + i - .5)));
    if (a && mid >= Math.min(a[1], b[1]) - 1 && mid <= Math.max(a[1], b[1]) + 1) {
      const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((pointer.x - a[0]) * dx + (pointer.y - a[1]) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(a[0] + t * dx - pointer.x, a[1] + t * dy - pointer.y);
      if (!best || d < best.d) best = { d, x: fromX(a[0] + t * dx) };
    }
    a = b;
  }
  return best && { ...best, y: fn(best.x) };
}
function drawHover() {
  hoverCtx.clearRect(0, 0, width, height);
  const tip = $('coordinates');
  if (!pointer || drag) { tip.hidden = true; return; }
  if (complexMode() || setMode()) return complexHover(tip);
  // The nearest root, intersection, extremum or y-intercept within 8 px wins: show its exact coordinates.
  const snapping = $('snap-toggle').checked, dist = m => Math.hypot(px(m.x) - pointer.x, py(m.y) - pointer.y);
  const mark = [...marks.map(m => ({ ...m, color: active().color })), ...snaps].filter(m => snapping && dist(m) < 8).sort((a, b) => dist(a) - dist(b))[0];
  let hit = mark && { ...mark, exact: true };
  if (!hit) {
    // Otherwise follow the graph nearest the cursor (in px, so steep parts follow up-and-down moves too)…
    for (const f of plotted()) {
      const p = nearestOnGraph(f.fn);
      if (p && p.d < 24 && (!hit || p.d < hit.d)) hit = { ...p, color: f.color, f };
    }
    // …sticking to where it crosses a grid line within 3 px of that point: the roundest vertical and the roundest
    // horizontal line in reach, whichever is nearer. Grid values are short decimals (or multiples of π), so exact.
    if (hit && snapping && $('grid-toggle').checked) {
      const fn = hit.f.fn, gap = p => Math.hypot(px(p.x) - px(hit.x), py(p.y) - py(hit.y)), options = [];
      const gx = (trigMode() ? [xStep(), minorX()].map(s => Math.round(hit.x / s) * s) : roundNear(hit.x, xStep())).map(x => ({ x, y: fn(x) })).find(p => Number.isFinite(p.y) && gap(p) < 3);
      if (gx) options.push({ ...gx, label: trigMode() ? { x: piLabel(gx.x) } : { x: format(gx.x, 12), y: exactValue(hit.f.real, parameters, gx.x) } });
      // ponytail: up to 4 root searches per mouse move; fine for the one graph under the cursor.
      for (const level of roundNear(hit.y, tick(yscale()))) {
        const at = roots(t => fn(t) - level, fromX(px(hit.x) - 3), fromX(px(hit.x) + 3)).find(t => gap({ x: t, y: level }) < 3);
        if (at !== undefined) { options.push({ x: at, y: level, label: { x: exactPoint([hit.f.real, String(level)], parameters, at)?.x ?? null, y: format(level, 12) } }); break; }
      }
      const pick = options.sort((a, b) => gap(a) - gap(b))[0];
      if (pick) hit = { ...hit, ...pick, exact: true };
    }
  }
  tip.hidden = !hit;
  if (!hit) return;
  const hx = px(hit.x), hy = py(hit.y);
  hoverCtx.beginPath(); hoverCtx.arc(hx, hy, 5, 0, Math.PI * 2); hoverCtx.fillStyle = hit.color; hoverCtx.fill();
  hoverCtx.lineWidth = 2.5; hoverCtx.strokeStyle = theme['plot-bg']; hoverCtx.stroke();
  tip.innerHTML = hit.exact ? stacked(`x = ${hit.label?.x ?? approx(hit.x)}   y = ${hit.label?.y ?? approx(hit.y)}`) : `x ${format(hit.x)}   y ${format(hit.y)}`;
  tip.style.setProperty('--c', hit.color);
  tip.style.left = `${Math.max(8, Math.min(width - tip.offsetWidth - 8, hx + 14))}px`;
  tip.style.top = `${Math.max(8, Math.min(height - tip.offsetHeight - 8, hy - 40))}px`;
}
// On the complex plane: z under the cursor and f(z) (only z for sets), or the exact value of a zero within 8 px.
function complexHover(tip) {
  const f = active(), mark = marks.find(m => Math.hypot(px(m.x) - pointer.x, py(m.y) - pointer.y) < 8);
  tip.hidden = !f?.fn;
  if (!f?.fn) return;
  const short = v => format(v), z = mark ? [mark.x, mark.y] : [fromX(pointer.x), fromY(pointer.y)];
  if (mark) {
    hoverCtx.beginPath(); hoverCtx.arc(px(z[0]), py(z[1]), 5, 0, Math.PI * 2); hoverCtx.fillStyle = f.color; hoverCtx.fill();
    hoverCtx.lineWidth = 2.5; hoverCtx.strokeStyle = theme['plot-bg']; hoverCtx.stroke();
  }
  tip.innerHTML = mark ? stacked(`z = ${mark.text}`) : f.set ? `z = ${complexText(z, short)}` : `z = ${complexText(z, short)}   f(z) = ${complexText(f.cfn(z), short) ?? 'nie istnieje'}`;
  tip.style.setProperty('--c', f.color);
  tip.style.left = `${Math.max(8, Math.min(width - tip.offsetWidth - 8, pointer.x + 14))}px`;
  tip.style.top = `${Math.max(8, Math.min(height - tip.offsetHeight - 8, pointer.y - 40))}px`;
}
// Coalesce bursts of events (drag, wheel) into one redraw per animation frame.
let frame = 0, needDraw = false, needInsights = false;
function schedule({ graphs = false, insights = false } = {}) {
  needDraw ||= graphs; needInsights ||= insights;
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    // Zeros on the planes cost more than a frame: while moving they wait for settle(); the real-axis analysis stays live.
    if (needInsights && !(moving && (complexMode() || setMode()))) updateInsights(); else if (needDraw || needInsights) draw(); else drawHover();
    needDraw = needInsights = false;
  });
}
// While the wheel or a slider keeps going, the complex plane and sets are painted coarser (like dragging);
// 150 ms after the last change they are repainted sharp.
let moving = 0;
function settle() { clearTimeout(moving); moving = setTimeout(() => { moving = 0; schedule({ insights: true }); }, 150); }
function dot(x, y, r, fill, stroke) {
  x = px(x); y = py(y); if (x < -r || x > width + r || y < -r || y > height + r) return;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke();
}
// Splits each pixel step until the curve is straight to ½ px, so corners, domain edges (√(1−x²) meets the axis)
// and asymptotes (tan x, 1/x) are drawn exactly instead of being bridged or cut short.
// Returns the endpoint dots of the pieces it drew (domain edges, jumps, removable holes).
function plot(fn) {
  const Y = p => py(fn(fromX(p))), ok = Number.isFinite, limit = height * 10, tol = .5 / yscale(), ends = [];
  let pen = false;
  const point = (p, y) => {
    if (!ok(y)) { pen = false; return; }
    y = Math.max(-limit, Math.min(height + limit, y));
    if (pen) ctx.lineTo(p, y); else ctx.moveTo(p, y);
    pen = true;
  };
  const segment = (p0, y0, p1, y1, depth, parentDelta) => {
    if (!ok(y0) && !ok(y1)) return point(p1, y1);
    const both = ok(y0) && ok(y1), delta = Math.abs(y1 - y0);
    const offscreen = both && ((y0 < 0 && y1 < 0) || (y0 > height && y1 > height));
    if (depth && !offscreen) {
      const pm = (p0 + p1) / 2, ym = Y(pm);
      if (!both || delta > height || !ok(ym) || Math.abs(ym - (y0 + y1) / 2) > .5) { segment(p0, y0, pm, ym, depth - 1, delta); segment(pm, ym, p1, y1, depth - 1, delta); return; }
    }
    // After 8 halvings a continuous curve's step shrinks (by ~½ per halving, ~0.8 for ∛x); a jump (floor x, tan x) doesn't.
    const jump = !depth && both && !offscreen && delta > 2 && (delta > height || delta > .95 * parentDelta);
    if (jump || (!depth && !both)) {
      // A piece ends inside this 1/256 px step. Close the gap exactly: run the left piece into (c; its end),
      // lift the pen, start the right piece from (c; its start). ±∞ becomes a point far off-screen.
      const e = endpoint(fn, fromX(p0), fromX(p1), tol), pc = px(e.x);
      const at = v => v === Infinity ? -limit : v === -Infinity ? height + limit : py(v);
      ends.push(...e.dots);
      if (ok(y0) && !Number.isNaN(e.left)) point(pc, at(e.left));
      if (e.left !== e.right) pen = false; // equal sides = continuous, keep one stroke
      if (ok(y1) && !Number.isNaN(e.right)) point(pc, at(e.right));
    }
    point(p1, y1);
  };
  // ponytail: depth 8 (1/256 px) caps work on wild functions like sin(1/x); raise it if detail near such points matters.
  let p0 = 0, y0 = Y(0); point(p0, y0);
  for (let p = 1; p <= Math.ceil(width); p++) { const y = Y(p); segment(p0, y0, p, y, 8, Infinity); p0 = p; y0 = y; }
  return [...ends, ...holes(fn, view.min, view.max, tol)];
}
function resize() {
  const rect = $('canvas-wrap').getBoundingClientRect(); width = rect.width; height = rect.height;
  const dpr = window.devicePixelRatio || 1;
  for (const [c, cx] of [[canvas, ctx], [$('hover'), hoverCtx]]) { c.width = Math.round(width * dpr); c.height = Math.round(height * dpr); cx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  syncRange(); if (complexMode() || setMode()) updateInsights(); else draw(); // the y range (and on the complex plane the zeros) depend on the canvas height
}
function setView(next) { view = next; syncRange(); schedule({ insights: true }); }
function reset() { $('range-error').textContent = ''; setView({ min: -10, max: 10, cy: 0, ratio: 1 }); }
// fx, fy scale the visible x and y range (< 1 zooms in), keeping the point under (x; y) in place.
function zoom(fx, fy = fx, x = width / 2, y = height / 2) {
  const range = (view.max - view.min) * fx, ratio = view.ratio * fy / fx; if (!fits(range, ratio)) return;
  const anchorX = fromX(x), anchorY = fromY(y), min = anchorX - range * x / width;
  setView({ min, max: min + range, ratio, cy: anchorY - (height / 2 - y) * range * ratio / width });
}
function pan(dx, dy) { const s = scale(); setView({ ...view, min: view.min + dx / s, max: view.max + dx / s, cy: view.cy + dy / yscale() }); }
// Keeps the x range and fits y to the graphs.
function fit() {
  const ys = [];
  for (const f of plotted()) for (let i = 0; i <= 200; i++) { const y = f.fn(view.min + (view.max - view.min) * i / 200); if (Number.isFinite(y)) ys.push(y); }
  if (!ys.length) return toast('Brak wartości funkcji w tym zakresie.');
  ys.sort((a, b) => a - b);
  let low = ys[Math.floor(ys.length * .03)], high = ys[Math.min(ys.length - 1, Math.floor(ys.length * .97))];
  // Percentiles drop asymptote spikes but would clip a steep end (e^x on [0; 20]): keep true extremes that are near.
  const p = high - low; if (ys[0] >= low - 3 * p) low = ys[0]; if (ys.at(-1) <= high + 3 * p) high = ys.at(-1);
  const k = height * (view.max - view.min) / width, span = (high - low) * 1.2 || Math.max(2, Math.abs(low) / 2);
  setView({ ...view, cy: (low + high) / 2, ratio: Math.min(1e12 / k, Math.max(1e-4 / k, span / k)) });
}

// --- Events ---
new ResizeObserver(resize).observe($('canvas-wrap'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); draw(); });
$('add-function').onclick = () => addFunction();
// Clicking from one row to another: let the mousedown blur the edited row and it switches to the typeset formula (the height can change),
// the rows below jump up and the click lands elsewhere. So keep focus put on mousedown and move it ourselves.
$('functions').onmousedown = e => {
  if (e.target.matches('input')) return; // caret placement inside the field being edited
  e.preventDefault();
  const input = !e.target.closest('button') && e.target.closest('.fn')?.querySelector('input');
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
};
$('zoom-in').onclick = () => zoom(.75);
$('zoom-out').onclick = () => zoom(4 / 3);
$('fit-view').onclick = fit;
$('reset-view').onclick = reset;
$('equal-axes').onclick = () => setView({ ...view, ratio: 1 });
for (const id of ['grid-toggle', 'axes-toggle']) $(id).onchange = draw;
// Switching to trigonometric shows two periods; the complex plane needs equal axes.
$('axes-mode').onchange = e => {
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) canvas.animate([{ opacity: .15, filter: 'blur(3px)' }, { opacity: 1, filter: 'none' }], { duration: 380, easing: 'ease-out' });
  for (const f of functions) { f.set = null; setExpression(f, f.expression); } // i, z and = change meaning
  renderList(); renderParameters();
  e.target.value === 'trig' ? setView({ min: -2 * Math.PI, max: 2 * Math.PI, cy: 0, ratio: 1 }) : ['complex', 'set'].includes(e.target.value) ? setView({ ...view, ratio: 1 }) : updateInsights();
};
const rangeInputs = ['x-min', 'x-max', 'y-min', 'y-max'];
for (const id of rangeInputs) $(id).onchange = () => {
  const [x0, x1, y0, y1] = rangeInputs.map(id => $(id).value === '' ? NaN : Number($(id).value)), ratio = (y1 - y0) * width / (height * (x1 - x0));
  if (!fits(x1 - x0, ratio) || Math.max(Math.abs(x0), Math.abs(x1)) > 1e9 || Math.max(Math.abs(y0), Math.abs(y1)) > 1e15) {
    $('range-error').textContent = 'Podaj rosnące zakresy: X o szerokości od 0,0001 do 10 000 000 w granicach ±10⁹, Y o wysokości od 0,0001 do 10¹² w granicach ±10¹⁵.'; return;
  }
  $('range-error').textContent = ''; setView({ min: x0, max: x1, cy: (y0 + y1) / 2, ratio });
};
// Zoom by how far the wheel moved, not per event: a trackpad sends dozens of small events per gesture.
// Shift = y axis only (some systems then report the wheel as deltaX), Alt = x axis only.
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect(), delta = (e.shiftKey && !e.deltaY ? e.deltaX : e.deltaY) * [1, 16, height][e.deltaMode];
  if (!delta) return;
  // A mouse notch (~100 px) zooms ~13%; trackpad pinch arrives as ctrl+wheel with small deltas.
  const factor = Math.exp(Math.max(-300, Math.min(300, delta)) * (e.ctrlKey ? .01 : .0012));
  settle(); zoom(e.shiftKey ? 1 : factor, e.altKey ? 1 : factor, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
// One pointer drags the view, two pinch-zoom it. Every move is measured from the gesture's start, keeping the
// point that was under the start midpoint under the current midpoint (so a pinch also pans).
const pointers = new Map();
function startGesture() {
  const [a, b = a] = pointers.values(), r = canvas.getBoundingClientRect();
  drag = { view: { ...view }, x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top, d: Math.hypot(a.x - b.x, a.y - b.y) };
}
canvas.onpointerdown = e => {
  canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  startGesture(); canvas.style.cursor = 'grabbing'; schedule();
};
canvas.onpointermove = e => {
  const r = canvas.getBoundingClientRect(); pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  if (!pointers.has(e.pointerId)) return schedule();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const [a, b = a] = pointers.values(), mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top, d = Math.hypot(a.x - b.x, a.y - b.y);
  const v = drag.view, range = (v.max - v.min) * (drag.d && d ? drag.d / d : 1);
  if (!fits(range, v.ratio)) return;
  const sx = width / (v.max - v.min), anchorX = v.min + drag.x / sx, anchorY = v.cy + (height / 2 - drag.y) * v.ratio / sx;
  const min = anchorX - mx * range / width;
  view = { ...v, min, max: min + range, cy: anchorY - (height / 2 - my) * range * v.ratio / width }; syncRange();
  schedule({ graphs: true });
};
function endPointer(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (pointers.size) return startGesture(); // a finger lifted mid-pinch: carry on dragging with the other
  drag = null; canvas.style.cursor = ''; schedule({ insights: true });
}
canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = endPointer;
canvas.onpointerleave = () => { if (!drag) { pointer = null; schedule(); } };
canvas.onkeydown = e => {
  const moves = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
  if (moves[e.key]) { e.preventDefault(); pan(...moves[e.key]); }
  else if (['+', '='].includes(e.key)) { e.preventDefault(); zoom(.75); }
  else if (e.key === '-') { e.preventDefault(); zoom(4 / 3); }
  else if (e.key === '0') reset();
};
$('export').onclick = () => {
  const link = document.createElement('a'); link.download = 'bettergebra-wykres.png'; link.href = canvas.toDataURL('image/png'); link.click();
  toast('Wykres zapisany jako PNG.');
};
const showAnalysis = show => { $('analysis').hidden = !show; $('analysis-button').setAttribute('aria-pressed', String(show)); };
$('analysis-button').onclick = () => showAnalysis($('analysis').hidden);
document.querySelectorAll('.close-dialog').forEach(button => button.onclick = () => button.closest('dialog').close());
document.querySelectorAll('dialog').forEach(dialog => dialog.onclick = e => {
  const r = dialog.getBoundingClientRect();
  if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
});
document.fonts.ready.then(draw);

// --- Theme toggle ---
const themeBtn = $('theme-toggle');
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('bettergebra_theme', t); } catch {}
  readTheme();
  draw();
  if (themeBtn) {
    themeBtn.setAttribute('title', t === 'dark' ? 'Przełącz na jasny motyw' : 'Przełącz na ciemny motyw');
    themeBtn.setAttribute('aria-label', t === 'dark' ? 'Jasny motyw' : 'Ciemny motyw');
  }
}
const savedTheme = localStorage.getItem('bettergebra_theme');
if (savedTheme) {
  document.documentElement.dataset.theme = savedTheme;
}
if (themeBtn) {
  themeBtn.onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(cur === 'dark' ? 'light' : 'dark');
  };
}

// Everything (graphs, their settings, parameters, view, toggles) is kept in localStorage, saved whenever the page
// is hidden or closed, so a reload or a new visit brings it all back.
const STORE = 'bettergebra', toggles = ['grid-toggle', 'axes-toggle', 'snap-toggle'];
function save() {
  const graphs = functions.map(({ expression, color, visible, from, to, fromOpen, toOpen, width, dash }) => ({ expression, color, visible, from, to, fromOpen, toOpen, width, dash }));
  const state = { graphs, active: functions.findIndex(f => f.id === activeId), parameters, view, mode: $('axes-mode').elements.mode.value, toggles: toggles.map(id => $(id).checked) };
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} // private mode or full storage: just don't remember
}
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
function restore() {
  let state; try { state = JSON.parse(localStorage.getItem(STORE)); } catch {}
  if (!state?.graphs?.length) return false;
  $('axes-mode').elements.mode.value = state.mode ?? ''; toggles.forEach((id, k) => $(id).checked = state.toggles?.[k] ?? true);
  Object.assign(parameters, state.parameters); if (state.view) view = state.view;
  // JSON writes ±Infinity (an unbounded interval) as null.
  for (const g of state.graphs.slice(0, MAX)) addFunction(g.expression, false, { ...g, from: g.from ?? -Infinity, to: g.to ?? Infinity });
  activeId = (functions[state.active] ?? functions[0]).id;
  return true;
}
readTheme();
if (!restore()) { addFunction('x^2', false); addFunction('sin(x)', false); activeId = functions[0].id; }
functions.forEach(syncRow); refresh();
