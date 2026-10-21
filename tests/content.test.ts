// Rules source -> content -> app data integrity.
//
// The Homebrewery source of the rules (rules/BtP-Alpha-Rules.md) is the point of
// reference: this file reads the markdown directly with a small, independent
// reader and checks that
//   - scripts/parse-rules.mjs reproduces src/content/rules.json exactly,
//   - every heading, field and table of the markdown made it into rules.json,
//   - the accessors in src/content (spells, maneuvers, weapons, conditions…)
//     agree with the markdown,
//   - the hand-written app data (src/data, ACTIVATIONS, CONDITION_RULES…) only
//     references rules sections that exist and says what the rules say.
// Expected values come from the markdown, not from the app code.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { includeUnreleased } from '../scripts/unreleased.mjs';
import { describe, expect, it } from 'vitest';
import rulesJson from '../src/content/rules.json';
import {
  allNodes,
  ARCANA_TYPES,
  armorQualities,
  armorRequirements,
  basicActions,
  conditions,
  EVOCATION_TYPES,
  firstTable,
  getCastable,
  getItem,
  getNode,
  getParent,
  MANEUVER_TYPES,
  maneuvers,
  mustNode,
  personalAlignment,
  rulesSource,
  sections,
  slashingVulnerability,
  spells,
  tokensToText,
  weaponPropertyNode,
  weaponProperties,
  weapons,
  type Castable,
  type RuleNode,
} from '../src/content';
import { ancestries, ancestryById } from '../src/data/ancestries';
import { backgroundById, backgrounds, heritageById, heritageFacets } from '../src/data/backgrounds';
import { classById, classes } from '../src/data/classes';
import { ATTRS, LIGHTS, type ClassDef, type Effect, type FacetDef, type PoolFilter, type SpellListDef } from '../src/data/types';
import { ACTIVATIONS } from '../src/engine/activations';
import { classAlignment, classEndurance, classFacets, classTable, columnValue, numeric, subclassesOf, subclassFacets } from '../src/engine/classInfo';
import { CONDITION_DAMAGE_TYPE, CONDITION_RULES } from '../src/engine/conditions';
import { isVariable, parseCost } from '../src/engine/costs';
import { MAX_LEVEL } from '../src/engine/derive';
import { exaltedState, resolveHtml, scaleText } from '../src/engine/scaling';
import { makeCharacter, QA, sample } from './helpers';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MD_PATH = join(ROOT, 'rules/BtP-Alpha-Rules.md');
const ICONS = ['VIG', 'AGI', 'PER', 'INT', 'PRS', 'AP', 'SL'];
const CLASS_LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

// ---------------------------------------------------------------------------
// An independent reader for the Homebrewery markdown.
// ---------------------------------------------------------------------------

interface MdNode {
  depth: number;
  title: string;
  lvl?: number;
  lines: string[];
  children: MdNode[];
  parent?: MdNode;
}

/** Homebrewery inline markup to plain text: icons as {VIG}, no emphasis, no {{style …}} wrappers. */
const clean = (s: string) =>
  s
    .replace(/\{\{[^\s}]*\s+([^}]*?)\s*\}\}/g, '$1')
    .replace(/\$\[([A-Z]+)\]/g, '{$1}')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const MD_RAW = readFileSync(MD_PATH, 'utf8').replace(/\r\n/g, '\n');
/** Commented-out (unreleased) content is not part of the rules. */
const MD_TEXT = includeUnreleased(MD_RAW).replace(/<!--[\s\S]*?-->/g, '');
const MD_LINES = (() => {
  const lines = MD_TEXT.split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === '# Beyond the Prism');
  return lines.slice(start);
})();

const MD_ROOT: MdNode = (() => {
  const root: MdNode = { depth: 0, title: 'root', lines: [], children: [] };
  const stack = [root];
  for (const l of MD_LINES) {
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (!h) {
      stack[stack.length - 1].lines.push(l);
      continue;
    }
    const depth = h[1].length;
    let title = h[2];
    let lvl: number | undefined;
    const lm = title.match(/<\s*lvl\s*(\d+)\s*>\s*$/i);
    if (lm) {
      lvl = Number(lm[1]);
      title = title.slice(0, lm.index);
    }
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    const node: MdNode = { depth, title: clean(title).replace(/\{[A-Z]+\}\s*/g, ''), lvl, lines: [], children: [], parent };
    parent.children.push(node);
    stack.push(node);
  }
  return root;
})();

function mdWalk(n: MdNode, f: (n: MdNode) => void) {
  for (const c of n.children) {
    f(c);
    mdWalk(c, f);
  }
}

/** Follows a path of headings from the top of the document (or from `from`). */
function md(path: string[], from: MdNode = MD_ROOT): MdNode {
  let cur = from;
  for (const t of path) {
    const next = cur.children.find((c) => c.title === t);
    if (!next) throw new Error(`Markdown heading not found: ${[...path].join(' > ')} (at "${t}")`);
    cur = next;
  }
  return cur;
}

/** Body text of a section (its own lines, not its subsections). */
const mdText = (n: MdNode) => clean(n.lines.filter((l) => !/^\s*(\{\{[^}]*$|\}\}|:+)\s*$/.test(l)).join(' '));
/** Body text of a section and all its subsections. */
const mdDeepText = (n: MdNode): string => [mdText(n), ...n.children.map(mdDeepText)].join(' ');

const FIELD = /^\s*\*\*(.+?)\*\*\s*::\s*(.*)$/;
function mdFields(n: MdNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of n.lines) {
    const m = l.match(FIELD);
    if (m) out[clean(m[1])] = clean(m[2]);
  }
  return out;
}

/** The italic type line under a spell/maneuver heading (e.g. "Fire Arcanum, 1st-level"). */
function mdSubtitle(n: MdNode): string | undefined {
  for (const l of n.lines) {
    const t = l.trim();
    if (!t || /^:+$/.test(t) || (t.startsWith('{{') && !t.includes('}}')) || t === '}}' || t.startsWith('![') || t.includes('{{pageNumber')) continue;
    return /^\*[^*].*[^*]\*$/.test(t) ? clean(t) : undefined;
  }
  return undefined;
}

interface MdTable {
  headers: string[];
  rows: string[][];
}
function mdTables(n: MdNode): MdTable[] {
  const out: MdTable[] = [];
  const split = (l: string) => {
    let t = l.trim();
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|')) t = t.slice(0, -1);
    return t.split('|').map((c) => clean(c));
  };
  const isDelim = (l: string) => /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l.trim());
  for (let i = 0; i < n.lines.length; i++) {
    if (!n.lines[i].trim().startsWith('|')) continue;
    const group: string[] = [];
    while (i < n.lines.length && n.lines[i].trim().startsWith('|')) group.push(n.lines[i++]);
    const d = group.findIndex(isDelim);
    if (d < 0) continue;
    const head = group.slice(0, d).map(split);
    const width = Math.max(...group.map((l) => split(l).length));
    out.push({
      headers: Array.from({ length: width }, (_, k) => head.map((r) => r[k] ?? '').filter(Boolean).join(' ')),
      rows: group
        .slice(d + 1)
        .map(split)
        .filter((r) => r.some(Boolean)),
    });
  }
  return out;
}

/** Named lead-in paragraphs: `***Name.*** text`, up to the next item or `:` separator. */
function mdItems(n: MdNode): { name: string; text: string }[] {
  const out: { name: string; parts: string[] }[] = [];
  let cur: { name: string; parts: string[] } | undefined;
  for (const l of n.lines) {
    const t = l.trim();
    const m = t.match(/^(?:[-*]\s+)?\*\*\*(.+?)\*\*\*\s*(.*)$/);
    if (m) {
      cur = { name: clean(m[1]).replace(/[.:]$/, ''), parts: [m[2]] };
      out.push(cur);
    } else if (cur && (/^:+$/.test(t) || FIELD.test(t))) cur = undefined;
    else if (cur && t) cur.parts.push(t);
  }
  return out.map((i) => ({ name: i.name, text: clean(i.parts.join(' ')) }));
}

/** The n-th (0-based) child heading with this title (some titles repeat, e.g. a facet and its option list). */
function mdNth(parent: MdNode, title: string, n: number): MdNode {
  const found = parent.children.filter((c) => c.title === title)[n];
  if (!found) throw new Error(`Markdown heading not found: ${title} #${n + 1}`);
  return found;
}

/** Icons ({VIG} …) mentioned in a text, in order, without repeats. */
const attrsIn = (s: string) => [...new Set([...s.matchAll(/\{(VIG|AGI|PER|INT|PRS)\}/g)].map((m) => m[1]))];

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const ordinal = (s: string) => Number(s.match(/^(\d+)(st|nd|rd|th)$/)?.[1] ?? NaN);
const sortStr = (xs: string[]) => [...xs].sort();

// Reference data read from the markdown.
const MD_DAMAGE_TYPES = md(['Beyond the Prism', 'Damage Types']).children.flatMap((c) =>
  c.title
    .replace(/\(Rank \d+\)/, '')
    .split(/,\s*|\s+and\s+|\s+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== 'and'),
);
const MD_PHYSICAL = ['Crushing', 'Piercing', 'Slashing'];
const MD_CONDITION_NODES = md(['Beyond the Prism', 'Conditions', 'Condition List']).children;
const MD_CONDITIONS = MD_CONDITION_NODES.map((c) => ({ name: c.title.replace(/\s+X$/, ''), leveled: /\sX$/.test(c.title), node: c }));
const MD_CONDITION_NAMES = MD_CONDITIONS.map((c) => c.name);

// ---------------------------------------------------------------------------
// 1. Parser
// ---------------------------------------------------------------------------

describe('rules parser (scripts/parse-rules.mjs)', () => {
  it('reproduces the committed src/content/rules.json from the markdown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'btp-rules-'));
    try {
      const out = join(dir, 'rules.json');
      execFileSync(process.execPath, [join(ROOT, 'scripts/parse-rules.mjs'), MD_PATH, out], { cwd: ROOT, stdio: 'pipe' });
      const fresh = JSON.parse(readFileSync(out, 'utf8'));
      expect(fresh.source).toBe(rulesSource);
      expect(fresh).toEqual(rulesJson);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records the rules file name as the source', () => {
    expect(rulesSource).toBe('BtP-Alpha-Rules.md');
  });

  it('every (uncommented) heading of the markdown is a node, in the same order, depth and facet level', () => {
    const fromMd: string[] = [];
    mdWalk(MD_ROOT, (n) => fromMd.push(`${n.depth}|${n.title}|${n.lvl ?? ''}`));
    const fromJson: string[] = [];
    const walk = (ns: RuleNode[]) =>
      ns.forEach((n) => {
        fromJson.push(`${n.depth}|${n.title}|${n.lvl ?? ''}`);
        if (n.children) walk(n.children);
      });
    walk(sections);
    expect(fromJson).toEqual(fromMd);
  });

  it('every node keeps the `**Key** :: value` fields written under its heading', () => {
    const mismatches: string[] = [];
    const walk = (mdKids: MdNode[], jsKids: RuleNode[]) =>
      mdKids.forEach((m, i) => {
        const j = jsKids[i];
        const want = mdFields(m);
        if (JSON.stringify(want) !== JSON.stringify(j.fields ?? {})) mismatches.push(j.id);
        walk(m.children, j.children ?? []);
      });
    walk(MD_ROOT.children, sections);
    expect(mismatches).toEqual([]);
  });

  it('every node keeps the tables written under its heading', () => {
    const mismatches: string[] = [];
    const walk = (mdKids: MdNode[], jsKids: RuleNode[]) =>
      mdKids.forEach((m, i) => {
        const j = jsKids[i];
        if (JSON.stringify(mdTables(m)) !== JSON.stringify(j.tables ?? [])) mismatches.push(j.id);
        walk(m.children, j.children ?? []);
      });
    walk(MD_ROOT.children, sections);
    expect(mismatches).toEqual([]);
  });

  it('commented-out (unreleased) headings are not in the content', () => {
    const commented = [...includeUnreleased(MD_RAW).matchAll(/<!--([\s\S]*?)-->/g)].flatMap((m) => [...m[1].matchAll(/^#{1,6}\s+(.*)$/gm)].map((h) => clean(h[1].replace(/<\s*lvl\s*\d+\s*>/i, ''))));
    expect(commented.length).toBeGreaterThan(0);
    // e.g. the Vampyre class and the later Arcanist facets are commented out.
    expect(getNode('classes/vampyre')).toBeUndefined();
    expect(getNode('classes/arcanist/arcane-discovery')).toBeUndefined();
  });

  it('no field line is malformed in the markdown (a `**Key** text :: value` line loses its value)', () => {
    // A `**Key** text :: value` line is not a field, so its value is lost.
    const bad = MD_LINES.filter((l) => /^\s*\*\*[^*]+\*\*\s+[^:\s][^:]*::/.test(l)).map((l) => l.trim());
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Tree structure of rules.json
// ---------------------------------------------------------------------------

describe('rules.json tree', () => {
  const nodes = allNodes();

  it('has a sensible number of sections and the expected top-level parts', () => {
    expect(nodes.length).toBeGreaterThan(500);
    expect(sections.map((s) => s.id)).toEqual(['beyond-the-prism', 'player-characters', 'classes', 'equipment', 'reading-spells-maneuvers', 'maneuvers', 'spells']);
  });

  it('ids are unique and every node is reachable by getNode', () => {
    let count = 0;
    const ids = new Set<string>();
    const walk = (ns: RuleNode[]) =>
      ns.forEach((n) => {
        count++;
        ids.add(n.id);
        expect(getNode(n.id)).toBe(n);
        if (n.children) walk(n.children);
      });
    walk(sections);
    expect(ids.size).toBe(count);
    expect(nodes.length).toBe(count);
  });

  it('every node has an id, title and titleHtml; depth grows from parent to child', () => {
    const bad: string[] = [];
    for (const n of nodes) {
      if (!n.id || !n.title || !n.titleHtml || !(n.depth >= 1 && n.depth <= 6)) bad.push(n.id);
      const p = getParent(n.id);
      if (p && !(n.depth > p.depth)) bad.push(`${n.id} (depth)`);
      if (p && !(n.id.startsWith(`${p.id}/`) && !n.id.slice(p.id.length + 1).includes('/'))) bad.push(`${n.id} (id path)`);
      if (!p && n.id.includes('/')) bad.push(`${n.id} (orphan)`);
      if (!/^[a-z0-9-]+(~\d+)?$/.test(n.id.split('/').pop()!)) bad.push(`${n.id} (slug)`);
      if (n.children && n.children.length === 0) bad.push(`${n.id} (empty children)`);
    }
    expect(bad).toEqual([]);
  });

  it('only duplicate titles among siblings get a ~N suffix', () => {
    const bad: string[] = [];
    for (const n of nodes) {
      const m = n.id.match(/~(\d+)$/);
      if (!m) continue;
      const base = n.id.replace(/~\d+$/, '');
      const sib = getNode(base);
      if (!sib || getParent(base) !== getParent(n.id) || Number(m[1]) < 2) bad.push(n.id);
    }
    expect(bad).toEqual([]);
  });

  it('facet levels are within 1–10', () => {
    const lv = nodes.filter((n) => n.lvl !== undefined);
    expect(lv.length).toBeGreaterThan(20);
    for (const n of lv) expect(n.lvl, n.id).toBeGreaterThanOrEqual(1), expect(n.lvl, n.id).toBeLessThanOrEqual(10);
  });

  it('{TOKENS} in text are only the known icon set, and html icons are only known icons', () => {
    const unknown = new Set<string>();
    for (const n of nodes) {
      const strs = [n.title, n.subtitle ?? '', ...Object.entries(n.fields ?? {}).flat(), ...(n.items ?? []).flatMap((i) => [i.name, i.text]), ...(n.tables ?? []).flatMap((t) => [...t.headers, ...t.rows.flat()])];
      for (const s of strs) for (const m of s.matchAll(/\{([A-Za-z]+)\}/g)) if (!ICONS.includes(m[1])) unknown.add(`${n.id}: ${m[0]}`);
      for (const s of [n.html ?? '', n.titleHtml, ...(n.items ?? []).map((i) => i.html)])
        for (const m of s.matchAll(/class="ic ic-([A-Za-z]+)"/g)) if (!ICONS.includes(m[1])) unknown.add(`${n.id}: ic-${m[1]}`);
    }
    expect([...unknown]).toEqual([]);
  });

  it('plain section titles (rules nav, search, crumbs) carry no icon tokens; titleHtml keeps the icon', () => {
    expect(nodes.filter((n) => /\{[A-Z]+\}/.test(n.title)).map((n) => n.id)).toEqual([]);
    const level = nodes.find((n) => n.titleHtml.includes('ic-SL') && n.title === 'Level');
    expect(level).toBeDefined();
  });

  it('no Homebrewery markup leaks into the content ($[X], {{ }}, \\page, <lvl>)', () => {
    const leaks: string[] = [];
    for (const n of nodes) {
      const strs = [n.title, n.titleHtml, n.html ?? '', n.subtitle ?? '', ...Object.entries(n.fields ?? {}).flat(), ...(n.items ?? []).flatMap((i) => [i.name, i.html, i.text]), ...(n.tables ?? []).flatMap((t) => [...t.headers, ...t.rows.flat()])];
      for (const s of strs) if (/\$\[|\{\{|\}\}|<\s*lvl|\\page|\\column|<!--/.test(s)) leaks.push(n.id);
    }
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('tables are rectangular-ish: no row is wider than its header', () => {
    const bad: string[] = [];
    for (const n of nodes) for (const t of n.tables ?? []) for (const r of t.rows) if (r.length > t.headers.length) bad.push(n.id);
    expect([...new Set(bad)]).toEqual([]);
  });

  it('tokensToText reads icons as words', () => {
    expect(tokensToText('Spend 2 {AP}; {SL}d6; {VIG} and {PRS}')).toBe('Spend 2 AP; leveld6; VIG and PRS');
    expect(tokensToText('{FOO}')).toBe('{FOO}');
  });

  it('mustNode throws for unknown ids; firstTable searches descendants', () => {
    expect(() => mustNode('no/such/node')).toThrow(/no\/such\/node/);
    expect(mustNode('classes').title).toBe('Classes');
    expect(getNode('equipment/armor/slashing-vulnerability')?.tables).toBeUndefined();
    expect(firstTable('equipment/armor/slashing-vulnerability')?.headers).toEqual(['Vitality Maximum', 'Slashing Vulnerability']);
    expect(firstTable('no/such/node')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Every rules id referenced by the app resolves
// ---------------------------------------------------------------------------

function allSpellLists(): { where: string; list: SpellListDef; cls?: ClassDef }[] {
  const out: { where: string; list: SpellListDef; cls?: ClassDef }[] = [];
  const fromEffects = (where: string, effects: Effect[] | undefined, cls?: ClassDef) => {
    for (const e of effects ?? []) if (e.kind === 'spellList') out.push({ where, list: e.list, cls });
  };
  for (const c of classes) {
    for (const l of c.spellLists ?? []) out.push({ where: `${c.id}/${l.id}`, list: l, cls: c });
    for (const ch of c.choices ?? []) for (const o of ch.options) fromEffects(`${c.id}/${ch.id}/${o.id}`, o.effects, c);
    for (const [sid, ex] of Object.entries(c.subclassExtras ?? {})) {
      for (const l of ex.spellLists ?? []) out.push({ where: `${c.id}/${sid}/${l.id}`, list: l, cls: c });
      for (const ch of ex.choices ?? []) for (const o of ch.options) fromEffects(`${c.id}/${sid}/${ch.id}/${o.id}`, o.effects, c);
      for (const [k, f] of Object.entries(ex.facetExtras ?? {})) fromEffects(`${c.id}/${sid}/${k}`, f.effects, c);
    }
    for (const [k, f] of Object.entries(c.facetExtras ?? {})) fromEffects(`${c.id}/${k}`, f.effects, c);
  }
  for (const a of ancestries) for (const f of [...a.facets, ...(a.subAncestries ?? []).flatMap((s) => s.facets)]) fromEffects(`${a.id}/${f.name}`, f.effects);
  for (const h of heritageFacets) fromEffects(h.id, h.effects);
  return out;
}

function allFacetDefs(): { where: string; f: FacetDef }[] {
  return [
    ...ancestries.flatMap((a) => [...a.facets.map((f) => ({ where: a.id, f })), ...(a.subAncestries ?? []).flatMap((s) => s.facets.map((f) => ({ where: `${a.id}/${s.id}`, f })))]),
    ...heritageFacets.map((f) => ({ where: f.id, f })),
  ];
}

describe('rules ids referenced by the app', () => {
  const refs: [string, string][] = [];
  for (const c of classes) {
    refs.push([`${c.id}.contentId`, c.contentId], [`${c.id}.tableId`, c.tableId], [`${c.id}.subclassListId`, c.subclassListId]);
    for (const ch of c.choices ?? []) for (const o of ch.options) if (o.contentId) refs.push([`${c.id}.choices.${ch.id}.${o.id}`, o.contentId]);
    for (const ex of Object.values(c.subclassExtras ?? {})) for (const ch of ex.choices ?? []) for (const o of ch.options) if (o.contentId) refs.push([`${c.id}.subclass choice ${o.id}`, o.contentId]);
  }
  for (const a of ancestries) {
    refs.push([`${a.id}.contentId`, a.contentId], [`${a.id}.facetsId`, a.facetsId]);
    for (const s of a.subAncestries ?? []) refs.push([`${a.id}/${s.id}.contentId`, s.contentId]);
  }
  for (const { where, f } of allFacetDefs()) if (f.contentId) refs.push([`${where}: ${f.name}`, f.contentId]);
  for (const b of backgrounds) refs.push([`background ${b.id}`, b.contentId]);
  for (const h of heritageFacets) if (h.contentId) refs.push([`heritage ${h.id}`, h.contentId]);
  for (const a of ACTIVATIONS) refs.push([`activation ${a.label}`, a.id]);
  for (const { where, list } of allSpellLists()) for (const g of list.granted ?? []) refs.push([`${where} granted`, g]);
  for (const a of ancestries) for (const f of a.facets) for (const e of f.effects ?? []) if (e.kind === 'grant') refs.push([`${a.id} grant`, e.castable]);

  it.each(refs)('%s -> %s', (_where, id) => {
    expect(getNode(id)).toBeDefined();
  });

  it('facet items referenced by name exist in their section', () => {
    const missing = allFacetDefs()
      .filter(({ f }) => f.item)
      .filter(({ f }) => !getItem(f.contentId!, f.item!))
      .map(({ where, f }) => `${where}: ${f.item}`);
    expect(missing).toEqual([]);
  });

  it('granted spells/maneuvers resolve to castables of the list kind', () => {
    for (const { where, list } of allSpellLists()) {
      for (const g of list.granted ?? []) {
        const cs = getCastable(g);
        expect(cs, `${where}: ${g}`).toBeDefined();
        const kinds = [list.pool.kind, ...(list.pool.or ?? []).map((o) => o.kind)];
        expect(kinds, `${where}: ${g}`).toContain(cs!.kind);
      }
    }
    for (const a of ancestries) for (const f of a.facets) for (const e of f.effects ?? []) if (e.kind === 'grant') expect(getCastable(e.castable), e.castable).toBeDefined();
  });

  it('ACTIVATIONS: (id, label) pairs are unique and spell/maneuver activations are castables', () => {
    const keys = ACTIVATIONS.map((a) => `${a.id}:${a.label}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of ACTIVATIONS) {
      if (a.id.startsWith('spells/') || a.id.startsWith('maneuvers/')) expect(getCastable(a.id), a.id).toBeDefined();
      const n = getNode(a.id)!;
      const costText = n.fields?.Cost ?? n.fields?.['Cast Time'] ?? n.fields?.['Execution Time'];
      expect(() => parseCost(costText)).not.toThrow();
    }
  });

  it('rules ids hard-coded in the UI resolve', () => {
    const dir = join(ROOT, 'src/ui');
    const src = readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    const ids = [...src.matchAll(/(?:<(?:Guide|RuleLink)\s+id=|getNode\()["']([a-z0-9~/-]+)["']/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(10);
    expect(ids.filter((id) => !getNode(id))).toEqual([]);
    // Builder builds attribute ids from the attribute names.
    for (const a of ATTRS) expect(getNode(`beyond-the-prism/attributes/${({ VIG: 'vigor', AGI: 'agility', PER: 'perception', INT: 'intelligence', PRS: 'presence' } as const)[a]}-${a.toLowerCase()}`), a).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Classes and subclasses
// ---------------------------------------------------------------------------

const MD_CLASSES = md(['Classes']).children.filter((c) => c.children.some((k) => k.title === `${c.title} Class Table`));

describe('classes vs the markdown', () => {
  it('the app models exactly the classes the rules define (those with a Class Table)', () => {
    expect(sortStr(classes.map((c) => c.name))).toEqual(sortStr(MD_CLASSES.map((c) => c.title)));
    expect(new Set(classes.map((c) => c.id)).size).toBe(classes.length);
    for (const c of classes) expect(classById.get(c.id)).toBe(c);
  });

  it('MAX_LEVEL matches the highest level in the class tables', () => {
    for (const m of MD_CLASSES) {
      const t = mdTables(md(['Classes', m.title, `${m.title} Class Table`]))[0];
      expect(Math.max(...t.rows.map((r) => ordinal(r[0]))), m.title).toBe(MAX_LEVEL);
    }
  });

  describe.each(classes.map((c) => [c.name, c] as const))('%s', (name, cls) => {
    const mdClass = md(['Classes', name]);
    const mdTable = mdTables(md([`${name} Class Table`], mdClass))[0];
    const training = mdFields(md(['Training'], mdClass));
    const headers = mdTable.headers;

    it('class table matches the markdown (levels, bonus, die, facets, every column)', () => {
      const t = classTable(cls);
      expect(t.headers).toEqual(mdTable.headers);
      expect(t.rows.length).toBe(mdTable.rows.length);
      const dieCol = headers.findIndex((h) => / Die$/.test(h));
      const facetsCol = headers.indexOf('Facets');
      mdTable.rows.forEach((r, i) => {
        const row = t.rows[i];
        expect(row.level).toBe(ordinal(r[0]));
        expect(row.bonus).toBe(Number(r[1].replace('+', '')));
        expect(row.die).toBe(r[dieCol]);
        expect(row.facets).toBe(r[facetsCol]);
        headers.forEach((h, k) => expect(row.columns[h], `${h} @ ${r[0]}`).toBe(r[k]));
      });
      expect(t.rows.map((r) => r.level)).toEqual(CLASS_LEVELS);
    });

    it('die name and its column', () => {
      expect(headers).toContain(`${cls.dieName} Die`);
      expect(training['Save Checks'] ?? '').toContain(`${cls.dieName} Die`);
    });

    it('resources read real class-table columns; "Limit" columns are limits', () => {
      expect(cls.resources.length).toBeGreaterThan(0);
      for (const r of cls.resources) {
        expect(headers, r.column).toContain(r.column);
        expect(r.column).toContain(r.name);
        expect(r.mode).toBe(/Limit/.test(r.column) ? 'limit' : 'pool');
        for (const lv of CLASS_LEVELS) {
          const v = columnValue(cls, lv, r.column)!;
          expect(v, `${r.column} @ ${lv}`).toMatch(/^(\d+|-|—)$/);
        }
      }
      // The highest level has resources to spend.
      expect(numeric(columnValue(cls, MAX_LEVEL, cls.resources[0].column))).toBeGreaterThan(0);
    });

    it('spell list columns (count / max level) exist in the class table', () => {
      const lists = allSpellLists().filter((l) => l.cls === cls);
      for (const { where, list } of lists) {
        const cols = [list.count.column, list.pool.maxLevelColumn, ...(list.pool.or ?? []).map((o) => o.maxLevelColumn)].filter(Boolean) as string[];
        for (const col of cols) expect(headers.some((h) => h.toLowerCase().includes(col.toLowerCase())), `${where}: ${col}`).toBe(true);
      }
      if (lists.some((l) => l.list.pool.maxLevelColumn)) expect(numeric(columnValue(cls, MAX_LEVEL, 'Max'))).toBeGreaterThanOrEqual(1);
    });

    it('every facet in the class table has a `### Name < lvl N >` section at that level, and vice versa', () => {
      const norm = (s: string) => s.replace(/[’']/g, "'").toLowerCase();
      const facetsCol = headers.indexOf('Facets');
      const fromTable = mdTable.rows.flatMap((r) =>
        r[facetsCol]
          .split(',')
          .map((f) => f.trim())
          .filter((f) => f && f !== '—')
          .map((f) => `${ordinal(r[0])}:${norm(f)}`),
      );
      const fromHeadings = mdClass.children.filter((c) => c.lvl !== undefined && c.lvl <= MAX_LEVEL).map((c) => `${c.lvl}:${norm(c.title)}`);
      expect(sortStr(fromHeadings)).toEqual(sortStr(fromTable));
      // and the engine sees the same facets
      expect(sortStr(classFacets(cls, MAX_LEVEL).map((f) => `${f.level}:${norm(f.name)}`))).toEqual(sortStr(fromTable));
    });

    it('Endurance matches the rules text', () => {
      const end = mdClass.children.find((c) => /^Endurance/.test(c.title))!;
      const m = mdText(end).match(/start with (\d+) Endurance and gain (\d+) per level/)!;
      expect(m, mdText(end)).toBeTruthy();
      expect(classEndurance(cls)).toEqual({ start: Number(m[1]), perLevel: Number(m[2]) });
    });

    it('Alignment matches the rules text', () => {
      const al = mdClass.children.find((c) => c.title === 'Alignment');
      const text = al ? mdText(al) : '';
      const want = !al ? null : /of your choice/.test(text) ? 'choice' : LIGHTS.find((l) => text.includes(`${l} Alignment`));
      expect(classAlignment(cls)).toBe(want);
    });

    it('Training: save checks, skill checks, actions, maneuver/spell dice, armor', () => {
      const saves = training['Save Checks'];
      const wantSaves = [...attrsIn(saves), ...(/another Attribute of your choice/.test(saves) ? ['choice'] : [])];
      expect(cls.saveTandem).toEqual(wantSaves);
      expect(!!cls.saveEmpowered).toBe(/Empowered/.test(saves));
      expect([cls.basicSkillEmpowered]).toEqual(attrsIn(training['Skill Checks']));
      const actions = training.Actions ? [...training.Actions.matchAll(/(Arcane|Combat|Supernatural)/g)].map((m) => m[1]) : [];
      expect(cls.actions).toEqual(actions);
      expect(!!cls.maneuverDie).toBe(!!training.Maneuvers);
      const sp = training.Spells;
      if (!sp) expect(cls.spellAttr).toBeUndefined();
      else if (/^Choose/.test(sp)) expect(cls.spellAttr).toBe('choice');
      else expect([cls.spellAttr]).toEqual(attrsIn(sp).slice(0, 1));
      const attrDie = !!sp && (/Attribute Die is your Spell Mod Die/.test(sp) || /^Your \{[A-Z]+\} Die is your Spell Mod Die/.test(sp));
      expect(cls.spellDie === 'attr').toBe(attrDie);
      const armor = training.Armor ?? '';
      expect(cls.armor.some((a) => a.kind === 'levelUnarmored')).toBe(/level to your AC while not wearing armor/.test(armor));
      const bonus = cls.armor.find((a) => a.kind === 'bonusWith');
      const wantArmor = /any kind of armor/.test(armor) ? ['Light', 'Medium', 'Heavy'] : (['Light', 'Medium', 'Heavy'] as const).filter((t) => new RegExp(`Bonus to your AC while wearing[^.]*\\b${t}\\b`).test(armor));
      expect(bonus && bonus.kind === 'bonusWith' ? bonus.armor : []).toEqual(wantArmor);
    });

    it('subclasses match the rules list, and subclass extras refer to real subclasses and facets', () => {
      const listTitle = getNode(cls.subclassListId)!.title;
      const mdList = md(['Classes', listTitle]);
      const subs = subclassesOf(cls);
      expect(subs.map((s) => s.name)).toEqual(mdList.children.map((c) => c.title));
      expect(subs.length).toBeGreaterThan(0);
      for (const s of subs) {
        expect(getParent(s.contentId)?.id).toBe(cls.subclassListId);
        // every subclass has facets at 1st level
        expect(subclassFacets(cls, s.id, 1).length, s.id).toBeGreaterThan(0);
      }
      for (const [sid, ex] of Object.entries(cls.subclassExtras ?? {})) {
        const sc = subs.find((s) => s.id === sid);
        expect(sc, sid).toBeDefined();
        const facetSlugs = (getNode(sc!.contentId)!.children ?? []).filter((c) => c.lvl !== undefined).map((c) => c.id.split('/').pop());
        for (const k of Object.keys(ex.facetExtras ?? {})) expect(facetSlugs, `${sid}.${k}`).toContain(k);
      }
    });

    it('facetExtras keys are facets (sections with a level) of the class', () => {
      const facetSlugs = (getNode(cls.contentId)!.children ?? []).filter((c) => c.lvl !== undefined).map((c) => c.id.split('/').pop());
      for (const k of Object.keys(cls.facetExtras ?? {})) expect(facetSlugs, k).toContain(k);
    });

    it('choices: options are exactly the sections the rules offer', () => {
      for (const ch of cls.choices ?? []) {
        const parent = getParent(ch.options[0].contentId!)!;
        expect(sortStr(ch.options.map((o) => o.contentId!))).toEqual(sortStr((parent.children ?? []).map((c) => c.id)));
        expect(sortStr(ch.options.map((o) => o.name))).toEqual(sortStr((parent.children ?? []).map((c) => c.title)));
        expect(new Set(ch.options.map((o) => o.id)).size).toBe(ch.options.length);
        expect(ch.level).toBeGreaterThanOrEqual(1);
        expect(ch.level).toBeLessThanOrEqual(MAX_LEVEL);
      }
    });

    it('trackers have a rules section in the class', () => {
      for (const t of cls.trackers ?? []) {
        const found = allNodes().some((n) => n.id.startsWith(`${cls.contentId}/`) && n.title.startsWith(t));
        expect(found, t).toBe(true);
      }
    });
  });
});

describe('class options vs their rules text', () => {
  const gladiator = classById.get('gladiator')!;
  const styles = gladiator.choices!.find((c) => c.id === 'combat-style')!;
  it.each(styles.options.map((o) => [o.name, o] as const))('Combat Style %s: weapon property and Tandem die', (name, o) => {
    const text = mdText(md(['Classes', 'Gladiator', 'Combat Styles', name]));
    for (const e of o.effects ?? []) {
      if (e.kind !== 'weapon') continue;
      expect(text, name).toContain(`${e.property}`);
      if (e.tandem) expect(text).toMatch(new RegExp(`roll your \\{${e.tandem}\\} Die in Tandem`));
      if (e.bolster) expect(text).toContain(`Bolstered ${e.bolster}`);
      if (e.melee) expect(text).toContain(`${e.property} melee weapon`);
    }
    // Styles that name a Tandem die in the rules have it modelled.
    const m = text.match(/roll your \{([A-Z]+)\} Die in Tandem/);
    if (m) expect((o.effects ?? []).some((e) => e.kind === 'weapon' && e.tandem === m[1])).toBe(true);
  });

  const auras = classById.get('champion')!.choices!.find((c) => c.id === 'champions-aura')!;
  it.each(auras.options.map((o) => [o.name, o] as const))('Champion’s Aura %s grants the Alignment named in the rules', (name, o) => {
    const text = mdDeepText(md([name], mdNth(md(['Classes', 'Champion']), 'Champion’s Aura', 1)));
    const lights = LIGHTS.filter((l) => text.includes(`${l} Alignment`));
    expect((o.effects ?? []).filter((e) => e.kind === 'alignment').map((e) => (e as { light: string }).light)).toEqual(lights);
  });

  const genres = classById.get('troubadour')!.choices!.find((c) => c.id === 'favored-genre')!;
  it.each(genres.options.map((o) => [o.name, o] as const))('Favored Genre %s: Alignment and Prepare types', (name, o) => {
    const text = mdText(md(['Classes', 'Favored Genres', name]));
    const light = LIGHTS.find((l) => text.includes(`a level of ${l} Alignment`));
    expect((o.effects ?? []).find((e) => e.kind === 'alignment')).toEqual({ kind: 'alignment', light });
    const prep = text.match(/You can Prepare ([^.]*) Evocations/)![1];
    const types = prep.split(/,\s*(?:and\s+)?|\s+and\s+/).map((s) => s.trim());
    const list = (o.effects ?? []).find((e) => e.kind === 'spellList') as Extract<Effect, { kind: 'spellList' }>;
    expect(sortStr(list.list.pool.types!)).toEqual(sortStr(types));
    expect(list.list.level).toBe(2);
  });

  const manif = classById.get('incarnate')!.choices!.find((c) => c.id === 'manifestation')!;
  it.each(manif.options.map((o) => [o.name, o] as const))('Manifestation %s: 1st-tier spell/maneuver matches the rules', (name, o) => {
    const text = mdDeepText(md([name], mdNth(md(['Classes', 'Incarnate']), 'Manifestations', 1)));
    const list = (o.effects ?? []).find((e) => e.kind === 'spellList') as Extract<Effect, { kind: 'spellList' }>;
    const p = list.list.pool;
    if (p.kind === 'spell') expect(text).toContain(`one ${p.types![0]} cantrip`);
    else expect(text).toContain(`one ${p.types![0]} Maneuver`);
    expect(list.list.count.base).toBe(1);
  });

  const wellspring = classById.get('berserker')!.choices!.find((c) => c.id === 'somatic-wellspring')!;
  it('Somatic Wellspring offers the three Attributes the rules name', () => {
    const text = mdText(md(['Classes', 'Berserker', 'Somatic Wellspring']));
    expect(wellspring.options.map((o) => o.id)).toEqual(attrsIn(text));
  });

  it('Berserker knows Rage plus one maneuver at 1st level (Maneuvers Known 2)', () => {
    const text = mdText(md(['Classes', 'Berserker', 'Berserker Maneuvers']));
    expect(text).toMatch(/one 1st-level maneuver of your choice from the types you can learn \(Feral and Instinctual\) and the Rage maneuver/);
    const b = classById.get('berserker')!;
    expect(b.spellLists![0].pool.types).toEqual(['Feral', 'Instinctual']);
    expect(numeric(columnValue(b, 1, 'Known'))).toBe(2);
  });

  it('class maneuver types match "the types you can learn (X and Y)"', () => {
    for (const [id, facet] of [
      ['berserker', 'Berserker Maneuvers'],
      ['expert', 'Expert Maneuvers'],
    ] as const) {
      const text = mdText(md(['Classes', classById.get(id)!.name, facet]));
      const m = text.match(/types you can learn \((\w+) and (\w+)\)/)!;
      expect(classById.get(id)!.spellLists![0].pool.types, id).toEqual([m[1], m[2]]);
    }
  });

  it('subclass spell lists match their rules text', () => {
    const luminance = mdDeepText(md(['Classes', 'Inner Luminance', 'Flaming Luminance']));
    expect(luminance).toMatch(/learn two Fire cantrips and two Fire Arcana/);
    const fl = classById.get('luminary')!.subclassExtras!['flaming-luminance'].spellLists!;
    expect(fl.find((l) => l.id === 'cantrips')!.count.base).toBe(2);
    // two at 1st level, plus one at 2nd (even level)
    expect(fl.find((l) => l.id === 'arcana')!.count.byLevel).toEqual([2, 3]);

    const king = mdDeepText(md(['Classes', 'Primordial Souls', 'The King']));
    expect(king).toMatch(/learn two Frost evocations/);
    const ks = classById.get('incarnate')!.subclassExtras!['the-king'].spellLists![0];
    expect([ks.count.base, ks.pool.types]).toEqual([2, ['Frost']]);

    const cosmos = mdDeepText(md(['Classes', 'Divine Domains', 'Cosmos Domain']));
    expect(cosmos).toMatch(/learn three mantras, each of which must be either Frost, Pneuma, Lunar, or Platinum/);
    const cm = classById.get('thaumaturge')!.subclassExtras!['cosmos-domain'].spellLists!;
    expect(cm[0].count.base).toBe(3);
    expect(cm[0].pool.types).toEqual(['Frost', 'Pneuma', 'Lunar', 'Platinum']);
    expect(cm[0].pool.or![0].types).toEqual(['Mind', 'Moon']);

    const kinesis = mdDeepText(md(['Classes', 'Arcane Triumvirates', 'Kinesis Triumvirate']));
    expect(kinesis).toMatch(/learn three cantrips/);
    expect(classById.get('arcanist')!.subclassExtras!['kinesis-triumvirate'].spellLists![0].count.base).toBe(3);

    const throne = mdDeepText(md(['Classes', "Champion's Causes", 'The Throne']));
    expect(throne).toMatch(/Martial and Psychological Maneuvers, as well as Flame and Infernal Evocations/);
    const ex = classById.get('champion')!.subclassExtras!['the-throne'].spellLists![0];
    expect(ex.pool.types).toEqual(['Martial', 'Psychological']);
    expect(ex.pool.or![0].types).toEqual(['Flame', 'Infernal']);
    // Smite plus two = Exploits Known at 2nd level
    expect(numeric(columnValue(classById.get('champion')!, 2, 'Known'))).toBe(1 + 2);
  });

  it('Arcanist prepares level + INT arcana (rules text)', () => {
    const text = mdDeepText(md(['Classes', 'Arcanist', 'Prismacasting']));
    expect(text).toMatch(/equal to your Arcanist level plus your \{INT\} points/);
    const p = classById.get('arcanist')!.spellLists!.find((l) => l.id === 'prepared')!;
    expect(p.count).toEqual({ level: true, attr: 'INT' });
  });
});

// ---------------------------------------------------------------------------
// 5. Spell list definitions are satisfiable
// ---------------------------------------------------------------------------

/** The pool rule as documented in src/data/types.ts. */
function inPool(cs: Castable, f: PoolFilter, maxLevel: number): boolean {
  const self =
    cs.kind === f.kind &&
    (!f.types || f.types.includes(cs.type)) &&
    (cs.kind !== 'spell' || ((!f.group || cs.group === f.group) && (!f.tiers || f.tiers.includes(cs.tier)))) &&
    (!f.maxLevelColumn || cs.level <= maxLevel);
  return self || (f.or ?? []).some((o) => inPool(cs, o, maxLevel));
}

describe('spell list definitions', () => {
  const lists = allSpellLists();
  it('ids are unique per source and types are real spell/maneuver types', () => {
    const validTypes = (f: PoolFilter): boolean =>
      (f.types ?? []).every((t) => (f.kind === 'maneuver' ? MANEUVER_TYPES : f.group === 'Arcana' ? ARCANA_TYPES : f.group === 'Evocations' ? EVOCATION_TYPES : [...ARCANA_TYPES, ...EVOCATION_TYPES]).includes(t)) &&
      (f.kind === 'spell' || (!f.group && !f.tiers)) &&
      (f.or ?? []).every(validTypes);
    for (const { where, list } of lists) expect(validTypes(list.pool), where).toBe(true);
    for (const c of classes) {
      const ids = (c.spellLists ?? []).map((l) => l.id);
      expect(new Set(ids).size, c.id).toBe(ids.length);
      for (const l of c.spellLists ?? []) if (l.from) expect(ids, `${c.id}.${l.id}`).toContain(l.from);
    }
  });

  it.each(lists.map((l) => [l.where, l] as const))('%s has enough spells/maneuvers to choose from', (_w, { list, cls }) => {
    const general = [...spells, ...maneuvers].filter((s) => !s.source);
    for (const lv of CLASS_LEVELS.filter((l) => l >= (list.level ?? 1))) {
      const maxLevel = cls ? numeric(columnValue(cls, lv, list.pool.maxLevelColumn ?? 'Max')) : 1;
      const pool = general.filter((s) => inPool(s, list.pool, maxLevel) && !(list.granted ?? []).includes(s.id));
      let need = list.count.base ?? 0;
      if (list.count.byLevel) need += list.count.byLevel[Math.min(lv, list.count.byLevel.length) - 1];
      if (list.count.column && cls) need += numeric(columnValue(cls, lv, list.count.column));
      if (list.count.level) need += lv;
      need -= (list.granted ?? []).length;
      expect(pool.length, `level ${lv}`).toBeGreaterThanOrEqual(Math.max(1, need));
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Ancestries, backgrounds and heritage facets
// ---------------------------------------------------------------------------

const MD_ANCESTRIES = md(['Player Characters', 'Ancestries']).children;

/** Checks an effect against the text of the facet that grants it; returns a problem or ''. */
function effectMatchesText(e: Effect, text: string): string {
  const has = (s: string | RegExp) => (typeof s === 'string' ? text.includes(s) : s.test(text));
  switch (e.kind) {
    case 'alignment':
      return e.light === 'choice' || has(`${e.light} Alignment`) ? '' : `no "${e.light} Alignment"`;
    case 'resistance': {
      const m = text.match(new RegExp(`(?:\\b${e.type}(?: and \\w+)?|\\w+ and ${e.type}) Resistance (equal to (half )?your (?:Class|Lumen) Bonus|\\d+)`, 'i'));
      if (!m) return `no ${e.type} Resistance`;
      const want = m[2] ? 'halfClassBonus' : /^equal/.test(m[1]) ? 'classBonus' : Number(m[1]);
      return want === e.amount ? '' : `${e.type}: ${String(e.amount)} vs ${String(want)}`;
    }
    case 'movement':
      return has(new RegExp(`Movement increases by ${String(e.amount)}\\b`)) ? '' : `no "Movement increases by ${String(e.amount)}"`;
    case 'movementType':
      return has(`${e.type} Movement equal to ${e.amount === 'halfMovement' ? 'half ' : ''}your Movement`) ? '' : `${e.type} Movement`;
    case 'hobbies': {
      const words: Record<number, string> = { 1: '(an|one)', 2: 'two', 3: 'three' };
      return has(new RegExp(`${words[e.count]} (new |additional )?Hobb(y|ies)[^.]*${e.rank}`, 'i')) ? '' : `hobbies ${e.count} ${e.rank}`;
    }
    case 'radiance':
      return e.amount === 1 && has('additional Radiance') ? '' : 'radiance';
    case 'vitality':
      return e.amount === 1 && has('additional Vitality') ? '' : 'vitality';
    case 'endurance':
      return e.amount === 'twiceLevel' && has(/twice your Level/i) ? '' : 'endurance';
    case 'bolster': {
      const attr = e.what.match(/^(VIG|AGI|PER|INT|PRS)/)?.[1];
      return has(`Bolstered ${String(e.amount)}`) && (!attr || has(`{${attr}}`)) ? '' : `bolster ${e.what}`;
    }
    case 'sense':
      return has(e.name) ? '' : e.name;
    case 'bulkShift':
      return has(`Bulk Rank of items you carry on your person (not in a backpack) is decreased by ${e.amount}`) ? '' : 'bulk';
    case 'attributePoint':
      return has('additional Attribute Point') ? '' : 'attribute point';
    case 'noSlashingVulnerability':
      return has('no Slashing Vulnerability') ? '' : 'slashing vulnerability';
    case 'acUnarmored':
      return e.amount === 'level' && has('add your Level to your AC') ? '' : 'AC';
    case 'grant':
      return has(`learn the ${getCastable(e.castable)?.name} cantrip`) ? '' : `grant ${e.castable}`;
    case 'spellList':
      return (e.list.pool.types ?? []).every((t) => has(t)) ? '' : `spell list ${e.list.id}`;
    default:
      return '';
  }
}

describe('ancestries vs the markdown', () => {
  it('the app models exactly the ancestries in the rules', () => {
    expect(sortStr(ancestries.map((a) => a.name))).toEqual(sortStr(MD_ANCESTRIES.map((a) => a.title)));
    for (const a of ancestries) expect(ancestryById.get(a.id)).toBe(a);
  });

  describe.each(ancestries.map((a) => [a.name, a] as const))('%s', (name, a) => {
    const mdFacets = md([name, 'Facets'], md(['Player Characters', 'Ancestries']));
    const items = mdItems(mdFacets);

    it('facets are exactly the named facets in the rules (Sub-Ancestry aside)', () => {
      expect(a.facets.map((f) => f.name)).toEqual(items.map((i) => i.name).filter((n) => n !== 'Sub-Ancestry'));
      expect(!!a.subAncestries).toBe(items.some((i) => i.name === 'Sub-Ancestry'));
    });

    it('sub-ancestries and their facets match the rules', () => {
      expect((a.subAncestries ?? []).map((s) => s.name)).toEqual(mdFacets.children.map((c) => c.title));
      for (const s of a.subAncestries ?? []) {
        const sub = md([s.name], mdFacets);
        expect(s.facets.map((f) => f.name), s.name).toEqual(mdItems(sub).map((i) => i.name));
      }
    });

    it('modelled effects say what the facet text says', () => {
      const problems: string[] = [];
      const check = (facets: FacetDef[], node: MdNode) => {
        const texts = new Map(mdItems(node).map((i) => [i.name, i.text]));
        for (const f of facets) {
          const text = texts.get(f.name) ?? '';
          if (f.name === 'Prismatic Resistance') continue; // checked below
          for (const e of f.effects ?? []) {
            const p = effectMatchesText(e, text);
            if (p) problems.push(`${f.name}: ${p}`);
          }
          // Every Alignment and Resistance in the text is modelled.
          for (const l of LIGHTS) if (text.includes(`level of ${l} Alignment`) && !(f.effects ?? []).some((e) => e.kind === 'alignment' && e.light === l)) problems.push(`${f.name}: ${l} Alignment not modelled`);
          for (const m of text.matchAll(/(\w+)(?: and (\w+))? Resistance/g))
            for (const t of [m[1], m[2]].filter(Boolean))
              if ([...MD_DAMAGE_TYPES, ...MD_CONDITION_NAMES].includes(t) && !(f.effects ?? []).some((e) => e.kind === 'resistance' && e.type === t)) problems.push(`${f.name}: ${t} Resistance not modelled`);
        }
      };
      check(a.facets, mdFacets);
      for (const s of a.subAncestries ?? []) check(s.facets, md([s.name], mdFacets));
      expect(problems).toEqual([]);
    });

    it('every ancestry grants exactly one Alignment (with its sub-ancestry)', () => {
      const count = (fs: FacetDef[]) => fs.flatMap((f) => f.effects ?? []).filter((e) => e.kind === 'alignment').length;
      if (a.subAncestries?.length && count(a.facets) === 0) for (const s of a.subAncestries) expect(count(s.facets), s.name).toBe(1);
      else expect(count(a.facets)).toBe(1);
    });
  });

  it('Platinum soli: Prismatic Resistance covers every non-physical damage type', () => {
    const text = mdItems(md(['Soli', 'Facets', 'Platinum'], md(['Player Characters', 'Ancestries']))).find((i) => i.name === 'Prismatic Resistance')!.text;
    expect(text).toMatch(/Resistance to all damage types except Crushing, Piercing, or Slashing, equal to half your Class bonus/);
    const f = ancestryById.get('soli')!.subAncestries!.find((s) => s.id === 'platinum')!.facets.find((x) => x.name === 'Prismatic Resistance')!;
    const res = (f.effects ?? []).filter((e) => e.kind === 'resistance') as Extract<Effect, { kind: 'resistance' }>[];
    expect(sortStr(res.map((r) => r.type))).toEqual(sortStr(MD_DAMAGE_TYPES.filter((t) => !MD_PHYSICAL.includes(t))));
    expect(res.every((r) => r.amount === 'halfClassBonus')).toBe(true);
  });

  it('resistance types in app data are damage types or conditions from the rules', () => {
    const known = [...MD_DAMAGE_TYPES, ...MD_CONDITION_NAMES];
    const types: string[] = [];
    const collect = (effects: Effect[] | undefined) => effects?.forEach((e) => (e.kind === 'resistance' || e.kind === 'vulnerability') && types.push(e.type));
    for (const { f } of allFacetDefs()) collect(f.effects);
    for (const c of classes) {
      Object.values(c.facetExtras ?? {}).forEach((f) => collect(f.effects));
      Object.values(c.subclassExtras ?? {}).forEach((ex) => Object.values(ex.facetExtras ?? {}).forEach((f) => collect(f.effects)));
    }
    expect(types.length).toBeGreaterThan(10);
    expect(types.filter((t) => !known.includes(t))).toEqual([]);
  });
});

describe('backgrounds and heritage facets vs the markdown', () => {
  const mdBgs = md(['Player Characters', 'Backgrounds']).children;
  const mdHer = md(['Player Characters', 'Heritage Facets']).children;

  it('the app has exactly the backgrounds and heritage facets in the rules', () => {
    expect(backgrounds.map((b) => b.name)).toEqual(mdBgs.map((b) => b.title));
    expect(heritageFacets.map((h) => h.name)).toEqual(mdHer.map((h) => h.title));
    for (const b of backgrounds) expect(backgroundById.get(b.id)).toBe(b);
    for (const h of heritageFacets) expect(heritageById.get(h.id)).toBe(h);
  });

  it.each(backgrounds.map((b) => [b.name, b] as const))('%s: Profession, Hobbies and Facet match the rules', (name, b) => {
    const lines = md([name], md(['Player Characters', 'Backgrounds'])).lines.map((l) => l.trim());
    const get = (k: string) => clean(lines.find((l) => l.startsWith(`**${k}**`))!.replace(`**${k}**`, ''));
    expect(b.profession).toBe(get('Profession'));
    expect(b.hobbies).toEqual(get('Hobbies').split(/,\s*/));
    expect(heritageById.get(b.heritage)?.name).toBe(get('Facet'));
  });

  it.each(heritageFacets.map((h) => [h.name, h] as const))('%s: modelled effects and uses say what the rules say', (name, h) => {
    const text = mdDeepText(md([name], md(['Player Characters', 'Heritage Facets'])));
    for (const e of h.effects ?? []) {
      if (e.kind === 'bolster') expect(text).toContain(`Bolstered ${String(e.amount)}`);
      else if (e.kind === 'resistance') expect(text).toContain(`${e.type} Resistance ${String(e.amount)}`);
      else expect(effectMatchesText(e, text)).toBe('');
    }
    if (h.uses) expect(text).toMatch(new RegExp(`must finish a ${h.uses.per}`));
  });
});

// ---------------------------------------------------------------------------
// 7. Conditions
// ---------------------------------------------------------------------------

describe('conditions vs the markdown', () => {
  it('content lists the conditions of the rules, with X marking leveled ones', () => {
    expect(conditions.map((c) => [c.name, c.leveled])).toEqual(MD_CONDITIONS.map((c) => [c.name, c.leveled]));
    expect(new Set(conditions.map((c) => c.name)).size).toBe(conditions.length);
  });

  it('CONDITION_RULES covers exactly the rules conditions', () => {
    expect(sortStr(Object.keys(CONDITION_RULES))).toEqual(sortStr(MD_CONDITION_NAMES));
  });

  it('CONDITION_DAMAGE_TYPE = the "Immunity to X damage prevents this condition" lines', () => {
    const want: Record<string, string> = {};
    for (const c of MD_CONDITIONS) {
      const m = mdText(c.node).match(/Immunity to (\w+) damage prevents this condition/i);
      if (m) want[c.name] = m[1];
    }
    expect(Object.keys(want)).toHaveLength(6);
    expect(CONDITION_DAMAGE_TYPE).toEqual(want);
    for (const t of Object.values(want)) expect(MD_DAMAGE_TYPES).toContain(t);
  });

  describe.each(sample(MD_CONDITIONS, 8).map((c) => [c.name, c] as const))('%s', (name, c) => {
    const rule = CONDITION_RULES[name];
    const text = mdText(c.node);

    it('implied conditions are the ones the text gives you, at the level it says', () => {
      const implied = new Map((rule.implies ?? []).map(([n, f]) => [n, f(4)]));
      const want = new Map<string, number>();
      for (const other of MD_CONDITION_NAMES) {
        if (other === name) continue;
        const m = text.match(new RegExp(`You are (?:also )?[^.]*?\\b${other}\\b( half of X| \\d*X| \\d+)?`));
        if (!m) continue;
        const lv = m[1]?.trim();
        want.set(other, !lv ? 1 : lv === 'half of X' ? 2 : lv.endsWith('X') ? Number(lv.slice(0, -1) || 1) * 4 : Number(lv));
      }
      expect(Object.fromEntries(implied)).toEqual(Object.fromEntries(want));
    });

    it('"Your {X} Checks are Hindered X" is modelled as Hindered X on that Attribute', () => {
      const m = text.match(/^Your \{([A-Z]+)\} Checks are Hindered X\.?$/);
      if (!m) return;
      expect(rule.checks).toHaveLength(1);
      expect(rule.checks![0].attrs).toEqual([m[1]]);
      expect(rule.checks![0].kind).toBe('hindered');
      expect(rule.checks![0].amount!(3)).toBe(3);
    });

    it('start-of-turn damage has the type and amount in the text', () => {
      const play = makeCharacter().play;
      const lvl = text.match(/take (\w+) damage at the start of each of your turns equal to your level times X/);
      const mult = text.match(/take (\d*)X (\w+) damage/);
      if (lvl) {
        expect(rule.startDamage?.type).toBe(lvl[1]);
        expect(rule.startDamage!.amount(3, 4, play)).toBe(12);
      } else if (mult) {
        expect(rule.startDamage?.type).toBe(mult[2]);
        expect(rule.startDamage!.amount(3, 1, { ...play, endurance: 10 })).toBe(Number(mult[1] || 1) * 3);
      } else expect(rule.startDamage).toBeUndefined();
    });

    it('"reduces by 1 at the end of your turn" is an end-of-turn change', () => {
      expect(rule.endChange === -1).toBe(/level of this Condition reduces by 1 at the end of your turn/.test(text));
      for (const t of rule.reducedBy ?? []) expect(text).toMatch(new RegExp(`each time you take ${t} damage|reduces by \\d+ (each time|when) you take ${t} damage|${t} damage`));
    });
  });

  it('start-of-turn damage types are rules damage types', () => {
    const types = Object.entries(CONDITION_RULES)
      .filter(([, r]) => r.startDamage)
      .map(([n, r]) => [n, r.startDamage!.type] as const);
    expect(types.filter(([, t]) => !MD_DAMAGE_TYPES.includes(t))).toEqual([]);
  });

  it('the rules list fourteen damage types', () => {
    expect(MD_DAMAGE_TYPES).toHaveLength(14);
    expect(new Set(MD_DAMAGE_TYPES).size).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// 8. Equipment
// ---------------------------------------------------------------------------

const MD_WEAPONS = (() => {
  const out: { name: string; group: string; cells: string[] }[] = [];
  const ws = md(['Equipment', 'Weapons']);
  const tables = ws.children.filter((c) => /^Weapons Tables?\b/.test(c.title));
  expect(tables.length).toBe(2);
  for (const node of tables) {
    let group = '';
    for (const r of mdTables(node)[0].rows) {
      if (r.slice(1).every((c) => !c)) group = r[0];
      else out.push({ name: r[0], group, cells: r });
    }
  }
  return out;
})();

describe('equipment vs the markdown', () => {
  it('weapons are exactly the rows of the weapons tables', () => {
    expect(MD_WEAPONS.length).toBeGreaterThan(40);
    expect(weapons.map((w) => `${w.group}: ${w.name}`)).toEqual(MD_WEAPONS.map((w) => `${w.group}: ${w.name}`));
    expect(new Set(weapons.map((w) => w.name.toLowerCase())).size).toBe(weapons.length);
  });

  it.each(sample(MD_WEAPONS, 8).map((w) => [w.name, w] as const))('%s parses like the table row', (name, w) => {
    const weapon = weapons.find((x) => x.name === name)!;
    const [, dv, deadly, damage, req, props] = w.cells;
    expect(weapon).toMatchObject({ dv, deadlyDv: deadly, damage, requirements: req === '—' ? '' : req });
    expect(weapon.properties).toEqual(props === '—' ? [] : splitTopLevel(props));
    expect(weapon.dv).toMatch(/^\d+( \(\d+\))?$/);
    expect(weapon.deadlyDv).toMatch(/^(\d+( \(\d+\))?|Mod Die( \(\+\d+\))?)$/);
    for (const t of weapon.damage.split('/')) expect(MD_PHYSICAL).toContain(t);
    expect(weapon.requirements).toMatch(/^((VIG|AGI|PER|INT|PRS) \d+(, (VIG|AGI|PER|INT|PRS) \d+)*)?$/);
    for (const p of weapon.properties) expect(weaponPropertyNode(p), p).toBeDefined();
  });

  it('weapon properties are the rules sections, and every one is used by some weapon', () => {
    expect(weaponProperties.map((p) => p.title)).toEqual(md(['Equipment', 'Weapons', 'Weapon Properties']).children.map((c) => c.title));
    const used = new Set(weapons.flatMap((w) => w.properties.map((p) => weaponPropertyNode(p)?.id)));
    expect(weaponProperties.filter((p) => !used.has(p.id)).map((p) => p.title)).toEqual([]);
    expect(weaponPropertyNode('Drawn(3-5 {AP})')?.title).toBe('Drawn (X - Y)');
    expect(weaponPropertyNode('two-HANDED')?.title).toBe('Two-handed');
    expect(weaponPropertyNode('Nonexistent')).toBeUndefined();
  });

  it('weapon properties named in class data are real properties', () => {
    const props: string[] = [];
    for (const c of classes) for (const ch of c.choices ?? []) for (const o of ch.options) for (const e of o.effects ?? []) if (e.kind === 'weapon' && e.property) props.push(e.property);
    expect(props.length).toBeGreaterThan(3);
    for (const p of props) expect(weaponPropertyNode(p), p).toBeDefined();
  });

  it('armor AC values match the Armor AC Values table and are numbers', () => {
    const t = mdTables(md(['Equipment', 'Armor', 'Armor Quality', 'Armor AC Values']))[0];
    expect(armorQualities).toEqual(t.rows.map((r) => ({ quality: r[0], ac: { Light: Number(r[1]), Medium: Number(r[2]), Heavy: Number(r[3]) } })));
    for (const q of armorQualities) for (const v of Object.values(q.ac)) expect(Number.isInteger(v)).toBe(true);
    // Better quality never lowers AC; heavier armor never lowers AC.
    for (let i = 1; i < armorQualities.length; i++) for (const k of ['Light', 'Medium', 'Heavy'] as const) expect(armorQualities[i].ac[k]).toBeGreaterThan(armorQualities[i - 1].ac[k]);
    for (const q of armorQualities) expect(q.ac.Light < q.ac.Medium && q.ac.Medium < q.ac.Heavy).toBe(true);
  });

  it('armor VIG requirements match the rules table', () => {
    const t = mdTables(md(['Equipment', 'Armor', 'Armor Requirements']))[0];
    expect(armorRequirements).toEqual(Object.fromEntries(t.rows.map((r) => [r[0], Number(r[1].replace('VIG ', ''))])));
  });

  const svRows = mdTables(md(['Equipment', 'Armor', 'Slashing Vulnerability', 'Unarmored Slashing Vulnerability']))[0].rows;
  it.each(svRows.map((r) => [Number(r[0]), r[1]] as const))('Slashing Vulnerability at Vitality Maximum %i is %s', (v, die) => {
    expect(slashingVulnerability(v)).toBe(die);
  });

  it('Slashing Vulnerability beyond the table: none above the top row, the 1 row for 0 or less', () => {
    const top = Math.max(...svRows.map((r) => Number(r[0])));
    expect(slashingVulnerability(top + 1)).toBe('');
    expect(slashingVulnerability(100)).toBe('');
    expect(slashingVulnerability(0)).toBe(svRows[0][1]);
    expect(slashingVulnerability(-3)).toBe(svRows[0][1]);
    expect(slashingVulnerability(2.5)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 9. Personal alignment
// ---------------------------------------------------------------------------

describe('personal alignment', () => {
  const t = mdTables(md(['Player Characters', 'Character Creation', 'Alignment', 'I Respond to New...']))[0];
  it('the rules table has all 8 answer combinations exactly once', () => {
    const combos = t.rows.map((r) => r.slice(0, 3).join('/'));
    expect(new Set(combos).size).toBe(8);
    for (const s of ['Action', 'Patience']) for (const p of ['Reason', 'Instinct']) for (const q of ['Apathy', 'Empathy']) expect(combos).toContain(`${s}/${p}/${q}`);
  });

  it.each(t.rows.map((r) => [r[0], r[1], r[2], r[3]] as const))('%s / %s / %s -> %s', (s, p, q, light) => {
    expect(personalAlignment(s, p, q)).toBe(light);
    expect([...LIGHTS, 'Any Light']).toContain(light);
  });

  it('unknown answers give no Alignment', () => {
    expect(personalAlignment('Action', 'Reason', 'Indifference')).toBeUndefined();
    expect(personalAlignment('', '', '')).toBeUndefined();
    expect(personalAlignment('action', 'reason', 'apathy')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 10. Spells and maneuvers
// ---------------------------------------------------------------------------

interface MdCastable {
  kind: 'spell' | 'maneuver';
  name: string;
  type: string;
  group?: string;
  subtitle: string;
  fields: Record<string, string>;
  inClass: boolean;
}
const MD_CASTABLES: MdCastable[] = (() => {
  const out: MdCastable[] = [];
  for (const g of ['Arcana', 'Evocations'])
    for (const t of md(['Spells', g]).children)
      for (const s of t.children) {
        const sub = mdSubtitle(s);
        if (sub && /Cantrip|Mantra|Arcanum|Evocation/.test(sub)) out.push({ kind: 'spell', name: s.title.replace(/\s*\[.*\]$/, ''), type: t.title, group: g, subtitle: sub, fields: mdFields(s), inClass: false });
      }
  for (const t of md(['Maneuvers']).children)
    for (const m of t.children) {
      const sub = mdSubtitle(m);
      if (sub?.includes('Maneuver')) out.push({ kind: 'maneuver', name: m.title, type: t.title, subtitle: sub, fields: mdFields(m), inClass: false });
    }
  mdWalk(md(['Classes']), (n) => {
    const sub = mdSubtitle(n);
    if (!sub) return;
    const type = sub.split(' ')[0];
    if (sub.includes('Maneuver')) out.push({ kind: 'maneuver', name: n.title, type, subtitle: sub, fields: mdFields(n), inClass: true });
    else if (/Cantrip|Mantra|Arcanum|Evocation/.test(sub))
      out.push({ kind: 'spell', name: n.title.replace(/\s*\[.*\]$/, ''), type, group: ARCANA_TYPES.includes(type) ? 'Arcana' : 'Evocations', subtitle: sub, fields: mdFields(n), inClass: true });
  });
  return out;
})();
const castKey = (c: { kind: string; type: string; name: string }) => `${c.kind}|${c.type}|${c.name}`;
const ALL_CASTABLES: Castable[] = [...spells, ...maneuvers];
const castableByKey = new Map(ALL_CASTABLES.map((c) => [castKey(c), c]));
/** Rules typos the app inherits; each has an it.fails below. */
const KNOWN_BUGS: Record<string, string> = {};

describe('spells and maneuvers vs the markdown', () => {
  it('content has exactly the spells and maneuvers written in the rules', () => {
    expect(sortStr(ALL_CASTABLES.map(castKey))).toEqual(sortStr(MD_CASTABLES.map(castKey)));
    expect(spells.length).toBeGreaterThan(80);
    expect(maneuvers.length).toBeGreaterThan(20);
  });

  it('ids and keys are unique and getCastable finds every one', () => {
    const ids = ALL_CASTABLES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(castableByKey.size).toBe(ALL_CASTABLES.length);
    for (const c of ALL_CASTABLES) expect(getCastable(c.id)).toBe(c);
    expect(getCastable('spells')).toBeUndefined();
  });

  it('only castables written inside a class description have a source (the class)', () => {
    for (const m of MD_CASTABLES) {
      const c = castableByKey.get(castKey(m))!;
      expect(!!c.source, c.id).toBe(m.inClass);
      // The source is the title of the class section it is written in (a class, or a subclass list such as "Primordial Souls").
      if (c.source) expect(c.source, c.id).toBe(getNode(c.id.split('/').slice(0, 2).join('/'))!.title);
    }
  });

  it('every general spell/maneuver type has some entries; types are the known lists', () => {
    for (const t of ARCANA_TYPES) expect(spells.some((s) => s.group === 'Arcana' && s.type === t && !s.source), t).toBe(true);
    for (const t of EVOCATION_TYPES) expect(spells.some((s) => s.group === 'Evocations' && s.type === t && !s.source), t).toBe(true);
    for (const t of MANEUVER_TYPES) expect(maneuvers.some((s) => s.type === t && !s.source), t).toBe(true);
    expect(md(['Spells', 'Arcana']).children.map((c) => c.title)).toEqual(ARCANA_TYPES);
    expect(md(['Spells', 'Evocations']).children.map((c) => c.title)).toEqual(EVOCATION_TYPES);
    expect(md(['Maneuvers']).children.map((c) => c.title)).toEqual(MANEUVER_TYPES);
  });

  const cases = sample(MD_CASTABLES, 12);
  for (const m of cases) {
    const key = castKey(m);
    const bug = KNOWN_BUGS[key];
    describe(`${m.kind} ${m.name} (${m.type})`, () => {
      const c = () => castableByKey.get(key)!;

      it('kind, group, tier and level come from its type line', () => {
        const cs = c();
        expect(cs.kind).toBe(m.kind);
        expect(cs.subtitle).toBe(m.subtitle);
        const lv = m.subtitle.match(/(\d+)(st|nd|rd|th)-level/);
        expect(cs.level).toBe(lv ? Number(lv[1]) : 0);
        expect(cs.level).toBeGreaterThanOrEqual(0);
        expect(cs.level).toBeLessThanOrEqual(10);
        if (cs.kind === 'spell') {
          expect(cs.group).toBe(m.group);
          expect(m.subtitle).toContain(cs.tier);
          // Cantrips and mantras have no level; arcana and evocations do.
          expect(cs.level === 0).toBe(cs.tier === 'Cantrip' || cs.tier === 'Mantra');
          expect(cs.tier === 'Cantrip' || cs.tier === 'Arcanum').toBe(cs.group === 'Arcana');
          // "Evocation (type varies)" (Smite) is the only spell without a fixed type.
          if (cs.type !== 'Evocation') expect(cs.group === 'Arcana' ? ARCANA_TYPES : EVOCATION_TYPES).toContain(cs.type);
          else expect(m.subtitle).toMatch(/type varies/);
        } else {
          expect(MANEUVER_TYPES).toContain(cs.type);
          expect(cs.level).toBeGreaterThanOrEqual(1);
        }
      });

      it('fields are the ones written in the rules', () => {
        expect(c().fields).toEqual(m.fields);
      });

      (bug ? it.fails : it)(bug ?? 'Cast/Execution Time is written and parses to an AP cost', () => {
        const cs = c();
        const timeKey = cs.kind === 'spell' ? 'Cast Time' : 'Execution Time';
        const time = cs.fields[timeKey];
        expect(time, `${timeKey} missing`).toBeDefined();
        const cost = parseCost(time);
        const fixed = time.match(/^(?:Reaction, )?(\d+) \{AP\}$/);
        const range = time.match(/^(\d+) ?- ?(\d+) \{AP\}$/);
        if (fixed) expect(cost.ap).toBe(Number(fixed[1]));
        else if (range) expect(cost.ap).toEqual({ min: Number(range[1]), max: Number(range[2]) });
        else expect(['Strike', '1 minute', 'Varies', 'Varies, minimum 1 minute', 'Reaction, {AP} Varies']).toContain(time);
        if (isVariable(cost)) expect(cost.ap.min <= cost.ap.max && cost.ap.max <= 5).toBe(true);
        else expect(cost.ap).toBeLessThanOrEqual(5);
        expect(cost.reaction).toBe(/Reaction/.test(time));
        // Reaction spells and maneuvers list their trigger.
        expect(!!cs.fields.Trigger).toBe(cost.reaction);
      });

      it('Exalted entries parse and apply above the base level', () => {
        const cs = c();
        for (const k of Object.keys(cs.fields).filter((k) => /^Exalted/.test(k))) {
          const st = exaltedState(k, cs.level, cs.level);
          expect(st, k).toBeDefined();
          if (st!.kind === 'at') {
            expect(st!.level, k).toBeGreaterThan(cs.level);
            expect(st!.active).toBe(false);
            expect(exaltedState(k, cs.level, st!.level)).toMatchObject({ active: true });
          } else {
            expect(st!.every).toBeGreaterThanOrEqual(1);
            expect(st!.times).toBe(0);
          }
        }
        if (cs.level === 0) expect(Object.keys(cs.fields).some((k) => /^Exalted \(\d/.test(k))).toBe(false);
      });

      it('level scaling resolves every {SL} to a number', () => {
        const cs = c();
        for (const lv of [Math.max(1, cs.level), 5, 10]) {
          for (const v of Object.values(cs.fields)) {
            const s = scaleText(v, { level: lv, charLevel: 2 });
            expect(s).not.toMatch(/\{SL\}|NaN|undefined/);
          }
        }
      });
    });
  }

  it('"half {SL}, rounded down" is resolved rounded down', () => {
    // Rules (Intimidate's Frighten / Frightening Strike options, shown with the maneuver):
    // "Panicked half {SL}, rounded down." At SL 5 that is Panicked 2, not 3.
    const subs = allNodes().filter((n) => Object.values(n.fields ?? {}).some((v) => /half \{SL\}, rounded down/.test(v)));
    expect(subs.map((n) => n.id)).toEqual(['maneuvers/psychological/intimidate/frighten', 'maneuvers/psychological/intimidate/frightening-strike']);
    expect(getCastable(getParent(subs[0].id)!.id)?.name).toBe('Intimidate');
    for (const n of subs) {
      expect(scaleText(n.fields!.Failure, { level: 5, charLevel: 1 }), n.id).toMatch(/Panicked 2, rounded down/);
      expect(resolveHtml(n.html!, { level: 5, charLevel: 1 }).replace(/<[^>]+>/g, ''), n.id).toMatch(/Panicked 2, rounded down/);
    }
  });

  it('every castable has its Cast/Execution Time', () => {
    const missing = ALL_CASTABLES.filter((c) => !c.fields[c.kind === 'spell' ? 'Cast Time' : 'Execution Time']).map(castKey);
    expect(missing).toEqual(Object.keys(KNOWN_BUGS));
  });

  it('scaling arithmetic on rules expressions', () => {
    expect(scaleText('6{SL} plus 3 Arctic damage', { level: 2, charLevel: 1 })).toBe('15 Arctic damage');
    // "always round up in BtP"
    expect(scaleText('half {SL}', { level: 5, charLevel: 1 })).toBe('3');
    expect(scaleText('{SL} plus 4 minus 2', { level: 3, charLevel: 1 })).toBe('5');
    expect(scaleText('your level of skill; your level', { level: 3, charLevel: 7 })).toBe('your level of skill; 7');
  });
});

// ---------------------------------------------------------------------------
// 11. Actions and Cost lines
// ---------------------------------------------------------------------------

describe('actions vs the markdown', () => {
  const mdActions = md(['Beyond the Prism', 'Action List']).children.flatMap((cat) =>
    cat.children.map((a) => ({ category: cat.title.replace(/ Actions$/, ''), name: a.title, fields: mdFields(a) })),
  );

  it('basic actions are the rules Action List, with their categories', () => {
    expect(basicActions.map((a) => `${a.category}: ${a.name}`)).toEqual(mdActions.map((a) => `${a.category}: ${a.name}`));
    expect(new Set(basicActions.map((a) => a.category))).toEqual(new Set(['Basic', 'Arcane', 'Combat', 'Supernatural']));
    // Class action categories are real categories.
    for (const c of classes) for (const a of c.actions) expect(['Arcane', 'Combat', 'Supernatural']).toContain(a);
  });

  it.each(basicActions.map((a) => [a.category, a.name, a] as const))('%s: %s has its rules Cost, which parses', (_c, name, a) => {
    const m = mdActions.find((x) => x.name === name)!;
    expect(a.fields).toEqual(m.fields);
    const text = a.fields.Cost;
    expect(text, 'Cost').toBeDefined();
    const cost = parseCost(text);
    const n = text.match(/^(?:Reaction, )?(\d+) \{AP\}/);
    if (n) expect(cost.ap).toBe(Number(n[1]));
    else expect(text).toMatch(/^Varies/), expect(cost.ap).toEqual({ min: 1, max: 5 });
    expect(cost.reaction).toBe(/Reaction/.test(text));
    expect(cost.cap).toBe(/Basic CAP/.test(text));
  });

  const costLines = MD_LINES.map((l) => l.match(/^\s*\*\*Cost\*\*\s*::\s*(.*)$/)?.[1]).filter((x): x is string => x !== undefined).map(clean);
  it('every Cost line in the rules parses to an AP cost within 0–5 and the resources it names', () => {
    expect(costLines.length).toBeGreaterThan(50);
    for (const text of costLines) {
      const cost = parseCost(text);
      const ap: number[] = isVariable(cost) ? [cost.ap.min, cost.ap.max] : [cost.ap as number];
      for (const v of ap) expect(v >= 0 && v <= 5, text).toBe(true);
      const fixed = text.match(/(?:^|, )(\d+) \{AP\}/);
      if (fixed && !/\d+\s*(-|–|to)\s*\d+\s*\{AP\}/.test(text)) expect(cost.ap, text).toBe(Number(fixed[1]));
      for (const m of text.matchAll(/(\d+) (Prisma|Radiance|Favor|Will|Stamina|Light|Wonder|Vitality)\b/g)) expect(cost.resources, text).toContainEqual({ name: m[2], amount: Number(m[1]) });
      expect(cost.reaction).toBe(/Reaction/i.test(text));
    }
  });

  it('casting Actions (“{AP} in spell’s Cast Time”) cost no fixed AP of their own', () => {
    const casting = costLines.filter((t) => /\{AP\} in (the )?spells?[’']?s? Cast Time/i.test(t));
    expect(casting.length).toBeGreaterThanOrEqual(5);
    for (const t of casting) expect(parseCost(t).ap, t).toBe(0);
  });

  it('parseCost edge cases', () => {
    expect(parseCost(undefined)).toEqual({ ap: 0, reaction: false, cap: false, resources: [] });
    expect(parseCost('1 Prisma, 2 {AP}')).toEqual({ ap: 2, reaction: false, cap: false, resources: [{ name: 'Prisma', amount: 1 }] });
    expect(parseCost('1 – 3 {AP}').ap).toEqual({ min: 1, max: 3 });
    expect(parseCost('<b>2</b> {AP}').ap).toBe(2);
  });
});

if (QA) {
  // QA mode samples the big lists above; make sure the sample is not empty.
  describe('QA sampling', () => {
    it('samples every big list', () => {
      expect(sample(MD_CASTABLES, 12).length).toBeGreaterThan(5);
      expect(sample(MD_WEAPONS, 8).length).toBeGreaterThan(5);
    });
  });
}
