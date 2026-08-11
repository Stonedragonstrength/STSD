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
