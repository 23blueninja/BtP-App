import { describe, expect, it } from 'vitest';
import { alignmentGradient, LIGHT_TEXT } from './lightColors';

describe('alignment heading gradient', () => {
  it('sizes each band by Alignment level, strongest first', () => {
    const g = alignmentGradient([
      { light: 'Velvet', level: 2 },
      { light: 'Flame', level: 1 },
      { light: 'Lunar', level: 1 },
    ])!;
    // Velvet takes 0–50%, Flame 50–75%, Lunar 75–100%; solid in the middle half of each band.
    expect(g).toBe(
      `linear-gradient(to bottom right, ${LIGHT_TEXT.Velvet} 12.5%, ${LIGHT_TEXT.Velvet} 37.5%, ${LIGHT_TEXT.Flame} 56.3%, ${LIGHT_TEXT.Flame} 68.8%, ${LIGHT_TEXT.Lunar} 81.3%, ${LIGHT_TEXT.Lunar} 93.8%)`,
    );
  });
  it('is a solid colour for one Light and absent for none', () => {
    expect(alignmentGradient([{ light: 'Soma', level: 3 }])).toBe(`linear-gradient(to bottom right, ${LIGHT_TEXT.Soma}, ${LIGHT_TEXT.Soma})`);
    expect(alignmentGradient([])).toBeUndefined();
  });
});
