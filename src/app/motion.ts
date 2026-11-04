/**
 * Motion that CSS alone cannot start: a list that arrives again when its content changes, and the side panel folding
 * into its header and back. The values are the tokens' (tokens.css, Motion); with reduced motion nothing moves, as
 * base.css stops the CSS.
 */
export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A spring's curve as CSS linear(): overshoots by ~3 % and settles, for things that land. */
export const SPRING = 'linear(0, 0.18 6%, 0.62 16%, 0.92 26%, 1.03 36%, 1.04 44%, 1.01 58%, 0.995 72%, 1)';

/**
 * The children of `el` arrive one after another: out of a slight blur, rising and unfolding from a little below
 * full size, each landing on a soft spring. The first (the answer) comes in a touch higher than the rest.
 */
export function cascade(el: Element | null, stagger = 55): void {
  if (!el || reduced()) return;
  Array.from(el.children).forEach((child, i) => child.animate(
    [
      { opacity: 0, transform: `translateY(${i ? 14 : 18}px) scale(0.975)`, filter: 'blur(6px)' },
      { opacity: 1, offset: 0.55, filter: 'blur(0)' },
      { opacity: 1, transform: 'none', filter: 'blur(0)' },
    ],
    { duration: 720, delay: Math.min(i, 8) * stagger, easing: SPRING, fill: 'backwards' },
  ));
}

/** An element leaves: it folds shut, shrinks a little and blurs out; `done` runs when it is gone (at once with reduced motion). */
export function leave(el: HTMLElement | null, done: () => void, gap = 0): void {
  if (!el || reduced() || el.dataset.leaving) { if (!el?.dataset.leaving) done(); return; }
  el.dataset.leaving = '1';
  const h = el.getBoundingClientRect().height;
  el.style.pointerEvents = 'none';
  el.style.overflow = 'hidden';
  const a = el.animate(
    [
      { opacity: 1, transform: 'none', filter: 'blur(0)', height: `${h}px`, marginBottom: '0px' },
      { opacity: 0, transform: 'translateX(-12px) scale(0.96)', filter: 'blur(4px)', offset: 0.55, height: `${h}px`, marginBottom: '0px' },
      { opacity: 0, transform: 'translateX(-12px) scale(0.96)', filter: 'blur(4px)', height: '0px', marginBottom: `${-gap}px` },
    ],
    { duration: 380, easing: EASE, fill: 'forwards' },
  );
  a.onfinish = done;
}

/** "No": a short shake, as a head shakes, that dies away. */
export function shake(el: Element | null): void {
  if (!el || reduced()) return;
  el.animate(
    { transform: ['none', 'translateX(-7px)', 'translateX(6px)', 'translateX(-4px)', 'translateX(2px)', 'none'] },
    { duration: 440, easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)' },
  );
}

/** A formula is written out: uncovered from the left as a pen would, its last strokes out of a blur. */
export function write(el: Element | null, delay = 160): void {
  if (!el || reduced()) return;
  el.animate(
    [
      { clipPath: 'inset(-20% 100% -20% 0)', filter: 'blur(3px)', transform: 'translateX(-4px)' },
      { clipPath: 'inset(-20% 0 -20% 0)', filter: 'blur(0)', transform: 'none' },
    ],
    { duration: 900, delay, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'backwards' },
  );
}

/** A small thing done (a toggle, a pick): it gives under the finger and springs back a little past its size. */
export function pop(el: Element | null, by = 0.16): void {
  if (!el || reduced()) return;
  el.animate({ transform: ['scale(1)', `scale(${1 - by / 2})`, `scale(${1 + by})`, 'scale(1)'], offset: [0, 0.2, 0.55, 1] }, { duration: 460, easing: 'ease-out' });
}

/**
 * Ink spreads from where a list row, a chip or a key is pressed, in the ink's own alpha (the chrome stays
 * monochrome). The ring is the element's ::after (controls.css), placed by --rx/--ry and restarted by flipping
 * data-ripple between two names; React never owns either, so a render doesn't cut it short.
 */
const RIPPLE = '.b-row, .b-chip, .b-key, .b-switch, .b-disclosure-head, .b-menu-option, .b-cplot-key, .b-gpalette-tool, .b-calc-tile';
export function installRipple(): void {
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || reduced()) return;
    const el = (e.target as Element | null)?.closest<HTMLElement>(RIPPLE);
    if (!el || (el as HTMLButtonElement).disabled) return;
    const r = el.getBoundingClientRect();
    const size = Math.hypot(Math.max(e.clientX - r.left, r.right - e.clientX), Math.max(e.clientY - r.top, r.bottom - e.clientY)) * 2;
    el.style.setProperty('--rx', `${e.clientX - r.left}px`);
    el.style.setProperty('--ry', `${e.clientY - r.top}px`);
    el.style.setProperty('--rs', `${size}px`);
    el.dataset.ripple = el.dataset.ripple === 'a' ? 'b' : 'a';
  }, { passive: true, capture: true });
  document.addEventListener('animationend', e => {
    if (e.animationName.startsWith('b-ripple')) delete (e.target as HTMLElement).dataset.ripple;
  });
}

let folding: Animation[] = [];

/**
 * Folds the card (`.b-dock`) into its header or opens it out of it. `change` applies the new state synchronously;
 * the card is clipped from the one size to the other, so it moves on the compositor and nothing is laid out per frame.
 * While folding, `.is-folding` keeps the card its open size (layout.css) until the clip has closed over it.
 */
export function fold(dock: HTMLElement, change: () => void, opening: boolean): void {
  folding.forEach(a => a.cancel());
  folding = [];
  dock.classList.remove('is-folding');
  if (reduced()) return change();
  const from = dock.getBoundingClientRect();
  change();
  const to = dock.getBoundingClientRect();
  const r = getComputedStyle(dock).borderTopLeftRadius;
  const clip = (w: number, h: number) => `inset(0 ${Math.max(0, w)}px ${Math.max(0, h)}px 0 round ${r})`;
  const shownBody = () => Array.from(dock.querySelectorAll<HTMLElement>('.sidebar-body')).find(b => getComputedStyle(b).display !== 'none');
  if (opening) {
    const body = shownBody();
    folding.push(dock.animate({ clipPath: [clip(to.width - from.width, to.height - from.height), clip(0, 0)] }, { duration: 460, easing: EASE }));
    if (body) folding.push(body.animate(
      [{ opacity: 0, transform: 'translateY(-6px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
      { duration: 420, delay: 80, easing: EASE, fill: 'backwards' },
    ));
  } else {
    dock.classList.add('is-folding');
    const shown = shownBody();
    const a = dock.animate({ clipPath: [clip(0, 0), clip(from.width - to.width, from.height - to.height)] }, { duration: 360, easing: EASE });
    a.onfinish = () => { dock.classList.remove('is-folding'); folding.forEach(x => x.cancel()); folding = []; };
    folding.push(a);
    if (shown) folding.push(shown.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' }));
  }
}

/** A page (a panel's canvas or the calculator) comes into focus: out of a blur, settling from a hair larger. */
export function enter(el: Element | null): void {
  if (!el || reduced()) return;
  el.animate(
    [{ opacity: 0, transform: 'scale(1.012)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
    { duration: 620, easing: EASE },
  );
}
