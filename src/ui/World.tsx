// The World tab: a model of the World Prism you can turn and zoom. The sun stays
// put and the prism moves under it, as in the PM's Blender model. Drawn as SVG
// from src/engine/world.ts (no 3D library).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { daylightShare, faceLights, FACES, nextEvent, normalize, rotate, scale, sunEvents, turnDirection, turnOfCycle, turnPoint, VERTICES, WORLD_PRISM, type Vec3, type WorldModel } from '../engine/world';

/** How far from the pivot the sun is drawn (the pyramid's corners are 1 from its centre). Drawing only. */
const SUN_DISTANCE = 2.1;
/** The viewer's distance, for a slight perspective. */
const CAMERA = 9;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 3;
const START_VIEW = { yaw: 0.6, pitch: 0.3, zoom: 1 };
/** Turns per second while playing. */
const PLAY_SPEED = 0.2;
/** Slider steps per turn (the Blender model has 48 frames to a turn). */
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
/** "1.25 turns"; hours instead once the model has them. */
function span(model: WorldModel, turns: number): string {
  return model.hoursPerTurn ? `${(turns * model.hoursPerTurn).toFixed(1)} h` : `${turns.toFixed(2)} ${Math.abs(turns - 1) < 0.005 ? 'turn' : 'turns'}`;
}

export function World({ model = WORLD_PRISM }: { model?: WorldModel }) {
  const [view, setView] = useState<View>(START_VIEW);
  // Turns since the model's start; the calendar will count from this too.
  const [turns, setTurns] = useState(0);
  const [playing, setPlaying] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setTurns((t) => t + dt * PLAY_SPEED);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

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
  const events = useMemo(() => FACES.map((f) => sunEvents(model, f.id)), [model]);
  const shares = useMemo(() => FACES.map((f) => daylightShare(model, f.id)), [model]);
  const at = turnOfCycle(model, turns);

  // The line the prism tumbles about, through the pivot.
  const axis = normalize(model.tumbleAxis);
  const [ax1, ay1] = screen(turned(scale(axis, -1.9), view));
  const [ax2, ay2] = screen(turned(scale(axis, 1.9), view));

  const sun = turned(scale(normalize(model.sun), SUN_DISTANCE), view);
  const [sunX, sunY] = screen(sun);
  const sunSize = 0.2 * (CAMERA / (CAMERA - sun[2]));
  const sunShape = (
    <g className="world-sun" data-testid="world-sun" data-x={fmt(sunX)} data-y={fmt(sunY)}>
      <circle className="world-sun-glow" cx={sunX} cy={sunY} r={sunSize * 2} />
      <circle className="world-sun-disc" cx={sunX} cy={sunY} r={sunSize} />
    </g>
  );

  const corners = VERTICES.map((p) => turned(turnPoint(model, turns, p), view));
  // Faces turned toward the viewer (the pyramid is convex, so those are all that show).
  const shown = lights
    .map((l) => ({ ...l, normal: turned(turnDirection(model, turns, l.face.normal), view), centre: turned(turnPoint(model, turns, l.face.centre), view) }))
    .filter((f) => f.normal[0] * -f.centre[0] + f.normal[1] * -f.centre[1] + f.normal[2] * (CAMERA - f.centre[2]) > 0);

  const size = 5.2 / view.zoom;
  const summary = lights.map((l) => `${l.face.name}: ${l.day ? 'day' : 'night'}`).join(', ');

  return (
    <div className="world">
      <h1>The World Prism</h1>
      <p className="muted world-intro">The sun stays where it is. The World Prism tumbles beneath it, spinning as it goes, and each face has day while it is turned toward the sun.</p>
      <div className="world-layout">
        <section className="box world-stage">
          <svg
            ref={svg}
            className="world-view"
            viewBox={`${fmt(-size / 2)} ${fmt(-size / 2)} ${fmt(size)} ${fmt(size)}`}
            role="img"
            tabIndex={0}
            aria-label={`Model of the World Prism, ${span(model, at)} into its cycle. ${summary}. Drag or use the arrow keys to turn it; pinch, scroll or press plus and minus to zoom.`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          >
            <line className="world-axis" x1={ax1} y1={ay1} x2={ax2} y2={ay2} />
            {sun[2] < 0 && sunShape}
            {shown.map((f) => {
              const [lx, ly] = screen(f.centre);
              return (
                <g key={f.face.id} data-face={f.face.id} data-day={f.day}>
                  <polygon
                    className="world-face"
                    points={f.face.corners.map((i) => screen(corners[i]).map(fmt).join(',')).join(' ')}
                    style={{ fill: `color-mix(in srgb, var(--world-day) ${Math.round(f.light * 100)}%, var(--world-night))` }}
                  />
                  <text className={`world-label ${f.light > 0.45 ? 'on-day' : ''}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="central">
                    {f.face.name.replace(/^Face /, '')}
                  </text>
                </g>
              );
            })}
            {sun[2] >= 0 && sunShape}
          </svg>
          <div className="row wrap world-view-controls">
            <button type="button" onClick={() => zoomBy(1 / 1.25)} disabled={view.zoom <= ZOOM_MIN} aria-label="Zoom out">
              −
            </button>
            <button type="button" onClick={() => zoomBy(1.25)} disabled={view.zoom >= ZOOM_MAX} aria-label="Zoom in">
              +
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
              Turn <strong data-testid="world-turn">{at.toFixed(2)}</strong> <span className="muted">of {model.turnsPerCycle}</span>
            </span>
            <input type="range" min={0} max={model.turnsPerCycle * STEPS - 1} step={1} value={Math.min(Math.round(at * STEPS), model.turnsPerCycle * STEPS - 1)} onChange={(e) => setTurns(Number(e.target.value) / STEPS)} />
          </label>
          <div className="row">
            <button type="button" className={playing ? '' : 'primary'} onClick={() => setPlaying((p) => !p)}>
              {playing ? 'Pause' : 'Play'}
            </button>
          </div>
          <table className="world-faces">
            <thead>
              <tr>
                <th>Face</th>
                <th>Now</th>
                <th>Next</th>
                <th>Daylight</th>
              </tr>
            </thead>
            <tbody>
              {lights.map((l, i) => {
                const next = nextEvent(model, events[i], turns);
                return (
                  <tr key={l.face.id} data-face-row={l.face.id}>
                    <th scope="row">{l.face.name}</th>
                    <td>
                      {l.day ? 'Day' : 'Night'}
                      {l.day && <span className="muted small"> sun {Math.round(l.sunHeight)}° up</span>}
                    </td>
                    <td>{next ? `${next.type === 'sunrise' ? 'Sunrise' : 'Sunset'} in ${span(model, next.in)}` : '–'}</td>
                    <td>{Math.round(shares[i] * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">
            One turn is one full tumble of the prism; after {model.turnsPerCycle} it is back where it began. A face is flat, so the sun rises over all of it at the same moment.
            {!model.hoursPerTurn && ' Hours are not set yet.'}
          </p>
        </section>
      </div>
    </div>
  );
}
