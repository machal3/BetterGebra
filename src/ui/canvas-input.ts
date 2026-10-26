/** Pan, zoom and pinch on the plot, plus its keyboard shortcuts. Every gesture just writes state.view. */
import { compiled } from '../model';
import type { Scene } from '../render/scene';
import { fits, panned, zoomed } from '../render/viewport';
import { DEFAULT_VIEW, TRIG_VIEW, commit, state, type View } from '../state';
import { toast } from '../app/toast';

let scene: Scene;
let settleTimer = 0;

/** While wheel, pinch or a slider keep going, heavy layers paint coarser; 150 ms after the last change, sharp again. */
export function settle(): void {
  scene.moving = true;
  clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => { scene.moving = false; scene.request(); }, 150);
}

export function setView(view: View): void {
  state.view = view;
  commit('view');
}

export function zoom(fx: number, fy = fx, x?: number, y?: number): void {
  const next = zoomed(state.view, scene.width, scene.height, fx, fy, x, y);
  if (next) setView(next);
}

export const resetView = () => setView({ ...(state.xUnit !== 'num' ? TRIG_VIEW : DEFAULT_VIEW) });

/** Keeps the x range and fits y to the visible graphs (percentiles, so asymptote spikes don't flatten everything). */
export function fitY(): void {
  const ys: number[] = [], { min, max } = state.view;
  for (const f of state.functions) {
    const fn = f.visible ? compiled(f, state.mode, state.params).fn : null;
    if (!fn) continue;
    for (let i = 0; i <= 400; i++) { const y = fn(min + (max - min) * i / 400); if (Number.isFinite(y)) ys.push(y); }
  }
  if (!ys.length) { toast(state.mode === 'graph' ? 'Brak wartości funkcji w tym zakresie.' : 'Dopasowanie działa dla wykresów y = f(x).'); return; }
  ys.sort((a, b) => a - b);
  let low = ys[Math.floor(ys.length * 0.03)], high = ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.97))];
  // Percentiles drop spikes but would clip a steep end (e^x on [0; 20]): keep true extremes that are near.
  const p = high - low;
  if (ys[0] >= low - 3 * p) low = ys[0];
  if (ys[ys.length - 1] <= high + 3 * p) high = ys[ys.length - 1];
  const k = scene.height * (max - min) / scene.width, span = (high - low) * 1.2 || Math.max(2, Math.abs(low) / 2);
  setView({ ...state.view, cy: (low + high) / 2, ratio: Math.min(1e12 / k, Math.max(1e-4 / k, span / k)) });
}

export function initCanvasInput(s: Scene): void {
  scene = s;
  const canvas = document.getElementById('plot') as HTMLCanvasElement;
  const local = (e: { clientX: number; clientY: number }) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // Zoom by how far the wheel moved, not per event: a trackpad sends dozens of small events per gesture.
  // Shift = y axis only (some systems then report the wheel as deltaX), Alt = x axis only.
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const raw = e.shiftKey && !e.deltaY ? e.deltaX : e.deltaY, delta = raw * [1, 16, scene.height][e.deltaMode];
    if (!delta) return;
    // A mouse notch (~100 px) zooms ~13%; a trackpad pinch arrives as ctrl+wheel with small deltas.
    const factor = Math.exp(Math.max(-300, Math.min(300, delta)) * (e.ctrlKey ? 0.01 : 0.0012));
    const p = local(e);
    settle();
    zoom(e.shiftKey ? 1 : factor, e.altKey ? 1 : factor, p.x, p.y);
  }, { passive: false });

  // One pointer drags, two pinch. Every move is measured from the gesture's start, keeping the world point that was
  // under the start midpoint under the current midpoint, so a pinch also pans and nothing drifts.
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: { view: View; x: number; y: number; d: number } | null = null;
  const start = () => {
    const [a, b = a] = pointers.values();
    gesture = { view: { ...state.view }, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    start();
    scene.dragging = true;
    canvas.classList.add('grabbing');
    scene.request(false);
  });
  canvas.addEventListener('pointermove', e => {
    const p = local(e);
    scene.pointer = p;
    if (!pointers.has(e.pointerId) || !gesture) { scene.request(false); return; }
    pointers.set(e.pointerId, p);
    const [a, b = a] = pointers.values(), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y);
    const v = gesture.view, range = (v.max - v.min) * (gesture.d && d ? gesture.d / d : 1);
    if (!fits(range, v.ratio, scene.width, scene.height)) return;
    const sx = scene.width / (v.max - v.min), anchorX = v.min + gesture.x / sx, anchorY = v.cy + (scene.height / 2 - gesture.y) * v.ratio / sx;
    const min = anchorX - mx * range / scene.width;
    setView({ ...v, min, max: min + range, cy: anchorY - (scene.height / 2 - my) * range * v.ratio / scene.width });
  });
  const end = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size) { start(); return; } // a finger lifted mid-pinch: carry on dragging with the other
    gesture = null;
    scene.dragging = false;
    canvas.classList.remove('grabbing');
    scene.request();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('pointerleave', e => { if (!pointers.has(e.pointerId)) { scene.pointer = null; scene.request(false); } });

  canvas.addEventListener('keydown', e => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
    if (moves[e.key]) { e.preventDefault(); setView(panned(state.view, scene.width, ...moves[e.key])); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(0.75); }
    else if (e.key === '-' || e.key === '−') { e.preventDefault(); zoom(4 / 3); }
    else if (e.key === '0') resetView();
  });
}

/** The toolbar's buttons (the keyboard and the wheel use the same steps). */
export const zoomIn = () => zoom(0.75);
export const zoomOut = () => zoom(4 / 3);
export const equalAxes = () => setView({ ...state.view, ratio: 1 });
