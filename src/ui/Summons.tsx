import { useContext, useRef, useState } from 'react';
import { conditions as conditionDefs, getCastable } from '../content';
import { ATTRS, ATTR_NAMES } from '../data/types';
import type { Character, PlayState } from '../engine/character';
import { addCondition } from '../engine/conditions';
import { dieLabel } from '../engine/dice';
import {
  SUMMON_AP_MAX,
  damageSummon,
  endSummonTurn,
  fromPlay,
  healSummon,
  importCreatures,
  startSummonTurn,
  statBlock,
  summonDefenses,
  summonName,
  summonPlay,
  type Rated,
  type StatBlock,
  type Summon,
} from '../engine/summons';
import { PlayContext } from './Activate';
import { Collapsible, Icon, RuleLink, Stepper, TokenText } from './common';

type SetPlay = (fn: (p: PlayState) => PlayState) => void;

const rated = (xs: Rated[]) => xs.map((x) => (x.rating ? `${x.name} ${x.rating}` : x.name)).join(', ');

/** The Summons tab: each creature your spells summoned, with its stat block and its own Endurance, Conditions and AP. */
export function SummonsTab({ c, setPlay }: { c: Character; setPlay: SetPlay }) {
  const summons = c.play.summons ?? [];
  return (
    <div className="summons-tab">
      {summons.map((s) => (
        <SummonCard key={s.id} s={s} setPlay={setPlay} />
      ))}
    </div>
  );
}

function SummonCard({ s, setPlay }: { s: Summon; setPlay: SetPlay }) {
  const api = useContext(PlayContext);
  const [amount, setAmount] = useState('');
  const b = statBlock(s);
  const set = (fn: (s: Summon) => Summon) => setPlay((p) => ({ ...p, summons: (p.summons ?? []).map((x) => (x.id === s.id ? fn(x) : x)) }));
  const remove = () => setPlay((p) => ({ ...p, summons: (p.summons ?? []).filter((x) => x.id !== s.id) }));
  if (!b) {
    return (
      <section className="box summon-card">
        <p>This summon’s spell or creature is no longer in the app.</p>
        <button type="button" onClick={remove}>
          Dismiss
        </button>
      </section>
    );
  }
  const n = Math.max(0, Number(amount) || 0);
  const ap = s.ap ?? SUMMON_AP_MAX;
  const myTurn = !!s.turn?.active;
  const gone = s.endurance <= 0;
  const familiar = s.spell === 'spells/arcana/mind/summon-familiar';
  const log = (lines: string[]) => api?.onLog(lines.map((l) => `${summonName(s)}: ${l}`));
  return (
    <section className={`box summon-card ${gone ? 'gone' : ''}`} style={{ '--summon-border': b.border } as React.CSSProperties} aria-label={summonName(s)}>
      <div className="summon-head">
        <div className="summon-title">
          <input className="summon-name" value={s.name} placeholder={b.name} onChange={(e) => set((x) => ({ ...x, name: e.target.value }))} aria-label="Summon name" />
          <span className="muted small">
            {b.subtitle} · {getCastable(s.spell)?.name}
          </span>
        </div>
        <div className="summon-actions">
          {familiar && (
            <button
              type="button"
              title="Spends 1 of your AP during your turn"
              onClick={() => setPlay((p) => ({ ...p, ap: p.ap === undefined ? p.ap : Math.max(0, p.ap - 1), summons: (p.summons ?? []).map((x) => (x.id === s.id ? { ...x, stored: !x.stored } : x)) }))}
            >
              {s.stored ? 'Release from spinel' : 'Absorb into spinel'}
            </button>
          )}
          <button type="button" onClick={remove}>
            Dismiss
          </button>
        </div>
      </div>
      {s.stored && <p className="muted small">Contained in the spinel. Releasing it into an adjacent space costs 1 AP during your turn.</p>}
      {gone && <p className="summon-gone">0 Endurance: {b.atZero}</p>}
      <div className="summon-grid">
        <div className="summon-endurance">
          <div className="box-head">
            <h3 className="box-title">Endurance</h3>
            <span className="box-head-extra">
              <span className="muted small">Temp</span>
              <Stepper label="Temporary Endurance" value={s.tempEndurance} min={0} onChange={(v) => set((x) => ({ ...x, tempEndurance: v }))} />
            </span>
          </div>
          <div className="end-grid">
            <span className="end-current" aria-label={`Endurance ${s.endurance} of ${b.endurance}`}>
              {s.endurance}
            </span>
            <span className="end-max muted" aria-hidden>
              {b.endurance}
            </span>
            <button type="button" className="end-heal" disabled={!n} onClick={() => (set((x) => healSummon(x, n, b)), setAmount(''))}>
              Heal
            </button>
            <input className="end-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" aria-label="Amount" />
            <button type="button" className="danger end-damage" disabled={!n} onClick={() => (set((x) => damageSummon(x, n)), setAmount(''))}>
              Damage
            </button>
          </div>
        </div>
        <div className="summon-turn">
          <h3 className="box-title">
            <Icon name="AP" /> {ap}/{SUMMON_AP_MAX}
          </h3>
          <span className="pips" aria-label={`AP: ${ap} of ${SUMMON_AP_MAX} available`}>
            {Array.from({ length: SUMMON_AP_MAX }, (_, i) => {
              const on = i < ap;
              return (
                <button
                  key={i}
                  type="button"
                  className={`pip ${on ? 'on' : ''}`}
                  aria-label={on ? 'Spend AP' : 'Restore AP'}
                  title={on ? 'Spend AP' : 'Restore AP'}
                  onClick={() => set((x) => ({ ...x, ap: Math.max(0, Math.min(SUMMON_AP_MAX, (x.ap ?? SUMMON_AP_MAX) + (on ? -1 : 1))) }))}
                />
              );
            })}
          </span>
          <p className="muted small">Takes its turn after yours.</p>
          <div className="row wrap small-gap">
            <button
              type="button"
              className={myTurn ? '' : 'primary'}
              disabled={myTurn}
              onClick={() => {
                const r = startSummonTurn(s, b);
                set(() => r.summon);
                log(r.log);
              }}
            >
              ▶ Start
            </button>
            <button
              type="button"
              className={myTurn ? 'primary' : ''}
              disabled={!myTurn}
              onClick={() => {
                const r = endSummonTurn(s, b);
                set(() => r.summon);
                log(r.log);
              }}
            >
              ■ End
            </button>
          </div>
        </div>
        <div className="summon-conditions">
          <h3 className="box-title">Conditions</h3>
          <SummonConditions s={s} b={b} set={set} />
        </div>
      </div>
      <Collapsible title={<strong>Stat block</strong>}>
        <StatBlockView b={b} />
      </Collapsible>
    </section>
  );
}

function SummonConditions({ s, b, set }: { s: Summon; b: StatBlock; set: (fn: (s: Summon) => Summon) => void }) {
  const [pick, setPick] = useState('');
  const [pickLevel, setPickLevel] = useState(1);
  const pickDef = conditionDefs.find((x) => x.name === pick);
  const def = summonDefenses(b);
  const immune = new Set(def.immuneConditions);
  return (
    <div>
      {s.conditions.length === 0 && <p className="muted">None</p>}
      <ul className="plain">
        {s.conditions.map((cd, i) => {
          const cdef = conditionDefs.find((x) => x.name === cd.name);
          return (
            <li key={i} className="row between">
              <span>{cdef ? <RuleLink id={cdef.id}>{cd.name}</RuleLink> : cd.name}</span>
              {cdef?.leveled && (
                <Stepper label={`${cd.name} level`} value={cd.level ?? 1} min={1} onChange={(v) => set((x) => ({ ...x, conditions: x.conditions.map((y, j) => (j === i ? { ...y, level: v } : y)) }))} />
              )}
              <button type="button" className="icon-btn" onClick={() => set((x) => ({ ...x, conditions: x.conditions.filter((_, j) => j !== i) }))} aria-label={`Remove ${cd.name}`}>
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <div className="row condition-add">
        <select value={pick} onChange={(e) => (setPick(e.target.value), setPickLevel(1))} aria-label="Condition">
          <option value="">Add condition…</option>
          {conditionDefs
            .filter((x) => x.name !== 'Dying')
            .map((x) => (
              <option key={x.id} value={x.name} disabled={immune.has(x.name)}>
                {x.name}
                {immune.has(x.name) ? ' (Immune)' : ''}
              </option>
            ))}
        </select>
        {pickDef?.leveled && <Stepper label="Condition level" value={pickLevel} min={1} onChange={setPickLevel} />}
        <button
          type="button"
          disabled={!pick || immune.has(pick)}
          onClick={() => {
            // Gaining Burning or Dissolving deals damage through its Resistances and Immunities.
            set((x) => fromPlay(x, addCondition(summonPlay(x), pick, pickDef?.leveled ? pickLevel : undefined, { resistances: def.resistances, immune: def.immune, immuneConditions: def.immuneConditions })));
            setPick('');
            setPickLevel(1);
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/** A stat block in the rules' layout: numbers, Attributes, defences, then Traits, Weapons and Actions. */
export function StatBlockView({ b }: { b: StatBlock }) {
  const line = (label: React.ReactNode, value: React.ReactNode) => (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  return (
    <div className="stat-block" style={{ '--summon-border': b.border } as React.CSSProperties}>
      <h4 className="stat-block-name">{b.name}</h4>
      <p className="muted">
        <em>{b.subtitle}</em>
      </p>
      <dl className="defs">
        {line('Armor Class', `${b.armorClass}${b.armor ? ` (${b.armor})` : ''}`)}
        {line('Endurance', b.endurance)}
        {line('Movement', b.movement)}
        {b.senses.length > 0 && line('Senses', b.senses.join(', '))}
        {line(
          <>
            <Icon name="PER" /> Radius
          </>,
          b.perRadius,
        )}
      </dl>
      <div className="stat-block-attrs">
        {ATTRS.map((a) => (
          <div key={a} title={ATTR_NAMES[a]}>
            <Icon name={a} />
            <strong>{b.attributes[a]}</strong>
            <span className="muted small">{dieLabel(b.attributes[a])}</span>
          </div>
        ))}
      </div>
      <dl className="defs">
        {b.resistances.length > 0 && line('Resistances', rated(b.resistances))}
        {b.immunities.length > 0 && line('Immunities', rated(b.immunities))}
        {b.vulnerabilities.length > 0 && line('Vulnerabilities', rated(b.vulnerabilities))}
        {b.professions.length > 0 && line('Professions', b.professions.map((x) => `${x.name} +${x.mod}`).join(', '))}
        {b.hobbies.length > 0 && line('Hobbies', b.hobbies.map((x) => `${x.name} +${x.mod}`).join(', '))}
        {b.languages.length > 0 && line('Languages', b.languages.join(', '))}
        {line('Duration', b.duration)}
      </dl>
      {b.sections.map((sec) => (
        <div key={sec.title} className="stat-block-section">
          <h5>{sec.title}</h5>
          {sec.html && <div className="rules" dangerouslySetInnerHTML={{ __html: sec.html }} />}
          {sec.entries && (
            <dl className="defs">
              {sec.entries.map((e) => (
                <div key={e.name}>
                  <dt>
                    <TokenText text={e.name} />
                  </dt>
                  <dd>
                    {e.trigger && (
                      <em>
                        Trigger: <TokenText text={e.trigger} />;{' '}
                      </em>
                    )}
                    <TokenText text={e.text} />
                    {e.outcomes?.map((o) => (
                      <span key={o.label} className="outcome">
                        <strong>{o.label}</strong> <TokenText text={o.text} />
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Import Beasts and Ethereals for the Communion spells from a Monster Maker export
 * (a backup or a single monster's JSON). They're saved with the character.
 */
export function CreatureImport({ type }: { type: string }) {
  const api = useContext(PlayContext);
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<{ text: string; warn?: boolean } | null>(null);
  if (!api) return null;
  const { c, update } = api;
  const mine = c.creatures.filter((x) => x.type.split(/[\s,]+/).includes(type));
  return (
    <div className="creature-import">
      <button type="button" onClick={() => fileRef.current?.click()}>
        Import creature…
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Monster Maker export"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const r = importCreatures(JSON.parse(await f.text()));
            // Importing a creature again replaces the earlier copy.
            update((x) => ({ ...x, creatures: [...x.creatures.filter((y) => !r.creatures.some((n) => n.id === y.id)), ...r.creatures] }));
            const parts = [r.creatures.length ? `Imported ${r.creatures.map((x) => `${x.name} (${x.type})`).join(', ')}.` : 'Nothing imported.'];
            if (r.skipped.length) parts.push(`Skipped ${r.skipped.join(', ')}: only Beasts and Ethereals can be summoned.`);
            setNote({ text: parts.join(' '), warn: !r.creatures.length || r.skipped.length > 0 });
          } catch {
            setNote({ text: 'That file is not a Monster Maker export.', warn: true });
          }
        }}
      />
      {note && <span className={`small ${note.warn ? 'warn' : 'muted'}`}>{note.text}</span>}
      {mine.length > 0 && (
        <span className="creature-chips">
          {mine.map((x) => (
            <span key={x.id} className="chip">
              {x.name}
              <button type="button" className="icon-btn" aria-label={`Remove ${x.name}`} onClick={() => update((y) => ({ ...y, creatures: y.creatures.filter((z) => z.id !== x.id) }))}>
                ✕
              </button>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
