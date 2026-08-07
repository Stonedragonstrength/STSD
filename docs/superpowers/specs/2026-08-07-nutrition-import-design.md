# Nutrition Tracker Import — Design

**Date:** 2026-08-07
**Status:** Approved, ready for implementation planning
**First source:** Cronometer. MyFitnessPal second.

## Context

Athletes arriving at Stone Dragon have years of history in another nutrition
tracker. The app already has a complete food logger — USDA food database, custom
foods, saved meals, water tracking, targets, and a nutrition game — but a new
athlete opens it empty. The friction of rebuilding a food library by hand keeps
people on the old app even once they have somewhere better to log.

The goal is migration, not synchronisation: a one-time import that carries an
athlete's history across so they can stop opening the other app. There is no
ongoing sync, and none is planned.

**Cronometer is the first source**, for one reason that outweighs everything
else: a real export can be produced today. Its export is plain CSV — no
password-protected workbook, no zip, no decryption — and `servings.csv` carries
per-food entries with up to 80+ nutrient columns. MyFitnessPal is second: its API
is private and closed to new developers, and no sample export exists yet to build
against.

**Out of scope:** Apple Watch / Apple Health. HealthKit is readable only by
native iOS apps, so a PWA cannot reach it. The workable bridge (Health Auto
Export) requires each athlete to install and configure a separate paid app, and
is iPhone-only, which excludes Android athletes entirely. The cost/benefit does
not justify it.

## What gets imported

| Data | Destination | Pruned? |
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
- **Cronometer exports plain CSV**, so the primary path needs no format
  workaround. If a *later* source hands us something else — MFP's free export has
  been reported as a password-protected `.xlsx` — the importer detects it and
  asks the athlete to re-save as CSV. No decryption, no xlsx parser, no new
  dependency, ever.

## Architecture

One new section in `app.js` beside the food logger (near `loadFoodDb`,
~line 28400) and one modal in `index.html`. No migration, no new table, no new
external dependency.

| Unit | Responsibility | Depends on |
|---|---|---|
| `parseCsv(text)` | RFC-4180 CSV → row objects. Quoted fields, embedded commas and newlines, CRLF. | — |
| `IMPORT_SOURCES` | Data table: per source, per kind, the candidate header names. The **only** source-specific code in the feature. | — |
| `sniffImportFile(headers)` | Identify `{ source, kind }` **by header columns**, not filename. | `IMPORT_SOURCES` |
| `mapImportRows(source, kind, parsed, opts)` | Rows → STSD entry shapes. Pure; writes nothing. | `IMPORT_SOURCES` |
| `applyImport(mapped)` | Write to `progress`, set XP boundary, `saveClient()`. | `progress` |

Parsing is pure and separated from writing so the preview screen can run the
whole pipeline and display results before anything is committed.

**Everything except `IMPORT_SOURCES` is source-agnostic.** Adding MyFitnessPal
later is adding a key to that table — not touching the parser, the mapper, the
writer, the XP fence, or the UI. This is the whole reason the design is shaped
this way rather than around a single vendor.

## Data flow

```
athlete picks file(s) → FileReader.readAsText
   ↓  .xlsx / .zip magic bytes detected → stop, show "re-save as CSV" help
parseCsv → sniffImportFile → mapImportRows
   ↓
preview: "412 diary days, 87 custom foods, 14 recipes, 230 weigh-ins"
         "232 days older than 180 discarded"  "14 rows skipped, no calorie data"
   ↓  athlete confirms
applyImport → foodLog / customFoods / savedMeals / bodyweightLog
   ↓
pruneFoodLog() → saveClient() → existing debounced cloud push
```

## Food matching

Diary entries keep the macros the source recorded. They are **not** matched
against the vendored USDA database. Matching would be lossy and would silently
rewrite the numbers the athlete actually ate. Entries are tagged with their
source (`src: "cron"`, later `src: "mfp"`), reusing the existing `src` field —
which already carries `"db"`, `"custom"`, `"quick"`, `"recipe"`.

Per-source tagging rather than a single `"import"` tag is deliberate: it keeps
re-import idempotent **per source**, so re-importing Cronometer cannot wipe
entries that came from somewhere else.

Quantities are stored verbatim as the source recorded them ("1 cup", "2
servings") rather than re-derived into grams.

Imported **custom foods** do become first-class: they land in
`progress.customFoods` and are immediately searchable through the existing
`foodSearch` path, which is what lets the athlete stop needing the old app.

**Recipes are not saved meals.** `savedMeals` holds both, distinguished by
`kind: "recipe"` (`app.js:30942`). A plain saved meal is a bundle of entries
logged as several lines; a recipe carries `servings` plus an `items[]` ingredient
list and logs as one line scaled by servings eaten, via `recipePerServing()` and
`openRecipePortionStep()` (`app.js:30958`). Recipes therefore map to the recipe
shape — `{ id, name, kind: "recipe", servings, items[], uses: 0, createdAt }`.
Mapping them to plain saved meals would lose the per-serving scaling that makes
a recipe usable.

Where a recipe's ingredients cannot be resolved to usable per-item macros,
import it as a single-item recipe carrying the recipe's own totals rather than
dropping it. `recipePerServing()` computes `foodDayTotals(items) / servings`, so
a single item holding the whole recipe's totals still scales correctly. A recipe
that logs correctly but cannot be edited ingredient-by-ingredient is far more
useful than one that never arrives.

## XP boundary

`applyImport` records `progress.nutritionGame.importedThrough` = the latest
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
- **Idempotent re-import, per source:** applying first removes existing entries
  *from that source* within the covered date range, so running the import twice
  yields the same result rather than doubling every meal — and without touching
  entries imported from a different app.
- Custom foods dedupe on name + brand against existing `customFoods`.
- Recipes dedupe on name against existing `savedMeals`.
- Weigh-ins dedupe on date against existing `bodyweightLog`.
- Days beyond the 180-day window are dropped at import with an explicit count,
  never written-then-pruned.

## Testing

1. `parseCsv` units: quoted fields, embedded commas, embedded newlines, CRLF,
   trailing newline, ragged rows.
2. `mapImportRows` units against fixture CSVs cut from the real Cronometer
   export.
3. jsdom harness: seed an athlete, run `applyImport`, assert `foodLog` shape,
   `customFoods` dedupe, `bodyweightLog` merge, and that imported recipes carry
   `kind: "recipe"` with a valid `servings` and `items[]`.
4. Browser: log an imported recipe through `openRecipePortionStep()` and confirm
   the scaled macros are correct — the path that proves a recipe imported
   usefully rather than merely arriving.
5. jsdom: assert `syncNutritionGame()` awards **zero** XP for imported dates and
   that `bestStreak` is unchanged.
6. jsdom: run the import twice, assert entry counts are identical.
7. Browser: preview modal and file picker at mobile width.
8. Browser: verify on a second athlete — module-level caches in `app.js` survive
   athlete switches.

## Adding a source

The design's one real claim is that a new source is a data edit. To add
MyFitnessPal once a real export exists:

1. Run the export through the importer. An unrecognised file reports its actual
   header row back as selectable text — that error is the instrument.
2. Add an `mfp` key to `IMPORT_SOURCES` with those header names.
3. Add a fixture row to the test file using the real headers.
4. Re-run the test.

No logic changes. **If adding a source needs more than new entries in
`IMPORT_SOURCES`, the abstraction was wrong — say so rather than working around
it.**

## Cronometer's export — verified 2026-08-07

Read from a real export. This section is fact, not guesswork.

Six files, always: `servings`, `dailysummary`, `biometrics`, `notes`, `fasts`,
`exercises`. The export screen offers no others.

**`servings.csv`** — 67 columns, one row per logged food. Carries per-food
macros, settling the open question.

| Column | Example | Maps to |
|---|---|---|
| `Day` | `2026-08-05` | `date` — already ISO |
| `Time` | `11:05 AM` | unused |
| `Group` | `Breakfast`, `Uncategorized` | `meal` |
| `Food Name` | `Blueberries, Fresh` | `name` |
| `Amount` | `100.00 g`, `8.00 fl oz` | `qty` + `unit` — **one field, must be split** |
| `Energy (kcal)` | `57.00` | `kcal` |
| `Protein (g)` / `Carbs (g)` / `Fat (g)` / `Fiber (g)` | | `p` / `c` / `f` / `fib` |
| `Net Carbs (g)`, `Category`, +55 micronutrients | | unused |

**`biometrics.csv`** — `Day, Time, Group, Metric, Unit, Amount`. Key-value, one
row per measurement, **not** a wide `Date, Weight` table. Weight means filtering
`Metric == "Weight"` and reading `Unit` for lb-vs-kg.

**`dailysummary.csv`** — `Date, Group, …same nutrients…, Completed`. `Group` is
a meal name or `Total`. Redundant with `servings` for our purposes.

**Water is logged as a food row** — `Food Name: "Water"`, `Amount: "8.00 fl oz"`,
no `Energy (kcal)`, only `Water (g)`. These belong in `progress.waterLog`, not
`foodLog`. `WATER_CUP_OZ = 8` (`app.js:28518`), so fl oz ÷ 8 is the cup count.

**`Group` is free text.** `Uncategorized` is common and Cronometer users can
rename groups, so meal mapping needs a fallback rather than a fixed set.

### What Cronometer cannot give us

**There is no custom-foods export and no recipes export.** The food library —
the single most valuable thing in a migration, and the reason this feature
exists — is not in Cronometer's export at any subscription tier.

This reverses the reasoning that put Cronometer first. It was chosen because a
real export could be produced and verified today, which was correct and did
settle the format. But the ceiling for this source is **diary + weight + water**,
not the food library. MyFitnessPal's export reportedly *does* include custom
foods and custom recipes — unverified, since no MFP export exists to check.

## Known unknowns

- **Cronometer column names.** Pending the real export, which is being fetched.
  Sources disagree on whether `servings.csv` carries per-food macros or only
  daily and per-meal totals; the file settles it. If it turns out to hold only
  daily totals, diary import falls back to one summary entry per day and the
  custom-foods and recipe halves are unaffected.
- **Recipe ingredient format.** Whether recipes export as separate ingredient
  rows, an embedded list, or not at all. The single-item-recipe fallback covers
  the worst case.
