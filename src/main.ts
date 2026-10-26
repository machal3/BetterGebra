import './styles/tokens.css';
import './styles/app.css';
import { StrictMode, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { panelFromHash } from './app/navigation';
import { isDark, systemDark } from './app/theme';
import { AnalysisClient } from './analysis/client';
import type { AnalysisResult } from './analysis/compute';
import { format } from './format';
import { labelDigits } from './render/plot2d';
import { initGeometry, redrawGeometry } from './geometry/panel';
import { forget } from './model';
import { Scene } from './render/scene';
import { fits } from './render/viewport';
import { addFunction, commit, on, restore, save, state, type AxisUnit } from './state';
import { initAnalysisPanel, renderAnalysis, syncPanelVisibility } from './ui/analysis-panel';
import { redrawCalcPlots } from './ui/calc-plot';
import { calculatorFromHash, initCalculator } from './ui/calculator';
import { fitY, initCanvasInput, setView, settle } from './ui/canvas-input';
import { $, initTooltips, toast } from './ui/dom';
import { initFunctionList, syncList } from './ui/function-list';
import { initParameters, syncParameters } from './ui/parameters';

if (!restore()) {
  addFunction('x^2');
  addFunction('sin(x)');
  state.activeId = state.functions[0].id;
}

const scene = new Scene($<HTMLCanvasElement>('plot'), $<HTMLCanvasElement>('hover'), $('readout'));
let latest: AnalysisResult | null = null;
const analysis = new AnalysisClient(result => {
  // Older answers can still arrive after a newer request was sent; they are fine to show until the next one lands.
  latest = result;
  scene.analysis = result;
  scene.request();
});
scene.onDrawn = () => renderAnalysis(latest, scene.found);

function requestAnalysis(): void {
  if (!scene.width || !scene.height) return;
  const vp = scene.vp;
  analysis.request({
    mode: state.mode,
    functions: state.functions.map(f => ({ ...f })),
    activeId: state.activeId,
    params: { ...state.params },
    bounds: { xmin: vp.min, xmax: vp.max, ymin: vp.bottom, ymax: vp.top, width: vp.width, height: vp.height },
  });
}

// --- Theme ---
function applyTheme(): void {
  const dark = isDark();
  // Always resolved: the Affect UI components follow data-theme, not the system preference.
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // the browser chrome takes the colour of the top bar
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) { m.removeAttribute('media'); m.content = dark ? '#161618' : '#ffffff'; }
  scene.refreshTheme();
  redrawGeometry();
  redrawCalcPlots();
}
systemDark.addEventListener('change', applyTheme);

// --- Panels: home | graphs | geometry | calculator (the hash keeps the choice across reloads) ---
function syncPanel(): void {
  const hash = location.hash;
  // #kalkulator?q=… opens the calculator with that question (links to a result)
  document.body.dataset.panel = panelFromHash(hash);
  // a function's settings live in the top layer, outside the panel: they would stay over the next one
  if (document.body.dataset.panel !== 'graphs') document.querySelectorAll<HTMLElement>('[id^="fn-settings-"]:popover-open').forEach(p => p.hidePopover());
  if (document.body.dataset.panel === 'calculator') calculatorFromHash();
}
addEventListener('hashchange', syncPanel);

// --- View panel ---
const toggles = { grid: $<HTMLInputElement>('grid-toggle'), axes: $<HTMLInputElement>('axes-toggle'), snap: $<HTMLInputElement>('snap-toggle') };
for (const [key, input] of Object.entries(toggles) as [keyof typeof toggles, HTMLInputElement][]) {
  input.addEventListener('change', () => { state[key] = input.checked; commit('toggles'); });
}
const rangeIds = ['x-min', 'x-max', 'y-min', 'y-max'];
const rangeInputs = rangeIds.map(id => $<HTMLInputElement>(id));
function syncRange(): void {
  const vp = scene.vp, short = (v: number) => String(Number(v.toPrecision(7)));
  if (!scene.width) return;
  [vp.min, vp.max, vp.bottom, vp.top].forEach((v, i) => { if (document.activeElement !== rangeInputs[i]) rangeInputs[i].value = short(v); });
  const xd = labelDigits(Math.max(Math.abs(vp.min), Math.abs(vp.max)), (vp.max - vp.min) / 10), yd = labelDigits(Math.max(Math.abs(vp.bottom), Math.abs(vp.top)), (vp.top - vp.bottom) / 10);
  $('range-caption').textContent = `x ∈ [${format(vp.min, xd)}; ${format(vp.max, xd)}]   y ∈ [${format(vp.bottom, yd)}; ${format(vp.top, yd)}]`;
}
for (const input of rangeInputs) input.addEventListener('change', () => {
  const [x0, x1, y0, y1] = rangeInputs.map(i => i.value === '' ? NaN : Number(i.value));
  const ratio = (y1 - y0) * scene.width / (scene.height * (x1 - x0));
  const ok = x1 > x0 && y1 > y0 && fits(x1 - x0, ratio, scene.width, scene.height) && Math.max(Math.abs(x0), Math.abs(x1)) <= 1e9 && Math.max(Math.abs(y0), Math.abs(y1)) <= 1e15
    // float64 must still tell the grid lines apart that far from 0
    && x1 - x0 >= 1e-10 * Math.max(Math.abs(x0), Math.abs(x1)) && y1 - y0 >= 1e-10 * Math.max(Math.abs(y0), Math.abs(y1));
  $('range-error').textContent = ok ? '' : 'Podaj rosnące zakresy: x o szerokości od 0,0001 do 10 000 000 (w granicach ±10⁹), y o wysokości od 0,0001 do 10¹² (w granicach ±10¹⁵), nie węższe niż 10⁻¹⁰ swoich wartości.';
  if (ok) setView({ min: x0, max: x1, cy: (y0 + y1) / 2, ratio });
});
const units = { xUnit: $<HTMLSelectElement>('x-unit'), yUnit: $<HTMLSelectElement>('y-unit') };
for (const [key, select] of Object.entries(units) as [keyof typeof units, HTMLSelectElement][]) {
  select.addEventListener('change', () => { state[key] = select.value as AxisUnit; commit('toggles'); });
}
const syncToggles = () => {
  for (const [key, input] of Object.entries(toggles)) input.checked = state[key as keyof typeof toggles];
  for (const [key, select] of Object.entries(units)) select.value = state[key as keyof typeof units];
};

// --- Export ---
$('export').addEventListener('click', async () => {
  const blob = await scene.toBlob();
  if (!blob) { toast('Nie udało się zapisać obrazu.'); return; }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'bettergebra-wykres.png'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Wykres zapisany jako PNG.');
});

// --- Help & global keys ---
const help = $<HTMLDialogElement>('help');
help.addEventListener('click', e => { if (e.target === help) help.close(); }); // click on the backdrop
document.addEventListener('keydown', e => {
  const t = e.target as HTMLElement;
  if (e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [contenteditable]') || help.open || document.body.dataset.panel !== 'graphs') return;
  if (e.key === '?') { e.preventDefault(); help.showModal(); }
  else if (e.key === 'b' || e.key === 'B') { state.analysisOpen = !state.analysisOpen; commit('panel'); }
  else if (e.key === 'f' || e.key === 'F') fitY();
});

// --- Wiring: who reacts to what ---
on(['list', 'expr', 'active', 'mode', 'style'], () => syncList());
on(['list', 'expr', 'mode'], () => { forget(new Set(state.functions.map(f => f.id))); syncParameters(); });
on(['list', 'expr', 'active', 'mode', 'style', 'params', 'view', 'toggles'], topics => {
  if (topics.has('mode')) document.body.dataset.mode = state.mode;
  if (topics.has('view') || topics.has('mode')) syncRange();
  scene.request();
  // Grid, axes and snapping don't change the analysis.
  if ([...topics].some(t => t !== 'toggles')) requestAnalysis();
});
on(['theme'], applyTheme);
on(['panel'], () => { syncPanelVisibility(); renderAnalysis(latest, scene.found); });

addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// --- Start ---
initFunctionList();
initParameters(settle);
initAnalysisPanel();
initCanvasInput(scene);
initGeometry();
initCalculator();
initTooltips();
syncPanel();
document.body.dataset.mode = state.mode;
syncToggles();
syncPanelVisibility();
applyTheme();

const stage = $('stage');
new ResizeObserver(() => {
  const r = stage.getBoundingClientRect();
  scene.resize(r.width, r.height);
  syncRange();
  requestAnalysis();
}).observe(stage);
// MathML and the plot's label fonts may arrive after the first paint.
document.fonts?.ready.then(() => { scene.request(); redrawGeometry(); });

createRoot($('root')).render(createElement(StrictMode, null, createElement(App)));

// Exposed for debugging in the console.
Object.assign(window, { bettergebra: { state, scene } });
