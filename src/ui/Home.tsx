import { useEffect, useRef, useState } from 'react';
import { ancestryName } from '../data/ancestries';
import { classById } from '../data/classes';
import { newCharacter, newId } from '../engine/character';
import { exportCharacter, importCharacter, store } from '../storage/storage';
import { go } from './common';
import { usePrefs } from './prefs';
import { startTour, TOUR_DEMO_ID, tourActive } from './Tour';
import logo from '../assets/icons/8VNXled.png';

export function Home() {
  const [, setTick] = useState(0);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const list = store.list().filter((s) => s.id !== TOUR_DEMO_ID);
  const refresh = () => setTick((t) => t + 1);
  const { tourSeen } = usePrefs();
  // The tour starts by itself the first time the app opens with no characters.
  const firstVisit = !tourSeen && list.length === 0;
  useEffect(() => {
    if (firstVisit && !tourActive()) startTour();
  }, [firstVisit]);

  return (
    <div className="home">
      <section className="hero">
        <img src={logo} alt="" className="hero-logo" />
        <h1>Beyond the Prism</h1>
        <p>Character builder & sheet for the Alpha Rules.</p>
        <div className="row wrap center">
          <button
            type="button"
            className="primary"
            data-tour="new"
            onClick={() => {
              const c = newCharacter();
              store.save(c);
              go('c', c.id, 'build', 'basics');
            }}
          >
            + New character
          </button>
          <button type="button" data-tour="import" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
          <button type="button" data-tour="rules" onClick={() => go('rules')}>
            📖 Rules reference
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const c = await importCharacter(f);
                if (store.get(c.id)) c.id = newId();
                store.save({ ...c, updatedAt: new Date().toISOString() });
                setError('');
                refresh();
              } catch {
                setError('That file is not a valid character export.');
              }
            }}
          />
        </div>
        {error && <p className="warn">{error}</p>}
        <p className="small">
          <button type="button" className="link" onClick={startTour}>
            Take the tour
          </button>
        </p>
      </section>
      <section>
        <h2>Your characters</h2>
        {list.length === 0 && <p className="muted">No characters yet. They are saved in this browser; use Export to back them up or move them to another device.</p>}
        <div className="char-grid">
          {list.map((s) => (
            <div key={s.id} className="char-card">
              <button type="button" className="char-open" onClick={() => go('c', s.id)}>
                <strong>{s.name || 'Unnamed'}</strong>
                <span className="muted">
                  Level {s.level} {ancestryName(s)} {classById.get(s.classId)?.name ?? ''}
                </span>
                <small className="muted">Updated {new Date(s.updatedAt).toLocaleString()}</small>
              </button>
              <div className="row">
                <button type="button" onClick={() => go('c', s.id, 'build', 'basics')}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const c = store.get(s.id);
                    if (c) exportCharacter(c);
                  }}
                >
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const c = store.get(s.id);
                    if (!c) return;
                    store.save({ ...c, id: newId(), name: `${c.name} (copy)`, updatedAt: new Date().toISOString() });
                    refresh();
                  }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    if (confirm(`Delete ${s.name || 'this character'}? This cannot be undone.`)) {
                      store.remove(s.id);
                      refresh();
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
