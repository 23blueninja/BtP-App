// Mechanical effects of Conditions, and what happens to them at the start and
// end of your turn. The rules text lives in the content; this file encodes it.
import { conditions as conditionDefs } from '../content';
import { ATTRS, type Attr } from '../data/types';
import type { Condition, PlayState } from './character';

/** Your Action Point Maximum (5 for player characters). */
export const AP_MAX = 5;

type CheckKind = 'hindered' | 'weakened' | 'disadvantage' | 'autofail';

interface CheckMod {
  /** Which Checks: one Attribute, several, or every Check. */
  attrs: Attr[] | 'all';
  /** Only Save Checks of those Attributes. */
  save?: boolean;
  kind: CheckKind;
  amount?: (x: number) => number;
  /** For automatic failures: what kind of failure, and when. */
  detail?: string;
}

interface TurnDamage {
  type: string;
  amount: (x: number, level: number, p: PlayState) => number;
  /** Resistance cannot reduce the damage below this. */
  min?: number;
}

interface ConditionRule {
  /** Other Conditions this one gives you, at a level. */
  implies?: [string, (x: number) => number][];
  checks?: CheckMod[];
  /** Effects on Attack Checks made against you. */
  against?: (x: number) => string;
  /** Other Checks (Attack, DC, Manipulate…). */
  otherChecks?: (x: number) => string;
  ac?: (x: number) => number;
  movement?: (x: number) => number | 'zero';
  /** Notes on Action Points and Actions. */
  ap?: (x: number) => string;
  notes?: (x: number) => string;
  startDamage?: TurnDamage;
  /** Text reminders at the start / end of your turn. */
  startNote?: (x: number) => string;
  endNote?: (x: number) => string;
  /** Level change at the end of your turn (negative reduces). */
  endChange?: number;
  /** Taking damage of these types reduces the level by 1. */
  reducedBy?: string[];
}

const all = 'all' as const;

export const CONDITION_RULES: Record<string, ConditionRule> = {
  Bleeding: {
    startDamage: { type: 'Somatic', amount: (x, level) => level * x },
    ap: () => 'Spend 5 AP (with a bandage) to reduce Bleeding by 1.',
  },
  Blinded: {
    checks: [
      { attrs: ['PER'], kind: 'disadvantage' },
      { attrs: ['PER'], kind: 'autofail', detail: 'Complete Failure on Checks entirely based on sight' },
    ],
    against: () => 'Advantage',
    notes: () => 'All spaces are Treacherous Terrain for you; immune to effects that require sight.',
  },
  Bruised: {
    checks: [{ attrs: ['VIG', 'AGI'], kind: 'weakened' }],
    notes: () => 'Bruised lasts until you finish a Rest.',
  },
  Buffeted: { ac: (x) => -x },
  Burning: {
    implies: [['Numbed', (x) => x]],
    startDamage: { type: 'Thermic', amount: (x) => 3 * x },
    ap: () => 'Spend 2 AP to reduce Burning by 1; it ends if you are submerged in water.',
  },
  Deafened: {
    checks: [
      { attrs: ['PER'], kind: 'weakened' },
      { attrs: ['PER'], kind: 'autofail', detail: 'Complete Failure on Checks entirely based on hearing' },
    ],
  },
  Dissolving: {
    startDamage: { type: 'Caustic', amount: (x) => 2 * x },
    endChange: -1,
    ap: () => 'Spend 1 AP to wipe it off and reduce Dissolving by 1.',
  },
  Dulled: { checks: [{ attrs: ['PRS'], kind: 'hindered', amount: (x) => x }] },
  Dying: {
    // Only while your Endurance is above 0; Somatic Resistance can't reduce it below 1.
    startDamage: { type: 'Somatic', amount: (x, _l, p) => (p.endurance > 0 ? 2 * x : 0), min: 1 },
  },
  Exhausted: {
    checks: [{ attrs: all, kind: 'hindered', amount: (x) => x }],
    against: (x) => `Bolstered ${x}`,
    movement: (x) => -x,
  },
  Freezing: {
    implies: [
      ['Sluggish', (x) => x],
      ['Slowed', (x) => 2 * x],
    ],
    endChange: -1,
    reducedBy: ['Thermic'],
  },
  Immobilized: {
    checks: [{ attrs: ['AGI'], save: true, kind: 'weakened' }],
    movement: () => 'zero',
  },
  Morphing: {
    implies: [
      ['Dulled', () => 1],
      ['Muddled', () => 1],
    ],
    startDamage: { type: 'Cosmic', amount: (x) => 3 * x },
    endNote: (x) => `Morphing: make an INT Save Check (DC ${10 + x}). Success −2, Complete Success −3, Deadly Failure +1.`,
    reducedBy: ['Sonic'],
  },
  Muddled: { checks: [{ attrs: ['INT'], kind: 'hindered', amount: (x) => x }] },
  Numbed: { checks: [{ attrs: ['PER'], kind: 'hindered', amount: (x) => x }] },
  Pacified: { otherChecks: (x) => `Attack and DC Checks: Hindered ${x}` },
  Panicked: {
    implies: [
      ['Muddled', (x) => x],
      ['Numbed', (x) => x],
    ],
    notes: () => 'You cannot move toward the source of your panic.',
    startNote: (x) => `Panicked: make a PRS Save (DC ${10 + x}). Success −2, Complete Success −3; on a Failure you must Stride away (twice and +1 on a Deadly Failure).`,
  },
  Paralyzed: {
    implies: [['Restrained', () => 1]],
    checks: [{ attrs: ['AGI', 'PER'], kind: 'autofail', detail: 'automatic Complete Failures' }],
    ap: () => 'You lose all your AP and can’t regain AP.',
  },
  Poisoned: {
    implies: [['Sickened', (x) => Math.floor(x / 2)]],
    startDamage: { type: 'Somatic', amount: (x) => x },
    notes: (x) => `Every minute, make a VIG Save Check (DC ${10 + x}); on a Success you stop taking its damage.`,
  },
  Possessed: {
    startDamage: { type: 'Infernal', amount: (x) => 2 * x },
    notes: () => 'You must make an Attack Check on your turn against a random closest creature; you can only cast damaging spells costing 3 AP or less.',
    endNote: (x) => `Possessed: make a PRS Save Check (DC ${10 + x}). Success −2, Complete Success −3, Deadly Failure +1.`,
    reducedBy: ['Sonic'],
  },
  Prone: { against: () => 'Advantage within 5 spaces, Disadvantage beyond' },
  Restrained: {
    implies: [['Seized', () => 1]],
    checks: [
      { attrs: ['AGI'], kind: 'disadvantage' },
      { attrs: ['AGI'], save: true, kind: 'autofail', detail: 'automatic Deadly Failures' },
    ],
    against: () => 'Advantage',
    ap: () => 'You can’t take Move or Manipulate Actions except Escape.',
  },
  Seized: {
    implies: [['Immobilized', () => 1]],
    against: () => 'Bolstered 1',
    otherChecks: () => 'Checks for Manipulate Actions: Hindered 1',
  },
  Sickened: { checks: [{ attrs: ['VIG'], kind: 'hindered', amount: (x) => x }] },
  Slowed: { movement: (x) => -x },
  Sluggish: { checks: [{ attrs: ['AGI'], kind: 'hindered', amount: (x) => x }] },
  Stunned: {
    ap: (x) => `You can’t take Actions on your turn, but can spend AP to reduce Stunned by 1 per AP. Reactions cost ${x} more AP.`,
    startNote: (x) => `Stunned: if you have an active Sustained effect, make an INT Save Check (DC ${10 + x}); on a Failure you can’t Sustain this turn.`,
  },
  Unconscious: {
    checks: [
      { attrs: ['AGI', 'PER'], kind: 'autofail', detail: 'automatic Complete or Deadly Failures' },
      { attrs: ['VIG', 'INT', 'PRS'], kind: 'weakened' },
    ],
    against: () => 'Bolstered 10',
    ap: () => 'You can’t spend AP.',
    notes: () => 'Ends if you take damage, unless an effect keeps you Unconscious.',
  },
};

export interface ActiveCondition {
  name: string;
  level: number;
  /** Conditions that gave you this one, when it isn't (only) your own. */
  from: string[];
  /** True when it's in your condition list (not only implied). */
  own: boolean;
}

/** Your conditions plus the ones they give you, each at its highest level. */
/** Your Conditions and the ones they bring with them, minus any you're immune to. */
export function activeConditions(p: PlayState, immune: string[] = []): ActiveCondition[] {
  const out = new Map<string, ActiveCondition>();
  const add = (name: string, level: number, from?: string) => {
    if (level <= 0 || immune.includes(name)) return;
    const cur = out.get(name);
    if (cur && cur.level >= level && (!from || cur.from.includes(from))) return;
    const next: ActiveCondition = cur ? { ...cur, level: Math.max(cur.level, level) } : { name, level, from: [], own: !from };
    if (from && !next.from.includes(from)) next.from = [...next.from, from];
    if (!from) next.own = true;
    out.set(name, next);
    for (const [n, f] of CONDITION_RULES[name]?.implies ?? []) add(n, f(level), name);
  };
  for (const c of p.conditions) add(c.name, c.level ?? 1);
  if (p.dying > 0) add('Dying', p.dying);
  return [...out.values()];
}

export interface CheckSummary {
  /** e.g. "PRS Checks" or "AGI Save Checks". */
  label: string;
  attr: Attr;
  save: boolean;
  /** Hindered and Bolstered levels and where they come from (they cancel out). */
  hindered: number;
  hinderedFrom: string[];
  bolstered: number;
  bolsteredFrom: string[];
  weakened: string[];
  disadvantage: string[];
  autofail: string[];
}

export interface ConditionEffects {
  active: ActiveCondition[];
  /** Per-Attribute Check penalties (Save-only penalties separate). */
  checks: CheckSummary[];
  against: string[];
  otherChecks: string[];
  acChange: { value: number; from: string[] };
  movementChange: { value: number; zero: boolean; from: string[] };
  ap: string[];
  notes: string[];
  /** AP can't be regained (Paralyzed). */
  noApRegain: boolean;
}

const leveled = new Set(conditionDefs.filter((d) => d.leveled).map((d) => d.name));
const label = (c: { name: string; level: number }) => (leveled.has(c.name) ? `${c.name} ${c.level}` : c.name);

/** Conditions and Active Effects; `extra` adds Bolstered/Hindered Check levels from items and other effects. */
export function conditionEffects(p: PlayState, extra: { name: string; attrs: Attr[]; save?: boolean; amount: number }[] = [], immune: string[] = []): ConditionEffects {
  const active = activeConditions(p, immune);
  const rows = new Map<string, CheckSummary>();
  const row = (attr: Attr, save: boolean) => {
    const key = `${attr}${save ? ' Save' : ''}`;
    let r = rows.get(key);
    if (!r) {
      r = { label: `${attr} ${save ? 'Save ' : ''}Checks`, attr, save, hindered: 0, hinderedFrom: [], bolstered: 0, bolsteredFrom: [], weakened: [], disadvantage: [], autofail: [] };
      rows.set(key, r);
    }
    return r;
  };
  const fx: ConditionEffects = {
    active,
    checks: [],
    against: [],
    otherChecks: [],
    acChange: { value: 0, from: [] },
    movementChange: { value: 0, zero: false, from: [] },
    ap: [],
    notes: [],
    noApRegain: false,
  };
  for (const c of active) {
    const rule = CONDITION_RULES[c.name];
    if (!rule) continue;
    const name = label(c);
    for (const m of rule.checks ?? []) {
      for (const a of m.attrs === 'all' ? ATTRS : m.attrs) {
        const r = row(a, !!m.save);
        if (m.kind === 'hindered') {
          const v = m.amount ? m.amount(c.level) : 1;
          if (v <= 0) continue;
          r.hindered += v;
          r.hinderedFrom.push(name);
        } else if (m.kind === 'weakened') r.weakened.push(name);
        else if (m.kind === 'disadvantage') r.disadvantage.push(name);
        else r.autofail.push(`${m.detail} (${name})`);
      }
    }
    if (rule.against) fx.against.push(`${rule.against(c.level)} (${name})`);
    if (rule.otherChecks) fx.otherChecks.push(`${rule.otherChecks(c.level)} (${name})`);
    if (rule.ac) {
      fx.acChange.value += rule.ac(c.level);
      fx.acChange.from.push(name);
    }
    if (rule.movement) {
      const m = rule.movement(c.level);
      if (m === 'zero') fx.movementChange.zero = true;
      else fx.movementChange.value += m;
      fx.movementChange.from.push(name);
    }
    if (rule.ap) fx.ap.push(rule.ap(c.level));
    if (rule.notes) fx.notes.push(rule.notes(c.level));
    if (c.name === 'Paralyzed') fx.noApRegain = true;
  }
  for (const x of extra) {
    for (const a of x.attrs) {
      const r = row(a, !!x.save);
      if (x.amount >= 0) {
        r.bolstered += x.amount;
        r.bolsteredFrom.push(x.name);
      } else {
        r.hindered -= x.amount;
        r.hinderedFrom.push(x.name);
      }
    }
  }
  // Active effects from activated facets, spells and maneuvers.
  for (const e of p.effects ?? []) {
    for (const m of e.checks ?? []) {
      for (const a of m.attrs === 'all' ? ATTRS : m.attrs) {
        const r = row(a, !!m.save);
        r.bolstered += m.bolstered;
        r.bolsteredFrom.push(e.name);
      }
    }
    if (e.ac) {
      fx.acChange.value += e.ac;
      fx.acChange.from.push(e.name);
    }
    if (e.movement) {
      fx.movementChange.value += e.movement;
      fx.movementChange.from.push(e.name);
    }
  }
  fx.checks = [...rows.values()].sort((a, b) => ATTRS.indexOf(a.attr) - ATTRS.indexOf(b.attr) || Number(a.save) - Number(b.save));
  return fx;
}

/** Short text for a Check row: "Hindered 2 (Dulled 1, Exhausted 1), Weakened (Bruised)". */
export function describeCheck(r: CheckSummary): string[] {
  const out: string[] = [];
  const net = r.bolstered - r.hindered;
  if (r.bolstered && r.hindered) {
    out.push(`Bolstered ${r.bolstered} (${r.bolsteredFrom.join(', ')}) and Hindered ${r.hindered} (${r.hinderedFrom.join(', ')}): ${net === 0 ? 'no change' : net > 0 ? `Bolstered ${net}` : `Hindered ${-net}`}`);
  } else if (r.bolstered) out.push(`Bolstered ${r.bolstered} (${r.bolsteredFrom.join(', ')})`);
  else if (r.hindered) out.push(`Hindered ${r.hindered} (${r.hinderedFrom.join(', ')})`);
  if (r.weakened.length) out.push(`Weakened (${r.weakened.join(', ')})`);
  if (r.disadvantage.length) out.push(`Disadvantage (${r.disadvantage.join(', ')})`);
  out.push(...r.autofail);
  return out;
}

/** Adds a condition, keeping the higher level if you already have it. */
export function addCondition(p: PlayState, name: string, level?: number): PlayState {
  const cur = p.conditions.find((c) => c.name === name);
  const lvl = level === undefined ? undefined : Math.max(level, cur?.level ?? 0);
  const conditions = [...p.conditions.filter((c) => c.name !== name), { name, level: lvl }];
  // Paralyzed: you lose all your AP.
  return name === 'Paralyzed' ? { ...p, conditions, ap: 0, tempAp: 0 } : { ...p, conditions };
}

const changeLevel = (conds: Condition[], name: string, by: number) =>
  conds.map((c) => (c.name === name ? { ...c, level: (c.level ?? 1) + by } : c)).filter((c) => c.name !== name || (c.level ?? 1) > 0);

/** Conditions that Immunity to a damage type prevents (per each Condition's rules). */
export const CONDITION_DAMAGE_TYPE: Record<string, string> = {
  Bleeding: 'Slashing',
  Bruised: 'Crushing',
  Burning: 'Thermic',
  Dissolving: 'Caustic',
  Freezing: 'Arctic',
  Poisoned: 'Somatic',
};

/** Damage Immunities and Vulnerabilities, for damage the app applies itself. */
export interface Defenses {
  /** Damage types. */
  immune: string[];
  vulnerable: { type: string; dice: string }[];
  /** Conditions you're immune to (they have no effect). */
  immuneConditions?: string[];
}

export interface TurnResult {
  play: PlayState;
  log: string[];
  /** Damage to take, by type, after Resistance. */
  damage: { type: string; amount: number; source: string }[];
}

/**
 * Start of your turn: damage from Conditions (after Resistance), Buffeted ends,
 * Paralyzed ends your turn, and reminders for start-of-turn Saves.
 */
export function startTurn(p: PlayState, level: number, resistances: { type: string; value: number }[], defenses: Defenses = { immune: [], vulnerable: [] }): TurnResult {
  let conditions = [...p.conditions];
  const log: string[] = [];
  const damage: TurnResult['damage'] = [];
  const active = activeConditions(p, defenses.immuneConditions);
  let noApRegain = false;

  for (const c of active) {
    const rule = CONDITION_RULES[c.name];
    if (!rule?.startDamage) continue;
    const raw = rule.startDamage.amount(c.level, level, p);
    if (raw <= 0) continue;
    const type = rule.startDamage.type;
    if (defenses.immune.includes(type)) {
      log.push(`${label(c)}: no ${type} damage (Immune).`);
      continue;
    }
    const res = resistances.find((r) => r.type === type)?.value ?? 0;
    const amount = Math.max(rule.startDamage.min ?? 0, raw - res);
    damage.push({ type, amount, source: label(c) });
    const vuln = defenses.vulnerable.find((v) => v.type === type);
    log.push(
      `${label(c)}: take ${amount} ${type} damage${res ? ` (${raw} − Resistance ${res})` : ''}.` +
        (vuln ? ` Roll your ${type} Vulnerability ${vuln.dice} and take that too.` : ''),
    );
  }
  // Damage of certain types reduces some Conditions.
  for (const dmg of damage) {
    for (const c of conditions) {
      if (CONDITION_RULES[c.name]?.reducedBy?.includes(dmg.type)) {
        conditions = changeLevel(conditions, c.name, -1);
        log.push(`${c.name} reduced by 1 (${dmg.type} damage).`);
      }
    }
  }
  if (conditions.some((c) => c.name === 'Buffeted')) {
    conditions = conditions.filter((c) => c.name !== 'Buffeted');
    log.push('Buffeted ended.');
  }
  if (conditions.some((c) => c.name === 'Paralyzed')) {
    conditions = changeLevel(conditions, 'Paralyzed', -1);
    noApRegain = true;
    log.push('Paralyzed: your turn ends immediately, you don’t regain AP, and Paralyzed reduces by 1.');
  }
  for (const c of active) {
    const note = CONDITION_RULES[c.name]?.startNote;
    if (note) log.push(note(c.level));
  }
  if (damage.length && active.some((c) => c.name === 'Unconscious')) log.push('Taking damage ends Unconscious unless an effect keeps you Unconscious.');
  // Active effects: some end now, some grant Temporary Endurance each turn.
  let tempEndurance = p.tempEndurance;
  const effects = (p.effects ?? []).filter((e) => {
    if (e.ends !== 'startOfTurn') return true;
    log.push(`${e.name} ended.`);
    return false;
  });
  for (const e of effects) {
    if (e.tempEnduranceEachTurn && e.tempEnduranceEachTurn > tempEndurance) {
      tempEndurance = e.tempEnduranceEachTurn;
      log.push(`${e.name}: Temporary Endurance set to ${tempEndurance}.`);
    }
  }
  if (!log.length) log.push('Your turn begins.');
  return { play: { ...p, conditions, effects, tempEndurance, turn: { active: true, noApRegain } }, log, damage };
}

/** End of your turn: regain AP, temporary AP disappears, and Conditions that tick down do. */
export function endTurn(p: PlayState): TurnResult {
  let conditions = [...p.conditions];
  const log: string[] = [];
  const active = activeConditions(p);
  for (const c of active) {
    const note = CONDITION_RULES[c.name]?.endNote;
    if (note) log.push(note(c.level));
  }
  for (const c of p.conditions) {
    const by = CONDITION_RULES[c.name]?.endChange;
    if (by) {
      conditions = changeLevel(conditions, c.name, by);
      const left = conditions.find((x) => x.name === c.name);
      log.push(left ? `${c.name} reduced to ${left.level}.` : `${c.name} ended.`);
    }
  }
  const blocked = p.turn?.noApRegain || active.some((c) => c.name === 'Paralyzed');
  const ap = blocked ? (p.ap ?? 0) : AP_MAX;
  log.push(blocked ? 'You don’t regain AP (Paralyzed).' : `Regained AP (${AP_MAX}).`);
  if (p.tempAp) log.push('Temporary AP lost.');
  // Active effects: some end now; others restore temporary AP or a resource.
  const resources = { ...p.resources };
  let tempAp = 0;
  const effects = (p.effects ?? []).filter((e) => {
    if (e.ends !== 'endOfTurn') return true;
    log.push(`${e.name} ended.`);
    return false;
  });
  for (const e of effects) {
    if (e.tempApEachTurn) {
      tempAp += e.tempApEachTurn;
      log.push(`${e.name}: regained ${e.tempApEachTurn} temporary AP.`);
    }
    if (e.resourceEachTurn) {
      const { name, amount } = e.resourceEachTurn;
      const spent = resources[name] ?? 0;
      resources[name] = Math.max(0, spent - amount);
      if (spent) log.push(`${e.name}: regained ${spent - resources[name]} ${name}.`);
    }
  }
  return { play: { ...p, conditions, effects, resources, ap, tempAp, turn: { active: false } }, log, damage: [] };
}
