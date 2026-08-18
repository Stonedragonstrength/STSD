// The progress shape, tested from both ends — written new when the pair
// moved out of the IIFE (tier 1: a real import of the shipped file; no
// tier-2 tests existed for these before the move).
//
// Why the paranoia level is what it is: every pull, import and boot path
// runs progress through ensureProgressShape before anything reads a field,
// so a guard that overwrites when it should preserve silently deletes an
// athlete's logs, and a guard that never fires leaves an old shape to crash
// a render mid-boot. Both failures are the house kind — quiet. So every
// guard is asserted in BOTH directions: missing/wrong-type gets the default,
// and a realistic seeded value survives BY REFERENCE (reference equality is
// what catches a guard mutated into an unconditional reassignment, even one
// that copies the data).
import { describe, it, expect } from "vitest";
import "./progress-shape.js";

const { emptyProgress, ensureProgressShape } = globalThis.STSD.sync;

// The canonical empty shape, spelled out. This IS the mutation check for
// emptyProgress: toEqual is exact in both directions, so any field added,
// dropped or re-typed in the literal fails here by name.
const EMPTY = {
  exerciseLogs: {}, bodyweightLog: [], feedback: "", dayCompletions: {},
  personalRecords: [], packageRequests: [], dayNotes: {},
  dismissedBulletins: {}, seenMessages: {}, totalWorkoutMs: 0,
  workoutMoods: {}, addedExercises: {}, athleteDays: [], formChecks: {},
  swaps: {}, nutritionTargets: {}, foodLog: {}, customFoods: [],
  savedMeals: [], waterLog: {}, nutritionGame: {}, statField: {},
  avatarId: "",
};

// A lived-in progress object — realistic values, not minimal ones, because a
// derived-value bug fails by being plausible. Every field ensureProgressShape
// guards is present with real data; the preservation test walks this.
const seeded = () => ({
  avatarId: "dragon-3",
  exerciseLogs: { exbench: [{ date: "2026-08-10", sets: [{ w: 225, r: 5, locked: true }] }] },
  bodyweightLog: [{ date: "2026-08-01", weight: 208 }],
  feedback: "Felt strong, hips tight on pulls",
  dayCompletions: { d1: ["2026-08-04", "2026-08-11"] },
  personalRecords: [{ lift: "Deadlift", weight: 405, date: "2026-07-30" }],
  packageRequests: [{ id: "pk1", sessions: 10 }],
  dayNotes: { d1: "left hip felt tight on warmup" },
  cardioLogs: [{ date: "2026-08-10", type: "Run", minutes: 30, miles: 3.1, intensity: "Moderate" }],
  dismissedBulletins: { b1: true },
  seenMessages: { m1: 1723500000000 },
  totalWorkoutMs: 3600000,
  workoutMoods: { "2026-08-10": 4 },
  pendingDeloads: { exsquat: true },
  statField: { "2026-08-10": { STR: 2, END: 1 } },
  readiness: { "2026-08-10": { v: 2, sleep: 3, soreness: 2 } },
  athleteDays: [{ id: "ad1", name: "Extra push day", exercises: [] }],
  formChecks: { fc1: { url: "squat-clip.mp4", note: "depth check" } },
  swaps: { exrow: "exlatpull" },
  nutritionTargets: { calories: 3200, protein: 180 },
  foodLog: { "2026-08-10": [{ name: "Oats", grams: 100 }] },
  customFoods: [{ name: "Mass shake", kcal: 900 }],
  savedMeals: [{ name: "Breakfast", items: ["Oats", "Eggs"] }],
  waterLog: { "2026-08-10": 96 },
  nutritionGame: { xp: 420, streak: 6 },
});

describe("emptyProgress", () => {
  it("starts every collection empty and every scalar at its zero — exactly these fields, no others", () => {
    expect(emptyProgress()).toEqual(EMPTY);
  });

  it("returns a fresh object each call, so one athlete's copy cannot bleed into the next", () => {
    const a = emptyProgress(), b = emptyProgress();
    expect(a).not.toBe(b);
    a.exerciseLogs.exbench = [{ date: "2026-08-10" }];
    a.customFoods.push({ name: "Mass shake" });
    expect(b.exerciseLogs).toEqual({});
    expect(b.customFoods).toEqual([]);
  });
});

describe("ensureProgressShape", () => {
  it("returns the very object it was given — callers repair in place and keep their reference", () => {
    const p = {};
    expect(ensureProgressShape(p)).toBe(p);
    const s = seeded();
    expect(ensureProgressShape(s)).toBe(s);
  });

  it("backfills every guarded field on a bare object", () => {
    const p = ensureProgressShape({});
    expect(p).toEqual({
      avatarId: "", exerciseLogs: {}, bodyweightLog: [], feedback: "",
      dayCompletions: {}, personalRecords: [], packageRequests: [],
      dayNotes: {}, cardioLogs: [], dismissedBulletins: {}, seenMessages: {},
      totalWorkoutMs: 0, workoutMoods: {}, pendingDeloads: {}, statField: {},
      readiness: {}, athleteDays: [], formChecks: {}, swaps: {},
      nutritionTargets: {}, foodLog: {}, customFoods: [], savedMeals: [],
      waterLog: {}, nutritionGame: {},
    });
  });

  it("leaves a lived-in progress alone — every collection survives by reference, every scalar by value", () => {
    const s = seeded();
    const refs = { ...s };
    ensureProgressShape(s);
    for (const key of Object.keys(refs)) {
      expect(s[key], key).toBe(refs[key]);
    }
  });

  it("repairs a wrong-typed field to its default instead of letting it reach a render", () => {
    const repairs = [
      ["avatarId", 7, ""],
      ["avatarId", null, ""],
      ["cardioLogs", {}, []],
      ["totalWorkoutMs", "5000", 0],
      ["totalWorkoutMs", NaN, 0],
      ["totalWorkoutMs", Infinity, 0],
      ["workoutMoods", "tired", {}],
      ["pendingDeloads", "soon", {}],
      ["statField", 3, {}],
      ["readiness", "good", {}],
      ["athleteDays", {}, []],
      ["formChecks", "squat-clip.mp4", {}],
      ["swaps", 4, {}],
      ["nutritionTargets", 3200, {}],
      ["foodLog", "oats", {}],
      ["customFoods", {}, []],
      ["savedMeals", "breakfast", []],
      ["waterLog", 96, {}],
      ["nutritionGame", true, {}],
    ];
    for (const [key, bad, def] of repairs) {
      const p = ensureProgressShape({ [key]: bad });
      expect(p[key], `${key} given ${String(bad)}`).toEqual(def);
    }
  });

  it("treats a null field like a missing one for every falsy-guarded collection", () => {
    const nulled = {
      exerciseLogs: null, bodyweightLog: null, dayCompletions: null,
      personalRecords: null, packageRequests: null, dayNotes: null,
      dismissedBulletins: null, seenMessages: null,
    };
    const p = ensureProgressShape(nulled);
    expect(p.exerciseLogs).toEqual({});
    expect(p.bodyweightLog).toEqual([]);
    expect(p.dayCompletions).toEqual({});
    expect(p.personalRecords).toEqual([]);
    expect(p.packageRequests).toEqual([]);
    expect(p.dayNotes).toEqual({});
    expect(p.dismissedBulletins).toEqual({});
    expect(p.seenMessages).toEqual({});
  });

  it("turns null-ish feedback into the empty string and keeps real words", () => {
    expect(ensureProgressShape({ feedback: null }).feedback).toBe("");
    expect(ensureProgressShape({}).feedback).toBe("");
    expect(ensureProgressShape({ feedback: "" }).feedback).toBe("");
    expect(ensureProgressShape({ feedback: "Felt strong" }).feedback).toBe("Felt strong");
  });

  // The two halves deliberately disagree, and this pins the disagreement so a
  // "cleanup" cannot slip in silently. cardioLogs, pendingDeloads and
  // readiness are repair-only (fresh progress always flows through ensure, so
  // late-added fields only need the repair half); addedExercises is
  // seed-only (every reader is defensive and its one writer self-heals).
  it("appends exactly the three repair-only fields to the empty shape, and never backfills addedExercises", () => {
    const p = emptyProgress();
    ensureProgressShape(p);
    expect(p).toEqual({ ...EMPTY, cardioLogs: [], pendingDeloads: {}, readiness: {} });
    expect("addedExercises" in ensureProgressShape({})).toBe(false);
  });
});
