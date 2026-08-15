// Editing an athlete FROM THE ROSTER has to push that athlete explicitly.
//
// The trap, and it is a quiet one: `saveTrainer()` writes localStorage for
// everything, but its cloud push covers exactly one athlete —
// `state.currentClientId`. `renderDashboard()` sets that to null on arrival,
// which is correct (no athlete is open on the roster). So any control that
// lives on the roster and mutates a client writes to this device and reaches
// the cloud never.
//
// Nothing errors. The value is on screen, it survives a reload from
// localStorage, and it looks saved — until a cloud-authoritative pull answers
// with the row the server still holds and puts the old value back. Reported as
// "the training age isn't saving" (2026-08-15); the roster training hub had
// been losing goal / days / pain relief / gear the same way for longer.
//
// The fix is one call, and this test exists because the omission is invisible:
// every roster-side mutation must be followed by `pushAthlete(<the client it
// mutated>)`.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

function fnSrc(decl) {
  const at = appSrc.indexOf(decl);
  if (at < 0) throw new Error(`not found: ${decl}`);
  const open = appSrc.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < appSrc.length; i++) {
    if (appSrc[i] === "{") depth++;
    else if (appSrc[i] === "}") { depth--; if (!depth) return appSrc.slice(at, i + 1); }
  }
  throw new Error(`unbalanced: ${decl}`);
}

let passed = 0;
const ok = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

console.log("roster edits reach the cloud");

// The premise. If either of these two facts stops being true, the rule below
// stops being necessary — and the failure message should say so rather than
// leaving someone puzzling over a test guarding nothing.
ok("PREMISE: saveTrainer pushes only state.currentClientId", () => {
  const src = fnSrc("function saveTrainer(");
  assert.ok(/window\.Cloud\?\.enabled && state\.currentClientId/.test(src),
    "saveTrainer's push condition changed — if it now pushes the edited athlete itself, this whole file can go");
});

ok("PREMISE: the roster nulls currentClientId on arrival", () => {
  const src = fnSrc("function renderDashboard(");
  assert.ok(/state\.currentClientId = null/.test(src),
    "renderDashboard no longer clears currentClientId — re-check what saveTrainer would push from the roster");
});

// The rule.
const SITES = [
  ["the training-age picker", "function openTrainingAgePicker("],
  ["the roster training hub", "function wireRosterTrainingHub("],
];

SITES.forEach(([label, decl]) => {
  ok(`${label} pushes the athlete it edited`, () => {
    const src = fnSrc(decl);
    assert.ok(/saveTrainer\(\)/.test(src), `${label} no longer saves at all`);
    assert.ok(/pushAthlete\(c\)/.test(src),
      `${label} calls saveTrainer() without pushAthlete(c) — on the roster that is a local-only write, and a cloud pull will quietly undo it`);
  });
});

ok("every saveTrainer() in the roster block is paired with a push", () => {
  // A sweep rather than two pinned lines: the bug is an omission, so a new
  // control added to either function would reintroduce it and the two checks
  // above would still pass. Scan the region that renders the roster.
  const from = appSrc.indexOf("function rosterStatMini(");
  const to = appSrc.indexOf("function groupRoster(");
  assert.ok(from > -1 && to > from, "roster region markers moved — update this test's bounds");
  const region = appSrc.slice(from, to);
  const saves = [...region.matchAll(/saveTrainer\(\)/g)];
  assert.ok(saves.length >= 2, `expected at least the picker and the hub to save; found ${saves.length}`);
  saves.forEach((m) => {
    // pushAthlete should appear within a few lines after each save.
    const after = region.slice(m.index, m.index + 700);
    assert.ok(/pushAthlete\(/.test(after),
      `a saveTrainer() in the roster region has no pushAthlete after it:\n      ...${region.slice(Math.max(0, m.index - 120), m.index + 60).replace(/\s+/g, " ")}`);
  });
});

ok("pushAthlete takes the client, so no caller needs to move currentClientId", () => {
  // The reason the fix is pushAthlete(c) and not `state.currentClientId = c.id`:
  // the roster deliberately has no athlete open, and faking one to get a push
  // would leave surfaces that read currentClientId (coverage, the anatomy map)
  // believing the coach is inside someone.
  const src = fnSrc("function pushAthlete(");
  assert.ok(/function pushAthlete\(c\)/.test(src), "pushAthlete no longer takes the client");
  assert.ok(/markAthleteDirty\(c\.id\)/.test(src), "pushAthlete stopped tracking the write");
  assert.ok(!/state\.currentClientId/.test(src), "pushAthlete now depends on currentClientId — the roster cannot use it");
});

console.log(`\n${passed} passed`);
