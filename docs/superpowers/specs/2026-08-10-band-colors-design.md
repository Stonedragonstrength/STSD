# Band colors: which band, as part of what the lift is

2026-08-10

## The problem

A banded lift's resistance is its band, and right now the app cannot say which
one. `Band` exists as a single Equipment tag (`app.js:948`) meaning "a band is
involved" — not yellow, not grey, just *some* band. So a program says "Banded
Row" and the athlete picks whatever is in the rack, the coach has no record of
what was prescribed, and two months of banded work has no load history at all.

Five bands are in use, lightest to heaviest:

**yellow · red · purple · green · grey**

## What we are building

A new single-select **Band** modifier group carrying those five colors, joining
the existing lift-identity machinery so a green-band row and a grey-band row keep
separate progression chains and separate PRs — exactly as a barbell squat and a
dumbbell squat already do.

The coach prescribes it. The chip renders in the band's own color on both the
coach's and the athlete's card.

## Why a tag, and not the two things it looked like

**Not a quick note.** The obvious home was the athlete's pill picker
(`EX_NOTES`, `app.js:24819`), but those are *observations* — "Felt rough", "Too
heavy", "Pain or tweak". Each carries a `tone` (good/warn/info/bad) and the
athlete may pick at most two (`MAX_EX_NOTES`). A band color is a fact about the
setup, not a feeling about the set, it has no tone, and spending one of two note
slots on it would cost the athlete the ability to report that a lift both hurt
and felt heavy.

**Not a weight value.** The weight field already carries word sentinels — `"BW"`
and `"BAR"` via `isWeightWord()` (`app.js:1191`) — and a band color looked like a
third. That model dies on accommodating resistance: a banded bench press is
**225 lb *and* a red band**, two loads at once, and the weight field holds one
value. Both kinds of banded work are programmed here, so the model has to carry
both.

**A tag handles both cases with no new model:**

```
Banded Bench Press   [BB] [● RED]    225 lb × 5     tag = band, weight = bar
Band Pull-Apart      [● GREEN]            × 15      tag = band, no weight
```

## What comes for free

This is the whole reason for the tag. `LIFT_ID_GROUPS` (`app.js:1005`) already
contains Equipment, Unilateral, Position and Grip, and `liftKey()` builds a
matching key from them. Adding `"Band"` to that list means:

- **Progression chains fork per color.** A green-band row and a grey-band row
  never chain into each other, so the double-progression engine does not read a
  band change as a stall or a jump.
- **PRs fork per color.** The same guard that stopped a 315 barbell squat from
  burying every dumbbell squat PR.
- **The "Last:" line is per color.**
- **Single-select is the default.** `if (!multi)` at `app.js:2733` — a group
  without `multi: true` already replaces rather than stacks, which is right: one
  band at a time.
- **Zero tonnage, correctly.** `setLb()` (`app.js:30751`) scores only finite
  positive weights, so a band-only set contributes nothing to the Hoard, the same
  as bodyweight. A bar+band set scores its bar weight, which is the honest number.

The colored badge is a data edit. `TAG_COLORS` (`app.js:1389`) is already a
hardcoded hex map read by `tagColor()`, which feeds `--mc`/`--mb` onto
`.mod-chip` at every render site (`app.js:8635`, `app.js:12385`). Five more rows
and the chips are colored on both sides.

## The design

### The group

```js
{ group: "Band", tags: ["Yellow", "Red", "Purple", "Green", "Grey"] },
```

Placed after Equipment in `EXERCISE_MODIFIERS`. No `multi` flag — single-select.

Tags are the bare color words rather than `"Band Y"` shorthand, because the chip
renders its raw tag text (`escapeHtml(tag)`) and a chip that is literally green
and reads "Green" needs no decoding. The words are unique across every existing
group, so `groupForTag()`'s exact-match lookup stays unambiguous.

`TAG_LONG` expands them for the athlete's sentence — `"Green"` → `"Green Band"` —
since the athlete reads a name, not a chip row, in several places.

### Ordering

`LIFT_ID_GROUPS` gains `"Band"`. `NAME_GROUP_ORDER` gains `"Band"` at the front,
so the composed name reads *"Green Band Barbell Bench Press"*.

That is clunky English and worth eyeballing once it renders. It is accepted here
because the alternative is worse: excluding the band from `liftLabel()` would
leave two PR-board rows both reading "Barbell Bench Press" with different
numbers and no way to tell which band earned which. Unambiguous beats graceful on
the PR board.

Coaches who currently name an exercise "Banded Bench Press" should drop to
"Bench Press" and let the tag carry it — the same convention that already applies
to BB and DB.

### Colors

Five rows in `TAG_COLORS`, hex plus an 18%-alpha background, matching the shape
of every existing entry.

These are **literal colors, deliberately not theme tokens** — a green band is
green in every theme, and `TAG_COLORS` is already hardcoded hex by design. But
the app ships ten themes including a light one, and yellow and grey are the two
most likely to disappear against a pale background. Both must be checked on the
light theme specifically, not just the default dark.

### Progression

- **Bar + band** — the band is part of the setup and holds still; the weight
  climbs as normal. This is how accommodating resistance is actually programmed:
  you add plates within a block, not band tension.
- **Band-only** — no weight to climb, so reps climb and hold, which is the
  existing `repsOnly` path (`app.js:1638`).
- **Changing bands is a coach decision**, and it correctly forks the chain,
  exactly like moving an athlete from barbell to dumbbell. The engine does not
  auto-promote yellow → red.

The light-to-heavy order is recorded in the tag order so a later "they are
crushing green, consider grey" suggestion has a ladder to read. No such
suggestion is built here.

### The old `Band` Equipment tag

Left in place, untouched. Existing programs use it, and it still means "a band is
involved, unspecified." Tagging both it and a color is redundant but harmless.
Nothing is migrated.

### Cached clients

A PWA on the previous build has no `Band` group. It renders an unknown tag as a
chip in the default slate (`tagColor()`'s fallback), and `groupForTag()` returns
null so `orderedModifiers()` sorts it to the front. Cosmetic only. It will not
include the tag in `liftKey()`, so an old client groups green-band and grey-band
history together where a current one separates them — a divergence that resolves
itself when the client updates, and which loses no data either way.

## Testing

A new `tests/band-tags.test.js`, reading the real `EXERCISE_MODIFIERS`,
`TAG_COLORS` and `LIFT_ID_GROUPS` out of `app.js` per the folder's convention:

- all five colors resolve through `groupForTag()` to the Band group
- none of the five collides with a tag in any other group
- every one has a `TAG_COLORS` entry — no band falls through to the slate default
- `liftKey()` gives green-band and grey-band versions of one exercise
  **different** keys, and a band-only exercise a different key from the untagged
  original
- the Band group has no `multi` flag, so picking a second color replaces the first
- `TAG_LONG` expands all five

Then in the running app: a bar+band lift showing both `225 lb` and a red chip, a
band-only lift showing a chip and no weight, and the chip legible on the light
theme.

## Files

| File | Change |
|---|---|
| `app.js` | `EXERCISE_MODIFIERS` +Band group, `TAG_COLORS` +5, `TAG_LONG` +5, `LIFT_ID_GROUPS` +"Band", `NAME_GROUP_ORDER` +"Band" |
| `styles.css` | only if the colored chip needs contrast help on the light theme |
| `index.html` | `?v=` bump |
| `tests/band-tags.test.js` | new |
| `tests/README.md` | one line, per convention |

No migration. Modifiers already ride `weeks`, which syncs as jsonb.
