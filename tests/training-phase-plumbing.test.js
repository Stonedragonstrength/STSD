// trainingPhase has to reach the same four places trainingLevel does, and
// misses the same way: silently. The coach's coverage map filters by burn level
// while the athlete's counts every set, and neither screen says they disagree.
//
//   1. makeClient()            — new athletes carry the field
//   2. athleteToRow()          — it reaches Supabase
//   3. rowToAthlete()          — it comes back
//   4. buildProgramFromAthlete() — it reaches the ATHLETE'S DEVICE
//
// (4) is the one that bites: it is a hand-picked allowlist of fields, not a
// spread, so a new field is simply absent unless someone remembers.
//
// Deliberately NOT in updateAthleteProfileFields(): that is the athlete's
// self-edit path, and the phase is the coach's programming decision. Training
// age is a fact about the athlete and is settable on both sides; which block
// they are in is not.
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

check("makeClient seeds trainingPhase", () => {
  const body = fnBody(appSrc, "function makeClient(");
  assert.ok(/trainingPhase\s*:/.test(body), "makeClient must seed trainingPhase");
});

check("buildProgramFromAthlete carries trainingPhase to the athlete's device", () => {
  const body = fnBody(appSrc, "function buildProgramFromAthlete(");
  assert.ok(/trainingPhase\s*:/.test(body),
    "buildProgramFromAthlete is an allowlist — without this line the athlete's map " +
    "counts every set while the coach's filters by burn level");
});

check("athleteToRow writes training_phase", () => {
  const body = fnBody(cloudSrc, "function athleteToRow(");
  assert.ok(/training_phase\s*:/.test(body), "athleteToRow must write training_phase");
});

check("rowToAthlete reads training_phase back", () => {
  const body = fnBody(cloudSrc, "function rowToAthlete(");
  assert.ok(/trainingPhase\s*:\s*r\.training_phase/.test(body),
    "rowToAthlete must map training_phase back to trainingPhase");
});

check("the migration exists and constrains the values", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20260813120000_training_phase.sql"), "utf8");
  assert.ok(/add column if not exists training_phase/.test(sql), "adds the column");
  assert.ok(/fatloss/.test(sql) && /maintenance/.test(sql), "checks the two allowed values");
  assert.ok(/is null or/.test(sql),
    "must stay nullable — athleteToRow coerces empty strings to null, so a " +
    "not-null column rejects an unphased athlete on the first write");
});

check("the ids in the migration match the ids in the phase table", () => {
  // A check constraint that disagrees with TRAINING_PHASES rejects the write
  // with a 400 that never reaches the coach's screen: the pill flips, the
  // debounce fires, the row never changes.
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20260813120000_training_phase.sql"), "utf8");
  const ids = [...appSrc.matchAll(/\{\s*id:\s*"(fatloss|maintenance)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 2, "TRAINING_PHASES should declare both phases");
  ids.forEach((id) => assert.ok(sql.includes(`'${id}'`), `migration is missing '${id}'`));
});

console.log(`\ntraining-phase-plumbing: ${n} checks passed.`);
