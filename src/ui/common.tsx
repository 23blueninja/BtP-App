import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getItem, getNode, type RuleNode } from '../content';

export type IconName = 'VIG' | 'AGI' | 'PER' | 'INT' | 'PRS' | 'AP' | 'SL';

export function Icon({ name }: { name: IconName }) {
  return <span className={`ic ic-${name}`} role="img" aria-label={name} title={name} />;
}

/** Renders plain text containing `{VIG}`-style tokens with icons. */
export function TokenText({ text }: { text: string }) {
  const parts = text.split(/(\{(?:VIG|AGI|PER|INT|PRS|AP|SL)\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\{(\w+)\}$/);
        return m ? <Icon key={i} name={m[1] as IconName} /> : <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

/** Plain-text excerpt of rules HTML (entities decoded). */
export function excerpt(html: string | undefined, max: number): string {
  const text = new DOMParser().parseFromString(html ?? '', 'text/html').body.textContent ?? '';
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t;
}

/** Trusted HTML generated from the rules source at build time. */
export function Html({ html, className }: { html?: string; className?: string }) {
  if (!html) return null;
  return <div className={`rules ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A rules section with all of its subsections. */
export function RuleBlock({ node, showTitle = true, depthOffset = 0 }: { node: RuleNode; showTitle?: boolean; depthOffset?: number }) {
  const level = Math.min(6, Math.max(2, node.depth - depthOffset + 1));
  const H = `h${level}` as 'h2';
  return (
    <section className="rule-block">
      {showTitle && (
        <H className="rule-title">
          <span dangerouslySetInnerHTML={{ __html: node.titleHtml }} />
          {node.lvl !== undefined && <span className="badge">Level {node.lvl}</span>}
        </H>
      )}
      <Html html={node.html} />
      {node.children?.map((c) => <RuleBlock key={c.id} node={c} depthOffset={depthOffset} />)}
    </section>
  );
}

/** Rules text for a facet: a named item within a section, or a whole section. */
export function FacetText({ contentId, item }: { contentId?: string; item?: string }) {
  if (!contentId) return null;
  if (item) {
    const it = getItem(contentId, item);
    return it ? <Html html={it.html} /> : null;
  }
  const n = getNode(contentId);
  if (!n) return null;
  return (
    <div className="facet-text">
      <Html html={n.html} />
      {n.children?.map((c) => <RuleBlock key={c.id} node={c} depthOffset={n.depth} />)}
    </div>
  );
}

export function Collapsible({ title, children, defaultOpen = false, extra }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; extra?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsible ${open ? 'open' : ''}`}>
      {/* Extras (use pips, Use buttons) sit beside the toggle, not inside it. */}
      <div className="collapsible-row">
        <button type="button" className="collapsible-head" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="chevron" aria-hidden>
            ▸
          </span>
          <span className="collapsible-title">{title}</span>
        </button>
        {extra && <span className="collapsible-extra">{extra}</span>}
      </div>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

export function Stepper({ value, onChange, min = -Infinity, max = Infinity, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string }) {
  return (
    <div className="stepper" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Decrease ${label ?? ''}`}>
        −
      </button>
      <span className="stepper-value">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`Increase ${label ?? ''}`}>
        +
      </button>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  // Rendered at the app root: a glass panel's backdrop-filter would otherwise
  // trap the fixed backdrop inside that panel, under the panels after it.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.querySelector('.app') ?? document.body,
  );
}

/** Opens a rules section in a modal. */
export function RuleLink({ id, children }: { id: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const n = getNode(id);
  if (!n) return <>{children}</>;
  return (
    <>
      <button type="button" className="link" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && (
        <Modal title={<span dangerouslySetInnerHTML={{ __html: n.titleHtml }} />} onClose={() => setOpen(false)} wide>
          <Html html={n.html} />
          {n.children?.map((c) => <RuleBlock key={c.id} node={c} depthOffset={n.depth} />)}
        </Modal>
      )}
    </>
  );
}

// ---------- hash routing ----------

export function useHashRoute(): string[] {
  const parse = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(...parts: string[]) {
  window.location.hash = '#/' + parts.map(encodeURIComponent).join('/');
}
