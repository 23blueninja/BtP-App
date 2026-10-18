import type { Light } from '../data/types';

/** Text-friendly tints of each Light's colour (readable on the dark background). */
export const LIGHT_TEXT: Record<Light, string> = {
  Flame: '#ff9a52',
  Frost: '#9fe0ff',
  Pneuma: '#ff7ad9',
  Soma: '#5ce6c6',
  Mordant: '#f0dc5a',
  Velvet: '#b48cff',
  Infernal: '#ff5a6e',
  Lunar: '#8fa6ff',
  Temporal: '#6fd97a',
  Platinum: '#e3e6ef',
};

/**
 * Diagonal (bottom left to top right) gradient of the character's Lights, strongest first. Each Light
 * gets a band sized by its level; the middle half of a band is its solid
 * colour and neighbouring bands blend into each other.
 */
export function alignmentGradient(ranked: { light: Light; level: number }[]): string | undefined {
  const total = ranked.reduce((s, a) => s + a.level, 0);
  if (!total) return undefined;
  if (ranked.length === 1) return `linear-gradient(to top right, ${LIGHT_TEXT[ranked[0].light]}, ${LIGHT_TEXT[ranked[0].light]})`;
  let start = 0;
  const stops: string[] = [];
  for (const a of ranked) {
    const width = (a.level / total) * 100;
    const c = LIGHT_TEXT[a.light];
    stops.push(`${c} ${(start + width * 0.25).toFixed(1)}%`, `${c} ${(start + width * 0.75).toFixed(1)}%`);
    start += width;
  }
  return `linear-gradient(to top right, ${stops.join(', ')})`;
}
