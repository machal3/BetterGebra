/**
 * Light or dark: state.theme is the explicit choice (null = follow the system). <html data-theme> always holds the
 * resolved one, since the Affect UI components read it; main.ts writes it whenever either source changes.
 */
import { useSyncExternalStore } from 'react';
import { commit, state } from '../state';

export const systemDark = matchMedia('(prefers-color-scheme: dark)');
export const isDark = () => (state.theme ? state.theme === 'dark' : systemDark.matches);

/** Light ↔ dark. From a button, the new theme spreads out of it in a circle, where there are view transitions. */
export function toggleTheme(from?: Element): void {
  const flip = () => {
    state.theme = isDark() ? 'light' : 'dark';
    commit('theme');
  };
  if (!from || !('startViewTransition' in document) || matchMedia('(prefers-reduced-motion: reduce)').matches) return flip();
  const b = from.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.startViewTransition(flip).ready.then(() => document.documentElement.animate(
    { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
    { duration: 640, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
  ), () => { /* skipped: the theme has changed all the same */ });
}

const subscribe = (notify: () => void) => {
  const mo = new MutationObserver(notify);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
};
/** The theme on screen, for labels like "Jasny motyw". */
export const useDark = () => useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme === 'dark');
