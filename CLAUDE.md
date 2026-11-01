# BtP character builder

React 19 + TypeScript + Vite PWA for the Beyond the Prism TTRPG. The rules
document's Homebrewery source is `rules/BtP-Alpha-Rules.md`; `npm run
parse-rules` turns it into `src/content/rules.json`, which the data
(`src/data`) and engine (`src/engine`, pure `derive(c)`) build on.

## Summons

`src/engine/summons.ts` builds summon stat blocks (Summon Familiar, Snow
Familiar, Bestial and Spiritual Communion) at the casting level; the Summons tab
is `src/ui/Summons.tsx`, and summons live in `play.summons`. Creatures the
Communion spells can summon are in `src/content/creatures.json`: Bestiary stat
blocks exported from the BtP Monster Maker (in that repo, `npm run check-monster -- <file>
--json`), in its Monster format. Add a creature by appending its export (Arch
chose to publish them here). Players can also import Beasts and
Ethereals from a Monster Maker JSON export in the Communion cast panel
(`importCreatures`); they're saved on the character (`creatures`), and a summon
keeps its imported stat block (`creatureData`).

## PDF character sheet

`npm run build-sheets` (Python 3 with reportlab, pypdf and Pillow) runs
`scripts/character-sheet/build.py`, which draws the fillable sheet in the app's
look and writes three versions to `src/assets/sheets/` (Dark and Light for
screens, with dropdowns for AP, Vitality, Radiance and Rest Charges; Printable in
CMYK with bubbles and AP tracked with a d6) plus `fields.json`, the field names.
Basic actions and Conditions are printed from `rules.json`: re-run it after
`npm run parse-rules` (`tests/sheet.test.ts` checks the Conditions). The Sheet
tab's ⇩ PDF button fills a version with `sheetValues(c, d)`
(`src/engine/sheetExport.ts`) via pdf-lib (`src/engine/sheetPdf.ts`, loaded on
export) and lists anything that didn't fit. Layout decisions are Arch's
(US Letter, page order, panel contents): ask before moving things.

## Tests

| Command | What | When |
| --- | --- | --- |
| `npm run test:qa` | Typecheck + the whole Vitest suite on sampled matrices (`QA=1`) — a few seconds | **Before every commit** |
| `npm run test:full` | Every test at full size (every class × subclass × ancestry × level, every activation, …) | On request, and before larger engine/data changes |
| `npm run test:e2e` | Builds, then a browser smoke test (playwright-core): every class through every tab and builder step, phone widths, no page/console errors | On request, and after UI layout changes |
| `npm run test:all` | full + e2e | Before a release |

- `src/**/*.test.ts` are the original unit tests; `tests/*.test.ts` is the
  rules-driven suite (`content`, `derive`, `play`, `systems`, `coverage`), with
  `tests/helpers.ts` (`sample`, `LEVELS`, `makeCharacter`, `built`, `badNumbers`).
- In `tests/`, big lists go through `sample(list, n)` so QA mode stays fast;
  cheap structural checks always run in full.
- Expected values come from the rules document, not from the app code. A test
  that documents a known app bug is written as `it.fails('BUG: …')` — fix the
  bug, then turn it back into `it`.
- `tests/coverage.test.ts` audits facet text: every always-on mechanic the
  engine can model (Tandem dice, Empowered saves, Resistances, Immunities,
  Swim/Climb, Movement, senses, Bolstered Checks, Endurance/Vitality/Radiance,
  AC) must have an effect AND show in the value it belongs to (e.g. the
  Initiative die). Adding a facet means modelling it, or listing it in
  `ALLOWED` with the reason (activated states only).
- E2E needs Chromium for playwright-core (`npx playwright-core install
  chromium` locally; cloud sessions have it).
