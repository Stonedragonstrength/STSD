// Coverage over time: what the training actually hit, week by week.
//
// The Anatomy page grades the week you WROTE. This reads the week you DID, off
// the logs, which is a different question and a different set of ways to be
// wrong:
//
//   * a set counts where the exercise credits it, at the weight the muscle map
//     gives — half credit stays half, or every accessory reads like a main lift
//   * a set logged against an exercise that no longer exists counts nowhere,
//     because there is no way to know what it was
//   * an empty row is a FINDING, not a gap in the data. Every anatomy group
//     comes back whether or not it was trained.
import { describe, it, expect } from "vitest";
import { loadFns } from "./helpers/load-fn.js";

// The muscle map, the anatomy list and the clock are all injected, so this
// tests the bucketing rather than the library.
const GROUPS = [{ id: "chest", name: "Chest" }, { id: "lats", name: "Lats" }, { id: "biceps", name: "Biceps" }];
const MAP = {
  "Bench Press": [{ id: "chest", weight: 1 }],
  "Row": [{ id: "lats", weight: 1 }, { id: "biceps", weight: 0.5 }],
  "Mystery Move": [],
};
const deps = () => ({
  ANATOMY_GROUPS: GROUPS,
  COV_WEEKS: 8,   // app.js's own window; the matrix is eight columns wide
  musclesForExercise: (ex) => MAP[ex.name] || [],
  effortRank: (ex) => Number(ex.effortRank) || 0,
  sessionDays: () => [],
  todayISO: () => "2026-08-20",
  weekStartISO: (iso) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); },
  addDaysISO: (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); },
  dateISO: (d) => d.toISOString().slice(0, 10),
});
const load = () => loadFns(["function coverageHistory("], deps());

const client = (exercises) => ({ weeks: [{ days: [{ exercises }] }] });
const set = (w, r) => ({ weight: String(w), reps: String(r) });

describe("coverageHistory", () => {
  it("counts a logged set on every muscle the exercise credits, at its weight", () => {
    const { coverageHistory } = load();
    const h = coverageHistory(
      client([{ id: "e1", name: "Row" }]),
      { exerciseLogs: { e1: [{ date: "2026-08-18", sets: [set(135, 8), set(135, 8)] }] } },
    );
    const row = (id) => h.rows.find((r) => r.id === id);
    const last = h.weeks.length - 1;
    expect(row("lats").sets[last]).toBe(2);      // full credit
    expect(row("biceps").sets[last]).toBe(1);    // half credit, two sets
    expect(row("chest").sets[last]).toBe(0);
  });

  it("returns every anatomy group, trained or not, so an empty row can be seen", () => {
    const { coverageHistory } = load();
    const h = coverageHistory(client([{ id: "e1", name: "Bench Press" }]),
      { exerciseLogs: { e1: [{ date: "2026-08-18", sets: [set(185, 5)] }] } });
    expect(h.rows.map((r) => r.id)).toEqual(["chest", "lats", "biceps"]);
    expect(h.rows.find((r) => r.id === "lats").sets.every((v) => v === 0)).toBe(true);
  });

  it("buckets by the week a set was logged in", () => {
    const { coverageHistory } = load();
    const h = coverageHistory(client([{ id: "e1", name: "Bench Press" }]), {
      exerciseLogs: { e1: [
        { date: "2026-08-18", sets: [set(185, 5)] },      // this week
        { date: "2026-08-11", sets: [set(180, 5), set(180, 5)] },  // last week
      ] },
    });
    const chest = h.rows.find((r) => r.id === "chest").sets;
    expect(chest[chest.length - 1]).toBe(1);
    expect(chest[chest.length - 2]).toBe(2);
  });

  it("drops anything older than the window", () => {
    const { coverageHistory } = load();
    const h = coverageHistory(client([{ id: "e1", name: "Bench Press" }]),
      { exerciseLogs: { e1: [{ date: "2026-01-05", sets: [set(185, 5)] }] } });
    expect(h.counted).toBe(0);
    expect(h.rows.every((r) => r.sets.every((v) => v === 0))).toBe(true);
  });

  it("ignores a set row that was opened and never filled in", () => {
    const { coverageHistory } = load();
    const h = coverageHistory(client([{ id: "e1", name: "Bench Press" }]),
      { exerciseLogs: { e1: [{ date: "2026-08-18", sets: [{ weight: "", reps: "" }, set(185, 5)] }] } });
    expect(h.rows.find((r) => r.id === "chest").sets.at(-1)).toBe(1);
  });

  it("counts an unmapped exercise as unmapped rather than putting it somewhere", () => {
    const { coverageHistory } = load();
    const h = coverageHistory(client([{ id: "e1", name: "Mystery Move" }]),
      { exerciseLogs: { e1: [{ date: "2026-08-18", sets: [set(50, 10), set(50, 10)] }] } });
    expect(h.unmapped).toBe(2);
    expect(h.counted).toBe(0);
  });

  it("skips a log whose exercise no longer exists", () => {
    const { coverageHistory } = load();
    const h = coverageHistory(client([]),
      { exerciseLogs: { gone: [{ date: "2026-08-18", sets: [set(100, 5)] }] } });
    expect(h.counted).toBe(0);
    expect(h.unmapped).toBe(0);
  });

  it("never credits mobility, which has no burn picker and no weights", () => {
    const { coverageHistory } = load();
    const h = coverageHistory(client([{ id: "e1", name: "Row", kind: "mobility" }]),
      { exerciseLogs: { e1: [{ date: "2026-08-18", sets: [set(0, 30)] }] } });
    expect(h.counted).toBe(0);
  });

  it("averages effort over the sets that carried it, not over the weeks", () => {
    const { coverageHistory } = load();
    const h = coverageHistory(
      client([{ id: "e1", name: "Bench Press", effortRank: 3 }, { id: "e2", name: "Bench Press", effortRank: 1 }]),
      { exerciseLogs: {
        e1: [{ date: "2026-08-18", sets: [set(185, 5), set(185, 5), set(185, 5)] }],   // 3 sets at 3
        e2: [{ date: "2026-08-18", sets: [set(95, 12)] }],                             // 1 set at 1
      } },
    );
    // (3×3 + 1×1) / 4 = 2.5
    expect(h.rows.find((r) => r.id === "chest").hard.at(-1)).toBeCloseTo(2.5, 5);
  });

  it("leaves effort at zero when nothing carried a burn level", () => {
    const { coverageHistory } = load();
    const h = coverageHistory(client([{ id: "e1", name: "Bench Press" }]),
      { exerciseLogs: { e1: [{ date: "2026-08-18", sets: [set(185, 5)] }] } });
    expect(h.rows.find((r) => r.id === "chest").hard.at(-1)).toBe(0);
  });

  it("survives an athlete with no program and no logs", () => {
    const { coverageHistory } = load();
    const h = coverageHistory(null, null);
    expect(h.counted).toBe(0);
    expect(h.weeks.length).toBe(8);
    expect(h.max).toBe(1);   // never divides by zero when shading
  });
});
