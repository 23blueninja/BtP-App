// Attribute points -> Modifier Die, and die-size stepping (Bolstered/Hindered).

const SIZES = [2, 4, 6, 8, 10, 12];

/** A Mod Die as a signed step (1 = d2 … 6 = d12) plus any flat bonus beyond d12. */
export interface ModDie {
  step: number; // -6..6, 0 = no die
  bonus: number; // flat bonus beyond ±d12
}

export function modDieFromPoints(points: number): ModDie {
  const abs = Math.abs(points);
  const step = Math.min(abs, 6) * Math.sign(points);
  const bonus = Math.max(abs - 6, 0) * Math.sign(points);
  return { step, bonus };
}

/** Steps a die up (positive) or down (negative), carrying overflow into the flat bonus. */
export function stepDie(die: ModDie, steps: number): ModDie {
  let total = die.step + die.bonus + steps;
  const step = Math.max(-6, Math.min(6, total));
  return { step, bonus: total - step };
}

export function formatDie(die: ModDie): string {
  if (die.step === 0 && die.bonus === 0) return '—';
  const size = die.step === 0 ? '' : `${die.step < 0 ? '-' : ''}d${SIZES[Math.abs(die.step) - 1]}`;
  if (!die.bonus) return size;
  return `${size}${die.bonus > 0 ? '+' : ''}${die.bonus}`;
}

export function dieLabel(points: number): string {
  return formatDie(modDieFromPoints(points));
}

/** Parses "1d6" / "d8" into a step. */
export function parseDie(s: string): ModDie {
  const m = s.match(/(-?)\d*d(\d+)/);
  if (!m) return { step: 0, bonus: 0 };
  const idx = SIZES.indexOf(Number(m[2]));
  return { step: (idx + 1) * (m[1] ? -1 : 1), bonus: 0 };
}

/** Triangular growth used by Movement and Radius: +1 at 1 point, +3 at 2, +6 at 3 … */
export function triangular(points: number): number {
  const n = Math.abs(points);
  return (Math.sign(points) * n * (n + 1)) / 2;
}

/** BtP always rounds up when halving. */
export const half = (n: number) => Math.ceil(n / 2);
