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

## World tab

`#/world` (`src/ui/World.tsx`) is a model of the World Prism that can be turned
and zoomed, drawn as SVG with no 3D library; it doesn't touch characters. The
maths is `src/engine/world.ts`: the sun is fixed and the prism tumbles and spins
under it, but the tab draws it the way someone in the world sees it, with the
prism still and the sun travelling around it (`sunSeenFromWorld`; Arch
2026-11-16). The motion is Arch's, read from the keyframes of Arch's Blender model
(`World Prism.blend`, 2026-11-15) into the one `WORLD_PRISM` value. One turn
(tumble) is a 24-hour day, the week has nine named days, the three painted
sides are the Infernal, Temporal and Lunar Facets, and the edges between them
are the Storm, Spring and Heart Spines (day while either Facet has it), all
Arch's. Arch's table of each Facet's and Spine's days is in `DAY_KINDS` and in
`tests/world.test.ts`, which checks the engine against the keyframes and the
table. The moon sits opposite the sun and has a phase every three days; the
phases, the nine three-week months and the start year 3732 OI come from
Arch's Moon Cycle table, which `tests/world.test.ts` holds in full. The
moon is shut all through Closed, fully open all through Open, and opens or
closes steadily in between (Arch). Below the model, a moon calendar lays out the shown year like
Arch's table (tap a day to go there), and a Speed dial sets how fast Play runs. A calendar tracker is planned on top of this: keep the motion and time
in that model, and ask Arch before adding lore numbers.

## Button and field labels

The app bundles no text font, so devices use their own, and some (Windows'
Segoe UI) sit capitals low in the line. Arch wants labels truly centred:
controls use the font's own line height, and `src/ui/capShift.ts` measures the
font in use and sets `--cap-shift` and `--line-fix`, which every control's
padding uses (`--label-up`/`--label-down`; a select only `--cap-shift`). A new
control style with its own padding should use them too. The e2e test "button
and field labels" checks this in a deliberately lopsided font
(`tests/e2e/fonts/`).

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
