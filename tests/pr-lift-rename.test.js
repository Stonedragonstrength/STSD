// Back Squat -> Barbell Squat on the PR cards, and the alias that keeps those
// cards attached to the sets they track.
//
// This one runs against LIVE athlete data on every open — it renames and
// deletes cards on real people's records — so the function is lifted out of
// app.js and run for real rather than reimplemented.
//
// The failures it exists to catch:
//   1. A card the athlete has filled in being skipped, so half the roster ends
//      up on the old name and half on the new one.
//   2. The duplicate being dropped along with a PR only IT had recorded.
//   3. The rename and the alias pointing the same way, so the seeded card no
//      longer matches the library's "Back Squat" and reads as untracked.
//   4. PR_LIFT_RENAMES still carrying "barbell squat", which would rename every
//      migrated card straight back on the next open.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

function fnSrc(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error(`not found: ${decl}`);
  let i = src.indexOf("(", at), paren = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") paren++;
    else if (src[i] === ")") { paren--; if (!paren) { i++; break; } }
  }
  const open = src.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (!depth) return src.slice(at, j + 1); }
  }
  throw new Error(`unbalanced: ${decl}`);
}
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

const DEFAULT_PR_LIFTS = extractLiteral(appSrc, "const DEFAULT_PR_LIFTS = [");
const PR_LIFT_ALIASES = extractLiteral(appSrc, "const PR_LIFT_ALIASES = {");
const PR_LIFT_RENAMES = extractLiteral(appSrc, "const PR_LIFT_RENAMES = {");
const PR_LIFT_MERGES = extractLiteral(appSrc, "const PR_LIFT_MERGES = {");

const exKey = (n) => String(n || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!]+$/, "");
const api = Function("exKey", "PR_LIFT_MERGES", "PR_LIFT_RENAMES", "PR_LIFT_ALIASES", `
  ${fnSrc(appSrc, "function prLiftAlias(")}
  ${fnSrc(appSrc, "function migratePRLiftNames(")}
  ${fnSrc(appSrc, "function migratePRLiftMerges(")}
  return { prLiftAlias, migratePRLiftNames, migratePRLiftMerges };
`)(exKey, PR_LIFT_MERGES, PR_LIFT_RENAMES, PR_LIFT_ALIASES);
const { prLiftAlias, migratePRLiftNames, migratePRLiftMerges } = api;

let n = 0, failures = 0;
function check(label, fn) {
  try { fn(); n++; console.log("  ok  " + label); }
  catch (e) { failures++; console.log("FAIL  " + label + "\n      " + e.message); }
}
const card = (name, extra) => ({ id: "p" + Math.random().toString(36).slice(2, 7), name, pr1: "", pr2: "", pr3: "", ...extra });

check("the seeded lifts name Barbell Squat, not Back Squat", () => {
  assert.ok(DEFAULT_PR_LIFTS.includes("Barbell Squat"), `seeded lifts are ${DEFAULT_PR_LIFTS.join(", ")}`);
  assert.ok(!DEFAULT_PR_LIFTS.includes("Back Squat"), "Back Squat is still seeded");
});

check("a lone Back Squat card is renamed, keeping its numbers", () => {
  const list = [card("Back Squat", { pr1: "315", pr1Date: "2026-07-01", pr1Locked: true }), card("Deadlift")];
  assert.strictEqual(migratePRLiftMerges(list), true);
  const sq = list.find((p) => p.name === "Barbell Squat");
  assert.ok(sq, `no Barbell Squat card: ${list.map((p) => p.name).join(", ")}`);
  assert.strictEqual(sq.pr1, "315");
  assert.strictEqual(sq.pr1Date, "2026-07-01");
  assert.strictEqual(sq.pr1Locked, true);
  assert.strictEqual(list.length, 2, "nothing else was touched");
});

check("a FILLED-IN card is renamed too, unlike the gentler rename pass", () => {
  // The whole point: Nathan wants every athlete moved, not just the pristine
  // ones. migratePRLiftNames deliberately skips a card with a value on it.
  const list = [card("Back Squat", { pr1: "405", pr1Locked: true })];
  migratePRLiftMerges(list);
  assert.strictEqual(list[0].name, "Barbell Squat");
  assert.strictEqual(list[0].pr1, "405");
});

check("when both cards exist the old one goes and nothing is lost", () => {
  const list = [
    card("Back Squat", { pr1: "315", pr1Date: "2026-06-01", pr3: "275", pr3Date: "2026-06-02" }),
    card("Barbell Squat", { pr1: "335", pr1Date: "2026-08-01" }),
    card("Deadlift", { pr1: "500" }),
  ];
  assert.strictEqual(migratePRLiftMerges(list), true);
  assert.deepStrictEqual(list.map((p) => p.name), ["Barbell Squat", "Deadlift"]);
  const sq = list[0];
  // The surviving card's own value wins where it has one...
  assert.strictEqual(sq.pr1, "335", "the newer card's 1RM was overwritten");
  assert.strictEqual(sq.pr1Date, "2026-08-01");
  // ...and a slot only the deleted card had is carried across rather than binned.
  assert.strictEqual(sq.pr3, "275", "a PR only the old card held was thrown away");
  assert.strictEqual(sq.pr3Date, "2026-06-02");
});

check("it is idempotent — a second open changes nothing", () => {
  const list = [card("Back Squat", { pr1: "315" }), card("Deadlift")];
  migratePRLiftMerges(list);
  const after = JSON.stringify(list);
  assert.strictEqual(migratePRLiftMerges(list), false, "reported a change with nothing left to do");
  assert.strictEqual(JSON.stringify(list), after);
});

check("the rename pass does not undo the merge on the next open", () => {
  // PR_LIFT_RENAMES used to carry "barbell squat" -> "Back Squat". Left there,
  // every migrated card would be renamed straight back the next time the page
  // opened, and the two passes would fight forever.
  assert.ok(!PR_LIFT_RENAMES["barbell squat"],
    "PR_LIFT_RENAMES still renames Barbell Squat back to Back Squat");
  const list = [card("Back Squat", { pr1: "315" })];
  migratePRLiftMerges(list);
  migratePRLiftNames(list);
  assert.strictEqual(list[0].name, "Barbell Squat");
});

check("the seeded card still finds the library's Back Squat sets", () => {
  // PRs are matched by NAME and the exercise library calls the lift "Back
  // Squat". Without this alias the seeded card sits dead beside its own sets.
  assert.strictEqual(prLiftAlias("Barbell Squat"), "Back Squat");
  DEFAULT_PR_LIFTS.forEach((nm) => {
    const a = prLiftAlias(nm);
    if (a) assert.notStrictEqual(exKey(a), exKey(nm), `${nm} aliases to itself`);
  });
});

check("no lift is both merged away and seeded", () => {
  Object.keys(PR_LIFT_MERGES).forEach((from) => {
    assert.ok(!DEFAULT_PR_LIFTS.some((nm) => exKey(nm) === from),
      `${from} is seeded AND migrated away, so every athlete gets it re-added then removed`);
  });
});

console.log("");
if (failures) { console.log(`${failures} failing`); process.exit(1); }
console.log(`pr-lift-rename: ${n} checks passed.`);
