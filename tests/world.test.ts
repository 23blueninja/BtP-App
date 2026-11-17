// The World Prism model (src/engine/world.ts). Expected values are the geometry
// of a regular triangular pyramid and the motion keyed in the PM's Blender model
// (World Prism.blend), worked out by hand here, not read from the engine.
import { describe, expect, it } from 'vitest';
import { dateOf, daysPerYear, moonPhase, moonSeenFromWorld, cycleNumber, hourName, sunSeenFromWorld, DAY_KINDS, daylightOn, daylightShare, dot, faceLights, FACES, formatHour, hourOfDay, isDay, length, nextEvent, SPINES, sunEvents, turnDirection, turnOfCycle, turnOfWeek, turnPoint, VERTICES, weekday, WORLD_PRISM, type WorldModel } from '../src/engine/world';

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
    expect(FACES.map((f) => f.id)).toEqual(['infernal', 'temporal', 'lunar', 'base']);
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
    expect(light(0)).toEqual({ infernal: -19.5, temporal: -19.5, lunar: -19.5, base: 90 });
    expect(light(0.5)).toEqual({ infernal: 19.5, temporal: 19.5, lunar: 19.5, base: -90 });
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
    const events = sunEvents(M, 'base');
    expect(events.map((e) => e.type)).toEqual(['sunset', 'sunrise', 'sunset', 'sunrise', 'sunset', 'sunrise']);
    [0.25, 0.75, 1.25, 1.75, 2.25, 2.75].forEach((at, i) => expect(events[i].at).toBeCloseTo(at, 5));
    expect(daylightShare(M, 'base')).toBeCloseTo(0.5, 3);
  });

  it('each side has three sunrises and sunsets a cycle, the same pattern one turn apart', () => {
    const [a, b, c] = ['temporal', 'infernal', 'lunar'].map((id) => sunEvents(M, id));
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
    const shares = ['temporal', 'infernal', 'lunar'].map((id) => daylightShare(M, id));
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
    const events = sunEvents(M, 'base');
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

// The PM's names, clock and table of the week (2026-11-15).
describe('Facets, Spines and the week', () => {
  it('the Facets are the sides painted red, green and blue in the Blender model; the base is the fourth face', () => {
    // Mesh faces by corner (base corners at 30°, 150°, 270°): red spans 150° and 30°, so it
    // faces 90°; green spans 30° and 270° (330°); blue spans 270° and 150° (210°).
    const facing = (id: string) => {
      const n = toBlender(FACES.find((f) => f.id === id)!.normal);
      return Math.round((Math.atan2(n[1], n[0]) * 180) / Math.PI + 360) % 360;
    };
    expect(facing('infernal')).toBe(90);
    expect(facing('temporal')).toBe(330);
    expect(facing('lunar')).toBe(210);
    expect(toBlender(FACES.find((f) => f.id === 'base')!.normal)[2]).toBeCloseTo(-1, 12);
    expect(FACES.map((f) => f.name)).toEqual(['Infernal Facet', 'Temporal Facet', 'Lunar Facet', 'Base']);
  });

  it('each Spine joins two different Facets, and the three cover every pair', () => {
    expect(SPINES.map((s) => `${s.name}: ${s.faces.join('+')}`)).toEqual(['Storm Spine: infernal+temporal', 'Spring Spine: temporal+lunar', 'Heart Spine: lunar+infernal']);
  });

  it('a day is one turn of 24 hours, and the week has nine days starting on Asmoday', () => {
    expect(M.hoursPerTurn).toBe(24);
    expect(M.weekdays).toEqual(['Asmoday', 'Tempoday', 'Lunaday', 'Morday', 'Veleday', 'Pneumaday', 'Somaday', 'Auroday', 'Nixaday']);
    expect(weekday(M, 0)).toBe('Asmoday');
    expect(weekday(M, 0.99)).toBe('Asmoday');
    expect(weekday(M, 1)).toBe('Tempoday');
    expect(weekday(M, 8.5)).toBe('Nixaday');
    expect(weekday(M, 9)).toBe('Asmoday');
    expect(weekday(M, -0.5)).toBe('Nixaday');
    expect(hourOfDay(M, 4.25)).toBeCloseTo(6, 9);
    expect(turnOfWeek(M, 10.5)).toBeCloseTo(1.5, 9);
    expect(formatHour(6.5)).toBe('6:30');
    expect(formatHour(0)).toBe('0:00');
    // The week is a whole number of cycles, so every week is alike.
    expect(M.weekdays.length % M.turnsPerCycle).toBe(0);
  });

  it("each Facet's days are what the PM's table calls them", () => {
    // PM's table, Asmoday to Lunaday (it repeats through the week).
    const table: Record<string, string[]> = {
      infernal: ['Sunrise', 'Long Night', 'Short Day'],
      temporal: ['Long Night', 'Short Day', 'Sunrise'],
      lunar: ['Short Day', 'Sunrise', 'Long Night'],
    };
    expect(DAY_KINDS).toEqual(table);
    for (const [id, kinds] of Object.entries(table)) {
      const events = sunEvents(M, id);
      kinds.forEach((kind, day) => {
        const light = daylightOn(M, events, day);
        // One sunrise a day on every Facet.
        expect(light, `${id} day ${day}`).toHaveLength(1);
        const { sunrise, night, day: hours } = light[0];
        // A Short Day is by far the shortest daylight; a Long Night day is the one whose
        // sunrise ends a night of most of a day; a Sunrise day has the sun up soon after it starts.
        expect(hours < 8, `${id} day ${day} short`).toBe(kind === 'Short Day');
        expect(night > 20, `${id} day ${day} long night`).toBe(kind === 'Long Night');
        expect(sunrise < 3, `${id} day ${day} early`).toBe(kind === 'Sunrise');
      });
    }
  });

  it("each Spine's nights and days are the hours in the PM's table, to the hour", () => {
    // "N / D": hours of night, then of the day that follows, for the daylight starting each day.
    const table: Record<string, [number, number][]> = {
      storm: [[10, 22], [9, 14], [3, 14]],
      spring: [[9, 14], [3, 14], [10, 22]],
      heart: [[3, 14], [10, 22], [9, 14]],
    };
    for (const spine of SPINES) {
      const events = sunEvents(M, spine.faces);
      let total = 0;
      table[spine.id].forEach(([night, day], i) => {
        const light = daylightOn(M, events, i);
        expect(light, `${spine.id} day ${i}`).toHaveLength(1);
        // The table's hours are rounded by hand; the model is within about an hour of each.
        expect(Math.abs(light[0].night - night), `${spine.id} day ${i} night`).toBeLessThan(1.1);
        expect(Math.abs(light[0].day - day), `${spine.id} day ${i} day`).toBeLessThan(1.1);
        total += light[0].night + light[0].day;
      });
      // Three days in all, as the table's hours are (72).
      expect(total).toBeCloseTo(72, 3);
    }
  });

  it('a Spine has day exactly while either of its Facets does', () => {
    for (let t = 0; t < 3; t += 0.013)
      for (const spine of SPINES) expect(isDay(M, spine.faces, t), `${spine.id} at ${t}`).toBe(isDay(M, spine.faces[0], t) || isDay(M, spine.faces[1], t));
  });
});

// PM 2026-11-16: the World tab shows the sun moving around a still prism, as someone in the world sees it.
describe('the sun as seen from the world', () => {
  it('stands over each face exactly as the keyframes put that face under the sun', () => {
    for (let t = 0; t < 3; t += 0.037) {
      const sun = sunSeenFromWorld(M, t);
      expect(length(sun)).toBeCloseTo(1, 12);
      // Height of the fixed sun over the turned face = Blender z of its turned normal.
      for (const f of FACES) expect(dot(f.normal, sun), `${f.id} at ${t}`).toBeCloseTo(blender(toBlender(f.normal), t)[2], 9);
    }
  });

  it('is straight above the apex at Apex (12:00) and straight below the base at midnight, every day', () => {
    for (const day of [0, 1, 2, 5]) {
      const noon = sunSeenFromWorld(M, day + 0.5);
      const midnight = sunSeenFromWorld(M, day);
      VERTICES[0].forEach((n, i) => expect(noon[i]).toBeCloseTo(n, 9));
      VERTICES[0].forEach((n, i) => expect(midnight[i]).toBeCloseTo(-n, 9));
    }
  });

  it('names midnight and Apex, and no other hour', () => {
    expect(hourName(M, 0)).toBe('Midnight');
    expect(hourName(M, 3)).toBe('Midnight');
    expect(hourName(M, 4.5)).toBe('Apex');
    expect(hourName(M, 4.5 + 0.5 / 24)).toBeUndefined();
    expect(hourName(M, 0.25)).toBeUndefined();
  });

  it('comes back to the same place in the sky after three days, not after one', () => {
    const a = sunSeenFromWorld(M, 0.3);
    sunSeenFromWorld(M, 3.3).forEach((n, i) => expect(n).toBeCloseTo(a[i], 9));
    expect(Math.hypot(...sunSeenFromWorld(M, 1.3).map((n, i) => n - a[i]))).toBeGreaterThan(0.5);
  });

  it('the base is the ocean', () => {
    expect(FACES.find((f) => f.id === 'base')!.note).toBe('Ocean');
  });
});

// PM's Moon Cycle table for 3732 OI (2026-11-16): week, month, then the phase on each weekday.
const MOON_CYCLE = `
1|Golden Greeting|Smiling|Smiling|Smiling|Sleepy|Sleepy|Sleepy|Squinting|Squinting|Squinting
2|Golden Greeting|Closed|Closed|Closed|Peeking|Peeking|Peeking|Waking|Waking|Waking
3|Golden Greeting|Hunting|Hunting|Hunting|Open|Open|Open|Smiling|Smiling|Smiling
4|Golden Embrace|Sleepy|Sleepy|Sleepy|Squinting|Squinting|Squinting|Closed|Closed|Closed
5|Golden Embrace|Peeking|Peeking|Peeking|Waking|Waking|Waking|Hunting|Hunting|Hunting
6|Golden Embrace|Open|Open|Open|Smiling|Smiling|Smiling|Sleepy|Sleepy|Sleepy
7|Golden Farewell|Squinting|Squinting|Squinting|Closed|Closed|Closed|Peeking|Peeking|Peeking
8|Golden Farewell|Waking|Waking|Waking|Hunting|Hunting|Hunting|Open|Open|Open
9|Golden Farewell|Smiling|Smiling|Smiling|Sleepy|Sleepy|Sleepy|Squinting|Squinting|Squinting
10|Drowning Approach|Closed|Closed|Closed|Peeking|Peeking|Peeking|Waking|Waking|Waking
11|Drowning Approach|Hunting|Hunting|Hunting|Open|Open|Open|Smiling|Smiling|Smiling
12|Drowning Approach|Sleepy|Sleepy|Sleepy|Squinting|Squinting|Squinting|Closed|Closed|Closed
13|Drowning Stare|Peeking|Peeking|Peeking|Waking|Waking|Waking|Hunting|Hunting|Hunting
14|Drowning Stare|Open|Open|Open|Smiling|Smiling|Smiling|Sleepy|Sleepy|Sleepy
15|Drowning Stare|Squinting|Squinting|Squinting|Closed|Closed|Closed|Peeking|Peeking|Peeking
16|Drowning Quiet|Waking|Waking|Waking|Hunting|Hunting|Hunting|Open|Open|Open
17|Drowning Quiet|Smiling|Smiling|Smiling|Sleepy|Sleepy|Sleepy|Squinting|Squinting|Squinting
18|Drowning Quiet|Closed|Closed|Closed|Peeking|Peeking|Peeking|Waking|Waking|Waking
19|Silver Glimpse|Hunting|Hunting|Hunting|Open|Open|Open|Smiling|Smiling|Smiling
20|Silver Glimpse|Sleepy|Sleepy|Sleepy|Squinting|Squinting|Squinting|Closed|Closed|Closed
21|Silver Glimpse|Peeking|Peeking|Peeking|Waking|Waking|Waking|Hunting|Hunting|Hunting
22|Silver Hunt|Open|Open|Open|Smiling|Smiling|Smiling|Sleepy|Sleepy|Sleepy
23|Silver Hunt|Squinting|Squinting|Squinting|Closed|Closed|Closed|Peeking|Peeking|Peeking
24|Silver Hunt|Waking|Waking|Waking|Hunting|Hunting|Hunting|Open|Open|Open
25|Silver Repose|Smiling|Smiling|Smiling|Sleepy|Sleepy|Sleepy|Squinting|Squinting|Squinting
26|Silver Repose|Closed|Closed|Closed|Peeking|Peeking|Peeking|Waking|Waking|Waking
27|Silver Repose|Hunting|Hunting|Hunting|Open|Open|Open|Smiling|Smiling|Smiling`
  .trim()
  .split('\n')
  .map((row) => row.split('|'));

describe('the moon and the year', () => {
  it("every day of 3732 OI has the phase, month and weekday in the PM's table", () => {
    expect(MOON_CYCLE).toHaveLength(27);
    expect(daysPerYear(M)).toBe(243);
    MOON_CYCLE.forEach(([week, month, ...phases], w) => {
      expect(Number(week)).toBe(w + 1);
      phases.forEach((phase, d) => {
        // Any hour of the day.
        for (const hour of [0, 0.5, 0.99]) {
          const t = w * 9 + d + hour;
          expect(moonPhase(M, t).name, `week ${week} day ${d}`).toBe(phase);
          expect(dateOf(M, t)).toEqual({ year: 3732, dayOfYear: w * 9 + d, week: w, weekOfMonth: w % 3, month, weekday: M.weekdays[d] });
        }
      });
    });
    expect(M.era).toBe('OI');
  });

  it('the moon opens and closes like a pupil: Open is fully open, Closed is shut, and it narrows then widens between', () => {
    const open = Object.fromEntries(M.moon.phases.map((p) => [p.name, p.open]));
    expect(open.Open).toBe(1);
    expect(open.Closed).toBe(0);
    // In the table's order after Open: narrowing to Closed, then widening back.
    const order = ['Open', 'Smiling', 'Sleepy', 'Squinting', 'Closed', 'Peeking', 'Waking', 'Hunting', 'Open'].map((n) => open[n]);
    for (let i = 0; i < 4; i++) expect(order[i + 1]).toBeLessThan(order[i]);
    for (let i = 4; i < 8; i++) expect(order[i + 1]).toBeGreaterThan(order[i]);
  });

  it('the moon is always exactly opposite the sun', () => {
    for (const t of [0, 0.3, 1.7, 40.25]) {
      const sun = sunSeenFromWorld(M, t);
      const moon = moonSeenFromWorld(M, t);
      moon.forEach((n, i) => expect(n).toBeCloseTo(-sun[i], 12));
      // So a face has the moon over it exactly when the sun is under it.
      for (const f of FACES) expect(dot(f.normal, moon)).toBeCloseTo(-dot(f.normal, sun), 12);
    }
  });

  it('counts years either side of 3732, with the phases running straight on', () => {
    expect(dateOf(M, 243)).toMatchObject({ year: 3733, dayOfYear: 0, week: 0, month: 'Golden Greeting', weekday: 'Asmoday' });
    expect(dateOf(M, -1)).toMatchObject({ year: 3731, dayOfYear: 242, week: 26, month: 'Silver Repose', weekday: 'Nixaday' });
    // 243 days is ten 24-day cycles and three days: the next year starts one phase on,
    // and the last three days before 3732 are the phase before Smiling.
    expect(moonPhase(M, 243).name).toBe('Sleepy');
    expect(moonPhase(M, -1).name).toBe('Open');
    expect(moonPhase(M, -3).name).toBe('Open');
    expect(moonPhase(M, -4).name).toBe('Hunting');
  });
});
