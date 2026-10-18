import { useContext, useRef, useState } from 'react';
import { weaponProperties, weapons } from '../content';
import { ATTRS, ATTR_NAMES, LIGHTS, type Attr, type Light, type RestRule } from '../data/types';
import { newId, type Character, type DieChoice, type HomebrewEffect, type HomebrewEntry, type HomebrewRow, type PerTier } from '../engine/character';
import { derive, type Derived } from '../engine/derive';
import { describeEffect, newHomebrew, RULE_TEXT, spendPool, TIER_NAMES, type ResolvedHomebrew } from '../engine/homebrew';
import { PlayContext } from './Activate';
import { Collapsible, Modal } from './common';

type Update = (fn: (c: Character) => Character) => void;

const DAMAGE_TYPES = ['Arctic', 'Caustic', 'Chthonic', 'Cosmic', 'Crushing', 'Divine', 'Galvanic', 'Infernal', 'Piercing', 'Psychic', 'Slashing', 'Somatic', 'Sonic', 'Thermic'];

const tierRange = (row: HomebrewRow) => {
  const min = row.minTier ?? 0;
  const max = row.maxTier ?? 3;
  if (min === 0 && max === 3) return '';
  if (min === max) return `${TIER_NAMES[min]} only`;
  return max === 3 ? `${TIER_NAMES[min]}+` : `${TIER_NAMES[min]}–${TIER_NAMES[max]}`;
};

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, '_')}.btp-homebrew.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Homebrew items and effects on the sheet, with buttons to add, import and edit them. */
export function HomebrewBox({ d, update }: { d: Derived; update: Update }) {
  const [editing, setEditing] = useState<HomebrewEntry | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const save = (e: HomebrewEntry) => update((x) => ({ ...x, homebrew: x.homebrew.some((h) => h.id === e.id) ? x.homebrew.map((h) => (h.id === e.id ? e : h)) : [...x.homebrew, e] }));
  return (
    <div className="homebrew">
      <div className="row wrap">
        <button type="button" onClick={() => setEditing(newHomebrew('item', newId()))}>
          + Item
        </button>
        <button type="button" onClick={() => setEditing(newHomebrew('effect', newId()))}>
          + Effect (boon / curse)
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Import…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const data = JSON.parse(await f.text());
              const list = (Array.isArray(data) ? data : [data]) as HomebrewEntry[];
              if (!list.every((h) => h && typeof h.name === 'string' && Array.isArray(h.rows))) throw new Error('bad');
              update((x) => ({ ...x, homebrew: [...x.homebrew, ...list.map((h) => ({ ...h, id: newId(), attuned: false }))] }));
              setError('');
            } catch {
              setError('That file is not a homebrew export.');
            }
          }}
        />
      </div>
      {error && <p className="warn small">{error}</p>}
      {d.homebrew.length === 0 && <p className="muted small">Items and effects from your PM, like a supernatural weapon or a curse. Their effects apply to your sheet automatically.</p>}
      <div className="homebrew-cards">
        {d.homebrew.map((card) => (
          <HomebrewCard key={card.entry.id} card={card} update={update} onEdit={() => setEditing(structuredClone(card.entry))} />
        ))}
      </div>
      {editing && (
        <HomebrewEditor
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={(e) => {
            save(e);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function HomebrewCard({ card, update, onEdit }: { card: ResolvedHomebrew; update: Update; onEdit: () => void }) {
  const api = useContext(PlayContext);
  const { entry, tier } = card;
  const patch = (p: Partial<HomebrewEntry>) => update((x) => ({ ...x, homebrew: x.homebrew.map((h) => (h.id === entry.id ? { ...h, ...p } : h)) }));
  const stats = ATTRS.filter((a) => card.stats[a]);
  return (
    <section className={`hb-card ${card.active ? '' : 'inactive'}`}>
      <div className="hb-head">
        <div>
          <strong>{entry.name}</strong>
          {entry.subtitle && <div className="muted small">{entry.subtitle}</div>}
        </div>
        <div className="hb-meta small">
          {card.level !== undefined && card.level > 0 && <span className="chip">Level {card.level}</span>}
          {entry.kind === 'effect' && <span className="chip">{entry.ends === 'rest' ? 'Until your next Rest' : entry.ends === 'longRest' ? 'Until your next Long Rest' : 'Effect'}</span>}
        </div>
      </div>
      {entry.tierLight && (
        <div className="hb-tiers small" title={`From your ${entry.tierLight} Alignment`}>
          <span className="muted">{entry.tierLight}:</span>
          {TIER_NAMES.slice(1).map((t, i) => (
            <span key={t} className={`tier ${tier === i + 1 ? 'on' : tier > i + 1 ? 'past' : ''}`}>
              {t}
            </span>
          ))}
        </div>
      )}
      {entry.kind === 'item' && (
        <div className="row wrap small hb-toggles">
          {entry.attunement && (
            <label className="inline">
              <input type="checkbox" checked={!!entry.attuned} onChange={(e) => patch({ attuned: e.target.checked })} /> Attuned
            </label>
          )}
          <label className="inline">
            <input type="checkbox" checked={!!entry.inBackpack} onChange={(e) => patch({ inBackpack: e.target.checked })} /> In backpack
          </label>
        </div>
      )}
      {stats.length > 0 && (
        <div className="hb-stats small">
          {stats.map((a) => (
            <span key={a}>
              {a} <strong>{card.stats[a]!.points}</strong> <span className="muted">({card.stats[a]!.die})</span>
            </span>
          ))}
        </div>
      )}
      {card.pools
        .filter((p) => p.max > 0)
        .map((p) => (
          <div key={p.id} className="hb-pool">
            <span>
              {p.name} <span className="muted small">/ {p.refresh}</span>
            </span>
            <span className="pips">
              {Array.from({ length: p.max }, (_, i) => {
                const on = i < p.max - p.spent;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`pip ${on ? 'on' : ''}`}
                    aria-label={on ? `${p.name} available` : `Restore ${p.name}`}
                    onClick={() => !on && update((x) => ({ ...x, play: { ...x.play, facetUses: { ...x.play.facetUses, [p.key]: Math.max(0, p.spent - 1) } } }))}
                  />
                );
              })}
            </span>
            <button
              type="button"
              className="use-btn"
              disabled={p.spent >= p.max}
              onClick={() =>
                update((x) => {
                  const fresh = derive(x).homebrew.find((h) => h.entry.id === entry.id)!;
                  const r = spendPool(x.play, fresh, p.id);
                  api?.onLog(r.log, x.play);
                  return { ...x, play: r.play };
                })
              }
            >
              Spend {p.name}
            </button>
          </div>
        ))}
      {!card.active && <p className="muted small">Not attuned: its effects don't apply.</p>}
      <ul className="hb-effects small">
        {entry.rows.map((r) => {
          const on = card.applied.includes(r) || (r.onSpend && card.active && tier >= (r.minTier ?? 0) && tier <= (r.maxTier ?? 3));
          const pool = r.onSpend ? entry.pools?.find((p) => p.id === r.onSpend)?.name : undefined;
          return (
            <li key={r.id} className={on ? 'on' : 'off'}>
              {tierRange(r) && <span className="tier-tag">{tierRange(r)}</span>}
              {pool && <span className="tier-tag">When you spend {pool}</span>}
              {r.when === 'onPerson' && <span className="tier-tag">On your person</span>}
              {describeEffect(r.effect, card)}
            </li>
          );
        })}
      </ul>
      {entry.description && (
        <Collapsible title={<span className="muted small">Description</span>}>
          <p className="small pre">{entry.description}</p>
        </Collapsible>
      )}
      <div className="row wrap hb-actions">
        <button type="button" className="link small" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="link small" onClick={() => download(entry.name, { ...entry, attuned: undefined, inBackpack: undefined })}>
          Export
        </button>
        <button
          type="button"
          className="link small danger-text"
          onClick={() => confirm(`Remove ${entry.name}?`) && update((x) => ({ ...x, homebrew: x.homebrew.filter((h) => h.id !== entry.id) }))}
        >
          Remove
        </button>
      </div>
    </section>
  );
}

// ---------- editor ----------

const DEFAULTS: Record<HomebrewEffect['kind'], HomebrewEffect> = {
  movement: { kind: 'movement', amount: 1 },
  movementType: { kind: 'movementType', type: 'Swim', amount: 'movement' },
  attribute: { kind: 'attribute', attr: 'VIG', amount: 1 },
  ac: { kind: 'ac', amount: 1 },
  resistance: { kind: 'resistance', type: 'Thermic', amount: 2 },
  check: { kind: 'check', scope: 'all', attr: 'VIG', amount: 1 },
  initiativeTandem: { kind: 'initiativeTandem', die: 'class' },
  saveTandem: { kind: 'saveTandem', attr: 'VIG', die: 'class' },
  saveEmpowered: { kind: 'saveEmpowered', attr: 'VIG' },
  max: { kind: 'max', stat: 'endurance', amount: 5 },
  sense: { kind: 'sense', name: '' },
  weapon: { kind: 'weapon', note: '' },
  restRule: { kind: 'restRule', rule: 'noRadianceLongRest' },
  note: { kind: 'note', text: '' },
};

const KIND_LABELS: Record<HomebrewEffect['kind'], string> = {
  note: 'Note (text only)',
  movement: 'Movement',
  movementType: 'Swim / Climb Movement',
  attribute: 'Attribute Points',
  ac: 'AC',
  resistance: 'Resistance',
  check: 'Bolstered / Hindered Checks',
  initiativeTandem: 'Initiative in Tandem',
  saveTandem: 'Save Checks in Tandem',
  saveEmpowered: 'Save Checks Empowered',
  max: 'Endurance / Vitality / Radiance maximum',
  sense: 'Sense',
  weapon: 'Weapon Attack Checks',
  restRule: 'Rest rule (debuff)',
};

const TIER_OPTIONS: { label: string; min: number; max: number }[] = [
  { label: 'Always', min: 0, max: 3 },
  { label: 'Weak only', min: 1, max: 1 },
  { label: 'Weak and up', min: 1, max: 3 },
  { label: 'Firm only', min: 2, max: 2 },
  { label: 'Firm and up', min: 2, max: 3 },
  { label: 'Strong', min: 3, max: 3 },
];

/** Inputs for a value that may differ by tier: one input, or Weak / Firm / Strong. */
function TierValue({ value, tiered, onChange, zeroAtNone, placeholder }: { value: PerTier | undefined; tiered: boolean; onChange: (v: PerTier | undefined) => void; zeroAtNone?: boolean; placeholder?: string }) {
  const num = (s: string) => (s === '' ? undefined : Number(s));
  if (!tiered) {
    const v = Array.isArray(value) ? value[1] : value;
    return <input className="num" type="number" value={v ?? ''} placeholder={placeholder} onChange={(e) => onChange(num(e.target.value))} />;
  }
  const arr: [number, number, number, number] = Array.isArray(value) ? value : [value ?? 0, value ?? 0, value ?? 0, value ?? 0];
  const set = (i: number, s: string) => {
    const next = [...arr] as [number, number, number, number];
    next[i] = num(s) ?? 0;
    // Below Weak: nothing for pools and levels; stats keep their Weak value.
    next[0] = zeroAtNone ? 0 : next[1];
    onChange(next);
  };
  return (
    <span className="tier-values">
      {[1, 2, 3].map((i) => (
        <label key={i} className="inline small">
          {TIER_NAMES[i]}
          <input className="num" type="number" value={arr[i]} onChange={(e) => set(i, e.target.value)} />
        </label>
      ))}
    </span>
  );
}

function HomebrewEditor({ entry, onClose, onSave }: { entry: HomebrewEntry; onClose: () => void; onSave: (e: HomebrewEntry) => void }) {
  const [e, setE] = useState<HomebrewEntry>(entry);
  const set = (p: Partial<HomebrewEntry>) => setE((x) => ({ ...x, ...p }));
  const tiered = !!e.tierLight;
  const isItem = e.kind === 'item';
  const statAttrs = ATTRS.filter((a) => e.stats?.[a] !== undefined);
  const dieOptions: { value: DieChoice; label: string }[] = [{ value: 'class', label: 'Class Die' }, ...statAttrs.map((a) => ({ value: `item:${a}` as DieChoice, label: `This item's ${a} Die` }))];
  const setRow = (id: string, p: Partial<HomebrewRow>) => set({ rows: e.rows.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  return (
    <Modal title={entry.name ? `Edit ${entry.name}` : 'New homebrew'} onClose={onClose} wide>
      <form
        className="hb-editor"
        onSubmit={(ev) => {
          ev.preventDefault();
          onSave({ ...e, name: e.name.trim() || 'Unnamed' });
        }}
      >
        <div className="row wrap">
          <label className="inline">
            <input type="radio" checked={isItem} onChange={() => set({ kind: 'item' })} /> Item
          </label>
          <label className="inline">
            <input type="radio" checked={!isItem} onChange={() => set({ kind: 'effect', ends: e.ends ?? 'manual' })} /> Effect (boon / curse)
          </label>
        </div>
        <label>
          Name
          <input value={e.name} onChange={(x) => set({ name: x.target.value })} autoFocus />
        </label>
        <label>
          Subtitle
          <input value={e.subtitle ?? ''} onChange={(x) => set({ subtitle: x.target.value })} placeholder={isItem ? 'e.g. Supernatural Platinum Katana' : 'e.g. Curse'} />
        </label>
        <label>
          Description
          <textarea rows={3} value={e.description ?? ''} onChange={(x) => set({ description: x.target.value })} placeholder="Flavour and full rules text, shown on the card" />
        </label>
        {isItem ? (
          <div className="row wrap">
            <label>
              Weapon
              <select value={e.baseWeapon ?? ''} onChange={(x) => set({ baseWeapon: x.target.value || undefined })}>
                <option value="">Not a weapon</option>
                {weapons.map((w) => (
                  <option key={w.name}>{w.name}</option>
                ))}
              </select>
            </label>
            <label>
              Bulk
              <select value={e.bulk ?? ''} onChange={(x) => set({ bulk: x.target.value ? Number(x.target.value) : undefined })}>
                <option value="">Bulkless</option>
                {[1, 2, 3, 4, 5].map((b) => (
                  <option key={b} value={b}>
                    Bulk {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline">
              <input type="checkbox" checked={!!e.attunement} onChange={(x) => set({ attunement: x.target.checked })} /> Requires attunement
            </label>
          </div>
        ) : (
          <label>
            Ends
            <select value={e.ends ?? 'manual'} onChange={(x) => set({ ends: x.target.value as HomebrewEntry['ends'] })}>
              <option value="manual">When removed</option>
              <option value="rest">At your next Rest</option>
              <option value="longRest">At your next Long Rest</option>
            </select>
          </label>
        )}

        <h4>Alignment tiers</h4>
        <div className="row wrap">
          <label>
            Scales with
            <select value={e.tierLight ?? ''} onChange={(x) => set({ tierLight: (x.target.value || undefined) as Light | undefined })}>
              <option value="">Nothing (always the same)</option>
              {LIGHTS.map((l) => (
                <option key={l} value={l}>
                  {l} Alignment
                </option>
              ))}
            </select>
          </label>
          <label>
            Level
            <TierValue value={e.level} tiered={tiered} zeroAtNone onChange={(v) => set({ level: v })} placeholder="—" />
          </label>
        </div>

        {isItem && (
          <>
            <h4>Sentient item stats</h4>
            <div className="row wrap">
              {ATTRS.map((a) => (
                <label key={a} className="hb-stat">
                  {ATTR_NAMES[a]}
                  <TierValue value={e.stats?.[a]} tiered={tiered} placeholder="—" onChange={(v) => set({ stats: { ...e.stats, [a]: v } })} />
                </label>
              ))}
            </div>

            <h4>Pools (like Light it holds)</h4>
            {(e.pools ?? []).map((p) => (
              <div key={p.id} className="row wrap hb-row">
                <input value={p.name} onChange={(x) => set({ pools: e.pools!.map((q) => (q.id === p.id ? { ...q, name: x.target.value } : q)) })} aria-label="Pool name" />
                <TierValue value={p.max} tiered={tiered} zeroAtNone onChange={(v) => set({ pools: e.pools!.map((q) => (q.id === p.id ? { ...q, max: v ?? 0 } : q)) })} />
                <select value={p.refresh} onChange={(x) => set({ pools: e.pools!.map((q) => (q.id === p.id ? { ...q, refresh: x.target.value as 'Rest' | 'Long Rest' } : q)) })}>
                  <option value="Long Rest">Refills on a Long Rest</option>
                  <option value="Rest">Refills on any Rest</option>
                </select>
                <button type="button" className="icon-btn" aria-label="Remove pool" onClick={() => set({ pools: e.pools!.filter((q) => q.id !== p.id) })}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" onClick={() => set({ pools: [...(e.pools ?? []), { id: newId(), name: 'Light', max: tiered ? [0, 1, 2, 3] : 1, refresh: 'Long Rest' }] })}>
              + Pool
            </button>
          </>
        )}

        <h4>Effects</h4>
        {e.rows.map((r) => {
          const range = TIER_OPTIONS.findIndex((t) => t.min === (r.minTier ?? 0) && t.max === (r.maxTier ?? 3));
          return (
            <div key={r.id} className="hb-row-edit">
              <div className="row wrap">
                {tiered && (
                  <select value={Math.max(0, range)} onChange={(x) => setRow(r.id, { minTier: TIER_OPTIONS[Number(x.target.value)].min, maxTier: TIER_OPTIONS[Number(x.target.value)].max })} aria-label="Tiers">
                    {TIER_OPTIONS.map((t, i) => (
                      <option key={t.label} value={i}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                )}
                {isItem && (
                  <select value={r.when ?? 'always'} onChange={(x) => setRow(r.id, { when: x.target.value as HomebrewRow['when'] })} aria-label="Requirement">
                    <option value="always">{e.attunement ? 'While attuned' : 'Always'}</option>
                    <option value="onPerson">While on your person</option>
                  </select>
                )}
                {(e.pools ?? []).length > 0 && (
                  <select value={r.onSpend ?? ''} onChange={(x) => setRow(r.id, { onSpend: x.target.value || undefined })} aria-label="Trigger">
                    <option value="">Passive</option>
                    {e.pools!.map((p) => (
                      <option key={p.id} value={p.id}>
                        When you spend {p.name} (reminder)
                      </option>
                    ))}
                  </select>
                )}
                <select value={r.effect.kind} onChange={(x) => setRow(r.id, { effect: DEFAULTS[x.target.value as HomebrewEffect['kind']] })} aria-label="Effect type">
                  {(Object.keys(KIND_LABELS) as HomebrewEffect['kind'][]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                <button type="button" className="icon-btn" aria-label="Remove effect" onClick={() => set({ rows: e.rows.filter((x) => x.id !== r.id) })}>
                  ✕
                </button>
              </div>
              <EffectFields effect={r.effect} dieOptions={dieOptions} onChange={(effect) => setRow(r.id, { effect })} />
              <p className="muted small">{describeEffect(r.effect, { entry: e, stats: Object.fromEntries(statAttrs.map((a) => [a, { points: 0, die: 'its die' }])) })}</p>
            </div>
          );
        })}
        <button type="button" onClick={() => set({ rows: [...e.rows, { id: newId(), minTier: tiered ? 1 : 0, effect: DEFAULTS.note }] })}>
          + Effect
        </button>

        <div className="row hb-save">
          <button type="submit" className="primary">
            Save
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AttrSelect({ value, onChange }: { value: Attr | undefined; onChange: (a: Attr) => void }) {
  return (
    <select value={value ?? 'VIG'} onChange={(e) => onChange(e.target.value as Attr)} aria-label="Attribute">
      {ATTRS.map((a) => (
        <option key={a}>{a}</option>
      ))}
    </select>
  );
}

function Num({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return <input className="num" type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />;
}

/** The inputs for one effect type. */
function EffectFields({ effect: f, dieOptions, onChange }: { effect: HomebrewEffect; dieOptions: { value: DieChoice; label: string }[]; onChange: (e: HomebrewEffect) => void }) {
  const DieSelect = ({ value, onPick, allowNone }: { value?: DieChoice; onPick: (d?: DieChoice) => void; allowNone?: boolean }) => (
    <select value={value ?? ''} onChange={(e) => onPick((e.target.value || undefined) as DieChoice | undefined)} aria-label="Die">
      {allowNone && <option value="">No Tandem</option>}
      {dieOptions.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  switch (f.kind) {
    case 'note':
      return <textarea rows={2} value={f.text} onChange={(e) => onChange({ ...f, text: e.target.value })} placeholder="What it does (shown as a reminder)" aria-label="Note" />;
    case 'movement':
    case 'ac':
      return <Num value={f.amount} label="Amount" onChange={(amount) => onChange({ ...f, amount })} />;
    case 'movementType':
      return (
        <div className="row wrap">
          <select value={f.type} onChange={(e) => onChange({ ...f, type: e.target.value as 'Swim' | 'Climb' })}>
            <option>Swim</option>
            <option>Climb</option>
          </select>
          <select value={f.amount} onChange={(e) => onChange({ ...f, amount: e.target.value as 'movement' | 'halfMovement' })}>
            <option value="movement">equal to your Movement</option>
            <option value="halfMovement">equal to half your Movement</option>
          </select>
        </div>
      );
    case 'attribute':
      return (
        <div className="row wrap">
          <AttrSelect value={f.attr} onChange={(attr) => onChange({ ...f, attr })} />
          <Num value={f.amount} label="Points" onChange={(amount) => onChange({ ...f, amount })} />
        </div>
      );
    case 'resistance':
      return (
        <div className="row wrap">
          <input list="hb-damage" value={f.type} onChange={(e) => onChange({ ...f, type: e.target.value })} aria-label="Damage type" />
          <datalist id="hb-damage">
            {DAMAGE_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <Num value={f.amount} label="Resistance" onChange={(amount) => onChange({ ...f, amount })} />
        </div>
      );
    case 'check':
      return (
        <div className="row wrap">
          <select value={f.scope} onChange={(e) => onChange({ ...f, scope: e.target.value as typeof f.scope })} aria-label="Which Checks">
            <option value="all">All Checks of an Attribute</option>
            <option value="save">Save Checks of an Attribute</option>
            <option value="attribute">Attribute (skill) Checks of an Attribute</option>
            <option value="attack">Attack Checks</option>
            <option value="custom">Other (describe)</option>
          </select>
          {f.scope === 'custom' ? (
            <input value={f.text ?? ''} onChange={(e) => onChange({ ...f, text: e.target.value })} placeholder="e.g. Checks to resist fear" />
          ) : (
            f.scope !== 'attack' && <AttrSelect value={f.attr} onChange={(attr) => onChange({ ...f, attr })} />
          )}
          <Num value={f.amount} label="Bolstered (+) or Hindered (−)" onChange={(amount) => onChange({ ...f, amount })} />
          <span className="muted small">+ Bolstered, − Hindered</span>
        </div>
      );
    case 'initiativeTandem':
      return <DieSelect value={f.die} onPick={(die) => die && onChange({ ...f, die })} />;
    case 'saveTandem':
      return (
        <div className="row wrap">
          <AttrSelect value={f.attr} onChange={(attr) => onChange({ ...f, attr })} />
          <DieSelect value={f.die} onPick={(die) => die && onChange({ ...f, die })} />
        </div>
      );
    case 'saveEmpowered':
      return <AttrSelect value={f.attr} onChange={(attr) => onChange({ ...f, attr })} />;
    case 'max':
      return (
        <div className="row wrap">
          <select value={f.stat} onChange={(e) => onChange({ ...f, stat: e.target.value as typeof f.stat })}>
            <option value="endurance">Endurance</option>
            <option value="vitality">Vitality</option>
            <option value="radiance">Radiance</option>
          </select>
          <Num value={f.amount} label="Amount" onChange={(amount) => onChange({ ...f, amount })} />
        </div>
      );
    case 'sense':
      return <input value={f.name} onChange={(e) => onChange({ ...f, name: e.target.value })} placeholder="e.g. Darkvision 10" aria-label="Sense" />;
    case 'weapon':
      return (
        <div className="row wrap">
          <select value={f.property ?? ''} onChange={(e) => onChange({ ...f, property: e.target.value || undefined })} aria-label="Property">
            <option value="">Any Attack Check</option>
            {weaponProperties.map((p) => (
              <option key={p.id} value={p.title.split(' (')[0]}>
                With {p.title.split(' (')[0]}
              </option>
            ))}
          </select>
          <DieSelect value={f.die} allowNone onPick={(die) => onChange({ ...f, die })} />
          <Num value={f.bolster ?? 0} label="Bolstered" onChange={(bolster) => onChange({ ...f, bolster })} />
          <input className="grow" value={f.note ?? ''} onChange={(e) => onChange({ ...f, note: e.target.value })} placeholder="Note, e.g. Critical Success on 19–20" />
        </div>
      );
    case 'restRule':
      return (
        <select value={f.rule} onChange={(e) => onChange({ ...f, rule: e.target.value as RestRule })}>
          {(Object.keys(RULE_TEXT) as RestRule[]).map((r) => (
            <option key={r} value={r}>
              {RULE_TEXT[r]}
            </option>
          ))}
        </select>
      );
  }
}
