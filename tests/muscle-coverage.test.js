// Muscle coverage: turning an athlete's week into sets-per-muscle.
//
// Two wrong answers came out of this the first time it ran on a real program,
// and neither is visible on screen — the figure just quietly lights up wrong:
//
//   1. A week of squats, deadlifts and RDLs reported ZERO glute work, because
//      the curated anchors/accessories lists were treated as authoritative and
//      "Deadlift" appears only under Lower Back there. The lists say "this is a
//      good example of that muscle", not "this is all the exercise trains".
//   2. Front, side and rear delts all reported the SAME number, because the
//      demo database files every shoulder movement under one "shoulders" tag
//      and that coarse bucket was allowed to fan back out across all three
//      heads — overwriting the curated lists, the one source that knew a
//      lateral raise from a face pull.
//
// The functions below are copied from app.js per the convention in this folder,
// but the DATA is read out of app.js and exercise-demos.js so the assertions
// are made against the real anchors, accessories and muscle tags. If you change
// musclesForExercise() in app.js, change the copy here too.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");

// ---- pull the real data out of the sources -------------------------------
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

const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const ANATOMY_GROUPS = extractLiteral(appSrc, "const ANATOMY_GROUPS = [");
const EXERCISE_LIBRARY = extractLiteral(appSrc, "const EXERCISE_LIBRARY = [");

const demoSrc = fs.readFileSync(path.join(ROOT, "exercise-demos.js"), "utf8");
const EXERCISE_DEMOS = extractLiteral(demoSrc, "window.EXERCISE_DEMOS =[");

// ---- copies of the app.js logic ------------------------------------------
function exKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!]+$/, "");
}

const DEMO_MUSCLE_GROUPS = {
  abdominals: ["core"], quadriceps: ["quads"], hamstrings: ["hamstrings"],
  glutes: ["glutes"], calves: ["calves"], adductors: ["adductors"],
  abductors: ["abductors"], chest: ["chest"], lats: ["lats"],
  "middle back": ["rhomboids"], "lower back": ["lowerback"], traps: ["traps"],
  shoulders: ["delts-front", "delts-side", "delts-rear"],
  biceps: ["biceps"], triceps: ["triceps"], forearms: ["forearms"],
};
const LIB_CAT_GROUPS = {
  Chest: ["chest"], Back: ["lats", "rhomboids"], Quads: ["quads"],
  Hamstrings: ["hamstrings"], Glutes: ["glutes"], Adductors: ["adductors"],
  Abductors: ["abductors"], Shoulders: ["delts-front", "delts-side", "delts-rear"],
  Biceps: ["biceps"], Triceps: ["triceps"], Core: ["core", "obliques"],
  Calves: ["calves"], Carries: ["forearms", "traps"],
};

const curatedEx = new Map();
ANATOMY_GROUPS.forEach((g) => {
  [...(g.anchors || []), ...(g.accessories || [])].forEach((n) => {
    const k = exKey(n);
    if (!k) return;
    const arr = curatedEx.get(k) || [];
    if (!arr.includes(g.id)) arr.push(g.id);
    curatedEx.set(k, arr);
  });
});
const libCat = new Map();
EXERCISE_LIBRARY.forEach((c) => (c.ex || []).forEach((n) => libCat.set(exKey(n), c.cat)));

// Stand-in for demoEntryForName(): exact token match is enough for the names
// asserted below, and keeps the fuzzy matcher out of the test's way.
const demoByKey = new Map();
EXERCISE_DEMOS.forEach((e) => { if (!demoByKey.has(exKey(e.n))) demoByKey.set(exKey(e.n), e); });
const DEMO_ALIAS_FOR_TEST = { "bench press": "barbell bench press - medium grip", deadlift: "barbell deadlift" };
function demoEntryForName(name) {
  const k = exKey(name);
  return demoByKey.get(k) || demoByKey.get(DEMO_ALIAS_FOR_TEST[k] || "") || null;
}

function musclesForExercise(ex) {
  const name = typeof ex === "string" ? ex : ex && ex.name;
  const k = exKey(name);
  if (!k) return [];
  const best = new Map();
  const add = (id, weight) => { if (!(best.get(id) >= weight)) best.set(id, weight); };
  const curated = curatedEx.get(k) || [];
  curated.forEach((id) => add(id, 1));
  const curatedDelt = curated.some((id) => id.startsWith("delts-"));
  const entry = demoEntryForName(name);
  if (entry) {
    const fan = (m, weight) => {
      if (m === "shoulders" && curatedDelt) return;
      (DEMO_MUSCLE_GROUPS[m] || []).forEach((id) => add(id, weight));
    };
    (entry.p || []).forEach((m) => fan(m, 1));
    (entry.s || []).forEach((m) => fan(m, 0.5));
  }
  if (!best.size) {
    const cat = libCat.get(k);
    (LIB_CAT_GROUPS[cat] || []).forEach((id) => add(id, 1));
  }
  return [...best].map(([id, weight]) => ({ id, weight }));
}

// The TABLE is read out of app.js, not copied, so these assertions pin the real
// numbers. A copied table would drift silently and the test would cheerfully
// guard the copy — and it would also pass before app.js had the table at all,
// which is no test.
const TRAINING_LEVELS = extractLiteral(appSrc, "const TRAINING_LEVELS = [");
const TRAINING_LEVEL_BY_ID = Object.fromEntries(TRAINING_LEVELS.map((l) => [l.id, l]));
const DEFAULT_TRAINING_LEVEL = "intermediate";

// The LOGIC is copied, per the convention at the top of this file.
function levelBands(client) {
  return TRAINING_LEVEL_BY_ID[client?.trainingLevel]
    || TRAINING_LEVEL_BY_ID[DEFAULT_TRAINING_LEVEL];
}
function coverageBand(n, bands) {
  const b = bands || TRAINING_LEVEL_BY_ID[DEFAULT_TRAINING_LEVEL];
  if (n >= b.plenty) return 3;
  if (n >= b.solid) return 2;
  if (n >= 1) return 1;
  return 0;
}

function coverageForWeek(week, client) {
  const bands = levelBands(client);
  const sets = {};
  ANATOMY_GROUPS.forEach((g) => { sets[g.id] = 0; });
  let unmapped = 0;
  (week.days || []).forEach((d) => (d.exercises || []).forEach((ex) => {
    const n = Number(ex.sets) || 0;
    if (!n) return;
    const hits = musclesForExercise(ex);
    if (!hits.length) { unmapped++; return; }
    hits.forEach((h) => { if (sets[h.id] != null) sets[h.id] += n * h.weight; });
  }));
  Object.keys(sets).forEach((k) => { sets[k] = Math.round(sets[k] * 10) / 10; });
  return {
    sets, unmapped, bands,
    gaps: ANATOMY_GROUPS.filter((g) => !sets[g.id]).map((g) => g.id),
    light: ANATOMY_GROUPS.filter((g) => sets[g.id] > 0 && sets[g.id] < bands.solid).map((g) => g.id),
  };
}

// ---- helpers --------------------------------------------------------------
const w = (ex, id) => { const h = ex.find((x) => x.id === id); return h ? h.weight : 0; };
let n = 0;
const check = (label, fn) => { fn(); n++; console.log("  ok  " + label); };

// ---- the data is what we think it is -------------------------------------
check("the real sources loaded", () => {
  assert.strictEqual(ANATOMY_GROUPS.length, 19, "19 muscle groups");
  assert.ok(EXERCISE_LIBRARY.length > 10, "exercise library present");
  assert.ok(EXERCISE_DEMOS.length > 800, "demo database present");
});

// ---- regression 1: the curated lists must not short-circuit --------------
check("Deadlift credits glutes and hamstrings, not just lower back", () => {
  // It is listed under Lower Back in the curated anchors. That must not be the
  // whole story, or a squat/deadlift week reports zero glute work.
  assert.deepStrictEqual(curatedEx.get("deadlift"), ["lowerback"],
    "precondition: Deadlift is curated only under lowerback");
  const m = musclesForExercise("Deadlift");
  assert.strictEqual(w(m, "lowerback"), 1, "lower back still primary");
  assert.ok(w(m, "glutes") > 0, "glutes must get credit");
  assert.ok(w(m, "hamstrings") > 0, "hamstrings must get credit");
});

check("a squat/hinge week never reports zero glutes", () => {
  const cov = coverageForWeek({ days: [{ exercises: [
    { name: "Back Squat", sets: 5 },
    { name: "Romanian Deadlift", sets: 4 },
    { name: "Deadlift", sets: 4 },
  ] }] });
  assert.ok(cov.sets.glutes > 0, `glutes were ${cov.sets.glutes}`);
  assert.ok(cov.sets.hamstrings > 0, `hamstrings were ${cov.sets.hamstrings}`);
  assert.ok(!cov.gaps.includes("glutes"), "glutes must not be listed as a gap");
});

// ---- regression 2: the coarse shoulders bucket must not flatten delts ----
check("Lateral Raise favours side delts over the other two heads", () => {
  const m = musclesForExercise("Lateral Raise");
  assert.strictEqual(w(m, "delts-side"), 1, "side delts primary");
  assert.ok(w(m, "delts-side") > w(m, "delts-rear"),
    "a lateral raise is not a rear delt exercise");
});

check("Face Pull favours rear delts", () => {
  const m = musclesForExercise("Face Pull");
  assert.strictEqual(w(m, "delts-rear"), 1, "rear delts primary");
  assert.ok(w(m, "delts-rear") > w(m, "delts-front"),
    "a face pull is not a front delt exercise");
});

check("a mixed shoulder week gives the three heads different numbers", () => {
  const cov = coverageForWeek({ days: [{ exercises: [
    { name: "Overhead Press", sets: 4 },
    { name: "Lateral Raise", sets: 4 },
    { name: "Face Pull", sets: 3 },
  ] }] });
  const three = [cov.sets["delts-front"], cov.sets["delts-side"], cov.sets["delts-rear"]];
  assert.strictEqual(new Set(three).size > 1, true,
    `all three delts read the same (${three.join(", ")}) — the coarse bucket flattened them`);
});

// ---- weighting and fallbacks ---------------------------------------------
check("secondary involvement counts half", () => {
  const m = musclesForExercise("Barbell Deadlift");
  const secondary = m.filter((x) => x.weight === 0.5);
  assert.ok(secondary.length > 0, "some muscles should be assisting, not working");
  assert.ok(m.every((x) => x.weight === 1 || x.weight === 0.5), "weights are 1 or 0.5 only");
});

check("the library category is a fallback, never an override", () => {
  // Hip Abduction is the only entry under the Abductors category and is not in
  // the demo db under that name, so the floor is what answers.
  const m = musclesForExercise("Hip Abduction");
  assert.ok(m.some((x) => x.id === "abductors"), "abductors credited via the category floor");
});

check("an unrecognised exercise maps to nothing rather than guessing", () => {
  assert.deepStrictEqual(musclesForExercise("Zzzz Nonsense Lift"), []);
  const cov = coverageForWeek({ days: [{ exercises: [{ name: "Zzzz Nonsense Lift", sets: 4 }] }] });
  assert.strictEqual(cov.unmapped, 1, "it is counted so the coach can be told");
  assert.strictEqual(cov.sets.chest, 0, "and it silently credits nothing");
});

check("sets with no number contribute nothing", () => {
  const cov = coverageForWeek({ days: [{ exercises: [{ name: "Bench Press", sets: 0 }] }] });
  assert.strictEqual(cov.sets.chest, 0);
});

// ---- bands ----------------------------------------------------------------
check("the default level is a real row in the table", () => {
  assert.ok(TRAINING_LEVEL_BY_ID[DEFAULT_TRAINING_LEVEL],
    `DEFAULT_TRAINING_LEVEL "${DEFAULT_TRAINING_LEVEL}" is not in TRAINING_LEVELS`);
});

// ---- bands are per level ---------------------------------------------------
check("intermediate is EXACTLY today's ladder", () => {
  // The whole migration story rests on this. Every existing athlete is unset,
  // unset reads as intermediate, and intermediate must be 6/12 — or shipping
  // this moves every map on the roster before a single level is assigned.
  const b = TRAINING_LEVEL_BY_ID.intermediate;
  assert.strictEqual(b.solid, 6);
  assert.strictEqual(b.plenty, 12);
  assert.strictEqual(coverageBand(0, b), 0);
  assert.strictEqual(coverageBand(0.5, b), 0, "half a set still shows nothing");
  assert.strictEqual(coverageBand(1, b), 1);
  assert.strictEqual(coverageBand(5.5, b), 1);
  assert.strictEqual(coverageBand(6, b), 2);
  assert.strictEqual(coverageBand(11.5, b), 2);
  assert.strictEqual(coverageBand(12, b), 3);
});

check("every level splits on its own two numbers", () => {
  TRAINING_LEVELS.forEach((b) => {
    assert.strictEqual(coverageBand(0, b), 0, `${b.id}: zero`);
    assert.strictEqual(coverageBand(b.solid - 0.5, b), 1, `${b.id}: just under solid`);
    assert.strictEqual(coverageBand(b.solid, b), 2, `${b.id}: on solid`);
    assert.strictEqual(coverageBand(b.plenty - 0.5, b), 2, `${b.id}: just under plenty`);
    assert.strictEqual(coverageBand(b.plenty, b), 3, `${b.id}: on plenty`);
  });
});

check("the ladder climbs — no level is easier than a lighter one", () => {
  for (let i = 1; i < TRAINING_LEVELS.length; i++) {
    assert.ok(TRAINING_LEVELS[i].solid > TRAINING_LEVELS[i - 1].solid,
      `${TRAINING_LEVELS[i].id} solid must exceed ${TRAINING_LEVELS[i - 1].id}`);
    assert.ok(TRAINING_LEVELS[i].plenty > TRAINING_LEVELS[i - 1].plenty,
      `${TRAINING_LEVELS[i].id} plenty must exceed ${TRAINING_LEVELS[i - 1].id}`);
  }
});

check("unset and nonsense both fall back to intermediate", () => {
  const mid = TRAINING_LEVEL_BY_ID.intermediate;
  assert.deepStrictEqual(levelBands(null), mid, "no client at all");
  assert.deepStrictEqual(levelBands({}), mid, "field absent — every existing athlete");
  assert.deepStrictEqual(levelBands({ trainingLevel: "" }), mid, "explicitly unset");
  assert.deepStrictEqual(levelBands({ trainingLevel: "elite" }), mid, "a value we never wrote");
});

check("a beginner's week stops reading as a wall of warnings", () => {
  // The bug this feature exists for. Same week, two levels.
  const week = { days: [{ exercises: [
    { name: "Back Squat", sets: 5 },
    { name: "Bench Press", sets: 5 },
    { name: "Lateral Raise", sets: 3 },
  ] }] };
  const asMid = coverageForWeek(week, { trainingLevel: "intermediate" });
  const asBeg = coverageForWeek(week, { trainingLevel: "beginner" });
  assert.deepStrictEqual(asMid.sets, asBeg.sets, "the sets themselves do not change");
  assert.ok(asBeg.light.length < asMid.light.length,
    `a beginner should be warned about fewer muscles (${asBeg.light.length} vs ${asMid.light.length})`);
});

check("light tracks the level's own solid threshold", () => {
  TRAINING_LEVELS.forEach((lv) => {
    const cov = coverageForWeek({ days: [{ exercises: [
      { name: "Bench Press", sets: 5 }, { name: "Plank", sets: 2 },
    ] }] }, { trainingLevel: lv.id });
    cov.light.forEach((id) => {
      assert.ok(cov.sets[id] > 0 && cov.sets[id] < lv.solid,
        `${lv.id}: ${id} is listed light at ${cov.sets[id]} against solid ${lv.solid}`);
    });
    cov.gaps.forEach((id) => assert.ok(!cov.light.includes(id), `${lv.id}: ${id} in both lists`));
  });
});

check("gaps and light are disjoint, and cover every group", () => {
  const cov = coverageForWeek({ days: [{ exercises: [
    { name: "Bench Press", sets: 5 }, { name: "Plank", sets: 2 },
  ] }] });
  cov.gaps.forEach((id) => assert.ok(!cov.light.includes(id), `${id} in both lists`));
  assert.ok(cov.gaps.includes("adductors"), "nothing trains adductors here");
  assert.ok(cov.light.includes("chest") || cov.sets.chest >= 6, "chest got 5 sets");
});

console.log(`\nmuscle-coverage: ${n} checks passed.`);
