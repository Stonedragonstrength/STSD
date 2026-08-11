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

const EXERCISE_MODIFIERS = extractLiteral(appSrc, "const EXERCISE_MODIFIERS = [");
const TAG_COLORS         = extractLiteral(appSrc, "const TAG_COLORS = {");
const TAG_LONG           = extractLiteral(appSrc, "const TAG_LONG = {");
const LIFT_ID_GROUPS     = extractLiteral(appSrc, "const LIFT_ID_GROUPS = [");

const BANDS = ["Yellow", "Red", "Purple", "Green", "Grey"];

// ---- copies of the app.js logic ------------------------------------------
function exKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!]+$/, "");
}
function groupForTag(tag) {
  return EXERCISE_MODIFIERS.find((g) => g.tags.includes(tag)) || null;
}
function orderedModifiers(ex) {
  return [...(ex.modifiers || [])].sort((a, b) => {
    const ga = EXERCISE_MODIFIERS.findIndex((g) => g.tags.includes(a));
    const gb = EXERCISE_MODIFIERS.findIndex((g) => g.tags.includes(b));
    if (ga !== gb) return ga - gb;
    const g = EXERCISE_MODIFIERS[ga];
    return g ? g.tags.indexOf(a) - g.tags.indexOf(b) : 0;
  });
}
function liftTags(ex) {
  return orderedModifiers(ex || {}).filter((t) => LIFT_ID_GROUPS.includes(groupForTag(t)?.group));
}
// exResolvedName() resolves template placeholders; irrelevant here, so the bare
// name stands in for it.
function liftKey(ex) {
  const bare = exKey(ex?.name || "");
  if (!bare) return "";
  const tags = liftTags(ex).map((t) => t.toLowerCase()).sort().join("+");
  return tags ? `${bare}|${tags}` : bare;
}

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
const BAND_TAGS = (EXERCISE_MODIFIERS.find((g) => g.group === "Band") || {}).tags || [];
function bandOf(ex) {
  return (ex?.modifiers || []).find((t) => BAND_TAGS.includes(t)) || null;
}
function nextBandUp(tag) {
  const i = BAND_TAGS.indexOf(tag);
  return i < 0 || i === BAND_TAGS.length - 1 ? null : BAND_TAGS[i + 1];
}

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

console.log(`\nband-tags: ${n} checks passed.`);
