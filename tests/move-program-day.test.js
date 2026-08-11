// Moving a day between weeks — the splice that must never clone.
//
// Logs, completions, moods and readiness are all keyed by exercise/day ids,
// never by week position, so moving the DAY OBJECT carries a filled day's
// history with it for free. That free ride has one condition: the move must
// splice the same object. A clone with a fresh id would orphan every log
// silently — the program would look right and the athlete's history would be
// gone from under it. The identity assertions here are the whole point.
//
// The other trap is the same-week off-by-one: the sheet labels positions as
// the user SEES them, pre-removal. Moving a day forward means the removal
// shifts every later index left by one, so a naive splice(toPos) lands the
// day one slot past where the user tapped — plausible-looking and wrong.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

// Same brace-matcher as tests/band-tags.test.js — run the REAL function.
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

const moveProgramDay = new Function(
  `${fnSrc(appSrc, "function moveProgramDay(")}; return moveProgramDay;`
)();

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures++; console.log(`  FAIL ${label}\n       ${e.message}`); }
}

// A three-week fixture with named days so landing spots are legible.
// Day objects carry nested data (exercises, notes) so identity vs clone is
// distinguishable.
function fixture() {
  const day = (id, name) => ({ id, name, exercises: [{ id: `ex-${id}`, name: `${name} lift`, sets: 3 }] });
  return [
    { id: "w1", label: "Week 1", days: [day("a", "Push"), day("b", "Pull"), day("c", "Legs"), day("d", "Core")] },
    { id: "w2", label: "Week 2", days: [day("e", "Upper"), day("f", "Lower")] },
    { id: "w3", label: "Week 3", days: [] },
  ];
}

console.log("same-week moves land where the user tapped:");
check("forward: Push (0) to slot 2 lands at 2, order Pull-Legs-Push-Core", () => {
  const weeks = fixture();
  const moved = weeks[0].days[0];
  const at = moveProgramDay(weeks, 0, 0, 0, 2);
  assert.strictEqual(at, 2);
  assert.deepStrictEqual(weeks[0].days.map((d) => d.name), ["Pull", "Legs", "Push", "Core"]);
  assert.strictEqual(weeks[0].days[2], moved, "must be the same object, not a copy");
});
check("backward: Core (3) to slot 0 lands at 0", () => {
  const weeks = fixture();
  const at = moveProgramDay(weeks, 0, 3, 0, 0);
  assert.strictEqual(at, 0);
  assert.deepStrictEqual(weeks[0].days.map((d) => d.name), ["Core", "Push", "Pull", "Legs"]);
});
check("to the last slot: Push (0) to slot 3 ends the week", () => {
  const weeks = fixture();
  const at = moveProgramDay(weeks, 0, 0, 0, 3);
  assert.strictEqual(at, 3);
  assert.deepStrictEqual(weeks[0].days.map((d) => d.name), ["Pull", "Legs", "Core", "Push"]);
});

console.log("\ncross-week moves:");
check("appends to the target's end, same object, id untouched", () => {
  const weeks = fixture();
  const moved = weeks[0].days[1]; // Pull, id "b"
  const at = moveProgramDay(weeks, 0, 1, 1, weeks[1].days.length);
  assert.strictEqual(at, 2);
  assert.deepStrictEqual(weeks[1].days.map((d) => d.name), ["Upper", "Lower", "Pull"]);
  assert.strictEqual(weeks[1].days[2], moved, "must be the same object, not a copy");
  assert.strictEqual(weeks[1].days[2].id, "b", "id must never be re-minted");
  assert.strictEqual(weeks[1].days[2].exercises[0].id, "ex-b", "nested exercise ids ride along");
  assert.deepStrictEqual(weeks[0].days.map((d) => d.name), ["Push", "Legs", "Core"]);
});
check("into an empty week", () => {
  const weeks = fixture();
  const at = moveProgramDay(weeks, 0, 0, 2, 0);
  assert.strictEqual(at, 0);
  assert.deepStrictEqual(weeks[2].days.map((d) => d.name), ["Push"]);
});
check("emptying the source leaves the week standing", () => {
  const weeks = fixture();
  moveProgramDay(weeks, 1, 0, 0, 4);
  moveProgramDay(weeks, 1, 0, 0, 5);
  assert.strictEqual(weeks[1].days.length, 0);
  assert.strictEqual(weeks.length, 3, "an emptied week is not deleted");
  assert.deepStrictEqual(weeks[0].days.map((d) => d.name), ["Push", "Pull", "Legs", "Core", "Upper", "Lower"]);
});

console.log("\nguards:");
check("same position is a no-op returning null", () => {
  const weeks = fixture();
  const before = JSON.stringify(weeks);
  assert.strictEqual(moveProgramDay(weeks, 0, 1, 0, 1), null);
  assert.strictEqual(JSON.stringify(weeks), before, "a no-op must not touch the data");
});
check("out-of-range input is a no-op returning null", () => {
  const weeks = fixture();
  const before = JSON.stringify(weeks);
  assert.strictEqual(moveProgramDay(weeks, 0, 9, 1, 0), null);
  assert.strictEqual(moveProgramDay(weeks, 9, 0, 1, 0), null);
  assert.strictEqual(moveProgramDay(weeks, 0, 0, 9, 0), null);
  assert.strictEqual(JSON.stringify(weeks), before);
});

console.log("");
if (failures) { console.log(`${failures} failing`); process.exit(1); }
console.log("all passing");
