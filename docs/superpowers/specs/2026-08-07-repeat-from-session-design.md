# Make this a regular session — design

**Date:** 2026-08-07
**Status:** approved, ready to plan

## The ask

From the coach Overview calendar, tapping an athlete's name opens the session
sheet. The coach wants to turn that session into a standing appointment from
there — including when the session has **already happened** — with the pattern
choices they'd expect: this day and time every week, or this time on several
chosen days.

## What already exists

Almost all of it. This is an entry-point problem, not an engine problem.

| Piece | Where | Note |
|---|---|---|
| Multi-weekday pattern expansion | `patternOccurrences` (`app.js:20249`) | Already "this time on multiple days" |
| Single weekly expansion | `weeklyOccurrences` (`app.js:20222`) | |
| Pattern read back in words | `dowsPhrase` (`app.js:20261`) | "Tuesdays and Thursdays" |
| Series write | `saveCoachBooking` (`app.js:20537`) | One `sr_` id per pattern |
| Bulk insert, conflict-aware | `Cloud.createBookings` | Returns `{created, taken}` |
| Series list, Extend, End | `bookingSeriesList` / `renderCoachSeries` (`app.js:20793`) | |
| Google push for a whole series | `googleCall("push-series", …)` | One call, not one per week |
| Past-occurrence clamping | `runSetmoreLockIn` (`app.js:14337`) | The precedent this reuses |

The only way to create a series today is the "＋ Book a session" sheet, where
the athlete, time and weekday are all re-picked by hand. Nothing connects a
session already on the calendar to the series engine.

## Entry point

One new action row in the session sheet's action list (`app.js:15011`), placed
with the other scheduling actions — after "Change the date or time", before
"Cancel this session":

> 🔁 Make this a regular session

**Shown when** the session resolves to a known athlete and has a time. That
deliberately includes past sessions (the whole point of the request) and
Setmore mirror rows, since building a pattern needs only an athlete and a time.

**Hidden when** the session already belongs to a series (`e.seriesId`). The
sheet already tells the coach "Part of a weekly series." there, and offering
this would silently create a second series overlapping the first. Extending an
existing one is a different action that already lives on the Schedule card.

## The sheet

`openRepeatFromSession(row, event, client)` — a slim modal scoped to one
athlete. No athlete picker and no search: the athlete was chosen by tapping
their name.

```
Make Leo a regular
─────────────────────────
Leo Frostholm · 5:30 PM · 60 min

Repeats on
[S] [M] [T] [W] [T*] [F] [S]     ← tapped session's weekday pre-selected

For how long
[ 4 ] [ 8 ] [ 12* ] [ 26 ]  weeks

Thursdays at 5:30 PM · 12 sessions, through 30 Oct

[ Cancel ]        [ Book 12 sessions ]
```

Reuses the existing `.cbk-seg`, `.cbk-seg-btn`, `.cbk-dows` and `.cbk-hint`
styles and the `REPEAT_WEEKS` values, so it matches the sheets already in the
app and adds no CSS.

**Time and duration are not editable.** They carry over from the session
tapped — the coach is repeating *that* session, so re-asking for a time is a
decision they already made. Duration is `end_at − start_at`, floored at 15
minutes, falling back to the coach's default session length, matching how
`extendSeries` derives it (`app.js:20861`).

## The past-session rule

The behaviour the request turns on.

`patternOccurrences(fromISO, …)` starts from the first matching weekday **on or
after** `fromISO` (`nextDowISO`, `app.js:20239`). Handed the tapped session's
own date it would generate sessions in the past.

So the pattern is generated from **today**, never from the tapped session's
date, and anything already gone is dropped — the same two steps
`runSetmoreLockIn` takes:

```js
patternOccurrences(todayISO(), dows, hh, mm, tz, weeks)
  .filter((ms) => ms > Date.now())
```

Consequences, all intended:

- Repeating last Tuesday's 5:30 session starts **next** Tuesday.
- Repeating today's session after it has already happened starts next week.
- Because the first occurrence can drop, the number of sessions created is not
  always `weeks × days`.

That last point is where a bug would hide. **The summary line and the write
both read from one `plannedStarts()` call**, so the sheet cannot promise 12
sessions and then write 11. The primary button's label is counted from the same
list.

## Writing it

Identical to the series branch of `saveCoachBooking`:

1. One `sr_${uid()}` for the whole pattern, however many weekdays it spans — so
   "Tuesdays and Thursdays" is one standing appointment.
2. Rows through `Cloud.createBookings`.
3. Toast reporting created, and any slots already taken.
4. One `googleCall("push-series", { seriesId, from: rows[0].start_at })`.
5. `afterBookingChange()`.

The result is a first-class series: Extend, End, and "this and all future" work
on it immediately with no special-casing.

**Offline it refuses**, with the same wording as every other booking write. The
database is the only thing that can say whether a slot was free, so a local
"booked" would be a guess the athlete might act on.

## Testing

`tests/repeat-from-session.test.js`, covering the pure half — which start
instants a pattern produces, which is the part that goes wrong silently:

- a past session's repeat starts in the future, never behind the coach
- a session earlier **today** rolls to next week rather than booking the past
- a multi-weekday pattern keeps each weekday in step with its own anchor
- the summary count equals the number of rows written (one `plannedStarts()`)
- a pattern crossing a DST boundary keeps its clock time instead of drifting

Per `tests/README.md` these duplicate the app's functions rather than importing
them, so the copies must be updated alongside the originals.

## Out of scope

- **The coach tour copy.** Its "Standing arrangements" step (`app.js:33652`)
  reads "Set these once … this page is only for changing them", which goes
  slightly stale once a series can start from the calendar. Explicitly deferred
  — revisit later if it turns out to matter. Nothing breaks either way.
- Editing the time or duration in this sheet (use "＋ Book a session").
- Any change to how series are extended or ended.
- Converting *existing* past sessions into series rows retroactively — this
  creates future sessions only; history is left alone.
