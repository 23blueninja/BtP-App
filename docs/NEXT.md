# Next session: to do

Notes from the user (2026-10-20), plus findings and a plan for each.

## 1. Unarmed Strike in Weapons
Add Unarmed Strike to the weapons table on the sheet (and Equipment).
- Read its stats from the rules: the Unarmed Strike entry (Crushing, VIG Die,
  DV/Deadly DV), plus facets that change it, e.g. the Incarnate's Primordial Die
  ("the DV equals half your Incarnate Bonus, and the Deadly DV is your
  Incarnate Bonus") and The King's Claws (Slashing).
- Always listed. It shouldn't need adding by hand.

## 2. "Thaumaturge Bonus" clips out of its triangle
In the split Class Bonus / Class Die box (top-left of the stat strip), long
class names overflow the top-left triangle.
- Shrink the Class Die (bottom-right) triangle to give the Class Bonus triangle
  more room. The polygons are in `StatStrip` in `src/ui/Sheet.tsx`
  (`0,0 93,0 0,91` and `100,9 100,100 7,100`) with matching `.split-glass`
  clip-paths in `src/styles.css`.
- Check with the longest class name ("Thaumaturge Bonus") at desktop, tablet
  and 360px.

## 3. Bolstered levels from different sources add together
Check Modifiers shows two lines for the same Check type:
"PER Attribute Checks: Bolstered 1 (Keen Senses)" and "… Bolstered 1 (Predator's Chains)".
- Bolstered/Hindered levels from different sources add together. Show one
  line per Check type with the total and all sources, e.g.
  "PER Attribute Checks: Bolstered 2 (Keen Senses, Predator's Chains)".
- `d.bolsters` comes from `eff('bolster')` in `src/engine/derive.ts`. Group by
  `what` and sum.
- Check the rules wording for Bolstered + Hindered on the same Check (they
  cancel level for level, as `conditionEffects` already does for Conditions),
  and make the two paths consistent.

## 4. Facets tab: two columns under the Class Table
Left column: Class → Subclass. Right column: Ancestry → Sub-ancestry →
Heritage → Homebrew facets. Phones: one column.

## 5. Icons instead of attribute / AP abbreviations
Replace VIG, AGI, PER, INT, PRS and AP in user-readable text with their icons
(`<Icon name=… />` / the `.ic ic-*` masks used elsewhere).
- Places generated in code, not rules text: Check Modifiers lines
  ("PER Attribute Checks"), save notes, armor notes ("You need 3 VIG…"),
  activation logs ("Spent 2 AP"), stat Details modals, the Actions panel,
  homebrew card descriptions, condition notes, Initiative Details.
- Likely approach: a small `TokenText`-style renderer for generated strings,
  writing them with `{VIG}`/`{AP}` tokens (like the rules text) so they render
  as icons. That's also screen-reader friendly via `aria-label`.
- Keep plain-text forms where text leaves the app (export, log copy, `title`
  tooltips).

## 6. Heavy-armor Weakened AGI Checks missing from Check Modifiers
**Cause:** `src/engine/derive.ts` (~line 466) only pushes the armor penalty to
`armorNotes` ("You need N VIG for X armor: your AGI Checks are Weakened"),
which shows on the Equipment tab. It never reaches `conditionFx` / Check
Modifiers. Medium armor's "AGI Save Checks are Hindered 1" has the same problem
(it only shows as a save note).
**Fix:** feed armor penalties into the same Check modifier pipeline as
Conditions and effects (e.g. add them to the `extra` passed to
`conditionEffects`, extended to support `weakened`), so they show as
"AGI Checks: Weakened (Heavy armor, needs 3 VIG)".

### Test-suite changes to catch this class of bug
The coverage audit only reads **facet** text. This bug came from **equipment
rules text** and a value that was computed but shown in the wrong place. Plan:

1. **Extend the coverage audit beyond facets.** Run the same sentence
   detectors over every rules section the engine applies automatically:
   - armor (types, qualities, requirements);
   - weapon properties (Massive, Blocking, Heavy…);
   - the Condition list;
   - Exalted lines;
   - homebrew effect descriptions.
   For armor and weapons, build a character wearing or wielding each one and
   assert the stated mechanic shows in the value it belongs to.
2. **Add a "Check modifiers are complete" invariant.** Anything that changes a
   roll must appear in Check Modifiers, whichever code path produced it: armor
   notes, save notes, initiative notes, condition effects, effect bolsters and
   tandems. In the derive matrix, for every character (incl. every armor
   type × quality × VIG below/above the requirement), collect every
   Hindered/Weakened/Bolstered/Tandem/Disadvantage phrase from all derived
   note fields. Then assert each has a matching structured entry in the Check
   Modifiers data (`conditionFx.checks`, `bolsters`, `tandems`).
3. **One source of truth per mechanic.** Add a test that fails if
   `armorNotes`, save `notes` or `initiativeNotes` contain a Check modifier
   phrase that isn't also in the Check Modifiers data. This forces new code to
   go through the shared pipeline instead of writing text directly.
4. **E2E: assert on what's displayed, not just that nothing errors.** For a
   few scripted characters (Heavy armor with low VIG, Medium armor, Keen
   Senses + Predator's Chains), open the sheet and assert the Check Modifiers
   panel contains the expected lines ("AGI Checks: Weakened",
   "PER Attribute Checks: Bolstered 2"). Then a regression in UI wiring is
   caught as well as one in the engine.
5. **Write each fix as a failing test first.** Turn each item above into a
   test that fails first (`it.fails('BUG: …')` while documenting, then
   flipped), per CLAUDE.md.
