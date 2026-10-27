// Summons: stat blocks resolved at the casting level, and the summon's own
// Endurance, Conditions and turns. Expected values come from the spells' stat
// blocks in rules/BtP-Alpha-Rules.md (Summon Familiar, Snow Familiar, Bestial
// Communion) and the Bestiary's Wolf (src/content/creatures.json, exported from
// the Monster Maker).
import { describe, expect, it } from 'vitest';
import { getNode } from '../src/content';
import { addCondition } from '../src/engine/conditions';
import {
  SUMMON_SPELLS,
  castSummon,
  creatureChoices,
  creatures,
  damageSummon,
  endSummonTurn,
  fromPlay,
  healSummon,
  newSummon,
  startSummonTurn,
  statBlock,
  summonDefenses,
  summonPlay,
  type Summon,
} from '../src/engine/summons';

const FAMILIAR = 'spells/arcana/mind/summon-familiar';
const SNOW = 'spells/arcana/ice/snow-familiar';
const BESTIAL = 'spells/evocations/frost/bestial-communion';
const SPIRITUAL = 'spells/evocations/pneuma/spiritual-communion';

const block = (spell: string, level: number, creature?: string) => {
  const b = statBlock({ spell, level, creature });
  if (!b) throw new Error(`no stat block for ${spell}`);
  return b;
};
const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe('summon spells', () => {
  it('every summon spell and stat block exists in the rules', () => {
    for (const s of SUMMON_SPELLS) {
      expect(getNode(s.spell), s.spell).toBeDefined();
      if (s.node) expect(getNode(s.node), s.node).toBeDefined();
    }
  });
});

describe('Familiar (Summon Familiar)', () => {
  // Armor Class: Half {SL} plus 10 (rounded up); Endurance: 3{SL} plus 10.
  it.each([
    [1, 11, 13],
    [2, 11, 16],
    [3, 12, 19],
    [4, 12, 22],
    [5, 13, 25],
  ])('at level %i: AC %i, Endurance %i', (sl, ac, end) => {
    const b = block(FAMILIAR, sl);
    expect(b.armorClass).toBe(ac);
    expect(b.endurance).toBe(end);
    expect(b.subtitle).toBe(`Tiny Ethereal, level ${sl}`);
  });

  it('has the stat block’s numbers, Attributes and defences', () => {
    const b = block(FAMILIAR, 1);
    expect(b.movement).toBe('4');
    expect(b.perRadius).toBe(8);
    expect(b.attributes).toEqual({ VIG: -5, AGI: -1, PER: 2, INT: 3, PRS: -4 });
    expect(names(b.immunities)).toEqual(['Arctic', 'Blinded', 'Bleeding', 'Bruised', 'Caustic', 'Deafened', 'Prone', 'Somatic', 'Thermic']);
    expect(b.vulnerabilities).toEqual([{ name: 'Cosmic', rating: '3d6' }]);
    expect(b.languages).toEqual(['Yours']);
    expect(b.duration).toBe('Until dispelled');
    expect(names(b.sections.map((s) => ({ name: s.title })))).toEqual(['Traits', 'Actions']);
  });

  it('Attributes match the rules text', () => {
    const html = getNode('spells/arcana/mind/summon-familiar/familiar')!.html!;
    const b = block(FAMILIAR, 1);
    for (const [, pts, attr] of html.matchAll(/<p>(-?\d+) \([^)]*\) ::<span class="ic ic-(\w+)"/g)) expect(b.attributes[attr as 'VIG'], attr).toBe(Number(pts));
  });

  it('Psychic Blast damage is resolved for the casting level', () => {
    // Success: Half {SL} plus 1; Deadly Success: {SL} plus 2.
    const html = block(FAMILIAR, 4).sections.find((s) => s.title === 'Actions')!.html!;
    expect(html).toMatch(/<b class="calc">3<\/b> Psychic damage/);
    expect(html).toMatch(/<b class="calc">6<\/b> Psychic damage/);
  });

  it('splits its Immunities into damage types and Conditions', () => {
    const d = summonDefenses(block(FAMILIAR, 1));
    expect(d.immune).toEqual(['Arctic', 'Caustic', 'Somatic', 'Thermic']);
    expect(d.immuneConditions).toEqual(['Blinded', 'Bleeding', 'Bruised', 'Deafened', 'Prone']);
    expect(d.vulnerable).toEqual([{ type: 'Cosmic', dice: '3d6' }]);
  });
});

describe('Snow Familiar', () => {
  // Endurance 13{SL}; Size and VIG by level; Movements 7 at 4th, 8 at 5th; Endurance +20 at 5th.
  it.each([
    [1, 'Tiny', -4, 13, '6, Swim 6'],
    [2, 'Small', -2, 26, '6, Swim 6'],
    [3, 'Medium', 0, 39, '6, Swim 6'],
    [4, 'Large', 2, 52, '7, Swim 7'],
    [5, 'Gigantic', 4, 85, '8, Swim 8'],
  ])('at level %i: %s, VIG %i, Endurance %i, Movement %s', (sl, size, vig, end, move) => {
    const b = block(SNOW, sl);
    expect(b.subtitle).toBe(`${size} Primordial, level ${sl}`);
    expect(b.attributes.VIG).toBe(vig);
    expect(b.endurance).toBe(end);
    expect(b.movement).toBe(move);
    expect(b.armorClass).toBe(10);
  });

  it('lasts 24 hours, or until dispelled at 5th level with its Exalted Freezing Blast', () => {
    expect(block(SNOW, 4).duration).toBe('24 hours');
    expect(block(SNOW, 4).sections.some((s) => s.title === 'Exalted')).toBe(false);
    const b = block(SNOW, 5);
    expect(b.duration).toBe('Until dispelled');
    expect(b.sections.find((s) => s.title === 'Exalted')?.entries?.[0].text).toMatch(/Freezing 2 on a Success/);
  });

  it('Freezing Blast damage is resolved for the casting level', () => {
    // half {SL} plus 1 / {SL} plus 2 Arctic.
    const html = block(SNOW, 3).sections.find((s) => s.title === 'Weapons')!.html!;
    expect(html).toMatch(/<b class="calc">3<\/b> \/ <b class="calc">5<\/b> Arctic/);
  });
});

describe('Bestial Communion', () => {
  const wolf = creatures.find((c) => c.id === 'wolf')!;

  it('the Wolf is the Bestiary’s', () => {
    expect(wolf).toMatchObject({ name: 'Wolf', size: 'Medium', alignment: 'Frost', type: 'Beast', level: 1, armorClass: 10, endurance: 22, movement: 15, perRadius: 15 });
    expect(wolf.attributes).toEqual({ VIG: 2, AGI: 4, PER: 2, INT: -3, PRS: 1 });
  });

  it('offers Beasts up to level 2{SL}', () => {
    expect(creatureChoices(BESTIAL, 1).map((c) => c.id)).toContain('wolf');
    expect(creatureChoices(BESTIAL, 1).every((c) => c.level <= 2)).toBe(true);
    expect(creatureChoices(BESTIAL, 1).every((c) => c.type.includes('Beast'))).toBe(true);
    expect(creatureChoices(SPIRITUAL, 1).every((c) => c.type.includes('Ethereal'))).toBe(true);
    expect(creatureChoices(FAMILIAR, 1)).toEqual([]);
  });

  it('is also an Eidolon, with Somatic Resistance 2{SL} and Immune to Bleeding and Bruised', () => {
    const b = block(BESTIAL, 3, 'wolf');
    expect(b.subtitle).toBe('Medium Frost Beast (Eidolon), level 1');
    expect(b.resistances).toEqual([
      { name: 'Arctic', rating: '2' },
      { name: 'Freezing', rating: '1' },
      { name: 'Somatic', rating: '6' },
    ]);
    expect(names(b.immunities)).toEqual(['Bleeding', 'Bruised']);
    expect(b.vulnerabilities).toEqual([{ name: 'Slashing', rating: '1d6' }]);
    expect(b.endurance).toBe(22);
    expect(b.movement).toBe('15, Swim 1');
    expect(b.duration).toMatch(/^24 hours/);
  });

  it('shows the Wolf’s Bite, Howl and Pack Strike', () => {
    const b = block(BESTIAL, 1, 'wolf');
    const entries = b.sections.flatMap((s) => s.entries ?? []);
    expect(entries.find((e) => e.name === 'Bite')?.text).toBe('(2 / 4) + Mod Slashing; Pulling, Seized by the wolf on a Deadly Success.');
    expect(names(entries)).toEqual(['Bite', 'Howl (5 {AP})', 'Pack Strike (Reaction, 3 {AP})']);
    expect(entries[2].trigger).toMatch(/^An Ally Strikes/);
  });
});

describe('casting a summon spell', () => {
  it('summons at full Endurance', () => {
    const { summons, log } = castSummon([], FAMILIAR, 2);
    expect(summons).toHaveLength(1);
    expect(summons[0]).toMatchObject({ spell: FAMILIAR, level: 2, endurance: 16, tempEndurance: 0, conditions: [] });
    expect(log.join(' ')).toMatch(/Summoned Familiar at 2nd level/);
  });

  it('casting it again replaces the earlier summon, keeping its name; other spells’ summons stay', () => {
    let summons: Summon[] = castSummon([], FAMILIAR, 1).summons;
    summons = [{ ...summons[0], name: 'Pip', endurance: 3 }];
    summons = castSummon(summons, SNOW, 1).summons;
    const r = castSummon(summons, FAMILIAR, 3);
    expect(r.summons.map((s) => s.spell).sort()).toEqual([SNOW, FAMILIAR].sort());
    expect(r.summons.find((s) => s.spell === FAMILIAR)).toMatchObject({ name: 'Pip', level: 3, endurance: 19 });
    expect(r.log[0]).toMatch(/Pip is replaced/);
  });

  it('Communion at 5th level summons a second Beast', () => {
    expect(castSummon([], BESTIAL, 4, 'wolf').summons).toHaveLength(1);
    expect(castSummon([], BESTIAL, 5, 'wolf').summons).toHaveLength(2);
  });

  it('a Communion spell without a creature summons nothing', () => {
    expect(castSummon([], BESTIAL, 1).summons).toEqual([]);
  });
});

describe('a summon in play', () => {
  const fresh = (spell: string, level: number, creature?: string) => newSummon(spell, level, creature)!;

  it('damage takes Temporary Endurance first and stops at 0; healing stops at its maximum', () => {
    let s = { ...fresh(FAMILIAR, 1), tempEndurance: 2 };
    s = damageSummon(s, 5);
    expect(s).toMatchObject({ tempEndurance: 0, endurance: 10 });
    s = damageSummon(s, 50);
    expect(s.endurance).toBe(0);
    expect(healSummon(s, 100, block(FAMILIAR, 1)).endurance).toBe(13);
  });

  it('gaining Burning deals its damage through the summon’s Immunities', () => {
    const snow = fresh(SNOW, 1);
    const b = block(SNOW, 1);
    const d = summonDefenses(b);
    // Burning 2: 3 × 2 Thermic damage when gained; the Snow Familiar has no Thermic Resistance.
    expect(fromPlay(snow, addCondition(summonPlay(snow), 'Burning', 2, d)).endurance).toBe(13 - 6);
    // The Familiar is Immune to Thermic damage.
    const fam = fresh(FAMILIAR, 1);
    expect(fromPlay(fam, addCondition(summonPlay(fam), 'Burning', 2, summonDefenses(block(FAMILIAR, 1)))).endurance).toBe(13);
  });

  it('Condition damage at the start of its turn goes through its Resistances', () => {
    // Poisoned 6: 6 Somatic damage; the Communion Wolf at 2nd level has Somatic Resistance 4.
    const wolf = { ...fresh(BESTIAL, 2, 'wolf'), conditions: [{ name: 'Poisoned', level: 6 }] };
    const r = startSummonTurn(wolf, block(BESTIAL, 2, 'wolf'));
    expect(r.summon.endurance).toBe(22 - 2);
    expect(r.summon.turn?.active).toBe(true);
    expect(r.log.join(' ')).toMatch(/take 2 Somatic damage \(6 − Resistance 4\)/);
  });

  it('a Condition it is Immune to deals no damage', () => {
    const wolf = { ...fresh(BESTIAL, 1, 'wolf'), conditions: [{ name: 'Bleeding', level: 2 }] };
    expect(startSummonTurn(wolf, block(BESTIAL, 1, 'wolf')).summon.endurance).toBe(22);
  });

  it('regains up to 3 AP at the end of its turn', () => {
    const s = { ...fresh(FAMILIAR, 1), ap: 0, turn: { active: true } };
    const r = endSummonTurn(s, block(FAMILIAR, 1));
    expect(r.summon.ap).toBe(3);
    expect(r.summon.turn?.active).toBe(false);
    expect(r.log.join(' ')).toMatch(/Regained AP \(3\)/);
  });
});
