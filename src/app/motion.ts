/**
 * Motion that CSS alone cannot start: a list that arrives again when its content changes, and the side panel folding
 * into its header and back. The values are the tokens' (tokens.css, Motion); with reduced motion nothing moves, as
 * base.css stops the CSS.
 */
export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The children of `el` arrive one after another, out of a slight blur. */
export function cascade(el: Element | null, stagger = 45): void {
  if (!el || reduced()) return;
  Array.from(el.children).forEach((child, i) => child.animate(
    [{ opacity: 0, transform: 'translateY(8px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
    { duration: 560, delay: Math.min(i, 8) * stagger, easing: EASE, fill: 'backwards' },
  ));
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
