// Day-card tap targets: the middle of a day card must belong to the day.
//
// The bug this guards (2026-08-17): "Skipped it?" and "⇄ Move" were inline
// spans inside .workout-card-meta. Under @media (pointer: coarse) they were
// given `padding: 0.55em 0.35em; margin: -0.55em 0 …`, on the belief that the
// negative margin cancels the padding's effect on layout. It does not — and
// worse, neither half does what was intended:
//
//   * vertical MARGIN is ignored on a non-replaced inline element, so it
//     cancelled nothing;
//   * vertical PADDING on an inline element does not lay out either, but it
//     DOES extend the border box, so it hit-tests.
//
// Net effect: a 27px-tall invisible target hanging across the meta line, which
// on a ~100px two-line card is the card's own centre. On a tablet the coach
// aimed at the day and got the skip sheet or the day mover instead, with
// nothing on screen to explain it. Measured in Chromium at eight tablet /
// phone geometries: up to 43% of a 44px fingertip at the card's centre landed
// on one of the two controls.
//
// The fix moved them into .wc-actions — a flex COLUMN beside the body, where
// the same padding takes real space, so the target and the ink are one
// rectangle. A row under the meta is not enough: on a two-line card that row
// is still mid-card, which measured as no fix at all.
//
// This test reads the real app.js / styles.css, like theme-tokens.test.js.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log("  ok   " + name); return; }
  failures++;
  console.log("  FAIL " + name + (detail ? "\n       " + detail : ""));
}

console.log("day-card tap targets");

// ---- 1. The markup: the controls are not in the meta line ----
// Grab the template literal that builds the day card.
const cardStart = app.indexOf('<div class="workout-card-icon">');
const cardEnd = app.indexOf('<div class="workout-card-chevron">', cardStart);
check("found the day-card template in app.js", cardStart > -1 && cardEnd > cardStart);

const template = app.slice(cardStart, cardEnd);
const metaMatch = template.match(/<div class="workout-card-meta">[\s\S]*?<\/div>/);
check("found the .workout-card-meta line", !!metaMatch);
if (metaMatch) {
  const meta = metaMatch[0];
  check(
    "skipCtl is not interpolated into .workout-card-meta",
    !meta.includes("${skipCtl}") && !meta.includes("wc-skip"),
    "an inline control there sits on the card's own centre — see the header of this file"
  );
  check(
    "moveCtl is not interpolated into .workout-card-meta",
    !meta.includes("${moveCtl}") && !meta.includes("wc-move"),
    "an inline control there sits on the card's own centre — see the header of this file"
  );
  // The "vs last" delta DOES live in this line, unlike the two controls above —
  // it is passive text, so it is not a tap hazard. What it must never do is
  // ADD to the line. It is interpolated via `metaLead`, which is the delta OR
  // the exercise count, never both; see the size measurements below.
  check(
    "the delta reaches the meta line only through metaLead",
    meta.includes("${metaLead}") && !meta.includes("${deltaTok}"),
    "the delta must displace the exercise count, not append to it"
  );
}
check(
  "the controls are wrapped in .wc-actions",
  /class="wc-actions">\$\{skipCtl\}\$\{moveCtl\}<\/div>/.test(template),
  "expected a .wc-actions wrapper holding skipCtl + moveCtl"
);
// The load-bearing half of the placement. A done athlete card carries NO
// .wc-actions at all — skipCtl needs !checked, moveCtl is coach-only — so
// putting the delta in that column creates one, costing the text box ~58px and
// wrapping the readiness/mood chips a finished day carries. Measured across
// 320/360/390/430/768/1000/1280px it grew the card in 90 of 168 configurations,
// by up to 57px. Swapping the count out grew it in none. Keep it a swap.
check(
  "the delta displaces the exercise count rather than joining it",
  /const metaLead = deltaTok \|\| `\$\{totalEx\} exercise/.test(app),
  "metaLead must be `deltaTok || <count>` — appending the delta to the count " +
  "is what makes the card grow; see the note over .wc-delta in styles.css"
);
check(
  "the delta is not in the actions column",
  !/class="wc-actions">[^<]*\$\{deltaTok\}/.test(template) && !template.includes("wc-actions\">${deltaTok}"),
  "a column on a done card is new structure — that is the +57px case"
);
// Neither half of the guard may be loosened: a partial day compared against a
// complete one reads as a collapse, and a skipped day has nothing to compare.
check(
  "the delta only renders on a finished, unskipped day",
  /const delta = !skippedNow && \(checked \|\| allLogged\)/.test(app),
  "the delta must not appear on partial or skipped days"
);
// .wc-delta must stay an inline token. Turning it back into a flex column (the
// first design) breaks the meta line's single row on every finished card.
const deltaRule = css.match(/^\.wc-delta\s*\{([^}]*)\}/m);
check(
  ".wc-delta is an inline token, not a flex column",
  !!deltaRule && !/display:\s*flex/.test(deltaRule[1]),
  deltaRule ? "rule was: " + deltaRule[1].trim() : ".wc-delta rule not found"
);
// .wc-actions must be a SIBLING of .workout-card-body, not inside it: inside,
// it lands under the meta line, which on a two-line card is still mid-card.
// Walk the div depth from the body's opening tag to find where the body closes.
function bodyClosesAt(html) {
  const open = html.indexOf('<div class="workout-card-body">');
  if (open < 0) return -1;
  let depth = 0;
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = open;
  let t;
  while ((t = tag.exec(html))) {
    depth += t[0] === "</div>" ? -1 : 1;
    if (depth === 0) return t.index;
  }
  return -1;
}
const closeAt = bodyClosesAt(template);
const actionsAt = template.indexOf('class="wc-actions"');
check(
  ".wc-actions sits outside .workout-card-body",
  closeAt > -1 && actionsAt > closeAt,
  `body closes at ${closeAt}, .wc-actions at ${actionsAt} — it must be a sibling ` +
  "beside the body, not stacked under the meta line"
);

// ---- 2. The CSS: no invisible hit box on either control ----
// Any rule targeting .wc-skip / .wc-move with a negative vertical margin is the
// exact shape of the bug, whatever media block it lives in.
const RULE = /([^{}]*\.wc-(?:skip|move)[^{}]*)\{([^}]*)\}/g;
let m, negatives = [];
while ((m = RULE.exec(css))) {
  const [, selector, body] = m;
  // `margin: A B C D` / `margin-top:` / `margin-bottom:` with a negative value.
  const shorthand = body.match(/margin:\s*([^;]+);/);
  const vertNeg =
    /margin-top:\s*-/.test(body) ||
    /margin-bottom:\s*-/.test(body) ||
    (shorthand && /^-/.test(shorthand[1].trim().split(/\s+/)[0])) ||
    (shorthand && shorthand[1].trim().split(/\s+/).length >= 3 &&
      /^-/.test(shorthand[1].trim().split(/\s+/)[2]));
  if (vertNeg) negatives.push(selector.trim() + " { " + body.trim() + " }");
}
check(
  "no negative vertical margin on .wc-skip / .wc-move",
  negatives.length === 0,
  negatives.join("\n       ")
);

// The controls must be blockified (flex items or inline-flex) so their padding
// lays out. An inline span's vertical padding hit-tests without taking space.
["wc-skip", "wc-move"].forEach((cls) => {
  const rule = css.match(new RegExp("\\.(?:" + cls + ")\\s*\\{([^}]*)\\}"));
  check(
    "." + cls + " is inline-flex (its padding must take real space)",
    !!rule && /display:\s*inline-flex/.test(rule[1]),
    rule ? "display was: " + (rule[1].match(/display:[^;]*/) || ["(none)"])[0] : "rule not found"
  );
});

const actions = css.match(/\.wc-actions\s*\{([^}]*)\}/);
check(".wc-actions exists in styles.css", !!actions);
if (actions) {
  check(".wc-actions is a flex container", /display:\s*flex/.test(actions[1]));
  check(".wc-actions is a column beside the body", /flex-direction:\s*column/.test(actions[1]),
    "a row under the meta is still mid-card — that measured as no fix at all");
}

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
