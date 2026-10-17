import { describe, expect, it } from 'vitest';
import { getItem, getNode, maneuvers, personalAlignment, spells, weapons, conditions, basicActions, armorQualities } from '../content';
import { ancestries } from '../data/ancestries';
import { backgrounds, heritageFacets } from '../data/backgrounds';
import { classes } from '../data/classes';
import { newCharacter, type Character } from './character';
import { classAlignment, classEndurance, classTable, subclassesOf } from './classInfo';
import { derive } from './derive';
import { dieLabel, stepDie, modDieFromPoints, formatDie, triangular } from './dice';
import { levelUp, longRest, shortRest, takeDamage, freshPlay } from './play';

function build(over: Partial<Character> = {}): Character {
  return { ...newCharacter(), name: 'Test', ...over };
}

describe('dice', () => {
  it('maps attribute points to mod dice', () => {
    expect(dieLabel(-1)).toBe('-d2');
    expect(dieLabel(0)).toBe('—');
    expect(dieLabel(3)).toBe('d6');
    expect(dieLabel(6)).toBe('d12');
    expect(dieLabel(8)).toBe('d12+2');
    expect(dieLabel(-6)).toBe('-d12');
  });
  it('steps dice and carries past d12', () => {
    expect(formatDie(stepDie(modDieFromPoints(5), 2))).toBe('d12+1'); // d10 Bolstered 2 -> d12 +1
    expect(formatDie(stepDie(modDieFromPoints(2), -4))).toBe('-d4'); // d4 Hindered 4 -> -d4
  });
  it('grows Movement/Radius triangularly', () => {
    expect([0, 1, 2, 3].map(triangular)).toEqual([0, 1, 3, 6]);
    expect(triangular(-1)).toBe(-1);
  });
});

describe('rules content', () => {
  it('parses spells, maneuvers, actions, conditions and equipment', () => {
    expect(spells.length).toBeGreaterThan(90);
    expect(maneuvers.length).toBeGreaterThan(25);
    expect(basicActions.find((a) => a.name === 'Strike')).toBeTruthy();
    expect(conditions.find((c) => c.name === 'Bleeding')?.leveled).toBe(true);
    expect(weapons.find((w) => w.name === 'Longsword')?.dv).toBe('2 (3)');
    expect(armorQualities.find((q) => q.quality === 'Basic')?.ac.Heavy).toBe(6);
  });
  it('reads the personal alignment matrix', () => {
    expect(personalAlignment('Action', 'Reason', 'Apathy')).toBe('Flame');
    expect(personalAlignment('Patience', 'Instinct', 'Empathy')).toBe('Frost');
  });
});

// These catch renamed/moved sections when a new rules revision is parsed.
describe('data references resolve against the rules', () => {
  it('ancestry facets', () => {
    for (const a of ancestries) {
      expect(getNode(a.contentId), a.contentId).toBeTruthy();
      for (const f of [...a.facets, ...(a.subAncestries ?? []).flatMap((s) => s.facets)]) {
        expect(getItem(f.contentId!, f.item!), `${a.name}: ${f.name}`).toBeTruthy();
      }
    }
  });
  it('backgrounds and heritage facets', () => {
    for (const b of backgrounds) expect(getNode(b.contentId), b.contentId).toBeTruthy();
    for (const h of heritageFacets) expect(getNode(h.contentId!), h.contentId).toBeTruthy();
  });
  it('classes, tables, choices, subclasses and spell grants', () => {
    for (const c of classes) {
      expect(getNode(c.contentId), c.contentId).toBeTruthy();
      const t = classTable(c);
      expect(t.rows.length, `${c.name} table`).toBeGreaterThanOrEqual(2);
      expect(classEndurance(c).start, `${c.name} endurance`).toBeGreaterThan(0);
      for (const r of c.resources) expect(t.headers.some((h) => h.toLowerCase().includes(r.column.toLowerCase())), `${c.name}: ${r.column}`).toBe(true);
      for (const ch of c.choices ?? []) for (const o of ch.options) if (o.contentId) expect(getNode(o.contentId), o.contentId).toBeTruthy();
      expect(subclassesOf(c).length, `${c.name} subclasses`).toBeGreaterThan(0);
      for (const key of Object.keys(c.subclassExtras ?? {})) expect(subclassesOf(c).some((s) => s.id === key), `${c.name}: ${key}`).toBe(true);
      for (const key of Object.keys(c.facetExtras ?? {})) expect(getNode(`${c.contentId}/${key}`), `${c.name}: ${key}`).toBeTruthy();
      for (const sc of subclassesOf(c)) for (const key of Object.keys(sc.extras.facetExtras ?? {})) expect(getNode(`${sc.contentId}/${key}`), `${sc.name}: ${key}`).toBeTruthy();
      const granted = [...(c.spellLists ?? []), ...subclassesOf(c).flatMap((s) => s.extras.spellLists ?? [])].flatMap((l) => l.granted ?? []);
      for (const g of granted) expect([...spells, ...maneuvers].some((s) => s.id === g), g).toBe(true);
    }
  });
  it('class alignments', () => {
    const map = Object.fromEntries(classes.map((c) => [c.id, classAlignment(c)]));
    expect(map.arcanist).toBe('Lunar');
    expect(map.berserker).toBe('Soma');
    expect(map.troubadour).toBe('choice');
    expect(map.luminary).toBe(null);
  });
});

describe('derive', () => {
  it('computes a level 1 Cogitani Arcanist', () => {
    const c = build({
      attributes: { method: 'pointBuy', pool: 12, base: { VIG: 0, AGI: 1, PER: 2, INT: 3, PRS: 1 }, bonus: [] },
      ancestry: 'cogitani',
      classId: 'arcanist',
      subclass: 'kinesis-triumvirate',
    });
    const d = derive(c);
    expect(d.pointBuy.spent).toBe(12);
    expect(d.classBonus).toBe(2);
    expect(d.classDie).toBe('d6');
    expect(d.movement).toBe(4); // 3 + 1
    expect(d.radius).toBe(8); // 5 + 1 + 2
    expect(d.vitalityMax).toBe(3);
    expect(d.radianceMax).toBe(1);
    expect(d.enduranceMax).toBe(16);
    expect(d.ac.value).toBe(5); // INT 3 + PER 2
    expect(d.resistances).toContainEqual({ type: 'Psychic', value: 2 });
    expect(d.alignment.map((a) => a.light)).toEqual(['Flame', 'Frost', 'Pneuma', 'Velvet', 'Lunar']); // Kinesis adds Flame/Frost/Velvet
    expect(d.saves.find((s) => s.attr === 'INT')?.label).toBe('d6 + d6');
    expect(d.resources).toEqual([{ name: 'Prisma', max: 2, mode: 'limit' }]);
    expect(d.skillSlots.filter((s) => s.kind === 'hobby')).toHaveLength(2 + 3 + 1);
    expect(d.skillSlots.filter((s) => s.kind === 'profession')).toHaveLength(2);
    const grimoire = d.spellLists.find((l) => l.def.id === 'grimoire')!;
    expect(grimoire.count).toBe(5);
    expect(grimoire.pool.every((s) => s.kind === 'spell' && s.group === 'Arcana' && s.level === 1)).toBe(true);
    expect(d.spellLists.find((l) => l.def.id === 'prepared')?.count).toBe(4); // level 1 + INT 3
    expect(d.facets.some((f) => f.name === 'Kinetic Font')).toBe(true);
    expect(d.facets.some((f) => f.name === 'Arcane Flow')).toBe(false);
  });

  it('applies human bonus attribute and age-ups', () => {
    const c = build({
      ancestry: 'human',
      attributes: { method: 'pointBuy', pool: 12, base: { VIG: 2, AGI: 1, PER: 1, INT: 1, PRS: 2 }, bonus: ['VIG'] },
      ageUps: ['AGI'],
    });
    const d = derive(c);
    expect(d.attrs.VIG.points).toBe(3);
    expect(d.attrs.AGI.points).toBe(0);
    expect(d.radianceMax).toBe(1 + 1 + 1);
    expect(d.skillSlots.filter((s) => s.source === 'Age-up 1')).toHaveLength(3);
  });

  it('flags attributes above the cap', () => {
    const c = build({ attributes: { method: 'pointBuy', pool: 12, base: { VIG: 4, AGI: 3, PER: 0, INT: -1, PRS: 1 }, bonus: [] } });
    expect(derive(c).issues.some((i) => i.includes('VIG is above'))).toBe(true);
  });

  it('handles berserker unarmored AC, Rage and choices', () => {
    const c = build({
      ancestry: 'soli',
      subAncestry: 'velvet',
      classId: 'berserker',
      subclass: 'roaring-fervor',
      level: 2,
      attributes: { method: 'pointBuy', pool: 12, base: { VIG: 3, AGI: 2, PER: 1, INT: 0, PRS: -1 }, bonus: [] },
    });
    const d = derive(c);
    expect(d.ac.value).toBe(3 + 2 + 2 + 2); // two highest + level + Sturdy Scales (level)
    expect(d.movement).toBe(3 + 3 + 1);
    const m = d.spellLists.find((l) => l.def.id === 'maneuvers')!;
    expect(m.count).toBe(3);
    expect(m.granted.map((g) => g.name)).toEqual(['Rage']);
    expect(d.choices.map((ch) => ch.id)).toContain('somatic-wellspring');
    expect(d.resources[0]).toEqual({ name: 'Stamina', max: 5, mode: 'pool' });
    expect(d.slashingVulnerability).toBe('');
  });

  it('computes armored AC with class bonus', () => {
    const c = build({
      classId: 'gladiator',
      attributes: { method: 'pointBuy', pool: 12, base: { VIG: 3, AGI: 1, PER: 2, INT: 0, PRS: 0 }, bonus: [] },
      equipment: { armor: { type: 'Heavy', quality: 'Basic' }, weapons: [{ id: 'w', name: 'Kite Shield' }], inventory: [] },
    });
    const d = derive(c);
    expect(d.ac.value).toBe(6 + 3 + 2 + 1);
    expect(d.resistances).toContainEqual({ type: 'Slashing', value: 6 });
    expect(d.resistances).toContainEqual({ type: 'Piercing', value: 3 });
    expect(d.attrs.AGI.label).toBe('—'); // d2 one step smaller (d4 Hindered 4 -> -d4 implies a 'no die' step)
  });
});

describe('play', () => {
  const base = () => {
    const c = build({
      ancestry: 'mundalf',
      classId: 'expert',
      subclass: 'investigator',
      attributes: { method: 'pointBuy', pool: 12, base: { VIG: 2, AGI: 1, PER: 3, INT: 1, PRS: 0 }, bonus: [] },
    });
    c.play = freshPlay(c);
    return c;
  };

  it('starts fully rested', () => {
    const c = base();
    const d = derive(c);
    expect(c.play.endurance).toBe(20 + 2);
    expect(c.play.vitality).toBe(d.vitalityMax);
    expect(d.vitalityMax).toBe(3 + 1 + 1);
  });

  it('applies damage to temp endurance, endurance, then vitality', () => {
    const c = base();
    const d = derive(c);
    let p = { ...c.play, tempEndurance: 4 };
    p = takeDamage(p, 10, d);
    expect(p.tempEndurance).toBe(0);
    expect(p.endurance).toBe(22 - 6);
    p = takeDamage(p, 100, d);
    expect(p.endurance).toBe(0);
    expect(p.vitality).toBe(5);
    p = takeDamage(p, 1, d);
    expect(p.vitality).toBe(4);
    expect(p.dying).toBe(1);
  });

  it('short and long rests restore resources', () => {
    const c = base();
    const d = derive(c);
    c.play = { ...c.play, endurance: 2, vitality: 2, resources: { Stamina: 3 }, radianceSpent: 1 };
    const s = shortRest(c, d, { spendRestCharge: true });
    expect(s.play.vitality).toBe(3); // +ceil(2/2)
    expect(s.play.endurance).toBe(2 + 11);
    expect(s.play.resources.Stamina).toBe(0);
    const gritty = shortRest({ ...c, settings: { restRules: 'gritty' } }, d, { spendRestCharge: false });
    expect(gritty.play.vitality).toBe(2);
    const l = longRest(c, d);
    expect(l.play.endurance).toBe(22);
    expect(l.play.vitality).toBe(2 + 1 + 1);
    expect(l.play.tempEndurance).toBe(2 * 2);
  });

  it('levels up with the checklist', () => {
    const c = base();
    const { character, summary } = levelUp(c);
    expect(character.level).toBe(2);
    expect(summary.changes).toContain('Endurance Maximum: 22 → 34');
    expect(summary.newFacets.map((f) => f.name)).toEqual(['Evaluate', 'Superior Tactics']);
    expect(character.play.endurance).toBe(34);
  });
});

describe('rules clarifications', () => {
  it('adds resistances of the same type from different sources', () => {
    const c = build({
      ancestry: 'soli',
      subAncestry: 'flame',
      classId: 'expert',
      attributes: { method: 'pointBuy', pool: 12, base: { VIG: 2, AGI: 1, PER: 3, INT: 1, PRS: 0 }, bonus: [] },
      equipment: { armor: { type: 'Medium', quality: 'Basic' }, weapons: [], inventory: [] },
    });
    // Sturdy Scales: ½ Class Bonus (1) + Medium armor: ½ AC value (2)
    expect(derive(c).resistances).toContainEqual({ type: 'Slashing', value: 3 });
  });

  it('reads alignment grants from class and subclass facet text', () => {
    const lights = (classId: string, subclass: string) =>
      derive(build({ classId, subclass }))
        .facets.flatMap((f) => (f.effects ?? []).filter((e) => e.kind === 'alignment').map((e) => (e.kind === 'alignment' ? e.light : '')))
        .sort();
    expect(lights('arcanist', 'kinesis-triumvirate')).toEqual(['Flame', 'Frost', 'Velvet']);
    expect(lights('luminary', 'flaming-luminance')).toEqual(['Flame']);
    expect(lights('incarnate', 'the-king')).toEqual(['Frost']);
    // Class alignment (Infernal) comes from the class's Alignment section, not a facet.
    expect(derive(build({ classId: 'thaumaturge', subclass: 'cosmos-domain' })).alignment.map((a) => a.light)).toEqual(['Infernal']);
  });
});
