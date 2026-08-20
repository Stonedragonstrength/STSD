// The five band colors, and the one thing that must never change about them.
//
// A band is not an implement. A barbell squat really is a different lift from a
// dumbbell squat — different loading scale, so they rightly keep separate PR
// ladders and separate progression chains, which is what LIFT_ID_GROUPS is for.
// A green band is NOT a different lift from a grey one: for a band-only exercise
// the band IS the load, the way 225 is the load on a bench, and nobody forks a
// lift's identity between 225 and 315.
//
// So "Band" is deliberately absent from LIFT_ID_GROUPS, and the liftKey checks
// below exist to fail loudly if anyone adds it. Adding it would shatter every
// athlete's banded history into five unrelated short chains with nothing
// climbing between them — silently, and only visible months later as a graph
// that never goes anywhere.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
// The progression engine moved to src/training/progression.js (Phase 2
// extraction); its source is read from the module file.
const progressionSrc = fs.readFileSync(path.join(ROOT, "src", "training", "progression.js"), "utf8");

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
// Grab a function's body by brace-matching from its declaration. Same helper
// as tests/training-level-plumbing.test.js and tests/anatomy-coverage-wiring.test.js
// — reused rather than reinvented. Used below (Task 3) to execute the REAL
// progressionRule()/progressionResult() out of the live shipped module, rather than trusting
// a hand-copied stand-in to stay honest about what the engine actually does.
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
function extractConst(src, name) {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*([^;]+);`));
  if (!m) throw new Error(`not found: ${name}`);
  return eval(m[1]);
}

const TAG_COLORS = extractLiteral(appSrc, "const TAG_COLORS = {");

// The tag system and lift identity moved to src/training/tags.js (Phase 2
// extraction). The shipped module assigns onto globalThis.STSD when executed,
// so requiring it hands this test the same real tables and functions the app
// runs — the hand-copied stand-ins this file used to carry are gone with it.
require(path.join(ROOT, "src", "training", "tags.js"));
const { EXERCISE_MODIFIERS, TAG_LONG, LIFT_ID_GROUPS, liftKey,
        groupForTag, orderedModifiers,
        BAND_TAGS, bandOf, nextBandUp } = globalThis.STSD.training;

const BANDS = ["Yellow", "Red", "Purple", "Green", "Grey"];

let n = 0;
const check = (label, fn) => { fn(); n++; console.log("  ok  " + label); };

// ---- the group exists and is shaped right --------------------------------
check("the Band group carries all five colors, in ladder order", () => {
  const g = EXERCISE_MODIFIERS.find((x) => x.group === "Band");
  assert.ok(g, "there is a Band group");
  assert.deepStrictEqual(g.tags, BANDS,
    "the tag order IS the ladder, lightest to heaviest — nothing else stores it");
});

check("the Band group is single-select", () => {
  const g = EXERCISE_MODIFIERS.find((x) => x.group === "Band");
  assert.ok(!g.multi, "no multi flag — one band at a time, picking a second replaces the first");
});

check("every color resolves to the Band group", () => {
  BANDS.forEach((t) => {
    assert.strictEqual(groupForTag(t)?.group, "Band", `${t} resolves to Band`);
  });
});

check("no color collides with a tag in another group", () => {
  BANDS.forEach((t) => {
    const hits = EXERCISE_MODIFIERS.filter((g) => g.tags.includes(t));
    assert.strictEqual(hits.length, 1, `${t} appears in ${hits.length} groups — must be exactly 1`);
  });
});

check("every band has its own color — none falls through to the slate default", () => {
  const seen = new Set();
  BANDS.forEach((t) => {
    const c = TAG_COLORS[t];
    assert.ok(c, `${t} has a TAG_COLORS entry`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(c.color), `${t} has a hex color, got ${c.color}`);
    assert.ok(c.bg, `${t} has a background`);
    assert.ok(!seen.has(c.color), `${t} reuses ${c.color} — the colors ARE the meaning here`);
    seen.add(c.color);
  });
});

check("every band expands to a readable name", () => {
  BANDS.forEach((t) => {
    assert.strictEqual(TAG_LONG[t], `${t} Band`, `${t} expands for the athlete's sentence`);
  });
});

// ---- the decision this file exists to defend ------------------------------
check("Band is NOT in LIFT_ID_GROUPS", () => {
  assert.ok(!LIFT_ID_GROUPS.includes("Band"),
    "Adding Band to LIFT_ID_GROUPS shatters every athlete's banded history into " +
    "five unrelated chains. The band is the load, not the implement. If you are " +
    "reading this because the test failed: that change is the bug, not this test.");
});

check("the band does not change a lift's identity", () => {
  const plain = { name: "Band Pull-Apart", modifiers: [] };
  const green = { name: "Band Pull-Apart", modifiers: ["Green"] };
  const grey  = { name: "Band Pull-Apart", modifiers: ["Grey"] };
  assert.strictEqual(liftKey(green), liftKey(grey),
    "green and grey are rungs on one ladder — same lift, same history");
  assert.strictEqual(liftKey(green), liftKey(plain),
    "and tagging a band at all must not fork an exercise off its own history");
});

check("a band alongside an implement still keys on the implement", () => {
  // Accommodating resistance: the bar makes it a barbell lift, the band does not
  // make it a different one.
  const bare  = { name: "Bench Press", modifiers: ["BB"] };
  const banded = { name: "Bench Press", modifiers: ["BB", "Red"] };
  assert.strictEqual(liftKey(bare), liftKey(banded));
  assert.ok(liftKey(banded).includes("bb"), "the implement is still in the key");
});

check("the band chip renders after the implement", () => {
  const ex = { modifiers: ["Red", "BB"] };
  assert.deepStrictEqual(orderedModifiers(ex), ["BB", "Red"],
    "Band sits after Equipment in EXERCISE_MODIFIERS, so chips read [BB] [Red]");
});

// ---- the ladder -----------------------------------------------------------
check("next band up, and grey is the top", () => {
  const nextBand = (tag) => {
    const i = BANDS.indexOf(tag);
    return i < 0 || i === BANDS.length - 1 ? null : BANDS[i + 1];
  };
  assert.strictEqual(nextBand("Yellow"), "Red");
  assert.strictEqual(nextBand("Purple"), "Green");
  assert.strictEqual(nextBand("Grey"), null, "nothing above grey");
  assert.strictEqual(nextBand("Chartreuse"), null, "an unknown tag has no next");
});

// ---- the helpers the card uses -------------------------------------------
// Copied from app.js — see the note at the top of tests/README.md.
// BAND_TAGS, bandOf and nextBandUp come from the shipped module (required at
// the top of this file) — no more copies to drift.

check("BAND_TAGS is read from the group, so it cannot drift from the ladder", () => {
  assert.deepStrictEqual(BAND_TAGS, BANDS);
});

check("bandOf finds the band among other tags, or says there isn't one", () => {
  assert.strictEqual(bandOf({ modifiers: ["BB", "Incline", "Purple"] }), "Purple");
  assert.strictEqual(bandOf({ modifiers: ["BB", "Incline"] }), null);
  assert.strictEqual(bandOf({ modifiers: [] }), null);
  assert.strictEqual(bandOf({}), null, "an exercise with no modifiers array at all");
  assert.strictEqual(bandOf(null), null);
});

check("bandOf is not fooled by the old unspecified Band equipment tag", () => {
  // "Band" (Equipment) still means "a band, unspecified" and predates the
  // colors. It is not a rung and must not be mistaken for one.
  assert.strictEqual(bandOf({ modifiers: ["Band"] }), null);
});

check("stepping up stops at grey", () => {
  assert.strictEqual(nextBandUp("Yellow"), "Red");
  assert.strictEqual(nextBandUp("Red"), "Purple");
  assert.strictEqual(nextBandUp("Purple"), "Green");
  assert.strictEqual(nextBandUp("Green"), "Grey");
  assert.strictEqual(nextBandUp("Grey"), null, "grey is the top — the control goes away");
  assert.strictEqual(nextBandUp(null), null);
});

// ---- when a band-only lift has topped out --------------------------------
// A band-only lift has no number to climb — the band IS the load — so it gets
// the same rep ladder bodyweight gets, and tops out at its ceiling. That is the
// moment the card offers the next band. The engine never takes it: a band change
// is a prescription, and prescriptions are the coach's.
function bandOnlyRule(ex) {
  const floor = parseInt(ex.currentReps, 10);
  if (!floor) return null;
  const ceil = parseInt(ex.progression?.ceil, 10);
  if (!ceil || ceil <= floor) return null;
  const hasWeight = String(ex.currentWeight || "").trim() !== "";
  if (hasWeight || !bandOf(ex)) return null;
  return { floor, ceil, band: true, repsOnly: true };
}

check("a band-only lift gets a rep ladder where today it gets nothing", () => {
  const ex = { name: "Band Pull-Apart", modifiers: ["Green"],
    currentWeight: "", currentReps: "10", progression: { ceil: "15" } };
  const rule = bandOnlyRule(ex);
  assert.ok(rule, "it has a progression rule at all");
  assert.strictEqual(rule.band, true);
  assert.strictEqual(rule.floor, 10);
  assert.strictEqual(rule.ceil, 15);
});

check("a bar+band lift is NOT band-only — the bar climbs, the band holds", () => {
  const ex = { name: "Bench Press", modifiers: ["BB", "Red"],
    currentWeight: "225", currentReps: "5", progression: { ceil: "8" } };
  assert.strictEqual(bandOnlyRule(ex), null,
    "it has a weight to climb, so it uses the ordinary weight ladder");
});

check("an unbanded weightless lift is not a band ladder either", () => {
  const ex = { name: "Plank", modifiers: [],
    currentWeight: "", currentReps: "30", progression: { ceil: "60" } };
  assert.strictEqual(bandOnlyRule(ex), null);
});

check("at the ceiling, the next band is what's offered", () => {
  const ex = { name: "Band Pull-Apart", modifiers: ["Purple"],
    currentWeight: "", currentReps: "10", progression: { ceil: "15" } };
  const rule = bandOnlyRule(ex);
  const atCap = 15 >= rule.ceil;           // what the engine will report
  assert.ok(atCap, "topped out");
  assert.strictEqual(nextBandUp(bandOf(ex)), "Green", "and green is what's earned");
});

check("on grey there is nothing left to offer", () => {
  const ex = { name: "Band Pull-Apart", modifiers: ["Grey"],
    currentWeight: "", currentReps: "15", progression: { ceil: "15" } };
  assert.strictEqual(nextBandUp(bandOf(ex)), null,
    "topped out on the heaviest band — the card must not promise a rung that isn't there");
});

// ---- binding to the REAL app.js functions, not just the stand-in ---------
// bandOnlyRule() above is a simplified stand-in that expresses the intended
// shape; it cannot prove app.js was actually changed to match it — a typo in
// progressionRule() could leave it returning null forever and every check
// above would still pass. These pull the REAL progressionRule() and
// progressionResult() out of src/training/progression.js with fnBody() and execute them,
// the same technique tests/anatomy-coverage-wiring.test.js uses for exactly
// this reason (a reviewer proved that file's earlier text-only checks kept
// passing after the real bug was reintroduced).
const PROG_TIME_STEP = extractConst(progressionSrc, "PROG_TIME_STEP");
const PROG_MAX_ADD_SETS = extractConst(progressionSrc, "PROG_MAX_ADD_SETS");
const PROG_BACKOFF_PCTS = extractConst(progressionSrc, "PROG_BACKOFF_PCTS");
const PROG_STALL_DEFAULT = extractConst(progressionSrc, "PROG_STALL_DEFAULT");
const PROG_NO_CAP = extractConst(progressionSrc, "PROG_NO_CAP");
// RIR autoregulation reads a per-rule target (2026-08-19), so progressionRule
// now closes over these two as well. Every constant the extracted body names
// has to be injected here or the Function call throws — see the extraction
// rules at the top of this block.
const PROG_RIR_EASY = extractConst(progressionSrc, "PROG_RIR_EASY");
const PROG_RIR_TARGET = extractConst(progressionSrc, "PROG_RIR_TARGET");
// Stub: real exIsTimed() also name-sniffs carries (isCarryName), which no
// fixture below relies on — only the explicit ex.timed flag matters here.
const exIsTimedStub = (ex) => !!(ex && ex.timed === true);

const realProgressionRuleFn = new Function(
  "ex", "exIsTimed", "bandOf", "PROG_TIME_STEP", "PROG_MAX_ADD_SETS", "PROG_BACKOFF_PCTS", "PROG_STALL_DEFAULT", "PROG_NO_CAP",
  "PROG_RIR_EASY", "PROG_RIR_TARGET",
  fnBody(progressionSrc, "function progressionRule(ex) {")
);
function realProgressionRule(ex) {
  return realProgressionRuleFn(ex, exIsTimedStub, bandOf, PROG_TIME_STEP, PROG_MAX_ADD_SETS, PROG_BACKOFF_PCTS, PROG_STALL_DEFAULT, PROG_NO_CAP,
    PROG_RIR_EASY, PROG_RIR_TARGET);
}
const realProgressionResult = new Function(
  "st", "rule", "writtenSets", "base",
  fnBody(progressionSrc, "function progressionResult(st, rule, writtenSets, base) {")
);

check("REAL progressionRule(): a band-only lift now gets a rep ladder", () => {
  const ex = { name: "Band Pull-Apart", modifiers: ["Purple"],
    currentWeight: "", currentReps: "10", progression: { ceil: "15" } };
  const rule = realProgressionRule(ex);
  assert.ok(rule, "progressionRule() must no longer bail at the parseFloat for a band-only lift");
  assert.strictEqual(rule.band, true);
  assert.strictEqual(rule.repsOnly, true, "it rides the same reps-only ladder bodyweight gets");
  assert.strictEqual(rule.floor, 10);
  assert.strictEqual(rule.ceil, 15);
  assert.strictEqual(rule.inc, 0, "no weight leg — the band is the load");
  assert.strictEqual(rule.reset, 10, "holds at the floor; nothing to reset to but itself");
});

check("REAL progressionRule(): atCap flows end to end for a band-only lift at its ceiling", () => {
  const ex = { name: "Band Pull-Apart", modifiers: ["Purple"],
    currentWeight: "", currentReps: "10", progression: { ceil: "15" } };
  const rule = realProgressionRule(ex);
  const st = { weight: 0, reps: 15, extra: 0, stall: 0, earned: 0, deloads: 0, last: "cap" };
  const res = realProgressionResult(st, rule, 3, 0);
  assert.strictEqual(res.atCap, true, "topped out — the next band is earned");
  assert.strictEqual(res.band, true, "the card can tell this cap means a band, not a weight jump");
});

check("REAL progressionRule(): a bar+band lift is untouched — weight present wins over the band tag", () => {
  const ex = { name: "Bench Press", modifiers: ["BB", "Red"],
    currentWeight: "225", currentReps: "5", progression: { ceil: "8", inc: "5" } };
  const rule = realProgressionRule(ex);
  assert.ok(rule, "still has a rule");
  assert.ok(!rule.band, "not band-only — it has a real weight to climb");
  assert.strictEqual(rule.inc, 5, "the ordinary weight increment, untouched");
});

check("REAL progressionRule(): an unbanded weightless lift still gets nothing, exactly as before", () => {
  const ex = { name: "Plank", modifiers: [], currentWeight: "", currentReps: "30", progression: { ceil: "60" } };
  assert.strictEqual(realProgressionRule(ex), null,
    "no band and no weight — still no progression at all, the pre-existing (and correct) behavior");
});

check("REGRESSION: REAL progressionRule() is byte-identical for a weighted lift", () => {
  const ex = { currentWeight: "185", currentReps: "5", progression: { ceil: "8", inc: "5" } };
  assert.deepStrictEqual(realProgressionRule(ex), {
    floor: 5, ceil: 8, inc: 5, reset: 5, step: 1, timed: false,
    addSets: 0, backoff: 0, stallAfter: 2, targetRir: 2,
  });
});

check("REGRESSION: REAL progressionRule() is byte-identical for a bodyweight lift (plain and graduating)", () => {
  const plain = { currentWeight: "BW", currentReps: "10", progression: { ceil: "15" } };
  assert.deepStrictEqual(realProgressionRule(plain), {
    floor: 10, ceil: 15, inc: 0, reset: 10, bw: true, step: 1, timed: false,
    addSets: 0, backoff: 0, stallAfter: 2, targetRir: 2,
  });
  const graduating = { currentWeight: "BW", currentReps: "10", progression: { ceil: "15", inc: "10" } };
  assert.deepStrictEqual(realProgressionRule(graduating), {
    floor: 10, ceil: 15, inc: 10, reset: 10, bw: true, graduate: true, step: 1, timed: false,
    addSets: 0, backoff: 0, stallAfter: 2, targetRir: 2,
  });
});

check("REGRESSION: REAL progressionResult() gains atCap but every other field is untouched for a weighted climb", () => {
  const rule = realProgressionRule({ currentWeight: "185", currentReps: "5", progression: { ceil: "8", inc: "5" } });
  const st = { weight: 190, reps: 5, extra: 0, stall: 0, earned: 1, deloads: 0, last: "jump" };
  const res = realProgressionResult(st, rule, 3, 185);
  assert.strictEqual(res.atCap, false, "a weight jump is not a band cap");
  // `ground` and `easyRun` joined the result with RIR autoregulation
  // (2026-08-19) the same way atCap did — peeled off here for the same reason:
  // this assertion is about the fields that existed BEFORE, and it must keep
  // failing on a change to any of those.
  const { atCap, ground, easyRun, ...older } = res;
  assert.strictEqual(ground, false, "a weight jump is not a ground-out hold");
  assert.deepStrictEqual(older, {
    weight: 190, reps: 5, earned: 1, gained: 5, extra: 0, sets: 3, stall: 0, deloads: 0,
    justDeloaded: false, floor: 5, ceil: 8, inc: 5, reset: 5, step: 1, timed: false,
    addSets: 0, backoff: 0, stallAfter: 2, targetRir: 2,
  }, "every pre-existing field computes exactly as it did before atCap existed");
});

console.log(`\nband-tags: ${n} checks passed.`);
