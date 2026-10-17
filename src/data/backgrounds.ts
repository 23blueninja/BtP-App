import type { BackgroundDef, HeritageFacetDef } from './types';

const B = 'player-characters/backgrounds';
const H = 'player-characters/heritage-facets';

export const backgrounds: BackgroundDef[] = [
  { id: 'civil-engineer', name: 'Civil Engineer', contentId: `${B}/civil-engineer`, profession: 'Architect', hobbies: ['Cooking', 'Nonfiction Reading'], heritage: 'dabbler' },
  { id: 'medical-practitioner', name: 'Medical Practitioner', contentId: `${B}/medical-practitioner`, profession: 'Paramedic', hobbies: ['Carousing', 'Woodworking'], heritage: 'first-responder' },
  { id: 'mountaineer', name: 'Mountaineer', contentId: `${B}/mountaineer`, profession: 'Trail Guide', hobbies: ['Hunting', 'Historical Fiction Reading'], heritage: 'climber' },
  { id: 'restaurateur', name: 'Restaurateur', contentId: `${B}/restaurateur`, profession: 'Chef', hobbies: ['Dancing', 'Fishing'], heritage: 'chef' },
  { id: 'track-star', name: 'Track Star', contentId: `${B}/track-star`, profession: 'Track Athlete', hobbies: ['Gambling', 'Gardening'], heritage: 'speedster' },
  { id: 'vagabond', name: 'Vagabond', contentId: `${B}/vagabond`, profession: 'Mercenary', hobbies: ['Card Counting', 'Sleight-of-Hand'], heritage: 'hardened' },
  { id: 'woodsman', name: 'Woodsman', contentId: `${B}/woodsman`, profession: 'Lumberjack', hobbies: ['Bushcraft', 'Distilling'], heritage: 'blue-collar' },
];

export const heritageFacets: HeritageFacetDef[] = [
  { id: 'blue-collar', name: 'Blue-Collar', contentId: `${H}/blue-collar` },
  { id: 'chef', name: 'Chef', contentId: `${H}/chef`, uses: { count: 1, per: 'Long Rest' } },
  {
    id: 'climber',
    name: 'Climber',
    contentId: `${H}/climber`,
    effects: [
      { kind: 'movementType', type: 'Climb', amount: 'halfMovement' },
      { kind: 'endurance', amount: 'twiceLevel' },
    ],
  },
  { id: 'dabbler', name: 'Dabbler', contentId: `${H}/dabbler`, effects: [{ kind: 'hobbies', count: 3, rank: 'Novice' }] },
  {
    id: 'first-responder',
    name: 'First Responder',
    contentId: `${H}/first-responder`,
    effects: [
      { kind: 'movement', amount: 1 },
      { kind: 'bolster', what: 'Initiative Checks', amount: 1 },
    ],
  },
  {
    id: 'hardened',
    name: 'Hardened',
    contentId: `${H}/hardened`,
    effects: [
      { kind: 'bolster', what: 'Skill Checks to intimidate', amount: 1 },
      { kind: 'resistance', type: 'Panicked', amount: 1 },
    ],
  },
  { id: 'speedster', name: 'Speedster', contentId: `${H}/speedster`, effects: [{ kind: 'movement', amount: 3 }] },
];

export const backgroundById = new Map(backgrounds.map((b) => [b.id, b]));
export const heritageById = new Map(heritageFacets.map((h) => [h.id, h]));
