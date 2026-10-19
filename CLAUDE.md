# BtP character builder

React 19 + TypeScript + Vite PWA for the Beyond the Prism TTRPG. The rules
document's Homebrewery source is `rules/BtP-Alpha-Rules.md`; `npm run
parse-rules` turns it into `src/content/rules.json`, which the data
(`src/data`) and engine (`src/engine`, pure `derive(c)`) build on.

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
