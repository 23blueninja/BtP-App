import { useState } from 'react';
import { newId, type Character, type InventoryItem } from '../engine/character';
import type { Derived } from '../engine/derive';
import { effectiveBulk, groupInventory, layoutBulk, layoutContainer, type BulkRow } from '../engine/inventory';
import { RuleLink, TokenText } from './common';

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

/** One pyramid of Bulk slots; empty slots take a typed item when `onAdd` is given. */
function Pyramid({
  title,
  rows,
  bonus = false,
  shift,
  onAdd,
}: {
  title: string;
  rows: BulkRow[];
  bonus?: boolean;
  shift: number;
  onAdd?: (name: string, rank: number) => void;
}) {
  return (
    <div className="pyramid">
      <h4 className="pyr-title">
        <TokenText text={title} />
      </h4>
      {rows.map((r) => (
        <div key={r.rank} className="pyr-row">
          <span className="pyr-rank">{r.rank}</span>
          <div className="pyr-slots">
            {r.slots
              .filter((s) => s.bonus === bonus)
              .map((s, i) =>
                !s.item && !s.locked && onAdd ? (
                  <EmptySlot key={i} rank={r.rank} onAdd={(name) => onAdd(name, r.rank)} />
                ) : (
                  <span
                    key={i}
                    className={`pyr-slot ${s.locked ? 'locked' : ''} ${s.item ? 'filled' : ''}`}
                    title={
                      s.item
                        ? `${s.item.name} (Bulk ${s.item.bulk}${effectiveBulk(s.item, shift) !== s.item.bulk ? ` → ${effectiveBulk(s.item, shift)} with Powerful Build` : ''})${s.item.notes ? ` — ${s.item.notes}` : ''}`
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
}

const overflowText = (items: InventoryItem[], where: string) =>
  `Over capacity${where}: ${items.map((i) => i.name).join(', ')} ${items.length === 1 ? "doesn't" : "don't"} fit.`;

/**
 * Bulk slots drawn as pyramids, like the inventory on the original character sheet:
 * yours, the VIG bonus one, and one for each container (backpack). With `update`,
 * typing into an empty slot adds an item that fills that slot.
 */
export function BulkPyramid({ c, d, update }: { c: Character; d: Derived; update?: (fn: (c: Character) => Character) => void }) {
  // Items on your person count as `bulkShift` ranks lower (Powerful Build), so an item
  // typed into a rank r slot gets Bulk r − shift where possible, to land where it was typed.
  const add = (name: string, rank: number, storedIn?: string) =>
    update?.((x) => ({
      ...x,
      equipment: {
        ...x.equipment,
        inventory: [
          ...x.equipment.inventory,
          { id: newId(), name, qty: 1, bulk: storedIn ? rank : rank - d.bulkShift >= 1 ? rank - d.bulkShift : rank, ...(storedIn ? { storedIn } : {}) },
        ],
      },
    }));
  const vig = Math.max(0, d.attrs.VIG.points);
  const groups = groupInventory(c.equipment.inventory);
  // Homebrew items with a Bulk take slots on your person too.
  const items = [
    ...groups.person,
    ...d.homebrew.filter((h) => h.entry.kind === 'item' && h.entry.bulk).map((h) => ({ id: h.entry.id, name: h.entry.name, qty: 1, bulk: h.entry.bulk, inBackpack: h.entry.inBackpack })),
  ];
  const { rows, overflow } = layoutBulk(items, vig, d.bulkShift);
  const bulkless = c.equipment.inventory.filter((i) => !i.bulk);
  const onAdd = update ? (name: string, rank: number) => add(name, rank) : undefined;
  return (
    <div className="bulk-pyramid">
      <div className="pyramids" data-tour="pyramid">
        <Pyramid title="Inventory" rows={rows} shift={d.bulkShift} onAdd={onAdd} />
        <Pyramid title={`VIG Bonus Inventory (${vig} VIG)`} rows={rows} bonus shift={d.bulkShift} onAdd={onAdd} />
        {groups.containers.map(({ item, contents }) => {
          const l = layoutContainer(contents);
          return (
            <div key={item.id}>
              <Pyramid title={item.name} rows={l.rows} shift={0} onAdd={update ? (name, rank) => add(name, rank, item.id) : undefined} />
              {l.overflow.length > 0 && <p className="warn small">{overflowText(l.overflow, ` in ${item.name}`)}</p>}
            </div>
          );
        })}
      </div>
      {overflow.length > 0 && <p className="warn small">{overflowText(overflow, '')}</p>}
      <p className="small muted">
        Rows are Bulk ranks 1–5.{d.bulkShift > 0 && ` Powerful Build: items on your person count as ${d.bulkShift} rank lower (not in a backpack).`} Bulkless:{' '}
        {bulkless.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}${i.notes ? ` (${i.notes})` : ''}`).join(', ') || '—'} ·{' '}
        <RuleLink id="equipment/bulk">Bulk rules</RuleLink>
      </p>
    </div>
  );
}
