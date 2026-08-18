// The exercise library and its name classifiers — written new when they
// moved out of the IIFE (tier 1: a real import of the shipped file; nothing
// executed these before, the legacy tests only parsed the tables).
//
// The classifiers decide how an exercise is PRESCRIBED (reps vs seconds,
// weight vs none), so a misclassification renders a wrong card with no
// error anywhere. The other thing pinned here is the custom-exercise seam:
// the module reads the coach's custom list through
// globalThis.STSD.app.customExerciseList at CALL time — never captured at
// load — so a spec (or the athlete side) with nothing published reads as
// "no custom exercises" instead of crashing.
import { describe, it, expect, afterEach } from "vitest";
import "./library.js";

const {
  EXERCISE_LIBRARY,
  MOBILITY_NAMES, isMobilityName,
  SPEED_NAMES, isSpeedName,
  isHoldName, HOLD_CATS, HOLD_NAMES, HOLD_SEC_VALUES,
  CARRY_NAMES, isCarryName, CARRY_SEC_VALUES,
  exIsTimed,
  ALL_EXERCISE_NAMES,
} = globalThis.STSD.training;

afterEach(() => { delete globalThis.STSD.app; });

describe("the library's shape", () => {
  it("every category has a name and at least one exercise", () => {
    expect(EXERCISE_LIBRARY.length).toBeGreaterThan(10);
    for (const c of EXERCISE_LIBRARY) {
      expect(typeof c.cat, JSON.stringify(c)).toBe("string");
      expect(c.ex.length, c.cat).toBeGreaterThan(0);
    }
  });

  it("ALL_EXERCISE_NAMES is the whole library, deduplicated and alphabetised", () => {
    expect(ALL_EXERCISE_NAMES).toContain("Bench Press");
    expect(new Set(ALL_EXERCISE_NAMES).size).toBe(ALL_EXERCISE_NAMES.length);
    const sorted = [...ALL_EXERCISE_NAMES].sort((a, b) => a.localeCompare(b));
    expect(ALL_EXERCISE_NAMES).toEqual(sorted);
  });

  it("the picker second-values are pinned — they are prescriptions, not decoration", () => {
    expect(HOLD_SEC_VALUES).toEqual(["10", "15", "20", "30", "45", "60", "90", "120"]);
    expect(CARRY_SEC_VALUES).toEqual(["10", "15", "20", "30", "40", "45", "60", "90", "120"]);
  });
});

describe("the name sets derive from their categories", () => {
  it("a mobility stretch, a speed drill and a carry each land in their own set", () => {
    expect(MOBILITY_NAMES.has("Couch Stretch")).toBe(true);
    expect(SPEED_NAMES.has("A-Skip")).toBe(true);
    expect(CARRY_NAMES.has("Farmer's Carry")).toBe(true);
    expect(MOBILITY_NAMES.has("Bench Press")).toBe(false);
  });

  it("HOLD_NAMES is the union of stretches and drills, HOLD_CATS the union of their categories", () => {
    expect(HOLD_NAMES.has("Couch Stretch")).toBe(true);
    expect(HOLD_NAMES.has("A-Skip")).toBe(true);
    expect(HOLD_NAMES.has("Farmer's Carry")).toBe(false);
    expect(HOLD_CATS).toEqual(["Mobility & Stretching", "Speed/Agility"]);
  });

  it("plyometrics are NOT holds — they are prescribed in reps and sometimes loaded", () => {
    // The library comment records why Plyometrics is its own category; if a
    // jump ever reads as a hold card, this is the first thing to check.
    expect(isHoldName("Box Jump")).toBe(false);
    expect(isSpeedName("Box Jump")).toBe(false);
  });
});

describe("the classifiers", () => {
  it("classify library names without any app state published", () => {
    expect(isMobilityName("Couch Stretch")).toBe(true);
    expect(isSpeedName("Ladder Icky Shuffle")).toBe(true);
    expect(isHoldName("Couch Stretch")).toBe(true);
    expect(isHoldName("A-Skip")).toBe(true);
    expect(isHoldName("Deadlift")).toBe(false);
  });

  it("isCarryName: library carries, and any coach-typed name that says carry", () => {
    expect(isCarryName("Farmer's Carry")).toBe(true);
    expect(isCarryName("Heavy Bucket Carry")).toBe(true);
    expect(isCarryName("Sandbag Carries")).toBe(true);
    // The regex demands the whole WORD carry/carries. "Carryover" is real
    // gym vocabulary (accessory carryover work) and is not a carry — without
    // the boundary it would render as a weight × time card.
    expect(isCarryName("Carryover Work")).toBe(false);
    expect(isCarryName("Carioca")).toBe(false);
    expect(isCarryName("")).toBe(false);
    expect(isCarryName(null)).toBe(false);
  });

  it("exIsTimed: persisted flag, or a carry name; mobility holds are not timed lifts", () => {
    expect(exIsTimed({ name: "Custom Thing", timed: true })).toBe(true);
    expect(exIsTimed({ name: "Suitcase Carry" })).toBe(true);
    expect(exIsTimed({ name: "Bench Press" })).toBe(false);
    expect(exIsTimed({ name: "Couch Stretch" })).toBe(false);
    expect(exIsTimed(null)).toBe(false);
  });
});

describe("the custom-exercise seam", () => {
  const publish = (list) => {
    globalThis.STSD.app = { customExerciseList: () => list };
  };

  it("a custom filed under a hold or carry category classifies like a library one", () => {
    publish([
      { name: "Coach's Special Stretch", cat: "Mobility & Stretching" },
      { name: "Cone Chaos", cat: "Speed/Agility" },
      { name: "Keg Walk", cat: "Carries" },
    ]);
    expect(isMobilityName("Coach's Special Stretch")).toBe(true);
    expect(isSpeedName("Cone Chaos")).toBe(true);
    expect(isCarryName("Keg Walk")).toBe(true);
    expect(exIsTimed({ name: "Keg Walk" })).toBe(true);
  });

  it("a custom under a strength category stays a strength exercise", () => {
    publish([{ name: "Coach's Special Stretch", cat: "Chest" }]);
    expect(isMobilityName("Coach's Special Stretch")).toBe(false);
    expect(isCarryName("Coach's Special Stretch")).toBe(false);
  });

  it("reads the published list at CALL time, not at load", () => {
    // The whole point of the seam: the module was imported long before this
    // test published anything, and the classifier still sees it.
    expect(isMobilityName("Late Arrival Stretch")).toBe(false);
    publish([{ name: "Late Arrival Stretch", cat: "Mobility & Stretching" }]);
    expect(isMobilityName("Late Arrival Stretch")).toBe(true);
    delete globalThis.STSD.app;
    expect(isMobilityName("Late Arrival Stretch")).toBe(false);
  });
});
