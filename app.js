import { compile, roots, parameterNames, toMathML, intersections, exact, endpoint, holes } from './math.js';
const parameters = Object.create(null);
const $ = id => document.getElementById(id);
const MAX = 8;
const palette = ['#4f6bed', '#e5484d', '#12a594', '#f08c00', '#8e4ec6', '#0090c1', '#d6409f', '#5c7c2f'];
const removeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
let functions = [], nextId = 1, activeId = null, marks = [];
let view = { min: -10, max: 10, cy: 0 }, width = 0, height = 0, drag = null, pointer = null, theme = {};
const canvas = $('plot'), ctx = canvas.getContext('2d'), hoverCtx = $('hover').getContext('2d');
const format = (n, digits = 5) => Math.abs(n) < 1e-8 ? '0' : Number(n.toPrecision(digits)).toLocaleString('pl-PL', { maximumFractionDigits: digits });
// Exact form when recognisable (√2, π/4, 1/3), otherwise 8 significant digits.
const value = n => exact(n) ?? `≈ ${format(n, 8)}`;
// Shows the fractions in value() strings stacked (MathML) instead of as 5/13. Only for our own number strings.
const stacked = s => s.replace(/([\dπ√]+)\/(\d+)/g, '<math><mfrac><mn>$1</mn><mn>$2</mn></mfrac></math>');
const list = (items, max = 6) => items.slice(0, max).join(';  ') + (items.length > max ? ';  …' : '');
const scale = () => width / (view.max - view.min);
const px = x => (x - view.min) * scale();
const py = y => height / 2 - (y - view.cy) * scale();
const fromX = x => view.min + x / scale();
const fromY = y => view.cy + (height / 2 - y) / scale();
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
    f.fn = compile(expression, parameters); f.error = '';
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
function addFunction(expression = '', focus = true) {
  if (functions.length >= MAX) return toast('Możesz porównywać do 8 funkcji naraz.');
  const f = { id: nextId++, color: palette.find(c => !functions.some(g => g.color === c)), visible: true };
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
// --- Colour & visibility menu ---
let menuFn = null, menuClosedAt = 0;
$('fn-colors').append(...palette.map(color => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'color'; b.style.setProperty('--sw', color); b.dataset.color = color;
  b.setAttribute('aria-label', `Kolor ${color}`); b.onclick = () => setColor(menuFn, color); return b;
}));
function syncMenu() {
  $('fn-colors').querySelectorAll('.color').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === menuFn.color)));
  $('fn-custom-color').value = menuFn.color; $('fn-visible').checked = menuFn.visible;
}
function setColor(f, color) {
  f.color = color; document.querySelector(`[data-id="${f.id}"]`).style.setProperty('--c', color);
  syncMenu(); updateInsights();
}
function openMenu(f, swatch) {
  const menu = $('fn-menu');
  if (menu.matches(':popover-open') && menuFn === f) return menu.hidePopover();
  if (menuFn === f && performance.now() - menuClosedAt < 300) return; // this click's pointerdown already light-dismissed it
  menuFn = f; syncMenu(); menu.showPopover();
  const r = swatch.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 8)}px`;
}
$('fn-custom-color').oninput = e => setColor(menuFn, e.target.value);
$('fn-visible').onchange = e => { menuFn.visible = e.target.checked; syncRow(menuFn); updateInsights(); };
$('fn-menu').addEventListener('toggle', e => { if (e.newState === 'closed') menuClosedAt = performance.now(); });
$('fn-menu').addEventListener('toggle', e => document.querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-expanded', String(e.newState === 'open' && s.closest('.fn').dataset.id === String(menuFn.id)))));
const rowInput = id => document.querySelector(`[data-id="${id}"] input`);
function syncRow(f) {
  const row = document.querySelector(`[data-id="${f.id}"]`);
  row.classList.toggle('active', f.id === activeId);
  row.classList.toggle('invalid', !!f.error);
  row.classList.toggle('hidden-fn', !f.visible);
  row.querySelector('.swatch').setAttribute('aria-label', `Kolor i widoczność: funkcja ${functions.indexOf(f) + 1}${f.visible ? '' : ' (ukryta)'}`);
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
    swatch.title = 'Kolor i widoczność'; swatch.onclick = () => openMenu(f, swatch);
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
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon remove'; remove.innerHTML = removeIcon;
    remove.setAttribute('aria-label', `Usuń funkcję ${i + 1}`); remove.onclick = () => removeFunction(f.id);
    const preview = document.createElement('div'); preview.className = 'fn-preview'; preview.setAttribute('aria-hidden', 'true');
    const error = document.createElement('p'); error.className = 'error'; error.id = `err-${f.id}`; error.setAttribute('role', 'alert');
    row.append(swatch, field, remove, preview, error);
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
  for (const [id, x] of [['value-zero', 0], ['value-one', 1]]) $(id).innerHTML = !fn ? '—' : Number.isFinite(fn(x)) ? stacked(value(fn(x))) : 'nie istnieje';
  marks = [];
  if (!fn) { $('roots').textContent = $('intersections').textContent = '—'; return draw(); }
  const zeroOnView = h => Array.from({ length: 31 }, (_, i) => h(view.min + (view.max - view.min) * i / 30)).every(y => y === 0);
  const allZero = zeroOnView(fn), values = allZero ? [] : roots(fn, view.min, view.max);
  $('roots').innerHTML = allZero ? 'cały widoczny zakres' : values.length ? stacked(`x = ${list(values.map(value))}`) : 'brak';
  const others = plotted().filter(g => g !== f && !zeroOnView(x => fn(x) - g.fn(x)));
  const crossings = others.flatMap(g => intersections(fn, g.fn, view.min, view.max)).sort((a, b) => a.x - b.x)
    .filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y); // two graphs crossing at one point: list it once
  $('intersections').innerHTML = !others.length ? '—' : crossings.length ? stacked(list(crossings.map(p => `(${value(p.x)}; ${value(p.y)})`), 4)) : 'brak';
  if (f.visible) marks = [...values.map(x => ({ x, y: 0 })), ...crossings];
  draw();
}
function syncRange() { $('x-min').value = Number(view.min.toFixed(3)); $('x-max').value = Number(view.max.toFixed(3)); $('scale-label').textContent = `x ∈ [${format(view.min)}; ${format(view.max)}]`; }
function refresh() { renderParameters(); draw(); updateInsights(); syncRange(); }

// --- Plot ---
function draw() {
  if (!width || !height) return;
  ctx.fillStyle = theme['plot-bg']; ctx.fillRect(0, 0, width, height);
  const unit = scale(), bottom = fromY(height), top = fromY(0);
  const raw = 70 / unit, magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(v => v * magnitude).find(v => v >= raw);
  function grid(spacing, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = Math.ceil(view.min / spacing) * spacing; x <= view.max; x += spacing) { const p = Math.round(px(x)) + .5; ctx.moveTo(p, 0); ctx.lineTo(p, height); }
    for (let y = Math.ceil(bottom / spacing) * spacing; y <= top; y += spacing) { const p = Math.round(py(y)) + .5; ctx.moveTo(0, p); ctx.lineTo(width, p); }
    ctx.stroke();
  }
  if ($('grid-toggle').checked) { grid(step / 5, theme['grid-minor']); grid(step, theme['grid-major']); }
  if ($('axes-toggle').checked) {
    ctx.strokeStyle = theme.axis; ctx.lineWidth = 1.25; ctx.beginPath();
    ctx.moveTo(Math.round(px(0)) + .5, 0); ctx.lineTo(Math.round(px(0)) + .5, height); ctx.moveTo(0, Math.round(py(0)) + .5); ctx.lineTo(width, Math.round(py(0)) + .5); ctx.stroke();
    ctx.fillStyle = theme.label; ctx.font = '11px "Geist Mono", ui-monospace, monospace';
    const axisY = Math.max(14, Math.min(height - 40, py(0))), axisX = Math.max(30, Math.min(width - 12, px(0)));
    ctx.textAlign = 'center';
    for (let x = Math.ceil(view.min / step) * step; x < view.max; x += step) if (Math.abs(x) > step / 100 && px(x) > 16 && px(x) < width - 24) ctx.fillText(format(x), px(x), axisY + 16);
    ctx.textAlign = 'right';
    for (let y = Math.ceil(bottom / step) * step; y < top; y += step) if (Math.abs(y) > step / 100) ctx.fillText(format(y), axisX - 8, py(y) + 4);
    ctx.fillText('0', axisX - 8, axisY + 16);
    ctx.font = 'italic 14px Georgia, serif'; ctx.fillText('x', width - 14, axisY - 8); ctx.textAlign = 'left'; ctx.fillText('y', axisX + 8, 18);
  }
  const current = active();
  ctx.lineJoin = ctx.lineCap = 'round';
  const ends = [];
  for (const f of [...plotted().filter(f => f !== current), ...(current?.visible && current.fn ? [current] : [])]) {
    ctx.beginPath(); ctx.lineWidth = f === current ? 2.75 : 2.25; ctx.strokeStyle = f.color;
    for (const e of plot(f.fn)) ends.push({ ...e, color: f.color });
    ctx.stroke();
  }
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
  let hit = mark && { x: mark.x, y: mark.y, color: active().color, exact: true };
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
  tip.innerHTML = hit.exact ? stacked(`x = ${value(hit.x)}   y = ${value(hit.y)}`) : `x ${format(hit.x)}   y ${format(hit.y)}`;
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
  const Y = p => py(fn(fromX(p))), ok = Number.isFinite, limit = height * 10, tol = .5 / scale(), ends = [];
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
  draw();
}
function setView(next) { view = next; syncRange(); schedule({ insights: true }); }
function reset() { $('range-error').textContent = ''; setView({ min: -10, max: 10, cy: 0 }); }
function zoom(factor, x = width / 2, y = height / 2) {
  const range = (view.max - view.min) * factor; if (range < .0001 || range > 1e7) return;
  const anchorX = fromX(x), anchorY = fromY(y), min = anchorX - range * x / width;
  setView({ min, max: min + range, cy: anchorY - (height / 2 - y) * range / width });
}
function pan(dx, dy) { const s = scale(); setView({ min: view.min + dx / s, max: view.max + dx / s, cy: view.cy + dy / s }); }
function fit() {
  const ys = [];
  for (const f of plotted()) for (let i = 0; i <= 200; i++) { const y = f.fn(view.min + (view.max - view.min) * i / 200); if (Number.isFinite(y)) ys.push(y); }
  if (!ys.length) return toast('Brak wartości funkcji w tym zakresie.');
  ys.sort((a, b) => a - b);
  const low = ys[Math.floor(ys.length * .03)], high = ys[Math.min(ys.length - 1, Math.floor(ys.length * .97))];
  const range = Math.min(1e7, Math.max(view.max - view.min, (high - low || 2) * width / height * 1.2)), center = (view.min + view.max) / 2;
  setView({ min: center - range / 2, max: center + range / 2, cy: (low + high) / 2 });
}

// --- Events ---
new ResizeObserver(resize).observe($('canvas-wrap'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); draw(); });
$('add-function').onclick = () => addFunction();
$('zoom-in').onclick = () => zoom(.75);
$('zoom-out').onclick = () => zoom(4 / 3);
$('fit-view').onclick = fit;
$('reset-view').onclick = reset;
for (const id of ['grid-toggle', 'axes-toggle']) $(id).onchange = draw;
for (const id of ['x-min', 'x-max']) $(id).onchange = () => {
  const min = Number($('x-min').value), max = Number($('x-max').value);
  if (!$('x-min').value || !$('x-max').value || !Number.isFinite(min) || !Number.isFinite(max) || max - min < .0001 || max - min > 1e7 || Math.max(Math.abs(min), Math.abs(max)) > 1e9) {
    $('range-error').textContent = 'Podaj rosnący zakres o szerokości od 0,0001 do 10 000 000, w granicach ±10⁹.'; return;
  }
  $('range-error').textContent = ''; setView({ ...view, min, max });
};
canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
canvas.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, ...view }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; schedule(); };
canvas.onpointermove = e => {
  const r = canvas.getBoundingClientRect(); pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  if (!drag) return schedule();
  const dx = (e.clientX - drag.x) / scale();
  view = { min: drag.min - dx, max: drag.max - dx, cy: drag.cy + (e.clientY - drag.y) / scale() }; syncRange();
  schedule({ graphs: true });
};
function endDrag() { if (drag) { drag = null; canvas.style.cursor = ''; schedule({ insights: true }); } }
canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = endDrag;
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
