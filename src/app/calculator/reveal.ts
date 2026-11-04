/**
 * How an answer arrives, about a second from end to end. Its motif is the line — a fraction bar, the rule of a
 * ledger — in ink only, as the chrome is monochrome:
 *
 *  1. the question as typed peels off the field and drops into the heading, blurring into its typeset form;
 *  2. a hairline is drawn across where the answer will be, then splits into the card's top and bottom edges,
 *     opening the card between them (the card is clipped, so it all runs on the compositor);
 *  3. the formula assembles symbol by symbol out of a blur, the "=" drawn out from its middle; the "Wynik" badge
 *     is stamped and a gleam crosses it; the notes settle last;
 *  4. the cards that explain it follow, quieter.
 *
 * The values are never animated — each symbol is shown as it is, only uncovered. With reduced motion nothing moves.
 */
import { reduced } from '../motion';

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const SPRING = 'linear(0, 0.18 6%, 0.62 16%, 0.92 26%, 1.03 36%, 1.04 44%, 1.01 58%, 0.995 72%, 1)';
let running: Animation[] = [];
let leftovers: Element[] = [];

function stop(): void {
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

/** 2–3. The answer's card opens out of a line and its formula assembles. */
function openAnswer(card: HTMLElement, t0: number): void {
  const mid = card.offsetHeight / 2, host = card.parentElement!;
  // 240 ms: the hairline is drawn left to right; 360 ms: it splits into two that ride the opening edges to the
  // card's top and bottom; then they fade as the card's shadow comes back. (The lines lie beside the card, not in
  // it, so its clip doesn't cut them.)
  const DRAW = 240, SPLIT = 360, FADE = 160, ALL = DRAW + SPLIT + FADE;
  const at = (ms: number) => ms / ALL;
  const seam = (dir: -1 | 1) => {
    const line = document.createElement('div');
    line.className = 'b-pod-seam';
    Object.assign(line.style, { top: `${card.offsetTop + mid}px`, left: `${card.offsetLeft}px`, width: `${card.offsetWidth}px` });
    host.append(line);
    leftovers.push(line);
    const a = play(line, [
      { transform: 'translateY(0) scaleX(0)', opacity: 0.75, offset: 0, easing: OUT },
      { transform: 'translateY(0) scaleX(1)', opacity: 0.75, offset: at(DRAW), easing: 'cubic-bezier(0.7, 0, 0.2, 1)' },
      { transform: `translateY(${dir * mid}px) scaleX(1)`, opacity: 0.55, offset: at(DRAW + SPLIT), easing: 'ease-out' },
      { transform: `translateY(${dir * mid}px) scaleX(1)`, opacity: 0, offset: 1 },
    ], { duration: ALL, delay: t0, easing: 'linear', fill: 'both' });
    a.onfinish = () => line.remove();
  };
  seam(-1); seam(1);
  // the card: shut on the line, opened between the edges in step with them, then its shadow given back
  const pad = 40, shut = `inset(${mid - 0.5}px ${-pad}px ${mid - 0.5}px ${-pad}px)`;
  play(card, [
    { clipPath: shut, transform: 'scale(0.994)', offset: 0 },
    { clipPath: shut, transform: 'scale(0.994)', offset: at(DRAW), easing: 'cubic-bezier(0.7, 0, 0.2, 1)' },
    { clipPath: `inset(0px ${-pad}px 0px ${-pad}px)`, transform: 'none', offset: at(DRAW + SPLIT) },
    { clipPath: `inset(${-pad}px)`, transform: 'none', offset: 1 },
  ], { duration: ALL, delay: t0, easing: 'linear' });

  const open = t0 + DRAW;
  // the head: the badge stamped, a gleam across it; the title out of a blur beside it
  const badge = card.querySelector('.b-pod-badge');
  if (badge) {
    play(badge, [{ transform: 'scale(1.5)', opacity: 0, filter: 'blur(3px)' }, { transform: 'scale(0.94)', opacity: 1, filter: 'blur(0)', offset: 0.55 }, { transform: 'none', opacity: 1, filter: 'blur(0)' }],
      { duration: 460, delay: open + 60, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' });
    play(badge, [{ transform: 'translateX(-120%)' }, { transform: 'translateX(120%)' }], { duration: 700, delay: open + 420, easing: OUT, pseudoElement: '::after', fill: 'both' });
  }
  for (const el of card.querySelectorAll('.b-pod-head h3, .b-pod-head .ui-mac')) {
    play(el, [{ opacity: 0, transform: 'translateX(-6px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 420, delay: open + 120, easing: OUT });
  }
  // the formulas, symbol by symbol; "=" drawn out from its middle; the rest of a row (≈ 0,333…) last
  let k = 0;
  card.querySelectorAll('.b-pod-row').forEach(row => {
    const math = row.querySelector('.b-pod-math math');
    const pieces = math ? atoms(math) : Array.from(row.querySelectorAll('.b-pod-math, .b-pod-long, .b-grid'));
    const step = Math.max(12, Math.min(26, 300 / Math.max(1, pieces.length)));
    pieces.forEach(p => {
      const delay = open + 60 + k++ * step;
      if (p.localName === 'mo' && /^[=≈≡⇔→]$/.test(p.textContent?.trim() ?? '')) {
        play(p, [{ opacity: 0, transform: 'scaleX(0)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay, easing: SPRING });
      } else {
        play(p, [{ opacity: 0, transform: 'translateY(0.4em) scale(0.9)', filter: 'blur(5px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 480, delay, easing: SPRING });
      }
    });
    for (const n of row.querySelectorAll('.b-pod-row-note')) {
      play(n, [{ opacity: 0, transform: 'translateX(-8px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 420, delay: open + 80 + k * step + 60, easing: OUT });
    }
  });
  // the footer (Sprawdzone różniczkowaniem) rises in last
  for (const el of card.querySelectorAll(':scope > .b-pod-note, :scope > .b-pod-more, :scope > .b-cplot')) {
    play(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: open + 260, easing: OUT });
  }
}

/** The whole arrival; `results` is the results' container, inside the calculator's page. */
export function revealAnswer(results: HTMLElement | null): void {
  stop();
  if (!results || reduced()) return;
  const calc = results.closest('.b-calc') ?? document;
  dropQuestion(calc, results);
  const primary = results.querySelector<HTMLElement>(':scope > .b-pod.is-primary');
  if (primary) openAnswer(primary, 120);
  // what explains it follows, quieter and after the answer has opened
  let i = 0;
  for (const child of Array.from(results.children)) {
    if (child === primary || child.matches('.b-calc-query, .b-pod-seam')) continue;
    play(child, [{ opacity: 0, transform: 'translateY(14px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
      { duration: 560, delay: (primary ? 440 : 80) + Math.min(i++, 6) * 60, easing: OUT });
  }
  for (const el of results.querySelectorAll('.b-calc-query-label, .b-calc-query-note, .b-calc-query .ui-mac')) {
    play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 200, easing: 'ease' });
  }
}

/** The field moves from the middle of the empty page to the top as the first answer is asked for (FLIP). */
export function glideField(field: Element | null, fromTop: number | null): void {
  if (!field || fromTop === null || reduced()) return;
  const dy = fromTop - field.getBoundingClientRect().top;
  if (Math.abs(dy) < 2) return;
  field.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 620, easing: OUT });
}
