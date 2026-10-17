// Class information read from the rules: class table rows, Alignment,
// Endurance, facets by level and the subclass list.
import { getNode, type RuleNode } from '../content';
import { classById } from '../data/classes';
import { LIGHTS, type ClassDef, type FacetDef, type Light, type SubclassExtras } from '../data/types';

export interface ClassRow {
  level: number;
  bonus: number;
  die: string;
  facets: string;
  columns: Record<string, string>;
}

export function classTable(cls: ClassDef): { headers: string[]; rows: ClassRow[] } {
  const t = getNode(cls.tableId)?.tables?.[0];
  if (!t) return { headers: [], rows: [] };
  const rows = t.rows.map((r) => {
    const columns: Record<string, string> = {};
    t.headers.forEach((h, i) => (columns[h] = r[i] ?? ''));
    const bonusCol = t.headers.findIndex((h) => /bonus/i.test(h));
    const dieCol = t.headers.findIndex((h) => /\bdie\b/i.test(h));
    const facetCol = t.headers.findIndex((h) => /facets/i.test(h));
    return {
      level: parseInt(r[0], 10),
      bonus: parseInt(r[bonusCol] ?? '0', 10) || 0,
      die: r[dieCol] ?? '',
      facets: r[facetCol] ?? '',
      columns,
    };
  });
  return { headers: t.headers, rows };
}

export function maxClassLevel(cls: ClassDef): number {
  return Math.max(1, ...classTable(cls).rows.map((r) => r.level));
}

export function classRow(cls: ClassDef, level: number): ClassRow | undefined {
  return classTable(cls).rows.find((r) => r.level === level);
}

/** Value of the first column whose header contains `match` (case-insensitive). */
export function columnValue(cls: ClassDef, level: number, match: string): string | undefined {
  const row = classRow(cls, level);
  if (!row) return undefined;
  const key = Object.keys(row.columns).find((h) => h.toLowerCase().includes(match.toLowerCase()));
  return key ? row.columns[key] : undefined;
}

/** "1st" / "2" / "—" -> number (0 when not available). */
export function numeric(v: string | undefined): number {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : 0;
}

function childText(cls: ClassDef, title: RegExp): string {
  const n = getNode(cls.contentId)?.children?.find((c) => title.test(c.title));
  return (n?.html ?? '').replace(/<[^>]+>/g, ' ');
}

export function classAlignment(cls: ClassDef): Light | 'choice' | null {
  const text = childText(cls, /^Alignment$/);
  if (!text) return null;
  if (/of your choice/i.test(text)) return 'choice';
  return LIGHTS.find((l) => new RegExp(`\\b${l}\\b`).test(text)) ?? null;
}

export function classEndurance(cls: ClassDef): { start: number; perLevel: number } {
  const text = childText(cls, /^Endurance/);
  const m = text.match(/start with\s+(\d+)\s+Endurance\s+and gain\s+(\d+)/i);
  return m ? { start: Number(m[1]), perLevel: Number(m[2]) } : { start: 0, perLevel: 0 };
}

export interface ResolvedFacet extends FacetDef {
  key: string;
  source: string;
  level: number;
}

const slugOf = (id: string) => id.split('/').pop() ?? id;

function facetsOf(node: RuleNode | undefined, extras: Record<string, Partial<FacetDef>> | undefined, source: string, level: number): ResolvedFacet[] {
  return (node?.children ?? [])
    .filter((c) => c.lvl !== undefined && c.lvl <= level)
    .map((c) => {
      const extra = extras?.[slugOf(c.id)] ?? {};
      return { name: c.title, contentId: c.id, level: c.lvl!, source, key: c.id, ...extra };
    });
}

export function classFacets(cls: ClassDef, level: number): ResolvedFacet[] {
  return facetsOf(getNode(cls.contentId), cls.facetExtras, cls.name, level);
}

export interface SubclassInfo {
  id: string;
  name: string;
  contentId: string;
  extras: SubclassExtras;
}

export function subclassesOf(cls: ClassDef): SubclassInfo[] {
  return (getNode(cls.subclassListId)?.children ?? []).map((n) => ({
    id: slugOf(n.id),
    name: n.title,
    contentId: n.id,
    extras: cls.subclassExtras?.[slugOf(n.id)] ?? {},
  }));
}

export function subclassFacets(cls: ClassDef, subclassId: string, level: number): ResolvedFacet[] {
  const sc = subclassesOf(cls).find((s) => s.id === subclassId);
  if (!sc) return [];
  return facetsOf(getNode(sc.contentId), sc.extras.facetExtras, sc.name, level);
}

export function getClass(id: string): ClassDef | undefined {
  return classById.get(id);
}
