# MyFitnessPal Import — Design

**Date:** 2026-08-07
**Status:** Approved, ready for implementation planning

## Context

Athletes arriving at Stone Dragon have years of history in MyFitnessPal. The app
already has a complete food logger — USDA food database, custom foods, saved
meals, water tracking, targets, and a nutrition game — but a new athlete opens it
empty. The friction of rebuilding a food library by hand keeps people on MFP even
once they have somewhere better to log.

The goal is migration, not synchronisation: a one-time import that carries an
athlete's history across so they can stop opening MyFitnessPal. There is no
ongoing sync, and none is planned — MFP's API is private and closed to new
developers, so no live integration is available at any price.

**Out of scope:** Apple Watch / Apple Health. HealthKit is readable only by
native iOS apps, so a PWA cannot reach it. The workable bridge (Health Auto
Export) requires each athlete to install and configure a separate paid app, and
is iPhone-only, which excludes Android athletes entirely. The cost/benefit does
not justify it.

## What gets imported

| MFP data | Destination | Pruned? |
|---|---|---|
| Food diary | `progress.foodLog` | Yes — 180-day window |
| Custom foods | `progress.customFoods` | No |
| Recipes | `progress.savedMeals` with `kind: "recipe"` | No |
| Weight history | `progress.bodyweightLog` | No |

Custom foods and recipes are the point. Diary history is a bonus that makes
trends and the coach adherence view useful from day one. Multi-year diary
history is explicitly **not** imported.

## Constraints discovered

- **`FOOD_LOG_DAYS = 180`** (`app.js:28394`). `pruneFoodLog()` (`app.js:28475`)
  runs on every save and deletes any `foodLog` / `waterLog` key older than the
  window. Imported days beyond 180 would vanish on the athlete's next log. The
  import therefore discards them up front, with an explicit message, rather than
  writing data that disappears later.
- The whole `progress` row is upserted on every cloud push, which is why the
  window exists. Nothing in this design increases steady-state row size.
- `progress` is athlete-owned. The coach app upserts whole `athletes` rows and
  would clobber anything written there, which is why the food logger lives on
  `progress`. Import is athlete-initiated and writes through `saveClient()`,
  staying on the correct side of that boundary.
- MFP export format is uncertain: the Premium in-app export produces plain CSV,
  while the free Privacy Center export has been reported as a
  password-protected `.xlsx`. The design handles CSV natively and instructs the
  athlete to re-save anything else as CSV. No decryption, no xlsx parser, no new
  dependency.

## Architecture

One new section in `app.js` beside the food logger (near `loadFoodDb`,
~line 28400) and one modal in `index.html`. No migration, no new table, no new
external dependency.

| Unit | Responsibility | Depends on |
|---|---|---|
| `parseCsv(text)` | RFC-4180 CSV → row objects. Quoted fields, embedded commas and newlines, CRLF. | — |
| `sniffMfpFile(name, text)` | Identify diary / custom foods / recipes / weight **by header columns**, not filename. | — |
| `mapMfpRows(kind, rows)` | MFP rows → STSD entry shapes. Pure; writes nothing. | — |
| `applyMfpImport(parsed)` | Write to `progress`, set XP boundary, `saveClient()`. | `progress` |

Parsing is pure and separated from writing so the preview screen can run the
whole pipeline and display results before anything is committed.

## Data flow

```
athlete picks file(s) → FileReader.readAsText
   ↓  .xlsx / .zip magic bytes detected → stop, show "re-save as CSV" help
parseCsv → sniffMfpFile → mapMfpRows
   ↓
preview: "412 diary days, 87 custom foods, 14 recipes, 230 weigh-ins"
         "232 days older than 180 discarded"  "14 rows skipped, no calorie data"
   ↓  athlete confirms
applyMfpImport → foodLog / customFoods / savedMeals / bodyweightLog
   ↓
pruneFoodLog() → saveClient() → existing debounced cloud push
```

## Food matching

Diary entries keep the macros MFP recorded. They are **not** matched against the
vendored USDA database. MFP is largely brand-name and user-generated foods USDA
does not carry, so matching would be lossy and would silently rewrite the numbers
the athlete actually ate. Entries are tagged `src: "mfp"`, reusing the existing
`src` field in the entry shape.

Quantities are stored verbatim as MFP recorded them ("1 cup", "2 servings")
rather than re-derived into grams.

Imported **custom foods** do become first-class: they land in
`progress.customFoods` and are immediately searchable through the existing
`foodSearch` path, which is what lets the athlete stop needing MFP.

**Recipes are not saved meals.** `savedMeals` holds both, distinguished by
`kind: "recipe"` (`app.js:30942`). A plain saved meal is a bundle of entries
logged as several lines; a recipe carries `servings` plus an `items[]` ingredient
list and logs as one line scaled by servings eaten, via `recipePerServing()` and
`openRecipePortionStep()` (`app.js:30958`). MFP recipes carry ingredients and a
serving count, so they map to the recipe shape — `{ id, name, kind: "recipe",
servings, items[], uses: 0, createdAt }`. Mapping them to plain saved meals would
lose the per-serving scaling that makes a recipe usable.

Where an MFP recipe's ingredients cannot be resolved to usable per-item macros,
import it as a single-item recipe carrying the recipe's own totals rather than
dropping it. A recipe that logs correctly but cannot be edited ingredient-by-
ingredient is far more useful than one that never arrives.

## XP boundary

`applyMfpImport` records `progress.nutritionGame.importedThrough` = the latest
imported date. Two changes flow from it:

- `syncNutritionGame()` (`app.js:28837`) — filter its `dates` list to
  `d > importedThrough`. Imported days award no XP.
- `streakDay()` (`app.js:28683`) — return `false` for `date <= importedThrough`,
  so `bestStreak` cannot be inflated by an import.

Everything else — `nutritionRollup()` (`app.js:12933`), charts, averages, the
coach adherence view — reads `foodLog` directly and picks up the history with no
change. An import must never hand someone six months of XP and a 180-day streak,
which would devalue the game for every athlete who earned it honestly.

## Error handling

A failed import must never leave a half-written log.

- Parse and validate fully in memory; write only on success. No partial writes.
- Unparseable file → named error, nothing written.
- Rows with missing or non-numeric calories → skipped, counted, surfaced in the
  preview rather than silently dropped.
- **Idempotent re-import:** applying first removes existing `src: "mfp"` entries
  within the covered date range, so running the import twice yields the same
  result rather than doubling every meal.
- Custom foods dedupe on name + brand against existing `customFoods`.
- Weigh-ins dedupe on date against existing `bodyweightLog`.
- Days beyond the 180-day window are dropped at import with an explicit count,
  never written-then-pruned.

## Testing

1. `parseCsv` units: quoted fields, embedded commas, embedded newlines, CRLF,
   trailing newline, ragged rows.
2. `mapMfpRows` units against fixture CSVs (hand-written until a real export is
   available).
3. jsdom harness: seed an athlete, run `applyMfpImport`, assert `foodLog` shape,
   `customFoods` dedupe, `bodyweightLog` merge, and that imported recipes carry
   `kind: "recipe"` with a valid `servings` and `items[]`.
4. Browser: log an imported recipe through `openRecipePortionStep()` and confirm
   the scaled macros are correct — this is the path that proves a recipe
   imported usefully rather than merely arriving.
5. jsdom: assert `syncNutritionGame()` awards **zero** XP for imported dates and
   that `bestStreak` is unchanged.
6. jsdom: run the import twice, assert entry counts are identical.
7. Browser: preview modal and file picker at mobile width.
8. Browser: verify on a second athlete — module-level caches in `app.js` survive
   athlete switches.

## Known unknowns

- **Real column headers.** `mapMfpRows` is written against expected MFP headers
  and will need one correction pass against an actual export file. `sniffMfpFile`
  detecting by header content rather than filename limits the blast radius.
- **Free-export format.** If the free export really is an encrypted `.xlsx`, the
  athlete must open it and re-save as CSV. Acceptable for a one-time migration;
  revisit only if it proves to be a real barrier in practice.
