import { createContext, useContext, useState } from 'react';
import type { Character, PlayState } from '../engine/character';
import { derive, type Derived } from '../engine/derive';
import { activationUseKey, apChoice, apCost, needsPrompt, performUse, useMax, type UseInputs, type UseRequest } from '../engine/activations';
import { clampPlay, facetUseMax } from '../engine/play';
import { Modal } from './common';

/** What a Use button needs from the sheet: the character, and how to save and report changes. */
export interface PlayApi {
  c: Character;
  d: Derived;
  update: (fn: (c: Character) => Character) => void;
  onLog: (lines: string[], undo?: PlayState) => void;
}

export const PlayContext = createContext<PlayApi | null>(null);

/** A button that spends an Action's costs and applies its effects, asking for any input first. */
export function UseButton({ req, label, primary, disabled, hideCost }: { req: UseRequest; label?: string; primary?: boolean; disabled?: boolean; /** The cost is shown elsewhere; only show CAP/Stunned extras. */ hideCost?: boolean }) {
  const api = useContext(PlayContext);
  const [open, setOpen] = useState(false);
  if (!api) return null;
  const { c, d, update, onLog } = api;
  const def = req.def;
  const max = def ? useMax(def, d) : 0;
  const used = def?.uses ? (c.play.facetUses[activationUseKey(def)] ?? 0) : 0;
  const facet = req.facetKey ? d.facets.find((f) => f.key === req.facetKey) : undefined;
  const facetLeft = facet ? facetUseMax(facet, d) - (c.play.facetUses[facet.key] ?? 0) : Infinity;
  const outOfUses = (def?.uses && used >= max) || facetLeft <= 0;
  const cost = apCost(req, c.play, d);
  const choice = apChoice(req, d);
  const apText = hideCost ? (cost.parts.length ? `${cost.total} AP` : '') : choice ? `${choice.min}–${choice.max} AP` : cost.total ? `${cost.total} AP` : '';

  const apply = (inputs: UseInputs) =>
    update((x) => {
      const dx = derive(x);
      const r = performUse(x, dx, req, inputs);
      onLog(r.log, x.play);
      return { ...x, play: clampPlay(r.play, derive({ ...x, play: r.play })) };
    });

  return (
    <span className="use" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`use-btn ${primary ? 'primary' : ''}`}
        disabled={disabled || outOfUses}
        title={outOfUses ? 'No uses left' : undefined}
        onClick={() => (needsPrompt(req, d) ? setOpen(true) : apply({}))}
      >
        {label ?? def?.label ?? 'Use'}
        {apText && <span className="use-cost"> · {apText}</span>}
      </button>
      {def?.uses && (
        <span className="muted small">
          {' '}
          {max - used}/{max}
        </span>
      )}
      {open && <UseDialog req={req} onClose={() => setOpen(false)} onConfirm={(i) => (apply(i), setOpen(false))} />}
    </span>
  );
}

function UseDialog({ req, onClose, onConfirm }: { req: UseRequest; onClose: () => void; onConfirm: (i: UseInputs) => void }) {
  const api = useContext(PlayContext)!;
  const { c, d } = api;
  const def = req.def;
  const choice = apChoice(req, d);
  const [ap, setAp] = useState(choice?.min ?? 0);
  const [mod, setMod] = useState('');
  const [outcome, setOutcome] = useState(def?.inputs?.outcome?.[0] ?? '');
  const [amount, setAmount] = useState('');
  const [self, setSelf] = useState(false);
  const inputs: UseInputs = { ap: choice ? ap : undefined, mod: Number(mod) || 0, outcome, amount: Number(amount) || 0, self };
  const preview = performUse(c, d, req, inputs).log;
  const needMod = !!def?.inputs?.mod && (!def.inputs.modOutcomes || def.inputs.modOutcomes.includes(outcome));
  const missing = (needMod && mod === '') || (def?.inputs?.amount && amount === '');

  return (
    <Modal title={def?.label ?? req.name} onClose={onClose}>
      <form
        className="use-form"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(inputs);
        }}
      >
        {choice && (
          <label>
            AP to spend
            <select value={ap} onChange={(e) => setAp(Number(e.target.value))}>
              {Array.from({ length: choice.max - choice.min + 1 }, (_, i) => choice.min + i).map((n) => (
                <option key={n} value={n}>
                  {n} AP
                </option>
              ))}
            </select>
          </label>
        )}
        {def?.inputs?.outcome && (
          <fieldset className="outcomes">
            <legend>Result</legend>
            {def.inputs.outcome.map((o) => (
              <label key={o} className="inline">
                <input type="radio" name="outcome" checked={outcome === o} onChange={() => setOutcome(o)} /> {o}
              </label>
            ))}
          </fieldset>
        )}
        {needMod && (
          <label>
            {def?.inputs?.mod}
            <input className="num" type="number" inputMode="numeric" value={mod} onChange={(e) => setMod(e.target.value)} autoFocus placeholder="Value rolled" />
          </label>
        )}
        {def?.inputs?.amount && (
          <label>
            {def.inputs.amount}
            <input className="num" type="number" inputMode="numeric" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus={!needMod} />
          </label>
        )}
        {def?.target === 'either' && (
          <label className="inline">
            <input type="checkbox" checked={self} onChange={(e) => setSelf(e.target.checked)} /> I am the target
          </label>
        )}
        <div className="use-preview">
          <strong className="small">What happens</strong>
          <ul className="small">
            {preview.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
        <div className="row">
          <button type="submit" className="primary" disabled={!!missing}>
            Confirm
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
