// Advanced edit mode: a PM's adjustments to numbers on the sheet, and spells or maneuvers
// added outside the class's lists. An adjusted number feeds everything worked out from it,
// as the rules work it out: VIG "Grants one Vitality per 2 points", Movement grows with
// AGI "+1 at 1, +2 at 2", and the Attribute Limit table caps assigned points only.
import { describe, expect, it } from 'vitest';
import { built, makeCharacter } from './helpers';
import { derive } from '../src/engine/derive';
import { normalizeCharacter, type Adjustment } from '../src/engine/character';
import { classes } from '../src/data/classes';
import { subclassesOf } from '../src/engine/classInfo';
import { spells, maneuvers } from '../src/content';
import { triangular } from '../src/engine/dice';

const attributes = { method: 'manual' as const, pool: 12, base: { VIG: 2, AGI: 1, PER: 1, INT: 0, PRS: 0 }, bonus: [] };
const cls = classes[0];
const sc = subclassesOf(cls)[0];
let n = 0;
const adj = (stat: string, op: Adjustment['op'], value: number, note?: string): Adjustment => ({ id: `a${n++}`, stat, op, value, note });
const withAdj = (...adjustments: Adjustment[]) => built({ classId: cls.id, subclass: sc.id, attributes, adjustments }).d;

describe('adjustments to numbers', () => {
  const base = withAdj();

  it('old saves get no adjustments', () => {
    const c = normalizeCharacter({ name: 'Old' });
    expect(c.adjustments).toEqual([]);
    expect(c.addedCastables).toEqual([]);
    expect(derive(c).adjustments).toEqual({ applied: [], unapplied: [] });
  });

  it('set replaces a number and add changes it, in order, with a breakdown line', () => {
    const d = withAdj(adj('ac', 'set', 15, 'cursed armor'), adj('ac', 'add', -1));
    expect(d.ac.value).toBe(14);
    expect(d.ac.breakdown.slice(-2)).toEqual(['→ 15 adjusted (cursed armor)', '−1 adjusted']);
    expect(d.adjustments.applied.map((x) => [x.label, x.before, x.after])).toEqual([
      ['AC', String(base.ac.value), '15'],
      ['AC', '15', '14'],
    ]);
  });

  it('an adjusted Attribute carries through to what it grants', () => {
    const d = withAdj(adj('attr:VIG', 'add', 2), adj('attr:AGI', 'set', 3));
    expect(d.attrs.VIG.points).toBe(4);
    expect(d.vitalityMax).toBe(base.vitalityMax + 1); // one Vitality per 2 points: 2 → 4 VIG
    expect(d.movement).toBe(base.movement - triangular(1) + triangular(3));
    expect(d.attrs.VIG.sources.at(-1)).toBe('+2 adjusted');
  });

  it('adjusted Attribute points do not count against the Attribute cap', () => {
    const d = withAdj(adj('attr:VIG', 'set', 5));
    expect(d.issues.some((i) => /VIG is above/.test(i))).toBe(false);
  });

  it('can give a Resistance or Swim Movement the character has no other source of', () => {
    const d = withAdj(adj('resistance:Arctic', 'add', 3), adj('movement:Swim', 'set', 4));
    expect(d.resistances).toContainEqual({ type: 'Arctic', value: 3 });
    expect(d.movementTypes).toContainEqual({ type: 'Swim', value: 4 });
  });

  it('dice: set takes the sides, add steps the die', () => {
    const d = withAdj(adj('die:class', 'set', 12), adj('die:attr:VIG', 'add', 1));
    expect(d.classDie).toBe('d12');
    expect(d.attrs.VIG.label).toBe('d6'); // 2 points is a d4, one step up
    expect(d.adjustments.applied.map((x) => [x.label, x.after])).toEqual([
      ['Class Die', 'd12'],
      ['VIG Die', 'd6'],
    ]);
  });

  it('Save Checks and Initiative can be Bolstered', () => {
    const d = withAdj(adj('save:PRS', 'add', 1), adj('initiative', 'add', 1));
    const prs = d.saves.find((s) => s.attr === 'PRS')!;
    expect(prs.shift).toBe(base.saves.find((s) => s.attr === 'PRS')!.shift + 1);
    expect(prs.notes).toContain('Bolstered 1 (adjusted)');
    expect(d.initiativeShift).toBe(base.initiativeShift + 1);
  });

  it('a stat the character does not have is listed as not applying', () => {
    const d = withAdj(adj('resource:Nothing', 'add', 2));
    expect(d.adjustments.unapplied.map((a) => a.stat)).toEqual(['resource:Nothing']);
  });

  it('weapon DVs can be adjusted', () => {
    const c = makeCharacter({ classId: cls.id, subclass: sc.id, attributes, equipment: { armor: null, weapons: [{ id: 'w', name: 'Unarmed Strike' }], inventory: [] } });
    const d = derive({ ...c, adjustments: [adj('weapon:unarmed:Unarmed Strike:deadly', 'add', 2)] });
    expect(d.weapons[0].deadlyDv).toBe(String(d.attrs.VIG.points + 2));
    expect(d.adjustments.applied[0].label).toBe('Unarmed Strike Deadly DV');
  });
});

describe('spells and maneuvers added by the PM', () => {
  it('appear in their own list, outside the class lists and limits', () => {
    const picks = [spells[0], maneuvers[0]];
    const { d } = built({ classId: cls.id, subclass: sc.id, attributes, addedCastables: picks.map((p) => p.id) });
    const list = d.spellLists.find((l) => l.def.id === 'added')!;
    expect(list.granted.map((g) => g.id)).toEqual(picks.map((p) => p.id));
    expect(d.issues.some((i) => /Added by your PM/.test(i))).toBe(false);
  });
});
