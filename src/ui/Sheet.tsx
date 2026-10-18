import { useState } from 'react';
import { basicActions, conditions as conditionDefs, getNode, getCastable, type RuleNode } from '../content';
import { ancestryById } from '../data/ancestries';
import { ATTRS, ATTR_NAMES, RANK_DIE } from '../data/types';
import type { Character, PlayState } from '../engine/character';
import { derive, type Derived } from '../engine/derive';
import { clampPlay, facetUseMax, heal, longRest, shortRest, takeDamage } from '../engine/play';
import { AP_MAX, CONDITION_RULES, addCondition, describeCheck, endTurn, startTurn } from '../engine/conditions';
import { ClassTableView, Equipment, WeaponTable } from './Builder';
import { Collapsible, FacetText, go, Icon, RuleLink, Stepper, TokenText } from './common';
import { SpellListEditor } from './pickers';
import { CastRow } from './Cast';
import { BulkPyramid } from './Inventory';
import { alignmentGradient } from './lightColors';
import { PlayContext, UseButton } from './Activate';
import { actionRequest, activationsFor, ACTIVATIONS } from '../engine/activations';
import { parseCost } from '../engine/costs';
import type { ActiveEffect } from '../engine/character';

type Update = (fn: (c: Character) => Character) => void;

/** Heading gradient from the character's alignments (see lightColors.ts). */
function headingStyle(d: Derived): React.CSSProperties | undefined {
  const g = alignmentGradient(d.alignmentRanked);
  return g ? ({ '--heading-gradient': g } as React.CSSProperties) : undefined;
}

const TABS = ['Sheet', 'Features', 'Spells & Maneuvers', 'Equipment', 'Notes'] as const;
type Tab = (typeof TABS)[number];

export function Sheet({ c, update }: { c: Character; update: Update }) {
  const [tab, setTab] = useState<Tab>('Sheet');
  const [log, setLog] = useState<{ lines: string[]; undo?: PlayState } | null>(null);
  const d = derive(c);
  const setPlay = (fn: (p: PlayState) => PlayState) => update((x) => ({ ...x, play: clampPlay(fn(x.play), derive(x)) }));
  const anc = ancestryById.get(c.ancestry);
  const sub = anc?.subAncestries?.find((s) => s.id === c.subAncestry);
  const onLog = (lines: string[], undo?: PlayState) => setLog({ lines, undo });
  return (
    <PlayContext.Provider value={{ c, d, update, onLog }}>
      <div className="sheet" style={headingStyle(d)}>
        <header className="sheet-header">
          <div>
            <h1>{c.name || 'Unnamed character'}</h1>
            <p className="muted">
              Level {d.level} · {anc ? `${anc.name}${sub ? ` (${sub.name})` : ''}` : 'No ancestry'} · {d.cls ? `${d.cls.name}${d.subclassName ? ` — ${d.subclassName}` : ''}` : 'No class'}
              {c.player && ` · Player: ${c.player}`}
            </p>
          </div>
          <div className="sheet-actions">
            <button type="button" onClick={() => go('c', c.id, 'build', 'basics')}>
              ✎ Edit
            </button>
            {d.level < d.maxLevel && d.cls && (
              <button type="button" className="primary" onClick={() => go('c', c.id, 'levelup')}>
                ⬆ Level Up
              </button>
            )}
          </div>
        </header>
        <TurnBar c={c} d={d} update={update} setPlay={setPlay} onLog={onLog} />
        {d.issues.length > 0 && (
          <details className="issues banner">
            <summary>{d.issues.length} unfinished item(s) — open the builder to complete them</summary>
            <ul>
              {d.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </details>
        )}
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'Sheet' && <MainSheet c={c} d={d} update={update} setPlay={setPlay} onRest={(lines) => setLog({ lines })} />}
        {tab === 'Features' && <Features c={c} d={d} setPlay={setPlay} />}
        {tab === 'Spells & Maneuvers' && <SpellsTab c={c} d={d} setPlay={setPlay} />}
        {tab === 'Equipment' && <Equipment c={c} d={d} update={update} />}
        {tab === 'Notes' && <Notes c={c} update={update} />}
        {log && (
          <div className="toast" role="status">
            <ul>
              {log.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
            {log.undo && (
              <button
                type="button"
                onClick={() => {
                  const prev = log.undo!;
                  update((x) => ({ ...x, play: prev }));
                  setLog(null);
                }}
              >
                Undo
              </button>
            )}
            <button type="button" className="icon-btn" onClick={() => setLog(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}
      </div>
    </PlayContext.Provider>
  );
}

/** AP tracker and Start/End Turn, kept at the top of the sheet. */
function TurnBar({ c, d, update, setPlay, onLog }: { c: Character; d: Derived; update: Update; setPlay: (fn: (p: PlayState) => PlayState) => void; onLog: (lines: string[], undo?: PlayState) => void }) {
  const p = c.play;
  const ap = p.ap ?? AP_MAX;
  const myTurn = !!p.turn?.active;
  const blocked = d.conditionFx.active.find((x) => x.name === 'Paralyzed' || x.name === 'Unconscious' || x.name === 'Stunned');
  return (
    <section className={`turn-bar box ${myTurn ? 'my-turn' : ''}`} aria-label="Turn">
      <div className="turn-ap">
        <span className="turn-label">
          <Icon name="AP" /> AP
        </span>
        <Pips total={AP_MAX} used={AP_MAX - Math.min(ap, AP_MAX)} onChange={(u) => setPlay((x) => ({ ...x, ap: AP_MAX - u }))} label="AP" />
        <span className="turn-count">
          {ap}/{AP_MAX}
        </span>
        <span className="turn-temp">
          <span className="muted small">Temp</span>
          <Stepper label="Temporary AP" value={p.tempAp ?? 0} min={0} onChange={(v) => setPlay((x) => ({ ...x, tempAp: v }))} />
        </span>
      </div>
      <div className="turn-buttons">
        <button
          type="button"
          className={myTurn ? '' : 'primary'}
          disabled={myTurn}
          onClick={() =>
            update((x) => {
              const dx = derive(x);
              const r = startTurn(x.play, dx.level, dx.resistances);
              let play = r.play;
              for (const dmg of r.damage) play = takeDamage(play, dmg.amount, dx);
              onLog(r.log, x.play);
              return { ...x, play: clampPlay(play, dx) };
            })
          }
        >
          ▶ Start Turn
        </button>
        <button
          type="button"
          className={myTurn ? 'primary' : ''}
          disabled={!myTurn}
          onClick={() =>
            update((x) => {
              const r = endTurn(x.play);
              onLog(r.log, x.play);
              return { ...x, play: clampPlay(r.play, derive(x)) };
            })
          }
        >
          ■ End Turn
        </button>
        <button type="button" title="Rolling Initiative refills your AP" onClick={() => setPlay((x) => ({ ...x, ap: AP_MAX, tempAp: 0, turn: { active: false } }))}>
          Initiative {d.initiative}
        </button>
      </div>
      {blocked && <p className="turn-warn small">{blocked.name}: {CONDITION_RULES[blocked.name].ap?.(blocked.level)}</p>}
    </section>
  );
}

interface MainProps {
  c: Character;
  d: Derived;
  update: Update;
  setPlay: (fn: (p: PlayState) => PlayState) => void;
  onRest: (log: string[]) => void;
}

function Box({ title, children, className = '' }: { title: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`box ${className}`}>
      <h3 className="box-title">{title}</h3>
      {children}
    </section>
  );
}

function MainSheet({ c, d, update, setPlay, onRest }: MainProps) {
  const p = c.play;
  const [amount, setAmount] = useState('');
  const [useCharge, setUseCharge] = useState(true);
  const n = Number(amount) || 0;
  const al = c.alignment;
  return (
    <div className="sheet-grid">
      {/* Top row: Bonus / Die / Saves / Endurance / AC / Movement / Initiative */}
      <div className="top-row">
        <Box title={d.cls ? `${d.cls.name} Bonus` : 'Bonus'} className="stat">
          <div className="big">+{d.classBonus}</div>
          <div className="sub">
            {d.classDieName}: <strong>{d.classDie || '—'}</strong>
          </div>
        </Box>
        <Box title="Save Checks" className="saves">
          <table>
            <tbody>
              {d.saves.map((s) => (
                <tr key={s.attr}>
                  <th>
                    <Icon name={s.attr} /> {s.attr}
                  </th>
                  <td>{s.label}</td>
                  <td className="muted small">{s.notes.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
        <Box title="Endurance" className="endurance">
          <div className="end-main">
            <span className="big">{p.endurance}</span>
            <span className="muted"> / {d.enduranceMax}</span>
          </div>
          <div className="row small-gap">
            <span>Temp</span>
            <Stepper label="Temporary Endurance" value={p.tempEndurance} min={0} onChange={(v) => setPlay((x) => ({ ...x, tempEndurance: v }))} />
          </div>
          <div className="row small-gap">
            <input className="num" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" aria-label="Amount" />
            <button type="button" className="danger" disabled={!n} onClick={() => (setPlay((x) => takeDamage(x, n, d)), setAmount(''))}>
              Damage
            </button>
            <button type="button" disabled={!n} onClick={() => (setPlay((x) => heal(x, n, d)), setAmount(''))}>
              Heal
            </button>
          </div>
        </Box>
        <Box title="AC" className="stat">
          <div className="big" title={d.ac.breakdown.join('\n')}>
            {d.ac.value}
          </div>
          <div className="sub">{c.equipment.armor ? `${c.equipment.armor.quality} ${c.equipment.armor.type}` : 'Unarmored'}</div>
        </Box>
        <Box title="Movement" className="stat">
          <div className="big" title={d.movementBreakdown.join('\n')}>
            {d.movement}
          </div>
          <div className="sub">{d.movementBreakdown.join(' ')}</div>
        </Box>
        <Box title="Initiative" className="stat">
          <div className="big">{d.initiative}</div>
          <div className="sub">{d.initiativeNotes.join(', ')}</div>
        </Box>
      </div>

      <div className="col">
        <Box title="Attributes">
          <div className="attrs">
            {ATTRS.map((a) => (
              <div key={a} className="attr">
                <div className="attr-icon">
                  <Icon name={a} />
                </div>
                <div>
                  <div className="attr-name">{ATTR_NAMES[a]}</div>
                  <div className="muted small">
                    {d.attrs[a].points} points{d.attrs[a].sources.length > 1 && ` (${d.attrs[a].sources.join(' ')})`}
                    {d.attrs[a].dieNote && ` · ${d.attrs[a].dieNote}`}
                  </div>
                </div>
                <div className="attr-die">{d.attrs[a].label}</div>
              </div>
            ))}
          </div>
        </Box>
        <Box title="Vitality & Radiance">
          <div className="row between">
            <span>Vitality</span>
            <Stepper label="Vitality" value={p.vitality} min={0} max={d.vitalityMax} onChange={(v) => setPlay((x) => ({ ...x, vitality: v, dying: v > x.vitality ? 0 : x.dying }))} />
            <span className="muted">/ {d.vitalityMax}</span>
          </div>
          <div className="row between">
            <span>Rest Charges</span>
            <Pips total={d.restCharges} used={p.restChargesSpent} onChange={(u) => setPlay((x) => ({ ...x, restChargesSpent: u }))} label="Rest Charge" />
          </div>
          <div className="row between">
            <span>Radiance</span>
            <Pips total={d.radianceMax} used={p.radianceSpent} onChange={(u) => setPlay((x) => ({ ...x, radianceSpent: u }))} label="Radiance" />
          </div>
          <div className="row between">
            <span>
              <RuleLink id="beyond-the-prism/endurance-and-vitality/dying">Dying</RuleLink>
            </span>
            <Stepper label="Dying" value={p.dying} min={0} onChange={(v) => setPlay((x) => ({ ...x, dying: v }))} />
          </div>
          {d.slashingVulnerability && <p className="small muted">Unarmored Slashing Vulnerability: {d.slashingVulnerability}</p>}
        </Box>
        <Box title="Rest">
          <label className="inline small">
            <input type="checkbox" checked={useCharge} onChange={(e) => setUseCharge(e.target.checked)} /> Spend a Rest Charge on Short Rest
          </label>
          <div className="row">
            <button type="button" onClick={() => update((x) => { const r = shortRest(x, derive(x), { spendRestCharge: useCharge }); onRest(r.log); return { ...x, play: r.play }; })}>
              Short Rest
            </button>
            <button type="button" onClick={() => update((x) => { const r = longRest(x, derive(x)); onRest(r.log); return { ...x, play: r.play }; })}>
              Long Rest
            </button>
          </div>
          <p className="muted small">
            {c.settings.restRules === 'heroic' ? 'Heroic' : 'Gritty'} rules · Short Rests since Long Rest: {p.shortRests}/2 · <RuleLink id="beyond-the-prism/resting">Resting rules</RuleLink>
          </p>
        </Box>
        <Box title="Movement & Senses">
          <ul className="plain">
            <li>Movement {d.movement}</li>
            {d.movementTypes.map((m) => (
              <li key={m.type}>
                {m.type} Movement {m.value}
              </li>
            ))}
            <li>
              <Icon name="PER" /> Perception Radius {d.radius}
            </li>
            <li>
              Max Long Jump {d.jump.long} · Max High Jump {d.jump.high}
            </li>
            {d.senses.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Box>
      </div>

      <div className="col">
        <Box title="Professions">
          <SkillList slots={d.skillSlots.filter((s) => s.kind === 'profession')} />
        </Box>
        <Box title="Hobbies">
          <SkillList slots={d.skillSlots.filter((s) => s.kind === 'hobby')} />
        </Box>
        <Box title="Weapons">
          <WeaponTable c={c} d={d} />
        </Box>
        <Box title="Experiences">
          <Experiences c={c} update={update} />
        </Box>
        <Box title="Inventory">
          <BulkPyramid c={c} d={d} />
        </Box>
      </div>

      <div className="col">
        <Box title="I respond to new…">
          <ul className="plain">
            <li>Situations with <strong>{al.situations || '—'}</strong></li>
            <li>Problems with <strong>{al.problems || '—'}</strong></li>
            <li>People with <strong>{al.people || '—'}</strong></li>
          </ul>
        </Box>
        <Box title="Alignments">
          {d.alignment.length ? (
            <ul className="plain">
              {d.alignment.map((a) => (
                <li key={a.light} title={a.sources.join(', ')}>
                  <span className={`dot light-${a.light.toLowerCase()}`} /> {a.light} — {['None', 'Weak', 'Firm', 'Strong'][a.level]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None</p>
          )}
        </Box>
        <Box title="Resistances & Vulnerabilities">
          {d.resistances.length ? (
            <ul className="plain">
              {d.resistances.map((r) => (
                <li key={r.type}>
                  {r.type} Resistance {r.value}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None</p>
          )}
          {d.slashingVulnerability && <p className="small">Slashing Vulnerability {d.slashingVulnerability} (unarmored)</p>}
        </Box>
        <Box title="Conditions">
          <Conditions p={p} d={d} setPlay={setPlay} />
        </Box>
        <Box title="Active effects">
          <ActiveEffects effects={p.effects ?? []} setPlay={setPlay} />
        </Box>
        <Box title="Check modifiers">
          <CheckModifiers d={d} />
        </Box>
        <Box title="Training">
          <p className="small">
            <strong>Armor:</strong> {d.armorTraining}
          </p>
          <p className="small">
            <strong>Weapons:</strong> {d.weaponTraining}
          </p>
          <p className="small">
            <strong>Action categories:</strong> {d.actionCategories.join(', ')}
          </p>
          {d.armorNotes.map((x) => (
            <p key={x} className="note small">
              {x}
            </p>
          ))}
        </Box>
      </div>

      <div className="wide-row">
        <Box title="Actions">
          <ActionsList c={c} d={d} />
        </Box>
      </div>
    </div>
  );
}

function Pips({ total, used, onChange, label }: { total: number; used: number; onChange: (used: number) => void; label: string }) {
  return (
    <span className="pips" aria-label={`${label}: ${total - used} of ${total} available`}>
      {Array.from({ length: total }, (_, i) => {
        const available = i < total - used;
        return (
          <button
            key={i}
            type="button"
            className={`pip ${available ? 'on' : ''}`}
            title={available ? `Spend ${label}` : `Restore ${label}`}
            onClick={() => onChange(available ? used + 1 : used - 1)}
            aria-label={available ? `Spend ${label}` : `Restore ${label}`}
          />
        );
      })}
    </span>
  );
}

function SkillList({ slots }: { slots: Derived['skillSlots'] }) {
  if (!slots.length) return <p className="muted">None</p>;
  return (
    <table className="skills">
      <thead>
        <tr>
          <th>Name</th>
          <th>Mod Die</th>
          <th>Rank</th>
        </tr>
      </thead>
      <tbody>
        {slots.map((s) => (
          <tr key={s.id}>
            <td>{s.name || <span className="muted">— unnamed —</span>}</td>
            <td>{RANK_DIE[s.rank]}</td>
            <td>{s.rank}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Conditions({ p, d, setPlay }: { p: PlayState; d: Derived; setPlay: (fn: (p: PlayState) => PlayState) => void }) {
  const [pick, setPick] = useState('');
  // Conditions given by other Conditions (Burning → Numbed) and Dying from the Vitality box.
  const implied = d.conditionFx.active.filter((x) => !x.own);
  return (
    <div>
      {p.conditions.length === 0 && implied.length === 0 && <p className="muted">None</p>}
      <ul className="plain">
        {p.conditions.map((cd, i) => {
          const def = conditionDefs.find((x) => x.name === cd.name);
          return (
            <li key={i} className="row between">
              {def ? <RuleLink id={def.id}>{cd.name}</RuleLink> : cd.name}
              {def?.leveled && (
                <Stepper label={`${cd.name} level`} value={cd.level ?? 1} min={1} onChange={(v) => setPlay((x) => ({ ...x, conditions: x.conditions.map((y, j) => (j === i ? { ...y, level: v } : y)) }))} />
              )}
              <button type="button" className="icon-btn" onClick={() => setPlay((x) => ({ ...x, conditions: x.conditions.filter((_, j) => j !== i) }))} aria-label={`Remove ${cd.name}`}>
                ✕
              </button>
            </li>
          );
        })}
        {implied.map((cd) => {
          const def = conditionDefs.find((x) => x.name === cd.name);
          return (
            <li key={cd.name} className="row between implied">
              <span>
                {def ? <RuleLink id={def.id}>{cd.name}</RuleLink> : cd.name}
                {def?.leveled && ` ${cd.level}`}
              </span>
              <span className="muted small">{cd.name === 'Dying' && !cd.from.length ? 'from Vitality' : `from ${cd.from.join(', ')}`}</span>
            </li>
          );
        })}
      </ul>
      <div className="row">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Condition">
          <option value="">Add condition…</option>
          {conditionDefs
            .filter((x) => x.name !== 'Dying')
            .map((x) => (
              <option key={x.id}>{x.name}</option>
            ))}
        </select>
        <button
          type="button"
          disabled={!pick}
          onClick={() => {
            const def = conditionDefs.find((x) => x.name === pick);
            setPlay((x) => addCondition(x, pick, def?.leveled ? 1 : undefined));
            setPick('');
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/** Check penalties from Conditions, plus Bolstered/Tandem effects from facets. */
function CheckModifiers({ d }: { d: Derived }) {
  const fx = d.conditionFx;
  const empty = !fx.checks.length && !fx.against.length && !fx.otherChecks.length && !fx.ap.length && !fx.notes.length && !d.bolsters.length && !d.tandems.length;
  if (empty) return <p className="muted">None</p>;
  return (
    <dl className="defs mods small">
      {fx.checks.map((r) => (
        <div key={r.label}>
          <dt>
            <Icon name={r.attr} /> {r.label}
          </dt>
          <dd>{describeCheck(r).join('; ')}</dd>
        </div>
      ))}
      {fx.otherChecks.map((t) => (
        <div key={t}>
          <dd>{t}</dd>
        </div>
      ))}
      {fx.against.length > 0 && (
        <div>
          <dt>Attacks against you</dt>
          <dd>{fx.against.join('; ')}</dd>
        </div>
      )}
      {fx.acChange.value !== 0 && (
        <div>
          <dt>AC</dt>
          <dd>
            {fx.acChange.value > 0 ? '+' : ''}
            {fx.acChange.value} ({fx.acChange.from.join(', ')})
          </dd>
        </div>
      )}
      {(fx.movementChange.zero || fx.movementChange.value !== 0) && (
        <div>
          <dt>Movement</dt>
          <dd>
            {fx.movementChange.zero ? 'All Movements are 0' : `${fx.movementChange.value > 0 ? '+' : ''}${fx.movementChange.value}`} ({fx.movementChange.from.join(', ')})
          </dd>
        </div>
      )}
      {fx.ap.map((t) => (
        <div key={t}>
          <dt>
            <Icon name="AP" /> AP
          </dt>
          <dd>{t}</dd>
        </div>
      ))}
      {fx.notes.map((t) => (
        <div key={t}>
          <dd>{t}</dd>
        </div>
      ))}
      {[...d.bolsters, ...d.tandems].map((b) => (
        <div key={b}>
          <dd>{b}</dd>
        </div>
      ))}
    </dl>
  );
}

function Experiences({ c, update }: { c: Character; update: Update }) {
  const [text, setText] = useState('');
  return (
    <div>
      <ul className="plain">
        {c.experiences.map((e, i) => (
          <li key={i} className="row between">
            {e}
            <button type="button" className="icon-btn" onClick={() => update((x) => ({ ...x, experiences: x.experiences.filter((_, j) => j !== i) }))} aria-label="Remove">
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Monster Slayer" aria-label="Experience" />
        <button
          type="button"
          disabled={!text.trim()}
          onClick={() => {
            update((x) => ({ ...x, experiences: [...x.experiences, text.trim()] }));
            setText('');
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/** Actions defined inside the character's facets (e.g. Refract, Reignite). */
function facetActions(d: Derived): RuleNode[] {
  const out: RuleNode[] = [];
  const walk = (n: RuleNode) => {
    if (n.fields?.Categories && n.fields?.Cost) out.push(n);
    n.children?.forEach(walk);
  };
  for (const f of d.facets) {
    const n = f.contentId && !f.item ? getNode(f.contentId) : undefined;
    if (n) walk(n);
  }
  return out;
}

function ActionsList({ d }: { c: Character; d: Derived }) {
  const special = facetActions(d);
  const available = basicActions.filter((a) => d.actionCategories.includes(a.category));
  return (
    <div>
      {special.length > 0 && (
        <>
          <h4>From your facets</h4>
          {special.map((n) => (
            <Collapsible
              key={n.id}
              title={
                <span>
                  <strong>{n.title}</strong> <span className="muted small"><TokenText text={n.fields?.Cost ?? ''} /></span>
                </span>
              }
              extra={<ActionUse d={d} id={n.id} name={n.title} cost={n.fields?.Cost} />}
            >
              <FacetText contentId={n.id} />
            </Collapsible>
          ))}
        </>
      )}
      <h4>Available actions</h4>
      <table className="actions-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>
              <Icon name="AP" /> Cost
            </th>
            <th>Categories</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {available.map((a) => (
            <tr key={a.id}>
              <td>
                <RuleLink id={a.id}>{a.name}</RuleLink>
              </td>
              <td className="small">
                <TokenText text={a.fields.Cost ?? ''} />
              </td>
              <td className="small muted">{a.fields.Categories}</td>
              <td>
                <UseButton req={{ key: a.id, name: a.name, cost: parseCost(a.fields.Cost), sl: 0 }} hideCost />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Use buttons for a facet Action: its activations, or a plain Use that spends its costs. */
function ActionUse({ d, id, name, cost }: { d: Derived; id: string; name: string; cost?: string }) {
  const defs = activationsFor(id);
  if (!defs.length) return <UseButton req={actionRequest(d, id, name, cost)} />;
  return (
    <span className="use-group">
      {defs.map((def) => (
        <UseButton key={def.label} req={{ ...actionRequest(d, id, name, cost, def), key: `${id}:${def.label}` }} />
      ))}
    </span>
  );
}

const facetActivationDefs = (facetId?: string) => (facetId ? ACTIVATIONS.filter((a) => a.id === facetId || a.id.startsWith(`${facetId}/`)) : []);

/** Activations defined on a facet or the Actions inside it. */
function FacetActivations({ d, facetId }: { d: Derived; facetId?: string }) {
  const defs = facetActivationDefs(facetId);
  if (!defs.length) return null;
  return (
    <span className="use-group">
      {defs.map((def) => {
        const node = getNode(def.id);
        return <UseButton key={def.id + def.label} req={{ ...actionRequest(d, def.id, def.label, node?.fields?.Cost, def), key: `${def.id}:${def.label}` }} />;
      })}
    </span>
  );
}

const ENDS: Record<ActiveEffect['ends'], string> = {
  startOfTurn: 'until the start of your next turn',
  endOfTurn: 'until the end of your turn',
  rest: 'until you Rest',
  longRest: 'until your next Long Rest',
  manual: 'until removed',
};

function ActiveEffects({ effects, setPlay }: { effects: ActiveEffect[]; setPlay: (fn: (p: PlayState) => PlayState) => void }) {
  if (!effects.length) return <p className="muted">None. Effects from Rage, spells and other activations appear here.</p>;
  return (
    <ul className="plain effects">
      {effects.map((e) => (
        <li key={e.id}>
          <div className="row between">
            <strong>{e.name}</strong>
            <button type="button" className="icon-btn" onClick={() => setPlay((x) => ({ ...x, effects: (x.effects ?? []).filter((y) => y.id !== e.id) }))} aria-label={`End ${e.name}`}>
              ✕
            </button>
          </div>
          <div className="muted small">
            {[
              ...(e.checks ?? []).map((m) => `${m.attrs === 'all' ? 'All' : m.attrs.join(' & ')} ${m.save ? 'Save ' : ''}Checks Bolstered ${m.bolstered}`),
              e.ac ? `AC +${e.ac}` : '',
              e.movement ? `Movement +${e.movement}` : '',
              ...(e.resistances?.length ? [`${e.resistances.map((r) => r.type).join(', ')} Resistance ${e.resistances[0].amount}`] : []),
              ENDS[e.ends],
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {e.notes?.map((n) => (
            <div key={n} className="small">
              {n}
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

function Features({ c, d, setPlay }: { c: Character; d: Derived; setPlay: (fn: (p: PlayState) => PlayState) => void }) {
  const groups = [...new Set(d.facets.map((f) => f.source))];
  return (
    <div className="features">
      {d.cls && (
        <section className="box">
          <Collapsible title={<strong>{d.cls.name} Class Table</strong>}>
            <ClassTableView c={c} />
          </Collapsible>
        </section>
      )}
      {groups.map((g) => (
        <section key={g} className="box">
          <h3 className="box-title">{g}</h3>
          {d.facets
            .filter((f) => f.source === g)
            .map((f) => {
              const max = facetUseMax(f, d);
              const used = c.play.facetUses[f.key] ?? 0;
              return (
                <Collapsible
                  key={f.key}
                  title={
                    <span>
                      <strong>{f.name}</strong> {f.level > 1 && <span className="badge">Level {f.level}</span>}
                    </span>
                  }
                  extra={
                    (max > 0 || facetActivationDefs(f.contentId).length > 0) && (
                    <span className="facet-extra" onClick={(e) => e.stopPropagation()}>
                      {max > 0 && (
                        <span className="uses">
                          <Pips total={max} used={used} label={`${f.name} use`} onChange={(u) => setPlay((x) => ({ ...x, facetUses: { ...x.facetUses, [f.key]: u } }))} />
                          <span className="muted small"> / {f.uses!.per}</span>
                        </span>
                      )}
                      <FacetActivations d={d} facetId={f.contentId} />
                    </span>
                    )
                  }
                >
                  <FacetText contentId={f.contentId} item={f.item} />
                </Collapsible>
              );
            })}
        </section>
      ))}
      {d.choices
        .filter((ch) => ch.selected)
        .map((ch) => {
          const o = ch.options.find((x) => x.id === ch.selected)!;
          return (
            <section key={ch.id} className="box">
              <h3 className="box-title">{ch.label}</h3>
              <Collapsible title={<strong>{o.name}</strong>}>
                <FacetText contentId={o.contentId} item={o.item} />
              </Collapsible>
            </section>
          );
        })}
    </div>
  );
}

function SpellsTab({ c, d, setPlay }: { c: Character; d: Derived; setPlay: (fn: (p: PlayState) => PlayState) => void }) {
  const p = c.play;
  const known = d.spellLists.filter((l) => l.def.mode === 'known');
  const prepared = d.spellLists.filter((l) => l.def.mode === 'prepared');
  const [editing, setEditing] = useState<string | null>(null);
  // Spells from the class itself spend class resources; others (e.g. ancestry gifts) don't.
  const fromClass = (source: string) => source === d.cls?.name || source === d.subclassName || source === 'Facets';
  if (!known.length && !prepared.length && !d.resources.length) return <p className="muted">No spells or maneuvers.</p>;
  return (
    <div className="spells-tab">
      <div className="row wrap">
        {d.spellModDie && (
          <Box title="Spell Mod Die" className="stat">
            <div className="big">{d.spellModDie}</div>
          </Box>
        )}
        {d.maneuverModDie && (
          <Box title="Maneuver Mod Die" className="stat">
            <div className="big">{d.maneuverModDie}</div>
          </Box>
        )}
        {d.resources.map((r) => {
          const v = p.resources[r.name] ?? 0;
          return (
            <Box key={r.name} title={r.mode === 'pool' ? r.name : `${r.name} (applied / limit)`} className="stat">
              {r.mode === 'pool' ? (
                <>
                  <div className="big">
                    {r.max - v}
                    <span className="muted"> / {r.max}</span>
                  </div>
                  <Stepper label={`${r.name} available`} value={r.max - v} min={0} max={r.max} onChange={(n) => setPlay((x) => ({ ...x, resources: { ...x.resources, [r.name]: r.max - n } }))} />
                </>
              ) : (
                <>
                  <div className="big">
                    {v}
                    <span className="muted"> / {r.max}</span>
                  </div>
                  <Stepper label={`${r.name} applied`} value={v} min={0} max={r.max} onChange={(n) => setPlay((x) => ({ ...x, resources: { ...x.resources, [r.name]: n } }))} />
                </>
              )}
            </Box>
          );
        })}
        {d.trackers.map((t) => (
          <Box key={t} title={t} className="stat">
            <div className="big">{p.trackers[t] ?? 0}</div>
            <Stepper label={t} value={p.trackers[t] ?? 0} min={0} onChange={(n) => setPlay((x) => ({ ...x, trackers: { ...x.trackers, [t]: n } }))} />
          </Box>
        ))}
      </div>

      {prepared.map((l) => {
        const ids = p.prepared[l.def.id] ?? [];
        return (
          <section key={l.def.id} className="box">
            <div className="list-head">
              <h3 className="box-title">
                {l.def.label} <span className="muted">({ids.length} / {l.count})</span>
              </h3>
              <button type="button" onClick={() => setEditing(editing === l.def.id ? null : l.def.id)}>
                {editing === l.def.id ? 'Done' : 'Change prepared'}
              </button>
            </div>
            {editing === l.def.id ? (
              <SpellListEditor list={l} limit={l.count} selectedIds={ids} onChange={(next) => setPlay((x) => ({ ...x, prepared: { ...x.prepared, [l.def.id]: next } }))} />
            ) : ids.length ? (
              ids.map((id) => {
                const cs = getCastable(id);
                return cs ? <CastRow key={id} c={c} d={d} cs={cs} fromClass={fromClass(l.source)} /> : null;
              })
            ) : (
              <p className="muted">Nothing prepared yet.</p>
            )}
          </section>
        );
      })}

      {known.map((l) => (
        <section key={`${l.source}-${l.def.id}`} className="box">
          <h3 className="box-title">
            {l.def.label} <span className="muted">({l.source})</span>
          </h3>
          {[...l.granted, ...l.selected].map((cs) => (
            <CastRow key={cs.id} c={c} d={d} cs={cs} fromClass={fromClass(l.source)} />
          ))}
          {!l.granted.length && !l.selected.length && <p className="muted">None chosen — use Edit → Spells & Maneuvers.</p>}
        </section>
      ))}
      <p className="muted small">
        <RuleLink id="reading-spells-maneuvers">How to read spells & maneuvers</RuleLink>
      </p>
    </div>
  );
}

function Notes({ c, update }: { c: Character; update: Update }) {
  const set = (k: keyof Character['details'], v: string) => update((x) => ({ ...x, details: { ...x.details, [k]: v } }));
  return (
    <div className="form">
      <Box title="Session notes">
        <textarea className="full" rows={10} value={c.details.notes} onChange={(e) => set('notes', e.target.value)} aria-label="Session notes" />
      </Box>
      <Box title="Appearance">
        <textarea className="full" rows={3} value={c.details.appearance} onChange={(e) => set('appearance', e.target.value)} aria-label="Appearance" />
      </Box>
      <Box title="Backstory">
        <textarea className="full" rows={6} value={c.details.backstory} onChange={(e) => set('backstory', e.target.value)} aria-label="Backstory" />
        <p className="muted small">
          Age: {c.details.age || '—'} · Devotion: {c.details.devotion || 'None'}
        </p>
      </Box>
    </div>
  );
}
