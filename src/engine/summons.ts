// Summons: creatures that spells put under your command (Summon Familiar, Snow
// Familiar, Bestial and Spiritual Communion). Each summon is tracked on the sheet
// with its stat block worked out at the level it was cast, plus its own Endurance,
// Conditions and AP (its AP Maximum is 3, and it takes its turn after yours).
import { conditions as conditionDefs, getCastable, getNode, type RuleNode } from '../content';
import creatureData from '../content/creatures.json';
import type { Attr } from '../data/types';
import { emptyPlay, type Condition, type PlayState } from './character';
import { endTurn, startTurn, type TurnResult } from './conditions';
import { exaltedState, resolveHtml, scaleText } from './scaling';

/** Every summon's AP Maximum ("The familiar's {AP} Maximum is 3", and the Communion spells). */
export const SUMMON_AP_MAX = 3;

/** A Resistance, Immunity or Vulnerability: `Arctic 2`, `Bleeding`, `Cosmic 3d6`. */
export interface Rated {
  name: string;
  rating?: string;
}

/** A creature as the Monster Maker exports it (src/content/creatures.json). */
export interface Creature {
  id: string;
  name: string;
  size: string;
  alignment: string;
  type: string;
  level: number;
  border?: string;
  armorClass: number;
  armor?: string;
  endurance: number;
  movement: number;
  otherMovement: string[];
  senses: string[];
  perRadius: number;
  attributes: Record<Attr, number>;
  resistances: Rated[];
  immunities: Rated[];
  vulnerabilities: Rated[];
  professions: { name: string; mod: number }[];
  hobbies: { name: string; mod: number }[];
  languages: string[];
  facets: { name: string; text: string }[];
  weapons: { name: string; dv: string; deadly: string; damage: string; details: string; raw?: string }[];
  actions: { name: string; reaction: boolean; ap?: string; uses?: string; rawCost?: string; trigger?: string; text: string; outcomes: { label: string; text: string }[] }[];
}

export const creatures = (creatureData as { creatures: Creature[] }).creatures;

/** A stat block entry: `Name` then text with `{VIG}` tokens (and an optional trigger). */
export interface StatEntry {
  name: string;
  text: string;
  trigger?: string;
  outcomes?: { label: string; text: string }[];
}

/** One section below the numbers (Traits, Weapons, Actions): rules HTML or entries. */
export interface StatSection {
  title: string;
  html?: string;
  entries?: StatEntry[];
}

/** A summon's stat block, resolved for the level it was cast at. */
export interface StatBlock {
  name: string;
  /** "Tiny Ethereal, level 2". */
  subtitle: string;
  level: number;
  /** CSS colour of the stat block's border (the rules' border). */
  border: string;
  armorClass: number;
  armor?: string;
  endurance: number;
  movement: string;
  senses: string[];
  perRadius: number;
  attributes: Record<Attr, number>;
  resistances: Rated[];
  immunities: Rated[];
  vulnerabilities: Rated[];
  professions: { name: string; mod: number }[];
  hobbies: { name: string; mod: number }[];
  languages: string[];
  sections: StatSection[];
  /** How long it lasts, from the spell. */
  duration: string;
  /** What happens at 0 Endurance. */
  atZero: string;
}

/** A summon on the sheet (kept in PlayState.summons). */
export interface Summon {
  id: string;
  /** Castable id of the spell that summoned it. */
  spell: string;
  /** Creature id (creatures.json) for spells that summon a chosen creature. */
  creature?: string;
  /** Level the spell was cast at. */
  level: number;
  /** Your name for it ("Pip"); the stat block's name when empty. */
  name: string;
  endurance: number;
  tempEndurance: number;
  conditions: Condition[];
  /** AP, tracked during an Encounter (undefined outside one). */
  ap?: number;
  turn?: { active: boolean; noApRegain?: boolean };
  /** The Familiar, absorbed into its spinel. */
  stored?: boolean;
}

interface SummonSpell {
  /** Castable id. */
  spell: string;
  /** Creatures of this type are offered (Communion spells); otherwise the stat block node. */
  creatureType?: string;
  /** Rules node holding the stat block (spells with their own stat block). */
  node?: string;
  border: string;
  attributes?: (sl: number) => Record<Attr, number>;
  /** Changes from the stat block's own lines (level tables in its traits). */
  adjust?: (b: StatBlock, sl: number) => StatBlock;
  /** Changes a chosen creature gets (Bestial Communion's Statistics). */
  extras?: (b: StatBlock, sl: number) => StatBlock;
  duration: (sl: number) => string;
  atZero: string;
  /** Highest creature level it can summon. */
  maxCreatureLevel?: (sl: number) => number;
  /** Creatures summoned per casting. */
  count?: (sl: number) => number;
}

const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
// Snow Familiar, Size and Strength: Size and VIG by spell level (5th and up use the 5th-level line).
const SNOW_SIZE = ['Tiny', 'Small', 'Medium', 'Large', 'Gigantic'];
const SNOW_VIG = [-4, -2, 0, 2, 4];
const step = (sl: number) => Math.max(1, Math.min(5, sl)) - 1;

export const SUMMON_SPELLS: SummonSpell[] = [
  {
    spell: 'spells/arcana/mind/summon-familiar',
    node: 'spells/arcana/mind/summon-familiar/familiar',
    border: 'magenta',
    attributes: () => ({ VIG: -5, AGI: -1, PER: 2, INT: 3, PRS: -4 }),
    duration: () => 'Until dispelled',
    atZero: 'It dies, but keeps its memories; cast the spell again to re-summon it.',
  },
  {
    spell: 'spells/arcana/ice/snow-familiar',
    node: 'spells/arcana/ice/snow-familiar/snow-familiar',
    border: 'cyan',
    attributes: (sl) => ({ VIG: SNOW_VIG[step(sl)], AGI: 2, PER: 2, INT: -3, PRS: -4 }),
    adjust: (b, sl) => {
      // 4th level: Movements increase to 7 spaces; 5th: Endurance +20 and Movements 8 spaces.
      const move = sl >= 5 ? 8 : sl >= 4 ? 7 : undefined;
      return {
        ...b,
        subtitle: `${SNOW_SIZE[step(sl)]} Primordial, level ${sl}`,
        endurance: b.endurance + (sl >= 5 ? 20 : 0),
        movement: move ? b.movement.replace(/\d+/g, String(move)) : b.movement,
      };
    },
    duration: (sl) => (sl >= 5 ? 'Until dispelled' : '24 hours'),
    atZero: 'It melts.',
  },
  {
    spell: 'spells/evocations/frost/bestial-communion',
    creatureType: 'Beast',
    border: 'silver',
    // Statistics: also an Eidolon, Somatic Resistance 2{SL}, Immune to Bleeding and Bruised.
    extras: (b, sl) => ({
      ...b,
      subtitle: b.subtitle.replace(/, level/, ' (Eidolon), level'),
      resistances: [...b.resistances.filter((r) => r.name !== 'Somatic'), { name: 'Somatic', rating: String(2 * sl + (Number(b.resistances.find((r) => r.name === 'Somatic')?.rating) || 0)) }],
      immunities: [...b.immunities, ...['Bleeding', 'Bruised'].filter((n) => !b.immunities.some((i) => i.name === n)).map((name) => ({ name }))],
    }),
    duration: () => '24 hours, or until you cast this option again',
    atZero: 'It dissipates and the spell ends.',
    maxCreatureLevel: (sl) => 2 * sl,
    count: (sl) => (sl >= 5 ? 2 : 1),
  },
  {
    spell: 'spells/evocations/pneuma/spiritual-communion',
    creatureType: 'Ethereal',
    border: 'silver',
    duration: () => '24 hours, or until you cast this option again',
    atZero: 'It dissipates and the spell ends.',
    maxCreatureLevel: (sl) => 2 * sl,
    count: (sl) => (sl >= 5 ? 2 : 1),
  },
];

export const summonSpell = (spell: string) => SUMMON_SPELLS.find((s) => s.spell === spell);

/** Creatures a Communion spell cast at `sl` can summon. */
export function creatureChoices(spell: string, sl: number): Creature[] {
  const def = summonSpell(spell);
  if (!def?.creatureType) return [];
  const max = def.maxCreatureLevel?.(sl) ?? Infinity;
  return creatures.filter((c) => c.type.split(/[\s,]+/).includes(def.creatureType!) && c.level <= max);
}

/** "Arctic, Cosmic 3d6" -> [{Arctic}, {Cosmic, 3d6}]. */
export function parseRated(s: string | undefined): Rated[] {
  if (!s) return [];
  return s
    .split(/,\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = x.match(/^(.*?)\s+(\d+d\d+|\d+)$/);
      return m ? { name: m[1], rating: m[2] } : { name: x };
    });
}

const num = (s: string | undefined, sl: number) => Number(scaleText(s ?? '0', { level: sl, charLevel: 0 }).match(/-?\d+/)?.[0] ?? 0);

/** The spell's Exalted entries that apply at this level (Snow Familiar 5th: Freezing Blast inflicts more Freezing). */
function exalted(spell: string, sl: number): StatSection[] {
  const base = getCastable(spell)?.level ?? 1;
  const entries = Object.entries(getNode(spell)?.fields ?? {})
    .filter(([label]) => {
      const st = exaltedState(label, base, sl);
      return st && (st.kind === 'step' ? st.times > 0 : st.active);
    })
    .map(([name, text]) => ({ name, text: scaleText(text, { level: sl, charLevel: 0 }) }));
  return entries.length ? [{ title: 'Exalted', entries }] : [];
}

function fromNode(node: RuleNode, def: SummonSpell, sl: number): StatBlock {
  const f = node.fields ?? {};
  const kind = scaleText(node.subtitle ?? '', { level: sl, charLevel: 0 });
  const castable = getNode(def.spell)?.fields ?? {};
  return {
    name: node.title,
    subtitle: kind,
    level: sl,
    border: def.border,
    armorClass: num(f['Armor Class'], sl),
    endurance: num(f['Endurance'], sl),
    movement: f['Movement'] ?? '',
    senses: f['Senses'] ? f['Senses'].split(/,\s*/) : [],
    perRadius: num(f['Perception Radius'] ?? f['{PER} Radius'], sl),
    attributes: def.attributes?.(sl) ?? { VIG: 0, AGI: 0, PER: 0, INT: 0, PRS: 0 },
    resistances: parseRated(f['Resistances']),
    immunities: parseRated(f['Immunities']),
    vulnerabilities: parseRated(f['Vulnerabilities']),
    professions: [],
    hobbies: [],
    languages: f['Languages'] ? f['Languages'].split(/,\s*/) : [],
    sections: [...(node.children ?? []).map((c) => ({ title: c.title, html: resolveHtml(c.html ?? '', { level: sl, charLevel: 0 }) })), ...exalted(def.spell, sl)],
    duration: def.duration(sl) || castable['Duration'] || '',
    atZero: def.atZero,
  };
}

function fromCreature(c: Creature, def: SummonSpell, sl: number): StatBlock {
  const sections: StatSection[] = [];
  if (c.facets.length) sections.push({ title: 'Traits', entries: c.facets.map((x) => ({ name: x.name, text: x.text })) });
  if (c.weapons.length)
    sections.push({
      title: 'Weapons',
      entries: c.weapons.map((w) => ({ name: w.name, text: w.raw ?? `(${w.dv} / ${w.deadly}) + Mod ${w.damage}${w.details ? `; ${w.details}` : '.'}` })),
    });
  if (c.actions.length)
    sections.push({
      title: 'Actions',
      entries: c.actions.map((a) => {
        const cost = a.rawCost ?? [a.reaction ? 'Reaction' : '', a.ap ? `${a.ap} {AP}` : '', a.uses ? `${a.uses}/Rest` : ''].filter(Boolean).join(', ');
        return { name: cost ? `${a.name} (${cost})` : a.name, text: a.text, trigger: a.trigger, outcomes: a.outcomes };
      }),
    });
  const block: StatBlock = {
    name: c.name,
    subtitle: `${c.size} ${c.alignment} ${c.type}, level ${c.level}`,
    level: c.level,
    border: def.border,
    armorClass: c.armorClass,
    armor: c.armor,
    endurance: c.endurance,
    movement: [String(c.movement), ...c.otherMovement].join(', '),
    senses: c.senses,
    perRadius: c.perRadius,
    attributes: { ...c.attributes },
    resistances: c.resistances,
    immunities: c.immunities,
    vulnerabilities: c.vulnerabilities,
    professions: c.professions,
    hobbies: c.hobbies,
    languages: c.languages,
    sections,
    duration: def.duration(sl),
    atZero: def.atZero,
  };
  return def.extras ? def.extras(block, sl) : block;
}

/** The summon's stat block at the level it was cast (undefined if its spell or creature is unknown). */
export function statBlock(s: Pick<Summon, 'spell' | 'creature' | 'level'>): StatBlock | undefined {
  const def = summonSpell(s.spell);
  if (!def) return undefined;
  if (def.creatureType) {
    const c = creatures.find((x) => x.id === s.creature);
    return c ? fromCreature(c, def, s.level) : undefined;
  }
  const node = def.node ? getNode(def.node) : undefined;
  if (!node) return undefined;
  const b = fromNode(node, def, s.level);
  return def.adjust ? def.adjust(b, s.level) : b;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** A freshly summoned creature at full Endurance. */
export function newSummon(spell: string, level: number, creature?: string): Summon | undefined {
  const s = { id: uid(), spell, creature, level, name: '', endurance: 0, tempEndurance: 0, conditions: [] as Condition[] };
  const b = statBlock(s);
  return b ? { ...s, endurance: b.endurance } : undefined;
}

/**
 * Casting a summon spell: its earlier summons go (casting again replaces them,
 * or ends the spell early), and the new ones arrive.
 */
export function castSummon(summons: Summon[], spell: string, level: number, creature?: string): { summons: Summon[]; log: string[] } {
  const def = summonSpell(spell);
  if (!def) return { summons, log: [] };
  const n = def.count?.(level) ?? 1;
  const fresh = Array.from({ length: n }, () => newSummon(spell, level, creature)).filter((x): x is Summon => !!x);
  if (!fresh.length) return { summons, log: [] };
  const gone = summons.filter((s) => s.spell === spell);
  const name = statBlock(fresh[0])!.name;
  const log = [
    ...(gone.length ? [`${gone.map(summonName).join(', ')} ${gone.length === 1 ? 'is' : 'are'} replaced.`] : []),
    `Summoned ${n > 1 ? `${n} × ` : ''}${name} at ${ord(level)} level. See the Summons tab.`,
  ];
  // Keep a re-summoned creature's name (the same spirit, re-summoned).
  const keep = gone[0]?.name;
  return { summons: [...summons.filter((s) => s.spell !== spell), ...fresh.map((s) => (keep && s.creature === gone[0].creature ? { ...s, name: keep } : s))], log };
}

export function summonName(s: Summon): string {
  return s.name || statBlock(s)?.name || 'Summon';
}

const conditionNames = new Set(conditionDefs.map((c) => c.name));

/** Its Immunities split into damage types and Conditions, and its numeric Resistances. */
export function summonDefenses(b: StatBlock) {
  return {
    resistances: b.resistances.filter((r) => r.rating && /^\d+$/.test(r.rating)).map((r) => ({ type: r.name, value: Number(r.rating) })),
    immune: b.immunities.filter((i) => !conditionNames.has(i.name)).map((i) => i.name),
    immuneConditions: b.immunities.filter((i) => conditionNames.has(i.name)).map((i) => i.name),
    vulnerable: b.vulnerabilities.filter((v) => v.rating).map((v) => ({ type: v.name, dice: v.rating! })),
  };
}

/** The summon as a PlayState, so the Condition rules (gaining, turns) apply to it as they do to you. */
export function summonPlay(s: Summon): PlayState {
  return { ...emptyPlay(), initialized: true, endurance: s.endurance, tempEndurance: s.tempEndurance, conditions: s.conditions, ap: s.ap, turn: s.turn };
}

export function fromPlay(s: Summon, p: PlayState): Summon {
  return { ...s, endurance: p.endurance, tempEndurance: p.tempEndurance, conditions: p.conditions, ap: p.ap, turn: p.turn ? { active: p.turn.active, noApRegain: p.turn.noApRegain } : undefined };
}

/** Plain damage: Temporary Endurance first, then Endurance. */
export function damageSummon(s: Summon, amount: number): Summon {
  if (amount <= 0) return s;
  const fromTemp = Math.min(s.tempEndurance, amount);
  // Taking damage ends Unconscious.
  const conditions = s.conditions.filter((c) => c.name !== 'Unconscious');
  return { ...s, tempEndurance: s.tempEndurance - fromTemp, endurance: Math.max(0, s.endurance - (amount - fromTemp)), conditions };
}

export function healSummon(s: Summon, amount: number, b: StatBlock): Summon {
  return { ...s, endurance: Math.max(0, Math.min(b.endurance, s.endurance + amount)) };
}

/** Start of its turn: Condition damage goes through its Resistances and Immunities, as yours does. */
export function startSummonTurn(s: Summon, b: StatBlock): { summon: Summon; log: string[] } {
  const def = summonDefenses(b);
  const r: TurnResult = startTurn(summonPlay(s), b.level, def.resistances, { immune: def.immune, vulnerable: def.vulnerable, immuneConditions: def.immuneConditions });
  let next = fromPlay(s, r.play);
  for (const dmg of r.damage) next = damageSummon(next, dmg.amount);
  const log = r.log.map((l) => l.replace(/\byour\b/g, 'its').replace(/\bYour\b/g, 'Its').replace(/\byou\b/g, 'it').replace(/\bYou\b/g, 'It'));
  return { summon: next, log };
}

/** End of its turn: it regains AP up to 3, and Conditions that tick down do. */
export function endSummonTurn(s: Summon, b: StatBlock): { summon: Summon; log: string[] } {
  const r = endTurn(summonPlay(s), summonDefenses(b).immuneConditions, SUMMON_AP_MAX);
  const log = r.log.map((l) => l.replace(/\byour\b/g, 'its').replace(/\bYour\b/g, 'Its').replace(/\byou\b/g, 'it').replace(/\bYou\b/g, 'It'));
  return { summon: fromPlay(s, r.play), log };
}
