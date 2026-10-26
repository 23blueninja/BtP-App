import { useState } from 'react';
import { getNode } from '../content';
import type { Character } from '../engine/character';
import { AUTO_LISTS, derive } from '../engine/derive';
import { levelUp, type LevelUpSummary } from '../engine/play';
import { FacetText, go, Html, Collapsible } from './common';
import { ChoicePicker, SpellListEditor } from './pickers';
import { SkillsEditor } from './Builder';

type Update = (fn: (c: Character) => Character) => void;

export function LevelUp({ c, update }: { c: Character; update: Update }) {
  const [summary, setSummary] = useState<LevelUpSummary | null>(null);
  const d = derive(c);
  const checklist = getNode('player-characters/leveling-up/level-up-checklist');

  if (!summary) {
    if (d.level >= d.maxLevel) {
      return (
        <div className="levelup">
          <h2>Level Up</h2>
          <p>
            {c.name} is level {d.level}, the highest level in the current alpha rules. Higher levels will be added with future rules releases.
          </p>
          <button type="button" onClick={() => go('c', c.id)}>
            Back to sheet
          </button>
        </div>
      );
    }
    return (
      <div className="levelup">
        <h2>
          Level Up: {d.level} → {d.level + 1}
        </h2>
        <Html html={checklist?.html} />
        <p>The app applies the class table changes and new facets, then asks for any new choices.</p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => {
              const r = levelUp(c);
              update(() => r.character);
              setSummary(r.summary);
            }}
          >
            Level up to {d.level + 1}
          </button>
          <button type="button" onClick={() => go('c', c.id)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // After levelling: show what changed and any new choices.
  const newChoices = d.choices.filter((ch) => ch.level === d.level);
  const lists = d.spellLists.filter((l) => l.def.mode === 'known' && !AUTO_LISTS.includes(l.def.id));
  return (
    <div className="levelup">
      <h2>
        {c.name} is now level {summary.to}
      </h2>
      <h3>Checklist</h3>
      <ul className="checklist">
        {summary.changes.map((x) => (
          <li key={x}>✓ {x}</li>
        ))}
      </ul>
      {summary.newFacets.length > 0 && (
        <>
          <h3>New facets</h3>
          {summary.newFacets.map((f) => (
            <Collapsible key={f.key} title={<strong>{f.name}</strong>} defaultOpen>
              <FacetText contentId={f.contentId} item={f.item} />
            </Collapsible>
          ))}
        </>
      )}
      {newChoices.length > 0 && <h3>New choices</h3>}
      {newChoices.map((ch) => (
        <ChoicePicker key={ch.id} choice={ch} onPick={(id) => update((x) => ({ ...x, choices: { ...x.choices, [ch.id]: id } }))} />
      ))}
      {lists.some((l) => (c.spells[l.def.id]?.length ?? 0) < l.count - l.granted.length) && <h3>Learn new spells & maneuvers</h3>}
      {lists
        .filter((l) => (c.spells[l.def.id]?.length ?? 0) < l.count - l.granted.length)
        .map((l) => (
          <SpellListEditor
            key={`${l.source}-${l.def.id}`}
            list={l}
            selectedIds={c.spells[l.def.id] ?? []}
            onChange={(ids) => update((x) => ({ ...x, spells: { ...x.spells, [l.def.id]: ids } }))}
          />
        ))}
      {/* Level 3 and every odd level after give a rank increase (or a Novice Hobby). */}
      {summary.to >= 3 && summary.to % 2 === 1 && (
        <>
          <h3>Hobby & Profession ranks</h3>
          <SkillsEditor d={d} update={update} />
        </>
      )}
      {d.issues.length > 0 && (
        <details className="issues">
          <summary>{d.issues.length} item(s) still open</summary>
          <ul>
            {d.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </details>
      )}
      <button type="button" className="primary" onClick={() => go('c', c.id)}>
        Done — back to sheet
      </button>
    </div>
  );
}
