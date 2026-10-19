// Homebrew items and effects from the PM: which tier they're at (from an
// Alignment), their own stats and pools, and the effects they currently apply.
import { ATTRS, type Attr, type DieRef, type Effect, type Light } from '../data/types';
import type { Character, DieChoice, HomebrewEffect, HomebrewEntry, HomebrewRow, PerTier, PlayState } from './character';
import { formatDie, modDieFromPoints } from './dice';

export const TIER_NAMES = ['None', 'Weak', 'Firm', 'Strong'] as const;

export const atTier = (v: PerTier | undefined, tier: number): number | undefined => (v === undefined ? undefined : Array.isArray(v) ? v[tier] : v);

export const poolKey = (entryId: string, poolId: string) => `hb:${entryId}:${poolId}`;

export interface ResolvedPool {
  id: string;
  name: string;
  key: string;
  max: number;
  spent: number;
  refresh: 'Rest' | 'Long Rest';
}

export interface ResolvedHomebrew {
  entry: HomebrewEntry;
  /** 0 (none) to 3 (Strong). */
  tier: number;
  level?: number;
  stats: Partial<Record<Attr, { points: number; die: string }>>;
  pools: ResolvedPool[];
  /** Whether the item's effects apply at all (attunement). */
  active: boolean;
  /** Rows applying now, and rows that will apply at other tiers. */
  applied: HomebrewRow[];
  inactive: HomebrewRow[];
}

export interface HomebrewResult {
  cards: ResolvedHomebrew[];
  effects: { e: Effect; source: string }[];
}

/** Rows that apply at this tier and in this situation (passive rows only). */
export function rowApplies(row: HomebrewRow, entry: HomebrewEntry, tier: number): boolean {
  if (row.onSpend) return false;
  if (tier < (row.minTier ?? 0) || tier > (row.maxTier ?? 3)) return false;
  if (row.when === 'onPerson' && entry.inBackpack) return false;
  return true;
}

export function resolveDie(choice: DieChoice | undefined, r: Pick<ResolvedHomebrew, 'entry' | 'stats'>): 'class' | Attr | DieRef | undefined {
  if (!choice) return undefined;
  if (choice.startsWith('item:')) {
    const a = choice.slice(5) as Attr;
    const s = r.stats[a];
    return s ? { name: `${r.entry.name} ${a}`, die: s.die } : undefined;
  }
  return choice as 'class' | Attr;
}

/** The engine effect(s) a homebrew row stands for. */
function toEffects(spec: HomebrewEffect, r: Pick<ResolvedHomebrew, 'entry' | 'stats'>): Effect[] {
  switch (spec.kind) {
    case 'movement':
    case 'movementType':
    case 'attribute':
    case 'ac':
    case 'resistance':
    case 'immunity':
    case 'vulnerability':
    case 'saveEmpowered':
    case 'sense':
    case 'restRule':
    case 'note':
      return [spec as Effect];
    case 'alignment':
      // Counted with your other Alignments before tiers are worked out (see derive).
      return [];
    case 'max':
      return [{ kind: spec.stat, amount: spec.amount }];
    case 'check':
      if ((spec.scope === 'all' || spec.scope === 'save') && spec.attr) return [{ kind: 'checks', attrs: [spec.attr], save: spec.scope === 'save', amount: spec.amount }];
      return [
        {
          kind: 'bolster',
          what: spec.scope === 'attribute' ? `${spec.attr} Attribute Checks` : spec.scope === 'attack' ? 'Attack Checks' : spec.text || 'Checks',
          amount: spec.amount,
        },
      ];
    case 'initiativeTandem': {
      const die = resolveDie(spec.die, r);
      return die ? [{ kind: 'tandem', what: 'Initiative Checks', die }] : [];
    }
    case 'saveTandem': {
      const die = resolveDie(spec.die, r);
      if (!die) return [];
      return [{ kind: 'saveTandem', attr: spec.attr, die: die === 'class' ? undefined : typeof die === 'string' ? undefined : die }];
    }
    case 'weapon': {
      const die = resolveDie(spec.die, r);
      return [
        {
          kind: 'weapon',
          property: spec.property || undefined,
          weapon: r.entry.kind === 'item' && r.entry.baseWeapon ? r.entry.name : undefined,
          tandemDie: die && typeof die === 'object' ? die : undefined,
          bolster: spec.bolster || undefined,
          note: spec.note || undefined,
        },
      ];
    }
  }
}

/** Resolves every homebrew entry against your Alignment levels. */
export function resolveHomebrew(c: Character, alignmentLevel: (light: Light) => number): HomebrewResult {
  const cards: ResolvedHomebrew[] = [];
  const effects: HomebrewResult['effects'] = [];
  for (const entry of c.homebrew ?? []) {
    const tier = entry.tierLight ? Math.min(3, alignmentLevel(entry.tierLight)) : 0;
    const stats: ResolvedHomebrew['stats'] = {};
    for (const a of ATTRS) {
      const v = atTier(entry.stats?.[a], tier);
      if (v !== undefined) stats[a] = { points: v, die: formatDie(modDieFromPoints(v)) };
    }
    const pools = (entry.pools ?? []).map((p) => ({ id: p.id, name: p.name, key: poolKey(entry.id, p.id), max: atTier(p.max, tier) ?? 0, spent: c.play.facetUses[poolKey(entry.id, p.id)] ?? 0, refresh: p.refresh }));
    const active = entry.kind !== 'item' || !entry.attunement || !!entry.attuned;
    const applied = active ? entry.rows.filter((row) => rowApplies(row, entry, tier)) : [];
    const card: ResolvedHomebrew = { entry, tier, level: atTier(entry.level, tier), stats, pools, active, applied, inactive: entry.rows.filter((row) => !applied.includes(row)) };
    cards.push(card);
    for (const row of applied) for (const e of toEffects(row.effect, card)) effects.push({ e, source: entry.name });
  }
  return { cards, effects };
}

/** Spends one from an item's pool, adding a reminder for each "when you spend" row at this tier. */
export function spendPool(p: PlayState, card: ResolvedHomebrew, poolId: string): { play: PlayState; log: string[] } {
  const pool = card.pools.find((x) => x.id === poolId);
  if (!pool) return { play: p, log: [] };
  const log = [`Spent 1 ${pool.name} from ${card.entry.name} (${Math.max(0, pool.max - pool.spent - 1)} left).`];
  const reminders = card.active
    ? card.entry.rows.filter((row) => row.onSpend === poolId && card.tier >= (row.minTier ?? 0) && card.tier <= (row.maxTier ?? 3))
    : [];
  const effects = [...(p.effects ?? [])];
  for (const row of reminders) {
    const text = describeEffect(row.effect, card);
    effects.push({ id: Math.random().toString(36).slice(2, 10), name: `${card.entry.name}`, ends: 'endOfTurn', notes: [text] });
    log.push(text);
  }
  return { play: { ...p, facetUses: { ...p.facetUses, [pool.key]: pool.spent + 1 }, effects }, log };
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);
const dieText = (choice: DieChoice | undefined, r: Pick<ResolvedHomebrew, 'entry' | 'stats'>) => {
  const d = resolveDie(choice, r);
  if (!d) return 'a die';
  if (d === 'class') return 'your Class Die';
  if (typeof d === 'string') return `your ${d} Die`;
  return `${d.name} Die (${d.die})`;
};
export const RULE_TEXT: Record<string, string> = {
  noRadianceLongRest: 'You don’t regain Radiance when you finish a Long Rest.',
  noVitalityLongRest: 'You don’t regain Vitality when you finish a Long Rest.',
  noEnduranceLongRest: 'You don’t regain Endurance when you finish a Long Rest.',
  noTempEnduranceLongRest: 'You don’t gain Temporary Endurance when you finish a Long Rest.',
  noRestCharges: 'You can’t spend Rest Charges.',
  noVitalityShortRest: 'You don’t regain Vitality when you finish a Short Rest.',
};

/** Plain-English text for an effect row, as shown on the item card. */
export function describeEffect(e: HomebrewEffect, r: Pick<ResolvedHomebrew, 'entry' | 'stats'>): string {
  switch (e.kind) {
    case 'movement':
      return `Movement ${signed(e.amount)}.`;
    case 'movementType':
      return `${e.type} Movement equal to ${e.amount === 'movement' ? 'your Movement' : 'half your Movement'}.`;
    case 'attribute':
      return `${e.attr} Points ${signed(e.amount)}.`;
    case 'ac':
      return `AC ${signed(e.amount)}.`;
    case 'resistance':
      return `${e.type} Resistance ${e.amount}.`;
    case 'immunity':
      return e.condition ? `Immune to the ${e.condition} Condition.` : `Immune to ${e.damage} damage.`;
    case 'vulnerability':
      return `${e.type} Vulnerability ${e.dice}.`;
    case 'alignment':
      return `+1 ${e.light} Alignment level.`;
    case 'check': {
      const what = e.scope === 'all' ? `${e.attr} Checks` : e.scope === 'save' ? `${e.attr} Save Checks` : e.scope === 'attribute' ? `${e.attr} Attribute Checks` : e.scope === 'attack' ? 'Attack Checks' : e.text || 'Checks';
      return `${what} are ${e.amount >= 0 ? 'Bolstered' : 'Hindered'} ${Math.abs(e.amount)}.`;
    }
    case 'initiativeTandem':
      return `Initiative Checks are rolled in Tandem with ${dieText(e.die, r)}.`;
    case 'saveTandem':
      return `${e.attr} Save Checks are rolled in Tandem with ${dieText(e.die, r)}.`;
    case 'saveEmpowered':
      return `${e.attr} Save Checks are Empowered.`;
    case 'max':
      return `${e.stat[0].toUpperCase()}${e.stat.slice(1)} maximum ${signed(e.amount)}.`;
    case 'sense':
      return `You gain ${e.name}.`;
    case 'weapon': {
      const parts = [
        e.die && `rolled in Tandem with ${dieText(e.die, r)}`,
        e.bolster && `${e.bolster > 0 ? 'Bolstered' : 'Hindered'} ${Math.abs(e.bolster)}`,
      ].filter(Boolean);
      const lead = `${e.property ? `With the ${e.property} property, ` : ''}${r.entry.baseWeapon ? 'Attack Checks with this weapon' : 'Weapon Attack Checks'}`;
      return [parts.length ? `${lead} are ${parts.join(' and ')}.` : '', e.note ?? ''].filter(Boolean).join(' ');
    }
    case 'restRule':
      return RULE_TEXT[e.rule];
    case 'note':
      return e.text;
  }
}

/** Builds Predator's Chains / Moonblade style entries in tests and as examples. */
export const newHomebrew = (kind: HomebrewEntry['kind'], id: string): HomebrewEntry => ({
  id,
  kind,
  name: kind === 'item' ? 'New item' : kind === 'facet' ? 'New facet' : 'New effect',
  rows: [],
  ...(kind === 'effect' ? { ends: 'manual' as const } : {}),
});

/** Alignment levels granted by homebrew rows: they always apply while the entry is active (no tiers, no pools). */
export function homebrewAlignments(c: Character): { light: Light; source: string }[] {
  const out: { light: Light; source: string }[] = [];
  for (const entry of c.homebrew ?? []) {
    const active = entry.kind !== 'item' || !entry.attunement || !!entry.attuned;
    if (!active) continue;
    for (const row of entry.rows) {
      if (row.effect.kind !== 'alignment' || row.onSpend || (row.when === 'onPerson' && entry.inBackpack)) continue;
      out.push({ light: row.effect.light, source: entry.name });
    }
  }
  return out;
}
