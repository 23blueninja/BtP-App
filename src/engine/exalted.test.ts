import { describe, expect, it } from 'vitest';
import { getNode, type RuleNode } from '../content';
import { calculateCastable } from './exalted';

const flat = (n: RuleNode): string => [n.html ?? '', ...(n.children ?? []).map((c) => `<h5>${c.titleHtml}</h5>${flat(c)}`)].join('');
const calc = (id: string, level: number) => {
  const n = getNode(id)!;
  return calculateCastable(flat(n), 1, { level, charLevel: 2 });
};
const line = (h: string, outcome: string) =>
  h.match(new RegExp(`<dt>${outcome}</dt><dd>([\\s\\S]*?)</dd>`))?.[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() ?? '';

describe('Exalted merging', () => {
  it('Trip: Stunned joins the Deadly Success at 3rd level only', () => {
    expect(line(calc('maneuvers/martial/trip', 2).html, 'Deadly Success')).not.toContain('Stunned');
    const r3 = calc('maneuvers/martial/trip', 3);
    expect(line(r3.html, 'Deadly Success')).toMatch(/Prone, Stunned 1\./);
    expect(r3.notes.find((n) => n.label === 'Exalted (3rd)')).toMatchObject({ merged: true, active: true });
    expect(r3.notes.find((n) => n.label === 'Exalted (5th)')).toMatchObject({ active: false });
    // Not-yet-active entries show the numbers for their own level (5 minus 3 = 2).
    expect(r3.notes.find((n) => n.label === 'Exalted (5th)')!.html.replace(/<[^>]+>/g, '')).toContain('Stunned 2');
  });

  it('swaps in replacement result blocks', () => {
    expect(line(calc('maneuvers/feral/forceful-strike', 2).html, 'Success')).toMatch(/^8 Crushing damage\./);
    expect(line(calc('maneuvers/feral/forceful-strike', 3).html, 'Success')).toMatch(/^18 Crushing damage, and the target must Succeed/);
  });

  it('replaces an existing condition level rather than duplicating it', () => {
    const r = calc('maneuvers/martial/concussive-strike', 4);
    expect((line(r.html, 'Failure') ?? '').match(/Stunned/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it('keeps unmergeable entries as notes', () => {
    const r = calc('maneuvers/feral/forceful-strike', 4);
    expect(r.notes.find((n) => n.label === 'Exalted (4th)')).toMatchObject({ merged: false, active: true });
  });
});
