// mergedRosterProgress — what the coach's roster knows about each athlete.
//
// The bug this pins: the athletes-table row never carries progress
// (rowToAthlete stamps importedProgress: null), and populateCoachFromCloud
// adopted those rows wholesale for every clean athlete. So each boot or
// 20-second resync WIPED every athlete's locally-held progress, and the
// roster fell back to "No sync" — no percentages, no avatars, no mood chips —
// until each athlete was opened one by one (the only per-athlete pull).
// On the phone, where every open is a fresh boot, the roster read "No sync"
// essentially always, with 22 athletes' progress sitting right there in the
// cloud.
//
// The fix: the coach load bulk-fetches every athlete's progress row (66 kB
// across 22 athletes, measured in production 2026-08-13), and this helper
// decides what each card keeps. Cloud row present → adopt it, but union
// exercise logs through mergeExerciseLogs so a pull can never erase local
// work, and never while an unconfirmed coach write owns the local copy
// (_coachProgressDirtyAt). Cloud row absent (offline, RLS hiccup) → KEEP the
// local copy — identity-return, so callers can tell "unchanged" — instead of
// wiping it.
//
// These run the REAL functions, extracted from app.js by brace-matching.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

function fnSrc(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error(`not found: ${decl}`);
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error(`unbalanced: ${decl}`);
}

// mergedRosterProgress leans on mergeExerciseLogs; load both real bodies.
const mergedRosterProgress = new Function(
  `${fnSrc(appSrc, "function mergeExerciseLogs(")};
   ${fnSrc(appSrc, "function mergedRosterProgress(")};
   return mergedRosterProgress;`
)();

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures++; console.log(`  FAIL ${label}\n       ${e.message}`); }
}

const entry = (id, m, tag) => ({ id, date: "2026-08-13", m, sets: [{ weight: tag, reps: 5 }] });

console.log("\nroster progress");

check("cloud row present: adopted, with completions visible and syncedAt stamped", () => {
  const cloud = { dayCompletions: { d1: ["2026-08-10"] }, exerciseLogs: {}, personalRecords: [] };
  const out = mergedRosterProgress(null, cloud, false);
  assert.deepStrictEqual(out.dayCompletions, { d1: ["2026-08-10"] });
  assert.ok(out.syncedAt > 0, "syncedAt stamped");
});

check("local-only exercise logs survive the adopt — a pull can never erase work", () => {
  const local = { dayCompletions: {}, exerciseLogs: { ex1: [entry("a", 100, "local")] } };
  const cloud = { dayCompletions: { d1: ["2026-08-10"] }, exerciseLogs: { ex1: [entry("b", 90, "cloud")] } };
  const out = mergedRosterProgress(local, cloud, false);
  const ids = out.exerciseLogs.ex1.map((e) => e.id).sort();
  assert.deepStrictEqual(ids, ["a", "b"], "both sides' entries present");
  assert.deepStrictEqual(out.dayCompletions, { d1: ["2026-08-10"] }, "rest adopts the cloud row");
});

check("unconfirmed coach write owns the local copy: dirty keeps local, identity-returned", () => {
  const local = { dayCompletions: { d9: ["2026-08-12"] }, exerciseLogs: {} };
  const cloud = { dayCompletions: {}, exerciseLogs: {} };
  const out = mergedRosterProgress(local, cloud, true);
  assert.strictEqual(out, local, "same object back — caller sees 'unchanged'");
});

check("no cloud row (offline / fetch failed): local kept, not wiped — the roster bug", () => {
  const local = { dayCompletions: { d1: ["2026-08-10"] }, exerciseLogs: {} };
  const out = mergedRosterProgress(local, undefined, false);
  assert.strictEqual(out, local, "identity — the local copy survives the refresh");
});

check("neither side has anything: null, which renders as the honest 'No sync'", () => {
  assert.strictEqual(mergedRosterProgress(null, undefined, false), null);
  assert.strictEqual(mergedRosterProgress(undefined, null, true), null);
});

console.log("");
if (failures) { console.log(`${failures} failing`); process.exit(1); }
console.log("all passing");
