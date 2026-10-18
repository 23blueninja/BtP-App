// Folds active Exalted entries into a spell's or maneuver's Check results.
//
// Works on the rules HTML. Outcome lists (Success, Deadly Success, Failure…)
// and Exalted entries are both `<dl class="defs">` blocks. For the chosen level:
//   - "The additional effects … are now as follows." swaps in the outcome
//     block that follows it;
//   - clauses aimed at outcomes ("On a Deadly Success, the target is Stunned 1",
//     "Burning 1 on a Success, or Burning 2 on a Deadly Success", "the Burning
//     level of every other result increases by 1", "the damage on any Success
//     increases by 3") are written into those outcome lines;
//   - anything else is listed under "At this level".
import { exaltedState, resolveHtml, type ScaleCtx } from './scaling';

const OUTCOMES = ['Critical Success', 'Deadly Success', 'Complete Success', 'Success', 'Deadly Failure', 'Complete Failure', 'Failure'];

interface DefItem {
  dt: string;
  dd: string;
}

type Segment = { kind: 'html'; html: string } | { kind: 'defs'; items: DefItem[] };

export interface ExaltedNote {
  label: string;
  /** Rendered text (HTML) for clauses that couldn't be merged. */
  html: string;
  merged: boolean;
  active: boolean;
  times?: number;
}

export interface CalculatedCastable {
  html: string;
  notes: ExaltedNote[];
}

const textOf = (html: string) =>
  html
    .replace(/<span class="ic ic-(\w+)"[^>]*><\/span>/g, '{$1}')
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const tokensHtml = (s: string) => s.replace(/\{(VIG|AGI|PER|INT|PRS|AP|SL)\}/g, (_, k) => `<span class="ic ic-${k}" role="img" aria-label="${k}" title="${k}"></span>`);

function splitSegments(html: string): Segment[] {
  const out: Segment[] = [];
  const re = /<dl class="defs">([\s\S]*?)<\/dl>/g;
  let last = 0;
  for (let m; (m = re.exec(html)); ) {
    if (m.index > last) out.push({ kind: 'html', html: html.slice(last, m.index) });
    const items = [...m[1].matchAll(/<div><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)].map((x) => ({ dt: x[1], dd: x[2] }));
    out.push({ kind: 'defs', items });
    last = m.index + m[0].length;
  }
  if (last < html.length) out.push({ kind: 'html', html: html.slice(last) });
  return out;
}

const isOutcome = (dt: string) => OUTCOMES.includes(textOf(dt).replace(/:$/, ''));
const outcomeName = (dt: string) => textOf(dt).replace(/:$/, '');
const isExalted = (dt: string) => /^Exalted/i.test(textOf(dt));

/** Outcome names a scope phrase refers to ("any Success", "every other result", …). */
function scopeNames(phrase: string, all: string[], elsewhere: string[]): string[] {
  const p = phrase.toLowerCase();
  if (/every other result/.test(p)) return all.filter((n) => !elsewhere.includes(n));
  const except = p.match(/any result (?:except|other than) (.+)/);
  if (except) {
    const ex = scopeNames(except[1], all, []);
    return all.filter((n) => !ex.includes(n));
  }
  const names = new Set<string>();
  if (/any success/.test(p)) all.filter((n) => n.endsWith('Success')).forEach((n) => names.add(n));
  if (/any failure/.test(p)) all.filter((n) => n.endsWith('Failure')).forEach((n) => names.add(n));
  let rest = p;
  for (const n of OUTCOMES) {
    const k = n.toLowerCase();
    if (rest.includes(k)) {
      names.add(n);
      rest = rest.split(k).join(' ');
    }
  }
  return all.filter((n) => names.has(n));
}

type Op =
  | { kind: 'add'; targets: string[]; payload: string }
  | { kind: 'levelUp'; targets: string[]; condition: string; by: number }
  | { kind: 'damageUp'; targets: string[]; by: number };

const SUBJECT = /^(?:a creature|the creature|creatures|the target|targets|it)\s+(?:is|are|becomes|become)\s+/i;

/** "Stunned 2", "Sickened and Slowed 1 until the start of your turn", "Prone". */
const CONDITION_LIKE = /^[A-Z][a-z]+(?:(?:,| and) [A-Z][a-z]+)*(?: \d+)?(?: (?:until|while|for) .+)?$/;

/** Condition-style payloads ("Stunned 1", "Prone") are appended to the result line; others become a sentence. */
function condense(payload: string): { text: string; condition: boolean } {
  const t = payload.trim().replace(/\.$/, '');
  if (SUBJECT.test(t)) return { text: t.replace(SUBJECT, ''), condition: true };
  if (/^(?:a creature|the creature|the target)\s+falls?\s+prone$/i.test(t)) return { text: 'Prone', condition: true };
  if (CONDITION_LIKE.test(t)) return { text: t, condition: true };
  return { text: t.charAt(0).toUpperCase() + t.slice(1), condition: false };
}

/** "X on a Success, or Y on a Deadly Success" -> per-outcome payloads. `lead` targets the first part when given. */
function splitAlternatives(c: string, all: string[], lead?: string[]): Op[] | undefined {
  const parts = c.split(/,\s+or\s+/);
  const ops: Op[] = [];
  let first = '';
  for (const [i, part] of parts.entries()) {
    let payload: string;
    let targets: string[];
    if (i === 0 && lead) {
      payload = part;
      targets = lead;
    } else {
      const pm = part.match(/^(.+?) on ((?:an?|any) .+)$/i);
      if (!pm) return undefined;
      payload = pm[1];
      targets = scopeNames(pm[2], all, []);
    }
    if (!targets.length) return undefined;
    if (!first) first = payload;
    else if (/^\d+(?: [A-Za-z]+)?$/.test(payload.trim())) {
      // "or 2 on a Deadly Success" / "or 2 Vitality on …": reuse the first part's wording.
      const p = payload.trim();
      payload = /\s/.test(p) ? first.replace(/\d+ [A-Za-z]+(?!.*\d)/, p) : first.replace(/\d+(?!.*\d)/, p);
    }
    ops.push({ kind: 'add', targets, payload });
  }
  return ops;
}

/** Parses one Exalted entry (already scaled to numbers) into operations; returns leftover text. */
function parseEntry(text: string, all: string[], times: number): { ops: Op[]; leftover: string[] } {
  const ops: Op[] = [];
  const leftover: string[] = [];
  const mentioned = all.filter((n) => text.includes(n));
  const sentences = text.split(/(?<=\.)\s+/).map((s) => s.replace(/\.$/, '').trim()).filter(Boolean);
  for (const s of sentences) {
    if (/instead|now as follows|for each exalted level/i.test(s)) {
      leftover.push(s);
      continue;
    }
    for (const clause of s.split(/,\s+and\s+(?=the |a creature|the creature)/i)) {
      const c = clause.trim();
      let m;
      if ((m = c.match(/^the (\w+) level(?:s)? (?:of|on|for) (.+?) increases? by (\d+)$/i))) {
        const targets = scopeNames(m[2], all, mentioned.filter((n) => !m![2].includes(n)));
        if (targets.length) ops.push({ kind: 'levelUp', targets, condition: m[1], by: Number(m[3]) * times });
        else leftover.push(c);
      } else if ((m = c.match(/^the (?:\w+ )?damage (?:on (.+?) )?increases by (?:an additional )?(\d+)(?: on (.+))?$/i))) {
        const targets = scopeNames(m[1] ?? m[3] ?? '', all, []);
        if (targets.length) ops.push({ kind: 'damageUp', targets, by: Number(m[2]) * times });
        else leftover.push(c);
      } else if (/^(?:when|while|each time|if)\b/i.test(c) && !/^if your attack check is/i.test(c)) {
        // Conditional on something other than the result (e.g. "When you detonate the mote, …").
        leftover.push(c);
      } else if ((m = c.match(/^(?:on|if your attack check is) (an?|any) ([^,]+), (.+)$/i))) {
        const lead = scopeNames(`${m[1]} ${m[2]}`, all, []);
        const alt = lead.length ? splitAlternatives(m[3], all, lead) : undefined;
        if (alt) ops.push(...alt);
        else leftover.push(c);
      } else if (/ on (?:an?|any) /i.test(c)) {
        const alt = splitAlternatives(c, all);
        if (alt) ops.push(...alt);
        else leftover.push(c);
      } else {
        leftover.push(c);
      }
    }
  }
  return { ops, leftover };
}

const CALC = (n: number, title: string) => `<b class="calc" title="${title}">${n}</b>`;

function applyOp(dd: string, op: Op, label: string): string {
  switch (op.kind) {
    case 'levelUp': {
      const re = new RegExp(`(${op.condition})\\s+(?:<b class="calc"[^>]*>)?(\\d+)(?:</b>)?`, 'i');
      return re.test(dd) ? dd.replace(re, (_, cond, n) => `${cond} ${CALC(Number(n) + op.by, `+${op.by} from ${label}`)}`) : dd;
    }
    case 'damageUp': {
      const re = /(?:<b class="calc"[^>]*>)?(\d+)(?:<\/b>)?(\s+(?:\w+\s+)?damage)/i;
      return re.test(dd) ? dd.replace(re, (_, n, rest) => `${CALC(Number(n) + op.by, `+${op.by} from ${label}`)}${rest}`) : dd;
    }
    case 'add': {
      const { text, condition } = condense(op.payload);
      const tag = (s: string) => `<span class="ex-add" title="${label}">${tokensHtml(s)}</span>`;
      if (condition) {
        // Same condition already present: the Exalted value replaces it.
        const cm = text.match(/^([A-Z][a-z]+)\s+(\d+)$/);
        if (cm) {
          const re = new RegExp(`(${cm[1]})\\s+(?:<b class="calc"[^>]*>)?(\\d+)(?:</b>)?`);
          if (re.test(dd)) return dd.replace(re, (_, cond) => `${cond} ${CALC(Number(cm[2]), label)}`);
        }
        if (!/\d/.test(text) && textOf(dd).toLowerCase().includes(text.toLowerCase())) return dd;
        if (/^Nothing\.?$/i.test(textOf(dd))) return `${tag(text)}.`;
        return dd.replace(/\.(<\/span>)?\s*$/, '$1') + `, ${tag(text)}.`;
      }
      return `${dd} ${tag(`${text}.`)}`;
    }
  }
}

/** HTML for a castable at the chosen level, with Exalted effects folded into its results. */
export function calculateCastable(html: string, base: number, ctx: ScaleCtx): CalculatedCastable {
  const scaled = resolveHtml(html, ctx);
  const segs = splitSegments(scaled);
  // Raw Exalted texts (same order) so inactive entries can show their own level's numbers.
  const rawExalted = splitSegments(html).flatMap((s) => (s.kind === 'defs' ? s.items.filter((i) => isExalted(i.dt)).map((i) => i.dd) : []));
  const notes: ExaltedNote[] = [];
  const allOutcomeNames = [...new Set(segs.flatMap((s) => (s.kind === 'defs' ? s.items.filter((i) => isOutcome(i.dt)).map((i) => outcomeName(i.dt)) : [])))];

  // 1. Pull Exalted entries out of their lists; note replacement blocks.
  type Entry = { label: string; text: string; active: boolean; times: number; previewHtml: string };
  const entries: Entry[] = [];
  const replacementFor = new Map<number, Entry>(); // segment index -> entry whose block it is
  let pendingReplace: Entry | undefined;
  segs.forEach((seg, idx) => {
    if (seg.kind !== 'defs') return;
    const outcomes = seg.items.filter((i) => isOutcome(i.dt));
    if (pendingReplace && outcomes.length) {
      replacementFor.set(idx, pendingReplace);
      pendingReplace = undefined;
    }
    seg.items = seg.items.filter((i) => {
      if (!isExalted(i.dt)) return true;
      const label = textOf(i.dt);
      const st = exaltedState(label, base, ctx.level);
      const active = st ? (st.kind === 'step' ? st.times > 0 : st.active) : false;
      const raw = rawExalted[entries.length] ?? i.dd;
      const previewLevel = st?.kind === 'at' ? st.level : base + (st?.kind === 'step' ? st.every : 1);
      const entry: Entry = {
        label,
        text: textOf(i.dd),
        active,
        times: st?.kind === 'step' ? st.times : 1,
        previewHtml: resolveHtml(raw, { ...ctx, level: Math.max(previewLevel, ctx.level) }),
      };
      entries.push(entry);
      if (/now as follows/i.test(entry.text)) pendingReplace = entry;
      return false;
    });
  });

  // 2. Swap in the highest active replacement for each base outcome block.
  let baseIdx = -1;
  segs.forEach((seg, idx) => {
    if (seg.kind !== 'defs' || !seg.items.some((i) => isOutcome(i.dt))) return;
    const rep = replacementFor.get(idx);
    if (!rep) {
      baseIdx = idx;
      return;
    }
    if (rep.active && baseIdx >= 0) {
      (segs[baseIdx] as { items: DefItem[] }).items = seg.items;
    }
    seg.items = [];
  });

  // 3. Merge outcome-targeted clauses into the remaining outcome lines.
  for (const e of entries) {
    if (!e.active) {
      notes.push({ label: e.label, html: e.previewHtml, merged: false, active: false });
      continue;
    }
    if (/now as follows/i.test(e.text)) {
      notes.push({ label: e.label, html: 'Results above are the Exalted versions.', merged: true, active: true });
      continue;
    }
    const { ops, leftover } = parseEntry(e.text, allOutcomeNames, e.times);
    for (const op of ops) {
      for (const seg of segs) {
        if (seg.kind !== 'defs') continue;
        for (const it of seg.items) if (isOutcome(it.dt) && op.targets.includes(outcomeName(it.dt))) it.dd = applyOp(it.dd, op, e.label);
      }
    }
    notes.push({
      label: e.label,
      html: leftover.length ? tokensHtml(leftover.map((l) => `${l}.`).join(' ')) : 'Applied to the results above.',
      merged: leftover.length === 0,
      active: true,
      times: e.times > 1 ? e.times : undefined,
    });
  }

  const out = segs
    .map((s) =>
      s.kind === 'html'
        ? s.html
        : s.items.length
          ? `<dl class="defs">${s.items.map((i) => `<div${isOutcome(i.dt) ? ' class="outcome"' : ''}><dt>${i.dt}</dt><dd>${i.dd}</dd></div>`).join('')}</dl>`
          : '',
    )
    .join('');
  return { html: out, notes };
}
