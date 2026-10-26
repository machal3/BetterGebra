/**
 * The geometry board's state for React: re-renders once per frame at most when the construction, the selection or
 * the tool changes (the board batches its notices), and the favourite tools, remembered as before.
 */
import { useSyncExternalStore } from 'react';
import { TOOLS, geoStore, type ToolId } from '../../geometry/controller';

export function useGeo(): typeof geoStore {
  useSyncExternalStore(geoStore.subscribe, geoStore.version);
  return geoStore;
}

const FAV_STORE = 'bettergebra.geometry.favourites';
const DEFAULT_FAVS: ToolId[] = ['move', 'point', 'segment', 'line', 'polygon', 'circle', 'intersect', 'delete'];
function loadFavs(): ToolId[] {
  try { const saved = JSON.parse(localStorage.getItem(FAV_STORE) ?? 'null'); if (Array.isArray(saved)) return saved.filter((id): id is ToolId => id in TOOLS); } catch { /* keep the default */ }
  return DEFAULT_FAVS;
}
let favs = loadFavs();
const favListeners = new Set<() => void>();
export function setFavs(next: ToolId[]): void {
  favs = next;
  try { localStorage.setItem(FAV_STORE, JSON.stringify(next)); } catch { /* just don't remember */ }
  for (const l of favListeners) l();
}
export const useFavs = () => useSyncExternalStore(l => { favListeners.add(l); return () => { favListeners.delete(l); }; }, () => favs);

/** Lower case, without Polish letters: "srodek" finds "Środek". */
export const plain = (s: string) => s.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/\p{M}/gu, '');
