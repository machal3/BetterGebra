export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type Attrs = Record<string, string | number | boolean | undefined | null>;
/** Small element builder: h('button', { class: 'x', type: 'button', 'aria-label': '…' }, child, …). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...children);
  return el;
}

export const icon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
export const ICONS = {
  trash: icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  sliders: icon('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  copy: icon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
};

/** Sets innerHTML only when it changed, so MathML isn't re-laid out on every keystroke elsewhere. */
export function setHTML(el: Element, html: string): void {
  if ((el as HTMLElement).dataset.html !== html) { el.innerHTML = html; (el as HTMLElement).dataset.html = html; }
}

/** Slider fill: where the thumb (--p) and zero (--z) sit along the range, for the CSS track gradient. */
export function fillRange(el: HTMLInputElement): void {
  const min = Number(el.min), max = Number(el.max), at = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min) || 0));
  el.style.setProperty('--p', String(at(Number(el.value))));
  el.style.setProperty('--z', String(at(0)));
}

let toastTimer = 0;
export function toast(message: string): void {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('visible'), 2600);
}
