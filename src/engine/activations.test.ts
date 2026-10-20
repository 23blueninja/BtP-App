import { describe, expect, it } from 'vitest';
import { getNode } from '../content';
import { ACTIVATIONS, activationsFor, actionRequest, performUse, type UseRequest } from './activations';
import { newCharacter, type Character } from './character';
import { endTurn, startTurn } from './conditions';
import { parseCost } from './costs';
import { derive } from './derive';
import { freshPlay, shortRest } from './play';

function build(over: Partial<Character> = {}): Character {
  const { play, ...rest } = over;
  const c = { ...newCharacter(), name: 'Test', ...rest };
  return { ...c, play: { ...freshPlay(c), ap: 5, ...play } };
}

const castReq = (id: string, sl = 1, costText = '1 {AP}'): UseRequest => ({ key: id, name: id, cost: parseCost(costText), def: activationsFor(id)[0], sl });

describe('costs', () => {
  it('reads AP, Reaction, CAP and resource costs', () => {
    expect(parseCost('Reaction, 2 {AP}, Basic CAP')).toEqual({ ap: 2, reaction: true, cap: true, resources: [] });
    expect(parseCost('1-5 {AP}').ap).toEqual({ min: 1, max: 5 });
    expect(parseCost('1 Prisma, 2 {AP}')).toMatchObject({ ap: 2, resources: [{ name: 'Prisma', amount: 1 }] });
    expect(parseCost('{SL} Prisma, {AP} in spell’s Cast Time').ap).toBe(0);
    expect(parseCost('Varies').ap).toEqual({ min: 1, max: 5 });
  });
});

describe('activations', () => {
  it('attach to sections that exist in the rules', () => {
    for (const a of ACTIVATIONS) expect(getNode(a.id), a.id).toBeDefined();
  });

  it('spends AP, temporary AP first', () => {
    const c = build({ play: { tempAp: 1 } as never });
    const r = performUse(c, derive(c), { key: 'strike', name: 'Strike', cost: parseCost('2 {AP}'), sl: 0 });
    expect(r.play.tempAp).toBe(0);
    expect(r.play.ap).toBe(4);
  });

  it('adds Basic CAP for each earlier use this turn, and Stunned to Reactions', () => {
    let c = build();
    const req = { key: 'step', name: 'Step', cost: parseCost('2 {AP}, Basic CAP'), sl: 0 };
    c = { ...c, play: performUse(c, derive(c), req).play };
    expect(c.play.ap).toBe(3);
    c = { ...c, play: performUse(c, derive(c), req).play };
    expect(c.play.ap).toBe(0);
    const stunned = build({ play: { conditions: [{ name: 'Stunned', level: 2 }] } as never });
    const r = performUse(stunned, derive(stunned), { key: 'r', name: 'R', cost: parseCost('Reaction, 1 {AP}'), sl: 0 });
    expect(r.play.ap).toBe(2);
  });

  it('Brace adds the Mod Die roll to 5{SL} Temporary Endurance', () => {
    const c = build();
    expect(performUse(c, derive(c), castReq('maneuvers/feral/brace', 1, 'Reaction, 1 {AP}'), { mod: 3 }).play.tempEndurance).toBe(8);
  });

  it('Temporary Endurance keeps the higher amount', () => {
    const c = build({ play: { tempEndurance: 40 } as never });
    expect(performUse(c, derive(c), castReq('maneuvers/feral/brace'), { mod: 3 }).play.tempEndurance).toBe(40);
  });

  it('Ice Armor deals Arctic damage to you, then grants Temporary Endurance', () => {
    const c = build({ classId: 'arcanist', subclass: 'kinesis-triumvirate' });
    const d = derive(c);
    const r = performUse(c, d, castReq('spells/arcana/ice/ice-armor'));
    expect(r.play.endurance).toBe(d.enduranceMax - 5);
    expect(r.play.tempEndurance).toBe(25);
  });

  it('spells on "a creature" only change your sheet when you are the target', () => {
    const c = build({ play: { endurance: 1 } as never });
    const d = derive(c);
    const req = castReq('spells/evocations/platinum/radiant-renewal', 1, '1-5 {AP}');
    const other = performUse(c, d, req, { ap: 3, mod: 4, outcome: 'Success', self: false });
    expect(other.play.endurance).toBe(1);
    expect(other.log).toContain('Target: regains 21 Endurance.');
    expect(performUse(c, d, req, { ap: 3, mod: 4, outcome: 'Success', self: true }).play.endurance).toBe(Math.min(d.enduranceMax, 22));
    expect(other.play.ap).toBe(2);
  });

  it('Undaunted: Press On sacrifices Vitality, heals and spends the facet use', () => {
    const c = build({ classId: 'champion', level: 2, play: { endurance: 1 } as never });
    const d = derive(c);
    const [pressOn] = activationsFor('classes/champion/undaunted');
    const r = performUse(c, d, actionRequest(d, pressOn.id, pressOn.label, undefined, pressOn));
    expect(r.play.vitality).toBe(c.play.vitality - 1);
    expect(r.play.endurance).toBe(Math.min(d.enduranceMax, 1 + 10 * d.classBonus));
    expect(r.play.facetUses['classes/champion/undaunted']).toBe(1);
  });

  it('Rage becomes an Active Effect that feeds checks, Movement and Resistances', () => {
    const c = build({ classId: 'berserker' });
    const before = derive(c);
    const raging = { ...c, play: performUse(c, before, castReq('classes/berserker/berserker-maneuvers/rage')).play };
    const d = derive(raging);
    expect(d.movement).toBe(before.movement + 1);
    expect(d.resistances.find((r) => r.type === 'Thermic')?.value).toBe(2);
    expect(d.conditionFx.checks.find((r) => r.attr === 'VIG')?.bolstered).toBe(1);
    expect(d.saves.find((s) => s.attr === 'VIG')?.notes).toContain('Bolstered 1 (Rage 1)');
  });

  it('Bolstered and Hindered cancel out in the Check summary', () => {
    const c = build({ classId: 'berserker', play: { conditions: [{ name: 'Sickened', level: 2 }] } as never });
    const raging = { ...c, play: performUse(c, derive(c), castReq('classes/berserker/berserker-maneuvers/rage')).play };
    const vig = derive(raging).conditionFx.checks.find((r) => r.attr === 'VIG' && !r.save)!;
    expect(vig.bolstered - vig.hindered).toBe(-1);
  });

  it('effects end on turns and rests, and re-grant temporary AP', () => {
    const c = build();
    const d = derive(c);
    let p = performUse(c, d, castReq('spells/arcana/fire/embolden'), { self: true }).play;
    expect(p.tempAp).toBe(1);
    p = performUse({ ...c, play: p }, d, { key: 'pray', name: 'Pray', cost: parseCost('1 {AP}'), def: activationsFor('classes/thaumaturge/thaumaturgy/casting-spells/pray')[0], sl: 0 }).play;
    p = endTurn({ ...p, turn: { active: true } }).play;
    expect(p.tempAp).toBe(1);
    p = startTurn(p, 1, []).play;
    expect(p.effects?.map((e) => e.name)).toEqual(['Embolden 1']);
    expect(shortRest({ ...c, play: p }, d, { restCharges: 0 }).play.effects).toEqual([]);
  });

  it('Reignite has its own uses, one regained on a Short Rest', () => {
    const c = build({ classId: 'gladiator', play: { endurance: 1 } as never });
    const d = derive(c);
    const def = activationsFor('classes/gladiator/fighters-light/reignite')[0];
    const r = performUse(c, d, actionRequest(d, def.id, def.label, getNode(def.id)?.fields?.Cost, def), { mod: 4 });
    expect(r.play.endurance).toBe(1 + 4 + d.level);
    expect(r.play.ap).toBe(4);
    const key = `act:${def.id}:${def.label}`;
    expect(r.play.facetUses[key]).toBe(1);
    expect(shortRest({ ...c, play: r.play }, d, { restCharges: 0 }).play.facetUses[key]).toBe(0);
  });
});

describe('casting debts', () => {
  const evoke = 'classes/thaumaturge/thaumaturgy/casting-spells/evoke';
  const prismacast = 'classes/arcanist/prismacasting/casting-spells/prismacast';
  const use = (c: Character, id: string, sl: number, ap = 2) => {
    const d = derive(c);
    const node = getNode(id)!;
    return performUse(c, d, actionRequest(d, id, node.title, node.fields?.Cost, activationsFor(id)[0]), { amount: sl, ap });
  };
  it('Evoke spends {SL} Favor and makes you Indebted 2{SL}, keeping the higher level', () => {
    const c = build({ classId: 'thaumaturge', level: 5 });
    const r = use(c, evoke, 3);
    expect(r.play.trackers.Indebted).toBe(6);
    expect(r.play.resources.Favor).toBe(3);
    expect(r.play.ap).toBe(3);
    // A lower level doesn't add to it.
    expect(use({ ...c, play: r.play }, evoke, 1).play.trackers.Indebted).toBe(6);
  });
  it('Prismacast makes you Prismaburned {SL}, which drops by 1 at the start of your turn', () => {
    const c = build({ classId: 'arcanist', level: 5 });
    const r = use(c, prismacast, 2);
    expect(r.play.trackers.Prismaburn).toBe(2);
    expect(use({ ...c, play: r.play }, prismacast, 1).play.trackers.Prismaburn).toBe(2);
    expect(startTurn(r.play, 5, []).play.trackers.Prismaburn).toBe(1);
  });
});
