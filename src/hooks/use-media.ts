import { useCallback, useSyncExternalStore } from 'react';

/** Whether a media query matches now; re-renders when it flips. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const mq = matchMedia(query);
    mq.addEventListener('change', notify);
    return () => mq.removeEventListener('change', notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}

/** Phones: panels become sheets, the mode switch moves to the bottom. */
export const PHONE = '(max-width: 767px)';
