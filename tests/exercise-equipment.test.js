// The realization map is the load-bearing data behind the program builder: it
// is what lets a missing barbell yield a dumbbell bench press instead of
// nothing. Two ways it fails silently, both caught here:
//   1. An exercise in the builder's pool with no entry is simply never picked,
//      so a muscle quietly has fewer options than it should.
//   2. A typo'd gear id or modifier tag matches nothing, so a realization can
//      never be satisfied and the movement vanishes for everyone.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const eqSrc = fs.readFileSync(path.join(ROOT, "exercise-equipment.js"), "utf8");

function extractLiteral(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`not found: ${marker}`);
  const open = at + marker.length - 1;
  const closer = { "{": "}", "[": "]" }[src[open]];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === closer) { depth--; if (!depth) return eval("(" + src.slice(open, i + 1) + ")"); }
  }
  throw new Error(`unbalanced: ${marker}`);
}
function exKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!]+$/, "");
}

const GEAR = extractLiteral(appSrc, "const GEAR = [");
const EXERCISE_MODIFIERS = extractLiteral(appSrc, "const EXERCISE_MODIFIERS = [");
const ANATOMY_GROUPS = extractLiteral(appSrc, "const ANATOMY_GROUPS = [");
const EXERCISE_LIBRARY = extractLiteral(appSrc, "const EXERCISE_LIBRARY = [");
const MAP = extractLiteral(eqSrc, "window.EXERCISE_EQUIPMENT = {");

const gearIds = new Set(GEAR.map((g) => g.id));
const equipTags = new Set(
  (EXERCISE_MODIFIERS.find((g) => g.group === "Equipment") || {}).tags || []);

// The pool the builder draws from: every curated anchor and accessory, plus
// the whole exercise library.
const pool = new Set();
ANATOMY_GROUPS.forEach((g) =>
  [...(g.anchors || []), ...(g.accessories || [])].forEach((n) => pool.add(exKey(n))));
EXERCISE_LIBRARY.forEach((c) => (c.ex || []).forEach((n) => pool.add(exKey(n))));

let n = 0;
const check = (label, fn) => { fn(); n++; console.log("  ok  " + label); };

check("the vocabulary is the 17 eq: icons", () => {
  assert.strictEqual(GEAR.length, 17);
  GEAR.forEach((g) => {
    assert.ok(g.id && g.label && g.icon, `incomplete gear row: ${JSON.stringify(g)}`);
    assert.ok(g.icon.startsWith("eq:"), `${g.id} must use an eq: icon, got ${g.icon}`);
  });
  assert.strictEqual(new Set(GEAR.map((g) => g.id)).size, 17, "gear ids must be unique");
});

check("every exercise in the builder's pool has a realization", () => {
  const missing = [...pool].filter((k) => !MAP[k]);
  assert.deepStrictEqual(missing, [],
    `${missing.length} pooled exercises have no equipment entry, so the builder ` +
    `can never pick them: ${missing.slice(0, 10).join(", ")}`);
});

check("nothing is mapped that the builder cannot reach", () => {
  // Not fatal, but an entry outside the pool is dead weight that will drift.
  const extra = Object.keys(MAP).filter((k) => !pool.has(k));
  assert.deepStrictEqual(extra, [], `mapped but not in the pool: ${extra.join(", ")}`);
});

check("every realization names real gear and a real modifier tag", () => {
  Object.entries(MAP).forEach(([k, rs]) => {
    assert.ok(Array.isArray(rs) && rs.length, `${k}: needs at least one realization`);
    rs.forEach((r) => {
      assert.ok(Array.isArray(r.gear), `${k}: gear must be an array`);
      r.gear.forEach((g) => assert.ok(gearIds.has(g), `${k}: unknown gear "${g}"`));
      if (r.tag !== null) assert.ok(equipTags.has(r.tag), `${k}: unknown modifier tag "${r.tag}"`);
    });
  });
});

check("keys are already exKey-normalised", () => {
  Object.keys(MAP).forEach((k) =>
    assert.strictEqual(k, exKey(k), `key "${k}" is not normalised`));
});

check("a tag never repeats what the name already says", () => {
  // Otherwise the app renders "Cable Cable Fly". The check is deliberately
  // narrow: only the tags whose own word appears in the name.
  const WORD = { BB: "barbell", DB: "dumbbell", DBs: "dumbbell", KB: "kettlebell",
    Cable: "cable", Machine: "machine", Band: "band", Landmine: "landmine", Bench: "bench" };
  Object.entries(MAP).forEach(([k, rs]) => rs.forEach((r) => {
    if (!r.tag) return;
    const w = WORD[r.tag];
    if (!w) return;
    assert.ok(!k.includes(w),
      `"${k}" already says ${w}, so the ${r.tag} tag would render it twice`);
  }));
});

check("bodyweight movements are reachable with no gear at all", () => {
  assert.ok(MAP["push-up"].some((r) => !r.gear.length),
    "a push-up must be performable with nothing");
  assert.ok(MAP["plank"].some((r) => !r.gear.length), "so must a plank");
});

check("the compounds name gear their titles do not", () => {
  // The reason this map is written by hand rather than sniffed from names.
  const needs = (k, g) => assert.ok(
    MAP[k] && MAP[k][0].gear.includes(g),
    `${k}'s first realization should need ${g}`);
  needs("back squat", "barbell");
  needs("back squat", "rack");
  needs("bench press", "barbell");
  needs("bench press", "bench");
  needs("pull-up", "pullup");
  needs("romanian deadlift", "barbell");
});

check("bench press can be done with dumbbells", () => {
  // Nathan's explicit ask: the movement survives a missing barbell.
  const db = MAP["bench press"].find((r) => r.gear.includes("dumbbell"));
  assert.ok(db, "bench press needs a dumbbell realization");
  assert.ok(db.gear.includes("bench"), "a dumbbell bench press still needs the bench");
  assert.strictEqual(db.tag, "DBs", "a two-dumbbell press is DBs, not DB");
});

check("every realization of a movement is distinct", () => {
  Object.entries(MAP).forEach(([k, rs]) => {
    const sigs = rs.map((r) => [...r.gear].sort().join("+") + "|" + r.tag);
    assert.strictEqual(new Set(sigs).size, sigs.length,
      `${k} lists the same realization twice, so the second can never be reached`);
  });
});

console.log(`\nexercise-equipment: ${n} checks passed.`);
