import type { Attr, Light, Rank, RestRule } from '../data/types';
import type { Creature, Summon } from './summons';

export const CHARACTER_VERSION = 1;

export interface InventoryItem {
  id: string;
  name: string;
  qty: number;
  /** Bulk Rank (1–5); omitted for bulkless items. */
  bulk?: number;
  notes?: string;
  /** Stowed in a backpack rather than carried on your person. */
  inBackpack?: boolean;
  /** A backpack or similar: it has its own inventory pyramid (not in the rules yet). */
  container?: boolean;
  /** Id of the container item this is stored in (its pyramid, not yours). */
  storedIn?: string;
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

/** A temporary effect from an activated facet, spell or maneuver (e.g. Rage). */
export interface ActiveEffect {
  id: string;
  name: string;
  /** When it ends on its own; 'manual' effects are removed by hand (or a rest). */
  ends: 'startOfTurn' | 'endOfTurn' | 'rest' | 'longRest' | 'manual';
  /** Bolstered levels for Checks of some Attributes (Save Checks only when `save`). */
  checks?: { attrs: Attr[] | 'all'; save?: boolean; bolstered: number }[];
  ac?: number;
  movement?: number;
  resistances?: { type: string; amount: number }[];
  notes?: string[];
  /** Temporary AP you regain at the end of each of your turns (Embolden). */
  tempApEachTurn?: number;
  /** Temporary Endurance gained at the start of each of your turns (Invigorate). */
  tempEnduranceEachTurn?: number;
  /** Class resource regained at the end of each of your turns (Titanus Form). */
  resourceEachTurn?: { name: string; amount: number };
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
  /** Action Points, tracked during an Encounter (undefined outside one). */
  ap?: number;
  tempAp?: number;
  /** Whether it is currently your turn. */
  turn?: { active: boolean; noApRegain?: boolean; uses?: Record<string, number> };
  effects?: ActiveEffect[];
  /** Creatures your spells summoned (Summons tab). */
  summons?: Summon[];
}

/** A value that may differ by Alignment tier: [none, Weak, Firm, Strong]. */
export type PerTier = number | [number, number, number, number];

/** A Mod Die an effect can roll in Tandem with: the Class Die, one of your Attributes, or the item's own. */
export type DieChoice = 'class' | Attr | `item:${Attr}`;

/** What a homebrew effect row does. */
export type HomebrewEffect =
  | { kind: 'movement'; amount: number }
  | { kind: 'movementType'; type: 'Swim' | 'Climb'; amount: 'movement' | 'halfMovement' }
  | { kind: 'attribute'; attr: Attr; amount: number }
  | { kind: 'ac'; amount: number }
  | { kind: 'resistance'; type: string; amount: number }
  | { kind: 'immunity'; damage?: string; condition?: string }
  /** +1 Alignment level in a Light (always applies while the entry is active; tiers can't gate it). */
  | { kind: 'alignment'; light: Light }
  | { kind: 'vulnerability'; type: string; dice: string }
  /** Bolstered (positive) or Hindered (negative): all of an Attribute's Checks, its Saves, its Attribute Checks, Attack Checks, or custom text. */
  | { kind: 'check'; scope: 'all' | 'save' | 'attribute' | 'attack' | 'custom'; attr?: Attr; text?: string; amount: number }
  | { kind: 'initiativeTandem'; die: DieChoice }
  | { kind: 'saveTandem'; attr: Attr; die: DieChoice }
  | { kind: 'saveEmpowered'; attr: Attr }
  | { kind: 'max'; stat: 'endurance' | 'vitality' | 'radiance'; amount: number }
  | { kind: 'sense'; name: string }
  /** On this item's weapon (or any weapon, for effects): Tandem die, Bolstered, or a note; optionally only with a property. */
  | { kind: 'weapon'; property?: string; die?: DieChoice; bolster?: number; note?: string }
  | { kind: 'restRule'; rule: RestRule }
  | { kind: 'note'; text: string };

export interface HomebrewRow {
  id: string;
  /** Alignment tiers this row applies at (0 = no Alignment needed … 3 = Strong). */
  minTier?: number;
  maxTier?: number;
  /** Extra requirement on top of the item's own (attunement). */
  when?: 'always' | 'onPerson';
  /** A reminder created when you spend from this pool, instead of a passive effect. */
  onSpend?: string;
  effect: HomebrewEffect;
}

export interface HomebrewPool {
  id: string;
  name: string;
  max: PerTier;
  refresh: 'Rest' | 'Long Rest';
}

/** A homebrew item (or a boon/curse when kind is 'effect') given by the PM. */
export interface HomebrewEntry {
  id: string;
  /** Facets are permanent and always active (shown on the Facets tab). */
  kind: 'item' | 'effect' | 'facet';
  name: string;
  subtitle?: string;
  description?: string;
  /** Weapon from the weapons table this item is (adds it to the Weapons box). */
  baseWeapon?: string;
  bulk?: number;
  /** Requires attunement; effects only apply while `attuned`. */
  attunement?: boolean;
  attuned?: boolean;
  inBackpack?: boolean;
  /** Tier comes from your Alignment level in this Light. */
  tierLight?: Light;
  level?: PerTier;
  /** A sentient item's own Attributes. */
  stats?: Partial<Record<Attr, PerTier>>;
  pools?: HomebrewPool[];
  rows: HomebrewRow[];
  /** For effects: when it ends on its own. */
  ends?: 'manual' | 'rest' | 'longRest';
}

/** A player reward from the PM: usually a single-use boon, like Advantage on one kind of Check. */
export interface Experience {
  id: string;
  name: string;
  /** How many times it can be used (usually 1). */
  uses: number;
  used: number;
  /** What it does, e.g. "Advantage on an Attack Check against a Large creature." */
  effect: string;
}

/**
 * A PM's change to one number on the sheet (advanced edit mode): add to it or set it outright.
 * `stat` is a stat key from the engine (`ac`, `attr:VIG`, `resistance:Arctic`…) or a die key
 * (`die:class`, `die:attr:VIG`: `set` takes the die's sides, `add` steps it; `save:VIG` and
 * `initiative`: `add` Bolsters).
 */
export interface Adjustment {
  id: string;
  stat: string;
  op: 'add' | 'set';
  value: number;
  note?: string;
}

export interface SessionNote {
  id: string;
  title: string;
  /** ISO date (yyyy-mm-dd) of the session. */
  date: string;
  body: string;
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
  /** The name of a Custom ancestry (e.g. "Kobold"). */
  customAncestryName?: string;

  background: {
    /** Pre-made background id, or '' for custom. */
    preset: string;
    heritage: string;
  };
  /** Names for Hobby/Profession slots, keyed by slot id from the engine. */
  skills: Record<string, string>;
  /** Hobby/Profession ranks raised above a slot's starting rank (Ranks & Leveling up), by slot id. */
  skillRanks: Record<string, Rank>;
  /** Hobbies gained at Novice rank instead of a rank increase. */
  noviceHobbies: number;

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
  experiences: Experience[];
  /** Notes for each play session, newest added last. */
  sessions: SessionNote[];
  /** Homebrew items and effects (boons, curses) from the PM. */
  homebrew: HomebrewEntry[];
  /** PM changes to numbers on the sheet, applied in order. */
  adjustments: Adjustment[];
  /** Spells and maneuvers the PM granted outside the class's lists and limits (castable ids). */
  addedCastables: string[];
  /** Beasts and Ethereals imported from Monster Maker exports, for the Communion spells. */
  creatures: Creature[];

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
    skillRanks: {},
    noviceHobbies: 0,
    classId: '',
    subclass: '',
    choices: {},
    spells: {},
    alignment: { situations: '', problems: '', people: '', picks: {} },
    details: { age: '', devotion: '', appearance: '', backstory: '', notes: '' },
    experiences: [],
    sessions: [],
    homebrew: [],
    adjustments: [],
    addedCastables: [],
    creatures: [],
    equipment: { armor: null, weapons: [], inventory: [] },
    settings: { restRules: 'heroic' },
    play: emptyPlay(),
  };
}

/** Conditions whose rulebook spelling was corrected. */
const RENAMED_CONDITIONS: Record<string, string> = { Defeaned: 'Deafened', Possesed: 'Possessed' };

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
    play: { ...emptyPlay(), ...c.play, conditions: (c.play?.conditions ?? []).map((x) => ({ ...x, name: RENAMED_CONDITIONS[x.name] ?? x.name })) },
    skills: { ...c.skills },
    skillRanks: { ...c.skillRanks },
    noviceHobbies: c.noviceHobbies ?? 0,
    choices: { ...c.choices },
    spells: { ...c.spells },
    ageUps: c.ageUps ?? [],
    // Experiences used to be plain names.
    experiences: ((c.experiences ?? []) as (Experience | string)[]).map((e) => (typeof e === 'string' ? { id: uid(), name: e, uses: 1, used: 0, effect: '' } : e)),
    homebrew: c.homebrew ?? [],
    adjustments: c.adjustments ?? [],
    addedCastables: c.addedCastables ?? [],
    creatures: c.creatures ?? [],
    sessions: c.sessions ?? (c.details?.notes ? [{ id: uid(), title: 'Earlier notes', date: (c.updatedAt ?? new Date().toISOString()).slice(0, 10), body: c.details.notes }] : []),
    version: CHARACTER_VERSION,
  };
}
