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
  /** Panels with corners cut flat (bevelled); off: square corners. */
  cutCorners: boolean;
  /** The chosen look; choosing one applies its LOOKS settings, which can then be customised. */
  look: Look;
  /** The guided tour has been finished or skipped (it starts by itself only before that). */
  tourSeen: boolean;
}

export type Look = 'faceted' | 'polished';

/** What each look turns on or off. */
export const LOOKS: Record<Look, { name: string; description: string; settings: Pick<Prefs, 'cutCorners' | 'glassPanels' | 'animateEdges'> }> = {
  faceted: {
    name: 'Faceted',
    description: 'Fully stylised: cut corners, frosted-glass panels and edges that drift with the background.',
    settings: { cutCorners: true, glassPanels: true, animateEdges: true },
  },
  polished: {
    name: 'Polished',
    description: 'Quieter and lighter: square corners, solid panels and still edges with their glint.',
    settings: { cutCorners: false, glassPanels: false, animateEdges: false },
  },
};

const KEY = 'btp.prefs.v1';
const DEFAULTS: Prefs = { pinStatBar: true, animateGradients: true, animateBackground: true, animateEdges: true, glassPanels: true, cutCorners: true, look: 'faceted', tourSeen: false };

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
