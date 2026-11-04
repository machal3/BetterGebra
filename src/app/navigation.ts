/**
 * Where the app is: the panel comes from the address (#wykresy, #geometria, #kalkulator, #kalkulator?q=…, anything
 * else is the start screen), the graph mode from state. Changing either goes through here.
 */
import { useSyncExternalStore } from 'react';
import { commit, state, type Mode } from '../state';

export type Panel = 'home' | 'graphs' | 'geometry' | 'calculator';
/** What the mode switch shows: the two graph modes, then the other panels. */
export type Section = Mode | 'geometry' | 'calculator';

export const panelFromHash = (hash = location.hash): Panel =>
  // #kalkulator?q=… opens the calculator with that question (links to a result)
  hash.startsWith('#kalkulator') ? 'calculator' : ({ '#wykresy': 'graphs', '#geometria': 'geometry' } as Record<string, Panel>)[hash] ?? 'home';

const subscribe = (notify: () => void) => {
  addEventListener('hashchange', notify);
  return () => removeEventListener('hashchange', notify);
};
export const usePanel = (): Panel => useSyncExternalStore(subscribe, () => panelFromHash());

export const TITLES: Record<Section, string> = { graph: 'Wykresy', complex: 'Zespolone', geometry: 'Geometria', calculator: 'Kalkulator' };

export function setMode(mode: Mode): void {
  if (mode === state.mode) return;
  state.mode = mode;
  // The complex plane needs equal axes.
  if (mode === 'complex') state.view = { ...state.view, ratio: 1 };
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // the plane turns over into the other mode: out of a blur, from a hair smaller (the graphs then draw themselves in)
    document.getElementById('plot')?.animate(
      [{ opacity: 0.15, transform: 'scale(0.985)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
      { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }
  commit('mode', 'view');
}

export function openSection(section: Section): void {
  if (section === 'geometry') location.hash = '#geometria';
  else if (section === 'calculator') location.hash = '#kalkulator';
  else {
    setMode(section);
    if (location.hash !== '#wykresy') location.hash = '#wykresy';
  }
}
