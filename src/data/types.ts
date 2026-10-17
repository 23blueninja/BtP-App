export const ATTRS = ['VIG', 'AGI', 'PER', 'INT', 'PRS'] as const;
export type Attr = (typeof ATTRS)[number];

export const ATTR_NAMES: Record<Attr, string> = {
  VIG: 'Vigor',
  AGI: 'Agility',
  PER: 'Perception',
  INT: 'Intelligence',
  PRS: 'Presence',
};

export const LIGHTS = ['Flame', 'Frost', 'Pneuma', 'Soma', 'Mordant', 'Velvet', 'Infernal', 'Lunar', 'Temporal', 'Platinum'] as const;
export type Light = (typeof LIGHTS)[number];

export const RANKS = ['Novice', 'Amateur', 'Proficient', 'Adept', 'Master'] as const;
export type Rank = (typeof RANKS)[number];
export const RANK_DIE: Record<Rank, string> = { Novice: 'd4', Amateur: 'd6', Proficient: 'd8', Adept: 'd10', Master: 'd12' };

/** A value that scales with the character, e.g. "equal to your Class Bonus". */
export type Scaled = number | 'classBonus' | 'halfClassBonus' | 'level' | 'twiceLevel' | { attr: Attr; half?: boolean };

/**
 * Mechanical effects the engine applies. Anything not modelled here is still
 * shown to the player as facet text.
 */
export type Effect =
  | { kind: 'alignment'; light: Light | 'choice' }
  | { kind: 'movement'; amount: Scaled }
  | { kind: 'movementType'; type: 'Swim' | 'Climb'; amount: 'movement' | 'halfMovement' }
  | { kind: 'vitality'; amount: Scaled }
  | { kind: 'radiance'; amount: Scaled }
  | { kind: 'endurance'; amount: Scaled }
  | { kind: 'resistance'; type: string; amount: Scaled }
  | { kind: 'acUnarmored'; amount: Scaled }
  | { kind: 'hobbies'; count: number; rank: Rank }
  | { kind: 'profession'; count: number; rank: Rank; name?: string }
  | { kind: 'attributePoint'; count: number }
  | { kind: 'sense'; name: string }
  | { kind: 'bolster'; what: string; amount: Scaled }
  | { kind: 'tandem'; what: string; die: 'class' | Attr }
  | { kind: 'saveTandem'; attr: Attr | 'choice' }
  | { kind: 'noSlashingVulnerability' }
  /** Bulk Rank of items carried on your person (not in a backpack) is decreased by `amount` (rank number goes up). */
  | { kind: 'bulkShift'; amount: number }
  | { kind: 'actions'; categories: string[] }
  | { kind: 'spellList'; list: SpellListDef }
  | { kind: 'grant'; castable: string };

export interface FacetDef {
  /** Display name. */
  name: string;
  /** Section id in the rules (for the full text). */
  contentId?: string;
  /** Name of a lead-in item within `contentId`, when the facet is one paragraph of a section. */
  item?: string;
  level?: number;
  effects?: Effect[];
  /** Usage limit shown on the sheet, e.g. "1 / Long Rest". */
  uses?: { count: number | 'halfClassBonus' | 'classBonus'; per: 'Rest' | 'Short Rest' | 'Long Rest' };
}

export interface ChoiceOption {
  id: string;
  name: string;
  contentId?: string;
  item?: string;
  effects?: Effect[];
  facets?: FacetDef[];
}

export interface ChoiceDef {
  id: string;
  label: string;
  level: number;
  options: ChoiceOption[];
}

/** How many entries a spell/maneuver list should hold. */
export interface CountExpr {
  base?: number;
  /** Values by class level (index 0 = level 1). Added to base. */
  byLevel?: number[];
  /** Read from a class table column (e.g. "Maneuvers Known"). */
  column?: string;
  level?: boolean;
  classBonus?: boolean;
  attr?: Attr;
}

export interface PoolFilter {
  kind: 'spell' | 'maneuver';
  group?: 'Arcana' | 'Evocations';
  types?: string[];
  tiers?: ('Cantrip' | 'Mantra' | 'Arcanum' | 'Evocation')[];
  /** Restrict to leveled spells/maneuvers up to the class table's max level column. */
  maxLevelColumn?: string;
  /** Alternative filters OR-ed with this one (e.g. "or a Mind cantrip"). */
  or?: PoolFilter[];
}

export interface SpellListDef {
  id: string;
  label: string;
  count: CountExpr;
  pool: PoolFilter;
  /** Granted automatically and counted towards `count`. */
  granted?: string[];
  /** 'known' lists are chosen at creation/level-up; 'prepared' lists change each Long Rest. */
  mode: 'known' | 'prepared';
  /** For prepared lists drawn from another list (e.g. Grimoire). */
  from?: string;
  note?: string;
  /** Level at which this list becomes available. */
  level?: number;
}

export interface ResourceDef {
  name: string;
  /** Class table column holding the maximum. */
  column: string;
  /**
   * 'pool': a maximum you spend from and regain on a Rest (Stamina, Will, Wonder).
   * 'limit': a per-Long-Rest spending limit, reduced by Class Bonus on a Short Rest (Prisma, Light, Favor).
   */
  mode: 'pool' | 'limit';
}

export type ArmorRule =
  | { kind: 'levelUnarmored' }
  | { kind: 'bonusWith'; armor: ('Light' | 'Medium' | 'Heavy')[] };

/** Hand-authored mechanics for a subclass; its facets are read from the rules. */
export interface SubclassExtras {
  facetExtras?: Record<string, Partial<FacetDef>>;
  choices?: ChoiceDef[];
  spellLists?: SpellListDef[];
}

export interface ClassDef {
  id: string;
  name: string;
  contentId: string;
  /** Section id of the class table. */
  tableId: string;
  /** Alignment and Endurance are read from the class's rules text. */
  dieName: string;
  actions: string[];
  armor: ArmorRule[];
  armorTraining: string;
  weaponTraining: string;
  saveTandem: (Attr | 'choice')[];
  saveEmpowered?: boolean;
  basicSkillEmpowered: Attr;
  spellAttr?: Attr | 'choice';
  /** Spell Mod Die is the class die (default) or the Spell Attribute's die. */
  spellDie?: 'class' | 'attr';
  maneuverDie?: boolean;
  resources: ResourceDef[];
  /** Mechanics for facets keyed by the facet's section slug; facets themselves come from the rules. */
  facetExtras?: Record<string, Partial<FacetDef>>;
  subclassLabel: string;
  /** Section listing the subclasses (e.g. classes/arcane-triumvirates). */
  subclassListId: string;
  subclassExtras?: Record<string, SubclassExtras>;
  choices?: ChoiceDef[];
  spellLists?: SpellListDef[];
  /** Extra trackers shown in play mode (e.g. Prismaburn). */
  trackers?: string[];
}

export interface AncestryDef {
  id: string;
  name: string;
  contentId: string;
  facetsId: string;
  facets: FacetDef[];
  subAncestries?: { id: string; name: string; contentId: string; facets: FacetDef[] }[];
}

export interface HeritageFacetDef extends FacetDef {
  id: string;
}

export interface BackgroundDef {
  id: string;
  name: string;
  contentId: string;
  profession: string;
  hobbies: string[];
  heritage: string;
}
