import { describe, expect, it } from 'vitest';
import { alignmentGradient, GRADIENT_CYCLES, LIGHT_TEXT } from './lightColors';

describe('alignment heading gradient', () => {
  it('sizes each band by Alignment level, strongest first, repeated for the animation', () => {
    const g = alignmentGradient([
      { light: 'Velvet', level: 2 },
      { light: 'Flame', level: 1 },
      { light: 'Lunar', level: 1 },
    ])!;
    expect(g.startsWith('linear-gradient(to bottom right, ')).toBe(true);
    const stops = [...g.matchAll(/(#[0-9a-f]{6}) ([\d.]+)%/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(stops).toHaveLength(6 * GRADIENT_CYCLES);
    // First cycle: Velvet 0–50%, Flame 50–75%, Lunar 75–100% of the cycle; solid in each band's middle half.
    const cycle = 100 / GRADIENT_CYCLES;
    expect(stops.slice(0, 6)).toEqual([
      [LIGHT_TEXT.Velvet, +(cycle * 0.125).toFixed(2)],
      [LIGHT_TEXT.Velvet, +(cycle * 0.375).toFixed(2)],
      [LIGHT_TEXT.Flame, +(cycle * 0.5625).toFixed(2)],
      [LIGHT_TEXT.Flame, +(cycle * 0.6875).toFixed(2)],
      [LIGHT_TEXT.Lunar, +(cycle * 0.8125).toFixed(2)],
      [LIGHT_TEXT.Lunar, +(cycle * 0.9375).toFixed(2)],
    ]);
    // Later cycles are the same bands shifted by one cycle.
    expect(stops[6]).toEqual([LIGHT_TEXT.Velvet, +(cycle + cycle * 0.125).toFixed(2)]);
  });
  it('is a solid colour for one Light and absent for none', () => {
    expect(alignmentGradient([{ light: 'Soma', level: 3 }])).toBe(`linear-gradient(to bottom right, ${LIGHT_TEXT.Soma}, ${LIGHT_TEXT.Soma})`);
    expect(alignmentGradient([])).toBeUndefined();
  });
});
