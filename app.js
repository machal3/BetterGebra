import { compile, roots, parameterNames, toMathML, intersections, exact, exactPoint, exactValue, endpoint, holes } from './math.js';
const parameters = Object.create(null);
const $ = id => document.getElementById(id);
const MAX = 8;
const palette = ['#4f6bed', '#e5484d', '#12a594', '#f08c00', '#8e4ec6', '#0090c1', '#d6409f', '#5c7c2f'];
const removeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const settingsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
let functions = [], nextId = 1, activeId = null, marks = [];
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

function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').classList.remove('visible'), 2600); }
function readTheme() { const s = getComputedStyle(document.documentElement); for (const k of ['plot-bg', 'grid-minor', 'grid-major', 'axis', 'label']) theme[k] = s.getPropertyValue(`--${k}`).trim(); }

// --- Function list ---
function setExpression(f, expression) {
  f.expression = expression;
  f.parameters = [];
  if (!expression.trim()) { f.fn = null; f.error = ''; return; }
  try {
    f.parameters = parameterNames(expression);
    for (const name of f.parameters) if (!Object.hasOwn(parameters, name)) parameters[name] = 1;
    // Outside the chosen interval the graph doesn't exist: plot, roots and hover all see NaN there.
    const fn = compile(expression, parameters); f.fn = x => x < f.from || x > f.to ? NaN : fn(x); f.error = '';
  } catch (e) { f.fn = null; f.error = e.message; }
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
    const fitSlider = value => { slider.min = Math.min(-10, Math.floor(value)); slider.max = Math.max(10, Math.ceil(value)); slider.value = value; };
    fitSlider(parameters[name]);
    const apply = value => { parameters[name] = value; updateInsights(); };
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
    row.append(label, input, slider, error); return row;
  }));
}
function addFunction(expression = '', focus = true, settings = {}) {
  if (functions.length >= MAX) return toast('Możesz porównywać do 8 funkcji naraz.');
  const f = { id: nextId++, color: palette.find(c => !functions.some(g => g.color === c)), visible: true, from: -Infinity, to: Infinity, width: 2.25, dash: '', ...settings };
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
  $('fn-domain-error').textContent = ''; $('fn-dash').value = menuFn.dash; $('fn-width').value = menuFn.width;
}
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
$('fn-width').oninput = e => { menuFn.width = e.target.valueAsNumber; draw(); };
const domainInputs = [$('fn-from'), $('fn-to')];
for (const input of domainInputs) input.oninput = () => {
  const [from, to] = domainInputs.map((el, i) => el.value === '' ? (i ? Infinity : -Infinity) : el.valueAsNumber);
  const valid = from < to;
  $('fn-domain-error').textContent = valid ? '' : 'Początek przedziału musi być mniejszy niż koniec.';
  if (valid) { Object.assign(menuFn, { from, to }); syncRow(menuFn); updateInsights(); }
};
$('fn-duplicate').onclick = () => {
  const { expression, from, to, width, dash } = menuFn; $('fn-menu').hidePopover();
  addFunction(expression, false, { from, to, width, dash });
};
$('fn-delete').onclick = () => removeFunction(menuFn.id);
$('fn-menu').addEventListener('toggle', e => { if (e.newState === 'closed') menuClosedAt = performance.now(); });
$('fn-menu').addEventListener('toggle', e => document.querySelectorAll('.swatch, .settings-button').forEach(s => s.setAttribute('aria-expanded', String(e.newState === 'open' && s.closest('.fn').dataset.id === String(menuFn.id)))));
const rowInput = id => document.querySelector(`[data-id="${id}"] input`);
function syncRow(f) {
  const row = document.querySelector(`[data-id="${f.id}"]`);
  row.classList.toggle('active', f.id === activeId);
  row.classList.toggle('invalid', !!f.error);
  row.classList.toggle('hidden-fn', !f.visible);
  row.querySelector('.swatch').setAttribute('aria-label', `Ustawienia: funkcja ${functions.indexOf(f) + 1}${f.visible ? '' : ' (ukryta)'}`);
  const bounded = Number.isFinite(f.from) || Number.isFinite(f.to);
  row.querySelector('.fn-domain').textContent = bounded ? `x ∈ ${Number.isFinite(f.from) ? `⟨${format(f.from)}` : '(−∞'}; ${Number.isFinite(f.to) ? `${format(f.to)}⟩` : '+∞)'}` : '';
  row.querySelector('input').setAttribute('aria-invalid', String(!!f.error));
  row.querySelector('.error').textContent = f.error;
  // Typeset formula when finished; raw text + live preview while editing (or while empty/invalid).
  const editing = f.editing || !f.fn, math = f.fn ? toMathML(f.expression) : '';
  row.classList.toggle('editing', editing);
  row.querySelector('.fn-math').innerHTML = editing ? '' : math;
  const preview = row.querySelector('.fn-preview');
  preview.hidden = !editing || !f.fn; preview.innerHTML = editing ? math : '';
}
function renderList() {
  $('function-list').replaceChildren(...functions.map((f, i) => {
    const row = document.createElement('li'); row.className = 'fn'; row.dataset.id = f.id; row.style.setProperty('--c', f.color);
    const swatch = document.createElement('button'); swatch.type = 'button'; swatch.className = 'swatch';
    swatch.setAttribute('aria-haspopup', 'dialog'); swatch.setAttribute('aria-expanded', 'false');
    swatch.title = 'Ustawienia funkcji'; swatch.onclick = () => openMenu(f, swatch);
    const field = document.createElement('label'); field.className = 'fn-field';
    const prefix = document.createElement('span'); prefix.textContent = 'y =';
    const input = document.createElement('input');
    Object.assign(input, { value: f.expression, placeholder: i ? 'np. sin(x)' : 'np. x^2 - 2', autocomplete: 'off', spellcheck: false });
    input.setAttribute('aria-label', `Funkcja ${i + 1}`); input.setAttribute('aria-describedby', `err-${f.id}`);
    input.oninput = () => { setExpression(f, input.value); syncRow(f); renderParameters(); updateInsights(); };
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
    const preview = document.createElement('div'); preview.className = 'fn-preview'; preview.setAttribute('aria-hidden', 'true');
    const error = document.createElement('p'); error.className = 'error'; error.id = `err-${f.id}`; error.setAttribute('role', 'alert');
    const domain = document.createElement('p'); domain.className = 'fn-domain';
    row.append(swatch, field, settings, remove, preview, domain, error);
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
  target.innerHTML = ''; const label = document.createElement('span'); if (fn) label.innerHTML = toMathML(f.expression); else label.textContent = 'brak funkcji'; target.append(label);
  for (const [id, x] of [['value-zero', 0], ['value-one', 1]]) {
    const proven = fn && exactValue(f.expression, parameters, x);
    $(id).innerHTML = !fn ? '—' : proven === undefined || !Number.isFinite(fn(x)) ? 'nie istnieje' : stacked(proven ?? approx(fn(x)));
  }
  marks = [];
  if (!fn) { $('roots').textContent = $('intersections').textContent = '—'; return draw(); }
  const zeroOnView = h => Array.from({ length: 31 }, (_, i) => h(view.min + (view.max - view.min) * i / 30)).every(y => y === 0);
  const allZero = zeroOnView(fn), values = allZero ? [] : roots(fn, view.min, view.max);
  const rootMarks = values.map(x => ({ x, y: 0, label: exactPoint([f.expression, '0'], parameters, x) }));
  $('roots').innerHTML = allZero ? 'cały widoczny zakres' : values.length ? stacked(`x = ${list(rootMarks.map(m => m.label?.x ?? approx(m.x)))}`) : 'brak';
  const others = plotted().filter(g => g !== f && !zeroOnView(x => fn(x) - g.fn(x)));
  const crossings = others.flatMap(g => intersections(fn, g.fn, view.min, view.max).map(p => ({ ...p, label: exactPoint([f.expression, g.expression], parameters, p.x) }))).sort((a, b) => a.x - b.x)
    .filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y); // two graphs crossing at one point: list it once
  $('intersections').innerHTML = !others.length ? '—' : crossings.length ? stacked(list(crossings.map(p => `(${p.label?.x ?? approx(p.x)}; ${p.label?.y ?? approx(p.y)})`), 4)) : 'brak';
  if (f.visible) marks = [...rootMarks, ...crossings];
  draw();
}
function syncRange() {
  const bottom = fromY(height), top = fromY(0), short = v => Number(v.toPrecision(7));
  [$('x-min').value, $('x-max').value, $('y-min').value, $('y-max').value] = [view.min, view.max, bottom, top].map(short);
  $('scale-label').textContent = `x ∈ [${format(view.min)}; ${format(view.max)}]   y ∈ [${format(bottom)}; ${format(top)}]`;
}
function refresh() { renderParameters(); draw(); updateInsights(); syncRange(); }

// --- Plot ---
function draw() {
  if (!width || !height) return;
  ctx.fillStyle = theme['plot-bg']; ctx.fillRect(0, 0, width, height);
  const bottom = fromY(height), top = fromY(0);
  const tick = unit => { const raw = 70 / unit, magnitude = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map(v => v * magnitude).find(v => v >= raw); };
  const step = tick(scale()), ystep = tick(yscale());
  function grid(sx, sy, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = Math.ceil(view.min / sx) * sx; x <= view.max; x += sx) { const p = Math.round(px(x)) + .5; ctx.moveTo(p, 0); ctx.lineTo(p, height); }
    for (let y = Math.ceil(bottom / sy) * sy; y <= top; y += sy) { const p = Math.round(py(y)) + .5; ctx.moveTo(0, p); ctx.lineTo(width, p); }
    ctx.stroke();
  }
  if ($('grid-toggle').checked) { grid(step / 5, ystep / 5, theme['grid-minor']); grid(step, ystep, theme['grid-major']); }
  if ($('axes-toggle').checked) {
    ctx.strokeStyle = theme.axis; ctx.lineWidth = 1.25; ctx.beginPath();
    ctx.moveTo(Math.round(px(0)) + .5, 0); ctx.lineTo(Math.round(px(0)) + .5, height); ctx.moveTo(0, Math.round(py(0)) + .5); ctx.lineTo(width, Math.round(py(0)) + .5); ctx.stroke();
    ctx.fillStyle = theme.label; ctx.font = '11px "Geist Mono", ui-monospace, monospace';
    const ys = []; for (let y = Math.ceil(bottom / ystep) * ystep; y < top; y += ystep) if (Math.abs(y) > ystep / 100) ys.push(y);
    // Long y labels (485 165 195) push the pinned axis right instead of running off the canvas.
    const labelWidth = Math.max(0, ...ys.map(y => ctx.measureText(format(y)).width));
    const axisY = Math.max(14, Math.min(height - 40, py(0))), axisX = Math.max(labelWidth + 14, Math.min(width - 12, px(0)));
    ctx.textAlign = 'center';
    for (let x = Math.ceil(view.min / step) * step; x < view.max; x += step) if (Math.abs(x) > step / 100 && px(x) > 16 && px(x) < width - 24) ctx.fillText(format(x), px(x), axisY + 16);
    ctx.textAlign = 'right';
    for (const y of ys) ctx.fillText(format(y), axisX - 8, py(y) + 4);
    if (axisX === px(0) && axisY === py(0)) ctx.fillText('0', axisX - 8, axisY + 16); // origin label only where the axes really cross
    ctx.font = 'italic 14px Georgia, serif'; ctx.fillText('x', width - 14, axisY - 8); ctx.textAlign = 'left'; ctx.fillText('y', axisX + 8, 18);
  }
  const current = active();
  ctx.lineJoin = ctx.lineCap = 'round';
  const ends = [];
  for (const f of [...plotted().filter(f => f !== current), ...(current?.visible && current.fn ? [current] : [])]) {
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
// The cursor dot lives on its own canvas layer: moving the mouse redraws only this, never the graphs,
// so it keeps up with the cursor. It follows the graph nearest to the cursor and is recomputed after
// every redraw, so it stays right after panning or zooming too.
function drawHover() {
  hoverCtx.clearRect(0, 0, width, height);
  const tip = $('coordinates');
  if (!pointer || drag) { tip.hidden = true; return; }
  // A root or intersection within 8 px wins: show its exact coordinates.
  const mark = marks.find(m => Math.hypot(px(m.x) - pointer.x, py(m.y) - pointer.y) < 8);
  let hit = mark && { ...mark, color: active().color, exact: true };
  if (!hit) {
    const x = fromX(pointer.x);
    for (const f of plotted()) {
      const y = f.fn(x), d = Math.abs(py(y) - pointer.y);
      if (Number.isFinite(y) && d < 24 && (!hit || d < hit.d)) hit = { x, y, color: f.color, d };
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
// Coalesce bursts of events (drag, wheel) into one redraw per animation frame.
let frame = 0, needDraw = false, needInsights = false;
function schedule({ graphs = false, insights = false } = {}) {
  needDraw ||= graphs; needInsights ||= insights;
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    if (needInsights) updateInsights(); else if (needDraw) draw(); else drawHover();
    needDraw = needInsights = false;
  });
}
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
  syncRange(); draw(); // the y range depends on the canvas height
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
// Clicking from one row to another: let the mousedown blur the edited row and it collapses (its preview goes),
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
  zoom(e.shiftKey ? 1 : factor, e.altKey ? 1 : factor, e.clientX - r.left, e.clientY - r.top);
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
$('help-button').onclick = () => $('help-dialog').showModal();
$('examples-button').onclick = () => $('examples-dialog').showModal();
document.querySelectorAll('[data-expression]').forEach(button => button.onclick = () => {
  $('examples-dialog').close();
  const f = active();
  if (f && !f.expression.trim()) { setExpression(f, button.dataset.expression); rowInput(f.id).value = f.expression; syncRow(f); refresh(); }
  else addFunction(button.dataset.expression, false);
});
document.querySelectorAll('.close-dialog').forEach(button => button.onclick = () => button.closest('dialog').close());
document.querySelectorAll('dialog').forEach(dialog => dialog.onclick = e => {
  const r = dialog.getBoundingClientRect();
  if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
});
document.fonts.ready.then(draw);

readTheme();
addFunction('x^2', false);
addFunction('sin(x)', false);
activeId = functions[0].id; functions.forEach(syncRow); refresh();
