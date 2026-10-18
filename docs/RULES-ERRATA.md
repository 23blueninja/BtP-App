# Rules errata found while building the app

Changes to make in the rulebook, found while building the character app.
Line numbers refer to `rules/BtP-Alpha-Rules.md` (the Homebrewery source) as
it stands in this repo. After editing, send the new markdown and the app is
regenerated with `npm run parse-rules`.

## Rule changes you've decided on

| # | Where | Change |
|---|---|---|
| 1 | Berserker, facet "Feral Light" (line 3202) | Rename to **Barbarous Light** to match the class table (line 3145). The app needs a one-line rename when this lands; the tests flag it. |
| 2 | Resistance (Encounters → Damage → Resistance) | Clarify that Resistances of the same type from different sources **add together**. |
| 3 | Powerful Build (line 2199, and its copies; 4 occurrences) | Add **"(minimum 5)"**: the Bulk Rank can't go below 5. |
| 4 | Thaumaturge Divine Domains: Cosmos Domain (line 4972), Forge Domain (line 5051) | Add the subclass's Alignment grant ("You gain a level of X Alignment."). All Thaumaturges also keep Infernal. The app picks up the new line automatically. |

## Inconsistencies

| # | Where | Issue |
|---|---|---|
| 5 | Gladiator class table (line 3878) | Says **Gladiator Maneuvers**; the facet is called **Martial Maneuvers** (line 3916). |
| 6 | Incarnate Maneuvers (line 4295) | Says "(Instinctual and Tactical)"; the paragraph above says **Feral and Instinctual**, which is correct. Looks copied from the Expert. |
| 7 | Greatbow, weapons table (line 5967) | Properties read "Two-Handed**.** Ammo (Greatarrow)": a full stop where a comma belongs. |

## Typos

| # | Where | Now | Should be |
|---|---|---|---|
| 8 | Conditions (line 1636) | Defeaned | Deafened |
| 9 | Conditions (line 1750) | Possesed X | Possessed X (the Infernal Embodiment spell already spells it "Possessed") |
| 10 | Rage, Berserker (line 3192) | "our $[VIG] Checks are bolstered $[SL]." | "Your $[VIG] Checks are Bolstered $[SL]." |
| 11 | Plot, Expert (line 3764) | oppoents moves | opponents' moves |
| 12 | Temporary Action Points (line 619) | contrained | constrained |
| 13 | Action Flare, Gladiator (line 3974) | you can can choose | you can choose |
| 14 | Arcane Power, Blood cantrip (line 7988) | Exanguinate | Exsanguinate |
| 15 | Spiritual Communion (line 8718) | the Etheral | the Ethereal |
| 16 | Ice Armor (line 7251) | Powered Aquamarine | Powdered Aquamarine |
| 17 | Survival Saves (line 1474) | your Dying level increase by 1 | increases by 1 |
| 18 | Ferocious Strikes, Incarnate (line 4301) | the DV equals your half your Incarnate Bonus | the DV equals half your Incarnate Bonus |
| 19 | Undaunted, Overcome (line 3369) | if its a spell … if its a maneuver | if it's a spell … if it's a maneuver |
| 20 | Undaunted, Press On (line 3367) | missing full stop after "Champion Bonus" | add "." |
| 21 | Skill Checks (line 454) | When you PC tries | When your PC tries |
| 22 | Save Checks (line 449) | a giant bolder | a giant boulder |

## Open questions (the app made a call; confirm or change)

| # | Where | Question | What the app does now |
|---|---|---|---|
| 23 | Luminary | The class has no class Alignment; only its subclass grants one (Flaming Luminance → Flame). Intended? | No class Alignment. |
| 24 | Mod Die steps | Stepping a d2 down one size: does it become "no die", or go straight to −d2? | Goes to "no die" first. |
| 25 | Paralyzed | "When you start your turn, **it** ends immediately": does "it" mean your turn or the Condition? The level also drops by 1, which suggests your turn. | Your turn ends, and Paralyzed drops by 1. |
| 26 | Brace, Exalted (5th) | "The Temporary Endurance you gain becomes 6{SL}": does the Mod Die roll still add to it? | Mod Die + 6{SL}. |
| 27 | Temporary Endurance | "Choose whether you keep your current amount or gain the new amount." | Keeps the higher amount automatically. |
