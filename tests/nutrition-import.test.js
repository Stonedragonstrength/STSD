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

// Grid -> objects keyed by header. Short rows fill with "" rather than undefined
// so every consumer can treat a missing cell as an empty string.
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
// `cron` was read from a real export, verified 2026-08-07. There is deliberately
// no `mfp` entry: no MyFitnessPal export has ever been seen, and a stub of
// invented column names would sit beside verified facts looking equally
// trustworthy. Add one from a real file, never from memory.
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
  const spec = IMPORT_SOURCES[source] && IMPORT_SOURCES[source].kinds[kind];
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
const FL_OZ_ML = 29.5735;
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
      // Biometrics is key-value: weight, body fat and blood pressure all share
      // the file. Anything that is not weight is a different metric, not lost
      // data, so it is passed over without counting as a skip.
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

    // Water is a food row in Cronometer and a separate log here.
    if (WATER_NAME.test(name)) {
      if (date < cutoff) { out.tooOld++; continue; }
      out.water.push({ date, oz: /oz/i.test(unit) ? qty : qty / FL_OZ_ML });
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
// Cronometer never exports a food definition -- only servings actually logged.
// So the library is reconstructed from the diary. That is not a workaround: it
// yields the foods the athlete really ate, ranked by how often, instead of every
// abandoned entry they created once and forgot. Its one real limit is that a
// food created but never eaten does not come across, which is the right trade.
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
    // person actually eats the thing now. Keeping an older portion would look
    // plausible and be wrong for every future log.
    if (!prev || d.date >= prev.date) byName.set(key, { ...d, uses: (prev ? prev.uses : 0) + 1 });
    else byName.set(key, { ...prev, uses: prev.uses + 1 });
  }

  const foods = [], recipes = [];
  for (const { entry, uses } of byName.values()) {
    if (RECIPE_UNIT.test(entry.unit)) {
      recipes.push({
        name: entry.name,
        kind: "recipe",
        // The export gives no servings count -- the athlete logged one whole
        // recipe -- so 1 reproduces exactly what they logged, and never divides
        // by zero in recipePerServing().
        servings: 1,
        items: [{ ...entry, meal: "dinner", qty: 1, unit: "recipe", grams: null }],
        uses,
      });
      continue;
    }
    const grams = entry.unit === "g" && entry.qty > 0;
    // Scale to whichever form the food logger stores: per 100 g when the weight
    // is known, per one unit otherwise. Getting this backwards silently doubles
    // or halves every future portion of the food.
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
// ---- end copy ----

let pass = 0, fail = 0;
// Reaching into a result that may be empty. Without this a red-stage stub
// throws on the first deref and aborts the run, hiding every assertion below.
function at(arr, i) { return (arr && arr[i]) || {}; }
function entryAt(arr, i) { return at(arr, i).entry || {}; }
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
// Detection is by content, not filename -- the vendor names these files.
eq("column order is irrelevant",
   sniffImportFile(["Energy (kcal)", "Food Name", "Day", "Amount"]), { source: "cron", kind: "diary" });
// servings and biometrics share Day/Time/Group/Amount. Diary must win.
// Null-guarded on purpose: a bare .kind would throw and abort the whole run,
// hiding every assertion below it.
eq("diary is not mistaken for weight", (sniffImportFile(CRON_SERVINGS) || {}).kind, "diary");
// exercises.csv also carries Day/Time/Group -- it must match nothing.
eq("exercises file is ignored",
   sniffImportFile(["Day", "Time", "Group", "Exercise", "Minutes", "Calories Burned"]), null);

// The strongest assertion here: not a hand-typed header list, but the real
// export as it came off Cronometer. If they rename a column, this is what fails.
console.log("\nsniffImportFile against the vendored real export");
const FIXTURE = require("path").join(__dirname,
  "..", "docs", "superpowers", "specs", "fixtures-cronometer-servings.csv");
const realCsv = parseCsv(require("fs").readFileSync(FIXTURE, "utf8"));
eq("the real file is recognised", sniffImportFile(realCsv.headers), { source: "cron", kind: "diary" });
eq("no required column is missing from it",
   resolveColumns("cron", "diary", realCsv.headers).missing, []);
eq("it still has its rows", realCsv.rows.length, 4);

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
// Multi-word units are real -- both of these are verbatim from the export.
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
eq("date carried", at(d.diary,0).date, "2026-08-06");
eq("meal mapped", entryAt(d.diary,0).meal, "breakfast");
eq("qty split from amount", entryAt(d.diary,0).qty, 100);
eq("unit split from amount", entryAt(d.diary,0).unit, "g");
eq("macros", [entryAt(d.diary,0).kcal, entryAt(d.diary,0).p, entryAt(d.diary,0).c, entryAt(d.diary,0).f],
   [57, 0.7, 14.57, 0.31]);
eq("tagged with its source", entryAt(d.diary,0).src, "cron");
eq("no ref into a database it did not come from", entryAt(d.diary,0).ref, null);
// A blank Time is normal -- the recipe row in the real export has none.
eq("blank Time is fine", entryAt(d.diary,1).name, "ZZTest Chili");
eq("multi-word unit survives", entryAt(d.diary,1).unit, "full recipe");
// Water is a food row in Cronometer but a separate log here.
eq("water routed out of the food log", at(d.water,0), { date: "2026-08-06", oz: 8 });

console.log("\nmapImportRows weight");
const w = mapImportRows("cron", "weight", parseCsv([
  "Day,Time,Group,Metric,Unit,Amount",
  "2026-08-06,7:00 AM,Uncategorized,Weight,lbs,181.4",
  "2026-08-05,7:00 AM,Uncategorized,Body Fat,%,18.2",
  "2026-08-04,7:00 AM,Uncategorized,Weight,kg,80",
  "2019-01-01,7:00 AM,Uncategorized,Weight,lbs,200",
].join("\n")), OPTS);
// Biometrics is key-value: every metric shares the file, so non-weight rows
// must be passed over rather than imported as bodyweight.
eq("only Weight rows", w.weights.length, 3);
eq("body fat is not a weigh-in", w.weights.map((x) => x.date).includes("2026-08-05"), false);
// Nor is it lost data -- it is another metric, so it must not inflate `skipped`.
eq("body fat is not counted as a skip", w.skipped, 0);
// Keyed by date, not position: the skipped body-fat row shifts every index, so
// positional assertions here silently test the wrong row.
const wOn = (d) => (w.weights.find((x) => x.date === d) || {}).weightLb;
eq("pounds kept", wOn("2026-08-06"), 181.4);
eq("kg converted", wOn("2026-08-04"), 176.4);
// Weight is never pruned -- only foodLog has a window.
eq("old weigh-ins kept", w.weights.some((x) => x.date === "2019-01-01"), true);

console.log("\nderiveLibrary");
const lib = deriveLibrary([
  { date: "2026-08-01", entry: { name: "Blueberries", qty: 100, unit: "g", kcal: 57, p: 0.7, c: 14.57, f: 0.31, fib: 2.4 } },
  { date: "2026-08-03", entry: { name: "Blueberries", qty: 50, unit: "g", kcal: 28, p: 0.35, c: 7.3, f: 0.16, fib: 1.2 } },
  { date: "2026-08-02", entry: { name: "Whey Shake", qty: 1, unit: "scoop", kcal: 120, p: 24, c: 3, f: 1.5, fib: 0 } },
  { date: "2026-08-07", entry: { name: "ZZTest Chili", qty: 1, unit: "full recipe", kcal: 291.49, p: 21.28, c: 38.04, f: 6.44, fib: 9.74 } },
]);
const food = (n) => lib.foods.find((f) => f.name === n) || {};
eq("one entry per unique food", lib.foods.length, 2);
eq("recipes split out of foods", lib.recipes.length, 1);
// Frequency is why deriving from the diary beats a library export: what someone
// ate twice outranks what they tried once.
eq("uses counts how often it was logged", food("Blueberries").uses, 2);
eq("single log counts once", food("Whey Shake").uses, 1);
// Gram portions normalise to per-100g so any future portion scales correctly.
eq("gram foods are per100", food("Blueberries").per100, true);
// The 2026-08-03 row is the most recent: 50 g at 28 kcal doubles to 56 per 100 g.
// Taking the older 100 g row instead would give 57 -- close enough to look right
// and wrong for every portion the athlete logs afterwards.
eq("per100 normalised from the MOST RECENT row", food("Blueberries").kcal, 56);
eq("per100 macros scale together", food("Blueberries").p, 0.7);
eq("servingG set for gram foods", food("Blueberries").servingG, 100);
eq("serving label for gram foods", food("Blueberries").servingLabel, "100 g");
// A non-gram unit cannot be normalised by weight, so macros are per one unit.
eq("non-gram foods are per-unit", food("Whey Shake").per100, false);
eq("per-unit macros are for one unit", [food("Whey Shake").kcal, food("Whey Shake").p], [120, 24]);
eq("serving label kept verbatim", food("Whey Shake").servingLabel, "scoop");
// A recipe logged as one row maps straight onto the recipe shape.
const rc = lib.recipes[0] || {};
eq("recipe name", rc.name, "ZZTest Chili");
eq("recipe kind", rc.kind, "recipe");
// The export carries no servings count, so 1 reproduces what was logged.
eq("servings defaults to 1", rc.servings, 1);
eq("single item carrying whole-recipe totals", (rc.items || []).length, 1);
eq("item macros are the recipe totals", at(rc.items, 0).kcal, 291.49);
// Guards the divide in recipePerServing(): 0 servings would be Infinity kcal.
eq("servings is never zero", rc.servings > 0, true);

// End-to-end on the real export: parse -> sniff -> map -> derive, with no
// hand-written input anywhere. Everything above tests a stage in isolation; this
// is the only assertion that the stages actually fit together on a real file.
console.log("\nfull pipeline over the vendored real export");
const realHit = sniffImportFile(realCsv.headers);
const realMapped = mapImportRows(realHit.source, realHit.kind, realCsv,
  { today: "2026-08-07", windowDays: 180 });
const realLib = deriveLibrary(realMapped.diary);
// 4 rows: Water x2, Blueberries, ZZTest Chili.
eq("two food entries", realMapped.diary.length, 2);
eq("both water rows routed to the water log", realMapped.water.length, 2);
eq("nothing skipped", realMapped.skipped, 0);
eq("nothing out of window", realMapped.tooOld, 0);
eq("one real food in the library", realLib.foods.length, 1);
eq("the food is the blueberries", at(realLib.foods, 0).name, "Blueberries, Fresh");
// The whole reason Task 4 exists: the recipe was logged, so it comes across even
// though Cronometer never exported its definition.
eq("one recipe", realLib.recipes.length, 1);
eq("the recipe is the chili", at(realLib.recipes, 0).name, "ZZTest Chili");
eq("recipe carries its real totals", at(at(realLib.recipes, 0).items, 0).kcal, 291.49);
// The custom food ZZTest Protein Powder exists in the account but was never
// logged, and is correctly absent -- this is the fact the design rests on.
eq("an unlogged custom food is simply not there",
   realLib.foods.some((f) => /protein powder/i.test(f.name)), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
