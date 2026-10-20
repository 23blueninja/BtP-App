// Computes everything on the character sheet from a Character's choices.
import {
  armorQualities,
  armorRequirements,
  getCastable,
  maneuvers,
  personalAlignment,
  slashingVulnerability,
  spells,
  weapons,
  type Castable,
} from '../content';
import { ancestryById } from '../data/ancestries';
import { backgroundById, heritageById } from '../data/backgrounds';
import {
  ATTR_NAMES,
  ATTRS,
  LIGHTS,
  type Attr,
  type ChoiceDef,
  type ClassDef,
  type CountExpr,
  type Effect,
  type FacetDef,
  type Light,
  type PoolFilter,
  type Rank,
  type Scaled,
  type SpellListDef,
} from '../data/types';
import type { Character } from './character';
import { CONDITION_DAMAGE_TYPE, conditionEffects, describeCheck, type ConditionEffects, type ExtraCheck } from './conditions';
import { homebrewAlignments, resolveHomebrew, type ResolvedHomebrew } from './homebrew';
import type { DieRef, RestRule } from '../data/types';
import {
  classAlignment,
  classEndurance,
  classFacets,
  classRow,
  columnValue,
  getClass,
  maxClassLevel,
  numeric,
  subclassFacets,
  subclassesOf,
  type ResolvedFacet,
} from './classInfo';
import { formatDie, half, modDieFromPoints, parseDie, stepDie, triangular, type ModDie } from './dice';

export const POINT_BUY_POOL = 12;
export const MAX_LEVEL = 2;

/** Attribute point cap by level (from the Attribute Limit table). */
export function attributeCap(level: number): number {
  if (level >= 10) return 5;
  if (level >= 4) return 4;
  return 3;
}

export interface SkillSlot {
  id: string;
  kind: 'hobby' | 'profession';
  rank: Rank;
  source: string;
  /** Pre-filled suggestion (e.g. from a pre-made background). */
  suggested?: string;
  /** Social hobbies must involve communicating with people. */
  social?: boolean;
  name: string;
}

export interface ResolvedList {
  def: SpellListDef;
  source: string;
  count: number;
  pool: Castable[];
  granted: Castable[];
  selected: Castable[];
}

export interface ResolvedChoice extends ChoiceDef {
  source: string;
  selected?: string;
}

export interface UnarmedStrike {
  name: string;
  dv: number;
  deadlyDv: number;
  damage: string;
  properties: string[];
  /** Rolled with the Class Die instead of the VIG Die (e.g. Ferocious Strikes). */
  classDie?: boolean;
  sources: string[];
}

export interface SaveLine {
  attr: Attr;
  die: string;
  classDie?: string;
  empowered: boolean;
  label: string;
  notes: string[];
}

/** An unfinished item: its text, the builder step it's on, and the fields to highlight there. */
export interface Todo {
  text: string;
  step: string;
  fields: string[];
}

export interface Derived {
  level: number;
  maxLevel: number;
  cls?: ClassDef;
  subclassName?: string;
  classBonus: number;
  classDie: string;
  classDieName: string;
  /** Final points and Mod Die per attribute, with where the points come from. */
  attrs: Record<Attr, { points: number; die: ModDie; label: string; sources: string[]; dieNote?: string }>;
  pointBuy: { spent: number; pool: number; cap: number };
  movement: number;
  movementBreakdown: string[];
  movementTypes: { type: string; value: number }[];
  radius: number;
  initiative: string;
  initiativeNotes: string[];
  vitalityMax: number;
  /** Champion of Darkness: Darkness (your missing Vitality) and the facets that give it. */
  darkness?: { value: number; sources: string[] };
  radianceMax: number;
  enduranceMax: number;
  restCharges: number;
  longRestTempEndurance: number;
  ac: { value: number; breakdown: string[] };
  jump: { long: number; high: number };
  resistances: { type: string; value: number }[];
  /** Damage types you take no damage from. */
  damageImmunities: { type: string; sources: string[] }[];
  /** Conditions you can't gain (directly, or through Immunity to the damage type behind them). */
  conditionImmunities: { name: string; sources: string[] }[];
  /** Vulnerability dice added to damage of a type (incl. unarmored Slashing). */
  vulnerabilities: { type: string; dice: string; source: string }[];
  slashingVulnerability: string;
  alignment: { light: Light; level: number; sources: string[] }[];
  /** Alignments strongest first (same tie-breaks as strongestLight). */
  alignmentRanked: { light: Light; level: number; sources: string[] }[];
  /** The character's strongest Light. */
  strongestLight?: Light;
  senses: string[];
  bolsters: string[];
  tandems: string[];
  saves: SaveLine[];
  actionCategories: string[];
  armorTraining: string;
  weaponTraining: string;
  /** The class's Save Check training, e.g. "PER, VIG in Tandem with your Martial Die". */
  saveTraining?: string;
  armorNotes: string[];
  spellModDie?: string;
  maneuverModDie?: string;
  resources: { name: string; max: number; mode: 'pool' | 'limit' }[];
  trackers: string[];
  skillSlots: SkillSlot[];
  facets: ResolvedFacet[];
  choices: ResolvedChoice[];
  spellLists: ResolvedList[];
  bulkSlots: { rank: number; slots: number }[];
  /** Bulk Rank decrease for items on your person (Powerful Build). */
  bulkShift: number;
  /** Weapon Attack Check modifiers (Combat Styles). */
  weaponMods: (Extract<Effect, { kind: 'weapon' }> & { source: string })[];
  /** Unarmed Strikes: your body, plus natural weapons (claws, horns…). */
  unarmed: UnarmedStrike[];
  /** Homebrew items and effects, resolved at their current tier. */
  homebrew: ResolvedHomebrew[];
  /** Rest benefits taken away by homebrew effects. */
  restRules: RestRule[];
  /** Notes from homebrew effects that apply now. */
  homebrewNotes: { text: string; source: string }[];
  /** What your current Conditions do. */
  conditionFx: ConditionEffects;
  issues: string[];
  /** The same unfinished items, with the builder step and fields to highlight. */
  todo: Todo[];
  /** "An Alignment of your choice" grants, with the key their Light is stored under. */
  alignmentChoices: { pickKey: string; source: string }[];
}

interface Ctx {
  level: number;
  classBonus: number;
  points: Record<Attr, number>;
  darkness?: number;
}

export function resolveScaled(v: Scaled, ctx: Ctx): number {
  if (typeof v === 'number') return v;
  switch (v) {
    case 'classBonus':
      return ctx.classBonus;
    case 'halfClassBonus':
      return half(ctx.classBonus);
    case 'level':
      return ctx.level;
    case 'twiceLevel':
      return ctx.level * 2;
    case 'darkness':
      return ctx.darkness ?? 0;
    default:
      return v.half ? half(ctx.points[v.attr]) : ctx.points[v.attr];
  }
}

function scaledLabel(v: Scaled): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return { classBonus: 'Class Bonus', halfClassBonus: '½ Class Bonus', level: 'level', twiceLevel: '2 × level', darkness: 'Darkness' }[v];
  return `${v.half ? '½ ' : ''}${v.attr}`;
}

/** All facets that apply to the character, with their source. */
function gatherFacets(c: Character, cls: ClassDef | undefined): ResolvedFacet[] {
  const out: ResolvedFacet[] = [];
  const anc = ancestryById.get(c.ancestry);
  if (anc) {
    anc.facets.forEach((f) => out.push({ ...f, key: `anc:${f.name}`, source: anc.name, level: 1 }));
    const sub = anc.subAncestries?.find((s) => s.id === c.subAncestry);
    sub?.facets.forEach((f) => out.push({ ...f, key: `anc:${sub.id}:${f.name}`, source: `${anc.name} (${sub.name})`, level: 1 }));
  }
  const her = heritageById.get(c.background.heritage);
  if (her) out.push({ ...her, key: `her:${her.id}`, source: 'Heritage', level: 1 });
  if (cls) {
    out.push(...classFacets(cls, c.level));
    if (c.subclass) out.push(...subclassFacets(cls, c.subclass, c.level));
  }
  return out;
}

/** Choices available to the character: class, subclass and built-in. */
function gatherChoices(c: Character, cls: ClassDef | undefined): ResolvedChoice[] {
  const out: ResolvedChoice[] = [];
  if (!cls) return out;
  const push = (ch: ChoiceDef, source: string) => {
    if (ch.level <= c.level) out.push({ ...ch, source, selected: c.choices[ch.id] });
  };
  if (cls.saveTandem.includes('choice')) {
    push(
      {
        id: 'save-attr',
        label: 'Additional Save Check (Tandem with class die)',
        level: 1,
        options: ATTRS.filter((a) => !cls.saveTandem.includes(a)).map((a) => ({ id: a, name: ATTR_NAMES[a] })),
      },
      cls.name,
    );
  }
  if (cls.spellAttr === 'choice') {
    push({ id: 'spell-attr', label: 'Spell Mod Die Attribute', level: 1, options: (['VIG', 'PRS'] as Attr[]).map((a) => ({ id: a, name: ATTR_NAMES[a] })) }, cls.name);
  }
  cls.choices?.forEach((ch) => push(ch, cls.name));
  const sc = subclassesOf(cls).find((s) => s.id === c.subclass);
  sc?.extras.choices?.forEach((ch) => push(ch, sc.name));
  return out;
}

function selectedOptionEffects(choices: ResolvedChoice[]): { effects: Effect[]; source: string; facets: FacetDef[] }[] {
  return choices.flatMap((ch) => {
    const opt = ch.options.find((o) => o.id === ch.selected);
    return opt ? [{ effects: opt.effects ?? [], source: `${ch.label}: ${opt.name}`, facets: opt.facets ?? [] }] : [];
  });
}

function matchesPool(cs: Castable, f: PoolFilter, maxLevel: (col: string) => number): boolean {
  const self = (() => {
    if (cs.kind !== f.kind) return false;
    if (f.types && !f.types.includes(cs.type)) return false;
    if (cs.kind === 'spell') {
      if (f.group && cs.group !== f.group) return false;
      if (f.tiers && !f.tiers.includes(cs.tier)) return false;
    }
    if (f.maxLevelColumn && cs.level > maxLevel(f.maxLevelColumn)) return false;
    return true;
  })();
  return self || (f.or ?? []).some((o) => matchesPool(cs, o, maxLevel));
}

function countOf(e: CountExpr, ctx: Ctx, cls: ClassDef | undefined): number {
  let n = e.base ?? 0;
  if (e.byLevel) n += e.byLevel[Math.min(ctx.level, e.byLevel.length) - 1] ?? 0;
  if (e.column && cls) n += numeric(columnValue(cls, ctx.level, e.column));
  if (e.level) n += ctx.level;
  if (e.classBonus) n += ctx.classBonus;
  if (e.attr) n += Math.max(0, ctx.points[e.attr]);
  return n;
}

export function derive(c: Character): Derived {
  const issues: string[] = [];
  const todo: Todo[] = [];
  const need = (text: string, step: string, ...fields: string[]) => {
    issues.push(text);
    todo.push({ text, step, fields });
  };
  const cls = getClass(c.classId);
  const maxLevel = cls ? Math.min(MAX_LEVEL, maxClassLevel(cls)) : MAX_LEVEL;
  const level = Math.max(1, Math.min(c.level, maxLevel));
  const row = cls ? classRow(cls, level) : undefined;
  const classBonus = row?.bonus ?? 0;
  const classDie = row?.die.replace(/^1/, '') ?? '';

  // ---- facets & choices -> effects ----
  const facets = gatherFacets({ ...c, level }, cls);
  const choices = gatherChoices({ ...c, level }, cls);
  const chosen = selectedOptionEffects(choices);
  chosen.forEach((ch) => ch.facets.forEach((f) => facets.push({ ...f, key: `choice:${f.name}`, source: ch.source, level })));
  const effects: { e: Effect; source: string }[] = [
    ...facets.flatMap((f) => (f.effects ?? []).map((e) => ({ e, source: f.name }))),
    ...chosen.flatMap((ch) => ch.effects.map((e) => ({ e, source: ch.source }))),
  ];
  const eff = <K extends Effect['kind']>(kind: K) =>
    effects.filter((x) => x.e.kind === kind) as { e: Extract<Effect, { kind: K }>; source: string }[];

  // ---- alignment ----
  const align = new Map<Light, string[]>();
  const alignmentChoices: Derived['alignmentChoices'] = [];
  const addAlign = (light: Light | 'choice' | null | undefined, source: string, pickKey: string) => {
    const l = light === 'choice' ? c.alignment.picks[pickKey] : light;
    if (light === 'choice') alignmentChoices.push({ pickKey, source });
    if (light === 'choice' && !l) need(`Choose a Light for ${source}.`, pickKey === 'class' ? 'class' : 'details', `light:${pickKey}`);
    if (l) align.set(l, [...(align.get(l) ?? []), source]);
  };
  eff('alignment').forEach((x, i) => addAlign(x.e.light, x.source, `effect:${x.source}:${i}`));
  homebrewAlignments(c).forEach((x) => addAlign(x.light, x.source, `homebrew:${x.source}`));
  if (cls) addAlign(classAlignment(cls), cls.name, 'class');
  const { situations, problems, people } = c.alignment;
  if (situations && problems && people) {
    const res = personalAlignment(situations, problems, people);
    if (res === 'Any Light') addAlign('choice', 'Personal Alignment', 'personal');
    else if (res) addAlign(res as Light, 'Personal Alignment', 'personal');
  }
  const alignment = LIGHTS.filter((l) => align.has(l)).map((l) => ({ light: l, level: Math.min(3, align.get(l)!.length), sources: align.get(l)! }));
  // Strongest Light; ties go to the Personal Alignment, then the class's Light, then rulebook order.
  const rank = (a: (typeof alignment)[number]) =>
    a.level * 100 + (a.sources.includes('Personal Alignment') ? 10 : 0) + (cls && a.sources.includes(cls.name) ? 5 : 0);
  const alignmentRanked = [...alignment].sort((a, b) => rank(b) - rank(a));
  const strongestLight = alignmentRanked[0]?.light;

  // ---- homebrew items & effects (tiers come from your Alignment) ----
  const hb = resolveHomebrew(c, (l) => alignment.find((a) => a.light === l)?.level ?? 0);
  effects.push(...hb.effects);

  // ---- attributes ----
  const bonusPoints = eff('attributePoint').reduce((s, x) => s + x.e.count, 0);
  const bonusSource = eff('attributePoint')[0]?.source ?? 'bonus';
  const points = {} as Record<Attr, number>;
  const sources = {} as Record<Attr, string[]>;
  const itemPoints = Object.fromEntries(ATTRS.map((a) => [a, 0])) as Record<Attr, number>;
  for (const a of ATTRS) {
    const bonus = c.attributes.bonus.slice(0, bonusPoints).filter((b) => b === a).length;
    const age = c.ageUps.filter((x) => x === a).length;
    points[a] = c.attributes.base[a] + bonus - age;
    sources[a] = [`${c.attributes.base[a]} assigned`];
    if (bonus) sources[a].push(`+${bonus} ${bonusSource}`);
    if (age) sources[a].push(`−${age} age-up`);
    // Fixed points from items and effects; these don't count against the cap.
    for (const x of eff('attribute').filter((x) => x.e.attr === a)) {
      itemPoints[a] += x.e.amount;
      sources[a].push(`${x.e.amount >= 0 ? '+' : '−'}${Math.abs(x.e.amount)} ${x.source}`);
    }
    points[a] += itemPoints[a];
  }
  const attrs = Object.fromEntries(
    ATTRS.map((a) => {
      const die = modDieFromPoints(points[a]);
      return [a, { points: points[a], die, label: formatDie(die), sources: sources[a] }];
    }),
  ) as Derived['attrs'];
  const spent = ATTRS.reduce((s, a) => s + (c.attributes.base[a] + 1), 0);
  const cap = attributeCap(level);
  const pointBuy = { spent, pool: c.attributes.pool, cap };
  if (c.attributes.method !== 'manual') {
    if (spent !== c.attributes.pool) need(`Attribute Points: ${spent} of ${c.attributes.pool} spent.`, 'attributes', 'attr-points');
  }
  for (const a of ATTRS) if (points[a] - itemPoints[a] > cap) need(`${a} is above the level ${level} Attribute cap of ${cap}.`, 'attributes', `attr:${a}`);
  if (c.attributes.bonus.length < bonusPoints) need(`Assign ${bonusPoints - c.attributes.bonus.length} bonus Attribute Point(s).`, 'attributes', 'attr-bonus');

  const ctx: Ctx = { level, classBonus, points };
  const sc = (v: Scaled) => resolveScaled(v, ctx);
  const vitalityMax = 3 + Math.floor(Math.max(0, points.VIG) / 2) + eff('vitality').reduce((s, x) => s + sc(x.e.amount), 0);
  // Champion of Darkness (Endwalker): Darkness equals your missing Vitality.
  const darkness = eff('darkness').length && c.play.initialized ? Math.max(0, vitalityMax - c.play.vitality) : 0;
  ctx.darkness = darkness;

  // ---- equipment ----
  const armor = c.equipment.armor;
  const armorQ = armor ? armorQualities.find((q) => q.quality === armor.quality) : undefined;
  const armorAc = armor && armorQ ? armorQ.ac[armor.type] : 0;
  const equippedWeapons = c.equipment.weapons.map((w) => weapons.find((x) => x.name === w.name)).filter(Boolean) as typeof weapons;
  const hasProp = (p: string) => equippedWeapons.some((w) => w.properties.some((x) => x.toLowerCase().startsWith(p.toLowerCase())));
  const armorNotes: string[] = [];
  // Armor's Check penalties go through the same pipeline as Conditions so they show in Check Modifiers.
  const armorChecks: ExtraCheck[] = [];
  if (armor) {
    const req = armorRequirements[armor.type] ?? 0;
    if (points.VIG < req) armorChecks.push({ name: `${armor.type} armor needs ${req} VIG`, attrs: ['AGI'], amount: 0, weakened: true });
    if (armor.type === 'Medium') armorChecks.push({ name: 'Weighty (Medium armor)', attrs: ['AGI'], save: true, amount: -1 });
  }

  // ---- movement & senses ----
  const movementBreakdown = [`3 base`];
  if (points.AGI) movementBreakdown.push(`${triangular(points.AGI) > 0 ? '+' : ''}${triangular(points.AGI)} from ${points.AGI} AGI`);
  for (const x of eff('movement')) movementBreakdown.push(`+${sc(x.e.amount)} ${x.source}`);
  let movement = 3 + triangular(points.AGI) + eff('movement').reduce((s, x) => s + sc(x.e.amount), 0);
  if (armor?.type === 'Heavy') {
    const d = stepDie(attrs.AGI.die, -1);
    attrs.AGI = { ...attrs.AGI, die: d, label: formatDie(d), dieNote: `${attrs.AGI.label} → ${formatDie(d)} (Heavy armor)` };
    movement -= 1;
    movementBreakdown.push('−1 Heavy armor');
    armorNotes.push('Heavy armor: Movement −1, AGI Mod Die one step smaller, Standing costs 2 AP.');
  }
  if (hasProp('Massive')) {
    movement -= 2;
    movementBreakdown.push('−2 Massive weapon');
    armorNotes.push('Massive weapon: Movement −2.');
  }
  // ---- immunities ----
  const listAdd = <K extends string>(m: Map<K, string[]>, k: K, src: string) => m.set(k, [...(m.get(k) ?? []), src]);
  const dmgImm = new Map<string, string[]>();
  const condImm = new Map<string, string[]>();
  for (const x of eff('immunity')) {
    if (x.e.damage) listAdd(dmgImm, x.e.damage, x.source);
    if (x.e.condition) listAdd(condImm, x.e.condition, x.source);
  }
  for (const [cond, type] of Object.entries(CONDITION_DAMAGE_TYPE)) if (dmgImm.has(type)) listAdd(condImm, cond, `${type} Immunity`);
  const damageImmunities = [...dmgImm.entries()].map(([type, sources]) => ({ type, sources }));
  const conditionImmunities = [...condImm.entries()].map(([name, sources]) => ({ name, sources }));

  // Conditions you're immune to have no effect.
  const conditionFx = conditionEffects(
    c.play,
    [...eff('checks').map((x) => ({ name: x.source, attrs: x.e.attrs, save: x.e.save, amount: x.e.amount })), ...armorChecks],
    [...condImm.keys()],
  );
  const cm = conditionFx.movementChange;
  if (cm.zero) {
    movement = 0;
    movementBreakdown.push(`→ 0 (${cm.from.join(', ')})`);
  } else if (cm.value) {
    movement += cm.value;
    movementBreakdown.push(`${cm.value > 0 ? '+' : '−'}${Math.abs(cm.value)} ${cm.from.join(', ')}`);
  }
  movement = Math.max(0, movement);
  // One entry per type: the larger grant wins, and `ifAlready` effects add to an existing one.
  const moveMap = new Map<string, number>();
  const moveEffects = eff('movementType');
  for (const x of [...moveEffects.filter((m) => !m.e.ifAlready), ...moveEffects.filter((m) => m.e.ifAlready)]) {
    const value = x.e.amount === 'movement' ? movement : half(movement);
    const cur = moveMap.get(x.e.type);
    moveMap.set(x.e.type, cur === undefined ? value : x.e.ifAlready ? cur + x.e.ifAlready : Math.max(cur, value));
  }
  const movementTypes = [...moveMap.entries()].map(([type, value]) => ({ type, value }));
  const radius = 5 + triangular(points.PER);
  const senses = [...new Set(eff('sense').map((x) => x.e.name))];

  // ---- health & resources ----
  const radianceMax = 1 + Math.floor(Math.max(0, points.PRS) / 2) + eff('radiance').reduce((s, x) => s + sc(x.e.amount), 0);
  const end = cls ? classEndurance(cls) : { start: 0, perLevel: 0 };
  const enduranceMax = end.start + end.perLevel * (level - 1) + eff('endurance').reduce((s, x) => s + sc(x.e.amount), 0);
  const longRestTempEndurance = Math.max(0, points.VIG) * classBonus;

  // ---- AC ----
  const breakdown: string[] = [];
  let ac = 0;
  if (!armor) {
    const top = [...ATTRS].map((a) => points[a]).sort((x, y) => y - x).slice(0, 2);
    ac = top[0] + top[1];
    breakdown.push(`Two highest Attributes: ${top[0]} + ${top[1]}`);
    if (cls?.armor.some((r) => r.kind === 'levelUnarmored')) {
      ac += level;
      breakdown.push(`${cls.name} level (unarmored): +${level}`);
    }
    for (const x of eff('acUnarmored')) {
      ac += sc(x.e.amount);
      breakdown.push(`${x.source}: +${sc(x.e.amount)}`);
    }
  } else {
    const attr: Attr = armor.type === 'Light' ? 'AGI' : armor.type === 'Medium' ? 'PER' : 'VIG';
    ac = armorAc + points[attr];
    breakdown.push(`${armor.quality} ${armor.type} armor: ${armorAc}`, `${attr} Points: ${points[attr]}`);
    if (cls?.armor.some((r) => r.kind === 'bonusWith' && r.armor.includes(armor.type))) {
      ac += classBonus;
      breakdown.push(`${cls.name} Bonus: +${classBonus}`);
    }
    const req = armorRequirements[armor.type] ?? 0;
    if (points.VIG < req) armorNotes.push(`You need ${req} VIG for ${armor.type} armor: your AGI Checks are Weakened.`);
    if (armor.type === 'Medium') armorNotes.push('Medium armor (Weighty): AGI Save Checks are Hindered 1.');
  }
  const blocking = equippedWeapons.filter((w) => w.properties.includes('Blocking'));
  for (const w of blocking) {
    const b = w.properties.includes('Massive') ? 2 : w.properties.includes('Heavy') ? 1 : 0;
    if (b) {
      ac += b;
      breakdown.push(`${w.name} (Blocking): +${b}`);
    }
  }

  for (const x of eff('ac')) {
    ac += x.e.amount;
    breakdown.push(`${x.source}: ${x.e.amount >= 0 ? '+' : ''}${x.e.amount}`);
  }
  if (conditionFx.acChange.value) {
    ac += conditionFx.acChange.value;
    breakdown.push(`${conditionFx.acChange.from.join(', ')}: ${conditionFx.acChange.value}`);
  }

  // ---- resistances ----
  // Resistances of the same type from different sources add together.
  const resMap = new Map<string, number>();
  const addRes = (type: string, v: number) => resMap.set(type, (resMap.get(type) ?? 0) + v);
  for (const x of eff('resistance')) addRes(x.e.type, sc(x.e.amount));
  for (const e of c.play.effects ?? []) for (const r of e.resistances ?? []) addRes(r.type, r.amount);
  if (armor?.type === 'Medium') addRes('Slashing', half(armorAc));
  if (armor?.type === 'Heavy') {
    addRes('Slashing', armorAc);
    addRes('Piercing', half(armorAc));
  }
  const resistances = [...resMap.entries()].filter(([, v]) => v > 0).map(([type, value]) => ({ type, value }));
  const vuln = !armor && !eff('noSlashingVulnerability').length ? slashingVulnerability(vitalityMax) : '';
  const vulnerabilities = [
    ...(vuln ? [{ type: 'Slashing', dice: vuln, source: 'unarmored' }] : []),
    ...eff('vulnerability').map((x) => ({ type: x.e.type, dice: x.e.dice, source: x.source })),
  ].filter((v) => !dmgImm.has(v.type));

  // ---- checks ----
  const classDieLabel = classDie || undefined;
  const tandemSave = new Set<Attr>((cls?.saveTandem ?? []).filter((a): a is Attr => a !== 'choice'));
  if (cls?.saveTandem.includes('choice') && c.choices['save-attr']) tandemSave.add(c.choices['save-attr'] as Attr);
  const classSaves = (cls?.saveTandem ?? []).map((a) => (a === 'choice' ? (c.choices['save-attr'] ?? 'one more Attribute (choose in the builder)') : a));
  const saveTraining = cls && classSaves.length ? `${classSaves.join(', ')} in Tandem with your ${cls.dieName} Die${cls.saveEmpowered ? ', Empowered' : ''}` : undefined;
  eff('saveTandem').forEach((x) => x.e.attr !== 'choice' && !x.e.die && tandemSave.add(x.e.attr));
  const bolstered = (n: number) => (n >= 0 ? `Bolstered ${n}` : `Hindered ${-n}`);
  // Bolstered/Hindered levels on the same Checks add together (and cancel each other): one line per kind of Check.
  const bolsterTotals = new Map<string, { amount: number; sources: string[] }>();
  for (const x of eff('bolster')) {
    const cur = bolsterTotals.get(x.e.what) ?? { amount: 0, sources: [] };
    bolsterTotals.set(x.e.what, { amount: cur.amount + sc(x.e.amount), sources: [...cur.sources, x.source] });
  }
  const bolsters = [...bolsterTotals.entries()].map(([what, t]) => `${what}: ${bolstered(t.amount)} (${t.sources.join(', ')})`);
  const dieName = (die: 'class' | Attr | DieRef) => (die === 'class' ? `${cls?.dieName ?? 'Class'} Die` : typeof die === 'string' ? `${die} Die` : `${die.name} Die (${die.die})`);
  const tandems = eff('tandem').map((x) => `${x.e.what}: Tandem with ${dieName(x.e.die)} (${x.source})`);
  const saves: SaveLine[] = ATTRS.map((a) => {
    const t = tandemSave.has(a) && !!classDieLabel;
    const fromFacet = eff('saveEmpowered').filter((x) => x.e.attr === a);
    const empowered = (t && !!cls?.saveEmpowered && cls.saveTandem.includes(a)) || fromFacet.length > 0;
    const die = attrs[a].label;
    // Empowered: Tandem dice are added together; a single die adds a d4.
    // Tandem with another die (e.g. a sentient item's) when not already Tandem with the Class Die.
    const other = eff('saveTandem').find((x) => x.e.attr === a && x.e.die);
    // Only one die can be rolled in Tandem: use the bigger of the Class Die and the other die.
    const size = (die?: string) => Number(die?.match(/d(\d+)/)?.[1] ?? 0);
    const useOther = !!other && (!t || size(other.e.die!.die) > size(classDieLabel));
    const second = useOther ? other!.e.die!.die : t ? classDieLabel : undefined;
    // Empowered: two Tandem dice that are both d4 or larger are added together; otherwise roll an
    // extra d4. With no Attribute Die (0 points) only the other die is rolled.
    const hasDie = die !== '—';
    const big = (x: string) => !x.startsWith('-') && size(x) >= 4;
    const label = !second
      ? empowered
        ? hasDie
          ? `${die} + d4`
          : 'd4'
        : die
      : !hasDie
        ? empowered
          ? `${second} + d4`
          : second
        : empowered
          ? big(die) && big(second)
            ? `${die} + ${second}`
            : `${die} / ${second} + d4`
          : `${die} / ${second}`;
    const notes = eff('bolster')
      .filter((x) => x.e.what.startsWith(`${a} Save`))
      .map((x) => bolstered(sc(x.e.amount)));
    if (useOther) notes.push(`Tandem with ${other!.e.die!.name} Die (${other!.source})`);
    for (const x of fromFacet) notes.push(`Empowered (${x.source})`);
    for (const r of conditionFx.checks) if (r.attr === a) notes.push(...describeCheck(r));
    return { attr: a, die, classDie: second, empowered, label, notes };
  });
  // Initiative in Tandem with another die shows it beside the PER Die, like Save Checks
  // (only one die can be rolled in Tandem, so the biggest).
  const dieSize = (die?: string) => Number(die?.match(/d(\d+)/)?.[1] ?? 0);
  const tandemDieLabel = (die: 'class' | Attr | DieRef) => (die === 'class' ? classDieLabel : typeof die === 'string' ? attrs[die].label : die.die);
  const initiativeTandem = eff('tandem')
    .filter((x) => x.e.what.startsWith('Initiative'))
    .map((x) => tandemDieLabel(x.e.die))
    .filter((x): x is string => !!x)
    .sort((a, b) => dieSize(b) - dieSize(a))[0];
  const initiativeNotes = [
    ...eff('tandem')
      .filter((x) => x.e.what.startsWith('Initiative'))
      .map((x) => `Tandem with ${dieName(x.e.die)}${x.source === cls?.name ? '' : ` (${x.source})`}`),
    ...eff('bolster').filter((x) => x.e.what.startsWith('Initiative')).map((x) => bolstered(sc(x.e.amount))),
  ];
  const actionCategories = ['Basic', ...(cls?.actions ?? []), ...eff('actions').flatMap((x) => x.e.categories)];

  // ---- hobbies & professions ----
  const skillSlots: SkillSlot[] = [];
  const slot = (id: string, kind: SkillSlot['kind'], rank: Rank, source: string, extra: Partial<SkillSlot> = {}) =>
    skillSlots.push({ id, kind, rank, source, name: c.skills[id] ?? '', ...extra });
  const bg = backgroundById.get(c.background.preset);
  slot('bg-prof-1', 'profession', 'Proficient', 'Background', { suggested: bg?.profession });
  slot('bg-hobby-1', 'hobby', 'Amateur', 'Background', { suggested: bg?.hobbies[0] });
  slot('bg-hobby-2', 'hobby', 'Amateur', 'Background', { suggested: bg?.hobbies[1] });
  for (let i = 1; i <= Math.max(0, points.INT); i++) slot(`int-hobby-${i}`, 'hobby', 'Amateur', 'Intelligence');
  for (let i = 1; i <= Math.floor(Math.max(0, points.INT) / 2); i++) slot(`int-prof-${i}`, 'profession', 'Proficient', 'Intelligence');
  for (let i = 1; i <= Math.max(0, points.PRS); i++) slot(`prs-hobby-${i}`, 'hobby', 'Amateur', 'Presence', { social: true });
  c.ageUps.forEach((_, n) => {
    slot(`age-${n + 1}-hobby-1`, 'hobby', 'Amateur', `Age-up ${n + 1}`);
    slot(`age-${n + 1}-hobby-2`, 'hobby', 'Amateur', `Age-up ${n + 1}`);
    slot(`age-${n + 1}-prof-1`, 'profession', 'Proficient', `Age-up ${n + 1}`);
  });
  eff('hobbies').forEach((x, k) => {
    for (let i = 1; i <= x.e.count; i++) slot(`fx-${slugify(x.source)}-${k}-hobby-${i}`, 'hobby', x.e.rank, x.source);
  });
  eff('profession').forEach((x, k) => {
    for (let i = 1; i <= x.e.count; i++) slot(`fx-${slugify(x.source)}-${k}-prof-${i}`, 'profession', x.e.rank, x.source, { suggested: x.e.name });
  });
  const unnamed = skillSlots.filter((s) => !s.name.trim());
  if (unnamed.length) need(`${unnamed.length} Hobby/Profession slot(s) need a name.`, 'background', ...unnamed.map((s) => `skill:${s.id}`));

  // ---- spells & maneuvers ----
  const maxLevelOf = (col: string) => (cls ? numeric(columnValue(cls, level, col)) : 1);
  const listDefs: { def: SpellListDef; source: string }[] = [];
  cls?.spellLists?.forEach((def) => listDefs.push({ def, source: cls.name }));
  const scInfo = cls ? subclassesOf(cls).find((s) => s.id === c.subclass) : undefined;
  scInfo?.extras.spellLists?.forEach((def) => listDefs.push({ def, source: scInfo.name }));
  eff('spellList').forEach((x) => listDefs.push({ def: x.e.list, source: x.source }));
  // Spells and maneuvers written inside a class description are exclusive to
  // that class: they never appear in general pools.
  const all: Castable[] = [...spells, ...maneuvers].filter((s) => !s.source);
  const spellLists: ResolvedList[] = listDefs
    .filter(({ def }) => (def.level ?? 1) <= level)
    .map(({ def, source }) => {
      const granted = (def.granted ?? []).map(getCastable).filter(Boolean) as Castable[];
      let pool = all.filter((s) => matchesPool(s, def.pool, maxLevelOf) && !granted.some((g) => g.id === s.id));
      if (def.from) {
        const fromIds = new Set(c.spells[def.from] ?? []);
        pool = pool.filter((s) => fromIds.has(s.id));
      }
      const ids = def.mode === 'prepared' ? (c.play.prepared[def.id] ?? []) : (c.spells[def.id] ?? []);
      const selected = ids.map(getCastable).filter(Boolean) as Castable[];
      const count = countOf(def.count, ctx, cls);
      if (def.mode === 'known') {
        const want = count - granted.length;
        if (selected.length !== want) need(`${def.label}: ${selected.length} of ${want} chosen.`, 'spells', `spells:${def.id}`);
        const bad = selected.filter((s) => !pool.some((p) => p.id === s.id));
        if (bad.length) need(`${def.label}: ${bad.map((b) => b.name).join(', ')} not allowed for this list.`, 'spells', `spells:${def.id}`);
      }
      return { def, source, count, pool, granted, selected };
    });
  // ...and are known automatically once the character has the facet that
  // defines them (unless a list above already counts them, like Rage).
  const listed = new Set(spellLists.flatMap((l) => l.granted.map((g) => g.id)));
  const facetIds = facets.filter((f) => f.contentId && !f.item).map((f) => f.contentId!);
  const fromFacets = [...spells, ...maneuvers].filter((s) => s.source && facetIds.some((id) => s.id.startsWith(`${id}/`)));
  const grantedExtra = [...fromFacets, ...(eff('grant').map((x) => getCastable(x.e.castable)).filter(Boolean) as Castable[])].filter(
    (s, i, arr) => !listed.has(s.id) && arr.findIndex((x) => x.id === s.id) === i,
  );
  if (grantedExtra.length) {
    spellLists.push({
      def: { id: 'granted', label: 'Class Spells & Maneuvers', mode: 'known', count: { base: grantedExtra.length }, pool: { kind: 'spell' } },
      source: 'Facets',
      count: grantedExtra.length,
      pool: [],
      granted: grantedExtra,
      selected: [],
    });
  }

  // ---- checks on required choices ----
  if (!c.name.trim()) need('Give your character a name.', 'basics', 'name');
  const anc = ancestryById.get(c.ancestry);
  if (!anc) need('Choose an Ancestry.', 'ancestry', 'ancestry');
  else if (anc.subAncestries && !anc.subAncestries.some((s) => s.id === c.subAncestry)) need(`Choose a ${anc.name} sub-ancestry.`, 'ancestry', 'subancestry');
  if (!c.background.heritage) need('Choose a Heritage Facet.', 'background', 'heritage');
  if (!cls) need('Choose a Class.', 'class', 'class');
  else if (!scInfo) need(`Choose your ${cls.subclassLabel}.`, 'class', 'subclass');
  choices.filter((ch) => !ch.selected).forEach((ch) => need(`Choose your ${ch.label}.`, 'class', `choice:${ch.id}`));
  if (!(situations && problems && people))
    need(
      'Answer the Personal Alignment questions.',
      'details',
      ...(['situations', 'problems', 'people'] as const).filter((k) => !c.alignment[k]).map((k) => `alignment:${k}`),
    );

  const spellAttr = cls?.spellAttr === 'choice' ? (c.choices['spell-attr'] as Attr | undefined) : cls?.spellAttr;
  const resources = (cls?.resources ?? [])
    .map((r) => ({ name: r.name, mode: r.mode, max: numeric(columnValue(cls!, level, r.column)) }))
    .filter((r) => r.max > 0);

  // Bulk: each VIG point unlocks bonus rows (row n requires n VIG).
  const bulkSlots = [1, 2, 3, 4, 5].map((rank) => ({ rank, slots: rank + (Math.max(0, points.VIG) >= rank ? rank : 0) }));

  // ---- Unarmed Strikes ----
  // Your body: Close-Up, DV 0, Deadly DV equal to your VIG points, Crushing. Facets can change
  // that, Powerful Build adds to both DVs of every Unarmed Strike, and natural weapons add rows.
  const unarmedBonus = eff('unarmedBonus').reduce((n, x) => n + sc(x.e.amount), 0);
  const bonusSources = eff('unarmedBonus').map((x) => x.source);
  const body: UnarmedStrike = { name: 'Unarmed Strike', dv: 0, deadlyDv: points.VIG, damage: 'Crushing', properties: ['Close-Up'], sources: [] };
  for (const x of eff('unarmed')) {
    if (x.e.dv !== undefined) body.dv = sc(x.e.dv);
    if (x.e.deadly !== undefined) body.deadlyDv = x.e.deadly === 'twiceDv' ? 2 * body.dv : sc(x.e.deadly);
    for (const p of x.e.properties ?? []) if (!body.properties.includes(p)) body.properties.push(p);
    if (x.e.damage) body.damage = [body.damage, ...x.e.damage].join(' or ');
    body.sources.push(x.source);
  }
  const unarmed: UnarmedStrike[] = [
    body,
    ...eff('naturalWeapon').map((x) => ({
      name: x.e.name,
      dv: sc(x.e.dv),
      deadlyDv: sc(x.e.deadly) + (x.e.deadlyPlus ?? 0),
      damage: x.e.damage,
      properties: x.e.properties,
      classDie: x.e.die === 'class',
      sources: [x.source],
    })),
  ]
    .map((u) => (unarmedBonus ? { ...u, dv: u.dv + unarmedBonus, deadlyDv: u.deadlyDv + unarmedBonus, sources: [...u.sources, ...bonusSources] } : u))
    .map((u) => ({ ...u, dv: Math.max(0, u.dv), deadlyDv: Math.max(0, u.deadlyDv) }));

  const powerful = eff('jump').some((x) => x.e.mode === 'powerful');
  const doubled = eff('jump').some((x) => x.e.mode === 'double');
  const jump = {
    long: (powerful ? Math.max(2 + points.VIG, 2 * points.VIG) : 2 + points.VIG) * (doubled ? 2 : 1),
    high: (powerful ? 1 + points.VIG : 1 + Math.floor(points.VIG / 2)) * (doubled ? 2 : 1),
  };

  return {
    level,
    maxLevel,
    cls,
    subclassName: scInfo?.name,
    classBonus,
    classDie,
    classDieName: cls ? `${cls.dieName} Die` : 'Class Die',
    attrs,
    pointBuy,
    movement,
    movementBreakdown,
    movementTypes,
    radius,
    initiative: initiativeTandem ? (attrs.PER.label === '—' ? initiativeTandem : `${attrs.PER.label} / ${initiativeTandem}`) : attrs.PER.label,
    initiativeNotes,
    vitalityMax,
    darkness: eff('darkness').length ? { value: darkness, sources: eff('darkness').map((x) => x.source) } : undefined,
    radianceMax,
    enduranceMax,
    restCharges: vitalityMax,
    longRestTempEndurance,
    ac: { value: ac, breakdown },
    jump,
    resistances,
    damageImmunities,
    conditionImmunities,
    vulnerabilities,
    slashingVulnerability: vuln,
    alignment,
    alignmentRanked,
    strongestLight,
    senses,
    bolsters,
    tandems,
    saves,
    actionCategories: [...new Set(actionCategories)],
    armorTraining: cls?.armorTraining ?? '—',
    weaponTraining: cls?.weaponTraining ?? 'Simple weapons',
    saveTraining,
    armorNotes,
    spellModDie: spellAttr ? (cls?.spellDie === 'attr' ? attrs[spellAttr].label : classDie) : undefined,
    maneuverModDie: cls?.maneuverDie ? classDie : undefined,
    resources,
    trackers: cls?.trackers ?? [],
    skillSlots,
    facets,
    choices,
    spellLists,
    bulkSlots,
    conditionFx,
    homebrew: hb.cards,
    restRules: [...new Set(eff('restRule').map((x) => x.e.rule))],
    homebrewNotes: eff('note').map((x) => ({ text: x.e.text, source: x.source })),
    weaponMods: eff('weapon').map((x) => ({ ...x.e, source: x.source.replace(/^.*: /, '') })),
    unarmed,
    bulkShift: eff('bulkShift').reduce((sum, x) => sum + x.e.amount, 0),
    issues,
    todo,
    alignmentChoices,
  };
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export { scaledLabel, parseDie };
