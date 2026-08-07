# Nutrition Tracker Import Implementation Plan

> **⚠️ AWAITING RETARGET — do not execute yet.**
>
> This plan was written against MyFitnessPal with no sample export available, so
> every column name in it is a guess. The spec has since been retargeted:
> **Cronometer is now the first source** (see
> `docs/superpowers/specs/2026-08-07-nutrition-import-design.md`), because a real
> Cronometer export can be produced today and is plain CSV.
>
> The structure below — CSV parser, column-table indirection, pure mapper,
> idempotent writer, XP fence, header-reporting error path — is unchanged and
> still correct. What changes when the export lands:
>
> - `MFP_COLUMNS` → `IMPORT_SOURCES` (keyed by source, then kind)
> - `sniffMfpFile(headers)` → `sniffImportFile(headers)` returning `{ source, kind }`
> - `mapMfpRows(kind, …)` → `mapImportRows(source, kind, …)`
> - `applyMfpImport` → `applyImport`, clearing prior entries **per source** so a
>   Cronometer re-import cannot wipe entries from another app
> - `src: "mfp"` → `src: "cron"`, with `"mfp"` added later
> - Every fixture CSV replaced with rows cut from the real export
>
> Deliberately **not** rewritten yet: turning MFP column guesses into Cronometer
> column guesses is churn the real file would immediately invalidate. Retarget
> once, against the actual headers.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an athlete upload their MyFitnessPal export and land their custom foods, recipes, recent diary, and weight history in Stone Dragon's existing food logger, so they can stop using MFP.

**Architecture:** Four pure functions (CSV parse → file sniff → column resolve → row map) feeding one impure writer (`applyMfpImport`). Purity is what lets the preview screen run the whole pipeline and show results before anything is written. All MFP-format knowledge is confined to one `MFP_COLUMNS` data table, because no real export file exists yet.

**Tech Stack:** Vanilla ES2020 in `app.js` (one IIFE, no exports, no bundler). Tests are plain Node scripts, no framework, no install.

## Global Constraints

- **No new dependencies.** Supabase (CDN) is the only external dependency. No CSV library, no xlsx parser, no decryption.
- **No build step.** Code goes directly into `app.js`; there is nothing to compile.
- **`app.js` is one IIFE with no exports.** Tests therefore **duplicate** functions rather than importing them. Every task that adds a function to `app.js` must place a byte-identical copy in the test file, and the test file must carry a `DUPLICATES` comment naming the app.js function. See `tests/README.md`.
- **Tests are plain Node scripts.** No framework. Use the existing `eq()` harness (copy from `tests/cancel-window.test.js:29-34`) and end with `process.exit(fail ? 1 : 0)`. Run with `node tests/<name>.test.js`.
- **`FOOD_LOG_DAYS = 180`** (`app.js:28394`). Nothing older may be written to `foodLog`.
- **Writes go through `saveClient()`**, never `saveTrainer()`. `progress` is athlete-owned; a `saveTrainer()` here would lose athlete work.
- **Imported days must never award XP or extend a streak.**
- **Meal keys are exactly** `breakfast`, `lunch`, `dinner`, `snack` (`app.js:28388-28393`).
- **Entry shape:** `{ id, name, meal, qty, unit, grams, kcal, p, c, f, fib, src, ref, at }`.
- **Bodyweight shape:** `{ id, date, weightLb }`.
- **`src: "mfp"`** is the new tag. Existing values are `"db"`, `"custom"`, `"quick"`, `"recipe"`.

---

## File Structure

| File | Responsibility |
|---|---|
| `app.js` — new `// ===== MyFitnessPal import =====` section, placed after the food logger's `renderMyFoods` (~line 31100) | Parser, column table, mapper, writer, UI. Writes `foodLog`, `customFoods`, `savedMeals` (recipes), `bodyweightLog` |
| `app.js:28683` `streakDay()` | Guard: imported days don't hold a streak |
| `app.js:28854` `syncNutritionGame()` | Guard: imported days award no XP |
| `app.js:31009` `openMyFoodsSheet()` | Entry point button |
| `index.html` | `?v=` cache bust only — the modal is built by `openModal()`, no new markup |
| `tests/mfp-import.test.js` | New. Covers parse, sniff, column resolve, row map |
| `tests/README.md` | Add a row to the table |

---

### Task 1: CSV parser

**Files:**
- Create: `tests/mfp-import.test.js`
- Modify: `app.js` (new section after `renderMyFoods`, ~line 31100)

**Interfaces:**
- Consumes: nothing
- Produces: `parseCsvGrid(text) -> string[][]`, `parseCsv(text) -> { headers: string[], rows: Object[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/mfp-import.test.js`:

```js
// The MyFitnessPal importer's pure half: CSV parsing, file identification,
// column resolution and row mapping.
//
// This earns a test because it is the one part of the app that eats a file we
// have never seen. No real MFP export was available when it was written, so the
// column names in MFP_COLUMNS are educated guesses and WILL need correcting
// against a real file. Everything around them — quoting, blank rows, the
// 180-day cutoff, unit conversion, dedupe keys — is format-independent and is
// pinned here so that correction pass cannot quietly break it.
//
// DUPLICATES parseCsvGrid, parseCsv, normHeader, MFP_COLUMNS, resolveColumns,
// sniffMfpFile, mfpMealKey and mapMfpRows (app.js), which is one IIFE with no
// exports. Change the original, change the copy here too, or this guards
// nothing.

// ---- copy of app.js ----
function parseCsvGrid(text) {
  return [];
}

function parseCsv(text) {
  return { headers: [], rows: [] };
}
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
eq("headers and objects", parseCsv("Date,Food\n2026-01-01,Eggs"),
   { headers: ["Date", "Food"], rows: [{ Date: "2026-01-01", Food: "Eggs" }] });
eq("blank lines dropped", parseCsv("Date,Food\n2026-01-01,Eggs\n\n").rows.length, 1);
eq("ragged short row fills empty", parseCsv("a,b,c\n1,2").rows[0], { a: "1", b: "2", c: "" });
eq("values trimmed", parseCsv("a\n  x  ").rows[0], { a: "x" });
eq("header only", parseCsv("Date,Food"), { headers: ["Date", "Food"], rows: [] });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mfp-import.test.js`
Expected: FAIL on every assertion, exit code 1 (the stubs return `[]` / empty).

- [ ] **Step 3: Write the implementation in the test file**

Replace the stub block in `tests/mfp-import.test.js` between the `---- copy of app.js ----` markers:

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
      // A doubled quote inside a quoted field is one literal quote.
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
  // A trailing newline leaves nothing pending; anything else is a final row.
  if (field !== "" || row.length) { row.push(field); grid.push(row); }
  return grid;
}

// Grid -> objects keyed by header. Short rows fill with "" rather than
// undefined so every consumer can treat a missing cell as an empty string.
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

Run: `node tests/mfp-import.test.js`
Expected: `13 passed, 0 failed`, exit code 0.

- [ ] **Step 5: Copy the two functions into `app.js`**

In `app.js`, immediately after `renderMyFoods()` ends (~line 31100), open the new section and paste `parseCsvGrid` and `parseCsv` **byte-identically**:

```js
  // ================= MyFitnessPal import =================
  // A one-time migration, not a sync: MFP's API is private and closed to new
  // developers, so a file upload is the only door. The parse half is pure so
  // the preview can show what a file holds before a single entry is written.
  //
  // MIRRORED in tests/mfp-import.test.js. Change one, change the other.

  // ...paste parseCsvGrid and parseCsv here, indented two spaces...
```

- [ ] **Step 6: Commit**

```bash
git add tests/mfp-import.test.js app.js
git commit -m "Add CSV parser for MyFitnessPal import

Hand-rolled RFC 4180 reader rather than a dependency -- the app ships
with one external dependency and a food import does not earn a second.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: File identification and column resolution

**Files:**
- Modify: `tests/mfp-import.test.js`
- Modify: `app.js` (MFP import section)

**Interfaces:**
- Consumes: `parseCsv` (Task 1)
- Produces: `normHeader(h) -> string`, `MFP_COLUMNS` (const), `resolveColumns(kind, headers) -> { map: Object, missing: string[] }`, `sniffMfpFile(headers) -> "diary"|"foods"|"weight"|null`

- [ ] **Step 1: Write the failing test**

Append to `tests/mfp-import.test.js`, before the `console.log(\`\n${pass} passed...\`)` line. Add stubs inside the copy block first:

```js
function normHeader(h) { return ""; }
const MFP_COLUMNS = {};
function resolveColumns(kind, headers) { return { map: {}, missing: [] }; }
function sniffMfpFile(headers) { return null; }
```

Then the assertions:

```js
console.log("\nnormHeader");
eq("lowercases", normHeader("Date"), "date");
eq("collapses whitespace", normHeader("Food  Name"), "food name");
eq("underscores become spaces", normHeader("food_name"), "food name");
eq("strips punctuation but keeps parens", normHeader("Protein (g)"), "protein (g)");
eq("trims", normHeader("  Date  "), "date");
eq("null safe", normHeader(null), "");

console.log("\nsniffMfpFile");
eq("diary by its columns", sniffMfpFile(["Date", "Meal", "Food", "Calories"]), "diary");
eq("weight by its columns", sniffMfpFile(["Date", "Weight"]), "weight");
eq("custom foods by its columns", sniffMfpFile(["Food Name", "Brand", "Calories"]), "foods");
eq("unknown file", sniffMfpFile(["Colour", "Shape"]), null);
eq("empty headers", sniffMfpFile([]), null);
// Detection is by content, not filename, because MFP renames these files.
eq("column order is irrelevant", sniffMfpFile(["Calories", "Food", "Date", "Meal"]), "diary");
// Diary and weight both carry Date; the tie must not resolve to weight.
eq("diary wins over weight when both could match", sniffMfpFile(["Date", "Food", "Calories", "Weight"]), "diary");

console.log("\nresolveColumns");
eq("maps aliases to real headers",
   resolveColumns("weight", ["Date", "Weight"]).map,
   { date: "Date", weight: "Weight" });
eq("nothing missing when all present", resolveColumns("weight", ["Date", "Weight"]).missing, []);
eq("reports what is missing", resolveColumns("weight", ["Date"]).missing, ["weight"]);
eq("case and spacing insensitive",
   resolveColumns("weight", ["  DATE ", "weight"]).map,
   { date: "  DATE ", weight: "weight" });
eq("optional columns absent is not missing",
   resolveColumns("diary", ["Date", "Food", "Calories"]).missing, []);
eq("optional columns map when present",
   resolveColumns("diary", ["Date", "Food", "Calories", "Protein (g)"]).map.p, "Protein (g)");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mfp-import.test.js`
Expected: the new assertions FAIL, exit code 1.

- [ ] **Step 3: Write the implementation in the test file**

Replace the four stubs:

```js
// Header matching is deliberately forgiving: MFP has renamed these columns
// before and will again, and a trailing space must not cost an athlete their
// history.
function normHeader(h) {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .replace(/[^a-z0-9() ]/g, "")
    .trim();
}

// THE ONLY PART THAT DEPENDS ON MFP'S REAL FORMAT.
// Written without a sample export, so treat every name here as a guess.
// Correcting it against a real file is editing strings — nothing else moves.
const MFP_COLUMNS = {
  diary: {
    required: {
      date: ["date"],
      food: ["food", "food name", "item", "description"],
      kcal: ["calories", "energy (kcal)", "kcal"],
    },
    optional: {
      meal: ["meal", "meal name"],
      qty: ["amount", "quantity", "servings", "number of servings"],
      unit: ["serving size", "serving", "unit"],
      p: ["protein (g)", "protein"],
      c: ["carbohydrates (g)", "carbs (g)", "carbohydrates", "carbs"],
      f: ["fat (g)", "fat"],
      fib: ["fiber (g)", "fibre (g)", "fiber", "fibre"],
    },
  },
  foods: {
    required: {
      food: ["food name", "food", "name", "description"],
      kcal: ["calories", "energy (kcal)", "kcal"],
    },
    optional: {
      brand: ["brand", "brand name", "manufacturer"],
      unit: ["serving size", "serving", "unit"],
      p: ["protein (g)", "protein"],
      c: ["carbohydrates (g)", "carbs (g)", "carbohydrates", "carbs"],
      f: ["fat (g)", "fat"],
      fib: ["fiber (g)", "fibre (g)", "fiber", "fibre"],
    },
  },
  weight: {
    required: {
      date: ["date"],
      weight: ["weight", "weight (lbs)", "weight (lb)", "weight (kg)"],
    },
    optional: {},
  },
};

function resolveColumns(kind, headers) {
  const spec = MFP_COLUMNS[kind];
  if (!spec) return { map: {}, missing: [] };
  const byNorm = new Map();
  // First header wins, so a duplicate column name cannot shadow the original.
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

// Ordered most-specific first: a diary export also carries a Date column, so
// weight must be considered only after diary has been ruled out.
const MFP_KINDS = ["diary", "foods", "weight"];

function sniffMfpFile(headers) {
  if (!headers || !headers.length) return null;
  for (const kind of MFP_KINDS) {
    if (!resolveColumns(kind, headers).missing.length) return kind;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/mfp-import.test.js`
Expected: `32 passed, 0 failed`, exit code 0.

- [ ] **Step 5: Copy into `app.js`**

Paste `normHeader`, `MFP_COLUMNS`, `resolveColumns`, `MFP_KINDS`, `sniffMfpFile` byte-identically into the MFP import section, after `parseCsv`.

- [ ] **Step 6: Commit**

```bash
git add tests/mfp-import.test.js app.js
git commit -m "Identify MFP files by column content, not filename

All format guesswork is confined to MFP_COLUMNS so correcting it against
a real export is editing strings. Diary is checked before weight because
both carry a Date column.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Row mapping

**Files:**
- Modify: `tests/mfp-import.test.js`
- Modify: `app.js` (MFP import section)

**Interfaces:**
- Consumes: `parseCsv`, `resolveColumns`, `sniffMfpFile` (Tasks 1-2)
- Produces: `mfpMealKey(raw) -> string`, `mfpNum(raw) -> number|null`, `mapMfpRows(kind, parsed, opts) -> { kind, items: Object[], skipped: number, tooOld: number }`

`opts` is `{ today: "YYYY-MM-DD", windowDays: 180, kgToLb: boolean }`. `today` is injected rather than read from the clock so the test is not time-dependent.

- [ ] **Step 1: Write the failing test**

Add stubs to the copy block:

```js
function mfpMealKey(raw) { return "snack"; }
function mfpNum(raw) { return null; }
function mapMfpRows(kind, parsed, opts) { return { kind, items: [], skipped: 0, tooOld: 0 }; }
```

Assertions:

```js
console.log("\nmfpMealKey");
eq("breakfast", mfpMealKey("Breakfast"), "breakfast");
eq("lunch lowercase", mfpMealKey("lunch"), "lunch");
eq("dinner padded", mfpMealKey(" Dinner "), "dinner");
eq("MFP plural Snacks", mfpMealKey("Snacks"), "snack");
eq("singular Snack", mfpMealKey("Snack"), "snack");
// Premium users rename meals; anything unrecognised is a snack, never dropped.
eq("custom meal name falls back to snack", mfpMealKey("Pre-Workout"), "snack");
eq("empty falls back to snack", mfpMealKey(""), "snack");

console.log("\nmfpNum");
eq("plain number", mfpNum("42"), 42);
eq("decimal", mfpNum("1.5"), 1.5);
eq("thousands separator", mfpNum("1,234"), 1234);
eq("unit suffix stripped", mfpNum("12 g"), 12);
eq("empty is null not zero", mfpNum(""), null);
eq("dash is null", mfpNum("-"), null);
eq("rubbish is null", mfpNum("n/a"), null);
// A null must never become 0: a blank protein cell is unknown, not zero grams.
eq("null input", mfpNum(null), null);

const OPTS = { today: "2026-08-07", windowDays: 180, kgToLb: false };

console.log("\nmapMfpRows diary");
const diary = parseCsv([
  "Date,Meal,Food,Calories,Protein (g),Carbohydrates (g),Fat (g)",
  "2026-08-06,Breakfast,Eggs,180,12,1,14",
  "2026-08-06,Lunch,Rice,205,4,45,0.4",
  "2020-01-01,Dinner,Ancient Toast,90,3,17,1",
  "2026-08-05,Snacks,Broken Row,,,,",
].join("\n"));
const dm = mapMfpRows("diary", diary, OPTS);
eq("keeps in-window rows", dm.items.length, 2);
eq("drops rows older than the window", dm.tooOld, 1);
eq("skips rows with no calories", dm.skipped, 1);
eq("maps meal key", dm.items[0].meal, "breakfast");
eq("carries date", dm.items[0].date, "2026-08-06");
eq("tags source", dm.items[0].entry.src, "mfp");
eq("no ref into a database it did not come from", dm.items[0].entry.ref, null);
eq("macros mapped", [dm.items[0].entry.kcal, dm.items[0].entry.p, dm.items[0].entry.c, dm.items[0].entry.f],
   [180, 12, 1, 14]);
eq("name carried", dm.items[0].entry.name, "Eggs");

console.log("\nmapMfpRows weight");
const wt = parseCsv("Date,Weight\n2026-08-06,181.4\n2019-01-01,200\n2026-08-05,\n");
const wm = mapMfpRows("weight", wt, OPTS);
// Weight is not pruned, so old weigh-ins are kept -- only foodLog has a window.
eq("keeps all dates, however old", wm.items.length, 2);
eq("no tooOld for weight", wm.tooOld, 0);
eq("skips blank weight", wm.skipped, 1);
eq("weight in pounds", wm.items[0].weightLb, 181.4);
eq("kg converts to lb", mapMfpRows("weight", parseCsv("Date,Weight\n2026-08-06,80"),
   { ...OPTS, kgToLb: true }).items[0].weightLb, 176.4);

console.log("\nmapMfpRows foods");
const fd = parseCsv("Food Name,Brand,Calories,Protein (g),Carbohydrates (g),Fat (g)\nWhey,MyBrand,120,24,3,1\n,,,,,\n");
const fm = mapMfpRows("foods", fd, OPTS);
eq("one usable food", fm.items.length, 1);
eq("food name", fm.items[0].name, "Whey");
eq("brand kept for dedupe", fm.items[0].brand, "MyBrand");
eq("calories", fm.items[0].kcal, 120);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mfp-import.test.js`
Expected: new assertions FAIL, exit code 1.

- [ ] **Step 3: Write the implementation in the test file**

```js
const MFP_MEALS = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner", snack: "snack", snacks: "snack" };

// Premium users rename their meals. An unrecognised name becomes a snack
// rather than dropping the food -- a meal in the wrong slot is a nuisance, a
// missing meal is lost history.
function mfpMealKey(raw) {
  return MFP_MEALS[String(raw ?? "").trim().toLowerCase()] || "snack";
}

// null, never 0. A blank protein cell means "MFP did not record this", and
// zeroing it would quietly libel the athlete's day in every rollup.
function mfpNum(raw) {
  const s = String(raw ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return isFinite(n) ? n : null;
}

const KG_LB = 2.20462;

function mapMfpRows(kind, parsed, opts) {
  const o = opts || {};
  const today = o.today;
  const windowDays = Number(o.windowDays) || 180;
  const { map, missing } = resolveColumns(kind, parsed.headers);
  const out = { kind, items: [], skipped: 0, tooOld: 0 };
  if (missing.length) return out;

  // Inline rather than calling addDaysISO(): this half stays pure and free of
  // app.js helpers so the test copy needs nothing around it.
  const cutoff = new Date(Date.parse(today + "T00:00:00Z") - windowDays * 86400000)
    .toISOString().slice(0, 10);

  for (const row of parsed.rows) {
    const get = (field) => (map[field] ? row[map[field]] : "");

    if (kind === "weight") {
      const date = String(get("date") || "").slice(0, 10);
      const w = mfpNum(get("weight"));
      if (!date || w === null) { out.skipped++; continue; }
      out.items.push({
        date,
        weightLb: Math.round((o.kgToLb ? w * KG_LB : w) * 10) / 10,
      });
      continue;
    }

    const kcal = mfpNum(get("kcal"));
    const name = String(get("food") || "").trim();
    if (!name || kcal === null) { out.skipped++; continue; }

    const macros = {
      kcal,
      p: mfpNum(get("p")) ?? 0,
      c: mfpNum(get("c")) ?? 0,
      f: mfpNum(get("f")) ?? 0,
      fib: mfpNum(get("fib")) ?? 0,
    };

    if (kind === "foods") {
      out.items.push({
        name,
        brand: String(get("brand") || "").trim(),
        unit: String(get("unit") || "serving").trim() || "serving",
        ...macros,
      });
      continue;
    }

    // diary
    const date = String(get("date") || "").slice(0, 10);
    if (!date) { out.skipped++; continue; }
    // Dropped here rather than written and pruned later, so the preview can
    // tell the athlete the truth about what is arriving.
    if (date < cutoff) { out.tooOld++; continue; }
    out.items.push({
      date,
      entry: {
        name,
        meal: mfpMealKey(get("meal")),
        qty: mfpNum(get("qty")) ?? 1,
        // Verbatim as MFP recorded it. Re-deriving grams from "1 cup" would be
        // guesswork on top of guesswork.
        unit: String(get("unit") || "serving").trim() || "serving",
        grams: null,
        ...macros,
        src: "mfp",
        ref: null,
      },
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/mfp-import.test.js`
Expected: `65 passed, 0 failed`, exit code 0.

- [ ] **Step 5: Copy into `app.js`**

Paste `MFP_MEALS`, `mfpMealKey`, `mfpNum`, `KG_LB`, `mapMfpRows` byte-identically after `sniffMfpFile`.

- [ ] **Step 6: Commit**

```bash
git add tests/mfp-import.test.js app.js
git commit -m "Map MFP rows to Stone Dragon shapes

Blank macro cells resolve to null, never 0 -- a missing protein value is
unknown, not zero grams, and zeroing it would libel the day in every
rollup. Diary rows past the 180-day window are dropped at map time so the
preview can report them, rather than written and silently pruned later.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Apply the import and fence off XP

**Files:**
- Modify: `app.js` (MFP import section — new `applyMfpImport`)
- Modify: `app.js:28683` `streakDay()`
- Modify: `app.js:28854` `syncNutritionGame()`

**Interfaces:**
- Consumes: `mapMfpRows` (Task 3), plus existing `ensureFoodLog`, `pruneFoodLog`, `saveClient`, `uid`, `todayISO`
- Produces: `applyMfpImport(mapped) -> { days, entries, foods, weighIns, replaced }` where `mapped` is an array of `mapMfpRows` results

This task has no unit test — it writes to live app state and is covered by the manual verification below plus the existing test suite staying green. The pure logic it depends on is already pinned by Tasks 1-3.

- [ ] **Step 1: Add the XP guard to `streakDay()`**

At `app.js:28683`, immediately after the function opens:

```js
  function streakDay(progress, basePlan, dateKey) {
    // Imported history never holds a streak. An import covers months at a
    // stroke, and a streak that was bought rather than earned devalues the
    // ladder for everyone who earned theirs.
    const through = progress?.nutritionGame?.importedThrough;
    if (through && dateKey <= through) return false;
```

- [ ] **Step 2: Add the XP guard to `syncNutritionGame()`**

At `app.js:28854`, change the date filter:

```js
    const imported = g.importedThrough || "";
    const dates = [...new Set([
      ...Object.keys(progress.foodLog || {}),
      ...Object.keys(g.awarded),
    ])].filter((d) => d >= cutoff && d <= today && !(imported && d <= imported)).sort();
```

- [ ] **Step 3: Write `applyMfpImport`**

Add to the MFP import section in `app.js`:

```js
  // The only impure step. Everything above produced plain data; this is where
  // it lands. Re-running must be safe, so every prior mfp entry in the covered
  // range goes first -- an athlete who imports twice gets one copy, not two.
  function applyMfpImport(mapped) {
    const progress = state.clientData.progress;
    ensureFoodLog(progress);
    ensureNutritionGame(progress);

    const diary = mapped.filter((m) => m.kind === "diary").flatMap((m) => m.items);
    const foods = mapped.filter((m) => m.kind === "foods").flatMap((m) => m.items);
    const weights = mapped.filter((m) => m.kind === "weight").flatMap((m) => m.items);

    let replaced = 0;
    const dates = [...new Set(diary.map((d) => d.date))];
    for (const date of dates) {
      const list = progress.foodLog[date];
      if (!list) continue;
      const kept = list.filter((e) => e.src !== "mfp");
      replaced += list.length - kept.length;
      if (kept.length) progress.foodLog[date] = kept; else delete progress.foodLog[date];
    }

    let entries = 0;
    for (const d of diary) {
      if (!progress.foodLog[d.date]) progress.foodLog[d.date] = [];
      progress.foodLog[d.date].push({ ...d.entry, id: uid(), at: Date.now() });
      entries++;
    }

    // Dedupe on name+brand so a second import does not create 87 copies.
    const seen = new Set((progress.customFoods || [])
      .map((f) => `${String(f.name).toLowerCase()}|${String(f.brand || "").toLowerCase()}`));
    let added = 0;
    for (const f of foods) {
      const key = `${f.name.toLowerCase()}|${(f.brand || "").toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      progress.customFoods.push({
        id: uid(), name: f.name, brand: f.brand, unit: f.unit, unitGrams: null,
        kcal: f.kcal, p: f.p, c: f.c, f: f.f, uses: 0, createdAt: todayISO(),
      });
      added++;
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
      // Days behind the fence keep no XP receipt.
      for (const k of Object.keys(g.awarded || {})) {
        if (k <= g.importedThrough) {
          g.xp = Math.max(0, g.xp - (Number(g.awarded[k]) || 0));
          delete g.awarded[k];
        }
      }
    }

    pruneFoodLog(progress);
    saveClient();
    return { days: dates.length, entries, foods: added, weighIns, replaced };
  }
```

- [ ] **Step 4: Verify the existing suite still passes**

Run: `for f in tests/*.test.js; do node "$f" || echo "FAILED: $f"; done`
Expected: every file reports `0 failed`. The `streakDay`/`syncNutritionGame` edits must not disturb them.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Apply MFP import and fence imported days out of XP

Imported days feed trends and the coach adherence view but award no XP
and cannot hold a streak -- an import covers months at a stroke, and a
ladder that can be bought devalues every athlete who climbed it.

Re-import is idempotent: prior mfp entries in the covered range are
cleared first, custom foods dedupe on name+brand, weigh-ins on date.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Recipe import

**Files:**
- Modify: `tests/mfp-import.test.js`
- Modify: `app.js` — `MFP_COLUMNS`, `MFP_KINDS`, `mapMfpRows`, `applyMfpImport`

**Interfaces:**
- Consumes: everything from Tasks 1-4
- Produces: `MFP_COLUMNS.recipes`, a `"recipes"` branch in `mapMfpRows` producing `{ name, servings, items: [entry] }`, and a `savedMeals` writer inside `applyMfpImport`

**Why this is separate from custom foods:** `savedMeals` holds two different
things, told apart by `kind: "recipe"` (`app.js:30942`). A plain saved meal is a
bundle logged as several lines; a recipe carries `servings` plus an `items[]`
ingredient list and logs as **one** line scaled by servings eaten, through
`recipePerServing()` (`app.js:30838`) and `openRecipePortionStep()`
(`app.js:30958`). Importing a recipe as a plain saved meal would silently drop
the per-serving scaling, which is most of what makes a recipe worth having.

`recipePerServing()` computes `foodDayTotals(items) / servings`, so a recipe
whose `items[]` is a single entry carrying the whole recipe's totals scales
correctly. That is the fallback when MFP gives us no usable ingredient
breakdown — a recipe that logs correctly but cannot be edited ingredient-by-
ingredient beats one that never arrives.

- [ ] **Step 1: Write the failing test**

Add to the copy block in `tests/mfp-import.test.js`, inside `MFP_COLUMNS`, a
`recipes` key (stub it as `{ required: {}, optional: {} }` for now), and append:

```js
console.log("\nmapMfpRows recipes");
const rc = parseCsv([
  "Recipe Name,Servings,Calories,Protein (g),Carbohydrates (g),Fat (g)",
  "Chili,6,2400,180,150,90",
  "Nameless,4,,,,",
].join("\n"));
const rm = mapMfpRows("recipes", rc, OPTS);
eq("one usable recipe", rm.items.length, 1);
eq("skips the row with no calories", rm.skipped, 1);
eq("name", rm.items[0].name, "Chili");
eq("servings", rm.items[0].servings, 6);
// One item carrying the whole recipe's totals: recipePerServing divides by
// servings, so this scales correctly without an ingredient breakdown.
eq("single fallback item", rm.items[0].items.length, 1);
eq("item carries whole-recipe totals", rm.items[0].items[0].kcal, 2400);
eq("item is tagged mfp", rm.items[0].items[0].src, "mfp");
// Guards the divide in recipePerServing: 0 or absent servings must become 1.
eq("zero servings clamps to 1",
   mapMfpRows("recipes", parseCsv("Recipe Name,Servings,Calories\nX,0,100"), OPTS).items[0].servings, 1);
eq("missing servings column defaults to 1",
   mapMfpRows("recipes", parseCsv("Recipe Name,Calories\nX,100"), OPTS).items[0].servings, 1);

console.log("\nsniffMfpFile recipes");
eq("recipes by its columns", sniffMfpFile(["Recipe Name", "Servings", "Calories"]), "recipes");
// Recipes and custom foods both carry Calories; the tie must not go to foods.
eq("recipes wins over foods", sniffMfpFile(["Recipe Name", "Servings", "Calories", "Brand"]), "recipes");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mfp-import.test.js`
Expected: the new assertions FAIL, exit code 1.

- [ ] **Step 3: Add the recipes column spec and sniff order**

In the test file's copy block, replace the `recipes` stub:

```js
  recipes: {
    required: {
      food: ["recipe name", "recipe", "name"],
      kcal: ["calories", "energy (kcal)", "kcal"],
    },
    optional: {
      servings: ["servings", "number of servings", "yield", "serves"],
      p: ["protein (g)", "protein"],
      c: ["carbohydrates (g)", "carbs (g)", "carbohydrates", "carbs"],
      f: ["fat (g)", "fat"],
      fib: ["fiber (g)", "fibre (g)", "fiber", "fibre"],
    },
  },
```

And put `recipes` ahead of `foods` in the sniff order — a recipe export also
carries a Calories column, so `foods` would otherwise claim it:

```js
const MFP_KINDS = ["diary", "recipes", "foods", "weight"];
```

- [ ] **Step 4: Add the recipes branch to `mapMfpRows`**

Insert immediately before the `if (kind === "foods")` block, so it shares the
`name`/`kcal`/`macros` work already done above it:

```js
    if (kind === "recipes") {
      // Clamped to at least 1: recipePerServing() divides by this, and a 0
      // from a malformed export would produce Infinity calories per serving.
      const servings = Math.max(Math.round(mfpNum(get("servings")) ?? 1), 1);
      out.items.push({
        name,
        servings,
        // One item holding the recipe's whole totals. MFP's export does not
        // reliably carry an ingredient breakdown, and foodDayTotals() over a
        // single entry divided by servings gives the right per-serving number.
        items: [{
          name, meal: "dinner", qty: 1, unit: "recipe", grams: null,
          ...macros, src: "mfp", ref: null,
        }],
      });
      continue;
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/mfp-import.test.js`
Expected: `77 passed, 0 failed`, exit code 0.

- [ ] **Step 6: Copy the changes into `app.js`**

Mirror all three edits — the `recipes` entry in `MFP_COLUMNS`, the reordered
`MFP_KINDS`, and the `recipes` branch in `mapMfpRows` — byte-identically.

- [ ] **Step 7: Write recipes in `applyMfpImport`**

Add to `applyMfpImport` in `app.js`, after the custom-foods block and before the
weigh-ins block:

```js
    const recipes = mapped.filter((m) => m.kind === "recipes").flatMap((m) => m.items);
    // Dedupe on name alone: savedMeals carries no brand.
    const haveMeals = new Set((progress.savedMeals || []).map((m) => String(m.name).toLowerCase()));
    let addedRecipes = 0;
    for (const r of recipes) {
      const key = r.name.toLowerCase();
      if (haveMeals.has(key)) continue;
      haveMeals.add(key);
      progress.savedMeals.push({
        id: uid(), name: r.name, kind: "recipe", servings: r.servings,
        items: r.items.map((i) => ({ ...i, id: uid() })),
        uses: 0, createdAt: todayISO(),
      });
      addedRecipes++;
    }
```

Then extend the return value:

```js
    return { days: dates.length, entries, foods: added, recipes: addedRecipes, weighIns, replaced };
```

- [ ] **Step 8: Verify the whole suite**

Run: `for f in tests/*.test.js; do node "$f" || echo "FAILED: $f"; done`
Expected: every file reports `0 failed`.

- [ ] **Step 9: Commit**

```bash
git add tests/mfp-import.test.js app.js
git commit -m "Import MyFitnessPal recipes as recipes, not saved meals

savedMeals holds two shapes told apart by kind: 'recipe'. A recipe carries
servings and logs as one scaled line; a saved meal logs as several. Mapping
recipes to plain saved meals would drop the per-serving scaling that makes
a recipe worth having.

Where MFP gives no usable ingredient breakdown, the recipe is imported as a
single item carrying its whole totals -- recipePerServing() divides by
servings, so it still logs correctly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Import UI

**Files:**
- Modify: `app.js` (MFP import section — `openMfpImportSheet`, `readMfpFiles`)
- Modify: `app.js:31009` `openMyFoodsSheet()` — add the entry button
- Modify: `app.js:31026` `renderMyFoods()` empty state — add the entry there too

**Interfaces:**
- Consumes: `parseCsv`, `sniffMfpFile`, `normHeader`, `mapMfpRows`, `applyMfpImport` (Tasks 1-5), existing `openModal`, `closeModal`, `toast`, `escapeHtml`, `renderClientDiet`
- Produces: `openMfpImportSheet()` — no return value

- [ ] **Step 1: Write the file reader and preview**

```js
  // "PK" is the zip magic number, which is what an .xlsx actually is. We do not
  // ship a decryptor or an xlsx parser for a one-time migration -- we tell the
  // athlete how to hand us something we can read.
  function looksLikeZip(text) { return text.slice(0, 2) === "PK"; }

  function readMfpFiles(files) {
    return Promise.all([...files].map((file) => new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve({ name: file.name, text: String(r.result || "") });
      r.onerror = () => resolve({ name: file.name, text: "", error: "unreadable" });
      r.readAsText(file);
    })));
  }

  function openMfpImportSheet() {
    openModal({
      title: "Import from MyFitnessPal",
      body: `
        <p class="muted" style="margin-top:0">
          In MyFitnessPal, request your data export, then pick the CSV files here.
          Your foods, recipes, recent diary and weight history come across.
        </p>
        <label>Export files
          <input type="file" id="mfp-files" multiple accept=".csv,text/csv" />
        </label>
        <div id="mfp-result"></div>`,
      actions: [
        { label: "Close", className: "btn btn-ghost", onClick: () => { closeModal(); renderFoodDay(); } },
      ],
    });
    $("#mfp-files").addEventListener("change", async (ev) => {
      const out = $("#mfp-result");
      out.innerHTML = `<p class="muted">Reading…</p>`;
      const files = await readMfpFiles(ev.target.files);
      renderMfpPreview(files, out);
    });
  }
```

- [ ] **Step 2: Write the preview, including the header-reporting failure path**

```js
  function renderMfpPreview(files, out) {
    const opts = { today: todayISO(), windowDays: FOOD_LOG_DAYS, kgToLb: false };
    const mapped = [], unknown = [];

    for (const f of files) {
      if (looksLikeZip(f.text)) {
        out.innerHTML = `<p class="mfp-warn">${escapeHtml(f.name)} is a zip or spreadsheet, not a CSV.
          Open it, then use <b>File &rsaquo; Save As</b> and choose CSV. Then pick the CSV here.</p>`;
        return;
      }
      const parsed = parseCsv(f.text);
      const kind = sniffMfpFile(parsed.headers);
      if (!kind) { unknown.push({ name: f.name, headers: parsed.headers }); continue; }
      // Weight in kg is detectable only from the column name.
      const kg = parsed.headers.some((h) => normHeader(h).includes("(kg)"));
      mapped.push(mapMfpRows(kind, parsed, { ...opts, kgToLb: kg }));
    }

    // The instrument. With no real export to design against, the first athlete
    // to hit this is how we learn MFP's actual column names -- so the error
    // must hand those names back, not just say "unrecognised".
    if (unknown.length) {
      out.innerHTML = unknown.map((u) => `
        <p class="mfp-warn">Couldn't tell what <b>${escapeHtml(u.name)}</b> holds.</p>
        <p class="muted">Send your coach this line and it can be added:</p>
        <textarea readonly rows="3" class="mfp-headers"
          onclick="this.select()">${escapeHtml(u.headers.join(", "))}</textarea>`).join("");
      if (!mapped.length) return;
    }

    const sum = (kind, key) => mapped.filter((m) => m.kind === kind)
      .reduce((n, m) => n + (key === "items" ? m.items.length : m[key]), 0);
    const days = new Set(mapped.filter((m) => m.kind === "diary")
      .flatMap((m) => m.items.map((i) => i.date))).size;
    const tooOld = sum("diary", "tooOld");
    const skipped = mapped.reduce((n, m) => n + m.skipped, 0);

    out.innerHTML += `
      <ul class="mfp-summary">
        <li><b>${days}</b> diary days (${sum("diary", "items")} entries)</li>
        <li><b>${sum("foods", "items")}</b> custom foods</li>
        <li><b>${sum("recipes", "items")}</b> recipes</li>
        <li><b>${sum("weight", "items")}</b> weigh-ins</li>
      </ul>
      ${tooOld ? `<p class="muted">${tooOld} diary entries are older than ${FOOD_LOG_DAYS} days and won't be imported — the log keeps a rolling window.</p>` : ""}
      ${skipped ? `<p class="muted">${skipped} rows skipped: no calorie value.</p>` : ""}
      <button class="btn btn-primary" id="mfp-go">Import</button>`;

    $("#mfp-go")?.addEventListener("click", () => {
      const r = applyMfpImport(mapped);
      closeModal();
      renderClientDiet();
      toast(`Imported ${r.entries} entries, ${r.foods} foods, ${r.recipes} recipes ✓`);
    });
  }
```

- [ ] **Step 3: Add the entry point**

In `openMyFoodsSheet()` (`app.js:31009`), add a second action before Close:

```js
      actions: [
        { label: "Import from MFP", className: "btn btn-ghost", onClick: () => openMfpImportSheet() },
        { label: "Close", className: "btn btn-ghost", onClick: () => { closeModal(); renderFoodDay(); } },
      ],
```

And in `renderMyFoods()`'s empty state (`app.js:31027`) — the moment an athlete most needs it:

```js
      el.innerHTML = `<p class="muted">Nothing saved yet. Foods you create and recipes you build land here.</p>
        <p class="muted">Coming from MyFitnessPal? <a href="#" id="myfoods-import">Import your foods and history.</a></p>`;
      $("#myfoods-import")?.addEventListener("click", (e) => { e.preventDefault(); openMfpImportSheet(); });
      return;
```

- [ ] **Step 4: Add styles**

In `styles.css`, near the other food-logger rules:

```css
.mfp-summary { margin: 12px 0; padding-left: 20px; }
.mfp-summary li { margin: 4px 0; }
.mfp-warn { color: var(--warn); }
.mfp-headers { width: 100%; font-family: monospace; font-size: 12px;
  background: rgba(var(--primary-rgb), 0.06); border: 1px solid rgba(var(--primary-rgb), 0.25);
  border-radius: 8px; padding: 8px; color: var(--text); }
```

`.mfp-warn` is needed because `.warn` exists only as a modifier in this codebase
(`.exn-chip.warn`, `styles.css:6287`) and does nothing on its own. Colours come
from `--primary-rgb` and `--warn` rather than hardcoded hex, so this survives all
ten themes including the light one.

- [ ] **Step 5: Bump the cache bust**

In `index.html`, bump `?v=` on the `app.js` and `styles.css` tags. Without this, installed PWAs keep serving the old build.

- [ ] **Step 6: Verify in the browser**

```bash
python3 -m http.server 5190 --directory .
```

Then, with the offline stub setup from `__preview-setup.html`:
1. Open the athlete food screen → My foods and recipes → **Import from MFP**.
2. Upload a CSV built from the Task 3 fixtures. Confirm the preview counts match.
3. Upload a file with junk headers. **Confirm the actual header line is displayed and selectable** — this is the requirement the whole build-before-the-file strategy rests on.
4. Rename a `.zip` to `.csv` and upload. Confirm the "Save As CSV" message appears and nothing is written.
5. Import, then import the same file again. Confirm entry counts are identical, not doubled.
6. Open an imported recipe and log it through the portion step. Confirm the
   per-serving macros are the recipe's totals divided by its servings — this is
   the check that proves a recipe imported *usefully* rather than merely arriving.
7. Confirm the nutrition rank/XP badge did not move, and the streak flame did not light.
8. Repeat on a second athlete — module-level caches in `app.js` survive athlete switches.
9. Check the modal at 390px width.

- [ ] **Step 7: Commit**

```bash
git add app.js styles.css index.html
git commit -m "Add MyFitnessPal import UI

The unrecognised-file path reports the actual header row back as
selectable text. Built without a real MFP export to test against, that
error is the instrument: the first athlete to hit it tells us the real
column names instead of dead-ending.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Documentation

**Files:**
- Modify: `tests/README.md`
- Modify: `STSD/CLAUDE.md`

- [ ] **Step 1: Add the test to the README table**

Append a row to the table in `tests/README.md`:

```markdown
| `mfp-import.test.js` | the MyFitnessPal importer's pure half — CSV parse, file sniffing, column resolution, row mapping | It eats a file we have never seen. The column names in `MFP_COLUMNS` were written without a real export and will need one correction pass; everything around them — quoting, blank rows, the 180-day cutoff, kg→lb, dedupe keys, and blank macros resolving to null rather than 0 — is format-independent and pinned here so that pass cannot quietly break it. |
```

- [ ] **Step 2: Note the importer in CLAUDE.md**

Under **Key UI flows**, add:

```markdown
- **MFP import** → athlete uploads CSVs → `parseCsv` → `sniffMfpFile` → `mapMfpRows` → preview → `applyMfpImport()` writes `foodLog`/`customFoods`/`savedMeals`/`bodyweightLog` via `saveClient()`. All MFP-format knowledge lives in `MFP_COLUMNS`; imported days are fenced out of XP by `nutritionGame.importedThrough`.
```

- [ ] **Step 3: Commit**

```bash
git add tests/README.md CLAUDE.md
git commit -m "Document the MyFitnessPal importer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After the real export arrives

The one correction pass this plan is built around:

1. Run the export through the importer. If a file is unrecognised, the error hands back its header row.
2. Add those names to the matching `MFP_COLUMNS` entry.
3. Add a fixture row to `tests/mfp-import.test.js` using the real headers.
4. Re-run `node tests/mfp-import.test.js`.

No logic changes. If the correction needs more than new strings in `MFP_COLUMNS`, that is a signal the abstraction was wrong — say so rather than working around it.
