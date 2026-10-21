import { useState, type ReactNode } from 'react';
import { allNodes, armorQualities, getNode, weaponPropertyNode, weapons } from '../content';
import { ancestries, ancestryById, ancestryName, CUSTOM_ANCESTRY, CUSTOM_ANCESTRY_NOTE } from '../data/ancestries';
import { backgroundById, backgrounds, heritageById, heritageFacets } from '../data/backgrounds';
import { classes } from '../data/classes';
import { ATTRS, ATTR_NAMES, LIGHTS, RANK_DIE, type Attr, type Light } from '../data/types';
import { newId, type Character } from '../engine/character';
import { classAlignment, classTable, subclassesOf } from '../engine/classInfo';
import { derive, POINT_BUY_POOL, type Derived } from '../engine/derive';
import { freshPlay } from '../engine/play';
import { Collapsible, excerpt, FacetText, go, Html, Icon, Modal, RuleBlock, RuleLink, Stepper, TokenText } from './common';
import { ChoicePicker, SpellListEditor } from './pickers';
import { BulkPyramid } from './Inventory';

export const STEPS = [
  { id: 'basics', label: 'Basics' },
  { id: 'attributes', label: 'Attributes' },
  { id: 'ancestry', label: 'Ancestry' },
  { id: 'background', label: 'Background' },
  { id: 'class', label: 'Class' },
  { id: 'spells', label: 'Spells & Maneuvers' },
  { id: 'details', label: 'Final Details' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'review', label: 'Review' },
] as const;

type Update = (fn: (c: Character) => Character) => void;

/** "needs" when an unfinished item points at this field, so it stands out. */
const needs = (d: Derived, field: string, base = '') => `${base}${d.todo.some((t) => t.fields.includes(field)) ? `${base ? ' ' : ''}needs` : ''}` || undefined;

interface StepProps {
  c: Character;
  d: Derived;
  update: Update;
}

export function Builder({ c, update, step }: { c: Character; update: Update; step: string }) {
  const d = derive(c);
  const idx = Math.max(0, STEPS.findIndex((s) => s.id === step));
  const cur = STEPS[idx];
  const props = { c, d, update };
  return (
    <div className="builder">
      <nav className="steps" aria-label="Character creation steps">
        {STEPS.map((s, i) => {
          const left = d.todo.filter((t) => t.step === s.id).length;
          return (
            <button key={s.id} type="button" className={`step ${i === idx ? 'active' : ''}`} onClick={() => go('c', c.id, 'build', s.id)}>
              <span className="step-num">{i + 1}</span> {s.label}
              {left > 0 && (
                <span className="step-todo" title={`${left} thing(s) left to do`}>
                  {left}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="builder-main">
        <div className="builder-content">
          <h2>{cur.label}</h2>
          {cur.id === 'basics' && <Basics {...props} />}
          {cur.id === 'attributes' && <Attributes {...props} />}
          {cur.id === 'ancestry' && <Ancestry {...props} />}
          {cur.id === 'background' && <Background {...props} />}
          {cur.id === 'class' && <ClassStep {...props} />}
          {cur.id === 'spells' && <Spells {...props} />}
          {cur.id === 'details' && <Details {...props} />}
          {cur.id === 'equipment' && <Equipment {...props} />}
          {cur.id === 'review' && <Review {...props} />}
          <div className="step-nav">
            {idx > 0 && (
              <button type="button" onClick={() => go('c', c.id, 'build', STEPS[idx - 1].id)}>
                ← {STEPS[idx - 1].label}
              </button>
            )}
            <span className="spacer" />
            {idx < STEPS.length - 1 ? (
              <button type="button" className="primary" onClick={() => go('c', c.id, 'build', STEPS[idx + 1].id)}>
                {STEPS[idx + 1].label} →
              </button>
            ) : (
              <button type="button" className="primary" onClick={() => go('c', c.id)}>
                Open Character Sheet
              </button>
            )}
          </div>
        </div>
        <Summary c={c} d={d} />
      </div>
    </div>
  );
}

function Summary({ c, d }: { c: Character; d: Derived }) {
  const anc = ancestryById.get(c.ancestry);
  return (
    <aside className="summary" aria-label="Character summary">
      <h3>{c.name || 'Unnamed'}</h3>
      <p className="muted">
        Level {d.level} {anc ? ancestryName(c) : ''} {d.cls?.name ?? ''}
        {d.subclassName ? ` (${d.subclassName})` : ''}
      </p>
      <div className="attr-row">
        {ATTRS.map((a) => (
          <div key={a} className="attr-mini">
            <Icon name={a} />
            <span>{d.attrs[a].points}</span>
            <small>{d.attrs[a].label}</small>
          </div>
        ))}
      </div>
      <dl className="summary-stats">
        <dt>Endurance</dt>
        <dd>{d.enduranceMax}</dd>
        <dt>Vitality</dt>
        <dd>{d.vitalityMax}</dd>
        <dt>Radiance</dt>
        <dd>{d.radianceMax}</dd>
        <dt>AC</dt>
        <dd>{d.ac.value}</dd>
        <dt>Movement</dt>
        <dd>{d.movement}</dd>
        <dt>Radius</dt>
        <dd>{d.radius}</dd>
        {d.cls && (
          <>
            <dt>Bonus / Die</dt>
            <dd>
              +{d.classBonus} / {d.classDie}
            </dd>
          </>
        )}
      </dl>
      {d.issues.length > 0 ? (
        <details className="issues">
          <summary>{d.issues.length} thing(s) left to do</summary>
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
      ) : (
        <p className="ok-text">✓ Character complete</p>
      )}
    </aside>
  );
}

function Guide({ id, title = 'Rules' }: { id: string; title?: string }) {
  const n = getNode(id);
  if (!n) return null;
  return (
    <Collapsible title={<span className="muted">📖 {title}: {n.title}</span>}>
      <Html html={n.html} />
      {n.children?.map((ch) => <RuleBlock key={ch.id} node={ch} depthOffset={n.depth} />)}
    </Collapsible>
  );
}

// ---------- steps ----------

function Basics({ c, d, update }: StepProps) {
  const gritty = allNodes().find((n) => /heroic\s*&\s*gritty/i.test(n.title));
  return (
    <div className="form">
      <Guide id="player-characters/character-creation/envisioning-your-character" title="Start here" />
      <label className={needs(d, 'name')}>
        Character name
        <input value={c.name} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} placeholder="Name your character" />
      </label>
      <label>
        Player
        <input value={c.player} onChange={(e) => update((x) => ({ ...x, player: e.target.value }))} />
      </label>
      <label>
        Starting level
        <select value={c.level} onChange={(e) => update((x) => ({ ...x, level: Number(e.target.value) }))}>
          {Array.from({ length: d.maxLevel }, (_, i) => i + 1).map((l) => (
            <option key={l} value={l}>
              Level {l}
            </option>
          ))}
        </select>
        <small className="muted">The alpha rules cover levels 1–{d.maxLevel}. Use “Level Up” on the sheet to advance an existing character.</small>
      </label>
      <fieldset>
        <legend>Resting rules</legend>
        <label className="inline">
          <input type="radio" checked={c.settings.restRules === 'heroic'} onChange={() => update((x) => ({ ...x, settings: { ...x.settings, restRules: 'heroic' } }))} />
          Heroic (default)
        </label>
        <label className="inline">
          <input type="radio" checked={c.settings.restRules === 'gritty'} onChange={() => update((x) => ({ ...x, settings: { ...x.settings, restRules: 'gritty' } }))} />
          Gritty
        </label>
        {gritty && <Html html={gritty.html} className="note" />}
      </fieldset>
    </div>
  );
}

function rollPool(): number {
  const r = Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 4)).sort((a, b) => b - a);
  return r.slice(0, 4).reduce((s, x) => s + x, 0) + 1;
}

function Attributes({ c, d, update }: StepProps) {
  const at = c.attributes;
  const setBase = (a: Attr, v: number) => update((x) => ({ ...x, attributes: { ...x.attributes, base: { ...x.attributes.base, [a]: v } } }));
  const bonusCount = d.facets.flatMap((f) => f.effects ?? []).filter((e) => e.kind === 'attributePoint').reduce((s, e) => s + (e.kind === 'attributePoint' ? e.count : 0), 0);
  const remaining = at.pool - d.pointBuy.spent;
  return (
    <div className="form">
      <Guide id="player-characters/character-creation/assigning-attributes" />
      <fieldset>
        <legend>Method (your PM decides)</legend>
        <label className="inline">
          <input
            type="radio"
            checked={at.method === 'pointBuy'}
            onChange={() => update((x) => ({ ...x, attributes: { ...x.attributes, method: 'pointBuy', pool: POINT_BUY_POOL } }))}
          />
          Point Buy (12 points)
        </label>
        <label className="inline">
          <input type="radio" checked={at.method === 'rolled'} onChange={() => update((x) => ({ ...x, attributes: { ...x.attributes, method: 'rolled' } }))} />
          Rolled pool (5d4, drop lowest, +1)
        </label>
        <label className="inline">
          <input type="radio" checked={at.method === 'manual'} onChange={() => update((x) => ({ ...x, attributes: { ...x.attributes, method: 'manual' } }))} />
          Manual (e.g. 1d4−1 each)
        </label>
      </fieldset>
      {at.method === 'rolled' && (
        <div className="row">
          <label>
            Points to spend
            <input type="number" min={0} value={at.pool} onChange={(e) => update((x) => ({ ...x, attributes: { ...x.attributes, pool: Number(e.target.value) } }))} />
          </label>
          <button type="button" onClick={() => update((x) => ({ ...x, attributes: { ...x.attributes, pool: rollPool() } }))}>
            🎲 Roll 5d4
          </button>
        </div>
      )}
      {at.method !== 'manual' && (
        <p className={needs(d, 'attr-points', `points-left ${remaining === 0 ? 'ok' : remaining < 0 ? 'over' : ''}`)}>
          {remaining} of {at.pool} points remaining · cap {d.pointBuy.cap} per Attribute at level {d.level}, including bonus points
        </p>
      )}
      <div className="attr-grid">
        {ATTRS.map((a) => (
          <div key={a} className={needs(d, `attr:${a}`, 'attr-card')}>
            <div className="attr-head">
              <Icon name={a} /> <strong>{ATTR_NAMES[a]}</strong>
            </div>
            <span className="small muted">Assigned points</span>
            <Stepper
              label={a}
              value={at.base[a]}
              min={at.method === 'manual' ? -6 : -1}
              // The cap applies to the final points, so bonus points count toward it.
              max={at.method === 'manual' ? 12 : at.base[a] + d.pointBuy.cap - d.attrs[a].points}
              onChange={(v) => {
                if (at.method !== 'manual' && v > at.base[a] && remaining <= 0) return;
                setBase(a, v);
              }}
            />
            <div className="attr-final">
              Final: <strong>{d.attrs[a].points}</strong> points · Mod Die <strong>{d.attrs[a].label}</strong>
              {d.attrs[a].sources.length > 1 && <div className="small muted">{d.attrs[a].sources.join(' ')}</div>}
              {d.attrs[a].dieNote && <div className="small muted">{d.attrs[a].dieNote}</div>}
            </div>
            <Collapsible title={<span className="muted">What {ATTR_NAMES[a]} does</span>}>
              <FacetText contentId={`beyond-the-prism/attributes/${ATTR_NAMES[a].toLowerCase()}-${a.toLowerCase()}`} />
            </Collapsible>
          </div>
        ))}
      </div>
      {bonusCount > 0 && (
        <fieldset className={needs(d, 'attr-bonus')}>
          <legend>Bonus Attribute Point{bonusCount > 1 ? 's' : ''} (from your Ancestry)</legend>
          {Array.from({ length: bonusCount }, (_, i) => (
            <select
              key={i}
              value={at.bonus[i] ?? ''}
              onChange={(e) =>
                update((x) => {
                  const bonus = [...x.attributes.bonus];
                  bonus[i] = e.target.value as Attr;
                  return { ...x, attributes: { ...x.attributes, bonus: bonus.filter(Boolean) } };
                })
              }
            >
              <option value="">Choose…</option>
              {ATTRS.map((a) => {
                // Points without this bonus slot: an Attribute already at the cap can't take it.
                const without = d.attrs[a].points - (at.bonus[i] === a ? 1 : 0);
                const atCap = at.method !== 'manual' && without >= d.pointBuy.cap;
                return (
                  <option key={a} value={a} disabled={atCap}>
                    {a}
                    {atCap ? ` (at the cap of ${d.pointBuy.cap})` : ''}
                  </option>
                );
              })}
            </select>
          ))}
        </fieldset>
      )}
      <Guide id="beyond-the-prism/attributes/attribute-points-modifier-dice" title="Reference" />
    </div>
  );
}

function Ancestry({ c, d, update }: StepProps) {
  const anc = ancestryById.get(c.ancestry);
  return (
    <div className="form">
      <Guide id="player-characters/character-creation/choosing-an-ancestry" />
      <div className={needs(d, 'ancestry', 'card-grid')}>
        {[...ancestries, CUSTOM_ANCESTRY].map((a) => (
          <button
            key={a.id}
            type="button"
            className={`pick-card ${c.ancestry === a.id ? 'selected' : ''}`}
            onClick={() => update((x) => ({ ...x, ancestry: a.id, subAncestry: x.ancestry === a.id ? x.subAncestry : '' }))}
          >
            <strong>{a.name}</strong>
            <small>{a === CUSTOM_ANCESTRY ? 'Your own ancestry, with facets you add as Homebrew facets.' : excerpt(getNode(a.contentId)?.html, 90)}</small>
          </button>
        ))}
      </div>
      {anc && (
        <div className="detail">
          {anc.subAncestries && (
            <label className={needs(d, 'subancestry')}>
              Sub-ancestry
              <select value={c.subAncestry} onChange={(e) => update((x) => ({ ...x, subAncestry: e.target.value }))}>
                <option value="">Choose…</option>
                {anc.subAncestries.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {anc === CUSTOM_ANCESTRY ? (
            <>
              <label>
                Ancestry name
                <input value={c.customAncestryName ?? ''} onChange={(e) => update((x) => ({ ...x, customAncestryName: e.target.value }))} placeholder="e.g. Kobold" />
              </label>
              <p className="note">{CUSTOM_ANCESTRY_NOTE}</p>
            </>
          ) : (
            <RuleBlock node={getNode(anc.contentId)!} />
          )}
        </div>
      )}
    </div>
  );
}

function Background({ c, d, update }: StepProps) {
  const preset = backgroundById.get(c.background.preset);
  const applyPreset = (id: string) =>
    update((x) => {
      const b = backgroundById.get(id);
      const skills = { ...x.skills };
      if (b) {
        skills['bg-prof-1'] = b.profession;
        skills['bg-hobby-1'] = b.hobbies[0];
        skills['bg-hobby-2'] = b.hobbies[1];
      }
      return { ...x, background: { preset: id, heritage: b ? b.heritage : x.background.heritage }, skills };
    });
  const setSkill = (id: string, name: string) => update((x) => ({ ...x, skills: { ...x.skills, [id]: name } }));
  const hobbies = d.skillSlots.filter((s) => s.kind === 'hobby');
  const profs = d.skillSlots.filter((s) => s.kind === 'profession');
  const her = heritageById.get(c.background.heritage);
  return (
    <div className="form">
      <Guide id="player-characters/character-creation/choosing-a-background" />
      <label>
        Background
        <select value={c.background.preset} onChange={(e) => applyPreset(e.target.value)}>
          <option value="">Custom (make your own)</option>
          {backgrounds.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {preset && <FacetText contentId={preset.contentId} />}
      <label className={needs(d, 'heritage')}>
        Heritage Facet
        <select value={c.background.heritage} onChange={(e) => update((x) => ({ ...x, background: { ...x.background, heritage: e.target.value } }))}>
          <option value="">Choose…</option>
          {heritageFacets.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </label>
      {her && <FacetText contentId={her.contentId} />}
      <h3>Professions</h3>
      <SkillTable d={d} slots={profs} setSkill={setSkill} />
      <h3>Hobbies</h3>
      <SkillTable d={d} slots={hobbies} setSkill={setSkill} />
      <Guide id="beyond-the-prism/hobbies-professions/guidelines-for-hobbies-professions" title="Guidelines" />
    </div>
  );
}

function SkillTable({ d, slots, setSkill }: { d: Derived; slots: Derived['skillSlots']; setSkill: (id: string, name: string) => void }) {
  return (
    <table className="skill-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Rank</th>
          <th>Die</th>
          <th>From</th>
        </tr>
      </thead>
      <tbody>
        {slots.map((s) => (
          <tr key={s.id} className={needs(d, `skill:${s.id}`)}>
            <td>
              <input
                value={s.name}
                placeholder={s.suggested ?? (s.social ? 'Social hobby (involves people)' : s.kind === 'hobby' ? 'e.g. Oil Painting' : 'e.g. Blacksmith')}
                onChange={(e) => setSkill(s.id, e.target.value)}
                aria-label={`${s.kind} from ${s.source}`}
              />
              {s.suggested && !s.name && (
                <button type="button" className="link small" onClick={() => setSkill(s.id, s.suggested!)}>
                  use “{s.suggested}”
                </button>
              )}
            </td>
            <td>{s.rank}</td>
            <td>{RANK_DIE[s.rank]}</td>
            <td className="muted">{s.source}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LightPick({ c, d, update, pickKey, label }: { c: Character; d: Derived; update: Update; pickKey: string; label: string }) {
  return (
    <label className={needs(d, `light:${pickKey}`)}>
      {label}
      <select
        value={c.alignment.picks[pickKey] ?? ''}
        onChange={(e) => update((x) => ({ ...x, alignment: { ...x.alignment, picks: { ...x.alignment.picks, [pickKey]: e.target.value as Light } } }))}
      >
        <option value="">Choose a Light…</option>
        {LIGHTS.map((l) => (
          <option key={l}>{l}</option>
        ))}
      </select>
    </label>
  );
}

function ClassStep({ c, d, update }: StepProps) {
  const cls = d.cls;
  const subs = cls ? subclassesOf(cls) : [];
  const sub = subs.find((s) => s.id === c.subclass);
  return (
    <div className="form">
      <Guide id="player-characters/character-creation/choosing-a-class" />
      <div className={needs(d, 'class', 'card-grid')}>
        {classes.map((k) => (
          <button
            key={k.id}
            type="button"
            className={`pick-card ${c.classId === k.id ? 'selected' : ''}`}
            onClick={() => update((x) => (x.classId === k.id ? x : { ...x, classId: k.id, subclass: '', choices: {}, spells: {} }))}
          >
            <strong>{k.name}</strong>
            <small>{excerpt(getNode(k.contentId)?.html, 110)}</small>
          </button>
        ))}
      </div>
      {cls && (
        <div className="detail">
          <ClassTableView c={c} />
          <label className={needs(d, 'subclass')}>
            {cls.subclassLabel}
            <select value={c.subclass} onChange={(e) => update((x) => ({ ...x, subclass: e.target.value }))}>
              <option value="">Choose…</option>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {sub && (
            <Collapsible title={<strong>{sub.name}</strong>} defaultOpen>
              <FacetText contentId={sub.contentId} />
            </Collapsible>
          )}
          {classAlignment(cls) === 'choice' && <LightPick c={c} d={d} update={update} pickKey="class" label={`${cls.name} Alignment`} />}
          {d.choices.map((ch) => (
            <div key={ch.id} className={needs(d, `choice:${ch.id}`)}>
              <ChoicePicker choice={ch} onPick={(id) => update((x) => ({ ...x, choices: { ...x.choices, [ch.id]: id } }))} />
            </div>
          ))}
          <h3>Class features</h3>
          {(getNode(cls.contentId)?.children ?? [])
            .filter((n) => !/class-table$/.test(n.id) && (n.lvl === undefined ? !/~\d$/.test(n.id) : n.lvl <= d.level))
            .map((n) => (
              <Collapsible
                key={n.id}
                title={
                  <>
                    <span dangerouslySetInnerHTML={{ __html: n.titleHtml }} /> {n.lvl !== undefined && <span className="badge">Level {n.lvl}</span>}
                  </>
                }
                defaultOpen={n.lvl === undefined}
              >
                <FacetText contentId={n.id} />
              </Collapsible>
            ))}
        </div>
      )}
    </div>
  );
}

export function ClassTableView({ c }: { c: Character }) {
  const d = derive(c);
  if (!d.cls) return null;
  const t = classTable(d.cls);
  return (
    <div className="table-wrap">
      <table className="class-table">
        <thead>
          <tr>
            {t.headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.level} className={r.level === d.level ? 'current' : ''}>
              {t.headers.map((h) => (
                <td key={h}>{r.columns[h]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Spells({ c, d, update }: StepProps) {
  const known = d.spellLists.filter((l) => l.def.mode === 'known' && l.def.id !== 'granted');
  const granted = d.spellLists.find((l) => l.def.id === 'granted');
  if (!d.cls) return <p>Choose a class first.</p>;
  return (
    <div className="form">
      {known.length === 0 && <p className="muted">Your class has no spells or maneuvers to choose at this level.</p>}
      {granted && (
        <p>
          Granted by facets: {granted.granted.map((g) => g.name).join(', ')}
        </p>
      )}
      {known.map((l) => (
        <div key={`${l.source}-${l.def.id}`} className={needs(d, `spells:${l.def.id}`)}>
          <SpellListEditor list={l} selectedIds={c.spells[l.def.id] ?? []} onChange={(ids) => update((x) => ({ ...x, spells: { ...x.spells, [l.def.id]: ids } }))} />
        </div>
      ))}
      {d.spellLists.some((l) => l.def.mode === 'prepared') && (
        <p className="note">Prepared spells are chosen each Long Rest on the character sheet’s Spells & Maneuvers tab.</p>
      )}
    </div>
  );
}

function Details({ c, d, update }: StepProps) {
  const al = c.alignment;
  const setAl = (k: 'situations' | 'problems' | 'people', v: string) => update((x) => ({ ...x, alignment: { ...x.alignment, [k]: v } }));
  const needsAny = d.alignmentChoices.some((a) => a.pickKey === 'personal');
  // Facets that grant "an Alignment of your choice".
  const effectPicks = d.alignmentChoices.filter((a) => a.pickKey.startsWith('effect:'));
  const gods = getNode('player-characters/character-creation/devotion')?.children ?? [];
  const setDetail = (k: keyof Character['details'], v: string) => update((x) => ({ ...x, details: { ...x.details, [k]: v } }));
  return (
    <div className="form">
      <h3>Personal Alignment</h3>
      <Guide id="player-characters/character-creation/alignment" />
      <p>I respond to new…</p>
      <div className="row wrap">
        {(
          [
            ['situations', 'Situations with…', ['Action', 'Patience']],
            ['problems', 'Problems with…', ['Reason', 'Instinct']],
            ['people', 'People with…', ['Apathy', 'Empathy']],
          ] as const
        ).map(([k, label, opts]) => (
          <fieldset key={k} className={needs(d, `alignment:${k}`)}>
            <legend>{label}</legend>
            {opts.map((o) => (
              <label key={o} className="inline">
                <input type="radio" checked={al[k] === o} onChange={() => setAl(k, o)} /> {o}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {(needsAny || c.alignment.picks.personal) && <LightPick c={c} d={d} update={update} pickKey="personal" label="Your answers grant any Light:" />}
      {effectPicks.map((a) => (
        <LightPick key={a.pickKey} c={c} d={d} update={update} pickKey={a.pickKey} label={`${a.source} grants an Alignment of your choice:`} />
      ))}
      <div className="alignment-list">
        {d.alignment.map((a) => (
          <span key={a.light} className={`chip light-${a.light.toLowerCase()}`} title={a.sources.join(', ')}>
            {a.light} {['', 'Weak', 'Firm', 'Strong'][a.level]}
          </span>
        ))}
      </div>

      <h3>Age</h3>
      <label>
        Age
        <input value={c.details.age} onChange={(e) => setDetail('age', e.target.value)} />
      </label>
      <p className="muted">
        Age-up by 10 years to gain two Hobbies and one Profession at Proficient Rank, for 1 <Icon name="VIG" />, <Icon name="AGI" /> or <Icon name="PER" /> Point each time.
      </p>
      <div className="row wrap">
        {c.ageUps.map((a, i) => (
          <span key={i} className="chip">
            Age-up {i + 1}: −1 <Icon name={a} />{' '}
            <button type="button" className="link" onClick={() => update((x) => ({ ...x, ageUps: x.ageUps.filter((_, j) => j !== i) }))}>
              ✕
            </button>
          </span>
        ))}
        {(['VIG', 'AGI', 'PER'] as Attr[]).map((a) => (
          <button key={a} type="button" onClick={() => update((x) => ({ ...x, ageUps: [...x.ageUps, a] }))}>
            Age up (−1 <Icon name={a} />)
          </button>
        ))}
      </div>
      {c.ageUps.length > 2 && <p className="note">The rules recommend aging up no more than twice.</p>}

      <h3>Devotion</h3>
      <label>
        Deity (optional)
        <select value={c.details.devotion} onChange={(e) => setDetail('devotion', e.target.value)}>
          <option value="">None</option>
          {gods.map((g) => (
            <option key={g.id}>{g.title}</option>
          ))}
        </select>
      </label>
      {c.details.devotion && <FacetText contentId={gods.find((g) => g.title === c.details.devotion)?.id} />}

      <h3>Description</h3>
      <label>
        Appearance
        <textarea rows={3} value={c.details.appearance} onChange={(e) => setDetail('appearance', e.target.value)} />
      </label>
      <label>
        Backstory, friends & rivals
        <textarea rows={5} value={c.details.backstory} onChange={(e) => setDetail('backstory', e.target.value)} />
      </label>
    </div>
  );
}

export function Equipment({ c, d, update }: StepProps) {
  const [weapon, setWeapon] = useState('');
  const groups = [...new Set(weapons.map((w) => w.group))];
  const armor = c.equipment.armor;
  const setEq = (fn: (e: Character['equipment']) => Character['equipment']) => update((x) => ({ ...x, equipment: fn(x.equipment) }));
  return (
    <div className="form">
      {/* Inventory first, with the pyramids above the item list. */}
      <section className="box" data-tour="equipment">
      <h3 className="box-title">Inventory</h3>
      <BulkPyramid c={c} d={d} update={update} />
      <InventoryEditor c={c} update={update} />
      </section>


      {/* Weapons (two thirds) beside Armor. */}
      <div className="equip-row">
        <section className="box equip-weapons">
        <h3 className="box-title">Weapons</h3>
        <p className="muted">
          Weapon training: {d.weaponTraining}. <RuleLink id="equipment/weapons/weapon-properties">Weapon properties</RuleLink>
        </p>
        <div className="row">
          <select value={weapon} onChange={(e) => setWeapon(e.target.value)} aria-label="Weapon">
            <option value="">Add a weapon…</option>
            <option disabled={c.equipment.weapons.some((w) => w.name === UNARMED)}>{UNARMED}</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {weapons
                  .filter((w) => w.group === g)
                  .map((w) => (
                    <option key={w.name}>{w.name}</option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            disabled={!weapon}
            onClick={() => {
              setEq((q) => ({ ...q, weapons: [...q.weapons, { id: newId(), name: weapon }] }));
              setWeapon('');
            }}
          >
            Add
          </button>
        </div>
        <WeaponTable c={c} d={d} onRemove={(id) => setEq((q) => ({ ...q, weapons: q.weapons.filter((w) => w.id !== id) }))} />
        </section>
        <section className="box">
        <h3 className="box-title">Armor</h3>
        <div className="row wrap">
          <label>
            Type
            <select
              value={armor?.type ?? ''}
              onChange={(e) => setEq((q) => ({ ...q, armor: e.target.value ? { type: e.target.value as 'Light', quality: q.armor?.quality ?? 'Basic' } : null }))}
            >
              <option value="">No armor</option>
              <option>Light</option>
              <option>Medium</option>
              <option>Heavy</option>
            </select>
          </label>
          {armor && (
            <label>
              Quality
              <select value={armor.quality} onChange={(e) => setEq((q) => ({ ...q, armor: { ...armor, quality: e.target.value } }))}>
                {armorQualities.map((a) => (
                  <option key={a.quality}>{a.quality}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p>
          AC <strong>{d.ac.value}</strong> <span className="muted">
            (<TokenText text={d.ac.breakdown.join('; ')} />)
          </span>
        </p>
        {d.armorNotes.map((n) => (
          <p key={n} className="note">
            <TokenText text={n} />
          </p>
        ))}
        <p className="muted">
          Armor training: {d.armorTraining}. <RuleLink id="equipment/armor">Armor rules</RuleLink>
        </p>
        </section>
      </div>

    </div>
  );
}

/** The weapon-list entry for Unarmed Strikes: your body plus any natural weapons (claws, horns…). */
export const UNARMED = 'Unarmed Strike';

export function WeaponTable({ c, d, onRemove }: { c: Character; d: Derived; onRemove?: (id: string) => void }) {
  const unarmed = c.equipment.weapons.find((w) => w.name === UNARMED);
  // Your weapons, plus homebrew items that are weapons (named, with the base weapon's stats).
  const rows = [
    ...c.equipment.weapons.filter((w) => w !== unarmed).map((w) => ({ id: w.id, name: w.name, base: w.name, homebrew: false })),
    ...d.homebrew.filter((h) => h.entry.kind === 'item' && h.entry.baseWeapon).map((h) => ({ id: h.entry.id, name: h.entry.name, base: h.entry.baseWeapon!, homebrew: true })),
  ];
  return (
    <div className="table-wrap">
      <table className="weapons">
        <thead>
          <tr>
            <th>Weapon</th>
            <th>Mod Die</th>
            <th>DV / Deadly DV</th>
            <th>Damage</th>
            <th>Properties</th>
            {onRemove && <th />}
          </tr>
        </thead>
        <tbody>
          {/* Unarmed Strike, when picked: your body, plus any natural weapons (you Unarmed Strike with them). */}
          {(unarmed ? d.unarmed : []).map((u, i) => (
            <tr key={u.name} className="unarmed-row">
              <td className="w-name">
                {u.name}
                {u.sources.length > 0 && <div className="muted small">{u.sources.join(', ')}</div>}
              </td>
              <td className="w-die" data-label="Mod Die">
                {u.classDie ? d.classDie : <WeaponDie name={u.name} props={u.properties} d={d} />}
              </td>
              <td className="w-dv" data-label="DV">
                {u.dv} / {u.deadlyDv}
              </td>
              <td className="w-dmg">{u.damage}</td>
              <td className="w-props small">
                <PropertyLinks props={u.properties} />
              </td>
              {onRemove && (
                <td className="w-remove">
                  {i === 0 && (
                    <button type="button" className="icon-btn" onClick={() => onRemove(unarmed!.id)} aria-label={`Remove ${UNARMED}`}>
                      ✕
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {rows.map((we) => {
            const w = weapons.find((x) => x.name === we.base);
            const unmet = w?.requirements
              .split(',')
              .map((r) => r.trim().split(' '))
              .filter(([a, n]) => a && d.attrs[a as Attr] && d.attrs[a as Attr].points < Number(n));
            return (
              <tr key={we.id}>
                <td className="w-name">
                  {we.name}
                  {we.homebrew && <div className="muted small">{we.base}</div>}
                  {unmet && unmet.length > 0 && (
                    <div className="warn small" title="You have Disadvantage on Weapon Attack Checks without meeting the requirements.">
                      Needs {w!.requirements}
                    </div>
                  )}
                </td>
                <td className="w-die" data-label="Mod Die">
                  {w ? <WeaponDie name={we.name} props={w.properties} d={d} /> : '—'}
                </td>
                <td className="w-dv" data-label="DV">
                  {w?.dv} / {w?.deadlyDv}
                </td>
                <td className="w-dmg">{w?.damage}</td>
                <td className="w-props small">
                  <PropertyLinks props={w?.properties ?? []} />
                </td>
                {onRemove && !we.homebrew && (
                  <td className="w-remove">
                    <button type="button" className="icon-btn" onClick={() => onRemove(we.id)} aria-label={`Remove ${we.name}`}>
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Mod Die choices for a weapon's Attack Checks. The cell shows just the dice;
 * tapping it opens what each die is (and Combat Style Tandem/Bolstered/notes).
 */
/** Weapon properties, each linked to its rules section. */
function PropertyLinks({ props }: { props: string[] }) {
  return (
    <>
      {props.map((p, i) => {
        const node = weaponPropertyNode(p);
        return (
          <span key={p}>
            {i > 0 && ', '}
            {node ? (
              <RuleLink id={node.id}>
                <TokenText text={p} />
              </RuleLink>
            ) : (
              <TokenText text={p} />
            )}
          </span>
        );
      })}
    </>
  );
}

function WeaponDie({ name, props, d }: { name: string; props: string[]; d: Derived }): ReactNode {
  const [open, setOpen] = useState(false);
  const has = (p: string) => props.some((x) => x.toLowerCase().startsWith(p.toLowerCase()));
  const ranged = has('Ranged') || has('Drawn');
  const attrOpt = (a: Attr) => ({ attr: a, dice: d.attrs[a].label, label: `${ATTR_NAMES[a]} Die` });
  let opts: { attr?: Attr; dice: string; label: string }[] = [];
  if (ranged) opts.push(attrOpt('PER'));
  else {
    opts.push(attrOpt('VIG'));
    if (has('Deft')) opts.push(attrOpt('AGI'));
    if (has('Precise')) opts.push(attrOpt('PER'));
  }
  const classOpt = d.cls?.id === 'gladiator' ? { dice: d.classDie, label: `${d.cls.dieName} Die` } : undefined;
  if (classOpt) opts.push(classOpt);
  // Combat Styles apply by property; a homebrew weapon's own effects only to that weapon.
  const mods = d.weaponMods.filter((m) => (!m.weapon || m.weapon === name) && (!m.property || has(m.property)) && !(m.melee && ranged));
  // A Combat Style Tandem rolls the Attribute Die with the Martial Die and keeps the
  // higher, so it replaces rolling either of those dice alone.
  const tandems = mods.filter((m) => m.tandem);
  if (tandems.length && classOpt) {
    opts = [
      ...tandems.map((m) => ({ attr: m.tandem, dice: `${d.attrs[m.tandem!].label} / ${classOpt.dice}`, label: `${ATTR_NAMES[m.tandem!]} Die in Tandem with ${classOpt.label} (${m.source})` })),
      ...opts.filter((o) => o !== classOpt && !tandems.some((m) => m.tandem === o.attr)),
    ];
  }
  // Tandem with another die (a sentient item's): the property's Attribute (Precise → PER,
  // Deft → AGI), or every Attribute option when no property is given.
  const propAttr = (p?: string): Attr | undefined => (!p ? undefined : /precise|ranged|drawn/i.test(p) ? 'PER' : /deft/i.test(p) ? 'AGI' : 'VIG');
  for (const m of mods.filter((m) => m.tandemDie)) {
    opts = opts.map((o) =>
      o.attr && (!m.property || propAttr(m.property) === o.attr) && !o.dice.includes('/')
        ? { ...o, dice: `${o.dice} / ${m.tandemDie!.die}`, label: `${o.label} in Tandem with ${m.tandemDie!.name} Die${m.property ? ` (${m.property})` : ''}` }
        : o,
    );
  }
  const others = mods.filter((m) => !m.tandem && (m.bolster || m.note));
  return (
    <>
      <button type="button" className="link die-link" onClick={() => setOpen(true)} title="What these dice are">
        {opts.map((o) => o.dice).join(' or ')}
        {others.some((m) => m.bolster) && <sup>+</sup>}
      </button>
      {open && (
        <Modal title={`${name}: Mod Die`} onClose={() => setOpen(false)}>
          <p className="small muted">Roll one of these as the Mod Die for this weapon's Attack Checks.</p>
          <dl className="defs">
            {opts.map((o) => (
              <div key={o.label}>
                <dt>{o.dice}</dt>
                <dd>{o.label}</dd>
              </div>
            ))}
          </dl>
          {others.map((m, i) => (
            <p key={m.source + i} className="small">
              <strong>{m.source}:</strong> {m.property && m.weapon ? `With the ${m.property} property: ` : ''}
              {m.bolster ? `Attack Checks with this weapon are ${m.bolster > 0 ? 'Bolstered' : 'Hindered'} ${Math.abs(m.bolster)}. ` : ''}
              {m.note}
            </p>
          ))}
        </Modal>
      )}
    </>
  );
}

export function InventoryEditor({ c, update }: { c: Character; update: Update }) {
  const [name, setName] = useState('');
  const [bulk, setBulk] = useState('');
  const items = c.equipment.inventory;
  const shift = derive(c).bulkShift;
  const containers = items.filter((i) => i.container);
  const setItems = (fn: (i: typeof items) => typeof items) => update((x) => ({ ...x, equipment: { ...x.equipment, inventory: fn(x.equipment.inventory) } }));
  return (
    <div>
      <div className="row wrap">
        <input placeholder="Item" value={name} onChange={(e) => setName(e.target.value)} aria-label="Item name" />
        <select value={bulk} onChange={(e) => setBulk(e.target.value)} aria-label="Bulk rank">
          <option value="">Bulkless</option>
          {[1, 2, 3, 4, 5].map((b) => (
            <option key={b} value={b}>
              Bulk {b}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => {
            setItems((i) => [...i, { id: newId(), name: name.trim(), qty: 1, bulk: bulk ? Number(bulk) : undefined }]);
            setName('');
          }}
        >
          Add item
        </button>
        <RuleLink id="equipment/bulk">Bulk rules</RuleLink>
      </div>
      {items.length > 0 && (
        <table className="inventory">
          <thead>
            <tr>
              <th>Item</th>
              <th>Bulk</th>
              <th>#</th>
              <th>Notes</th>
              <th title="A backpack or similar with its own inventory pyramid">Backpack</th>
              {containers.length > 0 && <th>Stored in</th>}
              {shift > 0 && <th title="Powerful Build only applies to items on your person">In backpack</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td className="i-name">{it.name}</td>
                <td className="i-bulk" data-label="Bulk">
                  {it.bulk ?? '—'}
                </td>
                <td className="i-qty" data-label="Qty">
                  <Stepper label="quantity" value={it.qty} min={0} onChange={(v) => setItems((i) => i.map((x) => (x.id === it.id ? { ...x, qty: v } : x)))} />
                </td>
                <td className="i-notes">
                  <input
                    className="notes-input"
                    value={it.notes ?? ''}
                    placeholder="Notes"
                    aria-label={`Notes for ${it.name}`}
                    onChange={(e) => setItems((i) => i.map((x) => (x.id === it.id ? { ...x, notes: e.target.value } : x)))}
                  />
                </td>
                <td className="i-flag" data-label="Backpack">
                  <input
                    type="checkbox"
                    checked={!!it.container}
                    aria-label={`${it.name} has its own inventory pyramid`}
                    title="Gives this item its own inventory pyramid"
                    onChange={(e) => setItems((i) => i.map((x) => (x.id === it.id ? { ...x, container: e.target.checked || undefined, storedIn: undefined } : x)))}
                  />
                </td>
                {containers.length > 0 && (
                  <td className="i-flag" data-label={it.container ? undefined : 'Stored in'}>
                    {!it.container && (
                      <select
                        value={it.storedIn && containers.some((x) => x.id === it.storedIn) ? it.storedIn : ''}
                        aria-label={`Where ${it.name} is stored`}
                        onChange={(e) => setItems((i) => i.map((x) => (x.id === it.id ? { ...x, storedIn: e.target.value || undefined } : x)))}
                      >
                        <option value="">On you</option>
                        {containers.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                )}
                {shift > 0 && (
                  <td className="i-flag" data-label="In backpack">
                    <input
                      type="checkbox"
                      checked={!!it.inBackpack || (!!it.storedIn && containers.some((x) => x.id === it.storedIn))}
                      disabled={!!it.storedIn && containers.some((x) => x.id === it.storedIn)}
                      aria-label={`${it.name} is in a backpack`}
                      onChange={(e) => setItems((i) => i.map((x) => (x.id === it.id ? { ...x, inBackpack: e.target.checked } : x)))}
                    />
                  </td>
                )}
                <td className="i-remove">
                  <button type="button" className="icon-btn" onClick={() => setItems((i) => i.filter((x) => x.id !== it.id))} aria-label={`Remove ${it.name}`}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Review({ c, d, update }: StepProps) {
  return (
    <div className="form">
      {d.issues.length ? (
        <>
          <p>A few things are still open. You can finish them later — the sheet works either way.</p>
          <ul className="issues-list">
            {d.todo.map((t) => (
              <li key={t.text}>
                <a href={`#/c/${encodeURIComponent(c.id)}/build/${t.step}`}>
                  {t.text}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="ok-text">✓ Everything required for level {d.level} is filled in.</p>
      )}
      <p>
        Opening the sheet starts {c.name || 'your character'} fully rested ({d.enduranceMax} Endurance, {d.vitalityMax} Vitality, {d.radianceMax} Radiance).
      </p>
      <button
        type="button"
        className="primary"
        onClick={() => {
          update((x) => ({ ...x, play: freshPlay(x) }));
          go('c', c.id);
        }}
      >
        Finish & open sheet (full rest)
      </button>
    </div>
  );
}
