# Band colors: the band is the load

2026-08-10

## The problem

A banded lift's resistance is its band, and right now the app cannot say which
one. `Band` exists as a single Equipment tag (`app.js:948`) meaning "a band is
involved" — not yellow, not grey, just *some* band. So a program says "Banded
Row", the athlete picks whatever is in the rack, and months of banded work carry
no load history at all.

Five bands are in use, lightest to heaviest:

**yellow · red · purple · green · grey**

## What we are building

A single-select **Band** modifier group carrying those five colors, rendered as a
chip in the band's own color on both the coach's and the athlete's card.

The coach prescribes it. The five colors are **rungs on one ladder**, not five
different exercises — so an athlete's banded work reads as one climbing story,
and the coach gets a one-tap "next band" while programming.

## Why a tag, and not the two things it looked like

**Not a quick note.** The obvious home was the athlete's pill picker
(`EX_NOTES`, `app.js:24819`), but those are *observations* — "Felt rough", "Too
heavy", "Pain or tweak". Each carries a `tone` and the athlete may pick at most
two (`MAX_EX_NOTES`). A band color is a fact about the setup, not a feeling about
the set, it has no tone, and spending one of two note slots on it would cost the
athlete the ability to report that a lift both hurt and felt heavy.

**Not a weight value.** The weight field already carries word sentinels — `"BW"`
and `"BAR"` via `isWeightWord()` (`app.js:1191`) — and a band color looked like a
third. That dies on accommodating resistance: a banded bench press is **225 lb
*and* a red band**, two loads at once, and the field holds one value. Both kinds
of banded work get programmed here, so the model must carry both.

A tag holds the band while the weight field holds the bar, and neither has to
learn the other's job:

```
Banded Bench Press   [BB] [● RED]    225 lb × 5     tag = band, weight = bar
Band Pull-Apart      [● GREEN]            × 15      tag = band, no weight
```

## Rungs, not separate lifts

This is the decision everything else hangs off.

`LIFT_ID_GROUPS` (`app.js:1005`) lists the tag groups that make a lift a
*different lift* — Equipment, Unilateral, Position, Grip. A barbell squat and a
dumbbell squat load on different scales and rightly keep separate PR ladders and
separate progression chains.

**Band is deliberately NOT added to that list.** That rule is for implements, and
a band is not an implement — for a band-only lift the band *is* the load, the way
225 is the load on a bench. Nobody forks a lift's identity between 225 and 315.

Putting Band in lift identity would shatter an athlete's banded history into five
unrelated short chains with nothing climbing between them, and would make "the
next band" meaningless. One exercise, one history, with the band as the rung:

```
Band Pull-Apart
  Jun   ● YELLOW  × 12
  Jul   ● RED     × 15
  Aug   ● PURPLE  × 15     one story, climbing
```

**What this costs, accepted knowingly:** a banded bench at 225 × 5 with red and
the same at 225 × 5 with green read as the same PR. The bar weight matched and
the app will not separate them by band. That is the price of coherent band-only
history, and band-only accessory work is the bulk of the banded volume here.

Because Band stays out of `LIFT_ID_GROUPS`, `liftTags()` skips it, so `liftKey()`
ignores it (one chain) and `liftLabel()` leaves it out of the composed name. That
is correct: the band is a load, and loads belong in the load slot, not the name.
`Style` and `Hold` are already tags that render as chips without touching
identity — the same shape.

## The ladder, and the coach's next step

The tag order in `EXERCISE_MODIFIERS` **is** the ladder, lightest to heaviest.
Nothing else stores the order.

While programming, a banded exercise gets a one-tap **next band** control that
advances the tag one rung and does nothing at grey. That is the ask, and on its
own it needs no engine work at all.

The engine's part is to say *when*. The double-progression engine already
computes a target from logged history without ever writing to the exercise — the
convention in this codebase is computed targets, never mutated data. Band
laddering follows it exactly: when an athlete tops out their rep ceiling on their
current band, the computed target reads **"ready for ● GREEN"**, and the coach
takes it with the same one tap.

The engine does **not** advance the band by itself. A band change is a
prescription, and prescriptions are the coach's.

The precedent is bodyweight, which already graduates across a load-type boundary
at its rep cap (`app.js:1626`) — same ladder shape, different rungs.

## PRs are left alone

A band-only lift has no weight, so its PR is rep-only. `prIsRepOnly()` already
handles that and prints `—` in the weight slot (`app.js:16615`), and it will keep
doing exactly that — a band-only PR reads `— × 15` with no indication of which
band earned it.

This was considered and deliberately cut, not overlooked. The PR board is not
where banded work gets read; the exercise's own history is, and that already
carries the band as its rung. Adding a band to the PR record would touch record
writing, grouping and rendering to improve a board nobody consults for band work.

## The group

```js
{ group: "Band", tags: ["Yellow", "Red", "Purple", "Green", "Grey"] },
```

Placed after Equipment in `EXERCISE_MODIFIERS`, so `orderedModifiers()` renders
the band chip after the implement: `[BB] [● RED]`. No `multi` flag — `if (!multi)`
at `app.js:2733` already makes a group single-select, which is right: one band at
a time, and picking a second replaces the first.

Tags are the bare color words rather than `"Band Y"` shorthand, because the chip
renders its raw tag text (`escapeHtml(tag)`) and a chip that is literally green
and reads "Green" needs no decoding. The words collide with no existing tag, so
`groupForTag()`'s exact-match lookup stays unambiguous.

`TAG_LONG` expands them — `"Green"` → `"Green Band"` — for the places the athlete
reads a sentence rather than a chip row.

## Colors

Five rows in `TAG_COLORS` (`app.js:1389`), hex plus an 18%-alpha background,
matching every existing entry. `tagColor()` feeds them to `--mc`/`--mb` on
`.mod-chip` at every render site (`app.js:8635`, `app.js:12385`), so the colored
badge is a data edit rather than new rendering.

These are **literal colors, deliberately not theme tokens** — a green band is
green in every theme, and `TAG_COLORS` is already hardcoded hex by design. But
the app ships ten themes including a light one, and yellow and grey are the two
most likely to disappear against a pale background. Both must be checked on the
light theme specifically, not just the default dark.

## Tonnage

`setLb()` (`app.js:30751`) scores only finite positive weights, so a band-only
set contributes nothing to the Hoard — the same as bodyweight, and for the same
stated reason: there is no honest number of pounds to claim. A bar+band set
scores its bar weight. No change needed.

## The old `Band` Equipment tag

Left in place, untouched. Existing programs use it and it still means "a band is
involved, unspecified." Tagging both it and a color is redundant but harmless.
Nothing is migrated.

## Cached clients

A PWA on the previous build has no `Band` group. It renders an unknown tag as a
chip in `tagColor()`'s slate fallback, and `groupForTag()` returns null so
`orderedModifiers()` sorts it to the front. Cosmetic only.

Because Band is not in `LIFT_ID_GROUPS`, an old client and a current one compute
the **same** `liftKey` for a banded lift — so progression chains and PR grouping
agree across builds. That is a direct consequence of the rungs decision and worth
noting: the separate-lifts design would have had the two builds disagree.

## Testing

A new `tests/band-tags.test.js`, reading the real `EXERCISE_MODIFIERS`,
`TAG_COLORS`, `TAG_LONG` and `LIFT_ID_GROUPS` out of `app.js` per the folder's
convention:

- all five colors resolve through `groupForTag()` to the Band group
- none collides with a tag in any other group
- every one has a `TAG_COLORS` entry — no band falls through to the slate default
- the Band group has no `multi` flag
- `TAG_LONG` expands all five
- **`liftKey()` is unchanged by the band** — the green-band and grey-band versions
  of one exercise produce the *same* key, and the same key as the untagged
  original. This is the assertion that protects the one-history decision; if
  someone later adds `"Band"` to `LIFT_ID_GROUPS`, this fails loudly instead of
  silently fragmenting every athlete's banded history.
- the ladder is ordered yellow → grey, and "next band" from grey is grey

Then in the running app: a bar+band lift showing both `225 lb` and a red chip, a
band-only lift showing a chip and no weight, the next-band control advancing one
rung and stopping at grey, and the chip legible on the light theme.

## Files

| File | Change |
|---|---|
| `app.js` | `EXERCISE_MODIFIERS` +Band group, `TAG_COLORS` +5, `TAG_LONG` +5, next-band control, computed "ready for" target |
| `styles.css` | the next-band control; contrast help if the light theme needs it |
| `index.html` | `?v=` bump |
| `tests/band-tags.test.js` | new |
| `tests/README.md` | one line, per convention |

`LIFT_ID_GROUPS`, `NAME_GROUP_ORDER` and the PR board are deliberately **not**
touched.

No migration. Modifiers ride `weeks`, which already syncs as jsonb.
