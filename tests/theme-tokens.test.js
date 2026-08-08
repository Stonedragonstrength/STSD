// theme-tokens — every theme can still build the obsidian surface recipe.
//
// This earns a test because it fails INVISIBLY. You change :root, open the
// default blue theme, and it looks perfect. Black and White carry their own
// surfaces and their own alphas, and nobody opens them until an athlete does.
// A dozen-odd themes x six tokens is not something you verify by looking at a
// screen — and a hardcoded count here would itself go stale on theme twelve.
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
const COLOUR_THEMES = ["red", "orange", "green", "teal", "purple", "yellow", "pink", "sapphire"];

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

// ---- 4. the colour themes must NOT redefine the recipe -------------------
// They inherit it. A local override here is how the colour themes drift apart.
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

// ---- 7. the colour themes sit on the OBSIDIAN floor, not the old one ------
// Section 4 above only stops a colour theme redefining the six RECIPE tokens.
// It says nothing about the BASE surfaces each theme defines for itself, and
// that is exactly where these themes drifted: the obsidian branch deepened
// :root and the seven colour themes inherited the recipe while keeping their
// old, lighter base. Nobody saw it, because you open blue, it looks perfect,
// and the other nine are somebody else's problem. Measured at the time: a
// secondary .btn (--surface-3) against a --face-inset tile was 1.10:1 on blue
// but 1.61:1 on teal, 1.59 green, 1.54 yellow -- the same control reading as a
// whisper on one theme and a raised slab on another.
//
// So: every base surface a colour theme defines must sit at the same DEPTH as
// blue's, measured as WCAG contrast against --face-inset (the near-black
// substrate every theme inherits, which is what these surfaces actually sit
// against once waves 1-2 are applied).
//
// THRESHOLD: 0.10 of contrast ratio, per slot.
//   - The derived values' worst real drift is 0.009 (teal --bg), where 8-bit
//     sRGB simply cannot express a cast that dark at blue's luminance. 0.10 is
//     ~11x that, so rounding can never trip this.
//   - The regression it exists to catch was far larger: on the old values the
//     MILDEST of the seven (purple) was still 0.137 out at --surface-3 and
//     0.360 at --border; teal and green ran to 2.5-2.75 at --border-strong.
//   So the gap between "correctly derived" and "left on the old floor" is
//   about 15x, and 0.10 sits in the middle of it.
const BASE_SURFACES = [
  "--bg", "--bg-2", "--surface", "--surface-2",
  "--surface-3", "--surface-elevate", "--border", "--border-strong",
];
const DEPTH_TOLERANCE = 0.1;

function hexToRgb(v) {
  const m = /^#([0-9a-f]{6})$/i.exec((v || "").trim());
  if (!m) return null;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}
// WCAG 2.x relative luminance + contrast ratio.
function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  if (x === null || y === null) return null;
  return x > y ? (x + 0.05) / (y + 0.05) : (y + 0.05) / (x + 0.05);
}

if (root) {
  const faceInset = valueOf(root, "--face-inset");
  check(
    ":root --face-inset is a plain hex the depth check can measure",
    hexToRgb(faceInset) !== null,
    "found: " + faceInset
  );

  if (hexToRgb(faceInset)) {
    for (const th of COLOUR_THEMES) {
      const b = block(':root[data-theme="' + th + '"]');
      if (!b) continue;
      for (const slot of BASE_SURFACES) {
        // A theme is allowed to inherit a slot outright; only what it
        // REdefines has to be on the obsidian floor.
        if (!defines(b, slot)) continue;
        const themeVal = valueOf(b, slot);
        const blueVal = valueOf(root, slot);
        if (!hexToRgb(themeVal) || !hexToRgb(blueVal)) {
          check(
            "theme " + th + " " + slot + " is a plain hex",
            false,
            "theme: " + themeVal + ", :root: " + blueVal
          );
          continue;
        }
        const themeC = contrast(themeVal, faceInset);
        const blueC = contrast(blueVal, faceInset);
        check(
          "theme " + th + " " + slot + " is at obsidian depth",
          Math.abs(themeC - blueC) <= DEPTH_TOLERANCE,
          slot + " " + themeVal + " sits at " + themeC.toFixed(2) +
            ":1 against --face-inset but :root's " + blueVal + " sits at " +
            blueC.toFixed(2) + ":1 (drift " + Math.abs(themeC - blueC).toFixed(2) +
            " > " + DEPTH_TOLERANCE + "). The colour themes inherit the obsidian " +
            "recipe but define their own base surfaces -- deepen this one to " +
            "match, keeping its own hue and saturation."
        );
      }
    }
  }
}

// ---- 8. the app's themes and the widget's accents stay in step ------------
// THEMES (app.js) and ACCENTS (Theme.kt) are two hand-synced id lists with
// nothing else asserting parity — sapphire landed in both, but the next theme
// can land in one and the two products quietly stop matching. Colour themes
// map 1:1 by id; the neutrals are named differently on purpose (the app's
// Black/White are the widget's Slate/Ink), so those four are exempt.
const appJs = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const themeKt = fs.readFileSync(
  path.join(__dirname, "..", "android-widget", "app", "src", "main",
    "java", "com", "stonedragon", "schedule", "Theme.kt"),
  "utf8"
);
const themesBlock = /const THEMES = \[([\s\S]*?)\];/.exec(appJs);
check("app.js THEMES list found", themesBlock !== null);
const appIds = themesBlock
  ? [...themesBlock[1].matchAll(/id:\s*"([a-z]+)"/g)].map((m) => m[1])
  : [];
const widgetIds = [...themeKt.matchAll(/Accent\("([a-z]+)"/g)].map((m) => m[1]);
check("app.js THEMES parsed non-empty", appIds.length > 0);
check("Theme.kt ACCENTS parsed non-empty", widgetIds.length > 0);
const APP_NEUTRALS = ["black", "white"];
const WIDGET_NEUTRALS = ["slate", "ink"];
for (const id of appIds.filter((i) => !APP_NEUTRALS.includes(i))) {
  check(
    "widget has an accent for app theme " + id,
    widgetIds.includes(id),
    "add an Accent(\"" + id + "\", …) pair to android-widget Theme.kt"
  );
}
for (const id of widgetIds.filter((i) => !WIDGET_NEUTRALS.includes(i))) {
  check(
    "app has a theme for widget accent " + id,
    appIds.includes(id),
    "add { id: \"" + id + "\", … } to THEMES in app.js"
  );
}

if (failures) {
  console.error("\n" + failures + " check(s) failed.");
  process.exit(1);
}
console.log("theme-tokens: all checks passed.");
