import './styles/tokens.css';
import './styles/base.css';
import { StrictMode, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { rangeChanged, requestAnalysis, scene } from './app/graph-runtime';
import { panelFromHash } from './app/navigation';
import { isDark, systemDark } from './app/theme';
import { initGeometry, redrawGeometry } from './geometry/controller';
import { forget } from './model';
import { addFunction, commit, on, restore, save, state } from './state';
import { redrawCalcPlots } from './app/calculator/plot-engine';
import { fitY, initCanvasInput } from './ui/canvas-input';
import { initTooltips } from './app/tooltips';
import { initSheetDrag } from './components/controls';
import { openHelp } from './app/Help';
import { startMathTidy } from './app/math-tidy';
import { enter, installRipple } from './app/motion';
// last, so it layers over the panels' own styles
import './styles/motion.css';

if (!restore()) {
  addFunction('x^2');
  addFunction('sin(x)');
  state.activeId = state.functions[0].id;
}

// --- Theme ---
function applyTheme(): void {
  const dark = isDark();
  // Always resolved: the Affect UI components follow data-theme, not the system preference.
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // the browser chrome takes the colour of the top bar
  const bar = getComputedStyle(document.documentElement).getPropertyValue('--b-panel').trim();
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) { m.removeAttribute('media'); m.content = bar; }
  scene.refreshTheme();
  redrawGeometry();
  redrawCalcPlots();
}
systemDark.addEventListener('change', applyTheme);

// --- Panels: home | graphs | geometry | calculator (the hash keeps the choice across reloads) ---
const PANEL_MAIN: Record<string, string> = { graphs: 'stage', geometry: 'geometry', calculator: 'calc' };
function syncPanel(): void {
  const hash = location.hash, was = document.body.dataset.panel, now = panelFromHash(hash);
  // #kalkulator?q=… opens the calculator with that question (links to a result)
  document.body.dataset.panel = now;
  // another panel: its page comes into focus out of a soft blur, and on Wykresy the graphs are drawn in again
  if (was && was !== now) {
    enter(document.getElementById(PANEL_MAIN[now] ?? ''));
    if (now === 'graphs') scene.replay();
  }
  // a function's settings live in the top layer, outside the panel: they would stay over the next one
  if (document.body.dataset.panel !== 'graphs') document.querySelectorAll<HTMLElement>('[id^="fn-settings-"]:popover-open').forEach(p => p.hidePopover());
}
addEventListener('hashchange', syncPanel);

// --- Help & global keys ---
document.addEventListener('keydown', e => {
  const t = e.target as HTMLElement;
  if (e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]') || document.body.dataset.panel !== 'graphs') return;
  if (e.key === '?') { e.preventDefault(); openHelp(); }
  else if (e.key === 'b' || e.key === 'B') { state.analysisOpen = !state.analysisOpen; commit('panel'); }
  else if (e.key === 'f' || e.key === 'F') fitY();
});

// --- Wiring: who reacts to what ---
on(['list', 'expr', 'mode'], () => forget(new Set(state.functions.map(f => f.id))));
on(['list', 'expr', 'active', 'mode', 'style', 'params', 'view', 'toggles'], topics => {
  if (topics.has('mode')) document.body.dataset.mode = state.mode;
  if (topics.has('view') || topics.has('mode')) rangeChanged();
  scene.request();
  // Grid, axes and snapping don't change the analysis.
  if ([...topics].some(t => t !== 'toggles')) requestAnalysis();
});
on(['theme'], applyTheme);

addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// --- Start ---
initCanvasInput(scene);
initGeometry();
initTooltips();
initSheetDrag();
installRipple();
syncPanel();
document.body.dataset.mode = state.mode;
applyTheme();

const stage = document.getElementById('stage')!;
new ResizeObserver(() => {
  const r = stage.getBoundingClientRect();
  scene.resize(r.width, r.height);
  rangeChanged();
  requestAnalysis();
}).observe(stage);
// MathML and the plot's label fonts may arrive after the first paint.
document.fonts?.ready.then(() => { scene.request(); redrawGeometry(); });

createRoot(document.getElementById('root')!).render(createElement(StrictMode, null, createElement(App)));
// roots in formulas: the hole after them taken back, a coefficient kept apart from an index (math-tidy.ts)
startMathTidy();

// Exposed for debugging in the console.
Object.assign(window, { bettergebra: { state, scene } });
