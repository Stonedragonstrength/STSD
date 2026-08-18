// The exercise factory and the 🎲 day generator — tier 1: a real import of
// the shipped file, with the real tables. Written new at the move (nothing
// executed these before). makeExercise is where an exercise gets its KIND,
// and a wrong kind renders a wrong card with no error anywhere; the
// generator is the thing the seam incident broke, so its roll is pinned
// end to end.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import "./tags.js";
import "./library.js";
import "./anatomy.js";
import "./levels.js";
import "./builder.js";
import "./generator.js";

beforeAll(async () => {
  globalThis.window = globalThis;
  await import("../../exercise-demos.js");
  await import("../../exercise-muscles.js");
  await import("../../exercise-roles.js");
});

const {
  makeExercise, makeWorkoutTemplate, generateWorkoutDay,
  GEN_ARCHETYPES, FINISHER_PCTS, isHoldName,
} = globalThis.STSD.training;

let _uidN = 0;
beforeEach(() => {
  _uidN = 0;
  globalThis.STSD.app = { customExerciseList: () => [], uid: () => `id${++_uidN}` };
});
afterEach(() => { delete globalThis.STSD.app; });

function seeded(seed, fn) {
  const real = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  try { return fn(); } finally { Math.random = real; }
}

describe("makeExercise: where an exercise gets its kind", () => {
  it("a library stretch becomes a rounds × seconds card", () => {
    const ex = makeExercise({ name: "Couch Stretch" });
    expect(ex.kind).toBe("mobility");
    expect(ex.sets).toBe("1");
    expect(ex.currentReps).toBe("30");
    expect(ex.timed).toBe(false);
  });

  it("a speed drill rides the same mobility card machinery", () => {
    expect(makeExercise({ name: "A-Skip" }).kind).toBe("mobility");
  });

  it("a carry stays strength but goes weight × time", () => {
    const ex = makeExercise({ name: "Farmer's Carry" });
    expect(ex.kind).toBe("strength");
    expect(ex.timed).toBe(true);
    expect(ex.currentReps).toBe("30");
  });

  it("a barbell lift gets the plain strength defaults", () => {
    const ex = makeExercise({ name: "Bench Press" });
    expect(ex.kind).toBe("strength");
    expect(ex.timed).toBe(false);
    expect(ex.sets).toBe("3");
    expect(ex.currentReps).toBe("");
    expect(ex.modifiers).toEqual([]);
    expect(ex.id).toMatch(/^id\d+$/); // ids come through the STSD.app seam
  });

  it("an explicit seed kind or timed flag outranks the name", () => {
    expect(makeExercise({ name: "Couch Stretch", kind: "strength" }).kind).toBe("strength");
    expect(makeExercise({ name: "Bench Press", timed: true }).timed).toBe(true);
  });
});

describe("makeWorkoutTemplate", () => {
  it("wraps exercises in fresh copies with re-minted ids", () => {
    const t = makeWorkoutTemplate("Push A", [{ name: "Bench Press", sets: "4" }]);
    expect(t.name).toBe("Push A");
    expect(t.exercises.length).toBe(1);
    expect(t.exercises[0].sets).toBe("4");
    expect(t.exercises[0].kind).toBe("strength");
    expect(t.exercises[0].id).not.toBe(t.id);
    expect(makeWorkoutTemplate(null, null).exercises).toEqual([]);
  });
});

describe("generateWorkoutDay: the 🎲 roll", () => {
  it("rolls a complete day: name, focus, 4+ exercises with sets, reps and tag arrays", () => {
    const day = seeded(7, () => generateWorkoutDay());
    expect(day.name.length).toBeGreaterThan(0);
    expect(day.focus).toContain("·");
    expect(day.exercises.length).toBeGreaterThanOrEqual(4);
    for (const ex of day.exercises) {
      expect(ex.name.length, JSON.stringify(ex)).toBeGreaterThan(0);
      expect(String(ex.sets).length).toBeGreaterThan(0);
      expect(String(ex.reps).length).toBeGreaterThan(0);
      expect(Array.isArray(ex.modifiers)).toBe(true);
      // The generator programs resistance days; a hold here means the
      // archetype pool leaked a stretch.
      expect(isHoldName(ex.name), ex.name).toBe(false);
    }
  });

  it("is deterministic under a seed, and seeds vary the roll", () => {
    const roll = (seed) => seeded(seed, () => generateWorkoutDay()).exercises.map((e) => e.name);
    expect(roll(42)).toEqual(roll(42));
    expect(roll(42)).not.toEqual(roll(43));
  });

  it("a graduating bodyweight pick starts at BW with the rep ladder attached", () => {
    // Sweep seeds until a roll includes one — deterministic, no live dice.
    for (let seed = 1; seed < 60; seed++) {
      const day = seeded(seed, () => generateWorkoutDay());
      const bw = day.exercises.find((e) => e.currentWeight === "BW");
      if (!bw) continue;
      expect(bw.progression).toBeTruthy();
      expect(bw.progression.ceil).toBeGreaterThan(Number(bw.reps));
      expect(bw.modifiers).toEqual([]);
      return;
    }
    throw new Error("no seed under 60 rolled a graduating bodyweight lift");
  });

  it("supersets always pair two adjacent accessories", () => {
    for (let seed = 1; seed < 80; seed++) {
      const day = seeded(seed, () => generateWorkoutDay());
      const marked = day.exercises
        .map((e, i) => ({ e, i }))
        .filter((x) => x.e.supersetId);
      if (!marked.length) continue;
      expect(marked.length).toBe(2);
      expect(marked[1].i - marked[0].i).toBe(1);
      expect(marked[0].i).toBeGreaterThan(0); // never the primary
      expect(marked[0].e.supersetId).toBe(marked[1].e.supersetId);
      return;
    }
    throw new Error("no seed under 80 rolled a superset");
  });

  it("the archetype table is sound: every category is a real library shelf", () => {
    const { EXERCISE_LIBRARY } = globalThis.STSD.training;
    const shelves = new Set(EXERCISE_LIBRARY.map((c) => c.cat));
    for (const a of GEN_ARCHETYPES) {
      for (const cat of a.cats) expect(shelves.has(cat), `${a.name}: ${cat}`).toBe(true);
    }
    expect(FINISHER_PCTS).toEqual(["25", "50", "75"]);
  });
});
