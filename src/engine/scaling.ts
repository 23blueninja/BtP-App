// Resolves spell/maneuver text for a chosen casting level.
//
// The rules write scaling as `7{SL}` (7 × level), `{SL} plus 4`, `half {SL}`
// and `Exalted (+1 | +2 | Nth)` entries. "Your level" means the character's level.
import type { Castable } from '../content';
import type { ClassDef } from '../data/types';
import { columnValue, numeric } from './classInfo';
import { half } from './dice';

export interface ScaleCtx {
  /** Level the spell/maneuver is cast at. */
  level: number;
  /** The character's level. */
  charLevel: number;
}

const SL_SPAN = /<span class="ic ic-SL"[^>]*><\/span>/g;
const OPEN = '\u0001';
const CLOSE = '\u0002';

/**
 * Replaces scaling expressions with numbers. Works on plain text or rules HTML;
 * resolved values are wrapped in OPEN/CLOSE markers for the caller to style.
 */
function resolve(text: string, ctx: ScaleCtx): string {
  const v = (n: number) => `${OPEN}${n}${CLOSE}`;
  let s = text;
  s = s.replace(/\bhalf\s*\{SL\}/gi, () => v(half(ctx.level)));
  s = s.replace(/(\d+)\s*\{SL\}/g, (_, n) => v(Number(n) * ctx.level));
  s = s.replace(/\{SL\}/g, () => v(ctx.level));
  s = s.replace(/\b[Yy]our level\b(?!\s+of)/g, () => v(ctx.charLevel));
  // Fold arithmetic on resolved values: "«5» plus 4" -> «9", "«3» minus 2" -> «1».
  const fold = new RegExp(`${OPEN}(-?\\d+)${CLOSE}\\s+(plus|minus)\\s+(\\d+)(?![\\d{])`, 'g');
  let prev;
  do {
    prev = s;
    s = s.replace(fold, (_, a, op, b) => v(op === 'plus' ? Number(a) + Number(b) : Number(a) - Number(b)));
  } while (s !== prev);
  return s;
}

/** Plain-text version (e.g. "24 Thermic damage."). */
export function scaleText(text: string, ctx: ScaleCtx): string {
  return resolve(text, ctx).replace(new RegExp(`[${OPEN}${CLOSE}]`, 'g'), '');
}

export type ExaltedState = { kind: 'step'; every: number; times: number } | { kind: 'at'; level: number; active: boolean };

/** How an "Exalted (…)" entry applies when cast `ctx.level - base` levels above its base. */
export function exaltedState(label: string, base: number, level: number): ExaltedState | undefined {
  const m = label.match(/Exalted\s*\(\s*(?:\+(\d+)|(\d+)(?:st|nd|rd|th))\s*\)/i);
  if (!m) return undefined;
  if (m[1]) {
    const every = Number(m[1]);
    return { kind: 'step', every, times: Math.max(0, Math.floor((level - base) / every)) };
  }
  const at = Number(m[2]);
  return { kind: 'at', level: at, active: level >= at };
}

/** Rules HTML with level expressions resolved to highlighted numbers. */
export function resolveHtml(html: string, ctx: ScaleCtx): string {
  let s = resolve(html.replace(SL_SPAN, '{SL}'), ctx);
  s = s.replace(new RegExp(OPEN, 'g'), '<b class="calc">').replace(new RegExp(CLOSE, 'g'), '</b>');
  return s.replace(/\{SL\}/g, '<span class="ic ic-SL" role="img" aria-label="SL" title="SL"></span>');
}

/** Rules HTML resolved for the casting level, with Exalted entries marked active/inactive. */
export function scaleHtml(html: string, base: number, ctx: ScaleCtx): string {
  const s = resolveHtml(html, ctx);
  return s.replace(/<div><dt>(.*?)<\/dt>/g, (whole, dt: string) => {
    const st = exaltedState(dt.replace(/<[^>]+>/g, ''), base, ctx.level);
    if (!st) return whole;
    const on = st.kind === 'step' ? st.times > 0 : st.active;
    const badge = st.kind === 'step' ? (st.times > 0 ? ` <span class="badge">×${st.times}</span>` : '') : on ? ' <span class="badge">active</span>' : '';
    return `<div class="exalted ${on ? 'on' : 'off'}"><dt>${dt}${badge}</dt>`;
  });
}

/** Highest level this character can cast/execute at (the class table's "Max …" column). */
export function maxCastLevel(cls: ClassDef | undefined, charLevel: number): number {
  return cls ? Math.max(1, numeric(columnValue(cls, charLevel, 'Max'))) : 1;
}

export interface CastCost {
  resource: string;
  amount: number;
}

/**
 * Class resource spent to cast/execute at `level`: equal to the level, except
 * Champion maneuvers, which cost Will equal to half the level. Cantrips and
 * mantras, and spells from non-class sources (e.g. ancestry), cost no resource.
 */
export function castCost(cls: ClassDef | undefined, c: Castable, level: number, fromClass: boolean): CastCost | undefined {
  if (!cls || !fromClass || c.level === 0) return undefined;
  const resource = cls.resources[0]?.name;
  if (!resource) return undefined;
  // Incarnates Channel their soul spells; only maneuvers cost Stamina.
  if (cls.id === 'incarnate' && c.kind === 'spell') return undefined;
  if (cls.id === 'champion' && c.kind === 'maneuver') return { resource, amount: half(level) };
  return { resource, amount: level };
}
