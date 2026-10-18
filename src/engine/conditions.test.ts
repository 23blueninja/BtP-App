import { describe, expect, it } from 'vitest';
import { emptyPlay, type PlayState } from './character';
import { activeConditions, addCondition, conditionEffects, describeCheck, endTurn, startTurn } from './conditions';

const play = (conditions: PlayState['conditions'], extra: Partial<PlayState> = {}): PlayState => ({ ...emptyPlay(), endurance: 10, conditions, ...extra });

describe('condition effects', () => {
  it('Dulled hinders PRS Checks', () => {
    const fx = conditionEffects(play([{ name: 'Dulled', level: 2 }]));
    const prs = fx.checks.find((r) => r.attr === 'PRS' && !r.save)!;
    expect(describeCheck(prs)).toEqual(['Hindered 2 (Dulled 2)']);
  });

  it('adds Hindered levels from different Conditions', () => {
    const fx = conditionEffects(play([{ name: 'Dulled', level: 1 }, { name: 'Exhausted', level: 2 }]));
    const prs = fx.checks.find((r) => r.attr === 'PRS')!;
    expect(prs.hindered).toBe(3);
    expect(fx.checks.find((r) => r.attr === 'VIG')!.hindered).toBe(2);
    expect(fx.movementChange.value).toBe(-2);
  });

  it('expands implied Conditions at the higher level', () => {
    const names = activeConditions(play([{ name: 'Burning', level: 2 }, { name: 'Numbed', level: 1 }])).map((c) => `${c.name} ${c.level}`);
    expect(names).toContain('Numbed 2');
    const chain = activeConditions(play([{ name: 'Paralyzed', level: 1 }])).map((c) => c.name);
    expect(chain).toEqual(expect.arrayContaining(['Restrained', 'Seized', 'Immobilized']));
    expect(conditionEffects(play([{ name: 'Restrained' }])).movementChange.zero).toBe(true);
  });

  it('Buffeted reduces AC and ends at the start of your turn', () => {
    expect(conditionEffects(play([{ name: 'Buffeted', level: 2 }])).acChange.value).toBe(-2);
    expect(startTurn(play([{ name: 'Buffeted', level: 2 }]), 1, []).play.conditions).toEqual([]);
  });
});

describe('turns', () => {
  it('deals start-of-turn damage after Resistance', () => {
    const r = startTurn(play([{ name: 'Burning', level: 2 }, { name: 'Bleeding', level: 1 }]), 2, [{ type: 'Thermic', value: 1 }]);
    expect(r.damage).toEqual([
      { type: 'Thermic', amount: 5, source: 'Burning 2' },
      { type: 'Somatic', amount: 2, source: 'Bleeding 1' },
    ]);
  });

  it('Thermic damage reduces Freezing', () => {
    const r = startTurn(play([{ name: 'Burning', level: 1 }, { name: 'Freezing', level: 2 }]), 1, []);
    expect(r.play.conditions.find((c) => c.name === 'Freezing')?.level).toBe(1);
  });

  it('Dying only deals damage above 0 Endurance, minimum 1', () => {
    expect(startTurn(play([], { dying: 1, endurance: 0 }), 1, []).damage).toEqual([]);
    expect(startTurn(play([], { dying: 1 }), 1, [{ type: 'Somatic', value: 5 }]).damage[0].amount).toBe(1);
  });

  it('end of turn regains AP, drops temporary AP and ticks Conditions down', () => {
    const r = endTurn(play([{ name: 'Dissolving', level: 1 }, { name: 'Freezing', level: 2 }], { ap: 1, tempAp: 2, turn: { active: true } }));
    expect(r.play.ap).toBe(5);
    expect(r.play.tempAp).toBe(0);
    expect(r.play.conditions).toEqual([{ name: 'Freezing', level: 1 }]);
  });

  it('Paralyzed takes your AP and blocks regaining it', () => {
    const p = addCondition(play([], { ap: 4 }), 'Paralyzed', 2);
    expect(p.ap).toBe(0);
    const s = startTurn(p, 1, []);
    expect(s.play.conditions[0].level).toBe(1);
    expect(endTurn(s.play).play.ap).toBe(0);
  });

  it('keeps the higher level when a Condition is added again', () => {
    expect(addCondition(play([{ name: 'Burning', level: 3 }]), 'Burning', 1).conditions).toEqual([{ name: 'Burning', level: 3 }]);
  });
});
