# Beyond the Prism — Character Builder

A web app for creating and playing characters for **Beyond the Prism** (BtP),
the tabletop RPG by 23BLUENINJA. Alpha Rules © 2026 23BLUENINJA — All Rights Reserved.

- **Guided builder** — Attributes (Point Buy, rolled pool, or manual), Ancestry,
  Background & Heritage, Class & subclass, class choices, spells & maneuvers,
  Personal Alignment, age-ups, devotion and equipment. The rules text for every
  choice is shown inline.
- **Automatic sheet** — Mod Dice, Save Checks (Tandem / Empowered), Endurance,
  Vitality, Radiance, Rest Charges, AC, Movement, Radius, jumps, resistances,
  alignment, Hobby/Profession slots, bulk and more, laid out like the official
  Google Sheets template.
- **Play mode** — damage/healing (Temporary Endurance → Endurance → Vitality),
  Dying, Radiance and Rest Charge pips, class resources (Stamina, Will, Wonder,
  Prisma, Light, Favor), trackers (Prismaburn, Indebted), facet uses, conditions,
  Short/Long Rests with a per-character **Heroic / Gritty** toggle.
- **Level-up flow** following the Level Up Checklist.
- **Rules reference** — every section, spell, maneuver, action and condition,
  searchable.

Characters are saved in the browser (localStorage) and can be exported/imported
as JSON. Storage sits behind `CharacterStore` (`src/storage/storage.ts`) so
accounts and cloud sync can be added later.

## Installing on a phone

The app is a Progressive Web App: once the built site is hosted, open its URL in
Chrome on Android and choose **⋮ → Add to Home screen / Install app**. It then
opens full-screen like a normal app and works offline. Characters are stored
on that device; use Export/Import to move them between devices.

The site is published to **https://23blueninja.github.io/BtP-App/** by
`.github/workflows/deploy.yml` on every push to `main` (tests must pass first).
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # engine + data tests
npm run typecheck
npm run build      # static site in dist/ (deployable to GitHub Pages or any static host)
```

## Updating to a new rules revision

The app reads the rules straight from the Homebrewery source, so most updates
are a re-parse:

1. Replace `rules/BtP-Alpha-Rules.md` with the new Homebrewery source text
   (the markdown, not the PDF — it keeps icons, tables and facet levels intact).
2. `npm run parse-rules` — regenerates `src/content/rules.json`.
3. `npm test` — fails if any section the mechanics rely on was renamed or moved.

What updates automatically: all rules text, spells, maneuvers, actions,
conditions, weapons, armor, class tables (bonus, die, resources, max levels),
class Alignment and Endurance, facet lists by level, and new subclasses.
Content released inside `<!-- -->` comments stays hidden.

What needs code (`src/data/*.ts`): mechanical effects of new facets (e.g. a new
resistance or Movement bonus), new spell/maneuver selection rules, and new
ancestries or backgrounds. The highest playable level is `MAX_LEVEL` in
`src/engine/derive.ts` (currently 2).

## Layout

| Path | Purpose |
| --- | --- |
| `rules/` | Rules source (Homebrewery markdown) and the character sheet template |
| `scripts/parse-rules.mjs` | Markdown → JSON section tree |
| `src/content/` | Parsed rules and typed accessors (spells, maneuvers, weapons…) |
| `src/data/` | Hand-authored mechanics: ancestries, backgrounds, classes |
| `src/engine/` | Character model, derived stats, rests, level-up (pure, tested) |
| `src/storage/` | Persistence |
| `src/ui/` | React UI: builder, sheet, level-up, rules reference |
