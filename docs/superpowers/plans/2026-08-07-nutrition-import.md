# Nutrition Tracker Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an athlete upload their Cronometer export and land their diary, food library, recipes, water and weight in Stone Dragon's existing food logger, so they can stop using the other app.

**Architecture:** Pure pipeline — `parseCsv` → `sniffImportFile` → `mapImportRows` → `deriveLibrary` — feeding one impure writer, `applyImport`. Purity is what lets the preview run the whole pipeline and show results before anything is written. All source-specific knowledge lives in `IMPORT_SOURCES`, so adding MyFitnessPal later is a data edit.

**Tech Stack:** Vanilla ES2020 in `app.js` (one IIFE, no exports, no bundler). Tests are plain Node scripts, no framework, no install.

**Spec:** `docs/superpowers/specs/2026-08-07-nutrition-import-design.md`
**Fixture:** `docs/superpowers/specs/fixtures-cronometer-servings.csv` — a real export, verified 2026-08-07.

## Global Constraints

- **No new dependencies.** Supabase (CDN) is the only external dependency. No CSV library.
- **No build step.** Code goes into `app.js` directly.
- **`app.js` is one IIFE with no exports.** Tests **duplicate** functions rather than importing them. Every task adding a function to `app.js` must place a byte-identical copy in the test file, with a `DUPLICATES` comment. See `tests/README.md`.
- **Tests are plain Node scripts.** Copy the `eq()` harness from `tests/cancel-window.test.js:29-34`; end with `process.exit(fail ? 1 : 0)`. Run: `node tests/<name>.test.js`.
- **`FOOD_LOG_DAYS = 180`** (`app.js:28394`). Nothing older may be written to `foodLog`.
- **Writes go through `saveClient()`**, never `saveTrainer()`.
- **Imported days must never award XP or extend a streak.**
- **Meal keys are exactly** `breakfast`, `lunch`, `dinner`, `snack` (`app.js:28388`).
- **Entry shape:** `{ id, name, meal, qty, unit, grams, kcal, p, c, f, fib, src, ref, at }`.
- **Custom food shape** (`app.js:30472`, the code — *not* the stale migration comment): `{ id, name, per100, servingG, servingLabel, kcal, p, c, f, fib?, uses, createdAt }`. When `per100` is true, macros are per 100 g and logging scales by `grams/100`; otherwise macros are per one unit and scale by `qty`.
- **Bodyweight shape:** `{ id, date, weightLb }`.
- **`src: "cron"`** is the new tag. Existing: `"db"`, `"custom"`, `"quick"`, `"recipe"`.

### Facts verified from the real export — do not re-derive

- `Day` is already `YYYY-MM-DD`. No date parsing.
- `Time` **may be blank**. Never require it.
- `Amount` is `"<number> <unit>"` with a **multi-word** unit: `"100.00 g"`, `"8.00 fl oz"`, `"1.00 full recipe"`.
- `0.00` is a real logged value. **Only an empty cell means unknown.**
- **Byte-identical duplicate rows are legitimate** separate servings. Never collapse them.
- A **logged recipe is one row** carrying combined macros; its ingredients do not appear.
- An **unlogged custom food does not appear at all**. The library must be derived from the diary.
- Water logs as `Food Name: "Water"` with `Energy (kcal) = 0.00` and a `Water (g)` value.

---

## File Structure

| File | Responsibility |
|---|---|
| `app.js` — new `// ===== Nutrition tracker import =====` section after `renderMyFoods` (~line 31100) | Parser, source table, mappers, library derivation, writer, UI |
| `app.js:28683` `streakDay()` | Guard: imported days don't hold a streak |
| `app.js:28854` `syncNutritionGame()` | Guard: imported days award no XP |
| `app.js:31009` `openMyFoodsSheet()` | Entry point button |
| `index.html` | `?v=` cache bust only |
| `styles.css` | `.imp-*` classes |
| `tests/nutrition-import.test.js` | New |
| `tests/README.md` | Add a row |

---

### Task 1: CSV parser

**Files:**
- Create: `tests/nutrition-import.test.js`
- Modify: `app.js` (new section, ~line 31100)

**Interfaces:**
- Consumes: nothing
- Produces: `parseCsvGrid(text) -> string[][]`, `parseCsv(text) -> { headers: string[], rows: Object[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/nutrition-import.test.js`:

```js
// The nutrition-tracker importer's pure half: CSV parsing, source and file
// identification, column resolution, row mapping, and deriving a food library
// from a diary.
//
// This earns a test because it eats a file the app does not control. The column
// names in IMPORT_SOURCES.cron were read from a real Cronometer export
// (docs/superpowers/specs/fixtures-cronometer-servings.csv), but a vendor can
// rename a column at any time, and the behaviours pinned here are the ones that
// break silently when they do: 0.00 is a real value while an empty cell is
// unknown, duplicate rows are separate servings and must not collapse, a logged
// recipe is one row, and Amount carries a multi-word unit.
//
// DUPLICATES parseCsvGrid, parseCsv, normHeader, IMPORT_SOURCES, resolveColumns,
// sniffImportFile, cronNum, splitAmount, cronMealKey, mapImportRows and
// deriveLibrary (app.js), which is one IIFE with no exports. Change the
// original, change the copy here too, or this guards nothing.

// ---- copy of app.js ----
function parseCsvGrid(text) { return []; }
function parseCsv(text) { return { headers: [], rows: [] }; }
// ---- end copy ----

let pass = 0, fail = 0;
function eq(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
}

console.log("parseCsvGrid");
eq("plain row", parseCsvGrid("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
eq("quoted field with comma", parseCsvGrid('a,b\n"x,y",2'), [["a", "b"], ["x,y", "2"]]);
eq("escaped quote", parseCsvGrid('a\n"say ""hi"""'), [["a"], ['say "hi"']]);
eq("embedded newline", parseCsvGrid('a,b\n"one\ntwo",2'), [["a", "b"], ["one\ntwo", "2"]]);
eq("CRLF", parseCsvGrid("a,b\r\n1,2"), [["a", "b"], ["1", "2"]]);
eq("trailing newline makes no phantom row", parseCsvGrid("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
eq("BOM stripped", parseCsvGrid("﻿a,b\n1,2"), [["a", "b"], ["1", "2"]]);
eq("empty input", parseCsvGrid(""), []);

console.log("\nparseCsv");
eq("headers and objects", parseCsv("Day,Food Name\n2026-08-05,Eggs"),
   { headers: ["Day", "Food Name"], rows: [{ Day: "2026-08-05", "Food Name": "Eggs" }] });
eq("blank lines dropped", parseCsv("Day,Food Name\n2026-08-05,Eggs\n\n").rows.length, 1);
eq("ragged short row fills empty", parseCsv("a,b,c\n1,2").rows[0], { a: "1", b: "2", c: "" });
eq("values trimmed", parseCsv("a\n  x  ").rows[0], { a: "x" });
eq("header only", parseCsv("Day,Food Name"), { headers: ["Day", "Food Name"], rows: [] });
// Two identical servings are two servings. Nothing here may deduplicate.
eq("identical rows both survive", parseCsv("a\nWater\nWater").rows.length, 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/nutrition-import.test.js`
Expected: FAIL on every assertion, exit 1.

- [ ] **Step 3: Write the implementation in the test file**

Replace the stubs between the copy markers:

```js
// A hand-rolled RFC 4180 reader. No CSV library, because the app ships with one
// external dependency and a food import does not earn a second.
function parseCsvGrid(text) {
  const s = String(text ?? "").replace(/^﻿/, "");
  if (!s) return [];
  const grid = [];
  let row = [], field = "", quoted = false, i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); grid.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field !== "" || row.length) { row.push(field); grid.push(row); }
  return grid;
}

// Grid -> objects keyed by header. Short rows fill with "" so every consumer can
// treat a missing cell as an empty string.
function parseCsv(text) {
  const grid = parseCsvGrid(text);
  if (!grid.length) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => String(h).trim());
  const rows = grid.slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => {
      const o = {};
      headers.forEach((h, i) => { o[h] = String(r[i] ?? "").trim(); });
      return o;
    });
  return { headers, rows };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/nutrition-import.test.js`
Expected: `14 passed, 0 failed`, exit 0.

- [ ] **Step 5: Copy into `app.js`**

After `renderMyFoods()` ends (~line 31100):

```js
  // ================= Nutrition tracker import =================
  // A one-time migration, not a sync. The parse half is pure so the preview can
  // show what a file holds before a single entry is written.
  //
  // MIRRORED in tests/nutrition-import.test.js. Change one, change the other.

  // ...paste parseCsvGrid and parseCsv, indented two spaces...
```

- [ ] **Step 6: Commit**

```bash
git add tests/nutrition-import.test.js app.js
git commit -m "Add CSV parser for nutrition tracker import

Hand-rolled RFC 4180 reader rather than a dependency -- the app ships
with one external dependency and a food import does not earn a second.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Source table and file identification

**Files:**
- Modify: `tests/nutrition-import.test.js`, `app.js`

**Interfaces:**
- Consumes: `parseCsv`
- Produces: `normHeader(h) -> string`, `IMPORT_SOURCES` (const), `resolveColumns(source, kind, headers) -> { map, missing }`, `sniffImportFile(headers) -> { source, kind } | null`

- [ ] **Step 1: Write the failing test**

Add stubs to the copy block:

```js
function normHeader(h) { return ""; }
const IMPORT_SOURCES = {};
function resolveColumns(source, kind, headers) { return { map: {}, missing: [] }; }
function sniffImportFile(headers) { return null; }
```

Assertions:

```js
console.log("\nnormHeader");
eq("lowercases", normHeader("Day"), "day");
eq("collapses whitespace", normHeader("Food  Name"), "food name");
eq("underscores become spaces", normHeader("food_name"), "food name");
eq("keeps parens", normHeader("Energy (kcal)"), "energy (kcal)");
eq("trims", normHeader("  Day  "), "day");
eq("null safe", normHeader(null), "");

console.log("\nsniffImportFile");
// The real header rows, verbatim from the verified export.
const CRON_SERVINGS = ["Day", "Time", "Group", "Food Name", "Amount", "Energy (kcal)",
  "Carbs (g)", "Fiber (g)", "Fat (g)", "Protein (g)", "Category"];
const CRON_BIOMETRICS = ["Day", "Time", "Group", "Metric", "Unit", "Amount"];
eq("cronometer servings", sniffImportFile(CRON_SERVINGS), { source: "cron", kind: "diary" });
eq("cronometer biometrics", sniffImportFile(CRON_BIOMETRICS), { source: "cron", kind: "weight" });
eq("unknown file", sniffImportFile(["Colour", "Shape"]), null);
eq("empty headers", sniffImportFile([]), null);
// Detection is by content, not filename -- both files are named by the vendor.
eq("column order is irrelevant",
   sniffImportFile(["Energy (kcal)", "Food Name", "Day", "Amount"]), { source: "cron", kind: "diary" });
// servings and biometrics share Day/Time/Group/Amount. Diary must win.
eq("diary is not mistaken for weight", sniffImportFile(CRON_SERVINGS).kind, "diary");
// exercises.csv also has Day/Time/Group -- it must match nothing.
eq("exercises file is ignored",
   sniffImportFile(["Day", "Time", "Group", "Exercise", "Minutes", "Calories Burned"]), null);

console.log("\nresolveColumns");
eq("maps real headers",
   resolveColumns("cron", "diary", CRON_SERVINGS).map.kcal, "Energy (kcal)");
eq("nothing missing on the real file",
   resolveColumns("cron", "diary", CRON_SERVINGS).missing, []);
eq("reports what is missing",
   resolveColumns("cron", "weight", ["Day"]).missing, ["metric", "amount"]);
eq("case and spacing insensitive",
   resolveColumns("cron", "weight", ["  DAY ", "metric", "Amount", "unit"]).map.date, "  DAY ");
eq("optional absent is not missing",
   resolveColumns("cron", "diary", ["Day", "Food Name", "Amount", "Energy (kcal)"]).missing, []);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/nutrition-import.test.js` — new assertions FAIL, exit 1.

- [ ] **Step 3: Write the implementation**

```js
// Header matching is deliberately forgiving: vendors rename columns, and a
// trailing space must not cost an athlete their history.
function normHeader(h) {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .replace(/[^a-z0-9() ]/g, "")
    .trim();
}

// THE ONLY SOURCE-SPECIFIC CODE IN THE FEATURE.
// `cron` was read from a real export, verified 2026-08-07. `mfp` is left
// deliberately empty: no MyFitnessPal export has ever been seen, and inventing
// column names would put guesses next to facts. Fill it from a real file.
const IMPORT_SOURCES = {
  cron: {
    label: "Cronometer",
    kinds: {
      diary: {
        required: { date: ["day"], food: ["food name"], amount: ["amount"], kcal: ["energy (kcal)"] },
        optional: {
          group: ["group"], p: ["protein (g)"], c: ["carbs (g)"],
          f: ["fat (g)"], fib: ["fiber (g)"], water: ["water (g)"], category: ["category"],
        },
      },
      weight: {
        required: { date: ["day"], metric: ["metric"], amount: ["amount"] },
        optional: { unit: ["unit"] },
      },
    },
  },
};

function resolveColumns(source, kind, headers) {
  const spec = IMPORT_SOURCES[source]?.kinds?.[kind];
  if (!spec) return { map: {}, missing: [] };
  const byNorm = new Map();
  // First header wins, so a duplicate column cannot shadow the original.
  for (const h of headers || []) {
    const n = normHeader(h);
    if (n && !byNorm.has(n)) byNorm.set(n, h);
  }
  const map = {}, missing = [];
  for (const [field, aliases] of Object.entries(spec.required)) {
    const hit = aliases.map((a) => byNorm.get(a)).find((x) => x !== undefined);
    if (hit === undefined) missing.push(field); else map[field] = hit;
  }
  for (const [field, aliases] of Object.entries(spec.optional)) {
    const hit = aliases.map((a) => byNorm.get(a)).find((x) => x !== undefined);
    if (hit !== undefined) map[field] = hit;
  }
  return { map, missing };
}

// Ordered most-specific first. Cronometer's servings and biometrics files share
// Day/Time/Group/Amount, so diary must be tried before weight or a food log
// would be read as a pile of measurements.
const IMPORT_KINDS = ["diary", "weight"];

function sniffImportFile(headers) {
  if (!headers || !headers.length) return null;
  for (const source of Object.keys(IMPORT_SOURCES)) {
    for (const kind of IMPORT_KINDS) {
      if (!IMPORT_SOURCES[source].kinds[kind]) continue;
      if (!resolveColumns(source, kind, headers).missing.length) return { source, kind };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/nutrition-import.test.js`
Expected: `31 passed, 0 failed`, exit 0.

- [ ] **Step 5: Copy into `app.js`** — `normHeader`, `IMPORT_SOURCES`, `resolveColumns`, `IMPORT_KINDS`, `sniffImportFile`, byte-identically.

- [ ] **Step 6: Commit**

```bash
git add tests/nutrition-import.test.js app.js
git commit -m "Identify import files by column content, not filename

Column names read from a real Cronometer export. The mfp entry is left
empty on purpose: no MyFitnessPal export has been seen, and inventing
names would sit guesses next to verified facts.

Diary is matched before weight because Cronometer's servings and
biometrics files share Day/Time/Group/Amount.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Amount parsing and row mapping

**Files:**
- Modify: `tests/nutrition-import.test.js`, `app.js`

**Interfaces:**
- Consumes: Tasks 1-2
- Produces: `cronNum(raw) -> number|null`, `splitAmount(raw) -> { qty, unit }`, `cronMealKey(raw) -> string`, `mapImportRows(source, kind, parsed, opts) -> { source, kind, diary, water, weights, skipped, tooOld }`

`opts` is `{ today, windowDays }`. `today` is injected so tests are not time-dependent.

- [ ] **Step 1: Write the failing test**

Stubs:

```js
function cronNum(raw) { return null; }
function splitAmount(raw) { return { qty: 1, unit: "serving" }; }
function cronMealKey(raw) { return "snack"; }
function mapImportRows(source, kind, parsed, opts) {
  return { source, kind, diary: [], water: [], weights: [], skipped: 0, tooOld: 0 };
}
```

Assertions:

```js
console.log("\ncronNum");
eq("plain", cronNum("42"), 42);
eq("decimal", cronNum("57.00"), 57);
eq("thousands separator", cronNum("1,234"), 1234);
eq("empty is null", cronNum(""), null);
eq("dash is null", cronNum("-"), null);
eq("rubbish is null", cronNum("n/a"), null);
eq("null input", cronNum(null), null);
// The distinction the whole import rests on: water really is 0 kcal, but a
// blank protein cell is unknown. Collapsing these libels the athlete's day.
eq("zero is a real value, not null", cronNum("0.00"), 0);

console.log("\nsplitAmount");
eq("grams", splitAmount("100.00 g"), { qty: 100, unit: "g" });
// Multi-word units are real -- these two are verbatim from the export.
eq("multi-word unit", splitAmount("8.00 fl oz"), { qty: 8, unit: "fl oz" });
eq("full recipe", splitAmount("1.00 full recipe"), { qty: 1, unit: "full recipe" });
eq("no unit defaults to serving", splitAmount("2"), { qty: 2, unit: "serving" });
eq("empty defaults", splitAmount(""), { qty: 1, unit: "serving" });
eq("null safe", splitAmount(null), { qty: 1, unit: "serving" });

console.log("\ncronMealKey");
eq("breakfast", cronMealKey("Breakfast"), "breakfast");
eq("lunch", cronMealKey("lunch"), "lunch");
eq("dinner", cronMealKey(" Dinner "), "dinner");
eq("Snacks plural", cronMealKey("Snacks"), "snack");
// Cronometer's real default, and users may rename groups freely.
eq("Uncategorized falls back to snack", cronMealKey("Uncategorized"), "snack");
eq("custom group name falls back", cronMealKey("Pre-Workout"), "snack");
eq("empty falls back", cronMealKey(""), "snack");

const OPTS = { today: "2026-08-07", windowDays: 180 };
const H = "Day,Time,Group,Food Name,Amount,Energy (kcal),Protein (g),Carbs (g),Fat (g),Fiber (g),Water (g)";

console.log("\nmapImportRows diary");
const d = mapImportRows("cron", "diary", parseCsv([H,
  "2026-08-06,11:05 AM,Breakfast,Blueberries,100.00 g,57.00,0.70,14.57,0.31,2.40,84.19",
  "2026-08-07,,Dinner,ZZTest Chili,1.00 full recipe,291.49,21.28,38.04,6.44,9.74,",
  "2019-01-01,8:00 AM,Lunch,Ancient Toast,1.00 slice,90.00,3.00,17.00,1.00,1.00,",
  "2026-08-06,11:05 AM,Uncategorized,Water,8.00 fl oz,0.00,0.00,0.00,0.00,0.00,236.59",
  "2026-08-06,,Lunch,,100.00 g,,,,,,",
].join("\n")), OPTS);
eq("two food entries", d.diary.length, 2);
eq("one water entry", d.water.length, 1);
eq("one row too old", d.tooOld, 1);
eq("one unusable row skipped", d.skipped, 1);
eq("date carried", d.diary[0].date, "2026-08-06");
eq("meal mapped", d.diary[0].entry.meal, "breakfast");
eq("qty split from amount", d.diary[0].entry.qty, 100);
eq("unit split from amount", d.diary[0].entry.unit, "g");
eq("macros", [d.diary[0].entry.kcal, d.diary[0].entry.p, d.diary[0].entry.c, d.diary[0].entry.f], [57, 0.7, 14.57, 0.31]);
eq("tagged with its source", d.diary[0].entry.src, "cron");
eq("no ref into a database it did not come from", d.diary[0].entry.ref, null);
// A blank Time is normal -- the recipe row in the real export has none.
eq("blank Time is fine", d.diary[1].entry.name, "ZZTest Chili");
eq("multi-word unit survives", d.diary[1].entry.unit, "full recipe");
// Water is a food row in Cronometer but a separate log here.
eq("water routed out of the food log", d.water[0], { date: "2026-08-06", oz: 8 });

console.log("\nmapImportRows weight");
const w = mapImportRows("cron", "weight", parseCsv([
  "Day,Time,Group,Metric,Unit,Amount",
  "2026-08-06,7:00 AM,Uncategorized,Weight,lbs,181.4",
  "2026-08-05,7:00 AM,Uncategorized,Body Fat,%,18.2",
  "2026-08-04,7:00 AM,Uncategorized,Weight,kg,80",
  "2019-01-01,7:00 AM,Uncategorized,Weight,lbs,200",
].join("\n")), OPTS);
// Biometrics is key-value: every metric shares the file, so non-weight rows
// must be dropped rather than imported as bodyweight.
eq("only Weight rows", w.weights.length, 3);
eq("body fat ignored, not counted as skipped data loss", w.weights.map((x) => x.date).includes("2026-08-05"), false);
eq("pounds kept", w.weights[0].weightLb, 181.4);
eq("kg converted", w.weights[2].weightLb, 176.4);
// Weight is never pruned -- only foodLog has a window.
eq("old weigh-ins kept", w.weights.some((x) => x.date === "2019-01-01"), true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/nutrition-import.test.js` — new assertions FAIL.

- [ ] **Step 3: Write the implementation**

```js
// null, never 0. Water really is 0 kcal; a blank protein cell is unknown. Fold
// those together and every rollup misreports the day.
function cronNum(raw) {
  const s = String(raw ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return isFinite(n) ? n : null;
}

// "100.00 g" / "8.00 fl oz" / "1.00 full recipe". The unit is whatever follows
// the number, kept verbatim -- re-deriving grams from "full recipe" would be
// guesswork, and the macros are already correct for the amount logged.
function splitAmount(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { qty: 1, unit: "serving" };
  const qty = parseFloat(m[1]);
  const unit = m[2].trim();
  return { qty: isFinite(qty) ? qty : 1, unit: unit || "serving" };
}

const CRON_MEALS = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner", snack: "snack", snacks: "snack" };

// Cronometer's default group is "Uncategorized" and users can rename groups
// freely, so anything unrecognised becomes a snack rather than being dropped.
// A meal in the wrong slot is a nuisance; a missing meal is lost history.
function cronMealKey(raw) {
  return CRON_MEALS[String(raw ?? "").trim().toLowerCase()] || "snack";
}

const KG_LB = 2.20462;
const WATER_NAME = /^water$/i;

function mapImportRows(source, kind, parsed, opts) {
  const o = opts || {};
  const windowDays = Number(o.windowDays) || 180;
  const { map, missing } = resolveColumns(source, kind, parsed.headers);
  const out = { source, kind, diary: [], water: [], weights: [], skipped: 0, tooOld: 0 };
  if (missing.length) return out;

  // Inline rather than calling addDaysISO(): this half stays free of app.js
  // helpers so the test copy needs nothing around it.
  const cutoff = new Date(Date.parse(o.today + "T00:00:00Z") - windowDays * 86400000)
    .toISOString().slice(0, 10);

  for (const row of parsed.rows) {
    const get = (field) => (map[field] ? row[map[field]] : "");
    const date = String(get("date") || "").slice(0, 10);

    if (kind === "weight") {
      // Biometrics is key-value: weight, body fat, blood pressure all share the
      // file. Anything that is not weight is another metric, not lost data, so
      // it is passed over without counting as a skip.
      if (!/^weight$/i.test(String(get("metric") || "").trim())) continue;
      const n = cronNum(get("amount"));
      if (!date || n === null) { out.skipped++; continue; }
      const kg = /kg/i.test(String(get("unit") || ""));
      out.weights.push({ date, weightLb: Math.round((kg ? n * KG_LB : n) * 10) / 10 });
      continue;
    }

    const name = String(get("food") || "").trim();
    const kcal = cronNum(get("kcal"));
    if (!date || !name || kcal === null) { out.skipped++; continue; }

    const { qty, unit } = splitAmount(get("amount"));

    // Water is a food row in Cronometer and a separate log here. Routed before
    // the window check because waterLog is pruned on the same schedule anyway.
    if (WATER_NAME.test(name)) {
      if (date < cutoff) { out.tooOld++; continue; }
      out.water.push({ date, oz: /oz/i.test(unit) ? qty : qty / 29.5735 });
      continue;
    }

    // Dropped here rather than written and pruned later, so the preview can tell
    // the athlete the truth about what is arriving.
    if (date < cutoff) { out.tooOld++; continue; }

    out.diary.push({
      date,
      entry: {
        name,
        meal: cronMealKey(get("group")),
        qty,
        unit,
        grams: unit === "g" ? qty : null,
        kcal,
        p: cronNum(get("p")) ?? 0,
        c: cronNum(get("c")) ?? 0,
        f: cronNum(get("f")) ?? 0,
        fib: cronNum(get("fib")) ?? 0,
        src: source,
        ref: null,
      },
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/nutrition-import.test.js`
Expected: `62 passed, 0 failed`, exit 0.

- [ ] **Step 5: Copy into `app.js`** byte-identically.

- [ ] **Step 6: Commit**

```bash
git add tests/nutrition-import.test.js app.js
git commit -m "Map Cronometer rows to Stone Dragon shapes

Amount is one field carrying a number and a multi-word unit, so it is
split and the unit kept verbatim -- re-deriving grams from "full recipe"
would be guesswork on top of guesswork.

Water is a food row in Cronometer and a separate log here, so it is
routed to waterLog. Biometrics is key-value, so non-weight metrics are
passed over rather than imported as bodyweight.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Derive the food library from the diary

**Files:**
- Modify: `tests/nutrition-import.test.js`, `app.js`

**Interfaces:**
- Consumes: Task 3
- Produces: `deriveLibrary(diary) -> { foods: Object[], recipes: Object[] }`

**Why this exists:** an unlogged custom food never appears in the export — verified. So the athlete's library is reconstructed by deduplicating `Food Name` across the diary. This is the feature's headline benefit, and it is the piece with no counterpart in the old plan.

A `"full recipe"` unit marks a row as a recipe rather than a food; those go to `savedMeals` with `kind: "recipe"`.

- [ ] **Step 1: Write the failing test**

Stub: `function deriveLibrary(diary) { return { foods: [], recipes: [] }; }`

```js
console.log("\nderiveLibrary");
const lib = deriveLibrary([
  { date: "2026-08-01", entry: { name: "Blueberries", qty: 100, unit: "g", kcal: 57, p: 0.7, c: 14.57, f: 0.31, fib: 2.4 } },
  { date: "2026-08-03", entry: { name: "Blueberries", qty: 50, unit: "g", kcal: 28, p: 0.35, c: 7.3, f: 0.16, fib: 1.2 } },
  { date: "2026-08-02", entry: { name: "Whey Shake", qty: 1, unit: "scoop", kcal: 120, p: 24, c: 3, f: 1.5, fib: 0 } },
  { date: "2026-08-07", entry: { name: "ZZTest Chili", qty: 1, unit: "full recipe", kcal: 291.49, p: 21.28, c: 38.04, f: 6.44, fib: 9.74 } },
]);
eq("one entry per unique food", lib.foods.length, 2);
eq("recipes split out", lib.recipes.length, 1);
// Frequency is why deriving from the diary beats a library export: what someone
// ate twice outranks what they tried once.
eq("uses counts how often it was logged", lib.foods.find((f) => f.name === "Blueberries").uses, 2);
eq("single log counts once", lib.foods.find((f) => f.name === "Whey Shake").uses, 1);
// Grams normalise to per-100g so any future portion scales correctly.
const bb = lib.foods.find((f) => f.name === "Blueberries");
eq("gram foods are per100", bb.per100, true);
eq("per100 macros normalised from the most recent row", [bb.kcal, bb.p], [57, 0.7]);
eq("servingG set for gram foods", bb.servingG, 100);
// A non-gram unit cannot be normalised by weight, so macros are per one unit.
const ws = lib.foods.find((f) => f.name === "Whey Shake");
eq("non-gram foods are per-unit", ws.per100, false);
eq("per-unit macros are for one unit", [ws.kcal, ws.p], [120, 24]);
eq("serving label kept", ws.servingLabel, "scoop");
// A recipe logged as one row maps straight onto the recipe shape.
const rc = lib.recipes[0];
eq("recipe name", rc.name, "ZZTest Chili");
eq("recipe kind", rc.kind, "recipe");
// The export carries no servings count, so 1 reproduces what was logged.
eq("servings defaults to 1", rc.servings, 1);
eq("single item carrying whole-recipe totals", rc.items.length, 1);
eq("item macros are the recipe totals", rc.items[0].kcal, 291.49);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/nutrition-import.test.js` — new assertions FAIL.

- [ ] **Step 3: Write the implementation**

```js
// Cronometer never exports a food definition -- only servings actually logged.
// So the library is reconstructed from the diary. That is not a workaround: it
// yields the foods the athlete really ate, ranked by how often, instead of every
// abandoned entry they created once and forgot.
//
// A "full recipe" unit is how a logged recipe presents itself, and those belong
// in savedMeals rather than customFoods.
const RECIPE_UNIT = /recipe/i;

function deriveLibrary(diary) {
  const byName = new Map();
  for (const d of diary) {
    const key = d.entry.name.toLowerCase();
    const prev = byName.get(key);
    // Most recent wins: the newest logged portion is the best guess at how this
    // person actually eats the thing today.
    if (!prev || d.date >= prev.date) byName.set(key, { ...d, uses: (prev?.uses || 0) + 1 });
    else byName.set(key, { ...prev, uses: prev.uses + 1 });
  }

  const foods = [], recipes = [];
  for (const { entry, uses } of byName.values()) {
    if (RECIPE_UNIT.test(entry.unit)) {
      recipes.push({
        name: entry.name, kind: "recipe",
        // The export gives no servings count -- the athlete logged one whole
        // recipe -- so 1 reproduces exactly what they logged.
        servings: 1,
        items: [{ ...entry, meal: "dinner", qty: 1, unit: "recipe", grams: null }],
        uses,
      });
      continue;
    }
    const grams = entry.unit === "g" && entry.qty > 0;
    // Scale to the unit the app stores: per 100 g when we know the weight, per
    // one unit otherwise. Getting this backwards silently doubles or halves
    // every future portion of the food.
    const k = grams ? 100 / entry.qty : 1 / (entry.qty || 1);
    const r1 = (n) => Math.round((Number(n) || 0) * k * 10) / 10;
    foods.push({
      name: entry.name,
      per100: !!grams,
      servingG: grams ? 100 : 0,
      servingLabel: grams ? "100 g" : entry.unit,
      kcal: Math.round((Number(entry.kcal) || 0) * k),
      p: r1(entry.p), c: r1(entry.c), f: r1(entry.f), fib: r1(entry.fib),
      uses,
    });
  }
  return { foods, recipes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/nutrition-import.test.js`
Expected: `79 passed, 0 failed`, exit 0.

- [ ] **Step 5: Copy into `app.js`** byte-identically.

- [ ] **Step 6: Commit**

```bash
git add tests/nutrition-import.test.js app.js
git commit -m "Derive the food library from the diary

Cronometer never exports a food definition, only servings actually
logged -- verified against a real account. So the library is rebuilt by
deduplicating food names across the diary, which yields what the athlete
really ate ranked by frequency rather than every abandoned entry.

Gram portions normalise to per100 and everything else to per-unit,
matching how the food logger scales a portion. Getting that backwards
would silently double or halve every future log of the food.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Apply the import and fence off XP

**Files:**
- Modify: `app.js` — new `applyImport`; `app.js:28683` `streakDay()`; `app.js:28854` `syncNutritionGame()`

**Interfaces:**
- Consumes: Tasks 3-4, plus existing `ensureFoodLog`, `ensureNutritionGame`, `pruneFoodLog`, `saveClient`, `uid`, `todayISO`
- Produces: `applyImport(mapped) -> { days, entries, foods, recipes, water, weighIns, replaced }`

No unit test: it writes live app state. Covered by manual verification in Task 6, with its pure inputs already pinned by Tasks 1-4.

- [ ] **Step 1: Guard `streakDay()`**

At `app.js:28683`, immediately after the function opens:

```js
  function streakDay(progress, basePlan, dateKey) {
    // Imported history never holds a streak. An import covers months at a
    // stroke, and a streak that was bought rather than earned devalues the
    // ladder for everyone who earned theirs.
    const through = progress?.nutritionGame?.importedThrough;
    if (through && dateKey <= through) return false;
```

- [ ] **Step 2: Guard `syncNutritionGame()`**

At `app.js:28854`:

```js
    const imported = g.importedThrough || "";
    const dates = [...new Set([
      ...Object.keys(progress.foodLog || {}),
      ...Object.keys(g.awarded),
    ])].filter((d) => d >= cutoff && d <= today && !(imported && d <= imported)).sort();
```

- [ ] **Step 3: Write `applyImport`**

```js
  // The only impure step. Everything above produced plain data; this is where it
  // lands. Re-running must be safe, so entries from THIS source in the covered
  // range go first -- re-importing Cronometer must not touch anything that came
  // from another app.
  function applyImport(mapped) {
    const progress = state.clientData.progress;
    ensureFoodLog(progress);
    ensureNutritionGame(progress);

    const source = mapped[0]?.source || "cron";
    const diary = mapped.flatMap((m) => m.diary);
    const water = mapped.flatMap((m) => m.water);
    const weights = mapped.flatMap((m) => m.weights);
    const { foods, recipes } = deriveLibrary(diary);

    let replaced = 0;
    const dates = [...new Set(diary.map((d) => d.date))];
    for (const date of dates) {
      const list = progress.foodLog[date];
      if (!list) continue;
      const kept = list.filter((e) => e.src !== source);
      replaced += list.length - kept.length;
      if (kept.length) progress.foodLog[date] = kept; else delete progress.foodLog[date];
    }

    let entries = 0;
    for (const d of diary) {
      if (!progress.foodLog[d.date]) progress.foodLog[d.date] = [];
      progress.foodLog[d.date].push({ ...d.entry, id: uid(), at: Date.now() });
      entries++;
    }

    // Water is a count of cups per day, so same-day rows sum. Set rather than
    // add, so a re-import replaces the day instead of doubling it.
    const byDay = new Map();
    for (const w of water) byDay.set(w.date, (byDay.get(w.date) || 0) + w.oz);
    let waterDays = 0;
    for (const [date, oz] of byDay) {
      progress.waterLog[date] = Math.round(oz / WATER_CUP_OZ);
      waterDays++;
    }

    const haveFoods = new Set((progress.customFoods || []).map((f) => String(f.name).toLowerCase()));
    let addedFoods = 0;
    for (const f of foods) {
      if (haveFoods.has(f.name.toLowerCase())) continue;
      haveFoods.add(f.name.toLowerCase());
      progress.customFoods.push({ id: uid(), ...f, createdAt: todayISO() });
      addedFoods++;
    }

    const haveMeals = new Set((progress.savedMeals || []).map((m) => String(m.name).toLowerCase()));
    let addedRecipes = 0;
    for (const r of recipes) {
      if (haveMeals.has(r.name.toLowerCase())) continue;
      haveMeals.add(r.name.toLowerCase());
      progress.savedMeals.push({
        id: uid(), name: r.name, kind: "recipe", servings: r.servings,
        items: r.items.map((i) => ({ ...i, id: uid() })),
        uses: 0, createdAt: todayISO(),
      });
      addedRecipes++;
    }

    // One weigh-in per date; an existing entry wins, because it is the one the
    // athlete can see and delete.
    const haveDates = new Set((progress.bodyweightLog || []).map((b) => b.date));
    let weighIns = 0;
    for (const w of weights) {
      if (haveDates.has(w.date)) continue;
      haveDates.add(w.date);
      progress.bodyweightLog.push({ id: uid(), date: w.date, weightLb: w.weightLb });
      weighIns++;
    }

    // The XP fence. Everything on or before this date is history, not effort.
    const latest = diary.map((d) => d.date).sort().pop();
    if (latest) {
      const g = progress.nutritionGame;
      g.importedThrough = g.importedThrough && g.importedThrough > latest ? g.importedThrough : latest;
      for (const k of Object.keys(g.awarded || {})) {
        if (k <= g.importedThrough) {
          g.xp = Math.max(0, g.xp - (Number(g.awarded[k]) || 0));
          delete g.awarded[k];
        }
      }
    }

    pruneFoodLog(progress);
    saveClient();
    return { days: dates.length, entries, foods: addedFoods, recipes: addedRecipes, water: waterDays, weighIns, replaced };
  }
```

- [ ] **Step 4: Verify the existing suite still passes**

Run: `for f in tests/*.test.js; do node "$f" || echo "FAILED: $f"; done`
Expected: every file reports `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Apply the import and fence imported days out of XP

Imported days feed trends and the coach adherence view but award no XP
and cannot hold a streak -- an import covers months at a stroke, and a
ladder that can be bought devalues every athlete who climbed it.

Re-import is idempotent per source: only entries tagged with the source
being imported are cleared, so re-importing one app never disturbs
history from another.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Import UI

**Files:**
- Modify: `app.js` (import section, `openMyFoodsSheet` at 31009, `renderMyFoods` empty state at 31027), `styles.css`, `index.html`

**Interfaces:**
- Consumes: Tasks 1-5, plus `openModal`, `closeModal`, `toast`, `escapeHtml`, `renderClientDiet`, `FOOD_LOG_DAYS`, `todayISO`
- Produces: `openImportSheet()`

- [ ] **Step 1: File reading and the preview**

```js
  // "PK" is the zip magic number, which is what an .xlsx actually is. We ship no
  // decryptor and no xlsx parser for a one-time migration -- we tell the athlete
  // how to hand us something readable.
  function looksLikeZip(text) { return text.slice(0, 2) === "PK"; }

  function readImportFiles(files) {
    return Promise.all([...files].map((file) => new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve({ name: file.name, text: String(r.result || "") });
      r.onerror = () => resolve({ name: file.name, text: "", error: "unreadable" });
      r.readAsText(file);
    })));
  }

  function openImportSheet() {
    openModal({
      title: "Import your food history",
      body: `
        <p class="muted" style="margin-top:0">
          Export your data from Cronometer, then pick the CSV files here.
          Your foods, recipes, recent diary, water and weight come across.
        </p>
        <label>Export files
          <input type="file" id="imp-files" multiple accept=".csv,text/csv" />
        </label>
        <div id="imp-result"></div>`,
      actions: [{ label: "Close", className: "btn btn-ghost", onClick: () => { closeModal(); renderFoodDay(); } }],
    });
    $("#imp-files").addEventListener("change", async (ev) => {
      const out = $("#imp-result");
      out.innerHTML = `<p class="muted">Reading…</p>`;
      renderImportPreview(await readImportFiles(ev.target.files), out);
    });
  }
```

- [ ] **Step 2: The preview, including the header-reporting failure path**

```js
  function renderImportPreview(files, out) {
    const opts = { today: todayISO(), windowDays: FOOD_LOG_DAYS };
    const mapped = [], unknown = [];

    for (const f of files) {
      if (looksLikeZip(f.text)) {
        out.innerHTML = `<p class="imp-warn">${escapeHtml(f.name)} is a zip or spreadsheet, not a CSV.
          Open it, then use <b>File &rsaquo; Save As</b> and choose CSV.</p>`;
        return;
      }
      const parsed = parseCsv(f.text);
      const hit = sniffImportFile(parsed.headers);
      if (!hit) { unknown.push({ name: f.name, headers: parsed.headers }); continue; }
      mapped.push(mapImportRows(hit.source, hit.kind, parsed, opts));
    }

    // With only one verified source, the first athlete on a different app is how
    // we learn its column names -- so an unrecognised file must hand those names
    // back, not just say "unrecognised".
    if (unknown.length) {
      out.innerHTML = unknown.map((u) => `
        <p class="imp-warn">Couldn't tell what <b>${escapeHtml(u.name)}</b> holds.</p>
        <p class="muted">Send your coach this line and it can be added:</p>
        <textarea readonly rows="3" class="imp-headers"
          onclick="this.select()">${escapeHtml(u.headers.join(", "))}</textarea>`).join("");
      if (!mapped.length) return;
    }

    const diary = mapped.flatMap((m) => m.diary);
    const { foods, recipes } = deriveLibrary(diary);
    const days = new Set(diary.map((d) => d.date)).size;
    const tooOld = mapped.reduce((n, m) => n + m.tooOld, 0);
    const skipped = mapped.reduce((n, m) => n + m.skipped, 0);
    const weighIns = mapped.reduce((n, m) => n + m.weights.length, 0);

    out.innerHTML += `
      <ul class="imp-summary">
        <li><b>${days}</b> diary days (${diary.length} entries)</li>
        <li><b>${foods.length}</b> foods for your library</li>
        <li><b>${recipes.length}</b> recipes</li>
        <li><b>${weighIns}</b> weigh-ins</li>
      </ul>
      ${tooOld ? `<p class="muted">${tooOld} entries are older than ${FOOD_LOG_DAYS} days and won't be imported — the log keeps a rolling window.</p>` : ""}
      ${skipped ? `<p class="muted">${skipped} rows skipped: no name or calorie value.</p>` : ""}
      <button class="btn btn-primary" id="imp-go">Import</button>`;

    $("#imp-go")?.addEventListener("click", () => {
      const r = applyImport(mapped);
      closeModal();
      renderClientDiet();
      toast(`Imported ${r.entries} entries, ${r.foods} foods, ${r.recipes} recipes ✓`);
    });
  }
```

- [ ] **Step 3: Entry points**

In `openMyFoodsSheet()` (`app.js:31009`), add before Close:

```js
        { label: "Import history", className: "btn btn-ghost", onClick: () => openImportSheet() },
```

And in `renderMyFoods()`'s empty state (`app.js:31027`) — where an athlete most needs it:

```js
      el.innerHTML = `<p class="muted">Nothing saved yet. Foods you create and recipes you build land here.</p>
        <p class="muted">Coming from another app? <a href="#" id="myfoods-import">Import your foods and history.</a></p>`;
      $("#myfoods-import")?.addEventListener("click", (e) => { e.preventDefault(); openImportSheet(); });
      return;
```

- [ ] **Step 4: Styles**

```css
.imp-summary { margin: 12px 0; padding-left: 20px; }
.imp-summary li { margin: 4px 0; }
.imp-warn { color: var(--warn); }
.imp-headers { width: 100%; font-family: monospace; font-size: 12px;
  background: rgba(var(--primary-rgb), 0.06); border: 1px solid rgba(var(--primary-rgb), 0.25);
  border-radius: 8px; padding: 8px; color: var(--text); }
```

`.imp-warn` is needed because `.warn` exists only as a modifier in this codebase
(`.exn-chip.warn`, `styles.css:6287`) and does nothing alone. Colours come from
`--primary-rgb` and `--warn`, so this survives all ten themes including the light one.

- [ ] **Step 5: Cache bust**

Bump `?v=` on the `app.js` and `styles.css` tags in `index.html`. Without it, installed PWAs keep the old build.

- [ ] **Step 6: Verify in the browser**

Use the `STSD:verify` skill to boot the app. Then:

1. Athlete food screen → My foods and recipes → **Import history**.
2. Upload `docs/superpowers/specs/fixtures-cronometer-servings.csv`. The file holds
   two Water rows, one Blueberries row and one ZZTest Chili row, so the preview
   must report **2 diary days, 1 food, 1 recipe, 0 weigh-ins** — Water routes to
   the water log and the recipe is not counted as a food.
3. Upload a file with junk headers. **Confirm the actual header line displays and is selectable** — the requirement the whole build-before-more-sources strategy rests on.
4. Rename a `.zip` to `.csv` and upload. Confirm the "Save As CSV" message and that nothing is written.
5. Import, then import the same file again. Confirm counts are identical, not doubled.
6. Log the imported recipe through the portion step; confirm per-serving macros equal the recipe totals ÷ servings.
7. Log an imported gram-based food at a different portion; confirm macros scale correctly (this is the `per100` check).
8. Confirm the nutrition rank/XP badge did not move and the streak flame did not light.
9. Confirm water shows on the imported day.
10. Repeat on a second athlete — module-level caches in `app.js` survive athlete switches.
11. Check the modal at 390px width.

- [ ] **Step 7: Commit**

```bash
git add app.js styles.css index.html
git commit -m "Add the nutrition import UI

The unrecognised-file path reports the actual header row back as
selectable text. With one verified source, that error is the instrument:
the first athlete on another app tells us its real column names instead
of dead-ending.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Documentation

- [ ] **Step 1: Add a row to `tests/README.md`**

```markdown
| `nutrition-import.test.js` | the nutrition-tracker importer's pure half — CSV parse, file sniffing, column resolution, row mapping, library derivation | It eats a file the app does not control. `IMPORT_SOURCES.cron` was read from a real export, but a vendor can rename a column any time, and the behaviours pinned here are the ones that break silently when they do: `0.00` is a real value while an empty cell is unknown, duplicate rows are separate servings, a logged recipe is one row, `Amount` carries a multi-word unit, and gram foods must normalise to `per100` or every future portion is silently doubled or halved. |
```

- [ ] **Step 2: Note the importer in `CLAUDE.md`** under **Key UI flows**:

```markdown
- **Nutrition import** → athlete uploads CSVs → `parseCsv` → `sniffImportFile` → `mapImportRows` → `deriveLibrary` → preview → `applyImport()` writes `foodLog`/`customFoods`/`savedMeals`/`waterLog`/`bodyweightLog` via `saveClient()`. All source-specific knowledge lives in `IMPORT_SOURCES`; imported days are fenced out of XP by `nutritionGame.importedThrough`. The food library is derived from the diary because trackers export servings, not definitions.
```

- [ ] **Step 3: Commit**

```bash
git add tests/README.md CLAUDE.md
git commit -m "Document the nutrition importer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Adding a second source

`IMPORT_SOURCES` deliberately carries **only** `cron`. There is no `mfp` key,
empty or otherwise: no MyFitnessPal export has ever been seen, and a stub of
invented column names would sit guesses beside verified facts and look equally
trustworthy. When a real MyFitnessPal export exists:

1. Run it through the importer. An unrecognised file reports its header row back.
2. Add an `mfp` key with those names and its `kinds`.
3. Add a fixture and assertions using the real headers.
4. Re-run `node tests/nutrition-import.test.js`.

**If adding a source needs more than new entries in `IMPORT_SOURCES`, the abstraction was wrong — say so rather than working around it.**
