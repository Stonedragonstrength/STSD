// The day card's "moved more" readout: percent change in total weight moved
// against the last time through the same workout, shown on finished day cards
// in the athlete's week picker.
//
// Extracted real from app.js via load-fn — dayLogStats and
// previousDayOccurrence are the shipped functions the day-complete sheet
// already uses, so the picker's number and the finish sheet's number can never
// disagree.
//
// The rules under test:
//   * First time through a day name → null (there is no last time to beat).
//   * No volume this time (bodyweight-only, or nothing logged) → null.
//   * A result that rounds to zero → null. The card says nothing rather than
//     "0%", because a dead tie is not news on a list of five cards.
//   * Otherwise { pct, date }: a signed integer percent plus the ISO date of
//     the occurrence it was measured against, which the card uses for its
//     hover title.
//   * The previous occurrence matches by day NAME, never by id or position,
//     and ignores occurrences with no volume — so a skipped week falls through
//     to the last week that was actually trained.
import { describe, it, expect } from "vitest";
import { loadFns } from "./helpers/load-fn.js";

// One program day with one exercise, plus a locked log for it.
const day = (id, name, exId) => ({ id, name, exercises: [{ id: exId, name: "Bench Press" }] });
const lockedLog = (date, weight, reps) => ({
  locked: true, date, sets: [{ weight: String(weight), reps: String(reps) }],
});

function load(clientWeeks, progress) {
  return loadFns(
    ["function dayLogStats(", "function previousDayOccurrence(", "function dayVolumeDelta("],
    {
      state: { clientData: { program: { client: { weeks: clientWeeks } }, progress } },
      sessionDays: () => [],
    }
  );
}

describe("dayVolumeDelta", () => {
  it("is null the first time through a day name", () => {
    const d1 = day("d1", "Push Day", "e1");
    const progress = { exerciseLogs: { e1: [lockedLog("2026-08-12", 100, 10)] } };
    const { dayVolumeDelta } = load([{ id: "w1", days: [d1] }], progress);
    expect(dayVolumeDelta(d1, progress)).toBe(null);
  });

  it("is null when this time moved no weight", () => {
    const d1 = day("d1", "Push Day", "e1");
    const d2 = day("d2", "Push Day", "e2");
    const progress = {
      exerciseLogs: {
        e1: [lockedLog("2026-08-05", 100, 10)],
        e2: [{ locked: true, date: "2026-08-12", sets: [{ weight: "BW", reps: "12" }] }],
      },
    };
    const weeks = [{ id: "w1", days: [d1] }, { id: "w2", days: [d2] }];
    const { dayVolumeDelta } = load(weeks, progress);
    expect(dayVolumeDelta(d2, progress)).toBe(null);
  });

  it("reports a rounded percent up, with the date it beat", () => {
    const d1 = day("d1", "Push Day", "e1");
    const d2 = day("d2", "Push Day", "e2");
    const progress = {
      exerciseLogs: {
        e1: [lockedLog("2026-08-05", 100, 10)],  // 1000 moved
        e2: [lockedLog("2026-08-12", 104, 10)],  // 1040 moved → +4%
      },
    };
    const weeks = [{ id: "w1", days: [d1] }, { id: "w2", days: [d2] }];
    const { dayVolumeDelta } = load(weeks, progress);
    expect(dayVolumeDelta(d2, progress)).toEqual({ pct: 4, date: "2026-08-05" });
  });

  it("reports a lighter day as a negative percent", () => {
    const d1 = day("d1", "Pull Day", "e1");
    const d2 = day("d2", "Pull Day", "e2");
    const progress = {
      exerciseLogs: {
        e1: [lockedLog("2026-08-06", 100, 10)],  // 1000 moved
        e2: [lockedLog("2026-08-13", 97, 10)],   // 970 moved → -3%
      },
    };
    const weeks = [{ id: "w1", days: [d1] }, { id: "w2", days: [d2] }];
    const { dayVolumeDelta } = load(weeks, progress);
    expect(dayVolumeDelta(d2, progress)).toEqual({ pct: -3, date: "2026-08-06" });
  });

  it("is null on a dead tie", () => {
    const d1 = day("d1", "Push Day", "e1");
    const d2 = day("d2", "Push Day", "e2");
    const progress = {
      exerciseLogs: {
        e1: [lockedLog("2026-08-05", 100, 10)],
        e2: [lockedLog("2026-08-12", 100, 10)],
      },
    };
    const weeks = [{ id: "w1", days: [d1] }, { id: "w2", days: [d2] }];
    const { dayVolumeDelta } = load(weeks, progress);
    expect(dayVolumeDelta(d2, progress)).toBe(null);
  });

  it("matches by day name, ignoring other days logged more recently", () => {
    const push1 = day("d1", "Push Day", "e1");
    const legs = day("d2", "Leg Day", "e2");
    const push2 = day("d3", "Push Day", "e3");
    const progress = {
      exerciseLogs: {
        e1: [lockedLog("2026-08-05", 100, 10)],  // Push, 1000
        e2: [lockedLog("2026-08-07", 300, 10)],  // Legs, 3000 — must be ignored
        e3: [lockedLog("2026-08-12", 110, 10)],  // Push, 1100 → +10% vs e1
      },
    };
    const weeks = [{ id: "w1", days: [push1, legs] }, { id: "w2", days: [push2] }];
    const { dayVolumeDelta } = load(weeks, progress);
    expect(dayVolumeDelta(push2, progress)).toEqual({ pct: 10, date: "2026-08-05" });
  });

  it("falls through a skipped week to the last one actually trained", () => {
    const d1 = day("d1", "Push Day", "e1");
    const d2 = day("d2", "Push Day", "e2");
    const d3 = day("d3", "Push Day", "e3");
    const progress = {
      exerciseLogs: {
        e1: [lockedLog("2026-07-29", 100, 10)],                               // 1000
        e2: [{ locked: true, skipped: true, date: "2026-08-05", sets: [] }],  // skipped
        e3: [lockedLog("2026-08-12", 105, 10)],                               // 1050 → +5%
      },
    };
    const weeks = [{ id: "w1", days: [d1] }, { id: "w2", days: [d2] }, { id: "w3", days: [d3] }];
    const { dayVolumeDelta } = load(weeks, progress);
    expect(dayVolumeDelta(d3, progress)).toEqual({ pct: 5, date: "2026-07-29" });
  });

  // Documented in app.js as a deliberate difference from the finish sheet: the
  // sheet scopes to one date because it reports the session just finished, the
  // card labels the DAY and sums every date logged under it. A workout begun
  // Monday and finished Tuesday is one workout on this card.
  it("sums a day logged across two dates, and dates it from the last one", () => {
    const d1 = { id: "d1", name: "Push Day", exercises: [{ id: "e1", name: "Bench" }, { id: "e2", name: "OHP" }] };
    const d2 = { id: "d2", name: "Push Day", exercises: [{ id: "e3", name: "Bench" }, { id: "e4", name: "OHP" }] };
    const progress = {
      exerciseLogs: {
        e1: [lockedLog("2026-08-05", 100, 10)],   // 1000 \
        e2: [lockedLog("2026-08-05", 50, 10)],    //  500  } week 1 total 1500
        e3: [lockedLog("2026-08-12", 100, 10)],   // 1000 — started Wednesday
        e4: [lockedLog("2026-08-13", 65, 10)],    //  650 — finished Thursday
      },                                          //        week 2 total 1650 → +10%
    };
    const weeks = [{ id: "w1", days: [d1] }, { id: "w2", days: [d2] }];
    const { dayVolumeDelta } = load(weeks, progress);
    expect(dayVolumeDelta(d2, progress)).toEqual({ pct: 10, date: "2026-08-05" });
  });

  it("never measures against a later occurrence of the same day name", () => {
    const d1 = day("d1", "Push Day", "e1");
    const d2 = day("d2", "Push Day", "e2");
    const d3 = day("d3", "Push Day", "e3");
    const progress = {
      exerciseLogs: {
        e1: [lockedLog("2026-08-05", 100, 10)],  // 1000
        e2: [lockedLog("2026-08-12", 110, 10)],  // 1100 — the card being drawn
        e3: [lockedLog("2026-08-19", 400, 10)],  // 4000, later: must not be used
      },
    };
    const weeks = [{ id: "w1", days: [d1] }, { id: "w2", days: [d2] }, { id: "w3", days: [d3] }];
    const { dayVolumeDelta } = load(weeks, progress);
    expect(dayVolumeDelta(d2, progress)).toEqual({ pct: 10, date: "2026-08-05" });
  });
});
