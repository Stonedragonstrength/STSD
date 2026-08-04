// WorkoutClock — how long a session is recorded as lasting.
//
// Duplicated from app.js (search `const WorkoutClock`) because app.js is one
// IIFE with no exports. IF YOU CHANGE THE ORIGINAL, CHANGE THIS COPY TOO.
//
// This earns a test because the number is invisible until it is wrong: the
// summary says "24 minutes" after a 72-minute session and nothing about the
// screen says which one is right. Three separate bugs lived here at once, all
// of them under-counting, and all three are pinned below.
//
// Differences from app.js: `now` is passed in rather than read from Date.now(),
// and commit() writes to a plain object instead of state + saveClient().

const IDLE_MS = 5 * 60 * 1000;
const COMMIT_CAP_MS = 3 * 60 * 60 * 1000;

function makeClock(store) {
  let active = false, accum = 0, lastActive = 0, session = 0, dayKey = null;
  function flush(now) {
    if (!active) return;
    const gap = now - lastActive;
    if (gap > 0) { const add = Math.min(gap, IDLE_MS); accum += add; session += add; }
    lastActive = now;
  }
  function commit() {
    const add = Math.min(accum, COMMIT_CAP_MS); accum = 0;
    if (add < 1000) return;
    store.totalWorkoutMs = (store.totalWorkoutMs || 0) + add;
  }
  return {
    enter(now, key) {
      if (active) { flush(now); return; }
      if (key !== dayKey) { session = 0; dayKey = key ?? null; }
      active = true; accum = 0; lastActive = now;
    },
    touch(now) { if (active) flush(now); },
    sessionMs(now) { if (active) flush(now); return session; },
    leave(now) { if (!active) return; flush(now); active = false; commit(); },
    onHidden(now) { if (!active) return; flush(now); commit(); },
    onVisible() {},
  };
}

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${expected}, got ${actual}`}`);
}
const min = (m) => m * 60000;
const mins = (ms) => Math.round(ms / 60000);
// Advance `m` minutes of actual training: a tap every two minutes, which is
// what logging sets looks like and keeps every gap inside the idle cap.
function work(c, t, m) {
  for (let i = 0; i < m / 2; i++) { t += min(2); c.touch(t); }
  return t;
}

console.log("\nWorkoutClock");

// ---- 1. A rest longer than the idle cap is credited, not discarded ----
// The original rule was `gap <= IDLE_MS`, so a 5:01 rest counted as zero while
// a 4:59 rest counted in full. Heavy singles recorded ~21% of the real session.
{
  const c = makeClock({});
  let t = 0;
  c.enter(t, "d1|2026-08-04");
  t += min(6); c.touch(t);          // one 6-minute rest between heavy sets
  check("a 6-min rest credits the 5-min cap, not zero", mins(c.sessionMs(t)), 5);
}
{
  const c = makeClock({});
  let t = 0;
  c.enter(t, "d1|2026-08-04");
  t += min(4); c.touch(t);
  check("a 4-min rest credits in full", mins(c.sessionMs(t)), 4);
}
{
  // The cliff itself: 5:00 and 5:01 must not differ by five minutes.
  const a = makeClock({}), b = makeClock({});
  a.enter(0, "d"); b.enter(0, "d");
  a.touch(min(5)); b.touch(min(5) + 1000);
  const diff = Math.abs(b.sessionMs(min(5) + 1000) - a.sessionMs(min(5)));
  check("no cliff at the cap (5:00 vs 5:01 differ by <2s)", diff <= 2000, true);
}

// ---- 2. Rest with the screen off counts ----
// onVisible used to re-stamp lastActive, so every screen-lock-during-rest was
// dropped. This is the common case on a phone and cost ~two thirds of a session.
{
  const c = makeClock({});
  let t = 0;
  c.enter(t, "d1|2026-08-04");
  t += min(1); c.touch(t);          // log a set
  c.onHidden(t);                    // phone locks
  t += min(3);                      // rest
  c.onVisible(t);
  c.touch(t);                       // log the next set
  check("a 3-min rest with the screen off counts", mins(c.sessionMs(t)), 4);
}
{
  // But a genuine absence is still bounded by the cap.
  const c = makeClock({});
  let t = 0;
  c.enter(t, "d1|2026-08-04");
  c.onHidden(t);
  t += min(90);                     // phone in a bag for an hour and a half
  c.onVisible(t); c.touch(t);
  check("a 90-min absence adds only the cap", mins(c.sessionMs(t)), 5);
}

// ---- 3. Leaving the tab and coming back continues the same session ----
// enter() used to zero `session` unconditionally, so logging a shake on the
// Diet tab mid-workout restarted the clock.
{
  const c = makeClock({});
  let t = 0;
  c.enter(t, "d1|2026-08-04");
  t = work(c, t, 20);               // 20 minutes of logging
  c.leave(t);                       // → Diet tab to log a shake
  t += min(2);
  c.enter(t, "d1|2026-08-04");      // back to the same day
  t = work(c, t, 10);
  check("returning to the same day keeps the running total", mins(c.sessionMs(t)), 30);
  // The two minutes spent on the other tab are deliberately NOT counted.
}
{
  const c = makeClock({});
  let t = 0;
  c.enter(t, "d1|2026-08-04");
  t = work(c, t, 20);
  c.leave(t);
  c.enter(t, "d2|2026-08-04");      // a DIFFERENT day starts fresh
  t = work(c, t, 10);
  check("opening a different day starts a new session", mins(c.sessionMs(t)), 10);
}
{
  const c = makeClock({});
  let t = 0;
  c.enter(t, "d1|2026-08-04");
  t = work(c, t, 20); c.leave(t);
  c.enter(t, "d1|2026-08-05");      // same day id, next date
  t = work(c, t, 10);
  check("the same day tomorrow starts a new session", mins(c.sessionMs(t)), 10);
}

// ---- 4. The lifetime total still banks, and stays sane ----
{
  const store = {};
  const c = makeClock(store);
  let t = 0;
  c.enter(t, "d1|2026-08-04");
  t = work(c, t, 30);
  c.leave(t);
  check("leave() banks the chunk into the lifetime total", mins(store.totalWorkoutMs), 30);

  c.enter(t, "d2|2026-08-04");
  t = work(c, t, 16);
  c.leave(t);
  check("a second day adds to it", mins(store.totalWorkoutMs), 46);
}
{
  // COMMIT_CAP_MS bounds a single commit, so a clock left wedged for days
  // can't write a decade into the lifetime total in one go.
  const store = {};
  const c = makeClock(store);
  c.enter(0, "d1");
  // 200 touches an hour apart: each credits the 5-min cap = 1000 min accrued,
  // but one commit can only bank the 3-hour cap.
  for (let i = 1; i <= 200; i++) c.touch(min(60) * i);
  c.leave(min(60) * 201);
  check("one commit banks at most the 3-hour cap", mins(store.totalWorkoutMs), 180);
}

// ---- 5. A realistic session lands where a human would put it ----
{
  const c = makeClock({});
  let t = 0;
  c.enter(t, "d1|2026-08-04");
  for (let i = 0; i < 9; i++) { t += 40000; c.touch(t); }   // 6 min warm-up
  for (let lift = 0; lift < 4; lift++) {
    for (let set = 0; set < 4; set++) {
      t += 45000; c.touch(t);                                // the set
      c.onHidden(t); t += min(3); c.onVisible(t); c.touch(t); // rest, screen off
    }
    t += min(1.5); c.touch(t);                                // next station
  }
  const real = mins(t), measured = mins(c.sessionMs(t));
  check(`a 72-min session reports its real length (${measured}m of ${real}m)`, measured, real);
}

console.log(failures ? `\n${failures} failure(s)\n` : "\nAll passed\n");
process.exit(failures ? 1 : 0);
