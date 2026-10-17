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

export interface SaveLine {
  attr: Attr;
  die: string;
  classDie?: string;
  empowered: boolean;
  label: string;
  notes: string[];
}

export interface Derived {
  level: number;
  maxLevel: number;
  cls?: ClassDef;
  subclassName?: string;
  classBonus: number;
  classDie: string;
  classDieName: string;
  attrs: Record<Attr, { points: number; die: ModDie; label: string }>;
  pointBuy: { spent: number; pool: number; cap: number };
  movement: number;
  movementTypes: { type: string; value: number }[];
  radius: number;
  initiative: string;
  initiativeNotes: string[];
  vitalityMax: number;
  radianceMax: number;
  enduranceMax: number;
  restCharges: number;
  longRestTempEndurance: number;
  ac: { value: number; breakdown: string[] };
  jump: { long: number; high: number };
  resistances: { type: string; value: number }[];
  slashingVulnerability: string;
  alignment: { light: Light; level: number; sources: string[] }[];
  senses: string[];
  bolsters: string[];
  tandems: string[];
  saves: SaveLine[];
  actionCategories: string[];
  armorTraining: string;
  weaponTraining: string;
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
  issues: string[];
}

interface Ctx {
  level: number;
  classBonus: number;
  points: Record<Attr, number>;
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
    default:
      return v.half ? half(ctx.points[v.attr]) : ctx.points[v.attr];
  }
}

function scaledLabel(v: Scaled): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return { classBonus: 'Class Bonus', halfClassBonus: '½ Class Bonus', level: 'level', twiceLevel: '2 × level' }[v];
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
        options: ATTRS.filter((a) => !cls.saveTandem.includes(a)).map((a) => ({ id: a, name: a })),
      },
      cls.name,
    );
  }
  if (cls.spellAttr === 'choice') {
    push({ id: 'spell-attr', label: 'Spell Mod Die Attribute', level: 1, options: (['VIG', 'PRS'] as Attr[]).map((a) => ({ id: a, name: a })) }, cls.name);
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

  // ---- attributes ----
  const bonusPoints = eff('attributePoint').reduce((s, x) => s + x.e.count, 0);
  const points = {} as Record<Attr, number>;
  for (const a of ATTRS) {
    const bonus = c.attributes.bonus.slice(0, bonusPoints).filter((b) => b === a).length;
    const age = c.ageUps.filter((x) => x === a).length;
    points[a] = c.attributes.base[a] + bonus - age;
  }
  const attrs = Object.fromEntries(
    ATTRS.map((a) => {
      const die = modDieFromPoints(points[a]);
      return [a, { points: points[a], die, label: formatDie(die) }];
    }),
  ) as Derived['attrs'];
  const spent = ATTRS.reduce((s, a) => s + (c.attributes.base[a] + 1), 0);
  const cap = attributeCap(level);
  const pointBuy = { spent, pool: c.attributes.pool, cap };
  if (c.attributes.method !== 'manual') {
    if (spent !== c.attributes.pool) issues.push(`Attribute Points: ${spent} of ${c.attributes.pool} spent.`);
  }
  for (const a of ATTRS) if (points[a] > cap) issues.push(`${a} is above the level ${level} Attribute cap of ${cap}.`);
  if (c.attributes.bonus.length < bonusPoints) issues.push(`Assign ${bonusPoints - c.attributes.bonus.length} bonus Attribute Point(s).`);

  const ctx: Ctx = { level, classBonus, points };
  const sc = (v: Scaled) => resolveScaled(v, ctx);

  // ---- equipment ----
  const armor = c.equipment.armor;
  const armorQ = armor ? armorQualities.find((q) => q.quality === armor.quality) : undefined;
  const armorAc = armor && armorQ ? armorQ.ac[armor.type] : 0;
  const equippedWeapons = c.equipment.weapons.map((w) => weapons.find((x) => x.name === w.name)).filter(Boolean) as typeof weapons;
  const hasProp = (p: string) => equippedWeapons.some((w) => w.properties.some((x) => x.toLowerCase().startsWith(p.toLowerCase())));
  const armorNotes: string[] = [];

  // ---- movement & senses ----
  let movement = 3 + triangular(points.AGI) + eff('movement').reduce((s, x) => s + sc(x.e.amount), 0);
  if (armor?.type === 'Heavy') {
    const d = stepDie(attrs.AGI.die, -1);
    attrs.AGI = { ...attrs.AGI, die: d, label: formatDie(d) };
    movement -= 1;
    armorNotes.push('Heavy armor: Movement −1, AGI Mod Die one step smaller, Standing costs 2 AP.');
  }
  if (hasProp('Massive')) {
    movement -= 2;
    armorNotes.push('Massive weapon: Movement −2.');
  }
  movement = Math.max(0, movement);
  const movementTypes = eff('movementType').map((x) => ({
    type: x.e.type,
    value: x.e.amount === 'movement' ? movement : half(movement),
  }));
  const radius = 5 + triangular(points.PER);
  const senses = [...new Set(eff('sense').map((x) => x.e.name))];

  // ---- health & resources ----
  const vitalityMax = 3 + Math.floor(Math.max(0, points.VIG) / 2) + eff('vitality').reduce((s, x) => s + sc(x.e.amount), 0);
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
    if (armor.type === 'Medium') armorNotes.push('Medium armor: AGI Save Checks are Hindered 1.');
  }
  const blocking = equippedWeapons.filter((w) => w.properties.includes('Blocking'));
  for (const w of blocking) {
    const b = w.properties.includes('Massive') ? 2 : w.properties.includes('Heavy') ? 1 : 0;
    if (b) {
      ac += b;
      breakdown.push(`${w.name} (Blocking): +${b}`);
    }
  }

  // ---- resistances ----
  const resMap = new Map<string, number>();
  for (const x of eff('resistance')) resMap.set(x.e.type, Math.max(resMap.get(x.e.type) ?? 0, sc(x.e.amount)));
  if (armor?.type === 'Medium') resMap.set('Slashing', Math.max(resMap.get('Slashing') ?? 0, half(armorAc)));
  if (armor?.type === 'Heavy') {
    resMap.set('Slashing', Math.max(resMap.get('Slashing') ?? 0, armorAc));
    resMap.set('Piercing', Math.max(resMap.get('Piercing') ?? 0, half(armorAc)));
  }
  const resistances = [...resMap.entries()].filter(([, v]) => v > 0).map(([type, value]) => ({ type, value }));
  const vuln = !armor && !eff('noSlashingVulnerability').length ? slashingVulnerability(vitalityMax) : '';

  // ---- alignment ----
  const align = new Map<Light, string[]>();
  const addAlign = (light: Light | 'choice' | null | undefined, source: string, pickKey: string) => {
    const l = light === 'choice' ? c.alignment.picks[pickKey] : light;
    if (light === 'choice' && !l) issues.push(`Choose a Light for ${source}.`);
    if (l) align.set(l, [...(align.get(l) ?? []), source]);
  };
  eff('alignment').forEach((x, i) => addAlign(x.e.light, x.source, `effect:${x.source}:${i}`));
  if (cls) addAlign(classAlignment(cls), cls.name, 'class');
  const { situations, problems, people } = c.alignment;
  if (situations && problems && people) {
    const res = personalAlignment(situations, problems, people);
    if (res === 'Any Light') addAlign('choice', 'Personal Alignment', 'personal');
    else if (res) addAlign(res as Light, 'Personal Alignment', 'personal');
  }
  const alignment = LIGHTS.filter((l) => align.has(l)).map((l) => ({ light: l, level: Math.min(3, align.get(l)!.length), sources: align.get(l)! }));

  // ---- checks ----
  const classDieLabel = classDie || undefined;
  const tandemSave = new Set<Attr>((cls?.saveTandem ?? []).filter((a): a is Attr => a !== 'choice'));
  if (cls?.saveTandem.includes('choice') && c.choices['save-attr']) tandemSave.add(c.choices['save-attr'] as Attr);
  eff('saveTandem').forEach((x) => x.e.attr !== 'choice' && tandemSave.add(x.e.attr));
  const bolsters = eff('bolster').map((x) => `${x.e.what}: Bolstered ${sc(x.e.amount)} (${x.source})`);
  const tandems = eff('tandem').map((x) => `${x.e.what}: Tandem with ${x.e.die === 'class' ? `${cls?.dieName ?? 'Class'} Die` : `${x.e.die} Die`} (${x.source})`);
  const saves: SaveLine[] = ATTRS.map((a) => {
    const t = tandemSave.has(a) && !!classDieLabel;
    const empowered = t && !!cls?.saveEmpowered && cls.saveTandem.includes(a);
    const die = attrs[a].label;
    const label = t ? `${die} ${empowered ? '+' : '/'} ${classDieLabel}` : die;
    const notes = eff('bolster')
      .filter((x) => x.e.what.startsWith(`${a} Save`))
      .map((x) => `Bolstered ${sc(x.e.amount)}`);
    if (a === 'AGI' && armor?.type === 'Medium') notes.push('Hindered 1 (armor)');
    return { attr: a, die, classDie: t ? classDieLabel : undefined, empowered, label, notes };
  });
  const initiativeNotes = [
    ...eff('tandem').filter((x) => x.e.what.startsWith('Initiative')).map(() => `Tandem with ${cls?.dieName} Die`),
    ...eff('bolster').filter((x) => x.e.what.startsWith('Initiative')).map((x) => `Bolstered ${sc(x.e.amount)}`),
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
  const unnamed = skillSlots.filter((s) => !s.name.trim()).length;
  if (unnamed) issues.push(`${unnamed} Hobby/Profession slot(s) need a name.`);

  // ---- spells & maneuvers ----
  const maxLevelOf = (col: string) => (cls ? numeric(columnValue(cls, level, col)) : 1);
  const listDefs: { def: SpellListDef; source: string }[] = [];
  cls?.spellLists?.forEach((def) => listDefs.push({ def, source: cls.name }));
  const scInfo = cls ? subclassesOf(cls).find((s) => s.id === c.subclass) : undefined;
  scInfo?.extras.spellLists?.forEach((def) => listDefs.push({ def, source: scInfo.name }));
  eff('spellList').forEach((x) => listDefs.push({ def: x.e.list, source: x.source }));
  const all: Castable[] = [...spells, ...maneuvers];
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
        if (selected.length !== want) issues.push(`${def.label}: ${selected.length} of ${want} chosen.`);
        const bad = selected.filter((s) => !pool.some((p) => p.id === s.id));
        if (bad.length) issues.push(`${def.label}: ${bad.map((b) => b.name).join(', ')} not allowed for this list.`);
      }
      return { def, source, count, pool, granted, selected };
    });
  const grantedExtra = eff('grant')
    .map((x) => getCastable(x.e.castable))
    .filter(Boolean) as Castable[];
  if (grantedExtra.length) {
    spellLists.push({
      def: { id: 'granted', label: 'Granted', mode: 'known', count: { base: grantedExtra.length }, pool: { kind: 'spell' } },
      source: 'Facets',
      count: grantedExtra.length,
      pool: [],
      granted: grantedExtra,
      selected: [],
    });
  }

  // ---- checks on required choices ----
  if (!c.name.trim()) issues.push('Give your character a name.');
  const anc = ancestryById.get(c.ancestry);
  if (!anc) issues.push('Choose an Ancestry.');
  else if (anc.subAncestries && !anc.subAncestries.some((s) => s.id === c.subAncestry)) issues.push(`Choose a ${anc.name} sub-ancestry.`);
  if (!c.background.heritage) issues.push('Choose a Heritage Facet.');
  if (!cls) issues.push('Choose a Class.');
  else if (!scInfo) issues.push(`Choose your ${cls.subclassLabel}.`);
  choices.filter((ch) => !ch.selected).forEach((ch) => issues.push(`Choose your ${ch.label}.`));
  if (!(situations && problems && people)) issues.push('Answer the Personal Alignment questions.');

  const spellAttr = cls?.spellAttr === 'choice' ? (c.choices['spell-attr'] as Attr | undefined) : cls?.spellAttr;
  const resources = (cls?.resources ?? [])
    .map((r) => ({ name: r.name, mode: r.mode, max: numeric(columnValue(cls!, level, r.column)) }))
    .filter((r) => r.max > 0);

  // Bulk: each VIG point unlocks bonus rows (row n requires n VIG).
  const bulkSlots = [1, 2, 3, 4, 5].map((rank) => ({ rank, slots: rank + (Math.max(0, points.VIG) >= rank ? rank : 0) }));

  const jump = {
    long: 2 + points.VIG,
    high: 1 + Math.floor(points.VIG / 2),
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
    movementTypes,
    radius,
    initiative: attrs.PER.label,
    initiativeNotes,
    vitalityMax,
    radianceMax,
    enduranceMax,
    restCharges: vitalityMax,
    longRestTempEndurance,
    ac: { value: ac, breakdown },
    jump,
    resistances,
    slashingVulnerability: vuln,
    alignment,
    senses,
    bolsters,
    tandems,
    saves,
    actionCategories: [...new Set(actionCategories)],
    armorTraining: cls?.armorTraining ?? '—',
    weaponTraining: cls?.weaponTraining ?? 'Simple weapons',
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
    issues,
  };
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export { scaledLabel, parseDie };
