// trainingLevel has to reach four places, and missing any one fails silently:
// the coach's coverage map reads correctly while the athlete's quietly uses
// default bands, with nothing on either screen indicating they disagree.
//
//   1. makeClient()            — new athletes carry the field
//   2. athleteToRow()          — it reaches Supabase
//   3. rowToAthlete()          — it comes back
//   4. buildProgramFromAthlete() — it reaches the ATHLETE'S DEVICE
//
// (4) is the one that bites: it is a hand-picked allowlist of fields, not a
// spread, so a new field is simply absent unless someone remembers.
//
// This parses the sources rather than executing them because app.js is one IIFE
// with no exports and these are plumbing declarations, not behaviour.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const cloudSrc = fs.readFileSync(path.join(ROOT, "cloud.js"), "utf8");

// Grab a function's body by brace-matching from its declaration.
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

check("makeClient seeds trainingLevel", () => {
  const body = fnBody(appSrc, "function makeClient(");
  assert.ok(/trainingLevel\s*:/.test(body), "makeClient must seed trainingLevel");
});

check("buildProgramFromAthlete carries trainingLevel to the athlete's device", () => {
  const body = fnBody(appSrc, "function buildProgramFromAthlete(");
  assert.ok(/trainingLevel\s*:/.test(body),
    "buildProgramFromAthlete is an allowlist — without this line the athlete's map " +
    "silently uses default bands while the coach's is correct");
});

check("athleteToRow writes training_level", () => {
  const body = fnBody(cloudSrc, "function athleteToRow(");
  assert.ok(/training_level\s*:/.test(body), "athleteToRow must write training_level");
});

check("rowToAthlete reads training_level back", () => {
  const body = fnBody(cloudSrc, "function rowToAthlete(");
  assert.ok(/trainingLevel\s*:\s*r\.training_level/.test(body),
    "rowToAthlete must map training_level back to trainingLevel");
});

check("the migration exists and constrains the values", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20260810120000_training_level.sql"), "utf8");
  assert.ok(/add column if not exists training_level/.test(sql), "adds the column");
  assert.ok(/beginner/.test(sql) && /intermediate/.test(sql) && /advanced/.test(sql),
    "checks the three allowed values");
  assert.ok(/is null or/.test(sql),
    "must stay nullable — athleteToRow coerces empty strings to null, so a " +
    "not-null column rejects an unset athlete on the first write");
});

console.log(`\ntraining-level-plumbing: ${n} checks passed.`);
