# Training levels: the coverage map reads the athlete, not a constant

2026-08-10

## The problem

The muscle coverage map shipped in `4eb0ea5` grades every athlete against one
ladder: 6 sets a muscle is "solid", 12 is "plenty", anything under 6 is called
out as **light** in the verdict line. Those numbers came from the hypertrophy
literature for a trained lifter, and `coverageBand()` still carries the comment
admitting they are placeholders.

For a new client they are wrong, and wrong in the direction that does damage. A
sane beginner program — full body, three days, four to six sets a muscle — reads
as a wall of warnings:

> Glutes, Side delts, Biceps, Triceps, Calves, Hamstrings get under 6 sets — light.

Nothing is wrong with that program. The map is scolding the coach for writing a
correct one, which trains him to stop trusting it. A tool that cries wolf on its
most common case is worse than no tool.

The fix is not better numbers. It is *whose* numbers: the bands have to belong to
the athlete.

## What we are building

One coach-set field per athlete — beginner, intermediate, advanced — that
retunes the coverage bands and the verdict wording, and shows as a small badge on
the roster so the book can be read at a glance.

Explicitly **not** in scope: deriving the level from training history, and
seeding default set counts in `makeExercise()`. Both were considered and cut.
The second is purely additive and can be bolted on later without touching
anything below; it was deferred until the levels have been used long enough to
know what a beginner's default sets should actually be.

## A live bug this work has to fix first

The athlete's Coverage mode has never worked.

`coverageSubject()` (`app.js:10475`) hands the athlete mount `state.clientData`.
But `state.clientData` is `{program, progress}` (`app.js:89`) — an athlete's
weeks live at `state.clientData.program.client.weeks` (`app.js:26436`). The
string `clientData.weeks` appears nowhere else in `app.js` and is never assigned,
so `coverageWeek()` reads `undefined` and bails.

The Coverage button sits in the shared markup (`app.js:10437`) with no `editable`
guard, so an athlete can reach it. What they get is coach copy, on their phone,
about a program that plainly exists:

> No program to read yet — add a week with some days and this fills in.

This is in scope because the feature is meaningless without it: retuning an
athlete's bands silently retunes a map that renders an error. Two defects, one
cause — the wrong object, and an empty state written for someone who can add a
week.

## The design

### The field

`client.trainingLevel` — `""` | `"beginner"` | `"intermediate"` | `"advanced"`.

Named `trainingLevel` rather than `level` because `level` already means Hoard
rank in this file (`hoardRankForLevel`, `lvl.level`), and a second meaning for
the same word in a 13k-line IIFE is a trap.

`""` means **not set**, and behaves as intermediate. That is what keeps this
change quiet: intermediate's bands are exactly today's numbers, so no existing
athlete's map moves until a level is deliberately assigned.

### The table

Every threshold in the feature derives from one literal:

```js
const TRAINING_LEVELS = [
  { id: "beginner",     name: "Beginner",     solid: 4, plenty: 8  },
  { id: "intermediate", name: "Intermediate", solid: 6, plenty: 12 },
  { id: "advanced",     name: "Advanced",     solid: 8, plenty: 16 },
];
const TRAINING_LEVEL_BY_ID = Object.fromEntries(TRAINING_LEVELS.map((l) => [l.id, l]));
const DEFAULT_TRAINING_LEVEL = "intermediate";
```

Intermediate is deliberately unchanged from today. Beginner drops; advanced gets
a modest bump so the label is not inert. The numbers are tunable by eye here and
nowhere else.

A `levelBands(client)` helper resolves an athlete to their row, falling back to
the default for unset and for any unrecognised value.

### What reads it

`coverageBand(n)` gains the bands as an argument:

```js
function coverageBand(n, bands) {
  const b = bands || TRAINING_LEVEL_BY_ID[DEFAULT_TRAINING_LEVEL];
  if (n >= b.plenty) return 3;
  if (n >= b.solid)  return 2;
  if (n >= 1)        return 1;
  return 0;
}
```

`anatomyCoverage()` (`app.js:9606`) resolves the bands once and returns them on
the `cov` object, so the figure, the chips and the verdict all read one source
rather than three re-derivations.

Its `light` list stops being the hardcoded `< 6` and becomes `< bands.solid`.
That preserves today's invariant — the light warning and the solid band have
always been the same number, and they must stay coupled or the verdict will
contradict the colour of the figure.

`coverageVerdictHtml()` (`app.js:9663`) reads `under ${bands.solid} sets` instead
of the literal 6.

### Where the level reaches

The field has to land in four places. Miss any one and it fails silently, which
is the characteristic failure of this codebase's athlete data.

| Place | Why |
|---|---|
| `makeClient()` — `app.js:484` | new athletes carry the field |
| `supabase/migrations/20260810120000_training_level.sql` | a real column, following `units` and `can_book` |
| `cloud.js:93` `athleteToRow` + `cloud.js:122` `rowToAthlete` | survives a device switch |
| `buildProgramFromAthlete()` — `app.js:3405` | **reaches the athlete's device** |

The last is a hand-picked allowlist of fields, not a spread. Omitting it leaves
the coach's map correct while the athlete's uses intermediate bands, with nothing
on either screen indicating disagreement.

The migration follows the `20260731120000_athlete_units.sql` shape: one
`add column if not exists`, and a comment explaining why the column lives on
`athletes` (the coach sets it, and the athlete's own map reads it).

The column is **nullable** with a check of `training_level is null or
training_level in ('beginner','intermediate','advanced')`. Nullable rather than
`not null default 'intermediate'` because `athleteToRow` already coerces empty
strings to `null` for every optional field (`c.goals || null`), so a
`not null` column would reject an unset athlete on the first write. NULL is the
storage form of "not set", and `levelBands()` resolves it to intermediate on
read.

### Where the coach sets it

On the Anatomy coverage panel, coach mount only — a select beside the existing
`[data-cov-who]` line that already reads `Week 3 · Sarah M.`. Change it and the
body map repaints under your hand.

It saves on change, not behind an edit/save lock. This follows the lesson already
recorded at `app.js:8186`, where membership and rate were pulled out of the
locked profile form because "a stale value in this form can't overwrite one that
was set there." A dropdown you can set and walk away from must not be able to
lose its value.

Options read `Not set (uses Intermediate)`, `Beginner`, `Intermediate`,
`Advanced` — the first names its own behaviour, so nothing is silently applied.

The control is one field with one door: it does **not** also appear on the
profile card. Two edit points for one value is how the membership/rate bug
happened.

### What each role sees

**Coach.** The verdict header appends the level: `✓ Covered · Week 3 · Sarah M.
· Beginner`. The roster row carries a small pill on the name line, reusing the
existing `quiet-chip` class already used there by the partner chip
(`app.js:4553`). Unset athletes render **no** pill — an empty roster slot is
honest about a decision not yet made, where a default-looking "Intermediate"
badge would not be.

The name line already carries up to three other chips — a status badge, the
partner chip, and up to two mood chips — so this is the fourth thing competing
for it. The pill must be verified at phone width with an athlete carrying all
four; if the line wraps, the pill is what gets shortened, not the name.

**Athlete.** Their bands retune; the word is never printed. Their verdict header
stays `✓ Covered · Week 3`. Whether "Beginner" belongs on a paying client's own
screen is a business call, and the answer here is no.

## Testing

`tests/muscle-coverage.test.js` already asserts *"bands split at 1, 6 and 12"*
and keeps a copy of `coverageBand()` per the folder's convention. That test
becomes a per-level table test:

- each level's `solid` and `plenty` boundaries, on and either side of the edge
- unset and unrecognised values resolve to intermediate
- intermediate's boundaries are **unchanged from today** — this is the assertion
  that protects every existing athlete
- `light` tracks `bands.solid` for every level, and `light` and `gaps` stay
  disjoint

The athlete-side wiring fix cannot be unit-tested — `coverageSubject()` is a
closure inside `buildAnatomy()`. It gets a booted-UI check instead: stub
`config.js` to disable Cloud, seed `localStorage` with an athlete program, open
the Anatomy tab, switch to Coverage, and assert the verdict is a real reading.

That fixture must carry **real exercises with real set counts**, and the
assertion must be on specific numbers rather than "not the empty state." A
zero-exercise fixture would prove the wiring and hide wrong bands — derived
values fail by being plausible.

## Deploy order

1. Migration — nothing under `supabase/` ships with `git push`
2. Then the client (`app.js`, `cloud.js`, `index.html`, `styles.css`), with the
   `?v=` cache-bust bumped

An old cached PWA that has never heard of `trainingLevel` reads no field and uses
intermediate — today's exact behaviour. Nothing is being retired, so no
double-write is needed.

## Files

| File | Change |
|---|---|
| `supabase/migrations/20260810120000_training_level.sql` | new — the column |
| `app.js` | `TRAINING_LEVELS`, `levelBands()`, `coverageBand()`, `anatomyCoverage()`, `coverageVerdictHtml()`, `coverageSubject()` fix, `makeClient()`, `buildProgramFromAthlete()`, the select, the roster pill |
| `cloud.js` | `athleteToRow` / `rowToAthlete` |
| `index.html` | select markup in the coverage row; `?v=` bump |
| `styles.css` | the select, the roster pill |
| `tests/muscle-coverage.test.js` | per-level bands |
| `tests/anatomy-coverage-wiring.test.js` | new — athlete coverage wiring |
| `tests/README.md` | one line for the new test, per the folder's convention |
