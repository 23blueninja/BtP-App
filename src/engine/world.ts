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
  /** Stable id, used as the key when the PM names the faces. */
  id: string;
  /** Neutral working name until the PM names the faces. */
  name: string;
  /** Indices into VERTICES, anticlockwise seen from outside. */
  corners: readonly [number, number, number];
  /** Unit vector pointing straight out of the face. */
  normal: Vec3;
  centre: Vec3;
}

function face(id: string, name: string, corners: readonly [number, number, number]): Face {
  const [a, b, c] = corners.map((i) => VERTICES[i]);
  const centre = scale(add(add(a, b), c), 1 / 3);
  let normal = normalize(cross(sub(b, a), sub(c, a)));
  let order = corners;
  // Outward: away from the centre of the pyramid (the origin).
  if (dot(normal, centre) < 0) {
    normal = scale(normal, -1);
    order = [corners[0], corners[2], corners[1]];
  }
  return { id, name, corners: order, normal, centre };
}

/** The three sides, then the base (the face opposite the apex). */
export const FACES: readonly Face[] = [face('a', 'Face A', [0, 1, 2]), face('b', 'Face B', [0, 2, 3]), face('c', 'Face C', [0, 3, 1]), face('d', 'Face D', [1, 2, 3])];

/**
 * How the world moves. Time is counted in turns: one turn is one full tumble of
 * the prism. Angles are in degrees.
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
  /** Hours in one turn, once the PM sets it (the Blender model has no clock). */
  hoursPerTurn?: number;
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
};

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Where the prism has turned a direction (a face's normal, say) by `turns`. */
export function turnDirection(model: WorldModel, turns: number, v: Vec3): Vec3 {
  const spun = rotate(v, normalize(model.spinAxis), rad(model.spinStart + model.spinPerTurn * turns));
  return rotate(spun, normalize(model.tumbleAxis), rad(model.tumbleStart + model.tumbleSense * 360 * turns));
}

/** Where a point of the resting prism is at `turns`, measured from the pivot. */
export const turnPoint = (model: WorldModel, turns: number, p: Vec3): Vec3 => turnDirection(model, turns, sub(p, model.pivot));

/** Position within the cycle: 0 ≤ result < turnsPerCycle. */
export function turnOfCycle(model: WorldModel, turns: number): number {
  const t = turns % model.turnsPerCycle;
  return t < 0 ? t + model.turnsPerCycle : t;
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

/** Every sunrise and sunset on a face over one cycle, in order, found by stepping through it. */
export function sunEvents(model: WorldModel, faceId: string, stepsPerTurn = 1440): SunEvent[] {
  const f = FACES.find((x) => x.id === faceId);
  if (!f) return [];
  const out: SunEvent[] = [];
  const steps = stepsPerTurn * model.turnsPerCycle;
  let a = sunOver(model, f, 0);
  for (let i = 0; i < steps; i++) {
    const t0 = i / stepsPerTurn;
    const t1 = (i + 1) / stepsPerTurn;
    const b = sunOver(model, f, t1);
    if (a > EPS !== b > EPS) {
      // The crossing, by straight-line interpolation within the step.
      out.push({ type: b > EPS ? 'sunrise' : 'sunset', at: turnOfCycle(model, t0 + ((t1 - t0) * (EPS - a)) / (b - a)) });
    }
    a = b;
  }
  return out.sort((x, y) => x.at - y.at);
}

/** The next sunrise or sunset after `turns` among `events` (one cycle's worth), and how many turns away it is. */
export function nextEvent(model: WorldModel, events: readonly SunEvent[], turns: number): (SunEvent & { in: number }) | undefined {
  if (!events.length) return undefined;
  const now = turnOfCycle(model, turns);
  const e = events.find((x) => x.at > now + 1e-6) ?? events[0];
  return { ...e, in: turnOfCycle(model, e.at - now) };
}

/** Share of the cycle (0 to 1) a face spends in daylight. */
export function daylightShare(model: WorldModel, faceId: string, stepsPerTurn = 480): number {
  const f = FACES.find((x) => x.id === faceId);
  if (!f) return 0;
  const steps = stepsPerTurn * model.turnsPerCycle;
  let lit = 0;
  for (let i = 0; i < steps; i++) if (sunOver(model, f, (i + 0.5) / stepsPerTurn) > EPS) lit++;
  return lit / steps;
}
