// Numbers on the character sheet, with where they come from. derive tallies every number
// it works out here, so later steps (such as a PM's adjustments) change any of them in one
// place, and the breakdown shown for a number is built from the same parts as its value.
import type { Attr } from '../data/types';

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
  | 'bulkShift';

export interface StatValue {
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

/** All of a character's tallies. A stat is finished once, when its value is first needed. */
export class Stats {
  private done = new Map<StatKey, StatValue>();

  start(key: StatKey, base = 0, text?: string): Tally {
    return new Tally(key, base, text);
  }

  /** The tally's final value; from here on, other stats can depend on it. */
  finish(t: Tally): number {
    if (this.done.has(t.key)) throw new Error(`Stat ${t.key} finished twice`);
    this.done.set(t.key, { value: t.value, breakdown: [...t.lines] });
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
    return Object.fromEntries(this.done);
  }
}
