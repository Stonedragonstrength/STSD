// Extracted from app.js — Phase 4 (Scheduling) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/scheduling/series.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
//
// The series expansion: which start instants a weekly pattern implies
// (patternOccurrences — “Tuesdays and Thursdays at 6am” without hunting for
// a Tuesday first), stepped in WALL CLOCK so a 6am series stays 6am across
// a DST change (weeklyOccurrences), and which of those a “repeat this
// session” actually books (repeatStarts — generated from TODAY, never from
// the tapped session, so a session that already happened cannot re-book
// last Tuesday). dowsPhrase rides along: deterministic string assembly, not
// a locale formatter.
//
// zonedTimeToUtc comes off the namespace at load, loudly; dateISO (the
// device-local calendar date repeatStarts anchors “today” on) is app-owned
// and read through the STSD.app getter at CALL time, never captured.
(function () {
  "use strict";

  function dateISO(d) {
    return globalThis.STSD.app.dateISO(d);
  }

  // From src/scheduling/zone.js, which index.html loads first (the boot
  // smoke executes the tags in that order). Checked at load so a missing or
  // misordered tag fails HERE, by name.
  const { zonedTimeToUtc } = globalThis.STSD?.scheduling || {};
  if (typeof zonedTimeToUtc !== "function") {
    throw new Error("src/scheduling/zone.js must load before series.js");
  }
  // Weekly, in WALL CLOCK. Stepping by 7 × 86400000 would move a 6am session to
  // 5am the week the clocks change; every occurrence is recomputed from the
  // calendar date it lands on instead. Pure — the Node harness covers the
  // November fall-back week.
  function weeklyOccurrences(firstISO, hh, mm, tz, count) {
    const [y, m, d] = String(firstISO).split("-").map(Number);
    const out = [];
    for (let i = 0; i < count; i++) {
      const day = new Date(Date.UTC(y, m - 1, d + i * 7));
      out.push(zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz));
    }
    return out;
  }

  // The weekday a plain calendar date falls on (0 = Sunday). Read off a UTC
  // noon so no offset can push it onto the neighbouring day.
  function dowOfISO(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  }
  // The first date on or after `fromISO` that lands on weekday `dow`.
  function nextDowISO(fromISO, dow) {
    const [y, m, d] = String(fromISO).split("-").map(Number);
    const delta = (((dow - dowOfISO(fromISO)) % 7) + 7) % 7;
    const t = new Date(Date.UTC(y, m - 1, d + delta, 12));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  }
  // Every start instant a weekly pattern implies: for each weekday chosen, the
  // first such day on or after `fromISO`, then `weeks` weekly occurrences of
  // it. This is what makes "Tuesdays and Thursdays at 6am" expressible without
  // the coach hunting for a Tuesday on the calendar first.
  function patternOccurrences(fromISO, dows, hh, mm, tz, weeks) {
    const list = (dows || []).slice().sort((a, b) => a - b);
    const out = [];
    list.forEach((dow) => {
      out.push(...weeklyOccurrences(nextDowISO(fromISO, dow), hh, mm, tz, weeks));
    });
    return out.sort((a, b) => a - b);
  }
  // Which start instants a "repeat this session" pattern actually produces.
  //
  // Generated from TODAY, never from the session that was tapped. The coach
  // reaches this from a session that has often ALREADY HAPPENED, and
  // nextDowISO() returns the first matching weekday on or *after* the date it
  // is given — so the tapped date would put last Tuesday back on the calendar.
  // Anything already gone is then dropped, the same two steps the Setmore
  // lock-in takes.
  //
  // One consequence, and it is intended: the first occurrence can fall away, so
  // the number of sessions is not always weeks x days. "For how long" is a
  // horizon, not a promised count. The sheet's summary, its button label and
  // the write all read THIS function, so the count promised and the count
  // created cannot drift apart.
  //
  // `nowMs` is injectable only so the test can pin a clock; the app never
  // passes it.
  function repeatStarts(dows, hh, mm, tz, weeks, nowMs = Date.now()) {
    if (!(dows || []).length) return [];
    return patternOccurrences(dateISO(new Date(nowMs)), dows, hh, mm, tz, weeks)
      .filter((ms) => ms > nowMs);
  }

  // "Tuesdays and Thursdays", "every day", "weekdays" — the pattern read back in
  // words, because a row of highlighted letters is not something to double-check
  // a standing appointment against.
  const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function dowsPhrase(dows) {
    const list = (dows || []).slice().sort((a, b) => a - b);
    if (!list.length) return "";
    if (list.length === 7) return "every day";
    if (list.length === 5 && list.join() === "1,2,3,4,5") return "weekdays";
    const names = list.map((d) => DOW_LONG[d] + "s");
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.scheduling = Object.assign(NS.scheduling || {}, {
    weeklyOccurrences, dowOfISO, nextDowISO, patternOccurrences,
    repeatStarts, dowsPhrase,
  });
})();
