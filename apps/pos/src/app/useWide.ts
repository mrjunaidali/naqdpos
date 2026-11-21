import { useSyncExternalStore } from 'react';

/** From 768px (Tailwind md): side nav, cart beside the grid. Narrow when matchMedia is missing. */
export const WIDE_QUERY = '(min-width: 768px)';

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const list = window.matchMedia(WIDE_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

const wideNow = () =>
  typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches;

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, wideNow, () => false);
}
