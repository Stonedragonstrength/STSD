# Coverage-driven program builder

Design agreed with Nathan, 2026-08-13.

## The idea

The coverage map grades a program you already wrote. Point it backwards and it
can write one: given a day count and the gear on hand, pick compounds that
cover the most body per movement, then fill in what they miss.

Nathan's own sketch of the output, for two days:

```
DAY 1  squat, bench, split squat, flys, adductors, calves, triceps
DAY 2  deadlift, pulldowns, rows, wheel rollouts, pallof presses, curls, abductors
```

Note where those days end. The last few slots are the bits nothing else
reaches: adductors, abductors, calves, arms, anti-rotation core. That shape is
the whole point, and it is what the deficit filler below reproduces.

## What already exists

| Piece | Where | What it gives us |
|---|---|---|
| `musclesForExercise()` | app.js | exercise → muscles, weighted 1 or 0.5 |
| `anatomyCoverage()` | app.js | a week → sets per muscle, against the athlete's bands |
| `levelBands()` / `phaseOf()` | app.js | the solid/plenty targets, per training age or phase |
| `ANATOMY_GROUPS[].pattern` | app.js | Push / Pull / Squat / Hinge / Core / Isolation, per muscle |
| `ANATOMY_GROUPS[].anchors` / `.accessories` | app.js | 99 curated exercises, each tied to its muscle |
| `EXERCISE_LIBRARY` | app.js | 224 more, in 17 categories |
| `GEN_STYLES` | app.js | sets/reps schemes: Strength, Hypertrophy, Powerbuilding, … |
| `EXERCISE_MODIFIERS` "Equipment" | app.js | BB, DB, DBs, KB, EZ Bar, Cable, Rope, Wide Bar, Band, Machine, Landmine, Slider, Bench, Bench Assisted |
| `eq:` icons | app.js icon picker | barbell, dumbbell, kettlebell, plate, bench, rack, pullup, medball, trapbar, cable, band, rower, treadmill, jumprope, sled, box, dipbars |

`generateWorkoutDay()` also exists, powering 🎲 Surprise me. It rolls ONE day at
random from category buckets and has no idea what it covered. This builder does
not replace it; the two live side by side, one a day tool and one a week tool.

## Decisions taken

1. **Breadth to solid, then depth.** Nothing goes above solid until every
   muscle has reached solid. Leftover room then deepens the big movements.
   Rejected: spreading thin (nothing ever reaches solid on low day counts) and
   depth-first (small groups get dropped, which contradicts Nathan's example).
2. **Target the athlete's own bands.** A beginner's solid is 4, an advanced
   athlete's is 10, a Fat loss athlete's is 3 hard sets. The builder reads
   `levelBands()`, so it inherits training age and training phase for free.
3. **Tag all ~280 exercises with their equipment.** Names do not say what they
   need: "Back Squat" mentions neither barbell nor rack. Keyword sniffing is
   wrong on exactly the compounds the design rests on, so the map is written by
   hand.
4. **Skeleton, then fill.** Split the days by movement pattern, seat one anchor
   compound per pattern, then run the deficit filler. Rejected: pure greedy
   (day one can open on a calf raise) and roll-many-keep-best (no pick can
   explain itself, and quality is capped by luck).
5. **The skeleton adapts to the gear.** If a whole pattern is unreachable the
   split is re-picked from what is reachable, so four days stay four useful
   days.

## Section 1: the equipment layer

### Vocabulary

The 17 `eq:` icons already in the icon picker. No new artwork, and the picker
reads as gear rather than a wall of words.

### Realization map

Equipment is not one required list per exercise. The app represents gear as a
*modifier tag* on a base name ("Bench Press" + `DBs`), which is what `liftKey()`
keys on and how the editor already writes it. Only 16 of the 224 library names
mention gear at all. So each exercise maps to the ways it can be realized, in
preference order:

```js
"bench press": [
  { gear: ["barbell", "bench"],  tag: "BB" },
  { gear: ["dumbbell", "bench"], tag: "DBs" },
  { gear: ["machine"],           tag: "Machine" },
],
"push-up":  [ { gear: [],          tag: null } ],
"pull-up":  [ { gear: ["pullup"],  tag: null } ],
"lat pulldown": [ { gear: ["cable"], tag: null } ],
```

The builder takes the first realization the athlete's gear satisfies and stamps
that modifier on the exercise it writes. Dumbbells and a bench but no barbell
yields a dumbbell bench press, written exactly as Nathan would write it by hand.
The movement survives the missing rack instead of vanishing with it.

Keys are `exKey()` normalised, so naming variants resolve to the same entry.

### Where it lives

Its own file, `exercise-equipment.js`, vendored the way `exercise-demos.js` is,
with its own `?v=` tag in index.html and its own entry in the service worker
precache. `app.js` is past 40,000 lines and a 280-entry table does not belong
in it.

### Per athlete

`client.equipment`, a list of equipment ids, sitting beside `trainingPhase`:

- seeded `[]` in `makeClient()`
- carried in the `buildProgramFromAthlete()` allowlist
- `equipment` column on `athletes` (jsonb, nullable), mapped both ways in
  `cloud.js`
- **unset or empty means everything is available**, so no existing athlete
  changes behaviour and the builder works before the field is ever filled in

A fold on the coach's athlete Profile next to Training phase: a tap-to-toggle
grid of the gear icons.

### Scope of the filter

The filter applies **only inside the builder**. It never restricts what can be
typed or picked by hand, and it never touches an existing program. An exercise
absent from the map is simply not a generation candidate, which is the right
behaviour for a custom exercise the coach invented.

## Section 2: the engine

### Inputs

The athlete (for bands and gear), a day count, and a style from `GEN_STYLES`.

### Step 1, skeleton

Pick a split for the day count, from the `pattern` field on each muscle group:

| Days | Split |
|---|---|
| 1 | Full Body |
| 2 | Squat+Push · Hinge+Pull |
| 3 | Push · Pull · Legs |
| 4 | Upper Push · Lower Squat · Upper Pull · Lower Hinge |
| 5 | Push · Pull · Legs · Upper · Lower |
| 6 | Push · Pull · Legs · Push · Pull · Legs |

Before seating anything, each pattern is checked for reachability against the
athlete's gear. An unreachable pattern is dropped from the skeleton and the
split re-picked from what remains, so a gym with no pulling equipment produces
four useful days rather than two full ones and two near-empty ones.

### Step 2, seat the anchors

For each pattern a day owns, take the highest-coverage exercise the gear allows,
preferring the curated `anchors`. Coverage score is the sum of the weights from
`musclesForExercise()`, so a deadlift outranks a leg extension on merit rather
than by a keyword list.

### Step 3, the deficit

Run `anatomyCoverage()` over the week so far. Each muscle's shortfall is
`max(0, solid - current)`.

### Step 4, fill

Repeatedly add whichever available, unused exercise closes the most shortfall
per set, placed in the day with the most room and the best pattern fit.
Recompute after each addition. Stop when every reachable muscle is at solid or
every day has hit the exercise cap.

### Step 5, depth

Leftover room adds **sets to the anchors**, never new exercises, and stops at
**plenty**. The ceiling is load-bearing: without it, an unreachable pull pattern
would pour its freed capacity into extra bench sets, which cannot fix a lat
deficit and costs recovery. Past plenty the day simply ends shorter.

### Shape of a day

Days cap at 7 exercises. Ordering is compounds first, isolation last, core at
the end, which the `pattern` field gives directly. Sets and reps come from the
chosen `GEN_STYLES` row: the primary scheme for anchors, the accessory scheme
for fills, the core scheme for core.

### When it cannot finish

It reports rather than fails. Two days will not reach solid everywhere, and a
gym with no pulling equipment leaves lats, rhomboids and biceps at zero. The
report names the short muscles, and for unreachable ones names the gear that
would unlock the most, so it says what to buy rather than only what is missing.

## Section 3: the surface

Entry point is a **⚡ Build the week** button in the program editor beside
+ Add week. Weeks are made there. The 🎲 templates modal stays a day-level tool.

### Setup sheet

Everything tapped, nothing typed.

```
  BUILD THE WEEK · Test Athlete

  Days     [1] [2] [3] (4) [5] [6]

  Style    (Powerbuilding) [Hypertrophy] [Strength] …

  Gear     🏋 ⚫ 🪑 ⬛ 🔗 ▭ ⬜ …     ← from their Profile,
           barbell dumbbell bench…      adjustable for this build

  Grading against Fat loss · solid 3, plenty 5
                                    [ Build ]
```

The bands line is read-only. It tells the coach what the builder is aiming at
without making them go and look.

### Preview

Nothing is written until Use this week.

```
  DAY 1  Squat + Push          DAY 2  Hinge + Pull
   Back Squat      4×6          Deadlift        4×5
   Bench Press·DBs 4×8          Lat Pulldown    4×8
   Split Squat     3×10         Seated Row      3×10
   Cable Fly       3×12         Ab Wheel        3×10
   Hip Adduction   3×15         Pallof Press    3×12
   Calf Raise      3×15         Curl · DBs      3×12
   Pushdown        3×12         Hip Abduction   3×15

  ████████ chest  5   ████████ quads 5   ░░ traps 1½
  ⚠ Traps and forearms fall short at 2 days.

        [ Use this week ]  [ Roll again ]  [ Cancel ]
```

The coverage strip reuses the Anatomy page's chips, so the preview is graded by
the same code that will grade the week once it is real. Roll again is the payoff
for tagging 280 exercises.

## Section 4: what it writes

A new week appended to the athlete's program: days named from the existing
pattern defaults, exercises carrying sets, reps, equipment modifiers and
supersets, in the same shape the editor already produces. Fully editable
afterwards, with no special "generated" state to strip out later.

### The burn-level interaction

The builder **must** set `ex.effort`, and never below the phase's minimum on
anything it counted.

This is not decoration. Coverage in Fat loss counts only Hard and Max. A
generated week carrying no effort would grade as completely empty the moment the
map was opened, and the note would report every exercise as untagged. The
builder cannot be allowed to produce a program its own grader rejects.

Assignment, by slot rather than by style, so it is unambiguous:

| Slot | Burn |
|---|---|
| anchor (the seated compound) | Hard |
| deficit fill | Moderate |
| isolation / core | Light |

Then, where a phase is set, every exercise the builder counted is floored at
that phase's `minEffort`. In Fat loss that lifts the fills and isolation to
Hard, which is correct: in a deficit the builder is programming fewer sets
precisely because each one has to be taken hard.

## Section 5: testing

Property assertions rather than fixed outputs, since rerolling is meant to vary.

- every generated exercise is realizable with the athlete's declared gear
- no muscle is taken past plenty
- the day exercise cap holds
- with full gear and 4+ days, every reachable muscle reaches solid
- in a phase, nothing counted carries less than the phase's minimum burn
- an unreachable pattern is dropped from the skeleton and reported, not silently
  emptied
- two consecutive rolls differ
- the realization map: every entry's `tag` is a real `EXERCISE_MODIFIERS`
  Equipment tag, and every `gear` id is a real `eq:` icon

Plus a plumbing test for `equipment` matching the shape of
`training-phase-plumbing.test.js`: seeded in `makeClient()`, carried in
`buildProgramFromAthlete()`, written by `athleteToRow()`, read by
`rowToAthlete()`, and a migration that adds the column.

## Build order

The equipment layer is independently shippable and worth landing first: the
realization map, `client.equipment`, the migration and the Profile picker stand
on their own, are verifiable without any builder, and are the long pole because
of the ~280 hand-written entries. The engine and its surface then land on top of
finished data rather than racing it.

## Out of scope

- Multi-week blocks with progression baked in. The builder makes one week; weeks
  are carried forward with the tools that already exist.
- Using the equipment data anywhere else. It will be reusable for flagging a
  swap the athlete cannot perform, or filtering the exercise picker, but none of
  that is built here.
- Replacing `generateWorkoutDay()` or the 🎲 templates modal.
- Athlete-facing anything. This is a coach tool.
