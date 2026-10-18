// Reads Action costs ("Reaction, 2 {AP}, Basic CAP", "1 Prisma, 2 {AP}", "1-5 {AP}") from the rules text.

export interface ApCost {
  /** Fixed AP cost, or the range to choose from when the cost varies. */
  ap: number | { min: number; max: number };
  reaction: boolean;
  /** Basic CAP: costs 1 more AP for each earlier use this turn. */
  cap: boolean;
  /** Other costs, e.g. 1 Prisma or 1 Radiance. */
  resources: { name: string; amount: number }[];
}

const RESOURCES = ['Prisma', 'Radiance', 'Favor', 'Will', 'Stamina', 'Light', 'Wonder', 'Vitality'];

export function parseCost(text: string | undefined): ApCost {
  const t = (text ?? '').replace(/<[^>]+>/g, ' ');
  const cost: ApCost = { ap: 0, reaction: /Reaction/i.test(t), cap: /Basic CAP/i.test(t), resources: [] };
  // "{AP} in spell's Cast Time": the spell's own Cast Time is spent when it's cast.
  if (/\{AP\}\s+(?:in|equal)/i.test(t)) return withResources(cost, t);
  const range = t.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*\{AP\}/);
  const fixed = t.match(/(\d+)\s*\{AP\}/);
  if (range) cost.ap = { min: Number(range[1]), max: Number(range[2]) };
  else if (fixed) cost.ap = Number(fixed[1]);
  else if (/Varies/i.test(t)) cost.ap = { min: 1, max: 5 };
  return withResources(cost, t);
}

function withResources(cost: ApCost, t: string): ApCost {
  for (const m of t.matchAll(new RegExp(`(\\d+)\\s+(${RESOURCES.join('|')})\\b`, 'g'))) cost.resources.push({ name: m[2], amount: Number(m[1]) });
  return cost;
}

export const isVariable = (c: ApCost): c is ApCost & { ap: { min: number; max: number } } => typeof c.ap !== 'number';
