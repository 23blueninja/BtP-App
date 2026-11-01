// The fillable PDF character sheet (src/assets/sheets, built by scripts/character-sheet):
// the value of each of its fields for a character. Pure, like derive(); the UI
// (src/ui/ExportPdf.tsx) writes these into the PDF. Field names are listed in
// src/assets/sheets/fields.json.
import { basicActions, conditions as conditionDefs, getCastable, getNode, tokensToText, type Castable, type RuleNode } from '../content';
import { ancestryById, ancestryName } from '../data/ancestries';
import { backgroundById } from '../data/backgrounds';
import { ATTRS, RANK_DIE } from '../data/types';
import type { Character } from './character';
import { AP_MAX } from './conditions';
import type { Derived } from './derive';
import { groupInventory, layoutBulk, layoutContainer, type BulkRow } from './inventory';

/** Text fields take strings; checkboxes take true (ticked) or false. */
export type SheetValues = Record<string, string | boolean>;

/**
 * Every row is given a value; rows past the end of a table on the sheet have no field, and
 * the exporter reports them as not fitting (see unfilled()). Bubbles: the printable sheet's.
 */
const ALL = 200;
const BUBBLES = 8;
/** Characters per Session Notes line, so text breaks at a word instead of running off the line. */
const NOTE_LINE = 110;

const LEVELS = ['None', 'Weak', 'Firm', 'Strong'];
const plain = (s: string) => tokensToText(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Actions defined inside the character's facets (e.g. Refract, Reignite). */
export function facetActions(d: Derived): RuleNode[] {
  const out: RuleNode[] = [];
  const walk = (n: RuleNode) => {
    if (n.fields?.Categories && n.fields?.Cost) out.push(n);
    n.children?.forEach(walk);
  };
  for (const f of d.facets) {
    const n = f.contentId && !f.item ? getNode(f.contentId) : undefined;
    if (n) walk(n);
  }
  return out;
}

/** Splits text into lines of at most `width` characters, breaking at spaces. */
export function wrapLines(text: string, width = NOTE_LINE): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = '';
      }
      line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

function pyramid(v: SheetValues, prefix: string, rows: BulkRow[], bonus: boolean) {
  for (const r of rows) {
    r.slots
      .filter((s) => s.bonus === bonus)
      .forEach((s, i) => {
        if (s.item) v[`${prefix}_${r.rank}_${i + 1}`] = s.item.name;
      });
  }
}

function castableRow(cs: Castable): Record<string, string> {
  const f = cs.fields;
  const tier = cs.kind === 'spell' ? cs.tier : 'Maneuver';
  return {
    name: cs.name,
    level: cs.level ? String(cs.level) : cs.kind === 'spell' && cs.tier === 'Cantrip' ? 'C' : '',
    cast_time: plain(f['Cast Time'] ?? f['Execution Time'] ?? ''),
    range: plain(f.Range ?? ''),
    duration: plain(f.Duration ?? ''),
    components: plain(f.Components ?? ''),
    notes: `${cs.type} ${tier}`,
  };
}

export function sheetValues(c: Character, d: Derived): SheetValues {
  const v: SheetValues = {};
  const p = c.play;
  const set = (k: string, x: string | number | undefined) => {
    if (x !== undefined && x !== '') v[k] = String(x);
  };
  const rows = <T>(prefix: string, items: T[], max: number, fill: (x: T) => Record<string, string | boolean | undefined>) =>
    items.slice(0, max).forEach((x, i) => {
      for (const [k, val] of Object.entries(fill(x))) if (val !== undefined && val !== '') v[`${prefix}_${i + 1}_${k}`] = val;
    });
  // Bubbles (printable) and a dropdown with its maximum (on screen).
  const tracked = (name: string, bubbles: string, current: number, max?: number) => {
    set(name, current);
    if (max !== undefined) set(`${name}_max`, max);
    for (let i = 1; i <= BUBBLES; i++) v[`${bubbles}_${i}`] = i <= current;
  };

  // ---- Page 1: Sheet ----
  set('name', c.name);
  for (const n of [2, 3, 4, 5, 6]) set(`p${n}_name`, c.name);
  set('player', c.player);
  set('level', d.level);
  set('background', backgroundById.get(c.background.preset)?.name ?? (c.background.heritage ? 'Custom' : ''));
  const sub = ancestryById.get(c.ancestry)?.subAncestries?.find((s) => s.id === c.subAncestry);
  set('ancestry', ancestryName(c) + (sub ? ` (${sub.name})` : ''));
  set('class', d.cls?.name);
  set('subclass', d.subclassName);
  set('age', c.details.age);
  set('devotion', c.details.devotion);

  set('class_bonus', d.classBonus);
  set('class_die', d.classDie);
  set('class_die_name', d.classDieName.replace(/\s*Die$/, ''));
  for (const a of ATTRS) {
    set(`${a}_die`, d.attrs[a].label);
    set(`${a}_points`, d.attrs[a].points);
    const save = d.saves.find((s) => s.attr === a);
    if (save) {
      set(`${a}_save`, save.label);
      set(`${a}_save_notes`, plain(save.notes.join(', ')));
    }
  }
  set('ap', p.ap ?? AP_MAX);
  set('ap_temp', p.tempAp ?? 0);

  set('initiative', d.initiative);
  set('ac', d.ac.value);
  const armor = c.equipment.armor;
  set('ac_armor', armor ? `${armor.quality} ${armor.type}` : 'Unarmored');
  set('movement', d.movement);
  set('perception_radius', d.radius);
  set('endurance', p.endurance);
  set('endurance_max', d.enduranceMax);
  set('endurance_temp', p.tempEndurance);
  tracked('vitality', 'vitality', p.vitality, d.vitalityMax);
  set('dying', p.dying);
  tracked('radiance', 'radiance', d.radianceMax - p.radianceSpent, d.radianceMax);
  set('respond_situations', c.alignment.situations);
  set('respond_problems', c.alignment.problems);
  set('respond_people', c.alignment.people);

  rows('weapon', d.weapons, ALL, (w) => ({
    name: w.base ? `${w.name} (${w.base})` : w.name,
    mod: w.fixedDie ?? (w.dice.length ? w.dice.map((o) => o.dice).join(' or ') : '—'),
    dv: `${w.dv} / ${w.deadlyDv}`,
    damage: w.damage,
    properties: plain(w.properties.join(', ')),
  }));

  const skill = (s: Derived['skillSlots'][number]) => ({ name: s.name, die: RANK_DIE[s.rank], rank: s.rank });
  rows('profession', d.skillSlots.filter((s) => s.kind === 'profession'), ALL, skill);
  // Hobbies fill the rest of the column; the PDF drops rows it doesn't have.
  rows('hobby', d.skillSlots.filter((s) => s.kind === 'hobby'), ALL, skill);

  tracked('rest_charges', 'rest_charge', d.restCharges - p.restChargesSpent, d.restCharges);
  v.short_rest_1 = p.shortRests >= 1;
  v.short_rest_2 = p.shortRests >= 2;

  rows('experience', c.experiences, ALL, (e) => ({ name: e.name, uses: String(Math.max(0, e.uses - e.used)), effect: e.effect }));

  for (const cd of conditionDefs) {
    const key = `cond_${slug(cd.name)}`;
    const on = p.conditions.find((x) => x.name === cd.name);
    v[key] = !!on;
    if (on && cd.leveled && on.level) set(`${key}_level`, on.level);
  }

  set('resistances', d.resistances.map((r) => `${r.type} ${r.value}`).join(', '));
  set('immunities', [...d.damageImmunities.map((x) => `${x.type} damage`), ...d.conditionImmunities.map((x) => `${x.name} (Condition)`)].join(', '));
  set('vulnerabilities', d.vulnerabilities.map((x) => `${x.type} ${x.dice} (${x.source})`).join(', '));
  set('movement_other', d.movementTypes.map((m) => `${m.type} ${m.value}`).join(', '));
  set('jump_long', d.jump.long);
  set('jump_high', d.jump.high);
  set('senses', d.senses.join(', '));
  rows('alignment', d.alignmentRanked, ALL, (a) => ({ light: a.light, level: LEVELS[a.level] }));

  // ---- Page 2: Facets & Actions ----
  set('training_armor', d.armorTraining);
  set('training_weapons', d.weaponTraining);
  set('training_saves', d.saveTraining && plain(d.saveTraining));
  set('maneuver_attr', d.maneuverModDie);
  set('spell_attr', d.spellModDie);
  set('action_categories', d.actionCategories.join(', '));
  const actions = [
    ...facetActions(d).map((n) => ({ name: n.title, cost: plain(n.fields?.Cost ?? ''), categories: n.fields?.Categories ?? '', notes: '' })),
    // Category actions (Arcane, Combat, Supernatural); the Basic ones are printed on the sheet.
    ...basicActions
      .filter((a) => a.category !== 'Basic' && d.actionCategories.includes(a.category))
      .map((a) => ({ name: a.name, cost: plain(a.fields.Cost ?? ''), categories: a.fields.Categories ?? '', notes: '' })),
  ];
  rows('action', actions, ALL, (a) => a);

  const facetText: string[] = [];
  for (const source of [...new Set(d.facets.map((f) => f.source))]) {
    const names = d.facets.filter((f) => f.source === source).map((f) => (f.level > 1 ? `${f.name} (level ${f.level})` : f.name));
    facetText.push(`${source}: ${names.join(', ')}`);
  }
  const effects = [
    ...d.bolsters.map(plain),
    ...d.tandems.map(plain),
    ...(p.effects ?? []).map((e) => e.name),
    ...d.homebrew.filter((h) => h.entry.kind !== 'facet').map((h) => h.entry.name),
    ...d.homebrewNotes.map((n) => `${plain(n.text)} (${n.source})`),
  ];
  if (effects.length) facetText.push('', `Active effects: ${effects.join('; ')}`);
  set('facets', facetText.join('\n'));

  // ---- Page 3: Spells & Maneuvers ----
  set('spell_mod_die', d.spellModDie);
  set('maneuver_mod_die', d.maneuverModDie);
  const resources = [
    ...d.resources.map((r) => {
      const used = p.resources[r.name] ?? 0;
      return { name: r.mode === 'pool' ? r.name : `${r.name} (applied)`, value: String(r.mode === 'pool' ? r.max - used : used), max: String(r.max) };
    }),
    ...d.trackers.map((t) => ({ name: t, value: String(p.trackers[t] ?? 0), max: '' })),
  ];
  rows('resource', resources, ALL, (r) => r);
  const spells: (Record<string, string> & { prepared?: string })[] = [];
  const seen = new Set<string>();
  for (const l of d.spellLists.filter((x) => x.def.mode === 'prepared')) {
    for (const id of p.prepared[l.def.id] ?? []) {
      const cs = getCastable(id);
      if (cs && !seen.has(cs.id)) (seen.add(cs.id), spells.push({ ...castableRow(cs), prepared: 'yes' }));
    }
  }
  for (const l of d.spellLists.filter((x) => x.def.mode === 'known')) {
    for (const cs of [...l.granted, ...l.selected]) if (!seen.has(cs.id)) (seen.add(cs.id), spells.push(castableRow(cs)));
  }
  rows('spell', spells, ALL, ({ prepared, ...r }) => ({ ...r, prepared: !!prepared }));

  // ---- Page 4: Equipment ----
  const inv = groupInventory(c.equipment.inventory);
  const mine = layoutBulk(inv.person, d.attrs.VIG.points, d.bulkShift);
  pyramid(v, 'inv', mine.rows, false);
  pyramid(v, 'bonus_inv', mine.rows, true);
  rows('item', inv.person, ALL, (i) => ({
    name: i.name,
    bulk: i.bulk ? String(i.bulk) : '—',
    qty: String(i.qty),
    stored: i.container ? '(container)' : i.inBackpack ? 'Backpack' : '',
    notes: i.notes,
  }));
  if (armor) {
    set('armor_type', armor.type);
    set('armor_quality', armor.quality);
  }
  set('armor_notes', d.armorNotes.map(plain).join(' '));
  set('appearance', c.details.appearance);
  set('backstory', c.details.backstory);

  // ---- Page 5: Session notes, newest last, one field per line ----
  const notes = [...c.sessions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((s, i) => [...(i ? [''] : []), `${s.date}${s.title ? ` · ${s.title}` : ''}`, ...wrapLines(s.body)]);
  notes.forEach((line, i) => set(`session_notes_${i + 1}`, line));

  // ---- Page 6: the first backpack or other container ----
  const box = inv.containers[0];
  if (box) {
    set('container_name', box.item.name);
    set('container_bulk', box.item.bulk);
    set('container_notes', box.item.notes);
    pyramid(v, 'container_inv', layoutContainer(box.contents).rows, false);
    rows('container_item', box.contents, ALL, (i) => ({ name: i.name, bulk: i.bulk ? String(i.bulk) : '—', qty: String(i.qty), notes: i.notes }));
  }
  // Items in the first container say so; ones in others are listed by container.
  for (let i = 0; i < inv.person.length; i++) {
    const it = inv.person[i];
    if (it.container && it.id !== box?.item.id) v[`item_${i + 1}_notes`] = [it.notes, `holds ${inv.containers.find((x) => x.item.id === it.id)?.contents.map((x) => x.name).join(', ') || 'nothing'}`].filter(Boolean).join('; ');
  }
  return v;
}

/** Fields only some versions have: dropdowns on screen, bubbles on paper. */
const ONE_VERSION = /^(ap|vitality|radiance|rest_charges)(_max)?$|^(vitality|radiance|rest_charge)_\d+$/;

const ROW_LABELS: Record<string, string> = {
  weapon: 'weapons', profession: 'Professions', hobby: 'Hobbies', experience: 'Experiences', alignment: 'Alignments', action: 'actions',
  resource: 'resources', spell: 'spells and maneuvers', item: 'items', container_item: 'container items', session_notes: 'lines of Session Notes',
};

/**
 * What didn't fit: values for fields the sheet doesn't have, counted by table
 * (e.g. "2 items"). `has` says whether the PDF has a field.
 */
export function unfilled(values: SheetValues, has: (name: string) => boolean): string[] {
  const counts = new Map<string, Set<string>>();
  for (const [k, val] of Object.entries(values)) {
    if (has(k) || val === false || val === '' || ONE_VERSION.test(k)) continue;
    const m = k.match(/^([a-z_]+?)_(\d+)(?:_|$)/);
    const table = m && ROW_LABELS[m[1]] ? m[1] : k;
    if (!counts.has(table)) counts.set(table, new Set());
    counts.get(table)!.add(m?.[2] ?? k);
  }
  return [...counts].map(([t, rows]) => (ROW_LABELS[t] ? `${rows.size} ${ROW_LABELS[t]}` : t));
}
