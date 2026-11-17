// The World Prism (a triangular pyramid) and the sun that lights it. Pure maths,
// no React and no DOM: the World tab draws what this returns, and the calendar
// tracker planned next builds on the same time and motion model.
//
// The sun stays where it is; the prism moves. Its motion is the PM's, read from
// the PM's Blender model (World Prism.blend, 2026-11-15) and kept in one
// WorldModel value (WORLD_PRISM below): nothing else in the app should hard-code
// how the world turns or how long a day is.

export type Vec3 = readonly [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));

/** Rotates `v` around the unit vector `axis` by `angle` radians (right-handed). */
export function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

/**
 * The World Prism at rest: a regular triangular pyramid centred on the origin,
 * every corner 1 from the centre, with y up. Corner 0 is the apex; the others
 * ring it below. (The Blender mesh has its apex on +Z and base corners at 30°,
 * 150° and 270° around it; Blender's x, y, z are x, z, -y here.)
 */
export const VERTICES: readonly Vec3[] = [
  [0, 1, 0],
  ...[0, 1, 2].map((i): Vec3 => {
    const a = (i * 2 * Math.PI) / 3;
    return [(Math.sqrt(8) / 3) * Math.sin(a), -1 / 3, (Math.sqrt(8) / 3) * Math.cos(a)];
  }),
];

export interface Face {
  id: string;
  /** The PM's name for it; the fourth face has none yet. */
  name: string;
  /** Its colour in the PM's Blender model, softened a little for the screen. */
  color: string;
  /** What it is, where that needs saying. */
  note?: string;
  /** Indices into VERTICES, anticlockwise seen from outside. */
  corners: readonly [number, number, number];
  /** Unit vector pointing straight out of the face. */
  normal: Vec3;
  centre: Vec3;
}

function face(id: string, name: string, color: string, corners: readonly [number, number, number], note?: string): Face {
  const [a, b, c] = corners.map((i) => VERTICES[i]);
  const centre = scale(add(add(a, b), c), 1 / 3);
  let normal = normalize(cross(sub(b, a), sub(c, a)));
  let order = corners;
  // Outward: away from the centre of the pyramid (the origin).
  if (dot(normal, centre) < 0) {
    normal = scale(normal, -1);
    order = [corners[0], corners[2], corners[1]];
  }
  return { id, name, color, corners: order, normal, centre, ...(note ? { note } : {}) };
}

/**
 * The three Facets, then the base (the face opposite the apex). Which is which
 * comes from the colours painted on the Blender model (PM 2026-11-15): red is
 * the Infernal Facet (the side facing Blender's +Y at rest), green the Temporal
 * Facet (the side at 330°), blue the Lunar Facet (210°); the base is yellow.
 */
export const FACES: readonly Face[] = [
  face('infernal', 'Infernal Facet', '#ff3355', [0, 2, 3]),
  face('temporal', 'Temporal Facet', '#35d435', [0, 1, 2]),
  face('lunar', 'Lunar Facet', '#4a5cff', [0, 3, 1]),
  // PM 2026-11-16: the base is all ocean, and the oceans are yellow.
  face('base', 'Base', '#ffe14a', [1, 2, 3], 'Ocean'),
];

/** An edge between two Facets. It has day while either of its Facets does. */
export interface Spine {
  id: string;
  name: string;
  /** Ids of the two faces it joins. */
  faces: readonly [string, string];
}

/**
 * The PM's Spines (2026-11-15). The PM's note put the Heart Spine between Lunar
 * and Temporal, which is the Spring Spine; the PM's table of its days and nights
 * fits Lunar and Infernal, the one pair left, and the PM confirmed it (2026-11-16).
 */
export const SPINES: readonly Spine[] = [
  { id: 'storm', name: 'Storm Spine', faces: ['infernal', 'temporal'] },
  { id: 'spring', name: 'Spring Spine', faces: ['temporal', 'lunar'] },
  { id: 'heart', name: 'Heart Spine', faces: ['lunar', 'infernal'] },
];

/** What the PM's table calls each Facet's day, by day of the three-day cycle (the first is Asmoday). */
export type DayKind = 'Sunrise' | 'Long Night' | 'Short Day';
export const DAY_KINDS: Readonly<Record<string, readonly DayKind[]>> = {
  infernal: ['Sunrise', 'Long Night', 'Short Day'],
  temporal: ['Long Night', 'Short Day', 'Sunrise'],
  lunar: ['Short Day', 'Sunrise', 'Long Night'],
};

/**
 * How the world moves. Time is counted in turns: one turn is one full tumble of
 * the prism, which is one day. Angles are in degrees.
 */
export interface WorldModel {
  /** Unit vector from the world toward the sun, which never moves. */
  sun: Vec3;
  /** The prism turns about this point (in its own resting coordinates). */
  pivot: Vec3;
  /** The prism spins about this line of its own (through the pivot)... */
  spinAxis: Vec3;
  /** ...and all of that tumbles about this fixed line (through the pivot). */
  tumbleAxis: Vec3;
  /** Angles at turn 0. */
  spinStart: number;
  tumbleStart: number;
  /** Degrees of spin per turn; the tumble is 360 per turn by definition. */
  spinPerTurn: number;
  /** 1 or -1: which way the tumble goes around its axis (right-handed). */
  tumbleSense: 1 | -1;
  /** Turns until the prism is back exactly where it began. */
  turnsPerCycle: number;
  /** Hours in one turn. One turn is one day. */
  hoursPerTurn: number;
  /** The days of the week, in order; turn 0 begins the first. */
  weekdays: readonly string[];
  /** Hours of the day that have a name. */
  hourNames: Readonly<Record<number, string>>;
}

/**
 * The motion in the PM's Blender model. There the prism's rotation is keyed in
 * ZYX Euler mode, linearly, from frame 0 to 144: X stays 0, Y goes -180° to
 * -1260° (three turns) and Z goes 120° to -240° (one turn), with the light
 * straight above on +Z. ZYX mode applies Z first, so the prism spins about its
 * own apex line once while tumbling about a level line three times.
 *
 * The object's origin (its pivot) sits 0.1 under the base of a 1.3037-tall
 * prism, on the apex line; scaled to this prism's height of 4/3 that is 0.1023.
 */
export const WORLD_PRISM: WorldModel = {
  sun: [0, 1, 0],
  pivot: [0, -1 / 3 - (0.1 / 1.3037) * (4 / 3), 0],
  spinAxis: [0, 1, 0],
  tumbleAxis: [0, 0, -1],
  spinStart: 120,
  tumbleStart: -180,
  spinPerTurn: -120,
  tumbleSense: -1,
  turnsPerCycle: 3,
  // PM 2026-11-15: 24 hours in a day, and a nine-day week (three cycles).
  hoursPerTurn: 24,
  weekdays: ['Asmoday', 'Tempoday', 'Lunaday', 'Morday', 'Veleday', 'Pneumaday', 'Somaday', 'Auroday', 'Nixaday'],
  // PM 2026-11-16: 0:00 is midnight; 12:00 is Apex, when the sun is straight above the prism's apex.
  hourNames: { 0: 'Midnight', 12: 'Apex' },
};

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Where the prism has turned a direction (a face's normal, say) by `turns`. */
export function turnDirection(model: WorldModel, turns: number, v: Vec3): Vec3 {
  const spun = rotate(v, normalize(model.spinAxis), rad(model.spinStart + model.spinPerTurn * turns));
  return rotate(spun, normalize(model.tumbleAxis), rad(model.tumbleStart + model.tumbleSense * 360 * turns));
}

/**
 * Where the sun stands at `turns` as someone on the World Prism sees it: a unit
 * vector in the prism's own resting coordinates. The prism's turning undone, so
 * the prism holds still and the sun goes around it; the light on every face is
 * the same either way.
 */
export function sunSeenFromWorld(model: WorldModel, turns: number): Vec3 {
  const untumbled = rotate(normalize(model.sun), normalize(model.tumbleAxis), -rad(model.tumbleStart + model.tumbleSense * 360 * turns));
  return rotate(untumbled, normalize(model.spinAxis), -rad(model.spinStart + model.spinPerTurn * turns));
}

/** The name of the hour at `turns`, if it has one (to the minute). */
export function hourName(model: WorldModel, turns: number): string | undefined {
  const minutes = Math.round(hourOfDay(model, turns) * 60) % Math.round(model.hoursPerTurn * 60);
  return minutes % 60 === 0 ? model.hourNames[minutes / 60] : undefined;
}

/** Where a point of the resting prism is at `turns`, measured from the pivot. */
export const turnPoint = (model: WorldModel, turns: number, p: Vec3): Vec3 => turnDirection(model, turns, sub(p, model.pivot));

/** Position within the cycle: 0 ≤ result < turnsPerCycle. */
export function turnOfCycle(model: WorldModel, turns: number): number {
  const t = turns % model.turnsPerCycle;
  return t < 0 ? t + model.turnsPerCycle : t;
}

/** Position within the week, in turns: 0 ≤ result < weekdays.length. */
export function turnOfWeek(model: WorldModel, turns: number): number {
  const n = model.weekdays.length;
  const t = turns % n;
  return t < 0 ? t + n : t;
}

/** The weekday at `turns`. */
export const weekday = (model: WorldModel, turns: number): string => model.weekdays[Math.floor(turnOfWeek(model, turns) + 1e-9) % model.weekdays.length];

/** Hours since the day began: 0 ≤ result < hoursPerTurn. */
export function hourOfDay(model: WorldModel, turns: number): number {
  const t = turnOfWeek(model, turns);
  return (t - Math.floor(t + 1e-9)) * model.hoursPerTurn;
}

/** "6:30" for 6.5 hours. */
export function formatHour(hours: number): string {
  const minutes = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Whole cycles gone by at `turns` (negative before the start). */
export const cycleNumber = (model: WorldModel, turns: number): number => Math.floor(turns / model.turnsPerCycle);

export interface FaceLight {
  face: Face;
  /** Degrees of the sun above the face's ground: 90 is straight overhead, below 0 it is under the horizon. */
  sunHeight: number;
  /** 0 (night) to 1 (sun straight overhead). */
  light: number;
  day: boolean;
}

const EPS = 1e-9;
const sunOver = (model: WorldModel, f: Face, turns: number) => Math.max(-1, Math.min(1, dot(turnDirection(model, turns, f.normal), normalize(model.sun))));

/**
 * How the sun stands over each face. The sun is treated as far away, so a flat
 * face sees it at one height everywhere: the whole face has sunrise at once.
 */
export function faceLights(model: WorldModel, turns: number): FaceLight[] {
  return FACES.map((f) => {
    const d = sunOver(model, f, turns);
    return { face: f, sunHeight: (Math.asin(d) * 180) / Math.PI, light: Math.max(0, d), day: d > EPS };
  });
}

export interface SunEvent {
  type: 'sunrise' | 'sunset';
  /** Position in the cycle, in turns. */
  at: number;
}

/** A face id, or several: a place that has day while any of those faces does (a Spine's two). */
export type Place = string | readonly string[];
const facesOf = (place: Place): Face[] => (typeof place === 'string' ? [place] : place).map((id) => FACES.find((f) => f.id === id)).filter((f): f is Face => !!f);
/** Height of the sun over a place: over whichever of its faces it stands highest. */
const sunOverPlace = (model: WorldModel, faces: readonly Face[], turns: number) => Math.max(...faces.map((f) => sunOver(model, f, turns)));

/** Every sunrise and sunset at a place over one cycle, in order, found by stepping through it. */
export function sunEvents(model: WorldModel, place: Place, stepsPerTurn = 1440): SunEvent[] {
  const faces = facesOf(place);
  if (!faces.length) return [];
  const out: SunEvent[] = [];
  const steps = stepsPerTurn * model.turnsPerCycle;
  let a = sunOverPlace(model, faces, 0);
  for (let i = 0; i < steps; i++) {
    const t0 = i / stepsPerTurn;
    const t1 = (i + 1) / stepsPerTurn;
    const b = sunOverPlace(model, faces, t1);
    if (a > EPS !== b > EPS) {
      // The crossing, by straight-line interpolation within the step.
      out.push({ type: b > EPS ? 'sunrise' : 'sunset', at: turnOfCycle(model, t0 + ((t1 - t0) * (EPS - a)) / (b - a)) });
    }
    a = b;
  }
  return out.sort((x, y) => x.at - y.at);
}

/** Whether a place has day at `turns`. */
export const isDay = (model: WorldModel, place: Place, turns: number): boolean => sunOverPlace(model, facesOf(place), turns) > EPS;

export interface Daylight {
  /** Hour of the day the sun comes up. */
  sunrise: number;
  /** Hours of night before that sunrise. */
  night: number;
  /** Hours of day after it. */
  day: number;
}

/**
 * The daylight that begins on a day of the cycle (0 is the first), from one
 * cycle's `events`: each sunrise that day, with the night before it and the day
 * after it, which may run past midnight either way. This is how the PM's table
 * counts a Spine's day ("10 N / 22 D").
 */
export function daylightOn(model: WorldModel, events: readonly SunEvent[], day: number): Daylight[] {
  const d = ((day % model.turnsPerCycle) + model.turnsPerCycle) % model.turnsPerCycle;
  const out: Daylight[] = [];
  events.forEach((e, i) => {
    if (e.type !== 'sunrise' || Math.floor(e.at) !== d) return;
    const before = events[(i - 1 + events.length) % events.length];
    const after = events[(i + 1) % events.length];
    out.push({ sunrise: (e.at - d) * model.hoursPerTurn, night: turnOfCycle(model, e.at - before.at) * model.hoursPerTurn, day: turnOfCycle(model, after.at - e.at) * model.hoursPerTurn });
  });
  return out;
}

/** The next sunrise or sunset after `turns` among `events` (one cycle's worth), and how many turns away it is. */
export function nextEvent(model: WorldModel, events: readonly SunEvent[], turns: number): (SunEvent & { in: number }) | undefined {
  if (!events.length) return undefined;
  const now = turnOfCycle(model, turns);
  const e = events.find((x) => x.at > now + 1e-6) ?? events[0];
  return { ...e, in: turnOfCycle(model, e.at - now) };
}

/** Share of the cycle (0 to 1) a place spends in daylight. */
export function daylightShare(model: WorldModel, place: Place, stepsPerTurn = 480): number {
  const faces = facesOf(place);
  if (!faces.length) return 0;
  const steps = stepsPerTurn * model.turnsPerCycle;
  let lit = 0;
  for (let i = 0; i < steps; i++) if (sunOverPlace(model, faces, (i + 0.5) / stepsPerTurn) > EPS) lit++;
  return lit / steps;
}
