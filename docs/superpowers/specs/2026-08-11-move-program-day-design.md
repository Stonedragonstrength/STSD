# Move a program day — within its week, or to another week

**Date:** 2026-08-11
**Asked for as:** "a way to rearrange days within weeks for athletes in their
complete programs. If there is a whole day accident this would be very
convenient" → refined to "I want to be able to move fully filled program days
around", including across weeks, working on the athlete's Program tab.

## The problem

A "whole day accident": a fully filled day — exercises, logged sets, a
completion — sits in the wrong place. Either the wrong slot in its week, or the
wrong week entirely (a schedule slide). Today there is no working way to fix
either on the athlete's program:

- Within-week reorder EXISTS as a drag on the day tabs (`renderDayTabs`,
  app.js ~12336) but is desktop-only HTML5 drag with **no visible affordance**,
  and Nathan — trying it on the athlete Program tab, on a desktop, while being
  told where it was — could not make it work. An invisible gesture that fails
  its own author is not a feature. (Why the drag fails there is NOT
  investigated or fixed in this work; it stays as-is.)
- Cross-week movement does not exist at all.

## The fix: one visible button, one sheet

A **⇄ Move day** button in the day-action row (the row that already holds
`＋ Add day · 📥 From library · ⧉ Duplicate week · Delete week`), grouped with
the day-scope controls. It acts on the active day, the same way the week
actions act on the active week — one control row, the button text says which
scope. That row is editor-only code, which is what keeps the control out of
the athlete's own view: `renderDayContent` is shared with athletes
(stsd-shared-day-editor) and must not carry it.

Tapping it opens a sheet titled `Move "<day name>"` with two groups:

1. **Within <week label>** — one row per position in the current week, labelled
   by the day now holding that slot ("1st — now Pull Day"). Tapping one moves
   the day so it **ends up at that visual position**. The current position is
   marked and disabled. Hidden when the week has one day.
2. **To another week** — one row per other week ("Week 3 — Hypertrophy ·
   4 days"). Tapping one appends the day to that week's end. Hidden when the
   program has one week.

The button renders only when at least one group would have something in it.

After a move the editor **jumps to where the day landed** — target week
active, moved day the active tab — so the change is visible under your hand
(same principle as the training-level picker).

## Why the data model makes this safe

Logs (`exerciseLogs[exId]`), completions (`dayCompletions[dayId]`), moods and
readiness are keyed by exercise/day **ids**, never by week position. Moving the
day object between `week.days` arrays carries everything with it. The one
invariant that matters: the move must splice the **same object** — never clone,
never re-mint `day.id` — or every log silently orphans. The test pins this.

## Mechanics

New helper `moveProgramDay(weeks, fromW, dayIdx, toW, toPos)`:

- Splices `weeks[fromW].days[dayIdx]` out and inserts so it lands at index
  `toPos` of the **target array as the user saw it** — for a same-week move to
  a later slot the insertion index compensates for the removal shift (the
  classic off-by-one; pinned by test).
- Cross-week: `toPos` is the target's length (append).
- Returns the landing index; no-ops (returns null) on same-position moves and
  out-of-range input.
- Caller: `saveTrainer()`, set `_coachActiveWeekIdx` / `week._activeDayIdx`,
  re-render, toast `"<day> → <week label> ✓"` (cross-week only; within-week
  the jump is the confirmation).

Works identically in both `renderWeeks` mounts: the athlete's Program tab
(`#weeks-container`, `currentClient().weeks`) and the standalone Programs
editor (`#program-editor-weeks`, template weeks) — the existing
`_programEditorId` switch already picks the list, exactly as Duplicate week
does. An empty source week is left in place (weeks may be empty; deleting is
the coach's call).

## Not doing (recorded, not forgotten)

- Not fixing or removing the day-tab drag — separate concern, unknown root
  cause, nothing new depends on it.
- No position picker for the target week — append + within-week move covers
  it in two taps; a slot picker doubles the sheet for a rare refinement.
- No athlete-side move — the program's shape is the coach's.
- One-off days are out of scope: they are dated, not slotted (their date IS
  their position).

## Testing

`tests/move-program-day.test.js`, repo style (extract the real function with
`fnBody`, run against fixtures): object identity preserved, id unchanged,
same-week later/earlier moves land exactly, cross-week append, no-op guards,
source week left intact when emptied. UI verified in the jsdom harness:
button renders in both mounts, absent from the athlete's own view, sheet
moves a day and the active tab follows.
