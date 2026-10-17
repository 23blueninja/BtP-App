import { useState } from 'react';
import { getNode, type Castable, type RuleNode } from '../content';
import type { Character, PlayState } from '../engine/character';
import type { Derived } from '../engine/derive';
import { castCost, maxCastLevel, scaleHtml, scaleText } from '../engine/scaling';
import { Collapsible, TokenText } from './common';

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

function ScaledNode({ node, base, level, charLevel, depth }: { node: RuleNode; base: number; level: number; charLevel: number; depth: number }) {
  const H = `h${Math.min(6, depth)}` as 'h4';
  return (
    <section className="rule-block">
      <H className="rule-title" dangerouslySetInnerHTML={{ __html: node.titleHtml }} />
      {node.html && <div className="rules" dangerouslySetInnerHTML={{ __html: scaleHtml(node.html, base, { level, charLevel }) }} />}
      {node.children?.map((ch) => <ScaledNode key={ch.id} node={ch} base={base} level={level} charLevel={charLevel} depth={depth + 1} />)}
    </section>
  );
}

/**
 * A spell or maneuver on the sheet: pick the level to cast/execute at, see the
 * text with every scaling value resolved, and spend the class resource.
 */
export function CastRow({
  c,
  d,
  cs,
  fromClass,
  setPlay,
}: {
  c: Character;
  d: Derived;
  cs: Castable;
  fromClass: boolean;
  setPlay: (fn: (p: PlayState) => PlayState) => void;
}) {
  const base = cs.level;
  const max = maxCastLevel(d.cls, d.level);
  const [level, setLevel] = useState(Math.max(base, 1));
  const [msg, setMsg] = useState('');
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

  const cast = () => {
    if (!cost || !res) {
      setMsg(`${cs.kind === 'spell' ? 'Cast' : 'Executed'} ${cs.name}${scalable ? ` at ${ordinal(level)} level` : ''}.`);
      return;
    }
    setPlay((p) => {
      const next = { ...p, resources: { ...p.resources, [cost.resource]: (p.resources[cost.resource] ?? 0) + cost.amount } };
      if (d.cls?.id === 'arcanist' && cs.kind === 'spell') next.trackers = { ...p.trackers, Prismaburn: (p.trackers.Prismaburn ?? 0) + level };
      return next;
    });
    const burn = d.cls?.id === 'arcanist' && cs.kind === 'spell' ? `, Prismaburned ${level}` : '';
    setMsg(`${cs.kind === 'spell' ? 'Cast' : 'Executed'} at ${ordinal(level)} level: ${res.mode === 'limit' ? 'applied' : 'spent'} ${cost.amount} ${cost.resource}${burn}.`);
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
        <button type="button" className="primary" onClick={cast} disabled={!canAfford}>
          {cs.kind === 'spell' ? 'Cast' : 'Execute'}
        </button>
      </div>
      {msg && <p className="ok-text small">{msg}</p>}
      <div className="castable-meta">
        <TokenText text={meta} />
      </div>
      {node && (
        <div className="castable-details">
          {node.html && <div className="rules" dangerouslySetInnerHTML={{ __html: scaleHtml(node.html, base, { level: castLevel, charLevel: d.level }) }} />}
          {node.children?.map((ch) => <ScaledNode key={ch.id} node={ch} base={base} level={castLevel} charLevel={d.level} depth={5} />)}
        </div>
      )}
    </Collapsible>
  );
}
