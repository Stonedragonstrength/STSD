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
