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
/** Fluent System Icons, 20px regular (MIT, github.com/microsoft/fluentui-system-icons). */
const fi = (d: string) => `<svg class="fi" viewBox="0 0 20 20" aria-hidden="true"><path d="${d}"/></svg>`;
export const FI = {
  help: fi('M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16m0 1a7 7 0 1 0 0 14 7 7 0 0 0 0-14m0 10.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5m0-8a2.5 2.5 0 0 1 1.65 4.38l-.15.12-.22.17-.09.07-.16.15c-.33.36-.53.85-.53 1.61a.5.5 0 0 1-1 0 3.2 3.2 0 0 1 1.16-2.62l.25-.19.12-.1A1.5 1.5 0 0 0 10 6.5c-.83 0-1.5.67-1.5 1.5a.5.5 0 0 1-1 0A2.5 2.5 0 0 1 10 5.5'),
  moon: fi('M15.5 13.5A6.98 6.98 0 0 1 4 14.39c2.83-1.09 4.56-2.42 5.6-4.4 1.04-2 1.33-4.16.75-6.9q1.36.17 2.58.87a7 7 0 0 1 2.55 9.54M5.45 16.92A7.98 7.98 0 1 0 9.88 2.04a.6.6 0 0 0-.61.73c.69 2.82.43 4.88-.55 6.76-.94 1.78-2.55 3.03-5.55 4.1a.6.6 0 0 0-.3.9 8 8 0 0 0 2.59 2.39'),
  sun: fi('M10 2c.28 0 .5.22.5.5v1a.5.5 0 0 1-1 0v-1c0-.28.22-.5.5-.5m0 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m0-1a3 3 0 1 1 0-6 3 3 0 0 1 0 6m7.5-2.5a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1zM10 16c.28 0 .5.22.5.5v1a.5.5 0 0 1-1 0v-1c0-.28.22-.5.5-.5m-6.5-5.5a.5.5 0 0 0 0-1H2.46a.5.5 0 0 0 0 1zm.65-6.35c.2-.2.5-.2.7 0l1 1a.5.5 0 1 1-.7.7l-1-1a.5.5 0 0 1 0-.7m.7 11.7a.5.5 0 0 1-.7-.7l1-1a.5.5 0 0 1 .7.7zm11-11.7a.5.5 0 0 0-.7 0l-1 1a.5.5 0 0 0 .7.7l1-1a.5.5 0 0 0 0-.7m-.7 11.7a.5.5 0 0 0 .7-.7l-1-1a.5.5 0 0 0-.7.7z'),
  add: fi('M10 2.5c.28 0 .5.22.5.5v6.5H17a.5.5 0 0 1 0 1h-6.5V17a.5.5 0 0 1-1 0v-6.5H3a.5.5 0 0 1 0-1h6.5V3c0-.28.22-.5.5-.5'),
  zoomIn: fi('M8.5 5.5c.28 0 .5.22.5.5v2h2a.5.5 0 0 1 0 1H9v2a.5.5 0 0 1-1 0V9H6a.5.5 0 0 1 0-1h2V6c0-.28.22-.5.5-.5m0-3.5a6.5 6.5 0 0 1 4.94 10.73l3.41 3.42a.5.5 0 0 1-.63.76l-.07-.06-3.42-3.41A6.5 6.5 0 1 1 8.5 2m0 1a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11'),
  zoomOut: fi('M11 8a.5.5 0 0 1 0 1H6a.5.5 0 0 1 0-1zM8.5 2a6.5 6.5 0 0 1 4.94 10.73l3.41 3.42a.5.5 0 0 1-.63.76l-.07-.06-3.42-3.41A6.5 6.5 0 1 1 8.5 2m0 1a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11'),
  fitY: fi('m15 3.63 1.14 1.18a.5.5 0 1 0 .72-.7l-1.82-1.88a.75.75 0 0 0-1.08 0L12.14 4.1a.5.5 0 1 0 .72.7L14 3.63V7.5a.5.5 0 0 0 1 0zM3 5c0-1.1.9-2 2-2h4.5a.5.5 0 0 1 0 1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4.5a.5.5 0 0 1 0 1H5a2 2 0 0 1-2-2zm13.14 10.2L15 16.36V12.5a.5.5 0 1 0-1 0v3.87l-1.14-1.18a.5.5 0 1 0-.72.7l1.82 1.88c.3.3.79.3 1.08 0l1.82-1.88a.5.5 0 1 0-.72-.7'),
  reset: fi('M16 10A6 6 0 0 0 5.53 6H7.5a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 1 0v1.6a7 7 0 1 1-1.98 4.36.5.5 0 0 1 1 .08L4 10a6 6 0 0 0 12 0'),
  options: fi('M14.95 5a2.5 2.5 0 0 0-4.9 0H2.5a.5.5 0 0 0 0 1h7.55a2.5 2.5 0 0 0 4.9 0h2.55a.5.5 0 0 0 0-1zM12.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m-2.55 7a2.5 2.5 0 0 0-4.9 0H2.5a.5.5 0 0 0 0 1h2.55a2.5 2.5 0 0 0 4.9 0h7.55a.5.5 0 0 0 0-1zM7.5 16a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3'),
  download: fi('M15.5 17a.5.5 0 0 1 .09 1H4.5a.5.5 0 0 1-.09-1H15.5M10 2a.5.5 0 0 1 .5.41V14.3l3.64-3.65a.5.5 0 0 1 .64-.06l.07.06c.17.17.2.44.06.63l-.06.07-4.5 4.5a.5.5 0 0 1-.25.14L10 16a.5.5 0 0 1-.4-.2l-4.46-4.45a.5.5 0 0 1 .64-.76l.07.06 3.65 3.64V2.5c0-.27.22-.5.5-.5'),
  dismiss: fi('m4.09 4.22.06-.07a.5.5 0 0 1 .63-.06l.07.06L10 9.29l5.15-5.14a.5.5 0 0 1 .63-.06l.07.06c.18.17.2.44.06.63l-.06.07L10.71 10l5.14 5.15c.18.17.2.44.06.63l-.06.07a.5.5 0 0 1-.63.06l-.07-.06L10 10.71l-5.15 5.14a.5.5 0 0 1-.63.06l-.07-.06a.5.5 0 0 1-.06-.63l.06-.07L9.29 10 4.15 4.85a.5.5 0 0 1-.06-.63l.06-.07z'),
  color: fi('M10 2a8 8 0 0 1 3.39 15.25c-1.09.5-2.33.44-3.3-.06a2.9 2.9 0 0 1-1.64-2.73q.04-.68.14-1.24.1-.59.14-1.02.03-.44-.08-.73-.09-.3-.45-.57a1 1 0 0 0-.84-.24q-.43.09-1.02.39c-.73.36-1.77.94-2.97.33-1.1-.56-1.43-1.87-1.22-2.92A8 8 0 0 1 10 2m0 1a7 7 0 0 0-6.87 5.66c-.15.78.13 1.54.69 1.83.68.35 1.25.07 2.08-.34.38-.18.83-.4 1.31-.48.52-.07 1.06.03 1.59.43q.58.44.79 1.02c.14.38.16.77.14 1.14s-.1.75-.15 1.12q-.1.55-.13 1.12c-.03.8.42 1.44 1.1 1.8.7.36 1.62.42 2.41.04A7 7 0 0 0 10 3m2.5 10a1 1 0 1 1 0 2 1 1 0 0 1 0-2m2-2.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2m0-3a1 1 0 1 1 0 2 1 1 0 0 1 0-2m-2-2.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2m-3-.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2'),
  undo: fi('M5 2.5a.5.5 0 0 0-1 0v4.9c0 .33.27.6.6.6h4.9a.5.5 0 0 0 0-1H5.9l3.48-3.02a4 4 0 0 1 5.25 6.04l-8.17 7.1a.5.5 0 0 0 .65.76l8.17-7.1a5 5 0 0 0-6.56-7.55L5 6.46z'),
  redo: fi('M15 2.5a.5.5 0 0 1 1 0v4.9a.6.6 0 0 1-.6.6h-4.9a.5.5 0 0 1 0-1h3.6l-3.48-3.02a4 4 0 1 0-5.24 6.04l8.17 7.1a.5.5 0 1 1-.66.76l-8.17-7.1a5 5 0 1 1 6.56-7.55L15 6.46z'),
  grid: fi('M7.5 11c.83 0 1.5.67 1.5 1.5v4c0 .83-.67 1.5-1.5 1.5h-4A1.5 1.5 0 0 1 2 16.5v-4c0-.83.67-1.5 1.5-1.5zm9 0c.83 0 1.5.67 1.5 1.5v4c0 .83-.67 1.5-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4c0-.83.67-1.5 1.5-1.5zm-9 1h-4a.5.5 0 0 0-.5.5v4c0 .28.22.5.5.5h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5m9 0h-4a.5.5 0 0 0-.5.5v4c0 .28.22.5.5.5h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5m-9-10C8.33 2 9 2.67 9 3.5v4C9 8.33 8.33 9 7.5 9h-4A1.5 1.5 0 0 1 2 7.5v-4C2 2.67 2.67 2 3.5 2zm9 0c.83 0 1.5.67 1.5 1.5v4c0 .83-.67 1.5-1.5 1.5h-4A1.5 1.5 0 0 1 11 7.5v-4c0-.83.67-1.5 1.5-1.5zm-9 1h-4a.5.5 0 0 0-.5.5v4c0 .28.22.5.5.5h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5m9 0h-4a.5.5 0 0 0-.5.5v4c0 .28.22.5.5.5h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5'),
  delete: fi('M8.5 4h3a1.5 1.5 0 0 0-3 0m-1 0a2.5 2.5 0 0 1 5 0h5a.5.5 0 0 1 0 1h-1.05l-1.2 10.34A3 3 0 0 1 12.27 18H7.73a3 3 0 0 1-2.98-2.66L3.55 5H2.5a.5.5 0 0 1 0-1zM5.74 15.23A2 2 0 0 0 7.73 17h4.54a2 2 0 0 0 1.99-1.77L15.44 5H4.56zM8.5 7.5c.28 0 .5.22.5.5v6a.5.5 0 0 1-1 0V8c0-.28.22-.5.5-.5M12 8a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z'),
  copy: fi('M7 7H5.5C4.67 7 4 7.67 4 8.5v6c0 .83.67 1.5 1.5 1.5h4c.65 0 1.2-.42 1.41-1h1.04a2.5 2.5 0 0 1-2.45 2h-4A2.5 2.5 0 0 1 3 14.5v-6A2.5 2.5 0 0 1 5.5 6H7zm7.5-4A2.5 2.5 0 0 1 17 5.5v6a2.5 2.5 0 0 1-2.5 2.5h-4A2.5 2.5 0 0 1 8 11.5v-6A2.5 2.5 0 0 1 10.5 3zm-4 1C9.67 4 9 4.67 9 5.5v6c0 .83.67 1.5 1.5 1.5h4c.83 0 1.5-.67 1.5-1.5v-6c0-.83-.67-1.5-1.5-1.5z'),
  star: fi('M9.1 2.9a1 1 0 0 1 1.8 0l1.93 3.91 4.31.63a1 1 0 0 1 .56 1.7l-3.12 3.05.73 4.3a1 1 0 0 1-1.45 1.05L10 15.51l-3.86 2.03a1 1 0 0 1-1.45-1.05l.74-4.3L2.3 9.14a1 1 0 0 1 .56-1.7l4.31-.63zm.9.44L8.07 7.25a1 1 0 0 1-.75.55L3 8.43l3.12 3.04a1 1 0 0 1 .3.89l-.75 4.3 3.87-2.03a1 1 0 0 1 .93 0l3.86 2.03-.74-4.3a1 1 0 0 1 .29-.89L17 8.43l-4.32-.63a1 1 0 0 1-.75-.55z'),
  starFilled: fi('M9.1 2.9a1 1 0 0 1 1.8 0l1.93 3.91 4.31.63a1 1 0 0 1 .56 1.7l-3.12 3.05.73 4.3a1 1 0 0 1-1.45 1.05L10 15.51l-3.86 2.03a1 1 0 0 1-1.45-1.05l.74-4.3L2.3 9.14a1 1 0 0 1 .56-1.7l4.31-.63z'),
  cursor: fi('M5 3.06a1 1 0 0 1 1.64-.77l11 9.06a1 1 0 0 1-.63 1.77h-5.6c-.43 0-.85.19-1.13.52L6.76 17.7A1 1 0 0 1 5 17.06zm12 9.06L6 3.06v14l3.52-4.08a2.5 2.5 0 0 1 1.9-.86z'),
  eyeOff: fi('M2.85 2.15a.5.5 0 1 0-.7.7l3.5 3.5a8 8 0 0 0-3.37 5.05.5.5 0 1 0 .98.2 7 7 0 0 1 3.1-4.53l1.6 1.59a3.5 3.5 0 1 0 4.88 4.89l4.3 4.3a.5.5 0 0 0 .71-.7zm9.27 10.68a2.5 2.5 0 1 1-3.45-3.45zm-2-4.83 3.38 3.38A3.5 3.5 0 0 0 10.12 8M10 6q-.86 0-1.67.21l-.8-.8A8 8 0 0 1 10 5c3.7 0 6.94 2.67 7.72 6.4a.5.5 0 0 1-.98.2A7 7 0 0 0 10 6'),
  ratio: fi('M6.76 7.07q.23.16.24.43v5a.5.5 0 0 1-1 0V8.3l-.28.15a.5.5 0 1 1-.44-.9l1-.5a.5.5 0 0 1 .48.02M14 7.5a.5.5 0 0 0-.72-.45l-1 .5a.5.5 0 1 0 .44.9L13 8.3v4.19a.5.5 0 0 0 1 0zm-4 1a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0M9.5 12a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1M2 6.75A2.75 2.75 0 0 1 4.75 4h10.5A2.75 2.75 0 0 1 18 6.75v6.5A2.75 2.75 0 0 1 15.25 16H4.75A2.75 2.75 0 0 1 2 13.25zM4.75 5C3.78 5 3 5.78 3 6.75v6.5c0 .97.78 1.75 1.75 1.75h10.5c.97 0 1.75-.78 1.75-1.75v-6.5C17 5.78 16.22 5 15.25 5z'),
  search: fi('M13.73 14.44a6.5 6.5 0 1 1 .7-.7l3.42 3.4a.5.5 0 0 1-.63.77l-.07-.06zm-.71-.71A5.5 5.5 0 0 0 15 9.5a5.5 5.5 0 1 0-1.98 4.23'),
  home: fi('M9 2.39a1.5 1.5 0 0 1 2 0l5.5 4.94c.32.28.5.69.5 1.12v7.05c0 .83-.67 1.5-1.5 1.5H13a1.5 1.5 0 0 1-1.5-1.5V12a.5.5 0 0 0-.5-.5H9a.5.5 0 0 0-.5.5v3.5c0 .83-.67 1.5-1.5 1.5H4.5A1.5 1.5 0 0 1 3 15.5V8.45c0-.43.18-.84.5-1.12zm1.33.74a.5.5 0 0 0-.66 0l-5.5 4.94a.5.5 0 0 0-.17.38v7.05c0 .28.22.5.5.5H7a.5.5 0 0 0 .5-.5V12c0-.83.67-1.5 1.5-1.5h2c.83 0 1.5.67 1.5 1.5v3.5c0 .28.22.5.5.5h2.5a.5.5 0 0 0 .5-.5V8.45a.5.5 0 0 0-.17-.38z'),
};
export const ICONS = { trash: FI.delete, sliders: FI.options, copy: FI.copy };

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
/** A short message; with an action (Cofnij) it stays longer and the button takes clicks. */
export function toast(message: string, action?: { label: string; run: () => void }): void {
  const el = $('toast');
  el.replaceChildren(h('span', {}, message));
  if (action) {
    const b = h('button', { type: 'button', class: 'toast-action' }, action.label);
    b.addEventListener('click', () => { el.classList.remove('visible'); action.run(); });
    el.append(b);
  }
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('visible'), action ? 7000 : 2600);
}

/** Fluent tooltips in place of the native title bubble: shown after a short delay on hover or keyboard focus. */
export function initTooltips(): void {
  const tip = $('tooltip');
  let owner: HTMLElement | null = null, timer = 0;
  const hide = () => {
    clearTimeout(timer);
    if (owner && !owner.hasAttribute('title') && owner.dataset.tip) owner.title = owner.dataset.tip;
    owner = null;
    if (tip.matches(':popover-open')) tip.hidePopover();
  };
  const show = (el: HTMLElement) => {
    hide();
    const text = el.getAttribute('title');
    if (!text) return;
    owner = el;
    el.dataset.tip = text;
    el.removeAttribute('title');
    // An icon-only control keeps its accessible name while the title is lifted off.
    if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', text);
    timer = window.setTimeout(() => {
      if (!el.isConnected) return;
      tip.textContent = text;
      tip.showPopover();
      const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect(), gap = 8;
      // Beside a vertical toolbar, otherwise above the control (below when there is no room).
      let x = r.left + (r.width - t.width) / 2, y = r.top - t.height - gap;
      if (el.closest('[aria-orientation="vertical"]') && innerWidth > 760) { x = r.left - t.width - gap; y = r.top + (r.height - t.height) / 2; }
      else if (y < 4) y = r.bottom + gap;
      tip.style.left = `${Math.max(4, Math.min(x, innerWidth - t.width - 4))}px`;
      tip.style.top = `${Math.max(4, Math.min(y, innerHeight - t.height - 4))}px`;
    }, 300);
  };
  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch' || owner?.contains(e.target as Node)) return;
    const el = (e.target as Element).closest<HTMLElement>('[title]');
    if (el) show(el); else if (owner) hide();
  });
  document.addEventListener('pointerout', e => { if (owner && !owner.contains(e.relatedTarget as Node)) hide(); });
  document.addEventListener('focusin', e => {
    const t = e.target as Element, el = t.closest?.<HTMLElement>('[title]');
    if (el && t.matches(':focus-visible')) show(el);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
}
