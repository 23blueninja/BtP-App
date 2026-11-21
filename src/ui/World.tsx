// The World tab: a model of the World Prism you can turn and zoom. It shows what
// someone in the world sees: the prism holds still and the sun travels around it
// (PM 2026-11-16; in the PM's Blender model it is the prism that moves). Drawn as SVG
// from src/engine/world.ts (no 3D library).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { moonOpen, dateOf, daysPerYear, moonPhase, moonSeenFromWorld, DAY_KINDS, daylightOn, faceLights, FACES, formatHour, hourName, hourOfDay, isDay, nextEvent, rotate, scale, SPINES, sunEvents, sunSeenFromWorld, turnOfCycle, turnOfWeek, VERTICES, weekday, WORLD_PRISM, type Place, type Vec3, type WorldModel } from '../engine/world';

/** How far from the prism's centre the sun is drawn (the pyramid's corners are 1 from its centre). Drawing only. */
const SUN_DISTANCE = 2.1;
/** The viewer's distance, for a slight perspective. */
const CAMERA = 9;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 3;
const START_VIEW = { yaw: 0.2, pitch: 0.3, zoom: 1 };
/** Play speeds, in hours of world time a second; the dial picks one (it starts on 4). */
const SPEEDS = [1, 2, 4, 6, 12, 24, 48, 72, 216];
const START_SPEED = 2;
/** "4 hours", "1 day", "9 days" for a play speed. */
function speedLabel(model: WorldModel, hours: number): string {
  if (hours < model.hoursPerTurn) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const d = hours / model.hoursPerTurn;
  return `${d} day${d === 1 ? '' : 's'}${d === model.weekdays.length ? ' (a week)' : ''}`;
}
/** Slider steps per day: half hours (the Blender model has 48 frames to a turn). */
const STEPS = 48;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];

interface View {
  yaw: number;
  pitch: number;
  zoom: number;
}

/** A point as the viewer sees it: x right, y up, z toward the viewer. */
const turned = (p: Vec3, v: View): Vec3 => rotate(rotate(p, Y, v.yaw), X, v.pitch);
/** Screen position (SVG y runs downward) with a slight perspective. */
function screen(p: Vec3): [number, number] {
  const k = CAMERA / (CAMERA - p[2]);
  return [p[0] * k, -p[1] * k];
}
const fmt = (n: number) => n.toFixed(3);
/** "5.2 h" for a stretch of turns. */
const span = (model: WorldModel, turns: number): string => `${(turns * model.hoursPerTurn).toFixed(1)} h`;

/** The moon as a cat's eye: a dark disc with a bright pupil, round when open (1) and a vertical slit as it closes (0). */
function MoonEye({ cx, cy, r, open }: { cx: number; cy: number; r: number; open: number }) {
  return (
    <>
      <circle className="world-moon-disc" cx={cx} cy={cy} r={r} />
      {open > 0.005 && <ellipse className="world-moon-pupil" cx={cx} cy={cy} rx={r * 0.88 * open} ry={r * 0.88} />}
    </>
  );
}

export function World({ model = WORLD_PRISM }: { model?: WorldModel }) {
  const [view, setView] = useState<View>(START_VIEW);
  // Days (turns) since the first midnight of the model's start year; the calendar will count from this too.
  const [turns, setTurns] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(START_SPEED);
  const speedRef = useRef(SPEEDS[START_SPEED]);
  speedRef.current = SPEEDS[speed];
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setTurns((t) => t + (dt * speedRef.current) / model.hoursPerTurn);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, model]);

  // The wheel zooms the model instead of scrolling the page (needs a non-passive listener).
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => ({ ...v, zoom: clamp(v.zoom * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const turn = (dYaw: number, dPitch: number) => setView((v) => ({ ...v, yaw: v.yaw + dYaw, pitch: clamp(v.pitch + dPitch, -Math.PI / 2, Math.PI / 2) }));
  const zoomBy = (k: number) => setView((v) => ({ ...v, zoom: clamp(v.zoom * k, ZOOM_MIN, ZOOM_MAX) }));

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const was = pointers.current.get(e.pointerId);
    if (!was) return;
    const now = { x: e.clientX, y: e.clientY };
    if (pointers.current.size === 1) {
      turn((now.x - was.x) * 0.01, (now.y - was.y) * 0.01);
    } else if (pointers.current.size === 2) {
      // Pinch: zoom by how much the two fingers moved apart.
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(was.x - other.x, was.y - other.y);
      const after = Math.hypot(now.x - other.x, now.y - other.y);
      if (before > 0) zoomBy(after / before);
    }
    pointers.current.set(e.pointerId, now);
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => pointers.current.delete(e.pointerId);

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = 0.12;
    if (e.key === 'ArrowLeft') turn(-step, 0);
    else if (e.key === 'ArrowRight') turn(step, 0);
    else if (e.key === 'ArrowUp') turn(0, -step);
    else if (e.key === 'ArrowDown') turn(0, step);
    else if (e.key === '+' || e.key === '=') zoomBy(1.2);
    else if (e.key === '-') zoomBy(1 / 1.2);
    else return;
    e.preventDefault();
  };

  const lights = faceLights(model, turns);
  // Every place the table lists: the faces, then the Spines between the Facets.
  const places = useMemo(
    () =>
      [
        ...FACES.map((f) => ({ id: f.id, name: f.name, note: f.note ?? '', place: f.id as Place })),
        ...SPINES.map((sp) => ({ id: sp.id, name: sp.name, note: sp.faces.map((id) => FACES.find((f) => f.id === id)?.name.replace(/ Facet$/, '')).join(' and '), place: sp.faces as Place })),
      ].map((p) => ({ ...p, events: sunEvents(model, p.place) })),
    [model],
  );
  const days = model.weekdays.length;
  const at = turnOfWeek(model, turns);
  const dayName = weekday(model, turns);
  const hour = hourOfDay(model, turns);
  const dayOfCycle = Math.floor(turnOfCycle(model, turns) + 1e-9) % model.turnsPerCycle;

  const named = hourName(model, turns);
  const date = dateOf(model, turns);
  const phase = moonPhase(model, turns);
  const open = moonOpen(model, turns);
  const weekStart = Math.floor((turns + 1e-9) / days) * days;
  const weeks = model.months.length * model.weeksPerMonth;
  const today = Math.floor(turns + 1e-9);
  const yearStart = today - date.dayOfYear;
  // The year's moon, day by day (at Apex), in the layout of the PM's Moon Cycle table.
  const moonYear = useMemo(
    () =>
      Array.from({ length: weeks }, (_, w) =>
        Array.from({ length: days }, (_, d) => {
          const t = yearStart + w * days + d + 0.5;
          return { phase: moonPhase(model, t).name, open: moonOpen(model, t) };
        }),
      ),
    [model, yearStart, weeks, days],
  );

  // The calendar's days only change with the day, so they aren't rebuilt on every
  // frame while Play runs. A day picked keeps the hour.
  const calendarRows = useMemo(
    () =>
      moonYear.map((week, w) => (
        <tr key={w} className={w % model.weeksPerMonth === 0 ? 'world-cal-month' : undefined}>
          <th scope="row">{w + 1}</th>
          <td className="world-cal-month-name">{model.months[Math.floor(w / model.weeksPerMonth)]}</td>
          {week.map((m, d) => {
            const isToday = w * days + d === date.dayOfYear;
            return (
              <td key={d} aria-current={isToday ? 'date' : undefined} className={isToday ? 'today' : undefined}>
                <button type="button" className="world-cal-day" aria-label={`Week ${w + 1}, ${model.weekdays[d]}: ${m.phase}`} onClick={() => setTurns((t) => yearStart + w * days + d + (t - Math.floor(t + 1e-9)))}>
                  <svg className="world-moon-icon" viewBox="-1.1 -1.1 2.2 2.2" aria-hidden>
                    <MoonEye cx={0} cy={0} r={1} open={m.open} />
                  </svg>
                  <span>{m.phase}</span>
                </button>
              </td>
            );
          })}
        </tr>
      )),
    [moonYear, model, days, yearStart, date.dayOfYear],
  );

  // The sun's path around the prism over the whole cycle, today's stretch drawn
  // boldly; each is split into the part behind the prism's centre and the part in front.
  const path = useMemo(() => {
    const perDay = 96;
    return Array.from({ length: model.turnsPerCycle * perDay + 1 }, (_, i) => ({ day: Math.min(Math.floor(i / perDay), model.turnsPerCycle - 1), p: scale(sunSeenFromWorld(model, i / perDay), SUN_DISTANCE) }));
  }, [model]);
  const lines = { todayBack: '', todayFront: '', restBack: '', restFront: '' };
  for (let i = 0; i + 1 < path.length; i++) {
    const a = turned(path[i].p, view);
    const b = turned(path[i + 1].p, view);
    const [x1, y1] = screen(a);
    const [x2, y2] = screen(b);
    const key = `${path[i].day === dayOfCycle ? 'today' : 'rest'}${a[2] + b[2] < 0 ? 'Back' : 'Front'}` as keyof typeof lines;
    lines[key] += `M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`;
  }

  const sun = turned(scale(sunSeenFromWorld(model, turns), SUN_DISTANCE), view);
  const [sunX, sunY] = screen(sun);
  const sunSize = 0.2 * (CAMERA / (CAMERA - sun[2]));
  const moon = turned(scale(moonSeenFromWorld(model, turns), SUN_DISTANCE), view);
  const [moonX, moonY] = screen(moon);
  const moonShape = (
    <g className="world-moon" data-testid="world-moon" data-phase={phase.name} data-open={open.toFixed(3)} data-x={fmt(moonX)} data-y={fmt(moonY)}>
      <MoonEye cx={moonX} cy={moonY} r={0.2 * (CAMERA / (CAMERA - moon[2]))} open={open} />
    </g>
  );
  const sunShape = (
    <g className="world-sun" data-testid="world-sun" data-x={fmt(sunX)} data-y={fmt(sunY)}>
      <circle className="world-sun-glow" cx={sunX} cy={sunY} r={sunSize * 2} />
      <circle className="world-sun-disc" cx={sunX} cy={sunY} r={sunSize} />
    </g>
  );

  const corners = VERTICES.map((p) => turned(p, view));
  // Faces turned toward the viewer (the pyramid is convex, so those are all that show).
  const shown = lights
    .map((l) => ({ ...l, normal: turned(l.face.normal, view), centre: turned(l.face.centre, view) }))
    .filter((f) => f.normal[0] * -f.centre[0] + f.normal[1] * -f.centre[1] + f.normal[2] * (CAMERA - f.centre[2]) > 0);

  const size = 5.2 / view.zoom;
  const summary = lights.map((l) => `${l.face.name}: ${l.day ? 'day' : 'night'}`).join(', ');

  return (
    <div className="world">
      <h1>The World Prism</h1>
      <p className="muted world-intro">Seen from the world, the sun circles the World Prism once a day, rising over one Facet and setting on the next. At Apex (12:00) it stands straight above the prism's point; at midnight it is under the ocean base.</p>
      <div className="world-layout">
        <section className="box world-stage">
          <svg
            ref={svg}
            className="world-view"
            viewBox={`${fmt(-size / 2)} ${fmt(-size / 2)} ${fmt(size)} ${fmt(size)}`}
            role="img"
            tabIndex={0}
            aria-label={`Model of the World Prism on ${dayName} at ${formatHour(hour)}${named ? ` (${named})` : ''}. ${summary}. The moon, opposite the sun, is ${phase.name}. Drag or use the arrow keys to turn it; pinch, scroll or press plus and minus to zoom.`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          >
            <path className="world-path rest back" d={lines.restBack} />
            <path className="world-path back" data-testid="world-path" d={lines.todayBack} />
            {sun[2] < 0 && sunShape}
            {moon[2] < 0 && moonShape}
            {shown.map((f) => {
              const [lx, ly] = screen(f.centre);
              return (
                <g key={f.face.id} data-face={f.face.id} data-day={f.day}>
                  <polygon
                    className="world-face"
                    points={f.face.corners.map((i) => screen(corners[i]).map(fmt).join(',')).join(' ')}
                    style={{ fill: `color-mix(in srgb, ${f.face.color} ${Math.round(30 + 70 * f.light)}%, var(--world-night))` }}
                  />
                  {/* A face seen nearly edge-on is too thin a sliver to hold its name. */}
                  {f.normal[2] > 0.5 && (
                    <text className="world-label" x={lx} y={ly} textAnchor="middle" dominantBaseline="central">
                      {f.face.name.replace(/ Facet$/, '')}
                    </text>
                  )}
                </g>
              );
            })}
            <path className="world-path rest" d={lines.restFront} />
            <path className="world-path" d={lines.todayFront} />
            {sun[2] >= 0 && sunShape}
            {moon[2] >= 0 && moonShape}
          </svg>
          <div className="row wrap world-view-controls">
            {/* Drawn signs: a font's minus and plus sit where its digits do, not in the middle of a button. */}
            <button type="button" className="world-zoom" onClick={() => zoomBy(1 / 1.25)} disabled={view.zoom <= ZOOM_MIN} aria-label="Zoom out">
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M3 8h10" />
              </svg>
            </button>
            <button type="button" className="world-zoom" onClick={() => zoomBy(1.25)} disabled={view.zoom >= ZOOM_MAX} aria-label="Zoom in">
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M3 8h10M8 3v10" />
              </svg>
            </button>
            <button type="button" onClick={() => setView(START_VIEW)}>
              Reset view
            </button>
            <span className="muted small">Drag to turn, pinch or scroll to zoom.</span>
          </div>
        </section>
        <section className="box world-time">
          <h2 className="box-title">Time</h2>
          <label className="world-hour">
            <span>
              <strong data-testid="world-day">{dayName}</strong>, <strong data-testid="world-hour">{formatHour(hour)}</strong>
              {named && <span data-testid="world-hour-name"> ({named})</span>} <span className="muted">of {model.hoursPerTurn} hours</span>
            </span>
            <input type="range" aria-label="Time in the week" min={0} max={days * STEPS - 1} step={1} value={Math.min(Math.round(at * STEPS), days * STEPS - 1)} onChange={(e) => setTurns(weekStart + Number(e.target.value) / STEPS)} />
          </label>
          <p className="world-date">
            <span data-testid="world-date">
              Week {date.week + 1}, {date.month}, {date.year} {model.era}
            </span>
            <span className="muted" data-testid="world-day-of-year">
              Day {date.dayOfYear + 1} of {daysPerYear(model)}
            </span>
            <span className="world-moon-now">
              <svg className="world-moon-icon" viewBox="-1.1 -1.1 2.2 2.2" aria-hidden>
                <MoonEye cx={0} cy={0} r={1} open={open} />
              </svg>
              Moon: <strong data-testid="world-moon-phase">{phase.name}</strong>
            </span>
          </p>
          <div className="row wrap">
            <button type="button" className={playing ? '' : 'primary'} onClick={() => setPlaying((p) => !p)}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <label className="row world-day-pick">
              <span className="muted small">Day</span>
              <select aria-label="Day" value={dayName} onChange={(e) => setTurns(weekStart + model.weekdays.indexOf(e.target.value) + hour / model.hoursPerTurn)}>
                {model.weekdays.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="row world-day-pick">
              <span className="muted small">Week</span>
              <select aria-label="Week" value={date.week} onChange={(e) => setTurns((t) => t + (Number(e.target.value) - date.week) * days)}>
                {Array.from({ length: weeks }, (_, w) => (
                  <option key={w} value={w}>
                    {w + 1}: {model.months[Math.floor(w / model.weeksPerMonth)]}
                  </option>
                ))}
              </select>
            </label>
            <label className="row world-day-pick">
              <span className="muted small">Year</span>
              <input
                type="number"
                aria-label="Year"
                className="world-year"
                value={date.year}
                onChange={(e) => {
                  const year = Math.round(Number(e.target.value));
                  if (e.target.value !== '' && Number.isFinite(year) && Math.abs(year) < 100000) setTurns((t) => t + (year - date.year) * daysPerYear(model));
                }}
              />
            </label>
          </div>
          <label className="row world-speed">
            <span className="muted small">Speed</span>
            <input type="range" aria-label="Speed" min={0} max={SPEEDS.length - 1} step={1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
            <output data-testid="world-speed">{speedLabel(model, SPEEDS[speed])} a second</output>
          </label>
          <table className="world-faces">
            <thead>
              <tr>
                <th>Place</th>
                <th>Now</th>
                <th>Next</th>
                <th>Today</th>
              </tr>
            </thead>
            <tbody>
              {places.map((p) => {
                const next = nextEvent(model, p.events, turns);
                const light = lights.find((l) => l.face.id === p.id);
                const day = isDay(model, p.place, turns);
                const kind = DAY_KINDS[p.id]?.[dayOfCycle];
                return (
                  <tr key={p.id} data-place={p.id}>
                    <th scope="row">
                      {p.name}
                      {p.note && <span className="muted small world-between"> {p.note}</span>}
                    </th>
                    <td>
                      {day ? 'Day' : 'Night'}
                      {/* Kept in place (hidden) at night, so the row doesn't change height at every sunrise and sunset. */}
                      {light && (
                        <span className={`muted small world-sun-up${day ? '' : ' hidden'}`} aria-hidden={!day || undefined}>
                          {' '}
                          sun {day ? Math.round(light.sunHeight) : 0}° up
                        </span>
                      )}
                    </td>
                    <td>{next ? `${next.type === 'sunrise' ? 'Sunrise' : 'Sunset'} in ${span(model, next.in)}` : '–'}</td>
                    <td>
                      {kind && <span className="world-kind">{kind} </span>}
                      <span className={`world-hours ${kind ? 'muted small' : ''}`}>
                        {daylightOn(model, p.events, dayOfCycle)
                          .map((d) => `${Math.round(d.night)} N / ${Math.round(d.day)} D`)
                          .join(', ')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">
            The moon sits exactly opposite the sun, and opens and closes like a cat's eye. The bold line is the sun's path today; the faint ones are the other days of the three-day cycle. Today: hours of night (N), then hours of the day (D) that follows, for the sunrise that falls on this day. A Spine has day while either of its Facets does. A Facet is flat, so the sun rises over all of it at the same moment.
          </p>
        </section>
      </div>
      <section className="box world-moon-calendar">
        <h2 className="box-title">
          Moon calendar, {date.year} {model.era}
        </h2>
        <p className="muted small">Each phase lasts three days, and the cycle runs on from year to year, so each year starts one phase later. Pick a day to go to it.</p>
        <div className="world-cal-scroll" role="region" aria-label="Moon calendar" tabIndex={0}>
          <table className="world-cal">
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col">Month</th>
                {model.weekdays.map((d) => (
                  <th scope="col" key={d}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{calendarRows}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
