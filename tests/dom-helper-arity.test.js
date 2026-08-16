// `$` and `$$` take ONE argument. Passing a root does not scope them.
//
//   const $  = (sel) => document.querySelector(sel);
//   const $$ = (sel) => Array.from(document.querySelectorAll(sel));
//
// So `$(".hoard-tile", host)` ignores `host`, searches the whole document, and
// returns a single Element — and `.forEach` on it throws. Three call sites had
// it (2026-08-16): the Hoard ladder never wired a tile, and the stat pentagon's
// tween threw on every animation frame, leaving the hull moving while the five
// nodes stayed put. Neither surfaced as anything but a dead control.
//
// Pinning those three lines would only guard the bugs already found, so this
// sweeps EVERY call site in app.js — same approach as day-icon-tokens.test.js.
// The fix is always a scoped query: `root.querySelector(sel)` /
// `root.querySelectorAll(sel)`.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SRC = path.join(__dirname, "..", "app.js");
const raw = fs.readFileSync(SRC, "utf8");
// Scan CODE, not prose: the note explaining this very bug quotes the broken
// call, which the first run of this test dutifully reported. Only whole-line
// comments are blanked, and only where `//` or `/*` STARTS the line — an
// unanchored /\/\*[\s\S]*?\*\// matched a `/*` sitting inside a string and
// blanked 304,788 characters of real code, which silently turned this sweep
// into a no-op over most of the file. Newlines are kept so line numbers hold.
const src = raw
  .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, " "))
  .replace(/^[ \t]*\/\/[^\n]*/gm, (m) => " ".repeat(m.length));
// A stripper that eats real code makes the whole test lie, so prove it didn't:
// comments are the majority of this file, but not 30% of it in one match.
assert.ok(src.length === raw.length, "stripper must preserve length");
assert.ok(src.replace(/[ \n]/g, "").length > raw.replace(/[ \n]/g, "").length * 0.4,
  "comment stripper removed implausibly much — it has swallowed real code");

// ---- the helpers really are single-argument (if this changes, so does the rule)
const defDollar = /const \$ = \(sel\) => document\.querySelector\(sel\);/.test(src);
const defDouble = /const \$\$ = \(sel\) => Array\.from\(document\.querySelectorAll\(sel\)\);/.test(src);
assert.ok(defDollar, "`$` is no longer `(sel) => document.querySelector(sel)` — re-read this test's premise");
assert.ok(defDouble, "`$$` is no longer `(sel) => Array.from(...)` — re-read this test's premise");

// ---- no call site passes a second argument -------------------------------
// Walk each `$(` / `$$(` call and scan its argument list at depth 0 for a comma.
// Strings, template literals and nested parens are tracked so a selector like
// `$("[data-x='a,b']")` or `$(`#${id}`)` is not a false positive.
const offenders = [];
const callRe = /(^|[^A-Za-z0-9_$.])(\$\$?)\(/g;
let m;
while ((m = callRe.exec(src))) {
  const open = m.index + m[0].length;      // index just past the "("
  let i = open, depth = 0, quote = null, topLevelComma = -1;
  for (; i < src.length; i++) {
    const ch = src[i], prev = src[i - 1];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
    if (ch === ")" && depth === 0) break;
    if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
    if (ch === "," && depth === 0 && topLevelComma < 0) topLevelComma = i;
    if (ch === "\n" && depth === 0 && i - open > 400) break;   // runaway guard
  }
  if (topLevelComma > 0 && topLevelComma < i) {
    const line = src.slice(0, m.index).split("\n").length;
    offenders.push(`app.js:${line}  ${src.slice(m.index + m[1].length, i + 1).replace(/\s+/g, " ").slice(0, 110)}`);
  }
}

assert.deepStrictEqual(offenders, [],
  "these pass a second argument to $ / $$, which is ignored — use root.querySelector(All) instead:\n  " +
  offenders.join("\n  "));

// ---- and the three that were broken are actually scoped now --------------
for (const needle of [
  'host.querySelectorAll(".hoard-tile")',
  'svg.querySelectorAll(".sf-node")',
]) {
  assert.ok(src.includes(needle), `expected the fixed scoped query: ${needle}`);
}
assert.ok(
  (src.match(/host\.querySelectorAll\("\.hoard-tile"\)/g) || []).length === 2,
  "both hoard-tile call sites should be scoped",
);

console.log("dom-helper-arity: no call site passes a root to $ / $$; the 3 known sites are scoped.");
