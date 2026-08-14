// The stat-field scoring engine — statProfileFor / statVectorForEntry /
// statBucketForDate. See docs/superpowers/specs/2026-08-13-stat-pentagon-design.md.
//
// Everything here runs the SHIPPED functions, lifted out of app.js with the
// same brace-matcher merge-exercise-logs.test.js uses, and the tuning numbers
// are read out of the source rather than copied — a copy would drift while
// every assertion below kept passing against the copy.
//
// The exercise->profile table is a FIXTURE, not the real exercise-stats.js.
// That is deliberate: retuning a profile in the table must not break the
// engine's rules, and the table's own invariants (fixed vector totals, full
// library coverage) belong to tests/exercise-stats.test.js. What this file
// pins is the arithmetic, and in particular the four ways it fails silently:
//
//   1. Reading only entry.sets scores ZERO for every ladder drill, bound,
//      sprint, cone drill and stretch in the library, because that card writes
//      `rounds:[true,false]` with no `sets` key at all. AGI and DEX die.
//   2. A 3x45s carry read as "45 reps" lands in the 26+ endurance band, so
//      farmer's carries quietly become cardio.
//   3. An unlocked draft moving the field, while the Hoard reads zero.
//   4. Two devices minting two entries for one session and it counting twice.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const statsPath = path.join(ROOT, "exercise-stats.js");

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
// A whole `const NAME = …;` statement. Used for the tuning numbers so the
// bands, multipliers and the cap are the shipped ones, not a second opinion.
function constSrc(src, name) {
  const at = src.indexOf(`const ${name} = `);
  if (at < 0) throw new Error(`not found: const ${name}`);
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === ";" && !depth) return src.slice(at, i + 1);
  }
  throw new Error(`unterminated: const ${name}`);
}

const EXERCISE_LIBRARY = extractLiteral(appSrc, "const EXERCISE_LIBRARY = [");
const TIMED_CATS = extractLiteral(appSrc, "const TIMED_CATS = [");

const CONSTS = ["CARRY_NAMES", "STAT_KEYS", "STAT_IMPULSE_PROFILE", "STAT_MOBILITY_PROFILE",
  "STAT_STR_HARD", "STAT_EFFORT_MULT", "STAT_CARDIO_MULT", "STAT_TIMED_REF_SEC",
  "STAT_TIMED_MIN", "STAT_DAY_FULL", "STAT_DAY_HALF"];
const FNS = [
  // What the engine leans on from the rest of app.js.
  "function customExerciseList(", "function exKey(", "function exSwapFor(",
  "function exResolvedName(", "function libCatFor(", "function isCarryName(",
  "function exIsTimed(", "function cardioLogsAll(", "function athleteOwnDays(",
  "function sessionDays(", "function hoardExerciseIndex(",
  // The engine itself.
  "function statZero(", "function statTable(", "function statProfileByKey(",
  "function statRepBand(", "function statStrGate(", "function statIntensityMult(",
  "function statSeconds(", "function statReps(", "function statTimedRef(",
  "function statProfileVector(", "function statShare(", "function statProfileFor(",
  "function statVectorForEntry(", "function statVectorForCardio(",
  "function statCapDay(", "function statBucketForDate(",
];
const body = [
  "let _libCatByKey = null;",
  ...CONSTS.map((c) => constSrc(appSrc, c)),
  ...FNS.map((f) => fnSrc(appSrc, f)),
  "return { statProfileFor, statVectorForEntry, statBucketForDate, statCapDay, statSeconds, STAT_KEYS, STAT_STR_HARD, STAT_EFFORT_MULT };",
].join("\n\n");

const win = {};
const state = { trainerData: { customExercises: [] } };
const API = new Function("window", "state", "EXERCISE_LIBRARY", "TIMED_CATS", body)(
  win, state, EXERCISE_LIBRARY, TIMED_CATS);
const { statProfileFor, statVectorForEntry, statBucketForDate, statCapDay, statSeconds,
        STAT_KEYS, STAT_EFFORT_MULT } = API;

// ---- the fixture table -----------------------------------------------------
// Written in whole points summing to 100 per vector, which is the invariant the
// real table's own test pins. The engine normalises by each row's own total, so
// these numbers are shares, not magnitudes; magnitude is `w`.
const FIXTURE = {
  profiles: {
    squat: { w: 1, timed: false, plyo: 0,
      lo:  { STR: 60, AGI: 0, DEX: 5, END: 0,  CON: 35 },
      mid: { STR: 40, AGI: 0, DEX: 5, END: 0,  CON: 55 },
      hi:  { STR: 15, AGI: 0, DEX: 5, END: 10, CON: 70 },
      vhi: { STR: 0,  AGI: 0, DEX: 5, END: 60, CON: 35 } },
    carry: { w: 1, timed: true, plyo: 0, ref: 45,
      v: { STR: 25, AGI: 0, DEX: 10, END: 5, CON: 60 } },
    mobility: { w: 0.4, timed: true, plyo: 0, ref: 45,
      v: { STR: 0, AGI: 0, DEX: 70, END: 0, CON: 30 } },
    speed: { w: 1, timed: true, plyo: 0.5, ref: 20,
      v: { STR: 0, AGI: 40, DEX: 45, END: 15, CON: 0 } },
    "plyo-jump": { w: 1, timed: true, plyo: 1, ref: 20,
      v: { STR: 10, AGI: 70, DEX: 15, END: 5, CON: 0 } },
    ballistic: { w: 1, timed: false, plyo: 0.5,
      lo:  { STR: 45, AGI: 35, DEX: 5, END: 0,  CON: 15 },
      mid: { STR: 30, AGI: 35, DEX: 5, END: 0,  CON: 30 },
      hi:  { STR: 10, AGI: 25, DEX: 5, END: 10, CON: 50 },
      vhi: { STR: 0,  AGI: 15, DEX: 5, END: 45, CON: 35 } },
    cardio: { w: 1, timed: true, plyo: 0, ref: 300,
      v: { STR: 0, AGI: 5, DEX: 0, END: 75, CON: 20 } },
    neutral: { w: 1, timed: false, plyo: 0,
      lo:  { STR: 55, AGI: 0, DEX: 5, END: 0,  CON: 40 },
      mid: { STR: 35, AGI: 0, DEX: 5, END: 0,  CON: 60 },
      hi:  { STR: 10, AGI: 0, DEX: 5, END: 10, CON: 75 },
      vhi: { STR: 0,  AGI: 0, DEX: 5, END: 55, CON: 40 } },
  },
  byName: {
    "back squat": "squat",
    "farmer's carry": "carry",
    "couch stretch": "mobility",
    "ladder icky shuffle": "speed",
    "box jump": "plyo-jump",
    "treadmill run": "cardio",
  },
  fallback: {
    Quads: "squat", Carries: "carry", Cardio: "cardio",
    "Mobility & Stretching": "mobility", "Speed/Agility": "speed", Plyometrics: "plyo-jump",
    "": "neutral",
  },
};
win.EXERCISE_STATS = FIXTURE;

// ---- helpers ---------------------------------------------------------------
let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures++; console.log(`  FAIL ${label}\n       ${e.message}`); }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const total = (v) => STAT_KEYS.reduce((n, k) => n + v[k], 0);
const top = (v) => STAT_KEYS.slice().sort((a, b) => v[b] - v[a])[0];
const sets = (n, reps, weight) =>
  Array.from({ length: n }, () => ({ weight: weight == null ? "225" : weight, reps: String(reps) }));
const locked = (extra) => Object.assign({ id: "l1", date: "2026-08-13", m: 1, locked: true }, extra);

const squatEx = { id: "e-squat", name: "Back Squat", sets: "3", currentReps: "5" };
const carryEx = { id: "e-carry", name: "Farmer's Carry", sets: "3", currentReps: "45" };
const stretchEx = { id: "e-stretch", name: "Couch Stretch", kind: "mobility", sets: "3", currentReps: "45" };
const drillEx = { id: "e-drill", name: "Ladder Icky Shuffle", kind: "mobility", sets: "4", currentReps: "20" };
const runEx = { id: "e-run", name: "Treadmill Run", sets: "1", currentReps: "30 min" };

// ---- resolution order (spec 3.3) -------------------------------------------

check("the table classifies by name", () => {
  assert.strictEqual(statProfileFor(squatEx, {}), FIXTURE.profiles.squat);
  assert.strictEqual(statProfileFor(carryEx, {}), FIXTURE.profiles.carry);
});

check("an unknown name falls back to its library category, then to neutral", () => {
  // "Hack Squat" is in Quads but has no byName row in the fixture.
  assert.strictEqual(statProfileFor({ id: "x", name: "Hack Squat" }, {}), FIXTURE.profiles.squat);
  // Nothing at all knows "Sandbag Toss" — resistance work by overwhelming prior.
  assert.strictEqual(statProfileFor({ id: "x", name: "Sandbag Toss" }, {}), FIXTURE.profiles.neutral);
});

check("a coach-made hold with no category resolves to mobility, not neutral", () => {
  const custom = { id: "x", name: "Coach's Hip Opener", kind: "mobility", sets: "2", currentReps: "30" };
  assert.strictEqual(statProfileFor(custom, {}), FIXTURE.profiles.mobility);
});

check("an Impulse tag overrides the table", () => {
  const speedDl = { id: "x", name: "Back Squat", modifiers: ["Ballistic"] };
  assert.strictEqual(statProfileFor(speedDl, {}), FIXTURE.profiles.ballistic);
  const jump = { id: "x", name: "Back Squat", modifiers: ["BB", "Plyometric"] };
  assert.strictEqual(statProfileFor(jump, {}), FIXTURE.profiles["plyo-jump"]);
});

check("the Impulse tags are real modifier tags, in their own group", () => {
  // statProfileFor only looks the tag up in STAT_IMPULSE_PROFILE, so scoring
  // would pass even if the group did not exist — and then the coach would have
  // no way to SET the tag, and exerciseDisplayLabel would prepend it to the
  // name. Pin the group itself.
  const MODS = extractLiteral(appSrc, "const EXERCISE_MODIFIERS = [");
  const impulse = MODS.find((g) => g.group === "Impulse");
  assert.ok(impulse, "no Impulse group in EXERCISE_MODIFIERS — the tag is unsettable");
  assert.ok(!impulse.multi, "Impulse is single-select: a movement is one class or the other");
  const IMPULSE = extractLiteral(appSrc, "const STAT_IMPULSE_PROFILE = {");
  Object.keys(IMPULSE).forEach((t) =>
    assert.ok(impulse.tags.includes(t), `"${t}" is scored but is not an Impulse tag`));
  // Explosive must stay in Style. It is a tempo instruction, and _genTags
  // stamps it at random, so it must never become a movement class.
  const style = MODS.find((g) => g.group === "Style");
  assert.ok(style.tags.includes("Explosive"), "Explosive belongs to Style");
  assert.ok(!impulse.tags.includes("Explosive"), "Explosive must NOT be an Impulse tag");
  // liftKey must not fragment PR history on a new group.
  const LIFT_ID_GROUPS = extractLiteral(appSrc, "const LIFT_ID_GROUPS = [");
  assert.ok(!LIFT_ID_GROUPS.includes("Impulse"),
    "Impulse in LIFT_ID_GROUPS would split every tagged lift's PR history");
});

check("ex.sp beats everything, so a custom exercise is classifiable at all", () => {
  const custom = { id: "x", name: "Whatever", sp: "plyo-jump", modifiers: ["Ballistic"] };
  assert.strictEqual(statProfileFor(custom, {}), FIXTURE.profiles["plyo-jump"]);
});

check("a swap reclassifies: the swapped-IN exercise is what gets scored", () => {
  // setExerciseSwap keeps the exercise id and changes the name. Scoring the
  // prescription instead would credit a Box Jump as heavy squatting.
  const progress = { swaps: { "e-squat": { name: "Box Jump", from: "Back Squat", at: 1 } } };
  assert.strictEqual(statProfileFor(squatEx, progress), FIXTURE.profiles["plyo-jump"]);
  assert.strictEqual(statProfileFor(squatEx, {}), FIXTURE.profiles.squat, "unswapped is untouched");
});

// ---- what counts, per entry (spec 4.1) -------------------------------------

check("a rounds-only mobility entry scores > 0", () => {
  // THE bug this file exists for: the hold card writes rounds:[true,false] and
  // no `sets` key at all, so a sets-only reader kills AGI and DEX outright.
  const v = statVectorForEntry(stretchEx, locked({ rounds: [true, true, false] }), {});
  assert.ok(v.DEX > 0, "a stretch must score DEX");
  assert.strictEqual(top(v), "DEX");
  // Two completed rounds at 45s against a 45s reference, on a 0.4-weight
  // profile: mobility counts, at ~0.4 of a working set. Nathan's call.
  near(total(v), 0.8, "two rounds of mobility");
});

check("a speed drill is NOT discounted the way a stretch is", () => {
  // Both carry kind:"mobility" (isHoldName covers both), so the 0.4 has to come
  // from the profile, never from ex.kind.
  const v = statVectorForEntry(drillEx, locked({ rounds: [true, true, true, true] }), {});
  assert.strictEqual(top(v), "DEX");
  assert.ok(v.AGI > 0, "ladder work feeds AGI");
  near(total(v), 4, "four rounds at the drill's own 20s reference");
});

check("warm-ups score zero", () => {
  const warm = { warmups: [{ weight: "135", reps: "5" }, { weight: "185", reps: "3" }] };
  const none = statVectorForEntry(squatEx, locked(Object.assign({ sets: [] }, warm)), {});
  assert.strictEqual(total(none), 0, "a ramp on its own is worth nothing");
  const withRamp = statVectorForEntry(squatEx, locked(Object.assign({ sets: sets(3, 5) }, warm)), {});
  const without = statVectorForEntry(squatEx, locked({ sets: sets(3, 5) }), {});
  near(total(withRamp), total(without), "padding the ramp pays nothing");
});

check("an unlocked draft scores zero", () => {
  // The 800ms autosave writes locked:false entries whose sets survive a
  // truthiness filter on reps alone.
  const draft = { id: "l1", date: "2026-08-13", m: 1, locked: false, sets: sets(3, 5) };
  assert.strictEqual(total(statVectorForEntry(squatEx, draft, {})), 0);
  const legacy = { id: "l1", date: "2026-08-13", sets: sets(3, 5) };  // no `locked` at all
  assert.strictEqual(total(statVectorForEntry(squatEx, legacy, {})), 0);
});

check("a skipped entry, and skipped sets inside one, score zero", () => {
  assert.strictEqual(total(statVectorForEntry(squatEx, locked({ sets: [], skipped: true }), {})), 0);
  const half = statVectorForEntry(squatEx,
    locked({ sets: [...sets(2, 5), { weight: "", reps: "", skipped: true }] }), {});
  near(total(half), total(statVectorForEntry(squatEx, locked({ sets: sets(2, 5) }), {})),
    "an X'd set is not a set");
});

check("a burnout is one more set; a dropset is ONE set, not three", () => {
  const base = statVectorForEntry(squatEx, locked({ sets: sets(3, 10) }), {});
  const burn = statVectorForEntry(squatEx, locked({ sets: sets(3, 10), burnout: { reps: "10" } }), {});
  near(total(burn), total(base) + 1, "a set to failure is a set");
  const drop = statVectorForEntry(squatEx, locked({
    sets: sets(3, 10), dropset: [{ reps: "10" }, { reps: "8" }, { reps: "6" }] }), {});
  near(total(drop), total(base) + 1, "three drops are one set with drops in it");
});

// ---- rep bands and the flame rule (spec 3.2 / 4.2) -------------------------

check("a 3-rep set feeds STR", () => {
  const v = statVectorForEntry(squatEx, locked({ sets: sets(1, 3) }), {});
  assert.ok(v.STR > 0, "a triple must feed STR");
  assert.strictEqual(top(v), "STR", "and a powerlifter must READ as one");
});

check("an untagged heavy triple still feeds STR", () => {
  // The rep-count fallback: no flames anywhere, and STR must not die.
  const untagged = statVectorForEntry(squatEx, locked({ sets: sets(5, 3) }), {});
  assert.ok(!squatEx.effort, "fixture must be untagged for this to mean anything");
  assert.ok(untagged.STR > 0);
  const tagged = statVectorForEntry(Object.assign({}, squatEx, { effort: "max" }),
    locked({ sets: sets(5, 3) }), {});
  near(untagged.STR, tagged.STR, "1-5 reps already reads as near-maximal load");
});

check("a 30-rep set feeds END", () => {
  // Nathan's rule: over 25 reps is muscular endurance.
  const v = statVectorForEntry(squatEx, locked({ sets: sets(1, 30) }), {});
  assert.strictEqual(top(v), "END");
  assert.strictEqual(v.STR, 0, "nothing about 30 reps is maximal force");
});

check("the pot per set is the same in every band — only the split moves", () => {
  const at = (reps) => total(statVectorForEntry(squatEx, locked({ sets: sets(1, reps) }), {}));
  [3, 8, 20, 30].forEach((r) => near(at(r), 1, `${r} reps`));
});

check("a max-flame set feeds STR", () => {
  const maxEx = Object.assign({}, squatEx, { effort: "max" });
  const v = statVectorForEntry(maxEx, locked({ sets: sets(3, 8) }), {});
  assert.ok(v.STR > 0, "🔥×4 earns the whole STR share");
  const plain = statVectorForEntry(squatEx, locked({ sets: sets(3, 8) }), {});
  assert.strictEqual(plain.STR, 0, "untagged 8s earn none of it");
});

check("a moderate-flame 10-rep set feeds CON, not STR", () => {
  const modEx = Object.assign({}, squatEx, { effort: "moderate" });
  const v = statVectorForEntry(modEx, locked({ sets: sets(3, 10) }), {});
  assert.strictEqual(v.STR, 0, "moderate work is not maximal force");
  assert.strictEqual(top(v), "CON");
});

check("nothing is discarded — the STR share a set does not earn lands in CON", () => {
  const eight = (effort) => statVectorForEntry(Object.assign({}, squatEx, { effort }),
    locked({ sets: sets(3, 8) }), {});
  const maxed = eight("max"), untagged = eight(undefined);
  assert.strictEqual(untagged.STR, 0, "untagged 8s earn no STR");
  assert.ok(untagged.CON > maxed.CON, "the work lands in Condition instead");
  // Strip the intensity multiplier CON carries on the tagged set and the two
  // must agree exactly: the whole STR share moved across, none of it evaporated.
  near(maxed.STR + maxed.CON / STAT_EFFORT_MULT.max, untagged.CON,
    "a coach who never taps the picker loses no points");
});

check("unset effort is the multiplicative identity, not 'light'", () => {
  const plain = statVectorForEntry(squatEx, locked({ sets: sets(3, 10) }), {});
  const mod = statVectorForEntry(Object.assign({}, squatEx, { effort: "moderate" }),
    locked({ sets: sets(3, 10) }), {});
  near(total(plain), total(mod), "no opinion must change nothing");
  const light = statVectorForEntry(Object.assign({}, squatEx, { effort: "light" }),
    locked({ sets: sets(3, 10) }), {});
  assert.ok(total(light) < total(plain), "and 'light' is a real, smaller statement");
});

check("reported RIR beats the coach's prescription", () => {
  const hardEx = Object.assign({}, squatEx, { effort: "hard" });
  const easy = statVectorForEntry(hardEx, locked({ sets: sets(3, 10), rir: 4 }), {});
  const spent = statVectorForEntry(hardEx, locked({ sets: sets(3, 10), rir: 0 }), {});
  assert.ok(spent.CON > easy.CON, "'nothing left' outweighs '4 or more left'");
});

// ---- timed work (spec 4.1) -------------------------------------------------

check("a 45s carry does NOT read as 45 reps", () => {
  // The failure mode: 45 lands in the 26+ band and farmer's carries silently
  // become cardio, while the same carry at 10s reads as strength.
  const v = statVectorForEntry(carryEx, locked({ sets: sets(3, 45, "70") }), {});
  assert.strictEqual(top(v), "CON", "a carry is structure, not endurance");
  assert.ok(v.CON > v.END * 5, `END must stay small, got CON ${v.CON} / END ${v.END}`);
  // What it would have looked like read as reps, for contrast.
  const asReps = statVectorForEntry(squatEx, locked({ sets: sets(3, 45) }), {});
  assert.strictEqual(top(asReps), "END", "45 REPS really is endurance — that is the trap");
});

check("timed work scales by duration instead of by rep band", () => {
  const short = statVectorForEntry(carryEx, locked({ sets: sets(1, 15, "70") }), {});
  const long = statVectorForEntry(carryEx, locked({ sets: sets(1, 90, "70") }), {});
  near(total(short), 15 / 45, "15s is a third of a working set");
  near(total(long), 2, "90s is two");
});

check("a hold with an unknown duration is one ordinary set, not nothing", () => {
  const noRx = { id: "e-x", name: "Couch Stretch", kind: "mobility", sets: "2" };
  const v = statVectorForEntry(noRx, locked({ rounds: [true, true] }), {});
  near(total(v), 0.8, "two rounds at the profile's own weight");
});

check("a distance or a calorie count is not a duration", () => {
  assert.strictEqual(statSeconds("400m"), null);
  assert.strictEqual(statSeconds("30 m"), null, "the builder writes metres for carries");
  assert.strictEqual(statSeconds("15 cal"), null);
  assert.strictEqual(statSeconds("40 ft"), null);
  assert.strictEqual(statSeconds("45s"), 45);
  assert.strictEqual(statSeconds("3 min"), 180);
  assert.strictEqual(statSeconds("1:30"), 90);
  assert.strictEqual(statSeconds("45"), 45);
});

// ---- the day: dedupe, cardio, cap (spec 4.3 / 5.3) -------------------------

const DAY = "2026-08-13";
function clientWith(exercises) {
  return { id: "c1", weeks: [{ id: "w1", days: [{ id: "d1", name: "Day 1", exercises }] }], oneOffDays: [] };
}

check("a day sums its exercises", () => {
  const client = clientWith([squatEx, stretchEx]);
  const progress = { exerciseLogs: {
    "e-squat": [locked({ id: "a", sets: sets(3, 3) })],
    "e-stretch": [locked({ id: "b", rounds: [true, true, true] })],
  } };
  const b = statBucketForDate(client, progress, DAY);
  assert.ok(b.STR > 0 && b.DEX > 0, `expected both axes, got ${JSON.stringify(b)}`);
  assert.strictEqual(b.AGI, undefined, "zero axes are absent, not stored as 0");
});

check("two devices minting two entries for one session counts ONCE", () => {
  // merge_progress dedupes on entry id, not on (exId, date), and lockIn only
  // searches the local array — so both ids survive the union forever. Highest
  // `m` wins, the same tiebreak mergeExerciseLogs uses.
  const client = clientWith([squatEx]);
  const one = { exerciseLogs: { "e-squat": [locked({ id: "phone", m: 100, sets: sets(3, 3) })] } };
  const two = { exerciseLogs: { "e-squat": [
    locked({ id: "phone", m: 100, sets: sets(3, 3) }),
    locked({ id: "coach", m: 200, sets: sets(3, 3) }),
  ] } };
  assert.deepStrictEqual(statBucketForDate(client, two, DAY), statBucketForDate(client, one, DAY));
});

check("of two entries on one date, the higher m is the one that is priced", () => {
  const client = clientWith([squatEx]);
  const progress = { exerciseLogs: { "e-squat": [
    locked({ id: "stale", m: 100, sets: sets(1, 3) }),
    locked({ id: "fresh", m: 200, sets: sets(5, 3) }),
  ] } };
  const five = { exerciseLogs: { "e-squat": [locked({ id: "fresh", m: 200, sets: sets(5, 3) })] } };
  assert.deepStrictEqual(statBucketForDate(client, progress, DAY), statBucketForDate(client, five, DAY));
});

check("logs whose exercise no longer resolves are skipped, not guessed at", () => {
  // Program assignment re-mints exercise ids, so ~10% of production entries
  // point at nothing on the athlete's device. They must not throw.
  const b = statBucketForDate(clientWith([squatEx]),
    { exerciseLogs: { "gone-2019": [locked({ sets: sets(3, 3) })] } }, DAY);
  assert.deepStrictEqual(b, {});
});

check("a cardio log feeds END", () => {
  const b = statBucketForDate(clientWith([]),
    { cardioLogs: [{ id: "c", date: DAY, type: "Run", minutes: 30, intensity: "Moderate" }] }, DAY);
  assert.ok(b.END > 0, `expected END, got ${JSON.stringify(b)}`);
  assert.strictEqual(b.STR, undefined, "a run is not maximal force");
});

check("the same run scores the same in the cardio block and in a program day", () => {
  // Otherwise where the athlete taps decides the number.
  const block = statBucketForDate(clientWith([]),
    { cardioLogs: [{ id: "c", date: DAY, type: "Run", minutes: 30, intensity: "Moderate" }] }, DAY);
  const inDay = statBucketForDate(clientWith([runEx]),
    { exerciseLogs: { "e-run": [locked({ sets: [{ weight: "", reps: "30 min" }] })] } }, DAY);
  assert.deepStrictEqual(inDay, block);
});

check("the daily cap: 10 full, the next 6 at half, nothing beyond", () => {
  assert.strictEqual(statCapDay(0), 0);
  assert.strictEqual(statCapDay(6), 6);
  assert.strictEqual(statCapDay(10), 10, "ten hard sets is the full-credit ceiling");
  assert.strictEqual(statCapDay(12), 11, "the next six pay half");
  assert.strictEqual(statCapDay(16), 13);
  assert.strictEqual(statCapDay(400), 13, "beyond is worth nothing at all");
});

check("40 sets of one thing resolves to 13, not 38", () => {
  const client = clientWith([squatEx]);
  const b = statBucketForDate(client,
    { exerciseLogs: { "e-squat": [locked({ sets: sets(40, 10) })] } }, DAY);
  assert.strictEqual(b.CON, 13, `expected the ceiling, got ${JSON.stringify(b)}`);
});

check("a hard normal session lands under the ceiling", () => {
  // Five lifts, four working sets each, 8-10 reps, tagged hard. If a session
  // like this hits 13 the cap is doing the athlete's grading for them.
  const lifts = ["a", "b", "c", "d", "e"].map((s) => Object.assign({}, squatEx,
    { id: "e-" + s, effort: "hard" }));
  const logs = {};
  lifts.forEach((ex) => { logs[ex.id] = [locked({ id: "l-" + ex.id, sets: sets(4, 9) })]; });
  const b = statBucketForDate(clientWith(lifts), { exerciseLogs: logs }, DAY);
  assert.ok(b.CON > 5 && b.CON < 13, `dominant axis should sit mid-field, got ${b.CON}`);
});

check("the cap is applied at SUM time, so removing an exercise unwinds it", () => {
  const client = clientWith([squatEx, Object.assign({}, squatEx, { id: "e-2" })]);
  const both = { exerciseLogs: {
    "e-squat": [locked({ id: "a", sets: sets(20, 10) })],
    "e-2": [locked({ id: "b", sets: sets(20, 10) })],
  } };
  const one = { exerciseLogs: { "e-squat": [locked({ id: "a", sets: sets(6, 10) })] } };
  assert.strictEqual(statBucketForDate(client, both, DAY).CON, 13);
  assert.ok(statBucketForDate(client, one, DAY).CON < 13, "a smaller day is a smaller day");
});

check("empty and malformed inputs are safe", () => {
  assert.deepStrictEqual(statBucketForDate(null, null, DAY), {});
  assert.deepStrictEqual(statBucketForDate(clientWith([squatEx]), {}, DAY), {});
  assert.deepStrictEqual(statBucketForDate(clientWith([squatEx]), { exerciseLogs: {} }, ""), {});
  assert.strictEqual(total(statVectorForEntry(null, null, null)), 0);
  assert.strictEqual(statProfileFor(null, {}), null);
});

check("a missing exercise-stats.js degrades to zero, it does not throw", () => {
  // An installed PWA can run app.js against a cached bundle that predates the
  // vendored table.
  win.EXERCISE_STATS = undefined;
  try {
    assert.strictEqual(statProfileFor(squatEx, {}), null);
    assert.strictEqual(total(statVectorForEntry(squatEx, locked({ sets: sets(3, 5) }), {})), 0);
    assert.deepStrictEqual(statBucketForDate(clientWith([squatEx]),
      { exerciseLogs: { "e-squat": [locked({ sets: sets(3, 5) })] } }, DAY), {});
  } finally { win.EXERCISE_STATS = FIXTURE; }
});

// ---- the contract with the real table --------------------------------------
// Only the parts the ENGINE names by hand. Vector totals and library coverage
// belong to tests/exercise-stats.test.js.

if (!fs.existsSync(statsPath)) {
  console.log("  --   exercise-stats.js not written yet, skipping the table contract");
} else {
  const TABLE = extractLiteral(fs.readFileSync(statsPath, "utf8"), "window.EXERCISE_STATS = {");
  check("the real table carries the profiles the engine names by hand", () => {
    // Read the names OUT of app.js rather than listing them here. A hardcoded
    // list drifts the moment the engine is repointed at a renamed profile, and
    // then this check fails for a naming reason while claiming a coverage one.
    const impulse = extractLiteral(appSrc, "const STAT_IMPULSE_PROFILE = {");
    const mobility = (appSrc.match(/const STAT_MOBILITY_PROFILE = "([^"]+)"/) || [])[1];
    assert.ok(mobility, "STAT_MOBILITY_PROFILE not found in app.js");
    [...new Set([...Object.values(impulse), mobility])].forEach((k) =>
      assert.ok(TABLE.profiles[k], `statProfileFor resolves to profile "${k}" — it must exist`));
    assert.ok(TABLE.fallback[""], "the final default (an unknown name) must have a profile");
  });
  check("cardio-scale profiles carry their own duration reference", () => {
    // At the 45s hold reference a 30-minute run slams into the daily cap and
    // every run in the app reads exactly the same.
    const key = TABLE.fallback.Cardio;
    const p = TABLE.profiles[key];
    assert.ok(p, `fallback.Cardio names "${key}", which is not a profile`);
    assert.ok(Number(p.ref) >= 120, `the Cardio profile needs ref (seconds per unit), got ${p.ref}`);
  });
}

console.log("");
if (failures) { console.log(`${failures} failing`); process.exit(1); }
console.log("all passing");
