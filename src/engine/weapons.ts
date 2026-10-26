// The Weapons box: each weapon's Mod Die options for its Attack Checks, its DV / Deadly DV,
// damage and properties. Unarmed Strikes (your body and natural weapons) come first.
import { weapons } from '../content';
import { ATTR_NAMES, type Attr, type ClassDef, type Effect } from '../data/types';
import type { Character } from './character';
import type { ResolvedHomebrew } from './homebrew';
import type { Stats } from './stat';

/** The weapon-list entry for Unarmed Strikes: your body plus any natural weapons (claws, horns…). */
export const UNARMED = 'Unarmed Strike';

export type WeaponMod = Extract<Effect, { kind: 'weapon' }> & { source: string };

/** One die (or Tandem pair) you can roll as the Mod Die. */
export interface WeaponDieOption {
  attr?: Attr;
  dice: string;
  label: string;
}

export interface WeaponRow {
  /** Unique per row: the weapon entry's id, the homebrew item's id, or `unarmed:<name>`. */
  id: string;
  name: string;
  kind: 'unarmed' | 'weapon' | 'homebrew';
  /** The weapons-table weapon a homebrew item is. */
  base?: string;
  /** The equipment entry removing this row removes (the first Unarmed Strike row stands for all of them). */
  removeId?: string;
  /** Facets an Unarmed Strike row comes from. */
  sources: string[];
  /** Rolled with this die alone (e.g. Ferocious Strikes' Class Die): no choices to explain. */
  fixedDie?: string;
  /** Mod Die choices; empty for a weapon that isn't in the weapons table. */
  dice: WeaponDieOption[];
  /** Combat Style and item effects other than a Tandem die: Bolstered levels and notes. */
  extras: WeaponMod[];
  dv: string;
  deadlyDv: string;
  damage: string;
  properties: string[];
  /** Requirements the character doesn't meet ("VIG 2"), if any. */
  unmet?: string;
}

interface WeaponCtx {
  cls?: ClassDef;
  classDie: string;
  attrs: Record<Attr, { points: number; label: string }>;
  weaponMods: WeaponMod[];
  unarmed: { name: string; dv: number; deadlyDv: number; damage: string; properties: string[]; classDie?: boolean; sources: string[] }[];
  homebrew: ResolvedHomebrew[];
}

/** Mod Die choices for a weapon's Attack Checks, and the effects that apply to it. */
function weaponDice(name: string, props: string[], x: WeaponCtx): { dice: WeaponDieOption[]; extras: WeaponMod[] } {
  const has = (p: string) => props.some((y) => y.toLowerCase().startsWith(p.toLowerCase()));
  const ranged = has('Ranged') || has('Drawn');
  const attrOpt = (a: Attr) => ({ attr: a, dice: x.attrs[a].label, label: `${ATTR_NAMES[a]} Die` });
  let opts: WeaponDieOption[] = [];
  if (ranged) opts.push(attrOpt('PER'));
  else {
    opts.push(attrOpt('VIG'));
    if (has('Deft')) opts.push(attrOpt('AGI'));
    if (has('Precise')) opts.push(attrOpt('PER'));
  }
  const classOpt = x.cls?.id === 'gladiator' ? { dice: x.classDie, label: `${x.cls.dieName} Die` } : undefined;
  if (classOpt) opts.push(classOpt);
  // Combat Styles apply by property; a homebrew weapon's own effects only to that weapon.
  const mods = x.weaponMods.filter((m) => (!m.weapon || m.weapon === name) && (!m.property || has(m.property)) && !(m.melee && ranged));
  // A Combat Style Tandem rolls the Attribute Die with the Martial Die and keeps the
  // higher, so it replaces rolling either of those dice alone.
  const tandems = mods.filter((m) => m.tandem);
  if (tandems.length && classOpt) {
    opts = [
      ...tandems.map((m) => ({ attr: m.tandem, dice: `${x.attrs[m.tandem!].label} / ${classOpt.dice}`, label: `${ATTR_NAMES[m.tandem!]} Die in Tandem with ${classOpt.label} (${m.source})` })),
      ...opts.filter((o) => o !== classOpt && !tandems.some((m) => m.tandem === o.attr)),
    ];
  }
  // Tandem with another die (a sentient item's): the property's Attribute (Precise → PER,
  // Deft → AGI), or every Attribute option when no property is given.
  const propAttr = (p?: string): Attr | undefined => (!p ? undefined : /precise|ranged|drawn/i.test(p) ? 'PER' : /deft/i.test(p) ? 'AGI' : 'VIG');
  for (const m of mods.filter((m) => m.tandemDie)) {
    opts = opts.map((o) =>
      o.attr && (!m.property || propAttr(m.property) === o.attr) && !o.dice.includes('/')
        ? { ...o, dice: `${o.dice} / ${m.tandemDie!.die}`, label: `${o.label} in Tandem with ${m.tandemDie!.name} Die${m.property ? ` (${m.property})` : ''}` }
        : o,
    );
  }
  return { dice: opts, extras: mods.filter((m) => !m.tandem && (m.bolster || m.note)) };
}

/** A DV from the weapons table, tallied when it's a number. */
function dvStat(stats: Stats, key: `weapon:${string}`, v: string | number): string {
  const n = typeof v === 'number' ? v : /^-?\d+$/.test(v.trim()) ? Number(v) : undefined;
  return n === undefined ? String(v) : String(stats.value(key, n));
}

export function weaponRows(c: Character, x: WeaponCtx, stats: Stats): WeaponRow[] {
  const unarmed = c.equipment.weapons.find((w) => w.name === UNARMED);
  const rows: WeaponRow[] = [];
  // Unarmed Strike, when picked: your body, plus any natural weapons (you Unarmed Strike with them).
  if (unarmed) {
    x.unarmed.forEach((u, i) => {
      const id = `unarmed:${u.name}`;
      rows.push({
        id,
        name: u.name,
        kind: 'unarmed',
        removeId: i === 0 ? unarmed.id : undefined,
        sources: u.sources,
        fixedDie: u.classDie ? x.classDie : undefined,
        ...(u.classDie ? { dice: [], extras: [] } : weaponDice(u.name, u.properties, x)),
        dv: dvStat(stats, `weapon:${id}:dv`, u.dv),
        deadlyDv: dvStat(stats, `weapon:${id}:deadly`, u.deadlyDv),
        damage: u.damage,
        properties: u.properties,
      });
    });
  }
  // Your weapons, plus homebrew items that are weapons (named, with the base weapon's stats).
  const listed = [
    ...c.equipment.weapons.filter((w) => w !== unarmed).map((w) => ({ id: w.id, name: w.name, base: w.name, homebrew: false })),
    ...x.homebrew.filter((h) => h.entry.kind === 'item' && h.entry.baseWeapon).map((h) => ({ id: h.entry.id, name: h.entry.name, base: h.entry.baseWeapon!, homebrew: true })),
  ];
  for (const we of listed) {
    const w = weapons.find((y) => y.name === we.base);
    const unmet = w?.requirements
      .split(',')
      .map((r) => r.trim().split(' '))
      .filter(([a, n]) => a && x.attrs[a as Attr] && x.attrs[a as Attr].points < Number(n));
    rows.push({
      id: we.id,
      name: we.name,
      kind: we.homebrew ? 'homebrew' : 'weapon',
      base: we.homebrew ? we.base : undefined,
      removeId: we.homebrew ? undefined : we.id,
      sources: [],
      ...(w ? weaponDice(we.name, w.properties, x) : { dice: [], extras: [] }),
      dv: w ? dvStat(stats, `weapon:${we.id}:dv`, w.dv) : '',
      deadlyDv: w ? dvStat(stats, `weapon:${we.id}:deadly`, w.deadlyDv) : '',
      damage: w?.damage ?? '',
      properties: w?.properties ?? [],
      unmet: unmet && unmet.length > 0 ? w!.requirements : undefined,
    });
  }
  return rows;
}
