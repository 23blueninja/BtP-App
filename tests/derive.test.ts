// Character derivation (the builder's rules engine): derive(), normalizeCharacter()
// and the class/ancestry data that feed them.
//
// Expected numbers are read from the rules document itself
// (rules/BtP-Alpha-Rules.md, the Homebrewery source), not from the app's code:
// class tables, Endurance, Save Checks, Alignment, ancestry facets, the Mod Die
// table, armor tables, Slashing Vulnerability and the Personal Alignment table.
// Where the app deviates from the document the test is marked `it.fails('BUG: …')`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { includeUnreleased } from '../scripts/unreleased.mjs';
import { describe, expect, it } from 'vitest';
import { LEVELS, QA, badNumbers, built, makeCharacter, sample } from './helpers';
import { derive, attributeCap, resolveScaled, skillRankAllowance, slugify, MAX_LEVEL, POINT_BUY_POOL, type Derived } from '../src/engine/derive';
import { newCharacter, normalizeCharacter, type Character, type HomebrewEffect, type HomebrewEntry } from '../src/engine/character';
import { classes } from '../src/data/classes';
import { ancestries } from '../src/data/ancestries';
import { backgrounds, heritageFacets } from '../src/data/backgrounds';
import { ATTRS, LIGHTS, RANK_DIE, type Attr, type ClassDef, type Light } from '../src/data/types';
import { classAlignment, classEndurance, classTable, maxClassLevel, subclassesOf, numeric } from '../src/engine/classInfo';
import { formatDie, half, modDieFromPoints, parseDie, stepDie, triangular } from '../src/engine/dice';
import { castCost, maxCastLevel, scaleText } from '../src/engine/scaling';
import { facetUseMax } from '../src/engine/play';
import { getCastable, spells, maneuvers, weapons } from '../src/content';

// ---------------------------------------------------------------------------
// The rules document
// ---------------------------------------------------------------------------

const RAW_MD = readFileSync(fileURLToPath(new URL('../rules/BtP-Alpha-Rules.md', import.meta.url)), 'utf8');
/** The document as rendered: HTML comments (unreleased levels/facets) removed. */
const MD = includeUnreleased(RAW_MD).replace(/<!--[\s\S]*?-->/g, '');
const LINES = MD.split('\n');

const norm = (s: string) =>
  s
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
const stripMd = (s: string) => s.replace(/\*+/g, '').replace(/\$\[(\w+)\]/g, '$1');

/** Lines of the table directly following a heading line matching `heading`. */
function tableAfter(heading: RegExp, from = 0): string[][] {
  const start = LINES.findIndex((l, i) => i >= from && heading.test(l));
  if (start < 0) return [];
  const out: string[][] = [];
  let i = start + 1;
  while (i < LINES.length && !LINES[i].trim().startsWith('|')) i++;
  for (; i < LINES.length && LINES[i].trim().startsWith('|'); i++) out.push(cells(LINES[i]));
  return out;
}
/** Removes markdown separator rows (|:--:|). */
const dataRows = (t: string[][]) => t.filter((r) => !r.every((c) => /^:?-*:?$/.test(c)));

/** Text of a section: from the heading line matching `re` up to the next heading of the same or higher level. */
function section(re: RegExp, from = 0): string {
  const start = LINES.findIndex((l, i) => i >= from && re.test(l));
  if (start < 0) return '';
  const depth = LINES[start].match(/^#+/)![0].length;
  let end = start + 1;
  while (end < LINES.length && !(LINES[end].match(/^#+ /) && LINES[end].match(/^#+/)![0].length <= depth)) end++;
  return LINES.slice(start, end).join('\n');
}

/** "### Name < lvl N >" / "#### Name < lvl N >" facets inside a block of text. */
function facetsIn(text: string): { name: string; level: number; text: string }[] {
  const out: { name: string; level: number; text: string }[] = [];
  const ls = text.split('\n');
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(/^#{3,4} (.+?)\s*<\s*lvl\s*(\d+)\s*>/);
    if (!m) continue;
    let j = i + 1;
    while (j < ls.length && !/^#{1,4} /.test(ls[j])) j++;
    out.push({ name: m[1].trim(), level: Number(m[2]), text: ls.slice(i + 1, j).join('\n') });
  }
  return out;
}

// ---- class information from the document ----

interface MdClass {
  name: string;
  /** Text from "## Name" to the next class (includes its subclass list and option sections). */
  region: string;
  rows: { level: number; bonus: number; die: string; facets: string[]; cols: Record<string, string> }[];
  endurance: { start: number; perLevel: number };
  saveLine: string;
  alignment: Light | 'choice' | null;
  armorLine: string;
  facets: { name: string; level: number; text: string }[];
}

const MD_CLASS_NAMES = [...MD.matchAll(/^##### (\w+) Class Table\s*$/gm)].map((m) => m[1]);

function mdClass(name: string): MdClass {
  const startLine = LINES.findIndex((l) => l.trim() === `## ${name}`);
  const nextNames = MD_CLASS_NAMES.filter((n) => n !== name);
  let endLine = startLine + 1;
  while (endLine < LINES.length && !nextNames.some((n) => LINES[endLine].trim() === `## ${n}`) && !/^# /.test(LINES[endLine])) endLine++;
  const region = LINES.slice(startLine, endLine).join('\n');
  const t = tableAfter(new RegExp(`^##### ${name} Class Table`));
  const [top, bottom] = t;
  const headers = bottom.map((b, i) => `${top[i] ?? ''} ${b}`.trim());
  const rows = dataRows(t.slice(2)).map((r) => {
    const cols: Record<string, string> = {};
    headers.forEach((h, i) => (cols[h] = r[i] ?? ''));
    return {
      level: parseInt(r[0], 10),
      bonus: parseInt(r[1], 10),
      die: r[3],
      facets: r[2].split(',').map((s) => s.trim()).filter((s) => s && s !== '—'),
      cols,
    };
  });
  const e = region.match(/start with (\d+) \*Endurance\* and gain (\d+)/)!;
  const alignText = (region.match(/^#### Alignment\s*\n([^\n]*)/m)?.[1] ?? '').trim();
  const alignment = !alignText ? null : /of your choice/.test(alignText) ? 'choice' : (LIGHTS.find((l) => alignText.includes(l)) ?? null);
  return {
    name,
    region,
    rows,
    endurance: { start: Number(e[1]), perLevel: Number(e[2]) },
    saveLine: region.match(/^\*\*Save Checks\*\*\s*::(.*)$/m)?.[1] ?? '',
    alignment,
    armorLine: region.match(/^\*\*Armor\*\*\s*::(.*)$/m)?.[1] ?? '',
    facets: facetsIn(section(new RegExp(`^## ${name}\\s*$`))),
  };
}

const MD_CLASSES = new Map(classes.map((c) => [c.id, mdClass(c.name)]));

/** A subclass's section ("### Victor") inside its class region. */
function mdSubclassFacets(cls: ClassDef, subName: string): { name: string; level: number; text: string }[] {
  const region = MD_CLASSES.get(cls.id)!.region.split('\n');
  const start = region.findIndex((l) => norm(l) === norm(`### ${subName}`));
  if (start < 0) return [];
  let end = start + 1;
  while (end < region.length && !/^#{1,3} /.test(region[end])) end++;
  return facetsIn(region.slice(start, end).join('\n'));
}

/** Text of a chosen option ("#### Connection", "### Comedy") inside its class region. */
function mdOptionText(cls: ClassDef, optName: string): string {
  const region = MD_CLASSES.get(cls.id)!.region.split('\n');
  const start = region.findIndex((l) => /^#{3,5} /.test(l) && norm(l.replace(/^#+/, '')) === norm(optName));
  if (start < 0) return '';
  const depth = region[start].match(/^#+/)![0].length;
  let end = start + 1;
  while (end < region.length && !(/^#+ /.test(region[end]) && region[end].match(/^#+/)![0].length <= depth)) end++;
  return region.slice(start + 1, end).join('\n');
}

// ---- ancestries from the document ----

interface MdFacet {
  name: string;
  text: string;
}
function mdAncestry(name: string): { facets: MdFacet[]; subs: Map<string, MdFacet[]> } {
  const sec = section(new RegExp(`^### ${name}\\s*$`)).split('\n');
  const fi = sec.findIndex((l) => /^#### Facets/.test(l));
  const facets: MdFacet[] = [];
  const subs = new Map<string, MdFacet[]>();
  let cur = facets;
  for (const l of sec.slice(fi + 1)) {
    const h = l.match(/^##### (.+?)\s*$/);
    if (h) {
      cur = [];
      subs.set(h[1], cur);
      continue;
    }
    const m = l.match(/^\*\*\*(.+?)\.\*\*\*\s*(.*)$/);
    if (m && m[1] !== 'Sub-Ancestry') cur.push({ name: m[1], text: stripMd(m[2]) });
  }
  return { facets, subs };
}
const MD_ANCESTRIES = new Map(ancestries.map((a) => [a.id, mdAncestry(a.name)]));

// ---- simple tables ----

const MOD_DIE_TABLE: [number, string][] = (() => {
  const start = LINES.findIndex((l) => /^##### Attribute Points & Modifier Dice/.test(l));
  const out: [number, string][] = [];
  for (let i = start; i < start + 30; i++) {
    const m = LINES[i].match(/^\|\s*(-?\d+)\s*\|\s*(-?1d\d+)\s*\|$/);
    if (m) out.push([Number(m[1]), m[2]]);
  }
  return out;
})();
const ATTRIBUTE_LIMIT = dataRows(tableAfter(/^##### Attribute Limit/)).slice(1).map((r) => [Number(r[0]), Number(r[1])] as const);
const ARMOR_AC = dataRows(tableAfter(/^##### Armor AC Values/)).slice(1).map((r) => ({ quality: r[0], Light: Number(r[1]), Medium: Number(r[2]), Heavy: Number(r[3]) }));
const ARMOR_REQ = Object.fromEntries(dataRows(tableAfter(/^### Armor Requirements/)).slice(1).map((r) => [r[0], Number(r[1].replace(/\D/g, ''))])) as Record<
  'Light' | 'Medium' | 'Heavy',
  number
>;
const SLASHING_VULN = new Map(dataRows(tableAfter(/^##### Unarmored Slashing Vulnerability/)).slice(1).map((r) => [Number(r[0]), r[1]]));
const PERSONAL_ALIGNMENT = dataRows(tableAfter(/^#### \{\{color:white I Respond to New/)).slice(1);
const DAMAGE_TYPES = [...MD.matchAll(/^#### (.+?) \(Rank \d\)/gm)].flatMap((m) => m[1].split(/,?\s+(?:and\s+)?/).filter((w) => /^[A-Z]/.test(w)));
const MD_BACKGROUNDS = backgrounds.map((b) => {
  const s = section(new RegExp(`^### ${b.name}\\s*$`));
  return {
    id: b.id,
    profession: s.match(/\*\*Profession\*\*\s*(.+)/)?.[1].trim(),
    hobbies: s.match(/\*\*Hobbies\*\*\s*(.+)/)?.[1].split(',').map((x) => x.trim()),
    facet: s.match(/\*\*Facet\*\*\s*(.+)/)?.[1].trim(),
  };
});

/** "1d6" -> "d6", "-1d4" -> "-d4" (how the app labels dice). */
const dieLabelOf = (d: string) => d.replace(/^(-?)1d/, '$1d');
const dieSize = (d: string) => Number(d.match(/d(\d+)/)?.[1] ?? 0);

// ---------------------------------------------------------------------------
// Building characters
// ---------------------------------------------------------------------------

const BUILDER_STEPS = new Set(['basics', 'attributes', 'ancestry', 'background', 'class', 'spells', 'details', 'equipment', 'review']);

interface Variant {
  id: string;
  sub: string;
  label: string;
}
const ANCESTRY_VARIANTS: Variant[] = ancestries.flatMap((a) =>
  a.subAncestries ? a.subAncestries.map((s) => ({ id: a.id, sub: s.id, label: `${a.id}/${s.id}` })) : [{ id: a.id, sub: '', label: a.id }],
);
const CLASS_VARIANTS = classes.flatMap((cls) => subclassesOf(cls).map((s) => ({ cls, sub: s.id, subName: s.name, label: `${cls.id}/${s.id}` })));

/** Even attributes (2 in each) so no Mod Die is smaller than a d4. */
const EVEN: Record<Attr, number> = { VIG: 2, AGI: 2, PER: 2, INT: 2, PRS: 2 };
/** A legal 12-point point buy: VIG 2, AGI 2, PER 2, INT 1, PRS 0. */
const POINT_BUY: Record<Attr, number> = { VIG: 2, AGI: 2, PER: 2, INT: 1, PRS: 0 };

/**
 * A fully built character: every choice takes its first option, every known
 * list is filled from its pool, every "Light of your choice" is Platinum,
 * every skill slot is named and bonus points go to PRS.
 */
function complete(over: Parameters<typeof makeCharacter>[0] = {}, opts: { light?: Light } = {}): Character {
  let c = makeCharacter({
    name: 'Complete',
    background: { preset: 'woodsman', heritage: 'blue-collar' },
    alignment: { situations: 'Action', problems: 'Reason', people: 'Apathy', picks: {} },
    attributes: { method: 'manual', pool: 12, base: { ...EVEN }, bonus: [] },
    ...over,
  });
  for (let pass = 0; pass < 5; pass++) {
    const d = derive(c);
    const choices = { ...c.choices };
    for (const ch of d.choices) if (!ch.selected) choices[ch.id] = ch.options[0].id;
    const spellsSel = { ...c.spells };
    for (const l of d.spellLists) {
      if (l.def.mode !== 'known' || l.def.id === 'granted') continue;
      const want = Math.max(0, l.count - l.granted.length);
      const cur = spellsSel[l.def.id] ?? [];
      if (cur.length !== want || cur.some((id) => !l.pool.some((p) => p.id === id))) spellsSel[l.def.id] = l.pool.slice(0, want).map((p) => p.id);
    }
    const picks = { ...c.alignment.picks };
    for (const a of d.alignmentChoices) if (!picks[a.pickKey]) picks[a.pickKey] = opts.light ?? 'Platinum';
    const skills = { ...c.skills };
    for (const s of d.skillSlots) if (!skills[s.id]) skills[s.id] = s.suggested ?? `Skill ${s.id}`;
    const need = d.issues.some((x) => x.startsWith('Assign'));
    const bonus = need ? [...c.attributes.bonus, 'PRS' as Attr] : c.attributes.bonus;
    c = { ...c, choices, spells: spellsSel, skills, alignment: { ...c.alignment, picks }, attributes: { ...c.attributes, bonus } };
  }
  return c;
}

/** Facet texts that apply: ancestry (+sub) from the document. */
// Bolstered & Hindered: each level is one step along the Mod Die sizes; past d12 it's +1 a level.
const DIE_LADDER = ['-d12', '-d10', '-d8', '-d6', '-d4', '-d2', '—', 'd2', 'd4', 'd6', 'd8', 'd10', 'd12'];
const stepLadder = (die: string, n: number) => {
  const i = DIE_LADDER.indexOf(die) + n;
  return i >= DIE_LADDER.length ? `d12+${i - DIE_LADDER.length + 1}` : DIE_LADDER[Math.max(0, i)];
};

function ancestryFacetTexts(v: Variant): MdFacet[] {
  const a = MD_ANCESTRIES.get(v.id)!;
  const anc = ancestries.find((x) => x.id === v.id)!;
  const subName = anc.subAncestries?.find((s) => s.id === v.sub)?.name;
  return [...a.facets, ...(subName ? (a.subs.get(subName) ?? []) : [])];
}

const RES_RE = /(\w+)(?:,? and (\w+))? Resistance equal to (half )?your (?:\w+ )?bonus/gi;
const ALIGN_RE = /gains? a level of ([^.]*?)Alignment/g;

/** Resistances granted by these texts at Class Bonus `cb`. */
function resistancesFromText(texts: string[], cb: number, into = new Map<string, number>()): Map<string, number> {
  const add = (t: string, v: number) => v > 0 && into.set(t, (into.get(t) ?? 0) + v);
  for (const text of texts) {
    for (const m of text.matchAll(RES_RE)) {
      const v = m[3] ? half(cb) : cb;
      add(m[1], v);
      if (m[2]) add(m[2], v);
    }
    if (/Resistance to all damage types except Crushing, Piercing, or Slashing, equal to half your Class bonus/i.test(text))
      for (const t of DAMAGE_TYPES.filter((x) => !['Crushing', 'Piercing', 'Slashing'].includes(x))) add(t, half(cb));
  }
  return into;
}

function lightsFromText(text: string): Light[] {
  return [...stripMd(text).matchAll(ALIGN_RE)].flatMap((m) => LIGHTS.filter((l) => new RegExp(`\\b${l}\\b`).test(m[1])));
}

const resMap = (d: Derived) => new Map(d.resistances.map((r) => [r.type, r.value]));

// ---------------------------------------------------------------------------
// Sanity of the document parse (so the expectations below mean something)
// ---------------------------------------------------------------------------

describe('rules document parse', () => {
  it('finds every app class in the document with a class table, Endurance and Save Checks', () => {
    for (const cls of classes) {
      const m = MD_CLASSES.get(cls.id)!;
      expect(m.rows.length, cls.id).toBeGreaterThan(0);
      expect(m.endurance.start, cls.id).toBeGreaterThan(0);
      expect(m.saveLine, cls.id).toMatch(/Save Checks/);
    }
  });
  it('reads the reference tables', () => {
    expect(MOD_DIE_TABLE).toHaveLength(12);
    expect(ATTRIBUTE_LIMIT.length).toBeGreaterThanOrEqual(3);
    expect(ARMOR_AC.map((r) => r.quality)).toEqual(['Basic', 'Adept', 'Expert', 'Master', 'Legendary']);
    expect(ARMOR_REQ).toEqual({ Light: 0, Medium: 1, Heavy: 3 });
    expect(SLASHING_VULN.size).toBe(6);
    expect(PERSONAL_ALIGNMENT).toHaveLength(8);
    expect(DAMAGE_TYPES).toHaveLength(14);
  });
});

// ---------------------------------------------------------------------------
// Data vs the document
// ---------------------------------------------------------------------------

describe('class data matches the rules document', () => {
  it.each(classes.map((c) => [c.id, c] as const))('%s: class table, Endurance, Alignment, Save Checks', (_id, cls) => {
    const m = MD_CLASSES.get(cls.id)!;
    const t = classTable(cls);
    expect(t.rows.map((r) => r.level)).toEqual(m.rows.map((r) => r.level));
    t.rows.forEach((r, i) => {
      expect(r.bonus).toBe(m.rows[i].bonus);
      expect(r.die).toBe(m.rows[i].die);
    });
    expect(maxClassLevel(cls)).toBe(Math.max(...m.rows.map((r) => r.level)));
    expect(classEndurance(cls)).toEqual(m.endurance);
    expect(classAlignment(cls)).toBe(m.alignment);
    const mdSaves = [...m.saveLine.matchAll(/\$\[(\w+)\]/g)].map((x) => x[1]);
    const expected = [...mdSaves, ...(/of your choice/.test(m.saveLine) ? ['choice'] : [])];
    expect([...cls.saveTandem].sort()).toEqual(expected.sort());
    expect(!!cls.saveEmpowered).toBe(/Empowered/.test(m.saveLine));
    // Armor rules: "add your X level … while not wearing armor" / "add your X Bonus … while wearing …"
    expect(cls.armor.some((r) => r.kind === 'levelUnarmored')).toBe(/level to your AC while not wearing armor/.test(m.armorLine));
    const bonusWith = cls.armor.find((r) => r.kind === 'bonusWith');
    const mdBonus = m.armorLine.match(/Bonus to your AC while wearing ([^.]*) armor/)?.[1] ?? '';
    const expectedTypes = /any kind/.test(mdBonus) ? ['Light', 'Medium', 'Heavy'] : (['Light', 'Medium', 'Heavy'] as const).filter((x) => mdBonus.includes(x));
    expect(bonusWith && bonusWith.kind === 'bonusWith' ? [...bonusWith.armor].sort() : []).toEqual([...expectedTypes].sort());
  });

  it('every class Class Die name matches its table header ("Arcana Die" …)', () => {
    for (const cls of classes) {
      const m = MD_CLASSES.get(cls.id)!;
      expect(Object.keys(m.rows[0].cols).some((h) => h === `${cls.dieName} Die`), cls.id).toBe(true);
    }
  });

  it.each(ancestries.map((a) => [a.id, a] as const))('%s: facet names match the document', (_id, anc) => {
    const m = MD_ANCESTRIES.get(anc.id)!;
    expect(anc.facets.map((f) => norm(f.name)).sort()).toEqual(m.facets.map((f) => norm(f.name)).sort());
    for (const s of anc.subAncestries ?? []) {
      expect(m.subs.has(s.name), `${anc.id}/${s.id}`).toBe(true);
      expect(s.facets.map((f) => norm(f.name)).sort()).toEqual((m.subs.get(s.name) ?? []).map((f) => norm(f.name)).sort());
    }
    expect([...m.subs.keys()].sort()).toEqual((anc.subAncestries ?? []).map((s) => s.name).sort());
  });

  it.each(MD_BACKGROUNDS.map((b) => [b.id, b] as const))('background %s matches the document', (_id, b) => {
    const bg = backgrounds.find((x) => x.id === b.id)!;
    expect(bg.profession).toBe(b.profession);
    expect(bg.hobbies).toEqual(b.hobbies);
    expect(heritageFacets.find((h) => h.id === bg.heritage)?.name).toBe(b.facet);
  });

  it('heritage facets exist in the document', () => {
    for (const h of heritageFacets) expect(section(new RegExp(`^### ${h.name}\\s*$`)), h.id).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

describe('Attribute Points → Mod Die (rules table)', () => {
  it.each(MOD_DIE_TABLE)('%i points → %s', (points, die) => {
    expect(formatDie(modDieFromPoints(points))).toBe(dieLabelOf(die));
    const { d } = built({ attributes: { method: 'manual', pool: 0, base: { VIG: points, AGI: 0, PER: 0, INT: 0, PRS: 0 }, bonus: [] } });
    expect(d.attrs.VIG.label).toBe(dieLabelOf(die));
    expect(d.attrs.VIG.points).toBe(points);
  });
  it('0 points has no Mod Die', () => {
    expect(formatDie(modDieFromPoints(0))).toBe('—');
  });
  it('each point beyond 6 adds +1 (and −1 below −6)', () => {
    expect(formatDie(modDieFromPoints(7))).toBe('d12+1');
    expect(formatDie(modDieFromPoints(9))).toBe('d12+3');
    expect(formatDie(modDieFromPoints(-8))).toBe('-d12-2');
  });
  it('Bolstered/Hindered steps: d10 Bolstered 2 → d12+1; d4 Hindered 4 → -d4 (rules examples)', () => {
    expect(formatDie(stepDie(modDieFromPoints(5), 2))).toBe('d12+1');
    expect(formatDie(stepDie(modDieFromPoints(2), -4))).toBe('-d4');
    expect(formatDie(stepDie(modDieFromPoints(-6), -2))).toBe('-d12-2');
  });
  it('parseDie / triangular / half', () => {
    expect(parseDie('1d6')).toEqual({ step: 3, bonus: 0 });
    expect(parseDie('-1d4')).toEqual({ step: -2, bonus: 0 });
    expect(parseDie('nothing')).toEqual({ step: 0, bonus: 0 });
    expect([0, 1, 2, 3, 4, -1, -2].map(triangular)).toEqual([0, 1, 3, 6, 10, -1, -3]);
    expect([1, 2, 3, 0].map(half)).toEqual([1, 1, 2, 0]); // BtP rounds up
  });
  it('Attribute Limit follows the rules table', () => {
    for (const [lvl, cap] of ATTRIBUTE_LIMIT) expect(attributeCap(lvl), `level ${lvl}`).toBe(cap);
    expect(attributeCap(3)).toBe(3);
    expect(attributeCap(9)).toBe(4);
    expect(POINT_BUY_POOL).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// The big matrix: every class × subclass × ancestry × level
// ---------------------------------------------------------------------------

const MATRIX_CLASSES = CLASS_VARIANTS; // all of them (cheap), in both modes
const MATRIX_ANCESTRIES = sample(ANCESTRY_VARIANTS, 4);

function expectInvariants(d: Derived, cls: ClassDef) {
  expect(badNumbers(d)).toEqual([]);
  expect(d.enduranceMax).toBeGreaterThan(0);
  expect(d.vitalityMax).toBeGreaterThanOrEqual(1);
  expect(d.radianceMax).toBeGreaterThanOrEqual(1);
  expect(d.restCharges).toBe(d.vitalityMax);
  expect(d.longRestTempEndurance).toBeGreaterThanOrEqual(0);
  expect(d.movement).toBeGreaterThanOrEqual(0);
  expect(d.ac.value).toBeGreaterThanOrEqual(0);
  expect(d.ac.value).toBeLessThan(40);
  expect(d.ac.breakdown.length).toBeGreaterThan(0);
  expect(Object.keys(d.attrs)).toEqual([...ATTRS]);
  for (const a of ATTRS) expect(d.attrs[a].label.length).toBeGreaterThan(0);
  expect(d.saves.map((s) => s.attr)).toEqual([...ATTRS]);
  expect(d.trackers).toEqual(cls.trackers ?? []);
  for (const r of d.resources) {
    expect(cls.resources.map((x) => x.name)).toContain(r.name);
    expect(r.max).toBeGreaterThan(0);
  }
  for (const l of d.spellLists) {
    expect(l.count).toBeGreaterThanOrEqual(0);
    expect(l.granted.length).toBeLessThanOrEqual(l.count);
    if (l.def.id !== 'granted' && l.def.mode === 'known' && l.count - l.granted.length > 0) expect(l.pool.length, `${l.def.id} pool`).toBeGreaterThanOrEqual(l.count - l.granted.length);
    if (l.def.mode === 'known') for (const s of l.selected) expect(l.pool.map((p) => p.id), l.def.id).toContain(s.id);
  }
  for (const f of d.facets) {
    expect(f.name.trim(), 'facet name').not.toBe('');
    expect(f.source.trim(), 'facet source').not.toBe('');
  }
  expect(new Set(d.facets.map((f) => f.key)).size, 'unique facet keys').toBe(d.facets.length);
  expect(new Set(d.skillSlots.map((s) => s.id)).size, 'unique skill slot ids').toBe(d.skillSlots.length);
  expect(d.todo.map((t) => t.text)).toEqual(d.issues);
  for (const t of d.todo) expect(BUILDER_STEPS.has(t.step), t.step).toBe(true);
  for (const a of d.alignment) {
    expect(LIGHTS).toContain(a.light);
    expect(a.level).toBeGreaterThanOrEqual(1);
    expect(a.level).toBeLessThanOrEqual(3);
  }
  for (let i = 1; i < d.alignmentRanked.length; i++) expect(d.alignmentRanked[i - 1].level).toBeGreaterThanOrEqual(d.alignmentRanked[i].level);
  expect(d.strongestLight).toBe(d.alignmentRanked[0]?.light);
  expect(d.actionCategories[0]).toBe('Basic');
  for (const a of cls.actions) expect(d.actionCategories).toContain(a);
  expect(new Set(d.actionCategories).size).toBe(d.actionCategories.length);
}

describe.each(MATRIX_CLASSES.map((v) => [v.label, v] as const))('matrix %s', (_label, v) => {
  const m = MD_CLASSES.get(v.cls.id)!;
  const subMd = mdSubclassFacets(v.cls, v.subName);
  it.each(MATRIX_ANCESTRIES.map((a) => [a.label, a] as const))('· %s · all levels', (_al, anc) => {
    for (const L of LEVELS) {
      const ctx = `${v.label} · ${anc.label} · L${L}`;
      const c = complete({ classId: v.cls.id, subclass: v.sub, ancestry: anc.id, subAncestry: anc.sub, level: L });
      const d = derive(c);
      expectInvariants(d, v.cls);
      // A complete character has nothing left to do.
      expect(d.todo, ctx).toEqual([]);

      // Level clamps to the rules' class table.
      const lvl = Math.min(L, Math.max(...m.rows.map((r) => r.level)), MAX_LEVEL);
      expect(d.level, ctx).toBe(lvl);
      const row = m.rows.find((r) => r.level === lvl)!;
      const cb = row.bonus;
      expect(d.classBonus, ctx).toBe(cb);
      expect(d.classDie, ctx).toBe(dieLabelOf(row.die));
      expect(d.classDieName).toBe(`${v.cls.dieName} Die`);

      const P = (a: Attr) => d.attrs[a].points;
      const ancTexts = ancestryFacetTexts(anc);
      const classTexts = m.facets.filter((f) => f.level <= lvl);
      const subTexts = subMd.filter((f) => f.level <= lvl);
      const chosenTexts = d.choices.map((ch) => mdOptionText(v.cls, ch.options.find((o) => o.id === ch.selected)?.name ?? ''));

      // Endurance: class start + per level, plus "Endurance Maximum gains a bonus equal to twice your Level".
      const twice = /Endurance Maximum gains a bonus equal to twice your Level/;
      const endBonus = [...ancTexts.map((f) => f.text), ...chosenTexts].filter((t) => twice.test(t)).length * 2 * lvl;
      expect(d.enduranceMax, ctx).toBe(m.endurance.start + m.endurance.perLevel * (lvl - 1) + endBonus);

      // Vitality 3 + 1 per 2 VIG; Radiance 1 + 1 per 2 PRS; plus facets.
      const extra = (stat: string) =>
        ancTexts.filter((f) => new RegExp(`an additional \\*?${stat}\\*?`).test(f.text) || new RegExp(`additional ${stat}`).test(f.text)).length +
        classTexts.filter((f) => new RegExp(`additional \\*${stat}\\* equal to half your`).test(f.text)).length * half(cb);
      expect(d.vitalityMax, ctx).toBe(3 + Math.floor(Math.max(0, P('VIG')) / 2) + extra('Vitality'));
      expect(d.radianceMax, ctx).toBe(1 + Math.floor(Math.max(0, P('PRS')) / 2) + extra('Radiance'));
      expect(d.longRestTempEndurance).toBe(Math.max(0, P('VIG')) * cb);

      // Movement 3 + triangular AGI (+1 per "Movement increases by 1 space").
      const fast = ancTexts.filter((f) => /Movement increases by 1 space/.test(f.text)).length;
      expect(d.movement, ctx).toBe(3 + triangular(P('AGI')) + fast);
      expect(d.radius).toBe(5 + triangular(P('PER')));
      for (const t of ['Swim', 'Climb']) {
        const has = ancTexts.some((f) => new RegExp(`${t} Movement equal to your Movement`).test(f.text));
        // A class facet granting it too that says "If you already have Swim Movement, it increases by 2 spaces".
        const plus = [...classTexts, ...subTexts].some((f) => new RegExp(`If you already have \\*${t} Movement\\*, it increases by 2 spaces`).test(f.text));
        if (has) expect(d.movementTypes, ctx).toContainEqual({ type: t, value: d.movement + (plus ? 2 : 0) });
        expect(d.movementTypes.filter((m) => m.type === t).length, ctx).toBeLessThanOrEqual(1);
      }
      // Jumps: 2 + VIG long, 1 + half VIG high; Powerful Jump (class facet) and Gravity Warp (ancestry) from their text.
      const powerful = classTexts.some((f) => /\*\*\*Powerful Jump\.\*\*\*/.test(f.text));
      const doubled = ancTexts.some((f) => /maximum distance you can move when you Jump is doubled/.test(f.text));
      const k = doubled ? 2 : 1;
      expect(d.jump, ctx).toEqual({
        long: (powerful ? Math.max(2 + P('VIG'), 2 * P('VIG')) : 2 + P('VIG')) * k,
        high: (powerful ? 1 + P('VIG') : 1 + Math.floor(P('VIG') / 2)) * k,
      });

      // Unarmored AC: two highest Attributes (+ level for the classes/ancestries that say so).
      const top = ATTRS.map(P).sort((a, b) => b - a);
      const lvlAc = (/level to your AC while not wearing armor/.test(m.armorLine) ? lvl : 0) + (ancTexts.some((f) => /while not wearing armor, you can add your Level to your AC/.test(f.text)) ? lvl : 0);
      expect(d.ac.value, ctx).toBe(top[0] + top[1] + lvlAc);

      // Unarmored Slashing Vulnerability by Vitality Maximum, unless "no Slashing Vulnerability".
      const noVuln = ancTexts.some((f) => /no Slashing Vulnerability/.test(f.text));
      expect(d.slashingVulnerability, ctx).toBe(noVuln ? '' : (SLASHING_VULN.get(d.vitalityMax) ?? ''));

      // Resistances: every "X Resistance equal to (half) your … Bonus" in the facets that apply.
      const expectedRes = resistancesFromText([...ancTexts.map((f) => f.text), ...classTexts.map((f) => stripMd(f.text)), ...subTexts.map((f) => stripMd(f.text))], cb);
      expect(resMap(d), ctx).toEqual(expectedRes);

      // Senses: Night Vision from facets.
      if (ancTexts.some((f) => f.name === 'Night Vision')) expect(d.senses).toContain('Night Vision');

      // Alignment: ancestry + class + Personal (Action/Reason/Apathy) + subclass facets + chosen options.
      const counts = new Map<Light, number>();
      const add = (l: Light) => counts.set(l, (counts.get(l) ?? 0) + 1);
      ancTexts.forEach((f) => lightsFromText(f.text).forEach(add));
      if (m.alignment === 'choice') add('Platinum');
      else if (m.alignment) add(m.alignment);
      add(PERSONAL_ALIGNMENT.find((r) => r[0] === 'Action' && r[1] === 'Reason' && r[2] === 'Apathy')![3] as Light);
      subTexts.forEach((f) => lightsFromText(f.text).forEach(add));
      chosenTexts.forEach((t) => lightsFromText(t).forEach(add));
      expect(Object.fromEntries(d.alignment.map((a) => [a.light, a.level])), ctx).toEqual(Object.fromEntries([...counts].map(([l, n]) => [l, Math.min(3, n)])));

      // Class table columns: resources, maneuvers known, max level, facets.
      for (const [h, val] of Object.entries(row.cols)) {
        if (/^(Level|.* Bonus|Facets|.* Die)$/.test(h)) continue;
        if (/Known/.test(h)) {
          const list = d.spellLists.find((l) => l.def.count.column);
          if (list) expect(list.count, `${ctx} ${h}`).toBe(numeric(val));
        } else if (/^Max/.test(h)) {
          expect(maxCastLevel(v.cls, lvl), `${ctx} ${h}`).toBe(Math.max(1, numeric(val)));
          for (const l of d.spellLists) if (l.def.pool.maxLevelColumn) for (const s of l.pool) expect(s.level, `${l.def.id}: ${s.name}`).toBeLessThanOrEqual(Math.max(numeric(val), 0) || 0);
        } else {
          const r = d.resources.find((x) => h.includes(x.name));
          if (numeric(val) > 0) {
            expect(r, `${ctx} resource ${h}`).toBeDefined();
            expect(r!.max).toBe(numeric(val));
            expect(r!.mode).toBe(/Limit/.test(h) ? 'limit' : 'pool');
          } else expect(r, `${ctx} resource ${h}`).toBeUndefined();
        }
      }
      const classFacetNames = d.facets.filter((f) => f.source === v.cls.name).map((f) => norm(f.name));
      const mdNames = m.rows.filter((r) => r.level <= lvl).flatMap((r) => r.facets.map(norm));
      expect(classFacetNames.sort(), ctx).toEqual([...mdNames].sort());
      const subFacetNames = d.facets.filter((f) => f.source === v.subName).map((f) => norm(f.name));
      expect(subFacetNames.sort(), ctx).toEqual(subTexts.map((f) => norm(f.name)).sort());
      const ancFacetNames = d.facets.filter((f) => f.key.startsWith('anc:')).map((f) => norm(f.name));
      expect(ancFacetNames.sort(), ctx).toEqual(ancTexts.map((f) => norm(f.name)).sort());

      // Save Checks: Tandem with the Class Die ("/"), "+" when Empowered.
      const tandem = new Set<string>([...m.saveLine.matchAll(/\$\[(\w+)\]/g)].map((x) => x[1]));
      if (/of your choice/.test(m.saveLine)) tandem.add(c.choices['save-attr']);
      const chosenTandem = chosenTexts.flatMap((t) => [...t.matchAll(/You roll \$\[(\w+)\] Save Checks in Tandem/g)].map((x) => x[1]));
      chosenTandem.forEach((a) => tandem.add(a));
      const empoweredFacet = new Set([...subTexts, ...classTexts].flatMap((f) => [...f.text.matchAll(/Your \$\[(\w+)\] Save Checks are Empowered/g)].map((x) => x[1])));
      // "Your $[X] Save (and Skill) Checks are Bolstered N" step the larger Mod Die (Bolstered & Hindered).
      const saveBolster = new Map<string, number>();
      for (const f of [...ancTexts, ...subTexts, ...classTexts])
        for (const x of f.text.matchAll(/[Yy]our (?:\$\[)?([A-Z]{3})\]? Save (?:and Skill )?Checks are Bolstered (\d+)/g)) saveBolster.set(x[1], (saveBolster.get(x[1]) ?? 0) + Number(x[2]));
      for (const s of d.saves) {
        const n = saveBolster.get(s.attr) ?? 0;
        const t = tandem.has(s.attr);
        const attrDie = d.attrs[s.attr].label;
        const stepAttr = !t || DIE_LADDER.indexOf(attrDie) >= DIE_LADDER.indexOf(d.classDie!);
        const die = stepAttr ? stepLadder(attrDie, n) : attrDie;
        const classDie = t && !stepAttr ? stepLadder(d.classDie!, n) : d.classDie;
        const emp = (t && /Empowered/.test(m.saveLine) && !chosenTandem.includes(s.attr)) || empoweredFacet.has(s.attr);
        const want = t ? `${die} ${emp ? '+' : '/'} ${classDie}` : emp ? `${die} + d4` : die;
        expect(s.label, `${ctx} ${s.attr} save`).toBe(want);
        expect(s.empowered).toBe(emp);
      }

      // Initiative: PER Die, in Tandem with the Class Die when a facet says so.
      const initTandem = [...classTexts, ...subTexts].some((f) => /Initiative Checks[^.]*rolled in Tandem with your \w+ Die/.test(f.text));
      expect(d.initiative, ctx).toBe(initTandem ? `${d.attrs.PER.label} / ${d.classDie}` : d.attrs.PER.label);

      // Spell / maneuver Mod Die.
      if (v.cls.spellAttr) expect(d.spellModDie, ctx).toBe(v.cls.spellDie === 'attr' ? d.attrs[(v.cls.spellAttr === 'choice' ? c.choices['spell-attr'] : v.cls.spellAttr) as Attr].label : d.classDie);
      else expect(d.spellModDie).toBeUndefined();
      expect(d.maneuverModDie).toBe(v.cls.maneuverDie ? d.classDie : undefined);
    }
  });
});

describe('every class without a subclass / ancestry still derives (partial characters)', () => {
  it.each(classes.map((c) => [c.id, c] as const))('%s', (_id, cls) => {
    for (const L of LEVELS) {
      const { d } = built({ classId: cls.id, level: L });
      expect(badNumbers(d)).toEqual([]);
      expect(d.issues).toContain(`Choose your ${cls.subclassLabel}.`);
      expect(d.todo.find((t) => t.fields.includes('subclass'))?.step).toBe('class');
      expect(d.todo.find((t) => t.fields.includes('ancestry'))?.step).toBe('ancestry');
      for (const t of d.todo) expect(BUILDER_STEPS.has(t.step)).toBe(true);
    }
  });
  it('a blank character derives with every unfinished step listed', () => {
    const d = derive(newCharacter());
    expect(badNumbers(d)).toEqual([]);
    const fields = d.todo.flatMap((t) => t.fields);
    for (const f of ['name', 'ancestry', 'heritage', 'class', 'alignment:situations', 'alignment:problems', 'alignment:people']) expect(fields).toContain(f);
    expect(d.classBonus).toBe(0);
    expect(d.enduranceMax).toBe(0);
    expect(d.resources).toEqual([]);
    expect(d.initiative).toBe(d.attrs.PER.label);
  });
  it('an unknown class / ancestry / heritage id is treated as unchosen', () => {
    const { d } = built({ classId: 'nope', ancestry: 'nope', background: { preset: 'nope', heritage: 'nope' } });
    expect(d.cls).toBeUndefined();
    expect(d.issues).toContain('Choose a Class.');
    expect(d.issues).toContain('Choose an Ancestry.');
    expect(badNumbers(d)).toEqual([]);
  });
  it('a sub-ancestry is required for Praedan and Soli', () => {
    for (const a of ancestries.filter((x) => x.subAncestries)) {
      const { d } = built({ ancestry: a.id });
      expect(d.todo.find((t) => t.fields.includes('subancestry'))?.text).toBe(`Choose a ${a.name} sub-ancestry.`);
    }
  });
});

describe('every choice option of every class derives cleanly', () => {
  const cases = CLASS_VARIANTS.flatMap((v) => {
    const d = derive(complete({ classId: v.cls.id, subclass: v.sub, ancestry: 'human', level: MAX_LEVEL }));
    return d.choices.flatMap((ch) => ch.options.map((o) => [`${v.label} · ${ch.id}=${o.id}`, v, ch.id, o.id] as const));
  });
  it.each(sample(cases, 8))('%s', (_n, v, chId, optId) => {
    const c = complete({ classId: v.cls.id, subclass: v.sub, ancestry: 'human', level: MAX_LEVEL, choices: { [chId]: optId } });
    const d = derive(c);
    expectInvariants(d, v.cls);
    expect(d.choices.find((x) => x.id === chId)?.selected).toBe(optId);
    expect(d.todo).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Level progression
// ---------------------------------------------------------------------------

describe('progression with level', () => {
  it.each(MATRIX_CLASSES.map((v) => [v.label, v] as const))('%s: nothing decreases as level rises; levels past the table clamp', (_l, v) => {
    for (const anc of sample(ANCESTRY_VARIANTS, 2)) {
      const ds = [1, 2, 3, 5, 10].map((L) => derive(complete({ classId: v.cls.id, subclass: v.sub, ancestry: anc.id, subAncestry: anc.sub, level: L })));
      for (let i = 1; i < ds.length; i++) {
        const [a, b] = [ds[i - 1], ds[i]];
        expect(b.level).toBeGreaterThanOrEqual(a.level);
        expect(b.classBonus).toBeGreaterThanOrEqual(a.classBonus);
        expect(b.enduranceMax).toBeGreaterThanOrEqual(a.enduranceMax);
        expect(b.vitalityMax).toBeGreaterThanOrEqual(a.vitalityMax);
        expect(b.radianceMax).toBeGreaterThanOrEqual(a.radianceMax);
        expect(b.facets.length).toBeGreaterThanOrEqual(a.facets.length);
        expect(b.choices.length).toBeGreaterThanOrEqual(a.choices.length);
        expect(maxCastLevel(v.cls, b.level)).toBeGreaterThanOrEqual(maxCastLevel(v.cls, a.level));
        expect(dieSize(b.classDie)).toBeGreaterThanOrEqual(dieSize(a.classDie));
        for (const r of a.resources) expect(b.resources.find((x) => x.name === r.name)?.max ?? 0).toBeGreaterThanOrEqual(r.max);
        for (const l of a.spellLists) {
          const nb = b.spellLists.find((x) => x.def.id === l.def.id && x.source === l.source);
          expect(nb, l.def.id).toBeDefined();
          expect(nb!.count).toBeGreaterThanOrEqual(l.count);
        }
        for (const al of a.alignment) expect(b.alignment.find((x) => x.light === al.light)?.level ?? 0).toBeGreaterThanOrEqual(al.level);
      }
      // Above the last level in the rules everything is as at that level.
      const top = ds[1];
      for (const d of ds.slice(2)) expect(d).toEqual(top);
      expect(top.level).toBe(Math.min(MAX_LEVEL, maxClassLevel(v.cls)));
    }
  });
  it('level 0 / negative levels clamp to 1', () => {
    const one = derive(complete({ classId: 'gladiator', subclass: 'victor', ancestry: 'human', level: 1 }));
    for (const L of [0, -3]) expect(derive(complete({ classId: 'gladiator', subclass: 'victor', ancestry: 'human', level: L }))).toEqual(one);
  });
});

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

describe('attributes', () => {
  it('point buy: 12 points spread from −1 each, no issue when fully spent', () => {
    const { d } = built({ attributes: { method: 'pointBuy', pool: 12, base: { ...POINT_BUY }, bonus: [] } });
    expect(d.pointBuy).toEqual({ spent: 12, pool: 12, cap: 3 });
    expect(d.todo.some((t) => t.fields.includes('attr-points'))).toBe(false);
  });
  it('point buy: under/over spending is an issue on the Attributes step', () => {
    for (const base of [{ ...POINT_BUY, PRS: -1 }, { ...POINT_BUY, PRS: 1 }]) {
      const { d } = built({ attributes: { method: 'pointBuy', pool: 12, base, bonus: [] } });
      const t = d.todo.find((x) => x.fields.includes('attr-points'))!;
      expect(t.step).toBe('attributes');
      expect(t.text).toMatch(/Attribute Points: \d+ of 12 spent/);
    }
  });
  it('rolled pools use their own total; manual skips the check', () => {
    const rolled = built({ attributes: { method: 'rolled', pool: 14, base: { VIG: 3, AGI: 3, PER: 2, INT: 0, PRS: 1 }, bonus: [] } }).d;
    expect(rolled.todo.some((t) => t.fields.includes('attr-points'))).toBe(false);
    const manual = built({ attributes: { method: 'manual', pool: 12, base: { VIG: 3, AGI: 3, PER: 3, INT: 3, PRS: 3 }, bonus: [] } }).d;
    expect(manual.todo.some((t) => t.fields.includes('attr-points'))).toBe(false);
  });
  it('the Attribute cap is 3 at level 1 ("you can put no more than 4 points into any one Attribute")', () => {
    const { d } = built({ attributes: { method: 'manual', pool: 12, base: { VIG: 4, AGI: -1, PER: -1, INT: -1, PRS: -1 }, bonus: [] } });
    expect(d.todo.find((t) => t.fields.includes('attr:VIG'))?.text).toBe('VIG is above the level 1 Attribute cap of 3.');
  });
  it('Human Bonus Attribute Point: one extra point, assigned in the builder, counted against the cap', () => {
    const base = { ...POINT_BUY };
    const unassigned = built({ ancestry: 'human', attributes: { method: 'pointBuy', pool: 12, base, bonus: [] } }).d;
    expect(unassigned.todo.find((t) => t.fields.includes('attr-bonus'))?.text).toBe('Assign 1 bonus Attribute Point(s).');
    const assigned = built({ ancestry: 'human', attributes: { method: 'pointBuy', pool: 12, base, bonus: ['PRS'] } }).d;
    expect(assigned.attrs.PRS.points).toBe(1);
    expect(assigned.attrs.PRS.sources).toContain('+1 Bonus Attribute Point');
    expect(assigned.pointBuy.spent).toBe(12); // the bonus isn't part of the pool
    expect(assigned.todo.some((t) => t.fields.includes('attr-points') || t.fields.includes('attr-bonus'))).toBe(false);
    // Only as many bonus points as facets grant are counted.
    const extra = built({ ancestry: 'human', attributes: { method: 'pointBuy', pool: 12, base, bonus: ['PRS', 'PRS', 'INT'] } }).d;
    expect(extra.attrs.PRS.points).toBe(1);
    expect(extra.attrs.INT.points).toBe(1);
    // Non-humans get none.
    expect(built({ ancestry: 'ori', attributes: { method: 'pointBuy', pool: 12, base, bonus: ['PRS'] } }).d.attrs.PRS.points).toBe(0);
    // Bonus pushing past the cap is flagged.
    const over = built({ ancestry: 'human', attributes: { method: 'manual', pool: 12, base: { ...EVEN, VIG: 3 }, bonus: ['VIG'] } }).d;
    expect(over.attrs.VIG.points).toBe(4);
    expect(over.todo.some((t) => t.fields.includes('attr:VIG'))).toBe(true);
  });
  it('age-ups cost one point each and give two Hobbies and a Profession', () => {
    const { d } = built({ ageUps: ['VIG', 'AGI', 'VIG'], attributes: { method: 'manual', pool: 12, base: { ...EVEN }, bonus: [] } });
    expect(d.attrs.VIG.points).toBe(0);
    expect(d.attrs.AGI.points).toBe(1);
    expect(d.attrs.VIG.sources).toContain('−2 age-up');
    const age = d.skillSlots.filter((s) => s.source.startsWith('Age-up'));
    expect(age).toHaveLength(9);
    expect(age.filter((s) => s.kind === 'profession').every((s) => s.rank === 'Proficient')).toBe(true);
    expect(age.filter((s) => s.kind === 'hobby')).toHaveLength(6);
  });
  it('negative attributes: −d dice, movement and radius shrink, no skill slots, jump floors', () => {
    const { d } = built({ attributes: { method: 'manual', pool: 0, base: { VIG: -2, AGI: -1, PER: -3, INT: -1, PRS: -1 }, bonus: [] } });
    expect(d.attrs.VIG.label).toBe('-d4');
    expect(d.movement).toBe(2);
    expect(d.radius).toBe(5 - 6);
    expect(d.vitalityMax).toBe(3);
    expect(d.radianceMax).toBe(1);
    expect(d.longRestTempEndurance).toBe(0);
    expect(d.jump).toEqual({ long: 0, high: 0 });
    expect(d.skillSlots.filter((s) => s.source === 'Intelligence' || s.source === 'Presence')).toEqual([]);
    expect(badNumbers(d)).toEqual([]);
  });
  it('Movement: base 3, +1 then +2 … per AGI point (rules: "+1 at 1, +2 at 2")', () => {
    for (const [agi, mv] of [
      [0, 3],
      [1, 4],
      [2, 6],
      [3, 9],
    ])
      expect(built({ attributes: { method: 'manual', pool: 0, base: { ...EVEN, AGI: agi }, bonus: [] } }).d.movement).toBe(mv);
  });
  it('Vitality, Radiance, Bulk and jumps from VIG/PRS points', () => {
    const { d } = built({ classId: 'gladiator', attributes: { method: 'manual', pool: 0, base: { VIG: 3, AGI: 0, PER: 0, INT: 0, PRS: 3 }, bonus: [] } });
    expect(d.vitalityMax).toBe(4);
    expect(d.radianceMax).toBe(2);
    expect(d.jump).toEqual({ long: 5, high: 2 });
    expect(d.bulkSlots).toEqual([
      { rank: 1, slots: 2 },
      { rank: 2, slots: 4 },
      { rank: 3, slots: 6 },
      { rank: 4, slots: 4 },
      { rank: 5, slots: 5 },
    ]);
    expect(d.longRestTempEndurance).toBe(3 * 2);
  });
  it('Ulu Gravity Warp — the maximum distance you can move when you Jump is doubled', () => {
    expect(ancestryFacetTexts({ id: 'ulu', sub: '', label: 'ulu' }).find((f) => f.name === 'Gravity Warp')!.text).toMatch(/maximum distance you can move when you Jump is doubled/);
    const { d } = built({ ancestry: 'ulu', attributes: { method: 'manual', pool: 0, base: { VIG: 2, AGI: 0, PER: 0, INT: 0, PRS: 0 }, bonus: [] } });
    expect(d.jump.long).toBe(2 * (2 + 2));
  });
  it('Berserker Barbarous Light (Powerful Jump) — High Jump is 1 + VIG, Long Jump max 2×VIG if larger', () => {
    const { d } = built({ classId: 'berserker', subclass: 'roaring-fervor', attributes: { method: 'manual', pool: 0, base: { VIG: 3, AGI: 0, PER: 0, INT: 0, PRS: 0 }, bonus: [] } });
    expect(d.jump).toEqual({ long: 6, high: 4 });
  });
});

// ---------------------------------------------------------------------------
// AC & armor
// ---------------------------------------------------------------------------

describe('AC and armor', () => {
  const attrs = { method: 'manual' as const, pool: 0, base: { VIG: 3, AGI: 1, PER: 2, INT: 0, PRS: -1 }, bonus: [] };
  it('unarmored: sum of the two highest Attributes', () => {
    expect(built({ classId: 'arcanist', attributes: attrs }).d.ac.value).toBe(5);
  });
  it('unarmored: Berserker / Incarnate add their level; Soli adds its level', () => {
    expect(built({ classId: 'berserker', level: 2, attributes: attrs }).d.ac.value).toBe(7);
    expect(built({ classId: 'incarnate', level: 1, attributes: attrs }).d.ac.value).toBe(6);
    expect(built({ classId: 'berserker', level: 2, ancestry: 'soli', subAncestry: 'flame', attributes: attrs }).d.ac.value).toBe(9);
  });
  const armorCases = ARMOR_AC.flatMap((q) => (['Light', 'Medium', 'Heavy'] as const).map((type) => [q.quality, type, q[type]] as const));
  it.each(armorCases)('%s %s armor: table AC + attribute points (+ Class Bonus where the class allows)', (quality, type, acv) => {
    const attr = type === 'Light' ? 'AGI' : type === 'Medium' ? 'PER' : 'VIG';
    for (const cls of classes) {
      const m = MD_CLASSES.get(cls.id)!;
      const { d } = built({ classId: cls.id, attributes: attrs, equipment: { armor: { type, quality }, weapons: [], inventory: [] } });
      const mdBonus = m.armorLine.match(/Bonus to your AC while wearing ([^.]*) armor/)?.[1] ?? '';
      const gets = /any kind/.test(mdBonus) || mdBonus.includes(type);
      expect(d.ac.value, `${cls.id} ${quality} ${type}`).toBe(acv + attrs.base[attr] + (gets ? d.classBonus : 0));
      expect(d.slashingVulnerability).toBe('');
      expect(d.vulnerabilities.find((v) => v.source === 'unarmored')).toBeUndefined();
      const r = resMap(d);
      if (type === 'Medium') {
        expect(r.get('Slashing')).toBe(half(acv));
        expect(d.saves.find((s) => s.attr === 'AGI')!.notes).toContain('Hindered 1 (Weighty (Medium armor))');
      }
      if (type === 'Heavy') {
        expect(r.get('Slashing')).toBe(acv);
        expect(r.get('Piercing')).toBe(half(acv));
      }
      if (type === 'Light') expect(r.has('Slashing')).toBe(false);
      // Armor requirements: VIG 3 meets every type.
      expect(d.armorNotes.some((n) => n.includes('VIG for'))).toBe(false);
    }
  });
  it('armor VIG requirement not met → AGI Checks Weakened note', () => {
    for (const type of ['Medium', 'Heavy'] as const) {
      const { d } = built({ attributes: { ...attrs, base: { ...attrs.base, VIG: ARMOR_REQ[type] - 1 } }, equipment: { armor: { type, quality: 'Basic' }, weapons: [], inventory: [] } });
      expect(d.armorNotes.join(' ')).toContain(`You need ${ARMOR_REQ[type]} VIG for ${type} armor`);
    }
  });
  it('Heavy armor: Movement −1 and AGI Mod Die one step smaller', () => {
    const plain = built({ attributes: attrs }).d;
    const { d } = built({ attributes: attrs, equipment: { armor: { type: 'Heavy', quality: 'Basic' }, weapons: [], inventory: [] } });
    expect(d.movement).toBe(plain.movement - 1);
    expect(d.attrs.AGI.label).toBe('—'); // d2 → no die
    expect(d.attrs.AGI.dieNote).toMatch(/Heavy armor/);
    expect(d.attrs.AGI.points).toBe(1); // points (and so Movement from AGI) unchanged
    const agi3 = built({ attributes: { ...attrs, base: { ...attrs.base, AGI: 3 } }, equipment: { armor: { type: 'Heavy', quality: 'Basic' }, weapons: [], inventory: [] } }).d;
    expect(agi3.attrs.AGI.label).toBe('d4');
  });
  it('Soli Slashing Resistance stacks with armor resistance', () => {
    const { d } = built({ ancestry: 'soli', subAncestry: 'frost', classId: 'gladiator', attributes: attrs, equipment: { armor: { type: 'Heavy', quality: 'Basic' }, weapons: [], inventory: [] } });
    expect(resMap(d).get('Slashing')).toBe(6 + half(2));
    // Sturdy Scales only adds level to AC while unarmored.
    expect(d.ac.value).toBe(6 + 3 + 2);
  });
  it('Blocking weapons add to AC (Heavy +1, Massive +2); Massive weapons cost 2 Movement', () => {
    const w = (name: string) => ({ id: name, name });
    const base = built({ attributes: attrs }).d;
    expect(weapons.find((x) => x.name === 'Kite Shield')?.properties).toContain('Blocking');
    expect(built({ attributes: attrs, equipment: { armor: null, weapons: [w('Kite Shield')], inventory: [] } }).d.ac.value).toBe(base.ac.value + 1);
    expect(built({ attributes: attrs, equipment: { armor: null, weapons: [w('Round Shield')], inventory: [] } }).d.ac.value).toBe(base.ac.value);
    const gs = built({ attributes: attrs, equipment: { armor: null, weapons: [w('Greatshield')], inventory: [] } }).d;
    expect(gs.ac.value).toBe(base.ac.value + 2);
    expect(gs.movement).toBe(base.movement - 2);
    expect(built({ attributes: attrs, equipment: { armor: null, weapons: [w('Greatsword')], inventory: [] } }).d.movement).toBe(base.movement - 2);
    // Unknown weapons are ignored.
    expect(built({ attributes: attrs, equipment: { armor: null, weapons: [w('Banana')], inventory: [] } }).d.ac.value).toBe(base.ac.value);
  });
  it('an unknown armor quality gives 0 armor AC but still counts as armored', () => {
    const { d } = built({ attributes: attrs, equipment: { armor: { type: 'Light', quality: 'Mythic' }, weapons: [], inventory: [] } });
    expect(d.ac.value).toBe(attrs.base.AGI);
    expect(d.slashingVulnerability).toBe('');
  });
});

describe('unarmored Slashing Vulnerability (rules table)', () => {
  it.each([...SLASHING_VULN.entries()])('Vitality Maximum %i → %s', (vit, dice) => {
    // VIG 0 gives Vitality 3; homebrew "max vitality" moves it.
    const hb: HomebrewEntry = { id: 'v', kind: 'effect', name: 'Vit', rows: [{ id: 'r', effect: { kind: 'max', stat: 'vitality', amount: vit - 3 } }] };
    const { d } = built({ attributes: { method: 'manual', pool: 0, base: { VIG: 0, AGI: 0, PER: 0, INT: 0, PRS: 0 }, bonus: [] }, homebrew: [hb] });
    expect(d.vitalityMax).toBe(vit);
    expect(d.slashingVulnerability).toBe(dice);
    expect(d.vulnerabilities).toContainEqual({ type: 'Slashing', dice, source: 'unarmored' });
  });
  it('Vitality above the table → none', () => {
    const { d } = built({ attributes: { method: 'manual', pool: 0, base: { VIG: 6, AGI: 0, PER: 0, INT: 0, PRS: 0 }, bonus: [] }, ancestry: 'mundalf' });
    expect(d.vitalityMax).toBe(7);
    expect(d.slashingVulnerability).toBe('');
  });
  it('Mundalf Extra Vitality and Champion Apostle’s Light move it', () => {
    const z = { method: 'manual' as const, pool: 0, base: { VIG: 0, AGI: 0, PER: 0, INT: 0, PRS: 0 }, bonus: [] };
    expect(built({ attributes: z, ancestry: 'mundalf' }).d.slashingVulnerability).toBe(SLASHING_VULN.get(4));
    expect(built({ attributes: z, ancestry: 'mundalf', classId: 'champion' }).d.slashingVulnerability).toBe(SLASHING_VULN.get(5));
  });
});

// ---------------------------------------------------------------------------
// Checks: saves & initiative
// ---------------------------------------------------------------------------

describe('Save Checks and Initiative', () => {
  const attrs = { method: 'manual' as const, pool: 0, base: { VIG: 3, AGI: 2, PER: 2, INT: 2, PRS: 2 }, bonus: [] };
  it('Gladiator: PER plus a chosen Attribute in Tandem; the choice is a todo until picked', () => {
    const un = built({ classId: 'gladiator', subclass: 'victor', attributes: attrs }).d;
    expect(un.todo.find((t) => t.fields.includes('choice:save-attr'))?.step).toBe('class');
    expect(un.choices.find((c) => c.id === 'save-attr')!.options.map((o) => o.id)).toEqual(['VIG', 'AGI', 'INT', 'PRS']);
    const d = built({ classId: 'gladiator', subclass: 'victor', attributes: attrs, choices: { 'save-attr': 'AGI' } }).d;
    expect(d.saves.find((s) => s.attr === 'AGI')!.label).toBe('d4 / d6');
    expect(d.saves.find((s) => s.attr === 'PER')!.label).toBe('d4 / d6');
    expect(d.saves.find((s) => s.attr === 'INT')!.label).toBe('d4');
  });
  it('Victor (Peerless Athlete): VIG saves Empowered — "+ d4" alone, "+ Martial Die" when Tandem', () => {
    const alone = built({ classId: 'gladiator', subclass: 'victor', attributes: attrs, choices: { 'save-attr': 'AGI' } }).d;
    expect(alone.saves.find((s) => s.attr === 'VIG')!.label).toBe('d6 + d4');
    expect(alone.saves.find((s) => s.attr === 'VIG')!.notes).toContain('Empowered (Peerless Athlete)');
    const tandem = built({ classId: 'gladiator', subclass: 'victor', attributes: attrs, choices: { 'save-attr': 'VIG' } }).d;
    expect(tandem.saves.find((s) => s.attr === 'VIG')!.label).toBe('d6 + d6');
  });
  it('Initiative: PER Die; Victor/Berserker show "PER / Class Die"; First Responder Bolstered 1', () => {
    expect(built({ classId: 'arcanist', attributes: attrs }).d.initiative).toBe('d4');
    expect(built({ classId: 'berserker', attributes: attrs }).d.initiative).toBe('d4 / d6');
    const v = built({ classId: 'gladiator', subclass: 'victor', attributes: { ...attrs, base: { ...attrs.base, PER: 1 } } }).d;
    expect(v.initiative).toBe('d2 / d6');
    expect(v.initiativeNotes.join(' ')).toMatch(/Tandem with Martial Die/);
    expect(built({ classId: 'gladiator', subclass: '', attributes: attrs }).d.initiative).toBe('d4'); // no Victor, no Tandem
    const fr = built({ background: { preset: '', heritage: 'first-responder' }, attributes: attrs }).d;
    expect(fr.initiativeNotes).toContain('Bolstered 1 (First Responder)');
    expect(fr.initiative).toBe(stepLadder(fr.attrs.PER.label, 1));
    expect(fr.initiativeParts).toEqual([{ text: fr.initiative, shift: 1 }]);
  });
  it('Initiative is a PER Check: Hindered PER Checks step its larger die (Numbed 1 on Victor d2 / d6 → d2 / d4)', () => {
    const play = { ...newCharacter().play, conditions: [{ name: 'Numbed', level: 1 }] };
    const v = built({ classId: 'gladiator', subclass: 'victor', attributes: { ...attrs, base: { ...attrs.base, PER: 1 } }, play }).d;
    expect(v.initiative).toBe('d2 / d4');
    expect(v.initiativeParts).toEqual([{ text: 'd2' }, { text: ' / ' }, { text: 'd4', shift: -1 }]);
    expect(v.initiativeNotes).toContain('Hindered 1 (Numbed 1)');
  });
  it('Incarnate INT Manifestation adds INT saves in Tandem (not Empowered)', () => {
    const d = built({ classId: 'incarnate', level: 2, attributes: attrs, choices: { manifestation: 'INT' } }).d;
    expect(d.saves.find((s) => s.attr === 'INT')!.label).toBe('d4 / d6');
    expect(built({ classId: 'incarnate', level: 1, attributes: attrs, choices: { manifestation: 'INT' } }).d.saves.find((s) => s.attr === 'INT')!.label).toBe('d4');
  });
  it('ancestry save bolsters step the die and show their source (Corpug Grit on VIG, Ori Unyielding on PRS)', () => {
    const vig = built({ ancestry: 'corpug', attributes: attrs }).d.saves.find((s) => s.attr === 'VIG')!;
    expect(vig.notes).toContain('Bolstered 1 (Grit)');
    expect(vig.label).toBe(stepLadder(built({ ancestry: 'corpug', attributes: attrs }).d.attrs.VIG.label, 1));
    expect(vig.shift).toBe(1);
    const prs = built({ ancestry: 'ori', attributes: attrs }).d.saves.find((s) => s.attr === 'PRS')!;
    expect(prs.notes).toContain('Bolstered 1 (Unyielding)');
    expect(prs.label).toBe(stepLadder(built({ ancestry: 'ori', attributes: attrs }).d.attrs.PRS.label, 1));
  });
  it('Bolstered and Hindered levels on a save add up across Conditions and armor, and step the die', () => {
    // Sluggish 1 (AGI Checks Hindered 1) and Medium armor (Weighty: AGI Save Checks Hindered 1): one line, Hindered 2.
    const medium = { armor: { type: 'Medium' as const, quality: ARMOR_AC[0].quality }, weapons: [], inventory: [] };
    const { d } = built({ attributes: { ...attrs, base: { ...attrs.base, AGI: 4 } }, equipment: medium, play: { ...newCharacter().play, conditions: [{ name: 'Sluggish', level: 1 }] } });
    const agi = d.saves.find((s) => s.attr === 'AGI')!;
    expect(agi.notes.filter((n) => /Hindered/.test(n))).toEqual(['Hindered 2 (Sluggish 1, Weighty (Medium armor))']);
    expect(agi.shift).toBe(-2);
    expect(agi.label).toBe(stepLadder(d.attrs.AGI.label, -2));
    expect(agi.parts).toEqual([{ text: agi.label, shift: -2 }]);
  });
  it('a Hindered Tandem save steps only the larger die (Victor AGI d4 / d6, Weighty → d4 / d4)', () => {
    const medium = { armor: { type: 'Medium' as const, quality: ARMOR_AC[0].quality }, weapons: [], inventory: [] };
    const agi = built({ classId: 'gladiator', subclass: 'victor', attributes: attrs, choices: { 'save-attr': 'AGI' }, equipment: medium }).d.saves.find((s) => s.attr === 'AGI')!;
    expect(agi.label).toBe('d4 / d4');
    expect(agi.parts).toEqual([{ text: 'd4' }, { text: ' / ' }, { text: 'd4', shift: -1 }]);
  });
  it('without a class, saves are just the Attribute Die', () => {
    const d = built({ attributes: attrs }).d;
    expect(d.saves.map((s) => s.label)).toEqual(['d6', 'd4', 'd4', 'd4', 'd4']);
  });
  it('Empowered Tandem save with an Attribute Die below d4 rolls an extra d4 instead of summing (Arcanist INT 1)', () => {
    // Rules (Empowered & Weakened): roll an extra d4, or if the Check is rolled in Tandem with two
    // Mod Dice that are BOTH d4s or larger, add their results together.
    const d = built({ classId: 'arcanist', attributes: { ...attrs, base: { ...attrs.base, INT: 1 } } }).d;
    expect(d.saves.find((s) => s.attr === 'INT')!.label).not.toBe('d2 + d6');
    expect(d.saves.find((s) => s.attr === 'INT')!.label).toContain('d4');
  });
  it('Empowered Tandem save with no Attribute Die shows only the other die plus d4 (Thaumaturge PRS 0)', () => {
    const d = built({ classId: 'thaumaturge', attributes: { ...attrs, base: { ...attrs.base, PRS: 0 } } }).d;
    expect(d.saves.find((s) => s.attr === 'PRS')!.label).not.toMatch(/^— \+/);
  });
});

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

describe('alignment', () => {
  it.each(PERSONAL_ALIGNMENT.map((r) => [r.slice(0, 3).join('/'), r] as const))('Personal Alignment %s → per the rules table', (_n, r) => {
    const [situations, problems, people, result] = r as [Character['alignment']['situations'], Character['alignment']['problems'], Character['alignment']['people'], string];
    const { d } = built({ alignment: { situations, problems, people, picks: {} } });
    if (result === 'Any Light') {
      expect(d.alignmentChoices).toContainEqual({ pickKey: 'personal', source: 'Personal Alignment' });
      const t = d.todo.find((x) => x.fields.includes('light:personal'))!;
      expect(t.step).toBe('details');
      const picked = built({ alignment: { situations, problems, people, picks: { personal: 'Temporal' } } }).d;
      expect(picked.alignment).toEqual([{ light: 'Temporal', level: 1, sources: ['Personal Alignment'] }]);
      expect(picked.todo.some((x) => x.fields.includes('light:personal'))).toBe(false);
    } else {
      expect(d.alignment).toEqual([{ light: result, level: 1, sources: ['Personal Alignment'] }]);
      expect(d.alignmentChoices).toEqual([]);
    }
  });
  it('unanswered questions are todos on Final Details listing exactly the missing ones', () => {
    const { d } = built({ alignment: { situations: 'Action', problems: '', people: '', picks: {} } });
    const t = d.todo.find((x) => x.text === 'Answer the Personal Alignment questions.')!;
    expect(t.step).toBe('details');
    expect(t.fields).toEqual(['alignment:problems', 'alignment:people']);
    expect(d.alignment).toEqual([]);
  });
  it('levels stack to Strong (3) and no further: Human + Gladiator + Action/Reason/Apathy + homebrew Flame', () => {
    const hb: HomebrewEntry = { id: 'f', kind: 'facet', name: 'Ember', rows: [{ id: 'r', effect: { kind: 'alignment', light: 'Flame' } }] };
    const three = built({ ancestry: 'human', classId: 'gladiator', alignment: { situations: 'Action', problems: 'Reason', people: 'Apathy', picks: {} } }).d;
    expect(three.alignment).toEqual([{ light: 'Flame', level: 3, sources: ['Flaming Soul', 'Gladiator', 'Personal Alignment'] }]);
    const four = built({ ancestry: 'human', classId: 'gladiator', homebrew: [hb], alignment: { situations: 'Action', problems: 'Reason', people: 'Apathy', picks: {} } }).d;
    expect(four.alignment[0].level).toBe(3);
    expect(four.alignment[0].sources).toHaveLength(4);
  });
  it('strongest Light: highest level, ties to Personal Alignment, then the class Light, then rulebook order', () => {
    // Cogitani Pneuma, Arcanist Lunar, personal Soma: all Weak → personal wins.
    const a = built({ ancestry: 'cogitani', classId: 'arcanist', alignment: { situations: 'Patience', problems: 'Instinct', people: 'Apathy', picks: {} } }).d;
    expect(a.strongestLight).toBe('Soma');
    // No personal answers: class Light (Lunar) beats Pneuma.
    expect(built({ ancestry: 'cogitani', classId: 'arcanist' }).d.strongestLight).toBe('Lunar');
    // Ancestry only: its Light.
    expect(built({ ancestry: 'cogitani' }).d.strongestLight).toBe('Pneuma');
    // Firm beats Weak: Ori Infernal + Champion Infernal vs personal Flame.
    const c = built({ ancestry: 'ori', classId: 'champion', alignment: { situations: 'Action', problems: 'Reason', people: 'Apathy', picks: {} } }).d;
    expect(c.strongestLight).toBe('Infernal');
    expect(c.alignmentRanked.map((x) => x.light)).toEqual(['Infernal', 'Flame']);
    expect(built({}).d.strongestLight).toBeUndefined();
  });
  it('Troubadour: "an Alignment of your choice" needs a pick on the Class step', () => {
    const un = built({ classId: 'troubadour' }).d;
    expect(un.alignmentChoices).toContainEqual({ pickKey: 'class', source: 'Troubadour' });
    const t = un.todo.find((x) => x.fields.includes('light:class'))!;
    expect(t.step).toBe('class');
    const picked = built({ classId: 'troubadour', alignment: { situations: '', problems: '', people: '', picks: { class: 'Velvet' } }, choices: { 'favored-genre': 'romance' } }).d;
    expect(picked.alignment).toEqual([{ light: 'Velvet', level: 2, sources: ['Favored Genre: Romance', 'Troubadour'] }]);
  });
  it('Champion’s Aura options grant their Light (rules: Connection Temporal, Force Infernal, Subversion Lunar)', () => {
    const champ = classes.find((c) => c.id === 'champion')!;
    for (const opt of champ.choices![0].options) {
      const light = lightsFromText(mdOptionText(champ, opt.name))[0];
      const d = built({ classId: 'champion', choices: { 'champions-aura': opt.id } }).d;
      expect(d.alignment.find((a) => a.light === light), opt.id).toBeDefined();
    }
  });
  it('Kinesis Triumvirate Potential Conversion: Flame, Frost and Velvet', () => {
    const d = built({ classId: 'arcanist', subclass: 'kinesis-triumvirate' }).d;
    expect(d.alignment.map((a) => a.light)).toEqual(['Flame', 'Frost', 'Velvet', 'Lunar']);
  });
});

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

describe('Hobby & Profession slots', () => {
  // Ranks & Leveling up: "Starting at level 3 and every odd level after, you can increase the rank of
  // one of your Hobbies or Professions by one step, or you can become a Novice in a new Hobby."
  const rankBlock = LINES.slice(LINES.findIndex((l) => /^##### Hobby & Profession Ranks/.test(l)));
  const rankRows = rankBlock.slice(0, rankBlock.findIndex((l) => l.startsWith('}}'))).filter((l) => /^\|\s*\w/.test(l)).map((l) => l.split('|').slice(1, -1).map((x) => x.trim()));
  const RANK_TABLE = rankRows.filter((r) => /^1d\d+$/.test(r[0])).map(([die, rank]) => ({ die: die.slice(1), rank }));
  const CAP_TABLE = rankRows.filter((r) => /^\d+$/.test(r[0])).map(([lv, rank]) => ({ level: Number(lv), rank }));
  const capAt = (lv: number) => [...CAP_TABLE].reverse().find((r) => lv >= r.level)!.rank;
  const zero = { method: 'manual' as const, pool: 0, base: { VIG: 0, AGI: 0, PER: 0, INT: 0, PRS: 0 }, bonus: [] };
  it('rank increases: one at level 3 and every odd level after; the cap follows the rules table', () => {
    expect(RANK_TABLE.map((r) => r.rank)).toEqual(['Novice', 'Amateur', 'Proficient', 'Adept', 'Master']);
    expect(CAP_TABLE.length).toBe(3);
    for (let lv = 1; lv <= 20; lv++) {
      expect(skillRankAllowance(lv).available, `level ${lv}`).toBe([3, 5, 7, 9, 11, 13, 15, 17, 19].filter((x) => x <= lv).length);
      expect(skillRankAllowance(lv).cap, `level ${lv}`).toBe(capAt(lv));
    }
    // What derive reports for a character (the alpha rules stop at level 2: no increases yet).
    const { d } = built({ classId: 'expert', subclass: 'investigator', level: 2, attributes: zero });
    expect(d.skillRanks).toEqual({ ...skillRankAllowance(d.level), used: 0 });
  });
  it('raising a rank steps its die and uses an increase; a Novice Hobby uses one too', () => {
    const { d } = built({ classId: 'expert', subclass: 'investigator', level: 2, attributes: zero, skills: { 'bg-hobby-1': 'Climbing', 'lvl-hobby-1': 'Whittling' }, skillRanks: { 'bg-hobby-1': 'Proficient' }, noviceHobbies: 1 });
    const raised = d.skillSlots.find((s) => s.id === 'bg-hobby-1')!;
    expect([raised.baseRank, raised.rank]).toEqual(['Amateur', 'Proficient']);
    expect(RANK_DIE[raised.rank]).toBe(RANK_TABLE.find((r) => r.rank === 'Proficient')!.die);
    const novice = d.skillSlots.find((s) => s.id === 'lvl-hobby-1')!;
    expect([novice.kind, novice.rank, novice.name]).toEqual(['hobby', 'Novice', 'Whittling']);
    expect(d.skillRanks.used).toBe(2);
  });
  it('ranks can be edited freely (a PM may allow it): only unspent increases are left to do', () => {
    const cls = { classId: 'expert', subclass: 'investigator' };
    // Raised at level 1 (no increases yet) or lowered: shown as set, nothing to fix.
    const free = built({ ...cls, level: 1, attributes: zero, skillRanks: { 'bg-hobby-1': 'Master', 'bg-prof-1': 'Novice' } }).d;
    expect(free.skillSlots.find((s) => s.id === 'bg-hobby-1')!.rank).toBe('Master');
    expect(free.skillSlots.find((s) => s.id === 'bg-prof-1')!.rank).toBe('Novice');
    expect(free.skillRanks.used).toBe(3); // Amateur → Master; lowering doesn't give any back
    expect(free.todo.filter((t) => t.fields.includes('skill-ranks'))).toEqual([]);
  });
  it('background: one Proficient Profession and two Amateur Hobbies, suggested from a preset', () => {
    const { d } = built({ background: { preset: 'mountaineer', heritage: 'climber' }, attributes: { method: 'manual', pool: 0, base: { VIG: 0, AGI: 0, PER: 0, INT: 0, PRS: 0 }, bonus: [] } });
    const bg = d.skillSlots.filter((s) => s.source === 'Background');
    expect(bg.map((s) => [s.kind, s.rank, s.suggested])).toEqual([
      ['profession', 'Proficient', 'Trail Guide'],
      ['hobby', 'Amateur', 'Hunting'],
      ['hobby', 'Amateur', 'Historical Fiction Reading'],
    ]);
    expect(d.skillSlots).toHaveLength(3);
  });
  it('INT: a Hobby per point and a Profession per 2 points; PRS: a social Hobby per point', () => {
    const { d } = built({ attributes: { method: 'manual', pool: 0, base: { VIG: 0, AGI: 0, PER: 0, INT: 3, PRS: 2 }, bonus: [] } });
    expect(d.skillSlots.filter((s) => s.source === 'Intelligence' && s.kind === 'hobby')).toHaveLength(3);
    expect(d.skillSlots.filter((s) => s.source === 'Intelligence' && s.kind === 'profession')).toHaveLength(1);
    const prs = d.skillSlots.filter((s) => s.source === 'Presence');
    expect(prs).toHaveLength(2);
    expect(prs.every((s) => s.social && s.rank === 'Amateur')).toBe(true);
  });
  it('facets: Human 2 Novice, Dabbler 3 Novice, Expertise 2 Amateur, Investigator Profession', () => {
    const { d } = built({ ancestry: 'human', background: { preset: '', heritage: 'dabbler' }, classId: 'expert', subclass: 'investigator' });
    const by = (src: string) => d.skillSlots.filter((s) => s.source === src);
    expect(by('Extra Hobbies').map((s) => s.rank)).toEqual(['Novice', 'Novice']);
    expect(by('Dabbler').map((s) => s.rank)).toEqual(['Novice', 'Novice', 'Novice']);
    expect(by('Expertise').map((s) => s.rank)).toEqual(['Amateur', 'Amateur']);
    expect(by('Professional Investigator')).toMatchObject([{ kind: 'profession', rank: 'Proficient', suggested: 'Investigator' }]);
  });
  it('ancestry hobby counts follow the document ("two additional Hobbies" / "an additional Hobby")', () => {
    for (const v of ANCESTRY_VARIANTS) {
      const texts = ancestryFacetTexts(v);
      const want = texts.reduce((n, f) => n + (/two additional Hobbies/.test(f.text) ? 2 : /an additional Hobby/.test(f.text) ? 1 : 0), 0);
      const { d } = built({ ancestry: v.id, subAncestry: v.sub });
      expect(d.skillSlots.filter((s) => s.rank === 'Novice').length, v.label).toBe(want);
    }
  });
  it('unnamed slots are one todo on the Background step listing each slot field; names clear it', () => {
    const { d } = built({ attributes: { method: 'manual', pool: 0, base: { VIG: 0, AGI: 0, PER: 0, INT: 2, PRS: 0 }, bonus: [] } });
    const t = d.todo.find((x) => x.text.includes('Hobby/Profession'))!;
    expect(t.step).toBe('background');
    expect(t.fields).toEqual(d.skillSlots.map((s) => `skill:${s.id}`));
    const named = built({
      attributes: { method: 'manual', pool: 0, base: { VIG: 0, AGI: 0, PER: 0, INT: 2, PRS: 0 }, bonus: [] },
      skills: Object.fromEntries(d.skillSlots.map((s) => [s.id, 'x'])),
    }).d;
    expect(named.todo.some((x) => x.text.includes('Hobby/Profession'))).toBe(false);
    // Whitespace isn't a name.
    const blank = built({ attributes: { method: 'manual', pool: 0, base: { VIG: 0, AGI: 0, PER: 0, INT: 0, PRS: 0 }, bonus: [] }, skills: { 'bg-prof-1': '  ' } }).d;
    expect(blank.todo.find((x) => x.text.includes('Hobby/Profession'))!.fields).toContain('skill:bg-prof-1');
  });
});

// ---------------------------------------------------------------------------
// Ancestry & heritage facets (values from the document)
// ---------------------------------------------------------------------------

describe('ancestry facets as written in the rules', () => {
  const zero = { method: 'manual' as const, pool: 0, base: { VIG: 0, AGI: 0, PER: 0, INT: 0, PRS: 0 }, bonus: [] };
  it.each(sample(ANCESTRY_VARIANTS, 6).map((v) => [v.label, v] as const))('%s', (_l, v) => {
    const texts = ancestryFacetTexts(v);
    const d = built({ classId: 'gladiator', ancestry: v.id, subAncestry: v.sub, attributes: zero }).d;
    expect(resMap(d)).toEqual(resistancesFromText(texts.map((f) => f.text), 2));
    expect(d.bulkShift).toBe(texts.filter((f) => /Bulk Rank of items you carry on your person \(not in a backpack\) is decreased by 1/.test(f.text)).length);
    for (const f of texts) for (const l of lightsFromText(f.text)) expect(d.alignment.find((a) => a.light === l)?.sources, f.name).toContain(f.name);
    for (const f of texts.filter((x) => /are Bolstered 1/.test(x.text))) expect(d.bolsters.some((b) => b.includes(`(${f.name})`)), f.name).toBe(true);
    expect(d.senses.includes('Night Vision')).toBe(texts.some((f) => /You have Night Vision/.test(f.text)));
  });
  it('Ulu: Lunar Gift is a one-spell list (Moon cantrip or Lunar mantra); Telepathic grants Transference', () => {
    const d = built({ ancestry: 'ulu' }).d;
    const lg = d.spellLists.find((l) => l.def.id === 'lunar-gift')!;
    expect(lg.count).toBe(1);
    expect(lg.pool.length).toBeGreaterThan(0);
    for (const s of lg.pool) expect(s.kind === 'spell' && ((s.type === 'Moon' && s.tier === 'Cantrip') || (s.type === 'Lunar' && s.tier === 'Mantra')), s.name).toBe(true);
    const granted = d.spellLists.find((l) => l.def.id === 'granted')!;
    expect(granted.granted.map((g) => g.name)).toContain('Transference');
  });
  it('Platinum Soli resists every damage type but Crushing, Piercing and Slashing (half Class Bonus) — plus Sturdy Scales Slashing', () => {
    const d = built({ classId: 'gladiator', ancestry: 'soli', subAncestry: 'platinum' }).d;
    for (const t of DAMAGE_TYPES) {
      if (t === 'Slashing') expect(resMap(d).get(t)).toBe(1);
      else if (['Crushing', 'Piercing'].includes(t)) expect(resMap(d).has(t)).toBe(false);
      else expect(resMap(d).get(t), t).toBe(1);
    }
  });
  it('heritage facets: Climber (half Climb, +2×level Endurance), First Responder (+1), Speedster (+3), Hardened (Panicked 1)', () => {
    const base = built({ classId: 'gladiator', level: 2 }).d;
    const climb = built({ classId: 'gladiator', level: 2, background: { preset: '', heritage: 'climber' } }).d;
    expect(climb.enduranceMax).toBe(base.enduranceMax + 4);
    expect(climb.movementTypes).toEqual([{ type: 'Climb', value: half(climb.movement) }]);
    expect(built({ background: { preset: '', heritage: 'first-responder' } }).d.movement).toBe(base.movement + 1);
    expect(built({ background: { preset: '', heritage: 'speedster' } }).d.movement).toBe(base.movement + 3);
    expect(resMap(built({ background: { preset: '', heritage: 'hardened' } }).d).get('Panicked')).toBe(1);
    expect(built({ background: { preset: '', heritage: 'chef' } }).d.facets.find((f) => f.name === 'Chef')?.uses).toEqual({ count: 1, per: 'Long Rest' });
  });
  it('resistances scale with Class Bonus (none without a class)', () => {
    expect(resMap(built({ ancestry: 'cogitani' }).d).has('Psychic')).toBe(false);
    expect(resMap(built({ ancestry: 'cogitani', classId: 'arcanist' }).d).get('Psychic')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Class specifics
// ---------------------------------------------------------------------------

describe('class specifics', () => {
  it('Gladiator Combat Style (level 2) sets weapon Attack Check modifiers', () => {
    expect(built({ classId: 'gladiator', level: 1 }).d.choices.some((c) => c.id === 'combat-style')).toBe(false);
    const want: Record<string, object> = {
      archery: { property: 'Drawn', tandem: 'PER' },
      fencer: { property: 'Deft', tandem: 'AGI' },
      'greatweapon-fighting': { property: 'Massive', bolster: 1 },
      'heavy-weapon-fighting': { property: 'Heavy', melee: true, tandem: 'VIG' },
    };
    for (const [id, mod] of Object.entries(want)) {
      const d = built({ classId: 'gladiator', level: 2, choices: { 'combat-style': id } }).d;
      expect(d.weaponMods, id).toEqual([expect.objectContaining({ ...mod, source: expect.any(String) })]);
    }
    expect(built({ classId: 'gladiator', level: 2, choices: { 'combat-style': 'defensive-fighting' } }).d.weaponMods).toEqual([]);
    const un = built({ classId: 'gladiator', level: 2 }).d;
    expect(un.todo.find((t) => t.fields.includes('choice:combat-style'))?.step).toBe('class');
  });
  it('Arcanist Grimoire: 5 arcana at level 1, 7 at level 2; prepared = level + INT', () => {
    const at = (level: number) => built({ classId: 'arcanist', level, attributes: { method: 'manual', pool: 0, base: { ...EVEN, INT: 3 }, bonus: [] } }).d;
    expect(at(1).spellLists.find((l) => l.def.id === 'grimoire')!.count).toBe(5);
    expect(at(2).spellLists.find((l) => l.def.id === 'grimoire')!.count).toBe(7);
    expect(at(2).spellLists.find((l) => l.def.id === 'prepared')!.count).toBe(2 + 3);
    // The prepared pool only holds grimoire spells.
    const grim = at(1).spellLists.find((l) => l.def.id === 'grimoire')!.pool.slice(0, 5).map((s) => s.id);
    const d = built({ classId: 'arcanist', level: 1, spells: { grimoire: grim } }).d;
    expect(d.spellLists.find((l) => l.def.id === 'prepared')!.pool.map((s) => s.id).sort()).toEqual([...grim].sort());
  });
  it('known lists: wrong counts and disallowed spells are todos on the Spells step', () => {
    const d0 = built({ classId: 'berserker' }).d;
    const list = d0.spellLists.find((l) => l.def.id === 'maneuvers')!;
    expect(list.granted.map((g) => g.name)).toContain('Rage');
    const t = d0.todo.find((x) => x.fields.includes('spells:maneuvers'))!;
    expect(t.step).toBe('spells');
    expect(t.text).toBe(`Maneuvers: 0 of ${list.count - 1} chosen.`);
    const wrong = spells.find((s) => !s.source)!;
    const bad = built({ classId: 'berserker', spells: { maneuvers: [wrong.id] } }).d;
    expect(bad.issues.join(' ')).toContain(`${wrong.name} not allowed`);
    // Unknown ids are ignored, not crashing.
    expect(badNumbers(built({ classId: 'berserker', spells: { maneuvers: ['no/such/thing'] } }).d)).toEqual([]);
  });
  it('Champion: Will and Exploits only from level 2 (table shows "-" at 1st); The Throne gets Smite', () => {
    const l1 = built({ classId: 'champion', subclass: 'the-throne', level: 1 }).d;
    expect(l1.resources).toEqual([]);
    expect(l1.spellLists.find((l) => l.def.id === 'exploits')).toBeUndefined();
    const l2 = built({ classId: 'champion', subclass: 'the-throne', level: 2 }).d;
    expect(l2.resources).toEqual([{ name: 'Will', max: 2, mode: 'pool' }]);
    const ex = l2.spellLists.find((l) => l.def.id === 'exploits')!;
    expect(ex.count).toBe(3);
    expect(ex.granted.map((g) => g.name)).toContain('Smite');
  });
  it('Champion Apostle’s Light: +half Class Bonus Vitality; Luminary Natural Radiance: +half Class Bonus Radiance', () => {
    const base = built({}).d;
    expect(built({ classId: 'champion' }).d.vitalityMax).toBe(base.vitalityMax + 1);
    expect(built({ classId: 'luminary' }).d.radianceMax).toBe(base.radianceMax + 1);
  });
  it('Luminary: Spell Mod Die is the chosen VIG or PRS Die (a todo until chosen)', () => {
    const at = { method: 'manual' as const, pool: 0, base: { VIG: 3, AGI: 0, PER: 0, INT: 0, PRS: 1 }, bonus: [] };
    expect(built({ classId: 'luminary', attributes: at }).d.spellModDie).toBeUndefined();
    expect(built({ classId: 'luminary', attributes: at }).d.todo.some((t) => t.fields.includes('choice:spell-attr'))).toBe(true);
    expect(built({ classId: 'luminary', attributes: at, choices: { 'spell-attr': 'VIG' } }).d.spellModDie).toBe('d6');
    expect(built({ classId: 'luminary', attributes: at, choices: { 'spell-attr': 'PRS' } }).d.spellModDie).toBe('d2');
  });
  it('Troubadour: Spell Mod Die is the PRS Die; prepared spells (Bonus + PRS) only from level 2', () => {
    const at = { method: 'manual' as const, pool: 0, base: { ...EVEN, PRS: 3 }, bonus: [] };
    const l1 = built({ classId: 'troubadour', level: 1, attributes: at, choices: { 'favored-genre': 'comedy' } }).d;
    expect(l1.spellModDie).toBe('d6');
    expect(l1.spellLists.find((l) => l.def.id === 'prepared')).toBeUndefined();
    const l2 = built({ classId: 'troubadour', level: 2, attributes: at, choices: { 'favored-genre': 'comedy' } }).d;
    expect(l2.spellLists.find((l) => l.def.id === 'prepared')!.count).toBe(2 + 3);
    expect(l2.resources).toEqual([{ name: 'Wonder', max: 2, mode: 'pool' }]);
  });
  it('Incarnate Manifestations (level 2): VIG +2×level Endurance, PER Night Vision, PRS Tandem, list per option', () => {
    const base = built({ classId: 'incarnate', level: 2 }).d;
    const vig = built({ classId: 'incarnate', level: 2, choices: { manifestation: 'VIG' } }).d;
    expect(vig.enduranceMax).toBe(base.enduranceMax + 4);
    expect(vig.spellLists.find((l) => l.def.id === 'manifestation')!.pool.every((s) => s.kind === 'spell' && s.type === 'Bio' && s.tier === 'Cantrip')).toBe(true);
    expect(built({ classId: 'incarnate', level: 2, choices: { manifestation: 'PER' } }).d.senses).toContain('Night Vision');
    expect(built({ classId: 'incarnate', level: 2, choices: { manifestation: 'PRS' } }).d.tandems.join(' ')).toContain('PRS Attribute Checks: Tandem with Primordial Die');
  });
  it('The King: Amphibious Swim = Movement and King of Beasts adds Combat actions', () => {
    const d = built({ classId: 'incarnate', subclass: 'the-king' }).d;
    expect(d.movementTypes).toContainEqual({ type: 'Swim', value: d.movement });
    expect(d.actionCategories).toContain('Combat');
  });
  it('The King Amphibious with Swim Movement already (Daxan Oceanic) raises Swim by 2', () => {
    // Rules (Amphibious): "If you already have Swim Movement, it increases by 2 spaces."
    expect(section(/^#### Amphibious < lvl 1 >/)).toMatch(/If you already have \*Swim Movement\*, it increases by 2 spaces/);
    const d = built({ classId: 'incarnate', subclass: 'the-king', ancestry: 'daxan' }).d;
    expect(d.movementTypes).toEqual([{ type: 'Swim', value: d.movement + 2 }]);
  });
  it('Corpug / Taurton / Ursine Powerful Build shift Bulk by 1', () => {
    for (const [a, s] of [
      ['corpug', ''],
      ['taurton', ''],
      ['praedan', 'ursine'],
      ['soli', 'soma'],
    ])
      expect(built({ ancestry: a, subAncestry: s }).d.bulkShift, a).toBe(1);
    expect(built({ ancestry: 'human' }).d.bulkShift).toBe(0);
  });
  it('facet uses carry through (e.g. Action Flare 1 / Rest at level 2)', () => {
    const d = built({ classId: 'gladiator', level: 2 }).d;
    const f = d.facets.find((x) => x.name === 'Action Flare')!;
    expect(f.uses?.per).toBe('Rest');
    expect(facetUseMax(f, d)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Conditions feeding derive
// ---------------------------------------------------------------------------

describe('conditions in derive', () => {
  it('Exhausted lowers Movement, Immobilized zeroes it, Buffeted lowers AC', () => {
    const base = built({}).d;
    expect(built({ play: { conditions: [{ name: 'Exhausted', level: 2 }] } }).d.movement).toBe(base.movement - 2);
    expect(built({ play: { conditions: [{ name: 'Immobilized' }] } }).d.movement).toBe(0);
    expect(built({ play: { conditions: [{ name: 'Seized' }] } }).d.movement).toBe(0); // Seized → Immobilized
    expect(built({ play: { conditions: [{ name: 'Buffeted', level: 3 }] } }).d.ac.value).toBe(base.ac.value - 3);
    expect(built({ play: { conditions: [{ name: 'Exhausted', level: 99 }] } }).d.movement).toBe(0);
  });
  it('active effects add AC, Movement and resistances', () => {
    const base = built({}).d;
    const d = built({ play: { effects: [{ id: 'e', name: 'Rage', ends: 'manual', ac: 2, movement: 1, resistances: [{ type: 'Crushing', amount: 3 }] }] } }).d;
    expect(d.ac.value).toBe(base.ac.value + 2);
    expect(d.movement).toBe(base.movement + 1);
    expect(resMap(d).get('Crushing')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Homebrew items, effects and facets
// ---------------------------------------------------------------------------

let hbN = 0;
function hb(effects: HomebrewEffect[], extra: Partial<HomebrewEntry> = {}): HomebrewEntry {
  hbN++;
  return { id: `hb${hbN}`, kind: 'effect', name: 'Boon', rows: effects.map((effect, i) => ({ id: `r${i}`, effect })), ...extra };
}
const zeroAttrs = { method: 'manual' as const, pool: 0, base: { VIG: 1, AGI: 1, PER: 1, INT: 1, PRS: 1 }, bonus: [] };

describe('homebrew-driven derive', () => {
  const base = built({ classId: 'gladiator', attributes: zeroAttrs }).d;
  const withHb = (...entries: HomebrewEntry[]) => built({ classId: 'gladiator', attributes: zeroAttrs, homebrew: entries }).d;

  it('movement / movementType / ac', () => {
    expect(withHb(hb([{ kind: 'movement', amount: 2 }])).movement).toBe(base.movement + 2);
    expect(withHb(hb([{ kind: 'movement', amount: -99 }])).movement).toBe(0);
    const swim = withHb(hb([{ kind: 'movementType', type: 'Swim', amount: 'halfMovement' }]));
    expect(swim.movementTypes).toEqual([{ type: 'Swim', value: half(swim.movement) }]);
    const ac = withHb(hb([{ kind: 'ac', amount: 2 }]));
    expect(ac.ac.value).toBe(base.ac.value + 2);
    expect(ac.ac.breakdown).toContain('Boon: +2');
  });
  it('attribute points change the die and everything downstream, without counting against the cap', () => {
    const d = withHb(hb([{ kind: 'attribute', attr: 'AGI', amount: 4 }]));
    expect(d.attrs.AGI.points).toBe(5);
    expect(d.attrs.AGI.label).toBe('d10');
    expect(d.attrs.AGI.sources).toContain('+4 Boon');
    expect(d.movement).toBe(3 + triangular(5));
    expect(d.todo.some((t) => t.fields.includes('attr:AGI'))).toBe(false);
    const neg = withHb(hb([{ kind: 'attribute', attr: 'PER', amount: -2 }]));
    expect(neg.attrs.PER.points).toBe(-1);
    expect(neg.attrs.PER.sources).toContain('−2 Boon');
    expect(neg.initiative).toBe('-d2');
  });
  it('resistance adds to other sources of the same type', () => {
    const d = built({ classId: 'gladiator', ancestry: 'soli', subAncestry: 'flame', attributes: zeroAttrs, homebrew: [hb([{ kind: 'resistance', type: 'Thermic', amount: 3 }])] }).d;
    expect(resMap(d).get('Thermic')).toBe(2 + 3);
  });
  it('damage immunity implies Condition immunities and removes matching vulnerabilities', () => {
    const d = withHb(hb([{ kind: 'immunity', damage: 'Thermic' }, { kind: 'vulnerability', type: 'Thermic', dice: '1d6' }]));
    expect(d.damageImmunities).toEqual([{ type: 'Thermic', sources: ['Boon'] }]);
    expect(d.conditionImmunities).toEqual([{ name: 'Burning', sources: ['Thermic Immunity'] }]);
    expect(d.vulnerabilities.some((v) => v.type === 'Thermic')).toBe(false);
    const slash = withHb(hb([{ kind: 'immunity', damage: 'Slashing' }]));
    expect(slash.vulnerabilities.some((v) => v.type === 'Slashing')).toBe(false);
    expect(slash.conditionImmunities.map((c) => c.name)).toContain('Bleeding');
    // Immunity to each damage type the rules name as preventing a Condition.
    for (const [cond, dmg] of [
      ['Bleeding', 'Slashing'],
      ['Bruised', 'Crushing'],
      ['Burning', 'Thermic'],
      ['Dissolving', 'Caustic'],
    ]) {
      expect(section(new RegExp(`^#### ${cond}`))).toMatch(new RegExp(`Immunity to ${dmg} damage prevents this`, 'i'));
      expect(withHb(hb([{ kind: 'immunity', damage: dmg }])).conditionImmunities.map((c) => c.name)).toContain(cond);
    }
  });
  it('Condition immunity: the Condition (and what it brings) has no effect', () => {
    const play = { conditions: [{ name: 'Burning', level: 2 }] };
    const hurt = built({ classId: 'gladiator', attributes: zeroAttrs, play }).d;
    expect(hurt.conditionFx.active.map((a) => a.name).sort()).toEqual(['Burning', 'Numbed']);
    const imm = built({ classId: 'gladiator', attributes: zeroAttrs, play, homebrew: [hb([{ kind: 'immunity', condition: 'Burning' }])] }).d;
    expect(imm.conditionFx.active).toEqual([]);
    expect(imm.conditionImmunities).toEqual([{ name: 'Burning', sources: ['Boon'] }]);
    const exh = built({ attributes: zeroAttrs, play: { conditions: [{ name: 'Immobilized' }] }, homebrew: [hb([{ kind: 'immunity', condition: 'Immobilized' }])] }).d;
    expect(exh.movement).toBe(3 + 1);
  });
  it('vulnerability is listed with its dice', () => {
    expect(withHb(hb([{ kind: 'vulnerability', type: 'Arctic', dice: '1d4' }])).vulnerabilities).toContainEqual({ type: 'Arctic', dice: '1d4', source: 'Boon' });
  });
  it('check rows: all/save become per-Attribute Check rows; attribute/attack/custom become bolsters', () => {
    const d = withHb(
      hb([
        { kind: 'check', scope: 'all', attr: 'VIG', amount: -2 },
        { kind: 'check', scope: 'save', attr: 'AGI', amount: 1 },
        { kind: 'check', scope: 'attribute', attr: 'PER', amount: 1 },
        { kind: 'check', scope: 'attack', amount: 2 },
        { kind: 'check', scope: 'custom', text: 'Checks to swim', amount: -1 },
      ]),
    );
    expect(d.conditionFx.checks.find((r) => r.attr === 'VIG' && !r.save)).toMatchObject({ hindered: 2, hinderedFrom: ['Boon'] });
    expect(d.conditionFx.checks.find((r) => r.attr === 'AGI' && r.save)).toMatchObject({ bolstered: 1 });
    expect(d.saves.find((s) => s.attr === 'VIG')!.notes.join(' ')).toContain('Hindered 2 (Boon)');
    expect(d.bolsters).toEqual(expect.arrayContaining(['PER Attribute Checks: Bolstered 1 (Boon)', 'Attack Checks: Bolstered 2 (Boon)', 'Checks to swim: Hindered 1 (Boon)']));
  });
  it('max: Endurance / Vitality / Radiance maximums', () => {
    const d = withHb(hb([{ kind: 'max', stat: 'endurance', amount: 5 }, { kind: 'max', stat: 'vitality', amount: 1 }, { kind: 'max', stat: 'radiance', amount: 2 }]));
    expect(d.enduranceMax).toBe(base.enduranceMax + 5);
    expect(d.vitalityMax).toBe(base.vitalityMax + 1);
    expect(d.restCharges).toBe(base.vitalityMax + 1);
    expect(d.radianceMax).toBe(base.radianceMax + 2);
  });
  it('senses are de-duplicated', () => {
    const d = built({ ancestry: 'daxan', homebrew: [hb([{ kind: 'sense', name: 'Night Vision' }, { kind: 'sense', name: 'Tremorsense' }])] }).d;
    expect(d.senses).toEqual(['Night Vision', 'Tremorsense']);
  });
  it('alignment rows add a level, which raises the tier of items keyed to that Light', () => {
    const blade: HomebrewEntry = {
      id: 'blade',
      kind: 'item',
      name: 'Frostblade',
      tierLight: 'Frost',
      rows: [
        { id: 'a', minTier: 1, effect: { kind: 'ac', amount: 1 } },
        { id: 'b', minTier: 2, effect: { kind: 'movement', amount: 1 } },
        { id: 'c', maxTier: 0, effect: { kind: 'note', text: 'dormant' } },
      ],
    };
    const none = withHb(blade);
    expect(none.homebrew[0].tier).toBe(0);
    expect(none.homebrewNotes).toEqual([{ text: 'dormant', source: 'Frostblade' }]);
    const weak = built({ classId: 'expert', attributes: zeroAttrs, homebrew: [blade] }).d; // Expert: Frost
    expect(weak.homebrew[0].tier).toBe(1);
    expect(weak.ac.value).toBe(built({ classId: 'expert', attributes: zeroAttrs }).d.ac.value + 1);
    const firm = built({ classId: 'expert', attributes: zeroAttrs, homebrew: [blade, hb([{ kind: 'alignment', light: 'Frost' }], { kind: 'facet', name: 'Winter Mark' })] }).d;
    expect(firm.alignment.find((a) => a.light === 'Frost')).toEqual({ light: 'Frost', level: 2, sources: ['Winter Mark', 'Expert'] });
    expect(firm.homebrew[0].tier).toBe(2);
    expect(firm.movement).toBe(weak.movement + 1);
  });
  it('weapon rows: item weapons name the weapon; effects apply to any weapon', () => {
    const item: HomebrewEntry = { id: 'sw', kind: 'item', name: 'Moonblade', baseWeapon: 'Longsword', stats: { PER: 4 }, rows: [{ id: 'w', effect: { kind: 'weapon', die: 'item:PER', bolster: 1, note: 'glows' } }] };
    const d = withHb(item, hb([{ kind: 'weapon', property: 'Deft', bolster: 2 }]));
    expect(d.weaponMods).toEqual([
      expect.objectContaining({ weapon: 'Moonblade', bolster: 1, note: 'glows', tandemDie: { name: 'Moonblade PER', die: 'd8' }, source: 'Moonblade' }),
      expect.objectContaining({ property: 'Deft', bolster: 2, weapon: undefined, source: 'Boon' }),
    ]);
  });
  it('initiativeTandem: the bigger of the Tandem dice is shown', () => {
    const item: HomebrewEntry = { id: 'eye', kind: 'item', name: 'Eye', stats: { PER: 5 }, rows: [{ id: 'i', effect: { kind: 'initiativeTandem', die: 'item:PER' } }] };
    expect(withHb(item).initiative).toBe('d2 / d10');
    expect(withHb(hb([{ kind: 'initiativeTandem', die: 'class' }])).initiative).toBe('d2 / d6');
    const victor = built({ classId: 'gladiator', subclass: 'victor', attributes: zeroAttrs, homebrew: [item] }).d;
    expect(victor.initiative).toBe('d2 / d10');
  });
  it('saveTandem with an item die: used when bigger than the Class Die or when not Tandem already', () => {
    const big: HomebrewEntry = { id: 'big', kind: 'item', name: 'Ward', stats: { AGI: 6 }, rows: [{ id: 's', effect: { kind: 'saveTandem', attr: 'AGI', die: 'item:AGI' } }] };
    const small: HomebrewEntry = { id: 'sm', kind: 'item', name: 'Charm', stats: { PER: 1 }, rows: [{ id: 's', effect: { kind: 'saveTandem', attr: 'PER', die: 'item:PER' } }] };
    const d = withHb(big, small);
    expect(d.saves.find((s) => s.attr === 'AGI')!.label).toBe('d2 / d12');
    expect(d.saves.find((s) => s.attr === 'AGI')!.notes).toContain('Tandem with Ward AGI Die (Ward)');
    expect(d.saves.find((s) => s.attr === 'PER')!.label).toBe('d2 / d6'); // class die is bigger
    const cls = withHb(hb([{ kind: 'saveTandem', attr: 'INT', die: 'class' }]));
    expect(cls.saves.find((s) => s.attr === 'INT')!.label).toBe('d2 / d6');
  });
  it('saveEmpowered, restRule and note', () => {
    const d = withHb(hb([{ kind: 'saveEmpowered', attr: 'INT' }, { kind: 'restRule', rule: 'noRestCharges' }, { kind: 'restRule', rule: 'noRestCharges' }, { kind: 'note', text: 'Smells of smoke.' }]));
    expect(d.saves.find((s) => s.attr === 'INT')!.label).toBe('d2 + d4');
    expect(d.restRules).toEqual(['noRestCharges']);
    expect(d.homebrewNotes).toEqual([{ text: 'Smells of smoke.', source: 'Boon' }]);
  });
  it('attunement gates an item’s effects (including its Alignment)', () => {
    const rows: HomebrewEntry['rows'] = [
      { id: 'a', effect: { kind: 'ac', amount: 3 } },
      { id: 'b', effect: { kind: 'alignment', light: 'Platinum' } },
    ];
    const off = withHb({ id: 'r', kind: 'item', name: 'Ring', attunement: true, attuned: false, rows });
    expect(off.ac.value).toBe(base.ac.value);
    expect(off.alignment.some((a) => a.light === 'Platinum')).toBe(false);
    expect(off.homebrew[0].active).toBe(false);
    const on = withHb({ id: 'r', kind: 'item', name: 'Ring', attunement: true, attuned: true, rows });
    expect(on.ac.value).toBe(base.ac.value + 3);
    expect(on.alignment.some((a) => a.light === 'Platinum')).toBe(true);
    // Effects and facets aren't gated by the attunement flag.
    expect(withHb({ id: 'e', kind: 'effect', name: 'Blessing', attunement: true, attuned: false, rows }).ac.value).toBe(base.ac.value + 3);
  });
  it('"on your person" rows stop applying in a backpack; onSpend rows are never passive', () => {
    const rows: HomebrewEntry['rows'] = [
      { id: 'a', when: 'onPerson', effect: { kind: 'movement', amount: 2 } },
      { id: 'b', effect: { kind: 'ac', amount: 1 } },
      { id: 'c', onSpend: 'p', effect: { kind: 'ac', amount: 10 } },
      { id: 'd', when: 'onPerson', effect: { kind: 'alignment', light: 'Soma' } },
    ];
    const carried = withHb({ id: 'b', kind: 'item', name: 'Boots', rows });
    expect(carried.movement).toBe(base.movement + 2);
    expect(carried.ac.value).toBe(base.ac.value + 1);
    expect(carried.alignment.some((a) => a.light === 'Soma')).toBe(true);
    const packed = withHb({ id: 'b', kind: 'item', name: 'Boots', inBackpack: true, rows });
    expect(packed.movement).toBe(base.movement);
    expect(packed.ac.value).toBe(base.ac.value + 1);
    expect(packed.alignment.some((a) => a.light === 'Soma')).toBe(false);
  });
  it('item stats and pools resolve per tier', () => {
    const item: HomebrewEntry = {
      id: 'sent',
      kind: 'item',
      name: 'Sentient',
      tierLight: 'Flame',
      level: [1, 2, 3, 4],
      stats: { INT: [0, 2, 4, 6] },
      pools: [{ id: 'p', name: 'Charges', max: [0, 1, 2, 3], refresh: 'Long Rest' }],
      rows: [],
    };
    const d = withHb(item); // Gladiator: Flame Weak
    expect(d.homebrew[0]).toMatchObject({ tier: 1, level: 2, stats: { INT: { points: 2, die: 'd4' } }, pools: [{ max: 1, spent: 0 }] });
  });
  it('every homebrew effect kind together derives without bad numbers', () => {
    const all: HomebrewEffect[] = [
      { kind: 'movement', amount: 1 },
      { kind: 'movementType', type: 'Climb', amount: 'movement' },
      { kind: 'attribute', attr: 'VIG', amount: 1 },
      { kind: 'ac', amount: 1 },
      { kind: 'resistance', type: 'Sonic', amount: 1 },
      { kind: 'immunity', damage: 'Caustic' },
      { kind: 'immunity', condition: 'Prone' },
      { kind: 'alignment', light: 'Lunar' },
      { kind: 'vulnerability', type: 'Divine', dice: '1d4' },
      { kind: 'check', scope: 'all', attr: 'INT', amount: 1 },
      { kind: 'initiativeTandem', die: 'AGI' },
      { kind: 'saveTandem', attr: 'PRS', die: 'item:PRS' },
      { kind: 'saveEmpowered', attr: 'PRS' },
      { kind: 'max', stat: 'radiance', amount: 1 },
      { kind: 'sense', name: 'Blindsight' },
      { kind: 'weapon', die: 'class' },
      { kind: 'restRule', rule: 'noVitalityShortRest' },
      { kind: 'note', text: 'n' },
    ];
    for (const kind of ['item', 'effect', 'facet'] as const) {
      const d = withHb(hb(all, { kind, tierLight: 'Lunar', stats: { PRS: [1, 2, 3, 4] } }));
      expect(badNumbers(d)).toEqual([]);
      expect(d.initiative).toBe('d2 / d2');
    }
  });
});

// ---------------------------------------------------------------------------
// Scaling helpers that read the class table
// ---------------------------------------------------------------------------

describe('scaling against class tables', () => {
  it('maxCastLevel reads the "Max …" column (at least 1)', () => {
    for (const cls of classes) {
      const m = MD_CLASSES.get(cls.id)!;
      for (const r of m.rows) {
        const col = Object.keys(r.cols).find((h) => /^Max/.test(h))!;
        expect(maxCastLevel(cls, r.level), `${cls.id} L${r.level}`).toBe(Math.max(1, numeric(r.cols[col])));
      }
    }
    expect(maxCastLevel(undefined, 5)).toBe(1);
  });
  it('castCost: level in the first resource; Champion maneuvers half; cantrips free; Incarnate spells free unless Exalted', () => {
    const cls = (id: string) => classes.find((c) => c.id === id)!;
    const leveled = spells.find((s) => s.level > 0)!;
    const cantrip = spells.find((s) => s.level === 0)!;
    const man = maneuvers.find((s) => s.level > 0)!;
    expect(castCost(cls('arcanist'), leveled, 3, true)).toEqual({ resource: 'Prisma', amount: 3 });
    expect(castCost(cls('arcanist'), cantrip, 3, true)).toBeUndefined();
    expect(castCost(cls('arcanist'), leveled, 3, false)).toBeUndefined();
    expect(castCost(cls('champion'), man, 3, true)).toEqual({ resource: 'Will', amount: 2 });
    expect(castCost(cls('incarnate'), leveled, leveled.level, true)).toBeUndefined();
    expect(castCost(cls('incarnate'), leveled, leveled.level + 1, true)).toEqual({ resource: 'Stamina', amount: 1 });
    expect(castCost(cls('incarnate'), man, 2, true)).toEqual({ resource: 'Stamina', amount: 2 });
  });
  it('scaleText resolves {SL} arithmetic', () => {
    expect(scaleText('7{SL} Thermic damage', { level: 3, charLevel: 1 })).toBe('21 Thermic damage');
    expect(scaleText('{SL} plus 4', { level: 2, charLevel: 1 })).toBe('6');
    expect(scaleText('half {SL}', { level: 3, charLevel: 1 })).toBe('2');
    expect(scaleText('equal to your level', { level: 3, charLevel: 2 })).toBe('equal to 2');
  });
  it('resolveScaled / slugify', () => {
    const ctx = { level: 2, classBonus: 3, points: { VIG: 3, AGI: 0, PER: 0, INT: 0, PRS: 0 } };
    expect(resolveScaled('classBonus', ctx)).toBe(3);
    expect(resolveScaled('halfClassBonus', ctx)).toBe(2);
    expect(resolveScaled('twiceLevel', ctx)).toBe(4);
    expect(resolveScaled({ attr: 'VIG', half: true }, ctx)).toBe(2);
    expect(slugify('Champion’s Aura: Force!')).toBe('champion-s-aura-force');
  });
  it('every granted castable referenced by data exists', () => {
    const ids = [
      ...classes.flatMap((c) => [...(c.spellLists ?? []), ...Object.values(c.subclassExtras ?? {}).flatMap((s) => s.spellLists ?? [])].flatMap((l) => l.granted ?? [])),
      'spells/arcana/mind/transference',
    ];
    for (const id of ids) expect(getCastable(id), id).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeCharacter
// ---------------------------------------------------------------------------

describe('normalizeCharacter', () => {
  const legacy: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['empty object', {}],
    ['name only', { name: 'Old' }],
    ['string experiences', { name: 'Old', experiences: ['Saved the mayor', 'Fell off a cliff'] }],
    ['renamed conditions', { play: { conditions: [{ name: 'Defeaned' }, { name: 'Possesed', level: 2 }, { name: 'Prone' }] } }],
    ['notes but no sessions', { updatedAt: '2025-03-04T10:00:00.000Z', details: { notes: 'We met a dragon.' } }],
    ['partial attributes', { attributes: { base: { VIG: 3 } } }],
    ['partial alignment', { alignment: { situations: 'Action' } }],
    ['partial equipment', { equipment: { weapons: [{ id: 'w', name: 'Dagger' }] } }],
    ['old play without newer fields', { play: { endurance: 5, vitality: 2 } }],
    ['class but no subclass', { classId: 'gladiator', level: 2, choices: { 'combat-style': 'archery' } }],
  ];
  it.each(legacy)('%s: normalises without throwing, derives cleanly, and round-trips stably', (_n, raw) => {
    const n = normalizeCharacter(raw);
    expect(n.version).toBe(1);
    expect(n.attributes.base).toEqual(expect.objectContaining({ VIG: expect.any(Number), AGI: expect.any(Number), PER: expect.any(Number), INT: expect.any(Number), PRS: expect.any(Number) }));
    expect(Array.isArray(n.experiences)).toBe(true);
    expect(Array.isArray(n.sessions)).toBe(true);
    expect(Array.isArray(n.homebrew)).toBe(true);
    expect(n.alignment.picks).toEqual(expect.any(Object));
    expect(n.play.conditions).toEqual(expect.any(Array));
    const d = derive(n);
    expect(badNumbers(d)).toEqual([]);
    expect(normalizeCharacter(n)).toEqual(n);
    expect(normalizeCharacter(JSON.parse(JSON.stringify(n)))).toEqual(n);
  });
  it('old string experiences become single-use experiences', () => {
    const n = normalizeCharacter({ experiences: ['Saved the mayor', { id: 'x', name: 'Kept', uses: 2, used: 1, effect: 'e' }] });
    expect(n.experiences[0]).toMatchObject({ name: 'Saved the mayor', uses: 1, used: 0, effect: '' });
    expect(n.experiences[0].id).toEqual(expect.any(String));
    expect(n.experiences[1]).toEqual({ id: 'x', name: 'Kept', uses: 2, used: 1, effect: 'e' });
  });
  it('misspelled conditions are renamed', () => {
    const n = normalizeCharacter({ play: { conditions: [{ name: 'Defeaned' }, { name: 'Possesed', level: 2 }] } });
    expect(n.play.conditions).toEqual([{ name: 'Deafened' }, { name: 'Possessed', level: 2 }]);
  });
  it('old notes become one session dated from updatedAt; existing sessions are kept', () => {
    const n = normalizeCharacter({ updatedAt: '2025-03-04T10:00:00.000Z', details: { notes: 'We met a dragon.' } });
    expect(n.sessions).toEqual([{ id: expect.any(String), title: 'Earlier notes', date: '2025-03-04', body: 'We met a dragon.' }]);
    const kept = normalizeCharacter({ sessions: [], details: { notes: 'x' } });
    expect(kept.sessions).toEqual([]);
  });
  it('fills defaults: missing attribute bases are −1, rest rules heroic, armor none', () => {
    const n = normalizeCharacter({ attributes: { base: { VIG: 3 } } });
    expect(n.attributes.base).toEqual({ VIG: 3, AGI: -1, PER: -1, INT: -1, PRS: -1 });
    expect(n.attributes.method).toBe('pointBuy');
    expect(n.settings.restRules).toBe('heroic');
    expect(n.equipment.armor).toBeNull();
    expect(n.level).toBe(1);
  });
  it('does not share nested objects between characters', () => {
    const a = normalizeCharacter({});
    const b = normalizeCharacter({});
    a.alignment.picks.class = 'Flame';
    a.skills.x = 'y';
    expect(b.alignment.picks).toEqual({});
    expect(b.skills).toEqual({});
  });
});

// Keep QA quick: one tiny sanity check that QA sampling is in effect.
describe('test modes', () => {
  it(`runs in ${QA ? 'QA (sampled)' : 'full'} mode`, () => {
    expect(LEVELS.length).toBe(QA ? 3 : 10);
  });
});

// ---------------------------------------------------------------------------
// Unarmed Strikes (rules: Unarmed Strikes; Powerful Build; natural weapons; class facets)
// ---------------------------------------------------------------------------
describe('Unarmed Strikes', () => {
  const vig = (VIG: number) => ({ method: 'manual' as const, pool: 0, base: { VIG, AGI: 0, PER: 0, INT: 0, PRS: 0 }, bonus: [] as never[] });
  const body = (d: Derived) => d.unarmed.find((u) => u.name === 'Unarmed Strike')!;

  it('your body: Close-Up, DV 0, Deadly DV equal to your VIG points, Crushing', () => {
    expect(section(/^##### Unarmed Strikes/)).toMatch(/Close-Up property, a DV of 0, and a Deadly DV equal to your \$\[VIG\] Points/);
    const d = built({ classId: 'expert', ancestry: 'human', attributes: vig(3) }).d;
    expect(body(d)).toMatchObject({ dv: 0, deadlyDv: 3, damage: 'Crushing', properties: ['Close-Up'] });
    expect(d.unarmed).toHaveLength(1);
  });
  it('Powerful Build adds your VIG points to both DVs (Corpug)', () => {
    const d = built({ classId: 'expert', ancestry: 'corpug', attributes: vig(2) }).d;
    expect(body(d)).toMatchObject({ dv: 2, deadlyDv: 4 });
  });
  it('natural weapons: DV half your Class Bonus, Deadly DV your Class Bonus (Ursine Bear Claws, with Powerful Build)', () => {
    const d = built({ classId: 'expert', ancestry: 'praedan', subAncestry: 'ursine', attributes: vig(1) }).d;
    expect(d.unarmed.find((u) => u.name === 'Bear Claws')).toMatchObject({ dv: half(d.classBonus) + 1, deadlyDv: d.classBonus + 1, damage: 'Slashing', properties: ['Brutal'] });
  });
  it('Acid Tongue: DV 1, Deadly DV your Class Bonus plus 1, Caustic, Deft', () => {
    const d = built({ classId: 'expert', ancestry: 'soli', subAncestry: 'mordant', attributes: vig(1) }).d;
    expect(d.unarmed.find((u) => u.name === 'Acid Tongue')).toMatchObject({ dv: 1, deadlyDv: d.classBonus + 1, damage: 'Caustic', properties: ['Deft'] });
  });
  it('Daxan Claw and Fang: claws (Slashing, Light) and maw (Piercing, Pulling)', () => {
    const d = built({ classId: 'expert', ancestry: 'daxan' }).d;
    expect(d.unarmed.map((u) => u.name)).toEqual(['Unarmed Strike', 'Claws', 'Maw']);
  });
  it('Berserker Barbarous Light: Pushing, DV equal to VIG points, Deadly DV twice that', () => {
    const d = built({ classId: 'berserker', subclass: 'roaring-fervor', ancestry: 'human', attributes: vig(3) }).d;
    expect(body(d)).toMatchObject({ dv: 3, deadlyDv: 6, properties: ['Close-Up', 'Pushing'] });
  });
  it('Incarnate Ferocious Strikes: an Unarmed Strike with the Primordial Die, DV half the Class Bonus, Deadly DV the Class Bonus', () => {
    const d = built({ classId: 'incarnate', subclass: 'the-king', ancestry: 'human' }).d;
    expect(d.unarmed.find((u) => u.classDie)).toMatchObject({ dv: half(d.classBonus), deadlyDv: d.classBonus });
    // The King's Claws: Slashing instead of Crushing.
    expect(body(d).damage).toBe('Crushing or Slashing');
  });
  it('DVs never go below 0 with negative VIG', () => {
    const d = built({ classId: 'expert', ancestry: 'human', attributes: vig(-2) }).d;
    expect(body(d)).toMatchObject({ dv: 0, deadlyDv: 0 });
  });
});

// Rules (Bolstered & Hindered): "If multiple effects would add Bolstered or Hindered levels, add their
// levels together." and "Bolstered and Hindered levels subtract from each other".
describe('Bolstered / Hindered from several sources', () => {
  const chains: HomebrewEntry = {
    id: 'chains',
    kind: 'item',
    name: "Predator's Chains",
    tierLight: 'Frost',
    rows: [{ id: 'd', minTier: 1, effect: { kind: 'check', scope: 'attribute', attr: 'PER', amount: 1 } }],
  };
  const frost = { situations: 'Patience', problems: 'Instinct', people: 'Empathy', picks: {} } as Character['alignment'];
  it('levels on the same Checks add together into one line (Keen Senses + Predator’s Chains)', () => {
    const d = built({ classId: 'expert', ancestry: 'praedan', subAncestry: 'canine', alignment: frost, homebrew: [chains] }).d;
    const per = d.bolsters.filter((b) => b.startsWith('PER Attribute Checks'));
    expect(per).toEqual(["PER Attribute Checks: Bolstered 2 (Keen Senses, Predator's Chains)"]);
  });
  it('Bolstered and Hindered on the same Checks cancel level for level', () => {
    const curse: HomebrewEntry = { id: 'c', kind: 'effect', name: 'Dim Eyes', rows: [{ id: '1', effect: { kind: 'check', scope: 'attribute', attr: 'PER', amount: -2 } }] };
    const d = built({ classId: 'expert', ancestry: 'praedan', subAncestry: 'canine', homebrew: [curse] }).d;
    expect(d.bolsters.filter((b) => b.startsWith('PER Attribute Checks'))).toEqual(['PER Attribute Checks: Hindered 1 (Keen Senses, Dim Eyes)']);
  });
});

// Rules, Armor: "Weighty: Your AGI Save Checks are Hindered 1" (Medium) and
// "If you don’t meet the VIG Point requirement of armor you are wearing, all AGI
// Checks you make are Weakened" (Light 0, Medium 1, Heavy 3).
describe('Armor penalties are Check Modifiers', () => {
  const wear = (type: 'Light' | 'Medium' | 'Heavy', VIG: number) =>
    built({
      classId: 'expert',
      attributes: { method: 'manual', base: { VIG, AGI: 2, PER: 2, INT: 2, PRS: 2 } } as Character['attributes'],
      equipment: { armor: { type, quality: 'Basic' }, weapons: [], inventory: [] },
    }).d;
  const row = (d: ReturnType<typeof wear>, label: string) => d.conditionFx.checks.find((r) => r.label === label);
  it('Heavy armor without 3 VIG: AGI Checks Weakened', () => {
    const d = wear('Heavy', 2);
    expect(row(d, 'AGI Checks')?.weakened.join()).toMatch(/Heavy armor/);
    expect(d.saves.find((s) => s.attr === 'AGI')!.notes.join()).toMatch(/Weakened/);
  });
  it('Heavy armor with 3 VIG: no penalty', () => {
    expect(row(wear('Heavy', 3), 'AGI Checks')).toBeUndefined();
  });
  it('Medium armor (Weighty): AGI Save Checks Hindered 1, once', () => {
    const d = wear('Medium', 1);
    const r = row(d, 'AGI Save Checks')!;
    expect([r.hindered, r.hinderedFrom]).toEqual([1, ['Weighty (Medium armor)']]);
    expect(row(d, 'AGI Checks')).toBeUndefined();
    expect(d.saves.find((s) => s.attr === 'AGI')!.notes.filter((n) => /Hindered/.test(n))).toHaveLength(1);
  });
  it('Medium armor with 0 VIG: Weakened too', () => {
    expect(row(wear('Medium', 0), 'AGI Checks')?.weakened.length).toBe(1);
  });
  it('Light armor needs VIG 0: fine at 0, Weakened at −1', () => {
    expect(row(wear('Light', 0), 'AGI Checks')).toBeUndefined();
    expect(row(wear('Light', -1), 'AGI Checks')?.weakened.length).toBe(1);
  });
});

// Rules, Gladiator: Save Checks PER and one Attribute of your choice, in Tandem with your Martial Die.
describe('Save Check training', () => {
  it('Gladiator: PER plus the chosen Attribute', () => {
    expect(built({ classId: 'gladiator', choices: { 'save-attr': 'VIG' } }).d.saveTraining).toBe('PER, VIG in Tandem with your Martial Die');
  });
  it('Gladiator before choosing says so', () => {
    expect(built({ classId: 'gladiator' }).d.saveTraining).toMatch(/^PER, one more Attribute \(choose in the builder\)/);
  });
  it('every class has Save Check training', () => {
    for (const cl of classes) expect(built({ classId: cl.id }).d.saveTraining, cl.id).toMatch(/in Tandem with your .+ Die/);
  });
});

// Playtest Cause, commented out in the rules source and included up to level 2
// by parse-rules: "Vital Sacrifice" (Evoke Darkness: 1 Vitality, 2 AP, once per
// Rest), "Endwalker" (Darkness = missing Vitality; Movement + Darkness) and
// "Darkness Exploits" (Feral/Martial Maneuvers, Void/Infernal Evocations, Smite).
describe('Champion of Darkness (playtest Cause)', async () => {
  const { getNode } = await import('../src/content');
  const { actionRequest, performUse } = await import('../src/engine/activations');
  const champion = classes.find((c) => c.id === 'champion')!;
  const dark = (level: number, vitality: number) =>
    built({ classId: 'champion', subclass: 'darkness', level, attributes: { method: 'manual', base: { VIG: 2, AGI: 0, PER: 0, INT: 0, PRS: 2 } } as Character['attributes'], play: { initialized: true, vitality } });
  it('is a Champion’s Cause, with nothing above level 2', () => {
    expect(subclassesOf(champion).map((s) => s.id)).toContain('darkness');
    expect(getNode('classes/champions-causes/darkness/void-ally')).toBeUndefined();
    expect(dark(10, 4).d.facets.filter((f) => f.source === 'Darkness').map((f) => f.name)).toEqual(['Vital Sacrifice', 'Endwalker', 'Darkness Exploits']);
  });
  it('Endwalker: Darkness is your missing Vitality, added to Movement', () => {
    // 3 + half of 2 VIG + Apostle’s Light (half the Champion Bonus).
    const full = dark(1, 5).d;
    expect(full.vitalityMax).toBe(5);
    expect(full.darkness?.value).toBe(0);
    const hurt = dark(1, 2).d;
    expect(hurt.darkness?.value).toBe(3);
    expect(hurt.movement).toBe(full.movement + 3);
  });
  it('Evoke Darkness costs 1 Vitality and 2 AP, once per Rest', () => {
    const { c, d } = dark(1, 5);
    const node = getNode('classes/champions-causes/darkness/vital-sacrifice/evoke-darkness')!;
    const req = actionRequest(d, node.id, 'Evoke Darkness', node.fields?.Cost);
    const r = performUse({ ...c, play: { ...c.play, ap: 5 } }, d, req);
    expect([r.play.vitality, r.play.ap]).toEqual([4, 3]);
    expect(req.facetKey).toBeDefined();
    expect(r.play.facetUses[req.facetKey!]).toBe(1);
  });
  it('Darkness Exploits at level 2: Smite plus Feral/Martial Maneuvers and Infernal Evocations', () => {
    const list = dark(2, 5).d.spellLists.find((l) => l.def.id === 'exploits')!;
    expect(list.granted.map((g) => g.id)).toEqual(['classes/champion/glorious-exploits/casting-spells/smite']);
    expect(new Set(list.pool.map((p) => p.type))).toEqual(new Set(['Feral', 'Martial', 'Infernal']));
  });
});

// Endwalker: "Each time you take or deal damage, you can increase or reduce one
// type of the damage by half your Darkness." Burning X: "take 3X Thermic damage
// when you gain this Condition and at the start of your turn."
describe('Endwalker reduces damage the app applies', async () => {
  const { addCondition, startTurn } = await import('../src/engine/conditions');
  const dark = (vitality: number) =>
    built({ classId: 'champion', subclass: 'darkness', level: 2, attributes: { method: 'manual', base: { VIG: 2, AGI: 0, PER: 0, INT: 0, PRS: 2 } } as Character['attributes'], play: { initialized: true, vitality, endurance: 30 } });
  it('half Darkness, rounded down; none at full Vitality', () => {
    expect(dark(5).d.damageReduction).toBeUndefined();
    expect(dark(1).d.damageReduction).toEqual({ amount: 2, source: 'Endwalker' });
  });
  it('gaining Burning 3 deals 9 Thermic, minus half Darkness', () => {
    const { c, d } = dark(1);
    expect(addCondition(c.play, 'Burning', 3, { vitalityMax: d.vitalityMax }).endurance).toBe(21);
    expect(addCondition(c.play, 'Burning', 3, { vitalityMax: d.vitalityMax, reduction: d.damageReduction }).endurance).toBe(23);
  });
  it('start-of-turn Burning damage is reduced too, and the log says why', () => {
    const { c, d } = dark(1);
    const r = startTurn({ ...c.play, conditions: [{ name: 'Burning', level: 3 }] }, d.level, d.resistances, { immune: [], vulnerable: [], reduction: d.damageReduction });
    expect(r.damage).toEqual([{ type: 'Thermic', amount: 7, source: 'Burning 3' }]);
    expect(r.log.join(' ')).toContain('take 7 Thermic damage (9 − Endwalker 2)');
  });
});

describe('Custom ancestry', () => {
  it('has no facets of its own and needs no sub-ancestry', () => {
    const { d } = built({ classId: 'expert', ancestry: 'custom' });
    expect(d.facets.filter((f) => f.key.startsWith('anc:'))).toEqual([]);
    expect(d.todo.filter((t) => t.step === 'ancestry')).toEqual([]);
  });
  it('takes its facets from Homebrew facets', () => {
    const gills: HomebrewEntry = { id: 'g', kind: 'facet', name: 'Gills', rows: [{ id: 'r', effect: { kind: 'movementType', type: 'Swim', amount: 'movement' } }] };
    const soul: HomebrewEntry = { id: 's', kind: 'facet', name: 'Tidal Soul', rows: [{ id: 'r', effect: { kind: 'alignment', light: 'Frost' } }] };
    const { d } = built({ classId: 'expert', ancestry: 'custom', homebrew: [gills, soul] });
    expect(d.movementTypes).toContainEqual({ type: 'Swim', value: d.movement });
    expect(d.alignment.find((a) => a.light === 'Frost')?.sources).toContain('Tidal Soul');
  });
  it('shows its own name when given one', async () => {
    const { ancestryName } = await import('../src/data/ancestries');
    expect(ancestryName({ ancestry: 'custom', customAncestryName: '  Kobold ' })).toBe('Kobold');
    expect(ancestryName({ ancestry: 'custom', customAncestryName: '' })).toBe('Custom');
    expect(ancestryName({ ancestry: 'custom' })).toBe('Custom');
    expect(ancestryName({ ancestry: 'praedan', customAncestryName: 'Kobold' })).toBe('Praedan');
  });
  it('is not one of the rules ancestries', async () => {
    const { ancestries, ancestryById, CUSTOM_ANCESTRY } = await import('../src/data/ancestries');
    expect(ancestries).not.toContain(CUSTOM_ANCESTRY);
    expect(ancestryById.get('custom')).toBe(CUSTOM_ANCESTRY);
  });
});
