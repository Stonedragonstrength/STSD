# Skip a whole day in one tap — and a one-time pullback after two in a row

**Date:** 2026-08-11
**Asked for as:** "no way for an athlete to just say that they skipped a whole
day of training … as an option, before going into the training day … if they
actually just don't do the day, not just a rest day on their calendar … I don't
want them having to manually click skip this exercise through all of them" —
plus: "if they skip 2 of the same day in a row ask them if they want to drop
the weights 15 percent … for the next week's day only."

## Part 1 — Skip the day

One tap on the day card, before entering the day. Not a rest day (a plan), not
a completion (work done): a recorded miss.

**The whole feature is sugar over an engine that already exists.** The
per-exercise Skip writes `{ id, date, sets: [], skipped: true, locked: true }`
into `exerciseLogs[ex.id]` (app.js ~29520), and every downstream reader
already has defined semantics for it:

- `progressionAttempt` (app.js:1734): whole-exercise skip → "targets hold, no
  stall. They didn't fail, they didn't train."
- The current-day walker anchors on recent activity, so a skipped day advances
  "what's next" instead of parking the athlete on it forever.
- History and the coach's breakdown file the entries by date like any log.

Skip-the-day writes that entry for **every exercise in the day** (dated today,
replacing nothing — the affordance only shows on days with nothing logged), in
one tap instead of N.

**UI:**
- The workout picker's day card grows a quiet secondary action, only on days
  with `doneEx === 0` and not checked: **"Skipped it?"** (stopPropagation — the
  card still opens the day).
- One confirm sheet: "Skip <day>? Every exercise is marked skipped. Your coach
  can see it, and your targets hold for next time."
- The card gains a third status: **"Skipped ✕"** (`wc-status skipped`) —
  distinct from Done ✓ and n/m logged. Skipped days do NOT count toward the
  week head's "n/m done".
- On a skipped card the same spot reads **"Skipped — undo"**: removes exactly
  the skip entries (skipped:true, no sets) it wrote for that date, nothing
  else. Entering the day and logging for real also overrides naturally — the
  logging card already renders and unlocks skip state.
- Coach's session-sheet breakdown: an exercise whose dated entry is a skip
  reads **"Skipped"** instead of "Not logged" — "deliberately didn't" vs
  "never opened" is the information the athlete's tap exists to send.

**A date D is a skip-occurrence of a day** when at least one exercise has a
locked skipped entry dated D and none has a real locked entry dated D. A
real-occurrence: any exercise has a locked entry with sets dated D.

## Part 2 — Two in a row → offer 15% off, next session only

When confirming a skip makes the day's two most recent occurrences both
skips (no real session between), a second sheet asks once:

> "That's two <day>s in a row. Want the next one 15% lighter? One session
> only — your numbers come back after."  [Make it lighter] [Keep my numbers]

**Storage:** `progress.pendingDeloads = { [dayId]: { pct: 15, at: <iso> } }` —
progress-side, athlete-owned, so it syncs athlete → coach with everything
else. Initialised in `ensureProgressShape`.

**Active** = the marker exists and no real locked entry has landed on that day
dated ≥ `at`. It self-expires by that definition — no consumption write, no
cleanup pass. Un-skipping the skip that triggered the offer also deletes the
marker (the premise is gone).

**Display (the only place weights change):** the logging card's one
`effectiveProgression` call (app.js ~28455). While active, a weighted target
shows `floorToGrain(target × 0.85, rule.inc)` — grain-rounded so it lands on
plate-clean numbers, floored at one grain. **Deliberately not floored at the
written weight** the automatic backoff honours: an early-chain athlete sits AT
the written weight, and that floor would turn the promised "15% lighter" into
0% exactly when they are struggling most. The automatic backoff keeps its
floor (unattended, it must not spiral); this pullback is coach-authored and
athlete-accepted, so it may undercut the prescription for its one session.
Bodyweight and reps-only exercises are untouched (there is no weight to drop;
the ladder is not the coach's 15%).

**Judging:** entries locked while a deload is active are stamped
`deload: true`. `progressionAttempt` returns `none` for them — the same
verdict as a skip: chain frozen, no stall, no climb. So the lighter session
neither reads as a miss (which would stall the ladder for taking the offer)
nor as a hit at reduced weight (which would climb reps off a weight that
wasn't the target). The week after, targets are back exactly where they were.
This is one added line in `progressionAttempt`, beside the skip line whose
semantics it copies.

**The chain's own stall/backoff machinery is untouched.** This is not a
deload in the engine's sense (`st.deloads` does not move); it is a one-session
display adjustment plus a judging exemption.

## Not doing

- No coach-side UI for the pending pullback in v1 — it rides progress sync,
  so the coach's copy has the data; surfacing it is a later nicety.
- No skip for one-off or athlete-own days (they are dated, not slotted; a
  missed one-off is just… not logged).
- No streak counting beyond two, no escalating percentages, no auto-apply.
  The offer fires at exactly two consecutive, every time it becomes true.

## Testing

Repo style (`fnBody` extraction, run the real functions):
- `progressionAttempt` returns `logged:false` for a `deload:true` entry even
  with full real sets — beside the existing skip behaviour, both pinned.
- Skip-occurrence detection: mixed dates, partial logs, undo.
- Pullback math: grain rounding, the written-weight floor, BW untouched.
- jsdom: card shows "Skipped it?" only pre-log; skip writes N entries and the
  card reads Skipped ✕; second consecutive skip raises the offer; accepting
  stores the marker and the logging card's target drops 15%; undo removes
  entries and marker.
