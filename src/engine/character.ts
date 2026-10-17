import type { Attr, Light } from '../data/types';

export const CHARACTER_VERSION = 1;

export interface InventoryItem {
  id: string;
  name: string;
  qty: number;
  /** Bulk Rank (1–5); omitted for bulkless items. */
  bulk?: number;
}

export interface WeaponEntry {
  id: string;
  /** Name from the weapons table, or a custom name. */
  name: string;
  notes?: string;
}

export interface Condition {
  name: string;
  level?: number;
}

export interface PlayState {
  /** False until the character first rests to full (new characters). */
  initialized: boolean;
  endurance: number;
  tempEndurance: number;
  vitality: number;
  radianceSpent: number;
  restChargesSpent: number;
  /** Spent amount (pool resources) or amount applied to the limit (limit resources), by resource name. */
  resources: Record<string, number>;
  /** Free-form trackers such as Prismaburn or Indebted. */
  trackers: Record<string, number>;
  /** Uses spent per facet key. */
  facetUses: Record<string, number>;
  conditions: Condition[];
  dying: number;
  shortRests: number;
  /** Prepared spell selections, by list id. */
  prepared: Record<string, string[]>;
}

export interface Character {
  id: string;
  version: number;
  name: string;
  player: string;
  createdAt: string;
  updatedAt: string;
  level: number;

  attributes: {
    method: 'pointBuy' | 'rolled' | 'manual';
    /** Points to spend for point buy / rolled (12 for point buy). */
    pool: number;
    /** Base points before ancestry bonuses and age-ups (each starts at -1). */
    base: Record<Attr, number>;
    /** Where bonus Attribute Points from facets were assigned. */
    bonus: Attr[];
  };
  /** Each age-up costs 1 point of the chosen attribute. */
  ageUps: Attr[];

  ancestry: string;
  subAncestry: string;

  background: {
    /** Pre-made background id, or '' for custom. */
    preset: string;
    heritage: string;
  };
  /** Names for Hobby/Profession slots, keyed by slot id from the engine. */
  skills: Record<string, string>;

  classId: string;
  subclass: string;
  /** Selected options by choice id (class, subclass and built-in choices). */
  choices: Record<string, string>;
  /** Known spells/maneuvers by list id. */
  spells: Record<string, string[]>;

  alignment: {
    situations: '' | 'Action' | 'Patience';
    problems: '' | 'Reason' | 'Instinct';
    people: '' | 'Apathy' | 'Empathy';
    /** Light picked when an effect grants "an Alignment of your choice". Keyed by source. */
    picks: Record<string, Light>;
  };

  details: {
    age: string;
    devotion: string;
    appearance: string;
    backstory: string;
    notes: string;
  };
  experiences: string[];

  equipment: {
    armor: { type: 'Light' | 'Medium' | 'Heavy'; quality: string } | null;
    weapons: WeaponEntry[];
    inventory: InventoryItem[];
  };

  settings: {
    restRules: 'heroic' | 'gritty';
  };

  play: PlayState;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const newId = uid;

export function emptyPlay(): PlayState {
  return {
    initialized: false,
    endurance: 0,
    tempEndurance: 0,
    vitality: 0,
    radianceSpent: 0,
    restChargesSpent: 0,
    resources: {},
    trackers: {},
    facetUses: {},
    conditions: [],
    dying: 0,
    shortRests: 0,
    prepared: {},
  };
}

export function newCharacter(): Character {
  const now = new Date().toISOString();
  return {
    id: uid(),
    version: CHARACTER_VERSION,
    name: '',
    player: '',
    createdAt: now,
    updatedAt: now,
    level: 1,
    attributes: { method: 'pointBuy', pool: 12, base: { VIG: -1, AGI: -1, PER: -1, INT: -1, PRS: -1 }, bonus: [] },
    ageUps: [],
    ancestry: '',
    subAncestry: '',
    background: { preset: '', heritage: '' },
    skills: {},
    classId: '',
    subclass: '',
    choices: {},
    spells: {},
    alignment: { situations: '', problems: '', people: '', picks: {} },
    details: { age: '', devotion: '', appearance: '', backstory: '', notes: '' },
    experiences: [],
    equipment: { armor: null, weapons: [], inventory: [] },
    settings: { restRules: 'heroic' },
    play: emptyPlay(),
  };
}

/** Fills in fields missing from older saves or hand-edited imports. */
export function normalizeCharacter(raw: unknown): Character {
  const base = newCharacter();
  const c = (raw ?? {}) as Partial<Character>;
  return {
    ...base,
    ...c,
    attributes: { ...base.attributes, ...c.attributes, base: { ...base.attributes.base, ...c.attributes?.base } },
    background: { ...base.background, ...c.background },
    alignment: { ...base.alignment, ...c.alignment, picks: { ...c.alignment?.picks } },
    details: { ...base.details, ...c.details },
    equipment: { ...base.equipment, ...c.equipment },
    settings: { ...base.settings, ...c.settings },
    play: { ...emptyPlay(), ...c.play },
    skills: { ...c.skills },
    choices: { ...c.choices },
    spells: { ...c.spells },
    ageUps: c.ageUps ?? [],
    experiences: c.experiences ?? [],
    version: CHARACTER_VERSION,
  };
}
