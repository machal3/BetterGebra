/**
 * How an answer arrives: as a drop of ink falling onto the page's lattice, and the one round wave it sets off.
 * About a second until all is in place, the wave's last light a little after.
 *
 *  1. the question as typed peels off the field and drops into the heading, blurring into its typeset form;
 *  2. a drop falls onto the grid where the answer will be (inkwave.ts);
 *  3. where it lands the card is uncovered by a circle that grows with the wave (`radiusAt`, the same radius the
 *     wave has on the grid at that moment), its crest and a faint swell crossing the card's surface;
 *  4. what is on the card settles in as the wave reaches it — the symbols of the formula, the "Wynik" badge
 *     stamped with a gleam, the title, the notes — and so do the cards below, the farther the later.
 *
 * Ink only, as the chrome is monochrome. The values are never animated: each symbol is shown as it is, only
 * uncovered. With reduced motion nothing moves.
 */
import { reduced } from '../motion';
import { FALL, inkWave, radiusAt, reachAt, rippleOf, type Ripple } from './inkwave';

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const SPRING = 'linear(0, 0.18 6%, 0.62 16%, 0.92 26%, 1.03 36%, 1.04 44%, 1.01 58%, 0.995 72%, 1)';
let running: Animation[] = [];
let leftovers: Element[] = [];
let wave: (() => void) | null = null;
let starting = 0;
/** Starts the wave when everything starts (see revealAnswer). */
let pendingWave: (() => () => void) | null = null;

function stop(): void {
  cancelAnimationFrame(starting); starting = 0; pendingWave = null;
  wave?.(); wave = null;
  running.forEach(a => a.cancel());
  leftovers.forEach(e => e.remove());
  running = []; leftovers = [];
}

function play(el: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes, options: KeyframeAnimationOptions): Animation {
  const a = el.animate(keyframes, { fill: 'backwards', ...options });
  running.push(a);
  return a;
}

/** The pieces of a formula to bring in one by one: the top row of the MathML, a lone group opened up. */
function atoms(math: Element): Element[] {
  let n: Element = math;
  while (n.children.length === 1 && /^(mrow|semantics|mstyle)$/.test(n.firstElementChild!.localName)) n = n.firstElementChild!;
  let out = Array.from(n.children).filter(c => c.localName !== 'annotation' && c.localName !== 'annotation-xml');
  // a short top row (∫ … = …) of big groups: one level deeper, so there is something to assemble
  if (out.length < 4) out = out.flatMap(c => c.localName === 'mrow' && c.children.length > 1 ? Array.from(c.children) : [c]);
  return out;
}

/** 1. The typed question drops from the field into the heading over the results. */
function dropQuestion(calc: ParentNode, results: HTMLElement): void {
  const field = calc.querySelector<HTMLTextAreaElement>('.b-composer textarea'), target = results.querySelector('.b-calc-query .b-pod-math');
  if (!field || !target || !field.value.trim()) return;
  const from = field.getBoundingClientRect(), to = target.getBoundingClientRect(), cs = getComputedStyle(field);
  if (from.bottom < 0 || from.top > innerHeight || to.top > innerHeight) return;
  const ghost = document.createElement('div');
  ghost.className = 'b-calc-ghost';
  ghost.textContent = field.value.split('\n')[0];
  Object.assign(ghost.style, {
    left: `${from.left + parseFloat(cs.paddingLeft)}px`, top: `${from.top + parseFloat(cs.paddingTop)}px`,
    font: cs.font, lineHeight: cs.lineHeight, maxWidth: `${from.width}px`,
  });
  document.body.append(ghost);
  leftovers.push(ghost);
  const dx = to.left - from.left - parseFloat(cs.paddingLeft), dy = to.top + to.height / 2 - (from.top + parseFloat(cs.paddingTop) + parseFloat(cs.lineHeight) / 2);
  const a = play(ghost, [
    { transform: 'none', opacity: 0.9, filter: 'blur(0)' },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.7}px) scale(0.96)`, opacity: 0.7, filter: 'blur(0.5px)', offset: 0.6 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.92)`, opacity: 0, filter: 'blur(6px)' },
  ], { duration: 520, easing: OUT, fill: 'forwards' });
  a.onfinish = () => ghost.remove();
  play(target, [{ opacity: 0, filter: 'blur(6px)', transform: 'translateY(-3px)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }], { duration: 420, delay: 260, easing: OUT });
}

/** How far `el` is from where the drop lands (to its middle, or to its nearest edge). */
function distance(el: Element, ripple: Ripple, nearest = false): number {
  const b = el.getBoundingClientRect();
  if (!nearest) return Math.hypot(b.left + b.width / 2 - ripple.x, b.top + b.height / 2 - ripple.y);
  const dx = Math.max(b.left - ripple.x, 0, ripple.x - b.right), dy = Math.max(b.top - ripple.y, 0, ripple.y - b.bottom);
  return Math.hypot(dx, dy);
}

/** 3–4. The answer's card, uncovered by the wave from where the drop lands; what is on it settles in as it passes. */
function openAnswer(card: HTMLElement, ripple: Ripple, impact: number): void {
  const b = card.getBoundingClientRect(), lx = ripple.x - b.left, ly = ripple.y - b.top;
  // the circle keeps to the wave's radius: sampled, so the clip and the wave on the grid never part
  const cover = Math.hypot(Math.max(lx, b.width - lx), Math.max(ly, b.height - ly)) + 48, T = reachAt(cover, ripple.far), N = 14;
  const frames: Keyframe[] = Array.from({ length: N + 1 }, (_, i) => {
    const r = radiusAt((T * i) / N, ripple.far);
    return { clipPath: `circle(${i ? r.toFixed(1) : 0}px at ${lx}px ${ly}px)`, transform: `scale(${0.985 + 0.015 * (i / N)})`, offset: i / N };
  });
  play(card, frames, { duration: T, delay: impact, easing: 'linear' });

  // On the card, over its content: the crest and a faint swell just inside it, keeping to the same radius, and the
  // splash where the drop landed — elements moved by transform and opacity only, so none of it repaints the card.
  const surface = document.createElement('div');
  surface.className = 'b-pod-ripple';
  const piece = (cls: string, size: number) => {
    const el = document.createElement('div');
    el.className = cls;
    Object.assign(el.style, { left: `${lx - size}px`, top: `${ly - size}px`, width: `${2 * size}px`, height: `${2 * size}px` });
    surface.append(el);
    return el;
  };
  const crest = piece('b-pod-crest', cover);
  card.append(surface);
  leftovers.push(surface);
  play(crest, frames.map((f, i) => ({ transform: `scale(${(radiusAt((T * i) / N, ripple.far) / cover).toFixed(4)})`, opacity: i === N ? 0 : 1, offset: f.offset })),
    { duration: T, delay: impact, easing: 'linear', fill: 'both' });
  play(piece('b-pod-drop', 4), [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.2)', opacity: 0 }], { duration: 160, delay: impact, easing: 'ease-out', fill: 'both' });
  [26, 46].forEach((size, i) => play(piece('b-pod-splash', size), [{ transform: 'scale(0)', opacity: 0.9 - i * 0.3 }, { transform: 'scale(1)', opacity: 0 }],
    { duration: 600, delay: impact + i * 90, easing: OUT, fill: 'both' }));
  setTimeout(() => surface.remove(), 2000 + impact);

  const when = (el: Element) => impact + reachAt(distance(el, ripple), ripple.far);
  // the head: the badge stamped and a gleam across it, the title and the copy button out of a soft blur
  const badge = card.querySelector('.b-pod-badge');
  if (badge) {
    const t = when(badge) + 30;
    play(badge, [{ transform: 'scale(1.5)', opacity: 0, filter: 'blur(3px)' }, { transform: 'scale(0.94)', opacity: 1, filter: 'blur(0)', offset: 0.55 }, { transform: 'none', opacity: 1, filter: 'blur(0)' }],
      { duration: 460, delay: t, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' });
    play(badge, [{ transform: 'translateX(-120%)' }, { transform: 'translateX(120%)' }], { duration: 700, delay: t + 300, easing: OUT, pseudoElement: '::after', fill: 'both' });
  }
  for (const el of card.querySelectorAll('.b-pod-head h3, .b-pod-head .ui-mac')) {
    play(el, [{ opacity: 0, transform: 'scale(0.96)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 440, delay: when(el) + 30, easing: OUT });
  }
  // the formulas, each symbol as the wave reaches it ("=" drawn out from its middle), then a row's note
  card.querySelectorAll('.b-pod-row').forEach(row => {
    const math = row.querySelector('.b-pod-math math');
    const pieces = math ? atoms(math) : Array.from(row.querySelectorAll('.b-pod-math, .b-pod-long, .b-grid'));
    for (const p of pieces) {
      const delay = when(p) + 20;
      if (p.localName === 'mo' && /^[=≈≡⇔→]$/.test(p.textContent?.trim() ?? '')) {
        play(p, [{ opacity: 0, transform: 'scaleX(0)' }, { opacity: 1, transform: 'none' }], { duration: 440, delay, easing: SPRING });
      } else {
        play(p, [{ opacity: 0, transform: 'scale(0.82)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay, easing: SPRING });
      }
    }
    for (const n of row.querySelectorAll('.b-pod-row-note')) {
      play(n, [{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: when(n) + 60, easing: OUT });
    }
  });
  for (const el of card.querySelectorAll(':scope > .b-pod-note, :scope > .b-pod-more, :scope > .b-cplot')) {
    play(el, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: when(el) + 60, easing: OUT });
  }
}

/** The whole arrival; `results` is the results' container, inside the calculator's page. */
export function revealAnswer(results: HTMLElement | null): void {
  stop();
  if (!results || reduced()) return;
  const calc = results.closest('.b-calc') ?? document;
  dropQuestion(calc, results);
  const primary = results.querySelector<HTMLElement>(':scope > .b-pod.is-primary');
  const backdrop = document.querySelector<HTMLElement>('.b-calc-backdrop');
  // without the lattice (no room for it) there is no drop to wait for
  const impact = backdrop ? 90 + FALL : 120;
  // the wave starts at the answer's card; without one, at the first card
  const first = primary ?? results.querySelector<HTMLElement>(':scope > .b-pod');
  const ripple = first ? rippleOf(first) : null;
  if (primary && ripple) {
    openAnswer(primary, ripple, impact);
    if (backdrop) pendingWave = () => inkWave(backdrop, ripple, impact);
  }
  // the cards below follow as the wave reaches them, the farther the later
  for (const child of Array.from(results.children)) {
    if (child === primary || child.matches('.b-calc-query')) continue;
    const delay = ripple ? impact + reachAt(distance(child, ripple, true), ripple.far) : 80;
    play(child, [{ opacity: 0, transform: 'translateY(12px) scale(0.99)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay, easing: OUT });
  }
  for (const el of results.querySelectorAll('.b-calc-query-label, .b-calc-query-note, .b-calc-query .ui-mac')) {
    play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 200, easing: 'ease' });
  }
  // Everything holds its first frame until the answer has been painted once: the frame that lays out the new
  // cards (MathML, a plot) is the slow one, and what started in it would lose its first steps and seem to jump.
  const held = running.slice();
  held.forEach(a => a.pause());
  starting = requestAnimationFrame(() => {
    starting = requestAnimationFrame(() => {
      starting = 0;
      held.forEach(a => a.play());
      if (pendingWave) { wave = pendingWave(); pendingWave = null; }
    });
  });
}

/** The field moves from the middle of the empty page to the top as the first answer is asked for (FLIP). */
export function glideField(field: Element | null, fromTop: number | null): void {
  if (!field || fromTop === null || reduced()) return;
  const dy = fromTop - field.getBoundingClientRect().top;
  if (Math.abs(dy) < 2) return;
  field.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 620, easing: OUT });
}
