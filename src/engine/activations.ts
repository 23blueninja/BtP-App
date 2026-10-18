// Using Actions, facets, spells and maneuvers in play: spend their costs (AP,
// resources, uses) and apply what they do to you (Endurance, Temporary
// Endurance, temporary AP, Active Effects…). Mechanics are hand-written per
// rules section, like the class data; costs are read from the rules text.
import type { Attr } from '../data/types';
import type { ActiveEffect, Character, PlayState } from './character';
import { activeConditions } from './conditions';
import { isVariable, parseCost, type ApCost } from './costs';
import type { Derived } from './derive';
import { half } from './dice';
import { heal, takeDamage } from './play';
import { maxCastLevel } from './scaling';

export interface ActivationCtx {
  /** Spell/maneuver level ({SL}); 0 for facets and cantrips. */
  sl: number;
  /** Character level. */
  level: number;
  classBonus: number;
  points: Record<Attr, number>;
  /** AP spent (for costs that vary). */
  ap: number;
  /** Mod Die value entered by the player. */
  mod: number;
  outcome: string;
  /** A number entered by the player (e.g. damage dealt). */
  amount: number;
}

export type Op = (
  | { kind: 'heal'; amount: number }
  | { kind: 'tempEndurance'; amount: number }
  | { kind: 'tempAp'; amount: number }
  | { kind: 'damage'; type: string; amount: number }
  | { kind: 'vitality'; amount: number }
  | { kind: 'radiance'; amount: number }
  | { kind: 'resource'; name: string; amount: number }
  | { kind: 'tracker'; name: string; amount: number }
  | { kind: 'removeConditions'; names: string[] }
  | { kind: 'reduceCondition'; name: string; by: number }
  | { kind: 'effect'; effect: Omit<ActiveEffect, 'id'> }
  | { kind: 'resetCap' }
  | { kind: 'note'; text: string }
) & {
  /** Applies to the target of a spell rather than always to you. */
  target?: boolean;
};

export interface ActivationDef {
  /** Rules section this attaches to (spell, maneuver, Action or facet). */
  id: string;
  label: string;
  /** AP cost, when it isn't read from the rules text (facets without a Cost line). */
  ap?: number | { min: number; max: number | 'maxLevel' };
  /** Who the effects apply to: always you, or a creature that may be you. */
  target?: 'self' | 'either' | 'other';
  /** What to ask the player for. */
  inputs?: { mod?: string; outcome?: string[]; amount?: string; /** Outcomes that need the Mod Die value (default: all). */ modOutcomes?: string[] };
  /** Uses tracked for this activation itself (when its facet doesn't track them). */
  uses?: { count: (x: { classBonus: number; points: Record<Attr, number> }) => number; per: 'Rest' | 'Long Rest'; shortRestRegain?: number };
  effects: (x: ActivationCtx) => Op[];
}

const T = { target: true } as const;
const sacrifice = (n: number): Op => ({ kind: 'vitality', amount: -n });

export const ACTIVATIONS: ActivationDef[] = [
  // ---- maneuvers ----
  {
    id: 'maneuvers/feral/brace',
    label: 'Brace',
    inputs: { mod: 'Mod Die roll' },
    effects: (x) => [{ kind: 'tempEndurance', amount: x.mod + (x.sl >= 5 ? 6 : 5) * x.sl }],
  },
  {
    id: 'maneuvers/tactical/feint',
    label: 'Feint',
    inputs: { outcome: ['Deadly Success', 'Success', 'Failure', 'Complete Failure'] },
    effects: (x) => {
      const ops: Op[] = [];
      if (x.outcome === 'Success' || x.outcome === 'Deadly Success') {
        const b = x.sl + (x.outcome === 'Deadly Success' ? 1 : 0);
        ops.push({ kind: 'effect', effect: { name: `Feint ${b}`, ends: 'endOfTurn', notes: [`Attack Checks against the target are Bolstered ${b}${x.sl >= 3 && x.outcome === 'Deadly Success' ? ' and have Advantage' : ''}.`] } });
        if (x.sl >= 5) ops.push({ kind: 'tempAp', amount: 2 }, { kind: 'note', text: 'The 2 temporary AP can only be used to Strike the target.' });
      } else if (x.outcome === 'Failure') ops.push({ kind: 'note', text: 'Your next Attack Check against the target costs 1 less AP.' });
      return ops;
    },
  },
  {
    id: 'classes/berserker/berserker-maneuvers/rage',
    label: 'Rage',
    effects: (x) => [
      {
        kind: 'effect',
        effect: {
          name: `Rage ${x.sl}`,
          ends: 'manual',
          checks: [{ attrs: ['VIG'], bolstered: x.sl }],
          movement: x.sl,
          resistances: ['Arctic', 'Caustic', 'Galvanic', 'Somatic', 'Thermic'].map((type) => ({ type, amount: 2 * x.sl })),
          notes: ['Crushing, Piercing, and Slashing damage you take is halved.', 'You can’t cast spells or Sustain other effects.', 'Sustain (1 AP) each turn; you may spend 1 Stamina to raise its level.'],
        },
      },
    ],
  },
  // ---- spells ----
  {
    id: 'spells/arcana/ice/ice-armor',
    label: 'Ice Armor',
    effects: (x) => [
      { kind: 'damage', type: 'Arctic', amount: 5 * x.sl },
      { kind: 'tempEndurance', amount: (x.sl >= 4 ? 30 : 25) * x.sl },
    ],
  },
  {
    id: 'spells/evocations/flame/flame-of-ambition',
    label: 'Flame of Ambition',
    effects: (x) => [
      { kind: 'damage', type: 'Thermic', amount: 10 * x.sl + 10 },
      { kind: 'tempEndurance', amount: 20 * x.sl + 20 + (x.sl >= 5 ? 30 : x.sl >= 4 ? 15 : x.sl >= 3 ? 5 : 0) },
    ],
  },
  {
    id: 'spells/arcana/blood/blood-siphon',
    label: 'Blood Siphon',
    inputs: { amount: 'Chthonic damage dealt' },
    effects: (x) => [{ kind: 'heal', amount: x.amount }],
  },
  {
    id: 'spells/arcana/blood/arcane-power',
    label: 'Arcane Power',
    inputs: { outcome: ['Exanguinate: Deadly Success', 'Another result or option'] },
    effects: (x) => (x.outcome.startsWith('Exanguinate') ? [{ kind: 'heal', amount: x.classBonus }] : []),
  },
  {
    id: 'spells/evocations/platinum/radiant-renewal',
    label: 'Radiant Renewal',
    target: 'either',
    inputs: { mod: 'Mod Die roll', outcome: ['Complete Success', 'Success', 'Failure', 'Complete Failure'] },
    effects: (x) => {
      const [base, per] = { 'Complete Success': [11, 8], Success: [7, 5], Failure: [4, 3], 'Complete Failure': [2, 1] }[x.outcome] ?? [0, 0];
      const extra = Math.max(0, x.ap - 1);
      const ops: Op[] = [{ kind: 'heal', amount: base * x.sl + per * extra + x.mod + (x.sl >= 5 ? 20 : 0), ...T }];
      const vit = x.outcome === 'Complete Success' ? (x.sl >= 4 ? 2 : 1) : x.outcome === 'Success' && x.sl >= 4 ? 1 : 0;
      if (vit) ops.push({ kind: 'vitality', amount: vit, ...T });
      return ops;
    },
  },
  {
    id: 'spells/evocations/soma/fleshmending-hymn',
    label: 'Fleshmending Hymn',
    target: 'either',
    inputs: { outcome: ['Complete Success', 'Success', 'Failure', 'Complete Failure'] },
    effects: (x) => {
      if (x.outcome === 'Complete Success' || x.outcome === 'Success')
        return [
          { kind: 'removeConditions', names: ['Bleeding', 'Bruised', 'Poisoned'], ...T },
          { kind: 'vitality', amount: x.outcome === 'Complete Success' ? 2 : 1, ...T },
        ];
      if (x.outcome === 'Failure')
        return [
          { kind: 'removeConditions', names: ['Bleeding'], ...T },
          { kind: 'reduceCondition', name: 'Poisoned', by: x.sl, ...T },
        ];
      return [{ kind: 'removeConditions', names: ['Bleeding'], ...T }];
    },
  },
  ...(['embolden', 'sharpen'] as const).map(
    (name): ActivationDef => ({
      id: `spells/arcana/${name === 'embolden' ? 'fire' : 'ice'}/${name}`,
      label: name === 'embolden' ? 'Embolden' : 'Sharpen',
      target: 'either',
      effects: (x) => {
        const use = name === 'embolden' ? 'cast a spell, Interact, Jump, Stride, or Strike (not Prepare)' : 'Prepare or take a Reaction';
        return [
          { kind: 'tempAp', amount: x.sl, ...T },
          {
            kind: 'effect',
            effect: { name: `${name === 'embolden' ? 'Embolden' : 'Sharpen'} ${x.sl}`, ends: 'manual', tempApEachTurn: x.sl, notes: [`${x.sl} temporary AP that can only be used to ${use}; regained at the end of your turn.`, 'Sustained (1 AP), 1 minute.'] },
            ...T,
          },
        ];
      },
    }),
  ),
  {
    id: 'spells/arcana/bio/adrenalize',
    label: 'Adrenalize',
    target: 'either',
    effects: (x) => [
      { kind: 'tempEndurance', amount: x.level + 5, ...T },
      {
        kind: 'effect',
        effect: { name: 'Adrenalize', ends: 'manual', movement: half(x.classBonus), notes: ['Lasts 1 minute, while you have its Temporary Endurance.', 'A Successful Weapon Attack Check sacrifices the Temporary Endurance as extra damage.'] },
        ...T,
      },
    ],
  },
  {
    id: 'spells/arcana/bio/invigorate',
    label: 'Invigorate',
    target: 'either',
    effects: (x) => [
      { kind: 'tempEndurance', amount: 2 * x.sl, ...T },
      {
        kind: 'effect',
        effect: {
          name: `Invigorate ${x.sl}`,
          ends: 'manual',
          checks: [{ attrs: ['VIG'], bolstered: 1 }],
          tempEnduranceEachTurn: 2 * x.sl,
          notes: [`High Jump +${x.sl}, Long Jump +${2 * x.sl}; standing Long Jump of ${x.sl + 1} spaces.`, 'Sustained, 10 minutes.'],
        },
        ...T,
      },
    ],
  },
  // ---- facets ----
  {
    id: 'classes/champion/undaunted',
    label: 'Press On',
    effects: (x) => [sacrifice(1), { kind: 'heal', amount: 10 * x.classBonus }],
  },
  {
    id: 'classes/champion/undaunted',
    label: 'Overcome',
    effects: () => [sacrifice(1), { kind: 'note', text: 'Perform a Glorious Exploit without spending Will, one level above your Max Exploit Level (two for a maneuver).' }],
  },
  {
    id: 'classes/champions-causes/the-throne/infernal-will',
    label: 'Infernal Will',
    inputs: { outcome: ['Success / Failure', 'Deadly'] },
    effects: (x) => [{ kind: 'heal', amount: x.outcome === 'Deadly' ? x.classBonus : half(x.classBonus) }],
  },
  {
    id: 'classes/champions-causes/the-throne/infernal-will',
    label: 'Rolled a 19',
    effects: () => [{ kind: 'radiance', amount: 1 }],
  },
  {
    id: 'classes/gladiator/fighters-light/reignite',
    label: 'Reignite',
    inputs: { mod: 'Martial Die in Tandem with VIG Die' },
    uses: { count: (x) => x.classBonus, per: 'Long Rest', shortRestRegain: 1 },
    effects: (x) => [{ kind: 'heal', amount: x.mod + x.level }],
  },
  {
    id: 'classes/gladiator/action-flare',
    label: 'Action Flare',
    effects: (x) => [
      { kind: 'tempAp', amount: x.classBonus },
      { kind: 'resource', name: 'Stamina', amount: half(x.classBonus) },
      { kind: 'resetCap' },
      { kind: 'note', text: 'CAP reset; unspent temporary AP disappears at the end of your turn.' },
    ],
  },
  {
    id: 'classes/gladiator/combat-styles/defensive-fighting',
    label: 'Defensive Fighting',
    effects: (x) => [
      {
        kind: 'effect',
        effect: { name: 'Defensive Fighting', ends: 'startOfTurn', ac: half(x.classBonus), notes: ['Your Attack Checks this turn are Hindered 1.'] },
      },
    ],
  },
  {
    id: 'classes/incarnate/titanus-form/titan-morph',
    label: 'Titan Morph',
    ap: { min: 1, max: 'maxLevel' },
    effects: (x) => [
      { kind: 'tempEndurance', amount: 10 * x.ap },
      {
        kind: 'effect',
        effect: {
          name: `Titanus Form (Size Bonus ${x.ap})`,
          ends: 'manual',
          checks: [{ attrs: ['VIG', 'PER'], bolstered: x.ap }],
          movement: x.ap,
          resistances: ['Crushing', 'Piercing', 'Slashing'].map((type) => ({ type, amount: 2 * x.ap })),
          resourceEachTurn: { name: 'Stamina', amount: x.ap },
          notes: [`Melee reach +${x.ap} spaces.`, 'Your equipment is unusable and you are unarmored.', 'Lasts 1 minute.'],
        },
      },
    ],
  },
  {
    id: 'classes/incarnate/primeval-light',
    label: 'Primeval Force',
    effects: (x) => [{ kind: 'tempEndurance', amount: x.points.PRS }],
  },
  {
    id: 'classes/luminary/shining-soul',
    label: 'Spend Radiance',
    effects: (x) => [
      { kind: 'radiance', amount: -1 },
      { kind: 'heal', amount: x.level },
      { kind: 'resource', name: 'Light', amount: 1 },
      { kind: 'note', text: 'Shine: you gain 1 Light, which dissipates at the end of your next turn.' },
    ],
  },
  {
    id: 'classes/thaumaturge/favored-acolyte/entreat-miracle',
    label: 'Entreat Miracle',
    target: 'either',
    inputs: { outcome: ['Protect Allies', 'Rebuke Oblux'], mod: 'Miracle Die + PRS Die total', modOutcomes: ['Protect Allies'] },
    effects: (x) => {
      const ops: Op[] = [{ kind: 'tracker', name: 'Indebted', amount: -x.classBonus }];
      if (x.outcome === 'Protect Allies')
        ops.push(
          { kind: 'heal', amount: x.mod + 2 * x.level, ...T },
          { kind: 'effect', effect: { name: 'Protect Allies', ends: 'startOfTurn', ac: x.classBonus, notes: ['Save Checks are rolled in Tandem with the Miracle Die.'] }, ...T },
        );
      return ops;
    },
  },
  {
    id: 'classes/thaumaturge/thaumaturgy/casting-spells/pray',
    label: 'Pray',
    effects: () => [
      {
        kind: 'effect',
        effect: { name: 'Prayer', ends: 'startOfTurn', notes: ['The first Save Check you make before your next turn is Bolstered 1.', 'The first Attack Check made against you before your next turn is Hindered 1.'] },
      },
      { kind: 'note', text: 'Garner 1 Favor if you aren’t Indebted and your Favor Limit hasn’t been reached.' },
    ],
  },
  {
    id: 'classes/divine-domains/cosmos-domain/cosmic-knowledge',
    label: 'Cosmic Knowledge',
    inputs: { mod: 'INT Die in Tandem with Miracle Die' },
    effects: (x) => [{ kind: 'tempEndurance', amount: x.mod }],
  },
  {
    id: 'classes/arcanist/prismatic-realignment/realign',
    label: 'Realign',
    effects: (x) => [
      { kind: 'resource', name: 'Prisma', amount: 999 },
      { kind: 'tracker', name: 'Prismaburn', amount: -half(x.classBonus) },
    ],
  },
  {
    id: 'classes/wild-fervors/roaring-fervor/roaring-rage',
    label: 'Roar: Adrenaline',
    effects: (x) => [{ kind: 'tempEndurance', amount: x.classBonus }],
  },
  {
    id: 'classes/wild-fervors/roaring-fervor/roaring-rage',
    label: 'Roar: Frenzy',
    inputs: { amount: 'Temporary Endurance to sacrifice (up to your level)' },
    effects: (x) => {
      const n = Math.min(x.amount, x.level);
      return [
        { kind: 'tempEndurance', amount: -n },
        { kind: 'note', text: `On a Hit, +${2 * n} damage (${3 * n} on a Deadly Hit).` },
      ];
    },
  },
  {
    id: 'classes/troubadour/artists-light/inspire',
    label: 'Inspire',
    target: 'other',
    uses: { count: (x) => Math.max(1, x.points.VIG + 1), per: 'Rest' },
    effects: (x) => [
      { kind: 'tempEndurance', amount: x.points.PRS, ...T },
      { kind: 'note', text: 'The Ally may roll the triggering Check in Tandem with your Art Die.' },
    ],
  },
  {
    id: 'classes/troubadour/artists-light/confound',
    label: 'Confound',
    uses: { count: (x) => Math.max(1, x.points.INT + 1), per: 'Rest' },
    effects: () => [{ kind: 'note', text: 'Subtract your Art Die from the triggering Check.' }],
  },
];

export const activationsFor = (id: string) => ACTIVATIONS.filter((a) => a.id === id);
export const activationUseKey = (a: ActivationDef) => `act:${a.id}:${a.label}`;

// ---------- using something ----------

export interface UseRequest {
  /** Identifies the Action for CAP counting. */
  key: string;
  name: string;
  cost: ApCost;
  def?: ActivationDef;
  /** {SL} when casting a spell or executing a maneuver. */
  sl: number;
  /** Facet whose use this spends. */
  facetKey?: string;
  /** Extra state changes (class resource spent casting, Prismaburn…), with their log lines. */
  extra?: { apply: (p: PlayState) => PlayState; log: string[] };
}

export interface UseInputs {
  ap?: number;
  mod?: number;
  outcome?: string;
  amount?: number;
  /** For effects on "a creature": whether that creature is you. */
  self?: boolean;
}

/** The AP range to choose from, or undefined when the cost is fixed. */
export function apChoice(req: UseRequest, d: Derived): { min: number; max: number } | undefined {
  const a = req.def?.ap;
  if (a !== undefined && typeof a !== 'number') return { min: a.min, max: a.max === 'maxLevel' ? Math.max(a.min, maxManeuverLevel(d)) : a.max };
  if (a === undefined && isVariable(req.cost)) return req.cost.ap;
  return undefined;
}

const maxManeuverLevel = (d: Derived) => Math.max(1, maxCastLevel(d.cls, d.level));

/** Whether using this needs the dialog (a choice or a number to enter). */
export function needsPrompt(req: UseRequest, d: Derived): boolean {
  const i = req.def?.inputs;
  return !!(apChoice(req, d) || i?.mod || i?.outcome || i?.amount || req.def?.target === 'either');
}

/** AP this use costs: base (or chosen) cost, Basic CAP, and Stunned on Reactions. */
export function apCost(req: UseRequest, p: PlayState, d: Derived, chosen?: number): { total: number; parts: string[] } {
  const fixed = req.def?.ap !== undefined && typeof req.def.ap === 'number' ? req.def.ap : typeof req.cost.ap === 'number' ? req.cost.ap : 0;
  const base = apChoice(req, d) ? (chosen ?? apChoice(req, d)!.min) : fixed;
  const parts: string[] = [];
  let total = base;
  const prior = req.cost.cap ? (p.turn?.uses?.[req.key] ?? 0) : 0;
  if (prior) {
    total += prior;
    parts.push(`+${prior} CAP`);
  }
  const stunned = req.cost.reaction ? activeConditions(p).find((c) => c.name === 'Stunned') : undefined;
  if (stunned) {
    total += stunned.level;
    parts.push(`+${stunned.level} Stunned`);
  }
  return { total, parts };
}

export function useMax(def: ActivationDef, d: Derived): number {
  return def.uses ? def.uses.count({ classBonus: d.classBonus, points: Object.fromEntries(Object.entries(d.attrs).map(([k, v]) => [k, v.points])) as Record<Attr, number> }) : 0;
}

/** Spends the costs and applies the effects; returns the new state and a log. */
export function performUse(c: Character, d: Derived, req: UseRequest, inputs: UseInputs = {}): { play: PlayState; log: string[] } {
  let p: PlayState = { ...c.play, resources: { ...c.play.resources }, trackers: { ...c.play.trackers }, facetUses: { ...c.play.facetUses } };
  const log: string[] = [];
  const def = req.def;

  // AP: temporary AP first.
  const { total: ap, parts } = apCost(req, p, d, inputs.ap);
  if (ap > 0) {
    const have = (p.ap ?? 5) + (p.tempAp ?? 0);
    const fromTemp = Math.min(p.tempAp ?? 0, ap);
    p.tempAp = (p.tempAp ?? 0) - fromTemp;
    p.ap = Math.max(0, (p.ap ?? 5) - (ap - fromTemp));
    log.push(`Spent ${ap} AP${parts.length ? ` (${parts.join(', ')})` : ''}${fromTemp ? `, ${fromTemp} of it temporary` : ''}.${have < ap ? ` You only had ${have}.` : ''}`);
  }
  if (req.cost.cap) p.turn = { active: false, ...p.turn, uses: { ...p.turn?.uses, [req.key]: (p.turn?.uses?.[req.key] ?? 0) + 1 } };

  // Other costs in the Cost line (1 Prisma, 1 Radiance…).
  for (const r of req.cost.resources) {
    if (r.name === 'Radiance') p.radianceSpent += r.amount;
    else if (r.name === 'Vitality') p.vitality = Math.max(0, p.vitality - r.amount);
    else if (d.resources.some((x) => x.name === r.name)) p.resources[r.name] = (p.resources[r.name] ?? 0) + r.amount;
    else continue;
    log.push(`Spent ${r.amount} ${r.name}.`);
  }
  if (req.facetKey) {
    p.facetUses[req.facetKey] = (p.facetUses[req.facetKey] ?? 0) + 1;
    log.push(`Used 1 use of ${d.facets.find((f) => f.key === req.facetKey)?.name ?? 'the facet'}.`);
  }
  if (def?.uses) {
    const k = activationUseKey(def);
    p.facetUses[k] = (p.facetUses[k] ?? 0) + 1;
  }
  if (req.extra) {
    p = req.extra.apply(p);
    log.push(...req.extra.log);
  }

  if (def) {
    const ctx: ActivationCtx = {
      sl: req.sl,
      level: d.level,
      classBonus: d.classBonus,
      points: Object.fromEntries(Object.entries(d.attrs).map(([k, v]) => [k, v.points])) as Record<Attr, number>,
      ap: inputs.ap ?? apChoice(req, d)?.min ?? 0,
      mod: inputs.mod ?? 0,
      outcome: inputs.outcome ?? def.inputs?.outcome?.[0] ?? '',
      amount: inputs.amount ?? 0,
    };
    const onYou = def.target === 'either' ? !!inputs.self : def.target !== 'other';
    for (const op of def.effects(ctx)) {
      if (op.target && !onYou) {
        log.push(`Target: ${describeOp(op)}`);
        continue;
      }
      p = applyOp(p, op, d, log);
    }
  }
  if (!log.length) log.push(`Used ${req.name}.`);
  return { play: p, log };
}

function describeOp(op: Op): string {
  switch (op.kind) {
    case 'heal':
      return `regains ${op.amount} Endurance.`;
    case 'tempEndurance':
      return `gains ${op.amount} Temporary Endurance.`;
    case 'tempAp':
      return `gains ${op.amount} temporary AP.`;
    case 'vitality':
      return `regains ${op.amount} Vitality.`;
    case 'removeConditions':
      return `${op.names.join(', ')} end.`;
    case 'reduceCondition':
      return `${op.name} reduces by ${op.by}.`;
    case 'effect':
      return `gains ${op.effect.name}${op.effect.ac ? ` (AC +${op.effect.ac})` : ''}.`;
    case 'note':
      return op.text;
    default:
      return '';
  }
}

function applyOp(p: PlayState, op: Op, d: Derived, log: string[]): PlayState {
  switch (op.kind) {
    case 'heal': {
      const next = heal(p, op.amount, d);
      log.push(`Regained ${next.endurance - p.endurance} Endurance${next.endurance - p.endurance < op.amount ? ` (of ${op.amount})` : ''}.`);
      return next;
    }
    case 'tempEndurance': {
      if (op.amount < 0) {
        const n = Math.min(p.tempEndurance, -op.amount);
        log.push(`Sacrificed ${n} Temporary Endurance.`);
        return { ...p, tempEndurance: p.tempEndurance - n };
      }
      // Temporary Endurance never stacks: keep whichever is higher.
      if (op.amount > p.tempEndurance) {
        log.push(`Temporary Endurance set to ${op.amount}.`);
        return { ...p, tempEndurance: op.amount };
      }
      log.push(`Kept your current ${p.tempEndurance} Temporary Endurance (new amount ${op.amount}).`);
      return p;
    }
    case 'tempAp':
      log.push(`Gained ${op.amount} temporary AP.`);
      return { ...p, tempAp: (p.tempAp ?? 0) + op.amount };
    case 'damage': {
      const res = d.resistances.find((r) => r.type === op.type)?.value ?? 0;
      const amount = Math.max(0, op.amount - res);
      log.push(`Took ${amount} ${op.type} damage${res ? ` (${op.amount} − Resistance ${res})` : ''}.`);
      return takeDamage(p, amount, d);
    }
    case 'vitality': {
      if (op.amount < 0) {
        log.push(`Sacrificed ${-op.amount} Vitality.`);
        return { ...p, vitality: Math.max(0, p.vitality + op.amount) };
      }
      const vitality = Math.min(d.vitalityMax, p.vitality + op.amount);
      log.push(`Regained ${vitality - p.vitality} Vitality.`);
      return { ...p, vitality, dying: vitality > p.vitality ? 0 : p.dying };
    }
    case 'radiance': {
      const radianceSpent = Math.max(0, Math.min(d.radianceMax, p.radianceSpent - op.amount));
      log.push(op.amount > 0 ? `Regained ${p.radianceSpent - radianceSpent} Radiance.` : `Spent ${-op.amount} Radiance.`);
      return { ...p, radianceSpent };
    }
    case 'resource': {
      const res = d.resources.find((r) => r.name === op.name);
      if (!res) return p;
      const spent = p.resources[op.name] ?? 0;
      const next = Math.max(0, spent - op.amount);
      if (next !== spent) log.push(res.mode === 'limit' ? `${op.name} applied to your limit reduced by ${spent - next}.` : `Regained ${spent - next} ${op.name}.`);
      return { ...p, resources: { ...p.resources, [op.name]: next } };
    }
    case 'tracker': {
      const cur = p.trackers[op.name] ?? 0;
      const next = Math.max(0, cur + op.amount);
      if (next !== cur) log.push(`${op.name} ${next < cur ? 'reduced' : 'increased'} to ${next}.`);
      return { ...p, trackers: { ...p.trackers, [op.name]: next } };
    }
    case 'removeConditions': {
      const gone = p.conditions.filter((c) => op.names.includes(c.name));
      if (gone.length) log.push(`${gone.map((c) => c.name).join(', ')} ended.`);
      return { ...p, conditions: p.conditions.filter((c) => !op.names.includes(c.name)) };
    }
    case 'reduceCondition': {
      const cur = p.conditions.find((c) => c.name === op.name);
      if (!cur) return p;
      const level = (cur.level ?? 1) - op.by;
      log.push(level > 0 ? `${op.name} reduced to ${level}.` : `${op.name} ended.`);
      return { ...p, conditions: level > 0 ? p.conditions.map((c) => (c === cur ? { ...c, level } : c)) : p.conditions.filter((c) => c !== cur) };
    }
    case 'effect': {
      const effects = [...(p.effects ?? []).filter((e) => e.name.split(' ')[0] !== op.effect.name.split(' ')[0] || op.effect.name === 'Prayer'), { ...op.effect, id: Math.random().toString(36).slice(2, 10) }];
      log.push(`${op.effect.name} is active.`);
      return { ...p, effects };
    }
    case 'resetCap':
      return { ...p, turn: { active: false, ...p.turn, uses: {} } };
    case 'note':
      log.push(op.text);
      return p;
  }
}

/** The request for a rules Action (one with a Cost line), with its activation if it has one. */
export function actionRequest(d: Derived, id: string, name: string, costText: string | undefined, def?: ActivationDef): UseRequest {
  const facet = d.facets.find((f) => f.uses && (id === f.key || id.startsWith(`${f.key}/`)));
  return { key: id, name, cost: parseCost(costText), def, sl: 0, facetKey: facet?.key };
}
