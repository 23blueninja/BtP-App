import type { Character } from '../engine/character';
import type { Derived } from '../engine/derive';
import { effectiveBulk, layoutBulk } from '../engine/inventory';
import { RuleLink } from './common';

/** Bulk slots drawn as a pyramid, like the inventory on the original character sheet. */
export function BulkPyramid({ c, d }: { c: Character; d: Derived }) {
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
              .map((s, i) => (
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
              ))}
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
