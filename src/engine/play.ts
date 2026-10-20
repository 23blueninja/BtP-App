// Play-mode state changes: rests, damage/healing, resources and level-up.
import type { Character, PlayState } from './character';
import { half } from './dice';
import { derive, type Derived } from './derive';
import { classEndurance, type ResolvedFacet } from './classInfo';
import { resolveScaled } from './derive';
import { ACTIVATIONS, activationUseKey } from './activations';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function facetUseMax(f: ResolvedFacet, d: Derived): number {
  if (!f.uses) return 0;
  const n = f.uses.count;
  if (typeof n === 'number') return n;
  if (typeof n === 'object') return n.base + Object.entries(n.at).reduce((sum, [lvl, extra]) => sum + (d.level >= Number(lvl) ? extra : 0), 0);
  return resolveScaled(n, { level: d.level, classBonus: d.classBonus, points: { VIG: 0, AGI: 0, PER: 0, INT: 0, PRS: 0 } });
}

/** A fully rested play state for a freshly built (or reset) character. */
export function freshPlay(c: Character, d: Derived = derive(c)): PlayState {
  return {
    ...c.play,
    initialized: true,
    endurance: d.enduranceMax,
    tempEndurance: 0,
    vitality: d.vitalityMax,
    radianceSpent: 0,
    restChargesSpent: 0,
    resources: {},
    trackers: {},
    facetUses: {},
    conditions: [],
    dying: 0,
    shortRests: 0,
  };
}

/** Keeps current values within their (possibly changed) maximums. */
export function clampPlay(p: PlayState, d: Derived): PlayState {
  const resources = { ...p.resources };
  for (const r of d.resources) resources[r.name] = clamp(resources[r.name] ?? 0, 0, r.max);
  return {
    ...p,
    endurance: clamp(p.endurance, 0, d.enduranceMax),
    vitality: clamp(p.vitality, 0, d.vitalityMax),
    radianceSpent: clamp(p.radianceSpent, 0, d.radianceMax),
    restChargesSpent: clamp(p.restChargesSpent, 0, d.restCharges),
    resources,
  };
}

/**
 * Applies damage: Temporary Endurance first, then Endurance. Taking damage while
 * at 0 Endurance costs 1 Vitality, and Dying becomes the Vitality missing.
 */
export function takeDamage(p: PlayState, amount: number, d: Derived): PlayState {
  if (amount <= 0) return p;
  let { tempEndurance, endurance, vitality, dying } = p;
  const wasAtZero = endurance <= 0;
  const fromTemp = Math.min(tempEndurance, amount);
  tempEndurance -= fromTemp;
  const rest = amount - fromTemp;
  if (rest > 0) {
    if (wasAtZero) {
      vitality = Math.max(0, vitality - 1);
      dying = Math.max(dying, d.vitalityMax - vitality);
    } else {
      endurance = Math.max(0, endurance - rest);
    }
  }
  // Unconscious ends when you take damage.
  const conditions = p.conditions.some((c) => c.name === 'Unconscious') ? p.conditions.filter((c) => c.name !== 'Unconscious') : p.conditions;
  return { ...p, tempEndurance, endurance, vitality, dying, conditions };
}

export function heal(p: PlayState, amount: number, d: Derived): PlayState {
  return { ...p, endurance: clamp(p.endurance + amount, 0, d.enduranceMax) };
}

export interface RestResult {
  play: PlayState;
  log: string[];
  /** Homebrew entries left after effects that end on this rest are removed. */
  homebrew: Character['homebrew'];
}

/** Homebrew effects that end on this kind of rest (an "until your next Rest" effect ends on either). */
function endHomebrew(c: Character, kind: 'rest' | 'longRest', log: string[]): Character['homebrew'] {
  const ends = (e: Character['homebrew'][number]) => e.kind === 'effect' && (e.ends === 'rest' || (kind === 'longRest' && e.ends === 'longRest'));
  for (const e of c.homebrew ?? []) if (ends(e)) log.push(`${e.name} ended.`);
  return (c.homebrew ?? []).filter((e) => !ends(e));
}

/** `restCharges`: how many Rest Charges to spend, each regaining half your Endurance Maximum. */
export function shortRest(c: Character, d: Derived, opts: { restCharges: number }): RestResult {
  // Bruised lasts until you finish a Rest.
  const p = { ...c.play, resources: { ...c.play.resources }, facetUses: { ...c.play.facetUses }, conditions: c.play.conditions.filter((x) => x.name !== 'Bruised') };
  const log: string[] = [];
  if (c.play.conditions.length !== p.conditions.length) log.push('Bruised ended.');
  // You can only benefit from two Short Rests per Long Rest.
  p.shortRests += 1;
  if (p.shortRests > 2) {
    log.unshift('Nothing restored: only two Short Rests count per Long Rest.');
    return { play: p, log, homebrew: c.homebrew ?? [] };
  }
  const rules = new Set(d.restRules);
  if (c.settings.restRules === 'heroic' && !rules.has('noVitalityShortRest')) {
    const gain = Math.min(half(Math.max(0, d.attrs.VIG.points)), d.vitalityMax - p.vitality);
    if (gain > 0) {
      p.vitality += gain;
      log.push(`Regained ${gain} Vitality.`);
      if (p.vitality > 0) p.dying = 0;
    }
  }
  const charges = Math.max(0, Math.min(opts.restCharges, d.restCharges - p.restChargesSpent));
  if (opts.restCharges > 0 && rules.has('noRestCharges')) log.push('You can’t spend Rest Charges.');
  else if (charges > 0) {
    const before = p.endurance;
    p.restChargesSpent += charges;
    p.endurance = Math.min(d.enduranceMax, p.endurance + charges * half(d.enduranceMax));
    log.push(`Spent ${charges === 1 ? 'a Rest Charge' : `${charges} Rest Charges`}: regained ${p.endurance - before} Endurance.`);
  }
  for (const r of d.resources) {
    if (r.mode === 'pool') {
      if (p.resources[r.name]) log.push(`${r.name} restored.`);
      p.resources[r.name] = 0;
    } else {
      const before = p.resources[r.name] ?? 0;
      p.resources[r.name] = Math.max(0, before - d.classBonus);
      if (before) log.push(`${r.name} applied to your limit reduced by ${before - p.resources[r.name]}.`);
    }
  }
  for (const f of d.facets) {
    if (f.uses && (f.uses.per === 'Rest' || f.uses.per === 'Short Rest') && p.facetUses[f.key]) {
      p.facetUses[f.key] = 0;
      log.push(`${f.name} refreshed.`);
    }
  }
  for (const a of ACTIVATIONS) {
    const k = activationUseKey(a);
    if (!a.uses || !p.facetUses[k]) continue;
    const before = p.facetUses[k];
    p.facetUses[k] = a.uses.per === 'Rest' ? 0 : Math.max(0, before - (a.uses.shortRestRegain ?? 0));
    if (p.facetUses[k] !== before) log.push(`${a.label}: regained ${before - p.facetUses[k]} use(s).`);
  }
  for (const card of d.homebrew) {
    for (const pool of card.pools) {
      if (pool.refresh === 'Rest' && p.facetUses[pool.key]) {
        p.facetUses[pool.key] = 0;
        log.push(`${card.entry.name}: ${pool.name} restored.`);
      }
    }
  }
  // Effects with durations in minutes are over after a Short Rest.
  const lasting = (p.effects ?? []).filter((e) => e.ends === 'longRest');
  if ((p.effects ?? []).length > lasting.length) log.push('Active effects ended.');
  p.effects = lasting;
  if (c.ancestry === 'human' && p.radianceSpent > 0) {
    p.radianceSpent -= 1;
    log.push('Radiant: regained 1 Radiance.');
  }
  if (d.cls?.id === 'luminary' && p.radianceSpent > 0) {
    const g = Math.min(half(d.classBonus), p.radianceSpent);
    p.radianceSpent -= g;
    log.push(`Natural Radiance: regained ${g} Radiance.`);
  }
  const homebrew = endHomebrew(c, 'rest', log);
  if (!log.length) log.push('Rested. Nothing to restore.');
  return { play: p, log, homebrew };
}

export function longRest(c: Character, d: Derived): RestResult {
  const p = { ...c.play, resources: {} as Record<string, number>, facetUses: {} as Record<string, number> };
  const log: string[] = [];
  const rules = new Set(d.restRules);
  if (rules.has('noEnduranceLongRest')) log.push('Endurance not restored (homebrew effect).');
  else {
    p.endurance = d.enduranceMax;
    log.push('Endurance fully restored.');
  }
  if (d.longRestTempEndurance > 0 && !rules.has('noTempEnduranceLongRest')) {
    p.tempEndurance = Math.max(p.tempEndurance, d.longRestTempEndurance);
    log.push(`Temporary Endurance set to ${p.tempEndurance}.`);
  }
  p.restChargesSpent = 0;
  const vig = Math.max(0, d.attrs.VIG.points);
  const vitGain = c.settings.restRules === 'heroic' ? 1 + half(vig) : Math.max(1, half(vig));
  const gained = rules.has('noVitalityLongRest') ? 0 : Math.min(vitGain, d.vitalityMax - c.play.vitality);
  if (rules.has('noVitalityLongRest')) log.push('Vitality not regained (homebrew effect).');
  p.vitality = c.play.vitality + gained;
  if (gained > 0) {
    log.push(`Regained ${gained} Vitality.`);
    p.dying = 0;
  }
  let rad = half(Math.max(0, d.attrs.PRS.points));
  if (c.ancestry === 'human') rad += 1;
  if (d.cls?.id === 'luminary') rad += half(d.classBonus);
  const radGain = rules.has('noRadianceLongRest') ? 0 : Math.min(rad, c.play.radianceSpent);
  if (rules.has('noRadianceLongRest') && c.play.radianceSpent) log.push('Radiance not regained (homebrew effect).');
  p.radianceSpent = c.play.radianceSpent - radGain;
  if (radGain) log.push(`Regained ${radGain} Radiance.`);
  p.shortRests = 0;
  p.effects = [];
  const trackers = { ...c.play.trackers };
  p.trackers = trackers;
  // Exhausted reduces by 1 on a Long Rest.
  p.conditions = c.play.conditions
    .map((x) => (x.name === 'Exhausted' ? { ...x, level: (x.level ?? 1) - 1 } : x))
    .filter((x) => x.name !== 'Exhausted' || (x.level ?? 0) > 0)
    // Bruised lasts until you finish a Rest.
    .filter((x) => x.name !== 'Bruised');
  log.push('Class resources and facet uses restored.');
  return { play: p, log, homebrew: endHomebrew(c, 'longRest', log) };
}

export interface LevelUpSummary {
  from: number;
  to: number;
  changes: string[];
  newFacets: ResolvedFacet[];
}

/** Raises the character one level and reports what changed (the Level Up Checklist). */
export function levelUp(c: Character): { character: Character; summary: LevelUpSummary } {
  const before = derive(c);
  const next: Character = { ...c, level: c.level + 1 };
  const after = derive(next);
  const changes: string[] = [];
  const delta = (label: string, a: number | string, b: number | string) => {
    if (a !== b) changes.push(`${label}: ${a} → ${b}`);
  };
  delta('Endurance Maximum', before.enduranceMax, after.enduranceMax);
  delta('Class Bonus', `+${before.classBonus}`, `+${after.classBonus}`);
  delta(after.classDieName, before.classDie, after.classDie);
  for (const r of after.resources) {
    const old = before.resources.find((x) => x.name === r.name)?.max ?? 0;
    delta(r.name, old, r.max);
  }
  for (const l of after.spellLists) {
    const old = before.spellLists.find((x) => x.def.id === l.def.id && x.source === l.source)?.count ?? 0;
    if (l.def.mode === 'known') delta(`${l.def.label} known`, old, l.count);
    else delta(`${l.def.label} (prepared)`, old, l.count);
  }
  if (after.level % 2 === 1 && after.level >= 3) changes.push('Increase the rank of one Hobby or Profession, or gain a new Hobby at Novice rank.');
  const beforeKeys = new Set(before.facets.map((f) => f.key));
  const newFacets = after.facets.filter((f) => !beforeKeys.has(f.key));
  const endGain = after.enduranceMax - before.enduranceMax;
  const play = clampPlay({ ...c.play, endurance: c.play.endurance + Math.max(0, endGain) }, after);
  const cls = after.cls;
  if (cls) {
    const e = classEndurance(cls);
    if (e.perLevel && !changes.some((x) => x.startsWith('Endurance'))) changes.push(`Endurance Maximum +${e.perLevel}`);
  }
  return {
    character: { ...next, play, updatedAt: new Date().toISOString() },
    summary: { from: c.level, to: next.level, changes, newFacets },
  };
}
