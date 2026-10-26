/**
 * The bridge from state.ts to React. A component names the topics it shows and re-renders only when one of them
 * is committed; everything else (a slider moving, the view panning) passes it by. The canvases never subscribe
 * here: they redraw through scene.request(), outside React.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { on, state, type State, type Topic } from '../state';

/** Counts commits per topic set, so useSyncExternalStore sees a new snapshot exactly when a topic changed. */
export function useTopics(topics: Topic[]): number {
  const key = topics.join(' ');
  const version = useRef(0);
  const subscribe = useCallback((notify: () => void) => on(key.split(' ') as Topic[], () => { version.current++; notify(); }), [key]);
  return useSyncExternalStore(subscribe, () => version.current);
}

/**
 * A value read from state, re-read when one of the topics is committed. The selector may build a new object or
 * array: the hook returns what it computed on the render that followed the commit.
 */
export function useStore<T>(topics: Topic[], select: (s: State) => T): T {
  useTopics(topics);
  return select(state);
}
