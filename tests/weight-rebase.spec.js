// "You went lighter than the card asked. Carry it forward?"
//
// The offer only ever appears when it can be delivered, so the two questions
// under it have to be exact:
//
//   * was this session genuinely lighter, judged on the TOP set? A lighter
//     warm-up is not a lighter session, and 184 against a prescribed 185 is a
//     different bar or a rounding, not a decision.
//   * which later copies of the lift should move? Only the ones that still
//     agree with the week being logged. A week the coach deliberately set to
//     something else was set deliberately.
import { describe, it, expect } from "vitest";
import { loadFns } from "./helpers/load-fn.js";

const { laterCopiesOfLift, loggedLighterThan } = loadFns(
  ["function laterCopiesOfLift(", "function loggedLighterThan("],
  {
    exKey: (n) => String(n || "").trim().toLowerCase(),
    storeW: (v) => (v === "BW" || v === "BAR" ? v : String(v ?? "")),
  },
);

const ex = (name, w) => ({ id: name + w, name, currentWeight: String(w) });
const week = (id, exercises) => ({ id, days: [{ id: id + "d", exercises }] });
const set = (w) => ({ weight: String(w), reps: "5" });

describe("loggedLighterThan", () => {
  it("reads the TOP set, not the first one", () => {
    const r = loggedLighterThan(ex("Bench Press", 185), { sets: [set(95), set(135), set(155)] });
    expect(r).toEqual({ asked: 185, top: 155 });
  });

  it("says nothing when they hit the number", () => {
    expect(loggedLighterThan(ex("Bench Press", 185), { sets: [set(185)] })).toBe(null);
  });

  it("says nothing when they went heavier", () => {
    expect(loggedLighterThan(ex("Bench Press", 185), { sets: [set(205)] })).toBe(null);
  });

  it("ignores a difference too small to be a decision", () => {
    // 182.5 against 185 is a different bar or a rounding, not "I went lighter".
    expect(loggedLighterThan(ex("Bench Press", 185), { sets: [set(182.5)] })).toBe(null);
    expect(loggedLighterThan(ex("Bench Press", 185), { sets: [set(175)] })).toBeTruthy();
  });

  it("has nothing to compare against for bodyweight or an empty bar", () => {
    expect(loggedLighterThan(ex("Pull-up", "BW"), { sets: [set(0)] })).toBe(null);
    expect(loggedLighterThan(ex("Bench Press", "BAR"), { sets: [set(45)] })).toBe(null);
    expect(loggedLighterThan(ex("Bench Press", ""), { sets: [set(135)] })).toBe(null);
  });

  it("has nothing to compare when no set carried a weight", () => {
    expect(loggedLighterThan(ex("Bench Press", 185), { sets: [{ weight: "", reps: "8" }] })).toBe(null);
    expect(loggedLighterThan(ex("Bench Press", 185), { sets: [] })).toBe(null);
    expect(loggedLighterThan(ex("Bench Press", 185), null)).toBe(null);
  });
});

describe("laterCopiesOfLift", () => {
  const weeks = [
    week("w1", [ex("Bench Press", 185), ex("Row", 135)]),
    week("w2", [ex("Bench Press", 185), ex("Row", 135)]),
    week("w3", [ex("Bench Press", 185)]),
    week("w4", [ex("Bench Press", 205)]),        // deliberately set higher
  ];

  it("takes the later weeks that still agree, and no others", () => {
    const found = laterCopiesOfLift(weeks, "w1", ex("Bench Press", 185));
    expect(found.length).toBe(2);                 // w2 and w3; w4 was set on purpose
    expect(found.every((e) => e.currentWeight === "185")).toBe(true);
  });

  it("never touches the week being logged, or the ones before it", () => {
    const found = laterCopiesOfLift(weeks, "w2", ex("Bench Press", 185));
    expect(found.length).toBe(1);                 // w3 only
  });

  it("is empty from the last week, which is the offer not appearing", () => {
    expect(laterCopiesOfLift(weeks, "w4", ex("Bench Press", 205))).toEqual([]);
  });

  it("matches the lift by name, because every week's copy has its own id", () => {
    const found = laterCopiesOfLift(weeks, "w1", { id: "unrelated", name: "bench press", currentWeight: "185" });
    expect(found.length).toBe(2);
  });

  it("leaves other lifts alone", () => {
    const found = laterCopiesOfLift(weeks, "w1", ex("Bench Press", 185));
    expect(found.some((e) => e.name === "Row")).toBe(false);
  });

  it("finds a lift that appears twice in one week", () => {
    const twice = [week("w1", [ex("Bench Press", 185)]),
      { id: "w2", days: [{ id: "a", exercises: [ex("Bench Press", 185)] }, { id: "b", exercises: [ex("Bench Press", 185)] }] }];
    expect(laterCopiesOfLift(twice, "w1", ex("Bench Press", 185)).length).toBe(2);
  });

  it("returns nothing rather than guessing when the week is unknown", () => {
    expect(laterCopiesOfLift(weeks, "nope", ex("Bench Press", 185))).toEqual([]);
    expect(laterCopiesOfLift(null, "w1", ex("Bench Press", 185))).toEqual([]);
    expect(laterCopiesOfLift(weeks, "w1", { name: "" })).toEqual([]);
  });
});
