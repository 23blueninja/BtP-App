// App options saved in this browser (per device), e.g. pinning the stat bar.
import { useSyncExternalStore } from 'react';

export interface Prefs {
  /** Desktop: keep the Class Bonus / Attributes / AP bar at the top while scrolling. */
  pinStatBar: boolean;
  /** Flowing alignment gradients on headings and attribute symbols. */
  animateGradients: boolean;
  /** The drifting rainbow behind the triangle grid. */
  animateBackground: boolean;
  /** Panel edges drift with the background's rainbow (in steps, ~5 a second). */
  animateEdges: boolean;
  /** Frosted-glass panels (blur what's behind them; heavier on the GPU). */
  glassPanels: boolean;
}

const KEY = 'btp.prefs.v1';
const DEFAULTS: Prefs = { pinStatBar: true, animateGradients: true, animateBackground: true, animateEdges: true, glassPanels: true };

function read(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function setPrefs(p: Partial<Prefs>) {
  current = { ...current, ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable (private mode): keep the choice for this visit only.
  }
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
