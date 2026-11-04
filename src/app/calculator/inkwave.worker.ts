/// <reference lib="webworker" />
/**
 * Paints the answer's wave on an OffscreenCanvas handed over by the page (inkwave.ts), on this thread's own frames,
 * so none of it falls on the page's main thread. One wave at a time: a new one, or a cancel, stops the last.
 */
import { painter, type WaveSpec } from './inkwave-paint';

declare const self: DedicatedWorkerGlobalScope;
let frame = 0, playing = 0;
const now = () => performance.timeOrigin + performance.now();
const next = (fn: () => void) => (typeof self.requestAnimationFrame === 'function' ? self.requestAnimationFrame(fn) : self.setTimeout(fn, 16));
const stop = () => { if (typeof self.cancelAnimationFrame === 'function') self.cancelAnimationFrame(frame); clearTimeout(frame); frame = 0; };

self.onmessage = (e: MessageEvent<{ id: number; canvas?: OffscreenCanvas; spec?: WaveSpec }>) => {
  const { id, canvas, spec } = e.data;
  stop();
  playing = id;
  if (!canvas || !spec) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const paint = painter(ctx, spec);
  const step = () => {
    if (playing !== id) return;
    if (paint(now())) frame = next(step);
    else { ctx.clearRect(0, 0, spec.W, spec.H); frame = 0; }
  };
  frame = next(step);
};
