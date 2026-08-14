# Stat Pentagon — design

**Date:** 2026-08-13
**Status:** design approved in chat, spec awaiting review. Hardened against an
adversarial review that found three fatal issues in the first draft (§4.1 `rounds` vs
`sets`, §5.3 duplicate entries per `(exId, date)`, §5.4 retroactive swap reclassification).
Every code reference below was verified against the working tree, not assumed.
**Feature:** a five-axis STR/AGI/DEX/END/CON proximity field for the athlete, fed by
tagged training work, decaying on per-stat clocks, framed by the Hoard rank.

---

## 1. What this is

Nathan's ask, in his words:

> "some sort of STR AGI DEX END CON stat bar or PROXIMITY STAT FIELD in a mech game
> such as armored core 2 where the proximity expands as you gain points in each stat
> toward each stat in a pentagon shape"

**Its job is identity and status**, chosen explicitly over three alternatives (exposing
neglected work, a coaching instrument, a consistency engine). It is a loadout screen,
not a report card. That decision governs every trade-off below.

The governing principle that follows from it:

> **Shape is identity. Size is progression.**

A novice powerlifter must still *read* as a powerlifter — spiky toward STR — just
smaller overall. The silhouette is the product.

### Decisions Nathan made

| Decision | Choice |
|---|---|
| Primary job | Identity and status |
| Decay behaviour | Peak stays (dashed), current recedes from it |
| The Hoard | Absorbed into the frame around the field, not deleted |
| Endurance rep threshold | **Over 25 reps counts as endurance** |
| Mobility and stretching | Count, at low weight (~40% of a working set) |
| Anti-farming | Per-stat daily cap: 10 sets full credit, next 6 at half, nothing after |

---

## 2. The five stats

Defined by **what the set demands**, not which muscle it hits. Muscle is the anatomy
map's job, and `musclesForExercise()` returns an empty list for 26 of 30 Speed/Agility
names — precisely the half of the pentagon that needs answering.

| Stat | Means | Fed by |
|---|---|---|
| **STR** | Maximal force. Neural drive, high-threshold recruitment. | Heavy compounds, low reps |
| **AGI** | Speed and elasticity. Rate of force development, stretch-shortening cycle. | Jumps, bounds, sprints, cuts |
| **DEX** | Control and precision. Coordination, range, balance. | Unilateral, footwork, mobility |
| **END** | The aerobic engine. | Cardio, conditioning, 26+ rep work |
| **CON** | Work capacity and structure. | Accumulated volume, carries, core, isometrics |

The **AGI/DEX split resolves the app's worst classification hole.** The single
`Speed/Agility` library category contains two unrelated qualities: Broad Jump Series
and Skater Bound are elastic power (AGI); Ladder Icky Shuffle and Cone Weave are
coordination (DEX). No category lookup can separate them. That is why the mapping must
be a table.

---

## 3. Exercise → stat mapping

### 3.1 A new vendored table

New file `exercise-stats.js`, modelled line-for-line on the existing
`exercise-equipment.js` (which already covers all 224 library names with zero misses,
keyed by `exKey`, loaded on coach and athlete alike, with its own `?v=` tag).

Loaded via `<script src="exercise-stats.js?v=st1">` in `index.html` immediately before
`app.js`. **`sw.js` needs no edit** — it parses `index.html` for versioned js/css.

It exports **profiles**, not per-exercise numbers. Each of the 224 library names points
at one of ~18 shared profiles, so there are 18 things to tune rather than 224. Each
profile is a vector that **sums to a fixed total**, which is the single invariant that
stops the table drifting into "add more stats to make an exercise better".

A unit test asserts the sum on every row and that every `EXERCISE_STATS` value names a
real profile. The codebase already unit-tests pure logic in Node.

### 3.2 Rep bands (Nathan's 25-rep rule)

The same movement feeds different stats depending on how it was actually performed.
Applied to rep-based profiles only:

| Reps | Reads as | Splits toward |
|---|---|---|
| 1–5 | Max force | STR heavy, some CON |
| 6–12 | Hypertrophy | STR + CON |
| 13–25 | Work capacity | CON dominant |
| **26+** | **Muscular endurance** | **END dominant, some CON** |

The pot of points per set is identical in every band. Only the split changes, so
nothing pays more for chasing a rep count.

### 3.3 Resolution order

Classify off `exResolvedName(ex, progress)`, **never `ex.name`** — an athlete swap keeps
the exercise id and changes the name, and scoring a swapped-in exercise as the
prescribed one is wrong at exactly the moment it matters.

First hit wins:

1. `ex.sp` — a stat-profile preset stamped on the exercise. Used for coach **custom**
   exercises, which resolve to category `""` on the athlete's device. The custom-exercise
   editor gets a six-item preset tap-grid (Strength / Muscle / Conditioning / Power /
   Skill / Mixed), mirroring how `makeExercise` already persists `kind` and `timed`.
2. An **Impulse** modifier tag (§3.4) — coach intent overrides the default.
3. `EXERCISE_STATS[exKey(name)]` — the table. All 224 library names, both devices.
4. `STAT_FALLBACK[libCatFor(name)]` — one row per library category.
5. `ex.kind === "mobility"` → the mobility profile.
6. Final default: a neutral STR/CON split. An unknown name logged with weight and reps
   is resistance work by overwhelming prior.

### 3.4 Plyometrics — solved twice, deliberately

**Inherent classification in the table.** Every library movement with a genuine
stretch-shortening cycle is classified in `exercise-stats.js`: Box Jump, Broad Jump
Series, Lateral Bound, Skater Bound, Mini-Hurdle Hops, Ladder Single-Leg Hop, Ladder
Hopscotch at full plyo; Jump Rope, Burpee, High Knees, A-Skip, B-Skip and the sprint
family at partial.

This is non-negotiable because **coach tagging alone will leak**: Box Jump is filed
under `Cardio`, and Broad Jump Series, Lateral Bound, Skater Bound, Mini-Hurdle Hops and
Ladder Single-Leg Hop are filed under `Speed/Agility`. No category lookup finds them
together. The table carries the default so the tag only ever handles exceptions.

**The demo database cannot do this job.** `exercise-demos.js` carries 61 `plyometrics`
entries, but `LIBRARY_DEMO_MAP` reaches a plyometrics demo for only five of 224 library
names. Reading the demo category would ship a pentagon where most jumping earns nothing.

**Explicit override — a new `EXERCISE_MODIFIERS` group, "Impulse", single-select:**

- **Plyometric** — a real SSC with a flight or rebound phase.
- **Ballistic** — med ball throw, KB swing, jump squat, a speed-day deadlift.

Named "Impulse" rather than "Plyometric" because Ballistic is the necessary sibling and
a group named after one of its own tags reads badly beside Style and Grip.

**Coexistence with `Explosive`:** they are different kinds of statement. `Explosive` is
a Style tag meaning *move the bar fast* (a tempo instruction). Plyometric is a movement
*class*. A barbell squat can be Explosive and is never plyometric. They live in
different groups, so both can be set at once.

> **Nothing in this design ever reads the `Explosive` tag.** Verified: the program
> generator `_genTags` (app.js:9311) stamps a random Style tag on 60% of primaries and
> 28% of accessories. It is noise, not intent. Any XP keyed on it would pay out on a
> coin flip.

Three mechanical consequences of adding the group:

1. **`liftKey` is unaffected** — it keys only on `LIFT_ID_GROUPS` (Equipment,
   Unilateral, Position, Grip), so PR history and progression matching do not fragment.
2. **`exerciseDisplayLabel` must be told about it.** It prepends any group that is not
   Style or Hold to the name, so left alone the athlete's card would read "Plyometric
   Box Jump". Impulse joins the Style/Hold exception list and renders as a trailing chip.
3. **The picker row renders itself** — adding the group to `EXERCISE_MODIFIERS` is
   picked up by the existing loop. No new UI.

---

## 4. The unit and the scoring

### 4.1 Working sets, not tonnage

The unit is a **stimulus point**, and the reference is one hard working set.

Tonnage is deliberately not reused: `setLb` scores **zero** for timed work, mobility and
bodyweight lifts — exactly the movements AGI and DEX exist to reward. Reusing it would
make pull-ups, planks, box jumps and every ladder drill worth nothing. It also keeps the
app from quoting two different pound totals for one session; pounds belong to the Hoard.

**A log entry has two possible shapes, and both must be read.** This is the single
easiest way to build this feature broken:

> `isHoldName(name) = isMobilityName(name) || isSpeedName(name)` (app.js:10095), so **all
> 30 Speed/Agility drills and all 20 Mobility stretches** are created with
> `kind:"mobility"`. That card's `persist()` (app.js:30422) writes
> `{ id, date, m, rounds:[true,true,false], locked }` — **an array of booleans, with no
> `sets` key at all.**
>
> A scoring rule that reads only `entry.sets` scores **zero** for every ladder drill,
> bound, sprint, cone drill and stretch in the library — i.e. it kills AGI and DEX
> outright and silently voids the decision that mobility counts. That is the same place
> `setLb` fails, for a different reason.
>
> The app already handles both shapes side by side at app.js:27689:
> `if (Array.isArray(entry.rounds)) doneSets += entry.rounds.filter(Boolean).length;`
> The pentagon must do the same.

What counts, per **locked** log entry:

- `entry.rounds` present → `rounds.filter(Boolean).length` completed rounds → 1.0 each
- each non-skipped entry in `entry.sets` → 1.0
- `entry.burnout` present → 1.0 (a set to failure)
- `entry.dropset` present → 1.0
- `entry.warmups` → **0.0** (counting them pays for padding the ramp, matching `logEntryLb`)
- `entry.skipped === true` → the whole entry scores 0
- draft entries (`locked !== true`) → 0. The 800 ms autosave writes `locked:false` entries
  whose sets survive a truthiness filter on reps alone, so this check is mandatory or an
  abandoned half-typed day moves the field while the Hoard reads zero.

**Timed work never enters the rep bands.** There is no separate duration field: hold and
carry seconds are stored in `currentReps` and logged into `sets[].reps`. A 3×45s farmer's
carry would otherwise read as "45 reps" and land in the 26+ endurance band, while the same
carry at 10s would read as strength. Profiles flagged `timed` (carry, iso-hold, mobility,
balance) skip §3.2 entirely and scale by duration instead.

Cardio is scored from `cardioLogs`, which are already self-describing
(`{type, minutes, intensity, date}`) and need no definition lookup. **Cardio prescribed
inside a program day is scored by duration on the same scale**, not per-set — otherwise a
35-minute treadmill run scores several times higher entered in the cardio block than
prescribed in a workout, and where the athlete taps decides the number.

### 4.2 Intensity multiplier

One multiplier. First source that exists wins:

1. `entry.rir` — athlete-reported reality beats prescription
2. `ex.effort` — coach-set 🔥 (light / moderate / hard / max)
3. **neither → 1.00**

> **Unset effort is 1.00, and this is the single most important number in the model.**
> `effortRank` returns 0 for unset, and only two writers exist in the entire app (the 🔥
> picker and the ⚡ builder). Every hand-written day, generated day, template day and
> athlete-added exercise has no effort at all. Treating unset as "light" would quietly
> shrink the pentagon of nearly every program in the app. 1.00 is the multiplicative
> identity: the absence of an opinion changes nothing, and tagging effort can only ever
> move a number the athlete already had.

### 4.3 The daily cap (anti-farming)

Per **stat**, per **day**:

| Portion | Credit |
|---|---|
| first 10 points | full |
| next 6 points | half |
| beyond | none |

Maximum 13 points to any one stat in a day. A hard normal session lands around 6–9 in
its dominant stat and never touches the ceiling; 40 sets of curls resolves to 13.

This matches the volume literature — per-session productive volume flattens around ten
hard sets, past which an athlete accumulates fatigue rather than adaptation.

**The cap is applied when a day's stamps are summed, never baked into the stamp.** This
is load-bearing: it means deleting or editing one exercise recomputes the day correctly
instead of leaving a capped number that cannot be unwound.

---

## 5. Storage — the ledger question

> **There is no ledger, and there are no new columns.**

### 5.1 What is stored

Two keys stamped onto each `exerciseLogs` entry at lock-in:

- `sv` — the stat split of that entry's work, **raw and uncapped**, one decimal.
- `svs` — a 32-bit hash of the entry's scoring inputs, used as a change detector.

```json
{
  "id": "ms2daac2rlaplr",
  "date": "2026-07-26",
  "locked": true,
  "sets": [{ "reps": "5", "weight": "195" }, { "reps": "5", "weight": "205" }],
  "warmups": [{ "reps": "15", "weight": "95" }],
  "burnout": { "pct": "50", "reps": "15" },
  "sv": { "STR": 1.8, "CON": 1.5 },
  "svs": 812734501
}
```

The pentagon is then a **sum over stamps, with decay and the daily cap applied at read.**

### 5.2 Why stamp instead of deriving

**Because exercise ids are regenerated when a program is assigned.** Verified:
`assignProgramPrompt` does `JSON.parse(JSON.stringify(tpl.weeks)).map(w => ({...w, id: uid()}))`,
and `progress.exerciseLogs` is keyed by `ex.id`.

A pentagon that resolved each logged exercise by lookup at read time would **read zero on
the exact morning an athlete starts a new block** — the day it should look its best.
Stamping consumes the definition once, at write, when it is guaranteed to be present.
After that the read joins nothing and cannot be orphaned.

### 5.3 Double-counting: what is safe, and the one case that is not

Editing is safe by construction. A sum-over-stamps is idempotent:

- **Re-open a day** → signature unchanged → nothing happens.
- **Edit a set** → signature changes → the entry re-prices; the sum reads the new value.
- **Delete an entry** → it simply leaves the sum.

There is no accumulator, no diff arithmetic and no refund step.

**But a naive sum over entries can double-count, and this must be handled explicitly.**

> Nothing enforces one entry per `(exId, date)`. `merge_progress` dedupes on **entry id**
> (`coalesce(e.value->>'id', 'd:' || date)`), not on date. `lockIn` searches only the
> **local** array for a matching date, so a device that has not yet seen another device's
> entry mints a fresh `uid()`. Both ids then survive the union and sit on the same date
> forever.
>
> `syncHoard` is immune because `hoard.awarded` is keyed `exId:date`, so the second write
> overwrites the first. A plain Σ over entries is **not** immune — it doubles that
> session permanently.
>
> This is not hypothetical. It is exactly Nathan's live-session workflow: `saveClient`'s
> preview branch carries the comment "the athlete may have logged from their own phone
> mid-session", and `adoptMergedLogs` folds the server's answer — containing both
> entries — back into both copies.

**Fix, one line at read: collapse by `(exId, date)` keeping the entry with the highest
`m`, then sum.** Cheap, self-healing, and it makes the "cannot double-count" property
actually true rather than merely asserted.

### 5.4 What the stamp freezes, and what it does not

The stamp pins **classification and stimulus to the day the work was done.** That is not
just an optimisation, it prevents a real corruption:

> `setExerciseSwap` writes `p.swaps[ex.id] = { name, from, at }` — **one global swap per
> exercise id, with no date scoping.** `exResolvedName` therefore returns the swapped name
> for *every* entry in that exercise's history. In a purely derived design, an athlete
> whose knee hurts on the 13th and swaps Back Squat to Box Jump would retroactively
> convert three prior weeks of heavy squatting into AGI, and STR would crater overnight
> with no new training. Swapping back would revert it.

Because each entry carries its own `sv`, history is immune. The 3-day re-stamp window
(§5.6) bounds any reclassification to work that is still current.

What remains computed at read, and therefore **retroactive if retuned**: the decay
constants and the daily cap. Retuning those reshapes every athlete's field on their next
open. The profile weights, rep bands and intensity multipliers do **not** — they are
baked into the stamp at write, so tuning them affects future work only. That split is
deliberate and is the opposite trade-off to a fully-derived design.

### 5.5 Zero migration

- **`progress` fields:** none. Reads existing `exerciseLogs`, `cardioLogs`, and
  `client.trainingLevel`.
- **`cloud.js`:** no change. `exerciseLogs ↔ exercise_logs` is already mapped, and
  `exercise_logs` is `jsonb` — unknown keys inside a jsonb value pass through untouched.
- **DB column:** none. **`merge_progress`:** untouched.

This deliberately avoids the documented four-step trap (`progressToRow`, `rowToProgress`,
a column, and both lists inside `merge_progress`) and its live-DB hazard, where an upsert
naming a column that does not exist yet fails and breaks **all** progress saves for
everyone. It is the same escape Trials took by stamping into `progress.hoard`.

### 5.6 Two details that are load-bearing

1. **Bump `entry.m` on every re-stamp.** `merge_progress` orders by `m desc`, and most
   production entries have no `m` at all. A re-stamp that does not bump it can lose to
   another device's stale copy.
2. **A 3-day re-stamp window.** Inside 3 days an entry re-prices freely, which covers
   "the athlete logged it, then the coach fixed the effort tag". Beyond 3 days a coach
   retag does **not** rewrite history — the same reasoning as the Hoard's frozen award,
   and it means nobody can reshape an athlete's past pentagon from the editor.

---

## 6. Decay

### 6.1 Computed on read, always

There is no server and no cron; nothing can run while the app is closed. Decay is a pure
function of `(stamps, today)`. An athlete offline for a month gets the correct answer the
moment they open the app. Grace applies **per impulse**, not to a global "days since last
trained" counter.

**Future-dated entries are clamped, never discarded.** The log-date chip is a plain
`<input type="date">` with no `max`, so a typo can produce a 2027 date. More importantly,
it does not take a typo: an athlete's phone stamps `todayISO()` in their local time, and a
coach opening the roster late in the evening — or any second device in another timezone —
can see `entry.date > today`. Discarding those would hide the athlete's newest session and
show a day of decay that never happened, captioned "1 day since you trained" on a day they
trained. Any entry dated ahead of the reading device's today is treated **as today**.

**A backfilled session counts from the date it was performed, and the caption follows the
same clock.** Logging Saturday's session on Tuesday with the date chip set back must not
produce "3 days since you trained" at the moment the athlete catches up.

### 6.2 The research, honestly

Nathan asked for his numbers to be checked. The answer relocates them rather than
discarding them.

- **His 5 days for cardio is right.** Plasma volume falls 5–12% within 2–6 days, which
  alone drops stroke volume and VO2max. Coyle et al. (1984): −7% VO2max at 12 days, −16%
  at 56 days. END is genuinely the fastest-fading quality.
- **His 7 days for strength is wrong, but the number is real.** Maximal strength is the
  most robust finding in the detraining literature — readily maintained through 2–4 weeks
  of complete inactivity, with meaningful decline around 8–12 weeks. What an athlete
  *feels* at 7–10 days off is loss of snap: rate of force development. **So his 7 belongs
  to AGI, not STR.**
- **CON is the slowest.** Detectable atrophy generally needs ~3 weeks and reaches only
  6–15% CSA over 8–12 weeks in trained people.

### 6.3 The five clocks

Each stat holds at full value through a grace window `G`, then decays exponentially with
half-life `H` toward a retained floor.

| Stat | Grace | Half-life | Anchor | Confidence |
|---|---|---|---|---|
| END | 5 d | 18 d | Coyle −7% @ 12 d, −16% @ 56 d | High |
| AGI | 7 d | 30 d | plyo gains partly retained @ 4 wk | Medium |
| DEX | 7 d | 35 d | ROM regression over 4–8 wk | **Low** |
| STR | 14 d | 45 d | no significant 1RM loss ≤ 4 wk | High |
| CON | 21 d | 60 d | atrophy detectable ~3 wk | High |

**Stated simplification:** real cardio detraining is two-phase — a plasma-volume cliff in
the first week, then a slower mitochondrial decline. This collapses it into one
exponential with a short grace; the grace absorbs the cliff.

**Flagged weakness: DEX is the least defensible row.** The ROM-detraining literature is
thin and inconsistent, and DEX bundles mobility (which fades) with motor skill (which is
retained for years). Expect this row to need tuning against real athletes.

### 6.4 Floors and the peak

- **Nothing falls to zero, and the floor has to be big enough to mean it.** Each stat
  decays toward a retained floor scaled by training age (`client.trainingLevel`, an
  existing column mapped both directions). The floor is a substantial fraction of peak,
  not a token: an athlete six weeks into a torn ACL must open the app and still see a
  recognisable version of their build, not a dot.
- **The peak is permanent** and drawn as a dashed outline. It is the per-stat high-water
  mark, derived in the same pass as the current value (one walk over daily sums), so it
  needs no storage of its own and is self-healing if history changes.

### 6.5 The absence problem, stated plainly

This is the only layer in the app that penalises not training. The readiness system's own
comment sets the house rule — *"a low score can only protect, never penalise"* — and the
nutrition streak at least dies once rather than visibly draining for two months.

Three mitigations, all required:

1. **The floor** (§6.4), so collapse has a hard bottom.
2. **The permanent peak outline**, so the athlete's identity is never actually taken away
   — the gap is framed as something to reclaim, which is why Nathan chose this decay model.
3. **No punitive presentation:** no red, no negative numbers, no deltas, and no "you have
   been away" nagging. The field simply reads as current form.

**Known limitation — ripple for low-frequency athletes.** A stat fed once a week swells the
day after and sags before the next session. For a general-population client doing one walk a
week, END can swing by half between sessions while they follow the program exactly. The
grace windows absorb this for anyone training a stat twice a week or more; below that the
axis visibly breathes. Options if it reads badly on the real roster: lengthen grace toward
the training frequency, or raise the floor. **Flagged for tuning against real athletes, not
solved on paper.**

---

## 7. The display

### 7.1 The Hoard becomes the frame

The Hoard stops being a `<details>` card with a rank ladder and becomes the **chassis**
the field sits in:

- crest and rank name on the top edge, tonnage on the right
- a thin progress sliver along the bottom, with build name and next rank
- the frame's **metal is the rank** — the existing `HOARD_LOOK` colours and glow values,
  copper through brass, gold, platinum and white-hot at HOARD
- ranking up **reforges** the frame with a flash (driven from rAF, see §7.3)

The tier ladder collapses to "next: Barrel", with the full ladder available on tapping
the frame. That is where the space saving actually comes from.

Nothing is lost: same tonnage, same ranks, same metals, same avatar crest behaviour. A
screenful of the Progress tab comes back, and tonnage now visibly upgrades the housing
the whole identity sits in instead of being a number competing with it.

**Two colours, two jobs:** frame = career metal, field = theme accent. They never fight
because they never mean the same thing. Verified across all ten themes.

### 7.2 Geometry

Inline SVG built as an HTML string and assigned via `innerHTML` — the only pattern in
this codebase (`bwChartCard`, `calorieRingHtml`, `ovRingTile`). There is no
`createElementNS` anywhere and this does not introduce one.

**Axis order, chosen so decay reads as a tilt.** Clockwise from twelve o'clock:
**STR, AGI, END, CON, DEX.** The right half is output (AGI 30 d, END 18 d half-life); the
left half is structure and control (CON 60 d, DEX 35 d). A fortnight off visibly collapses
the right side while the left holds — the field *tilts* rather than shrinking uniformly,
which is both what actually happens to a body and far more interesting to look at.

Layers, back to front: ring grid and spokes (never glowed — they are the ruler), the
dashed peak outline, the filled current polygon with a glow filter, vertex nodes, labels.

### 7.3 Motion

Nathan's phone runs with **Reduce Motion ON**, which kills CSS animation. Every
transition here — the field tweening between values, the reforge flash — is driven from
`requestAnimationFrame`, not CSS keyframes.

### 7.4 Home

The Progress tab, in a new `#prog-pentagon` host above `#prog-hoard`. That tab is rebuilt
on every arrival by `setClientTab("prs")`, which is exactly the recompute hook a decaying
field needs, and it is the athlete tab that exists to show charts.

Not on Overview: the redundant Hoard bar was already removed from there at Nathan's
request, and Overview becomes a two-column grid at ≥760px that a new block would inherit.

---

## 8. First run

Existing logs carry no `sv`. On first open the app runs a **one-time backfill** over
resolvable locked entries, stamping them as if they had been logged with the current
rules, then proceeds normally.

Roughly 10% of production log entries are already unresolvable to any exercise definition
on the athlete's device (a consequence of id regeneration, §5.2). Those are skipped — the
pentagon starts slightly understated for long-tenured athletes rather than empty, and
self-corrects as new work is logged.

The backfill is bounded by the decay horizon: entries older than the longest half-life
window contribute almost nothing, so there is no need to walk years of history.

---

## 9. Build plan

1. **Table + scoring, headless.** `exercise-stats.js`, the profiles, the resolution
   order, the rep bands, the intensity multiplier and the daily cap, with Node unit tests
   asserting profile sums and full library coverage. No UI.
2. **The stamp.** `sv`/`svs` at lock-in, the re-stamp rule, the `m` bump, the backfill.
3. **The read.** Decay, floors, peak derivation, the day cap applied at sum time.
4. **The field.** SVG pentagon in `#prog-pentagon`, rAF tweening, all ten themes.
5. **The frame.** Absorb the Hoard card into the chassis; ladder behind a tap.
6. **The Impulse group.** Modifier group, `exerciseDisplayLabel` exception, custom-exercise
   preset grid.

Steps 1–4 are the vertical slice that is worth shipping on its own.

---

## 10. Open questions

1. **Absolute or normalised axes?** Does everyone share one scale, so a beginner's field
   is genuinely small (honest, lots of room to grow), or is the field scaled to the
   athlete (feels good immediately, but a beginner and a national-level lifter look
   alike)? *Recommendation: absolute, with a generous early curve, consistent with
   "size is progression".*
2. **Can the coach see it?** Mini fields on the roster cards would make it something to
   program against. Deferred — the chosen job is athlete identity.
3. **Post-session payoff.** The strongest engagement idea on the table: the field swells
   with "+6 STR, +2 CON" after a workout. Not in the slice above; worth its own pass.
4. **DEX constants** (§6.3) will need tuning against real athletes.
5. **AGI will read empty for most of the general-population roster.** Plyometric and speed
   work is the only thing that feeds it, and most of Nathan's clients do none. A pentagon
   with one permanently dead vertex reads as a rendering bug rather than a coaching prompt.
   Options: broaden what feeds AGI (fast/ballistic resistance work at partial credit), give
   every axis a small floor so the shape is always closed, or accept it and let the empty
   axis be the honest prompt. *Needs Nathan's call.*
6. **STR does not read load.** Set-counting means 5×5 at 315 and 5×5 with an empty bar
   score the same STR, while the Hoard six inches below shows wildly different tonnage.
   The intensity multiplier (effort / RIR) is the partial answer, but it is coach-set on a
   minority of exercises. Worth deciding whether STR should take a load-relative factor
   against the athlete's own recent best.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| A third game layer reads as the Hoard reskinned | Different unit (sets, not pounds), different behaviour (decays), and the Hoard is absorbed rather than duplicated |
| Coach tagging leaks plyo work | Inherent classification in the table; the tag handles exceptions only |
| `Explosive` mistaken for intent | Never read. Documented in §3.4 |
| Effort unset treated as "light" shrinks every program | Unset = 1.00, documented in §4.2 |
| A per-render write pushes the whole `exercise_logs` blob | Stamping happens at lock-in and in the sync pass only, never on autosave or render |
| Swapped exercises scored as prescribed | Classify off `exResolvedName`, never `ex.name` |
| A later swap retroactively rewrites months of history | The stamp pins classification to the entry's own date, §5.4 |
| New program block zeroes the field | Stamping at write, §5.2 |
| **AGI and DEX score zero** because Speed/Agility and Mobility log `rounds`, not `sets` | Read both shapes, §4.1. **The single most likely way to build this broken** |
| Two devices mint two entries for one session and it counts twice | Collapse by `(exId, date)` on max `m` at read, §5.3 |
| A 3×45s carry read as "45 reps" and scored as endurance | Timed profiles skip the rep bands entirely, §4.1 |
| Timezone or a typo hides the newest session | Future dates clamp to today, never discard, §6.1 |
| Same cardio scored differently in a program day vs the cardio block | Both scored by duration on one scale, §4.1 |
| An injured athlete watches the instrument die | Floor, permanent peak, no punitive presentation, §6.5 |
