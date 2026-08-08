# App dark mode — "Obsidian & ember" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's flat dark mode with a near-black "obsidian" surface
system where the theme colour acts as a light source, across all ten themes.

**Architecture:** The look is expressed once in `:root` as six role-named CSS
custom properties built from `rgba(var(--primary-rgb), …)`. The eight colour
themes inherit it for free; Black retunes only its alphas, White overrides the
set with inverted physics. Components then consume tokens instead of naming
colours, applied in three waves.

**Tech stack:** Vanilla CSS, no build step, no bundler. Node for the one test.

**Spec:** `docs/superpowers/specs/2026-08-07-app-dark-mode-obsidian-design.md`

## Global Constraints

- **Never hardcode an accent hex.** Every accent value is
  `rgba(var(--primary-rgb), a)` or `rgba(var(--primary-bright-rgb), a)`.
- **Ten themes.** Eight colour themes inherit `:root`. `:root[data-theme="black"]`
  and `:root[data-theme="white"]` carry their own surfaces and must be retuned
  explicitly. White **is** the light theme — there is no `data-theme="light"`.
- **No new animation.** Existing hover sheen, press states and the eight
  `prefers-reduced-motion` blocks stay as they are.
- **The resting state carries the look.** There are 4 `@media (pointer: coarse)`
  blocks; hover never fires on phone or tablet. A button must look finished with
  no hover applied.
- **Bump `?v=` in `index.html` on every edit-retest cycle** or the service worker
  serves the stale stylesheet and a working change looks broken.
- **Verify in the real app**, never a standalone harness — a harness can pass a
  rule the app silently drops. Use the repo's `STSD:verify` skill.
- **Responsive testing uses same-origin iframes.** `resize_window` reports success
  without shrinking the viewport, so media queries never fire and a responsive
  check passes without testing anything.
- Commit after each task. Push only at the end of Task 6.
- **Every line number in this plan is measured against `styles.css` as it stands
  before Task 1.** Task 1 grows the `:root` block by roughly 17 lines, so every
  citation after it drifts by about that much. **Locate rules by their selector
  and content, never by jumping to a line number.** The line numbers are
  orientation, not addresses.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `styles.css` | All styles; `:root` + theme blocks at lines 13–145 | Modified in Tasks 1–4 |
| `tests/theme-tokens.test.js` | Guards that all ten themes can still build the recipe | **Created** in Task 1 |
| `index.html` | `?v=` cache-busting strings | Modified each task |
| `app.js` | Renders ~105 `.btn-primary`; mid-workout actions get `.btn-solid` | Modified in Task 5 |

`styles.css` is 14,462 lines and the repo's established pattern is one large
stylesheet. Do **not** split it — that is out of scope and would bury the change.

---

### Task 1: The recipe becomes tokens, guarded by a test

The tokens are the whole foundation: every later task consumes them. They also
fail invisibly — you change `:root`, look at the default blue theme, and it is
perfect, while Black and White carry their own values and nobody opens them
until an athlete does. Ten themes × six tokens is not something you check by
looking, which is exactly what this repo's `tests/README.md` says earns a test.

**Files:**
- Create: `tests/theme-tokens.test.js`
- Modify: `styles.css:13-60` (`:root`), `styles.css:101-106` (black), `styles.css:116-129` (white)

**Interfaces:**
- Produces: six custom properties available to every later task —
  `--face`, `--face-inset`, `--edge`, `--edge-lit`, `--halo`, `--lift`;
  plus `--btn-face` and `--btn-ink` consumed by Task 4.
  `--halo` and `--lift` are **composable box-shadow values**, always used as
  `box-shadow: var(--lift), var(--halo)`. White sets a zero-alpha halo rather
  than `none`, because `none` in a comma list is invalid CSS and would kill the
  whole declaration.

- [ ] **Step 1: Write the failing test**

Create `tests/theme-tokens.test.js`:

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node tests/theme-tokens.test.js
```

Expected: **exactly 22 failures**, exit 1, beginning `FAIL: :root defines --face`
and ending `FAIL: white's halo is explicitly off -- found: null`.

Sections 3 and 4 must report **no** failures even now — all nine theme blocks
already exist and define their channels, and no colour theme overrides a recipe
token. If either of those fires, something unrelated to this work is already
broken and should be understood before continuing.

(This expectation was produced by running the test against the current
`styles.css`, not estimated.)

- [ ] **Step 3: Add the recipe to `:root`**

In `styles.css`, inside the `:root` block, replace the six surface lines
(`--bg` through `--border-strong`, currently lines 14–21) with the deepened base
and append the recipe before the closing `}`:

```css
  /* Obsidian base. The eight colour themes inherit this wholesale; Black and
     White carry their own and are retuned below. */
  --bg: #010204;
  --bg-2: #04070e;
  --surface: #080b12;
  --surface-2: #0b0f18;
  --surface-3: #131a2b;
  --surface-elevate: #1c2740;
  --border: #22304e;
  --border-strong: #35486f;
```

```css
  /* ---- Obsidian & ember: the surface recipe, defined once ----
     These name ROLES, not colours, which is what makes ~283 flat surfaces
     tractable. Every accent value reads the theme channels, so a theme swap
     re-lights the whole app without touching a component rule.
     --halo and --lift are composable: always `box-shadow: var(--lift), var(--halo)`. */
  --face: linear-gradient(135deg, rgba(var(--primary-rgb), 0.14), rgba(9, 12, 19, 0) 54%), #080b12;
  --face-inset: #0b0f18;
  --edge: rgba(var(--primary-rgb), 0.26);
  --edge-lit: rgba(var(--primary-bright-rgb), 0.5);
  --halo: 0 0 26px -10px rgba(var(--primary-rgb), 0.5);
  --lift: 0 14px 34px rgba(0, 0, 0, 0.78);
  /* Primary buttons go dark so the halo has somewhere to land — a bright fill
     is brighter than its own glow, which is why the glow was invisible. */
  --btn-face: linear-gradient(180deg, rgba(var(--primary-bright-rgb), 0.17), rgba(8, 13, 20, 0) 46%), #080d14;
  --btn-ink: #eef2f8;
```

- [ ] **Step 4: Retune Black**

Append inside `:root[data-theme="black"]` (styles.css:101):

```css
  /* Slate at :root's alphas disappears against near-black — this theme needs
     more wash and a brighter rim to read at all. It is lit in silver because
     its primary IS silver; nothing blue may leak in. */
  --face: linear-gradient(135deg, rgba(var(--primary-rgb), 0.10), rgba(9, 12, 19, 0) 54%), #0a0a0d;
  --face-inset: #111116;
  --edge: rgba(var(--primary-rgb), 0.20);
  --edge-lit: rgba(var(--primary-bright-rgb), 0.42);
  --halo: 0 0 26px -12px rgba(var(--primary-rgb), 0.35);
```

- [ ] **Step 5: Invert the physics for White**

Append inside `:root[data-theme="white"]` (styles.css:116):

```css
  /* The light theme. The "light source" becomes a tinted wash plus a real
     shadow; edges DARKEN instead of brightening; halos go off entirely,
     because a glow on white reads as smudge. The halo is a zero-alpha shadow
     rather than `none` — `none` in a comma list invalidates the declaration. */
  --face: linear-gradient(135deg, rgba(var(--primary-rgb), 0.055), rgba(255, 255, 255, 0) 54%), #ffffff;
  --face-inset: #f4f7fb;
  --edge: rgba(var(--primary-rgb), 0.16);
  --edge-lit: rgba(var(--primary-rgb), 0.26);
  --halo: 0 0 0 0 rgba(0, 0, 0, 0);
  --lift: 0 10px 26px rgba(15, 23, 42, 0.10);
  --btn-face: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0) 46%), #1e293b;
  --btn-ink: #ffffff;
```

- [ ] **Step 6: Run the test until it passes**

```bash
node tests/theme-tokens.test.js
```

Expected: `theme-tokens: all checks passed.`, exit 0.

- [ ] **Step 7: Confirm the existing suite is untouched**

```bash
for f in tests/*.test.js; do node "$f" || echo "BROKE: $f"; done
```

Expected: every file prints its own pass line; no `BROKE:` lines.

- [ ] **Step 8: Commit**

```bash
git add tests/theme-tokens.test.js styles.css
git commit -m "The obsidian recipe, as six tokens every theme can read

Roles, not colours: --face, --face-inset, --edge, --edge-lit, --halo, --lift.
The eight colour themes inherit them; Black retunes its alphas because slate
disappears on near-black, and White inverts the physics.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Wave 1 — the chrome

Biggest visible change, smallest blast radius. The page canvas, the two sticky
bars, and the four selectors the July facelift already reached.

**Files:**
- Modify: `styles.css:155-157` (body backdrop), `styles.css:427-444` (`.app-header`),
  `styles.css:5418-5434` (`.coach-nav`), `styles.css:9588-9796` (facelift block)
- Modify: `index.html` (`?v=` bump)

**Interfaces:**
- Consumes: all six tokens from Task 1.

- [ ] **Step 1: Give the page a real light source**

`styles.css:155-157` — the current glow is 0.035/0.02 alpha, i.e. invisible.
Replace the two `radial-gradient` lines in the `html, body` rule:

```css
  background-image:
    radial-gradient(75% 48% at 50% 108%, rgba(var(--primary-rgb), 0.20) 0%, transparent 68%),
    radial-gradient(60% 40% at 8% -6%, rgba(var(--primary-bright-rgb), 0.07) 0%, transparent 62%);
```

- [ ] **Step 2: Rewrite the facelift block's card rule**

`styles.css:9598-9607` — replace the `.card, .client-row, .week-card, .modal-card`
rule so it consumes tokens instead of naming colours:

```css
/* -------- 1 · Layered cards: accent-lit face + lit edge + depth ---------- */
.card,
.client-row,
.week-card,
.modal-card {
  background: var(--face);
  border: 1px solid var(--edge);
  border-top-color: var(--edge-lit);
  box-shadow: var(--lift), var(--halo);
}
```

Leave the rest of the block (sections 2–7: hairlines, energy rails, plate
meters, calendar washes, notched buttons, superset spine) alone for now —
section 6's button work is Task 4.

- [ ] **Step 3: Re-light the two sticky bars**

`.app-header` (styles.css:432-434) already has a glass recipe. Swap its bloom
and fade for the obsidian values, keeping the blur and the fading hairline:

```css
  background:
    radial-gradient(560px 110px at 8% 130%, rgba(var(--primary-rgb), 0.18), transparent 70%),
    linear-gradient(180deg, color-mix(in srgb, var(--surface-2) 88%, transparent), color-mix(in srgb, var(--bg) 92%, transparent));
```

`.coach-nav` (styles.css:5424) — match it:

```css
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface-2) 76%, transparent), color-mix(in srgb, var(--bg) 88%, transparent));
```

- [ ] **Step 4: Bump the stylesheet version**

In `index.html`, change `styles.css?v=colr1` to `styles.css?v=obsid1`.

- [ ] **Step 5: Start the sandbox**

Write `sandbox-server.js` to the scratchpad (NOT the repo) and run it:

```js
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = "C:/Users/Natha/OneDrive/Desktop/Stone Dragon Strength Training/STSD";
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff2": "font/woff2", ".webp": "image/webp", ".jpg": "image/jpeg" };
http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/config.js") {                       // <- disables Cloud, enables offline boot
    res.writeHead(200, { "Content-Type": "application/javascript" });
    return res.end("window.STONE_DRAGON_CONFIG = {};");
  }
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(buf);
  });
}).listen(5191, () => console.log("sandbox on http://localhost:5191"));
```

Never seed or mutate data on port 5190 — the real coach data lives in that
origin's localStorage.

- [ ] **Step 6: Seed a coach and unregister the service worker**

In the browser tab on `http://localhost:5191`:

```js
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
localStorage.setItem("trainerpro_data_v1", JSON.stringify({
  trainer: { name: "Test Coach", email: "test@example.com" },
  clients: [{ id: "testc1", name: "Test Athlete",
    weeks: [{ id: "w1", label: "Week 1", focus: "", phaseLabel: "", days: [
      { id: "d1", name: "Day 1", exercises: [] }] }] }]
}));
sessionStorage.setItem("trainerpro_session_v1", "trainer");
localStorage.setItem("trainerpro_tour_coach_v1", "done");
location.reload();
```

- [ ] **Step 7: Verify on all three critical themes**

Screenshot the coach dashboard on each. Switch theme by setting the key and
reloading — blue is the default and sets **no** `data-theme` attribute:

```js
localStorage.setItem("trainerpro_theme_v1", '{"coach":"black"}'); location.reload();
localStorage.setItem("trainerpro_theme_v1", '{"coach":"white"}'); location.reload();
localStorage.removeItem("trainerpro_theme_v1");                  location.reload();  // blue
```

Check **White first**, not last — it inverts every low-alpha-white-sheen
assumption the dark themes rely on. Expected: cards have a visible lit top edge
and an accent-tinted face on all three; White shows no glow or smudge; Black
shows silver light with no blue cast.

- [ ] **Step 8: Commit**

```bash
git add styles.css index.html
git commit -m "Wave 1: the chrome learns where the light comes from

The page backdrop had its accent at 0.035 alpha, which is invisible. Cards,
header and nav now read the tokens, so the canvas has a real pool of light and
a panel has a lit edge instead of a flat rule.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Wave 2 — the long tail

283 distinct classes still paint a flat `background: var(--surface…)`. These are
the rows, tiles and chips *inside* cards — the thing that made the July facelift
look unfinished.

**Files:**
- Modify: `styles.css` (append a new section immediately after the facelift
  block, at what is currently line 9796)
- Modify: `index.html` (`?v=` bump)

**Interfaces:**
- Consumes: `--face-inset`, `--edge`, `--edge-lit` from Task 1.

- [ ] **Step 1: Find the real selector list**

```bash
awk '/\{[[:space:]]*$/{sel=$0;sub(/[[:space:]]*\{[[:space:]]*$/,"",sel)} /background:[[:space:]]*var\(--surface/{if(sel!="")print sel}' styles.css \
  | sed 's/^[[:space:]]*//' | sort -u > /tmp/inset-selectors.txt
wc -l /tmp/inset-selectors.txt
```

Expected: ~283 lines. This is the working list — do not guess at it.

- [ ] **Step 2: Add the inset rule**

Append a new section after the facelift block. Group the selectors from Step 1
that are genuinely *inside* a card (rows, tiles, chips, list items, pickers).
Exclude inputs, textareas and selects — those are Task 4.

```css
/* ==========================================================================
   Obsidian, wave 2 — the surfaces INSIDE a card
   The July facelift reached four outer selectors; everything nested in them
   stayed a flat slab, which is what made the whole thing read cheap. These
   consume --face-inset so a theme swap re-lights them too.
   ========================================================================== */
.client-row-view, .coach-row, .wk-row, .wkg-head, .rec-card, .food-tile,
.food-result, .food-nav, .ex-lib-item, .ex-lib-sb-cat, .dash-cal-day,
.grid-picker-cell, .demo-pick, .video-pick-btn, .role-btn, .tour-card,
.records-tab, .day-icon-btn, .day-note-toggle, .cex-set-col, .cd-col,
.rest-timer-pop, .ex-demo-preview, .status-unpaid, .rec-reroll,
.ex-cat-move-btn, .dvs-act {
  background: var(--face-inset);
  border: 1px solid var(--edge);
  border-top-color: var(--edge-lit);
}
```

Then walk the remainder of `/tmp/inset-selectors.txt` and add any further
in-card surfaces to this selector list. The list above covers the classes that
appear more than once in the audit; the tail is single-use classes.

- [ ] **Step 3: Bump and re-verify**

Change `styles.css?v=obsid1` to `styles.css?v=obsid2` in `index.html`.

- [ ] **Step 4: Verify, including the athlete side**

Reload the sandbox. Check the coach dashboard **and** the athlete portal —
shared chrome drifts, and this wave touches both. Switch role with:

```js
sessionStorage.setItem("trainerpro_session_v1", "client"); location.reload();
```

Also open the Coach Profile (click the coach's **name** in the top-left header —
it is not in the nav) and check all three `.pref-card` hosts.

Expected: no flat slabs left inside cards on any of blue/black/white.

- [ ] **Step 5: Commit**

```bash
git add styles.css index.html
git commit -m "Wave 2: the surfaces inside a card stop being flat slabs

The facelift reached four outer selectors and nothing nested in them, which is
most of what read cheap. Rows, tiles and chips now take --face-inset.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Wave 3 — the dark glowing button

`.btn-primary` is defined **twice** — `styles.css:226` and again at
`styles.css:5157`. The second adds glow, hover lift and a sheen sweep. Both must
be reconciled or the later silently wins.

**Files:**
- Modify: `styles.css:226-233` (base), `styles.css:5157-5170` (glow layer),
  `styles.css:143` (White ink patch)
- Modify: `index.html` (`?v=` bump)

**Interfaces:**
- Consumes: `--btn-face`, `--btn-ink` from Task 1.
- Produces: `.btn-solid` — the opt-out class Task 5 applies in markup.

- [ ] **Step 1: Replace the base `.btn-primary`**

`styles.css:226-233`:

```css
/* Black face, sheen across the top third, lit rim, outer halo. The old bright
   fill was brighter than its own glow, which is why the glow never read. The
   RESTING state carries all of this — hover never fires on touch. */
.btn-primary {
  position: relative;
  overflow: hidden;
  background: var(--btn-face);
  color: var(--btn-ink);
  border: 1px solid rgba(var(--primary-bright-rgb), 0.35);
  border-top-color: rgba(var(--primary-bright-rgb), 0.85);
}
.btn-primary:hover {
  background: var(--btn-face);
  border-top-color: rgba(var(--primary-bright-rgb), 1);
}
```

- [ ] **Step 2: Fold the glow layer into one place**

`styles.css:5157-5170` — replace the second `.btn-primary` box-shadow block:

```css
.btn-primary {
  box-shadow: 0 0 26px -6px rgba(var(--primary-bright-rgb), 0.45),
              inset 0 1px 0 rgba(255, 255, 255, 0.16);
}
.btn-primary:hover {
  box-shadow: 0 0 34px -5px rgba(var(--primary-bright-rgb), 0.62),
              inset 0 1px 0 rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
}
.btn-primary:active {
  transform: scale(0.96) translateY(0);
  box-shadow: 0 0 14px -4px rgba(var(--primary-bright-rgb), 0.5),
              inset 0 2px 6px rgba(0, 0, 0, 0.35);
}
```

Leave `.btn-primary::after` (the sheen sweep) and its `@keyframes sheen`
untouched — it is hover-only and adds no new motion.

- [ ] **Step 3: Add the `.btn-solid` opt-out**

Immediately after the base rule from Step 1:

```css
/* Mid-workout actions keep the solid fill. A dark primary is less obviously
   "the button", which matters when someone is tapping fast between sets. */
.btn-primary.btn-solid {
  background: linear-gradient(180deg, var(--primary-bright), var(--primary));
  border: 1px solid var(--primary-hover);
  color: #062131;
  box-shadow: 0 6px 20px rgba(var(--primary-rgb), 0.35),
              inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
:root[data-theme="white"] .btn-primary.btn-solid { color: #fff; }
```

- [ ] **Step 4: Retire the now-wrong White patch**

`styles.css:143` currently reads:

```css
:root[data-theme="white"] .btn-primary, :root[data-theme="white"] .tab-badge { color: #fff; }
```

The `.btn-primary` half existed only because White's primary is near-black and
the old ink was dark. `--btn-ink` now handles that. Drop it, keep the badge:

```css
:root[data-theme="white"] .tab-badge { color: #fff; }
```

- [ ] **Step 5: Bump and verify with hover disabled**

Change to `styles.css?v=obsid3`. Reload, then confirm the resting state carries
the look — this is the constraint tablets expose:

```js
document.querySelectorAll(".btn-primary").forEach(b => b.style.pointerEvents = "none");
```

Screenshot on blue, black and white. Expected: every primary button reads as a
button with no hover applied — visible rim, visible halo, legible ink. On White
the button is dark slate with white ink (correct for a light theme).

- [ ] **Step 6: Confirm no dark-on-dark ink anywhere**

```js
[...document.querySelectorAll(".btn-primary")].map(b => {
  const s = getComputedStyle(b);
  return { text: b.textContent.trim().slice(0, 24), color: s.color, bg: s.backgroundColor };
});
```

Expected: every entry's `color` is the light ink (or `#062131` on a
`.btn-solid`). Any dark ink on a dark background is a bug — fix before committing.

- [ ] **Step 7: Run the token test**

```bash
node tests/theme-tokens.test.js
```

Expected: still passes — `--btn-face`/`--btn-ink` are covered by it.

- [ ] **Step 8: Commit**

```bash
git add styles.css index.html
git commit -m "Wave 3: primary buttons go black so the glow can be seen

The bright fill was brighter than its own halo. Black face, sheen across the
top third, lit rim. Reconciles the two competing .btn-primary definitions, and
retires the White ink patch that only existed because the ink was hardcoded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Tag the mid-workout actions

The `.btn-solid` class exists but nothing wears it yet. Which buttons qualify is
decided by walking the athlete workout flow, not by guessing from class names —
only `rest-timer` was verifiable from the markup up front.

**Files:**
- Modify: `app.js` (the athlete workout render paths), `index.html` if any
  qualifying button is static
- Modify: `index.html` (`?v=` bump for `app.js`)

**Interfaces:**
- Consumes: `.btn-solid` from Task 4.

- [ ] **Step 1: Walk the flow as an athlete**

```js
sessionStorage.setItem("trainerpro_session_v1", "client"); location.reload();
```

Open a workout day and list every primary button reachable without leaving it:

```js
[...document.querySelectorAll("#screen-client .btn-primary")]
  .map(b => ({ id: b.id, cls: b.className, text: b.textContent.trim().slice(0, 30) }));
```

- [ ] **Step 2: Add `.btn-solid` to the qualifying buttons**

The rule: a button qualifies if an athlete taps it **during** a set or between
sets, when they are not looking carefully. Set logging, day completion and the
rest timer are the expected members; the flow decides.

In `app.js`, add `btn-solid` to those buttons' class strings, e.g.:

```js
// was: class="btn btn-primary"
// now: class="btn btn-primary btn-solid"
```

- [ ] **Step 3: Bump `app.js` and verify**

Change `app.js?v=series1` to `app.js?v=obsid1` in `index.html`. Reload as the
athlete and confirm the tagged buttons show the solid fill while the rest of the
app's primaries stay dark.

- [ ] **Step 4: Commit**

```bash
git add app.js index.html
git commit -m "Mid-workout actions keep the solid fill

Walking the athlete flow rather than guessing from class names. A dark primary
is less obviously the button, and between sets nobody is looking carefully.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The full matrix, then deploy

**Files:**
- Modify: `index.html` only if a fix is needed
- Modify: `styles.css` only if a fix is needed

- [ ] **Step 1: Mount the four real widths as iframes**

`resize_window` reports success without shrinking the viewport, so media queries
never fire and the check passes without testing anything. Iframes are real
viewports:

```js
document.body.innerHTML = "";
[[390, "phone"], [768, "tablet portrait"], [1024, "tablet landscape"], [1280, "desktop"]]
  .forEach(([w, label]) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:inline-block;margin:6px;vertical-align:top";
    wrap.innerHTML = "<div style='font:12px sans-serif;color:#888'>" + label + " · " + w + "</div>";
    const f = document.createElement("iframe");
    f.src = "/index.html";
    f.style.cssText = "width:" + w + "px;height:700px;border:1px solid #333";
    wrap.appendChild(f);
    document.body.appendChild(wrap);
  });
```

**768 and 1024 are both "tablet" and land on opposite sides of the
`min-width: 900px` boundary** — an iPad crosses it by rotating. Both are
required; one is not a proxy for the other.

- [ ] **Step 2: Confirm the widths actually took**

```js
[...document.querySelectorAll("iframe")].map(f => f.contentWindow.innerWidth);
```

Expected: `[390, 768, 1024, 1280]`. If these come back as the parent's width,
the media queries never fired and nothing below was tested.

- [ ] **Step 3: Check for horizontal overflow at every width**

```js
[...document.querySelectorAll("iframe")].map(f => {
  const d = f.contentDocument.documentElement;
  return { w: f.contentWindow.innerWidth, overflows: d.scrollWidth > d.clientWidth };
});
```

Expected: `overflows: false` at all four. The new borders add 2px per surface,
which is exactly the kind of thing that tips a tight row into a scroll.

- [ ] **Step 4: Run the matrix**

3 themes (blue, **black**, white) × 2 roles (coach, athlete) × 4 widths.
Screenshot each. White first within each pass.

- [ ] **Step 5: Run the whole test suite**

```bash
for f in tests/*.test.js; do node "$f" || echo "BROKE: $f"; done
```

Expected: all pass, no `BROKE:` lines.

- [ ] **Step 6: Tear down the sandbox**

Kill the Node server, and clear the seeded storage from the sandbox origin.
Never touch port 5190's storage.

- [ ] **Step 7: Commit any fixes and push**

```bash
git add -A
git commit -m "Obsidian: fixes from the full theme x role x width sweep

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

`git push origin main` **is** the deploy — GitHub Pages publishes from `main`.
The `?v=` bumps from Tasks 2–5 are what get the new CSS to installed PWAs.

---

## Self-Review

**Spec coverage.** Tokens → Task 1. Per-theme tuning for Black and White →
Task 1 Steps 4–5. Base deepening → Task 1 Step 3. Folding into the July facelift
rather than stacking → Task 2 Step 2. Three waves → Tasks 2, 3, 4. Button
reconciliation, ink flip and the White patch → Task 4. `.btn-solid` reach →
Tasks 4 and 5. No new animation → Global Constraints, honoured in Task 4 Step 2.
Verification matrix incl. both tablet bands → Task 6. `?v=` bump → every task.
Deploy → Task 6 Step 7.

**Placeholders.** None. The one genuinely undecidable item — exactly which
buttons count as mid-workout — is Task 5's deliverable with a stated rule and a
command that enumerates the candidates, rather than a guessed list. The wave-2
selector list is generated by a command in Task 3 Step 1 rather than asserted.

**Type consistency.** Six recipe tokens plus `--btn-face`/`--btn-ink` are named
identically in Task 1, the test, and every consuming rule. `--halo`/`--lift` are
used only as `box-shadow: var(--lift), var(--halo)`, which is why White's halo
is a zero-alpha shadow rather than `none`; the test enforces exactly that.
