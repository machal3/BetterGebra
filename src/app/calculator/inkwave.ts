/**
 * The answer's ripple. A drop of ink falls onto the calculator's lattice where the answer will be and one circular
 * wave runs out from where it lands: over the card first — the card is uncovered by it (reveal.ts, which keeps to
 * the same radius at every moment, `radiusAt`) — then on across the page, lighting up the grid's lines as it passes,
 * their crossings flaring like points of a lattice, and a fainter echo behind.
 *
 * Here: measuring the page once and handing a canvas over the lattice, under the cards, to a worker that paints the
 * drop and the wave (inkwave-paint.ts) on its own thread; where a canvas can't be handed over, the page paints it.
 * About 1.6 s, then the canvas is gone. Ink only, as the chrome is monochrome.
 */
import { ECHO, FALL, WAVE, painter, radiusAt, type WaveSpec } from './inkwave-paint';

export { FALL, WAVE, radiusAt };

/** Where the wave starts (client px) and how far it has to run to clear the screen. */
export interface Ripple { x: number; y: number; far: number }

/** The drop lands on the answer itself: the middle of the card's first formula (else of the card). */
export function rippleOf(card: Element): Ripple {
  // (a <math> fills its row: the middle of what it draws is that of its children)
  const m = card.querySelector('.b-pod-row .b-pod-math math') ?? card.querySelector('.b-pod-row') ?? card;
  const boxes = (m.localName === 'math' ? Array.from(m.children) : [m]).map(e => e.getBoundingClientRect()).filter(b => b.width || b.height);
  const c = boxes.length
    ? { left: Math.min(...boxes.map(b => b.left)), right: Math.max(...boxes.map(b => b.right)), top: Math.min(...boxes.map(b => b.top)), bottom: Math.max(...boxes.map(b => b.bottom)) }
    : card.getBoundingClientRect();
  const x = (c.left + c.right) / 2, y = (c.top + c.bottom) / 2;
  return { x, y, far: Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 80 };
}
/** When the wave reaches distance `r` (the inverse of radiusAt). */
export const reachAt = (r: number, far: number): number => (r >= far ? WAVE : WAVE * (1 - Math.cbrt(1 - r / far)));

/** The ink as r, g, b and its alpha, from the token (rgba(0, 0, 0, 0.88) or a hex). */
function inkOf(el: Element): [number, number, number, number] {
  const v = getComputedStyle(el).getPropertyValue('--b-ink').trim();
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (m) { const [r, g, b, a = '1'] = m[1].split(',').map(s => s.trim()); return [+r, +g, +b, +a]; }
  const h = /^#([0-9a-f]{6})$/i.exec(v);
  return h ? [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4, 6), 16), 1] : [0, 0, 0, 0.88];
}

let worker: Worker | null | undefined;
let waves = 0;
/** The painter's thread, started once (null where OffscreenCanvas can't be handed over). */
function painterThread(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof OffscreenCanvas === 'function' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype
      ? new Worker(new URL('./inkwave.worker.ts', import.meta.url), { type: 'module' }) : null;
  } catch { worker = null; }
  return worker;
}
/** Starts the painter's thread ahead of the first answer, so its first wave doesn't wait for it. */
export const warmInkWave = (): void => { painterThread(); };

/** Plays the ripple; the drop lands `impact` ms from now. Returns a cancel. */
export function inkWave(backdrop: HTMLElement, ripple: Ripple, impact: number): () => void {
  const box = backdrop.getBoundingClientRect();
  if (!box.width || !box.height) return () => {};
  const clock = () => performance.timeOrigin + performance.now();
  // the lattice: read once where its drifting lines are; the painter follows them by the clock, so no frame asks for layout
  const lines = backdrop.querySelector('.ui-gb-lines')?.getBoundingClientRect(), gb = getComputedStyle(backdrop.querySelector('.ui-gb') ?? backdrop);
  const spec: WaveSpec = {
    W: box.width, H: box.height, cx: ripple.x - box.left, cy: ripple.y - box.top, far: ripple.far, ink: inkOf(backdrop),
    cell: parseFloat(gb.getPropertyValue('--ui-gb-size')) || 48, period: (parseFloat(gb.getPropertyValue('--ui-gb-speed')) || 0) * 1000,
    ox: lines ? lines.left - box.left : 0, oy: lines ? lines.top - box.top : 0, read: clock(), t0: clock() + impact,
  };
  // 1×: a glow of faint lines loses nothing to the eye, and it is a quarter of the pixels on a dense screen
  const canvas = document.createElement('canvas');
  canvas.className = 'b-inkwave';
  canvas.width = Math.round(box.width); canvas.height = Math.round(box.height);
  backdrop.append(canvas);
  const id = ++waves, thread = painterThread();
  const gone = clock() + impact + ECHO + WAVE + 200;
  if (thread) {
    try {
      const off = canvas.transferControlToOffscreen();
      thread.postMessage({ id, canvas: off, spec }, [off]);
      const timer = setTimeout(() => canvas.remove(), gone - clock());
      return () => { clearTimeout(timer); thread.postMessage({ id: ++waves }); canvas.remove(); };
    } catch { /* painted here below */ }
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return () => {}; }
  const paint = painter(ctx, spec);
  let frame = 0;
  const step = () => { frame = paint(clock()) ? requestAnimationFrame(step) : 0; if (!frame) canvas.remove(); };
  frame = requestAnimationFrame(step);
  return () => { cancelAnimationFrame(frame); canvas.remove(); };
}
