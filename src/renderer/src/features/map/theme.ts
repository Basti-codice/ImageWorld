import { useSyncExternalStore } from 'react';

/** Reads a design token (CSS custom property) as a concrete colour string – MapLibre can't resolve var(). */
export function cssVar(name: string, fallback = '#888'): string {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}

const isDarkNow = () => document.documentElement.dataset.theme !== 'light';

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}

/** true while the app theme is dark. Reacts to `<html data-theme>` changes (also when set directly). */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, isDarkNow, () => true);
}

export const prefersReducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
