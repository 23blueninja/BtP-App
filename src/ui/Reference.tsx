import { useMemo, useState } from 'react';
import { allNodes, getNode, getParent, rulesSource, sections, type RuleNode } from '../content';
import { go, RuleBlock } from './common';

const strip = (h?: string) => (h ?? '').replace(/<[^>]+>/g, ' ');

/** Browsable, searchable rules reference. */
export function Reference({ id }: { id?: string }) {
  const [q, setQ] = useState('');
  const node = id ? getNode(id) : undefined;
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return allNodes()
      .filter((n) => n.title.toLowerCase().includes(t) || strip(n.html).toLowerCase().includes(t))
      .sort((a, b) => Number(!a.title.toLowerCase().includes(t)) - Number(!b.title.toLowerCase().includes(t)))
      .slice(0, 60);
  }, [q]);
  const crumbs: RuleNode[] = [];
  for (let n = node; n; n = getParent(n.id)) crumbs.unshift(n);

  return (
    <div className="reference">
      <aside className="ref-nav">
        <input type="search" placeholder="Search the rules…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the rules" />
        {q.trim().length >= 2 ? (
          <ul className="ref-results">
            {results.map((n) => (
              <li key={n.id}>
                <button type="button" className="link" onClick={() => go('rules', n.id)}>
                  {n.title}
                </button>
                <small className="muted"> {getParent(n.id)?.title}</small>
              </li>
            ))}
            {!results.length && <li className="muted">No matches.</li>}
          </ul>
        ) : (
          <ul className="ref-tree">
            {sections.map((s) => (
              <li key={s.id}>
                <button type="button" className={`link ${node?.id === s.id ? 'active' : ''}`} onClick={() => go('rules', s.id)}>
                  {s.title}
                </button>
                <ul>
                  {s.children
                    ?.filter((c) => c.depth <= 3)
                    .map((c) => (
                      <li key={c.id}>
                        <button type="button" className={`link ${crumbs.some((x) => x.id === c.id) ? 'active' : ''}`} onClick={() => go('rules', c.id)}>
                          {c.title}
                        </button>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Source: {rulesSource}</p>
      </aside>
      <article className="ref-body">
        {crumbs.length > 1 && (
          <nav className="crumbs">
            {crumbs.slice(0, -1).map((c) => (
              <span key={c.id}>
                <button type="button" className="link" onClick={() => go('rules', c.id)}>
                  {c.title}
                </button>{' '}
                ›{' '}
              </span>
            ))}
          </nav>
        )}
        {node ? (
          <RuleBlock node={node} depthOffset={node.depth - 1} />
        ) : (
          <div>
            <h2>Beyond the Prism — Alpha Rules</h2>
            <p>Browse sections on the left or search for any rule, spell, maneuver, condition or action.</p>
            <p className="muted small">Alpha Rules Release © 2026 23BLUENINJA — All Rights Reserved.</p>
          </div>
        )}
      </article>
    </div>
  );
}
