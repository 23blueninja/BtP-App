import { useState } from 'react';
import { getNode, type Castable, type RuleNode } from '../content';
import type { Character } from '../engine/character';
import type { Derived } from '../engine/derive';
import { calculateCastable } from '../engine/exalted';
import { castCost, maxCastLevel, scaleText } from '../engine/scaling';
import { activationsFor, type UseRequest } from '../engine/activations';
import { parseCost } from '../engine/costs';
import { UseButton } from './Activate';
import { Collapsible, TokenText } from './common';
import { CastableDetails } from './pickers';

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** A rules section and its subsections as one HTML string (subsection titles as headings). */
function flatHtml(node: RuleNode, depth = 5): string {
  return [node.html ?? '', ...(node.children ?? []).map((c) => `<h${Math.min(6, depth)} class="rule-title">${c.titleHtml}</h${Math.min(6, depth)}>${flatHtml(c, depth + 1)}`)].join('');
}

/**
 * A spell or maneuver on the sheet: pick the level to cast/execute at, see the
 * text with every scaling value resolved, and cast it (spending AP and the
 * class resource, and applying its effects).
 */
export function CastRow({
  c,
  d,
  cs,
  fromClass,
}: {
  c: Character;
  d: Derived;
  cs: Castable;
  fromClass: boolean;
}) {
  const base = cs.level;
  const max = maxCastLevel(d.cls, d.level);
  const [level, setLevel] = useState(Math.max(base, 1));
  const [view, setView] = useState<'calc' | 'orig'>('calc');
  const node = getNode(cs.id);
  const scalable = base > 0;
  const castLevel = scalable ? level : 0;
  const cost = castCost(d.cls, cs, castLevel, fromClass);
  const res = cost ? d.resources.find((r) => r.name === cost.resource) : undefined;
  const used = cost ? (c.play.resources[cost.resource] ?? 0) : 0;
  const available = res ? res.max - used : 0;
  const canAfford = !cost || (res !== undefined && cost.amount <= available);
  const modDie = cs.kind === 'spell' ? d.spellModDie : d.maneuverModDie;
  const levels = scalable ? Array.from({ length: Math.max(max, base) + 2 - base + 1 }, (_, i) => base + i).filter((l) => l <= 10) : [];
  const meta = [cs.fields['Cast Time'] ?? cs.fields['Execution Time'], cs.fields['Range'], cs.fields['Duration']]
    .filter(Boolean)
    .map((t) => scaleText(t!, { level: castLevel, charLevel: d.level }))
    .join(' · ');

  // Casting spends the Cast Time's AP, the class resource and (Arcanists) Prismaburn, then applies any effects.
  const burns = d.cls?.id === 'arcanist' && cs.kind === 'spell' && !!cost;
  const req: UseRequest = {
    key: cs.id,
    name: cs.name,
    cost: parseCost(cs.fields['Cast Time'] ?? cs.fields['Execution Time']),
    def: activationsFor(cs.id)[0],
    sl: castLevel,
    extra: {
      apply: (p) => {
        let next = p;
        if (cost && res) next = { ...next, resources: { ...next.resources, [cost.resource]: (next.resources[cost.resource] ?? 0) + cost.amount } };
        if (burns) next = { ...next, trackers: { ...next.trackers, Prismaburn: (next.trackers.Prismaburn ?? 0) + level } };
        return next;
      },
      log: [
        `${cs.kind === 'spell' ? 'Cast' : 'Executed'} ${cs.name}${scalable ? ` at ${ordinal(level)} level` : ''}.`,
        ...(cost && res ? [`${res.mode === 'limit' ? 'Applied' : 'Spent'} ${cost.amount} ${cost.resource}${burns ? `, Prismaburned ${level}` : ''}.`] : []),
      ],
    },
  };

  return (
    <Collapsible
      title={
        <span className="castable-title">
          <strong>{cs.name}</strong> <span className="muted">{cs.subtitle}</span>
        </span>
      }
    >
      <div className="cast-panel">
        {scalable && (
          <label className="inline">
            {cs.kind === 'spell' ? 'Cast at' : 'Execute at'}
            <select value={level} onChange={(e) => setLevel(Number(e.target.value))} aria-label="Casting level">
              {levels.map((l) => (
                <option key={l} value={l}>
                  {ordinal(l)} level{l > max ? ' (above your max)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {modDie && (
          <span className="chip">
            Mod Die <strong>{modDie}</strong>
          </span>
        )}
        {cost && (
          <span className={`chip ${canAfford ? '' : 'invalid'}`}>
            Cost {cost.amount} {cost.resource}
            {res && ` · ${available} ${res.mode === 'limit' ? 'left in limit' : 'available'}`}
          </span>
        )}
        <UseButton req={req} primary label={cs.kind === 'spell' ? 'Cast' : 'Execute'} disabled={!canAfford} />
      </div>
      <div className="castable-meta">
        <TokenText text={meta} />
      </div>
      <div className="view-toggle" role="tablist" aria-label="Text view">
        <button type="button" role="tab" aria-selected={view === 'calc'} className={view === 'calc' ? 'active' : ''} onClick={() => setView('calc')}>
          Calculated{scalable ? ` (${ordinal(level)} level)` : ''}
        </button>
        <button type="button" role="tab" aria-selected={view === 'orig'} className={view === 'orig' ? 'active' : ''} onClick={() => setView('orig')}>
          Original text
        </button>
      </div>
      {node && view === 'orig' && <CastableDetails c={cs} />}
      {node && view === 'calc' && <Calculated node={node} base={base} level={castLevel} charLevel={d.level} />}
    </Collapsible>
  );
}

function Calculated({ node, base, level, charLevel }: { node: RuleNode; base: number; level: number; charLevel: number }) {
  const { html, notes } = calculateCastable(flatHtml(node), base, { level, charLevel });
  const now = notes.filter((n) => n.active);
  const later = notes.filter((n) => !n.active);
  return (
    <div className="castable-details calculated">
      <div className="rules" dangerouslySetInnerHTML={{ __html: html }} />
      {now.length > 0 && (
        <div className="exalted-notes">
          <h5>At this level</h5>
          <dl className="defs">
            {now.map((n) => (
              <div key={n.label} className={n.merged ? 'merged' : ''}>
                <dt>
                  {n.label}
                  {n.times ? ` ×${n.times}` : ''}
                </dt>
                <dd dangerouslySetInnerHTML={{ __html: n.html }} />
              </div>
            ))}
          </dl>
        </div>
      )}
      {later.length > 0 && (
        <div className="exalted-notes later">
          <h5>At higher levels</h5>
          <dl className="defs">
            {later.map((n) => (
              <div key={n.label}>
                <dt>{n.label}</dt>
                <dd dangerouslySetInnerHTML={{ __html: n.html }} />
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
