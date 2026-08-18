// The ⚡ program builder — tier 1: a real import of the shipped file, run
// against the REAL vendored tables and the REAL muscle map. The deep
// behaviour checks (63 of them) live in tests/program-builder.test.js and
// still run; what this spec owns is the assembled pipeline: that buildWeek
// through the actual module, with its actual dependencies and its two
// seams, produces a coach-ready week.
//
// The builder is stochastic BY DESIGN, and the measured lesson (see the
// builder-measurement notes): a hard bar on one roll flakes. Every check
// here seeds Math.random with a deterministic LCG and restores it, so the
// suite never rolls dice.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import "./tags.js";
import "./library.js";
import "./readiness.js";
import "./anatomy.js";
import "./levels.js";
import "./builder.js";

beforeAll(async () => {
  globalThis.window = globalThis;
  await import("../../exercise-demos.js");
  await import("../../exercise-muscles.js");
  await import("../../exercise-equipment.js");
  await import("../../exercise-roles.js");
});

const {
  buildWeek, builderPool, gearSet, resolveRealization, coverageScore,
  schemeForLevel, isBeginner, DAY_CAP, BUILDER_SKIP_CATS,
  isHoldName, GEAR,
} = globalThis.STSD.training;

// The app-owned seams: ids, the empty-week shape, the day icon.
let _uidN = 0;
beforeEach(() => {
  _uidN = 0;
  globalThis.STSD.app = {
    customExerciseList: () => [],
    uid: () => `id${++_uidN}`,
    makeWeek: (i) => ({ id: `w${i}`, label: `Week ${i + 1}`, focus: "", phaseLabel: "", days: [], diet: {} }),
    workoutIconFor: () => "sd:claw",
  };
});
afterEach(() => { delete globalThis.STSD.app; });

/** Deterministic LCG in place of Math.random for the duration of fn. */
function seeded(seed, fn) {
  const real = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  try { return fn(); } finally { Math.random = real; }
}

describe("buildWeek, through the real pipeline", () => {
  it("produces a coach-ready four-day week: ids, names, sets, reps, icons", () => {
    const { week, report } = seeded(7, () =>
      buildWeek({ trainingLevel: "intermediate" }, { days: 4, styleName: "Powerbuilding" }));
    expect(week.days.length).toBe(4);
    expect(week.id).toBe("w0"); // came through the makeWeek seam
    for (const d of week.days) {
      expect(d.id && d.name, d.name).toBeTruthy();
      expect(d.icon).toBe("sd:claw"); // came through the workoutIconFor seam
      // ≤ DAY_CAP is self-relative (a shrunken cap would still pass it), so
      // the floor is absolute: an intermediate four-day week fills its days —
      // under this seed, to the cap of seven.
      expect(d.exercises.length).toBeGreaterThanOrEqual(5);
      expect(d.exercises.length).toBeLessThanOrEqual(DAY_CAP);
      for (const ex of d.exercises) {
        expect(ex.id, ex.name).toMatch(/^id\d+$/); // came through the uid seam
        expect(Number(ex.sets), ex.name).toBeGreaterThan(0);
        expect(String(ex.reps).length, ex.name).toBeGreaterThan(0);
        expect(Array.isArray(ex.modifiers), ex.name).toBe(true);
      }
    }
    expect(report).toHaveProperty("short");
    expect(report).toHaveProperty("dropped");
  });

  it("is deterministic under a seed, and different seeds vary the exercises", () => {
    const names = (seed) => seeded(seed, () =>
      buildWeek({ trainingLevel: "intermediate" }, { days: 4 })
    ).week.days.flatMap((d) => d.exercises.map((e) => e.name));
    expect(names(42)).toEqual(names(42));
    expect(names(42)).not.toEqual(names(43));
  });

  it("never programs a hold, drill, cardio filler or jump — resistance weeks only", () => {
    const { week } = seeded(11, () => buildWeek({ trainingLevel: "intermediate" }, { days: 4 }));
    for (const d of week.days) {
      for (const ex of d.exercises) {
        expect(isHoldName(ex.name), `${ex.name} is a hold/drill`).toBe(false);
      }
    }
    for (const nm of builderPool()) {
      expect(isHoldName(nm), nm).toBe(false);
    }
  });
});

describe("the levers", () => {
  it("gearSet: empty means everything — an unfilled athlete is unrestricted, not untrainable", () => {
    expect(gearSet({ equipment: [] }).size).toBe(GEAR.length);
    expect(gearSet(null).size).toBe(GEAR.length);
    const home = gearSet({ equipment: ["dumbbell", "bench"] });
    expect(home.size).toBe(2);
  });

  it("resolveRealization honours preference order and gear reach", () => {
    const fullGym = gearSet(null);
    const bb = resolveRealization("Bench Press", fullGym);
    expect(bb?.gear).toContain("barbell");
    const dumbbellsOnly = new Set(["dumbbell", "bench"]);
    const db = resolveRealization("Bench Press", dumbbellsOnly);
    expect(db?.tag).toBe("DBs");
    expect(resolveRealization("Bench Press", new Set())).toBe(null);
  });

  it("coverageScore is the anchor-choice basis: a deadlift outranks a leg extension", () => {
    expect(coverageScore("Deadlift")).toBeGreaterThan(coverageScore("Leg Extension"));
    expect(coverageScore("Quantum Flux Hoist")).toBe(0);
  });

  it("the beginner clamp: sets cap at five, reps floor at five, and only for beginners", () => {
    const scheme = { sets: [5, 6], reps: [3, 4] };
    expect(schemeForLevel(scheme, { trainingLevel: "beginner" })).toEqual({ sets: [5, 5], reps: [5, 5] });
    expect(schemeForLevel(scheme, { trainingLevel: "advanced" })).toBe(scheme);
    expect(isBeginner({ trainingLevel: "beginner" })).toBe(true);
    expect(isBeginner({})).toBe(false);
  });

  it("the skip list still names the four non-resistance categories", () => {
    expect([...BUILDER_SKIP_CATS].sort()).toEqual(
      ["Cardio", "Mobility & Stretching", "Plyometrics", "Speed/Agility"]);
  });
});
