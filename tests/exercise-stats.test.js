// exercise-stats.js is the load-bearing data behind the stat pentagon: it is
// what decides whether a logged set feeds STR or END, and whether a bound
// counts as AGI or DEX. Four ways it fails silently, all caught here:
//   1. A library exercise with no entry falls to the category fallback, so a
//      whole movement quietly scores as something it is not.
//   2. A vector that does not sum to the shared total makes one exercise worth
//      more than another for no reason — the drift the "sum to 10" rule exists
//      to stop.
//   3. A profile name typo'd in byName resolves to nothing at all.
//   4. A rep-banded profile missing a band throws at scoring time, on the
//      athlete's phone, mid-workout.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const statsSrc = fs.readFileSync(path.join(ROOT, "exercise-stats.js"), "utf8");

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
// Same normalisation app.js uses, so the keys here are the keys it will look up.
function exKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!]+$/, "");
}

const EXERCISE_LIBRARY = extractLiteral(appSrc, "const EXERCISE_LIBRARY = [");
const win = {};
new Function("window", statsSrc)(win);
const S = win.EXERCISE_STATS;

const STAT_KEYS = ["STR", "AGI", "DEX", "END", "CON"];
const VECTOR_TOTAL = 10;
const REP_BANDS = ["lo", "mid", "hi", "vhi"];

let n = 0;
const check = (label, fn) => { fn(); n++; console.log("  ok  " + label); };

check("the table loads and has the three sections", () => {
  assert.ok(S, "window.EXERCISE_STATS not defined");
  ["profiles", "byName", "fallback"].forEach((k) =>
    assert.ok(S[k] && typeof S[k] === "object", `missing section: ${k}`));
});

check("every vector sums to the shared total and names only real stats", () => {
  Object.entries(S.profiles).forEach(([key, p]) => {
    const vectors = p.v ? { v: p.v } : {};
    if (!p.v) REP_BANDS.forEach((b) => { vectors[b] = p[b]; });
    Object.entries(vectors).forEach(([band, v]) => {
      assert.ok(v, `${key}.${band}: missing vector`);
      const unknown = Object.keys(v).filter((k) => !STAT_KEYS.includes(k));
      assert.deepStrictEqual(unknown, [], `${key}.${band}: unknown stat keys ${unknown}`);
      const sum = STAT_KEYS.reduce((a, k) => a + (v[k] || 0), 0);
      assert.strictEqual(sum, VECTOR_TOTAL,
        `${key}.${band} sums to ${sum}, not ${VECTOR_TOTAL}. One set is one pot of ` +
        `points split by the vector; a bigger sum silently makes that movement worth more.`);
    });
  });
});

check("a rep-banded profile carries all four bands", () => {
  Object.entries(S.profiles).forEach(([key, p]) => {
    if (p.v) return; // fixed-vector profile, no bands
    REP_BANDS.forEach((b) => assert.ok(p[b], `${key}: missing rep band "${b}"`));
  });
});

check("a profile is either banded or fixed, never both and never neither", () => {
  Object.entries(S.profiles).forEach(([key, p]) => {
    const banded = REP_BANDS.some((b) => p[b]);
    assert.ok(p.v ? !banded : banded, `${key}: must have either v or lo/mid/hi/vhi`);
  });
});

check("timed profiles are fixed-vector, because seconds live in the reps field", () => {
  // Hold and carry SECONDS are stored in sets[].reps. A timed profile that used
  // rep bands would read a 45s carry as 45 reps and score it as endurance.
  Object.entries(S.profiles).forEach(([key, p]) => {
    if (p.timed) assert.ok(p.v, `${key}: timed profiles must use a fixed vector`);
  });
});

check("every profile a name or category points at actually exists", () => {
  const referenced = [...new Set([...Object.values(S.byName), ...Object.values(S.fallback)])];
  const missing = referenced.filter((p) => !S.profiles[p]);
  assert.deepStrictEqual(missing, [], `referenced but undefined: ${missing.join(", ")}`);
});

check("every exercise in the library has its own entry", () => {
  const names = EXERCISE_LIBRARY.flatMap((c) => c.ex.map(exKey));
  const missing = names.filter((k) => !S.byName[k]);
  assert.deepStrictEqual(missing, [],
    `${missing.length} library exercises fall through to the category fallback: ` +
    missing.slice(0, 10).join(", "));
});

check("every library category has a fallback, plus one for the unknown", () => {
  EXERCISE_LIBRARY.forEach((c) =>
    assert.ok(S.fallback[c.cat], `no fallback for category "${c.cat}"`));
  assert.ok(S.fallback[""], 'no fallback for "" (custom exercises resolve to no category)');
});

check("keys are already exKey-normalised", () => {
  Object.keys(S.byName).forEach((k) =>
    assert.strictEqual(k, exKey(k), `key "${k}" is not normalised`));
});

check("the plyo flag is only ever 0, 0.5 or 1", () => {
  Object.entries(S.profiles).forEach(([key, p]) => {
    assert.ok([0, 0.5, 1].includes(p.plyo), `${key}: plyo must be 0, 0.5 or 1, got ${p.plyo}`);
  });
});

check("every Plyometrics movement actually carries a plyo flag", () => {
  // The whole point of splitting the category out: a jump that scores plyo 0
  // would feed CON like a squat and AGI would stay dark.
  const cat = EXERCISE_LIBRARY.find((c) => c.cat === "Plyometrics");
  assert.ok(cat, "Plyometrics category missing from the library");
  const flat = cat.ex.filter((nm) => !S.profiles[S.byName[exKey(nm)]].plyo);
  assert.deepStrictEqual(flat, [], `plyometric movements with plyo 0: ${flat.join(", ")}`);
});

check("the heavy bands feed STR and the very-high bands feed END", () => {
  // Nathan's rule: over 25 reps is endurance. A compound must not still be
  // scoring strength at 30 reps.
  const c = S.profiles[S.byName[exKey("Back Squat")] || S.fallback["Quads"]];
  assert.ok(c.lo.STR > c.mid.STR, "a heavy triple should feed STR harder than a set of 10");
  assert.ok(c.vhi.END > c.vhi.STR, "past 25 reps a compound should read as endurance");
});

check("mobility is worth less than a working set", () => {
  const m = S.profiles[S.byName[exKey("Couch Stretch")]];
  assert.ok(m.w < 1, "mobility must be weighted below a working set so it cannot be farmed");
  assert.ok(m.v.DEX > 0, "mobility should feed DEX");
});

console.log(`\nexercise-stats: ${n} checks passed.`);
