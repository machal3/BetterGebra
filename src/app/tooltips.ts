/**
 * Tooltips in place of the native title bubble: shown after a short delay on hover or keyboard focus, beside a
 * vertical toolbar and above other controls (below when there is no room). The Affect UI components keep their own.
 */
export function initTooltips(): void {
  const tip = document.createElement('div');
  tip.id = 'tooltip';
  tip.className = 'b-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.popover = 'manual';
  document.body.append(tip);
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
      if (el.closest('[aria-orientation="vertical"]') && innerWidth >= 768) { x = r.left - t.width - gap; y = r.top + (r.height - t.height) / 2; }
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
