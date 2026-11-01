import { useCallback, useEffect, useState } from 'react';
import type { Character } from './engine/character';
import { derive } from './engine/derive';
import { clampPlay, freshPlay } from './engine/play';
import { store } from './storage/storage';
import { Builder } from './ui/Builder';
import { go, useHashRoute } from './ui/common';
import { Home } from './ui/Home';
import { LevelUp } from './ui/LevelUp';
import { Reference } from './ui/Reference';
import { Sheet } from './ui/Sheet';
import { Modal } from './ui/common';
import { LOOKS, setPrefs, usePrefs, type Look, type Prefs } from './ui/prefs';
import { removeDemo, startTour, Tour, tourActive } from './ui/Tour';
import logo from './assets/icons/8VNXled.png';

/** Panel-edge hosts (see the prismatic edge in styles.css). */
const EDGE_HOSTS = '.box, .builder-content, .summary, .ref-body, .ref-nav, .levelup, .char-card, .split-box';
/**
 * Firefox (Gecko) shakes content drawn through a cut-out (masks, background-clip:
 * text) while smooth-scrolling, and lags screen-fixed backgrounds. There (.gecko)
 * panel edges are gradient borders anchored to the page and headings are solid.
 * Detected by engine feature, not by user agent: only Gecko supports -moz-appearance.
 */
const GECKO = typeof CSS !== 'undefined' && CSS.supports('-moz-appearance', 'none');

function useCharacter(id: string | undefined) {
  const [c, setC] = useState<Character | undefined>(() => (id ? store.get(id) : undefined));
  useEffect(() => setC(id ? store.get(id) : undefined), [id]);
  const update = useCallback((fn: (c: Character) => Character) => {
    setC((prev) => {
      if (!prev) return prev;
      const next = { ...fn(prev), updatedAt: new Date().toISOString() };
      store.save(next);
      return next;
    });
  }, []);
  return [c, update] as const;
}

type BoolPref = { [K in keyof Prefs]: Prefs[K] extends boolean ? K : never }[keyof Prefs];
type Toggle = { key: BoolPref; label: string; note?: string };

/** Toggles a look sets; each look's dropdown customises them. */
const LOOK_TOGGLES: Toggle[] = [
  { key: 'cutCorners', label: 'Cut corners', note: 'Panel corners cut flat. Off: square corners.' },
  { key: 'glassPanels', label: 'Glass panels', note: 'Frosted-glass panel backgrounds. Turn off if scrolling feels slow on this device.' },
  { key: 'animateEdges', label: 'Animate panel edges', note: 'Edges drift with the background’s colours. Off: they keep their colours and glint but stay still.' },
];
/** Toggles that apply whichever look is chosen. */
const OTHER_TOGGLES: Toggle[] = [
  { key: 'animateGradients', label: 'Animate alignment gradients', note: 'Headings and attribute symbols.' },
  { key: 'animateBackground', label: 'Animate the background', note: 'The rainbow and the moving triangle grid.' },
  { key: 'pinStatBar', label: 'Pin the top bar while scrolling', note: 'Class Bonus, Attributes and AP stay at the top of the sheet (wide screens).' },
];

function ToggleRow({ t }: { t: Toggle }) {
  const prefs = usePrefs();
  return (
    <label className="option-row">
      <input type="checkbox" checked={prefs[t.key]} onChange={(e) => setPrefs({ [t.key]: e.target.checked })} />
      <span>
        {t.label}
        {t.note && <span className="muted small"> {t.note}</span>}
      </span>
    </label>
  );
}

function OptionsMenu({ onClose, onTour }: { onClose: () => void; onTour: () => void }) {
  const prefs = usePrefs();
  return (
    <Modal title="Options" onClose={onClose}>
      <div className="options">
        <fieldset className="looks">
          <legend>Look</legend>
          {(Object.keys(LOOKS) as Look[]).map((k) => (
            <div key={k} className={`look ${prefs.look === k ? 'selected' : ''}`}>
              <label className="option-row">
                <input type="radio" name="look" checked={prefs.look === k} onChange={() => setPrefs({ look: k, ...LOOKS[k].settings })} />
                <span>
                  <strong>{LOOKS[k].name}</strong>
                  <span className="muted small"> {LOOKS[k].description}</span>
                </span>
              </label>
              {prefs.look === k && (
                <details className="look-custom">
                  <summary>Customise {LOOKS[k].name}</summary>
                  {LOOK_TOGGLES.map((t) => (
                    <ToggleRow key={t.key} t={t} />
                  ))}
                </details>
              )}
            </div>
          ))}
        </fieldset>
        {OTHER_TOGGLES.map((t) => (
          <ToggleRow key={t.key} t={t} />
        ))}
        <div className="row">
          <button type="button" onClick={onTour}>
            Take the tour
          </button>
        </div>
        <p className="muted small">Options are saved in this browser.</p>
      </div>
    </Modal>
  );
}

export function App() {
  const route = useHashRoute();
  const prefs = usePrefs();
  const [options, setOptions] = useState(false);
  const [saveFailing, setSaveFailing] = useState(false);
  useEffect(() => store.onSaveState(setSaveFailing), []);
  const [section, id, view, step] = route;
  const [c, update] = useCharacter(section === 'c' ? id : undefined);

  // New characters start fully rested the first time their sheet opens.
  useEffect(() => {
    if (c && section === 'c' && !view && !c.play.initialized) update((x) => ({ ...x, play: freshPlay(x) }));
  }, [c, section, view, update]);
  // Keep play values within maximums after edits.
  useEffect(() => {
    if (!c || !c.play.initialized) return;
    const clamped = clampPlay(c.play, derive(c));
    if (JSON.stringify(clamped) !== JSON.stringify(c.play)) update((x) => ({ ...x, play: clamped }));
  }, [c, update]);

  let body;
  if (section === 'rules') body = <Reference id={route.slice(1).join('/') || undefined} />;
  else if (section === 'c' && !c) body = <p className="muted">Character not found.</p>;
  else if (section === 'c' && c && view === 'build') body = <Builder c={c} update={update} step={step ?? 'basics'} />;
  else if (section === 'c' && c && view === 'levelup') body = <LevelUp c={c} update={update} />;
  else if (section === 'c' && c) body = <Sheet c={c} update={update} />;
  else body = <Home />;

  // A tour's demo character left behind (the page closed mid-tour) is removed.
  useEffect(() => {
    if (!tourActive()) removeDemo();
  }, []);

  // Panel edges show the same drifting rainbow as the background (see --prism-field):
  // keep the background and every edge on one clock so they line up, including
  // edges of panels added later.
  // In Firefox each panel also gets its position on the page (--edge-x/--edge-y) so
  // its edge shows the colour for its own spot.
  useEffect(() => {
    if (typeof CSSAnimation === 'undefined') return;
    const names = new Set(['prism-drift', 'prism-grid-drift', 'prism-grid-counter', 'prism-edge-drift', 'prism-edge-drift-gecko']);
    let queued = false;
    const sync = () => {
      queued = false;
      for (const a of document.getAnimations()) if (a instanceof CSSAnimation && names.has(a.animationName) && a.startTime !== 0) a.startTime = 0;
      if (GECKO)
        document.querySelectorAll<HTMLElement>(EDGE_HOSTS).forEach((el) => {
          const r = el.getBoundingClientRect();
          el.style.setProperty('--edge-x', `${Math.round(r.left + scrollX)}px`);
          el.style.setProperty('--edge-y', `${Math.round(r.top + scrollY)}px`);
        });
    };
    const queue = () => {
      if (!queued) (queued = true), requestAnimationFrame(sync);
    };
    sync();
    const mo = new MutationObserver(queue);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    // Panels move when others grow or the window resizes.
    const ro = GECKO && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(queue) : undefined;
    ro?.observe(document.body);
    return () => (mo.disconnect(), ro?.disconnect());
  }, []);

  return (
    <div className={['app', prefs.pinStatBar && 'pin-stats', !prefs.animateGradients && 'still-gradients', !prefs.animateBackground && 'still-bg', !prefs.animateEdges && 'still-edges', prefs.glassPanels && 'glass', !prefs.cutCorners && 'square-corners', GECKO && 'gecko'].filter(Boolean).join(' ')}>
      <div className="prism-bg" aria-hidden>
        <div className="prism-grid">
          <div className="prism-counter" />
        </div>
      </div>
      <header className="topbar">
        <button type="button" className="brand" onClick={() => go()}>
          <img src={logo} alt="" className="brand-logo" /> BtP Characters
        </button>
        <nav>
          <button type="button" className="link" onClick={() => go()}>
            Characters
          </button>
          {c && section === 'c' && (
            <button type="button" className="link" onClick={() => go('c', c.id)}>
              Sheet
            </button>
          )}
          <button type="button" className="link" onClick={() => go('rules')}>
            Rules
          </button>
          <button type="button" className="icon-btn options-btn" data-tour="options" onClick={() => setOptions(true)} aria-label="Options" title="Options">
            ⚙
          </button>
        </nav>
      </header>
      {options && <OptionsMenu onClose={() => setOptions(false)} onTour={() => (setOptions(false), startTour())} />}
      <Tour />
      {saveFailing && (
        <p className="warn" role="alert">
          Changes aren't being saved: this browser's storage is full or blocked. Export your character to keep a copy.
        </p>
      )}
      <main>{body}</main>
      <footer className="footer muted small">Beyond the Prism © 2026 23BLUENINJA. Characters are saved in this browser.</footer>
    </div>
  );
}
