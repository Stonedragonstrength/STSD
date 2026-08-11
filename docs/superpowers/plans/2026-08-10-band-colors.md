# Band Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the coach prescribe which of five resistance bands a lift uses, rendered as a chip in the band's own color, with the five colors behaving as rungs on one ladder rather than as five separate exercises.

**Architecture:** A new single-select `Band` modifier group. The modifier picker, the chip renderer, the color system and single-select behaviour are all already generic, so the group itself is a data edit. `Band` is deliberately kept **out** of `LIFT_ID_GROUPS`, so an athlete's banded work stays one climbing history with the band as its rung.

**Tech Stack:** Vanilla JS (one IIFE in `app.js`), plain-Node test scripts (no framework, no install).

## Global Constraints

- **No build step.** Vanilla HTML/CSS/JS. No bundler, framework, or dependency.
- **The ladder is yellow → red → purple → green → grey**, lightest to heaviest. The tag order in `EXERCISE_MODIFIERS` *is* the ladder; nothing else stores it.
- **`Band` must NOT be added to `LIFT_ID_GROUPS`.** This is the load-bearing decision — adding it fragments every athlete's banded history into five unrelated chains. Task 1 ships a test whose whole job is to fail if someone does.
- **`NAME_GROUP_ORDER` is not touched either.** The band is a load, not part of the lift's name.
- **The existing `Band` Equipment tag stays.** Existing programs use it; it still means "a band, unspecified". Nothing is migrated.
- **Tag names are the bare color words** — `Yellow`, `Red`, `Purple`, `Green`, `Grey`. Grey, not Gray.
- **The PR board is deliberately untouched.** A band-only PR keeps reading `— × 15`.
- **No migration.** Modifiers ride `weeks`, which already syncs as jsonb.
- **Tests are plain Node scripts.** `node tests/x.test.js`, exit non-zero on failure, logic copied from `app.js` per `tests/README.md`.

---

### Task 1: The Band group

The picker (`app.js:2694`), the chip renderer (`app.js:2600`), the color system (`tagColor`) and single-select (`if (!multi)` at `app.js:2733`) are all fully generic. Adding the group is a data edit; no UI code is written in this task.

**Files:**
- Modify: `app.js:945` (`EXERCISE_MODIFIERS`), `app.js:966` (`TAG_LONG`), `app.js:1389` (`TAG_COLORS`)
- Test: `tests/band-tags.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - A `Band` group in `EXERCISE_MODIFIERS` with tags `["Yellow", "Red", "Purple", "Green", "Grey"]`, no `multi` flag.
  - `TAG_COLORS` entries for all five.
  - `TAG_LONG` entries expanding each to `"<Color> Band"`.

- [ ] **Step 1: Write the failing test**

Create `tests/band-tags.test.js`:

```js
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

console.log(`\nband-tags: ${n} checks passed.`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/band-tags.test.js`
Expected: FAIL on the first check — `there is a Band group`.

- [ ] **Step 3: Add the group**

In `app.js`, in `EXERCISE_MODIFIERS` (`app.js:945`), insert directly after the `Equipment` line so the chips read `[BB] [Red]`:

```js
    { group: "Equipment",   tags: ["BB", "DB", "DBs", "KB", "EZ Bar", "Cable", "Rope", "Wide Bar", "Band", "Machine", "Landmine", "Slider", "Bench", "Bench Assisted"], multi: true },
    // Which resistance band, lightest to heaviest. THIS ORDER IS THE LADDER —
    // nothing else stores it, so reordering these re-prescribes every banded
    // lift on the roster.
    //
    // Single-select on purpose (no `multi`): one band at a time, and picking a
    // second replaces the first, which also makes the picker row a one-tap way
    // to move somebody up a rung.
    //
    // Deliberately NOT in LIFT_ID_GROUPS: a band is the load, not the implement.
    // See tests/band-tags.test.js, which exists to stop that from being changed
    // by accident.
    { group: "Band",        tags: ["Yellow", "Red", "Purple", "Green", "Grey"] },
```

- [ ] **Step 4: Give them their colors**

In `TAG_COLORS` (`app.js:1389`), before the closing brace and after the `"Timed"` entry:

```js
    "Timed":     { color: "#f59e0b", bg: "rgba(245,158,11,0.18)"  },
    // The bands wear their own colors — this is the one place in this table
    // where the color IS the information, so no two may match. Mid-weight
    // shades rather than pure hues, because these have to stay legible on the
    // light theme as well as the nine dark ones.
    "Yellow":    { color: "#eab308", bg: "rgba(234,179,8,0.18)"   },
    "Red":       { color: "#ef4444", bg: "rgba(239,68,68,0.18)"   },
    "Purple":    { color: "#a855f7", bg: "rgba(168,85,247,0.18)"  },
    "Green":     { color: "#22c55e", bg: "rgba(34,197,94,0.18)"   },
    "Grey":      { color: "#6b7280", bg: "rgba(107,114,128,0.18)" },
```

- [ ] **Step 5: Give them readable names**

In `TAG_LONG` (`app.js:966`), before the closing brace:

```js
    "4S": "4s Hold", "5S": "5s Hold",
    // A chip that is literally green and reads "Green" needs no decoding, but
    // the athlete reads a sentence in several places, and "Green Bench Press"
    // is not one.
    "Yellow": "Yellow Band", "Red": "Red Band", "Purple": "Purple Band",
    "Green": "Green Band", "Grey": "Grey Band",
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node tests/band-tags.test.js`
Expected: PASS, `band-tags: 11 checks passed.`

- [ ] **Step 7: Run the whole suite for regressions**

Five new tags enter `groupForTag`, `orderedModifiers` and `liftKey`'s input space.

Run: `for f in tests/*.test.js; do node "$f" >/dev/null || echo "FAIL $f"; done; echo done`
Expected: `done` with no FAIL lines. `pull-from-day.test.js` covers `modifiers` copying specifically — it must still pass.

- [ ] **Step 8: Add the test to the tests README**

```markdown
| `band-tags.test.js` | the five band colors, and their absence from lift identity | The band is the load, not the implement. A barbell squat really is a different lift from a dumbbell squat, which is what `LIFT_ID_GROUPS` is for; a green band is not a different lift from a grey one, any more than 225 is a different lift from 315. Adding `"Band"` to `LIFT_ID_GROUPS` would shatter every athlete's banded history into five unrelated short chains with nothing climbing between them — silently, and only visible months later as a graph that never goes anywhere. Most of this file exists to fail loudly if that happens. Also pins the tag order (which *is* the ladder — nothing else stores it), single-select, one group per color, and that no two bands share a hex, since here the color is the information. |
```

- [ ] **Step 9: Commit**

```bash
git add app.js tests/band-tags.test.js tests/README.md
git commit -m "Five bands, as rungs rather than as five different lifts

The picker, the chip renderer, the color system and single-select are all
already generic, so the group itself is a data edit and no UI code is written
here.

Band stays out of LIFT_ID_GROUPS on purpose. That list is for implements — a
barbell squat really is a different lift from a dumbbell squat. A green band is
not a different lift from a grey one; for a band-only exercise the band IS the
load, and nobody forks a lift's identity between 225 and 315. Putting it in
would fragment every athlete's banded history into five chains that never
climb, and it would fail silently. Most of the new test exists to stop that.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The next band, one tap, while programming

The picker row is already the ladder in order, so with the picker open the next band is one tap. This adds the same move **without** opening the picker, next to the chip it advances.

**Files:**
- Modify: `app.js:2600` (`renderModChips`)
- Modify: `styles.css`
- Modify: `index.html` (cache-bust)

**Interfaces:**
- Consumes: the `Band` group from Task 1.
- Produces:
  - `BAND_TAGS` — the ladder array, read from the group so it can never drift from it.
  - `bandOf(ex)` → the exercise's band tag, or `null`.
  - `nextBandUp(tag)` → the next tag heavier, or `null` at grey / unknown.

- [ ] **Step 1: Write the failing test**

Append to `tests/band-tags.test.js`, before the final `console.log`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/band-tags.test.js`
Expected: FAIL — `bandOf is not fooled by the old unspecified Band equipment tag` passes trivially, but the run fails earlier if `BAND_TAGS` is empty. If all four new checks pass immediately, that is expected: they test copied logic. The real gate is Step 5's app behaviour.

- [ ] **Step 3: Add the helpers to `app.js`**

Immediately after `groupForTag` (`app.js:1434`):

```js
  // ── Bands ──────────────────────────────────────────────────────────────
  // Read out of the group rather than written twice, so the ladder and the
  // picker row can never disagree about what comes next.
  const BAND_TAGS = (EXERCISE_MODIFIERS.find((g) => g.group === "Band") || {}).tags || [];
  // The exercise's band, if it has one. Note this deliberately does NOT match
  // the old "Band" Equipment tag: that means "a band, unspecified", predates the
  // colors, and is not a rung on anything.
  function bandOf(ex) {
    return (ex?.modifiers || []).find((t) => BAND_TAGS.includes(t)) || null;
  }
  // One rung heavier. Null at grey, and null for anything not on the ladder.
  function nextBandUp(tag) {
    const i = BAND_TAGS.indexOf(tag);
    return i < 0 || i === BAND_TAGS.length - 1 ? null : BAND_TAGS[i + 1];
  }
```

- [ ] **Step 4: Add the control beside the band chip**

In `renderModChips` (`app.js:2621`), inside the `orderedModifiers(ex).forEach` loop, after the existing `container.appendChild(chip)` for a tag, add the step-up button.

`renderModChips` has only two call sites (`app.js:2756`/`2757` from inside the picker, and `app.js:12775`/`12789` from the coach's exercise editor) and both pass a live `openPicker` — they are the same two chip containers, re-rendered. The athlete's chips are built by separate inline renderers (`app.js:8635`, `app.js:12385`) that never call this function, so they cannot pick up the control. The `openPicker` guard is belt-and-braces against a future read-only caller:

`saveEditor()` (`app.js:194`) is module-level and already in scope here — it routes to `_editorSave` or `saveTrainer`, which is what every other edit in this file uses.

```js
      // One tap heavier, without opening the picker. Programming a band block
      // is mostly this move, and the picker is two taps and a hunt.
      if (openPicker && BAND_TAGS.includes(tag)) {
        const up = nextBandUp(tag);
        if (up) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "mod-chip-up";
          btn.textContent = "↑";
          btn.title = `Step up to the ${up.toLowerCase()} band`;
          btn.setAttribute("aria-label", `Step up to the ${up.toLowerCase()} band`);
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            ex.modifiers = (ex.modifiers || []).filter((m) => !BAND_TAGS.includes(m));
            ex.modifiers.push(up);
            saveEditor();
            renderModChips(container, ex, position, openPicker);
          });
          container.appendChild(btn);
        }
      }
```

- [ ] **Step 5: Style it**

In `styles.css`, beside the `.mod-chip` rules:

```css
.mod-chip-up {
  margin-left: -0.15em;
  padding: 0 0.35em;
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--muted);
  background: none;
  border: 1px solid var(--line);
  border-radius: 0.4em;
  cursor: pointer;
}
.mod-chip-up:hover { color: var(--text); border-color: rgba(var(--primary-rgb), 0.5); }
```

- [ ] **Step 6: Bump the cache-bust**

In `index.html`, change both `?v=lvl1` to `?v=band1` (line 17 `styles.css`, line 1595 `app.js`). If the training-levels plan has not shipped, the current value is `anat6` — change that instead.

- [ ] **Step 7: Verify in the running app**

```bash
python3 -m http.server 5190 --directory . &
```

As coach, open an athlete, open a day, and on an exercise:
1. Open the tag picker — a **Band** row shows five buttons in ladder order, each in its own color.
2. Tap **Purple**. The chip appears in purple, after the implement chip.
3. Tap another color, e.g. **Green** — purple comes off, green goes on. One band at a time.
4. Close the picker. Tap the **↑** beside the green chip → it becomes **Grey**, in place, without the picker.
5. The **↑** is gone on grey.
6. Reload → the band survived.
7. Open the same exercise on the athlete's side → the colored chip renders, with **no ↑**. The athlete's chips come from a different renderer (`app.js:8635`), so confirm the *color* survived that path — a band that reads slate grey there means the tag reached the athlete but `TAG_COLORS` did not.

- [ ] **Step 8: Verify the colors on the light theme**

Switch to the light theme and re-check the chips. **Yellow and grey are the two at risk** — yellow against a pale card, grey against a low-contrast border. All five must be readable and tellable apart. If one fails, darken that hex in `TAG_COLORS`; do not add a theme-conditional rule, since these are literal colors by design and must not swing per theme.

Then check one dark theme other than the default, to confirm nothing got tuned into invisibility the other way.

- [ ] **Step 9: Commit**

```bash
git add app.js styles.css index.html tests/band-tags.test.js
git commit -m "Step a lift up a band without opening the picker

The picker row is already the ladder in order, so with it open the next band was
always one tap. This is the same move from the card, next to the chip it
advances, because programming a band block is mostly this and the picker is two
taps and a hunt.

The step-up only renders where the chips are editable, so the athlete's card
shows the band and cannot change it. BAND_TAGS is read out of the group rather
than written a second time, so the ladder and the picker can never disagree
about what comes next.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Say when the next band is earned — SEPARABLE

**This task is optional and can be deferred without touching anything above.** Tasks 1–2 deliver the whole stated request; this adds the app telling you *when* a step-up is due, and it is the only part that touches the progression engine — the most load-bearing code in the file. Ship 1–2 first and run them for a couple of weeks before deciding.

The engine already computes targets and never mutates the exercise. This follows that exactly: it computes a *signal*, and the coach still taps the ↑.

**Files:**
- Modify: `app.js:1605` (`progressionRule`), `app.js:1752` (`progressionResult`)
- Test: `tests/band-tags.test.js`

**Interfaces:**
- Consumes: `bandOf` (Task 2).
- Produces: `progressionResult(...)` gains `atCap: boolean`, and `progressionRule(ex)` returns `band: true` for a band-only lift.

- [ ] **Step 1: Understand what is missing first**

A band-only exercise has an empty `currentWeight`, so `progressionRule()` bails at `if (!isFinite(base)) return null` (`app.js:1635`) and the lift has **no progression at all** today. Confirm that before changing anything:

Run: `node -e "const s=require('fs').readFileSync('app.js','utf8'); console.log(/const base = parseFloat\(ex\.currentWeight\);/.test(s) && /if \(!isFinite\(base\)\) return null;/.test(s))"`
Expected: `true`.

- [ ] **Step 2: Write the failing test**

Append to `tests/band-tags.test.js`, before the final `console.log`:

```js
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node tests/band-tags.test.js`
Expected: FAIL on `a band-only lift gets a rep ladder where today it gets nothing` — `bandOf` is defined in the test but `bandOnlyRule` returns null because the fixture has no band on the ladder, or passes trivially. Read the failure before proceeding; if all five pass immediately the copied logic is right and the gate is Step 6.

- [ ] **Step 4: Give a band-only lift a rep ladder**

In `progressionRule()` (`app.js:1634`), immediately **before** `const base = parseFloat(ex.currentWeight);`:

```js
    // A band-only lift has no number to climb — the band is the load. It gets
    // the same rep ladder bodyweight gets without an increment: reps climb to
    // the ceiling and hold there, and the card offers the next band at the top.
    // Without this it bails on the parseFloat below and has no progression at
    // all, which is what it has had since bands existed.
    if (!String(ex.currentWeight || "").trim() && bandOf(ex)) {
      return { floor, ceil, inc: 0, reset: floor, band: true, repsOnly: true, step, timed, ...layers };
    }
    const base = parseFloat(ex.currentWeight);
```

- [ ] **Step 5: Report the cap**

In `progressionResult()` (`app.js:1765`), beside `justDeloaded`:

```js
      justDeloaded: st.last === "deload",
      // Topped out with nothing left to spend. For a band-only lift this is
      // "they have earned the next band" — the card offers it, and the coach
      // still takes it. The engine computes targets; it does not re-prescribe.
      atCap: st.last === "cap",
```

`st.last === "cap"` is already set at `app.js:1740` for `rule.repsOnly`, which the band rule sets, so no change is needed in `stepProgression`.

- [ ] **Step 6: Run the tests**

Run: `node tests/band-tags.test.js && for f in tests/*.test.js; do node "$f" >/dev/null || echo "FAIL $f"; done; echo done`
Expected: band-tags passes, then `done` with no FAIL lines. **`pull-from-day.test.js` and any progression-touching test must be clean** — this task changed the engine's entry conditions.

- [ ] **Step 7: Verify in the running app**

Build a band-only exercise: no weight, `currentReps` 10, progression ceiling 15, band **Purple**. Log sets at 15 reps as the athlete until the target tops out, then on the coach's card confirm it reads that the next band is earned, and that tapping ↑ moves it to Green and resets the reps.

Then repeat on **Grey** and confirm nothing is offered — the card must not promise a rung that does not exist.

Then confirm a **bar+band** lift (225 lb, Red) still climbs its weight exactly as before and is untouched by any of this.

- [ ] **Step 8: Commit**

```bash
git add app.js tests/band-tags.test.js
git commit -m "A band-only lift can top out, and say so

It had no progression at all: with an empty weight field, progressionRule bailed
at the parseFloat and returned null, so the ladder never ran. It gets the rep
ladder bodyweight gets — reps climb to the ceiling and hold — and the result now
reports atCap, which for a band-only lift means the next band is earned.

The engine still does not take it. A band change is a prescription, and
prescriptions are the coach's; this only says when.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Ship it

- [ ] **Step 1: Full suite**

Run: `for f in tests/*.test.js; do node "$f" >/dev/null || echo "FAIL $f"; done; echo done`
Expected: `done`, no FAIL lines.

- [ ] **Step 2: Confirm the cache-bust actually moved**

Run: `grep -n '?v=' index.html | head -6`
Expected: `styles.css` and `app.js` both on the new token. An installed PWA caches assets cache-first keyed by full URL, so an unbumped `?v=` means nobody gets this.

- [ ] **Step 3: Push**

```bash
git push origin main
```

No migration and no Edge Function, so `git push` is the whole deploy for this one.
