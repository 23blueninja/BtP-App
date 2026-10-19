// Supporting systems: homebrew, inventory, dice, costs, scaling, class info,
// Exalted folding, character storage, UI prefs and Light colours.
//
// Where an engine implements a rule, expectations come from the rules document
// (rules/BtP-Alpha-Rules.md); app-only systems (storage, prefs, backpacks,
// homebrew editor shapes) are tested against the code's stated intent.
// Deviations are kept as `it.fails('BUG: …')` so the suite documents them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QA, makeCharacter, sample } from './helpers';

import { ATTRS, LIGHTS, type Attr, type Light, type RestRule } from '../src/data/types';
import type { Character, HomebrewEffect, HomebrewEntry, HomebrewRow, InventoryItem, PlayState } from '../src/engine/character';
import { normalizeCharacter } from '../src/engine/character';
import {
  RULE_TEXT,
  TIER_NAMES,
  atTier,
  describeEffect,
  homebrewAlignments,
  newHomebrew,
  poolKey,
  resolveDie,
  resolveHomebrew,
  rowApplies,
  spendPool,
} from '../src/engine/homebrew';
import { effectiveBulk, groupInventory, layoutBulk, layoutContainer, type BulkLayout } from '../src/engine/inventory';
import { dieLabel, formatDie, half, modDieFromPoints, parseDie, stepDie, triangular } from '../src/engine/dice';
import { isVariable, parseCost } from '../src/engine/costs';
import { castCost, exaltedState, maxCastLevel, resolveHtml, scaleHtml, scaleText } from '../src/engine/scaling';
import {
  alignmentFromText,
  classAlignment,
  classEndurance,
  classFacets,
  classRow,
  classTable,
  columnValue,
  getClass,
  maxClassLevel,
  numeric,
  subclassFacets,
  subclassesOf,
} from '../src/engine/classInfo';
import { calculateCastable } from '../src/engine/exalted';
import { classes } from '../src/data/classes';
import { getCastable, getNode, maneuvers, spells, type Castable } from '../src/content';
import { GRADIENT_CYCLES, LIGHT_TEXT, alignmentGradient } from '../src/ui/lightColors';

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/** mulberry32: small seeded PRNG so property-test failures are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

/** In-memory localStorage stand-in. */
class FakeStorage {
  data = new Map<string, string>();
  failGet = false;
  failSet = false;
  getItem(k: string) {
    if (this.failGet) throw new Error('SecurityError');
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.failSet) throw new Error('QuotaExceededError');
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  get length() {
    return this.data.size;
  }
}

/** Treats -0 and 0 alike when comparing Mod Dice. */
const nz = (d: { step: number; bonus: number }) => ({ step: d.step + 0, bonus: d.bonus + 0 });

const ALL_REST_RULES: RestRule[] = ['noRadianceLongRest', 'noVitalityLongRest', 'noEnduranceLongRest', 'noTempEnduranceLongRest', 'noRestCharges', 'noVitalityShortRest'];

// ===========================================================================
// dice.ts — Attribute Points & Modifier Dice table (rules p. "Attributes")
// ===========================================================================
describe('dice', () => {
  // Rules table: 1→1d2 … 6→1d12, -1→-1d2 … -6→-1d12, 0 → no Mod Die.
  const TABLE: [number, string][] = [
    [1, 'd2'], [2, 'd4'], [3, 'd6'], [4, 'd8'], [5, 'd10'], [6, 'd12'],
    [-1, '-d2'], [-2, '-d4'], [-3, '-d6'], [-4, '-d8'], [-5, '-d10'], [-6, '-d12'],
  ];
  it.each(TABLE)('%i points is a %s Mod Die (rules table)', (pts, die) => {
    expect(dieLabel(pts)).toBe(die);
    expect(nz(modDieFromPoints(pts))).toEqual({ step: pts, bonus: 0 });
  });
  it('0 points has no Mod Die', () => {
    expect(modDieFromPoints(0)).toEqual({ step: 0, bonus: 0 });
    expect(dieLabel(0)).toBe('—');
  });
  it('points past ±6 carry into a flat bonus', () => {
    expect(modDieFromPoints(8)).toEqual({ step: 6, bonus: 2 });
    expect(modDieFromPoints(-9)).toEqual({ step: -6, bonus: -3 });
    expect(dieLabel(8)).toBe('d12+2');
    expect(dieLabel(-9)).toBe('-d12-3');
  });
  it('formatDie shows a lone flat bonus', () => {
    expect(formatDie({ step: 0, bonus: 3 })).toBe('+3');
    expect(formatDie({ step: 0, bonus: -2 })).toBe('-2');
  });
  // Rules: "an Attack Check with a d10 Mod Die that is Bolstered 2 … roll a d12 and add 1".
  it('Bolstered 2 on a d10 is a d12 +1 (rules example)', () => {
    expect(stepDie(modDieFromPoints(5), 2)).toEqual({ step: 6, bonus: 1 });
  });
  // Rules: "a Save Check with a d4 Mod Die that is Hindered 4 … down to a -d4".
  it('Hindered 4 on a d4 is a -d4 (rules example)', () => {
    expect(formatDie(stepDie(modDieFromPoints(2), -4))).toBe('-d4');
  });
  it('Hindered past -d12 subtracts from the total; stepping is reversible', () => {
    expect(stepDie({ step: -6, bonus: 0 }, -2)).toEqual({ step: -6, bonus: -2 });
    for (let p = -9; p <= 9; p++)
      for (let s = -8; s <= 8; s++) {
        const d = stepDie(modDieFromPoints(p), s);
        expect(d.step).toBeGreaterThanOrEqual(-6);
        expect(d.step).toBeLessThanOrEqual(6);
        if (Math.abs(d.step) < 6) expect(d.bonus).toBe(0);
        expect(nz(stepDie(d, -s))).toEqual(nz(modDieFromPoints(p)));
      }
  });
  it('parseDie reads die sizes and signs', () => {
    expect(parseDie('1d6')).toEqual({ step: 3, bonus: 0 });
    expect(parseDie('d12')).toEqual({ step: 6, bonus: 0 });
    expect(parseDie('-1d4')).toEqual({ step: -2, bonus: 0 });
    expect(parseDie('nonsense')).toEqual({ step: 0, bonus: 0 });
    for (const [pts, die] of TABLE) expect(parseDie(die)).toEqual({ step: pts, bonus: 0 });
  });
  // Rules (Agility): +1 at 1 point, then +2, … — triangular growth.
  it('triangular growth and half (round up)', () => {
    expect([0, 1, 2, 3, 4].map(triangular)).toEqual([0, 1, 3, 6, 10]);
    expect(triangular(-2)).toBe(-3);
    expect([1, 2, 3, 4, 5].map(half)).toEqual([1, 1, 2, 2, 3]);
  });
});

// ===========================================================================
// costs.ts
// ===========================================================================
describe('parseCost', () => {
  const cases: [string | undefined, number | { min: number; max: number }, boolean, boolean, { name: string; amount: number }[]][] = [
    [undefined, 0, false, false, []],
    ['', 0, false, false, []],
    ['3 {AP}', 3, false, false, []],
    ['0 {AP}, Basic CAP', 0, false, true, []],
    ['2 {AP}, Basic CAP', 2, false, true, []],
    ['Reaction, 1 {AP}', 1, true, false, []],
    ['Reaction, 2 {AP}, Basic CAP', 2, true, true, []],
    ['Reaction,  1 {AP}', 1, true, false, []],
    ['Reaction, 2 {AP}, Basic CAP; The non-{AP} resources normally required for you to cast a spell of the same level.', 2, true, true, []],
    ['1 - 3 {AP}', { min: 1, max: 3 }, false, false, []],
    ['1-5 {AP}', { min: 1, max: 5 }, false, false, []],
    ['2–4 {AP}', { min: 2, max: 4 }, false, false, []],
    ['1 to 3 {AP}', { min: 1, max: 3 }, false, false, []],
    ['Varies', { min: 1, max: 5 }, false, false, []],
    ['Reaction, {AP} Varies', { min: 1, max: 5 }, true, false, []],
    ['1 minute', 0, false, false, []],
    ['Strike', 0, false, false, []],
    ['1 Prisma, 2 {AP}', 2, false, false, [{ name: 'Prisma', amount: 1 }]],
    ['1 Radiance, 2 {AP}', 2, false, false, [{ name: 'Radiance', amount: 1 }]],
    ['1 Favor, 2 {AP}', 2, false, false, [{ name: 'Favor', amount: 1 }]],
    ['1 Vitality (you don’t begin Dying), 2 {AP}', 2, false, false, [{ name: 'Vitality', amount: 1 }]],
    ['2 Will, 1 Stamina, 1 {AP}', 1, false, false, [{ name: 'Will', amount: 2 }, { name: 'Stamina', amount: 1 }]],
    ['3 Light, 1 Wonder, 2 {AP}', 2, false, false, [{ name: 'Light', amount: 3 }, { name: 'Wonder', amount: 1 }]],
    ['2 {AP}, or the {AP} listed in parentheses in the duration', 2, false, false, []],
    // The spell's own Cast Time is paid when it is cast.
    ['{SL} Prisma, {AP} in spell’s Cast Time', 0, false, false, []],
    ['{AP} in spells Cast Time', 0, false, false, []],
    ['{AP} equal to half the chosen level', 0, false, false, []],
    ['2 Prisma, {AP} in spell’s Cast Time', 0, false, false, [{ name: 'Prisma', amount: 2 }]],
    ['2 <span class="x">{AP}</span>', 2, false, false, []],
  ];
  it.each(cases)('%j', (text, ap, reaction, cap, resources) => {
    const c = parseCost(text);
    expect(c.ap).toEqual(ap);
    expect(c.reaction).toBe(reaction);
    expect(c.cap).toBe(cap);
    expect(c.resources).toEqual(resources);
    expect(isVariable(c)).toBe(typeof ap !== 'number');
  });

  it('every Cost / Cast Time / Execution Time in the rules content parses to a sane cost', () => {
    const texts = new Set<string>();
    const walk = (n: { fields?: Record<string, string>; children?: unknown[] }) => {
      for (const [k, v] of Object.entries(n.fields ?? {})) if (/^(Cost|Cast Time|Execution Time)$/.test(k)) texts.add(v);
      (n.children as typeof n[] | undefined)?.forEach(walk);
    };
    for (const id of ['spells', 'maneuvers', 'classes', 'beyond-the-prism']) {
      const n = getNode(id);
      if (n) walk(n as never);
    }
    for (const s of [...spells, ...maneuvers]) walk(s);
    expect(texts.size).toBeGreaterThan(10);
    for (const t of texts) {
      const c = parseCost(t);
      if (typeof c.ap === 'number') {
        expect(Number.isInteger(c.ap), t).toBe(true);
        expect(c.ap, t).toBeGreaterThanOrEqual(0);
        expect(c.ap, t).toBeLessThanOrEqual(10);
      } else {
        expect(c.ap.min, t).toBeLessThanOrEqual(c.ap.max);
        expect(c.ap.min, t).toBeGreaterThanOrEqual(0);
      }
      for (const r of c.resources) expect(r.amount, t).toBeGreaterThan(0);
      // "Reaction" is always the first word of a reaction cost line.
      expect(c.reaction, t).toBe(/^Reaction/.test(t));
    }
  });

  // Rules: "**Cost** :: 1 *Blood*, 1 $[AP], Basic CAP" (Iron Glide) and
  // "2 $[AP], 3 *Blood* unless …" — Blood is a cost the rules use, but it is
  // missing from costs.ts RESOURCES.
  it.fails('BUG: Blood costs from the rules are not parsed as a resource', () => {
    expect(parseCost('1 Blood, 1 {AP}, Basic CAP').resources).toEqual([{ name: 'Blood', amount: 1 }]);
  });

  // Rules: "**Cast Time** :: Varies, minimum 1 minute" is a ritual-length cast,
  // but parseCost turns any "Varies" into a 1–5 AP choice.
  it.fails('BUG: "Varies, minimum 1 minute" is read as a 1–5 AP cost', () => {
    expect(parseCost('Varies, minimum 1 minute').ap).toBe(0);
  });
});

// ===========================================================================
// scaling.ts
// ===========================================================================
describe('scaleText / resolveHtml', () => {
  const at = (text: string, level: number, charLevel = 1) => scaleText(text, { level, charLevel });

  // Rules: "Fire Spout … 3$[SL] plus 2 … at 1st level 5, at 2nd level 8".
  it('Fire Spout example from the rules: 3{SL} plus 2', () => {
    expect(at('3{SL} plus 2 Thermic damage.', 1)).toBe('5 Thermic damage.');
    expect(at('3{SL} plus 2 Thermic damage.', 2)).toBe('8 Thermic damage.');
  });
  it('{SL}, N{SL} and "N {SL}" (with a space, as the rules sometimes write it)', () => {
    expect(at('Movement increases by {SL}.', 3)).toBe('Movement increases by 3.');
    expect(at('2{SL} Resistance', 4)).toBe('8 Resistance');
    expect(at('2 {SL} Chthonic damage', 3)).toBe('6 Chthonic damage');
    expect(at('Thrown (10{SL}/20{SL})', 2)).toBe('Thrown (20/40)');
  });
  it('plus / minus fold, including chained arithmetic and negative results', () => {
    expect(at('{SL} plus 4', 5)).toBe('9');
    expect(at('Hindered {SL} minus 2', 3)).toBe('Hindered 1');
    expect(at('{SL} minus 2', 1)).toBe('-1');
    expect(at('{SL} plus 1 plus 2', 1)).toBe('4');
    expect(at('a {SL} minus 1-space-radius', 3)).toBe('a 2-space-radius');
    expect(at('2{SL} plus 8 (Combatant) or {SL} plus 7 (Mount)', 2)).toBe('12 (Combatant) or 9 (Mount)');
  });
  it('half {SL} rounds up by default (rules: "always round up")', () => {
    expect(at('half {SL}', 3)).toBe('2');
    expect(at('half {SL} plus 1 / {SL} plus 3', 5)).toBe('4 / 8');
    expect(at('Half {SL}', 1)).toBe('1');
  });
  it('"your level" means the character level, but not "your level of …"', () => {
    expect(at('add your level', 2, 7)).toBe('add 7');
    expect(at('Your level plus 1', 2, 7)).toBe('8');
    expect(at('attained your level of weapon mastery', 2, 7)).toBe('attained your level of weapon mastery');
  });
  it('text without scaling passes through unchanged', () => {
    expect(at('Nothing happens.', 4)).toBe('Nothing happens.');
  });

  // Rules: "**Failure** :: Panicked half $[SL], rounded down." — halving rounds
  // up "unless the effect says so specifically", and this one does.
  it.fails('BUG: "half {SL}, rounded down" still rounds up', () => {
    expect(at('Panicked half {SL}, rounded down.', 3)).toBe('Panicked 1, rounded down.');
  });

  it('resolveHtml swaps SL icons for highlighted numbers', () => {
    const icon = '<span class="ic ic-SL" role="img" aria-label="SL" title="SL"></span>';
    expect(resolveHtml(`4${icon} Crushing damage.`, { level: 3, charLevel: 1 })).toBe('<b class="calc">12</b> Crushing damage.');
    expect(resolveHtml(`${icon} plus 2`, { level: 2, charLevel: 1 })).toBe('<b class="calc">4</b>');
  });

  it('every spell and maneuver resolves at every level with no SL icon or NaN left', () => {
    const all = sample([...spells, ...maneuvers], 12);
    const levels = sample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
    for (const c of all) {
      const html = getNode(c.id)?.html ?? '';
      for (const level of levels) {
        const out = resolveHtml(html, { level, charLevel: 4 });
        expect(out, c.id).not.toMatch(/ic-SL/);
        expect(out, c.id).not.toMatch(/NaN|undefined/);
      }
    }
  });
});

describe('exaltedState / scaleHtml', () => {
  it('step entries count how many times they apply above the base level', () => {
    expect(exaltedState('Exalted (+1)', 1, 1)).toEqual({ kind: 'step', every: 1, times: 0 });
    expect(exaltedState('Exalted (+1)', 1, 4)).toEqual({ kind: 'step', every: 1, times: 3 });
    expect(exaltedState('Exalted (+2)', 1, 4)).toEqual({ kind: 'step', every: 2, times: 1 });
    expect(exaltedState('Exalted (+2)', 3, 2)).toEqual({ kind: 'step', every: 2, times: 0 });
  });
  it('"Nth" entries switch on at that level', () => {
    expect(exaltedState('Exalted (3rd)', 1, 2)).toEqual({ kind: 'at', level: 3, active: false });
    expect(exaltedState('Exalted (3rd)', 1, 3)).toEqual({ kind: 'at', level: 3, active: true });
    expect(exaltedState('Exalted (2nd)', 1, 5)?.kind).toBe('at');
    expect(exaltedState('exalted ( 4th )', 1, 4)).toEqual({ kind: 'at', level: 4, active: true });
    expect(exaltedState('Success', 1, 4)).toBeUndefined();
  });
  it('scaleHtml marks Exalted entries on/off with badges', () => {
    const html = '<dl class="defs"><div><dt>Exalted (+1)</dt><dd>x</dd></div><div><dt>Exalted (3rd)</dt><dd>y</dd></div><div><dt>Success</dt><dd>z</dd></div></dl>';
    const lo = scaleHtml(html, 1, { level: 1, charLevel: 1 });
    expect(lo).toContain('<div class="exalted off"><dt>Exalted (+1)</dt>');
    expect(lo).toContain('<div class="exalted off"><dt>Exalted (3rd)</dt>');
    expect(lo).toContain('<div><dt>Success</dt>');
    const hi = scaleHtml(html, 1, { level: 3, charLevel: 1 });
    expect(hi).toContain('<div class="exalted on"><dt>Exalted (+1) <span class="badge">×2</span></dt>');
    expect(hi).toContain('<div class="exalted on"><dt>Exalted (3rd) <span class="badge">active</span></dt>');
  });
});

describe('maxCastLevel / castCost', () => {
  const spell = (level: number): Castable => ({ id: 's', name: 'S', kind: 'spell', group: 'Arcana', type: 'Fire', tier: level ? 'Arcanum' : 'Cantrip', level, subtitle: '', fields: {} });
  const man = (level: number): Castable => ({ id: 'm', name: 'M', kind: 'maneuver', type: 'Feral', level, subtitle: '', fields: {} });

  it('maxCastLevel reads the class table "Max" column (at least 1)', () => {
    expect(maxCastLevel(undefined, 5)).toBe(1);
    for (const cls of classes) {
      for (let lvl = 1; lvl <= 10; lvl++) {
        const v = maxCastLevel(cls, lvl);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBe(Math.max(1, numeric(columnValue(cls, lvl, 'Max'))));
      }
    }
    // Arcanist Max Spell Level at 1st level is "1st".
    expect(maxCastLevel(getClass('arcanist'), 1)).toBe(1);
  });

  // Rules: spending equals the level (Stamina, Prisma, Light, Favor, Wonder);
  // Champions "expend Will equal to half its level" for maneuvers.
  it.each(classes.map((c) => c.id))('%s pays its class resource equal to the level', (id) => {
    const cls = getClass(id)!;
    const resource = cls.resources[0].name;
    for (let L = 1; L <= 5; L++) {
      const s = castCost(cls, spell(1), L, true);
      const m = castCost(cls, man(1), L, true);
      if (id === 'incarnate') expect(s).toBeUndefined();
      else expect(s).toEqual({ resource, amount: L });
      expect(m).toEqual({ resource, amount: id === 'champion' ? Math.ceil(L / 2) : L });
    }
  });
  it('cantrips/mantras, non-class sources and missing classes cost nothing', () => {
    const cls = getClass('arcanist')!;
    expect(castCost(cls, spell(0), 1, true)).toBeUndefined();
    expect(castCost(cls, spell(2), 2, false)).toBeUndefined();
    expect(castCost(undefined, spell(2), 2, true)).toBeUndefined();
    expect(castCost({ ...cls, resources: [] }, spell(2), 2, true)).toBeUndefined();
  });
  it('Champion maneuvers: half the level, rounded up', () => {
    const cls = getClass('champion')!;
    expect([1, 2, 3, 4, 5].map((L) => castCost(cls, man(1), L, true)?.amount)).toEqual([1, 1, 2, 2, 3]);
  });
  // Rules (Incarnate, Channel): "you can Exalt them by spending 1 Stamina per
  // Exalted level" — castCost returns no cost for any Incarnate spell.
  it.fails('BUG: Incarnate Channeled spells cost no Stamina when Exalted', () => {
    expect(castCost(getClass('incarnate')!, spell(1), 3, true)).toEqual({ resource: 'Stamina', amount: 2 });
  });
});

// ===========================================================================
// classInfo.ts
// ===========================================================================
describe('classInfo', () => {
  // From the rules' class pages ("You start with N Endurance and gain M per level", "#### Alignment").
  const EXPECTED: Record<string, { light: Light | 'choice' | null; start: number; perLevel: number; resource: string }> = {
    arcanist: { light: 'Lunar', start: 16, perLevel: 6, resource: 'Prisma' },
    berserker: { light: 'Soma', start: 26, perLevel: 16, resource: 'Stamina' },
    champion: { light: 'Infernal', start: 24, perLevel: 14, resource: 'Will' },
    expert: { light: 'Frost', start: 20, perLevel: 10, resource: 'Stamina' },
    gladiator: { light: 'Flame', start: 24, perLevel: 14, resource: 'Stamina' },
    incarnate: { light: 'Temporal', start: 20, perLevel: 10, resource: 'Stamina' },
    luminary: { light: null, start: 18, perLevel: 8, resource: 'Light' },
    thaumaturge: { light: 'Infernal', start: 20, perLevel: 10, resource: 'Favor' },
    troubadour: { light: 'choice', start: 20, perLevel: 10, resource: 'Wonder' },
  };
  it('covers every class', () => expect(classes.map((c) => c.id).sort()).toEqual(Object.keys(EXPECTED).sort()));
  it.each(Object.entries(EXPECTED))('%s: alignment, endurance, resource and table', (id, exp) => {
    const cls = getClass(id)!;
    expect(classAlignment(cls)).toBe(exp.light);
    expect(classEndurance(cls)).toEqual({ start: exp.start, perLevel: exp.perLevel });
    expect(cls.resources[0].name).toBe(exp.resource);
    const t = classTable(cls);
    expect(t.headers[0]).toBe('Level');
    expect(t.rows.length).toBeGreaterThanOrEqual(2);
    t.rows.forEach((r, i) => {
      expect(r.level).toBe(i + 1);
      expect(r.bonus).toBe(2); // +2 at 1st and 2nd level for every class
      expect(r.die).toMatch(/^1d\d+$/);
      expect(Object.keys(r.columns)).toEqual(t.headers);
    });
    expect(maxClassLevel(cls)).toBe(t.rows.length);
    expect(classRow(cls, 1)?.level).toBe(1);
    expect(classRow(cls, 99)).toBeUndefined();
    expect(columnValue(cls, 99, 'Max')).toBeUndefined();
    expect(columnValue(cls, 1, 'no-such-column')).toBeUndefined();
  });
  it('numeric parses ordinals and dashes', () => {
    expect(numeric('1st')).toBe(1);
    expect(numeric('12')).toBe(12);
    expect(numeric('—')).toBe(0);
    expect(numeric('-')).toBe(0);
    expect(numeric(undefined)).toBe(0);
  });
  it('alignmentFromText finds Lights and "of your choice"', () => {
    expect(alignmentFromText('You gain a level of Frost Alignment.')).toEqual([{ kind: 'alignment', light: 'Frost' }]);
    expect(alignmentFromText('<p>You gain a level of Flame, Frost, and Velvet Alignment.</p>')).toEqual([
      { kind: 'alignment', light: 'Flame' },
      { kind: 'alignment', light: 'Frost' },
      { kind: 'alignment', light: 'Velvet' },
    ]);
    expect(alignmentFromText('You gain a level of an Alignment of your choice.')).toEqual([{ kind: 'alignment', light: 'choice' }]);
    expect(alignmentFromText('Nothing to see.')).toEqual([]);
    expect(alignmentFromText(undefined)).toEqual([]);
  });
  it('facets are limited by level and subclasses resolve', () => {
    for (const cls of classes) {
      const f1 = classFacets(cls, 1);
      const f10 = classFacets(cls, 10);
      expect(f1.length).toBeGreaterThan(0);
      expect(f10.length).toBeGreaterThanOrEqual(f1.length);
      for (const f of f1) expect(f.level).toBeLessThanOrEqual(1);
      for (const f of f10) {
        expect(f.source).toBe(cls.name);
        expect(f.key).toBe(f.contentId);
        expect(Array.isArray(f.effects)).toBe(true);
      }
      const subs = subclassesOf(cls);
      expect(subs.length).toBeGreaterThan(0);
      for (const s of subs) for (const f of subclassFacets(cls, s.id, 10)) expect(f.source).toBe(s.name);
      expect(subclassFacets(cls, 'no-such-subclass', 10)).toEqual([]);
    }
    expect(getClass('nope')).toBeUndefined();
  });
});

// ===========================================================================
// exalted.ts
// ===========================================================================
describe('calculateCastable', () => {
  const node = (id: string) => {
    const html = getNode(id)?.html;
    const c = getCastable(id);
    if (!html || !c) throw new Error(`missing ${id}`);
    return { html, base: c.level };
  };
  const text = (html: string) => html.replace(/<[^>]+>/g, '');
  const outcome = (html: string, name: string) => {
    const m = html.match(new RegExp(`<div class="outcome"><dt>${name}</dt><dd>([\\s\\S]*?)</dd></div>`));
    return m ? text(m[1]) : undefined;
  };

  it('Savage Strike: "+1" and "+2" damage increases stack per Exalted level', () => {
    const { html, base } = node('maneuvers/feral/savage-strike');
    expect(base).toBe(1);
    const l1 = calculateCastable(html, base, { level: 1, charLevel: 1 });
    expect(outcome(l1.html, 'Success')).toBe('5 Crushing damage.');
    expect(l1.notes.every((n) => !n.active)).toBe(true);
    // Level 3: +1 applies twice (+3 each), +2 once (+3, Deadly Success only).
    const l3 = calculateCastable(html, base, { level: 3, charLevel: 1 });
    expect(outcome(l3.html, 'Success')).toBe('21 Crushing damage.');
    expect(outcome(l3.html, 'Deadly Success')).toBe('33 Crushing damage.');
    expect(l3.notes.map((n) => [n.label, n.active, n.merged, n.times])).toEqual([
      ['Exalted (+1)', true, true, 2],
      ['Exalted (+2)', true, true, undefined],
    ]);
  });

  it('Forceful Strike: "now as follows" swaps in the Exalted outcome block at 3rd', () => {
    const { html, base } = node('maneuvers/feral/forceful-strike');
    const l2 = calculateCastable(html, base, { level: 2, charLevel: 1 });
    expect(outcome(l2.html, 'Success')).toBe('8 Crushing damage.');
    expect((l2.html.match(/<div class="outcome"><dt>Success<\/dt>/g) ?? []).length).toBe(1);
    const n3 = l2.notes.find((n) => n.label === 'Exalted (3rd)')!;
    expect(n3.active).toBe(false);
    const l3 = calculateCastable(html, base, { level: 3, charLevel: 1 });
    expect(outcome(l3.html, 'Success')).toMatch(/^18 Crushing damage, and the target must Succeed/);
    expect(outcome(l3.html, 'Deadly Success')).toMatch(/^27 Crushing damage/);
    expect((l3.html.match(/<div class="outcome"><dt>Success<\/dt>/g) ?? []).length).toBe(1);
    expect(l3.notes.find((n) => n.label === 'Exalted (3rd)')).toMatchObject({ active: true, merged: true });
    expect(l3.notes.find((n) => n.label === 'Exalted (4th)')).toMatchObject({ active: false });
    // No Exalted <dt> is left inside the output lists.
    expect(l3.html).not.toMatch(/<dt>Exalted/);
  });

  const SYN =
    '<p>Intro {SL}.</p><dl class="defs"><div><dt>Success</dt><dd>Burning 1.</dd></div><div><dt>Deadly Success</dt><dd>Burning 2.</dd></div><div><dt>Failure</dt><dd>Nothing.</dd></div></dl>' +
    '<dl class="defs"><div><dt>Exalted (+1)</dt><dd>The Burning level of any Success increases by 1.</dd></div>' +
    '<div><dt>Exalted (3rd)</dt><dd>On a Failure, the target is Stunned 1.</dd></div>' +
    '<div><dt>Exalted (4th)</dt><dd>When you detonate the mote, it explodes.</dd></div></dl>';

  it('level-ups, condition additions and leftovers on synthetic text', () => {
    const r = calculateCastable(SYN, 1, { level: 4, charLevel: 1 });
    expect(r.html).toContain('Burning <b class="calc" title="+3 from Exalted (+1)">4</b>');
    expect(r.html).toContain('Burning <b class="calc" title="+3 from Exalted (+1)">5</b>');
    expect(outcome(r.html, 'Failure')).toBe('Stunned 1.');
    const left = r.notes.find((n) => n.label === 'Exalted (4th)')!;
    expect(left).toMatchObject({ active: true, merged: false });
    expect(left.html).toContain('When you detonate the mote, it explodes.');
    expect(r.notes.find((n) => n.label === 'Exalted (3rd)')).toMatchObject({ active: true, merged: true, html: 'Applied to the results above.' });
    expect(r.html).toContain('Intro <b class="calc">4</b>.');
  });
  it('at the base level nothing is merged and every entry is a preview', () => {
    const r = calculateCastable(SYN, 1, { level: 1, charLevel: 1 });
    expect(outcome(r.html, 'Success')).toBe('Burning 1.');
    expect(outcome(r.html, 'Failure')).toBe('Nothing.');
    expect(r.notes).toHaveLength(3);
    expect(r.notes.every((n) => !n.active && !n.merged)).toBe(true);
  });
  it('a castable with no Exalted entries is returned with no notes', () => {
    const html = '<dl class="defs"><div><dt>Success</dt><dd>3{SL} damage.</dd></div></dl>';
    const r = calculateCastable(html, 1, { level: 2, charLevel: 1 });
    expect(r.notes).toEqual([]);
    expect(r.html).toContain('<b class="calc">6</b> damage.');
  });
  it('every real spell/maneuver calculates at every level without throwing or losing outcomes', () => {
    for (const c of sample([...spells, ...maneuvers], 15)) {
      const html = getNode(c.id)?.html ?? '';
      const baseOutcomes = (html.match(/<dt>(Success|Deadly Success|Failure|Complete Failure|Critical Success|Complete Success|Deadly Failure)<\/dt>/g) ?? []).length;
      for (const level of sample([Math.max(1, c.level), 2, 3, 4, 5, 7, 10], 3)) {
        const r = calculateCastable(html, c.level, { level, charLevel: 3 });
        expect(r.html, c.id).not.toMatch(/NaN|undefined/);
        expect(r.html, c.id).not.toMatch(/<dt>Exalted/);
        if (baseOutcomes) expect(r.html, c.id).toMatch(/class="outcome"/);
        for (const n of r.notes) expect(n.html.length, `${c.id} ${n.label}`).toBeGreaterThan(0);
      }
    }
  });
});

// ===========================================================================
// homebrew.ts
// ===========================================================================
describe('homebrew', () => {
  let rowN = 0;
  const row = (effect: HomebrewEffect, over: Partial<HomebrewRow> = {}): HomebrewRow => ({ id: `r${++rowN}`, effect, ...over });
  const entry = (over: Partial<HomebrewEntry>): HomebrewEntry => ({ id: 'e1', kind: 'item', name: 'Moonblade', rows: [], ...over });
  const resolve = (entries: HomebrewEntry[], levels: Partial<Record<Light, number>> = {}, play: Partial<PlayState> = {}) =>
    resolveHomebrew(makeCharacter({ homebrew: entries, play }), (l) => levels[l] ?? 0);

  // One spec per HomebrewEffect kind, with its expected card text.
  const KINDS: [HomebrewEffect, string][] = [
    [{ kind: 'movement', amount: 2 }, 'Movement +2.'],
    [{ kind: 'movementType', type: 'Swim', amount: 'halfMovement' }, 'Swim Movement equal to half your Movement.'],
    [{ kind: 'attribute', attr: 'VIG', amount: 1 }, 'VIG Points +1.'],
    [{ kind: 'ac', amount: 1 }, 'AC +1.'],
    [{ kind: 'resistance', type: 'Thermic', amount: 2 }, 'Thermic Resistance 2.'],
    [{ kind: 'immunity', damage: 'Thermic' }, 'Immune to Thermic damage.'],
    [{ kind: 'alignment', light: 'Flame' }, '+1 Flame Alignment level.'],
    [{ kind: 'vulnerability', type: 'Slashing', dice: '1d4' }, 'Slashing Vulnerability 1d4.'],
    [{ kind: 'check', scope: 'all', attr: 'VIG', amount: 1 }, 'VIG Checks are Bolstered 1.'],
    [{ kind: 'initiativeTandem', die: 'class' }, 'Initiative Checks are rolled in Tandem with your Class Die.'],
    [{ kind: 'saveTandem', attr: 'AGI', die: 'class' }, 'AGI Save Checks are rolled in Tandem with your Class Die.'],
    [{ kind: 'saveEmpowered', attr: 'PRS' }, 'PRS Save Checks are Empowered.'],
    [{ kind: 'max', stat: 'endurance', amount: 5 }, 'Endurance maximum +5.'],
    [{ kind: 'sense', name: 'Darkvision' }, 'You gain Darkvision.'],
    [{ kind: 'weapon', bolster: 1 }, 'Weapon Attack Checks are Bolstered 1.'],
    [{ kind: 'restRule', rule: 'noRestCharges' }, 'You can’t spend Rest Charges.'],
    [{ kind: 'note', text: 'Glows near orcs.' }, 'Glows near orcs.'],
  ];
  const ALL_KINDS = ['movement', 'movementType', 'attribute', 'ac', 'resistance', 'immunity', 'alignment', 'vulnerability', 'check', 'initiativeTandem', 'saveTandem', 'saveEmpowered', 'max', 'sense', 'weapon', 'restRule', 'note'];

  it('the table above covers every HomebrewEffect kind', () => {
    expect(KINDS.map(([e]) => e.kind).sort()).toEqual([...ALL_KINDS].sort());
  });
  it.each(KINDS)('describeEffect(%j)', (spec, expected) => {
    const r = { entry: entry({}), stats: {} };
    const d = describeEffect(spec, r);
    expect(d).toBe(expected);
    expect(d.length).toBeGreaterThan(0);
  });

  describe('describeEffect variants', () => {
    const r = { entry: entry({}), stats: { PER: { points: 2, die: 'd4' } } };
    const d = (e: HomebrewEffect, rr: Parameters<typeof describeEffect>[1] = r) => describeEffect(e, rr);
    it('signs use a true minus', () => {
      expect(d({ kind: 'movement', amount: -1 })).toBe('Movement −1.');
      expect(d({ kind: 'ac', amount: 0 })).toBe('AC +0.');
      expect(d({ kind: 'max', stat: 'vitality', amount: -2 })).toBe('Vitality maximum −2.');
      expect(d({ kind: 'max', stat: 'radiance', amount: 1 })).toBe('Radiance maximum +1.');
    });
    it('movement types and immunities', () => {
      expect(d({ kind: 'movementType', type: 'Climb', amount: 'movement' })).toBe('Climb Movement equal to your Movement.');
      expect(d({ kind: 'immunity', condition: 'Bleeding' })).toBe('Immune to the Bleeding Condition.');
    });
    it('check scopes, Bolstered vs Hindered', () => {
      expect(d({ kind: 'check', scope: 'save', attr: 'AGI', amount: -2 })).toBe('AGI Save Checks are Hindered 2.');
      expect(d({ kind: 'check', scope: 'attribute', attr: 'INT', amount: 1 })).toBe('INT Attribute Checks are Bolstered 1.');
      expect(d({ kind: 'check', scope: 'attack', amount: 2 })).toBe('Attack Checks are Bolstered 2.');
      expect(d({ kind: 'check', scope: 'custom', text: 'Stealth Checks', amount: 1 })).toBe('Stealth Checks are Bolstered 1.');
      expect(d({ kind: 'check', scope: 'custom', amount: -1 })).toBe('Checks are Hindered 1.');
    });
    it('Tandem dice: class, attribute, the item’s own, missing', () => {
      expect(d({ kind: 'initiativeTandem', die: 'PER' })).toBe('Initiative Checks are rolled in Tandem with your PER Die.');
      expect(d({ kind: 'initiativeTandem', die: 'item:PER' })).toBe('Initiative Checks are rolled in Tandem with Moonblade PER Die (d4).');
      expect(d({ kind: 'saveTandem', attr: 'VIG', die: 'item:INT' })).toBe('VIG Save Checks are rolled in Tandem with a die.');
    });
    it('weapon rows', () => {
      const weapon = { entry: entry({ baseWeapon: 'Longsword' }), stats: { PER: { points: 2, die: 'd4' } } };
      expect(d({ kind: 'weapon', property: 'Heavy', die: 'item:PER', bolster: 1 }, weapon)).toBe(
        'With the Heavy property, Attack Checks with this weapon are rolled in Tandem with Moonblade PER Die (d4) and Bolstered 1.',
      );
      expect(d({ kind: 'weapon', bolster: -2, note: 'Sings.' })).toBe('Weapon Attack Checks are Hindered 2. Sings.');
      expect(d({ kind: 'weapon', note: 'Only at night.' })).toBe('Only at night.');
      expect(d({ kind: 'weapon', die: 'class' })).toBe('Weapon Attack Checks are rolled in Tandem with your Class Die.');
    });
    it('every rest rule has text', () => {
      for (const rule of ALL_REST_RULES) {
        expect(RULE_TEXT[rule]).toBeTruthy();
        expect(d({ kind: 'restRule', rule })).toBe(RULE_TEXT[rule]);
      }
      expect(Object.keys(RULE_TEXT).sort()).toEqual([...ALL_REST_RULES].sort());
    });
  });

  describe('toEffects (via resolveHomebrew)', () => {
    const effectsOf = (spec: HomebrewEffect, over: Partial<HomebrewEntry> = {}) => resolve([entry({ rows: [row(spec)], ...over })]).effects.map((x) => x.e);
    it('pass-through kinds become the same engine effect', () => {
      for (const [spec] of KINDS) {
        if (['alignment', 'max', 'check', 'initiativeTandem', 'saveTandem', 'weapon'].includes(spec.kind)) continue;
        expect(effectsOf(spec)).toEqual([spec]);
      }
    });
    it('alignment rows produce no effect here (counted in derive)', () => {
      expect(effectsOf({ kind: 'alignment', light: 'Lunar' })).toEqual([]);
    });
    it('max becomes the stat effect', () => {
      expect(effectsOf({ kind: 'max', stat: 'endurance', amount: 5 })).toEqual([{ kind: 'endurance', amount: 5 }]);
      expect(effectsOf({ kind: 'max', stat: 'vitality', amount: 1 })).toEqual([{ kind: 'vitality', amount: 1 }]);
      expect(effectsOf({ kind: 'max', stat: 'radiance', amount: 2 })).toEqual([{ kind: 'radiance', amount: 2 }]);
    });
    it('check scopes map to checks / bolster', () => {
      expect(effectsOf({ kind: 'check', scope: 'all', attr: 'VIG', amount: 1 })).toEqual([{ kind: 'checks', attrs: ['VIG'], save: false, amount: 1 }]);
      expect(effectsOf({ kind: 'check', scope: 'save', attr: 'AGI', amount: -1 })).toEqual([{ kind: 'checks', attrs: ['AGI'], save: true, amount: -1 }]);
      expect(effectsOf({ kind: 'check', scope: 'attribute', attr: 'INT', amount: 2 })).toEqual([{ kind: 'bolster', what: 'INT Attribute Checks', amount: 2 }]);
      expect(effectsOf({ kind: 'check', scope: 'attack', amount: 1 })).toEqual([{ kind: 'bolster', what: 'Attack Checks', amount: 1 }]);
      expect(effectsOf({ kind: 'check', scope: 'custom', text: 'Stealth', amount: 1 })).toEqual([{ kind: 'bolster', what: 'Stealth', amount: 1 }]);
      expect(effectsOf({ kind: 'check', scope: 'all', amount: 1 })).toEqual([{ kind: 'bolster', what: 'Checks', amount: 1 }]);
    });
    it('Tandem dice resolve to class / attribute / item die, or nothing when the item lacks the stat', () => {
      const stats = { PER: 3 } as HomebrewEntry['stats'];
      expect(effectsOf({ kind: 'initiativeTandem', die: 'class' })).toEqual([{ kind: 'tandem', what: 'Initiative Checks', die: 'class' }]);
      expect(effectsOf({ kind: 'initiativeTandem', die: 'AGI' })).toEqual([{ kind: 'tandem', what: 'Initiative Checks', die: 'AGI' }]);
      expect(effectsOf({ kind: 'initiativeTandem', die: 'item:PER' }, { stats })).toEqual([{ kind: 'tandem', what: 'Initiative Checks', die: { name: 'Moonblade PER', die: 'd6' } }]);
      expect(effectsOf({ kind: 'initiativeTandem', die: 'item:INT' }, { stats })).toEqual([]);
      expect(effectsOf({ kind: 'saveTandem', attr: 'VIG', die: 'class' })).toEqual([{ kind: 'saveTandem', attr: 'VIG', die: undefined }]);
      expect(effectsOf({ kind: 'saveTandem', attr: 'VIG', die: 'item:PER' }, { stats })).toEqual([{ kind: 'saveTandem', attr: 'VIG', die: { name: 'Moonblade PER', die: 'd6' } }]);
      expect(effectsOf({ kind: 'saveTandem', attr: 'VIG', die: 'item:INT' }, { stats })).toEqual([]);
    });
    it('weapon rows target the item’s own weapon only for items with a base weapon', () => {
      const stats = { PER: 2 } as HomebrewEntry['stats'];
      expect(effectsOf({ kind: 'weapon', property: 'Heavy', die: 'item:PER', bolster: 1, note: 'n' }, { baseWeapon: 'Longsword', stats })).toEqual([
        { kind: 'weapon', property: 'Heavy', weapon: 'Moonblade', tandemDie: { name: 'Moonblade PER', die: 'd4' }, bolster: 1, note: 'n' },
      ]);
      expect(effectsOf({ kind: 'weapon', property: '', note: '', bolster: 0 })).toEqual([
        { kind: 'weapon', property: undefined, weapon: undefined, tandemDie: undefined, bolster: undefined, note: undefined },
      ]);
      // An effect (boon) with a baseWeapon field still applies to any weapon.
      expect(effectsOf({ kind: 'weapon', bolster: 1 }, { kind: 'effect', baseWeapon: 'Longsword' })[0]).toMatchObject({ weapon: undefined });
    });
    it('effects carry the entry name as their source', () => {
      const r = resolve([entry({ name: 'Ring', rows: [row({ kind: 'ac', amount: 1 })] })]);
      expect(r.effects).toEqual([{ e: { kind: 'ac', amount: 1 }, source: 'Ring' }]);
    });
  });

  describe('tiers', () => {
    it('TIER_NAMES follow the rules’ Alignment Levels table', () => {
      expect(TIER_NAMES).toEqual(['None', 'Weak', 'Firm', 'Strong']);
    });
    it('tier comes from the tierLight Alignment level, capped at Strong (3)', () => {
      for (let lvl = 0; lvl <= 6; lvl++) {
        const [card] = resolve([entry({ tierLight: 'Lunar' })], { Lunar: lvl, Flame: 3 }).cards;
        expect(card.tier).toBe(Math.min(3, lvl));
      }
      // No tier Light: always tier 0, whatever your Alignments are.
      expect(resolve([entry({})], { Lunar: 3 }).cards[0].tier).toBe(0);
    });
    it('atTier reads arrays per tier and scalars at every tier', () => {
      expect(atTier(undefined, 2)).toBeUndefined();
      expect(atTier(4, 0)).toBe(4);
      expect(atTier(4, 3)).toBe(4);
      expect([0, 1, 2, 3].map((t) => atTier([1, 2, 3, 5], t))).toEqual([1, 2, 3, 5]);
    });
    it('minTier/maxTier gate rows; rowApplies is the same rule', () => {
      const rows = [
        row({ kind: 'ac', amount: 1 }),
        row({ kind: 'ac', amount: 2 }, { minTier: 2 }),
        row({ kind: 'ac', amount: 3 }, { maxTier: 1 }),
        row({ kind: 'ac', amount: 4 }, { minTier: 1, maxTier: 2 }),
      ];
      const want: Record<number, number[]> = { 0: [1, 3], 1: [1, 3, 4], 2: [1, 2, 4], 3: [1, 2] };
      for (let t = 0; t <= 3; t++) {
        const e = entry({ tierLight: 'Frost', rows });
        const [card] = resolve([e], { Frost: t }).cards;
        expect(card.applied.map((r) => (r.effect as { amount: number }).amount)).toEqual(want[t]);
        expect(card.inactive.length + card.applied.length).toBe(rows.length);
        for (const r of rows) expect(rowApplies(r, e, t)).toBe(card.applied.includes(r));
      }
    });
    it('per-tier level and stats → Mod Die', () => {
      const e = entry({ tierLight: 'Velvet', level: [0, 2, 4, 6], stats: { PER: [0, 1, 3, 6], INT: 2, VIG: [0, 0, -2, 8] } });
      const at = (t: number) => resolve([e], { Velvet: t }).cards[0];
      expect(at(0).level).toBe(0);
      expect(at(0).stats).toEqual({ PER: { points: 0, die: '—' }, INT: { points: 2, die: 'd4' }, VIG: { points: 0, die: '—' } });
      expect(at(2).stats.PER).toEqual({ points: 3, die: 'd6' });
      expect(at(2).stats.VIG).toEqual({ points: -2, die: '-d4' });
      expect(at(3).level).toBe(6);
      expect(at(3).stats).toEqual({ PER: { points: 6, die: 'd12' }, INT: { points: 2, die: 'd4' }, VIG: { points: 8, die: 'd12+2' } });
      expect(resolve([entry({})]).cards[0].level).toBeUndefined();
      expect(resolve([entry({})]).cards[0].stats).toEqual({});
    });
  });

  describe('situations', () => {
    it('onPerson rows stop while the item is in a backpack; always rows keep going', () => {
      const rows = [row({ kind: 'ac', amount: 1 }, { when: 'onPerson' }), row({ kind: 'ac', amount: 2 }, { when: 'always' }), row({ kind: 'ac', amount: 3 })];
      expect(resolve([entry({ rows })]).effects.map((x) => (x.e as { amount: number }).amount)).toEqual([1, 2, 3]);
      expect(resolve([entry({ rows, inBackpack: true })]).effects.map((x) => (x.e as { amount: number }).amount)).toEqual([2, 3]);
    });
    it('attunement: an unattuned item applies nothing; attuned or non-attunement items apply', () => {
      const rows = [row({ kind: 'ac', amount: 1 })];
      const un = resolve([entry({ rows, attunement: true })]).cards[0];
      expect(un.active).toBe(false);
      expect(un.applied).toEqual([]);
      expect(un.inactive).toEqual(rows);
      expect(resolve([entry({ rows, attunement: true, attuned: true })]).effects).toHaveLength(1);
      expect(resolve([entry({ rows, attuned: false })]).effects).toHaveLength(1);
    });
    it('effects and facets are always active (attunement only applies to items)', () => {
      for (const kind of ['effect', 'facet'] as const) {
        const [card] = resolve([entry({ kind, attunement: true, rows: [row({ kind: 'ac', amount: 1 })] })]).cards;
        expect(card.active).toBe(true);
        expect(card.applied).toHaveLength(1);
      }
    });
    it('onSpend rows never apply passively', () => {
      const [card] = resolve([entry({ rows: [row({ kind: 'ac', amount: 1 }, { onSpend: 'p' })] })]).cards;
      expect(card.applied).toEqual([]);
      expect(card.inactive).toHaveLength(1);
    });
    it('no homebrew → nothing', () => {
      expect(resolve([])).toEqual({ cards: [], effects: [] });
      const c = makeCharacter();
      expect(resolveHomebrew({ ...c, homebrew: undefined as unknown as HomebrewEntry[] }, () => 3)).toEqual({ cards: [], effects: [] });
    });
  });

  describe('pools', () => {
    const pools = [
      { id: 'p1', name: 'Charge', max: [1, 2, 3, 4] as [number, number, number, number], refresh: 'Rest' as const },
      { id: 'p2', name: 'Blood', max: 2, refresh: 'Long Rest' as const },
    ];
    it('max per tier, spent from facetUses under hb:<entry>:<pool>', () => {
      expect(poolKey('e1', 'p1')).toBe('hb:e1:p1');
      const [card] = resolve([entry({ tierLight: 'Soma', pools })], { Soma: 2 }, { facetUses: { 'hb:e1:p1': 1 } }).cards;
      expect(card.pools).toEqual([
        { id: 'p1', name: 'Charge', key: 'hb:e1:p1', max: 3, spent: 1, refresh: 'Rest' },
        { id: 'p2', name: 'Blood', key: 'hb:e1:p2', max: 2, spent: 0, refresh: 'Long Rest' },
      ]);
    });
    it('spendPool adds one end-of-turn reminder per matching onSpend row at the current tier', () => {
      const rows = [
        row({ kind: 'note', text: 'Tier 2+ burst.' }, { onSpend: 'p1', minTier: 2 }),
        row({ kind: 'note', text: 'Low-tier burst.' }, { onSpend: 'p1', maxTier: 1 }),
        row({ kind: 'ac', amount: 2 }, { onSpend: 'p1' }),
        row({ kind: 'note', text: 'Other pool.' }, { onSpend: 'p2' }),
        row({ kind: 'note', text: 'Passive.' }),
      ];
      const c = makeCharacter({ homebrew: [entry({ tierLight: 'Soma', pools, rows })], play: { facetUses: { 'hb:e1:p1': 1 }, effects: [] } });
      const [card] = resolveHomebrew(c, () => 2).cards;
      const before = JSON.stringify(c.play);
      const { play, log } = spendPool(c.play, card, 'p1');
      expect(JSON.stringify(c.play)).toBe(before); // input untouched
      expect(play.facetUses['hb:e1:p1']).toBe(2);
      expect(log).toEqual(['Spent 1 Charge from Moonblade (1 left).', 'Tier 2+ burst.', 'AC +2.']);
      expect(play.effects).toHaveLength(2);
      for (const e of play.effects!) {
        expect(e.ends).toBe('endOfTurn');
        expect(e.name).toBe('Moonblade');
        expect(e.id).toMatch(/^[a-z0-9]+$/);
      }
      expect(play.effects!.map((e) => e.notes)).toEqual([['Tier 2+ burst.'], ['AC +2.']]);
    });
    it('spendPool keeps existing effects, and at tier 0 picks the low-tier rows', () => {
      const rows = [row({ kind: 'note', text: 'Hi.' }, { onSpend: 'p1', minTier: 2 }), row({ kind: 'note', text: 'Lo.' }, { onSpend: 'p1', maxTier: 1 })];
      const existing = { id: 'x', name: 'Rage', ends: 'manual' as const };
      const c = makeCharacter({ homebrew: [entry({ tierLight: 'Soma', pools, rows })], play: { effects: [existing] } });
      const [card] = resolveHomebrew(c, () => 0).cards;
      const { play, log } = spendPool(c.play, card, 'p1');
      expect(play.effects!.map((e) => e.name)).toEqual(['Rage', 'Moonblade']);
      expect(log).toEqual(['Spent 1 Charge from Moonblade (0 left).', 'Lo.']);
    });
    it('an unknown pool changes nothing; an unattuned item spends but adds no reminders', () => {
      const rows = [row({ kind: 'note', text: 'Burst.' }, { onSpend: 'p2' })];
      const c = makeCharacter({ homebrew: [entry({ pools, rows, attunement: true })] });
      const [card] = resolveHomebrew(c, () => 0).cards;
      const none = spendPool(c.play, card, 'nope');
      expect(none.play).toBe(c.play);
      expect(none.log).toEqual([]);
      const { play, log } = spendPool(c.play, card, 'p2');
      expect(play.facetUses['hb:e1:p2']).toBe(1);
      expect(play.effects ?? []).toEqual([]);
      expect(log).toEqual(['Spent 1 Blood from Moonblade (1 left).']);
    });
  });

  describe('homebrewAlignments', () => {
    const al = (e: HomebrewEntry) => makeCharacter({ homebrew: [e] });
    it('facets, effects and attuned items grant Alignment levels regardless of tier', () => {
      const rows = [row({ kind: 'alignment', light: 'Lunar' }, { minTier: 3 }), row({ kind: 'alignment', light: 'Flame' }), row({ kind: 'ac', amount: 1 })];
      for (const kind of ['facet', 'effect'] as const)
        expect(homebrewAlignments(al(entry({ kind, name: 'Boon', rows })))).toEqual([
          { light: 'Lunar', source: 'Boon' },
          { light: 'Flame', source: 'Boon' },
        ]);
      expect(homebrewAlignments(al(entry({ rows, attunement: true, attuned: true })))).toHaveLength(2);
      expect(homebrewAlignments(al(entry({ rows })))).toHaveLength(2);
    });
    it('not when unattuned, onSpend, or onPerson while in a backpack', () => {
      const rows = [row({ kind: 'alignment', light: 'Lunar' })];
      expect(homebrewAlignments(al(entry({ rows, attunement: true })))).toEqual([]);
      expect(homebrewAlignments(al(entry({ rows: [row({ kind: 'alignment', light: 'Lunar' }, { onSpend: 'p' })] })))).toEqual([]);
      expect(homebrewAlignments(al(entry({ inBackpack: true, rows: [row({ kind: 'alignment', light: 'Lunar' }, { when: 'onPerson' })] })))).toEqual([]);
      expect(homebrewAlignments(al(entry({ inBackpack: true, rows })))).toEqual([{ light: 'Lunar', source: 'Moonblade' }]);
    });
    it('every Light can be granted', () => {
      const c = makeCharacter({ homebrew: [entry({ kind: 'facet', rows: LIGHTS.map((l) => row({ kind: 'alignment', light: l })) })] });
      expect(homebrewAlignments(c).map((x) => x.light)).toEqual([...LIGHTS]);
    });
  });

  it('newHomebrew defaults per kind', () => {
    expect(newHomebrew('item', 'a')).toEqual({ id: 'a', kind: 'item', name: 'New item', rows: [] });
    expect(newHomebrew('facet', 'b')).toEqual({ id: 'b', kind: 'facet', name: 'New facet', rows: [] });
    expect(newHomebrew('effect', 'c')).toEqual({ id: 'c', kind: 'effect', name: 'New effect', rows: [], ends: 'manual' });
    const [card] = resolveHomebrew(makeCharacter({ homebrew: [newHomebrew('item', 'a')] }), () => 3).cards;
    expect(card).toMatchObject({ tier: 0, active: true, applied: [], inactive: [], pools: [], stats: {} });
  });

  it('resolveDie', () => {
    const r = { entry: entry({}), stats: { PER: { points: 1, die: 'd2' } } };
    expect(resolveDie(undefined, r)).toBeUndefined();
    expect(resolveDie('class', r)).toBe('class');
    expect(resolveDie('VIG', r)).toBe('VIG');
    expect(resolveDie('item:PER', r)).toEqual({ name: 'Moonblade PER', die: 'd2' });
    expect(resolveDie('item:AGI', r)).toBeUndefined();
  });

  it('export/import: entries are plain JSON and round-trip to identical resolution', () => {
    const r = rng(42);
    const LIGHT_LIST = [...LIGHTS];
    const n = QA ? 20 : 300;
    for (let i = 0; i < n; i++) {
      const rows: HomebrewRow[] = Array.from({ length: int(r, 0, 6) }, () => {
        const [spec] = pick(r, KINDS);
        const over: Partial<HomebrewRow> = {};
        if (r() < 0.3) over.minTier = int(r, 0, 3);
        if (r() < 0.3) over.maxTier = int(r, 0, 3);
        if (r() < 0.3) over.when = pick(r, ['always', 'onPerson'] as const);
        if (r() < 0.2) over.onSpend = 'p1';
        return row(spec, over);
      });
      const e: HomebrewEntry = {
        id: `e${i}`,
        kind: pick(r, ['item', 'effect', 'facet'] as const),
        name: `Thing ${i}`,
        rows,
        tierLight: r() < 0.7 ? pick(r, LIGHT_LIST) : undefined,
        attunement: r() < 0.4,
        attuned: r() < 0.5,
        inBackpack: r() < 0.3,
        stats: r() < 0.5 ? { PER: [0, 1, 2, 3], INT: int(r, -2, 8) } : undefined,
        level: r() < 0.5 ? [1, 2, 3, 4] : undefined,
        pools: r() < 0.5 ? [{ id: 'p1', name: 'Charge', max: [0, 1, 2, 3], refresh: 'Rest' }] : undefined,
      };
      const levels = Object.fromEntries(LIGHT_LIST.map((l) => [l, int(r, 0, 4)])) as Record<Light, number>;
      const json = JSON.parse(JSON.stringify(e)) as HomebrewEntry;
      // Only undefined fields may be dropped by JSON.
      expect(json).toEqual(JSON.parse(JSON.stringify(json)));
      const a = resolve([e], levels);
      const b = resolve([json], levels);
      expect(JSON.parse(JSON.stringify(b))).toEqual(JSON.parse(JSON.stringify(a)));
      expect(homebrewAlignments(makeCharacter({ homebrew: [json] }))).toEqual(homebrewAlignments(makeCharacter({ homebrew: [e] })));
      for (const card of a.cards) for (const rr of card.entry.rows) expect(describeEffect(rr.effect, card).length).toBeGreaterThan(0);
    }
  });

  it('homebrew survives normalizeCharacter (save / import)', () => {
    const e = entry({ rows: [row({ kind: 'ac', amount: 1 })] });
    const c = normalizeCharacter(JSON.parse(JSON.stringify(makeCharacter({ homebrew: [e] }))));
    expect(c.homebrew).toEqual([e]);
    expect(normalizeCharacter({}).homebrew).toEqual([]);
  });
});

// ===========================================================================
// inventory.ts
// ===========================================================================
describe('inventory', () => {
  let idN = 0;
  const item = (bulk: number | undefined, over: Partial<InventoryItem> = {}): InventoryItem => ({ id: `i${++idN}`, name: `Item ${idN}`, qty: 1, bulk, ...over });
  const capacity = (rank: number, vig: number) => rank + (vig >= rank ? rank : 0);
  const placed = (l: BulkLayout) => l.rows.flatMap((r) => r.slots.filter((s) => s.item).map((s) => ({ rank: r.rank, item: s.item!, bonus: s.bonus })));

  describe('layoutBulk structure', () => {
    it('rank r has r slots plus r bonus slots unlocked at r VIG (rules: Bulk)', () => {
      for (const vig of [-1, 0, 1, 2, 3, 4, 5, 6]) {
        const l = layoutBulk([], vig);
        expect(l.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
        for (const r of l.rows) {
          expect(r.slots.filter((s) => !s.bonus)).toHaveLength(r.rank);
          expect(r.slots.filter((s) => s.bonus)).toHaveLength(r.rank);
          expect(r.slots.filter((s) => !s.bonus).every((s) => !s.locked)).toBe(true);
          expect(r.slots.filter((s) => s.bonus).every((s) => s.locked === vig < r.rank)).toBe(true);
        }
        expect(l.overflow).toEqual([]);
      }
    });
    // Rules: "with 1 VIG Point, you can carry an additional Bulk 1 item. With 2,
    // you can carry two additional Bulk 2 items."
    it('VIG examples from the rules', () => {
      expect(layoutBulk([item(1, { qty: 2 })], 0).overflow).toHaveLength(1);
      expect(layoutBulk([item(1, { qty: 2 })], 1).overflow).toHaveLength(0);
      expect(layoutBulk([item(1, { qty: 3 })], 1).overflow).toHaveLength(1);
      // Two Bulk 2 slots + two bonus Bulk 2 slots + (with 2 VIG) the bonus Bulk 1 slot and normal Bulk 1 slot.
      expect(layoutBulk([item(2, { qty: 4 })], 1).overflow).toHaveLength(0); // 2 + 1 + 1 (rank-1 normal and bonus)
      expect(layoutBulk([item(2, { qty: 6 })], 2).overflow).toHaveLength(0);
      expect(layoutBulk([item(2, { qty: 7 })], 2).overflow).toHaveLength(1);
    });
    // Rules: "you could have three Bulk 2 items on your person, but if you do,
    // you can't stow a Bulk 1 item".
    it('three Bulk 2 items take the Bulk 1 slot (rules example)', () => {
      const three = layoutBulk([item(2, { qty: 3 })], 0);
      expect(three.overflow).toEqual([]);
      expect(three.rows[0].slots[0].item?.bulk).toBe(2);
      const plusOne = layoutBulk([item(2, { qty: 3 }), item(1)], 0);
      expect(plusOne.overflow).toHaveLength(1);
      // A Bulk 1 item can never use a Bulk 2 slot.
      const ones = layoutBulk([item(1, { qty: 2 })], 0);
      expect(ones.rows[1].slots.every((s) => !s.item)).toBe(true);
    });
    it('items without Bulk, Bulk 0 and qty ≤ 0 take no slots', () => {
      const l = layoutBulk([item(undefined, { qty: 50 }), item(0, { qty: 3 }), item(3, { qty: 0 }), item(3, { qty: -2 })], 0);
      expect(placed(l)).toEqual([]);
      expect(l.overflow).toEqual([]);
    });
    it('Bulk past 5 counts as 5', () => {
      const l = layoutBulk([item(9)], 0);
      expect(placed(l)[0].rank).toBe(5);
    });
    it('most constrained first: a Bulk 1 item listed last still gets the Bulk 1 slot', () => {
      const l = layoutBulk([item(2, { qty: 2 }), item(1)], 0);
      expect(l.overflow).toEqual([]);
      expect(l.rows[0].slots[0].item?.bulk).toBe(1);
    });
  });

  describe('Powerful Build (effectiveBulk)', () => {
    // Rules: "The Bulk Rank of items you carry on your person (not in a backpack)
    // is decreased by 1 (minimum 5)."
    it('shifts items on your person by the amount, capped at 5', () => {
      expect([1, 2, 3, 4, 5].map((b) => effectiveBulk(item(b), 1))).toEqual([2, 3, 4, 5, 5]);
      expect(effectiveBulk(item(2), 0)).toBe(2);
      expect(effectiveBulk(item(1), 7)).toBe(5);
      expect(effectiveBulk(item(undefined), 1)).toBeUndefined();
      expect(effectiveBulk(item(0), 1)).toBeUndefined();
    });
    it('does not shift items in a backpack or stored in a container', () => {
      expect(effectiveBulk(item(2, { inBackpack: true }), 1)).toBe(2);
      expect(effectiveBulk(item(2, { storedIn: 'bag' }), 1)).toBe(2);
    });
    it('a shifted Bulk 1 item uses a Bulk 2 slot, leaving the Bulk 1 slot free', () => {
      const l = layoutBulk([item(1), item(1, { inBackpack: true })], 0, 1);
      expect(l.overflow).toEqual([]);
      expect(placed(l).map((p) => [p.rank, p.item.inBackpack ?? false])).toEqual([
        [1, true],
        [2, false],
      ]);
    });
    // groupInventory puts items whose container is gone back on your person,
    // but effectiveBulk still treats them as stored (no Powerful Build).
    it.fails('BUG: items whose container was removed fall back to your person but miss Powerful Build', () => {
      const orphan = item(2, { storedIn: 'deleted-bag' });
      const { person } = groupInventory([orphan]);
      expect(person).toEqual([orphan]);
      expect(effectiveBulk(orphan, 1)).toBe(3);
    });
  });

  describe('groupInventory / layoutContainer', () => {
    it('splits person and containers; missing containers fall back; containers cannot nest', () => {
      const bag = item(2, { container: true, name: 'Bag' });
      const box = item(1, { container: true, name: 'Box', storedIn: bag.id });
      const inBag = item(3, { storedIn: bag.id });
      const inBox = item(4, { storedIn: box.id });
      const orphan = item(3, { storedIn: 'gone' });
      const pointsAtItem = item(3, { storedIn: inBag.id }); // not a container
      const loose = item(5);
      const g = groupInventory([bag, box, inBag, inBox, orphan, pointsAtItem, loose]);
      expect(g.person.map((i) => i.id)).toEqual([bag, box, orphan, pointsAtItem, loose].map((i) => i.id));
      expect(g.containers.map((c) => [c.item.id, c.contents.map((i) => i.id)])).toEqual([
        [bag.id, [inBag.id]],
        [box.id, [inBox.id]],
      ]);
    });
    it('every item lands in exactly one place', () => {
      const r = rng(7);
      for (let n = 0; n < (QA ? 30 : 300); n++) {
        const items: InventoryItem[] = [];
        for (let k = 0; k < int(r, 0, 12); k++) {
          const ids = items.map((i) => i.id);
          items.push(item(int(r, 0, 5), { container: r() < 0.2 || undefined, storedIn: r() < 0.5 ? pick(r, [...ids, 'ghost']) : undefined }));
        }
        const g = groupInventory(items);
        const all = [...g.person, ...g.containers.flatMap((c) => c.contents)].map((i) => i.id).sort();
        expect(all).toEqual(items.map((i) => i.id).sort());
        for (const c of g.containers) {
          expect(c.item.container).toBe(true);
          for (const i of c.contents) {
            expect(i.container).toBeFalsy();
            expect(i.storedIn).toBe(c.item.id);
          }
        }
        for (const i of items.filter((x) => x.container)) expect(g.person).toContain(i);
      }
    });
    it('a container pyramid has no bonus slots and ignores Powerful Build', () => {
      const l = layoutContainer([item(1, { qty: 2 }), item(5, { qty: 6 })]);
      for (const r of l.rows) {
        expect(r.slots).toHaveLength(r.rank);
        expect(r.slots.every((s) => !s.bonus && !s.locked)).toBe(true);
      }
      // The second Bulk 1 item has nowhere to go (no bonus Bulk 1 slot); the six Bulk 5 items fit.
      expect(l.overflow.map((i) => i.bulk)).toEqual([1]);
    });
  });

  // Property tests over seeded random inventories.
  describe('layout properties', () => {
    const N = QA ? 30 : 500;
    const r = rng(20261019);
    const cases = Array.from({ length: N }, (_, n) => {
      const items = Array.from({ length: int(r, 0, 14) }, () =>
        item(r() < 0.1 ? pick(r, [undefined, 0, 6]) : int(r, 1, 5), { qty: int(r, -1, 5), inBackpack: r() < 0.3 || undefined }),
      );
      return { n, items, vig: int(r, -1, 6), shift: pick(r, [0, 0, 1, 2]) };
    });

    it(`${N} random inventories: slots, counts and optimality`, () => {
      for (const { n, items, vig, shift } of cases) {
        const tag = `case ${n} vig=${vig} shift=${shift}`;
        const l = layoutBulk(items, vig, shift);
        const units = items.filter((i) => i.bulk && i.qty > 0);
        const total = units.reduce((s, i) => s + i.qty, 0);
        const p = placed(l);

        // placed + overflow == total units, per item and overall (no item placed twice).
        expect(p.length + l.overflow.length, tag).toBe(total);
        for (const it of units) {
          const k = p.filter((x) => x.item === it).length + l.overflow.filter((x) => x === it).length;
          expect(k, `${tag} ${it.id}`).toBe(it.qty);
        }
        // Nothing with no Bulk / qty ≤ 0 shows up.
        for (const x of [...p.map((q) => q.item), ...l.overflow]) expect(units).toContain(x);

        for (const s of p) {
          // An item may use its own rank's slot or a slot of a lower rank number
          // (bigger items' slots), never a higher rank number.
          expect(s.rank, tag).toBeLessThanOrEqual(effectiveBulk(s.item, shift)!);
        }
        for (const row of l.rows) for (const s of row.slots) if (s.locked) expect(s.item, tag).toBeUndefined();
        // Rows never hold more items than their capacity.
        for (const row of l.rows) expect(row.slots.filter((s) => s.item).length).toBeLessThanOrEqual(capacity(row.rank, vig));

        // Overflowing items had no free unlocked slot they were allowed to use.
        for (const o of l.overflow) {
          const eb = effectiveBulk(o, shift)!;
          for (const row of l.rows.filter((rr) => rr.rank <= eb)) expect(row.slots.some((s) => !s.locked && !s.item), tag).toBe(false);
        }

        // The overflow is the minimum possible (max matching for nested ranks).
        const count = [0, 0, 0, 0, 0, 0];
        for (const it of units) count[effectiveBulk(it, shift)!] += it.qty;
        let fit = 0;
        let cap = 0;
        for (let k = 1; k <= 5; k++) {
          cap += capacity(k, vig);
          fit = Math.min(fit + count[k], cap);
        }
        expect(l.overflow.length, tag).toBe(total - fit);

        // Container layout of the same items: same rules with no VIG and no shift.
        const c = layoutContainer(items);
        const cp = placed(c);
        expect(cp.length + c.overflow.length).toBe(total);
        expect(cp.every((s) => !s.bonus && s.rank <= Math.min(5, s.item.bulk!))).toBe(true);
      }
    });

    it('more VIG never overflows more; more Powerful Build never overflows more', () => {
      for (const { items, vig, shift } of cases.slice(0, QA ? 15 : 200)) {
        const base = layoutBulk(items, vig, shift).overflow.length;
        expect(layoutBulk(items, vig + 1, shift).overflow.length).toBeLessThanOrEqual(base);
        expect(layoutBulk(items, vig, shift + 1).overflow.length).toBeLessThanOrEqual(base);
      }
    });
  });
});

// ===========================================================================
// storage/storage.ts
// ===========================================================================
describe('storage', () => {
  const KEY = 'btp.characters.v1';
  let ls: FakeStorage;
  beforeEach(() => {
    ls = new FakeStorage();
    vi.stubGlobal('localStorage', ls);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const load = async () => {
    vi.resetModules();
    return import('../src/storage/storage');
  };
  const char = (name: string, updatedAt: string, over: Partial<Character> = {}) => ({ ...makeCharacter({ name, ...over }), updatedAt });

  it('starts empty, saves, lists newest first and gets normalised copies', async () => {
    const { LocalStore } = await load();
    const s = new LocalStore();
    expect(s.list()).toEqual([]);
    expect(s.get('nope')).toBeUndefined();
    const a = char('Ann', '2026-01-01T00:00:00.000Z', { level: 2, ancestry: 'human', classId: 'arcanist' });
    const b = char('Bob', '2026-03-01T00:00:00.000Z');
    s.save(a);
    s.save(b);
    expect(s.list()).toEqual([
      { id: b.id, name: 'Bob', level: 1, ancestry: '', classId: '', updatedAt: b.updatedAt },
      { id: a.id, name: 'Ann', level: 2, ancestry: 'human', classId: 'arcanist', updatedAt: a.updatedAt },
    ]);
    expect(s.get(a.id)).toEqual(normalizeCharacter(a));
    // Persisted under the versioned key, readable by a fresh store.
    expect(Object.keys(JSON.parse(ls.data.get(KEY)!))).toEqual([a.id, b.id]);
    expect(new LocalStore().get(b.id)?.name).toBe('Bob');
  });

  it('save replaces by id; remove deletes', async () => {
    const { LocalStore } = await load();
    const s = new LocalStore();
    const a = char('Ann', '2026-01-01T00:00:00.000Z');
    s.save(a);
    s.save({ ...a, name: 'Anne' });
    expect(s.list().map((x) => x.name)).toEqual(['Anne']);
    s.remove(a.id);
    expect(s.list()).toEqual([]);
    expect(new LocalStore().list()).toEqual([]);
    s.remove('not-there'); // no throw
  });

  it('normalises older saves on load', async () => {
    ls.data.set(
      KEY,
      JSON.stringify({
        old: {
          id: 'old',
          name: 'Old',
          level: 3,
          updatedAt: '2025-05-05T00:00:00.000Z',
          details: { notes: 'Met a dragon.' },
          experiences: ['Saved the town'],
          play: { conditions: [{ name: 'Defeaned' }, { name: 'Possesed', level: 2 }] },
        },
      }),
    );
    const { LocalStore } = await load();
    const s = new LocalStore();
    expect(s.list()).toEqual([{ id: 'old', name: 'Old', level: 3, ancestry: undefined, classId: undefined, updatedAt: '2025-05-05T00:00:00.000Z' }]);
    const c = s.get('old')!;
    expect(c.version).toBe(1);
    expect(c.homebrew).toEqual([]);
    expect(c.equipment.inventory).toEqual([]);
    expect(c.attributes.base).toEqual({ VIG: -1, AGI: -1, PER: -1, INT: -1, PRS: -1 });
    expect(c.play.conditions).toEqual([{ name: 'Deafened' }, { name: 'Possessed', level: 2 }]);
    expect(c.experiences).toMatchObject([{ name: 'Saved the town', uses: 1, used: 0, effect: '' }]);
    expect(c.sessions).toMatchObject([{ title: 'Earlier notes', date: '2025-05-05', body: 'Met a dragon.' }]);
    expect(c.play.facetUses).toEqual({});
  });

  it('corrupt JSON or unreadable storage reads as empty, and saving then works', async () => {
    ls.data.set(KEY, '{not json');
    const { LocalStore } = await load();
    const s = new LocalStore();
    expect(s.list()).toEqual([]);
    const a = char('Ann', '2026-01-01T00:00:00.000Z');
    s.save(a);
    expect(JSON.parse(ls.data.get(KEY)!)[a.id].name).toBe('Ann');

    ls.failGet = true;
    expect(new LocalStore().list()).toEqual([]);
  });

  it('a failing write (quota / private mode) does not throw and keeps the session copy', async () => {
    const { LocalStore } = await load();
    const s = new LocalStore();
    ls.failSet = true;
    const a = char('Ann', '2026-01-01T00:00:00.000Z');
    expect(() => s.save(a)).not.toThrow();
    expect(s.get(a.id)?.name).toBe('Ann');
    expect(ls.data.has(KEY)).toBe(false);
    expect(() => s.remove(a.id)).not.toThrow();
  });

  it('the shared store reads storage lazily (works when stubbed after import)', async () => {
    const { store } = await load();
    const a = char('Zed', '2026-01-01T00:00:00.000Z');
    ls.data.set(KEY, JSON.stringify({ [a.id]: a }));
    expect(store.list().map((x) => x.name)).toEqual(['Zed']);
  });

  // storage.ts readAll: JSON.parse('null') returns null, which is cached as
  // "not loaded" and then passed to Object.values → TypeError.
  it.fails('BUG: storage holding JSON null crashes list()', async () => {
    ls.data.set(KEY, 'null');
    const { LocalStore } = await load();
    expect(new LocalStore().list()).toEqual([]);
  });

  // list() reads raw (un-normalised) saves; one without updatedAt (old or
  // hand-edited) makes localeCompare throw and the whole Home list fails.
  it.fails('BUG: a saved character missing updatedAt crashes list()', async () => {
    const a = char('Ann', '2026-01-01T00:00:00.000Z');
    const b = { ...char('Bob', ''), updatedAt: undefined };
    const d = { ...char('Dee', ''), updatedAt: undefined };
    ls.data.set(KEY, JSON.stringify({ [a.id]: a, [b.id]: b, [d.id]: d }));
    const { LocalStore } = await load();
    expect(new LocalStore().list().map((x) => x.name).sort()).toEqual(['Ann', 'Bob', 'Dee']);
  });

  it('exportCharacter downloads pretty JSON under a safe file name; importCharacter reads it back', async () => {
    const { exportCharacter, importCharacter } = await load();
    const blobs: Blob[] = [];
    const anchors: { href: string; download: string; click: ReturnType<typeof vi.fn> }[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blobs.push(b as Blob);
      return 'blob:fake';
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        expect(tag).toBe('a');
        const a = { href: '', download: '', click: vi.fn() };
        anchors.push(a);
        return a;
      },
    });
    const c = makeCharacter({ name: 'Sir Robin: the Brave!', homebrew: [newHomebrew('item', 'h1')] });
    exportCharacter(c);
    expect(anchors[0].download).toBe('Sir_Robin_the_Brave_.btp.json');
    expect(anchors[0].href).toBe('blob:fake');
    expect(anchors[0].click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:fake');
    expect(blobs[0].type).toBe('application/json');
    const text = await blobs[0].text();
    expect(text).toBe(JSON.stringify(c, null, 2));

    const back = await importCharacter(new File([text], 'x.btp.json'));
    expect(back).toEqual(normalizeCharacter(JSON.parse(text)));
    expect(back.homebrew).toEqual(c.homebrew);
    expect(back.id).toBe(c.id);

    exportCharacter({ ...c, name: '' });
    expect(anchors[1].download).toBe('character.btp.json');
  });

  it('importCharacter normalises partial files and rejects invalid JSON', async () => {
    const { importCharacter } = await load();
    const c = await importCharacter(new File([JSON.stringify({ name: 'Partial' })], 'p.json'));
    expect(c.name).toBe('Partial');
    expect(c.version).toBe(1);
    expect(c.play.conditions).toEqual([]);
    await expect(importCharacter(new File(['nope'], 'bad.json'))).rejects.toThrow();
  });
});

// ===========================================================================
// ui/prefs.ts
// ===========================================================================
describe('prefs', () => {
  const KEY = 'btp.prefs.v1';
  const DEFAULTS = { pinStatBar: true, animateGradients: true, animateBackground: true, glassPanels: true };
  let ls: FakeStorage;
  let subscribed: (() => void)[];

  beforeEach(() => {
    ls = new FakeStorage();
    subscribed = [];
    vi.stubGlobal('localStorage', ls);
    vi.resetModules();
    // usePrefs is a thin useSyncExternalStore wrapper; run it without React.
    vi.doMock('react', () => ({
      useSyncExternalStore: (subscribe: (l: () => void) => () => void, get: () => unknown) => {
        const l = () => subscribed.push(l);
        const unsub = subscribe(l);
        (globalThis as Record<string, unknown>).__unsub = unsub;
        return get();
      },
    }));
  });
  afterEach(() => {
    vi.doUnmock('react');
    vi.unstubAllGlobals();
  });
  const load = () => import('../src/ui/prefs');

  it('defaults when nothing is stored', async () => {
    const { usePrefs } = await load();
    expect(usePrefs()).toEqual(DEFAULTS);
  });
  it('stored values override defaults; unknown/missing keys fall back', async () => {
    ls.data.set(KEY, JSON.stringify({ pinStatBar: false }));
    const { usePrefs } = await load();
    expect(usePrefs()).toEqual({ ...DEFAULTS, pinStatBar: false });
  });
  it('corrupt or unavailable storage falls back to defaults', async () => {
    ls.data.set(KEY, '{oops');
    expect((await load()).usePrefs()).toEqual(DEFAULTS);
    vi.resetModules();
    ls.failGet = true;
    expect((await load()).usePrefs()).toEqual(DEFAULTS);
    vi.resetModules();
    ls.failGet = false;
    ls.data.set(KEY, 'null');
    expect((await load()).usePrefs()).toEqual(DEFAULTS);
  });
  it('setPrefs merges, persists and survives a reload', async () => {
    const { setPrefs, usePrefs } = await load();
    const before = usePrefs();
    setPrefs({ glassPanels: false });
    const after = usePrefs();
    expect(after).toEqual({ ...DEFAULTS, glassPanels: false });
    expect(after).not.toBe(before); // a new snapshot object, so React re-renders
    expect(JSON.parse(ls.data.get(KEY)!)).toEqual({ ...DEFAULTS, glassPanels: false });
    setPrefs({ pinStatBar: false });
    expect(JSON.parse(ls.data.get(KEY)!)).toEqual({ ...DEFAULTS, glassPanels: false, pinStatBar: false });
    expect(usePrefs()).toBe(usePrefs()); // stable snapshot between changes

    vi.resetModules();
    const again = await load();
    expect(again.usePrefs()).toEqual({ ...DEFAULTS, glassPanels: false, pinStatBar: false });
  });
  it('listeners are called on change and can unsubscribe', async () => {
    const { setPrefs, usePrefs } = await load();
    usePrefs();
    const unsub = (globalThis as Record<string, unknown>).__unsub as () => void;
    setPrefs({ animateGradients: false });
    expect(subscribed.length).toBe(1);
    unsub();
    setPrefs({ animateGradients: true });
    expect(subscribed.length).toBe(1);
  });
  it('a failing write keeps the choice for this visit', async () => {
    const { setPrefs, usePrefs } = await load();
    ls.failSet = true;
    expect(() => setPrefs({ animateBackground: false })).not.toThrow();
    expect(usePrefs().animateBackground).toBe(false);
    expect(ls.data.has(KEY)).toBe(false);
  });
});

// ===========================================================================
// ui/lightColors.ts
// ===========================================================================
describe('lightColors', () => {
  it('LIGHT_TEXT has a distinct hex colour for every Light', () => {
    expect(Object.keys(LIGHT_TEXT).sort()).toEqual([...LIGHTS].sort());
    for (const l of LIGHTS) expect(LIGHT_TEXT[l]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(Object.values(LIGHT_TEXT)).size).toBe(LIGHTS.length);
  });
  it('no Lights (or only level 0) → no gradient', () => {
    expect(alignmentGradient([])).toBeUndefined();
    expect(alignmentGradient([{ light: 'Flame', level: 0 }])).toBeUndefined();
  });
  it('one Light → a solid gradient of its colour', () => {
    for (const l of LIGHTS) expect(alignmentGradient([{ light: l, level: 2 }])).toBe(`linear-gradient(to bottom right, ${LIGHT_TEXT[l]}, ${LIGHT_TEXT[l]})`);
  });
  it('two Lights: exact stops for each cycle', () => {
    const g = alignmentGradient([
      { light: 'Flame', level: 1 },
      { light: 'Frost', level: 1 },
    ])!;
    const F = LIGHT_TEXT.Flame;
    const R = LIGHT_TEXT.Frost;
    const cyc = (c: number) => [`${F} ${((c + 0.125) * 25).toFixed(2)}%`, `${F} ${((c + 0.375) * 25).toFixed(2)}%`, `${R} ${((c + 0.625) * 25).toFixed(2)}%`, `${R} ${((c + 0.875) * 25).toFixed(2)}%`];
    expect(g).toBe(`linear-gradient(to bottom right, ${[0, 1, 2, 3].flatMap(cyc).join(', ')})`);
  });
  it('many Lights: band order, sizes by level, stops monotonic within 0–100%', () => {
    const r = rng(99);
    for (let n = 0; n < (QA ? 10 : 100); n++) {
      const lights = [...LIGHTS].sort(() => r() - 0.5).slice(0, int(r, 2, LIGHTS.length));
      const ranked = lights.map((light) => ({ light, level: int(r, 1, 4) }));
      const g = alignmentGradient(ranked)!;
      expect(g.startsWith('linear-gradient(to bottom right, ')).toBe(true);
      const stops = g.slice('linear-gradient(to bottom right, '.length, -1).split(', ').map((s) => {
        const [c, p] = s.split(' ');
        return { c, p: parseFloat(p) };
      });
      expect(stops).toHaveLength(2 * ranked.length * GRADIENT_CYCLES);
      const colours = stops.filter((_, i) => i % 2 === 0).map((s) => s.c);
      expect(colours).toEqual(Array.from({ length: GRADIENT_CYCLES }, () => ranked.map((a) => LIGHT_TEXT[a.light])).flat());
      for (let i = 1; i < stops.length; i++) expect(stops[i].p).toBeGreaterThanOrEqual(stops[i - 1].p);
      expect(stops[0].p).toBeGreaterThan(0);
      expect(stops[stops.length - 1].p).toBeLessThan(100);
      // Each band's solid section is half its share of one cycle.
      const total = ranked.reduce((s, a) => s + a.level, 0);
      ranked.forEach((a, i) => {
        const width = stops[2 * i + 1].p - stops[2 * i].p;
        expect(width).toBeCloseTo(((a.level / total) * 0.5 * 100) / GRADIENT_CYCLES, 1);
      });
    }
  });
});

// Keep the attribute list referenced (types only elsewhere).
it('ATTRS sanity', () => expect(ATTRS as readonly Attr[]).toEqual(['VIG', 'AGI', 'PER', 'INT', 'PRS']));
