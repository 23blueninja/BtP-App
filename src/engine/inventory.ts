// Places inventory items into Bulk slots, as on the sheet's inventory pyramid.
//
// Bulk rank r has r slots, plus r bonus slots unlocked at r VIG. An item may
// also use a slot of a lower rank (a third Bulk 2 item can take the Bulk 1
// slot), so the most constrained items are placed first.
import type { InventoryItem } from './character';

export interface BulkSlot {
  item?: InventoryItem;
  bonus: boolean;
  locked: boolean;
}

export interface BulkRow {
  rank: number;
  slots: BulkSlot[];
}

export interface BulkLayout {
  rows: BulkRow[];
  /** Item units that don't fit anywhere. */
  overflow: InventoryItem[];
}

export function layoutBulk(items: InventoryItem[], vig: number): BulkLayout {
  const rows: BulkRow[] = [1, 2, 3, 4, 5].map((rank) => ({
    rank,
    slots: [
      ...Array.from({ length: rank }, () => ({ bonus: false, locked: false })),
      ...Array.from({ length: rank }, () => ({ bonus: true, locked: vig < rank })),
    ],
  }));
  const overflow: InventoryItem[] = [];
  const units = items
    .filter((i) => i.bulk && i.qty > 0)
    .flatMap((i) => Array.from({ length: i.qty }, () => i))
    .sort((a, b) => a.bulk! - b.bulk!);
  for (const it of units) {
    let placed = false;
    for (let r = it.bulk!; r >= 1 && !placed; r--) {
      const slot = rows[r - 1].slots.find((s) => !s.locked && !s.item);
      if (slot) {
        slot.item = it;
        placed = true;
      }
    }
    if (!placed) overflow.push(it);
  }
  return { rows, overflow };
}
