/**
 * The Wykresy canvas and what feeds it, outside React: the Scene draws into the static canvases in #stage, the
 * analysis worker answers for the visible range. React components read from here through small external stores
 * (the visible range, the analysis after each drawn frame), so a pan or a slider never re-renders the canvas.
 */
import { AnalysisClient } from '../analysis/client';
import type { AnalysisResult } from '../analysis/compute';
import { Scene } from '../render/scene';
import { fits } from '../render/viewport';
import { state } from '../state';
import { setView } from '../ui/canvas-input';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const scene = new Scene(el<HTMLCanvasElement>('plot'), el<HTMLCanvasElement>('hover'), el('readout'));

/** A tiny store: a version that grows, and the components that want to hear about it. */
function signal() {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    bump() { version++; for (const l of listeners) l(); },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    get: () => version,
  };
}

// --- Analysis: the worker's latest answer; after every drawn frame the card may have something new to show ---
let latest: AnalysisResult | null = null;
export const latestAnalysis = () => latest;
const analysis = new AnalysisClient(result => {
  // Older answers can still arrive after a newer request was sent; they are fine to show until the next one lands.
  latest = result;
  scene.analysis = result;
  scene.request();
});
const drawn = signal();
scene.onDrawn = () => drawn.bump();
export const onDrawn = drawn.subscribe;

export function requestAnalysis(): void {
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

// --- The visible range (changes with the view and with the canvas size) ---
const range = signal();
export const rangeChanged = range.bump;
/** Calls back on every change of the visible range (read scene.vp for the numbers); returns the unsubscribe. */
export const rangeSubscribe = range.subscribe;

/** Sets the view from typed ranges; returns the problem, or '' when the view changed. */
export function applyRange(x0: number, x1: number, y0: number, y1: number): string {
  const ratio = (y1 - y0) * scene.width / (scene.height * (x1 - x0));
  const ok = x1 > x0 && y1 > y0 && fits(x1 - x0, ratio, scene.width, scene.height) && Math.max(Math.abs(x0), Math.abs(x1)) <= 1e9 && Math.max(Math.abs(y0), Math.abs(y1)) <= 1e15
    // float64 must still tell the grid lines apart that far from 0
    && x1 - x0 >= 1e-10 * Math.max(Math.abs(x0), Math.abs(x1)) && y1 - y0 >= 1e-10 * Math.max(Math.abs(y0), Math.abs(y1));
  if (!ok) return 'Podaj rosnące zakresy: x o szerokości od 0,0001 do 10 000 000 (w granicach ±10⁹), y o wysokości od 0,0001 do 10¹² (w granicach ±10¹⁵), nie węższe niż 10⁻¹⁰ swoich wartości.';
  setView({ min: x0, max: x1, cy: (y0 + y1) / 2, ratio });
  return '';
}

/** Saves the plot as bettergebra-wykres.png; false when the browser could not make the image. */
export async function exportPng(): Promise<boolean> {
  const blob = await scene.toBlob();
  if (!blob) return false;
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'bettergebra-wykres.png'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
