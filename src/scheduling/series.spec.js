// Which sessions a "make this a regular" repeat actually creates.
//
// The coach reaches this from a session on the calendar, very often one that
// has ALREADY HAPPENED — that is the case the feature was asked for.
// patternOccurrences starts from the first matching weekday on or after the
// date it is given, so handed the tapped session's own date it would happily
// book sessions into the past. Nothing would error; the coach would just find
// last Tuesday on their calendar again.
//
// The count matters as much as the dates: the sheet's button says "Book 12
// sessions" and must not then write 11. Both read this one function, and this
// spec is what holds that.
//
// Ported verbatim from tests/repeat-from-session.test.js when the series
// expansion moved out of the IIFE — tier 1 now: a real import of the shipped
// file, no more copies to keep in step. repeatStarts anchors "today" through
// the STSD.app.dateISO seam, faked here the way app.js publishes it.
import { describe, it, afterAll } from "vitest";
import assert from "node:assert";
import "./zone.js";
import "./series.js";

const {
  zonedTimeToUtc, zonedDateISO, zonedHM,
  weeklyOccurrences, dowOfISO, nextDowISO, patternOccurrences,
  repeatStarts, dowsPhrase,
} = globalThis.STSD.scheduling;

const prevApp = globalThis.STSD.app;
globalThis.STSD.app = {
  ...prevApp,
  // The app's own dateISO: the DEVICE-local calendar date. repeatStarts only
  // uses it to name "today" before the instant filter does the real work.
  dateISO: (d) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
};
afterAll(() => { globalThis.STSD.app = prevApp; });

const TZ = "America/Los_Angeles";
const days = (list) => list.map((ms) => zonedDateISO(ms, TZ));
const times = (list) => list.map((ms) => zonedHM(ms, TZ));

describe("a session that already happened repeats into the FUTURE", () => {
  // Standing on Friday 7 Aug 2026, repeating last Tuesday's 5:30pm session.
  const now = zonedTimeToUtc(2026, 8, 7, 20, 0, TZ); // Friday evening
  const got = repeatStarts([2], 17, 30, TZ, 4, now); // 2 = Tuesday
  it("nothing lands in the past", () => assert.deepStrictEqual(got.every((ms) => ms > now), true));
  it("starts the NEXT Tuesday, not the one that passed", () => assert.deepStrictEqual(days(got)[0], "2026-08-11"));
  it("four Tuesdays", () => assert.deepStrictEqual(days(got), ["2026-08-11", "2026-08-18", "2026-08-25", "2026-09-01"]));
  it("all at 17:30", () => assert.deepStrictEqual(times(got), ["17:30", "17:30", "17:30", "17:30"]));
});

describe("a session earlier TODAY rolls to next week", () => {
  // 8pm on Friday, repeating a session that was at 10am the same morning.
  const now = zonedTimeToUtc(2026, 8, 7, 20, 0, TZ);
  const got = repeatStarts([5], 10, 0, TZ, 3, now); // 5 = Friday
  it("today's slot is gone, so it starts next Friday", () => assert.deepStrictEqual(days(got)[0], "2026-08-14"));
  // "For how long" is a HORIZON in weeks, not a promise of a session count, so
  // a three-week repeat whose first slot has already been and gone is two
  // sessions. That is why the sheet's button counts from this same list rather
  // than from weeks x days — it says "Book 2 sessions" and means it.
  it("two sessions: today's has gone", () => assert.deepStrictEqual(got.length, 2));
  it("and it ends where the three weeks end", () => assert.deepStrictEqual(days(got), ["2026-08-14", "2026-08-21"]));
});

describe("a session LATER today is kept", () => {
  // 8am on Friday, repeating a 6pm Friday session: today still counts.
  const now = zonedTimeToUtc(2026, 8, 7, 8, 0, TZ);
  const got = repeatStarts([5], 18, 0, TZ, 3, now);
  it("today is the first one", () => assert.deepStrictEqual(days(got)[0], "2026-08-07"));
  it("three sessions", () => assert.deepStrictEqual(got.length, 3));
});

describe("several weekdays at one time stay in step", () => {
  const now = zonedTimeToUtc(2026, 8, 7, 20, 0, TZ); // Friday evening
  const got = repeatStarts([1, 3], 6, 0, TZ, 2, now); // Mondays and Wednesdays
  it("interleaved in date order", () =>
    assert.deepStrictEqual(days(got), ["2026-08-10", "2026-08-12", "2026-08-17", "2026-08-19"]));
  it("every one at 06:00", () => assert.deepStrictEqual(times(got), ["06:00", "06:00", "06:00", "06:00"]));
});

describe("no days picked means nothing to book", () => {
  const now = zonedTimeToUtc(2026, 8, 7, 12, 0, TZ);
  it("empty list", () => assert.deepStrictEqual(repeatStarts([], 9, 0, TZ, 12, now), []));
  it("undefined is not a crash", () => assert.deepStrictEqual(repeatStarts(undefined, 9, 0, TZ, 12, now), []));
});

describe("the clock time survives a DST boundary", () => {
  // US DST ends Sunday 1 Nov 2026. A Monday 6am series crossing it must stay
  // 6am; a naive +7*86400000ms would drift it to 5am.
  const now = zonedTimeToUtc(2026, 10, 20, 12, 0, TZ);
  const got = repeatStarts([1], 6, 0, TZ, 4, now);
  it("still 6am on both sides of the change", () =>
    assert.deepStrictEqual(times(got), ["06:00", "06:00", "06:00", "06:00"]));
  it("consecutive Mondays across the boundary", () =>
    assert.deepStrictEqual(days(got), ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]));
});

describe("the count the button promises is the count that gets written", () => {
  // The sheet labels its button from this list and the write maps over the
  // same list. Anything that makes them disagree is a bug in one of the two
  // callers.
  const now = zonedTimeToUtc(2026, 8, 7, 20, 0, TZ);
  [1, 4, 12].forEach((weeks) => {
    it(`${weeks} weeks x 2 days = ${weeks * 2} rows`, () =>
      assert.deepStrictEqual(repeatStarts([2, 4], 17, 30, TZ, weeks, now).length, weeks * 2));
  });
});

// ---- New at the port ----

describe("the primitives underneath", () => {
  it("dowOfISO reads the weekday off a plain date", () => {
    assert.deepStrictEqual(dowOfISO("2026-08-11"), 2); // a Tuesday
    assert.deepStrictEqual(dowOfISO("2026-08-16"), 0); // a Sunday
  });
  it("nextDowISO is ON or after — the same day answers for itself", () => {
    assert.deepStrictEqual(nextDowISO("2026-08-11", 2), "2026-08-11");
    assert.deepStrictEqual(nextDowISO("2026-08-11", 4), "2026-08-13");
    assert.deepStrictEqual(nextDowISO("2026-08-11", 1), "2026-08-17"); // wraps the week
  });
  it("weeklyOccurrences keeps the wall clock across the fall-back week", () => {
    const got = weeklyOccurrences("2026-10-26", 6, 0, TZ, 3);
    assert.deepStrictEqual(got.map((ms) => zonedHM(ms, TZ)), ["06:00", "06:00", "06:00"]);
    // The week the clocks fall back is one hour LONGER in UTC.
    assert.deepStrictEqual(got[1] - got[0], 7 * 86400000 + 3600000);
    assert.deepStrictEqual(got[2] - got[1], 7 * 86400000);
  });
  it("patternOccurrences merges its weekdays in instant order", () => {
    const got = patternOccurrences("2026-08-08", [3, 1], 6, 0, TZ, 2);
    assert.deepStrictEqual(days(got), ["2026-08-10", "2026-08-12", "2026-08-17", "2026-08-19"]);
  });
});

describe("dowsPhrase: the pattern read back in words", () => {
  it("the two shorthands", () => {
    assert.deepStrictEqual(dowsPhrase([0, 1, 2, 3, 4, 5, 6]), "every day");
    assert.deepStrictEqual(dowsPhrase([1, 2, 3, 4, 5]), "weekdays");
  });
  it("five days including a weekend day is NOT 'weekdays'", () =>
    assert.deepStrictEqual(dowsPhrase([0, 1, 2, 3, 6]),
      "Sundays, Mondays, Tuesdays, Wednesdays and Saturdays"));
  it("one day, two days, and the join", () => {
    assert.deepStrictEqual(dowsPhrase([2]), "Tuesdays");
    assert.deepStrictEqual(dowsPhrase([2, 4]), "Tuesdays and Thursdays");
    assert.deepStrictEqual(dowsPhrase([1, 3, 5]), "Mondays, Wednesdays and Fridays");
  });
  it("empty is empty, not a stray 'and'", () => assert.deepStrictEqual(dowsPhrase([]), ""));
});
