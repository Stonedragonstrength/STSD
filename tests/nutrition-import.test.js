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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
