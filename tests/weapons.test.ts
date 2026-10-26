// The Weapons box (src/engine/weapons.ts): Mod Die choices for each weapon's Attack Checks,
// DV / Deadly DV from the weapons table, and the Unarmed Strike rows.
//
// From the rules: VIG "Affects … melee weapons", AGI "Affects Deft weapons", PER "Affects …
// Precise weapons, Ranged weapons"; a Gladiator "can use your Martial Die in place of your
// Attribute Die for any Weapon Attack Check you make".
import { describe, expect, it } from 'vitest';
import { built } from './helpers';
import { weapons } from '../src/content';
import { UNARMED } from '../src/engine/weapons';

const has = (w: (typeof weapons)[number], p: string) => w.properties.some((x) => x.toLowerCase().startsWith(p.toLowerCase()));
const deft = weapons.find((w) => has(w, 'Deft') && !has(w, 'Precise') && !has(w, 'Ranged') && !has(w, 'Drawn'))!;
const ranged = weapons.find((w) => has(w, 'Ranged'))!;
const plain = weapons.find((w) => !['Deft', 'Precise', 'Ranged', 'Drawn'].some((p) => has(w, p)))!;
const attributes = { method: 'manual' as const, pool: 12, base: { VIG: 2, AGI: 1, PER: 3, INT: 0, PRS: 0 }, bonus: [] };

function rowsFor(names: string[], over: Parameters<typeof built>[0] = {}) {
  return built({ attributes, ...over, equipment: { armor: null, weapons: names.map((name, i) => ({ id: `w${i}`, name })), inventory: [] } }).d;
}

describe('weapon Mod Die choices', () => {
  it('melee weapons use the VIG Die; Deft adds the AGI Die; Ranged weapons use the PER Die', () => {
    const d = rowsFor([plain.name, deft.name, ranged.name]);
    const [p, df, r] = d.weapons;
    expect(p.dice.map((o) => o.attr)).toEqual(['VIG']);
    expect(df.dice.map((o) => o.attr)).toEqual(['VIG', 'AGI']);
    expect(r.dice.map((o) => o.attr)).toEqual(['PER']);
    expect(r.dice[0].dice).toBe(d.attrs.PER.label);
  });

  it('a Gladiator can roll the Martial Die instead', () => {
    const d = rowsFor([plain.name], { classId: 'gladiator' });
    expect(d.weapons[0].dice.map((o) => o.dice)).toEqual([d.attrs.VIG.label, d.classDie]);
    expect(d.weapons[0].dice[1].label).toBe('Martial Die');
  });

  it('DV and Deadly DV come from the weapons table and are tallied', () => {
    const d = rowsFor([plain.name]);
    expect(d.weapons[0]).toMatchObject({ dv: plain.dv, deadlyDv: plain.deadlyDv, damage: plain.damage, properties: plain.properties, removeId: 'w0' });
    if (/^\d+$/.test(plain.dv)) expect(d.stats['weapon:w0:dv']?.value).toBe(Number(plain.dv));
  });

  it('a weapon that is not in the table has no dice or DVs', () => {
    const d = rowsFor(['Something homemade']);
    expect(d.weapons[0]).toMatchObject({ dice: [], dv: '', deadlyDv: '' });
  });
});

describe('Unarmed Strike rows', () => {
  it('only when picked; your body has DV 0 and Deadly DV equal to your VIG points', () => {
    expect(rowsFor([]).weapons).toEqual([]);
    const d = rowsFor([UNARMED]);
    expect(d.weapons[0]).toMatchObject({ kind: 'unarmed', name: UNARMED, dv: '0', deadlyDv: String(d.attrs.VIG.points), removeId: 'w0' });
    expect(d.weapons.slice(1).every((w) => w.kind === 'unarmed' && !w.removeId)).toBe(true);
  });
});
