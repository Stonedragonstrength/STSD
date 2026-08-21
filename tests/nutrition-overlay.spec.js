// The Fuel chart's two rules, both of which lie convincingly if they are wrong.
//
//   * A day with no food entries is a HOLE, not a zero. Drawing it as zero
//     calories says the athlete starved; drawing a straight line across it says
//     they ate exactly halfway between Monday and Wednesday. Both are made up.
//   * A metric with no target has no denominator, and a percentage of nothing
//     is not a number. Those series are dropped rather than plotted at
//     Infinity, which renders as a line that leaves the card.
import { describe, it, expect } from "vitest";
import { loadFns } from "./helpers/load-fn.js";

const { nutritionDays, nutritionSeries } = loadFns(
  ["function nutritionDays(", "function nutritionSeries("],
  {
    // The real ones, so the shapes under test are the shipped shapes.
    foodDayTotals: (entries) => (entries || []).reduce((t, e) => ({
      kcal: t.kcal + (Number(e.kcal) || 0), protein: t.protein + (Number(e.p) || 0),
      carbs: t.carbs + (Number(e.c) || 0), fat: t.fat + (Number(e.f) || 0),
      fiber: t.fiber + (Number(e.fib) || 0),
    }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }),
    effectiveTargets: (c, p) => ({ plan: p.__plan || null }),
    todayISO: () => "2026-08-05",
    addDaysISO: (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); },
    waterGoalCups: (c, p) => p.__water || 0,
  },
);

const meal = (kcal, p, c, f) => ({ kcal, p, c, f });

describe("nutritionDays", () => {
  const progress = {
    foodLog: {
      "2026-08-01": [meal(800, 60, 70, 25), meal(700, 50, 60, 20)],
      "2026-08-02": [],                       // opened the logger, logged nothing
      "2026-08-03": [meal(2400, 180, 250, 75)],
      "2026-07-01": [meal(2000, 150, 200, 60)],   // outside the window
    },
    waterLog: { "2026-08-01": 10, "2026-08-02": 8, "2026-08-04": 6 },
  };

  it("adds a day's entries up", () => {
    const d = nutritionDays(progress, "2026-08-01", "2026-08-04").find((x) => x.date === "2026-08-01");
    expect(d.kcal).toBe(1500);
    expect(d.protein).toBe(110);
    expect(d.carbs).toBe(130);
    expect(d.fat).toBe(45);
  });

  it("marks a day with no entries as not logged, and does NOT call it zero", () => {
    const d = nutritionDays(progress, "2026-08-01", "2026-08-04").find((x) => x.date === "2026-08-02");
    expect(d.logged).toBe(false);
    expect(d.kcal).toBe(0);   // the number is zero, but `logged` is what the chart reads
  });

  it("keeps a water-only day, because water has its own goal", () => {
    const d = nutritionDays(progress, "2026-08-01", "2026-08-04").find((x) => x.date === "2026-08-04");
    expect(d).toBeTruthy();
    expect(d.water).toBe(6);
    expect(d.logged).toBe(false);
  });

  it("drops days before the window and sorts what is left", () => {
    const dates = nutritionDays(progress, "2026-08-01", "2026-08-04").map((d) => d.date);
    expect(dates).toEqual(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]);
  });

  it("ignores keys that are not dates", () => {
    const junk = { foodLog: { notADate: [meal(100, 1, 1, 1)], "2026-08-05": [meal(100, 1, 1, 1)] }, waterLog: {} };
    expect(nutritionDays(junk, "2026-08-05", "2026-08-05").map((d) => d.date)).toEqual(["2026-08-05"]);
  });

  it("survives an empty progress blob", () => {
    expect(nutritionDays({}, "2026-08-05", "2026-08-05").every((d) => !d.logged)).toBe(true);
    expect(nutritionDays(null, "2026-08-05", "2026-08-05").every((d) => !d.logged)).toBe(true);
  });
});

describe("nutritionSeries", () => {
  it("offers only what has a target to be measured against", () => {
    const progress = { __plan: { calories: 2400, protein: 185 }, __water: 0 };
    expect(nutritionSeries({}, progress).map((s) => s.key)).toEqual(["kcal", "protein"]);
  });

  it("offers nothing at all when no targets are set", () => {
    expect(nutritionSeries({}, { __plan: null, __water: 0 })).toEqual([]);
  });

  it("treats a zero or junk target as no target", () => {
    const progress = { __plan: { calories: 2400, protein: 0, carbs: "", fat: "abc" }, __water: 0 };
    expect(nutritionSeries({}, progress).map((s) => s.key)).toEqual(["kcal"]);
  });

  it("includes water on its own goal, which lives apart from the food plan", () => {
    const progress = { __plan: { calories: 2400 }, __water: 12 };
    const keys = nutritionSeries({}, progress).map((s) => s.key);
    expect(keys).toContain("water");
    expect(nutritionSeries({}, progress).find((s) => s.key === "water").target).toBe(12);
  });

  it("each series can pull its own number off a day", () => {
    const progress = { __plan: { calories: 2400, protein: 185, carbs: 250, fat: 75 }, __water: 12 };
    const day = { kcal: 2400, protein: 185, carbs: 250, fat: 75, water: 12 };
    nutritionSeries({}, progress).forEach((s) => {
      expect(s.pick(day) / s.target).toBe(1);
    });
  });
});
