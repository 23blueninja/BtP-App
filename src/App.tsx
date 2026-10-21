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
import { setPrefs, usePrefs, type Prefs } from './ui/prefs';
import logo from './assets/icons/8VNXled.png';

/** Panel-edge hosts (see the prismatic edge in styles.css). */
const EDGE_HOSTS = '.box, .builder-content, .summary, .ref-body, .ref-nav, .levelup, .char-card, .split-box';
/**
 * Firefox (Gecko) scrolls screen-fixed backgrounds a frame or two behind the
 * content, so its panel edges flicker after scrolling. There the edges' rainbow is
 * anchored to the page instead (.page-edges). Detected by engine feature, not by
 * user agent: only Gecko supports -moz-appearance.
 */
const PAGE_EDGES = typeof CSS !== 'undefined' && CSS.supports('-moz-appearance', 'none');

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

const OPTIONS: { key: keyof Prefs; label: string; note?: string }[] = [
  { key: 'pinStatBar', label: 'Pin the top bar while scrolling', note: 'Class Bonus, Attributes and AP stay at the top of the sheet (wide screens).' },
  { key: 'animateGradients', label: 'Animate alignment gradients', note: 'Headings and attribute symbols.' },
  { key: 'animateBackground', label: 'Animate the background' },
  { key: 'animateEdges', label: 'Animate panel edges', note: 'Panel edges drift with the background’s colours. Off: they keep their colours but stay still.' },
  { key: 'glassPanels', label: 'Glass panels', note: 'Frosted-glass panel backgrounds. Turn off if scrolling feels slow on this device.' },
];

function OptionsMenu({ onClose }: { onClose: () => void }) {
  const prefs = usePrefs();
  return (
    <Modal title="Options" onClose={onClose}>
      <div className="options">
        {OPTIONS.map((o) => (
          <label key={o.key} className="option-row">
            <input type="checkbox" checked={prefs[o.key]} onChange={(e) => setPrefs({ [o.key]: e.target.checked })} />
            <span>
              {o.label}
              {o.note && <span className="muted small"> {o.note}</span>}
            </span>
          </label>
        ))}
        <p className="muted small">Options are saved in this browser.</p>
      </div>
    </Modal>
  );
}

export function App() {
  const route = useHashRoute();
  const prefs = usePrefs();
  const [options, setOptions] = useState(false);
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

  // Panel edges show the same drifting rainbow as the background (see --prism-field):
  // keep the background and every edge on one clock so they line up, including
  // edges of panels added later.
  // With page-anchored edges (Firefox), each panel also gets its position on the
  // page (--edge-x/--edge-y) so its edge shows the colour for its own spot.
  useEffect(() => {
    if (typeof CSSAnimation === 'undefined') return;
    const names = new Set(['prism-drift', 'prism-edge-drift', 'prism-edge-drift-page']);
    let queued = false;
    const sync = () => {
      queued = false;
      for (const a of document.getAnimations()) if (a instanceof CSSAnimation && names.has(a.animationName) && a.startTime !== 0) a.startTime = 0;
      if (PAGE_EDGES)
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
    const ro = PAGE_EDGES && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(queue) : undefined;
    ro?.observe(document.body);
    return () => (mo.disconnect(), ro?.disconnect());
  }, []);

  return (
    <div className={['app', prefs.pinStatBar && 'pin-stats', !prefs.animateGradients && 'still-gradients', !prefs.animateBackground && 'still-bg', !prefs.animateEdges && 'still-edges', prefs.glassPanels && 'glass', PAGE_EDGES && 'page-edges'].filter(Boolean).join(' ')}>
      <div className="prism-bg" aria-hidden />
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
          <button type="button" className="icon-btn options-btn" onClick={() => setOptions(true)} aria-label="Options" title="Options">
            ⚙
          </button>
        </nav>
      </header>
      {options && <OptionsMenu onClose={() => setOptions(false)} />}
      <main>{body}</main>
      <footer className="footer muted small">Beyond the Prism © 2026 23BLUENINJA. Characters are saved in this browser.</footer>
    </div>
  );
}
