// Play mode: what happens at the table — Conditions, turns, damage, healing,
// rests, and using Actions / facets / spells / maneuvers (activations).
//
// Expected behaviour comes from the rules document (rules/BtP-Alpha-Rules.md):
// "Conditions", "Endurance and Vitality", "Dying", "Resting", "Damage", the
// class casting sections and each activation's own rules section. Where the app
// deviates from the document the test is kept as `it.fails('BUG: …')`.
import { describe, expect, it } from 'vitest';
import { QA, badNumbers, makeCharacter, sample } from './helpers';
import { conditions as conditionDefs, getCastable, getNode } from '../src/content';
import { classById } from '../src/data/classes';
import { ATTRS, type Attr } from '../src/data/types';
import type { Character, HomebrewEntry, PlayState } from '../src/engine/character';
import { derive, type Derived } from '../src/engine/derive';
import {
  ACTIVATIONS,
  actionRequest,
  activationUseKey,
  activationsFor,
  apChoice,
  apCost,
  needsPrompt,
  performUse,
  useMax,
  type ActivationDef,
  type UseInputs,
  type UseRequest,
} from '../src/engine/activations';
import {
  AP_MAX,
  CONDITION_DAMAGE_TYPE,
  CONDITION_RULES,
  activeConditions,
  addCondition,
  conditionEffects,
  describeCheck,
  endTurn,
  startTurn,
  type ConditionEffects,
} from '../src/engine/conditions';
import { parseCost } from '../src/engine/costs';
import { clampPlay, facetUseMax, freshPlay, heal, longRest, shortRest, takeDamage } from '../src/engine/play';
import { castCost, maxCastLevel } from '../src/engine/scaling';
import type { ResolvedFacet } from '../src/engine/classInfo';

// ---------------------------------------------------------------- helpers

const ATTR_BASE = (o: Partial<Record<Attr, number>> = {}) => ({ VIG: 2, AGI: 1, PER: 1, INT: 1, PRS: 2, ...o });

/** A character of a class with manual Attributes (VIG 2, PRS 2 unless overridden). */
function hero(classId: string, over: Parameters<typeof makeCharacter>[0] = {}, attrs: Partial<Record<Attr, number>> = {}): Character {
  return makeCharacter({ classId, level: 2, attributes: { method: 'manual', pool: 12, base: ATTR_BASE(attrs), bonus: [] }, ...over });
}

/** Character and its Derived, with play overrides. */
function setup(classId: string, play: Partial<PlayState> = {}, attrs: Partial<Record<Attr, number>> = {}, over: Parameters<typeof makeCharacter>[0] = {}) {
  const c = hero(classId, { ...over, play }, attrs);
  return { c, d: derive(c) };
}

/** A play state with the given Conditions (and anything else). */
function playWith(conds: { name: string; level?: number }[] = [], extra: Partial<PlayState> = {}): PlayState {
  return { ...makeCharacter().play, endurance: 20, conditions: conds, ...extra };
}

const homebrewEffect = (name: string, rows: HomebrewEntry['rows'], over: Partial<HomebrewEntry> = {}): HomebrewEntry => ({ id: name.toLowerCase().replace(/\W+/g, '-'), kind: 'effect', name, rows, ...over });
const row = (id: string, effect: HomebrewEntry['rows'][number]['effect']) => ({ id, effect });

/** The class that owns an activation's rules section (spells/maneuvers: a class that can use them). */
function ownerClass(def: ActivationDef): string {
  const m = def.id.match(/^classes\/([^/]+)\//);
  if (m) {
    const sub: Record<string, string> = { 'champions-causes': 'champion', 'wild-fervors': 'berserker', 'divine-domains': 'thaumaturge' };
    return sub[m[1]] ?? m[1];
  }
  return def.id.startsWith('maneuvers/') ? 'berserker' : 'arcanist';
}

/** The request the sheet builds: Cast/Execute button for spells and maneuvers, Use button otherwise. */
function reqFor(def: ActivationDef, d: Derived, sl = 0): UseRequest {
  const cs = getCastable(def.id);
  if (cs) return { key: cs.id, name: cs.name, cost: parseCost(cs.fields['Cast Time'] ?? cs.fields['Execution Time']), def, sl };
  return { ...actionRequest(d, def.id, def.label, getNode(def.id)?.fields?.Cost, def), key: `${def.id}:${def.label}`, sl };
}

const act = (label: string) => {
  const def = ACTIVATIONS.find((a) => a.label === label);
  if (!def) throw new Error(`no activation ${label}`);
  return def;
};

/** Uses an activation as the owning class (or the class given). */
function use(label: string, opts: { cls?: string; play?: Partial<PlayState>; attrs?: Partial<Record<Attr, number>>; sl?: number; inputs?: UseInputs; d?: (d: Derived) => Derived; over?: Parameters<typeof makeCharacter>[0] } = {}) {
  const def = act(label);
  const { c, d: d0 } = setup(opts.cls ?? ownerClass(def), opts.play, opts.attrs, opts.over);
  const d = opts.d ? opts.d(d0) : d0;
  const req = reqFor(def, d, opts.sl ?? (getCastable(def.id) ? 1 : 0));
  const r = performUse(c, d, req, opts.inputs);
  return { ...r, c, d, req, before: c.play };
}

const hinderedOf = (fx: ConditionEffects, attr: Attr, save = false) => fx.checks.find((r) => r.attr === attr && r.save === save)?.hindered ?? 0;
const rowOf = (fx: ConditionEffects, attr: Attr, save = false) => fx.checks.find((r) => r.attr === attr && r.save === save);

/** Invariants every play state must keep. */
function expectSanePlay(p: PlayState, d: Derived) {
  expect(badNumbers(p)).toEqual([]);
  expect(p.ap ?? 0).toBeGreaterThanOrEqual(0);
  expect(p.tempAp ?? 0).toBeGreaterThanOrEqual(0);
  expect(p.tempEndurance).toBeGreaterThanOrEqual(0);
  expect(p.endurance).toBeGreaterThanOrEqual(0);
  expect(p.endurance).toBeLessThanOrEqual(d.enduranceMax);
  expect(p.vitality).toBeGreaterThanOrEqual(0);
  expect(p.vitality).toBeLessThanOrEqual(d.vitalityMax);
  expect(p.radianceSpent).toBeGreaterThanOrEqual(0);
  for (const v of Object.values(p.resources)) expect(v).toBeGreaterThanOrEqual(0);
  for (const v of Object.values(p.trackers)) expect(v).toBeGreaterThanOrEqual(0);
  for (const v of Object.values(p.facetUses)) expect(v).toBeGreaterThanOrEqual(0);
}

// ---------------------------------------------------------------- Conditions: expected effects from the rules text

interface Expected {
  implied?: Record<string, number>;
  hindered?: Partial<Record<Attr, number>>;
  weakened?: Attr[];
  weakenedSave?: Attr[];
  disadvantage?: Attr[];
  autofail?: Attr[];
  autofailSave?: Attr[];
  against?: number; // number of "Attack Checks against you" lines
  otherChecks?: number;
  ac?: number;
  movement?: number | 'zero';
  /** Start-of-turn damage (character level 2, Endurance above 0). */
  start?: { type: string; amount: number }[];
  /** Level change at the end of your turn. */
  end?: number;
  noApRegain?: boolean;
}

const CHAR_LEVEL = 2;
const restrainedChain = { Restrained: 1, Seized: 1, Immobilized: 1 };

/** What each Condition does at level X, transcribed from the "Condition List". */
const EXPECTED: Record<string, (x: number) => Expected> = {
  Bleeding: (x) => ({ start: [{ type: 'Somatic', amount: CHAR_LEVEL * x }] }),
  Blinded: () => ({ disadvantage: ['PER'], autofail: ['PER'], against: 1 }),
  Bruised: () => ({ weakened: ['VIG', 'AGI'] }),
  Buffeted: (x) => ({ ac: -x }),
  Burning: (x) => ({ implied: { Numbed: x }, hindered: { PER: x }, start: [{ type: 'Thermic', amount: 3 * x }] }),
  Deafened: () => ({ weakened: ['PER'], autofail: ['PER'] }),
  Dissolving: (x) => ({ start: [{ type: 'Caustic', amount: 2 * x }], end: -1 }),
  Dulled: (x) => ({ hindered: { PRS: x } }),
  Dying: (x) => ({ start: [{ type: 'Somatic', amount: 2 * x }] }),
  Exhausted: (x) => ({ hindered: { VIG: x, AGI: x, PER: x, INT: x, PRS: x }, against: 1, movement: -x }),
  Freezing: (x) => ({ implied: { Sluggish: x, Slowed: 2 * x }, hindered: { AGI: x }, movement: -2 * x, end: -1 }),
  Immobilized: () => ({ weakenedSave: ['AGI'], movement: 'zero' }),
  Morphing: (x) => ({ implied: { Dulled: 1, Muddled: 1 }, hindered: { PRS: 1, INT: 1 }, start: [{ type: 'Cosmic', amount: 3 * x }] }),
  Muddled: (x) => ({ hindered: { INT: x } }),
  Numbed: (x) => ({ hindered: { PER: x } }),
  Pacified: () => ({ otherChecks: 1 }),
  Panicked: (x) => ({ implied: { Muddled: x, Numbed: x }, hindered: { INT: x, PER: x } }),
  Paralyzed: () => ({
    implied: restrainedChain,
    autofail: ['AGI', 'PER'],
    disadvantage: ['AGI'],
    autofailSave: ['AGI'],
    weakenedSave: ['AGI'],
    movement: 'zero',
    against: 2,
    otherChecks: 1,
    noApRegain: true,
  }),
  Poisoned: (x) => ({ implied: Math.floor(x / 2) > 0 ? { Sickened: Math.floor(x / 2) } : {}, hindered: Math.floor(x / 2) > 0 ? { VIG: Math.floor(x / 2) } : {}, start: [{ type: 'Somatic', amount: x }] }),
  Possessed: (x) => ({ start: [{ type: 'Chthonic', amount: 2 * x }] }),
  Prone: () => ({ against: 1 }),
  Restrained: () => ({ implied: { Seized: 1, Immobilized: 1 }, disadvantage: ['AGI'], autofailSave: ['AGI'], weakenedSave: ['AGI'], movement: 'zero', against: 2, otherChecks: 1 }),
  Seized: () => ({ implied: { Immobilized: 1 }, weakenedSave: ['AGI'], movement: 'zero', against: 1, otherChecks: 1 }),
  Sickened: (x) => ({ hindered: { VIG: x } }),
  Slowed: (x) => ({ movement: -x }),
  Sluggish: (x) => ({ hindered: { AGI: x } }),
  Stunned: () => ({}),
  Unconscious: () => ({ autofail: ['AGI', 'PER'], weakened: ['VIG', 'INT', 'PRS'], against: 1 }),
};

const condCases = conditionDefs.flatMap((cd) => (cd.leveled ? [1, 2, 3] : [undefined]).map((level) => ({ name: cd.name, level, leveled: cd.leveled, label: cd.leveled ? `${cd.name} ${level}` : cd.name })));

describe('Condition list', () => {
  it('every Condition in the rules has mechanics and an expectation, and vice versa', () => {
    const names = conditionDefs.map((c) => c.name).sort();
    expect(Object.keys(CONDITION_RULES).sort()).toEqual(names);
    expect(Object.keys(EXPECTED).sort()).toEqual(names);
    expect(names).toHaveLength(28);
  });

  it.each(sample(condCases, 12))('$label: added, its effects on Checks / AC / Movement / AP', ({ name, level, leveled }) => {
    const p = addCondition(playWith(), name, level);
    expect(p.conditions).toEqual([{ name, level }]);
    const x = level ?? 1;
    const exp = EXPECTED[name](x);
    const fx = conditionEffects(p);
    expect(badNumbers(fx)).toEqual([]);

    // Active: itself plus the implied Conditions at their levels.
    const active = Object.fromEntries(activeConditions(p).map((a) => [a.name, a.level]));
    expect(active).toEqual({ [name]: x, ...exp.implied });
    for (const a of activeConditions(p)) expect(a.own).toBe(a.name === name);

    for (const a of ATTRS) {
      expect(hinderedOf(fx, a), `${a} hindered`).toBe(exp.hindered?.[a] ?? 0);
      const r = rowOf(fx, a);
      const s = rowOf(fx, a, true);
      expect(!!r?.weakened.length, `${a} weakened`).toBe(!!exp.weakened?.includes(a));
      expect(!!s?.weakened.length, `${a} save weakened`).toBe(!!exp.weakenedSave?.includes(a));
      expect(!!r?.disadvantage.length, `${a} disadvantage`).toBe(!!exp.disadvantage?.includes(a));
      expect(!!r?.autofail.length, `${a} autofail`).toBe(!!exp.autofail?.includes(a));
      expect(!!s?.autofail.length, `${a} save autofail`).toBe(!!exp.autofailSave?.includes(a));
      if (r) expect(describeCheck(r).length).toBeGreaterThan(0);
    }
    expect(fx.against).toHaveLength(exp.against ?? 0);
    expect(fx.otherChecks).toHaveLength(exp.otherChecks ?? 0);
    expect(fx.acChange.value).toBe(exp.ac ?? 0);
    if (exp.movement === 'zero') expect(fx.movementChange.zero).toBe(true);
    else {
      expect(fx.movementChange.zero).toBe(false);
      expect(fx.movementChange.value).toBe(exp.movement ?? 0);
    }
    expect(fx.noApRegain).toBe(!!exp.noApRegain);
    // Labels show levels only for leveled Conditions.
    if (!exp.implied) for (const f of [...fx.against, ...fx.otherChecks]) expect(f).toContain(leveled ? `(${name} ${x})` : `(${name})`);
  });

  it.each(sample(condCases, 12))('$label: start-of-turn damage and end-of-turn level change', ({ name, level }) => {
    const x = level ?? 1;
    const exp = EXPECTED[name](x);
    const p = addCondition(playWith(), name, level);
    const s = startTurn(p, CHAR_LEVEL, []);
    expect(s.damage.map(({ type, amount }) => ({ type, amount }))).toEqual(exp.start ?? []);
    expect(s.log.length).toBeGreaterThan(0);
    expect(badNumbers(s.play)).toEqual([]);
    const e = endTurn(s.play);
    const after = e.play.conditions.find((c) => c.name === name);
    if (exp.end) {
      if (x + exp.end > 0) expect(after?.level).toBe(x + exp.end);
      else expect(after).toBeUndefined();
    } else if (name === 'Buffeted') expect(after).toBeUndefined(); // ends at the start of your turn
    else if (name === 'Paralyzed') {
      // reduces by 1 at the start of your turn
      if (x > 1) expect(after?.level).toBe(x - 1);
      else expect(after).toBeUndefined();
    } else expect(after).toEqual({ name, level });
  });

  it.each(sample(condCases, 10))('$label: Immunity to it makes it inert', ({ name, level }) => {
    const p = addCondition(playWith(), name, level);
    const fx = conditionEffects(p, [], [name]);
    expect(fx.active.find((a) => a.name === name)).toBeUndefined();
    // Its implied Conditions come from it, so they're gone too.
    expect(fx.active).toEqual([]);
    expect(fx.checks).toEqual([]);
    expect(fx.acChange.value).toBe(0);
    expect(fx.movementChange).toEqual({ value: 0, zero: false, from: [] });
    expect(fx.noApRegain).toBe(false);
    const s = startTurn({ ...p, dying: 0 }, CHAR_LEVEL, [], { immune: [], vulnerable: [], immuneConditions: [name] });
    expect(s.damage).toEqual([]);
  });
});

describe('Condition levels never add: the higher level is kept', () => {
  it.each([
    [3, 1, 3],
    [1, 3, 3],
    [2, 2, 2],
  ])('Burning %i then Burning %i → Burning %i', (a, b, want) => {
    const p = addCondition(addCondition(playWith(), 'Burning', a), 'Burning', b);
    expect(p.conditions).toEqual([{ name: 'Burning', level: want }]);
  });

  it('the same implied Condition from two sources takes the higher level (Burning 2 + Panicked 3 → Numbed 3)', () => {
    const p = playWith([
      { name: 'Burning', level: 2 },
      { name: 'Panicked', level: 3 },
    ]);
    const numbed = activeConditions(p).find((a) => a.name === 'Numbed')!;
    expect(numbed.level).toBe(3);
    expect(numbed.from.sort()).toEqual(['Burning', 'Panicked']);
    expect(hinderedOf(conditionEffects(p), 'PER')).toBe(3);
  });

  it('an own Condition and the same Condition implied take the higher level (Numbed 1 + Burning 3 → Numbed 3)', () => {
    for (const conds of [
      [{ name: 'Numbed', level: 1 }, { name: 'Burning', level: 3 }],
      [{ name: 'Burning', level: 3 }, { name: 'Numbed', level: 1 }],
    ]) {
      const fx = conditionEffects(playWith(conds));
      expect(fx.active.filter((a) => a.name === 'Numbed')).toHaveLength(1);
      expect(hinderedOf(fx, 'PER')).toBe(3);
    }
  });

  it('own Numbed 4 beats Burning 2’s Numbed 2', () => {
    const fx = conditionEffects(playWith([{ name: 'Burning', level: 2 }, { name: 'Numbed', level: 4 }]));
    expect(hinderedOf(fx, 'PER')).toBe(4);
  });

  // activeConditions' contract: `own` is "true when it's in your condition list (not only implied)";
  // the sheet lists `!own` Conditions again as "implied", so this one appears twice.
  it('an own Condition listed after a higher implied copy is still marked as own', () => {
    const p = playWith([{ name: 'Burning', level: 3 }, { name: 'Numbed', level: 1 }]);
    expect(activeConditions(p).find((a) => a.name === 'Numbed')!.own).toBe(true);
  });

  it('Morphing’s Dulled/Muddled are fixed at 1 whatever its level', () => {
    const fx = conditionEffects(playWith([{ name: 'Morphing', level: 5 }]));
    expect(hinderedOf(fx, 'PRS')).toBe(1);
    expect(hinderedOf(fx, 'INT')).toBe(1);
  });

  it('Exhausted stacks with Slowed for Movement (rules: “this stacks with the Slowed Condition”)', () => {
    const fx = conditionEffects(playWith([{ name: 'Exhausted', level: 2 }, { name: 'Slowed', level: 3 }]));
    expect(fx.movementChange.value).toBe(-5);
  });

  it('Bolstered and Hindered from items/effects are combined in the Check row', () => {
    const fx = conditionEffects(playWith([{ name: 'Dulled', level: 2 }]), [{ name: 'Charm', attrs: ['PRS'], amount: 3 }]);
    const r = rowOf(fx, 'PRS')!;
    expect(r.bolstered).toBe(3);
    expect(r.hindered).toBe(2);
    expect(describeCheck(r)[0]).toMatch(/Bolstered 1$/);
  });

  it('a Hindered-only and a Bolstered-only row describe themselves', () => {
    expect(describeCheck(rowOf(conditionEffects(playWith([{ name: 'Dulled', level: 2 }])), 'PRS')!)).toEqual(['Hindered 2 (Dulled 2)']);
    const fx = conditionEffects(playWith(), [{ name: 'Ring', attrs: ['VIG'], save: true, amount: 1 }]);
    expect(describeCheck(rowOf(fx, 'VIG', true)!)).toEqual(['Bolstered 1 (Ring)']);
  });
});

describe('Immunity, Resistance and Vulnerability against Condition damage', () => {
  const damaging = Object.entries(EXPECTED)
    .filter(([, f]) => f(1).start)
    .map(([name]) => name);

  it.each(damaging)('%s 3: Resistance reduces it, Immunity prevents it, Vulnerability is reminded', (name) => {
    const exp = EXPECTED[name](3).start![0];
    const p = playWith([{ name, level: 3 }]);
    const res = startTurn(p, CHAR_LEVEL, [{ type: exp.type, value: 2 }]);
    expect(res.damage[0].amount).toBe(exp.amount - 2);
    expect(res.log.join(' ')).toContain('Resistance 2');
    const big = startTurn(p, CHAR_LEVEL, [{ type: exp.type, value: 100 }]);
    expect(big.damage[0].amount).toBe(name === 'Dying' ? 1 : 0);
    const imm = startTurn(p, CHAR_LEVEL, [], { immune: [exp.type], vulnerable: [] });
    expect(imm.damage).toEqual([]);
    expect(imm.log.join(' ')).toMatch(/Immune/);
    const vul = startTurn(p, CHAR_LEVEL, [], { immune: [], vulnerable: [{ type: exp.type, dice: '1d6' }] });
    expect(vul.damage[0].amount).toBe(exp.amount);
    expect(vul.log.join(' ')).toContain('Vulnerability 1d6');
  });

  it('Resistance to another type does nothing', () => {
    const r = startTurn(playWith([{ name: 'Burning', level: 2 }]), CHAR_LEVEL, [{ type: 'Arctic', value: 5 }]);
    expect(r.damage).toEqual([{ type: 'Thermic', amount: 6, source: 'Burning 2' }]);
  });

  it('Dying: Somatic Resistance can’t reduce it below 1; no damage at 0 Endurance', () => {
    expect(startTurn(playWith([], { dying: 2 }), CHAR_LEVEL, [{ type: 'Somatic', value: 3 }]).damage[0].amount).toBe(1);
    expect(startTurn(playWith([], { dying: 2 }), CHAR_LEVEL, [{ type: 'Somatic', value: 1 }]).damage[0].amount).toBe(3);
    expect(startTurn(playWith([], { dying: 2, endurance: 0 }), CHAR_LEVEL, []).damage).toEqual([]);
  });

  it('Dying comes from the play state’s Dying level', () => {
    const a = activeConditions(playWith([], { dying: 2 }));
    expect(a).toEqual([{ name: 'Dying', level: 2, from: [], own: true }]);
  });

  it.each(Object.entries(CONDITION_DAMAGE_TYPE))('Immunity to %s’s damage type (%s) prevents it (derived from a homebrew Immunity)', (cond, type) => {
    const c = makeCharacter({ homebrew: [homebrewEffect('Ward', [row('r', { kind: 'immunity', damage: type })])], play: { conditions: [{ name: cond, level: 2 }] } });
    const d = derive(c);
    expect(d.conditionImmunities.map((x) => x.name)).toContain(cond);
    expect(d.conditionFx.active.find((x) => x.name === cond)).toBeUndefined();
  });

  it('Damage Immunities in the rules text map to the right Conditions', () => {
    expect(CONDITION_DAMAGE_TYPE).toEqual({ Bleeding: 'Slashing', Bruised: 'Crushing', Burning: 'Thermic', Dissolving: 'Caustic', Freezing: 'Arctic', Poisoned: 'Somatic' });
  });

  it('Burning’s Thermic damage reduces Freezing by 1 (Freezing: “reduces by 1 each time you take Thermic damage”)', () => {
    const r = startTurn(playWith([{ name: 'Burning', level: 1 }, { name: 'Freezing', level: 3 }]), CHAR_LEVEL, []);
    expect(r.play.conditions.find((c) => c.name === 'Freezing')?.level).toBe(2);
  });

  it('Freezing is not reduced when the Thermic damage is prevented by Immunity', () => {
    const r = startTurn(playWith([{ name: 'Burning', level: 1 }, { name: 'Freezing', level: 3 }]), CHAR_LEVEL, [], { immune: ['Thermic'], vulnerable: [] });
    expect(r.play.conditions.find((c) => c.name === 'Freezing')?.level).toBe(3);
  });

  it('Morphing’s own Cosmic damage does not reduce it (only Sonic does)', () => {
    const r = startTurn(playWith([{ name: 'Morphing', level: 3 }]), CHAR_LEVEL, []);
    expect(r.play.conditions).toEqual([{ name: 'Morphing', level: 3 }]);
  });

  it('several damaging Conditions each deal their damage', () => {
    const r = startTurn(playWith([{ name: 'Bleeding', level: 1 }, { name: 'Poisoned', level: 2 }, { name: 'Dissolving', level: 1 }]), CHAR_LEVEL, []);
    expect(r.damage.map((x) => [x.type, x.amount])).toEqual([
      ['Somatic', 2],
      ['Somatic', 2],
      ['Caustic', 2],
    ]);
  });
});

// ---------------------------------------------------------------- turn flow

describe('Turn flow', () => {
  it(`AP Maximum is 5 and you regain it at the end of your turn`, () => {
    expect(AP_MAX).toBe(5);
    const e = endTurn(playWith([], { ap: 1, tempAp: 3, turn: { active: true } }));
    expect(e.play.ap).toBe(5);
    expect(e.play.tempAp).toBe(0);
    expect(e.play.turn).toEqual({ active: false });
    expect(e.log.join(' ')).toMatch(/Temporary AP lost/);
  });

  it('start of turn does not touch AP and marks the turn active', () => {
    const s = startTurn(playWith([], { ap: 2, tempAp: 1 }), CHAR_LEVEL, []);
    expect(s.play.ap).toBe(2);
    expect(s.play.tempAp).toBe(1);
    expect(s.play.turn).toEqual({ active: true, noApRegain: false });
    expect(s.log).toEqual(['Your turn begins.']);
  });

  it('Paralyzed: gaining it loses all AP (and temporary AP)', () => {
    const p = addCondition(playWith([], { ap: 4, tempAp: 2 }), 'Paralyzed', 2);
    expect(p.ap).toBe(0);
    expect(p.tempAp).toBe(0);
  });

  it('Paralyzed 2: each turn it reduces by 1 at the start and you don’t regain AP; once gone, AP returns', () => {
    let p = addCondition(playWith(), 'Paralyzed', 2);
    let s = startTurn(p, CHAR_LEVEL, []);
    expect(s.play.conditions).toEqual([{ name: 'Paralyzed', level: 1 }]);
    expect(s.play.turn?.noApRegain).toBe(true);
    p = endTurn(s.play).play;
    expect(p.ap).toBe(0);
    s = startTurn(p, CHAR_LEVEL, []);
    expect(s.play.conditions).toEqual([]);
    p = endTurn(s.play).play;
    expect(p.ap).toBe(0); // "When you start your turn, ... you don't regain any AP"
    p = endTurn(startTurn(p, CHAR_LEVEL, []).play).play;
    expect(p.ap).toBe(5);
  });

  it('Paralyzed blocks AP regain at end of turn even without a start of turn', () => {
    const e = endTurn(playWith([{ name: 'Paralyzed', level: 1 }], { ap: 0 }));
    expect(e.play.ap).toBe(0);
    expect(e.log.join(' ')).toMatch(/don’t regain AP/);
  });

  // Rules (Damage → Immunity): "If you would gain a Condition you are immune to, you instead don't".
  it('Immunity to Paralyzed: your turn doesn’t end and AP isn’t blocked', () => {
    const p = playWith([{ name: 'Paralyzed', level: 2 }], { ap: 0 });
    const s = startTurn(p, CHAR_LEVEL, [], { immune: [], vulnerable: [], immuneConditions: ['Paralyzed'] });
    expect(s.play.turn?.noApRegain).toBe(false);
  });

  it('Buffeted ends at the start of your turn', () => {
    const s = startTurn(playWith([{ name: 'Buffeted', level: 3 }]), CHAR_LEVEL, []);
    expect(s.play.conditions).toEqual([]);
    expect(s.log).toContain('Buffeted ended.');
  });

  it('Prismaburned reduces by 1 at the start of your turn, down to 0', () => {
    let p = playWith([], { trackers: { Prismaburn: 2 } });
    p = startTurn(p, CHAR_LEVEL, []).play;
    expect(p.trackers.Prismaburn).toBe(1);
    p = startTurn(p, CHAR_LEVEL, []).play;
    expect(p.trackers.Prismaburn).toBe(0);
    p = startTurn(p, CHAR_LEVEL, []).play;
    expect(p.trackers.Prismaburn).toBe(0);
  });

  it('Indebted: reminder to roll the Miracle Die, level unchanged by the app', () => {
    const s = startTurn(playWith([], { trackers: { Indebted: 4 } }), CHAR_LEVEL, []);
    expect(s.log.join(' ')).toMatch(/Indebted 4: roll your Miracle Die; if it's higher than 4/);
    expect(s.play.trackers.Indebted).toBe(4);
  });

  it.each([
    ['Panicked', 2, /PRS Save \(DC 12\)/, 'start'],
    ['Stunned', 3, /INT Save Check \(DC 13\)/, 'start'],
    ['Morphing', 1, /INT Save Check \(DC 11\)/, 'end'],
    ['Possessed', 4, /PRS Save Check \(DC 14\)/, 'end'],
  ] as const)('%s %i: Save reminder (DC 10 + X) at the %s of the turn', (name, level, re, when) => {
    const p = playWith([{ name, level }]);
    const log = when === 'start' ? startTurn(p, CHAR_LEVEL, []).log : endTurn(p).log;
    expect(log.join(' ')).toMatch(re);
  });

  it('Unconscious: a reminder that the damage ends it', () => {
    const s = startTurn(playWith([{ name: 'Unconscious' }, { name: 'Bleeding', level: 1 }]), CHAR_LEVEL, []);
    expect(s.log.join(' ')).toMatch(/ends Unconscious/);
  });

  it('active effects ending at start / end of turn, temporary AP and Endurance each turn, resource each turn', () => {
    const p = playWith([], {
      tempEndurance: 3,
      resources: { Stamina: 3 },
      effects: [
        { id: '1', name: 'Shield', ends: 'startOfTurn', ac: 2 },
        { id: '2', name: 'Feint 1', ends: 'endOfTurn' },
        { id: '3', name: 'Embolden 2', ends: 'manual', tempApEachTurn: 2 },
        { id: '4', name: 'Invigorate 3', ends: 'manual', tempEnduranceEachTurn: 6 },
        { id: '5', name: 'Titanus Form', ends: 'manual', resourceEachTurn: { name: 'Stamina', amount: 2 } },
      ],
    });
    const s = startTurn(p, CHAR_LEVEL, []);
    expect(s.play.effects!.map((e) => e.name)).toEqual(['Feint 1', 'Embolden 2', 'Invigorate 3', 'Titanus Form']);
    expect(s.play.tempEndurance).toBe(6);
    const e = endTurn({ ...s.play, tempAp: 1 });
    expect(e.play.effects!.map((x) => x.name)).toEqual(['Embolden 2', 'Invigorate 3', 'Titanus Form']);
    expect(e.play.tempAp).toBe(2);
    expect(e.play.resources.Stamina).toBe(1);
  });

  it('Temporary Endurance each turn never lowers a higher current amount', () => {
    const p = playWith([], { tempEndurance: 10, effects: [{ id: '4', name: 'Invigorate 1', ends: 'manual', tempEnduranceEachTurn: 2 }] });
    expect(startTurn(p, CHAR_LEVEL, []).play.tempEndurance).toBe(10);
  });

  it('start and end of turn clear Basic CAP counts', () => {
    const p = playWith([], { turn: { active: true, uses: { x: 3 } } });
    expect(startTurn(p, CHAR_LEVEL, []).play.turn?.uses).toBeUndefined();
    expect(endTurn(p).play.turn?.uses).toBeUndefined();
  });

  it('Dying: full start-of-turn flow with the sheet applying the damage', () => {
    const { c, d } = setup('berserker', { dying: 1, vitality: 2, endurance: 10 });
    const s = startTurn(c.play, d.level, d.resistances);
    let p = s.play;
    for (const dmg of s.damage) p = takeDamage(p, dmg.amount, d);
    expect(p.endurance).toBe(8);
    expect(p.vitality).toBe(2);
  });
});

// ---------------------------------------------------------------- damage & healing

describe('Damage and healing (Endurance and Vitality)', () => {
  const { d } = setup('berserker');
  const base = (o: Partial<PlayState>) => ({ ...freshPlay(hero('berserker'), d), ...o });

  it('Temporary Endurance absorbs damage first', () => {
    const p = takeDamage(base({ endurance: 20, tempEndurance: 5 }), 8, d);
    expect([p.tempEndurance, p.endurance]).toEqual([0, 17]);
    const q = takeDamage(base({ endurance: 20, tempEndurance: 10 }), 8, d);
    expect([q.tempEndurance, q.endurance]).toEqual([2, 20]);
  });

  it('damage reduces Endurance to 0 but no further, and doesn’t cost Vitality on the way down', () => {
    const p = takeDamage(base({ endurance: 5 }), 50, d);
    expect([p.endurance, p.vitality, p.dying]).toEqual([0, d.vitalityMax, 0]);
    const q = takeDamage(base({ endurance: 5 }), 5, d);
    expect([q.endurance, q.vitality]).toEqual([0, d.vitalityMax]);
  });

  it('any damage at 0 Endurance costs exactly 1 Vitality, and Dying becomes the Vitality missing', () => {
    let p = base({ endurance: 0 });
    p = takeDamage(p, 1, d);
    expect([p.vitality, p.dying]).toEqual([d.vitalityMax - 1, 1]);
    p = takeDamage(p, 999, d);
    expect([p.vitality, p.dying]).toEqual([d.vitalityMax - 2, 2]);
  });

  it('Vitality never drops below 0', () => {
    let p = base({ endurance: 0, vitality: 1 });
    for (let i = 0; i < 5; i++) p = takeDamage(p, 3, d);
    expect(p.vitality).toBe(0);
    expect(p.dying).toBe(d.vitalityMax);
  });

  it('Temporary Endurance at 0 Endurance can soak the hit (no Vitality lost)', () => {
    const p = takeDamage(base({ endurance: 0, tempEndurance: 5 }), 5, d);
    expect([p.tempEndurance, p.vitality]).toEqual([0, d.vitalityMax]);
    const q = takeDamage(base({ endurance: 0, tempEndurance: 5 }), 6, d);
    expect([q.tempEndurance, q.vitality]).toEqual([0, d.vitalityMax - 1]);
  });

  it.each([0, -5])('damage of %i does nothing', (n) => {
    const p = base({ endurance: 3 });
    expect(takeDamage(p, n, d)).toBe(p);
  });

  it('heal caps at the Endurance Maximum and leaves Vitality and Dying alone', () => {
    const p = heal(base({ endurance: 1, dying: 1, vitality: 2 }), 9999, d);
    expect(p.endurance).toBe(d.enduranceMax);
    expect([p.vitality, p.dying]).toEqual([2, 1]);
    expect(heal(base({ endurance: 4 }), 3, d).endurance).toBe(7);
  });

  // Rules (Unconscious): "This Condition ends if you take damage, unless a specific effect is keeping you Unconscious."
  it('taking damage ends Unconscious', () => {
    const p = takeDamage(base({ endurance: 10, conditions: [{ name: 'Unconscious' }] }), 3, d);
    expect(p.conditions.find((c) => c.name === 'Unconscious')).toBeUndefined();
  });

  // Rules (Burning X / Dissolving X): "take 3X Thermic damage when you gain this Condition and at the start of your turn".
  it('gaining Burning deals its 3X Thermic damage straight away', () => {
    const p = addCondition(base({ endurance: 20 }), 'Burning', 2);
    expect(p.endurance).toBe(14);
  });

  it('freshPlay: everything full, nothing spent', () => {
    const c = hero('arcanist', { play: { ...makeCharacter().play, prepared: { x: ['y'] }, endurance: 1, conditions: [{ name: 'Prone' }] } });
    const dd = derive(c);
    const p = freshPlay(c, dd);
    expect(p).toMatchObject({ initialized: true, endurance: dd.enduranceMax, tempEndurance: 0, vitality: dd.vitalityMax, radianceSpent: 0, restChargesSpent: 0, resources: {}, trackers: {}, facetUses: {}, conditions: [], dying: 0, shortRests: 0, prepared: { x: ['y'] } });
  });

  it('clampPlay keeps values within their maximums', () => {
    const dd = setup('arcanist').d;
    const p = clampPlay({ ...makeCharacter().play, endurance: 999, vitality: -3, radianceSpent: 99, restChargesSpent: 99, resources: { Prisma: 99 } }, dd);
    expect(p.endurance).toBe(dd.enduranceMax);
    expect(p.vitality).toBe(0);
    expect(p.radianceSpent).toBe(dd.radianceMax);
    expect(p.restChargesSpent).toBe(dd.restCharges);
    expect(p.resources.Prisma).toBe(dd.resources.find((r) => r.name === 'Prisma')!.max);
    expect(clampPlay({ ...p, resources: { Prisma: -2 } }, dd).resources.Prisma).toBe(0);
  });
});

// ---------------------------------------------------------------- rests

describe('Short Rest', () => {
  it('Heroic: regain Vitality equal to half VIG points (rounded up); Dying removed', () => {
    for (const [vig, gain] of [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 2],
    ] as const) {
      const { c, d } = setup('berserker', {}, { VIG: vig });
      const r = shortRest({ ...c, play: { ...c.play, vitality: 1, dying: d.vitalityMax - 1 } }, d, { spendRestCharge: false });
      expect(r.play.vitality, `VIG ${vig}`).toBe(1 + gain);
      expect(r.play.dying).toBe(gain ? 0 : d.vitalityMax - 1);
    }
  });

  it('Heroic: Vitality regain is capped at the maximum', () => {
    const { c, d } = setup('berserker', {}, { VIG: 3 });
    const r = shortRest({ ...c, play: { ...c.play, vitality: d.vitalityMax - 1 } }, d, { spendRestCharge: false });
    expect(r.play.vitality).toBe(d.vitalityMax);
  });

  it('Gritty: no Vitality on a Short Rest', () => {
    const { c, d } = setup('berserker', {}, { VIG: 3 }, { settings: { restRules: 'gritty' } });
    const r = shortRest({ ...c, play: { ...c.play, vitality: 1 } }, d, { spendRestCharge: false });
    expect(r.play.vitality).toBe(1);
  });

  it('homebrew noVitalityShortRest removes the Vitality', () => {
    const { c, d } = setup('berserker', { vitality: 1 }, { VIG: 3 }, { homebrew: [homebrewEffect('Curse', [row('r', { kind: 'restRule', rule: 'noVitalityShortRest' })])] });
    expect(shortRest(c, d, { spendRestCharge: false }).play.vitality).toBe(1);
  });

  it('a Rest Charge restores half the Endurance Maximum (rounded up), capped; charges = maximum Vitality', () => {
    const { c, d } = setup('arcanist', { endurance: 0 });
    expect(d.restCharges).toBe(d.vitalityMax);
    const r = shortRest(c, d, { spendRestCharge: true });
    expect(r.play.endurance).toBe(Math.ceil(d.enduranceMax / 2));
    expect(r.play.restChargesSpent).toBe(1);
    const full = shortRest({ ...c, play: { ...c.play, endurance: d.enduranceMax - 1 } }, d, { spendRestCharge: true });
    expect(full.play.endurance).toBe(d.enduranceMax);
  });

  it('no Rest Charge spent when none are left or when not asked', () => {
    const { c, d } = setup('arcanist', { endurance: 0 });
    expect(shortRest({ ...c, play: { ...c.play, restChargesSpent: d.restCharges } }, d, { spendRestCharge: true }).play.endurance).toBe(0);
    expect(shortRest(c, d, { spendRestCharge: false }).play.restChargesSpent).toBe(0);
  });

  it('homebrew noRestCharges blocks spending them', () => {
    const { c, d } = setup('arcanist', { endurance: 0 }, {}, { homebrew: [homebrewEffect('Curse', [row('r', { kind: 'restRule', rule: 'noRestCharges' })])] });
    const r = shortRest(c, d, { spendRestCharge: true });
    expect(r.play.endurance).toBe(0);
    expect(r.log.join(' ')).toMatch(/can’t spend Rest Charges/);
  });

  it.each([
    ['berserker', 'Stamina'],
    ['champion', 'Will'],
    ['troubadour', 'Wonder'],
    ['gladiator', 'Stamina'],
  ])('%s: %s (regained when you finish a Rest) is fully restored', (cls, res) => {
    const { c, d } = setup(cls, { resources: { [res]: 2 } });
    expect(shortRest(c, d, { spendRestCharge: false }).play.resources[res]).toBe(0);
  });

  it.each([
    ['arcanist', 'Prisma'],
    ['thaumaturge', 'Favor'],
    ['luminary', 'Light'],
  ])('%s: %s applied to the Limit is reduced by the Class Bonus', (cls, res) => {
    const { c, d } = setup(cls, { resources: { [res]: 3 } });
    expect(shortRest(c, d, { spendRestCharge: false }).play.resources[res]).toBe(Math.max(0, 3 - d.classBonus));
    expect(shortRest({ ...c, play: { ...c.play, resources: { [res]: 1 } } }, d, { spendRestCharge: false }).play.resources[res]).toBe(0);
  });

  it('facets used per Rest refresh; per Long Rest don’t', () => {
    const champ = setup('champion', { facetUses: { 'classes/champion/undaunted': 1 } });
    expect(shortRest(champ.c, champ.d, { spendRestCharge: false }).play.facetUses['classes/champion/undaunted']).toBe(0);
    const inc = setup('incarnate', { facetUses: { 'classes/incarnate/titanus-form': 1 } });
    expect(shortRest(inc.c, inc.d, { spendRestCharge: false }).play.facetUses['classes/incarnate/titanus-form']).toBe(1);
  });

  it('activation uses: Inspire (per Rest) resets, Reignite (per Long Rest) regains one', () => {
    const insp = activationUseKey(act('Inspire'));
    const reig = activationUseKey(act('Reignite'));
    const t = setup('troubadour', { facetUses: { [insp]: 3 } });
    expect(shortRest(t.c, t.d, { spendRestCharge: false }).play.facetUses[insp]).toBe(0);
    const g = setup('gladiator', { facetUses: { [reig]: 2 } });
    const r = shortRest(g.c, g.d, { spendRestCharge: false });
    expect(r.play.facetUses[reig]).toBe(1);
    expect(r.log.join(' ')).toMatch(/Reignite: regained 1 use/);
  });

  it('homebrew pools refreshing on a Rest restore; Long Rest pools don’t', () => {
    const entry: HomebrewEntry = { id: 'orb', kind: 'item', name: 'Orb', rows: [], pools: [{ id: 'a', name: 'Charges', max: 3, refresh: 'Rest' }, { id: 'b', name: 'Big', max: 1, refresh: 'Long Rest' }] };
    const { c, d } = setup('berserker', { facetUses: { 'hb:orb:a': 2, 'hb:orb:b': 1 } }, {}, { homebrew: [entry] });
    const r = shortRest(c, d, { spendRestCharge: false });
    expect(r.play.facetUses['hb:orb:a']).toBe(0);
    expect(r.play.facetUses['hb:orb:b']).toBe(1);
    expect(longRest(c, d).play.facetUses['hb:orb:b'] ?? 0).toBe(0);
  });

  it('active effects in minutes end; effects lasting to a Long Rest stay', () => {
    const { c, d } = setup('berserker', { effects: [{ id: '1', name: 'Rage 1', ends: 'manual' }, { id: '2', name: 'Blessing', ends: 'longRest' }] });
    expect(shortRest(c, d, { spendRestCharge: false }).play.effects!.map((e) => e.name)).toEqual(['Blessing']);
  });

  it('human (Radiant) regains 1 Radiance; Luminary regains half its Class Bonus', () => {
    const h = setup('berserker', { radianceSpent: 2 }, {}, { ancestry: 'human' });
    expect(shortRest(h.c, h.d, { spendRestCharge: false }).play.radianceSpent).toBe(1);
    const l = setup('luminary', { radianceSpent: 2 });
    expect(shortRest(l.c, l.d, { spendRestCharge: false }).play.radianceSpent).toBe(2 - Math.ceil(l.d.classBonus / 2));
  });

  it('homebrew effects ending on a Rest end; Long Rest / manual effects and facets persist', () => {
    const hb: HomebrewEntry[] = [
      homebrewEffect('Rest Boon', [], { ends: 'rest' }),
      homebrewEffect('Long Boon', [], { ends: 'longRest' }),
      homebrewEffect('Curse', [], { ends: 'manual' }),
      { id: 'f', kind: 'facet', name: 'Gift', rows: [] },
    ];
    const { c, d } = setup('berserker', {}, {}, { homebrew: hb });
    const r = shortRest(c, d, { spendRestCharge: false });
    expect(r.homebrew.map((e) => e.name)).toEqual(['Long Boon', 'Curse', 'Gift']);
    expect(r.log).toContain('Rest Boon ended.');
    expect(longRest(c, d).homebrew.map((e) => e.name)).toEqual(['Curse', 'Gift']);
  });

  it('counts Short Rests and warns after two', () => {
    const { c, d } = setup('berserker', { shortRests: 2 });
    const r = shortRest(c, d, { spendRestCharge: false });
    expect(r.play.shortRests).toBe(3);
    expect(r.log[0]).toMatch(/only two Short Rests/);
  });

  // Rules (Short Rests): "A PC can only benefit from two Short Rests per Long Rest".
  it('a third Short Rest before a Long Rest restores nothing', () => {
    const { c, d } = setup('berserker', { shortRests: 2, vitality: 1, endurance: 0, resources: { Stamina: 3 } }, { VIG: 3 });
    const r = shortRest(c, d, { spendRestCharge: true });
    expect(r.play.vitality).toBe(1);
    expect(r.play.endurance).toBe(0);
    expect(r.play.resources.Stamina).toBe(3);
  });

  // Rules (Bruised): "Your VIG and AGI Checks are Weakened until you finish a Rest."
  it('Bruised ends when you finish a Short Rest', () => {
    const { c, d } = setup('berserker', { conditions: [{ name: 'Bruised' }] });
    expect(shortRest(c, d, { spendRestCharge: false }).play.conditions).toEqual([]);
  });

  it('Bruised ends when you finish a Long Rest', () => {
    const { c, d } = setup('berserker', { conditions: [{ name: 'Bruised' }] });
    expect(longRest(c, d).play.conditions).toEqual([]);
  });

  it('a Short Rest with nothing to restore says so', () => {
    const { c, d } = setup('expert');
    expect(shortRest(c, d, { spendRestCharge: false }).log).toEqual(['Rested. Nothing to restore.']);
  });
});

describe('Long Rest', () => {
  it('restores all Endurance, Rest Charges, resources and facet uses; resets Short Rests; ends active effects', () => {
    const { c, d } = setup('arcanist', {
      endurance: 1,
      restChargesSpent: 2,
      resources: { Prisma: 3 },
      facetUses: { 'classes/arcanist/prismatic-realignment': 1, [activationUseKey(act('Reignite'))]: 2 },
      shortRests: 2,
      effects: [{ id: '1', name: 'Blessing', ends: 'longRest' }],
    });
    const r = longRest(c, d);
    expect(r.play).toMatchObject({ endurance: d.enduranceMax, restChargesSpent: 0, resources: {}, facetUses: {}, shortRests: 0, effects: [] });
    expectSanePlay(r.play, d);
  });

  it('Temporary Endurance = VIG points × Class Bonus (kept if already higher)', () => {
    const { c, d } = setup('berserker', { tempEndurance: 0 }, { VIG: 3 });
    expect(d.longRestTempEndurance).toBe(3 * d.classBonus);
    expect(longRest(c, d).play.tempEndurance).toBe(3 * d.classBonus);
    expect(longRest({ ...c, play: { ...c.play, tempEndurance: 50 } }, d).play.tempEndurance).toBe(50);
  });

  it.each([
    ['heroic', 0, 1],
    ['heroic', 3, 3],
    ['heroic', 4, 3],
    ['gritty', 0, 1],
    ['gritty', 1, 1],
    ['gritty', 3, 2],
    ['gritty', 4, 2],
  ] as const)('%s, VIG %i: regain %i Vitality (Heroic 1 + half VIG; Gritty max(1, half VIG))', (rules, vig, gain) => {
    const { c, d } = setup('berserker', {}, { VIG: vig }, { settings: { restRules: rules } });
    const r = longRest({ ...c, play: { ...c.play, vitality: 0, dying: d.vitalityMax } }, d);
    expect(r.play.vitality).toBe(gain);
    expect(r.play.dying).toBe(0);
  });

  it('Radiance: regain half PRS points (+1 human, +half Class Bonus Luminary), capped at what was spent', () => {
    const a = setup('berserker', { radianceSpent: 3 }, { PRS: 3 });
    expect(longRest(a.c, a.d).play.radianceSpent).toBe(3 - 2);
    const h = setup('berserker', { radianceSpent: 3 }, { PRS: 1 }, { ancestry: 'human' });
    expect(longRest(h.c, h.d).play.radianceSpent).toBe(3 - 2);
    const l = setup('luminary', { radianceSpent: 3 }, { PRS: 0 });
    expect(longRest(l.c, l.d).play.radianceSpent).toBe(3 - Math.ceil(l.d.classBonus / 2));
    const z = setup('berserker', { radianceSpent: 1 }, { PRS: 5 });
    expect(longRest(z.c, z.d).play.radianceSpent).toBe(0);
  });

  it('Exhausted reduces by 1; other Conditions remain', () => {
    const { c, d } = setup('berserker', { conditions: [{ name: 'Exhausted', level: 2 }, { name: 'Prone' }] });
    expect(longRest(c, d).play.conditions).toEqual([{ name: 'Exhausted', level: 1 }, { name: 'Prone' }]);
    const one = setup('berserker', { conditions: [{ name: 'Exhausted', level: 1 }] });
    expect(longRest(one.c, one.d).play.conditions).toEqual([]);
  });

  it.each([
    ['noEnduranceLongRest', (p: PlayState) => p.endurance === 1],
    ['noTempEnduranceLongRest', (p: PlayState) => p.tempEndurance === 0],
    ['noVitalityLongRest', (p: PlayState) => p.vitality === 1],
    ['noRadianceLongRest', (p: PlayState) => p.radianceSpent === 1],
  ] as const)('homebrew restRule %s takes that benefit away', (rule, check) => {
    const { c, d } = setup('berserker', { endurance: 1, vitality: 1, radianceSpent: 1, tempEndurance: 0 }, { VIG: 3, PRS: 3 }, { homebrew: [homebrewEffect('Curse', [row('r', { kind: 'restRule', rule })])] });
    expect(d.restRules).toEqual([rule]);
    const r = longRest(c, d);
    expect(check(r.play)).toBe(true);
    expectSanePlay(r.play, d);
  });

  it('class trackers are untouched by rests', () => {
    const { c, d } = setup('arcanist', { trackers: { Prismaburn: 2 } });
    expect(longRest(c, d).play.trackers).toEqual({ Prismaburn: 2 });
  });
});

// ---------------------------------------------------------------- casting costs

describe('Casting costs (scaling)', () => {
  const spell = (lvl: number) => ({ kind: 'spell', level: lvl }) as unknown as Parameters<typeof castCost>[1];
  const man = (lvl: number) => ({ kind: 'maneuver', level: lvl }) as unknown as Parameters<typeof castCost>[1];

  it.each([1, 2, 3, 4, 5])('class resource equal to the level (%i) for an Arcanist / Thaumaturge / Troubadour spell', (l) => {
    expect(castCost(classById.get('arcanist'), spell(l), l, true)).toEqual({ resource: 'Prisma', amount: l });
    expect(castCost(classById.get('thaumaturge'), spell(l), l, true)).toEqual({ resource: 'Favor', amount: l });
    expect(castCost(classById.get('troubadour'), spell(l), l, true)).toEqual({ resource: 'Wonder', amount: l });
    expect(castCost(classById.get('berserker'), man(l), l, true)).toEqual({ resource: 'Stamina', amount: l });
  });

  it.each([1, 2, 3, 4, 5])('Champion maneuvers cost Will equal to half the level (%i, rounded up)', (l) => {
    expect(castCost(classById.get('champion'), man(l), l, true)).toEqual({ resource: 'Will', amount: Math.ceil(l / 2) });
  });

  it('cantrips, non-class spells, Incarnate spells (Channel) and no class cost nothing', () => {
    expect(castCost(classById.get('arcanist'), spell(0), 0, true)).toBeUndefined();
    expect(castCost(classById.get('arcanist'), spell(2), 2, false)).toBeUndefined();
    expect(castCost(classById.get('incarnate'), spell(1), 1, true)).toBeUndefined();
    expect(castCost(classById.get('incarnate'), man(1), 1, true)).toEqual({ resource: 'Stamina', amount: 1 });
    expect(castCost(undefined, spell(1), 1, true)).toBeUndefined();
  });

  it('maxCastLevel reads the class table, at least 1', () => {
    expect(maxCastLevel(undefined, 5)).toBe(1);
    for (const id of ['arcanist', 'berserker', 'thaumaturge']) expect(maxCastLevel(classById.get(id), 1)).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------- AP costs

describe('apCost / apChoice / needsPrompt', () => {
  const { d } = setup('troubadour');
  const p0 = playWith();
  const reqOf = (cost: string, key = 'k'): UseRequest => ({ key, name: 'X', cost: parseCost(cost), sl: 0 });

  it('fixed cost', () => {
    expect(apCost(reqOf('2 {AP}'), p0, d)).toEqual({ total: 2, parts: [] });
  });

  it('Basic CAP: +1 AP for each earlier use this turn, per Action', () => {
    const r = reqOf('1 {AP}, Basic CAP');
    let p = p0;
    const totals: number[] = [];
    for (let i = 0; i < 4; i++) {
      totals.push(apCost(r, p, d).total);
      p = performUse(makeCharacter({ play: p }), d, r).play;
    }
    expect(totals).toEqual([1, 2, 3, 4]);
    expect(apCost(reqOf('1 {AP}, Basic CAP', 'other'), p, d).total).toBe(1);
    expect(apCost(r, endTurn(p).play, d).total).toBe(1);
  });

  it('no CAP without “Basic CAP”', () => {
    const r = reqOf('1 {AP}');
    const p = performUse(makeCharacter({ play: p0 }), d, r).play;
    expect(apCost(r, p, d).total).toBe(1);
    expect(p.turn?.uses).toBeUndefined();
  });

  it.each([1, 2, 3])('Stunned %i: Reactions cost X more AP; other Actions don’t', (x) => {
    const p = playWith([{ name: 'Stunned', level: x }]);
    expect(apCost(reqOf('Reaction, 2 {AP}'), p, d)).toEqual({ total: 2 + x, parts: [`+${x} Stunned`] });
    expect(apCost(reqOf('2 {AP}'), p, d).total).toBe(2);
  });

  it('Stunned and Basic CAP combine on a Reaction (Inspire)', () => {
    const def = act('Inspire');
    const req = reqFor(def, d);
    const p = playWith([{ name: 'Stunned', level: 2 }], { turn: { active: false, uses: { [req.key]: 1 } } });
    expect(apCost(req, p, d)).toEqual({ total: 2 + 1 + 2, parts: ['+1 CAP', '+2 Stunned'] });
  });

  it('variable costs: chosen within the range, default the minimum', () => {
    const r = reqOf('1-5 {AP}');
    expect(apChoice(r, d)).toEqual({ min: 1, max: 5 });
    expect(apCost(r, p0, d).total).toBe(1);
    expect(apCost(r, p0, d, 4).total).toBe(4);
    expect(apChoice(reqOf('Varies'), d)).toEqual({ min: 1, max: 5 });
    expect(apChoice(reqOf('2 {AP}'), d)).toBeUndefined();
  });

  it('parseCost reads costs from the rules text', () => {
    expect(parseCost('Reaction, 2 {AP}, Basic CAP')).toEqual({ ap: 2, reaction: true, cap: true, resources: [] });
    expect(parseCost('1 Prisma, 2 {AP}')).toEqual({ ap: 2, reaction: false, cap: false, resources: [{ name: 'Prisma', amount: 1 }] });
    expect(parseCost('{SL} Prisma, {AP} in spell’s Cast Time').ap).toBe(0);
    expect(parseCost(undefined)).toEqual({ ap: 0, reaction: false, cap: false, resources: [] });
  });

  it('activation AP ranges: casting Actions 0–5, Titan Morph 1 to Max Maneuver Level', () => {
    for (const l of ['Evoke', 'Prismacast', 'Evoke Wonder']) expect(apChoice(reqFor(act(l), d), d)).toEqual({ min: 0, max: 5 });
    const inc = setup('incarnate').d;
    expect(apChoice(reqFor(act('Titan Morph'), inc), inc)).toEqual({ min: 1, max: Math.max(1, maxCastLevel(inc.cls, inc.level)) });
    // A higher Max Maneuver Level widens the range.
    const hi = { ...inc, level: 10 };
    expect(apChoice(reqFor(act('Titan Morph'), hi), hi)!.max).toBe(Math.max(1, maxCastLevel(inc.cls, 10)));
  });

  it('needsPrompt: only when there is something to choose or enter', () => {
    const ask = (l: string) => needsPrompt(reqFor(act(l), d, 1), d);
    expect(ask('Rage')).toBe(false);
    expect(ask('Pray')).toBe(false);
    expect(ask('Brace')).toBe(true); // Mod Die
    expect(ask('Feint')).toBe(true); // outcome
    expect(ask('Blood Siphon')).toBe(true); // amount
    expect(ask('Embolden')).toBe(true); // a creature that may be you
    expect(ask('Radiant Renewal')).toBe(true); // 1–5 AP
    expect(ask('Inspire')).toBe(false); // always an Ally
  });
});

// ---------------------------------------------------------------- every activation

interface ActCase {
  name: string;
  def: ActivationDef;
  sl: number;
  inputs: UseInputs;
}

const caseCache = new Map<string, { c: Character; d: Derived }>();
function caseSetup(cls: string, worn: boolean) {
  const key = `${cls}:${worn}`;
  let v = caseCache.get(key);
  if (!v) {
    const c0 = hero(cls);
    const d0 = derive(c0);
    const res = Object.fromEntries(d0.resources.map((r) => [r.name, Math.min(r.max, 2)]));
    const play: Partial<PlayState> = worn
      ? { endurance: Math.floor(d0.enduranceMax / 2), tempEndurance: 3, vitality: d0.vitalityMax - 1, dying: 1, radianceSpent: 1, resources: res, trackers: { Indebted: 3, Prismaburn: 2 }, conditions: [{ name: 'Bleeding', level: 2 }, { name: 'Poisoned', level: 3 }, { name: 'Bruised' }], ap: 5, tempAp: 1 }
      : { ap: 0, tempAp: 0, endurance: 0, vitality: 1, radianceSpent: d0.radianceMax };
    const c = hero(cls, { play });
    v = { c, d: derive(c) };
    caseCache.set(key, v);
  }
  return v;
}

const actCases: ActCase[] = ACTIVATIONS.flatMap((def) => {
  const cs = getCastable(def.id);
  const sls = cs ? Array.from({ length: 6 - Math.max(1, cs.level) }, (_, i) => Math.max(1, cs.level) + i) : [0];
  const outcomes: (string | undefined)[] = def.inputs?.outcome ?? [undefined];
  const mods: (number | undefined)[] = def.inputs?.mod ? [0, 7] : [undefined];
  const amounts: (number | undefined)[] = def.inputs?.amount ? [0, 3, 99] : [undefined];
  const selves: (boolean | undefined)[] = def.target === 'either' ? [true, false] : [undefined];
  const { d } = caseSetup(ownerClass(def), true);
  const choice = apChoice(reqFor(def, d), d);
  const aps: (number | undefined)[] = choice ? [...new Set([choice.min, choice.max])] : [undefined];
  const out: ActCase[] = [];
  for (const sl of sls)
    for (const outcome of outcomes)
      for (const mod of mods)
        for (const amount of amounts)
          for (const self of selves)
            for (const ap of aps) {
              const inputs: UseInputs = { outcome, mod, amount, self, ap };
              const bits = [cs ? `SL ${sl}` : '', outcome, mod !== undefined ? `mod ${mod}` : '', amount !== undefined ? `amount ${amount}` : '', self !== undefined ? (self ? 'self' : 'other') : '', ap !== undefined ? `${ap} AP` : ''].filter(Boolean);
              out.push({ name: `${def.label} (${ownerClass(def)}) ${bits.join(', ')}`.trim(), def, sl, inputs });
            }
  return out;
});

describe('every activation: never throws, AP never negative, no NaN, logs something', () => {
  it('every activation’s rules section exists, and the id/label pairs are unique', () => {
    for (const a of ACTIVATIONS) expect(getNode(a.id), a.id).toBeDefined();
    expect(new Set(ACTIVATIONS.map(activationUseKey)).size).toBe(ACTIVATIONS.length);
    expect(activationsFor('classes/champion/undaunted').map((a) => a.label)).toEqual(['Press On', 'Overcome']);
    expect(activationsFor('nope')).toEqual([]);
  });

  it.each(sample(actCases, QA ? 30 : actCases.length).map((c) => [c.name, c] as const))('%s', (_n, k) => {
    for (const worn of [true, false]) {
      const { c, d } = caseSetup(ownerClass(k.def), worn);
      const req = reqFor(k.def, d, k.sl);
      const r = performUse(c, d, req, k.inputs);
      expect(r.log.length).toBeGreaterThan(0);
      for (const l of r.log) expect(l).not.toMatch(/NaN|undefined/);
      // The sheet clamps the result to the (new) maximums before saving it.
      const saved = clampPlay(r.play, derive({ ...c, play: r.play }));
      expectSanePlay(saved, d);
      expect(badNumbers(r.play)).toEqual([]);
      expect(r.play.ap).toBeGreaterThanOrEqual(0);
      // The input state is not mutated.
      expect(c.play).toEqual(caseSetup(ownerClass(k.def), worn).c.play);
    }
  });
});

// ---------------------------------------------------------------- targeted activation tests

describe('casting Actions: Prismacast / Evoke / Evoke Wonder', () => {
  it('Prismacast SL 2 spends 2 Prisma (applied to the Limit), the chosen AP, and Prismaburned 2', () => {
    const r = use('Prismacast', { inputs: { amount: 2, ap: 3 } });
    expect(r.play.ap).toBe(2);
    expect(r.play.resources.Prisma).toBe(2);
    expect(r.play.trackers.Prismaburn).toBe(2);
  });

  it('Prismaburned takes the higher level, never adds', () => {
    expect(use('Prismacast', { play: { trackers: { Prismaburn: 3 } }, inputs: { amount: 1 } }).play.trackers.Prismaburn).toBe(3);
    expect(use('Prismacast', { play: { trackers: { Prismaburn: 1 } }, inputs: { amount: 2 } }).play.trackers.Prismaburn).toBe(2);
  });

  it('Evoke SL 2 spends 2 Favor and makes you Indebted 4 (2 × SL), higher kept', () => {
    const r = use('Evoke', { inputs: { amount: 2, ap: 2 } });
    expect(r.play.resources.Favor).toBe(2);
    expect(r.play.trackers.Indebted).toBe(4);
    expect(r.play.ap).toBe(3);
    expect(use('Evoke', { play: { trackers: { Indebted: 5 } }, inputs: { amount: 1 } }).play.trackers.Indebted).toBe(5);
    expect(use('Evoke', { play: { trackers: { Indebted: 1 } }, inputs: { amount: 1 } }).play.trackers.Indebted).toBe(2);
  });

  it('Evoke Wonder spends Wonder; no tracker', () => {
    const r = use('Evoke Wonder', { inputs: { amount: 1 } });
    expect(r.play.resources.Wonder).toBe(1);
    expect(r.play.trackers).toEqual({});
  });

  it('a casting Action used by a class without that resource spends nothing', () => {
    const r = use('Prismacast', { cls: 'berserker', inputs: { amount: 2 } });
    expect(r.play.resources).toEqual({});
  });

  it('Prismacast then start of turn: Prismaburned drops by 1', () => {
    const r = use('Prismacast', { inputs: { amount: 2 } });
    expect(startTurn(r.play, 2, []).play.trackers.Prismaburn).toBe(1);
  });
});

describe('maneuvers', () => {
  it.each([
    [1, 3, 8],
    [3, 0, 15],
    [4, 2, 22],
    [5, 4, 34], // Exalted (5th): Mod Die + 6{SL}
  ])('Brace SL %i, Mod %i → %i Temporary Endurance', (sl, mod, want) => {
    expect(use('Brace', { sl, inputs: { mod } }).play.tempEndurance).toBe(want);
  });

  it('Brace: a Reaction costing 1 AP; Temporary Endurance never stacks (higher kept)', () => {
    const r = use('Brace', { inputs: { mod: 1 }, play: { tempEndurance: 20 } });
    expect(r.play.tempEndurance).toBe(20);
    expect(r.play.ap).toBe(4);
    expect(r.req.cost.reaction).toBe(true);
    const st = use('Brace', { inputs: { mod: 1 }, play: { conditions: [{ name: 'Stunned', level: 2 }] } });
    expect(st.play.ap).toBe(5 - 3);
  });

  it.each([
    ['Success', 2, 'Feint 2'],
    ['Deadly Success', 2, 'Feint 3'],
  ])('Feint %s at SL %i → %s until end of turn', (outcome, sl, name) => {
    const r = use('Feint', { sl, inputs: { outcome } });
    expect(r.play.effects!.map((e) => [e.name, e.ends])).toEqual([[name, 'endOfTurn']]);
    expect(endTurn(r.play).play.effects).toEqual([]);
  });

  it('Feint Failure / Complete Failure: no effect, Failure leaves a note', () => {
    const f = use('Feint', { inputs: { outcome: 'Failure' } });
    expect(f.play.effects ?? []).toEqual([]);
    expect(f.log.join(' ')).toMatch(/costs 1 less AP/);
    expect(use('Feint', { inputs: { outcome: 'Complete Failure' } }).play.effects ?? []).toEqual([]);
  });

  it('Feint SL 5 Success: 2 temporary AP (Exalted 5th)', () => {
    expect(use('Feint', { sl: 5, inputs: { outcome: 'Success' } }).play.tempAp).toBe(2);
    expect(use('Feint', { sl: 4, inputs: { outcome: 'Success' } }).play.tempAp ?? 0).toBe(0);
  });

  it('Feint SL 3 Deadly Success has Advantage (Exalted 3rd)', () => {
    expect(use('Feint', { sl: 3, inputs: { outcome: 'Deadly Success' } }).play.effects![0].notes!.join(' ')).toMatch(/Advantage/);
  });

  // Rules (Feint, Exalted 4th): "Your Attack Checks have Advantage on any Success."
  it('Feint at SL 4 gives Advantage on any Success', () => {
    expect(use('Feint', { sl: 4, inputs: { outcome: 'Success' } }).play.effects![0].notes!.join(' ')).toMatch(/Advantage/);
  });

  it.each([1, 2, 3])('Rage SL %i: VIG Checks Bolstered SL, Movement +SL, Resistance 2×SL to five types', (sl) => {
    const r = use('Rage', { sl });
    const e = r.play.effects![0];
    expect(e.name).toBe(`Rage ${sl}`);
    expect(e.ends).toBe('manual');
    const d2 = derive({ ...r.c, play: r.play });
    for (const t of ['Arctic', 'Caustic', 'Galvanic', 'Somatic', 'Thermic']) expect(d2.resistances.find((x) => x.type === t)?.value).toBe(2 * sl);
    expect(d2.resistances.find((x) => x.type === 'Slashing')).toBeUndefined();
    expect(rowOf(d2.conditionFx, 'VIG')!.bolstered).toBe(sl);
    expect(d2.movement).toBe(r.d.movement + sl);
    expect(r.play.ap).toBe(4);
  });

  it('Rage again replaces the old Rage (one Rage at a time)', () => {
    const a = use('Rage', { sl: 1 });
    const def = act('Rage');
    const c2 = { ...a.c, play: a.play };
    const b = performUse(c2, derive(c2), reqFor(def, derive(c2), 2));
    expect(b.play.effects!.map((e) => e.name)).toEqual(['Rage 2']);
  });

  it('Rage’s Resistance reduces Somatic damage from Conditions at the start of your turn', () => {
    const a = use('Rage', { sl: 1, play: { conditions: [{ name: 'Bleeding', level: 2 }] } });
    const d2 = derive({ ...a.c, play: a.play });
    expect(startTurn(a.play, d2.level, d2.resistances).damage[0].amount).toBe(2 * 2 - 2);
  });
});

describe('spells', () => {
  it.each([
    [1, 5, 25],
    [3, 15, 75],
    [4, 20, 120],
  ])('Ice Armor SL %i: take %i Arctic damage, then %i Temporary Endurance', (sl, dmg, temp) => {
    const r = use('Ice Armor', { sl });
    expect(r.play.endurance).toBe(r.before.endurance - dmg);
    expect(r.play.tempEndurance).toBe(temp);
  });

  it('Ice Armor: damage respects Resistance (Rage) and Immunity, and reminds of Vulnerability', () => {
    const rage = use('Rage', { cls: 'arcanist', sl: 1 });
    const c2 = { ...rage.c, play: rage.play };
    const d2 = derive(c2);
    const r = performUse(c2, d2, reqFor(act('Ice Armor'), d2, 1));
    expect(r.play.endurance).toBe(c2.play.endurance - (5 - 2));
    expect(r.log.join(' ')).toMatch(/5 − Resistance 2/);
    const imm = use('Ice Armor', { over: { homebrew: [homebrewEffect('Frost Ward', [row('r', { kind: 'immunity', damage: 'Arctic' })])] } });
    expect(imm.play.endurance).toBe(imm.before.endurance);
    expect(imm.log.join(' ')).toMatch(/No Arctic damage \(Immune\)/);
    const vul = use('Ice Armor', { over: { homebrew: [homebrewEffect('Frail', [row('r', { kind: 'vulnerability', type: 'Arctic', dice: '1d8' })])] } });
    expect(vul.log.join(' ')).toMatch(/Arctic Vulnerability 1d8/);
  });

  it('Ice Armor: the damage hits existing Temporary Endurance first, then the new amount replaces it if higher', () => {
    const r = use('Ice Armor', { sl: 1, play: { tempEndurance: 4 } });
    expect(r.play.endurance).toBe(r.before.endurance - 1);
    expect(r.play.tempEndurance).toBe(25);
  });

  it.each([
    [1, 20, 40],
    [2, 30, 60],
    [3, 40, 85],
    [4, 50, 115],
    [5, 60, 150],
  ])('Flame of Ambition SL %i: %i Thermic damage, %i Temporary Endurance', (sl, dmg, temp) => {
    const r = use('Flame of Ambition', { sl, play: { endurance: 200 }, d: (d) => ({ ...d, enduranceMax: 200 }) });
    expect(r.play.endurance).toBe(200 - dmg);
    expect(r.play.tempEndurance).toBe(temp);
  });

  it('Flame of Ambition at 0 Endurance costs 1 Vitality (damage while at 0)', () => {
    const r = use('Flame of Ambition', { play: { endurance: 0 } });
    expect(r.play.vitality).toBe(r.before.vitality - 1);
    expect(r.play.dying).toBe(1);
  });

  it('Blood Siphon heals the Chthonic damage dealt; Arcane Power Exsanguinate Deadly Success heals the Class Bonus', () => {
    expect(use('Blood Siphon', { play: { endurance: 1 }, inputs: { amount: 7 } }).play.endurance).toBe(8);
    expect(use('Arcane Power', { play: { endurance: 1 }, inputs: { outcome: 'Exsanguinate: Deadly Success' } }).play.endurance).toBe(1 + 2);
    expect(use('Arcane Power', { play: { endurance: 1 }, inputs: { outcome: 'Another result or option' } }).play.endurance).toBe(1);
  });

  it.each([
    ['Complete Success', 1, 3, 2, 11 + 8 * 2 + 2, 1],
    ['Success', 2, 1, 0, 14, 0],
    ['Failure', 1, 5, 1, 4 + 3 * 4 + 1, 0],
    ['Complete Failure', 1, 2, 0, 2 + 1, 0],
    ['Success', 4, 1, 0, 28, 1],
    ['Complete Success', 4, 1, 0, 44, 2],
    ['Success', 5, 1, 0, 35 + 20, 1],
  ])('Radiant Renewal %s SL %i, %i AP, Mod %i on yourself → +%i Endurance, +%i Vitality', (outcome, sl, ap, mod, end, vit) => {
    const r = use('Radiant Renewal', { sl, play: { endurance: 0, vitality: 1, dying: 2 }, d: (d) => ({ ...d, enduranceMax: 500, vitalityMax: 5 }), inputs: { outcome, ap, mod, self: true } });
    expect(r.play.endurance).toBe(end);
    expect(r.play.vitality).toBe(1 + vit);
    expect(r.play.dying).toBe(vit ? 0 : 2); // Dying ends when you regain any Vitality
    expect(r.play.ap).toBe(5 - ap);
  });

  it('Radiant Renewal on another creature changes nothing of yours but still costs AP', () => {
    const r = use('Radiant Renewal', { play: { endurance: 1 }, inputs: { outcome: 'Success', ap: 2, self: false } });
    expect(r.play.endurance).toBe(1);
    expect(r.play.ap).toBe(3);
    expect(r.log.some((l) => l.startsWith('Target: regains'))).toBe(true);
  });

  it('Fleshmending Hymn: Success ends Bleeding / Bruised / Poisoned and restores 1 Vitality (Complete Success 2)', () => {
    const conds = [{ name: 'Bleeding', level: 2 }, { name: 'Bruised' }, { name: 'Poisoned', level: 3 }, { name: 'Prone' }];
    const s = use('Fleshmending Hymn', { play: { conditions: conds, vitality: 1 }, inputs: { outcome: 'Success', self: true } });
    expect(s.play.conditions).toEqual([{ name: 'Prone' }]);
    expect(s.play.vitality).toBe(2);
    const cs = use('Fleshmending Hymn', { play: { conditions: conds, vitality: 1 }, inputs: { outcome: 'Complete Success', self: true } });
    expect(cs.play.vitality).toBe(3);
  });

  it('Fleshmending Hymn: Failure ends Bleeding and reduces Poisoned by SL; Complete Failure ends only Bleeding', () => {
    const conds = [{ name: 'Bleeding', level: 2 }, { name: 'Bruised' }, { name: 'Poisoned', level: 3 }];
    const f = use('Fleshmending Hymn', { sl: 2, play: { conditions: conds }, inputs: { outcome: 'Failure', self: true } });
    expect(f.play.conditions).toEqual([{ name: 'Bruised' }, { name: 'Poisoned', level: 1 }]);
    const f3 = use('Fleshmending Hymn', { sl: 3, play: { conditions: conds }, inputs: { outcome: 'Failure', self: true } });
    expect(f3.play.conditions).toEqual([{ name: 'Bruised' }]);
    const cf = use('Fleshmending Hymn', { play: { conditions: conds }, inputs: { outcome: 'Complete Failure', self: true } });
    expect(cf.play.conditions).toEqual([{ name: 'Bruised' }, { name: 'Poisoned', level: 3 }]);
  });

  it.each(['Embolden', 'Sharpen'])('%s SL 2 on yourself: 2 temporary AP now and at the end of each turn', (label) => {
    const r = use(label, { sl: 2, inputs: { self: true } });
    expect(r.play.tempAp).toBe(2);
    expect(r.play.ap).toBe(4);
    expect(endTurn(r.play).play.tempAp).toBe(2);
    const other = use(label, { sl: 2, inputs: { self: false } });
    expect(other.play.tempAp ?? 0).toBe(0);
    expect(other.play.effects ?? []).toEqual([]);
  });

  it('Adrenalize: Temporary Endurance = your level + 5; Movement + half Class Bonus', () => {
    const r = use('Adrenalize', { sl: 0, inputs: { self: true } });
    expect(r.play.tempEndurance).toBe(r.d.level + 5);
    expect(derive({ ...r.c, play: r.play }).movement).toBe(r.d.movement + Math.ceil(r.d.classBonus / 2));
  });

  it('Invigorate SL 1: 2 Temporary Endurance now and each turn, VIG Checks Bolstered 1', () => {
    const r = use('Invigorate', { sl: 1, inputs: { self: true } });
    expect(r.play.tempEndurance).toBe(2);
    expect(rowOf(derive({ ...r.c, play: r.play }).conditionFx, 'VIG')!.bolstered).toBe(1);
    expect(startTurn({ ...r.play, tempEndurance: 0 }, 2, []).play.tempEndurance).toBe(2);
  });

  // Rules (Invigorate, Exalted (+2)): "The creature's VIG Checks are Bolstered an additional level" every 2 levels above 1st.
  it('Invigorate Exalted (+2): Bolstered 2 at SL 3', () => {
    const r = use('Invigorate', { sl: 3, inputs: { self: true } });
    expect(r.play.effects![0].checks![0].bolstered).toBe(2);
  });
});

describe('facets', () => {
  it('Press On: sacrifice 1 Vitality (no Dying), regain 10 × Class Bonus Endurance, spends the Undaunted use', () => {
    const r = use('Press On', { play: { endurance: 0 } });
    expect(r.play.vitality).toBe(r.before.vitality - 1);
    expect(r.play.dying).toBe(0);
    expect(r.play.endurance).toBe(10 * r.d.classBonus);
    expect(r.req.facetKey).toBe('classes/champion/undaunted');
    expect(r.play.facetUses['classes/champion/undaunted']).toBe(1);
    expect(r.play.ap).toBe(5);
  });

  it('Overcome: sacrifices 1 Vitality and spends the same Undaunted use', () => {
    const r = use('Overcome');
    expect(r.play.vitality).toBe(r.before.vitality - 1);
    expect(r.play.facetUses['classes/champion/undaunted']).toBe(1);
  });

  it('Infernal Will: half the Class Bonus, or the Class Bonus if Deadly; rolling a 19 regains 1 Radiance', () => {
    const cb = 3;
    const withCb = (d: Derived) => ({ ...d, classBonus: cb });
    expect(use('Infernal Will', { play: { endurance: 1 }, d: withCb, inputs: { outcome: 'Success / Failure' } }).play.endurance).toBe(1 + 2);
    expect(use('Infernal Will', { play: { endurance: 1 }, d: withCb, inputs: { outcome: 'Deadly' } }).play.endurance).toBe(1 + 3);
    expect(use('Rolled a 19', { play: { radianceSpent: 1 } }).play.radianceSpent).toBe(0);
    expect(use('Rolled a 19', { play: { radianceSpent: 0 } }).play.radianceSpent).toBe(0);
  });

  it('Reignite: heal Mod + level; 1 AP Basic CAP; uses = Class Bonus per Long Rest', () => {
    const def = act('Reignite');
    const { c, d } = setup('gladiator', { endurance: 1 });
    const req = reqFor(def, d);
    const a = performUse(c, d, req, { mod: 4 });
    expect(a.play.endurance).toBe(1 + 4 + d.level);
    expect(a.play.ap).toBe(4);
    expect(a.play.facetUses[activationUseKey(def)]).toBe(1);
    const b = performUse({ ...c, play: a.play }, d, req, { mod: 0 });
    expect(b.play.ap).toBe(2); // 1 + 1 CAP
    expect(useMax(def, d)).toBe(d.classBonus);
  });

  it('Action Flare: temporary AP = Class Bonus, regain half Class Bonus Stamina, CAP resets', () => {
    const r = use('Action Flare', { play: { resources: { Stamina: 3 }, turn: { active: true, uses: { x: 2 } } } });
    expect(r.play.tempAp).toBe(r.d.classBonus);
    expect(r.play.resources.Stamina).toBe(3 - Math.ceil(r.d.classBonus / 2));
    expect(r.play.turn?.uses).toEqual({});
    expect(r.play.facetUses['classes/gladiator/action-flare']).toBe(1);
    expect(endTurn(r.play).play.tempAp).toBe(0);
  });

  it('Defensive Fighting: AC + half Class Bonus until the start of your next turn', () => {
    const r = use('Defensive Fighting');
    const d2 = derive({ ...r.c, play: r.play });
    expect(d2.ac.value).toBe(r.d.ac.value + Math.ceil(r.d.classBonus / 2));
    expect(startTurn(r.play, 2, []).play.effects).toEqual([]);
  });

  it.each([1, 3, 5])('Titan Morph with %i AP: 10× Temporary Endurance, Size Bonus effects; spends the Titanus Form use', (ap) => {
    const r = use('Titan Morph', { inputs: { ap }, play: { resources: { Stamina: 4 } } });
    expect(r.play.ap).toBe(5 - ap);
    expect(r.play.tempEndurance).toBe(10 * ap);
    const e = r.play.effects![0];
    expect(e.movement).toBe(ap);
    expect(e.checks).toEqual([{ attrs: ['VIG', 'PER'], bolstered: ap }]);
    expect(e.resistances!.map((x) => [x.type, x.amount])).toEqual([
      ['Crushing', 2 * ap],
      ['Piercing', 2 * ap],
      ['Slashing', 2 * ap],
    ]);
    expect(r.play.facetUses['classes/incarnate/titanus-form']).toBe(1);
    expect(endTurn(r.play).play.resources.Stamina).toBe(Math.max(0, 4 - ap));
  });

  it('Primeval Force: Temporary Endurance = PRS points', () => {
    expect(use('Primeval Force', { attrs: { PRS: 3 } }).play.tempEndurance).toBe(3);
  });

  // Rules (Primeval Force): "gain Temporary Endurance equal to your PRS Points" — with negative PRS you gain none;
  // the app treats the negative amount as a sacrifice and takes Temporary Endurance away.
  it('Primeval Force with negative PRS points gives no Temporary Endurance and removes none', () => {
    const r = use('Primeval Force', { attrs: { PRS: -1 }, play: { tempEndurance: 5 } });
    expect(r.play.tempEndurance).toBe(5);
  });

  it('Spend Radiance (Shining Soul): spend 1 Radiance, regain level Endurance, 1 Light off the Limit', () => {
    const r = use('Spend Radiance', { play: { endurance: 1, resources: { Light: 2 } } });
    expect(r.play.radianceSpent).toBe(1);
    expect(r.play.endurance).toBe(1 + r.d.level);
    expect(r.play.resources.Light).toBe(1);
  });

  it('Entreat Miracle: Indebted reduced by Class Bonus; Protect Allies on you heals Mod + 2 × level and AC + Class Bonus', () => {
    const r = use('Entreat Miracle', { play: { endurance: 1, trackers: { Indebted: 5 } }, inputs: { outcome: 'Protect Allies', mod: 6, self: true } });
    expect(r.play.trackers.Indebted).toBe(5 - r.d.classBonus);
    expect(r.play.endurance).toBe(1 + 6 + 2 * r.d.level);
    expect(r.play.effects![0]).toMatchObject({ name: 'Protect Allies', ends: 'startOfTurn', ac: r.d.classBonus });
    expect(r.play.ap).toBe(3);
    expect(r.play.facetUses['classes/thaumaturge/favored-acolyte']).toBe(1);
  });

  it('Entreat Miracle: Rebuke Oblux only reduces Indebted (not below 0)', () => {
    const r = use('Entreat Miracle', { play: { endurance: 1, trackers: { Indebted: 1 } }, inputs: { outcome: 'Rebuke Oblux', self: true } });
    expect(r.play.trackers.Indebted).toBe(0);
    expect(r.play.endurance).toBe(1);
  });

  it('Pray: 1 AP, the Prayer blessing until the start of your next turn; Prayers stack', () => {
    const a = use('Pray');
    expect(a.play.ap).toBe(4);
    const c2 = { ...a.c, play: a.play };
    const b = performUse(c2, a.d, reqFor(act('Pray'), a.d));
    expect(b.play.effects!.map((e) => e.name)).toEqual(['Prayer', 'Prayer']);
    expect(startTurn(b.play, 2, []).play.effects).toEqual([]);
  });

  it('Cosmic Knowledge: Temporary Endurance = the roll', () => {
    expect(use('Cosmic Knowledge', { inputs: { mod: 9 } }).play.tempEndurance).toBe(9);
  });

  it('Realign: removes all Prisma from the Limit; Prismaburned reduced by half the Class Bonus', () => {
    const r = use('Realign', { play: { resources: { Prisma: 3 }, trackers: { Prismaburn: 3 } } });
    expect(r.play.resources.Prisma).toBe(0);
    expect(r.play.trackers.Prismaburn).toBe(3 - Math.ceil(r.d.classBonus / 2));
    expect(r.play.ap).toBe(3);
    expect(r.play.facetUses['classes/arcanist/prismatic-realignment']).toBe(1);
  });

  it('Roar: Adrenaline gives Class Bonus Temporary Endurance; Frenzy sacrifices up to your level', () => {
    expect(use('Roar: Adrenaline').play.tempEndurance).toBe(2);
    const f = use('Roar: Frenzy', { play: { tempEndurance: 10 }, inputs: { amount: 99 } });
    expect(f.play.tempEndurance).toBe(10 - f.d.level);
    expect(f.log.join(' ')).toMatch(new RegExp(`\\+${2 * f.d.level} damage`));
    expect(use('Roar: Frenzy', { play: { tempEndurance: 1 }, inputs: { amount: 2 } }).play.tempEndurance).toBe(0);
  });

  it('Inspire: always on an Ally (your state unchanged), uses = VIG + 1 (min 1); Confound uses = INT + 1', () => {
    const r = use('Inspire', { attrs: { PRS: 3, VIG: 2 } });
    expect(r.play.tempEndurance).toBe(0);
    expect(r.log.some((l) => l === 'Target: gains 3 Temporary Endurance.')).toBe(true);
    expect(r.play.ap).toBe(3);
    expect(useMax(act('Inspire'), r.d)).toBe(3);
    expect(useMax(act('Inspire'), setup('troubadour', {}, { VIG: -1 }).d)).toBe(1);
    expect(useMax(act('Confound'), setup('troubadour', {}, { INT: 2 }).d)).toBe(3);
    expect(r.play.facetUses[activationUseKey(act('Inspire'))]).toBe(1);
  });

  it('AP is spent from temporary AP first, and never goes below 0', () => {
    const r = use('Realign', { play: { ap: 5, tempAp: 1, resources: { Prisma: 1 } } });
    expect([r.play.tempAp, r.play.ap]).toEqual([0, 4]);
    const broke = use('Realign', { play: { ap: 1, tempAp: 0 } });
    expect(broke.play.ap).toBe(0);
    expect(broke.log[0]).toMatch(/You only had 1/);
  });

  it('Cost-line resources are spent (1 Prisma for Detect Arcane)', () => {
    const { c, d } = setup('arcanist');
    const node = getNode('classes/arcanist/prismatic-scholar/detect-arcane');
    const r = performUse(c, d, actionRequest(d, 'classes/arcanist/prismatic-scholar/detect-arcane', 'Detect Arcane', node?.fields?.Cost ?? '1 Prisma, 2 {AP}'));
    expect(r.play.resources.Prisma).toBe(1);
    expect(r.play.ap).toBe(3);
  });

  it('Radiance and Vitality in a Cost line are spent', () => {
    const { c, d } = setup('berserker');
    const r = performUse(c, d, { key: 'x', name: 'X', cost: parseCost('1 Radiance, 1 Vitality, 1 {AP}'), sl: 0 });
    expect(r.play.radianceSpent).toBe(1);
    expect(r.play.vitality).toBe(c.play.vitality - 1);
  });

  it('a plain Action with no effects logs that it was used', () => {
    const { c, d } = setup('berserker');
    expect(performUse(c, d, { key: 'x', name: 'Wave', cost: parseCost(''), sl: 0 }).log).toEqual(['Used Wave.']);
  });

  it('extra state changes (the Cast button’s resource / Prismaburn) apply with their log', () => {
    const { c, d } = setup('arcanist');
    const r = performUse(c, d, { key: 's', name: 'S', cost: parseCost('2 {AP}'), sl: 2, extra: { apply: (p) => ({ ...p, trackers: { Prismaburn: 2 } }), log: ['Cast S.'] } });
    expect(r.play.trackers.Prismaburn).toBe(2);
    expect(r.log).toContain('Cast S.');
  });
});

describe('facet uses: facetUseMax and spending them', () => {
  const { d } = setup('champion');
  const fake = (count: ResolvedFacet['uses']) => ({ key: 'f', name: 'F', source: 's', level: 1, uses: count }) as unknown as ResolvedFacet;

  it('no uses → 0; a number → itself; scaled counts resolve', () => {
    expect(facetUseMax({ key: 'f', name: 'F', source: 's', level: 1 } as unknown as ResolvedFacet, d)).toBe(0);
    expect(facetUseMax(fake({ count: 3, per: 'Rest' }), d)).toBe(3);
    expect(facetUseMax(fake({ count: 'classBonus', per: 'Rest' } as never), d)).toBe(d.classBonus);
    expect(facetUseMax(fake({ count: 'level', per: 'Rest' } as never), { ...d, level: 7 })).toBe(7);
  });

  it.each(['champion', 'gladiator', 'incarnate', 'thaumaturge', 'arcanist', 'berserker', 'troubadour'])('%s: every facet with uses has at least 1', (cls) => {
    const dd = setup(cls).d;
    const withUses = dd.facets.filter((f) => f.uses);
    expect(withUses.length).toBeGreaterThan(0);
    for (const f of withUses) expect(facetUseMax(f, dd)).toBeGreaterThanOrEqual(1);
  });

  it('actionRequest finds the facet for an Action inside it, and performUse spends one use each time', () => {
    const { c, d: dd } = setup('incarnate');
    const req = reqFor(act('Titan Morph'), dd);
    expect(req.facetKey).toBe('classes/incarnate/titanus-form');
    let p = c.play;
    for (let i = 1; i <= 2; i++) {
      p = performUse({ ...c, play: p }, dd, req, { ap: 1 }).play;
      expect(p.facetUses['classes/incarnate/titanus-form']).toBe(i);
    }
    expect(actionRequest(dd, 'some/other', 'X', '1 {AP}').facetKey).toBeUndefined();
  });

  // Rules (Action Flare): "You gain an additional use of this facet between Rests at 8th level."
  // (Latent while the app caps levels at 2.)
  it('Action Flare gains its second use at 8th level', () => {
    const dd = setup('gladiator').d;
    const f = dd.facets.find((x) => x.key === 'classes/gladiator/action-flare')!;
    expect(facetUseMax(f, { ...dd, level: 8 })).toBe(2);
  });
});
