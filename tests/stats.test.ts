// Stat tallies: every number derive works out is recorded in `d.stats` with the same value
// the sheet shows, so a PM adjustment to a stat can be applied in one place.
import { describe, expect, it } from 'vitest';
import { LEVELS, built, sample } from './helpers';
import { classes } from '../src/data/classes';
import { subclassesOf } from '../src/engine/classInfo';
import { Stats } from '../src/engine/stat';
import type { Derived } from '../src/engine/derive';

describe('Tally', () => {
  it('adds parts in order and keeps their breakdown lines', () => {
    const s = new Stats();
    const t = s.start('ac', 2, 'base 2').add(3, '+3 shield').add(0).note('just a note');
    expect(s.finish(t)).toBe(5);
    expect(s.get('ac')).toEqual({ value: 5, breakdown: ['base 2', '+3 shield', 'just a note'] });
  });

  it('set replaces the value, atLeast clamps it', () => {
    const s = new Stats();
    expect(s.finish(s.start('movement', 6).set(0, '→ 0 (Grappled)').add(-2))).toBe(-2);
    expect(s.finish(s.start('radius', 1).add(-5).atLeast(0))).toBe(0);
  });

  it('a stat can only be finished once', () => {
    const s = new Stats();
    s.value('classBonus', 1);
    expect(() => s.value('classBonus', 2)).toThrow(/finished twice/);
  });
});

/** The value each displayed number should have in `d.stats`. */
function displayed(d: Derived): [string, number | undefined, number][] {
  const v = (k: keyof Derived['stats']) => d.stats[k]?.value;
  return [
    ['classBonus', v('classBonus'), d.classBonus],
    ...d.saves.map((s) => [`attr:${s.attr}`, v(`attr:${s.attr}`), d.attrs[s.attr].points] as [string, number | undefined, number]),
    ['vitalityMax', v('vitalityMax'), d.vitalityMax],
    ['radianceMax', v('radianceMax'), d.radianceMax],
    ['enduranceMax', v('enduranceMax'), d.enduranceMax],
    ['restCharges', v('restCharges'), d.restCharges],
    ['longRestTempEndurance', v('longRestTempEndurance'), d.longRestTempEndurance],
    ['movement', v('movement'), d.movement],
    ['radius', v('radius'), d.radius],
    ['ac', v('ac'), d.ac.value],
    ['jumpLong', v('jumpLong'), d.jump.long],
    ['jumpHigh', v('jumpHigh'), d.jump.high],
    ['bulkShift', v('bulkShift'), d.bulkShift],
    ...d.movementTypes.map((m) => [`movement:${m.type}`, v(`movement:${m.type}`), m.value] as [string, number | undefined, number]),
    ...d.resistances.map((r) => [`resistance:${r.type}`, v(`resistance:${r.type}`), r.value] as [string, number | undefined, number]),
    ...d.resources.map((r) => [`resource:${r.name}`, v(`resource:${r.name}`), r.max] as [string, number | undefined, number]),
    ...d.spellLists.filter((l) => l.def.id !== 'granted').map((l) => [`spells:${l.def.id}`, v(`spells:${l.def.id}`), l.count] as [string, number | undefined, number]),
    ...d.bulkSlots.map((b) => [`bulk:${b.rank}`, v(`bulk:${b.rank}`), b.slots] as [string, number | undefined, number]),
  ];
}

describe('derive tallies every number it shows', () => {
  const cases = sample(
    classes.flatMap((cls) => subclassesOf(cls).flatMap((sc) => LEVELS.map((level) => ({ cls, sc, level })))),
    12,
  );
  for (const armor of [null, { type: 'Light', quality: 'Basic' }, { type: 'Heavy', quality: 'Basic' }] as const) {
    it.each(cases.map((x) => [`${x.cls.name} (${x.sc.name}) level ${x.level}, ${armor?.type ?? 'unarmored'}`, x]))('%s', (_, { cls, sc, level }) => {
      const { d } = built({
        classId: cls.id,
        subclass: sc.id,
        level,
        attributes: { method: 'manual', pool: 12, base: { VIG: 2, AGI: 1, PER: 1, INT: 0, PRS: 0 }, bonus: [] },
        equipment: { armor, weapons: [], inventory: [] },
      });
      for (const [key, stat, shown] of displayed(d)) expect(stat, key).toBe(shown);
      expect(d.stats.ac?.breakdown).toEqual(d.ac.breakdown);
      expect(d.stats.movement?.breakdown).toEqual(d.movementBreakdown);
    });
  }
});
