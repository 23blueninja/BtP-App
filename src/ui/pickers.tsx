import { useMemo, useState } from 'react';
import { getNode, type Castable } from '../content';
import type { ResolvedChoice, ResolvedList } from '../engine/derive';
import { Collapsible, FacetText, Html, RuleBlock, TokenText } from './common';

export function CastableDetails({ c }: { c: Castable }) {
  const n = getNode(c.id);
  if (!n) return null;
  return (
    <div className="castable-details">
      <Html html={n.html} />
      {n.children?.map((ch) => <RuleBlock key={ch.id} node={ch} depthOffset={n.depth} />)}
    </div>
  );
}

export function castableMeta(c: Castable): string {
  const f = c.fields;
  return [f['Cast Time'] ?? f['Execution Time'], f['Range'], f['Duration']].filter(Boolean).join(' · ');
}

export function CastableRow({ c, action }: { c: Castable; action?: React.ReactNode }) {
  return (
    <Collapsible
      title={
        <span className="castable-title">
          <strong>{c.name}</strong> <span className="muted">{c.subtitle}</span>
        </span>
      }
      extra={action}
    >
      <div className="castable-meta">
        <TokenText text={castableMeta(c)} />
      </div>
      <CastableDetails c={c} />
    </Collapsible>
  );
}

export function ChoicePicker({ choice, onPick }: { choice: ResolvedChoice; onPick: (id: string) => void }) {
  return (
    <div className="choice">
      <h4>
        {choice.label} <span className="muted">({choice.source}, level {choice.level})</span>
      </h4>
      <div className="option-grid">
        {choice.options.map((o) => (
          <label key={o.id} className={`option ${choice.selected === o.id ? 'selected' : ''}`}>
            <input type="radio" name={choice.id} checked={choice.selected === o.id} onChange={() => onPick(o.id)} />
            <span className="option-name">{o.name}</span>
          </label>
        ))}
      </div>
      {choice.selected && (
        <div className="choice-text">
          <FacetText contentId={choice.options.find((o) => o.id === choice.selected)?.contentId} item={choice.options.find((o) => o.id === choice.selected)?.item} />
        </div>
      )}
    </div>
  );
}

export function SpellListEditor({ list, selectedIds, onChange, limit }: { list: ResolvedList; selectedIds: string[]; onChange: (ids: string[]) => void; limit?: number }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const want = limit ?? list.count - list.granted.length;
  const types = useMemo(() => [...new Set(list.pool.map((p) => p.type))], [list.pool]);
  const shown = list.pool.filter(
    (p) => (!type || p.type === type) && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.subtitle.toLowerCase().includes(q.toLowerCase())),
  );
  const toggle = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  const full = selectedIds.length >= want;
  return (
    <div className="spell-list-editor">
      <div className="list-head">
        <h4>
          {list.def.label} <span className="muted">({list.source})</span>
        </h4>
        <span className={`count ${selectedIds.length === want ? 'ok' : selectedIds.length > want ? 'over' : ''}`}>
          {selectedIds.length} / {want} chosen
        </span>
      </div>
      {list.def.note && <p className="note">{list.def.note}</p>}
      {list.granted.length > 0 && (
        <div className="granted">
          <span className="muted">Always known: </span>
          {list.granted.map((g) => (
            <span key={g.id} className="chip">
              {g.name}
            </span>
          ))}
        </div>
      )}
      {selectedIds.length > 0 && (
        <div className="chips">
          {selectedIds.map((id) => {
            const c = list.pool.find((p) => p.id === id);
            return (
              <button type="button" key={id} className={`chip removable ${c ? '' : 'invalid'}`} onClick={() => toggle(id)} title="Remove">
                {c?.name ?? id.split('/').pop()} ✕
              </button>
            );
          })}
        </div>
      )}
      <div className="filters">
        <input type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search spells" />
        {types.length > 1 && (
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
      </div>
      <div className="pool">
        {shown.length === 0 && <p className="muted">Nothing available{list.def.from ? ` — add spells to your ${list.def.from} first` : ''}.</p>}
        {shown.map((c) => {
          const on = selectedIds.includes(c.id);
          return (
            <CastableRow
              key={c.id}
              c={c}
              action={
                <span
                  role="button"
                  tabIndex={0}
                  className={`pill-btn ${on ? 'on' : ''} ${!on && full ? 'disabled' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (on || !full) toggle(c.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      if (on || !full) toggle(c.id);
                    }
                  }}
                >
                  {on ? '✓ Chosen' : 'Choose'}
                </span>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
