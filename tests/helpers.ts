// Shared helpers for the tests/ suite.
//
// Every file runs in two modes:
//   npm run test:full  — exhaustive (every class, subclass, ancestry, level…)
//   npm run test:qa    — the same checks on a small, evenly spread sample, for
//                        a fast pass before each commit (QA=1, set by vitest.qa.config.ts).
import { newCharacter, normalizeCharacter, type Character } from '../src/engine/character';
import { derive, type Derived } from '../src/engine/derive';
import { freshPlay } from '../src/engine/play';

export const QA = process.env.QA === '1';

/** All of `items` in full mode; in QA mode about `qaCount` of them, spread evenly (first and last included). */
export function sample<T>(items: readonly T[], qaCount: number): T[] {
  if (!QA || items.length <= qaCount) return [...items];
  if (qaCount <= 1) return [items[0]];
  const step = (items.length - 1) / (qaCount - 1);
  return Array.from(new Set(Array.from({ length: qaCount }, (_, i) => items[Math.round(i * step)])));
}

/** Character levels to test: 1–10 in full mode, a spread in QA mode. */
export const LEVELS = sample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);

/**
 * A character built from a partial description, normalised like a saved one and
 * with a fresh play state (full Endurance, 5 AP…). `play` overrides are merged in.
 */
export function makeCharacter(over: Partial<Omit<Character, 'play'>> & { play?: Partial<Character['play']> } = {}): Character {
  const { play, ...rest } = over;
  const c = normalizeCharacter({ ...newCharacter(), name: 'Test', ...rest });
  return { ...c, play: { ...freshPlay(c), ap: 5, ...play } };
}

/** derive() plus a character, for tests that need both. */
export function built(over: Parameters<typeof makeCharacter>[0] = {}): { c: Character; d: Derived } {
  const c = makeCharacter(over);
  return { c, d: derive(c) };
}

/** Numbers that should never appear in derived output. */
export const isFiniteNumber = (n: unknown) => typeof n === 'number' && Number.isFinite(n);

/** Recursively finds NaN / Infinity / undefined-in-arrays in a derived object; returns the paths. */
export function badNumbers(value: unknown, path = '$', out: string[] = [], seen = new WeakSet<object>()): string[] {
  if (typeof value === 'number' && !Number.isFinite(value)) out.push(path);
  else if (value && typeof value === 'object') {
    if (seen.has(value as object)) return out;
    seen.add(value as object);
    if (Array.isArray(value)) value.forEach((v, i) => badNumbers(v, `${path}[${i}]`, out, seen));
    else for (const [k, v] of Object.entries(value)) if (typeof v !== 'function') badNumbers(v, `${path}.${k}`, out, seen);
  }
  return out;
}
