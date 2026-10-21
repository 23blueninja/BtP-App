// Guided tour: a short walk through the home page and a demo character's sheet.
// It starts by itself the first time the app opens with no saved characters, can
// be skipped at any step, and can be taken again from the home page or Options.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { newCharacter, normalizeCharacter, type Character } from '../engine/character';
import { freshPlay } from '../engine/play';
import { store } from '../storage/storage';
import { go, TokenText } from './common';
import { setPrefs } from './prefs';

/** The demo character the sheet steps show; created for the tour, removed when it ends. */
export const TOUR_DEMO_ID = 'tour-demo';

interface Step {
  /** Where the step is shown. */
  page: 'home' | 'sheet';
  /** data-tour value of the element to highlight; none: a centred card. */
  target?: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  { page: 'home', title: 'Welcome to Beyond the Prism', body: 'A character builder and live sheet for the Alpha Rules. This quick tour shows you around; skip it any time.' },
  { page: 'home', target: 'new', title: 'Create a character', body: 'Start here. The builder walks you through Ancestry, Background, Class and the rest, and lists anything still left to choose.' },
  { page: 'home', target: 'import', title: 'Import', body: 'Bring in a character exported from another device or browser.' },
  { page: 'home', target: 'rules', title: 'Rules reference', body: 'The whole Alpha Rules, searchable. Rules mentioned on the sheet link straight to their section.' },
  { page: 'home', target: 'options', title: 'Options', body: 'Choose a look (Faceted or Polished), turn animations off, and take this tour again.' },
  { page: 'sheet', target: 'stats', title: 'The sheet', body: 'Here is a demo character. Across the top: Class Bonus, Class Die and each Attribute’s Mod Die. Tap one for where it comes from.' },
  { page: 'sheet', target: 'turn', title: 'Turns and AP', body: 'Spend and restore AP here. Start Turn applies start-of-turn effects like Burning; Initiative refills your AP.' },
  { page: 'sheet', target: 'endurance', title: 'Endurance and Vitality', body: 'Enter an amount and press Damage or Heal. Temporary Endurance, Vitality and Dying are tracked for you.' },
  { page: 'sheet', target: 'conditions', title: 'Conditions', body: 'Add Conditions at their level. Their effects show up in Check Modifiers and on your Checks.' },
  { page: 'sheet', target: 'actions', title: 'Actions', body: 'Everything you can do, with its AP cost. Use spends the cost and applies the effect.' },
  { page: 'sheet', target: 'rest', title: 'Resting', body: 'Short and Long Rests restore what the rules say, with a preview before you rest.' },
  { page: 'sheet', target: 'tabs', title: 'More tabs', body: 'Facets, Spells & Maneuvers, Equipment and Notes each have their own tab.' },
  { page: 'sheet', target: 'edit', title: 'Edit', body: 'Reopen the builder to change choices or level up. Characters are saved in this browser; Export backs them up.' },
  { page: 'sheet', title: 'That’s the tour', body: 'Have fun out there. You can take the tour again from the home page or Options.' },
];

// ---- tour state (shared by the overlay and the buttons that start it) ----
let current: number | null = null;
const listeners = new Set<() => void>();
const set = (step: number | null) => {
  current = step;
  listeners.forEach((l) => l());
};
const useStep = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );

export function tourActive(): boolean {
  return current !== null;
}

export function startTour(): void {
  set(0);
}

/** Ends the tour (finished or skipped): it won't start by itself again. */
function endTour(): void {
  set(null);
  setPrefs({ tourSeen: true });
  removeDemo();
  go();
}

/** A demo character for the sheet steps: a level 2 Victor Gladiator. */
function demoCharacter(): Character {
  const c = normalizeCharacter({
    ...newCharacter(),
    id: TOUR_DEMO_ID,
    name: 'Aria (demo)',
    classId: 'gladiator',
    subclass: 'victor',
    level: 2,
    ancestry: 'human',
    attributes: { ...newCharacter().attributes, method: 'manual', base: { VIG: 2, AGI: 2, PER: 1, INT: 0, PRS: 1 } },
    equipment: { armor: { type: 'Medium', quality: 'Basic' }, weapons: [{ id: 'w', name: 'Longsword' }], inventory: [{ id: 'i', name: 'Rope', qty: 1, bulk: 1 }] },
  });
  return { ...c, play: { ...freshPlay(c), initialized: true } };
}

export function removeDemo(): void {
  if (store.get(TOUR_DEMO_ID)) store.remove(TOUR_DEMO_ID);
}

const showPage = (page: Step['page']) => {
  if (page === 'sheet') {
    if (!store.get(TOUR_DEMO_ID)) store.save(demoCharacter());
    if (location.hash !== `#/c/${TOUR_DEMO_ID}`) go('c', TOUR_DEMO_ID);
  } else if (location.hash.replace(/^#\/?/, '') !== '') go();
};

/** The first visible element for a step (the sheet has two turn bars, one per layout). */
const findTarget = (target: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

export function Tour() {
  const step = useStep();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const s = step === null ? undefined : STEPS[step];

  // Go to the step's page, wait for its element, bring it into view and keep the highlight on it.
  useEffect(() => {
    if (!s) return;
    showPage(s.page);
    setRect(null);
    if (!s.target) return;
    let el: HTMLElement | undefined;
    let tries = 0;
    let frame = 0;
    const measure = () => el && setRect(el.getBoundingClientRect());
    const find = () => {
      el = findTarget(s.target!);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        measure();
      } else if (tries++ < 120) frame = requestAnimationFrame(find);
    };
    find();
    addEventListener('scroll', measure, true);
    addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', measure, true);
      removeEventListener('resize', measure);
    };
  }, [s]);

  // Keyboard: Esc skips, arrows move; focus the card for screen readers and keys.
  useLayoutEffect(() => cardRef.current?.focus(), [step]);
  useEffect(() => {
    if (step === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft' && step > 0) set(step - 1);
    };
    const next = () => (step + 1 < STEPS.length ? set(step + 1) : endTour());
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [step]);

  if (step === null || !s) return null;
  const last = step === STEPS.length - 1;
  const pad = 6;
  // Below the highlight if there's room, otherwise above; centred when there's no target.
  const vw = innerWidth;
  const vh = innerHeight;
  const width = Math.min(360, vw - 32);
  const cardStyle: React.CSSProperties = rect
    ? {
        width,
        left: Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, vw - width - 16)),
        ...(rect.bottom + pad + 230 < vh || rect.top < 230 ? { top: Math.min(rect.bottom + pad + 10, vh - 230) } : { bottom: vh - rect.top + pad + 10 }),
      }
    : { width, left: (vw - width) / 2, top: Math.max(16, vh / 2 - 120) };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div className="tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="tour-shade" />
      )}
      <div className="tour-card" style={cardStyle} ref={cardRef} tabIndex={-1}>
        <p className="muted small">
          {step + 1} / {STEPS.length}
        </p>
        <h3 id="tour-title">{s.title}</h3>
        <p>
          <TokenText text={s.body} />
        </p>
        <div className="row between">
          {!last ? (
            <button type="button" className="link" onClick={endTour}>
              Skip tour
            </button>
          ) : (
            <span />
          )}
          <span className="row">
            {step > 0 && (
              <button type="button" onClick={() => set(step - 1)}>
                Back
              </button>
            )}
            <button type="button" className="primary" onClick={() => (last ? endTour() : set(step + 1))}>
              {last ? 'Finish' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
