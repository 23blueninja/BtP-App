import { useEffect, useRef, useState } from 'react';
import { basicActions, conditions as conditionDefs, getNode, getCastable, type RuleNode } from '../content';
import { ancestryById } from '../data/ancestries';
import { ATTRS, ATTR_NAMES, RANK_DIE, type Light } from '../data/types';
import { newId, type Character, type Experience, type PlayState, type SessionNote } from '../engine/character';
import { derive, type Derived } from '../engine/derive';
import { clampPlay, facetUseMax, heal, longRest, shortRest, takeDamage } from '../engine/play';
import { AP_MAX, CONDITION_RULES, addCondition, describeCheck, endTurn, startTurn } from '../engine/conditions';
import { ClassTableView, Equipment, WeaponTable } from './Builder';
import { Collapsible, FacetText, go, Icon, Modal, RuleLink, Stepper, TokenText } from './common';
import { SpellListEditor } from './pickers';
import { CastRow } from './Cast';
import { alignmentGradient, LIGHT_TEXT } from './lightColors';
import { PlayContext, UseButton } from './Activate';
import { HomebrewBox } from './Homebrew';
import { actionRequest, activationsFor, ACTIVATIONS } from '../engine/activations';
import { parseCost } from '../engine/costs';
import type { ActiveEffect } from '../engine/character';

type Update = (fn: (c: Character) => Character) => void;

/** Heading gradient from the character's alignments (see lightColors.ts). */
function headingStyle(d: Derived): React.CSSProperties | undefined {
  const g = alignmentGradient(d.alignmentRanked);
  return g ? ({ '--heading-gradient': g } as React.CSSProperties) : undefined;
}

const TABS = ['Sheet', 'Facets', 'Spells & Maneuvers', 'Equipment', 'Notes'] as const;
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
        <StatStrip d={d}>
          <TurnBar c={c} d={d} update={update} setPlay={setPlay} onLog={onLog} compact />
        </StatStrip>
        {/* Narrower screens keep the full-width sticky bar instead of the box in the strip. */}
        <TurnBar c={c} d={d} update={update} setPlay={setPlay} onLog={onLog} />
        {d.issues.length > 0 && (
          <details className="issues banner">
            <summary>{d.issues.length} unfinished item(s) — open the builder to complete them</summary>
            <ul>
              {d.todo.map((t) => (
                <li key={t.text}>
                  <a href={`#/c/${encodeURIComponent(c.id)}/build/${t.step}`}>
                    {t.text}
                  </a>
                </li>
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
        {tab === 'Facets' && <Facets c={c} d={d} setPlay={setPlay} update={update} />}
        {tab === 'Spells & Maneuvers' && <SpellsTab c={c} d={d} setPlay={setPlay} />}
        {tab === 'Equipment' && <Equipment c={c} d={d} update={update} />}
        {tab === 'Notes' && <Notes c={c} update={update} />}
        {log && (
          <div className="toast" role="status">
            <ul>
              {log.lines.map((l, i) => (
                <li key={i}>
                  <TokenText text={l} />
                </li>
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

/** Class Bonus, Class Die and the five Attributes, across the top of every tab. */
function StatStrip({ d, children }: { d: Derived; children?: React.ReactNode }) {
  // A marker just above the bar: once it scrolls out of view the bar is pinned, and
  // only then gets a backdrop so content passing underneath stays readable.
  const marker = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = marker.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
    <div ref={marker} className="stat-strip-marker" aria-hidden />
    <div className={`stat-strip ${stuck ? 'stuck' : ''}`}>
      {/* Class Bonus and Class Die: one box sliced on a diagonal; the Class Die takes the
          bottom-right corner, sized so long class names and die names both fit. */}
      <section className="split-box">
        <div className="split-glass a" aria-hidden />
        <div className="split-glass b" aria-hidden />
        <svg className="split-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polygon points="0,0 100,0 100,14 14,100 0,100" />
          <polygon points="100,22 100,100 22,100" />
        </svg>
        <div className="split-a">
          <h3 className="box-title">{d.cls ? `${d.cls.name} Bonus` : 'Class Bonus'}</h3>
          <div className="big">+{d.classBonus}</div>
        </div>
        <div className="split-b">
          <div className="big">{d.classDie || '—'}</div>
          <h3 className="box-title">{d.classDieName}</h3>
        </div>
      </section>
      {ATTRS.map((a) => {
        const at = d.attrs[a];
        const save = d.saves.find((x) => x.attr === a);
        return (
          <StatBox
            key={a}
            title={ATTR_NAMES[a]}
            value={at.label}
            className="attr-stat"
            display={
              <span className="attr-main">
                <span className="attr-symbol">
                  <Icon name={a} />
                </span>
                <span className={`attr-die ${at.label.length > 3 ? 'long' : ''}`}>{at.label}</span>
              </span>
            }
          >
            <p>
              <Icon name={a} /> {at.points} {at.points === 1 ? 'point' : 'points'}: <strong>{at.label}</strong> Mod Die
            </p>
            <Details lines={at.sources} />
            {at.dieNote && <p className="note small"><TokenText text={at.dieNote} /></p>}
            {save && (
              <p>
                Save Checks: <strong>{save.label}</strong>
                {save.notes.length > 0 && <span className="muted small"> · <TokenText text={save.notes.join(', ')} /></span>}
              </p>
            )}
          </StatBox>
        );
      })}
      {children}
    </div>
    </>
  );
}

/** AP tracker and Start/End Turn, kept at the top of the sheet. */
function TurnBar({
  c,
  d,
  update,
  setPlay,
  onLog,
  compact,
}: {
  c: Character;
  d: Derived;
  update: Update;
  setPlay: (fn: (p: PlayState) => PlayState) => void;
  onLog: (lines: string[], undo?: PlayState) => void;
  /** Desktop: a box at the end of the stat strip, with the AP bubbles stacked vertically. */
  compact?: boolean;
}) {
  const p = c.play;
  const ap = p.ap ?? AP_MAX;
  const myTurn = !!p.turn?.active;
  const blocked = d.conditionFx.active.find((x) => x.name === 'Paralyzed' || x.name === 'Unconscious' || x.name === 'Stunned');
  const start = () =>
    update((x) => {
      const dx = derive(x);
      const r = startTurn(x.play, dx.level, dx.resistances, {
        immune: dx.damageImmunities.map((i) => i.type),
        vulnerable: dx.vulnerabilities,
        immuneConditions: dx.conditionImmunities.map((i) => i.name),
      });
      let play = r.play;
      for (const dmg of r.damage) play = takeDamage(play, dmg.amount, dx);
      onLog(r.log, x.play);
      return { ...x, play: clampPlay(play, dx) };
    });
  const end = () =>
    update((x) => {
      const r = endTurn(x.play, derive(x).conditionImmunities.map((i) => i.name));
      onLog(r.log, x.play);
      return { ...x, play: clampPlay(r.play, derive(x)) };
    });
  const initiative = () => setPlay((x) => ({ ...x, ap: AP_MAX, tempAp: 0, turn: { active: false } }));
  const pips = <Pips total={AP_MAX} used={AP_MAX - Math.min(ap, AP_MAX)} onChange={(u) => setPlay((x) => ({ ...x, ap: AP_MAX - u }))} label="AP" />;
  const temp = <Stepper label="Temporary AP" value={p.tempAp ?? 0} min={0} onChange={(v) => setPlay((x) => ({ ...x, tempAp: v }))} />;
  const warn = blocked && (
    <p className="turn-warn small">
      {blocked.name}: <TokenText text={CONDITION_RULES[blocked.name].ap?.(blocked.level) ?? ''} />
    </p>
  );
  if (compact) {
    return (
      <section className={`box turn-box ${myTurn ? 'my-turn' : ''}`} aria-label="Turn">
        <div className="turn-box-head">
          <h3 className="box-title">
            <Icon name="AP" /> {ap}/{AP_MAX}
          </h3>
          <span className="turn-temp">
            <span className="muted small">Temp</span>
            {temp}
          </span>
        </div>
        <div className="turn-box-body">
          <div className="turn-pips-v">{pips}</div>
          <div className="turn-box-controls">
            <div className="turn-box-buttons">
              <button type="button" className={myTurn ? '' : 'primary'} disabled={myTurn} onClick={start}>
                ▶ Start
              </button>
              <button type="button" className={myTurn ? 'primary' : ''} disabled={!myTurn} onClick={end}>
                ■ End
              </button>
            </div>
            <button type="button" title="Rolling Initiative refills your AP" onClick={initiative}>
              Initiative {d.initiative}
            </button>
          </div>
        </div>
        {warn}
      </section>
    );
  }
  return (
    <section className={`turn-bar box ${myTurn ? 'my-turn' : ''}`} aria-label="Turn">
      <div className="turn-ap">
        <span className="turn-label">
          <Icon name="AP" />
        </span>
        {pips}
        <span className="turn-count">
          {ap}/{AP_MAX}
        </span>
        <span className="turn-temp">
          <span className="muted small">Temp</span>
          {temp}
        </span>
      </div>
      <div className="turn-buttons">
        <button type="button" className={myTurn ? '' : 'primary'} disabled={myTurn} onClick={start}>
          ▶ Start Turn
        </button>
        <button type="button" className={myTurn ? 'primary' : ''} disabled={!myTurn} onClick={end}>
          ■ End Turn
        </button>
        <button type="button" title="Rolling Initiative refills your AP" onClick={initiative}>
          Initiative {d.initiative}
        </button>
      </div>
      {warn}
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

/** Each Personal Alignment response is coloured like the Light it leans toward. */
const RESPONSE_LIGHT: Record<string, Light> = {
  Patience: 'Frost',
  Action: 'Flame',
  Reason: 'Pneuma',
  Instinct: 'Soma',
  Apathy: 'Mordant',
  Empathy: 'Velvet',
};

function Response({ value }: { value: string }) {
  const light = RESPONSE_LIGHT[value];
  return (
    <strong style={light ? { color: LIGHT_TEXT[light] } : undefined} title={light}>
      {value || '—'}
    </strong>
  );
}

/** A stat panel that opens its breakdown (where the number comes from) in a modal. */
function StatBox({ title, value, display, className = '', children }: { title: string; value: React.ReactNode; display?: React.ReactNode; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`box stat stat-btn ${className}`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`${title} ${value}: details`}>
        <span className="box-title">{title}</span>
        {display ?? <span className="big">{value}</span>}
        <span className="stat-more">Details</span>
      </button>
      {open && (
        <Modal title={`${title} ${value}`} onClose={() => setOpen(false)}>
          {children}
        </Modal>
      )}
    </>
  );
}

function Details({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="plain stat-details">
      {lines.map((l) => (
        <li key={l}>
          <TokenText text={l} />
        </li>
      ))}
    </ul>
  );
}

function MainSheet({ c, d, update, setPlay, onRest }: MainProps) {
  const p = c.play;
  const [amount, setAmount] = useState('');
  const [useCharge, setUseCharge] = useState(true);
  const n = Number(amount) || 0;
  const al = c.alignment;
  return (
    // On wide screens Actions sit in their own column on the right; otherwise below the sheet.
    <div className="sheet-layout">
      <div className="sheet-grid">
        {/* Top row: Level / Initiative / AC / Movement square, Endurance, I respond to new…, Saves */}
        <div className="top-row">
          {/* Level, Initiative, AC and Movement in a 2×2 square left of Endurance. */}
          <div className="stat-square">
            <Box title="Level" className="stat">
              <div className="big">{c.level}</div>
            </Box>
            <StatBox title="Initiative" value={d.initiative}>
              <p>
                Roll your <Icon name="PER" /> Die ({d.attrs.PER.label})
                {d.initiative !== d.attrs.PER.label ? ' in Tandem' : ''}.
              </p>
              <Details lines={d.initiativeNotes} />
            </StatBox>
            <StatBox title="AC" value={d.ac.value}>
              <p>{c.equipment.armor ? `${c.equipment.armor.quality} ${c.equipment.armor.type} armor` : 'Unarmored'}</p>
              <Details lines={d.ac.breakdown} />
            </StatBox>
            <StatBox title="Movement" value={d.movement}>
              <Details lines={d.movementBreakdown} />
              <Details lines={d.movementTypes.map((m) => `${m.type} Movement ${m.value}`)} />
            </StatBox>
          </div>
          <section className="box endurance">
            {/* Temp sits beside the label, like Temp AP in the turn box. */}
            <div className="box-head">
              <h3 className="box-title">Endurance</h3>
              <span className="box-head-extra">
                <span className="muted small">Temp</span>
                <Stepper label="Temporary Endurance" value={p.tempEndurance} min={0} onChange={(v) => setPlay((x) => ({ ...x, tempEndurance: v }))} />
              </span>
            </div>
            {/* Current Endurance beside Heal and the amount; the maximum beside Damage. */}
            <div className="end-grid">
              <span className="end-current" aria-label={`Endurance ${p.endurance} of ${d.enduranceMax}`}>
                {p.endurance}
              </span>
              <span className="end-max muted" aria-hidden>
                {d.enduranceMax}
              </span>
              <button type="button" className="end-heal" disabled={!n} onClick={() => (setPlay((x) => heal(x, n, d)), setAmount(''))}>
                Heal
              </button>
              <input className="end-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" aria-label="Amount" />
              <button type="button" className="danger end-damage" disabled={!n} onClick={() => (setPlay((x) => takeDamage(x, n, d)), setAmount(''))}>
                Damage
              </button>
            </div>
            <div className="end-vitality">
              <div className="row between">
                <span>Vitality</span>
                {/* Restoring Vitality ends Dying. */}
                <Pips total={d.vitalityMax} used={d.vitalityMax - p.vitality} onChange={(u) => setPlay((x) => { const v = d.vitalityMax - u; return { ...x, vitality: v, dying: v > x.vitality ? 0 : x.dying }; })} label="Vitality" />
              </div>
              {d.darkness && (
                <div className="row between" title={`Your missing Vitality (${d.darkness.sources.join(', ')})`}>
                  <span>Darkness</span>
                  <strong>{d.darkness.value}</strong>
                </div>
              )}
              <div className="row between">
                <span>
                  <RuleLink id="beyond-the-prism/endurance-and-vitality/dying">Dying</RuleLink>
                </span>
                <Stepper label="Dying" value={p.dying} min={0} onChange={(v) => setPlay((x) => ({ ...x, dying: v }))} />
              </div>
            </div>
          </section>
          {/* Radiance over "I respond to new…", stacked in one column. */}
          <div className="top-stack">
            {/* The title is the label; the bubbles sit right-aligned beside it and wrap downward. */}
            <section className="box radiance">
              <h3 className="box-title">Radiance</h3>
              <Pips total={d.radianceMax} used={p.radianceSpent} onChange={(u) => setPlay((x) => ({ ...x, radianceSpent: u }))} label="Radiance" />
            </section>
            <Box title="I respond to new…" className="respond">
              <ul className="plain">
                <li>Situations with <Response value={al.situations} /></li>
                <li>Problems with <Response value={al.problems} /></li>
                <li>People with <Response value={al.people} /></li>
              </ul>
            </Box>
          </div>
        </div>

        {/* Weapons get a full-width row: the table needs the space most. */}
        {/* Right-hand column, level with the top row: Save Checks with Conditions,
            Resistances, Alignments, Movement & Senses and Training beneath. */}
        <div className="side-col">
          <Box title="Save Checks" className="saves">
            <table>
              <tbody>
                {d.saves.map((s) => (
                  <tr key={s.attr}>
                    <td>
                      <span className="save-die">
                        <Icon name={s.attr} /> {s.label}
                      </span>
                      {s.notes.length > 0 && (
                        <div className="muted small">
                          <TokenText text={s.notes.join(', ')} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
          <Box title="Conditions">
            <Conditions p={p} d={d} setPlay={setPlay} />
          </Box>
          {/* Each shown only when the character has something in it. */}
          {d.resistances.length > 0 && (
            <Box title="Resistances">
              <ul className="plain">
                {d.resistances.map((r) => (
                  <li key={r.type}>
                    <strong>{r.type}</strong> {r.value}
                  </li>
                ))}
              </ul>
            </Box>
          )}
          {(d.damageImmunities.length > 0 || d.conditionImmunities.length > 0) && (
            <Box title="Immunities">
              <ul className="plain">
                {d.damageImmunities.map((x) => (
                  <li key={x.type} title={x.sources.join(', ')}>
                    <strong>{x.type}</strong> damage
                  </li>
                ))}
                {d.conditionImmunities.map((x) => (
                  <li key={x.name} title={x.sources.join(', ')}>
                    <strong>{x.name}</strong> <span className="muted small">Condition</span>
                  </li>
                ))}
              </ul>
            </Box>
          )}
          {d.vulnerabilities.length > 0 && (
            <Box title="Vulnerabilities">
              <ul className="plain">
                {d.vulnerabilities.map((v) => (
                  <li key={v.type + v.source}>
                    <strong>{v.type}</strong> {v.dice} <span className="muted small">({v.source})</span>
                  </li>
                ))}
              </ul>
            </Box>
          )}
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
          <Box title="Training">
            <p className="small">
              <strong>Armor:</strong> {d.armorTraining}
            </p>
            <p className="small">
              <strong>Weapons:</strong> {d.weaponTraining}
            </p>
            {d.saveTraining && (
              <p className="small">
                <strong>Save Checks:</strong> <TokenText text={d.saveTraining} />
              </p>
            )}
            {d.cls?.spellAttr === 'choice' && (
              <p className="small">
                <strong>Spell Mod Die:</strong> <TokenText text={c.choices['spell-attr'] ?? 'choose VIG or PRS in the builder'} />
              </p>
            )}
            <p className="small">
              <strong>Action categories:</strong> {d.actionCategories.join(', ')}
            </p>
            {d.armorNotes.map((x) => (
              <p key={x} className="note small">
                <TokenText text={x} />
              </p>
            ))}
          </Box>
        </div>

        <div className="wide-row">
          <Box title="Weapons">
            <WeaponTable c={c} d={d} />
          </Box>
        </div>

        <div className="main-cols">
          <div className="col">
            <Box title="Professions">
              <SkillList slots={d.skillSlots.filter((s) => s.kind === 'profession')} />
            </Box>
            <Box title="Hobbies">
              <SkillList slots={d.skillSlots.filter((s) => s.kind === 'hobby')} />
            </Box>
            <Box title="Experiences">
              <Experiences c={c} update={update} />
            </Box>
            <Box title="Rest">
              <div className="row between">
                <span>Rest Charges</span>
                <Pips total={d.restCharges} used={p.restChargesSpent} onChange={(u) => setPlay((x) => ({ ...x, restChargesSpent: u }))} label="Rest Charge" />
              </div>
              <label className="inline small">
                <input type="checkbox" checked={useCharge} onChange={(e) => setUseCharge(e.target.checked)} /> Spend a Rest Charge on Short Rest
              </label>
              <div className="row">
                <button type="button" onClick={() => update((x) => { const r = shortRest(x, derive(x), { spendRestCharge: useCharge }); onRest(r.log); return { ...x, play: r.play, homebrew: r.homebrew }; })}>
                  Short Rest
                </button>
                <button type="button" onClick={() => update((x) => { const r = longRest(x, derive(x)); onRest(r.log); return { ...x, play: r.play, homebrew: r.homebrew }; })}>
                  Long Rest
                </button>
              </div>
              <p className="muted small">
                {c.settings.restRules === 'heroic' ? 'Heroic' : 'Gritty'} rules · Short Rests since Long Rest: {p.shortRests}/2 · <RuleLink id="beyond-the-prism/resting">Resting rules</RuleLink>
              </p>
            </Box>
          </div>
          <div className="col">
            {/* What's changing your rolls right now, then the temporary effects behind some of it. */}
            <Box title="Active effects" className="active-effects">
              <h4>Check Modifiers</h4>
              <CheckModifiers d={d} />
              <h4>Temporary Effects</h4>
              <ActiveEffects effects={p.effects ?? []} setPlay={setPlay} />
            </Box>
            <Box title="Items & effects">
              <HomebrewBox d={d} update={update} />
            </Box>
          </div>
        </div>
      </div>
      <aside className="sheet-actions-col">
        <Box title="Actions">
          <ActionsList c={c} d={d} />
        </Box>
      </aside>
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
            <td>{s.name || <span className="muted">unnamed</span>}</td>
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
  const immune = new Set(d.conditionImmunities.map((x) => x.name));
  return (
    <div>
      {p.conditions.length === 0 && implied.length === 0 && <p className="muted">None</p>}
      <ul className="plain">
        {p.conditions.map((cd, i) => {
          const def = conditionDefs.find((x) => x.name === cd.name);
          return (
            <li key={i} className="row between">
              <span>
                {def ? <RuleLink id={def.id}>{cd.name}</RuleLink> : cd.name}
                {immune.has(cd.name) && <span className="muted small"> · Immune, no effect</span>}
              </span>
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
      <div className="row condition-add">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Condition">
          <option value="">Add condition…</option>
          {conditionDefs
            .filter((x) => x.name !== 'Dying')
            .map((x) => (
              // You can't gain a Condition you're immune to.
              <option key={x.id} value={x.name} disabled={immune.has(x.name)}>
                {x.name}
                {immune.has(x.name) ? ' (Immune)' : ''}
              </option>
            ))}
        </select>
        <button
          type="button"
          disabled={!pick || immune.has(pick)}
          onClick={() => {
            const def = conditionDefs.find((x) => x.name === pick);
            setPlay((x) =>
              addCondition(x, pick, def?.leveled ? 1 : undefined, {
                resistances: d.resistances,
                immune: d.damageImmunities.map((i) => i.type),
                immuneConditions: [...immune],
                vitalityMax: d.vitalityMax,
              }),
            );
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
            <TokenText text={r.label} />
          </dt>
          <dd>
            <TokenText text={describeCheck(r).join('; ')} />
          </dd>
        </div>
      ))}
      {fx.otherChecks.map((t) => (
        <div key={t}>
          <dd>
            <TokenText text={t} />
          </dd>
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
            <Icon name="AP" />
          </dt>
          <dd>
            <TokenText text={t} />
          </dd>
        </div>
      ))}
      {fx.notes.map((t) => (
        <div key={t}>
          <dd>
            <TokenText text={t} />
          </dd>
        </div>
      ))}
      {[...d.bolsters, ...d.tandems].map((b) => (
        <div key={b}>
          <dd>
            <TokenText text={b} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Experiences({ c, update }: { c: Character; update: Update }) {
  const [name, setName] = useState('');
  const [uses, setUses] = useState(1);
  const [effect, setEffect] = useState('');
  const setExp = (id: string, fn: (e: Experience) => Experience) => update((x) => ({ ...x, experiences: x.experiences.map((e) => (e.id === id ? fn(e) : e)) }));
  return (
    <div className="experiences">
      {c.experiences.length > 0 && (
        <ul className="plain">
          {c.experiences.map((e) => (
            <li key={e.id} className={e.used >= e.uses ? 'spent' : ''}>
              <div className="row between">
                <strong>{e.name}</strong>
                <span className="row small-gap">
                  <Pips total={e.uses} used={e.used} onChange={(u) => setExp(e.id, (x) => ({ ...x, used: u }))} label={`${e.name} use`} />
                  <button type="button" className="icon-btn" onClick={() => update((x) => ({ ...x, experiences: x.experiences.filter((y) => y.id !== e.id) }))} aria-label={`Remove ${e.name}`}>
                    ✕
                  </button>
                </span>
              </div>
              {e.effect && <div className="small muted">{e.effect}</div>}
            </li>
          ))}
        </ul>
      )}
      <div className="exp-add">
        <div className="row small-gap">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monster Slayer" aria-label="Experience name" />
          <span className="small muted">Uses</span>
          <Stepper label="Uses" value={uses} min={1} onChange={setUses} />
        </div>
        <textarea rows={2} value={effect} onChange={(e) => setEffect(e.target.value)} placeholder="Effect, e.g. Advantage on an Attack Check against a Large creature." aria-label="Experience effect" />
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => {
            update((x) => ({ ...x, experiences: [...x.experiences, { id: newId(), name: name.trim(), uses, used: 0, effect: effect.trim() }] }));
            setName('');
            setUses(1);
            setEffect('');
          }}
        >
          Add experience
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
  // Category actions (Combat, Arcane, Supernatural) come before the Basic ones.
  const categories = [...new Set(available.map((a) => a.category))].filter((cat) => cat !== 'Basic');
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
      {categories.map((cat) => (
        <ActionTable key={cat} title={`${cat} actions`} actions={available.filter((a) => a.category === cat)} />
      ))}
      <ActionTable title="Basic actions" actions={available.filter((a) => a.category === 'Basic')} />
    </div>
  );
}

function ActionTable({ title, actions }: { title: string; actions: typeof basicActions }) {
  if (!actions.length) return null;
  return (
    <>
      <h4>{title}</h4>
      <div className="table-wrap">
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
          {actions.map((a) => (
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
    </>
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

function Facets({ c, d, setPlay, update }: { c: Character; d: Derived; setPlay: (fn: (p: PlayState) => PlayState) => void; update: Update }) {
  const groups = [...new Set(d.facets.map((f) => f.source))];
  // Class → Subclass (and chosen options) on the left; Ancestry → Sub-ancestry → Heritage → Homebrew on the right.
  const classSources = new Set([d.cls?.name, d.subclassName].filter(Boolean));
  const classGroups = groups.filter((g) => classSources.has(g));
  const otherGroups = groups.filter((g) => !classSources.has(g));
  const group = (g: string) => (
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
  );
  return (
    <div className="features">
      {d.cls && (
        <section className="box">
          <Collapsible title={<strong>{d.cls.name} Class Table</strong>}>
            <ClassTableView c={c} />
          </Collapsible>
        </section>
      )}
      <div className="facet-cols">
        <div className="col">
          {classGroups.map(group)}
          {/* Choices with rules text of their own; bare picks (Save Check, Spell Mod Die Attribute) show under Training. */}
          {d.choices
            .filter((ch) => ch.options.some((o) => o.id === ch.selected && (o.contentId || o.item)))
            .map((ch) => {
              const o = ch.options.find((x) => x.id === ch.selected)!;
              return (
                <section key={ch.id} className="box">
                  <h3 className="box-title">{ch.label}</h3>
                  <Collapsible
                    title={<strong>{o.name}</strong>}
                    extra={facetActivationDefs(o.contentId).length > 0 && <FacetActivations d={d} facetId={o.contentId} />}
                  >
                    <FacetText contentId={o.contentId} item={o.item} />
                  </Collapsible>
                </section>
              );
            })}
        </div>
        <div className="col">
          {otherGroups.map(group)}
          {/* Facets your PM grants beyond your class and ancestry (e.g. one that raises an Alignment). */}
          <section className="box">
            <h3 className="box-title">Homebrew facets</h3>
            <HomebrewBox d={d} update={update} facets />
          </section>
        </div>
      </div>
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

/** Today as yyyy-mm-dd in the local time zone. */
const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const monthLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Session notes as a tree (month → session); pick one to read or edit it. */
function SessionNotes({ c, update }: { c: Character; update: Update }) {
  const sessions = c.sessions;
  const [openId, setOpenId] = useState<string | null>(sessions.at(-1)?.id ?? null);
  const open = sessions.find((s) => s.id === openId);
  const setSessions = (fn: (s: SessionNote[]) => SessionNote[]) => update((x) => ({ ...x, sessions: fn(x.sessions) }));
  const patch = (id: string, p: Partial<SessionNote>) => setSessions((s) => s.map((n) => (n.id === id ? { ...n, ...p } : n)));
  // Newest first, grouped by month.
  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || sessions.indexOf(b) - sessions.indexOf(a));
  const months = [...new Set(sorted.map((s) => s.date.slice(0, 7)))];
  return (
    <div className="session-notes">
      <div className="session-tree">
        <button
          type="button"
          className="primary"
          onClick={() => {
            const note: SessionNote = { id: newId(), title: `Session ${sessions.length + 1}`, date: localDate(), body: '' };
            setSessions((s) => [...s, note]);
            setOpenId(note.id);
          }}
        >
          + New session
        </button>
        {months.length === 0 && <p className="muted small">No sessions yet.</p>}
        {months.map((m) => (
          <details key={m} open>
            <summary>{monthLabel(`${m}-01`)}</summary>
            <ul className="plain">
              {sorted
                .filter((s) => s.date.startsWith(m))
                .map((s) => (
                  <li key={s.id}>
                    <button type="button" className={`tree-item ${s.id === openId ? 'active' : ''}`} onClick={() => setOpenId(s.id)}>
                      <span>{s.title || 'Untitled'}</span>
                      <span className="muted small">{dayLabel(s.date)}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </details>
        ))}
      </div>
      {open ? (
        <div className="session-editor">
          <div className="row wrap">
            <input className="grow" value={open.title} onChange={(e) => patch(open.id, { title: e.target.value })} aria-label="Session title" placeholder="Title" />
            <input type="date" value={open.date} onChange={(e) => e.target.value && patch(open.id, { date: e.target.value })} aria-label="Session date" />
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (!confirm(`Delete "${open.title || 'Untitled'}"? This cannot be undone.`)) return;
                setSessions((s) => s.filter((n) => n.id !== open.id));
                setOpenId(null);
              }}
            >
              Delete
            </button>
          </div>
          <textarea className="full" rows={14} value={open.body} onChange={(e) => patch(open.id, { body: e.target.value })} aria-label="Session notes" placeholder="What happened this session…" />
        </div>
      ) : (
        sessions.length > 0 && <p className="muted session-editor">Pick a session to read or edit it.</p>
      )}
    </div>
  );
}

function Notes({ c, update }: { c: Character; update: Update }) {
  const set = (k: keyof Character['details'], v: string) => update((x) => ({ ...x, details: { ...x.details, [k]: v } }));
  return (
    <div className="form">
      <Box title="Session notes">
        <SessionNotes c={c} update={update} />
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
