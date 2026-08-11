// Skip-the-day, and the one-session pullback after two in a row.
//
// The skip itself is sugar over entries the engine already rules on, so what
// needs pinning is the NEW rulings:
//
// 1. A deload-stamped entry is judged like a skip — logged:false, chain
//    frozen. Both failure modes it prevents are one branch away: judged as a
//    real attempt it reads "under target weight = miss" and STALLS the ladder
//    for taking the offer the app itself made; judged as a hit it climbs reps
//    off a weight that was never the target.
// 2. The pullback math honours progressionBackoff's own invariants: floors to
//    the ladder's grain, never cuts below the written weight.
// 3. Skip-occurrence detection: two in a row means the day's two most recent
//    occurrence dates are both all-skip, with partial logs breaking the run.

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

// progressionAttempt needs readinessScore/READINESS_QS/READY_LOW_MAX in scope;
// stub them — no readiness in these fixtures.
const progressionAttempt = new Function(
  "readinessScore", "READINESS_QS", "READY_LOW_MAX",
  `${fnSrc(appSrc, "function progressionAttempt(")}; return progressionAttempt;`
)(() => 0, [], 0);

const deloadTargetWeight = new Function(
  `${fnSrc(appSrc, "function deloadTargetWeight(")}; return deloadTargetWeight;`
)();

const daySkipHelpers = new Function(
  `${fnSrc(appSrc, "function dayOccurrences(")};
   ${fnSrc(appSrc, "function isSkipOccurrence(")};
   ${fnSrc(appSrc, "function consecutiveDaySkips(")};
   return { dayOccurrences, isSkipOccurrence, consecutiveDaySkips };`
)();

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures++; console.log(`  FAIL ${label}\n       ${e.message}`); }
}

const ex = { id: "e1", sets: 3 };

console.log("progressionAttempt rulings:");
check("a deload entry with full real sets is judged logged:false (chain frozen)", () => {
  const logs = { e1: [{ date: "2026-08-18", locked: true, deload: true,
    sets: [{ weight: 85, reps: 8 }, { weight: 85, reps: 8 }, { weight: 85, reps: 8 }] }] };
  const att = progressionAttempt(ex, 100, 3, logs, {});
  assert.strictEqual(att.logged, false, `deload session must not be judged (got ${JSON.stringify(att)})`);
});
check("…and NOT as a stall-triggering miss (the under-weight branch must not run)", () => {
  // Same entry, weight 15% under target: if the deload branch is missing,
  // this returns {logged:true, min:null} — a real miss that stalls.
  const logs = { e1: [{ date: "2026-08-18", locked: true, deload: true,
    sets: [{ weight: 85, reps: 8 }, { weight: 85, reps: 8 }, { weight: 85, reps: 8 }] }] };
  const att = progressionAttempt(ex, 100, 3, logs, {});
  assert.notStrictEqual(att.min === null && att.logged === true, true,
    "deload entry read as a real miss — taking the offer would stall the ladder");
});
check("a plain skip entry still rules logged:false (existing behaviour intact)", () => {
  const logs = { e1: [{ date: "2026-08-18", locked: true, skipped: true, sets: [] }] };
  assert.strictEqual(progressionAttempt(ex, 100, 3, logs, {}).logged, false);
});
check("a later REAL entry outranks an older deload one", () => {
  const logs = { e1: [
    { date: "2026-08-18", locked: true, deload: true, sets: [{ weight: 85, reps: 8 }, { weight: 85, reps: 8 }, { weight: 85, reps: 8 }] },
    { date: "2026-08-25", locked: true, sets: [{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }, { weight: 100, reps: 8 }] },
  ] };
  const att = progressionAttempt(ex, 100, 3, logs, {});
  assert.strictEqual(att.logged, true);
  assert.strictEqual(att.min, 8);
});

console.log("\npullback math:");
check("15% off 200 at 5lb grain → 170", () => {
  assert.strictEqual(deloadTargetWeight(200, 5, 15), 170);
});
check("floors to the grain: 15% off 185 at 5lb grain → 155 (not 157.25)", () => {
  assert.strictEqual(deloadTargetWeight(185, 5, 15), 155);
});
check("goes below the written weight — the offer is sanctioned, and a floor there would deliver 0% to whoever is at the floor", () => {
  // Early-chain athlete: target === written 105. progressionBackoff's floor
  // would return 105 — "15% lighter" delivering nothing.
  assert.strictEqual(deloadTargetWeight(105, 5, 15), 85);
});
check("never below one grain — a plate-able number, not zero", () => {
  assert.strictEqual(deloadTargetWeight(4, 5, 15), 5);
});
check("no grain given falls back to 5", () => {
  assert.strictEqual(deloadTargetWeight(200, 0, 15), 170);
});

console.log("\nskip-occurrence detection:");
const day = { id: "d1", exercises: [{ id: "e1" }, { id: "e2" }] };
const skipEntry = (date) => ({ date, locked: true, skipped: true, sets: [] });
const realEntry = (date) => ({ date, locked: true, sets: [{ weight: 100, reps: 8 }] });

check("two all-skip dates in a row → 2", () => {
  const logs = { e1: [skipEntry("2026-08-04"), skipEntry("2026-08-11")],
                 e2: [skipEntry("2026-08-04"), skipEntry("2026-08-11")] };
  assert.strictEqual(daySkipHelpers.consecutiveDaySkips(day, logs), 2);
});
check("a real session between breaks the run → 1", () => {
  const logs = { e1: [skipEntry("2026-08-04"), realEntry("2026-08-07"), skipEntry("2026-08-11")],
                 e2: [skipEntry("2026-08-04"), skipEntry("2026-08-11")] };
  assert.strictEqual(daySkipHelpers.consecutiveDaySkips(day, logs), 1);
});
check("a partially-logged date is a real occurrence, not a skip", () => {
  // e1 skipped but e2 actually trained that date → the athlete showed up.
  const logs = { e1: [skipEntry("2026-08-11")], e2: [realEntry("2026-08-11")] };
  assert.strictEqual(daySkipHelpers.consecutiveDaySkips(day, logs), 0);
});
check("no logs at all → 0", () => {
  assert.strictEqual(daySkipHelpers.consecutiveDaySkips(day, {}), 0);
});
check("single skip → 1", () => {
  const logs = { e1: [skipEntry("2026-08-11")], e2: [skipEntry("2026-08-11")] };
  assert.strictEqual(daySkipHelpers.consecutiveDaySkips(day, logs), 1);
});

console.log("");
if (failures) { console.log(`${failures} failing`); process.exit(1); }
console.log("all passing");
