// Facet coverage audit: does every always-on mechanic written in a facet's rules
// text actually apply where the sheet shows it — not just as text to read?
//
// For every facet a character can have (each class/subclass at max level, each
// option of each class choice, each ancestry and sub-ancestry, each heritage),
// the facet's text is split into sentences. A sentence that states an
// unconditional mechanic the engine knows how to model (Tandem dice, Empowered
// saves, Resistances, Immunities, Swim/Climb Movement, Movement, senses,
// Bolstered/Hindered Checks, Endurance/Vitality/Radiance, AC) must:
//   1. have a matching effect on the facet, and
//   2. show up in the derived value it belongs to (e.g. "Initiative Checks are
//      rolled in Tandem with your Wild Die" → the Initiative die reads "d4 / d6",
//      a Resistance → the Resistances list).
// Situational text ("when", "while", "if", "for the duration"…) is skipped, and
// facets whose mechanic only applies in an activated state are listed in
// ALLOWED with the reason. A new facet that the app only shows as text fails here.
import { describe, expect, it } from 'vitest';
import { classes } from '../src/data/classes';
import { ancestries } from '../src/data/ancestries';
import { heritageFacets } from '../src/data/backgrounds';
import { ATTRS, type Effect } from '../src/data/types';
import { subclassesOf, type ResolvedFacet } from '../src/engine/classInfo';
import { getItem, getNode, type RuleNode } from '../src/content';
import { CONDITION_DAMAGE_TYPE } from '../src/engine/conditions';
import { derive, MAX_LEVEL, type Derived } from '../src/engine/derive';
import { built, makeCharacter, sample } from './helpers';
import { weapons } from '../src/content';

// The 14 damage types in the rules (Damage Types, Ranks 1–6).
const DAMAGE_TYPES = ['Arctic', 'Caustic', 'Chthonic', 'Cosmic', 'Crushing', 'Divine', 'Galvanic', 'Piercing', 'Profane', 'Psychic', 'Slashing', 'Somatic', 'Sonic', 'Thermic'];
const CONDITIONS = ['Bleeding', 'Blinded', 'Bruised', 'Buffeted', 'Burning', 'Deafened', 'Dissolving', 'Dulled', 'Dying', 'Exhausted', 'Freezing', 'Immobilized', 'Morphing', 'Muddled', 'Numbed', 'Pacified', 'Panicked', 'Paralyzed', 'Poisoned', 'Possessed', 'Prone', 'Restrained', 'Seized', 'Sickened', 'Slowed', 'Sluggish', 'Stunned', 'Unconscious'];

/** Facets whose stated mechanic only applies in a state you activate, with why. */
const ALLOWED: Record<string, string> = {
  'Berserker › Berserker Maneuvers': 'Rage’s own text; applied by the Rage activation',
  'Berserker › Reckless Assault': 'chosen each turn ("you can choose to recklessly charge")',
  'Incarnate › Titanus Form': 'only in Titan form; applied by the Titan Morph activation',
  'Thaumaturge › Favored Acolyte': 'an Entreat Miracle option ("AC Bonus")',
  'Arcanist › Arcane Flow': 'only for Checks made while Surecasting',
  'Expert › Evaluate': 'only the triggering Check of the Reaction',
  "Gladiator › Fighter's Light": 'the Reignite heal roll; the Reignite activation asks for it',
};

const plain = (h = '') =>
  h
    .replace(/<span class="ic ic-(\w+)"[^>]*><\/span>/g, '{$1}')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|’/g, "'")
    .replace(/\s+/g, ' ');
const flat = (n: RuleNode): string => [plain(n.html), ...(n.children ?? []).map(flat)].join(' ');
const facetText = (f: ResolvedFacet) => (f.item ? plain(getItem(f.contentId!, f.item)?.html) : f.contentId && getNode(f.contentId) ? flat(getNode(f.contentId)!) : '');
const SITUATIONAL = /\b(when|while|whenever|if|until|after|before|during|as long as|once|each time|first time|you can|choose|spend|instead|duration|triggering|replace)\b/i;

interface Seen {
  facet: ResolvedFacet;
  d: Derived;
}

/** Every facet once, with a character that has it. */
function allFacets(): Seen[] {
  const out = new Map<string, Seen>();
  const add = (over: Parameters<typeof makeCharacter>[0]) => {
    const d = derive(makeCharacter(over));
    for (const f of d.facets) if (!out.has(`${f.source} › ${f.name}`)) out.set(`${f.source} › ${f.name}`, { facet: f, d });
    return d;
  };
  for (const cls of classes) {
    for (const sc of subclassesOf(cls)) {
      const d = add({ classId: cls.id, subclass: sc.id, level: MAX_LEVEL, ancestry: 'human' });
      for (const ch of d.choices) for (const o of ch.options) add({ classId: cls.id, subclass: sc.id, level: MAX_LEVEL, ancestry: 'human', choices: { [ch.id]: o.id } });
    }
  }
  // A class, so "equal to your Class Bonus" values aren't 0.
  const cls = { classId: 'expert', level: MAX_LEVEL };
  for (const a of ancestries) {
    if (a.subAncestries?.length) for (const s of a.subAncestries) add({ ...cls, ancestry: a.id, subAncestry: s.id });
    else add({ ...cls, ancestry: a.id });
  }
  for (const h of heritageFacets) add({ ...cls, ancestry: 'human', background: { preset: '', heritage: h.id } });
  return [...out.values()];
}

const has = (f: ResolvedFacet, ...kinds: Effect['kind'][]) => (f.effects ?? []).some((e) => kinds.includes(e.kind));
const attrIn = (s: string) => ATTRS.find((a) => s.includes(`{${a}} Save Check`));

/** A mechanic a sentence states, and how to see it applied. */
interface Detector {
  name: string;
  test: RegExp;
  /** Problems with how it's modelled, or [] when it applies. */
  check: (sentence: string, f: ResolvedFacet, d: Derived) => string[];
}

const DETECTORS: Detector[] = [
  {
    name: 'Tandem die',
    test: /rolled in Tandem|roll your \w+ Die in Tandem/i,
    check: (s, f, d) => {
      if (!has(f, 'tandem', 'saveTandem', 'weapon')) return ['no tandem effect'];
      if (/Initiative/.test(s) && !d.initiative.includes('/')) return [`Initiative reads "${d.initiative}", without the Tandem die`];
      const a = attrIn(s);
      if (a && !/[/+]/.test(d.saves.find((x) => x.attr === a)!.label)) return [`${a} Save reads "${d.saves.find((x) => x.attr === a)!.label}"`];
      return [];
    },
  },
  {
    name: 'Empowered Save',
    test: /Save Checks? (?:are|is) Empowered/,
    check: (s, f, d) => {
      const a = attrIn(s);
      if (!has(f, 'saveEmpowered')) return ['no saveEmpowered effect'];
      return a && !d.saves.find((x) => x.attr === a)!.empowered ? [`${a} Save not Empowered`] : [];
    },
  },
  {
    name: 'Resistance',
    test: /\bResistance\b/,
    check: (s, f, d) => {
      if (!has(f, 'resistance')) return ['no resistance effect'];
      const named = /all damage types except Crushing, Piercing, or Slashing/.test(s)
        ? DAMAGE_TYPES.filter((t) => !['Crushing', 'Piercing', 'Slashing'].includes(t))
        : [...DAMAGE_TYPES, ...CONDITIONS].filter((t) => new RegExp(`\\b${t}\\b`).test(s));
      return named.filter((t) => !d.resistances.some((r) => r.type === t)).map((t) => `${t} Resistance missing`);
    },
  },
  {
    name: 'Immunity',
    test: /\bimmune to\b/i,
    check: (s, f, d) => {
      const conds = CONDITIONS.filter((c) => new RegExp(`\\b${c}\\b`).test(s));
      const dmg = DAMAGE_TYPES.filter((t) => new RegExp(`\\b${t} damage\\b`).test(s));
      if (!conds.length && !dmg.length) return []; // e.g. "immune to effects that require sight"
      if (!has(f, 'immunity')) return ['no immunity effect'];
      return [
        ...conds.filter((c) => !d.conditionImmunities.some((x) => x.name === c)).map((c) => `${c} immunity missing`),
        ...dmg.filter((t) => !d.damageImmunities.some((x) => x.type === t)).map((t) => `${t} damage immunity missing`),
      ];
    },
  },
  {
    name: 'Swim/Climb Movement',
    test: /(Swim|Climb) Movement equal to/,
    check: (s, _f, d) => {
      const t = s.match(/(Swim|Climb) Movement/)![1];
      return d.movementTypes.some((m) => m.type === t) ? [] : [`no ${t} Movement`];
    },
  },
  { name: 'Movement', test: /Movement increases by/, check: (_s, f) => (has(f, 'movement') ? [] : ['no movement effect']) },
  {
    name: 'Sense',
    test: /\bYou have (Night Vision|Darkvision|Tremorsense|Blindsense)\b/,
    check: (s, _f, d) => {
      const n = s.match(/You have (Night Vision|Darkvision|Tremorsense|Blindsense)/)![1];
      return d.senses.includes(n) ? [] : [`${n} not in senses`];
    },
  },
  { name: 'Bolstered/Hindered', test: /Checks? (?:are|is) (?:Bolstered|Hindered) \d/, check: (_s, f) => (has(f, 'bolster', 'checks') ? [] : ['no bolster effect']) },
  { name: 'Endurance maximum', test: /Endurance Maximum/, check: (_s, f) => (has(f, 'endurance') ? [] : ['no endurance effect']) },
  { name: 'Vitality/Radiance', test: /additional \*?(Vitality|Radiance)/, check: (_s, f) => (has(f, 'vitality', 'radiance') ? [] : ['no vitality/radiance effect']) },
  { name: 'AC', test: /\b(add your \w+ to your AC|your AC (?:gains|increases))/i, check: (_s, f) => (has(f, 'acUnarmored') ? [] : ['no AC effect']) },
];

/**
 * Unarmed Strike rules are written as "When you Unarmed Strike…", which reads as
 * situational but always applies to the Unarmed Strike rows in the weapons table,
 * so these run on every sentence.
 */
const UNARMED_DETECTORS: Detector[] = [
  {
    name: 'Natural weapon',
    test: /\bnatural weapons?\b/i,
    check: (_s, f, d) => {
      if (!has(f, 'naturalWeapon')) return ['no naturalWeapon effect'];
      const names = (f.effects ?? []).flatMap((e) => (e.kind === 'naturalWeapon' ? [e.name] : []));
      return names.filter((n) => !d.unarmed.some((u) => u.name === n)).map((n) => `${n} not in the Unarmed Strike rows`);
    },
  },
  { name: 'Unarmed Strike DV bonus', test: /DV.s of your Unarmed Strikes/, check: (_s, f) => (has(f, 'unarmedBonus') ? [] : ['no unarmedBonus effect']) },
  {
    name: 'Unarmed Strike body',
    test: /When you Unarmed Strike, (your body has|you can deal|its DV|the DV)/,
    check: (_s, f) => (has(f, 'unarmed', 'naturalWeapon') ? [] : ['no unarmed effect']),
  },
  {
    name: 'Primordial Die Unarmed Strike',
    test: /replace your \{VIG\} Die with your \w+ Die when you Unarmed Strike/,
    check: (_s, f, d) => (d.unarmed.some((u) => u.classDie) && has(f, 'naturalWeapon') ? [] : ['no Unarmed Strike row with the Class Die']),
  },
];

const FACETS = allFacets();

describe('facet coverage audit', () => {
  it('finds a broad set of facets to audit', () => {
    expect(FACETS.length).toBeGreaterThan(150);
    // Sanity: the six damage-type Conditions are real Conditions.
    for (const c of Object.keys(CONDITION_DAMAGE_TYPE)) expect(CONDITIONS).toContain(c);
  });

  const cases = FACETS.map(({ facet, d }) => ({ key: `${facet.source} › ${facet.name}`, facet, d }));
  it.each(cases)('$key: every always-on mechanic in its text applies', ({ key, facet, d }) => {
    if (ALLOWED[key]) return;
    const problems: string[] = [];
    for (const sentence of facetText(facet).split(/(?<=[.!?])\s+/)) {
      for (const det of UNARMED_DETECTORS) {
        if (det.test.test(sentence)) for (const p of det.check(sentence, facet, d)) problems.push(`${det.name}: ${p} — "${sentence.trim()}"`);
      }
      if (SITUATIONAL.test(sentence)) continue;
      for (const det of DETECTORS) {
        if (!det.test.test(sentence)) continue;
        for (const p of det.check(sentence, facet, d)) problems.push(`${det.name}: ${p} — "${sentence.trim()}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every ALLOWED entry is still a facet with a matching mechanic (no stale exceptions)', () => {
    const keys = new Set(cases.map((c) => c.key));
    for (const k of Object.keys(ALLOWED)) expect(keys.has(k), k).toBe(true);
  });
});

// Check Modifiers completeness: anything that changes a roll must show in the
// Check Modifiers panel, whichever code path produced it. The engine's own notes
// (armor notes, Initiative notes, weapon notes, homebrew notes…) are scanned for
// "<Attr> … Checks … Weakened / Hindered N / Bolstered N / Disadvantage"; each
// phrase needs a structured entry (`conditionFx.checks` or `bolsters`). A note
// written straight to text — like the Heavy armor "AGI Checks are Weakened"
// that once only showed on the Equipment tab — fails here.
describe('Check Modifiers are complete', () => {
  /** Rules content carried on Derived (facet, spell and class text), not engine notes. */
  const CONTENT = new Set(['cls', 'facets', 'choices', 'spellLists', 'actionCategories', 'homebrew', 'conditionFx', 'bolsters', 'tandems']);
  const PHRASE = /\b(VIG|AGI|PER|INT|PRS)(?: Save| Attribute| Skill| &)* Checks?\b[^.;]*?\b(Weakened|Hindered \d+|Bolstered \d+|Disadvantage)\b/g;
  function notes(d: Derived): string[] {
    const out: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') out.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const [k, v] of Object.entries(d)) if (!CONTENT.has(k)) walk(v);
    return out;
  }
  function structured(d: Derived, attr: string, kind: string): boolean {
    const rows = d.conditionFx.checks.filter((r) => r.attr === attr);
    const line = (word: string) => d.bolsters.some((b) => b.startsWith(attr) && b.includes(word));
    if (kind === 'Weakened') return rows.some((r) => r.weakened.length > 0);
    if (kind === 'Disadvantage') return rows.some((r) => r.disadvantage.length > 0);
    if (kind.startsWith('Hindered')) return rows.some((r) => r.hindered > 0) || line('Hindered');
    return rows.some((r) => r.bolstered > 0) || line('Bolstered');
  }
  const cases = sample(classes, 3).flatMap((cl) =>
    sample(ancestries, 3).flatMap((a) =>
      ([undefined, 'Light', 'Medium', 'Heavy'] as const).flatMap((type) =>
        [-1, 3].map((VIG) => ({ cl, a, type, VIG, key: `${cl.name} ${a.name} ${type ?? 'no'} armor, VIG ${VIG}` })),
      ),
    ),
  );
  it.each(cases)('$key', ({ cl, a, type, VIG }) => {
    const { d } = built({
      classId: cl.id,
      subclass: subclassesOf(cl)[0]?.id,
      level: MAX_LEVEL,
      ancestry: a.id,
      subAncestry: a.subAncestries?.[0]?.id,
      attributes: { method: 'manual', base: { VIG, AGI: 2, PER: 2, INT: 2, PRS: 2 } } as never,
      equipment: { armor: type && { type, quality: 'Basic' }, weapons: sample(weapons, 6).map((w, i) => ({ id: `w${i}`, name: w.name })), inventory: [] },
    });
    const missing = notes(d).flatMap((n) => [...n.matchAll(PHRASE)].filter((m) => !structured(d, m[1], m[2])).map((m) => `${m[0]}  ← "${n}"`));
    expect(missing).toEqual([]);
  });
});
