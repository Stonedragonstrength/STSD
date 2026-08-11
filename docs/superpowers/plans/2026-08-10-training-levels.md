# Training Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each athlete a coach-set training level that retunes the muscle-coverage map's bands and verdict wording, show it as a roster pill, and fix the athlete-side Coverage map, which has never rendered.

**Architecture:** One nullable `training_level` column on `athletes`, mirrored to a `client.trainingLevel` string. A single `TRAINING_LEVELS` table supplies `solid`/`plenty` thresholds; `coverageBand()` takes them as an argument and `anatomyCoverage()` returns them on its result so the figure, the chips and the verdict all read one source. Intermediate's numbers are today's, so no existing athlete's map moves until a level is assigned.

**Tech Stack:** Vanilla JS (one IIFE in `app.js`), Supabase JS v2, plain-Node test scripts (no framework, no install).

## Global Constraints

- **No build step.** Vanilla HTML/CSS/JS. Do not add a bundler, framework, or dependency.
- **Field name is `trainingLevel`** (in-memory) / `training_level` (DB). Never `level` — `level` already means Hoard rank in `app.js` (`hoardRankForLevel`, `lvl.level`).
- **Values:** `""` (in-memory) / `NULL` (DB) = not set, plus `"beginner"`, `"intermediate"`, `"advanced"`. Nothing else.
- **Unset resolves to intermediate**, whose numbers are today's exact `6`/`12`. This is what keeps the change quiet — verify it, don't assume it.
- **Bands:** beginner `solid: 4, plenty: 8` · intermediate `solid: 6, plenty: 12` · advanced `solid: 8, plenty: 16`.
- **The athlete never sees the level word.** Their bands retune silently. The word appears only on coach surfaces.
- **Migration deploys before the client.** Nothing under `supabase/` ships with `git push`.
- **Tests are plain Node scripts.** `node tests/x.test.js`, exit non-zero on failure, no framework. Logic copied from `app.js` rather than imported — `app.js` is one IIFE with no exports. Per `tests/README.md`: if you change the original, change the copy.
- **`escapeHtml()` on any user content rendered into innerHTML.**

---

### Task 1: The field, end to end

The field has to land in four places or it fails silently — the coach's map reads correctly while the athlete's uses default bands, with nothing on either screen saying so. This task does all four and pins them with a test that fails if any one is dropped.

**Files:**
- Create: `supabase/migrations/20260810120000_training_level.sql`
- Modify: `app.js:490` (`makeClient`), `app.js:3418` (`buildProgramFromAthlete`)
- Modify: `cloud.js:96` (`athleteToRow`), `cloud.js:125` (`rowToAthlete`)
- Test: `tests/training-level-plumbing.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `client.trainingLevel` — a string, one of `""`/`"beginner"`/`"intermediate"`/`"advanced"`, present on every athlete object on both the coach and athlete side.

- [ ] **Step 1: Write the failing test**

Create `tests/training-level-plumbing.test.js`. This is a source-parsing test, following `theme-tokens.test.js`'s precedent, because the failure it guards is a *missing line* rather than wrong arithmetic — and `buildProgramFromAthlete` is a hand-picked allowlist where an omission is invisible at runtime.

```js
// trainingLevel has to reach four places, and missing any one fails silently:
// the coach's coverage map reads correctly while the athlete's quietly uses
// default bands, with nothing on either screen indicating they disagree.
//
//   1. makeClient()            — new athletes carry the field
//   2. athleteToRow()          — it reaches Supabase
//   3. rowToAthlete()          — it comes back
//   4. buildProgramFromAthlete() — it reaches the ATHLETE'S DEVICE
//
// (4) is the one that bites: it is a hand-picked allowlist of fields, not a
// spread, so a new field is simply absent unless someone remembers.
//
// This parses the sources rather than executing them because app.js is one IIFE
// with no exports and these are plumbing declarations, not behaviour.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const cloudSrc = fs.readFileSync(path.join(ROOT, "cloud.js"), "utf8");

// Grab a function's body by brace-matching from its declaration.
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

check("makeClient seeds trainingLevel", () => {
  const body = fnBody(appSrc, "function makeClient(");
  assert.ok(/trainingLevel\s*:/.test(body), "makeClient must seed trainingLevel");
});

check("buildProgramFromAthlete carries trainingLevel to the athlete's device", () => {
  const body = fnBody(appSrc, "function buildProgramFromAthlete(");
  assert.ok(/trainingLevel\s*:/.test(body),
    "buildProgramFromAthlete is an allowlist — without this line the athlete's map " +
    "silently uses default bands while the coach's is correct");
});

check("athleteToRow writes training_level", () => {
  const body = fnBody(cloudSrc, "function athleteToRow(");
  assert.ok(/training_level\s*:/.test(body), "athleteToRow must write training_level");
});

check("rowToAthlete reads training_level back", () => {
  const body = fnBody(cloudSrc, "function rowToAthlete(");
  assert.ok(/trainingLevel\s*:\s*r\.training_level/.test(body),
    "rowToAthlete must map training_level back to trainingLevel");
});

check("the migration exists and constrains the values", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20260810120000_training_level.sql"), "utf8");
  assert.ok(/add column if not exists training_level/.test(sql), "adds the column");
  assert.ok(/beginner/.test(sql) && /intermediate/.test(sql) && /advanced/.test(sql),
    "checks the three allowed values");
  assert.ok(/is null or/.test(sql),
    "must stay nullable — athleteToRow coerces empty strings to null, so a " +
    "not-null column rejects an unset athlete on the first write");
});

console.log(`\ntraining-level-plumbing: ${n} checks passed.`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/training-level-plumbing.test.js`
Expected: FAIL on the first check — `makeClient must seed trainingLevel`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260810120000_training_level.sql`:

```sql
-- Which volume ladder this athlete's coverage map is graded against.
--
-- The muscle map shipped grading everyone at 6 sets a muscle "solid" and 12
-- "plenty" — a trained lifter's numbers. A correct beginner program (full body,
-- three days, four to six sets a muscle) came back as six warnings, so the map
-- scolded the coach for writing a good program and trained him out of trusting
-- it.
--
-- Lives on `athletes` rather than `progress` because the coach sets it and the
-- athlete's own copy of the map reads it, exactly like `units`.
--
-- Nullable rather than `not null default 'intermediate'`: athleteToRow coerces
-- every optional field's empty string to null (`c.goals || null`), so a not-null
-- column would reject an unset athlete on its first write. NULL is the storage
-- form of "not set", and levelBands() resolves it to intermediate on read —
-- which is today's exact numbers, so no athlete's map moves until a level is
-- deliberately assigned.
alter table public.athletes
  add column if not exists training_level text
  check (training_level is null
         or training_level in ('beginner', 'intermediate', 'advanced'));
```

- [ ] **Step 4: Add the field to `makeClient()`**

In `app.js`, in `makeClient()`, immediately after the `goals: "", notes: "",` line (`app.js:496`):

```js
      goals: "", notes: "",
      // Which volume ladder their coverage map is graded against. "" means not
      // set and reads as intermediate — today's exact numbers — so assigning
      // levels is opt-in and nobody's map moves on its own. See TRAINING_LEVELS.
      trainingLevel: "",
```

- [ ] **Step 5: Carry it to the athlete's device**

In `app.js`, in `buildProgramFromAthlete()`, after the `goals: athlete.goals,` line (`app.js:3418`):

```js
        goals: athlete.goals,
        // Their coverage map runs on their own device and needs their bands.
        // This list is an allowlist, not a spread — a field omitted here is
        // simply absent on the athlete side, and the two maps disagree in
        // silence.
        trainingLevel: athlete.trainingLevel || "",
```

- [ ] **Step 6: Round-trip it through Supabase**

In `cloud.js`, in `athleteToRow()`, after `notes: c.notes || null,` (`cloud.js:97`):

```js
      notes: c.notes || null,
      training_level: c.trainingLevel || null,
```

In `cloud.js`, in `rowToAthlete()`, after `notes: r.notes || "",` (`cloud.js:126`):

```js
      notes: r.notes || "",
      trainingLevel: r.training_level || "",
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node tests/training-level-plumbing.test.js`
Expected: PASS, `training-level-plumbing: 5 checks passed.`

- [ ] **Step 8: Add the test to the tests README**

In `tests/README.md`, add a row to the table:

```markdown
| `training-level-plumbing.test.js` | that `trainingLevel` reaches all four places it has to | The field is set by the coach and read by the athlete's own copy of the coverage map, so it has to survive `makeClient` → `athleteToRow` → `rowToAthlete` → `buildProgramFromAthlete`. That last one is a hand-picked allowlist rather than a spread, so a new field is simply absent unless somebody remembers — and the failure is silent: the coach's map is right, the athlete's quietly uses default bands, and neither screen says they disagree. |
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260810120000_training_level.sql app.js cloud.js tests/training-level-plumbing.test.js tests/README.md
git commit -m "An athlete carries a training level, all the way to their device

buildProgramFromAthlete is an allowlist, not a spread, so a field that is not
named there simply never reaches the athlete — and the failure is silent: the
coach's coverage map reads correctly while the athlete's uses default bands.
The test parses all four plumbing sites so dropping one fails loudly.

The column is nullable on purpose. athleteToRow coerces every optional empty
string to null, so a not-null default would reject an unset athlete on the
first write.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Deploy the migration**

The migration must be live before any client code reads the column. Nothing under `supabase/` ships with `git push`.

Run: `npx supabase db push`
Expected: the migration applies. Confirm with:
`npx supabase db query "select column_name, is_nullable from information_schema.columns where table_name='athletes' and column_name='training_level'"`
Expected: one row, `training_level | YES`.

---

### Task 2: The bands

**Files:**
- Modify: `app.js:9582` (`coverageBand`), `app.js:9606` (`anatomyCoverage`), `app.js:9663` (`coverageVerdictHtml`), `app.js:10504` + `app.js:10543` (the two `coverageBand` call sites)
- Test: `tests/muscle-coverage.test.js`

**Interfaces:**
- Consumes: `client.trainingLevel` from Task 1.
- Produces:
  - `TRAINING_LEVELS` — array of `{ id, name, solid, plenty }`, ordered beginner → advanced.
  - `TRAINING_LEVEL_BY_ID` — `{ [id]: level }`.
  - `DEFAULT_TRAINING_LEVEL` — `"intermediate"`.
  - `levelBands(client)` → the level row; unset and unrecognised both give the default.
  - `coverageBand(n, bands)` → `0|1|2|3`.
  - `anatomyCoverage(client, isCoach)` result gains `bands` (the level row) and `level` (the row or `null` when unset).

- [ ] **Step 1: Write the failing test**

In `tests/muscle-coverage.test.js`, replace the existing `coverageBand` copy (currently just below `musclesForExercise`) with the level-aware copy, and add the table:

```js
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
```

Add a check that the default actually exists in the extracted table, so a
renamed id fails here rather than silently making every athlete fall back to
`undefined`:

```js
check("the default level is a real row in the table", () => {
  assert.ok(TRAINING_LEVEL_BY_ID[DEFAULT_TRAINING_LEVEL],
    `DEFAULT_TRAINING_LEVEL "${DEFAULT_TRAINING_LEVEL}" is not in TRAINING_LEVELS`);
});
```

Then replace `coverageForWeek(week)` with a level-aware version:

```js
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
```

Replace the existing `check("bands split at 1, 6 and 12", ...)` block with:

```js
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
```

Leave the earlier `coverageForWeek(week)` calls in this file exactly as they are — one argument, no client. They still pass (no client → unset → intermediate → today's 6/12), and that is the point: they now double as the proof that existing behaviour is unchanged. Do not add a client argument to them.

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/muscle-coverage.test.js`
Expected: FAIL with `not found: const TRAINING_LEVELS = [` — the table does not exist in `app.js` yet, and the test reads it from there rather than carrying its own copy.

If it passes, you copied the table into the test instead of extracting it. Go back to Step 1: the extraction is what makes this a test rather than a restatement.

- [ ] **Step 3: Add the table to `app.js`**

Immediately above `coverageBand` (`app.js:9580`), replacing the existing "Placeholder bands" comment:

```js
  // How much weekly volume per muscle counts as "solid" and "plenty" for a given
  // athlete. This shipped as one ladder for everyone — 6 and 12, a trained
  // lifter's numbers — and a correct beginner program (full body, three days,
  // four to six sets a muscle) came back as six separate warnings. A map that
  // cries wolf on its most common case teaches you to stop reading it.
  //
  // Intermediate is deliberately today's exact numbers. Every existing athlete
  // is unset, unset reads as intermediate, so nothing on the roster moves until
  // a level is deliberately assigned. Tunable by eye here and nowhere else — the
  // figure, the chips and the verdict all read these two numbers.
  const TRAINING_LEVELS = [
    { id: "beginner",     name: "Beginner",     solid: 4, plenty: 8  },
    { id: "intermediate", name: "Intermediate", solid: 6, plenty: 12 },
    { id: "advanced",     name: "Advanced",     solid: 8, plenty: 16 },
  ];
  const TRAINING_LEVEL_BY_ID = Object.fromEntries(TRAINING_LEVELS.map((l) => [l.id, l]));
  const DEFAULT_TRAINING_LEVEL = "intermediate";
  // Unset and unrecognised both resolve to the default. Unrecognised matters
  // because a cloud pull can hand back a value written by a newer build.
  function levelBands(client) {
    return TRAINING_LEVEL_BY_ID[client?.trainingLevel]
      || TRAINING_LEVEL_BY_ID[DEFAULT_TRAINING_LEVEL];
  }
```

- [ ] **Step 4: Make `coverageBand` take the bands**

Replace `coverageBand` (`app.js:9582-9587`) entirely:

```js
  // The bands come from the athlete, not from a constant. The default keeps
  // every caller that has no athlete in hand on today's ladder.
  function coverageBand(n, bands) {
    const b = bands || TRAINING_LEVEL_BY_ID[DEFAULT_TRAINING_LEVEL];
    if (n >= b.plenty) return 3;
    if (n >= b.solid) return 2;
    if (n >= 1) return 1;
    return 0;
  }
```

- [ ] **Step 5: Return the bands from `anatomyCoverage`**

In `anatomyCoverage()` (`app.js:9606`), after `if (!week) return null;`:

```js
    if (!week) return null;
    // Resolved once and returned, so the figure, the chips and the verdict all
    // grade against the same two numbers instead of re-deriving them three times.
    const bands = levelBands(client);
```

Then change the returned object (`app.js:9621-9625`) to:

```js
    return {
      week, sets, counted, unmapped, bands,
      level: TRAINING_LEVEL_BY_ID[client?.trainingLevel] || null,
      gaps: ANATOMY_GROUPS.filter((g) => !sets[g.id]).map((g) => g.name),
      light: ANATOMY_GROUPS.filter((g) => sets[g.id] > 0 && sets[g.id] < bands.solid).map((g) => g.name),
    };
```

- [ ] **Step 6: Make the verdict say the right number**

In `coverageVerdictHtml()` (`app.js:9668`), replace the hardcoded 6:

```js
    if (cov.light.length) bits.push(`${list(cov.light)} ${cov.light.length === 1 ? "gets" : "get"} under ${cov.bands.solid} sets — light.`);
```

- [ ] **Step 7: Pass the bands at both call sites**

`app.js:10504`, in `renderCoverage()`:

```js
        z.setAttribute("data-cov", String(coverageBand(n || 0, cov?.bands)));
```

`app.js:10543`, in `renderList()`:

```js
          + (cov ? ` data-cov="${coverageBand(n, cov.bands)}"` : "")
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node tests/muscle-coverage.test.js`
Expected: PASS, all checks including the five new ones.

- [ ] **Step 9: Commit**

```bash
git add app.js tests/muscle-coverage.test.js
git commit -m "The coverage bands belong to the athlete, not to a constant

Six sets a muscle is a trained lifter's 'solid'. Grading everyone there meant a
correct beginner program came back as six warnings, and a map that cries wolf on
its most common case teaches you to stop reading it.

Intermediate is left at exactly 6/12 and unset resolves to intermediate, so no
existing athlete's map moves until a level is deliberately assigned. The test
pins that specifically — it is the whole migration story.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Fix the athlete's Coverage map

It has never worked. `coverageSubject()` hands the athlete mount `state.clientData`, but that is a wrapper — `{program, progress}` — and the weeks live at `state.clientData.program.client.weeks`. The string `clientData.weeks` appears nowhere else in `app.js` and is never assigned, so `coverageWeek()` reads `undefined` and bails. The Coverage button is in the shared markup with no `editable` guard, so an athlete reaches it and gets coach copy telling them to add a week.

**Files:**
- Modify: `app.js:10474` (`coverageSubject`), `app.js:9663` (`coverageVerdictHtml` signature), `app.js:10499` (the no-client branch)
- Test: `tests/anatomy-coverage-wiring.test.js`

**Interfaces:**
- Consumes: `anatomyCoverage` / `coverageWeek` from Task 2.
- Produces: `athleteCoverageClient()` → the athlete's own client record or `null`. `coverageVerdictHtml(cov, who, isCoach)` — third parameter is new.

- [ ] **Step 1: Write the failing test**

Create `tests/anatomy-coverage-wiring.test.js`:

```js
// Whose record the athlete's coverage map reads.
//
// state.clientData is a WRAPPER — { program, progress } — and an athlete's weeks
// live one level down at state.clientData.program.client.weeks. The coverage map
// shipped reading the wrapper directly, so coverageWeek() got undefined, bailed,
// and every athlete who opened Coverage saw "No program to read yet — add a week
// with some days and this fills in": coach copy, on their phone, about a program
// that plainly exists.
//
// Nothing throws and nothing looks broken, which is why this is pinned here.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");

// ---- copies of the app.js logic ------------------------------------------
function athleteCoverageClient(clientData) {
  return clientData?.program?.client || null;
}
function coverageWeek(client) {
  const weeks = (client?.weeks || []).filter((w) => (w.days || []).length);
  if (!weeks.length) return null;
  return weeks[0];
}

// ---- a realistic athlete localStorage shape -------------------------------
// Real exercises with real set counts: a fixture with no exercises would prove
// the wiring and hide every wrong number, because derived values fail by being
// plausible rather than by being absent.
const clientData = {
  program: {
    kind: "tp-program", v: 2,
    client: {
      id: "a1", name: "Sarah", trainingLevel: "beginner",
      weeks: [{
        id: "w1", label: "Week 3",
        days: [
          { id: "d1", name: "Full Body A", exercises: [
            { id: "e1", name: "Back Squat",   sets: 3 },
            { id: "e2", name: "Bench Press",  sets: 3 },
            { id: "e3", name: "Barbell Row",  sets: 3 },
          ] },
          { id: "d2", name: "Full Body B", exercises: [
            { id: "e4", name: "Romanian Deadlift", sets: 3 },
            { id: "e5", name: "Overhead Press",    sets: 3 },
            { id: "e6", name: "Lateral Raise",     sets: 2 },
          ] },
        ],
      }],
    },
  },
  progress: { exerciseLogs: {}, dayCompletions: {} },
  selectedWeekId: "w1",
};

let n = 0;
const check = (label, fn) => { fn(); n++; console.log("  ok  " + label); };

check("the regression: the wrapper has no weeks of its own", () => {
  // If this ever starts failing, someone has started assigning weeks onto
  // clientData and this whole test needs rethinking rather than deleting.
  assert.strictEqual(clientData.weeks, undefined,
    "state.clientData is {program, progress} — it has never carried weeks");
  assert.strictEqual(coverageWeek(clientData), null,
    "reading the wrapper directly is exactly how the map rendered empty");
});

check("the fix: the athlete's own record is one level down", () => {
  const c = athleteCoverageClient(clientData);
  assert.ok(c, "there is a client record in there");
  assert.strictEqual(c.name, "Sarah");
  assert.ok(Array.isArray(c.weeks) && c.weeks.length, "and it carries the weeks");
});

check("a real week comes back, with its label", () => {
  const w = coverageWeek(athleteCoverageClient(clientData));
  assert.ok(w, "a week is found");
  assert.strictEqual(w.label, "Week 3");
  assert.strictEqual(w.days.length, 2);
  const totalSets = w.days.reduce((n, d) =>
    n + d.exercises.reduce((m, e) => m + Number(e.sets), 0), 0);
  assert.strictEqual(totalSets, 17, "17 prescribed sets across the week");
});

check("an athlete with no program yet resolves to null, not a crash", () => {
  assert.strictEqual(athleteCoverageClient({ program: null, progress: null }), null);
  assert.strictEqual(athleteCoverageClient(undefined), null);
});

check("the app really does read program.client.weeks elsewhere", () => {
  // Guards the assumption the whole fix rests on, against the real source.
  const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.ok(/prog\.client\.weeks/.test(appSrc),
    "the athlete's workout picker reads prog.client.weeks — same record");
  assert.ok(!/state\.clientData\.weeks\b/.test(appSrc),
    "nothing may read state.clientData.weeks — that is the bug");
});

console.log(`\nanatomy-coverage-wiring: ${n} checks passed.`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/anatomy-coverage-wiring.test.js`
Expected: FAIL on the last check — `state.clientData.weeks` is still present in `app.js` (inside `coverageSubject`).

- [ ] **Step 3: Add the named helper and fix the subject**

In `app.js`, immediately above `coverageWeek` (`app.js:9589`):

```js
  // The athlete's own client record. `state.clientData` is a WRAPPER —
  // { program, progress } — and the weeks live one level down. Reading the
  // wrapper is why the athlete's coverage map rendered its empty state from the
  // day it shipped: coverageWeek() got undefined and bailed, with nothing on
  // screen suggesting anything was wrong.
  function athleteCoverageClient() {
    return state.clientData?.program?.client || null;
  }
```

Then in `coverageSubject()` (`app.js:10475`):

```js
      if (!editable) return { client: athleteCoverageClient(), isCoach: false };
```

- [ ] **Step 4: Stop telling athletes to add a week**

Change `coverageVerdictHtml`'s signature and its no-program copy (`app.js:9663-9664`):

```js
  function coverageVerdictHtml(cov, who, isCoach) {
    if (!cov) return `<p class="a-cov-none">${isCoach
      ? "No program to read yet — add a week with some days and this fills in."
      : "No program to read yet. This fills in once your coach builds your week."}</p>`;
```

In `renderCoverage()` (`app.js:10499-10501`), pass the role through and fix the no-client branch, which an athlete now reaches when they have no program at all:

```js
      noteEl.innerHTML = client
        ? coverageVerdictHtml(cov, who, isCoach)
        : `<p class="a-cov-none">${isCoach
            ? "Open an athlete and this reads their week."
            : "No program yet. This fills in once your coach builds your week."}</p>`;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/anatomy-coverage-wiring.test.js`
Expected: PASS, `anatomy-coverage-wiring: 5 checks passed.`

- [ ] **Step 6: Run the whole suite for regressions**

Run: `for f in tests/*.test.js; do node "$f" >/dev/null || echo "FAIL $f"; done; echo done`
Expected: `done` with no FAIL lines.

- [ ] **Step 7: Add the test to the tests README**

```markdown
| `anatomy-coverage-wiring.test.js` | whose record the athlete's coverage map reads | `state.clientData` is a wrapper — `{program, progress}` — and an athlete's weeks live one level down at `program.client.weeks`. The map shipped reading the wrapper, so `coverageWeek()` got `undefined`, bailed, and every athlete who opened Coverage got "add a week with some days": coach copy, on their phone, about a program that plainly exists. Nothing threw and nothing looked broken. Pins the wrapper having no `weeks` of its own, the record being one level down, a real week with real set counts coming back, and — against the live source — that nothing in `app.js` reads `state.clientData.weeks` again. |
```

- [ ] **Step 8: Commit**

```bash
git add app.js tests/anatomy-coverage-wiring.test.js tests/README.md
git commit -m "The athlete's coverage map reads their program, not the wrapper

It has never worked. coverageSubject() handed the athlete mount
state.clientData, which is {program, progress}; their weeks live one level down
at program.client.weeks. coverageWeek() read undefined, bailed, and since the
Coverage button ships to both roles with no guard, every athlete who tapped it
got 'add a week with some days' — coach copy, on their phone, about a program
that exists.

Nothing threw, so it looked fine from here.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The level picker on the coverage panel

Saves on change, not behind an edit/save lock — following the lesson at `app.js:8186`, where membership and rate were pulled out of the locked profile form because "a stale value in this form can't overwrite one that was set there."

**Files:**
- Modify: `app.js:10439` (the mode row markup), `app.js:10483` (`renderCoverage`), and the event wiring in `buildAnatomy`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `TRAINING_LEVELS`, `levelBands` (Task 2); `coverageSubject` (Task 3).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the select to the markup**

In `buildAnatomy`'s template (`app.js:10439`), replace the `a-mode-who` line:

```js
            <span class="a-mode-who" data-cov-who></span>
            ${editable ? `<select class="a-level-sel hidden" data-cov-level aria-label="Training level — sets the coverage bands">
              <option value="">Not set (uses Intermediate)</option>
              ${TRAINING_LEVELS.map((l) => `<option value="${l.id}">${l.name}</option>`).join("")}
            </select>` : ""}
```

The athlete mount never renders it — their bands retune, but the word is not theirs to read.

- [ ] **Step 2: Populate and show it in `renderCoverage`**

In `renderCoverage()`, after the existing `whoEl.textContent = ...` assignment (`app.js:10496`):

```js
      // Coach only, and only with an athlete open — a level picker with nobody
      // to apply it to is a control that silently does nothing.
      const selEl = root.querySelector("[data-cov-level]");
      if (selEl) {
        selEl.classList.toggle("hidden", !client);
        if (client) selEl.value = client.trainingLevel || "";
      }
```

And in the `mode !== "coverage"` early-return branch (`app.js:10490-10494`), hide it too:

```js
      if (mode !== "coverage") {
        whoEl.textContent = "";
        root.querySelector("[data-cov-level]")?.classList.add("hidden");
        root.querySelectorAll(".a-zone[data-cov]").forEach((z) => z.removeAttribute("data-cov"));
        return;
      }
```

- [ ] **Step 3: Show the level in the coach's verdict header**

In `coverageVerdictHtml` (`app.js:9672`), append the level name to the lead line. It is only ever passed a level on the coach side, because `cov.level` is `null` when unset and the athlete mount does not print the header name either:

```js
      <span class="a-cov-lead">${cov.gaps.length ? "⚠ Gaps" : "✓ Covered"} · ${escapeHtml(cov.week.label || "This week")}${who ? " · " + escapeHtml(who) : ""}${who && cov.level ? " · " + escapeHtml(cov.level.name) : ""}</span>
```

- [ ] **Step 4: Wire the change handler**

In `buildAnatomy`, alongside the other listeners (near the `a-mode-btn` wiring), add:

```js
    // Saves on change. It deliberately does not live inside the locked profile
    // form — see the note at saveProfileFields(): membership and rate were moved
    // out of there precisely because a value you set and walked away from got
    // overwritten by whatever the stale form still held.
    root.querySelector("[data-cov-level]")?.addEventListener("change", (e) => {
      const { client } = coverageSubject();
      if (!client) return;
      client.trainingLevel = e.target.value;
      saveTrainer();
      renderCoverage();
      renderList();
      renderDashboard();
    });
```

- [ ] **Step 5: Style it**

In `styles.css`, next to the `.a-mode-btn` rules (around line 10690):

```css
.a-level-sel {
  margin-left: auto;
  padding: 0.3em 0.6em;
  font: inherit;
  font-size: 0.82rem;
  color: var(--text);
  background: var(--card-2, var(--card));
  border: 1px solid var(--line);
  border-radius: 0.5em;
}
.a-level-sel.hidden { display: none; }
```

- [ ] **Step 6: Verify in the running app**

Serve and drive it — a select that saves on change is exactly the kind of thing that looks wired and isn't.

```bash
python3 -m http.server 5190 --directory . &
```

Open `http://localhost:5190`, sign in as coach, open an athlete, go to **Anatomy → Coverage**:
1. The select shows, reading "Not set (uses Intermediate)".
2. Pick **Beginner** — the figure repaints brighter and the verdict's "under 6 sets" becomes "under 4 sets", in the same frame.
3. Navigate away to Roster and back into the same athlete → still Beginner.
4. Reload the page → still Beginner.
5. Open a *different* athlete → the select reads *that* athlete's level, not the previous one. (`renderCoverage` recomputes per paint precisely because this mount outlives athlete switches.)

- [ ] **Step 7: Commit**

```bash
git add app.js styles.css
git commit -m "Set an athlete's level where you can see it land

The picker sits on the coverage panel rather than the profile card, so the body
map repaints under your hand as you change it. It saves on change and stays out
of the locked profile form — membership and rate were moved out of there for
exactly this reason: a value you set and walked away from got overwritten by
whatever the stale form still held.

Coach mount only. The athlete's bands retune; the word is not theirs to read.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The roster pill

**Files:**
- Modify: `app.js:4549` (roster card name line)
- Modify: `styles.css`
- Modify: `index.html` (cache-bust)

**Interfaces:**
- Consumes: `TRAINING_LEVEL_BY_ID` (Task 2).
- Produces: nothing.

- [ ] **Step 1: Append the pill**

In `renderDashboard`'s card builder, after the birthday-chip block (`app.js:4549`) and before `const cPartner = partnerOf(c);`:

```js
      // Which volume ladder their coverage map is graded against. Unset renders
      // NOTHING on purpose: an empty slot is honest about a decision not yet
      // made, where a default-looking "Intermediate" badge would claim one that
      // was never taken.
      const lvl = TRAINING_LEVEL_BY_ID[c.trainingLevel];
      if (lvl) {
        const el = document.createElement("span");
        el.className = "quiet-chip level-chip";
        el.title = `${lvl.name} — coverage grades ${lvl.solid}+ sets as solid, ${lvl.plenty}+ as plenty`;
        el.textContent = lvl.name;
        nameEl.appendChild(el);
      }
```

- [ ] **Step 2: Style it**

In `styles.css`, beside the other `quiet-chip` modifiers:

```css
.level-chip {
  color: var(--muted);
  border-color: rgba(var(--primary-rgb), 0.35);
}
```

- [ ] **Step 3: Bump the cache-bust**

In `index.html`, change both `?v=anat6` to `?v=lvl1` (line 17 `styles.css`, line 1595 `app.js`).

- [ ] **Step 4: Verify at phone width**

The name line already carries a quiet chip, a birthday chip, a partner chip and up to two mood chips. This is the fourth competitor for it.

Open the roster in a 390px-wide viewport with an athlete who has a level set **and** a birthday inside the 5-day window **and** a partner **and** recent moods. Confirm the name does not wrap or get pushed out. If the line breaks, shorten the pill (first letter, or an abbreviation) — do not shorten the name.

Then: set a level on one athlete, confirm the pill appears; set it back to "Not set", confirm the pill disappears entirely rather than reading "Intermediate".

- [ ] **Step 5: Commit**

```bash
git add app.js styles.css index.html
git commit -m "The roster says which ladder each athlete is graded on

Unset renders nothing at all. An empty slot is honest about a decision not yet
made; a default-looking 'Intermediate' badge would claim one that was never
taken.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end verification, both roles

The map is the kind of thing that lights up confidently wrong — both bugs the existing coverage test pins were found by running the finished feature on a real program, not by reading it.

**Files:** none — verification only.

- [ ] **Step 1: Confirm the coach side against a real program**

With the server running, open an athlete whose week has real exercises. In **Anatomy → Coverage**:
- Set **Intermediate**. Note every muscle's number and colour.
- Set **Beginner**. Confirm **the numbers are identical** and only the colours and the "light" list changed. The sets are a property of the program; only the grading moved.
- Set **Advanced**. Confirm fewer muscles reach the top band than at Intermediate.

- [ ] **Step 2: Confirm the athlete side — the bug fix**

Per the offline-testing approach: stub `config.js` so `Cloud.enabled` is false, seed `localStorage` under `trainerpro_client_v1` with a program shaped `{ program: { client: { weeks: [...] } }, progress: {...} }` carrying real exercises and set counts, and open the athlete portal.

Go to **Anatomy → Coverage** and confirm:
- It renders a real reading — week label, muscle numbers, a verdict — **not** "No program to read yet."
- The level word appears **nowhere** on the athlete's screen.
- With `trainingLevel: "beginner"` seeded, the verdict says "under 4 sets", proving the level reached the device through `buildProgramFromAthlete`.

- [ ] **Step 3: Confirm an athlete with no program**

Seed `trainerpro_client_v1` as `{ program: null, progress: null }`, open Coverage, and confirm the copy reads "No program yet. This fills in once your coach builds your week." — and never instructs them to add a week.

- [ ] **Step 4: Full suite, then push**

```bash
for f in tests/*.test.js; do node "$f" >/dev/null || echo "FAIL $f"; done; echo done
git push origin main
```

Expected: `done` with no FAIL lines, then a clean push. The migration is already live from Task 1 Step 10 — confirm before pushing that it is, or the first client that writes a level gets a silent column error.
