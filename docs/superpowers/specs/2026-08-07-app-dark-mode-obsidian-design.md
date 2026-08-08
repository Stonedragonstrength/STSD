# App dark mode — "Obsidian & ember"

**Date:** 2026-08-07
**Status:** design approved, not implemented

## Why

The web app's dark mode reads cheap. Asked to name it specifically, Nathan named
all four of: flat panels everywhere, a dead background, weak edges and
separation, and a drab base colour.

A *Forged-steel facelift* landed 2026-07-14 (`styles.css:9599`) and was real,
but it reached only four selectors — `.card`, `.client-row`, `.week-card`,
`.modal-card`. Everything *inside* those cards stayed flat. There are **283
distinct classes** still painting a flat `background: var(--surface…)`, and the
page backdrop's accent glow sits at 0.035 alpha, which is invisible.

The Android widget had the same complaint ("lacklustre") and was fixed
2026-08-07 with four cheap, bitmap-free moves: a gradient in the surface itself,
a hairline stroke, a richer blue-black, and an accent-tinted glow in one corner.
This pass brings that thinking to the app, in a more dramatic direction Nathan
picked from mockups.

## Direction

**Obsidian & ember**, chosen from three rendered options. A near-black canvas
where the theme colour behaves as an actual light source: accent-tinted card
faces, crisp lit edges, and numerals that emit.

**Scope: all ten themes**, hand-tuned where needed. No theme is excluded.

## Architecture

### 1 · The recipe becomes tokens

The look is expressed **once** in `:root` as values, not rules:

| Token | Role |
|---|---|
| `--face` | card face — accent wash over near-black |
| `--face-inset` | rows, tiles, chips sitting *inside* a card |
| `--edge` | default border |
| `--edge-lit` | the lit top edge |
| `--halo` | outer accent glow |
| `--lift` | depth shadow |

Every value is built from `rgba(var(--primary-rgb), …)` and
`rgba(var(--primary-bright-rgb), …)`. Never a hardcoded hex.

Concrete starting values, taken from the approved mockup (default blue theme):

```css
--face:       linear-gradient(135deg, rgba(var(--primary-rgb), .14),
                              rgba(9, 12, 19, 0) 54%), #080b12;
--face-inset: #0b0f18;
--edge:       rgba(var(--primary-rgb), .26);
--edge-lit:   rgba(var(--primary-bright-rgb), .5);
--halo:       0 0 26px -10px rgba(var(--primary-rgb), .5);
--lift:       0 14px 34px rgba(0, 0, 0, .78);
```

Page canvas: `#010204` with
`radial-gradient(75% 48% at 50% 108%, rgba(var(--primary-rgb), .20), transparent 68%)`.

Emitting numerals (percentages, stat values) carry
`text-shadow: 0 0 15px rgba(var(--primary-bright-rgb), .55)`; the progress fill
carries `box-shadow: 0 0 10px rgba(var(--primary-bright-rgb), .7)`.

This is what makes 283 classes tractable: they stop naming colours and start
naming roles.

### 2 · Per-theme tuning

- **Eight colour themes** inherit `:root` wholesale. No per-theme work.
- **Black** overrides *only the alphas*. Its `--primary-rgb` is slate
  (`148,163,184`), so it is lit in silver rather than cyan — which is correct for
  a deliberately neutral theme, and means nothing blue leaks in. Slate at 14%
  disappears against near-black, so the wash drops to ~10% and the rim brightens.
- **White** — the one light theme — overrides the whole token set with inverted
  physics: the light source becomes a tinted wash plus a real shadow, edges
  *darken* instead of brightening, and halos go to zero (a glow on white reads as
  smudge).

### 3 · The base deepens

`:root` surfaces move into the obsidian range (canvas `#010204`, card face
`#080b12`). The eight colour themes follow automatically. Black and White keep
their own surface families, retuned as above.

### 4 · Fold into the July facelift — do not stack on it

The *Forged-steel facelift* block at `styles.css:9599` is **rewritten** to
consume the new tokens. A third competing card-styling layer would guarantee
specificity fights later.

### 5 · Buttons

Primary buttons become **black with a sheen across the top third**, a lit rim,
an outer halo, and light ink — the treatment that lets the glow actually read.
The silver/bright fill was brighter than its own halo, which is why the glow was
invisible.

Two structural problems to fix while here:

- **`.btn-primary` is defined twice** — `styles.css:226` and `styles.css:5157`.
  The second adds glow, hover lift and a sheen sweep. Both must be reconciled
  into one definition or the later silently wins.
- **On-primary ink is hardcoded** `color: #062131`, which assumes a *bright*
  button. Going dark inverts this everywhere. The White-theme patch at
  `styles.css:143` (`.btn-primary { color: #fff }`) exists only because White's
  primary is near-black — it is re-examined, not preserved by default.

Concrete button face (default blue theme; scales by `--primary-rgb`):

```css
background: linear-gradient(180deg, rgba(var(--primary-bright-rgb), .17),
                            rgba(8, 13, 20, 0) 46%), #080d14;
border: 1px solid rgba(var(--primary-bright-rgb), .35);
border-top-color: rgba(var(--primary-bright-rgb), .85);
box-shadow: 0 0 26px -6px rgba(var(--primary-bright-rgb), .45),
            inset 0 1px 0 rgba(255, 255, 255, .16);
```

**Reach:** all ten themes, both roles — **except** actions an athlete taps
mid-workout, which keep the solid fill so they stay unmistakably tappable.
These opt *out* via a `.btn-solid` class rather than being enumerated in CSS;
a rule outlives a list. The exact set is settled during implementation by
walking the athlete workout flow — indicatively set logging, day completion and
the rest timer, but the flow decides, not this list.

### 6 · Motion

**No new animation.** The existing hover sheen-sweep, press states and
`prefers-reduced-motion` blocks are kept as-is. Animated glows have a history of
strobing on Android GPUs where desktop Chrome hides the problem entirely, and
decoration is not worth reopening it.

**Consequence for touch devices:** there are 4 `@media (pointer: coarse)` blocks,
and hover never fires on a tablet or phone. The button's hover halo and sheen are
therefore *invisible* on touch. **The resting state must carry the whole look** —
hover is a desktop bonus, never the thing that makes a button look finished.

## Rollout

Three waves, one commit each, verified in the browser between them.

| Wave | Covers |
|---|---|
| 1 · Chrome | body backdrop (0.035 → a real accent pool), `.app-header`, `.coach-nav`, and the rewritten facelift block |
| 2 · The long tail | rows, tiles, chips, list items → `--face-inset`, via grouped selectors. The bulk of the 283 |
| 3 · Controls | buttons, inputs, modals, sheets |

## Verification

Per wave, in a real browser — not a harness.

**Themes:** blue (default), **black**, **white**. White first, not last, because
it inverts every "low-alpha white sheen" assumption the dark themes rely on.

**Roles:** coach *and* athlete. Chrome is shared but fixes drift; check all three
`.pref-card` hosts.

**Widths** — the app's own breakpoints, not generic ones:

| Band | Width | Note |
|---|---|---|
| Phone | 380–720 | finest breakpoints at 380/400/420/480/560/600 |
| Tablet portrait | 768 | sits *below* the `min-width: 900px` rules |
| Tablet landscape | 1024 | sits *above* them — a different layout |
| Desktop | ≥1200 | `min-width: 1200px` rules apply |

Tablet is **two** checks, not one: 900px is a layout boundary and an iPad crosses
it by rotating. Both bands are also `pointer: coarse`, so verify the resting
state reads correctly with no hover available.

**Deploy:** bump the `?v=` query strings in `index.html` so installed PWAs pick
up the new CSS. `sw.js` itself is unchanged, so its `CACHE` name stays.

## Risks

- **White is the highest-risk theme.** Every low-alpha white sheen assumption
  inverts there.
- **The ink flip touches every button in the app** (27 `.btn-primary` in
  `index.html`, ~105 more rendered from `app.js`). Most likely source of a
  dark-on-dark surprise.
- **Black must stay neutral.** Any blue leaking in from `:root` undoes a
  deliberate design decision.
- Both roles' markup ships to every client, so duplicate ids can hand a renderer
  an invisible element. Verify rendered output, not just the stylesheet.

## Out of scope

- The Android widget's palette — deliberately different from the app's; not
  touched.
- Any layout, spacing or copy change. This is colour, surface and depth only.
