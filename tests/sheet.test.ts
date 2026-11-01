// The fillable PDF character sheet: the templates in src/assets/sheets (built by
// scripts/character-sheet/build.py), their field list, and the export that fills
// them in. Expected numbers come from the rules (Vitality, Radiance) and from the
// character itself, not from the export code.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFTextField } from 'pdf-lib';
import { basicActions, conditions } from '../src/content';
import { classes } from '../src/data/classes';
import { ancestries } from '../src/data/ancestries';
import { subclassesOf } from '../src/engine/classInfo';
import { derive } from '../src/engine/derive';
import { sheetValues, unfilled, wrapLines } from '../src/engine/sheetExport';
import { fillSheet } from '../src/engine/sheetPdf';
import { makeCharacter, sample } from './helpers';

const DIR = 'src/assets/sheets';
const VERSIONS = { dark: 'screen', light: 'screen', printable: 'printable' } as const;
type Field = { name: string; type: string; page: number; label: string; versions: string[] };
const fieldList: Field[] = JSON.parse(readFileSync(`${DIR}/fields.json`, 'utf8'));
const template = (v: keyof typeof VERSIONS) => readFileSync(`${DIR}/character-sheet-${v}.pdf`);

const character = (classId: string, subclass: string, ancestry: string) =>
  makeCharacter({
    name: 'Seren Vale',
    player: 'Arch',
    classId,
    subclass,
    level: 2,
    ancestry,
    attributes: { method: 'manual', pool: 12, base: { VIG: 3, AGI: 3, PER: 2, INT: 2, PRS: 2 }, bonus: [] },
    details: { age: '27', devotion: 'Lunar', appearance: 'Tall.', backstory: 'Long ago…', notes: '' },
    experiences: [{ id: 'e', name: 'Monster Slayer', uses: 1, used: 0, effect: 'Advantage on an Attack Check against a Large creature.' }],
    equipment: {
      armor: { type: 'Light', quality: 'Basic' },
      weapons: [{ id: 'w', name: 'Longsword' }],
      inventory: [
        { id: 'r', name: 'Rope', qty: 1, bulk: 2, notes: '50 ft' },
        { id: 'b', name: 'Backpack', qty: 1, bulk: 1, container: true },
        { id: 't', name: 'Tent', qty: 1, bulk: 3, storedIn: 'b' },
      ],
    },
    sessions: [{ id: 's', title: 'The old well', date: '2026-10-30', body: 'Met the Drytaur.' }],
    play: { conditions: [{ name: 'Bleeding', level: 2 }, { name: 'Prone' }], ap: 3, shortRests: 1 },
  });

describe('sheet templates', () => {
  for (const v of Object.keys(VERSIONS) as (keyof typeof VERSIONS)[]) {
    it(`${v}: the PDF's fields are the ones fields.json lists for it`, async () => {
      const doc = await PDFDocument.load(template(v));
      const inPdf = doc.getForm().getFields().map((f) => f.getName()).sort();
      const listed = fieldList.filter((f) => f.versions.includes(VERSIONS[v])).map((f) => f.name).sort();
      expect(inPdf).toEqual(listed);
      expect(doc.getPageCount()).toBe(6);
      // US Letter.
      expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    });
  }

  it('the Conditions checklist matches the rules', () => {
    // Re-run `npm run build-sheets` after `npm run parse-rules` when this fails.
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const onSheet = fieldList.filter((f) => /^cond_[a-z_]+$/.test(f.name) && !f.name.endsWith('_level')).map((f) => f.name);
    expect(onSheet.sort()).toEqual(conditions.map((c) => `cond_${slug(c.name)}`).sort());
    for (const c of conditions) expect(fieldList.some((f) => f.name === `cond_${slug(c.name)}_level`)).toBe(c.leveled);
    // The Basic actions are printed from the rules: the list the sheet was built from still exists.
    expect(basicActions.filter((a) => a.category === 'Basic').length).toBeGreaterThan(10);
  });
});

describe('sheet values', () => {
  const cls = classes.find((c) => c.id === 'arcanist')!;
  const c = character(cls.id, subclassesOf(cls)[0]?.id ?? '', ancestries[0].id);
  const d = derive(c);
  const v = sheetValues(c, d);

  it('fills the header, stats and play state from the character', () => {
    expect(v.name).toBe('Seren Vale');
    expect(v.p6_name).toBe('Seren Vale');
    expect(v.player).toBe('Arch');
    expect(v.class).toBe('Arcanist');
    expect(v.age).toBe('27');
    expect(v.devotion).toBe('Lunar');
    expect(v.VIG_points).toBe('3');
    expect(v.ap).toBe('3');
    // Vitality Maximum is 3 + half your VIG points, rounded down (rules: Endurance and Vitality).
    expect(v.vitality_max).toBe('4');
    expect(v.vitality).toBe('4');
    expect([1, 2, 3, 4].map((i) => v[`vitality_${i}`])).toEqual([true, true, true, true]);
    expect(v.vitality_5).toBe(false);
    expect(v.short_rest_1).toBe(true);
    expect(v.short_rest_2).toBe(false);
  });

  it('fills conditions, weapons, experiences, inventory and notes', () => {
    expect(v.cond_bleeding).toBe(true);
    expect(v.cond_bleeding_level).toBe('2');
    expect(v.cond_prone).toBe(true);
    expect(v.cond_blinded).toBe(false);
    expect(v.weapon_1_name).toBe('Longsword');
    expect(v.experience_1_name).toBe('Monster Slayer');
    expect(v.experience_1_uses).toBe('1');
    expect(v.ac_armor).toBe('Basic Light');
    // Rope is Bulk 2: it takes a Bulk 2 slot of your own pyramid.
    expect(v.inv_2_1).toBe('Rope');
    expect(Object.entries(v).filter(([k, x]) => k.startsWith('item_') && k.endsWith('_name')).map(([, x]) => x)).toEqual(['Rope', 'Backpack']);
    // The Tent is in the Backpack: on the container sheet, in its Bulk 3 row.
    expect(v.container_name).toBe('Backpack');
    expect(v.container_inv_3_1).toBe('Tent');
    expect(v.container_item_1_name).toBe('Tent');
    expect(v.session_notes_1).toBe('2026-10-30 · The old well');
    expect(v.session_notes_2).toBe('Met the Drytaur.');
  });

  it('every value has a field on the screen and printable sheets', () => {
    for (const version of ['screen', 'printable']) {
      const names = new Set(fieldList.filter((f) => f.versions.includes(version)).map((f) => f.name));
      expect(unfilled(v, (n) => names.has(n)), version).toEqual([]);
    }
  });

  it('reports rows that do not fit', () => {
    const many = { ...c, equipment: { ...c.equipment, inventory: Array.from({ length: 45 }, (_, i) => ({ id: `i${i}`, name: `Thing ${i}`, qty: 1 })) } };
    const names = new Set(fieldList.map((f) => f.name));
    const rows = fieldList.filter((f) => /^item_\d+_name$/.test(f.name)).length;
    expect(unfilled(sheetValues(many, derive(many)), (n) => names.has(n))).toEqual([`${45 - rows} items`]);
  });

  it.each(sample(classes.flatMap((k) => subclassesOf(k).map((s) => [k.id, s.id])), 6))('%s %s: values fit the sheet', (k, s) => {
    const ch = character(k, s, ancestries[0].id);
    const names = new Set(fieldList.map((f) => f.name));
    expect(unfilled(sheetValues(ch, derive(ch)), (n) => names.has(n))).toEqual([]);
  });

  it('wraps long note lines at spaces', () => {
    const lines = wrapLines(`${'word '.repeat(60)}\nnext`, 40);
    expect(lines.every((l) => l.length <= 40)).toBe(true);
    expect(lines.at(-1)).toBe('next');
  });
});

describe('filling the PDF', () => {
  it.each(['dark', 'light', 'printable'] as const)('%s: the saved PDF holds the values', async (version) => {
    const cls = classes[0];
    const c = character(cls.id, subclassesOf(cls)[0]?.id ?? '', ancestries[0].id);
    const out = await fillSheet(template(version), sheetValues(c, derive(c)), 'Seren Vale');
    expect(out.unfilled).toEqual([]);
    const form = (await PDFDocument.load(out.bytes)).getForm();
    expect((form.getField('name') as PDFTextField).getText()).toBe('Seren Vale');
    expect((form.getField('cond_bleeding') as PDFCheckBox).isChecked()).toBe(true);
    expect((form.getField('cond_blinded') as PDFCheckBox).isChecked()).toBe(false);
    if (version === 'printable') expect((form.getField('vitality_4') as PDFCheckBox).isChecked()).toBe(true);
    else expect((form.getField('ap') as PDFDropdown).getSelected()).toEqual(['3']);
  });
});
