import { describe, expect, it } from 'vitest';
import { newCharacter, type Character, type HomebrewEntry } from './character';
import { derive } from './derive';
import { resolveHomebrew, spendPool } from './homebrew';
import { freshPlay, longRest } from './play';

const chains: HomebrewEntry = {
  id: 'chains',
  kind: 'item',
  name: "Predator's Chains",
  tierLight: 'Frost',
  rows: [
    { id: 'a', effect: { kind: 'note', text: 'Lose your Temporary Endurance after staying in the same space for 10 minutes.' } },
    { id: 'b', minTier: 1, maxTier: 1, effect: { kind: 'movement', amount: 1 } },
    { id: 'c', minTier: 1, effect: { kind: 'movementType', type: 'Swim', amount: 'movement' } },
    { id: 'd', minTier: 1, effect: { kind: 'check', scope: 'attribute', attr: 'PER', amount: 1 } },
    { id: 'e', minTier: 2, effect: { kind: 'movement', amount: 2 } },
    { id: 'f', minTier: 2, effect: { kind: 'movementType', type: 'Climb', amount: 'movement' } },
    { id: 'g', minTier: 3, effect: { kind: 'attribute', attr: 'AGI', amount: 1 } },
    { id: 'h', minTier: 3, effect: { kind: 'note', text: 'While sleeping, your PER Checks are unaffected by being Unconscious.' } },
  ],
};

const moonblade: HomebrewEntry = {
  id: 'moon',
  kind: 'item',
  name: 'Moonblade',
  subtitle: 'Supernatural Platinum Katana',
  baseWeapon: 'Katana',
  attunement: true,
  attuned: true,
  tierLight: 'Platinum',
  level: [0, 2, 3, 4],
  stats: { PER: [3, 3, 4, 5], INT: 1, PRS: 2 },
  pools: [{ id: 'light', name: 'Light', max: [0, 2, 3, 4], refresh: 'Long Rest' }],
  rows: [
    { id: '1', minTier: 1, effect: { kind: 'weapon', property: 'Precise', die: 'item:PER' } },
    { id: '2', minTier: 1, when: 'onPerson', effect: { kind: 'initiativeTandem', die: 'item:PER' } },
    { id: '3', minTier: 1, when: 'onPerson', effect: { kind: 'saveTandem', attr: 'PER', die: 'item:PER' } },
    { id: '4', minTier: 2, onSpend: 'light', effect: { kind: 'note', text: 'Your next Strike this turn costs 1 less AP.' } },
    { id: '5', minTier: 2, effect: { kind: 'weapon', note: 'Critical Success on a 19 or 20.' } },
    { id: '6', minTier: 3, onSpend: 'light', effect: { kind: 'note', text: 'Your next Attack Check with this weapon this turn deals Divine damage.' } },
  ],
};

function build(over: Partial<Character>): Character {
  const { play, ...rest } = over;
  const c = { ...newCharacter(), name: 'Test', ...rest };
  return { ...c, play: { ...freshPlay(c), ...play } };
}
const frostFirm = { classId: 'expert', alignment: { situations: 'Patience', problems: 'Instinct', people: 'Empathy', picks: {} } } as const;
const platinumFirm = { classId: 'troubadour', alignment: { situations: 'Patience', problems: 'Reason', people: 'Apathy', picks: { class: 'Platinum' } } } as const;

describe("Predator's Chains", () => {
  it('Weak: Movement +1, Swim, PER Attribute Checks Bolstered', () => {
    const base = derive(build({ classId: 'expert' }));
    const d = derive(build({ classId: 'expert', homebrew: [chains] }));
    expect(d.homebrew[0].tier).toBe(1);
    expect(d.movement).toBe(base.movement + 1);
    expect(d.movementTypes.map((m) => m.type)).toEqual(['Swim']);
    expect(d.bolsters).toContain("PER Attribute Checks: Bolstered 1 (Predator's Chains)");
  });
  it('Firm: Movement +2 instead of +1, and Climb', () => {
    const base = derive(build({ ...frostFirm }));
    const d = derive(build({ ...frostFirm, homebrew: [chains] }));
    expect(d.homebrew[0].tier).toBe(2);
    expect(d.movement).toBe(base.movement + 2);
    expect(d.movementTypes.map((m) => m.type)).toEqual(['Swim', 'Climb']);
  });
  it('Strong: AGI +1 that does not count against the cap', () => {
    const c = build({ ...frostFirm, homebrew: [chains] });
    const r = resolveHomebrew(c, () => 3);
    expect(r.effects.map((x) => x.e.kind)).toContain('attribute');
    expect(r.cards[0].applied.map((x) => x.id)).toEqual(['a', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
});

describe('Moonblade', () => {
  it('stats, level and pools follow the Platinum tier', () => {
    const d = derive(build({ ...platinumFirm, homebrew: [moonblade] }));
    const card = d.homebrew[0];
    expect(card.tier).toBe(2);
    expect(card.level).toBe(3);
    expect(card.stats.PER).toEqual({ points: 4, die: 'd8' });
    expect(card.pools[0]).toMatchObject({ name: 'Light', max: 3, spent: 0 });
  });
  it('Initiative and PER Saves in Tandem with its PER Die while on your person and attuned', () => {
    // No class: Platinum Weak from the Personal Alignment alone, so the blade's PER Die is a d6.
    const weak = derive(build({ classId: '', alignment: { ...platinumFirm.alignment, picks: {} }, homebrew: [moonblade] }));
    expect(weak.saves.find((s) => s.attr === 'PER')?.label).toMatch(/\/ d6$/);
    const d = derive(build({ ...platinumFirm, homebrew: [moonblade] }));
    expect(d.initiativeNotes.join()).toContain('Moonblade PER Die (d8)');
    const packed = derive(build({ ...platinumFirm, homebrew: [{ ...moonblade, inBackpack: true }] }));
    expect(packed.initiativeNotes.join()).not.toContain('Moonblade');
    const unattuned = derive(build({ ...platinumFirm, homebrew: [{ ...moonblade, attuned: false }] }));
    expect(unattuned.weaponMods.some((m) => m.weapon === 'Moonblade')).toBe(false);
  });
  it('weapon modifiers target only Moonblade', () => {
    const d = derive(build({ ...platinumFirm, homebrew: [moonblade] }));
    expect(d.weaponMods.filter((m) => m.weapon === 'Moonblade')).toMatchObject([
      { property: 'Precise', tandemDie: { name: 'Moonblade PER', die: 'd8' } },
      { note: 'Critical Success on a 19 or 20.' },
    ]);
  });
  it('spending Light adds the reminders for this tier and refills on a Long Rest', () => {
    const c = build({ ...platinumFirm, homebrew: [moonblade] });
    const d = derive(c);
    const r = spendPool(c.play, d.homebrew[0], 'light');
    expect(r.play.effects?.map((e) => e.notes?.[0])).toEqual(['Your next Strike this turn costs 1 less AP.']);
    const after = { ...c, play: r.play };
    expect(derive(after).homebrew[0].pools[0].spent).toBe(1);
    expect(derive({ ...after, play: longRest(after, derive(after)).play }).homebrew[0].pools[0].spent).toBe(0);
  });
});

describe('homebrew effects', () => {
  it('a curse that stops Radiance coming back on a Long Rest, ending at the next Long Rest', () => {
    const curse: HomebrewEntry = { id: 'x', kind: 'effect', name: 'Dimmed', ends: 'longRest', rows: [{ id: 'r', effect: { kind: 'restRule', rule: 'noRadianceLongRest' } }] };
    const c = build({ homebrew: [curse], play: { radianceSpent: 1 } as never });
    const r = longRest(c, derive(c));
    expect(r.play.radianceSpent).toBe(1);
    expect(r.homebrew).toEqual([]);
    expect(r.log).toContain('Dimmed ended.');
  });
  it('Hindered checks and AC penalties feed the sheet', () => {
    const hex: HomebrewEntry = {
      id: 'h',
      kind: 'effect',
      name: 'Hex',
      rows: [
        { id: '1', effect: { kind: 'check', scope: 'all', attr: 'PRS', amount: -2 } },
        { id: '2', effect: { kind: 'ac', amount: -1 } },
      ],
    };
    const base = derive(build({}));
    const d = derive(build({ homebrew: [hex] }));
    expect(d.ac.value).toBe(base.ac.value - 1);
    expect(d.conditionFx.checks.find((r) => r.attr === 'PRS')).toMatchObject({ hindered: 2, hinderedFrom: ['Hex'] });
  });
});
