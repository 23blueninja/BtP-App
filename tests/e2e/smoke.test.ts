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
    equipment: { armor: { type: 'Light', quality: 'Basic' }, weapons: [{ id: 'w', name: 'Longsword' }], inventory: [{ id: 'i', name: 'Rope', qty: 1, bulk: 2 }] },
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

/** Every sheet tab plus the main interactive pieces of the Sheet tab. */
async function exerciseSheet(page: Page, id: string) {
  await page.goto(`${base}#/c/${id}`);
  await page.getByRole('tab', { name: 'Sheet', exact: true }).waitFor();
  // Stat breakdown modals (attributes, Initiative, AC, Movement).
  for (const name of ['Initiative', 'AC', 'Movement', 'Vigor']) {
    const btn = page.locator('.stat-btn').filter({ hasText: name }).first();
    if (await btn.count()) {
      await btn.click();
      await page.locator('.modal').waitFor();
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
  await page.locator('.condition-add button').click();
  for (const t of ['Facets', 'Spells & Maneuvers', 'Equipment', 'Notes', 'Sheet']) await tab(page, t);
}

/** Every builder step via the step navigation. */
async function exerciseBuilder(page: Page, id: string) {
  await page.goto(`${base}#/c/${id}/build/basics`);
  const steps = page.locator('nav.steps button');
  await steps.first().waitFor();
  const n = await steps.count();
  for (let i = 0; i < n; i++) await steps.nth(i).click();
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
    await exerciseSheet(page, id);
    await exerciseBuilder(page, id);
    await page.close();
    expect(errors).toEqual([]);
  });
});

describe('phone layout', () => {
  it.each(classes.slice(0, 3).map((c) => c.id))('%s sheet on a 412px screen', async (cls) => {
    const sub = subclassesOf(classes.find((c) => c.id === cls)!)[0]?.id ?? '';
    const { page, errors } = await open([character(cls, sub, 5, ancestries[0].id, 'phone')], { width: 412, height: 900 });
    await exerciseSheet(page, 'phone');
    // Nothing wider than the screen.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.close();
    expect(errors).toEqual([]);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
