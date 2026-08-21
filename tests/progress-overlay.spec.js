// The one chart at the top of the athlete's PR screen.
//
// Everything on it is a percentage moved from where the range starts, which is
// the only way a 12 lb bodyweight drop and a 30 lb bench gain can share an
// axis. Two things make that arithmetic worth pinning:
//
//   * the baseline FOLLOWS the range buttons. On 30d, "since the start" means
//     since the first reading still in view, the same as the delta on every
//     other card here. Baselining against the whole history instead would draw
//     a 30d window that does not start at zero, which reads as a bug.
//   * a series with one reading in the window cannot be normalised at all, and
//     drawing it as a flat line at 0% would claim a month of no change from a
//     single weigh-in.
import { describe, it, expect } from "vitest";
import { loadFns } from "./helpers/load-fn.js";

const { overlayNorm, overlaySessionDates } = loadFns(
  ["function overlayNorm(", "function overlaySessionDates("], {});

const t = (d) => Date.UTC(2026, 5, d);
const pts = [
  { t: t(1), v: 200 }, { t: t(8), v: 196 }, { t: t(15), v: 194 },
  { t: t(22), v: 190 }, { t: t(29), v: 186 },
];

describe("overlayNorm", () => {
  it("starts at zero and reads percent from there", () => {
    const r = overlayNorm(pts, -Infinity);
    expect(r.base).toBe(200);
    expect(r.pts[0].pct).toBe(0);
    expect(r.pts[4].pct).toBeCloseTo(-7, 5);
  });

  it("keeps the real value beside the percentage, for the tooltip", () => {
    // Not toEqual on pct: -14/200*100 is -7.000000000000001 in binary, and a
    // chart does not care. The point of this one is that v survives at all.
    const p = overlayNorm(pts, -Infinity).pts[4];
    expect(p.t).toBe(t(29));
    expect(p.v).toBe(186);
    expect(p.pct).toBeCloseTo(-7, 6);
  });

  it("rebaselines to the first reading still in the window", () => {
    // From 15 June the athlete was 194, so the window opens at 0% there and
    // ends at -4.1%, not at the -7% they are down overall.
    const r = overlayNorm(pts, t(15));
    expect(r.base).toBe(194);
    expect(r.pts[0].pct).toBe(0);
    expect(r.pts.length).toBe(3);
    expect(r.pts[2].pct).toBeCloseTo(-4.124, 3);
  });

  it("refuses a window with only one reading in it", () => {
    expect(overlayNorm(pts, t(29))).toBe(null);
  });

  it("refuses an empty or missing series", () => {
    expect(overlayNorm([], -Infinity)).toBe(null);
    expect(overlayNorm(undefined, -Infinity)).toBe(null);
  });

  it("refuses a zero baseline instead of dividing by it", () => {
    expect(overlayNorm([{ t: t(1), v: 0 }, { t: t(8), v: 5 }], -Infinity)).toBe(null);
  });

  it("goes up as happily as down", () => {
    const r = overlayNorm([{ t: t(1), v: 165 }, { t: t(29), v: 195 }], -Infinity);
    expect(r.pts[1].pct).toBeCloseTo(18.18, 2);
  });
});

describe("overlaySessionDates", () => {
  const progress = {
    exerciseLogs: {
      e1: [{ date: "2026-06-01" }, { date: "2026-06-03" }],
      e2: [{ date: "2026-06-01" }, { date: "2026-06-05" }],   // same day as e1
      e3: [{ date: "" }, {}, null],
    },
  };

  it("is one tick per DAY, not per exercise", () => {
    expect(overlaySessionDates(progress)).toEqual(["2026-06-01", "2026-06-03", "2026-06-05"]);
  });

  it("sorts them, because the rug is drawn along a timeline", () => {
    const jumbled = { exerciseLogs: { a: [{ date: "2026-07-09" }, { date: "2026-06-02" }] } };
    expect(overlaySessionDates(jumbled)).toEqual(["2026-06-02", "2026-07-09"]);
  });

  it("survives a progress blob with nothing in it", () => {
    expect(overlaySessionDates(null)).toEqual([]);
    expect(overlaySessionDates({})).toEqual([]);
    expect(overlaySessionDates({ exerciseLogs: { a: null } })).toEqual([]);
  });
});
