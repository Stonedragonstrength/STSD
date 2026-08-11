// mergeExerciseLogs — the Stage-1 client edition of the sync design's merge
// rule for the one catastrophic-loss family (see
// docs/superpowers/specs/2026-08-11-cloud-authoritative-sync-design.md).
//
// The invariant: a pull can never erase work. A cloud copy that hasn't seen a
// local entry must not delete it; a local copy that predates a cloud entry
// must not delete that either. Same entry id on both sides → higher `m`
// (entry-modified ms) wins, and a tie goes to LOCAL — the device in hand is
// the one being edited. Old entries carry no `m` (absent = 0), so any stamped
// rewrite beats an unstamped original.

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

const mergeExerciseLogs = new Function(
  `${fnSrc(appSrc, "function mergeExerciseLogs(")}; return mergeExerciseLogs;`
)();

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures++; console.log(`  FAIL ${label}\n       ${e.message}`); }
}

const entry = (id, date, m, tag) => ({ id, date, m, sets: [{ weight: tag, reps: 5 }], locked: true });

check("union: local-only and cloud-only entries both survive", () => {
  const local = { ex1: [entry("a", "2026-08-11", 100, "local-a")] };
  const cloud = { ex1: [entry("b", "2026-08-10", 90, "cloud-b")] };
  const out = mergeExerciseLogs(local, cloud);
  assert.strictEqual(out.ex1.length, 2);
  const ids = out.ex1.map((e) => e.id).sort();
  assert.deepStrictEqual(ids, ["a", "b"]);
});

check("a pull cannot erase local work the cloud hasn't seen", () => {
  // Cloud has NOTHING for ex1 (the stale-copy scenario that used to clobber).
  const local = { ex1: [entry("a", "2026-08-11", 100, "todays-fill")] };
  const out = mergeExerciseLogs(local, {});
  assert.strictEqual(out.ex1.length, 1);
  assert.strictEqual(out.ex1[0].sets[0].weight, "todays-fill");
});

check("a stale local copy cannot erase newer cloud work", () => {
  const cloud = { ex1: [entry("a", "2026-08-11", 100, "other-device")] };
  const out = mergeExerciseLogs({}, cloud);
  assert.strictEqual(out.ex1.length, 1);
  assert.strictEqual(out.ex1[0].sets[0].weight, "other-device");
});

check("same id: higher m wins regardless of which side holds it", () => {
  const newer = entry("a", "2026-08-11", 200, "newer");
  const older = entry("a", "2026-08-11", 100, "older");
  assert.strictEqual(mergeExerciseLogs({ ex1: [older] }, { ex1: [newer] }).ex1[0].sets[0].weight, "newer");
  assert.strictEqual(mergeExerciseLogs({ ex1: [newer] }, { ex1: [older] }).ex1[0].sets[0].weight, "newer");
});

check("tie (equal m, and the both-unstamped case) goes to local", () => {
  const l = entry("a", "2026-08-11", 100, "local");
  const c = entry("a", "2026-08-11", 100, "cloud");
  assert.strictEqual(mergeExerciseLogs({ ex1: [l] }, { ex1: [c] }).ex1[0].sets[0].weight, "local");
  const lu = { id: "a", date: "2026-08-11", sets: [{ weight: "local-unstamped", reps: 5 }] };
  const cu = { id: "a", date: "2026-08-11", sets: [{ weight: "cloud-unstamped", reps: 5 }] };
  assert.strictEqual(mergeExerciseLogs({ ex1: [lu] }, { ex1: [cu] }).ex1[0].sets[0].weight, "local-unstamped");
});

check("a stamped rewrite beats an unstamped original", () => {
  const stamped = entry("a", "2026-08-11", 1, "stamped");
  const unstamped = { id: "a", date: "2026-08-11", sets: [{ weight: "unstamped", reps: 5 }] };
  assert.strictEqual(mergeExerciseLogs({ ex1: [unstamped] }, { ex1: [stamped] }).ex1[0].sets[0].weight, "stamped");
});

check("entries without ids key by date and still merge", () => {
  const l = { date: "2026-08-11", m: 5, sets: [{ weight: "l", reps: 5 }] };
  const c = { date: "2026-08-10", m: 9, sets: [{ weight: "c", reps: 5 }] };
  const out = mergeExerciseLogs({ ex1: [l] }, { ex1: [c] });
  assert.strictEqual(out.ex1.length, 2, "different dates = different entries");
});

check("exercises present on only one side survive whole", () => {
  const out = mergeExerciseLogs({ ex1: [entry("a", "2026-08-11", 1, "l")] },
                                { ex2: [entry("b", "2026-08-10", 1, "c")] });
  assert.ok(out.ex1 && out.ex2, "both exercise keys present");
});

check("null/undefined inputs are safe", () => {
  assert.deepStrictEqual(mergeExerciseLogs(null, null), {});
  assert.deepStrictEqual(mergeExerciseLogs(undefined, { ex1: [] }).ex1, []);
});

console.log("");
if (failures) { console.log(`${failures} failing`); process.exit(1); }
console.log("all passing");
