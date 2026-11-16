// The World Prism model (src/engine/world.ts). Expected values are the geometry
// of a regular triangular pyramid and the motion keyed in the PM's Blender model
// (World Prism.blend), worked out by hand here, not read from the engine.
import { describe, expect, it } from 'vitest';
import { cycleNumber, daylightShare, dot, faceLights, FACES, length, nextEvent, sunEvents, turnDirection, turnOfCycle, turnPoint, VERTICES, WORLD_PRISM, type WorldModel } from '../src/engine/world';

const M = WORLD_PRISM;

describe('the pyramid', () => {
  it('has four corners, each 1 from the centre and equally far from each other', () => {
    expect(VERTICES).toHaveLength(4);
    for (const v of VERTICES) expect(length(v)).toBeCloseTo(1, 12);
    // Edge of a regular tetrahedron with circumradius 1: sqrt(8/3).
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) expect(Math.hypot(VERTICES[i][0] - VERTICES[j][0], VERTICES[i][1] - VERTICES[j][1], VERTICES[i][2] - VERTICES[j][2])).toBeCloseTo(Math.sqrt(8 / 3), 12);
  });

  it('has four faces whose normals point outward and cancel out', () => {
    expect(FACES.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd']);
    const sum = [0, 0, 0];
    for (const f of FACES) {
      expect(length(f.normal)).toBeCloseTo(1, 12);
      // Outward, and the face sits 1/3 from the centre (the inradius).
      expect(dot(f.normal, f.centre)).toBeCloseTo(1 / 3, 12);
      // The corner the face doesn't touch is behind it.
      const opposite = [0, 1, 2, 3].find((i) => !f.corners.includes(i))!;
      expect(dot(f.normal, VERTICES[opposite])).toBeCloseTo(-1, 12);
      f.normal.forEach((n, i) => (sum[i] += n));
    }
    sum.forEach((n) => expect(n).toBeCloseTo(0, 12));
  });
});

/**
 * The Blender model, straight from its keyframes (Blender axes: Z up, light on +Z).
 * Rotation is ZYX Euler with X = 0, so a point p becomes Ry(y) · Rz(z) · p, with
 * y = -180° - 360°·t and z = 120° - 120°·t at turn t (frame 48·t).
 */
function blender(p: readonly [number, number, number], t: number): [number, number, number] {
  const y = ((-180 - 360 * t) * Math.PI) / 180;
  const z = ((120 - 120 * t) * Math.PI) / 180;
  const a: [number, number, number] = [p[0] * Math.cos(z) - p[1] * Math.sin(z), p[0] * Math.sin(z) + p[1] * Math.cos(z), p[2]];
  return [a[0] * Math.cos(y) + a[2] * Math.sin(y), a[1], -a[0] * Math.sin(y) + a[2] * Math.cos(y)];
}
/** This app's axes (y up) from Blender's (z up), and back. */
const toBlender = (p: readonly [number, number, number]): [number, number, number] => [p[0], -p[2], p[1]];
const fromBlender = (p: readonly [number, number, number]): [number, number, number] => [p[0], p[2], -p[1]];
const TIMES = [0, 0.1, 0.25, 0.5, 0.77, 1, 1.3, 2, 2.6, 2.99];

describe('the motion in the Blender model', () => {
  it('the resting prism matches the mesh: apex up, base corners at 30°, 150° and 270° around it', () => {
    // Mesh corners (Blender x, y): (0.79, 0.45), (0, -0.94), (-0.80, 0.45), i.e. 30°, 270°, 150°.
    const angles = VERTICES.slice(1).map((v) => {
      const b = toBlender(v);
      return Math.round((Math.atan2(b[1], b[0]) * 180) / Math.PI + 360) % 360;
    });
    expect(angles.sort((x, y) => x - y)).toEqual([30, 150, 270]);
    expect(toBlender(VERTICES[0])).toEqual([0, -0, 1]);
  });

  it('turns every direction and point the way the keyframes do', () => {
    for (const t of TIMES) {
      for (const f of FACES) {
        const want = fromBlender(blender(toBlender(f.normal), t));
        turnDirection(M, t, f.normal).forEach((n, i) => expect(n, `${f.id} at ${t}`).toBeCloseTo(want[i], 9));
      }
      for (const v of VERTICES) {
        // The pivot (the object's origin) is 0.1 under the base of the 1.3037-tall mesh.
        const local: [number, number, number] = [v[0], v[1] + 1 / 3 + (0.1 / 1.3037) * (4 / 3), v[2]];
        const want = fromBlender(blender(toBlender(local), t));
        turnPoint(M, t, v).forEach((n, i) => expect(n).toBeCloseTo(want[i], 9));
      }
    }
  });

  it('starts apex-down with the base facing the sun, and has the apex toward the sun half a turn later', () => {
    const light = (t: number) => Object.fromEntries(faceLights(M, t).map((l) => [l.face.id, Math.round(l.sunHeight * 10) / 10]));
    // Sides stand asin(1/3) = 19.5° off the apex line.
    expect(light(0)).toEqual({ a: -19.5, b: -19.5, c: -19.5, d: 90 });
    expect(light(0.5)).toEqual({ a: 19.5, b: 19.5, c: 19.5, d: -90 });
    expect(turnPoint(M, 0, VERTICES[0])[1]).toBeLessThan(0);
    expect(turnPoint(M, 0.5, VERTICES[0])[1]).toBeGreaterThan(0);
  });

  it('is back where it began after three turns, and not before', () => {
    expect(M.turnsPerCycle).toBe(3);
    for (const v of VERTICES) {
      const start = turnPoint(M, 0.4, v);
      turnPoint(M, 3.4, v).forEach((n, i) => expect(n).toBeCloseTo(start[i], 9));
    }
    // A base corner is somewhere else after one turn and after two (the apex, on the spin line, is not).
    const start = turnPoint(M, 0.4, VERTICES[1]);
    for (const t of [1.4, 2.4]) expect(Math.hypot(...turnPoint(M, t, VERTICES[1]).map((n, i) => n - start[i]))).toBeGreaterThan(0.5);
  });

  it('after one turn the prism looks the same with the three sides swapped round', () => {
    for (const t of TIMES) {
      const now = faceLights(M, t).map((l) => l.light);
      const later = faceLights(M, t + 1).map((l) => l.light);
      // The base is unchanged; each side has taken another side's place.
      expect(later[3]).toBeCloseTo(now[3], 9);
      const sort = (xs: number[]) => [...xs].sort((x, y) => x - y);
      sort(later.slice(0, 3)).forEach((n, i) => expect(n).toBeCloseTo(sort(now.slice(0, 3))[i], 9));
    }
    const a = faceLights(M, 0.3).map((l) => l.light);
    const b = faceLights(M, 1.3).map((l) => l.light);
    expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])).toBeGreaterThan(0.1);
  });
});

describe('time', () => {
  it('wraps the position in the cycle and counts cycles, also before the start', () => {
    expect(turnOfCycle(M, 3.5)).toBeCloseTo(0.5, 12);
    expect(turnOfCycle(M, -0.25)).toBeCloseTo(2.75, 12);
    expect(cycleNumber(M, 3.5)).toBe(1);
    expect(cycleNumber(M, -0.25)).toBe(-1);
  });
});

describe('light on the faces', () => {
  it('a face has day exactly when its outer side is turned toward the sun (straight up)', () => {
    for (let t = 0; t < 3; t += 0.031) {
      let sum = 0;
      for (const l of faceLights(M, t)) {
        // Height of the sun over the face, from the keyframes: the Blender z of its turned normal.
        const d = blender(toBlender(l.face.normal), t)[2];
        sum += d;
        if (Math.abs(d) < 1e-6) continue;
        expect(l.day, `${l.face.id} at ${t}`).toBe(d > 0);
        expect(l.light).toBeCloseTo(Math.max(0, d), 9);
        expect(Math.sin((l.sunHeight * Math.PI) / 180)).toBeCloseTo(d, 9);
      }
      // The four normals cancel, so the heights do too.
      expect(sum).toBeCloseTo(0, 9);
    }
  });

  it('never lights every face at once, and always lights at least one', () => {
    for (let t = 0; t < 3; t += 0.01) {
      const lit = faceLights(M, t).filter((l) => l.day).length;
      expect(lit).toBeGreaterThanOrEqual(1);
      expect(lit).toBeLessThanOrEqual(3);
    }
  });

  it('the base has an even day: sun height follows cos(turn), up for half of every turn', () => {
    // Base normal is -Z in Blender; Ry(-180° - 360°t) puts its z at cos(360°t).
    for (const t of TIMES) expect(faceLights(M, t)[3].light).toBeCloseTo(Math.max(0, Math.cos(2 * Math.PI * t)), 9);
    const events = sunEvents(M, 'd');
    expect(events.map((e) => e.type)).toEqual(['sunset', 'sunrise', 'sunset', 'sunrise', 'sunset', 'sunrise']);
    [0.25, 0.75, 1.25, 1.75, 2.25, 2.75].forEach((at, i) => expect(events[i].at).toBeCloseTo(at, 5));
    expect(daylightShare(M, 'd')).toBeCloseTo(0.5, 3);
  });

  it('each side has three sunrises and sunsets a cycle, the same pattern one turn apart', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((id) => sunEvents(M, id));
    for (const e of [a, b, c]) {
      expect(e).toHaveLength(6);
      expect(e.filter((x) => x.type === 'sunrise')).toHaveLength(3);
    }
    // Each event on one side happens on another side one turn later, and on the third two turns later.
    const key = (list: typeof a, shift: number) => list.map((e) => `${e.type}@${(((e.at + shift) % 3) + 3) % 3 < 2.99995 ? ((((e.at + shift) % 3) + 3) % 3).toFixed(4) : '0.0000'}`).sort();
    const shifted = [key(b, 0), key(b, 1), key(b, 2)].map((k) => k.join());
    expect(shifted).toContain(key(a, 0).join());
    expect(shifted).toContain(key(c, 0).join());
    expect(key(a, 0).join()).not.toBe(key(c, 0).join());
    // Sides share the daylight equally, and get less than the base.
    const shares = ['a', 'b', 'c'].map((id) => daylightShare(M, id));
    expect(shares[1]).toBeCloseTo(shares[0], 3);
    expect(shares[2]).toBeCloseTo(shares[0], 3);
    expect(shares[0]).toBeLessThan(0.5);
  });

  it('sunrise and sunset are where the keyframes put the sun on the horizon', () => {
    for (const f of FACES)
      for (const e of sunEvents(M, f.id)) {
        expect(blender(toBlender(f.normal), e.at)[2]).toBeCloseTo(0, 5);
        const after = blender(toBlender(f.normal), e.at + 0.01)[2];
        expect(after > 0).toBe(e.type === 'sunrise');
      }
  });

  it('finds the next sunrise or sunset, wrapping past the end of the cycle', () => {
    const events = sunEvents(M, 'd');
    const n = nextEvent(M, events, 0.5)!;
    expect(n.type).toBe('sunrise');
    expect(n.at).toBeCloseTo(0.75, 5);
    expect(n.in).toBeCloseTo(0.25, 5);
    const wrap = nextEvent(M, events, 2.9)!;
    expect(wrap.type).toBe('sunset');
    expect(wrap.in).toBeCloseTo(0.35, 5);
    expect(nextEvent(M, [], 1)).toBeUndefined();
  });

  it('follows a different model: no spin leaves every turn alike', () => {
    const still: WorldModel = { ...M, spinPerTurn: 0, turnsPerCycle: 1 };
    for (const t of TIMES) faceLights(still, t + 1).forEach((l, i) => expect(l.light).toBeCloseTo(faceLights(still, t)[i].light, 9));
  });
});
