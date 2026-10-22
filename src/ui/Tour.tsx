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

type SheetTab = 'Sheet' | 'Facets' | 'Spells & Maneuvers' | 'Equipment' | 'Notes';

interface Step {
  /** Where the step is shown. */
  page: 'home' | 'sheet';
  /** On the sheet: which tab (default Sheet). */
  tab?: SheetTab;
  /** data-tour value of the element to highlight, or a CSS selector (starting with "."); none: a centred card. */
  target?: string;
  title: string;
  body: string;
  /** Run once the step's page is showing (e.g. open an editor); `leave` undoes it. */
  enter?: () => void;
  leave?: () => void;
}

const click = (selector: string, text?: string) =>
  [...document.querySelectorAll<HTMLElement>(selector)].find((el) => !text || el.textContent?.trim() === text)?.click();

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
  {
    page: 'sheet',
    target: 'homebrew',
    title: 'Items & effects',
    body: 'Add your own items (a magic sword, a backpack), boons and curses from your PM. Their effects apply to your sheet automatically.',
  },
  {
    page: 'sheet',
    target: '.modal',
    title: 'The item creator',
    body: 'Name it, then add rows of effects: Bolstered or Hindered Checks, Resistances, Movement, AC, an Attribute point, Tandem dice and more. Effects can grow with an Alignment’s tier. Nothing is saved during the tour.',
    enter: () => click('[data-tour="homebrew"] button', '+ Item'),
    leave: () => click('.modal [aria-label="Close"]'),
  },
  { page: 'sheet', tab: 'Facets', target: 'facets', title: 'Facets', body: 'Everything your class, ancestry and heritage give you, by source. Facets with uses have their bubbles and Use buttons here, and Homebrew facets cover anything else your PM grants.' },
  { page: 'sheet', tab: 'Spells & Maneuvers', target: 'spells', title: 'Spells & Maneuvers', body: 'Choose the spells or maneuvers you know and prepare. Using one spends its AP and resources.' },
  {
    page: 'sheet',
    tab: 'Spells & Maneuvers',
    target: '.spells-tab .collapsible',
    title: 'A spell, worked out',
    body: 'Here’s Fire Spout. Pick the level you cast it at: Calculated shows exactly what it does at that level, with the spell level and your own numbers worked in and Exalted effects added once that level unlocks them. Original text shows the rules as written.',
    enter: () => click('.spells-tab .collapsible:not(.open) .collapsible-head'),
  },
  {
    page: 'sheet',
    tab: 'Equipment',
    target: 'pyramid',
    title: 'Inventory pyramid',
    body: 'Each row holds items of one Bulk rank. Type into an empty slot to add an item right there: its Bulk comes from the row. Backpacks get a pyramid of their own.',
  },
  { page: 'sheet', tab: 'Equipment', target: 'add-item', title: 'Add an item', body: 'Or add an item by name with its Bulk here, and it takes its place in the pyramid.' },
  { page: 'sheet', tab: 'Equipment', target: 'add-weapon', title: 'Add a weapon', body: 'Pick weapons from the rules’ tables, or Unarmed Strike. Their Mod Die, DVs and properties are worked out in the table below; armor and your AC are next to it.' },
  { page: 'sheet', tab: 'Notes', target: 'notes', title: 'Notes', body: 'Session notes by date, plus your character’s Appearance and Backstory.' },
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

/** A demo character for the sheet steps: a level 2 Flaming Luminance Luminary who knows Fire Spout. */
function demoCharacter(): Character {
  const c = normalizeCharacter({
    ...newCharacter(),
    id: TOUR_DEMO_ID,
    name: 'Aria (demo)',
    classId: 'luminary',
    subclass: 'flaming-luminance',
    level: 2,
    ancestry: 'human',
    attributes: { ...newCharacter().attributes, method: 'manual', base: { VIG: 1, AGI: 2, PER: 1, INT: 2, PRS: 1 } },
    spells: { arcana: ['spells/arcana/fire/fire-spout'] },
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
  [...document.querySelectorAll<HTMLElement>(target.startsWith('.') ? target : `[data-tour="${target}"]`)].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

export function Tour() {
  const step = useStep();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const s = step === null ? undefined : STEPS[step];

  // Go to the step's page and tab, run its enter action, wait for its element, bring
  // it into view and keep the highlight on it. Leaving the step undoes its action.
  useEffect(() => {
    if (!s) return;
    showPage(s.page);
    setRect(null);
    let el: HTMLElement | undefined;
    let tries = 0;
    let frame = 0;
    let entered = false;
    let ro: ResizeObserver | undefined;
    const measure = () => el && setRect(el.getBoundingClientRect());
    // Bring the element into view: centred, or from its top when it's taller than the space.
    const reveal = () => {
      if (!el) return;
      el.scrollIntoView({ block: el.offsetHeight > innerHeight - 280 ? 'start' : 'center' });
      measure();
    };
    const find = () => {
      if (s.page === 'sheet') {
        const tab = s.tab ?? 'Sheet';
        const tabButton = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((b) => b.textContent === tab);
        if (!tabButton) return void (tries++ < 120 && (frame = requestAnimationFrame(find)));
        // Switch tabs first, and run the step's action once the tab is showing (going back
        // to the item creator from another tab, its button isn't there until then).
        if (tabButton.getAttribute('aria-selected') !== 'true') {
          tabButton.click();
          return void (tries++ < 120 && (frame = requestAnimationFrame(find)));
        }
      }
      if (!entered) {
        entered = true;
        s.enter?.();
      }
      // Whatever a step opens, keep focus on the card: a focused text field would
      // bring up a phone's keyboard.
      if (document.activeElement?.matches('input, textarea, select, [contenteditable]')) {
        (document.activeElement as HTMLElement).blur();
        cardRef.current?.focus();
      }
      el = s.target ? findTarget(s.target) : undefined;
      if (el) {
        reveal();
        // It may still grow (a row the step just opened): follow it.
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(reveal);
          ro.observe(el);
        }
      } else if (s.target && tries++ < 120) frame = requestAnimationFrame(find);
    };
    find();
    addEventListener('scroll', measure, true);
    addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      removeEventListener('scroll', measure, true);
      removeEventListener('resize', measure);
      if (entered) s.leave?.();
    };
  }, [s]);

  // No scrolling while the tour is open (it scrolls each step into view itself):
  // the page is locked, and wheel, touch and scrolling keys are ignored.
  const overlay = useRef<HTMLDivElement>(null);
  const open = step !== null;
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add('tour-open');
    const el = overlay.current;
    const stop = (e: Event) => e.preventDefault();
    el?.addEventListener('wheel', stop, { passive: false });
    el?.addEventListener('touchmove', stop, { passive: false });
    return () => {
      document.documentElement.classList.remove('tour-open');
      el?.removeEventListener('wheel', stop);
      el?.removeEventListener('touchmove', stop);
    };
  }, [open]);

  // Keyboard: Esc skips, arrows move; focus the card for screen readers and keys.
  useLayoutEffect(() => cardRef.current?.focus(), [step]);
  useEffect(() => {
    if (step === null) return;
    const key = (e: KeyboardEvent) => {
      if ([' ', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp'].includes(e.key) && !(e.target instanceof HTMLButtonElement && e.key === ' ')) e.preventDefault();
      if (e.key === 'Escape') endTour();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft' && step > 0) set(step - 1);
    };
    const next = () => (step + 1 < STEPS.length ? set(step + 1) : endTour());
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [step]);

  // The card's real height, for placing it (cards vary with their text).
  const [cardH, setCardH] = useState(220);
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && h !== cardH) setCardH(h);
  });

  if (step === null || !s) return null;
  const last = step === STEPS.length - 1;
  const pad = 6;
  const gap = pad + 10;
  // Below the highlight if the card fits, else above; for a highlight too tall for
  // either, inside the bottom of the screen. Centred when there's no target.
  const vw = innerWidth;
  const vh = innerHeight;
  const width = Math.min(360, vw - 32);
  const top = !rect
    ? (vh - cardH) / 2
    : rect.bottom + gap + cardH <= vh - 16
      ? rect.bottom + gap
      : rect.top - gap - cardH >= 16
        ? rect.top - gap - cardH
        : vh - cardH - 16;
  const cardStyle: React.CSSProperties = {
    width,
    left: rect ? Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, vw - width - 16)) : (vw - width) / 2,
    top: Math.max(16, top),
  };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" ref={overlay}>
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
