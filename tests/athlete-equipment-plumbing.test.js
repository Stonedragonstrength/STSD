// equipment has to reach the same four places trainingLevel and trainingPhase
// do, and misses the same way: silently. See training-phase-plumbing.test.js
// for the full reasoning.
//
//   1. makeClient()            — new athletes carry the field
//   2. athleteToRow()          — it reaches Supabase
//   3. rowToAthlete()          — it comes back
//   4. buildProgramFromAthlete() — it reaches the ATHLETE'S DEVICE
//
// (4) is the one that bites: a hand-picked allowlist, not a spread.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const cloudSrc = fs.readFileSync(path.join(ROOT, "cloud.js"), "utf8");
// buildProgramFromAthlete moved to src/sync/program.js (Phase 1 extraction).
const programSrc = fs.readFileSync(path.join(ROOT, "src", "sync", "program.js"), "utf8");

function fnBody(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error(`not found: ${decl}`);
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (!depth) return src.slice(open, i + 1); }
  }
  throw new Error(`unbalanced: ${decl}`);
}

let n = 0;
const check = (label, fn) => { fn(); n++; console.log("  ok  " + label); };

check("makeClient seeds equipment", () => {
  assert.ok(/equipment\s*:/.test(fnBody(appSrc, "function makeClient(")),
    "makeClient must seed equipment");
});

check("buildProgramFromAthlete carries equipment to the athlete's device", () => {
  assert.ok(/equipment\s*:/.test(fnBody(programSrc, "function buildProgramFromAthlete(")),
    "an allowlist — without this line the athlete's device has no gear list");
});

check("athleteToRow writes equipment", () => {
  assert.ok(/equipment\s*:/.test(fnBody(cloudSrc, "function athleteToRow(")),
    "athleteToRow must write equipment");
});

check("rowToAthlete reads equipment back", () => {
  assert.ok(/equipment\s*:\s*r\.equipment/.test(fnBody(cloudSrc, "function rowToAthlete(")),
    "rowToAthlete must map equipment back");
});

check("the migration exists and stays nullable", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20260814090000_athlete_equipment.sql"), "utf8");
  assert.ok(/add column if not exists equipment/.test(sql), "adds the column");
  assert.ok(/jsonb/.test(sql), "stored as jsonb, like the other list columns");
  assert.ok(!/not null/i.test(sql),
    "must stay nullable — NULL is the storage form of 'everything available'");
});

check("an empty list is written rather than null", () => {
  // athleteToRow coerces most optional fields to null with `|| null`. Equipment
  // must NOT: an empty array and null mean the same thing to the reader, and
  // sending [] keeps the column's type stable from the very first write.
  const body = fnBody(cloudSrc, "function athleteToRow(");
  assert.ok(/equipment\s*:\s*c\.equipment\s*\|\|\s*\[\]/.test(body),
    "athleteToRow should send [] rather than null for equipment");
});

console.log(`\nathlete-equipment-plumbing: ${n} checks passed.`);
