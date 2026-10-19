import type { Light } from '../data/types';

/** Text-friendly tints of each Light's colour (readable on the dark background). */
export const LIGHT_TEXT: Record<Light, string> = {
  Flame: '#ff9a52',
  Frost: '#5ff0ff',
  Pneuma: '#ff5cf0',
  Soma: '#5ce6c6',
  Mordant: '#f0dc5a',
  Velvet: '#b48cff',
  Infernal: '#ff5a6e',
  Lunar: '#6f8dff',
  Temporal: '#6fd97a',
  Platinum: '#e3e6ef',
};

/** Copies of the band cycle in the gradient; the animation scrolls through one of them. */
export const GRADIENT_CYCLES = 4;

/**
 * Diagonal (top left to bottom right) gradient of the character's Lights,
 * strongest first. Each Light gets a band sized by its level; the middle half
 * of a band is its solid colour and neighbouring bands blend into each other.
 *
 * The band cycle is repeated GRADIENT_CYCLES times across a background that is
 * GRADIENT_CYCLES times the size of the heading, so each heading shows exactly
 * one cycle and sliding the background by one cycle loops seamlessly (the
 * last band blends into the first band of the next copy).
 */
export function alignmentGradient(ranked: { light: Light; level: number }[]): string | undefined {
  const total = ranked.reduce((s, a) => s + a.level, 0);
  if (!total) return undefined;
  if (ranked.length === 1) return `linear-gradient(to bottom right, ${LIGHT_TEXT[ranked[0].light]}, ${LIGHT_TEXT[ranked[0].light]})`;
  const stops: string[] = [];
  const pct = (cycle: number, f: number) => `${(((cycle + f) / GRADIENT_CYCLES) * 100).toFixed(2)}%`;
  for (let cycle = 0; cycle < GRADIENT_CYCLES; cycle++) {
    let start = 0;
    for (const a of ranked) {
      const width = a.level / total;
      const c = LIGHT_TEXT[a.light];
      stops.push(`${c} ${pct(cycle, start + width * 0.25)}`, `${c} ${pct(cycle, start + width * 0.75)}`);
      start += width;
    }
  }
  return `linear-gradient(to bottom right, ${stops.join(', ')})`;
}
