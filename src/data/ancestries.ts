import type { AncestryDef, FacetDef } from './types';

const A = 'player-characters/ancestries';

// Facet helper: text comes from the named item in the ancestry's Facets section.
const f = (contentId: string, name: string, effects: FacetDef['effects'] = []): FacetDef => ({ name, contentId, item: name, effects });

const nightVision = (id: string) => f(id, 'Night Vision', [{ kind: 'sense', name: 'Night Vision' }]);
const extraEndurance = (id: string) => f(id, 'Extra Endurance', [{ kind: 'endurance', amount: 'twiceLevel' }]);
const fast = (id: string) => f(id, 'Fast', [{ kind: 'movement', amount: 1 }]);
// Powerful Build: Bulk shift, and both DVs of your Unarmed Strikes get a bonus equal to your VIG points.
const powerfulBuild = (id: string) => f(id, 'Powerful Build', [{ kind: 'bulkShift', amount: 1 }, { kind: 'unarmedBonus', amount: { attr: 'VIG' } }]);

const soli = (light: AncestryDef['facets'][number]['name'], facets: (id: string) => FacetDef[]) => {
  const slug = light.toLowerCase();
  const id = `${A}/soli/facets/${slug}`;
  return { id: slug, name: light, contentId: id, facets: facets(id) };
};

export const ancestries: AncestryDef[] = [
  {
    id: 'cogitani',
    name: 'Cogitani',
    contentId: `${A}/cogitani`,
    facetsId: `${A}/cogitani/facets`,
    facets: [
      f(`${A}/cogitani/facets`, 'Brilliant Soul', [{ kind: 'alignment', light: 'Pneuma' }]),
      f(`${A}/cogitani/facets`, 'Resilient Mind', [{ kind: 'resistance', type: 'Psychic', amount: 'classBonus' }]),
      f(`${A}/cogitani/facets`, 'Vibrant Thought', [{ kind: 'bolster', what: 'INT Save & Skill Checks', amount: 1 }]),
    ],
  },
  {
    id: 'corpug',
    name: 'Corpug',
    contentId: `${A}/corpug`,
    facetsId: `${A}/corpug/facets`,
    facets: [
      f(`${A}/corpug/facets`, 'Ferocious Soul', [{ kind: 'alignment', light: 'Soma' }]),
      f(`${A}/corpug/facets`, 'Grit', [{ kind: 'bolster', what: 'VIG Save Checks', amount: 1 }]),
      powerfulBuild(`${A}/corpug/facets`),
      f(`${A}/corpug/facets`, 'Resilient Body', [{ kind: 'resistance', type: 'Somatic', amount: 'classBonus' }]),
    ],
  },
  {
    id: 'daxan',
    name: 'Daxan',
    contentId: `${A}/daxan`,
    facetsId: `${A}/daxan/facets`,
    facets: [
      f(`${A}/daxan/facets`, 'Salty Soul', [{ kind: 'alignment', light: 'Mordant' }]),
      f(`${A}/daxan/facets`, 'Acidic Adaptation', [{ kind: 'resistance', type: 'Caustic', amount: 'classBonus' }]),
      f(`${A}/daxan/facets`, 'Oceanic', [{ kind: 'movementType', type: 'Swim', amount: 'movement' }]),
      f(`${A}/daxan/facets`, 'Claw and Fang', [
        { kind: 'naturalWeapon', name: 'Claws', damage: 'Slashing', properties: ['Light'], dv: 'halfClassBonus', deadly: 'classBonus' },
        { kind: 'naturalWeapon', name: 'Maw', damage: 'Piercing', properties: ['Pulling'], dv: 'halfClassBonus', deadly: 'classBonus' },
      ]),
      nightVision(`${A}/daxan/facets`),
    ],
  },
  {
    id: 'human',
    name: 'Human',
    contentId: `${A}/human`,
    facetsId: `${A}/human/facets`,
    facets: [
      f(`${A}/human/facets`, 'Flaming Soul', [{ kind: 'alignment', light: 'Flame' }]),
      f(`${A}/human/facets`, 'Bonus Attribute Point', [{ kind: 'attributePoint', count: 1 }]),
      f(`${A}/human/facets`, 'Extra Hobbies', [{ kind: 'hobbies', count: 2, rank: 'Novice' }]),
      f(`${A}/human/facets`, 'Radiant', [{ kind: 'radiance', amount: 1 }]),
    ],
  },
  {
    id: 'mundalf',
    name: 'Mundalf',
    contentId: `${A}/mundalf`,
    facetsId: `${A}/mundalf/facets`,
    facets: [
      f(`${A}/mundalf/facets`, 'Stone Soul', [{ kind: 'alignment', light: 'Temporal' }]),
      extraEndurance(`${A}/mundalf/facets`),
      f(`${A}/mundalf/facets`, 'Extra Vitality', [{ kind: 'vitality', amount: 1 }]),
      f(`${A}/mundalf/facets`, 'Mundalven Resilience', [
        { kind: 'resistance', type: 'Crushing', amount: 'classBonus' },
        { kind: 'resistance', type: 'Stunned', amount: 'halfClassBonus' },
      ]),
      nightVision(`${A}/mundalf/facets`),
    ],
  },
  {
    id: 'ori',
    name: 'Ori',
    contentId: `${A}/ori`,
    facetsId: `${A}/ori/facets`,
    facets: [
      f(`${A}/ori/facets`, 'Powerful Soul', [{ kind: 'alignment', light: 'Infernal' }]),
      f(`${A}/ori/facets`, 'Blood Frenzy'),
      extraEndurance(`${A}/ori/facets`),
      f(`${A}/ori/facets`, 'Unyielding', [{ kind: 'bolster', what: 'PRS Save Checks', amount: 1 }]),
    ],
  },
  {
    id: 'praedan',
    name: 'Praedan',
    contentId: `${A}/praedan`,
    facetsId: `${A}/praedan/facets`,
    facets: [
      f(`${A}/praedan/facets`, 'Wild Soul', [{ kind: 'alignment', light: 'Frost' }]),
      f(`${A}/praedan/facets`, 'Nightblooded', [{ kind: 'resistance', type: 'Arctic', amount: 'classBonus' }]),
      nightVision(`${A}/praedan/facets`),
      f(`${A}/praedan/facets`, 'Keen Senses', [{ kind: 'bolster', what: 'PER Attribute Checks', amount: 1 }]),
    ],
    subAncestries: [
      {
        id: 'canine',
        name: 'Canine',
        contentId: `${A}/praedan/facets/canine`,
        facets: [
          extraEndurance(`${A}/praedan/facets/canine`),
          f(`${A}/praedan/facets/canine`, 'Extra Hobbies', [{ kind: 'hobbies', count: 2, rank: 'Novice' }]),
          fast(`${A}/praedan/facets/canine`),
        ],
      },
      {
        id: 'feline',
        name: 'Feline',
        contentId: `${A}/praedan/facets/feline`,
        facets: [
          f(`${A}/praedan/facets/feline`, 'Claws', [{ kind: 'naturalWeapon', name: 'Claws', damage: 'Slashing', properties: ['Pulling'], dv: 'halfClassBonus', deadly: 'classBonus' }]),
          f(`${A}/praedan/facets/feline`, 'Climber', [{ kind: 'movementType', type: 'Climb', amount: 'movement' }]),
          fast(`${A}/praedan/facets/feline`),
        ],
      },
      {
        id: 'pinnipine',
        name: 'Pinnipine',
        contentId: `${A}/praedan/facets/pinnipine`,
        facets: [
          f(`${A}/praedan/facets/pinnipine`, 'Diver', [{ kind: 'movementType', type: 'Swim', amount: 'movement' }]),
          f(`${A}/praedan/facets/pinnipine`, 'Blubbery', [
            { kind: 'resistance', type: 'Crushing', amount: 'classBonus' },
            { kind: 'resistance', type: 'Freezing', amount: 'halfClassBonus' },
          ]),
        ],
      },
      {
        id: 'ursine',
        name: 'Ursine',
        contentId: `${A}/praedan/facets/ursine`,
        facets: [
          f(`${A}/praedan/facets/ursine`, 'Bear Claws', [{ kind: 'naturalWeapon', name: 'Bear Claws', damage: 'Slashing', properties: ['Brutal'], dv: 'halfClassBonus', deadly: 'classBonus' }]),
          f(`${A}/praedan/facets/ursine`, 'Extra Vitality', [{ kind: 'vitality', amount: 1 }]),
          powerfulBuild(`${A}/praedan/facets/ursine`),
        ],
      },
    ],
  },
  {
    id: 'soli',
    name: 'Soli',
    contentId: `${A}/soli`,
    facetsId: `${A}/soli/facets`,
    facets: [
      f(`${A}/soli/facets`, 'Sturdy Scales', [
        { kind: 'resistance', type: 'Slashing', amount: 'halfClassBonus' },
        { kind: 'noSlashingVulnerability' },
        { kind: 'acUnarmored', amount: 'level' },
      ]),
    ],
    subAncestries: [
      soli('Flame', (id) => [
        f(id, 'Flaming Soul', [{ kind: 'alignment', light: 'Flame' }]),
        f(id, 'Heat Resistant', [
          { kind: 'resistance', type: 'Thermic', amount: 'classBonus' },
          { kind: 'resistance', type: 'Burning', amount: 'halfClassBonus' },
        ]),
        f(id, 'Extra Hobby', [{ kind: 'hobbies', count: 1, rank: 'Novice' }]),
        f(id, 'Extra Radiance', [{ kind: 'radiance', amount: 1 }]),
      ]),
      soli('Frost', (id) => [
        f(id, 'Frozen Soul', [{ kind: 'alignment', light: 'Frost' }]),
        f(id, 'Cold Resistant', [
          { kind: 'resistance', type: 'Arctic', amount: 'classBonus' },
          { kind: 'resistance', type: 'Freezing', amount: 'halfClassBonus' },
        ]),
        f(id, 'Claws', [{ kind: 'naturalWeapon', name: 'Claws', damage: 'Slashing', properties: ['Precise'], dv: 'halfClassBonus', deadly: 'classBonus' }]),
        fast(id),
        nightVision(id),
      ]),
      soli('Pneuma', (id) => [
        f(id, 'Enlightened Soul', [{ kind: 'alignment', light: 'Pneuma' }]),
        f(id, 'Bright Mind', [{ kind: 'bolster', what: 'INT Attribute Checks', amount: 1 }]),
        f(id, 'Extra Hobby', [{ kind: 'hobbies', count: 1, rank: 'Novice' }]),
        f(id, 'Sturdy Mind', [
          { kind: 'resistance', type: 'Psychic', amount: 'classBonus' },
          { kind: 'resistance', type: 'Muddled', amount: 'halfClassBonus' },
          { kind: 'resistance', type: 'Dulled', amount: 'halfClassBonus' },
        ]),
      ]),
      soli('Soma', (id) => [
        f(id, 'Raging Soul', [{ kind: 'alignment', light: 'Soma' }]),
        powerfulBuild(id),
        f(id, 'Strong', [{ kind: 'bolster', what: 'VIG Attribute Checks', amount: 1 }]),
        f(id, 'Sturdy Body', [
          { kind: 'resistance', type: 'Somatic', amount: 'classBonus' },
          { kind: 'resistance', type: 'Sickened', amount: 'halfClassBonus' },
        ]),
      ]),
      soli('Mordant', (id) => [
        f(id, 'Caustic Soul', [{ kind: 'alignment', light: 'Mordant' }]),
        f(id, 'Acid Tongue', [{ kind: 'naturalWeapon', name: 'Acid Tongue', damage: 'Caustic', properties: ['Deft'], dv: 1, deadly: 'classBonus', deadlyPlus: 1 }]),
        f(id, 'Amphibious', [{ kind: 'movementType', type: 'Swim', amount: 'movement' }]),
      ]),
      soli('Velvet', (id) => [
        f(id, 'Storming Soul', [{ kind: 'alignment', light: 'Velvet' }]),
        f(id, 'Lightning Speed', [
          { kind: 'movement', amount: 1 },
          { kind: 'bolster', what: 'AGI Save Checks', amount: 1 },
        ]),
        f(id, 'Resistor', [{ kind: 'resistance', type: 'Galvanic', amount: 'classBonus' }]),
      ]),
      soli('Infernal', (id) => [
        f(id, 'Infernal Soul', [{ kind: 'alignment', light: 'Infernal' }]),
        f(id, 'Blood Scaled', [
          { kind: 'resistance', type: 'Chthonic', amount: 'classBonus' },
          { kind: 'resistance', type: 'Possessed', amount: 'halfClassBonus' },
        ]),
        f(id, 'Unceasing'),
      ]),
      soli('Lunar', (id) => [
        f(id, 'Lunar Soul', [{ kind: 'alignment', light: 'Lunar' }]),
        f(id, 'Moon Scaled', [
          { kind: 'resistance', type: 'Cosmic', amount: 'classBonus' },
          { kind: 'resistance', type: 'Morphing', amount: 'halfClassBonus' },
        ]),
        f(id, 'Otherworldly'),
      ]),
      soli('Temporal', (id) => [
        f(id, 'Temporal Soul', [{ kind: 'alignment', light: 'Temporal' }]),
        f(id, 'World Scaled', [
          { kind: 'resistance', type: 'Sonic', amount: 'classBonus' },
          { kind: 'resistance', type: 'Stunned', amount: 'halfClassBonus' },
        ]),
        f(id, 'Everfull'),
      ]),
      soli('Platinum', (id) => [
        f(id, 'Pure Soul', [{ kind: 'alignment', light: 'Platinum' }]),
        f(id, 'Extra Radiance', [{ kind: 'radiance', amount: 1 }]),
        f(id, 'Heaven’s Pull'),
        f(id, 'Prismatic Resistance', [
          ...['Arctic', 'Caustic', 'Chthonic', 'Cosmic', 'Divine', 'Galvanic', 'Profane', 'Psychic', 'Somatic', 'Sonic', 'Thermic'].map(
            (type) => ({ kind: 'resistance' as const, type, amount: 'halfClassBonus' as const }),
          ),
        ]),
      ]),
    ],
  },
  {
    id: 'taurton',
    name: 'Taurton',
    contentId: `${A}/taurton`,
    facetsId: `${A}/taurton/facets`,
    facets: [
      f(`${A}/taurton/facets`, 'Poetic Soul', [{ kind: 'alignment', light: 'Velvet' }]),
      f(`${A}/taurton/facets`, 'Charged Horns', [{ kind: 'naturalWeapon', name: 'Charged Horns', damage: 'Piercing', properties: ['Pushing'], dv: 'halfClassBonus', deadly: 'classBonus' }]),
      extraEndurance(`${A}/taurton/facets`),
      f(`${A}/taurton/facets`, 'Extra Hobby', [{ kind: 'hobbies', count: 1, rank: 'Novice' }]),
      f(`${A}/taurton/facets`, 'Extra Radiance', [{ kind: 'radiance', amount: 1 }]),
      fast(`${A}/taurton/facets`),
      powerfulBuild(`${A}/taurton/facets`),
    ],
  },
  {
    id: 'ulu',
    name: 'Ulu',
    contentId: `${A}/ulu`,
    facetsId: `${A}/ulu/facets`,
    facets: [
      f(`${A}/ulu/facets`, 'Mystic Soul', [{ kind: 'alignment', light: 'Lunar' }]),
      f(`${A}/ulu/facets`, 'Everwatching'),
      f(`${A}/ulu/facets`, 'Gravity Warp', [{ kind: 'jump', mode: 'double' }]),
      f(`${A}/ulu/facets`, 'Lunar Gift', [
        {
          kind: 'spellList',
          list: {
            id: 'lunar-gift',
            label: 'Lunar Gift',
            mode: 'known',
            count: { base: 1 },
            pool: { kind: 'spell', group: 'Arcana', types: ['Moon'], tiers: ['Cantrip'], or: [{ kind: 'spell', group: 'Evocations', types: ['Lunar'], tiers: ['Mantra'] }] },
            note: 'One Moon cantrip or Lunar mantra.',
          },
        },
      ]),
      nightVision(`${A}/ulu/facets`),
      f(`${A}/ulu/facets`, 'Telepathic', [{ kind: 'grant', castable: 'spells/arcana/mind/transference' }]),
    ],
  },
];

export const ancestryById = new Map(ancestries.map((a) => [a.id, a]));
