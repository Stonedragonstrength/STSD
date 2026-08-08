// theme-tokens — every theme can still build the obsidian surface recipe.
//
// This earns a test because it fails INVISIBLY. You change :root, open the
// default blue theme, and it looks perfect. Black and White carry their own
// surfaces and their own alphas, and nobody opens them until an athlete does.
// Ten themes x six tokens is not something you verify by looking at a screen.
//
// Run: node tests/theme-tokens.test.js

const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

let failures = 0;
function check(name, cond, detail) {
  if (cond) return;
  failures++;
  console.error("FAIL: " + name + (detail ? " -- " + detail : ""));
}

// Body of a :root or :root[data-theme="x"] block. These blocks contain no
// nested braces, so the first closing brace ends them.
function block(selector) {
  const i = css.indexOf(selector + " {");
  if (i === -1) return null;
  const start = css.indexOf("{", i);
  const end = css.indexOf("}", start);
  return css.slice(start + 1, end);
}

// `--face` must not match `--face-inset`: the trailing ":" after optional
// whitespace is what separates them.
function defines(body, token) {
  return new RegExp(token + "\\s*:").test(body);
}
function valueOf(body, token) {
  const m = new RegExp(token + "\\s*:([^;]*);").exec(body);
  return m ? m[1].trim() : null;
}

const RECIPE = ["--face", "--face-inset", "--edge", "--edge-lit", "--halo", "--lift"];
const BUTTON = ["--btn-face", "--btn-ink"];
const COLOUR_THEMES = ["red", "orange", "green", "teal", "purple", "yellow", "pink"];

// ---- 1. :root defines the whole recipe -----------------------------------
const root = block(":root");
check(":root block found", root !== null);
if (root) {
  for (const t of RECIPE.concat(BUTTON)) {
    check(":root defines " + t, defines(root, t));
  }
}

// ---- 2. accent-derived tokens use the theme channels ---------------------
// If one of these hardcodes a hex, a theme swap leaves the old colour behind
// and only that theme looks wrong.
if (root) {
  for (const t of ["--edge", "--edge-lit", "--halo", "--face"]) {
    const v = valueOf(root, t);
    if (v === null) continue;
    check(
      ":root " + t + " is built from the theme channels",
      /var\(--primary(-bright)?-rgb\)/.test(v),
      "found: " + v
    );
  }
}

// ---- 3. every theme still supplies the channels the recipe reads ---------
for (const th of COLOUR_THEMES.concat(["black", "white"])) {
  const b = block(':root[data-theme="' + th + '"]');
  check("theme " + th + " exists", b !== null);
  if (!b) continue;
  check("theme " + th + " defines --primary-rgb", defines(b, "--primary-rgb"));
  check("theme " + th + " defines --primary-bright-rgb", defines(b, "--primary-bright-rgb"));
}

// ---- 4. the eight colour themes must NOT redefine the recipe -------------
// They inherit it. A local override here is how the ten themes drift apart.
for (const th of COLOUR_THEMES) {
  const b = block(':root[data-theme="' + th + '"]');
  if (!b) continue;
  for (const t of RECIPE) {
    check(
      "theme " + th + " inherits " + t + " rather than overriding it",
      !defines(b, t),
      "colour themes only override --primary*; surfaces come from :root"
    );
  }
}

// ---- 5. Black retunes its alphas ----------------------------------------
// Its --primary-rgb is slate. At :root's alphas that wash disappears against
// near-black, so Black must set its own.
const black = block(':root[data-theme="black"]');
if (black) {
  for (const t of ["--face", "--face-inset", "--edge", "--edge-lit", "--halo"]) {
    check(
      "black retunes " + t,
      defines(black, t),
      "slate at :root's alpha is invisible on near-black"
    );
  }
}

// ---- 6. White inverts the physics ---------------------------------------
const white = block(':root[data-theme="white"]');
if (white) {
  for (const t of RECIPE.concat(BUTTON)) {
    check(
      "white redefines " + t,
      defines(white, t),
      "white is the light theme -- it cannot inherit dark-surface values"
    );
  }
  const halo = valueOf(white, "--halo");
  check(
    "white's halo is explicitly off",
    halo !== null && /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(halo),
    "a glow on white reads as smudge; use a zero-alpha shadow, not `none` " +
      "(`none` inside a comma-separated box-shadow list is invalid and kills " +
      "the whole declaration). found: " + halo
  );
}

if (failures) {
  console.error("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("theme-tokens: all checks passed.");
