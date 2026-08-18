// Extracted from app.js — Phase 4 (Scheduling) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/scheduling/zone.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
//
// The zone maths: every schedule surface prints in the COACH's zone (a
// session happens where the coach is), and a standing appointment is made of
// WALL CLOCK — “Mondays at 9” stays 9am across a DST change. These are the
// primitives that carry both rules: offset at an instant, wall-time →
// instant (the two-pass guess-and-correct that gets DST boundaries right),
// instant → calendar date / HH:MM as read in a zone, and the wall shape a
// Setmore pattern is rebuilt from. Genuinely pure — no app state, no seams.
// fmtSlotTime/fmtSlotDay stay in app.js: locale formatters move as parts,
// never as strings. The booking-union dedupe (bookingsByDate) also stays —
// src/scheduling/merge.js waits on its owner questions (design doc §6).
(function () {
  "use strict";
  function localTz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
  }
  // How far `tz` sits from UTC at a given instant, in ms.
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
  // The instant at which the wall clock in `tz` reads this date and time.
  // Guess, then correct by the offset the guess actually lands in — the second
  // pass is what gets the DST boundaries right.
  function zonedTimeToUtc(y, m, d, hh, mm, tz) {
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    const once = guess - tzOffsetMs(guess, tz);
    return guess - tzOffsetMs(once, tz);
  }
  // The calendar date an instant falls on, as read in `tz`.
  function zonedDateISO(utcMs, tz) {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}`;
    } catch (e) { return new Date(utcMs).toISOString().slice(0, 10); }
  }
  function parseHM(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
    if (!m) return null;
    const hh = +m[1], mm = +m[2];
    if (hh > 23 || mm > 59) return null;
    return { hh, mm };
  }

  // The wall-clock time an instant reads as in `tz`, as "HH:MM".
  function zonedHM(ms, tz) {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit",
      }).format(new Date(ms));
    } catch (e) { return "09:00"; }
  }

  // Wall clock in `tz`, which is what a standing appointment is actually made
  // of — "Mondays at 9" has to stay 9am across a DST change, so the pattern is
  // rebuilt from the clock face rather than from the instant.
  function setmoreWall(utcMs, tz) {
    const local = new Date(utcMs + tzOffsetMs(utcMs, tz));
    return { dow: local.getUTCDay(), hh: local.getUTCHours(), mm: local.getUTCMinutes() };
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.scheduling = Object.assign(NS.scheduling || {}, {
    localTz, tzOffsetMs, zonedTimeToUtc, zonedDateISO, zonedHM, parseHM,
    setmoreWall,
  });
})();
