# Beyond the Prism — Character Builder: Plan

Source material: *BtP Alpha Rules* (© 2026 23BLUENINJA) and the official
Google Sheets character sheet template.

## Decisions

| Topic | Decision |
| --- | --- |
| Platform | Static web app (React + TypeScript + Vite). Characters saved in the browser (localStorage / IndexedDB) with JSON import/export. Storage sits behind a small interface so accounts + cloud sync can be added later. |
| Automation | Full guided builder, derived stats calculated automatically, in-app rules reference with class-restricted spell/maneuver selection. |
| Rules text | Full rules text may be stored in the repo. |
| v1 extras | Level-up flow, play-mode tracking. (Print/PDF and dice roller deferred.) |

## Architecture

```
src/
  data/        Rules content as typed data (ancestries, backgrounds, heritage
               facets, classes + subclasses, weapons, armor, spells,
               maneuvers, actions, conditions, alignment matrix)
  engine/      Pure functions: character choices -> derived sheet
  builder/     Step-by-step creation wizard
  sheet/       Character sheet view + play-mode tracking
  levelup/     Level-up checklist flow
  reference/   Browsable rules (spells, maneuvers, actions, conditions)
  storage/     Persistence interface (local now, cloud later)
```

A character is stored as **choices** (attribute points, ancestry,
sub-ancestry, background, hobbies/professions + ranks, class, subclass,
level, chosen spells/maneuvers, alignment answers, equipment, age-ups) plus
**play state** (current Endurance, Temp Endurance, Vitality, Radiance, class
resource, Rest Charges, conditions, Dying level). Everything else is derived
by the engine, so rules fixes propagate to existing characters.

Facet effects are encoded as structured modifiers (e.g. `movement +1`,
`resistance Psychic = classBonus`, `bolster saves VIG 1`,
`alignment Pneuma +1`, `extraHobbies 2 @ Novice`) alongside their full text,
so the engine can apply them and the UI can display them.

## Phase 1 — Rules data
- Attribute points -> Mod Die table (−d12 … d12, +1 per point beyond 6);
  attribute cap by level (3 @1, 4 @4, 5 @10).
- Ancestries (10) incl. Praedan & Soli sub-ancestries.
- Backgrounds (7 pre-made + custom) and Heritage Facets (7).
- Classes (9) with class tables, Endurance, training, save tandems,
  resources (Prisma, Stamina, Will, Wonder, …) and subclasses.
- Weapons, armor, Bulk; spells (Arcana & Evocations) and maneuvers.
- Personal Alignment matrix (Action/Patience × Reason/Instinct ×
  Apathy/Empathy).

## Phase 2 — Calculation engine (unit-tested)
- Mod Dice per attribute; Bolstered/Hindered stepping.
- Movement = 3 + triangular(AGI) + facets; Radius = 5 + triangular(PER).
- Long Jump max = 2 + VIG; High Jump = 1 + ⌊VIG/2⌋ (class overrides).
- Vitality = 3 + ⌈VIG/2⌉ + facets; Radiance = 1 + ⌈PRS/2⌉ + facets.
- Endurance max = class start + per-level gain + facets.
- Temp Endurance on Long Rest = VIG × Class Bonus; Rest Charges = max
  Vitality.
- Hobby/Profession counts from INT/PRS, background, ancestry, heritage,
  age-ups; rank caps by level.
- AC: unarmored = sum of two highest attributes; armored per Equipment
  rules (+ Class Bonus where allowed).
- Resistances, alignment levels, initiative, save tandems.
- Validation: point-buy budget, attribute caps, rank caps, spell levels.

## Phase 3 — Guided builder
Attributes (Point Buy 12 from −1, or 5d4 drop-lowest +1, or 1d4−1 each) →
Ancestry → Background → Class (+ subclass, spells/maneuvers, equipment) →
Final Details (alignment questions, age-up, devotion, notes).

## Phase 4 — Character sheet + play mode
Layout mirrors the official template. Trackers for Endurance / Temp
Endurance / Vitality / Radiance / class resource / Rest Charges, conditions
with levels, Dying + Survival Saves, Short/Long Rest buttons (Heroic or
Gritty rules toggle).

## Phase 5 — Level-up flow
Implements the Level Up Checklist: Endurance, class table resources,
new facets, attribute points, Hobby/Profession rank on odd levels,
new spells/maneuvers.

## Status

Phases 1–5 are implemented for levels 1–2. Rules updates: see README.

## Rules questions found while building

Answers (Oct 2026): the facet is **Barbarous Light** (rules heading to fix);
Incarnates use Feral and Instinctual; Thaumaturges always get Infernal and
should also gain a Light from their Domain (Cosmos Domain doesn't yet — the
app reads "You gain a level of X Alignment" from facet text, so a rules patch
is picked up automatically); the app follows the rulebook over the sheet;
resistances of the same type **add together**.

- Berserker table lists **Barbarous Light**; the facet is **Feral Light**.
- Gladiator table lists **Gladiator Maneuvers**; the facet is **Martial Maneuvers**.
- Incarnate Maneuvers says Feral and Instinctual, then “(Instinctual and
  Tactical)”. The app uses Feral and Instinctual.
- Arcanist text says “Primacast” once; the action is Prismacast.
- Thaumaturge’s Alignment section grants Infernal — intended, or the deity’s Light?
- Luminary has no class Alignment (Flaming Luminance grants Flame).
- Some table headers have typos (“Manuevers Known”, “Max Manevuer Level”).
- Template sheet: Mod Die formula maps 5 points to d10 twice (6 → d12 missing);
  Movement is `3 + AGI`, while the rules grow it triangularly (+1, +3, +6…).
  The app follows the rules text.

## Backlog (requested Oct 2026) — done

1. **Inventory item notes.** Add an optional `notes` field to inventory items,
   editable inline and shown on the sheet.
2. **Visual inventory pyramid.** Draw Bulk ranks 1–5 as a pyramid of slots like
   the Excel sheet (rank *n* has *n* slots, plus a bonus row of *n* slots
   unlocked at *n* VIG). Items fill slots; locked bonus rows are greyed out;
   over-capacity is flagged.
3. **Cast-at-level calculator.** A level selector on each spell/maneuver
   (base level up to the character's max) that resolves the text for that level:
   - `7{SL}` → 7 × level, `{SL} plus 4`, `half {SL}`, `{SL}-space cone`,
     `2{SL}g` components, conditions like `Burning {SL}`;
   - applies Exalted (+1), (+2) and (Nth) entries for the chosen level;
   - shows the cost (Prisma/Stamina/Will/Favor/Light/Wonder) and lets you
     spend it from the tracker;
   - shows the Check type and Mod Die (Spell/Maneuver Mod Die), with each
     outcome (Success, Deadly Success, Failure…) as final numbers.

Rules confirmed for the calculator: `N{SL}` is N × the cast level; "your
level" is the character's level; casting at level N costs N of the class
resource, except Champion maneuvers (Will = half the level, rounded up).
