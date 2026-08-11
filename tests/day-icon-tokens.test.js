// workoutIconFor() returns a TOKEN, not something you can print.
//
// It used to return an emoji, so every call site could drop the result straight
// into textContent or a template hole and get a picture. On 2026-07-15
// ("Athlete workout picker facelift") it started returning keys into
// DAY_ICON_SVGS instead — "sd:claw", "sd:mountain" — and the athlete-side call
// sites were converted to dayIconHtml()/setDayIcon() in the same commit. Two
// coach-side ones were not, and they had been printing the literal text
// "sd:claw" in place of an icon ever since: the Day Library grid and the
// "Import a day into <week>" picker in the program editor.
//
// Nothing threw. A token is a perfectly good string, so the failure renders as
// a tidy little box with "sd:claw" typed in it.
//
// This pins the invariant that makes the raw form wrong (every return value is
// an SVG key, never printable text) and then sweeps EVERY call site in app.js,
// so the next site to be added has to route through a renderer too.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

// Same brace-matching extraction as tests/band-tags.test.js and
// tests/training-level-plumbing.test.js — the point is to run the REAL
// functions out of app.js rather than a hand-copied stand-in.
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
// Whole declaration (signature included), so it can be re-declared in a sandbox.
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

const DAY_ICON_SVGS = extractLiteral(appSrc, "const DAY_ICON_SVGS = {");

const app = new Function("DAY_ICON_SVGS", `
  ${fnSrc(appSrc, "function escapeHtml(")}
  ${fnSrc(appSrc, "function isSvgIcon(")}
  ${fnSrc(appSrc, "function dayIconHtml(")}
  ${fnSrc(appSrc, "function setDayIcon(")}
  ${fnSrc(appSrc, "function workoutIconFor(")}
  return { escapeHtml, isSvgIcon, dayIconHtml, setDayIcon, workoutIconFor };
`)(DAY_ICON_SVGS);

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures++; console.log(`  FAIL ${label}\n       ${e.message}`); }
}

// ---------------------------------------------------------------------------
// 1. Every branch of workoutIconFor returns an SVG token, never printable text
// ---------------------------------------------------------------------------
// One name per branch, plus the fallthrough. If any of these ever returns an
// emoji again the sweep below can be relaxed — but until then, printing the
// return value raw is always a bug.
const BRANCH_NAMES = [
  "Heavy Squat", "Leg Day", "Deadlift", "Pull Day", "Back + Lats",
  "Push Day", "Bench Press", "Shoulders", "Arm Day", "Biceps",
  "Core + Abs", "Conditioning", "Sprints", "Rest", "Mobility",
  "Something Unmatched",
];

console.log("workoutIconFor returns tokens, not text:");
for (const name of BRANCH_NAMES) {
  check(`"${name}" -> an SVG token`, () => {
    const tok = app.workoutIconFor(name);
    assert.ok(
      app.isSvgIcon(tok),
      `workoutIconFor("${name}") returned ${JSON.stringify(tok)}, which is not a DAY_ICON_SVGS key`
    );
    assert.ok(
      app.dayIconHtml(tok).startsWith("<svg"),
      `dayIconHtml did not resolve ${JSON.stringify(tok)} to an <svg>`
    );
    // The shape of the bug: dropped in raw, the token prints as its own text.
    assert.strictEqual(
      app.escapeHtml(tok), tok,
      "a token survives escaping unchanged — i.e. it renders as literal text"
    );
    assert.ok(/^[a-z]+:[a-z]+$/.test(tok), `token ${JSON.stringify(tok)} is not in <set>:<name> form`);
  });
}

// setDayIcon is the DOM-side renderer; prove it takes the innerHTML path for a
// token and the textContent path for a plain emoji, against a minimal element.
check("setDayIcon writes an <svg> for a token, text for an emoji", () => {
  const el = { innerHTML: "", textContent: "" };
  app.setDayIcon(el, app.workoutIconFor("Leg Day"));
  assert.ok(el.innerHTML.startsWith("<svg"), "token did not take the innerHTML path");
  assert.strictEqual(el.textContent, "", "token should not be written as text");

  const el2 = { innerHTML: "", textContent: "" };
  app.setDayIcon(el2, "🔥");
  assert.strictEqual(el2.textContent, "🔥", "a coach-picked emoji must still render");
  assert.strictEqual(el2.innerHTML, "", "an emoji must not go through innerHTML");
});

// ---------------------------------------------------------------------------
// 2. Sweep: every workoutIconFor() call site routes through a renderer
// ---------------------------------------------------------------------------
// Grepping for the two known-bad lines would only pin the two bugs that were
// found. This walks every call instead, so a new one that prints the token raw
// fails here rather than on Nathan's screen.
//
// A call site is safe if it is:
//   a) wrapped directly     — dayIconHtml(workoutIconFor(...)) / setDayIcon(el, workoutIconFor(...))
//   b) STORED, not rendered — icon: workoutIconFor(...) / day.icon = workoutIconFor(...)
//   c) held in a local that the same function later hands to a renderer
//   d) a fallbackIcon callback — sessionCardGrid() wraps the result in
//      dayIconHtml() at its one render site, which (a) cannot see through.
function enclosingFn(src, idx) {
  // Walk back to the nearest `function name(` at or before idx, then take its body.
  const head = src.lastIndexOf("function ", idx);
  if (head < 0) return src.slice(Math.max(0, idx - 400), idx + 400);
  return fnSrc(src, src.slice(head, head + 80).split("(")[0] + "(");
}

const CALL = "workoutIconFor(";
const sites = [];
for (let i = appSrc.indexOf(CALL); i >= 0; i = appSrc.indexOf(CALL, i + 1)) {
  if (/[\w.]/.test(appSrc[i - 1] || "")) continue;       // part of a longer identifier
  if (appSrc.slice(i - 9, i) === "function ") continue;  // the declaration itself
  const lineStart = appSrc.lastIndexOf("\n", i) + 1;
  if (appSrc.slice(lineStart, i).includes("//")) continue; // prose about it, not a call
  sites.push(i);
}

console.log(`\ncall sites routed through a renderer (${sites.length} found):`);
assert.ok(sites.length >= 6, `expected to find the call sites, found ${sites.length}`);

for (const i of sites) {
  const line = appSrc.slice(0, i).split("\n").length;
  const before = appSrc.slice(Math.max(0, i - 120), i);
  const stmt = appSrc.slice(appSrc.lastIndexOf("\n", i) + 1, appSrc.indexOf("\n", i));

  check(`app.js:${line}  ${stmt.trim().slice(0, 72)}`, () => {
    if (/dayIconHtml\(\s*$/.test(before)) return;                       // (a)
    if (/setDayIcon\([^,()]+,\s*$/.test(before)) return;                // (a)
    if (/(icon\s*:\s*|\.icon\s*=\s*)(\w+(\.\w+)*\s*\|\|\s*)?$/.test(before)) return;  // (b)
    if (/fallbackIcon\s*:\s*\([^)]*\)\s*=>\s*$/.test(before)) return;   // (d)

    // (c) — assigned to a local; require a renderer to consume that local.
    const assign = before.match(/(?:const|let|var)\s+(\w+)\s*=\s*[^=;]*$/);
    assert.ok(assign, "result is neither wrapped, stored, nor bound to a local — it renders as literal text");
    const local = assign[1];
    const body = enclosingFn(appSrc, i);
    const consumed =
      new RegExp(`dayIconHtml\\(\\s*${local}\\s*\\)`).test(body) ||
      new RegExp(`setDayIcon\\([^,()]+,\\s*${local}\\s*\\)`).test(body);
    assert.ok(consumed, `local "${local}" is never passed to dayIconHtml()/setDayIcon() — it renders as literal text`);
  });
}

console.log("");
if (failures) { console.log(`${failures} failing`); process.exit(1); }
console.log("all passing");
