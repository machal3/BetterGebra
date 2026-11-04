/** Pan, zoom and pinch on the plot, plus its keyboard shortcuts. Every gesture just writes state.view. */
import { compiled } from '../model';
import type { Scene } from '../render/scene';
import { Viewport, anchored, fits, panned, zoomed } from '../render/viewport';
import { DEFAULT_VIEW, TRIG_VIEW, commit, state, type View } from '../state';
import { toast } from '../app/toast';
import { easeOutQuint, now, reducedMotion } from '../render/anim';

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

// --- Motion of the view: a glide to where a button sends it, a coast after a flick ---

let motion = 0;
/** Where a glide is heading: a second click of Przybliż goes on from there, not from the frame on screen. */
let heading: View | null = null;

/** Stops a glide or a coast where it is (a new gesture, a typed range, the panel moving). */
export function stopMotion(): void {
  if (motion) cancelAnimationFrame(motion);
  motion = 0;
  heading = null;
}

/**
 * Glides the view to `to`: the edges move on the tokens' curve, the scale geometrically (a zoom by 4 looks as even
 * as a zoom by 2) and the ratio too, so nothing seems to speed up halfway. Heavy layers paint coarser meanwhile.
 */
export function glideTo(to: View, ms = 520): void {
  const from = { ...state.view };
  stopMotion();
  if (reducedMotion() || !scene.width) { setView(to); return; }
  heading = to;
  const t0 = now(), r0 = from.max - from.min, r1 = to.max - to.min;
  // the world point in the middle travels on a straight line while the range changes geometrically
  const c0 = (from.min + from.max) / 2, c1 = (to.min + to.max) / 2;
  const step = () => {
    const t = Math.min(1, (now() - t0) / ms), e = easeOutQuint(t);
    if (t >= 1) { motion = 0; heading = null; setView(to); scene.moving = false; scene.request(); return; }
    const range = r0 * (r1 / r0) ** e, c = c0 + (c1 - c0) * e;
    settle();
    setView({ min: c - range / 2, max: c + range / 2, cy: from.cy + (to.cy - from.cy) * e, ratio: from.ratio * (to.ratio / from.ratio) ** e });
    motion = requestAnimationFrame(step);
  };
  motion = requestAnimationFrame(step);
}

/** After a flick the plane coasts on and slows down, as a page does under a finger. Velocity in px/ms. */
function coast(vx: number, vy: number): void {
  stopMotion();
  if (reducedMotion() || Math.hypot(vx, vy) < 0.25) return;
  let last = now();
  const step = () => {
    const t = now(), dt = Math.min(32, t - last);
    last = t;
    // the speed halves about every 110 ms
    const k = Math.exp(-dt / 160);
    vx *= k; vy *= k;
    if (Math.hypot(vx, vy) < 0.02) { motion = 0; scene.moving = false; scene.request(); return; }
    settle();
    setView(panned(state.view, scene.width, -vx * dt, vy * dt, scene.inset));
    motion = requestAnimationFrame(step);
  };
  motion = requestAnimationFrame(step);
}

export function zoom(fx: number, fy = fx, x?: number, y?: number, glide = false): void {
  const next = zoomed(glide && heading ? heading : state.view, scene.width, scene.height, fx, fy, x, y, scene.inset);
  if (!next) return;
  if (glide) glideTo(next, 380); else setView(next);
}

export const resetView = () => glideTo({ ...(state.xUnit !== 'num' ? TRIG_VIEW : DEFAULT_VIEW) }, 700);

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
  const k = scene.seen.h * (max - min) / scene.seen.w, span = (high - low) * 1.2 || Math.max(2, Math.abs(low) / 2);
  glideTo({ ...state.view, cy: (low + high) / 2, ratio: Math.min(1e12 / k, Math.max(1e-4 / k, span / k)) }, 640);
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
    stopMotion();
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
  // the last moves of a one-finger drag, for the speed it is let go with
  let track: { t: number; x: number; y: number }[] = [];
  let pinched = false;
  const start = () => {
    const [a, b = a] = pointers.values();
    gesture = { view: { ...state.view }, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.setPointerCapture(e.pointerId);
    stopMotion();
    pointers.set(e.pointerId, local(e));
    pinched = pointers.size > 1;
    track = [{ t: e.timeStamp, ...local(e) }];
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
    if (pointers.size === 1) { track.push({ t: e.timeStamp, ...p }); if (track.length > 8) track.shift(); }
    const [a, b = a] = pointers.values(), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y);
    const v = gesture.view, range = (v.max - v.min) * (gesture.d && d ? gesture.d / d : 1);
    if (!fits(range, v.ratio, scene.seen.w, scene.seen.h)) return;
    const at = new Viewport(v, scene.width, scene.height, scene.inset);
    setView(anchored(range, v.ratio, at.fromX(gesture.x), at.fromY(gesture.y), mx, my, scene.width, scene.height, scene.inset));
  });
  const end = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size) { start(); track = []; return; } // a finger lifted mid-pinch: carry on dragging with the other
    gesture = null;
    scene.dragging = false;
    canvas.classList.remove('grabbing');
    scene.request();
    // Let go while moving: the speed over the last ~80 ms, unless the finger rested before lifting.
    const recent = track.filter(q => e.timeStamp - q.t < 80), first = recent[0], last = recent[recent.length - 1];
    if (e.type === 'pointerup' && !pinched && first && last && last.t > first.t && e.timeStamp - last.t < 40) {
      coast((last.x - first.x) / (last.t - first.t), (last.y - first.y) / (last.t - first.t));
    }
    track = [];
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('pointerleave', e => { if (!pointers.has(e.pointerId)) { scene.pointer = null; scene.request(false); } });

  canvas.addEventListener('keydown', e => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
    if (moves[e.key]) { e.preventDefault(); glideTo(panned(heading ?? state.view, scene.width, ...moves[e.key], scene.inset), 240); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
    else if (e.key === '-' || e.key === '−') { e.preventDefault(); zoomOut(); }
    else if (e.key === '0') resetView();
  });
}

/** The toolbar's buttons (the keyboard and the wheel use the same steps). */
export const zoomIn = () => zoom(0.75, 0.75, undefined, undefined, true);
export const zoomOut = () => zoom(4 / 3, 4 / 3, undefined, undefined, true);
export const equalAxes = () => glideTo({ ...state.view, ratio: 1 }, 560);
