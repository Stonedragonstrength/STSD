// The zone maths — the primitives every schedule surface stands on.
//
// Two rules ride these functions. Everything prints in the COACH's zone (a
// session happens where the coach is, so a travelling athlete must not watch
// their sessions slide by the offset). And a standing appointment is made of
// WALL CLOCK — "Mondays at 9" stays 9am across a DST change, which is why
// zonedTimeToUtc guesses and then corrects by the offset the guess lands in:
// the second pass is what gets the boundaries right.
//
// NEW coverage at the extraction: these had no dedicated test — the
// repeat-from-session and blocked-time suites carried hand copies (now
// re-pointed here), and the copies were the only pin these DST subtleties had.
import { describe, it } from "vitest";
import assert from "node:assert";
import "./zone.js";

const {
  localTz, tzOffsetMs, zonedTimeToUtc, zonedDateISO, zonedHM, parseHM, setmoreWall,
} = globalThis.STSD.scheduling;

const NY = "America/New_York";

describe("tzOffsetMs: how far a zone sits from UTC at an instant", () => {
  it("New York is -5 in winter, -4 in summer — the offset is per instant", () => {
    assert.strictEqual(tzOffsetMs(Date.UTC(2026, 0, 15, 12), NY) / 3600000, -5);
    assert.strictEqual(tzOffsetMs(Date.UTC(2026, 6, 15, 12), NY) / 3600000, -4);
  });
  it("UTC is zero all year", () => {
    assert.strictEqual(tzOffsetMs(Date.UTC(2026, 0, 15, 12), "UTC"), 0);
    assert.strictEqual(tzOffsetMs(Date.UTC(2026, 6, 15, 12), "UTC"), 0);
  });
  it("half-hour zones come back exact", () =>
    assert.strictEqual(tzOffsetMs(Date.UTC(2026, 0, 15, 12), "Asia/Kolkata") / 3600000, 5.5));
  it("midnight is hour 0, not hour 24 — the %24 that keeps en-US honest", () => {
    // en-US with hour12:false reports midnight as "24"; without the wrap the
    // offset at any midnight instant comes back a day wrong.
    const midnightNY = zonedTimeToUtc(2026, 8, 18, 0, 0, NY);
    assert.strictEqual(tzOffsetMs(midnightNY, NY) / 3600000, -4);
  });
  it("a garbage zone reads as 0, not a throw", () =>
    assert.strictEqual(tzOffsetMs(Date.UTC(2026, 0, 15), "Not/AZone"), 0));
});

describe("zonedTimeToUtc: the instant at which a wall clock reads a time", () => {
  it("round-trips: the instant reads back as the wall time asked for", () => {
    // A matrix across both 2026 US transitions (spring forward Mar 8, fall
    // back Nov 1) — the single-pass version drifts an hour near a boundary.
    const cases = [
      [2026, 3, 7, 9, 0], [2026, 3, 8, 9, 0], [2026, 3, 9, 9, 0],
      [2026, 10, 31, 9, 0], [2026, 11, 1, 9, 0], [2026, 11, 2, 9, 0],
      [2026, 3, 8, 6, 30], [2026, 11, 1, 6, 30],
      // The hour right after the spring-forward skip: the one-pass guess reads
      // its offset on the EST side while the instant lands on the EDT side —
      // exactly the case the second correction exists for.
      [2026, 3, 8, 3, 0],
    ];
    cases.forEach(([y, m, d, hh, mm]) => {
      const ms = zonedTimeToUtc(y, m, d, hh, mm, NY);
      const want = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      assert.strictEqual(zonedHM(ms, NY), want, `${y}-${m}-${d} ${want} came back a different wall time`);
      assert.strictEqual(zonedDateISO(ms, NY),
        `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        `${y}-${m}-${d} landed on the wrong calendar day`);
    });
  });
  it("Mondays at 9 stays 9am across the change — one hour more of UTC apart", () => {
    const before = zonedTimeToUtc(2026, 3, 2, 9, 0, NY);  // EST Monday
    const after = zonedTimeToUtc(2026, 3, 9, 9, 0, NY);   // EDT Monday
    assert.strictEqual(zonedHM(before, NY), "09:00");
    assert.strictEqual(zonedHM(after, NY), "09:00");
    // Seven days minus the hour the clocks sprang forward.
    assert.strictEqual(after - before, 7 * 86400000 - 3600000);
  });
});

describe("zonedDateISO: the calendar date an instant falls on, in a zone", () => {
  it("a late UTC evening is still the same day in New York", () =>
    assert.strictEqual(zonedDateISO(Date.UTC(2026, 7, 18, 23, 30), NY), "2026-08-18"));
  it("an early UTC morning is the day BEFORE in New York", () =>
    assert.strictEqual(zonedDateISO(Date.UTC(2026, 7, 18, 2, 30), NY), "2026-08-17"));
  it("and already tomorrow in Tokyo", () =>
    assert.strictEqual(zonedDateISO(Date.UTC(2026, 7, 18, 23, 30), "Asia/Tokyo"), "2026-08-19"));
  it("a garbage zone falls back to UTC's date, not a throw", () =>
    assert.strictEqual(zonedDateISO(Date.UTC(2026, 7, 18, 23, 30), "Not/AZone"), "2026-08-18"));
});

describe("zonedHM", () => {
  it("HH:MM in the zone, 24-hour, zero-padded", () => {
    assert.strictEqual(zonedHM(Date.UTC(2026, 7, 18, 13, 5), NY), "09:05");
    assert.strictEqual(zonedHM(Date.UTC(2026, 7, 18, 4, 0), NY), "00:00");
  });
  it("a garbage zone falls back to 09:00, not a throw", () =>
    assert.strictEqual(zonedHM(Date.UTC(2026, 7, 18), "Not/AZone"), "09:00"));
});

describe("parseHM: a typed time, or null", () => {
  it("accepts H:MM and HH:MM", () => {
    assert.deepStrictEqual(parseHM("9:30"), { hh: 9, mm: 30 });
    assert.deepStrictEqual(parseHM("23:59"), { hh: 23, mm: 59 });
    assert.deepStrictEqual(parseHM(" 07:00 "), { hh: 7, mm: 0 });
  });
  it("24:00 is not a time, and neither is 9:60", () => {
    assert.strictEqual(parseHM("24:00"), null);
    assert.strictEqual(parseHM("9:60"), null);
  });
  it("junk is null, not NaN o'clock", () => {
    assert.strictEqual(parseHM("nine"), null);
    assert.strictEqual(parseHM(""), null);
    assert.strictEqual(parseHM(null), null);
    // Anchored on purpose: a trailing am/pm means the coach typed a different
    // format, not a 24-hour time that happens to be embedded in it.
    assert.strictEqual(parseHM("9:30pm"), null);
  });
});

describe("setmoreWall: the wall shape a standing appointment is made of", () => {
  it("day-of-week, hour and minute as read in the zone", () => {
    // 2026-03-09 is a Monday; 9am EDT.
    const ms = zonedTimeToUtc(2026, 3, 9, 9, 0, NY);
    assert.deepStrictEqual(setmoreWall(ms, NY), { dow: 1, hh: 9, mm: 0 });
  });
  it("the same slot keeps its wall shape across the DST change", () => {
    const est = zonedTimeToUtc(2026, 3, 2, 9, 0, NY);
    const edt = zonedTimeToUtc(2026, 3, 9, 9, 0, NY);
    assert.deepStrictEqual(setmoreWall(est, NY), setmoreWall(edt, NY),
      "Mondays at 9 read as two different patterns across the change");
  });
});

describe("localTz", () => {
  it("names a zone, never empty", () => {
    const tz = localTz();
    assert.strictEqual(typeof tz, "string");
    assert.notStrictEqual(tz, "");
  });
});
