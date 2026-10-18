import { useState } from 'react';
import { newId, type Character } from '../engine/character';
import type { Derived } from '../engine/derive';
import { effectiveBulk, layoutBulk } from '../engine/inventory';
import { RuleLink } from './common';

/** An empty slot you can type an item name into; Enter (or leaving the field) adds it. */
function EmptySlot({ rank, onAdd }: { rank: number; onAdd: (name: string) => void }) {
  const [text, setText] = useState('');
  const commit = () => {
    if (text.trim()) onAdd(text.trim());
    setText('');
  };
  return (
    <input
      className="pyr-slot pyr-input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), e.preventDefault())}
      placeholder=" "
      aria-label={`Add a Bulk ${rank} item`}
      title={`Type to add a Bulk ${rank} item`}
    />
  );
}

/**
 * Bulk slots drawn as a pyramid, like the inventory on the original character sheet.
 * With `update`, typing into an empty slot adds an item that fills that slot.
 */
export function BulkPyramid({ c, d, update }: { c: Character; d: Derived; update?: (fn: (c: Character) => Character) => void }) {
  // Items on your person count as `bulkShift` ranks lower (Powerful Build), so an item
  // typed into a rank r slot gets Bulk r − shift where possible, to land where it was typed.
  const add = (name: string, rank: number) =>
    update?.((x) => ({
      ...x,
      equipment: { ...x.equipment, inventory: [...x.equipment.inventory, { id: newId(), name, qty: 1, bulk: rank - d.bulkShift >= 1 ? rank - d.bulkShift : rank }] },
    }));
  const vig = Math.max(0, d.attrs.VIG.points);
  const { rows, overflow } = layoutBulk(c.equipment.inventory, vig, d.bulkShift);
  const bulkless = c.equipment.inventory.filter((i) => !i.bulk);
  const pyramid = (bonus: boolean) => (
    <div className="pyramid">
      <h4 className="pyr-title">{bonus ? `VIG Bonus Inventory (${vig} VIG)` : 'Inventory'}</h4>
      {rows.map((r) => (
        <div key={r.rank} className="pyr-row">
          <span className="pyr-rank">{r.rank}</span>
          <div className="pyr-slots">
            {r.slots
              .filter((s) => s.bonus === bonus)
              .map((s, i) =>
                !s.item && !s.locked && update ? (
                  <EmptySlot key={i} rank={r.rank} onAdd={(name) => add(name, r.rank)} />
                ) : (
                <span
                  key={i}
                  className={`pyr-slot ${s.locked ? 'locked' : ''} ${s.item ? 'filled' : ''}`}
                  title={
                    s.item
                      ? `${s.item.name} (Bulk ${s.item.bulk}${effectiveBulk(s.item, d.bulkShift) !== s.item.bulk ? ` → ${effectiveBulk(s.item, d.bulkShift)} with Powerful Build` : ''})${s.item.notes ? ` — ${s.item.notes}` : ''}`
                      : s.locked
                        ? `Requires ${r.rank} VIG`
                        : `Empty Bulk ${r.rank} slot`
                  }
                >
                  {s.item ? s.item.name : s.locked ? '🔒' : ''}
                </span>
                ),
              )}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="bulk-pyramid">
      <div className="pyramids">
        {pyramid(false)}
        {pyramid(true)}
      </div>
      {overflow.length > 0 && (
        <p className="warn small">
          Over capacity: {overflow.map((i) => i.name).join(', ')} {overflow.length === 1 ? "doesn't" : "don't"} fit.
        </p>
      )}
      <p className="small muted">
        Rows are Bulk ranks 1–5.{d.bulkShift > 0 && ` Powerful Build: items on your person count as ${d.bulkShift} rank lower (not in a backpack).`} Bulkless:{' '}
        {bulkless.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}${i.notes ? ` (${i.notes})` : ''}`).join(', ') || '—'} ·{' '}
        <RuleLink id="equipment/bulk">Bulk rules</RuleLink>
      </p>
    </div>
  );
}
