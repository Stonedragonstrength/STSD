# Make This a Regular Session — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the coach's session sheet, turn a session already on the calendar — including one that has already happened — into a standing weekly appointment.

**Architecture:** The recurring engine already exists and is reused unchanged (`patternOccurrences`, `Cloud.createBookings`, `series_id`, `push-series`). Three additions: a pure function deciding which start instants a repeat produces (clamped to the future), a slim athlete-locked sheet, and one action row wiring them into the existing session sheet.

**Tech Stack:** Vanilla JS, no build step, no framework. One IIFE in `app.js`. Tests are plain Node scripts run directly (`node tests/x.test.js`), no framework, no install.

## Global Constraints

- **No build step.** Edit `app.js` / `index.html` / `styles.css` directly.
- **`app.js` is one IIFE.** Every function below goes *inside* it. Nothing is exported; tests duplicate logic (see `tests/README.md`).
- **Escape all user content** rendered into `innerHTML` with `escapeHtml()`.
- **Dates are local**, never `toISOString()` slicing for a calendar date — use `dateISO()` / `todayISO()`.
- **Bump `?v=` on `app.js` in `index.html`** whenever `app.js` changes, or installed PWAs serve the cached old file.
- **Booking writes never happen offline.** Only the database can say a slot was free.
- **Do not touch the coach tour copy** — explicitly out of scope (spec).
- **Session length floor is 15 minutes**, matching `extendSeries`.
- Reuse existing CSS classes: `.cbk-sec`, `.cbk-lab`, `.cbk-dows`, `.cbk-dow`, `.cbk-dow-l`, `.cbk-dow-s`, `.cbk-seg`, `.cbk-seg-btn`, `.cbk-hint`, `.cbk-face`. Add no new CSS except where Task 2 says so.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `app.js` ~20256 | Add `repeatStarts()` | Pure: which instants a repeat produces. The only source of the count. |
| `app.js` ~10944 | Add `"sd:calrepeat"` icon | A calendar glyph distinct from `sd:calmove` beside it in the same menu |
| `app.js` ~20600 | Add `openRepeatFromSession()` | The slim athlete-locked sheet |
| `app.js` ~20600 | Add `bookRepeatFromSession()` | The write: rows, toast, Google push, refresh |
| `app.js:15033` | Add one `acts.push(...)` row | Entry point in the session sheet |
| `app.js:15111` | Add one `on("repeat", …)` | Wiring |
| `index.html:1573` | Bump `?v=` | Cache-bust |
| `tests/repeat-from-session.test.js` | Create | Pins the start-instant arithmetic |
| `tests/README.md` | Add a table row | Says why this test earns its place |

---

## Task 1: `repeatStarts()` — which instants a repeat produces

This is the whole risk of the feature. `patternOccurrences` starts from the first matching weekday **on or after** the date handed to it (`nextDowISO`, `app.js:20239`), so feeding it a past session's date books the past. Generating from today and dropping what's gone is the fix, and it is the same two steps `runSetmoreLockIn` takes (`app.js:14337`).

`nowMs` is a parameter (defaulting to `Date.now()`) purely so the test can pin a clock. The app never passes it.

**Files:**
- Modify: `app.js` — insert immediately after `patternOccurrences` ends (line ~20256, before the `DOW_LONG` comment)
- Test: `tests/repeat-from-session.test.js` (create)
- Modify: `tests/README.md`

**Interfaces:**
- Consumes: `patternOccurrences(fromISO, dows, hh, mm, tz, weeks)`, `dateISO(date)` — both already exist
- Produces: `repeatStarts(dows, hh, mm, tz, weeks, nowMs = Date.now()) -> number[]` — sorted ascending epoch ms, all strictly in the future, `[]` when `dows` is empty. Tasks 2 and 3 both call it.

- [ ] **Step 1: Write the failing test**

Create `tests/repeat-from-session.test.js`:

```js
// Which sessions a "make this a regular" repeat actually creates.
//
// The coach opens this from a session on the calendar, very often one that has
// ALREADY HAPPENED -- that is the case the feature was asked for. patternOccurrences
// starts from the first matching weekday on or after the date it is given, so handed
// the tapped session's own date it would happily book sessions into the past. Nothing
// would error; the coach would just find last Tuesday on their calendar again.
//
// The count matters as much as the dates: the sheet's button says "Book 12 sessions"
// and must not then write 11. Both read this one function, and this test is what
// holds that.
//
// DUPLICATES repeatStarts + patternOccurrences + weeklyOccurrences + nextDowISO +
// dowOfISO + zonedTimeToUtc + tzOffsetMs + dateISO from app.js. Change either side
// and change this, or it guards nothing.

// ---- copies from app.js ----
function tzOffsetMs(utcMs, tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(utcMs));
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
  } catch (e) { return 0; }
}
function zonedTimeToUtc(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const once = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(once, tz);
}
function zonedDateISO(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function zonedHM(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}
function dateISO(d) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}
function dowOfISO(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}
function nextDowISO(fromISO, dow) {
  const [y, m, d] = String(fromISO).split("-").map(Number);
  const delta = (((dow - dowOfISO(fromISO)) % 7) + 7) % 7;
  const t = new Date(Date.UTC(y, m - 1, d + delta, 12));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
function weeklyOccurrences(firstISO, hh, mm, tz, count) {
  const [y, m, d] = String(firstISO).split("-").map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i * 7));
    out.push(zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz));
  }
  return out;
}
function patternOccurrences(fromISO, dows, hh, mm, tz, weeks) {
  const list = (dows || []).slice().sort((a, b) => a - b);
  const out = [];
  list.forEach((dow) => {
    out.push(...weeklyOccurrences(nextDowISO(fromISO, dow), hh, mm, tz, weeks));
  });
  return out.sort((a, b) => a - b);
}
// ---- the function under test ----
function repeatStarts(dows, hh, mm, tz, weeks, nowMs) {
  if (!(dows || []).length) return [];
  return patternOccurrences(dateISO(new Date(nowMs)), dows, hh, mm, tz, weeks)
    .filter((ms) => ms > nowMs);
}

let pass = 0, fail = 0;
function eq(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
}
const TZ = "America/Los_Angeles";
const days = (list) => list.map((ms) => zonedDateISO(ms, TZ));
const times = (list) => list.map((ms) => zonedHM(ms, TZ));

console.log("-- a session that already happened repeats into the FUTURE --");
{
  // Standing on Friday 7 Aug 2026, repeating last Tuesday's 5:30pm session.
  const now = zonedTimeToUtc(2026, 8, 7, 20, 0, TZ); // Friday evening
  const got = repeatStarts([2], 17, 30, TZ, 4, now); // 2 = Tuesday
  eq("nothing lands in the past", got.every((ms) => ms > now), true);
  eq("starts the NEXT Tuesday, not the one that passed", days(got)[0], "2026-08-11");
  eq("four Tuesdays", days(got), ["2026-08-11", "2026-08-18", "2026-08-25", "2026-09-01"]);
  eq("all at 17:30", times(got), ["17:30", "17:30", "17:30", "17:30"]);
}

console.log("\n-- a session earlier TODAY rolls to next week --");
{
  // 8pm on Friday, repeating a session that was at 10am the same morning.
  const now = zonedTimeToUtc(2026, 8, 7, 20, 0, TZ);
  const got = repeatStarts([5], 10, 0, TZ, 3, now); // 5 = Friday
  eq("today's slot is gone, so it starts next Friday", days(got)[0], "2026-08-14");
  eq("three sessions, not four", got.length, 3);
}

console.log("\n-- a session LATER today is kept --");
{
  // 8am on Friday, repeating a 6pm Friday session: today still counts.
  const now = zonedTimeToUtc(2026, 8, 7, 8, 0, TZ);
  const got = repeatStarts([5], 18, 0, TZ, 3, now);
  eq("today is the first one", days(got)[0], "2026-08-07");
  eq("three sessions", got.length, 3);
}

console.log("\n-- several weekdays at one time stay in step --");
{
  const now = zonedTimeToUtc(2026, 8, 7, 20, 0, TZ); // Friday evening
  const got = repeatStarts([1, 3], 6, 0, TZ, 2, now); // Mondays and Wednesdays
  eq("interleaved in date order", days(got),
    ["2026-08-10", "2026-08-12", "2026-08-17", "2026-08-19"]);
  eq("every one at 06:00", times(got), ["06:00", "06:00", "06:00", "06:00"]);
}

console.log("\n-- no days picked means nothing to book --");
{
  const now = zonedTimeToUtc(2026, 8, 7, 12, 0, TZ);
  eq("empty list", repeatStarts([], 9, 0, TZ, 12, now), []);
  eq("undefined is not a crash", repeatStarts(undefined, 9, 0, TZ, 12, now), []);
}

console.log("\n-- the clock time survives a DST boundary --");
{
  // US DST ends Sunday 1 Nov 2026. A Monday 6am series crossing it must stay
  // 6am; a naive +7*86400000ms would drift it to 5am.
  const now = zonedTimeToUtc(2026, 10, 20, 12, 0, TZ);
  const got = repeatStarts([1], 6, 0, TZ, 4, now);
  eq("still 6am on both sides of the change", times(got), ["06:00", "06:00", "06:00", "06:00"]);
  eq("consecutive Mondays across the boundary", days(got),
    ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
}

console.log("\n-- the count the button promises is the count that gets written --");
{
  // The sheet labels its button from this list and the write maps over the same
  // list. Anything that makes them disagree is a bug in one of the two callers.
  const now = zonedTimeToUtc(2026, 8, 7, 20, 0, TZ);
  [1, 4, 12].forEach((weeks) => {
    const got = repeatStarts([2, 4], 17, 30, TZ, weeks, now);
    eq(`${weeks} weeks x 2 days = ${weeks * 2} rows`, got.length, weeks * 2);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd "C:/Users/Natha/OneDrive/Desktop/Stone Dragon Strength Training/STSD"
node tests/repeat-from-session.test.js
```

Expected: it **passes**, because the test carries its own copy of `repeatStarts`. That is the point of this suite's design — the copy is the spec. Before moving on, prove the test has teeth by temporarily changing the test's own copy to `patternOccurrences(dateISO(new Date(nowMs)), ...)` **without** the `.filter(...)`, re-running, and confirming the "nothing lands in the past" and "rolls to next week" assertions FAIL. Then put the filter back and confirm green.

- [ ] **Step 3: Add `repeatStarts` to `app.js`**

Insert directly after `patternOccurrences` closes (after line ~20256, before the `// "Tuesdays and Thursdays", "every day"…` comment):

```js
  // Which start instants a "repeat this session" pattern actually produces.
  //
  // Generated from TODAY, never from the session that was tapped. The coach
  // reaches this from a session that has often ALREADY HAPPENED, and
  // nextDowISO() returns the first matching weekday on or *after* the date it
  // is given -- so the tapped date would put last Tuesday back on the calendar.
  // Anything already gone is then dropped, the same two steps the Setmore
  // lock-in takes.
  //
  // One consequence, and it is intended: the first occurrence can fall away, so
  // the number of sessions is not always weeks x days. The sheet's summary, its
  // button label and the write all read THIS function, so the count promised
  // and the count created cannot drift apart.
  //
  // `nowMs` is injectable only so the test can pin a clock; the app never
  // passes it.
  function repeatStarts(dows, hh, mm, tz, weeks, nowMs = Date.now()) {
    if (!(dows || []).length) return [];
    return patternOccurrences(dateISO(new Date(nowMs)), dows, hh, mm, tz, weeks)
      .filter((ms) => ms > nowMs);
  }
```

- [ ] **Step 4: Check syntax and confirm the copies match**

```bash
node --check app.js
node tests/repeat-from-session.test.js
```

Expected: `SYNTAX OK`-equivalent (no output from `--check`), and all test assertions PASS. Then read the app's `repeatStarts` and the test's copy side by side and confirm they are character-identical apart from the default parameter.

- [ ] **Step 5: Add the tests/README.md row**

Add to the table in `tests/README.md`:

```markdown
| `repeat-from-session.test.js` | `repeatStarts` — which sessions "Make this a regular session" creates | The coach reaches it from a session that has usually already happened, and `patternOccurrences` starts from the first matching weekday *on or after* the date it is handed — so the tapped date would quietly re-book the past. Nothing errors; last Tuesday just reappears. Covers: a past session starting in the future, a session earlier today rolling a week while one later today is kept, several weekdays staying in step, clock time surviving a DST change, and the count the button promises equalling the rows written. |
```

- [ ] **Step 6: Commit**

```bash
git add app.js tests/repeat-from-session.test.js tests/README.md
git commit -m "Add repeatStarts: a repeat generates forward from today, never the past

Reached from a session that has usually already happened, so the pattern
cannot start from the tapped date without re-booking history."
```

---

## Task 2: The sheet

Slim and athlete-locked: the athlete was chosen by tapping their name, and the time and length are the ones being repeated, so the only decisions left are which days and for how long.

**Files:**
- Modify: `app.js` — add both functions immediately after `saveCoachBooking` ends (line ~20592, before the `// Both calendars have to catch up` comment)
- Modify: `styles.css` — two small rules

**Interfaces:**
- Consumes: `repeatStarts()` (Task 1); existing `normalizeAvailability`, `coachAvailability`, `localTz`, `parseHM`, `zonedHM`, `zonedDateISO`, `dowOfISO`, `dowsPhrase`, `fmtSlotTime`, `fmtSlotDay`, `athleteFaceHtml`, `escapeHtml`, `openModal`, `closeModal`, `toast`, `DOW_NAMES`, `REPEAT_WEEKS`
- Produces: `openRepeatFromSession(e, c)` — `e` is a day-view event `{ startAt, endAt, seriesId, native, bookingId, … }`, `c` is the athlete object. Task 4 calls it. It calls `bookRepeatFromSession` from Task 3.

- [ ] **Step 1: Add the sheet to `app.js`**

```js
  // "Make this a regular session" -- a session already on the calendar becomes
  // a standing appointment.
  //
  // Deliberately slimmer than the booking sheet: no athlete roster, because the
  // athlete was picked by tapping their name, and no time field, because the
  // whole point is repeating THIS time. A coach who wants a different time
  // wants a different session, and that is what "+ Book a session" is for.
  function openRepeatFromSession(e, c) {
    const a = normalizeAvailability(coachAvailability());
    const tz = a.tz || localTz();
    const startMs = +new Date(e.startAt);
    const hm = parseHM(zonedHM(startMs, tz)) || { hh: 9, mm: 0 };
    // The length being repeated. A Setmore mirror row can arrive with no end on
    // it, so the coach's own session length is the fallback.
    const endMs = e.endAt ? +new Date(e.endAt) : 0;
    const mins = endMs > startMs
      ? Math.max(15, Math.round((endMs - startMs) / 60000))
      : a.sessionMins;
    const draft = { dows: [dowOfISO(zonedDateISO(startMs, tz))], weeks: 12 };

    // The same sentence shape the booking sheet reads back, so the two sheets
    // sound like one app.
    const summaryText = (starts) => {
      if (!starts.length) return "";
      const last = fmtSlotDay(zonedDateISO(starts[starts.length - 1], tz));
      return `${dowsPhrase(draft.dows)} at ${fmtSlotTime(starts[0], tz)} · ` +
        `${starts.length} session${starts.length === 1 ? "" : "s"}, through ${last}`;
    };

    const draw = () => {
      const body = $("#modal-body"); if (!body) return;
      const starts = repeatStarts(draft.dows, hm.hh, hm.mm, tz, draft.weeks);
      body.innerHTML =
        `<div class="cbk-rep-head">` +
          `<span class="cbk-face">${athleteFaceHtml(c)}</span>` +
          `<span class="cbk-rep-id"><b>${escapeHtml(c.name)}</b>` +
            `<span>${escapeHtml(fmtSlotTime(startMs, tz))} · ${mins} min</span>` +
          `</span>` +
        `</div>` +
        `<div class="cbk-sec">` +
          `<div class="cbk-lab">Repeats on</div>` +
          `<div class="cbk-dows">${DOW_NAMES.map((name, i) =>
            `<button type="button" class="cbk-dow${draft.dows.includes(i) ? " on" : ""}" data-dow="${i}" aria-pressed="${draft.dows.includes(i)}">` +
              `<span class="cbk-dow-l">${escapeHtml(name[0])}</span>` +
              `<span class="cbk-dow-s">${escapeHtml(name)}</span>` +
            `</button>`).join("")}</div>` +
          (draft.dows.length ? "" : `<p class="cbk-hint">Pick at least one day.</p>`) +
        `</div>` +
        `<div class="cbk-sec">` +
          `<div class="cbk-lab">For how long</div>` +
          `<div class="cbk-seg">${REPEAT_WEEKS.map((n) =>
            `<button type="button" class="cbk-seg-btn${n === draft.weeks ? " on" : ""}" data-rw="${n}">${n}</button>`).join("")}</div>` +
          `<p class="cbk-hint">weeks</p>` +
        `</div>` +
        `<p class="cbk-rep-sum">${escapeHtml(summaryText(starts))}</p>`;

      // The button counts from the same list the write maps over, so it can
      // never promise a number that doesn't get created.
      const btn = $("#modal-foot .btn-primary");
      if (btn) {
        btn.disabled = !starts.length;
        btn.textContent = starts.length
          ? `Book ${starts.length} session${starts.length === 1 ? "" : "s"}`
          : "Book";
      }

      body.querySelectorAll("[data-dow]").forEach((b) => b.addEventListener("click", () => {
        const d = +b.dataset.dow;
        draft.dows = draft.dows.includes(d)
          ? draft.dows.filter((x) => x !== d)
          : draft.dows.concat(d).sort((x, y) => x - y);
        draw();
      }));
      body.querySelectorAll("[data-rw]").forEach((b) => b.addEventListener("click", () => {
        draft.weeks = +b.dataset.rw;
        draw();
      }));
    };

    openModal({
      title: `Make ${escapeHtml(String(c.name || "").split(" ")[0])} a regular`,
      body: "",
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Book", className: "btn btn-primary", onClick: () => {
          const starts = repeatStarts(draft.dows, hm.hh, hm.mm, tz, draft.weeks);
          if (!starts.length) { toast("Pick at least one day."); return; }
          bookRepeatFromSession(c, starts, mins);
        }},
      ],
    });
    draw();
  }
```

- [ ] **Step 2: Add the two CSS rules**

Append to `styles.css`, next to the other `.cbk-` rules:

```css
/* The athlete this repeat is for — read back, not re-picked. */
.cbk-rep-head { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.9rem; }
.cbk-rep-id { display: flex; flex-direction: column; line-height: 1.25; }
.cbk-rep-id span { font-size: 0.85em; color: rgba(var(--text-rgb), 0.65); }
.cbk-rep-sum { margin: 0.9rem 0 0; font-size: 0.9em; color: rgba(var(--text-rgb), 0.75); min-height: 1.2em; }
```

If `--text-rgb` is not the variable this stylesheet uses for body text, match whatever the neighbouring `.cbk-hint` rule uses rather than introducing a new one. Never hardcode a hex colour — ten themes including a light one read these.

- [ ] **Step 3: Check syntax**

```bash
node --check app.js
```

Expected: no output (success). `openRepeatFromSession` calls `bookRepeatFromSession`, which does not exist yet — that is fine, it is only resolved when clicked, and Task 3 adds it before anything can click it.

- [ ] **Step 4: Commit**

```bash
git add app.js styles.css
git commit -m "Add the repeat-from-session sheet

Athlete locked and time fixed: the only decisions are which days and
how many weeks. Button label counts from repeatStarts, same list the
write will map over."
```

---

## Task 3: The write

Identical in shape to the series branch of `saveCoachBooking` (`app.js:20555`), which is the pattern to copy — one series id for the whole thing, one Google call, refresh both calendars.

**Files:**
- Modify: `app.js` — immediately after `openRepeatFromSession`

**Interfaces:**
- Consumes: `repeatStarts()` output via its caller; `Cloud.createBookings`, `Cloud.googleCall`, `uid`, `toast`, `closeModal`, `afterBookingChange`, `state.trainerData.coachId`
- Produces: `bookRepeatFromSession(c, starts, mins)` — `c` the athlete, `starts` epoch-ms array from `repeatStarts`, `mins` session length. Called by Task 2's primary button.

- [ ] **Step 1: Add the write to `app.js`**

```js
  async function bookRepeatFromSession(c, starts, mins) {
    // Never faked offline: the database is the only thing that can say whether
    // a slot was free, and a local "booked" is a guess the athlete may act on.
    if (!window.Cloud?.enabled) {
      toast("Booking needs a connection. Try again once you're back online.", 5000);
      return;
    }
    // One series id for the whole pattern however many weekdays it spans, so
    // "Tuesdays and Thursdays" is ONE standing appointment and Extend, End and
    // "this and all future" act on all of it at once.
    const seriesId = `sr_${uid()}`;
    const rows = starts.map((ms) => ({
      id: uid(),
      // Sent for the not-null column; a BEFORE INSERT trigger replaces it with
      // the athlete's real coach either way.
      coach_id: state.trainerData.coachId || "",
      athlete_id: c.id,
      start_at: new Date(ms).toISOString(),
      end_at: new Date(ms + mins * 60000).toISOString(),
      status: "booked",
      created_by: "coach",
      note: null,
      series_id: seriesId,
    }));
    closeModal();
    const res = await window.Cloud.createBookings(rows);
    const made = (res?.created || []).length;
    const skipped = (res?.taken || []).length;
    if (!made) {
      toast(skipped
        ? "Every one of those times is already booked. Nothing was changed."
        : "Couldn't save those bookings. Try again.", 5000);
      return;
    }
    toast(`${made} session${made === 1 ? "" : "s"} booked for ${c.name} ✓` +
      (skipped ? ` · ${skipped} already taken` : ""), 5000);
    // One call for the whole series rather than one per week. Google failing is
    // a sync problem and never undoes a booking that already saved.
    window.Cloud.googleCall?.("push-series", { seriesId, from: rows[0].start_at });
    afterBookingChange();
  }
```

- [ ] **Step 2: Check syntax**

```bash
node --check app.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "Write the repeat as a first-class series

One sr_ id for the whole pattern, one push-series call, then refresh --
so Extend and End work on it with no special-casing."
```

---

## Task 4: The entry point, the icon, and end-to-end verification

**Files:**
- Modify: `app.js:10944` area — add the `sd:calrepeat` icon
- Modify: `app.js:15033` area — the action row
- Modify: `app.js:15111` area — the click wiring
- Modify: `index.html:1573` — `?v=` bump
- Create: scratchpad harness for verification

**Interfaces:**
- Consumes: `openRepeatFromSession(e, c)` (Task 2)
- Produces: nothing new

- [ ] **Step 1: Add the icon**

The session sheet already carries `sd:calmove`, and the comment above it (`app.js:10941`) is explicit that two icons in the same list must not read as the same action at a glance. So this gets its own: the same calendar body, with a cycle arrow instead of a straight one.

Insert immediately after the `"sd:calmove"` entry:

```js
    // The same calendar as sd:calmove and sd:calx, with a cycle arrow: this one
    // is the session happening AGAIN, not moving and not vanishing. All three
    // appear in the session sheet together, so they share a body and differ
    // only in the mark inside it.
    "sd:calrepeat": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.3" y="5.2" width="17.4" height="15.5" rx="3"/><path d="M3.3 10.1h17.4M8.1 3.3v3.6M15.9 3.3v3.6"/><path d="M9 15.2a3.1 3.1 0 0 1 5.3-2.2l1.2 1.1"/><path d="M15.8 12.1v2.4h-2.4"/><path d="M15 16.6a3.1 3.1 0 0 1-5.3 2.2l-1.2-1.1"/><path d="M8.2 19.7v-2.4h2.4"/></svg>',
```

Eyeball it in the browser at Step 5. If the cycle arrows read muddy at that size, simplify to a single arc plus one arrowhead rather than shipping something illegible.

- [ ] **Step 2: Add the action row**

At `app.js:15033`, immediately after the `"move"` row and before the `"cancel"` row:

```js
      if (e.native && e.bookingId) acts.push(act("move", "sd:calmove", "Change the date or time"));
      // Turning this session into a standing appointment. Offered on a session
      // that has ALREADY HAPPENED as well -- that is the common way it gets
      // used, and repeatStarts() begins the pattern from today so nothing can
      // land in the past. Also offered on a Setmore mirror row, which has no
      // booking of its own: a pattern needs only an athlete and a time, and
      // converting one of those to a native series is exactly the point.
      //
      // Not offered when this session is already part of a series -- the sheet
      // says so a few lines below, and a second series would silently overlap
      // the first. Extending an existing one lives on the Schedule card.
      if (!e.seriesId) acts.push(act("repeat", "sd:calrepeat", "Make this a regular session"));
      if (e.native && e.bookingId) acts.push(act("cancel", "sd:calx", "Cancel this session", "danger"));
```

Note this sits inside the existing `if (c && e) {` block, so both an athlete and an event are already guaranteed.

- [ ] **Step 3: Wire the click**

At `app.js:15111`, after the `on("move", …)` line:

```js
    on("move", () => { closeModal(); openMoveBookingSheet(e, c); });
    on("repeat", () => { closeModal(); openRepeatFromSession(e, c); });
```

- [ ] **Step 4: Bump the cache-bust and check syntax**

In `index.html`, change the `app.js` script tag's `?v=` to a new value (e.g. `?v=repeat1`). Note Task 2 also changed `styles.css`, so bump **that** tag's `?v=` too.

```bash
node --check app.js
node tests/repeat-from-session.test.js
```

Expected: no output from `--check`; all test assertions PASS.

- [ ] **Step 5: Verify in the real app**

jsdom, driving the actual app — not a re-implementation. Follow `stsd-mock-cloud-for-testing`: a Proxy fake `window.Cloud` with `enabled: true`, evaluated before `app.js`. Seed `trainerpro_data_v1` with `coachAuthId` matching the fake session's user id, or boot lands on the login screen. Have the fake's `createBookings` **record the rows it is handed** and return `{ created: rows.map(r => r.id), taken: [] }`.

Assert, in the real DOM:

1. Open the session sheet for a session **in the past**. The sheet contains a `[data-act="repeat"]` button reading "Make this a regular session".
2. A session whose event has a `seriesId` does **not** contain that button.
3. Clicking it opens the sheet; its primary button reads `Book 12 sessions` and the summary line names the tapped session's weekday.
4. Toggling a second weekday updates the button to `Book 24 sessions`.
5. Clicking the primary button hands `createBookings` 24 rows, every `start_at` strictly in the future, all sharing one `series_id` beginning `sr_`, each `end_at − start_at` equal to the tapped session's length.

Assertion 5 is the one that matters most — it is the whole feature in one check.

- [ ] **Step 6: Commit and push**

```bash
git add app.js index.html
git commit -m "Make a session on the calendar into a standing appointment

The recurring engine already did both patterns asked for; it just could
not be reached from a session on the calendar. Offered on past sessions
and on Setmore mirror rows, hidden when the session is already part of
a series."
git push origin main
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Action row after "Change the date or time", before "Cancel" | 4, Step 2 |
| Shown for past sessions and Setmore mirror rows | 4, Step 2 + verified 4, Step 5 |
| Hidden when already part of a series | 4, Step 2 + verified 4, Step 5 |
| Slim sheet, athlete locked, no picker/search | 2, Step 1 |
| Time and duration read back, not editable | 2, Step 1 |
| Duration = `end_at − start_at`, floor 15 min, fallback to session length | 2, Step 1 |
| Weekday pre-selected from tapped session | 2, Step 1 (`draft.dows`) |
| `REPEAT_WEEKS` picker, default 12 | 2, Step 1 |
| Live summary in `dowsPhrase` shape | 2, Step 1 |
| Pattern generated from today, past dropped | 1, Step 3 |
| Summary and write share one call | 1 (`repeatStarts`), 2 (button label), 3 (rows) |
| One `sr_` id per pattern | 3, Step 1 |
| Toast reports created and taken | 3, Step 1 |
| One `push-series` call | 3, Step 1 |
| `afterBookingChange()` | 3, Step 1 |
| Offline refuses | 3, Step 1 |
| All five test cases | 1, Step 1 |
| Coach tour untouched | Global Constraints |

**Placeholder scan:** none — every code step carries the code to paste. The one judgement call left open is deliberate and bounded: the icon's legibility at small size (Task 4, Step 1), which cannot be settled without looking at it.

**Type consistency:** `repeatStarts(dows, hh, mm, tz, weeks, nowMs?)` returns `number[]` and is called identically in Tasks 2 and 3. `openRepeatFromSession(e, c)` matches the `on("repeat", …)` call site. `bookRepeatFromSession(c, starts, mins)` matches its call in Task 2's primary button — three arguments in both places, no `tz` (the write needs only epoch ms and a length).
