import { describe, expect, it } from 'vitest';
import { newCharacter, normalizeCharacter } from './character';

describe('normalizeCharacter', () => {
  it('turns old plain-name Experiences into single-use Experiences', () => {
    const c = normalizeCharacter({ ...newCharacter(), experiences: ['Monster Slayer'] });
    expect(c.experiences).toMatchObject([{ name: 'Monster Slayer', uses: 1, used: 0, effect: '' }]);
    expect(c.experiences[0].id).toBeTruthy();
    expect(normalizeCharacter(c).experiences).toEqual(c.experiences);
  });
});
