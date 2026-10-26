/**
 * Light or dark: state.theme is the explicit choice (null = follow the system). <html data-theme> always holds the
 * resolved one, since the Affect UI components read it; main.ts writes it whenever either source changes.
 */
import { useSyncExternalStore } from 'react';
import { commit, state } from '../state';

export const systemDark = matchMedia('(prefers-color-scheme: dark)');
export const isDark = () => (state.theme ? state.theme === 'dark' : systemDark.matches);

export function toggleTheme(): void {
  state.theme = isDark() ? 'light' : 'dark';
  commit('theme');
}

const subscribe = (notify: () => void) => {
  const mo = new MutationObserver(notify);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
};
/** The theme on screen, for labels like "Jasny motyw". */
export const useDark = () => useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme === 'dark');
