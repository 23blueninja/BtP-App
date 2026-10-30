// Class mechanics. Class tables, facet lists, Alignment and Endurance are read
// from the rules; this file only adds what the engine needs to automate.
import type { ChoiceDef, ClassDef, Effect, SpellListDef } from './types';

const C = 'classes';

const maneuverList = (types: string[], extra: Partial<SpellListDef> = {}): SpellListDef => ({
  id: 'maneuvers',
  label: 'Maneuvers',
  mode: 'known',
  count: { column: 'Known' },
  pool: { kind: 'maneuver', types, maxLevelColumn: 'Max' },
  ...extra,
});

const attrChoice = (id: string, label: string, level: number, base: string): ChoiceDef => ({
  id,
  label,
  level,
  options: [
    { id: 'VIG', name: 'Vigor', contentId: `${base}/vigor` },
    { id: 'AGI', name: 'Agility', contentId: `${base}/agility` },
    { id: 'PER', name: 'Perception', contentId: `${base}/perception` },
  ],
});

/** Gladiator Combat Styles: how each changes Attack Checks with certain weapons. */
const combatStyleEffects: Record<string, Effect[]> = {
  Archery: [{ kind: 'weapon', property: 'Drawn', tandem: 'PER' }],
  Dueling: [{ kind: 'weapon', property: 'Versatile', note: 'Two hands: Deadly DV +1. One hand: Seize or Shove as part of a Strike for 1 more AP.' }],
  Fencer: [{ kind: 'weapon', property: 'Deft', tandem: 'AGI' }],
  'Greatweapon Fighting': [{ kind: 'weapon', property: 'Massive', bolster: 1 }],
  'Heavy Weapon Fighting': [{ kind: 'weapon', property: 'Heavy', melee: true, tandem: 'VIG' }],
  Juggernaut: [{ kind: 'weapon', property: 'Heavy', note: 'You can ignore the Two-Handed property.' }],
};

export const classes: ClassDef[] = [
  {
    id: 'arcanist',
    name: 'Arcanist',
    contentId: `${C}/arcanist`,
    tableId: `${C}/arcanist/arcanist-class-table`,
    dieName: 'Arcana',
    actions: ['Arcane'],
    armor: [],
    armorTraining: 'None',
    weaponTraining: 'Simple weapons',
    saveTandem: ['INT'],
    saveEmpowered: true,
    basicSkillEmpowered: 'INT',
    spellAttr: 'INT',
    resources: [{ name: 'Prisma', column: 'Prisma Limit', mode: 'limit' }],
    trackers: ['Prismaburn'],
    subclassLabel: 'Arcane Triumvirate',
    subclassListId: `${C}/arcane-triumvirates`,
    facetExtras: {
      'prismatic-realignment': { uses: { count: 1, per: 'Long Rest' } },
    },
    spellLists: [
      {
        id: 'grimoire',
        label: 'Grimoire',
        mode: 'known',
        count: { byLevel: [5, 7] },
        pool: { kind: 'spell', group: 'Arcana', tiers: ['Arcanum'], maxLevelColumn: 'Max' },
        note: 'Five 1st-level arcana at 1st level; your Triumvirate adds more each level.',
      },
      {
        id: 'prepared',
        label: 'Prepared Arcana',
        mode: 'prepared',
        from: 'grimoire',
        count: { level: true, attr: 'INT' },
        pool: { kind: 'spell', group: 'Arcana', tiers: ['Arcanum'], maxLevelColumn: 'Max' },
        note: 'Arcanist level plus INT points, chosen each Long Rest.',
      },
    ],
    subclassExtras: {
      'kinesis-triumvirate': {
        facetExtras: {
          'kinetic-font': { uses: { count: 1, per: 'Long Rest' } },
        },
        spellLists: [
          {
            id: 'cantrips',
            label: 'Cantrips',
            mode: 'known',
            count: { base: 3 },
            pool: { kind: 'spell', group: 'Arcana', tiers: ['Cantrip'] },
            note: 'Two must be Kinesis arcana (Fire, Ice, or Arc).',
          },
        ],
      },
    },
  },
  {
    id: 'berserker',
    name: 'Berserker',
    contentId: `${C}/berserker`,
    tableId: `${C}/berserker/berserker-class-table`,
    dieName: 'Wild',
    actions: ['Combat'],
    armor: [{ kind: 'levelUnarmored' }],
    armorTraining: 'None (add Berserker level to AC while unarmored)',
    weaponTraining: 'Simple weapons; any Heavy or Massive melee weapon',
    saveTandem: ['VIG', 'PER', 'AGI'],
    basicSkillEmpowered: 'VIG',
    maneuverDie: true,
    resources: [{ name: 'Stamina', column: 'Stamina', mode: 'pool' }],
    subclassLabel: 'Wild Fervor',
    subclassListId: `${C}/wild-fervors`,
    facetExtras: {
      'barbarous-light': {
        effects: [
          { kind: 'tandem', what: 'Initiative Checks', die: 'class' },
          { kind: 'jump', mode: 'powerful' },
          // Unarmed Strikes: Pushing, DV equal to your VIG points, Deadly DV twice that.
          { kind: 'unarmed', dv: { attr: 'VIG' }, deadly: 'twiceDv', properties: ['Pushing'] },
        ],
      },
      'somatic-wellspring': { uses: { count: 1, per: 'Rest' } },
    },
    spellLists: [maneuverList(['Feral', 'Instinctual'], { granted: [`${C}/berserker/berserker-maneuvers/rage`], note: 'Includes Rage.' })],
    choices: [attrChoice('somatic-wellspring', 'Somatic Wellspring Attribute', 2, `${C}/berserker/somatic-wellspring`)],
    subclassExtras: {
      'roaring-fervor': { facetExtras: { 'voice-of-the-feral': { uses: { count: 1, per: 'Rest' } } } },
    },
  },
  {
    id: 'champion',
    name: 'Champion',
    contentId: `${C}/champion`,
    tableId: `${C}/champion/champion-class-table`,
    dieName: 'Devotion',
    actions: ['Combat', 'Supernatural'],
    armor: [{ kind: 'bonusWith', armor: ['Light', 'Medium', 'Heavy'] }],
    armorTraining: 'All armor',
    weaponTraining: 'Any weapon',
    saveTandem: ['VIG', 'PRS'],
    basicSkillEmpowered: 'PRS',
    spellAttr: 'PRS',
    maneuverDie: true,
    resources: [{ name: 'Will', column: 'Will', mode: 'pool' }],
    subclassLabel: 'Champion’s Cause',
    subclassListId: `${C}/champions-causes`,
    facetExtras: {
      'apostles-light': {
        effects: [
          { kind: 'vitality', amount: 'halfClassBonus' },
          { kind: 'tandem', what: 'Survival Saves', die: 'class' },
        ],
      },
      undaunted: { uses: { count: 1, per: 'Rest' } },
    },
    choices: [
      {
        id: 'champions-aura',
        label: 'Champion’s Aura',
        level: 1,
        options: [
          { id: 'connection', name: 'Connection', contentId: `${C}/champion/champions-aura~2/connection`, effects: [{ kind: 'alignment', light: 'Temporal' }] },
          { id: 'force', name: 'Force', contentId: `${C}/champion/champions-aura~2/force`, effects: [{ kind: 'alignment', light: 'Infernal' }] },
          { id: 'subversion', name: 'Subversion', contentId: `${C}/champion/champions-aura~2/subversion`, effects: [{ kind: 'alignment', light: 'Lunar' }] },
        ],
      },
    ],
    subclassExtras: {
      'the-throne': {
        facetExtras: { 'evoke-submission': { uses: { count: 1, per: 'Rest' } } },
        spellLists: [
          {
            id: 'exploits',
            label: 'Glorious Exploits',
            mode: 'known',
            level: 2,
            count: { column: 'Known' },
            granted: [`${C}/champion/glorious-exploits/casting-spells/smite`],
            pool: {
              kind: 'maneuver',
              types: ['Martial', 'Psychological'],
              maxLevelColumn: 'Max',
              or: [{ kind: 'spell', group: 'Evocations', types: ['Flame', 'Infernal'], maxLevelColumn: 'Max' }],
            },
            note: 'Smite plus two Martial or Psychological maneuvers or Flame or Infernal evocations.',
          },
        ],
      },
      // Playtest Cause (commented out in the rules source; parse-rules includes it up to level 2).
      darkness: {
        facetExtras: {
          'vital-sacrifice': { uses: { count: 1, per: 'Rest' } },
          endwalker: { effects: [{ kind: 'darkness' }, { kind: 'movement', amount: 'darkness' }, { kind: 'damageReduction', amount: 'halfDarkness' }] },
        },
        spellLists: [
          {
            id: 'exploits',
            label: 'Glorious Exploits',
            mode: 'known',
            level: 2,
            count: { column: 'Known' },
            granted: [`${C}/champion/glorious-exploits/casting-spells/smite`],
            pool: {
              kind: 'maneuver',
              types: ['Feral', 'Martial'],
              maxLevelColumn: 'Max',
              // The Cause also lists Void Evocations; there are none in the rules yet.
              or: [{ kind: 'spell', group: 'Evocations', types: ['Infernal'], maxLevelColumn: 'Max' }],
            },
            note: 'Smite plus two Feral or Martial maneuvers or Infernal evocations (no Void evocations exist yet).',
          },
        ],
      },
    },
  },
  {
    id: 'expert',
    name: 'Expert',
    contentId: `${C}/expert`,
    tableId: `${C}/expert/expert-class-table`,
    dieName: 'Tactical',
    actions: [],
    armor: [{ kind: 'bonusWith', armor: ['Light', 'Medium'] }],
    armorTraining: 'Light and Medium armor',
    weaponTraining: 'Simple weapons; any Light, Close-up, or Precise weapon',
    saveTandem: ['PER', 'INT'],
    basicSkillEmpowered: 'PER',
    maneuverDie: true,
    resources: [{ name: 'Stamina', column: 'Stamina', mode: 'pool' }],
    subclassLabel: 'Expert Practice',
    subclassListId: `${C}/expert-practices`,
    facetExtras: {
      expertise: { effects: [{ kind: 'hobbies', count: 2, rank: 'Amateur' }] },
    },
    spellLists: [maneuverList(['Instinctual', 'Tactical'])],
    subclassExtras: {
      investigator: {
        facetExtras: {
          'professional-investigator': { effects: [{ kind: 'profession', count: 1, rank: 'Proficient', name: 'Investigator' }] },
          'eagle-eyed': { effects: [{ kind: 'tandem', what: 'PER Attribute Checks', die: 'class' }] },
        },
      },
    },
  },
  {
    id: 'gladiator',
    name: 'Gladiator',
    contentId: `${C}/gladiator`,
    tableId: `${C}/gladiator/gladiator-class-table`,
    dieName: 'Martial',
    actions: ['Combat'],
    armor: [{ kind: 'bonusWith', armor: ['Light', 'Medium', 'Heavy'] }],
    armorTraining: 'All armor',
    weaponTraining: 'Any weapon (Martial Die may replace Attribute Die for Weapon Attack Checks)',
    saveTandem: ['PER', 'choice'],
    basicSkillEmpowered: 'PER',
    maneuverDie: true,
    resources: [{ name: 'Stamina', column: 'Stamina', mode: 'pool' }],
    subclassLabel: 'Martial Training',
    subclassListId: `${C}/martial-trainings`,
    facetExtras: {
      // An additional use between Rests at 8th level.
      'action-flare': { uses: { count: { base: 1, at: { 8: 1 } }, per: 'Rest' } },
    },
    choices: [
      {
        id: 'combat-style',
        label: 'Combat Style',
        level: 2,
        options: ['Archery', 'Defensive Fighting', 'Dueling', 'Fencer', 'Greatweapon Fighting', 'Heavy Weapon Fighting', 'Juggernaut'].map((n) => ({
          id: n.toLowerCase().replace(/ /g, '-'),
          name: n,
          contentId: `${C}/gladiator/combat-styles/${n.toLowerCase().replace(/ /g, '-')}`,
          effects: combatStyleEffects[n],
        })),
      },
    ],
    subclassExtras: {
      victor: {
        facetExtras: {
          'surge-to-victory': { uses: { count: 1, per: 'Rest' } },
          'peerless-athlete': {
            effects: [
              { kind: 'tandem', what: 'Initiative Checks', die: 'class' },
              { kind: 'tandem', what: 'VIG Attribute Checks', die: 'class' },
              { kind: 'bolster', what: 'Basic VIG Skill Checks', amount: 1 },
              { kind: 'saveEmpowered', attr: 'VIG' },
            ],
          },
        },
        spellLists: [maneuverList(['Feral', 'Martial', 'Instinctual'])],
      },
    },
  },
  {
    id: 'incarnate',
    name: 'Incarnate',
    contentId: `${C}/incarnate`,
    tableId: `${C}/incarnate/incarnate-class-table`,
    dieName: 'Primordial',
    actions: [],
    armor: [{ kind: 'levelUnarmored' }, { kind: 'bonusWith', armor: ['Light'] }],
    armorTraining: 'Light armor (add Incarnate level to AC while unarmored)',
    weaponTraining: 'Simple weapons',
    saveTandem: ['PER', 'PRS'],
    basicSkillEmpowered: 'PER',
    spellAttr: 'PRS',
    maneuverDie: true,
    resources: [{ name: 'Stamina', column: 'Stamina', mode: 'pool' }],
    subclassLabel: 'Primordial Soul',
    subclassListId: `${C}/primordial-souls`,
    facetExtras: {
      'titanus-form': { uses: { count: 1, per: 'Long Rest' } },
      // Ferocious Strikes: Unarmed Strike with the Primordial Die; DV half your Class Bonus, Deadly DV your Class Bonus.
      'primeval-light': {
        effects: [{ kind: 'naturalWeapon', name: 'Unarmed Strike (Primordial Die)', damage: 'Crushing', properties: ['Close-up'], dv: 'halfClassBonus', deadly: 'classBonus', die: 'class' }],
      },
    },
    spellLists: [
      maneuverList(['Feral', 'Instinctual'], {
        note: 'The rules list Feral and Instinctual, then say “(Instinctual and Tactical)”; Feral and Instinctual are used here.',
      }),
    ],
    choices: [
      {
        id: 'manifestation',
        label: 'Manifestation',
        level: 2,
        options: [
          {
            id: 'VIG',
            name: 'Vigor',
            contentId: `${C}/incarnate/manifestations~2/vigor`,
            effects: [
              { kind: 'endurance', amount: 'twiceLevel' },
              { kind: 'spellList', list: { id: 'manifestation', label: 'Manifestation Cantrip', mode: 'known', count: { base: 1 }, pool: { kind: 'spell', group: 'Arcana', types: ['Bio'], tiers: ['Cantrip'] } } },
            ],
          },
          {
            id: 'AGI',
            name: 'Agility',
            contentId: `${C}/incarnate/manifestations~2/agility`,
            effects: [{ kind: 'spellList', list: { id: 'manifestation', label: 'Manifestation Maneuver', mode: 'known', count: { base: 1 }, pool: { kind: 'maneuver', types: ['Martial'], maxLevelColumn: 'Max' } } }],
          },
          {
            id: 'PER',
            name: 'Perception',
            contentId: `${C}/incarnate/manifestations~2/perception`,
            effects: [
              { kind: 'sense', name: 'Night Vision' },
              { kind: 'spellList', list: { id: 'manifestation', label: 'Manifestation Cantrip', mode: 'known', count: { base: 1 }, pool: { kind: 'spell', group: 'Arcana', types: ['Mind'], tiers: ['Cantrip'] } } },
            ],
          },
          {
            id: 'INT',
            name: 'Intelligence',
            contentId: `${C}/incarnate/manifestations~2/intelligence`,
            effects: [
              { kind: 'saveTandem', attr: 'INT' },
              { kind: 'spellList', list: { id: 'manifestation', label: 'Manifestation Maneuver', mode: 'known', count: { base: 1 }, pool: { kind: 'maneuver', types: ['Tactical'], maxLevelColumn: 'Max' } } },
            ],
          },
          {
            id: 'PRS',
            name: 'Presence',
            contentId: `${C}/incarnate/manifestations~2/presence`,
            effects: [
              { kind: 'tandem', what: 'PRS Attribute Checks', die: 'class' },
              { kind: 'spellList', list: { id: 'manifestation', label: 'Manifestation Maneuver', mode: 'known', count: { base: 1 }, pool: { kind: 'maneuver', types: ['Psychological'], maxLevelColumn: 'Max' } } },
            ],
          },
        ],
      },
    ],
    subclassExtras: {
      'the-king': {
        facetExtras: {
          // "If you already have Swim Movement, it increases by 2 spaces."
          amphibious: { effects: [{ kind: 'movementType', type: 'Swim', amount: 'movement', ifAlready: 2 }] },
          // Claws: Unarmed Strikes can deal Slashing damage instead of Crushing.
          'king-of-beasts': { effects: [{ kind: 'actions', categories: ['Combat'] }, { kind: 'unarmed', damage: ['Slashing'] }] },
        },
        spellLists: [
          {
            id: 'soul-spells',
            label: 'Soul Spells',
            mode: 'known',
            count: { base: 2 },
            pool: { kind: 'spell', group: 'Evocations', types: ['Frost'], maxLevelColumn: 'Max' },
            note: 'Two Frost evocations, cast by Channeling.',
          },
        ],
      },
    },
  },
  {
    id: 'luminary',
    name: 'Luminary',
    contentId: `${C}/luminary`,
    tableId: `${C}/luminary/luminary-class-table`,
    dieName: 'Lumen',
    actions: ['Arcane'],
    armor: [],
    armorTraining: 'None',
    weaponTraining: 'Simple weapons',
    saveTandem: ['VIG', 'PRS'],
    basicSkillEmpowered: 'VIG',
    spellAttr: 'choice',
    spellDie: 'attr',
    resources: [{ name: 'Light', column: 'Light Limit', mode: 'limit' }],
    subclassLabel: 'Inner Luminance',
    subclassListId: `${C}/inner-luminance`,
    facetExtras: {
      'natural-radiance': { effects: [{ kind: 'radiance', amount: 'halfClassBonus' }] },
    },
    subclassExtras: {
      'flaming-luminance': {
        facetExtras: {
          'enduring-warmth': { effects: [{ kind: 'resistance', type: 'Thermic', amount: 'classBonus' }] },
          eruption: { uses: { count: 1, per: 'Rest' } },
        },
        spellLists: [
          { id: 'cantrips', label: 'Fire Cantrips', mode: 'known', count: { base: 2 }, pool: { kind: 'spell', group: 'Arcana', types: ['Fire'], tiers: ['Cantrip'] } },
          {
            id: 'arcana',
            label: 'Fire Arcana',
            mode: 'known',
            count: { byLevel: [2, 3] },
            pool: { kind: 'spell', group: 'Arcana', types: ['Fire'], tiers: ['Arcanum'], maxLevelColumn: 'Max' },
            note: 'Two at 1st level, plus one each Luminary level (two on odd levels).',
          },
        ],
      },
    },
  },
  {
    id: 'thaumaturge',
    name: 'Thaumaturge',
    contentId: `${C}/thaumaturge`,
    tableId: `${C}/thaumaturge/thaumaturge-class-table`,
    dieName: 'Miracle',
    actions: ['Supernatural'],
    armor: [{ kind: 'bonusWith', armor: ['Light', 'Medium'] }],
    armorTraining: 'Light and Medium armor',
    weaponTraining: 'Simple weapons; any melee weapon without the Two-Handed property',
    saveTandem: ['PRS'],
    saveEmpowered: true,
    basicSkillEmpowered: 'PRS',
    spellAttr: 'PRS',
    resources: [{ name: 'Favor', column: 'Favor Limit', mode: 'limit' }],
    trackers: ['Indebted'],
    subclassLabel: 'Divine Domain',
    subclassListId: `${C}/divine-domains`,
    facetExtras: {
      'favored-acolyte': { uses: { count: 1, per: 'Rest' } },
    },
    subclassExtras: {
      'cosmos-domain': {
        spellLists: [
          {
            id: 'mantras',
            label: 'Mantras',
            mode: 'known',
            count: { base: 3 },
            pool: {
              kind: 'spell',
              group: 'Evocations',
              types: ['Frost', 'Pneuma', 'Lunar', 'Platinum'],
              tiers: ['Mantra'],
              or: [{ kind: 'spell', group: 'Arcana', types: ['Mind', 'Moon'], tiers: ['Cantrip'] }],
            },
            note: 'Frost, Pneuma, Lunar, or Platinum mantras (or Mind/Moon cantrips).',
          },
          {
            id: 'prepared',
            label: 'Prepared Spells',
            mode: 'prepared',
            count: { level: true, attr: 'PRS' },
            pool: {
              kind: 'spell',
              group: 'Evocations',
              types: ['Frost', 'Pneuma', 'Lunar', 'Platinum'],
              tiers: ['Evocation'],
              maxLevelColumn: 'Max',
              or: [{ kind: 'spell', group: 'Arcana', types: ['Mind', 'Moon'], tiers: ['Arcanum'], maxLevelColumn: 'Max' }],
            },
            note: 'Thaumaturge level plus PRS points, chosen each Long Rest.',
          },
        ],
      },
    },
  },
  {
    id: 'troubadour',
    name: 'Troubadour',
    contentId: `${C}/troubadour`,
    tableId: `${C}/troubadour/troubadour-class-table`,
    dieName: 'Art',
    actions: ['Supernatural'],
    armor: [{ kind: 'bonusWith', armor: ['Light', 'Medium'] }],
    armorTraining: 'Light and Medium armor',
    weaponTraining: 'Any weapon that isn’t a Two-Handed melee weapon',
    saveTandem: ['PER', 'PRS'],
    basicSkillEmpowered: 'PRS',
    spellAttr: 'PRS',
    spellDie: 'attr',
    resources: [{ name: 'Wonder', column: 'Wonder', mode: 'pool' }],
    subclassLabel: 'Artistic Medium',
    subclassListId: `${C}/artistic-mediums`,
    facetExtras: {
      'practice-drills': { uses: { count: 1, per: 'Rest' } },
    },
    choices: [
      {
        id: 'favored-genre',
        label: 'Favored Genre',
        level: 1,
        options: [
          ['comedy', 'Comedy', 'Lunar', ['Flame', 'Pneuma', 'Mordant', 'Lunar', 'Platinum']],
          ['tragedy', 'Tragedy', 'Pneuma', ['Pneuma', 'Velvet', 'Infernal', 'Lunar', 'Platinum']],
          ['romance', 'Romance', 'Velvet', ['Flame', 'Frost', 'Soma', 'Velvet', 'Platinum']],
        ].map(([id, name, light, types]) => ({
          id: id as string,
          name: name as string,
          contentId: `${C}/favored-genres/${id}`,
          effects: [
            { kind: 'alignment' as const, light: light as 'Lunar' },
            {
              kind: 'spellList' as const,
              list: {
                id: 'prepared',
                label: 'Prepared Spells',
                mode: 'prepared' as const,
                level: 2,
                count: { classBonus: true, attr: 'PRS' as const },
                pool: { kind: 'spell' as const, group: 'Evocations' as const, types: types as string[], maxLevelColumn: 'Max' },
                note: 'Troubadour Bonus plus PRS points, chosen each Long Rest.',
              },
            },
          ],
        })),
      },
    ],
  },
];

export const classById = new Map(classes.map((c) => [c.id, c]));
