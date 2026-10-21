// Character persistence. Everything goes through CharacterStore so a cloud
// implementation (accounts + sync) can replace LocalStore later.
import { normalizeCharacter, type Character } from '../engine/character';

export interface CharacterSummary {
  id: string;
  name: string;
  level: number;
  ancestry: string;
  customAncestryName?: string;
  classId: string;
  updatedAt: string;
}

export interface CharacterStore {
  list(): CharacterSummary[];
  get(id: string): Character | undefined;
  save(c: Character): void;
  remove(id: string): void;
  /** Writes any saves still waiting (they're batched while you edit). */
  flush(): void;
}

/** One key per character, so a save only serialises that character. */
const PREFIX = 'btp.character.';
/** Before per-character keys: every character in one JSON map. Migrated on first read. */
const LEGACY_KEY = 'btp.characters.v1';
/** Edits within this window are written once (typing a note doesn't save per keystroke). */
const SAVE_DELAY_MS = 400;

function readAll(): Record<string, Character> {
  const all: Record<string, Character> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      try {
        const c = JSON.parse(localStorage.getItem(k) ?? 'null');
        if (c && typeof c === 'object') all[k.slice(PREFIX.length)] = c as Character;
      } catch {
        // A corrupt entry doesn't take the others with it.
      }
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy !== null) {
      let old: unknown = null;
      try {
        old = JSON.parse(legacy);
      } catch {
        // Unreadable: nothing to migrate.
      }
      const moved = old && typeof old === 'object' ? Object.values(old as Record<string, Character>).filter((c) => c && typeof c === 'object' && c.id) : [];
      for (const c of moved) all[c.id] = c;
      if (moved.every((c) => write(c))) localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    // Storage unavailable (private mode, blocked): start empty for this session.
  }
  return all;
}

function write(c: Character): boolean {
  try {
    localStorage.setItem(PREFIX + c.id, JSON.stringify(c));
    return true;
  } catch {
    return false;
  }
}

/** Browser-local storage. Data stays on this device unless exported. */
export class LocalStore implements CharacterStore {
  private memory: Record<string, Character> | null = null;
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Write batched saves before the page goes away (closing a tab, switching apps on a phone).
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', () => this.flush());
      window.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && this.flush());
    }
  }

  private all(): Record<string, Character> {
    if (!this.memory) this.memory = readAll();
    return this.memory;
  }

  list(): CharacterSummary[] {
    return Object.values(this.all())
      .map((c) => ({ id: c.id, name: c.name, level: c.level, ancestry: c.ancestry, customAncestryName: c.customAncestryName, classId: c.classId, updatedAt: c.updatedAt }))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  get(id: string): Character | undefined {
    const c = this.all()[id];
    return c ? normalizeCharacter(c) : undefined;
  }

  save(c: Character): void {
    this.all()[c.id] = c;
    this.pending.add(c.id);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  remove(id: string): void {
    delete this.all()[id];
    this.pending.delete(id);
    try {
      localStorage.removeItem(PREFIX + id);
    } catch {
      // Storage unavailable: it's gone from this session.
    }
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const all = this.all();
    for (const id of this.pending) if (all[id]) write(all[id]);
    this.pending.clear();
  }
}

export const store: CharacterStore = new LocalStore();

export function exportCharacter(c: Character): void {
  const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(c.name || 'character').replace(/[^\w-]+/g, '_')}.btp.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importCharacter(file: File): Promise<Character> {
  const text = await file.text();
  return normalizeCharacter(JSON.parse(text));
}
