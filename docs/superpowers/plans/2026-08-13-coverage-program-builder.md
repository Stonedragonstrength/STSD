# Coverage-Driven Program Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the coverage map backwards so it writes a week of training instead of only grading one, choosing movements the athlete's gear can actually perform.

**Architecture:** Three layers, landing in order. First a data layer that says what equipment each exercise needs and what each athlete owns. Then a pure engine that seats anchor compounds by coverage score and fills the remaining deficit greedily against the athlete's own bands. Then a coach-facing surface that previews the result before anything is written into the program.

**Tech Stack:** Vanilla JS, no build step. One IIFE in `app.js`, one vendored data file, Node's built-in `assert` for tests, Supabase for sync.

**Spec:** `docs/superpowers/specs/2026-08-13-coverage-program-builder-design.md`

## Global Constraints

- **No framework, no bundler, no build step.** Plain `<script>` tags, one IIFE in `app.js`.
- **Cache-busting is manual.** Every changed asset gets a new `?v=` tag in `index.html`. `sw.js` caches versioned assets cache-first by full URL, so an unbumped tag ships nothing.
- **No em-dashes in user-facing copy.** Applies to every string the coach or athlete reads.
- **`escapeHtml()` whenever user content goes into `innerHTML`.**
- **Tests are plain Node scripts.** `node tests/<name>.test.js`, printing `  ok  <label>` lines and a count, non-zero exit on failure via a thrown `assert`. No test framework.
- **Tests copy logic, read data.** Per the convention at the top of `tests/muscle-coverage.test.js`: extract real tables out of `app.js` with `extractLiteral()` so assertions pin real values; copy the functions under test.
- **Unset means permissive.** `client.equipment` empty or absent means every piece of gear is available, so no existing athlete changes behaviour.
- **Migrate production before shipping code that writes a new column.** `athleteToRow()` sends every field on every upsert; a missing column fails the whole write.
- **The builder is coach-side and athlete-mode only.** It reads bands and gear off a real athlete, so it must not appear in program-template mode (`_programEditorId` set).

---

## File Structure

| File | Responsibility |
|---|---|
| `exercise-equipment.js` | **New.** `window.EXERCISE_EQUIPMENT`, the realization map. Data only, no logic. Vendored like `exercise-demos.js`. |
| `app.js` | `GEAR` vocabulary, gear helpers, the builder engine, the Profile picker fold, the week-strip button and the build sheet. |
| `cloud.js` | `equipment` in `athleteToRow()` / `rowToAthlete()`. |
| `index.html` | `<script>` tag for the new file, `#cprof-gear-host` div. |
| `styles.css` | Gear grid, build sheet, preview. |
| `supabase/migrations/20260814090000_athlete_equipment.sql` | **New.** The `equipment` column. |
| `tests/exercise-equipment.test.js` | **New.** Map completeness and validity. |
| `tests/athlete-equipment-plumbing.test.js` | **New.** The four-place plumbing check. |
| `tests/program-builder.test.js` | **New.** Engine property assertions. |

---

# Phase 1: The equipment layer

Independently shippable. Ships and is verified with no builder in existence.

---

### Task 1: The gear vocabulary and the realization map

**Files:**
- Create: `exercise-equipment.js`
- Modify: `app.js` (add `GEAR` near `TRAINING_PHASES`, around line 10395)
- Modify: `index.html:1622` (script tag)
- Test: `tests/exercise-equipment.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `window.EXERCISE_EQUIPMENT` — object keyed by `exKey()`-normalised name. Each value is an array of realizations in preference order: `{ gear: string[], tag: string|null }`. `gear` holds `GEAR` ids; `tag` is an `EXERCISE_MODIFIERS` "Equipment" tag or `null` when the movement needs no modifier.
  - `const GEAR` in `app.js` — array of `{ id, label, icon }`, 17 entries, `icon` being the existing `eq:` token.

- [ ] **Step 1: Write the failing test**

Create `tests/exercise-equipment.test.js`:

```js
// The realization map is the load-bearing data behind the program builder:
// it is what lets a missing barbell yield a dumbbell bench press instead of
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

check("bodyweight movements are reachable with no gear at all", () => {
  ["push-up", "pull-up", "plank"].forEach((k) => {
    assert.ok(MAP[k], `${k} should be in the map`);
    const free = MAP[k].some((r) => !r.gear.length);
    const named = MAP[k].some((r) => r.gear.length);
    assert.ok(free || named, `${k}: needs at least one realization`);
  });
  assert.ok(MAP["push-up"].some((r) => !r.gear.length),
    "a push-up must be performable with nothing");
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
});

check("bench press can be done with dumbbells", () => {
  // Nathan's explicit ask: the movement survives a missing barbell.
  const db = MAP["bench press"].find((r) => r.gear.includes("dumbbell"));
  assert.ok(db, "bench press needs a dumbbell realization");
  assert.ok(db.gear.includes("bench"), "a dumbbell bench press still needs the bench");
  assert.strictEqual(db.tag, "DBs", "a two-dumbbell press is DBs, not DB");
});

console.log(`\nexercise-equipment: ${n} checks passed.`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/exercise-equipment.test.js`
Expected: FAIL, `ENOENT` on `exercise-equipment.js`.

- [ ] **Step 3: Add the `GEAR` vocabulary to app.js**

Insert immediately after the `TRAINING_PHASES` block (after `phaseMinRank`, around line 10395):

```js
  // ── Gear ──
  // What a gym has, as opposed to how a single exercise is performed (that is
  // an EXERCISE_MODIFIERS "Equipment" tag). The two vocabularies are bridged by
  // EXERCISE_EQUIPMENT: a realization names the gear it needs and the tag to
  // stamp. Ids match the eq: icon tokens so the picker needs no new artwork.
  const GEAR = [
    { id: "barbell",   label: "Barbell",      icon: "eq:barbell" },
    { id: "plate",     label: "Plates",       icon: "eq:plate" },
    { id: "dumbbell",  label: "Dumbbells",    icon: "eq:dumbbell" },
    { id: "kettlebell",label: "Kettlebells",  icon: "eq:kettlebell" },
    { id: "trapbar",   label: "Trap bar",     icon: "eq:trapbar" },
    { id: "rack",      label: "Rack",         icon: "eq:rack" },
    { id: "bench",     label: "Bench",        icon: "eq:bench" },
    { id: "cable",     label: "Cable machine",icon: "eq:cable" },
    { id: "pullup",    label: "Pull-up bar",  icon: "eq:pullup" },
    { id: "dipbars",   label: "Dip bars",     icon: "eq:dipbars" },
    { id: "band",      label: "Bands",        icon: "eq:band" },
    { id: "medball",   label: "Med ball",     icon: "eq:medball" },
    { id: "box",       label: "Box",          icon: "eq:box" },
    { id: "sled",      label: "Sled",         icon: "eq:sled" },
    { id: "rower",     label: "Rower",        icon: "eq:rower" },
    { id: "treadmill", label: "Treadmill",    icon: "eq:treadmill" },
    { id: "jumprope",  label: "Jump rope",    icon: "eq:jumprope" },
  ];
  const GEAR_BY_ID = Object.fromEntries(GEAR.map((g) => [g.id, g]));
```

- [ ] **Step 4: Create `exercise-equipment.js`**

Write the file with this header and schema, then one entry for every key the
completeness test reports as missing. Run the test after each batch of ~40 and
work the `missing` list down to empty; the test names exactly what is left.

```js
// What each exercise NEEDS, and how to write it once you know what is on hand.
//
// Exercise names do not say what they require: "Back Squat" mentions neither
// the barbell nor the rack, and only 16 of the 224 library names name any gear
// at all. So this is written by hand rather than sniffed from the name, and it
// is the reason a missing barbell yields a dumbbell bench press instead of a
// hole in the program.
//
// Each value is a list of REALIZATIONS in preference order:
//   gear — GEAR ids that must all be present (see app.js)
//   tag  — the EXERCISE_MODIFIERS "Equipment" tag to stamp on the written
//          exercise, or null when the movement needs no modifier
//
// The builder takes the first realization the athlete's gear satisfies. Order
// matters: put the version you would actually program first.
//
// Vendored like exercise-demos.js. Has its OWN ?v= tag in index.html.
window.EXERCISE_EQUIPMENT = {
  "back squat":  [ { gear: ["barbell", "rack"], tag: "BB" } ],
  "bench press": [ { gear: ["barbell", "bench"],  tag: "BB" },
                   { gear: ["dumbbell", "bench"], tag: "DBs" },
                   { gear: ["cable"],             tag: "Machine" } ],
  "push-up":     [ { gear: [], tag: null } ],
  "pull-up":     [ { gear: ["pullup"], tag: null } ],
  "plank":       [ { gear: [], tag: null } ],
  // …one entry per pooled exercise; the test enumerates what is missing.
};
```

- [ ] **Step 5: Wire the script tag**

In `index.html`, add after the `exercise-demos.js` line (currently line 1622):

```html
  <script src="exercise-equipment.js?v=eq1"></script>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node tests/exercise-equipment.test.js`
Expected: PASS, 7 checks.

- [ ] **Step 7: Commit**

```bash
git add exercise-equipment.js app.js index.html tests/exercise-equipment.test.js
git commit -m "What each exercise needs, written by hand because names do not say"
```

---

### Task 2: `client.equipment` reaches storage and the athlete's device

**Files:**
- Modify: `app.js` — `makeClient()` (~line 822, beside `trainingPhase`), `buildProgramFromAthlete()` (~line 3921)
- Modify: `cloud.js` — `athleteToRow()` (~line 98), `rowToAthlete()` (~line 132)
- Create: `supabase/migrations/20260814090000_athlete_equipment.sql`
- Test: `tests/athlete-equipment-plumbing.test.js`

**Interfaces:**
- Consumes: `GEAR` from Task 1.
- Produces: `client.equipment` — `string[]` of `GEAR` ids. Empty means everything available.

- [ ] **Step 1: Write the failing test**

Create `tests/athlete-equipment-plumbing.test.js`:

```js
// equipment has to reach the same four places trainingLevel and trainingPhase
// do, and misses the same way: silently. See training-phase-plumbing.test.js
// for the full reasoning. (4) is the one that bites, because
// buildProgramFromAthlete is an allowlist rather than a spread.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const cloudSrc = fs.readFileSync(path.join(ROOT, "cloud.js"), "utf8");

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

let n = 0;
const check = (label, fn) => { fn(); n++; console.log("  ok  " + label); };

check("makeClient seeds equipment", () => {
  assert.ok(/equipment\s*:/.test(fnBody(appSrc, "function makeClient(")));
});

check("buildProgramFromAthlete carries equipment to the athlete's device", () => {
  assert.ok(/equipment\s*:/.test(fnBody(appSrc, "function buildProgramFromAthlete(")),
    "an allowlist — without this line the athlete's device has no gear list");
});

check("athleteToRow writes equipment", () => {
  assert.ok(/equipment\s*:/.test(fnBody(cloudSrc, "function athleteToRow(")));
});

check("rowToAthlete reads equipment back", () => {
  assert.ok(/equipment\s*:\s*r\.equipment/.test(fnBody(cloudSrc, "function rowToAthlete(")),
    "rowToAthlete must map equipment back");
});

check("the migration exists and stays nullable", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20260814090000_athlete_equipment.sql"), "utf8");
  assert.ok(/add column if not exists equipment/.test(sql), "adds the column");
  assert.ok(/jsonb/.test(sql), "stored as jsonb, like the other list columns");
  assert.ok(!/not null/i.test(sql),
    "must stay nullable — NULL is the storage form of 'everything available'");
});

console.log(`\nathlete-equipment-plumbing: ${n} checks passed.`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/athlete-equipment-plumbing.test.js`
Expected: FAIL on the first check.

- [ ] **Step 3: Seed it in `makeClient()`**

In `app.js`, immediately after the `trainingPhase: "",` line:

```js
      // What they have to train with. Empty means everything is available, so
      // an athlete whose gear was never filled in is unrestricted rather than
      // unable to do anything. See GEAR and EXERCISE_EQUIPMENT.
      equipment: [],
```

- [ ] **Step 4: Carry it in `buildProgramFromAthlete()`**

After the `trainingPhase: athlete.trainingPhase || "",` line:

```js
        equipment: athlete.equipment || [],
```

- [ ] **Step 5: Map it both ways in `cloud.js`**

In `athleteToRow()`, after `training_phase`:

```js
      equipment: c.equipment || [],
```

In `rowToAthlete()`, after `trainingPhase`:

```js
      equipment: r.equipment || [],
```

- [ ] **Step 6: Write the migration**

Create `supabase/migrations/20260814090000_athlete_equipment.sql`:

```sql
-- What this athlete has to train with, as a list of GEAR ids.
--
-- Feeds the program builder: exercise names do not say what they require, so
-- EXERCISE_EQUIPMENT maps each movement to the ways it can be performed, and
-- this column says which of those ways are open to this athlete.
--
-- jsonb rather than text[], matching how every other list on this table is
-- stored (weeks, coach_prs, trials) so the cloud mapping stays uniform.
--
-- Nullable, and an empty list means the same thing as NULL: everything is
-- available. An athlete whose gear was never filled in must be unrestricted,
-- never unable to be programmed for.
alter table public.athletes
  add column if not exists equipment jsonb;
```

- [ ] **Step 7: Apply the migration to production, then verify**

```bash
supabase db push --include-all
supabase db query --linked "select column_name, data_type, is_nullable from information_schema.columns where table_name='athletes' and column_name='equipment'"
```
Expected: one row, `jsonb`, `YES`.

This runs before the code ships. `athleteToRow()` now sends `equipment` on every upsert, so without the column every athlete write fails.

- [ ] **Step 8: Run the test to verify it passes**

Run: `node tests/athlete-equipment-plumbing.test.js`
Expected: PASS, 5 checks.

- [ ] **Step 9: Commit**

```bash
git add app.js cloud.js supabase/migrations/20260814090000_athlete_equipment.sql tests/athlete-equipment-plumbing.test.js
git commit -m "An athlete carries the gear they have to train with"
```

---

### Task 3: The gear picker on the coach's Profile

**Files:**
- Modify: `app.js` — fold builder beside `trainingPhaseFoldHtml` (~line 25990), renderer beside `renderCoachTrainingPhaseFold` (~line 6540), call site (~line 6429)
- Modify: `index.html` — `#cprof-gear-host` after `#cprof-phase-host`
- Modify: `styles.css` — the grid
- Modify: `index.html` — bump `app.js`, `styles.css` tags

**Interfaces:**
- Consumes: `GEAR`, `GEAR_BY_ID`, `client.equipment`.
- Produces: `gearFoldHtml(cur)`, `wireGearFold(host, onToggle)`, `renderCoachGearFold(c)`.

- [ ] **Step 1: Add the fold builder**

In `app.js`, after `wireTrainingPhaseFold`:

```js
  // What they have to train with. A tap grid rather than a list: seventeen
  // checkboxes is a form, seventeen icons is a glance. Empty means everything,
  // so the summary line says so rather than reading as "nothing set up".
  function gearSub(cur) {
    const n = (cur || []).length;
    if (!n) return "Everything available";
    return `${n} of ${GEAR.length} selected`;
  }
  function gearFoldHtml(cur, { id = "cprof-fold-gear", name = "cprof-gear-pick" } = {}) {
    const on = new Set(cur || []);
    return `
      <details class="pref-fold" id="${id}">
        <summary>
          <span class="pref-fold-ico">🏋️</span>
          <span class="pref-fold-text">
            <span class="pref-fold-title">Their equipment</span>
            <span class="pref-fold-sub">${escapeHtml(gearSub(cur))}</span>
          </span>
          <span class="pref-fold-chev">▸</span>
        </summary>
        <p class="pref-foot">What they can actually train with. Build the week only picks movements this gear can perform, so a missing barbell gets them a dumbbell bench press instead of nothing. Leave it empty and everything is treated as available.</p>
        <div class="gear-grid" data-gear-pick="${name}">
          ${GEAR.map((g) => `
            <button type="button" class="gear-opt${on.has(g.id) ? " on" : ""}" data-gear="${g.id}">
              <span class="gear-opt-ico">${dayIconHtml(g.icon)}</span>
              <span class="gear-opt-lbl">${escapeHtml(g.label)}</span>
            </button>`).join("")}
        </div>
      </details>`;
  }
  function wireGearFold(host, onToggle) {
    host.querySelectorAll("[data-gear]").forEach((b) =>
      b.addEventListener("click", () => onToggle(b.dataset.gear)));
  }
```

- [ ] **Step 2: Add the coach renderer**

After `renderCoachTrainingPhaseFold`:

```js
  // Repaints in place, keeping the fold open under the finger that tapped it,
  // exactly like the phase fold above.
  function renderCoachGearFold(c) {
    const host = $("#cprof-gear-host");
    if (!host || !c) return;
    const wasOpen = host.querySelector("details")?.open;
    host.innerHTML = gearFoldHtml(c.equipment || []);
    if (wasOpen) host.querySelector("details").open = true;
    wireGearFold(host, (id) => {
      if (!GEAR_BY_ID[id]) return;
      const have = new Set(c.equipment || []);
      if (have.has(id)) have.delete(id); else have.add(id);
      // Stored in GEAR order so the value is stable and diffs stay readable.
      c.equipment = GEAR.filter((g) => have.has(g.id)).map((g) => g.id);
      saveTrainer(); // debounce-pushes the athlete row; equipment rides along
      renderCoachGearFold(c);
    });
  }
```

- [ ] **Step 3: Call it**

Beside the existing fold calls (~line 6429), after `renderCoachTrainingPhaseFold(c);`:

```js
    renderCoachGearFold(c);
```

- [ ] **Step 4: Add the host div**

In `index.html`, after the `#cprof-phase-host` div:

```html
          <!-- Their equipment, rendered by renderCoachGearFold() -->
          <div id="cprof-gear-host"></div>
```

- [ ] **Step 5: Style the grid**

Append to `styles.css` near the `.cyc-share-pick` rules:

```css
/* Seventeen pieces of gear as a tap grid. auto-fill rather than a fixed column
   count so it reflows from a phone to the coach's 1200px spread without a
   media query. minmax(0,…) because a bare 1fr clips its own content. */
.gear-grid {
  display: grid; gap: 0.4rem; margin-top: 0.6rem;
  grid-template-columns: repeat(auto-fill, minmax(min(7.5rem, 100%), 1fr));
}
.gear-opt {
  display: flex; align-items: center; gap: 0.5em; min-width: 0;
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--muted); font: inherit; font-size: 0.78rem;
  padding: 0.5em 0.6em; border-radius: var(--radius); cursor: pointer;
  text-align: left;
}
.gear-opt-lbl { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gear-opt-ico { display: flex; flex: none; }
.gear-opt.on {
  color: var(--primary-bright);
  border-color: rgba(var(--primary-bright-rgb), 0.5);
  background: rgba(var(--primary-rgb), 0.12);
}
```

- [ ] **Step 6: Bump the cache tags**

In `index.html`, set `styles.css?v=gear1` and `app.js?v=gear1`.

- [ ] **Step 7: Verify in the browser**

Start the sandbox per `.claude/skills/verify`, seed a coach with one athlete, open Athletes → the athlete → Profile, and confirm by DOM query rather than screenshot:

```js
const host = document.querySelector("#cprof-gear-host");
host.querySelector("details").open = true;
host.querySelector('[data-gear="barbell"]').click();
({ sub: host.querySelector(".pref-fold-sub").textContent,
   stored: JSON.parse(localStorage.getItem("trainerpro_data_v1")).clients[0].equipment });
```
Expected: `sub` reads "1 of 17 selected", `stored` is `["barbell"]`.

- [ ] **Step 8: Commit**

```bash
git add app.js index.html styles.css
git commit -m "A tap grid for the gear an athlete actually has"
```

---

# Phase 2: The engine

Pure functions. No DOM, no writes, fully testable from Node.

---

### Task 4: Resolving a movement against the gear on hand

**Files:**
- Modify: `app.js` (after `GEAR_BY_ID`)
- Test: `tests/program-builder.test.js` (create)

**Interfaces:**
- Consumes: `GEAR`, `window.EXERCISE_EQUIPMENT`, `exKey()`.
- Produces:
  - `gearSet(client)` → `Set<string>`; a client with no equipment yields a set of every id.
  - `resolveRealization(name, gear)` → `{ gear: string[], tag: string|null }` or `null`. `gear` is a `Set`.

- [ ] **Step 1: Write the failing test**

Create `tests/program-builder.test.js` with the harness plus the first block. Follow `tests/muscle-coverage.test.js`: read tables out of the sources, copy the logic.

```js
// The program builder, asserted by PROPERTY rather than by fixed output —
// rerolling is meant to vary, so pinning an exact week would pin the RNG
// instead of the rules. What must hold every time is asserted here.
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
const EXERCISE_EQUIPMENT = extractLiteral(eqSrc, "window.EXERCISE_EQUIPMENT = {");

// ---- copies of the app.js logic ----
function gearSet(client) {
  const list = (client && client.equipment) || [];
  return new Set(list.length ? list : GEAR.map((g) => g.id));
}
function resolveRealization(name, gear) {
  const rs = EXERCISE_EQUIPMENT[exKey(name)];
  if (!rs) return null;
  return rs.find((r) => r.gear.every((g) => gear.has(g))) || null;
}

let n = 0;
const check = (label, fn) => { fn(); n++; console.log("  ok  " + label); };

check("no equipment set means everything is available", () => {
  assert.strictEqual(gearSet({}).size, GEAR.length, "field absent");
  assert.strictEqual(gearSet({ equipment: [] }).size, GEAR.length, "explicitly empty");
  assert.strictEqual(gearSet(null).size, GEAR.length, "no client at all");
  assert.strictEqual(gearSet({ equipment: ["barbell"] }).size, 1, "a real list restricts");
});

check("a missing barbell yields the dumbbell bench press", () => {
  // Nathan's ask, end to end.
  const full = resolveRealization("Bench Press", gearSet({}));
  assert.strictEqual(full.tag, "BB", "a full gym benches with a barbell");
  const dbOnly = resolveRealization("Bench Press", new Set(["dumbbell", "bench"]));
  assert.ok(dbOnly, "dumbbells and a bench must still bench");
  assert.strictEqual(dbOnly.tag, "DBs");
});

check("a movement with no reachable realization resolves to nothing", () => {
  assert.strictEqual(resolveRealization("Back Squat", new Set(["jumprope"])), null);
  assert.strictEqual(resolveRealization("Zzzz Nonsense Lift", gearSet({})), null,
    "an unmapped name is not a candidate");
});

check("bodyweight resolves with an empty gear set", () => {
  assert.ok(resolveRealization("Push-Up", new Set()), "a push-up needs nothing");
});

console.log(`\nprogram-builder: ${n} checks passed.`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/program-builder.test.js`
Expected: FAIL, `const GEAR = [` not found or the bench assertions fail.

- [ ] **Step 3: Implement in app.js**

After `GEAR_BY_ID`:

```js
  // The gear an athlete can reach. An empty list means everything, so an
  // athlete nobody filled in is unrestricted rather than unable to train.
  function gearSet(client) {
    const list = (client && client.equipment) || [];
    return new Set(list.length ? list : GEAR.map((g) => g.id));
  }
  // How this athlete would perform this movement, or null if they cannot.
  // Realizations are in preference order, so the first satisfiable one is the
  // one to program. Returns the tag to stamp as well as the gear it used.
  function resolveRealization(name, gear) {
    const rs = (window.EXERCISE_EQUIPMENT || {})[exKey(name)];
    if (!rs) return null;
    return rs.find((r) => r.gear.every((g) => gear.has(g))) || null;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/program-builder.test.js`
Expected: PASS, 4 checks.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/program-builder.test.js
git commit -m "How this athlete would perform this movement, or whether they can"
```

---

### Task 5: Scoring a movement by how much body it covers

**Files:**
- Modify: `app.js` (after `resolveRealization`)
- Test: `tests/program-builder.test.js`

**Interfaces:**
- Consumes: `musclesForExercise()`, `ANATOMY_GROUPS`.
- Produces:
  - `coverageScore(name)` → number, the sum of `musclesForExercise()` weights.
  - `POOL` → `string[]`, every distinct pooled exercise name (curated anchors and accessories, plus `EXERCISE_LIBRARY`), built once.
  - `MUSCLE_PATTERN` → `{ [muscleId]: pattern }` from `ANATOMY_GROUPS[].pattern`.

- [ ] **Step 1: Write the failing test**

Append to `tests/program-builder.test.js`, before the final `console.log`. Add the extra literals near the other `extractLiteral` calls at the top:

```js
const ANATOMY_GROUPS = extractLiteral(appSrc, "const ANATOMY_GROUPS = [");
const EXERCISE_LIBRARY = extractLiteral(appSrc, "const EXERCISE_LIBRARY = [");
```

Reuse `musclesForExercise` by copying it from `tests/muscle-coverage.test.js`
verbatim, along with its `curatedEx`, `libCat`, `demoByKey`, `DEMO_MUSCLE_GROUPS`
and `LIB_CAT_GROUPS` setup, then add:

```js
function coverageScore(name) {
  return musclesForExercise(name).reduce((t, h) => t + h.weight, 0);
}
const POOL = (() => {
  const out = new Map();
  ANATOMY_GROUPS.forEach((g) => [...(g.anchors || []), ...(g.accessories || [])]
    .forEach((nm) => { const k = exKey(nm); if (k && !out.has(k)) out.set(k, nm); }));
  EXERCISE_LIBRARY.forEach((c) => (c.ex || [])
    .forEach((nm) => { const k = exKey(nm); if (k && !out.has(k)) out.set(k, nm); }));
  return [...out.values()];
})();

check("a compound outscores an isolation", () => {
  assert.ok(coverageScore("Deadlift") > coverageScore("Leg Extension"),
    "a deadlift covers more body than a leg extension");
  assert.ok(coverageScore("Bench Press") > coverageScore("Cable Fly"));
});

check("an unmapped movement scores zero", () => {
  assert.strictEqual(coverageScore("Zzzz Nonsense Lift"), 0);
});

check("the pool is every curated and library exercise, deduped", () => {
  assert.ok(POOL.length > 250, `pool was ${POOL.length}`);
  assert.strictEqual(new Set(POOL.map(exKey)).size, POOL.length, "no duplicates");
});

check("every pooled exercise can be scored and resolved with full gear", () => {
  // The two data sets have to agree: an exercise the builder may pick must both
  // map to muscles and map to gear, or it silently contributes nothing.
  const full = gearSet({});
  const unresolvable = POOL.filter((nm) => !resolveRealization(nm, full));
  assert.deepStrictEqual(unresolvable, [],
    `unresolvable even with every piece of gear: ${unresolvable.slice(0, 8).join(", ")}`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/program-builder.test.js`
Expected: FAIL on `coverageScore` not defined.

- [ ] **Step 3: Implement in app.js**

```js
  // How much body a movement covers, as one number: the sum of its muscle
  // weights. This is what makes a deadlift outrank a leg extension on merit
  // rather than by a keyword list, and it is the whole basis of anchor choice.
  function coverageScore(name) {
    return musclesForExercise(name).reduce((t, h) => t + h.weight, 0);
  }
  // Everything the builder may pick from: the curated anchors and accessories
  // on the anatomy pages, then the wider library. Curated names come first so
  // ties resolve toward the ones already vouched for. Built once.
  let _builderPool = null;
  function builderPool() {
    if (_builderPool) return _builderPool;
    const out = new Map();
    ANATOMY_GROUPS.forEach((g) => [...(g.anchors || []), ...(g.accessories || [])]
      .forEach((nm) => { const k = exKey(nm); if (k && !out.has(k)) out.set(k, nm); }));
    EXERCISE_LIBRARY.forEach((c) => (c.ex || [])
      .forEach((nm) => { const k = exKey(nm); if (k && !out.has(k)) out.set(k, nm); }));
    _builderPool = [...out.values()];
    return _builderPool;
  }
  const MUSCLE_PATTERN = Object.fromEntries(ANATOMY_GROUPS.map((g) => [g.id, g.pattern]));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/program-builder.test.js`
Expected: PASS, 8 checks.

If the last check fails it means Task 1's map is incomplete for library names.
Add the missing entries to `exercise-equipment.js` rather than weakening the check.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/program-builder.test.js
git commit -m "Score a movement by how much body it covers"
```

---

### Task 6: The skeleton, and dropping patterns the gear cannot reach

**Files:**
- Modify: `app.js` (after `MUSCLE_PATTERN`)
- Test: `tests/program-builder.test.js`

**Interfaces:**
- Consumes: `MUSCLE_PATTERN`, `builderPool()`, `resolveRealization()`, `coverageScore()`.
- Produces:
  - `SPLITS` → `{ [dayCount]: string[][] }`, each day a list of patterns it owns.
  - `patternReachable(pattern, gear)` → boolean.
  - `skeletonFor(dayCount, gear)` → `{ days: string[][], dropped: string[] }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/program-builder.test.js` (copy `SPLITS`, `patternReachable`, `skeletonFor` from Step 3 into the test's logic-copy section first):

```js
check("every day count has a split, and it is that many days", () => {
  for (let d = 1; d <= 6; d++) {
    assert.ok(SPLITS[d], `no split for ${d} days`);
    assert.strictEqual(SPLITS[d].length, d, `${d}-day split has ${SPLITS[d].length} days`);
    SPLITS[d].forEach((day) => assert.ok(day.length, `${d}-day: an empty day`));
  }
});

check("every pattern named in a split is a real muscle pattern", () => {
  const real = new Set(Object.values(MUSCLE_PATTERN));
  Object.values(SPLITS).flat(2).forEach((p) =>
    assert.ok(real.has(p), `"${p}" is in a split but no muscle has that pattern`));
});

check("a full gym reaches every pattern", () => {
  const full = gearSet({});
  new Set(Object.values(MUSCLE_PATTERN)).forEach((p) =>
    assert.ok(patternReachable(p, full), `${p} unreachable with everything`));
});

check("no pulling gear drops the pull pattern and re-picks the split", () => {
  // Nathan's case: four days must stay four useful days.
  const gear = new Set(["dumbbell", "bench", "box"]);
  const sk = skeletonFor(4, gear);
  assert.strictEqual(sk.days.length, 4, "still four days");
  sk.days.forEach((day) => assert.ok(day.length, "no day may come out empty"));
  if (!patternReachable("Pull", gear)) {
    assert.ok(sk.dropped.includes("Pull"), "an unreachable pattern must be reported");
    assert.ok(!sk.days.flat().includes("Pull"), "and must not be seated");
  }
});

check("gear that reaches nothing still returns the right number of days", () => {
  const sk = skeletonFor(3, new Set());
  assert.strictEqual(sk.days.length, 3);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/program-builder.test.js`
Expected: FAIL, `SPLITS is not defined`.

- [ ] **Step 3: Implement in app.js**

```js
  // Which patterns each day owns, per day count. Patterns are the `pattern`
  // field on ANATOMY_GROUPS, so a split is stated in the same vocabulary the
  // muscles are, and a day's job is legible from its own definition.
  const SPLITS = {
    1: [["Squat", "Push", "Pull", "Hinge", "Core"]],
    2: [["Squat", "Push"], ["Hinge", "Pull"]],
    3: [["Push"], ["Pull"], ["Squat", "Hinge"]],
    4: [["Push"], ["Squat"], ["Pull"], ["Hinge"]],
    5: [["Push"], ["Pull"], ["Squat", "Hinge"], ["Push", "Pull"], ["Squat", "Hinge"]],
    6: [["Push"], ["Pull"], ["Squat", "Hinge"], ["Push"], ["Pull"], ["Squat", "Hinge"]],
  };
  // A pattern is reachable when at least one movement serving one of its
  // muscles can actually be performed with the gear on hand.
  function patternReachable(pattern, gear) {
    return builderPool().some((nm) => {
      if (!resolveRealization(nm, gear)) return false;
      return musclesForExercise(nm).some((h) => MUSCLE_PATTERN[h.id] === pattern);
    });
  }
  // The split for a day count, with unreachable patterns removed. A day left
  // with nothing takes the highest-scoring reachable pattern instead, so a gym
  // that cannot pull still yields the full number of useful days rather than
  // empty ones. Dropped patterns are reported, never silently swallowed.
  function skeletonFor(dayCount, gear) {
    const base = SPLITS[dayCount] || SPLITS[3];
    const all = [...new Set(Object.values(MUSCLE_PATTERN))];
    const reachable = all.filter((p) => patternReachable(p, gear));
    const dropped = all.filter((p) => !reachable.includes(p));
    // Rank the reachable patterns by the best movement each can offer, so a
    // re-picked day gets the most productive work available rather than
    // whatever happens to be first.
    const rank = (p) => Math.max(0, ...builderPool()
      .filter((nm) => resolveRealization(nm, gear)
        && musclesForExercise(nm).some((h) => MUSCLE_PATTERN[h.id] === p))
      .map(coverageScore));
    const byRank = [...reachable].sort((a, b) => rank(b) - rank(a));
    const days = base.map((day) => {
      const kept = day.filter((p) => reachable.includes(p));
      return kept.length ? kept : (byRank.length ? [byRank[0]] : []);
    });
    return { days, dropped };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/program-builder.test.js`
Expected: PASS, 13 checks.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/program-builder.test.js
git commit -m "A split that adapts to the gear instead of assuming a full gym"
```

---

### Task 7: Seating the anchors and filling the deficit

**Files:**
- Modify: `app.js` (after `skeletonFor`)
- Test: `tests/program-builder.test.js`

**Interfaces:**
- Consumes: everything from Tasks 4–6, plus `anatomyCoverage()`, `levelBands()`, `phaseOf()`, `ANATOMY_GROUPS`.
- Produces:
  - `DAY_CAP = 7`
  - `seatAnchors(skeletonDays, gear, used)` → `string[][]`, exercise names per day.
  - `weekSetsFor(dayNames, client)` → `{ [muscleId]: number }`, sets per muscle for a proposed week of plain `{name, sets}` rows.
  - `fillDeficit(days, client, gear, used, setsPerEx)` → mutates `days`, returns `{ short: string[] }`.

- [ ] **Step 1: Write the failing test**

Append (copying the new functions into the test's logic section):

```js
check("anchors are the best movement the gear allows, one per pattern", () => {
  const gear = gearSet({});
  const used = new Set();
  const days = seatAnchors([["Squat", "Push"], ["Hinge", "Pull"]], gear, used);
  assert.strictEqual(days.length, 2);
  days.forEach((d) => assert.strictEqual(d.length, 2, "one anchor per pattern"));
  const flat = days.flat();
  assert.strictEqual(new Set(flat.map(exKey)).size, flat.length, "no repeats across days");
  // A seated anchor must beat the average pooled movement by a wide margin.
  flat.forEach((nm) => assert.ok(coverageScore(nm) >= 2,
    `${nm} scored ${coverageScore(nm)}, too small to anchor a day`));
});

check("the filler drives every muscle toward solid", () => {
  const client = { trainingLevel: "beginner" };   // solid 4
  const gear = gearSet({});
  const used = new Set();
  const days = seatAnchors(skeletonFor(4, gear).days, gear, used);
  fillDeficit(days, client, gear, used, 3);
  const sets = weekSetsFor(days, client);
  const short = Object.keys(sets).filter((m) => sets[m] < 4);
  assert.ok(short.length <= 2,
    `4 days with a full gym left ${short.length} muscles under solid: ${short.join(", ")}`);
});

check("days never exceed the cap", () => {
  const gear = gearSet({});
  const used = new Set();
  const days = seatAnchors(skeletonFor(2, gear).days, gear, used);
  fillDeficit(days, { trainingLevel: "advanced" }, gear, used, 3);
  days.forEach((d) => assert.ok(d.length <= 7, `a day held ${d.length} exercises`));
});

check("the filler only ever picks movements the gear can perform", () => {
  const gear = new Set(["dumbbell", "bench"]);
  const used = new Set();
  const days = seatAnchors(skeletonFor(3, gear).days, gear, used);
  fillDeficit(days, {}, gear, used, 3);
  days.flat().forEach((nm) => assert.ok(resolveRealization(nm, gear),
    `${nm} cannot be performed with dumbbells and a bench`));
});

check("no exercise is written twice in a week", () => {
  const gear = gearSet({});
  const used = new Set();
  const days = seatAnchors(skeletonFor(5, gear).days, gear, used);
  fillDeficit(days, {}, gear, used, 3);
  const flat = days.flat().map(exKey);
  assert.strictEqual(new Set(flat).size, flat.length, "a repeat slipped through");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/program-builder.test.js`
Expected: FAIL, `seatAnchors is not defined`.

- [ ] **Step 3: Implement in app.js**

```js
  // Nathan's own sketch ran seven exercises a day. The athlete-added cap is 8,
  // so seven leaves the athlete room to add one of their own.
  const DAY_CAP = 7;

  // The best movement for a pattern that this gear allows and this week has not
  // already used. Curated names sort first within a score tie, because
  // builderPool() puts them first and sort is stable.
  function bestForPattern(pattern, gear, used) {
    let best = null, bestScore = -1;
    builderPool().forEach((nm) => {
      if (used.has(exKey(nm))) return;
      if (!resolveRealization(nm, gear)) return;
      if (!musclesForExercise(nm).some((h) => MUSCLE_PATTERN[h.id] === pattern)) return;
      const s = coverageScore(nm);
      if (s > bestScore) { bestScore = s; best = nm; }
    });
    return best;
  }
  // One anchor per pattern the day owns, taken in pattern order so the biggest
  // movement opens the day.
  function seatAnchors(skeletonDays, gear, used) {
    return skeletonDays.map((patterns) => {
      const day = [];
      patterns.forEach((p) => {
        if (day.length >= DAY_CAP) return;
        const nm = bestForPattern(p, gear, used);
        if (!nm) return;
        used.add(exKey(nm));
        day.push(nm);
      });
      return day;
    });
  }
  // Sets per muscle for a proposed week, graded by the athlete's own bands.
  // Runs the REAL coverage engine on a throwaway week shape so the preview and
  // the finished program can never disagree about what was covered.
  function weekSetsFor(dayNames, client, setsPerEx = 3) {
    const week = { days: dayNames.map((names, i) => ({
      id: `b${i}`, name: `Day ${i + 1}`,
      exercises: names.map((nm, j) => ({ id: `b${i}-${j}`, name: nm, sets: setsPerEx })),
    })) };
    // Grade it as Building regardless of phase: the builder has not assigned
    // burn levels yet, and a phase would count every one of them as untagged.
    const cov = anatomyCoverage({ ...client, trainingPhase: "", weeks: [week] }, true);
    return cov ? cov.sets : {};
  }
  // Add whichever reachable movement closes the most shortfall, until every
  // muscle reaches solid or every day is full. Mutates `days`.
  function fillDeficit(days, client, gear, used, setsPerEx = 3) {
    const bands = levelBands(client);
    const room = () => days.some((d) => d.length < DAY_CAP);
    for (let guard = 0; guard < 200 && room(); guard++) {
      const sets = weekSetsFor(days, client, setsPerEx);
      const deficit = {};
      let total = 0;
      ANATOMY_GROUPS.forEach((g) => {
        const d = Math.max(0, bands.solid - (sets[g.id] || 0));
        deficit[g.id] = d; total += d;
      });
      if (!total) break;
      let best = null, bestGain = 0;
      builderPool().forEach((nm) => {
        if (used.has(exKey(nm))) return;
        if (!resolveRealization(nm, gear)) return;
        // How much of the outstanding shortfall this movement would close.
        const gain = musclesForExercise(nm).reduce((t, h) =>
          t + Math.min(deficit[h.id] || 0, setsPerEx * h.weight), 0);
        if (gain > bestGain) { bestGain = gain; best = nm; }
      });
      if (!best) break;
      // Into the emptiest day, so the week stays balanced in length.
      const target = days.reduce((a, b) => (b.length < a.length ? b : a));
      if (target.length >= DAY_CAP) break;
      target.push(best);
      used.add(exKey(best));
    }
    const finalSets = weekSetsFor(days, client, setsPerEx);
    return {
      short: ANATOMY_GROUPS.filter((g) => (finalSets[g.id] || 0) < bands.solid)
        .map((g) => g.name),
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/program-builder.test.js`
Expected: PASS, 18 checks.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/program-builder.test.js
git commit -m "Seat the anchors, then close the gaps they left"
```

---

### Task 8: Depth, burn levels, and the finished week

**Files:**
- Modify: `app.js` (after `fillDeficit`)
- Test: `tests/program-builder.test.js`

**Interfaces:**
- Consumes: Tasks 4–7, plus `GEN_STYLES`, `EFFORT_LEVELS`, `TRAINING_PHASE_BY_ID`, `phaseOf()`, `phaseMinRank()`, `uid()`, `_pickRange()`, `_repsFor()`.
- Produces: `buildWeek(client, { days, styleName })` → `{ week, report }`.
  - `week` is a real week object: `{ id, label, focus, phaseLabel, days: [{ id, name, exercises: [...] }], diet }`.
  - Each exercise carries `{ id, name, sets, reps, modifiers, effort }`.
  - `report` is `{ short: string[], dropped: string[], unreachable: string[], gearHint: string|null }`.

- [ ] **Step 1: Write the failing test**

Append:

```js
check("a built week is the right shape and never exceeds plenty", () => {
  const client = { trainingLevel: "intermediate" };
  const { week } = buildWeek(client, { days: 4, styleName: "Powerbuilding" });
  assert.strictEqual(week.days.length, 4);
  week.days.forEach((d) => {
    assert.ok(d.id && d.name, "every day needs an id and a name");
    assert.ok(d.exercises.length && d.exercises.length <= 7);
    d.exercises.forEach((ex) => {
      assert.ok(ex.id && ex.name, "every exercise needs an id and a name");
      assert.ok(Number(ex.sets) > 0, `${ex.name} has no sets`);
      assert.ok(String(ex.reps).length, `${ex.name} has no reps`);
    });
  });
  const bands = { solid: 8, plenty: 10 };
  const cov = coverageOfBuiltWeek(week, client);
  Object.entries(cov).forEach(([m, v]) =>
    assert.ok(v <= bands.plenty + 0.5, `${m} reached ${v}, past plenty ${bands.plenty}`));
});

check("every exercise carries a burn level", () => {
  const { week } = buildWeek({}, { days: 3, styleName: "Hypertrophy" });
  week.days.flatMap((d) => d.exercises).forEach((ex) =>
    assert.ok(EFFORT_LEVELS[ex.effort], `${ex.name} has no burn level: ${ex.effort}`));
});

check("in a phase nothing is written below the phase's minimum", () => {
  // Otherwise the builder produces a week its own grader reads as empty.
  ["fatloss", "maintenance"].forEach((id) => {
    const phase = TRAINING_PHASE_BY_ID[id];
    const min = EFFORT_LEVELS[phase.minEffort].rank;
    const { week } = buildWeek({ trainingPhase: id }, { days: 3, styleName: "Strength" });
    week.days.flatMap((d) => d.exercises).forEach((ex) =>
      assert.ok(EFFORT_LEVELS[ex.effort].rank >= min,
        `${id}: ${ex.name} is ${ex.effort}, under ${phase.minEffort}`));
  });
});

check("equipment modifiers are stamped on what needs them", () => {
  const { week } = buildWeek({ equipment: ["dumbbell", "bench", "box"] },
    { days: 2, styleName: "Hypertrophy" });
  const bench = week.days.flatMap((d) => d.exercises).find((e) => exKey(e.name) === "bench press");
  if (bench) assert.ok((bench.modifiers || []).includes("DBs"),
    "a dumbbell bench press must carry its DBs tag");
});

check("the report names what fell short and what the gear cannot reach", () => {
  const { report } = buildWeek({ equipment: ["dumbbell"] }, { days: 2, styleName: "Strength" });
  assert.ok(Array.isArray(report.short));
  assert.ok(Array.isArray(report.dropped));
  assert.ok(Array.isArray(report.unreachable));
});

check("two rolls of the same request differ", () => {
  const sig = () => JSON.stringify(buildWeek({}, { days: 4, styleName: "Volume" })
    .week.days.map((d) => d.exercises.map((e) => e.name + e.sets + e.reps)));
  const rolls = new Set([sig(), sig(), sig(), sig(), sig(), sig()]);
  assert.ok(rolls.size > 1, "six rolls produced the identical week");
});
```

Add this helper beside the other copied logic:

```js
function coverageOfBuiltWeek(week, client) {
  const sets = {};
  ANATOMY_GROUPS.forEach((g) => { sets[g.id] = 0; });
  week.days.forEach((d) => d.exercises.forEach((ex) => {
    const n = Number(ex.sets) || 0;
    musclesForExercise(ex).forEach((h) => { if (sets[h.id] != null) sets[h.id] += n * h.weight; });
  }));
  return sets;
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/program-builder.test.js`
Expected: FAIL, `buildWeek is not defined`.

- [ ] **Step 3: Implement in app.js**

```js
  // Which burn level a slot earns. By slot rather than by style, so it is one
  // rule rather than nine. A phase then floors the lot: coverage in Fat loss
  // counts only Hard and up, so a generated week written below that minimum
  // would grade as completely empty the moment its map was opened. The builder
  // must never produce a program its own grader rejects.
  const BUILDER_SLOT_EFFORT = { anchor: "hard", fill: "moderate", iso: "light" };
  function builderEffort(slot, phase) {
    const want = BUILDER_SLOT_EFFORT[slot] || "moderate";
    if (!phase) return want;
    const min = phaseMinRank(phase);
    if ((EFFORT_LEVELS[want] || {}).rank >= min) return want;
    return phase.minEffort;
  }

  // The whole builder. Pure: it returns a week and a report, and writes nothing.
  function buildWeek(client, { days = 4, styleName = "Powerbuilding" } = {}) {
    const gear = gearSet(client);
    const phase = phaseOf(client);
    const bands = levelBands(client);
    const style = GEN_STYLES.find((s) => s.name === styleName) || GEN_STYLES[0];
    const setsPerEx = Math.round((style.acc.sets[0] + style.acc.sets[1]) / 2);

    const sk = skeletonFor(days, gear);
    const used = new Set();
    const dayNames = seatAnchors(sk.days, gear, used);
    const anchorKeys = new Set(dayNames.flat().map(exKey));
    const { short } = fillDeficit(dayNames, client, gear, used, setsPerEx);

    // Depth: leftover headroom adds SETS to the anchors, never new exercises,
    // and stops at plenty. Without the ceiling an unreachable pattern would
    // pour its freed capacity into extra sets that cannot fix the muscle it is
    // actually missing, and cost recovery for nothing.
    const extra = {};
    if (!short.length) {
      const sets = weekSetsFor(dayNames, client, setsPerEx);
      dayNames.flat().forEach((nm) => {
        if (!anchorKeys.has(exKey(nm))) return;
        const hits = musclesForExercise(nm);
        const headroom = Math.min(...hits.map((h) =>
          Math.floor((bands.plenty - (sets[h.id] || 0)) / Math.max(h.weight, 0.5))));
        if (headroom > 0) extra[exKey(nm)] = Math.min(headroom, 2);
      });
    }

    const week = makeWeek((client.weeks || []).length);
    week.days = dayNames.map((names, i) => ({
      id: uid(),
      name: sk.days[i].join(" + ") || "Full Body",
      exercises: names.map((nm, j) => {
        const isAnchor = j < sk.days[i].length;
        const slot = isAnchor ? "anchor"
          : (MUSCLE_PATTERN[(musclesForExercise(nm)[0] || {}).id] === "Isolation" ? "iso" : "fill");
        const scheme = isAnchor ? style.primary : (slot === "iso" ? style.core : style.acc);
        const real = resolveRealization(nm, gear);
        return {
          id: uid(),
          name: nm,
          sets: String(Number(_pickRange(scheme.sets)) + (extra[exKey(nm)] || 0)),
          reps: _repsFor(nm, "", scheme),
          modifiers: real && real.tag ? [real.tag] : [],
          effort: builderEffort(slot, phase),
          currentWeight: "", currentReps: "", goalWeight: "", goalReps: "",
          notes: "", videoUrl: "",
        };
      }),
    }));
    week.focus = `${style.name} · built from coverage`;

    // Which single missing piece of gear would unlock the most, so the report
    // says what to buy rather than only what is absent.
    let gearHint = null;
    if (sk.dropped.length) {
      let bestId = null, bestN = 0;
      GEAR.forEach((g) => {
        if (gear.has(g.id)) return;
        const widened = new Set([...gear, g.id]);
        const n = sk.dropped.filter((p) => patternReachable(p, widened)).length;
        if (n > bestN) { bestN = n; bestId = g.id; }
      });
      if (bestId) gearHint = GEAR_BY_ID[bestId].label;
    }
    return {
      week,
      report: {
        short,
        dropped: sk.dropped,
        unreachable: ANATOMY_GROUPS.filter((g) => sk.dropped.includes(g.pattern)).map((g) => g.name),
        gearHint,
      },
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/program-builder.test.js`
Expected: PASS, 24 checks.

- [ ] **Step 5: Run the whole suite**

```bash
for f in tests/*.test.js; do node "$f" >/dev/null || echo "FAIL $f"; done; echo done
```
Expected: no FAIL lines.

- [ ] **Step 6: Commit**

```bash
git add app.js tests/program-builder.test.js
git commit -m "The finished week: depth to plenty, and burn levels its own grader accepts"
```

---

# Phase 3: The surface

---

### Task 9: The build sheet and its preview

**Files:**
- Modify: `app.js` — the week strip (~line 13295), and a new `openBuildWeekSheet()` beside `openRecommendedTemplatesModal()` (~line 9365)
- Modify: `styles.css`
- Modify: `index.html` — bump tags

**Interfaces:**
- Consumes: `buildWeek()`, `GEAR`, `GEN_STYLES`, `levelBands()`, `phaseOf()`, `currentClient()`, `saveTrainer()`, `renderWeeks()`.
- Produces: `openBuildWeekSheet(client)`.

- [ ] **Step 1: Add the entry point**

In `app.js`, inside the `if (showAdd && weeks.length < 12)` block, after `strip.appendChild(addBtn);`:

```js
      // Athlete mode only: the builder reads bands, phase and gear off a real
      // athlete, and a program template has none of those.
      if (!_programEditorId && currentClient()) {
        const buildBtn = document.createElement("button");
        buildBtn.className = "coach-week-tab coach-week-tab-add coach-week-tab-build";
        buildBtn.textContent = "⚡";
        buildBtn.title = "Build the week from their coverage";
        buildBtn.addEventListener("click", () => openBuildWeekSheet(currentClient()));
        strip.appendChild(buildBtn);
      }
```

- [ ] **Step 2: Add the sheet**

Beside `openRecommendedTemplatesModal()`:

```js
  // Build the week: pick a day count, a style and the gear, see what it would
  // write, then take it or roll again. Nothing touches the program until Use
  // this week, so rolling is free.
  function openBuildWeekSheet(client) {
    if (!client) return;
    if ((client.weeks || []).length >= 12) { toast("12-week maximum reached"); return; }
    let days = 4;
    let styleName = "Powerbuilding";
    let gearPick = [...(client.equipment || [])];
    let built = null;

    const ov = document.createElement("div");
    ov.className = "modal-overlay build-week-overlay";
    ov.innerHTML = `<div class="modal-card build-week-card">
      <div class="build-head">
        <strong>Build the week</strong>
        <button type="button" class="btn btn-ghost btn-sm" data-close>✕</button>
      </div>
      <div class="build-body"></div>
    </div>`;
    document.body.appendChild(ov);
    Nav.push(() => ov.remove());

    const body = ov.querySelector(".build-body");
    const bandsLine = () => {
      const ph = phaseOf(client);
      const b = levelBands(client);
      return ph
        ? `Grading against ${escapeHtml(ph.name)} · solid ${b.solid}, plenty ${b.plenty}`
        : `Grading against their training age · solid ${b.solid}, plenty ${b.plenty}`;
    };
    const setupHtml = () => `
      <div class="build-row"><span class="build-lbl">Days</span>
        <span class="build-pick">${[1, 2, 3, 4, 5, 6].map((d) =>
          `<button type="button" class="build-opt${d === days ? " on" : ""}" data-days="${d}">${d}</button>`).join("")}</span></div>
      <div class="build-row"><span class="build-lbl">Style</span>
        <span class="build-pick">${GEN_STYLES.map((s) =>
          `<button type="button" class="build-opt${s.name === styleName ? " on" : ""}" data-style="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`).join("")}</span></div>
      <div class="build-row"><span class="build-lbl">Gear</span>
        <span class="build-pick gear-grid">${GEAR.map((g) =>
          `<button type="button" class="gear-opt${gearPick.includes(g.id) ? " on" : ""}" data-gear="${g.id}">
             <span class="gear-opt-ico">${dayIconHtml(g.icon)}</span>
             <span class="gear-opt-lbl">${escapeHtml(g.label)}</span></button>`).join("")}</span></div>
      <p class="build-bands">${bandsLine()}</p>
      <div class="build-actions"><button type="button" class="btn btn-primary" data-build>Build</button></div>`;

    const previewHtml = () => {
      const { week, report } = built;
      const cov = anatomyCoverage({ ...client, weeks: [week] }, true);
      const bands = levelBands(client);
      const chips = ANATOMY_GROUPS.map((g) => {
        const v = cov?.sets?.[g.id] || 0;
        return `<span class="build-chip" data-cov="${coverageBand(v, bands)}">${escapeHtml(g.name)} <b>${covSetsLabel(v)}</b></span>`;
      }).join("");
      const notes = [];
      if (report.short.length) notes.push(`${escapeHtml(report.short.join(", "))} fall short at ${days} day${days === 1 ? "" : "s"}.`);
      if (report.unreachable.length) notes.push(`Their gear cannot train ${escapeHtml(report.unreachable.join(", "))}.${report.gearHint ? ` A ${escapeHtml(report.gearHint.toLowerCase())} would open the most.` : ""}`);
      return `
        <div class="build-days">${week.days.map((d) => `
          <div class="build-day">
            <div class="build-day-name">${escapeHtml(d.name)}</div>
            ${d.exercises.map((ex) => `<div class="build-ex">
              <span>${escapeHtml(ex.name)}${(ex.modifiers || []).length ? ` · ${escapeHtml(ex.modifiers.join(" "))}` : ""}</span>
              <span class="build-ex-scheme">${escapeHtml(ex.sets)}×${escapeHtml(String(ex.reps))}</span>
            </div>`).join("")}
          </div>`).join("")}</div>
        <div class="build-cov">${chips}</div>
        ${notes.length ? `<p class="build-note">${notes.join(" ")}</p>` : ""}
        <div class="build-actions">
          <button type="button" class="btn btn-primary" data-use>Use this week</button>
          <button type="button" class="btn btn-ghost" data-roll>Roll again</button>
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        </div>`;
    };

    function render() {
      body.innerHTML = built ? previewHtml() : setupHtml();
      body.querySelectorAll("[data-days]").forEach((b) =>
        b.addEventListener("click", () => { days = Number(b.dataset.days); render(); }));
      body.querySelectorAll("[data-style]").forEach((b) =>
        b.addEventListener("click", () => { styleName = b.dataset.style; render(); }));
      body.querySelectorAll("[data-gear]").forEach((b) =>
        b.addEventListener("click", () => {
          const id = b.dataset.gear;
          gearPick = gearPick.includes(id) ? gearPick.filter((x) => x !== id) : [...gearPick, id];
          render();
        }));
      const roll = () => {
        built = buildWeek({ ...client, equipment: gearPick }, { days, styleName });
        render();
      };
      body.querySelector("[data-build]")?.addEventListener("click", roll);
      body.querySelector("[data-roll]")?.addEventListener("click", roll);
      body.querySelector("[data-use]")?.addEventListener("click", () => {
        client.weeks.push(built.week);
        _coachActiveWeekIdx = client.weeks.length - 1;
        _coachOneOffTab = false;
        saveTrainer();
        Nav.exit();
        renderWeeks(); renderDiet(); renderCoachCalendar();
        toast(`Week built · ${built.week.days.length} days ⚡`);
      });
    }
    ov.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => Nav.exit()));
    body.addEventListener("click", (e) => {
      if (e.target.matches("[data-close]")) Nav.exit();
    });
    render();
  }
```

- [ ] **Step 3: Style it**

Append to `styles.css`:

```css
/* Build the week. The preview is a read-only rehearsal of what would be
   written, graded by the same coverage chips the Anatomy page uses, so the
   sheet and the finished program can never disagree. */
.build-week-card { max-width: 56rem; width: 100%; }
.build-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.build-row { display: flex; gap: 0.75rem; align-items: flex-start; margin: 0.9rem 0; }
.build-lbl {
  flex: none; width: 4rem; padding-top: 0.35em;
  font-size: 0.7rem; font-weight: 800; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--muted);
}
.build-pick { display: flex; flex-wrap: wrap; gap: 0.35rem; min-width: 0; flex: 1; }
.build-pick.gear-grid { display: grid; }
.build-opt {
  background: var(--surface-2); border: 1px solid var(--border); color: var(--muted);
  font: inherit; font-size: 0.8rem; padding: 0.4em 0.8em;
  border-radius: 999px; cursor: pointer;
}
.build-opt.on {
  color: var(--primary-bright);
  border-color: rgba(var(--primary-bright-rgb), 0.5);
  background: rgba(var(--primary-rgb), 0.12);
}
.build-bands { margin: 0.6rem 0 0; font-size: 0.8rem; color: var(--muted); }
.build-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }
.build-days {
  display: grid; gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
}
.build-day { background: var(--surface-2); border-radius: var(--radius); padding: 0.7rem; min-width: 0; }
.build-day-name {
  font-size: 0.7rem; font-weight: 800; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--primary-bright); margin-bottom: 0.4rem;
}
.build-ex { display: flex; justify-content: space-between; gap: 0.6rem; font-size: 0.8rem; padding: 0.16em 0; min-width: 0; }
.build-ex > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.build-ex-scheme { flex: none; color: var(--muted); font-variant-numeric: tabular-nums; }
.build-cov { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.9rem; }
.build-chip {
  font-size: 0.72rem; padding: 0.22em 0.6em; border-radius: 999px;
  border: 1px solid var(--border); color: var(--muted);
}
.build-chip[data-cov="0"] { border-color: rgba(217, 119, 6, 0.5); color: #fbbf24; }
.build-chip[data-cov="2"], .build-chip[data-cov="3"] {
  border-color: rgba(var(--primary-bright-rgb), 0.5); color: var(--primary-bright);
}
.build-note { margin: 0.7rem 0 0; font-size: 0.8rem; color: var(--muted); }
```

- [ ] **Step 4: Bump the cache tags**

`app.js?v=build1`, `styles.css?v=build1` in `index.html`.

- [ ] **Step 5: Verify in the browser**

Sandbox per `.claude/skills/verify`. Seed a coach with one athlete holding a
week, open the athlete's Program, then drive by DOM:

```js
document.querySelector(".coach-week-tab-build").click();
await new Promise(r => setTimeout(r, 300));
document.querySelector('[data-days="2"]').click();
document.querySelector("[data-build]").click();
await new Promise(r => setTimeout(r, 400));
({ days: document.querySelectorAll(".build-day").length,
   exs: [...document.querySelectorAll(".build-day")].map(d => d.querySelectorAll(".build-ex").length),
   note: document.querySelector(".build-note")?.textContent,
   weeksBefore: JSON.parse(localStorage.getItem("trainerpro_data_v1")).clients[0].weeks.length });
```
Expected: 2 days, each with 1 to 7 exercises, `weeksBefore` unchanged — nothing
is written until Use this week. Then click `[data-use]` and confirm the week
count went up by one and the new week appears in the strip.

- [ ] **Step 6: Commit**

```bash
git add app.js styles.css index.html
git commit -m "Build the week: pick, preview, roll again, then take it"
```

---

### Task 10: Ship it

**Files:**
- Modify: `index.html` (final tags)

- [ ] **Step 1: Run the whole suite**

```bash
node --check app.js && node --check cloud.js && node --check exercise-equipment.js
for f in tests/*.test.js; do node "$f" >/dev/null || echo "FAIL $f"; done; echo suite-done
```
Expected: no FAIL lines.

- [ ] **Step 2: Confirm the migration is live**

```bash
supabase db query --linked "select column_name from information_schema.columns where table_name='athletes' and column_name='equipment'"
```
Expected: one row. If empty, `supabase db push --include-all` before pushing code.

- [ ] **Step 3: Push and confirm the deploy**

```bash
git push origin main
until curl -sL "https://app.stonedragonstrengthtraining.com/index.html" | grep -q 'app.js?v=build1'; do sleep 10; done
curl -sL "https://app.stonedragonstrengthtraining.com/exercise-equipment.js?v=eq1" | head -c 200
```
Expected: the tag goes live and the new file serves. Check the **custom domain**,
never the github.io URL, which 301s and curls empty without `-L`.

---

## Self-Review Notes

Checked against the spec:

- Equipment vocabulary, realization map, per-athlete storage, picker → Tasks 1–3.
- Skeleton with reachability re-pick → Task 6. Anchor seating by coverage score → Task 7. Greedy fill → Task 7. Depth to plenty → Task 8.
- Burn levels by slot, floored at the phase minimum → Task 8.
- Entry point, setup sheet, preview, roll again, write → Task 9.
- Every test named in the spec's Section 5 appears in Tasks 1, 2, 4–8.

Two spec details deliberately simplified, both noted here so the difference is a
decision rather than a drift:

- The spec ordered days "compounds first, isolation last". Anchors are seated
  first and fills are appended, which produces that order naturally, so no
  separate sort step exists.
- The spec's preview mockup shows a per-day coverage strip. One strip for the
  whole week is built instead: coverage is a weekly measure, and per-day strips
  would invite reading a single day's number as a verdict.
