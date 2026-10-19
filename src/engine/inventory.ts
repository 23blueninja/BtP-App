// Places inventory items into Bulk slots, as on the sheet's inventory pyramid.
//
// Bulk rank r has r slots, plus r bonus slots unlocked at r VIG. An item may
// also use a slot of a lower rank (a third Bulk 2 item can take the Bulk 1
// slot), so the most constrained items are placed first. Effects like Powerful
// Build decrease the Bulk Rank (raise the number) of items carried on your
// person, up to the lowest rank, 5.
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

/** Bulk Rank an item counts as, after any shift for items carried on your person. */
export function effectiveBulk(item: InventoryItem, shift: number): number | undefined {
  if (!item.bulk) return undefined;
  // Items in a container's pyramid are laid out with no shift (layoutContainer), so storedIn isn't checked here:
  // an item whose container is gone is back on your person.
  return Math.min(5, item.bulk + (item.inBackpack ? 0 : shift));
}

export interface InventoryGroups {
  /** Items in your own (and VIG bonus) pyramid. */
  person: InventoryItem[];
  /** Each container with the items stored in it. */
  containers: { item: InventoryItem; contents: InventoryItem[] }[];
}

/**
 * Splits items between your person and containers (backpacks with their own
 * pyramid). A container itself is carried on your person and can't go inside
 * another; items stored in a container that's gone fall back to your person.
 */
export function groupInventory(items: InventoryItem[]): InventoryGroups {
  const containers = items.filter((i) => i.container);
  const ids = new Set(containers.map((i) => i.id));
  const inContainer = (i: InventoryItem) => !i.container && !!i.storedIn && ids.has(i.storedIn);
  return {
    person: items.filter((i) => !inContainer(i)),
    containers: containers.map((item) => ({ item, contents: items.filter((i) => inContainer(i) && i.storedIn === item.id) })),
  };
}

/** A container's pyramid: rank r has r slots, with no VIG bonus slots. */
export function layoutContainer(items: InventoryItem[]): BulkLayout {
  const l = layoutBulk(items, 0, 0);
  return { rows: l.rows.map((r) => ({ ...r, slots: r.slots.filter((s) => !s.bonus) })), overflow: l.overflow };
}

export function layoutBulk(items: InventoryItem[], vig: number, shift = 0): BulkLayout {
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
    .sort((a, b) => effectiveBulk(a, shift)! - effectiveBulk(b, shift)!);
  for (const it of units) {
    let placed = false;
    for (let r = effectiveBulk(it, shift)!; r >= 1 && !placed; r--) {
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
