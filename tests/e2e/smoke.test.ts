// Browser smoke test: serves the production build, loads characters of every
// class into the app, and clicks through every tab, builder step and the main
// interactive pieces, failing on any page error or console error.
//
//   npm run test:e2e        (builds first)
//
// Needs a Chromium for playwright-core: `npx playwright-core install chromium`
// (cloud sessions have one pre-installed).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { preview, type PreviewServer } from 'vite';
import { classes } from '../../src/data/classes';
import { ancestries } from '../../src/data/ancestries';
import { subclassesOf } from '../../src/engine/classInfo';
import { newCharacter, normalizeCharacter, type Character } from '../../src/engine/character';
import { freshPlay } from '../../src/engine/play';

let server: PreviewServer;
let browser: Browser;
let base = '';

beforeAll(async () => {
  server = await preview({ preview: { port: 0, strictPort: false }, logLevel: 'silent' });
  base = server.resolvedUrls!.local[0];
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.httpServer.close(() => r()));
});

function character(classId: string, subclass: string, level: number, ancestry: string, id: string): Character {
  const c = normalizeCharacter({
    ...newCharacter(),
    id,
    name: `${classId} ${subclass}`,
    classId,
    subclass,
    level,
    ancestry,
    attributes: { ...newCharacter().attributes, method: 'manual', base: { VIG: 3, AGI: 3, PER: 2, INT: 2, PRS: 2 } },
    equipment: { armor: { type: 'Light', quality: 'Basic' }, weapons: [{ id: 'w', name: 'Longsword' }], inventory: [
        { id: 'i', name: 'Rope', qty: 1, bulk: 2, storedIn: 'b', notes: '50 ft' },
        { id: 'b', name: 'Backpack', qty: 1, bulk: 1, container: true },
      ] },
  });
  return { ...c, play: { ...freshPlay(c), ap: 5 } };
}

/** Opens a page with the given characters saved, collecting errors. */
async function open(chars: Character[], viewport = { width: 1400, height: 1000 }): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(base);
  await page.evaluate((list) => localStorage.setItem('btp.characters.v1', JSON.stringify(Object.fromEntries(list.map((c) => [c.id, c])))), chars);
  return { page, errors };
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();

/**
 * Attribute / AP abbreviations left as plain text (they should render as icons,
 * via TokenText). Form controls are skipped, and so is anything marked
 * `data-plain` (text that must stay plain).
 */
async function abbreviations(page: Page, where: string): Promise<string[]> {
  const found = await page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement?.closest('option, select, textarea, script, style, [data-plain]')) continue;
      const t = n.textContent ?? '';
      if (/\b(VIG|AGI|PER|INT|PRS|AP)\b/.test(t)) out.push(`${t.trim().slice(0, 100)} <${n.parentElement?.outerHTML.slice(0, 160)}>`);
    }
    return out;
  });
  return [...new Set(found)].map((t) => `${where}: ${t}`);
}


/** Every sheet tab plus the main interactive pieces of the Sheet tab. */
async function exerciseSheet(page: Page, id: string): Promise<string[]> {
  const abbr: string[] = [];
  await page.goto(`${base}#/c/${id}`);
  // Characters are read from storage at start-up, so reload after a hash-only navigation.
  await page.reload();
  await page.getByRole('tab', { name: 'Sheet', exact: true }).waitFor({ timeout: 10_000 });
  // Stat breakdown modals (attributes, Initiative, AC, Movement).
  for (const name of ['Initiative', 'AC', 'Movement', 'Vigor']) {
    const btn = page.locator('.stat-btn').filter({ hasText: name }).first();
    if (await btn.count()) {
      await btn.click();
      await page.locator('.modal').waitFor();
      abbr.push(...(await abbreviations(page, `${name} details`)));
      await page.keyboard.press('Escape');
    }
  }
  // Turn flow.
  const start = page.getByRole('button', { name: /Start/ }).first();
  if (await start.isEnabled()) await start.click();
  const end = page.getByRole('button', { name: /End/ }).first();
  if (await end.isEnabled()) await end.click();
  // Damage and heal.
  await page.locator('.end-amount').fill('3');
  await page.getByRole('button', { name: 'Damage' }).click();
  await page.locator('.end-amount').fill('2');
  await page.getByRole('button', { name: 'Heal' }).click();
  // A condition.
  const pick = page.locator('.condition-add select');
  await pick.selectOption({ index: 1 });
  await page.locator('.condition-add button', { hasText: 'Add' }).click();
  for (const t of ['Facets', 'Spells & Maneuvers', 'Equipment', 'Notes', 'Sheet']) {
    await tab(page, t);
    abbr.push(...(await abbreviations(page, t)));
  }
  return abbr;
}

/** Every builder step via the step navigation. */
async function exerciseBuilder(page: Page, id: string): Promise<string[]> {
  const abbr: string[] = [];
  await page.goto(`${base}#/c/${id}/build/basics`);
  await page.reload();
  const steps = page.locator('nav.steps button');
  await steps.first().waitFor();
  const n = await steps.count();
  for (let i = 0; i < n; i++) {
    await steps.nth(i).click();
    abbr.push(...(await abbreviations(page, `builder step ${i + 1}`)));
  }
  return abbr;
}

describe('app shell', () => {
  it('home, rules reference and options load without errors', async () => {
    const { page, errors } = await open([]);
    await page.goto(base);
    await page.getByRole('button', { name: /New character/ }).waitFor();
    await page.goto(`${base}#/rules`);
    await page.waitForTimeout(300);
    const gear = page.getByRole('button', { name: /Options/i });
    if (await gear.count()) {
      await gear.first().click();
      await page.keyboard.press('Escape');
    }
    await page.close();
    expect(errors).toEqual([]);
  });

  it('creating a new character opens the builder', async () => {
    const { page, errors } = await open([]);
    await page.goto(base);
    await page.getByRole('button', { name: /New character/ }).click();
    await page.locator('nav.steps').waitFor();
    await page.close();
    expect(errors).toEqual([]);
  });
});

// Every class with each of its subclasses, rotating through ancestries and levels.
const cases = classes.flatMap((cls, ci) =>
  subclassesOf(cls).map((sc, si) => ({ cls: cls.id, sub: sc.id, ancestry: ancestries[(ci + si) % ancestries.length].id, level: [1, 3, 5, 7, 10][(ci + si) % 5] })),
);

describe.each(cases)('$cls / $sub · $ancestry · L$level', ({ cls, sub, ancestry, level }) => {
  it('sheet tabs and builder steps render and respond without errors', async () => {
    const id = `${cls}-${sub}`;
    const { page, errors } = await open([character(cls, sub, level, ancestry, id)]);
    const abbr = [...(await exerciseSheet(page, id)), ...(await exerciseBuilder(page, id))];
    await page.close();
    expect(errors).toEqual([]);
    // VIG, AGI, PER, INT, PRS and AP show as icons, not letters.
    expect([...new Set(abbr)]).toEqual([]);
  });
});

describe('phone layout', () => {
  const phones = classes.flatMap((c) => [412, 360].map((width) => ({ cls: c.id, width })));
  it.each(phones)('$cls sheet on a $width px screen', async ({ cls, width }) => {
    const sub = subclassesOf(classes.find((c) => c.id === cls)!)[0]?.id ?? '';
    const { page, errors } = await open([character(cls, sub, 5, ancestries[0].id, 'phone')], { width, height: 900 });
    await exerciseSheet(page, 'phone');
    // Nothing wider than the screen, on any tab.
    const overflow: Record<string, number> = {};
    for (const t of ['Sheet', 'Facets', 'Spells & Maneuvers', 'Equipment', 'Notes']) {
      await tab(page, t);
      overflow[t] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    }
    await page.close();
    expect(errors).toEqual([]);
    expect(Object.entries(overflow).filter(([, px]) => px > 1)).toEqual([]);
  });
});

// What the sheet shows, not just that it renders: scripted characters whose
// rules-stated modifiers must appear in the Check Modifiers panel and Weapons table.
describe('sheet shows the modifiers the rules give', () => {
  async function sheet(over: Partial<Character>) {
    const c = { ...character('expert', subclassesOf(classes.find((x) => x.id === 'expert')!)[0].id, 5, 'human', 'shows'), ...over };
    const { page, errors } = await open([c]);
    await page.goto(`${base}#/c/shows`);
    await page.reload();
    await page.getByRole('tab', { name: 'Sheet', exact: true }).waitFor({ timeout: 10_000 });
    // Icons read as their label ("AGI"), so the text matches the rules wording.
    const mods = await page.locator('.active-effects .mods').evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('.ic').forEach((ic) => ic.replaceWith(ic.getAttribute('aria-label') ?? ''));
      return copy.textContent ?? '';
    });
    return { page, errors, mods };
  }
  const attrs = (VIG: number) => ({ ...newCharacter().attributes, method: 'manual' as const, base: { VIG, AGI: 3, PER: 2, INT: 2, PRS: 2 } });
  it('Heavy armor without 3 VIG: AGI Checks Weakened', async () => {
    const { page, errors, mods } = await sheet({ attributes: attrs(1), equipment: { armor: { type: 'Heavy', quality: 'Basic' }, weapons: [], inventory: [] } });
    await page.close();
    expect(errors).toEqual([]);
    expect(mods).toMatch(/AGI Checks\s*Weakened \(Heavy armor needs 3 VIG\)/);
  });
  it('Medium armor: AGI Save Checks Hindered 1 (Weighty)', async () => {
    const { page, mods } = await sheet({ attributes: attrs(1), equipment: { armor: { type: 'Medium', quality: 'Basic' }, weapons: [], inventory: [] } });
    await page.close();
    expect(mods).toMatch(/AGI Save Checks\s*Hindered 1 \(Weighty/);
  });
  it('Keen Senses + a Bolstering item add into one line', async () => {
    const { page, mods } = await sheet({
      ancestry: 'praedan',
      subAncestry: 'canine',
      homebrew: [{ id: 'h', kind: 'effect', name: 'Sharp Ears', rows: [{ id: 'r', effect: { kind: 'check', scope: 'attribute', attr: 'PER', amount: 1 } }] }],
    });
    await page.close();
    expect(mods).toContain('PER Attribute Checks: Bolstered 2 (Keen Senses, Sharp Ears)');
  });
  it('a Condition is gained at the chosen level (Burning 3: 9 Thermic damage)', async () => {
    const { page, errors } = await sheet({});
    const endurance = async () => Number(await page.locator('.end-current').textContent());
    const before = await endurance();
    await page.locator('.condition-add select').selectOption('Burning');
    await page.getByRole('button', { name: 'Increase Condition level' }).click();
    await page.getByRole('button', { name: 'Increase Condition level' }).click();
    await page.locator('.condition-add button', { hasText: 'Add' }).click();
    const after = await endurance();
    const mods = await page.locator('.active-effects .mods').textContent();
    await page.close();
    expect(errors).toEqual([]);
    expect(before - after).toBe(9);
    expect(mods).toContain('Numbed 3');
  });
  it('Custom ancestry: no ancestry facets, and a note pointing to Homebrew facets', async () => {
    const { page, errors } = await sheet({ ancestry: 'custom', subAncestry: '' });
    await page.getByRole('tab', { name: 'Facets', exact: true }).click();
    const facets = (await page.locator('main').textContent()) ?? '';
    await page.goto(`${base}#/c/shows/build/ancestry`);
    await page.reload();
    await page.locator('.pick-card.selected', { hasText: 'Custom' }).waitFor();
    const builder = (await page.locator('main').textContent()) ?? '';
    // Naming it: the name replaces "Custom" on the sheet.
    await page.getByLabel('Ancestry name').fill('Kobold');
    await page.goto(`${base}#/c/shows`);
    await page.getByRole('tab', { name: 'Facets', exact: true }).click();
    const named = (await page.locator('main').textContent()) ?? '';
    await page.close();
    expect(errors).toEqual([]);
    expect(facets).toContain('Custom ancestry');
    expect(facets).toContain('Add its facets');
    expect(builder).toContain('Add its facets');
    expect(named).toMatch(/Level \d+ · Kobold ·/);
    expect(named).toContain('Kobold (Custom ancestry)');
  });
  it('Radiance panel opens the Radiance rules', async () => {
    const { page, errors } = await sheet({});
    await page.locator('.box.radiance').click({ position: { x: 10, y: 10 } });
    const modal = (await page.locator('.modal').textContent()) ?? '';
    await page.keyboard.press('Escape');
    await page.close();
    expect(errors).toEqual([]);
    expect(modal).toMatch(/Radiance \d+\/\d+/);
    expect(modal.length).toBeGreaterThan(100);
  });
  it('Short Rest asks how many Rest Charges, previews Endurance, then rests', async () => {
    const base0 = character('expert', subclassesOf(classes.find((x) => x.id === 'expert')!)[0].id, 5, 'human', 'shows');
    const { page, errors } = await sheet({ play: { ...base0.play, endurance: 0 } });
    await page.getByRole('button', { name: 'Short Rest' }).click();
    const preview = async () => (await page.locator('.rest-preview').textContent()) ?? '';
    const max = Number((await preview()).match(/\/ (\d+)/)![1]);
    await page.locator('.rest-charges').getByRole('button', { name: '1', exact: true }).click();
    expect(await preview()).toContain(`0 → ${Math.ceil(max / 2)} / ${max}`);
    await page.locator('.rest-charges').getByRole('button', { name: '2', exact: true }).click();
    expect(await preview()).toContain(`0 → ${Math.min(max, 2 * Math.ceil(max / 2))} / ${max}`);
    await page.locator('.modal').getByRole('button', { name: 'Rest', exact: true }).click();
    const endurance = Number(await page.locator('.end-current').textContent());
    await page.close();
    expect(errors).toEqual([]);
    expect(endurance).toBe(max);
  });
  it('an edit survives an immediate reload (batched saves are written when the page goes away)', async () => {
    const { page, errors } = await sheet({});
    await page.getByRole('tab', { name: 'Notes', exact: true }).click();
    await page.getByLabel('Appearance').fill('Scar across the left eye');
    await page.reload();
    await page.getByRole('tab', { name: 'Notes', exact: true }).click();
    const value = await page.getByLabel('Appearance').inputValue();
    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    await page.close();
    expect(errors).toEqual([]);
    expect(value).toBe('Scar across the left eye');
    // Stored per character; the old all-characters key was migrated away.
    expect(keys).toContain('btp.character.shows');
    expect(keys).not.toContain('btp.characters.v1');
  });
  it('Unarmed Strike is listed once picked, above Simple weapons, and can be removed', async () => {
    const { page } = await sheet({ equipment: { armor: undefined, weapons: [], inventory: [] } });
    await page.getByRole('tab', { name: 'Equipment', exact: true }).click();
    const table = page.locator('table.weapons');
    expect(await table.textContent()).not.toContain('Unarmed Strike');
    const options = await page.locator('select[aria-label="Weapon"] > *').evaluateAll((els) => els.map((e) => e.getAttribute('label') ?? e.textContent));
    expect(options.slice(1, 3)).toEqual(['Unarmed Strike', 'Simple Weapons']);
    await page.locator('select[aria-label="Weapon"]').selectOption('Unarmed Strike');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    expect(await table.textContent()).toContain('Unarmed Strike');
    await page.getByRole('button', { name: 'Remove Unarmed Strike' }).click();
    const after = (await table.textContent()) ?? '';
    await page.close();
    expect(after).not.toContain('Unarmed Strike');
  });
});
