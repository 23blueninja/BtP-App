// Advanced edit mode: a PM's changes to any number on the sheet, and spells or maneuvers
// added outside the class's lists. The panel only appears once something has been changed.
import { useState } from 'react';
import { getCastable, maneuvers, spells } from '../content';
import { ATTRS } from '../data/types';
import { newId, type Adjustment, type Character } from '../engine/character';
import type { Derived } from '../engine/derive';
import { adjustmentLine, statLabel } from '../engine/stat';
import { Modal, TokenText } from './common';

type Update = (fn: (c: Character) => Character) => void;

const DAMAGE_TYPES = ['Arctic', 'Caustic', 'Chthonic', 'Cosmic', 'Crushing', 'Divine', 'Galvanic', 'Piercing', 'Profane', 'Psychic', 'Slashing', 'Somatic', 'Sonic', 'Thermic'];
const DIE_SIDES = [4, 6, 8, 10, 12];

/** Keys that are dice or Bolstered levels rather than tallied numbers. */
const isDie = (key: string) => key.startsWith('die:');
const isLevels = (key: string) => key.startsWith('save:') || key === 'initiative';

/** Everything a PM can adjust, with its current value, grouped for the picker. */
function targets(d: Derived): { group: string; key: string; label: string; current: string }[] {
  const out: { group: string; key: string; label: string; current: string }[] = [];
  const groupOf = (key: string) =>
    key.startsWith('attr:') ? 'Attributes'
    : key.startsWith('resistance:') ? 'Resistances'
    : key.startsWith('weapon:') ? 'Weapons'
    : key.startsWith('spells:') ? 'Spells & Maneuvers'
    : key.startsWith('resource:') ? 'Resources'
    : key.startsWith('bulk') ? 'Inventory'
    : 'Stats';
  out.push({ group: 'Dice & Checks', key: 'die:class', label: statLabel('die:class'), current: d.classDie || '—' });
  for (const a of ATTRS) out.push({ group: 'Dice & Checks', key: `die:attr:${a}`, label: statLabel(`die:attr:${a}`), current: d.attrs[a].label });
  for (const s of d.saves) out.push({ group: 'Dice & Checks', key: `save:${s.attr}`, label: statLabel(`save:${s.attr}`), current: s.label });
  out.push({ group: 'Dice & Checks', key: 'initiative', label: statLabel('initiative'), current: d.initiative });
  for (const [key, v] of Object.entries(d.stats)) out.push({ group: groupOf(key), key, label: v!.label, current: String(v!.value) });
  for (const t of ['Swim', 'Climb']) if (!d.stats[`movement:${t}`]) out.push({ group: 'Stats', key: `movement:${t}`, label: statLabel(`movement:${t}`), current: '0' });
  for (const t of DAMAGE_TYPES) if (!d.stats[`resistance:${t}`]) out.push({ group: 'Resistances', key: `resistance:${t}`, label: statLabel(`resistance:${t}`), current: '0' });
  const order = ['Stats', 'Attributes', 'Dice & Checks', 'Resistances', 'Weapons', 'Spells & Maneuvers', 'Resources', 'Inventory'];
  return out.sort((x, y) => order.indexOf(x.group) - order.indexOf(y.group));
}

/** The panel on the sheet: shown only when the PM has changed something. */
export function AdjustmentsPanel({ c, d, update }: { c: Character; d: Derived; update: Update }) {
  const [editing, setEditing] = useState(false);
  const { applied, unapplied } = d.adjustments;
  const added = c.addedCastables.map(getCastable).filter(Boolean);
  const count = c.adjustments.length + added.length;
  if (!count) return null;
  return (
    <details className="adjustments banner" data-testid="adjustments-panel">
      <summary>
        {count} PM adjustment{count === 1 ? '' : 's'}
      </summary>
      <ul className="plain">
        {applied.map((x, i) => (
          <li key={x.adjustment.id + i}>
            <TokenText text={x.label} />: {x.before} → <strong>{x.after}</strong>
            {x.adjustment.note && <span className="muted"> · {x.adjustment.note}</span>}
          </li>
        ))}
        {unapplied.map((a) => (
          <li key={a.id} className="muted">
            <TokenText text={`${statLabel(a.stat)} ${adjustmentLine(a)}: doesn’t apply to this character`} />
          </li>
        ))}
        {added.map((cs) => (
          <li key={cs!.id}>Added {cs!.kind}: {cs!.name}</li>
        ))}
      </ul>
      <button type="button" className="small" onClick={() => setEditing(true)}>
        Edit adjustments
      </button>
      {editing && <AdjustmentsEditor c={c} d={d} update={update} onClose={() => setEditing(false)} />}
    </details>
  );
}

/** Opens the editor from the sheet's header. */
export function AdjustButton({ c, d, update }: { c: Character; d: Derived; update: Update }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Change any number, or add a spell or maneuver (PM)">
        ± Adjust
      </button>
      {open && <AdjustmentsEditor c={c} d={d} update={update} onClose={() => setOpen(false)} />}
    </>
  );
}

export function AdjustmentsEditor({ c, d, update, onClose }: { c: Character; d: Derived; update: Update; onClose: () => void }) {
  const all = targets(d);
  const [key, setKey] = useState(all[0]?.key ?? 'ac');
  const [op, setOp] = useState<Adjustment['op']>('add');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [pick, setPick] = useState('');
  const target = all.find((t) => t.key === key);
  const levels = isLevels(key);
  const die = isDie(key);
  const n = die && op === 'set' ? Number(value || DIE_SIDES[0]) : Number(value);
  const setAdjustments = (fn: (a: Adjustment[]) => Adjustment[]) => update((x) => ({ ...x, adjustments: fn(x.adjustments) }));
  const setAdded = (fn: (a: string[]) => string[]) => update((x) => ({ ...x, addedCastables: fn(x.addedCastables) }));
  const groups = [...new Set(all.map((t) => t.group))];
  const q = search.trim().toLowerCase();
  const matches = q ? [...spells, ...maneuvers].filter((s) => s.name.toLowerCase().includes(q) && !c.addedCastables.includes(s.id)).slice(0, 50) : [];
  return (
    <Modal title="Adjustments" onClose={onClose} wide>
      <p className="small muted">Change any number on the sheet, or add a spell or maneuver. Everything worked out from a changed number follows it. Changes are listed above the sheet’s tabs.</p>
      {c.adjustments.length > 0 && (
        <ul className="plain adjustment-list">
          {c.adjustments.map((a) => (
            <li key={a.id} className="row between">
              <span>
                <TokenText text={`${all.find((t) => t.key === a.stat)?.label ?? statLabel(a.stat)} ${adjustmentLine(a)}`} />
              </span>
              <button type="button" className="icon-btn" aria-label={`Remove ${statLabel(a.stat)} adjustment`} onClick={() => setAdjustments((xs) => xs.filter((x) => x.id !== a.id))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="form adjust-form">
        <legend>Change a number</legend>
        <label>
          What
          <select
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (isLevels(e.target.value)) setOp('add');
            }}
            aria-label="Stat to adjust"
          >
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {all
                  .filter((t) => t.group === g)
                  .map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label} ({t.current})
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="row wrap">
          {!levels && (
            <label>
              <select value={op} onChange={(e) => setOp(e.target.value as Adjustment['op'])} aria-label="Add or set">
                <option value="add">{die ? 'Step by' : 'Add'}</option>
                <option value="set">Set to</option>
              </select>
            </label>
          )}
          {levels && <span>Bolster by (negative Hinders)</span>}
          {die && op === 'set' ? (
            <select value={value || String(DIE_SIDES[0])} onChange={(e) => setValue(e.target.value)} aria-label="Die">
              {DIE_SIDES.map((s) => (
                <option key={s} value={s}>
                  d{s}
                </option>
              ))}
            </select>
          ) : (
            <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" aria-label="Amount" />
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
          <button
            type="button"
            className="primary"
            disabled={(value === '' && !(die && op === 'set')) || !Number.isFinite(n) || (op === 'add' && n === 0)}
            onClick={() => {
              setAdjustments((xs) => [...xs, { id: newId(), stat: key, op, value: n, ...(note.trim() ? { note: note.trim() } : {}) }]);
              setValue('');
              setNote('');
            }}
          >
            Apply
          </button>
        </div>
        {target && <p className="small muted">Now: {target.current}</p>}
      </fieldset>
      <fieldset className="form adjust-form">
        <legend>Add a spell or maneuver</legend>
        {c.addedCastables.length > 0 && (
          <ul className="plain adjustment-list">
            {c.addedCastables.map((id) => (
              <li key={id} className="row between">
                <span>{getCastable(id)?.name ?? id}</span>
                <button type="button" className="icon-btn" aria-label={`Remove ${getCastable(id)?.name ?? id}`} onClick={() => setAdded((xs) => xs.filter((x) => x !== id))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row wrap">
          <input value={search} onChange={(e) => (setSearch(e.target.value), setPick(''))} placeholder="Search by name" aria-label="Search spells and maneuvers" />
          {matches.length > 0 && (
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Spell or maneuver">
              <option value="">Choose…</option>
              {matches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.subtitle || s.kind})
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="primary"
            disabled={!pick}
            onClick={() => {
              setAdded((xs) => [...xs, pick]);
              setPick('');
              setSearch('');
            }}
          >
            Add
          </button>
        </div>
        {q && !matches.length && <p className="small muted">No spells or maneuvers match.</p>}
      </fieldset>
    </Modal>
  );
}
