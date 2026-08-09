# Booking sheet: compaction, and closing time off

Date: 2026-08-09

## What prompted it

Nathan, on the coach's ＋ Book sheet: it should be compacted, the explanatory
copy ("informative stuff like what the time does") is unnecessary, it should be
cleaner on a phone, and — the gap he'd just noticed — **all he can do is book
clients.** There is no way to close a time off.

## Where it stands today

`openBookAthleteSheet()` draws six labelled sections stacked vertically: Who,
How often, Day (or Which days), Time, Length, and — for repeats — How long,
then a note field and a bordered summary box. At 390 × 740 the sheet is 712px
of content and the coach sees Who, How often, Day and the top of Time before
the fold. Length, the note, the summary and the **Book it button** are all
below it.

Three things make it taller than it needs to be:

- Every section carries an all-caps label on its own line.
- The athlete roster is a 13rem (11rem on phones) nested scroller that stays
  full height after an athlete has been picked, even though the answer is then
  a single name.
- Three separate sections — Day, Time, Length — each ask one small question.

And three pieces of copy explain controls rather than carrying state:
"No published hours going spare that day. Set any time you like.",
"Extend it any time from the Schedule card.", and the summary box, which reads
back a sentence the controls directly above it already show.

**Closing time off** exists only as `availability.blackouts`, whole days only,
edited from Profile → Scheduling → Your availability → Days off. Three levels
away from the calendar, and it cannot express "out Thursday 2–4" or "closing
early Friday".

## The design

### One sheet, two modes

The sheet opens with a segmented control:

```
[  Athlete  ][  Block off  ]
```

Athlete mode is the sheet as it works today. Block off mode reuses the same
day / time / length controls with the athlete roster swapped for an optional
label. Same button, same place — the coach's two ways of spending an hour sit
next to each other rather than three screens apart.

### Compaction

| Now | After |
|---|---|
| Roster stays 11rem after picking | Collapses to the picked athlete on one row, with Change |
| Day, Time, Length: three labelled sections | One block: date + repeat on a row, time chips under it, length as a select on the time row |
| Six all-caps label rows | Labels only where the control isn't self-evident |
| Note field always present | Behind a `+ Note` toggle |
| Bordered summary box | Gone; the read-back moves into the button — "Book 12 sessions" |
| Three hint paragraphs | Gone |

Nothing is removed that the coach can't see elsewhere on the sheet. The one
piece of real information in the summary — how many sessions a repeat actually
creates, which is not `weeks × days` — moves onto the button that creates them,
where it is harder to miss.

### Blocks

A block is stored on `coaches.availability`, which needs no migration and no
Edge Function deploy, and which `availability_for_athlete()` already forwards
to athletes wholesale.

```
blocks: [{ id, date, endDate, allDay, start, end, label }]
```

- `date` … `endDate` — inclusive; the same day for a single-day block.
- `allDay` — true ignores `start`/`end`.
- `label` — optional, free text, shown on the calendar.

**All-day blocks also keep writing `blackouts`.** An installed PWA serves the
previous build, and that build honours `blackouts` and knows nothing about
`blocks`; without the mirror an athlete on a stale client would be offered
slots on a day the coach has closed. Timed blocks have no `blackouts`
equivalent and are only honoured by the current build — blacking out the whole
day for stale clients would overreach far more than the gap costs.

### One place decides bookability

`generateSlots()` already subtracts a `busy` list of intervals. Blocks fold
into that list inside the function, so every caller inherits them: the coach's
quick-pick times, the athlete's slot grid, and the Node test harness. No
caller changes.

Blocked whole days keep going through the existing `blackouts` skip.

Note that `coachDaySlots()` deliberately clears `blackouts` before generating —
a day off is a day *athletes* can't book, not one the coach is forbidden to put
a session on. Blocks follow the same rule: the coach can always book over their
own block, and the sheet says so rather than refusing.

### Seeing them

A block the coach can't see is a block they'll forget. Blocks draw:

- in the **day view**, as a row in the same list as sessions, visibly not an
  athlete;
- in the **week timetable**, as a hatched span at its real time;
- and both open a sheet whose action is **Remove**.

### Out of scope

Weekly repeating blocks. "No sessions after 6pm on Fridays" is a change to the
weekly hours, which already exists; adding a second way to say it would give
the same fact two homes.

## Testing

- Node: extend the slot-generation coverage so a timed block subtracts exactly
  its own interval and an all-day block clears the day.
- Browser: drive the real sheet in the sandbox at 390px and at desktop —
  book an athlete, create both kinds of block, confirm the blocked times stop
  appearing as quick-picks and that the calendar shows them.
