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
import logo from './assets/icons/8VNXled.png';

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

export function App() {
  const route = useHashRoute();
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

  return (
    <div className="app">
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
        </nav>
      </header>
      <main>{body}</main>
      <footer className="footer muted small">Beyond the Prism © 2026 23BLUENINJA. Characters are saved in this browser.</footer>
    </div>
  );
}
