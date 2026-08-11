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
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

// Grab a function's body by brace-matching from its declaration. Same helper
// as tests/training-level-plumbing.test.js — reused rather than reinvented.
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
  assert.ok(/prog\.client\.weeks/.test(appSrc),
    "the athlete's workout picker reads prog.client.weeks — same record");
  assert.ok(!/state\.clientData\.weeks\b/.test(appSrc),
    "nothing may read state.clientData.weeks — that is the bug");
});

check("the REAL coverageSubject(), executed from live app.js, resolves the athlete's own record", () => {
  // The check above only greps for the literal text "state.clientData.weeks",
  // which never existed even in the broken build: the bug was
  // coverageSubject() aliasing `client` straight to state.clientData, with
  // coverageWeek() reading client.weeks generically afterwards. A parameter
  // alias isn't a dotted chain, so no regex over app.js's source can see it —
  // a reviewer proved this by reverting coverageSubject() to exactly that bug
  // and running the whole suite: all 18 files, including every check above,
  // passed anyway. This check closes that gap by pulling the real functions
  // out of the live source with fnBody() and running them, instead of reading
  // their text.
  const state = { clientData };
  const realAthleteCoverageClient = new Function("state",
    fnBody(appSrc, "function athleteCoverageClient()"));
  const realCoverageSubject = new Function(
    "editable", "athleteCoverageClient", "currentClient", "state", "_lastAthleteId",
    fnBody(appSrc, "function coverageSubject()"));

  // editable=false is the athlete mount. currentClient/_lastAthleteId are only
  // touched on the coach branch, which this call never reaches — left
  // undefined on purpose rather than stubbed.
  const result = realCoverageSubject(
    false, () => realAthleteCoverageClient(state), undefined, state, undefined);

  assert.strictEqual(result.isCoach, false);
  assert.ok(result.client, "the athlete branch must resolve to a client record");
  assert.strictEqual(result.client.name, "Sarah",
    "if coverageSubject() ever hands back the wrapper again, .name is undefined here");
  assert.ok(Array.isArray(result.client.weeks) && result.client.weeks.length,
    "the {program, progress} wrapper itself never carries .weeks — that IS the bug");
});

check("renderCoverage's who-label also speaks athlete, not just the note beneath it", () => {
  // Review finding: fixing coverageSubject() made client===null a genuinely
  // reachable state for an athlete (no program assigned at all) for the first
  // time — before, the athlete branch always got the truthy state.clientData
  // wrapper, so this branch was coach-only in practice. The noteEl paragraph
  // was written to branch on isCoach; the small a-mode-who label directly
  // above it was not, so an athlete with no program got the coach's "No
  // athlete open" sitting right above the correctly athlete-voiced note.
  const body = fnBody(appSrc, "function renderCoverage()");
  assert.ok(/isCoach\s*\?\s*"No athlete open"\s*:\s*"No program yet"/.test(body),
    "the who-label's no-client branch must speak athlete too, not just the note beneath it");
});

console.log(`\nanatomy-coverage-wiring: ${n} checks passed.`);
