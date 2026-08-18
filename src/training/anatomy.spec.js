// The exercise→muscle map and the demo matcher — tier 1: a real import of
// the shipped file, running against the REAL vendored data files. The deep
// per-exercise data checks stay in tests/muscle-coverage.test.js; what this
// spec owns is the map's MECHANICS and its two state seams, because both
// documented incidents were mechanics: the curated list short-circuiting the
// union reported a week of squats and deadlifts as zero glute work, and the
// demo database's one "shoulders" bucket fanning back across all three delt
// heads erased the only source that knew a lateral raise from a face pull.
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import "./tags.js";
import "./library.js";
import "./anatomy.js";

// The module reads the vendored data through window.* at CALL time; give the
// node environment a window and load the real shipped files. (Dynamic import,
// because static imports hoist above the window assignment.)
beforeAll(async () => {
  globalThis.window = globalThis;
  await import("../../exercise-demos.js");
  await import("../../exercise-muscles.js");
});

const { musclesForExercise, exCreditOverride, curatedExIndex,
  demoTokens, demoEntryForName, demoForExercise, demoSearch } = globalThis.STSD.training;

const ids = (list) => list.map((h) => h.id).sort();
const weightOf = (list, id) => list.find((h) => h.id === id)?.weight;

afterEach(() => { delete globalThis.STSD.app; });

describe("the three sources UNION — the zero-glute-work incident", () => {
  it("a deadlift credits glutes and hamstrings, not just its curated lower-back listing", () => {
    const m = ids(musclesForExercise("Deadlift"));
    expect(m).toContain("lowerback");
    expect(m).toContain("glutes");
    expect(m).toContain("hamstrings");
  });

  it("a lateral raise stays side delts — the coarse shoulders bucket must not fan back out", () => {
    const m = musclesForExercise("Lateral Raise");
    expect(weightOf(m, "delts-side")).toBe(1);
    expect(ids(m)).not.toContain("delts-front");
    expect(ids(m)).not.toContain("delts-rear");
  });

  it("an unrecognised lift maps to nothing — unmapped, never silently credited", () => {
    expect(musclesForExercise("Quantum Flux Hoist")).toEqual([]);
    expect(musclesForExercise("")).toEqual([]);
    expect(musclesForExercise(null)).toEqual([]);
  });
});

describe("the fan arithmetic, pinned on a controlled entry", () => {
  const K = "zzz test movement";
  afterEach(() => { delete window.EXERCISE_MUSCLES[K]; });

  it("primary tags pay whole; a secondary region splits across the muscles it names", () => {
    window.EXERCISE_MUSCLES[K] = { p: ["chest"], s: ["shoulders"] };
    const m = musclesForExercise("Zzz Test Movement");
    expect(weightOf(m, "chest")).toBe(1);
    // "shoulders" as a SECONDARY is 0.5 split across the three delt heads —
    // 1.5 sets of delt credit for a movement that merely involves the
    // shoulders is what froze the builder's isolation tier.
    expect(weightOf(m, "delts-front")).toBeCloseTo(0.5 / 3, 5);
    expect(weightOf(m, "delts-side")).toBeCloseTo(0.5 / 3, 5);
    expect(weightOf(m, "delts-rear")).toBeCloseTo(0.5 / 3, 5);
  });

  it("a primary shoulders region pays all three heads whole — splitting primaries re-baselines every athlete", () => {
    window.EXERCISE_MUSCLES[K] = { p: ["shoulders"], s: [] };
    const m = musclesForExercise("Zzz Test Movement");
    expect(weightOf(m, "delts-front")).toBe(1);
    expect(weightOf(m, "delts-side")).toBe(1);
    expect(weightOf(m, "delts-rear")).toBe(1);
  });
});

describe("the category floor", () => {
  it("a custom exercise nothing else recognises falls back to its category's muscles", () => {
    globalThis.STSD.app = { customExerciseList: () => [{ name: "Mystery Custom Curl Machine Nine", cat: "Biceps" }] };
    expect(musclesForExercise("Mystery Custom Curl Machine Nine")).toEqual([{ id: "biceps", weight: 1 }]);
  });
});

describe("the coach's credit override (the anatomyEdits seam)", () => {
  const publish = (exCredits) => {
    globalThis.STSD.app = { anatomyEdits: () => ({ exCredits }) };
  };

  it("an override replaces the derived answer outright — empty list included", () => {
    publish({ deadlift: [] });
    expect(exCreditOverride("deadlift")).toEqual([]);
    expect(musclesForExercise("Deadlift")).toEqual([]);
  });

  it("an override's entries are filtered to real muscles and snapped to legal weights", () => {
    publish({ deadlift: [
      { id: "glutes", w: 0.5 },
      { id: "hamstrings", w: 7 },
      { id: "not-a-muscle", w: 1 },
    ] });
    expect(exCreditOverride("deadlift")).toEqual([
      { id: "glutes", weight: 0.5 },
      { id: "hamstrings", weight: 1 },
    ]);
  });

  it("reads the seam at call time — nothing published means no overrides", () => {
    expect(exCreditOverride("deadlift")).toBe(null);
  });
});

describe("the demo matcher", () => {
  it("the curated map is authoritative for library lifts, an explicit null meaning NO demo", () => {
    expect(demoEntryForName("Cossack Stretch")).toBe(null);
    const neck = demoEntryForName("Neck Stretch");
    expect(neck?.i).toBe("Side_Neck_Stretch");
    // The reason the map exists: fuzzy matching picks odd variations for the
    // staples (plain "Fly" scores its way to a rear-delt cable fly). The
    // curated answer must win.
    expect(demoEntryForName("Fly")?.i).toBe("Dumbbell_Flyes");
  });

  it("demoForExercise honours the coach's explicit choice, including none", () => {
    expect(demoForExercise({ name: "Neck Stretch", demoId: "none" })).toBe(null);
    const pinned = demoForExercise({ name: "Whatever", demoId: "Side_Neck_Stretch" });
    expect(pinned?.i).toBe("Side_Neck_Stretch");
    expect(demoForExercise(null)).toBe(null);
  });

  it("demoTokens expands coach shorthand and drops filler words", () => {
    expect(demoTokens("BB Bench Press")).toContain("barbell");
    expect(demoTokens("Curl with the Bar")).not.toContain("the");
    expect(demoTokens("Curl with the Bar")).not.toContain("with");
  });

  it("demoSearch finds the staples", () => {
    const hits = demoSearch("squat", 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((e) => /squat/i.test(e.n))).toBe(true);
  });
});

describe("the indexes", () => {
  it("the curated index is built once and cached", () => {
    expect(curatedExIndex()).toBe(curatedExIndex());
    expect(curatedExIndex().get("deadlift")).toContain("lowerback");
  });
});
