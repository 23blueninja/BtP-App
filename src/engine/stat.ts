// Numbers on the character sheet, with where they come from. derive tallies every number
// it works out here, so later steps (such as a PM's adjustments) change any of them in one
// place, and the breakdown shown for a number is built from the same parts as its value.
import { ATTR_NAMES, type Attr } from '../data/types';
import type { Adjustment } from './character';

/** Every number derive tallies, by key. */
export type StatKey =
  | 'classBonus'
  | `attr:${Attr}`
  | 'vitalityMax'
  | 'radianceMax'
  | 'enduranceMax'
  | 'restCharges'
  | 'longRestTempEndurance'
  | 'damageReduction'
  | 'movement'
  | `movement:${string}`
  | 'radius'
  | 'ac'
  | `resistance:${string}`
  | 'jumpLong'
  | 'jumpHigh'
  | `resource:${string}`
  | `spells:${string}`
  | `bulk:${number}`
  /** A weapon row's `:dv` or `:deadly`, by row id. */
  | `weapon:${string}`
  | 'bulkShift';

export interface StatValue {
  /** The stat in words, e.g. "Vigor points" or "Longsword Deadly DV". */
  label: string;
  value: number;
  /** Where the value comes from, one line per part, in the order they were applied. */
  breakdown: string[];
}

/** One number being worked out: a base, then parts added (or a value set) in order. */
export class Tally {
  private v: number;
  readonly lines: string[] = [];

  constructor(
    readonly key: StatKey,
    base = 0,
    text?: string,
  ) {
    this.v = base;
    if (text) this.lines.push(text);
  }

  get value(): number {
    return this.v;
  }

  /** Adds `amount`, with an optional breakdown line. */
  add(amount: number, text?: string): this {
    this.v += amount;
    if (text) this.lines.push(text);
    return this;
  }

  /** Replaces the value (e.g. a Condition that makes Movement 0). */
  set(value: number, text?: string): this {
    this.v = value;
    if (text) this.lines.push(text);
    return this;
  }

  /** A breakdown line that doesn't change the value. */
  note(text: string): this {
    this.lines.push(text);
    return this;
  }

  atLeast(min: number): this {
    this.v = Math.max(min, this.v);
    return this;
  }
}

/** A PM adjustment as applied: what it changed, from what to what. */
export interface AppliedAdjustment {
  adjustment: Adjustment;
  label: string;
  before: string;
  after: string;
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

/** "AC +2 (note)" or "AC → 15 (note)": the breakdown line an adjustment adds. */
export function adjustmentLine(a: Adjustment): string {
  return `${a.op === 'set' ? `→ ${a.value}` : signed(a.value)} adjusted${a.note ? ` (${a.note})` : ''}`;
}

/**
 * All of a character's tallies. A stat is finished once, when its value is first needed;
 * that's when the PM's adjustments to it apply, so everything worked out from it follows.
 */
export class Stats {
  private done = new Map<StatKey, StatValue>();
  private names = new Map<string, string>();
  private appliedList: Omit<AppliedAdjustment, 'label'>[] = [];

  constructor(private adjustments: Adjustment[] = []) {}

  /** Adjustments to a stat or die key, in order. */
  for(key: string): Adjustment[] {
    return this.adjustments.filter((a) => a.stat === key);
  }

  /** Records an adjustment applied outside a tally (a die). */
  record(adjustment: Adjustment, before: string, after: string): void {
    this.appliedList.push({ adjustment, before, after });
  }

  /** A friendlier name for a key than `statLabel` can give (a weapon's or spell list's name). */
  name(key: string, label: string): void {
    this.names.set(key, label);
  }

  label(key: string): string {
    return this.names.get(key) ?? statLabel(key);
  }

  get applied(): AppliedAdjustment[] {
    return this.appliedList.map((x) => ({ ...x, label: this.label(x.adjustment.stat) }));
  }

  /** Adjustments whose stat never came up (e.g. a resource the class doesn't have). */
  unapplied(): Adjustment[] {
    return this.adjustments.filter((a) => !this.appliedList.some((x) => x.adjustment === a));
  }

  start(key: StatKey, base = 0, text?: string): Tally {
    return new Tally(key, base, text);
  }

  /** The tally's final value; from here on, other stats can depend on it. */
  finish(t: Tally): number {
    if (this.done.has(t.key)) throw new Error(`Stat ${t.key} finished twice`);
    for (const a of this.for(t.key)) {
      const before = t.value;
      if (a.op === 'set') t.set(a.value, adjustmentLine(a));
      else t.add(a.value, adjustmentLine(a));
      this.record(a, String(before), String(t.value));
    }
    this.done.set(t.key, { label: '', value: t.value, breakdown: [...t.lines] });
    return t.value;
  }

  /** Starts and finishes a stat with no parts beyond its base. */
  value(key: StatKey, base: number, text?: string): number {
    return this.finish(this.start(key, base, text));
  }

  get(key: StatKey): StatValue | undefined {
    return this.done.get(key);
  }

  toRecord(): Partial<Record<StatKey, StatValue>> {
    return Object.fromEntries([...this.done].map(([k, v]) => [k, { ...v, label: this.label(k) }]));
  }
}

const NAMED: Record<string, string> = {
  classBonus: 'Class Bonus',
  vitalityMax: 'Vitality maximum',
  radianceMax: 'Radiance maximum',
  enduranceMax: 'Endurance maximum',
  restCharges: 'Rest Charges',
  longRestTempEndurance: 'Temporary Endurance on a Long Rest',
  damageReduction: 'Damage reduction',
  movement: 'Movement',
  radius: 'Radius',
  ac: 'AC',
  jumpLong: 'Long Jump',
  jumpHigh: 'High Jump',
  bulkShift: 'Bulk Rank decrease',
  'die:class': 'Class Die',
  initiative: 'Initiative (Bolstered)',
};

/** A stat or die key in words, e.g. `attr:VIG` → "Vigor points". */
export function statLabel(key: string): string {
  if (NAMED[key]) return NAMED[key];
  const [kind, a, b] = key.split(':');
  if (kind === 'attr') return `${ATTR_NAMES[a as Attr] ?? a} points`;
  if (kind === 'die' && a === 'attr') return `${b} Die`;
  if (kind === 'save') return `${a} Save Checks (Bolstered)`;
  if (kind === 'movement') return `${a} Movement`;
  if (kind === 'resistance') return `${a} Resistance`;
  if (kind === 'resource') return `${a} maximum`;
  if (kind === 'spells') return `${a} size`;
  if (kind === 'bulk') return `Bulk Rank ${a} slots`;
  if (kind === 'weapon') return `${key.endsWith(':deadly') ? 'Deadly DV' : 'DV'}: ${key.slice(7, key.lastIndexOf(':'))}`;
  return key;
}
