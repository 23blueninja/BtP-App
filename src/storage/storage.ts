// Character persistence. Everything goes through CharacterStore so a cloud
// implementation (accounts + sync) can replace LocalStore later.
import { normalizeCharacter, type Character } from '../engine/character';

export interface CharacterSummary {
  id: string;
  name: string;
  level: number;
  ancestry: string;
  classId: string;
  updatedAt: string;
}

export interface CharacterStore {
  list(): CharacterSummary[];
  get(id: string): Character | undefined;
  save(c: Character): void;
  remove(id: string): void;
}

const KEY = 'btp.characters.v1';

function readAll(): Record<string, Character> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, Character>) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Character>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** Browser-local storage. Data stays on this device unless exported. */
export class LocalStore implements CharacterStore {
  private memory: Record<string, Character> | null = null;

  private all(): Record<string, Character> {
    if (!this.memory) this.memory = readAll();
    return this.memory;
  }

  list(): CharacterSummary[] {
    return Object.values(this.all())
      .map((c) => ({ id: c.id, name: c.name, level: c.level, ancestry: c.ancestry, classId: c.classId, updatedAt: c.updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Character | undefined {
    const c = this.all()[id];
    return c ? normalizeCharacter(c) : undefined;
  }

  save(c: Character): void {
    const all = this.all();
    all[c.id] = c;
    writeAll(all);
  }

  remove(id: string): void {
    const all = this.all();
    delete all[id];
    writeAll(all);
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
