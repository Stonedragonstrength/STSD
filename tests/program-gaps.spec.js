// What counts as an exercise the coach has not finished filling in.
//
// The trap is what does NOT count. "BW" and "BAR" are what the weight picker
// writes for bodyweight and an empty bar: they are answers, not blanks, and
// outlining a pull-up in red for having no weight would train the coach to
// ignore the red. Mobility is the other one: those rows render Rounds × Hold
// and never get a weight button at all, so asking them for a weight would
// flag a control that does not exist on screen.
import { describe, it, expect } from "vitest";
import { loadFns } from "./helpers/load-fn.js";

const { programGaps } = loadFns(["function programGaps("], {});

const ex = (over) => ({ id: "e1", name: "Back Squat", sets: "3", currentWeight: "185", currentReps: "8", ...over });
const week = (exercises, label = "Week 1") => [{ label, days: [{ id: "d1", name: "Day 1", exercises }] }];

describe("a finished exercise", () => {
  it("is not a gap", () => {
    expect(programGaps(week([ex()]))).toEqual([]);
  });

  it("counts BW as a filled-in weight, because it is one", () => {
    expect(programGaps(week([ex({ currentWeight: "BW" })]))).toEqual([]);
  });

  it("counts BAR the same way", () => {
    expect(programGaps(week([ex({ currentWeight: "BAR" })]))).toEqual([]);
  });
});

describe("the three blanks", () => {
  it("catches missing sets", () => {
    expect(programGaps(week([ex({ sets: "" })]))[0].missing).toEqual(["sets"]);
  });

  it("catches missing weight", () => {
    expect(programGaps(week([ex({ currentWeight: "" })]))[0].missing).toEqual(["weight"]);
  });

  it("catches missing reps", () => {
    expect(programGaps(week([ex({ currentReps: "" })]))[0].missing).toEqual(["reps"]);
  });

  it("catches all three at once, in the order they sit on the row", () => {
    const g = programGaps(week([ex({ sets: "", currentWeight: "", currentReps: "" })]));
    expect(g[0].missing).toEqual(["sets", "weight", "reps"]);
  });

  it("treats whitespace and undefined as blank", () => {
    expect(programGaps(week([ex({ sets: "   " })]))[0].missing).toEqual(["sets"]);
    expect(programGaps(week([ex({ currentReps: undefined })]))[0].missing).toEqual(["reps"]);
  });

  it("does not trip over a legitimate zero", () => {
    // A prescribed 0 is odd but it is an answer, and the picker can write one.
    expect(programGaps(week([ex({ sets: 0 })]))).toEqual([]);
  });
});

describe("mobility, which has no weight to give", () => {
  const mob = (over) => ex({ kind: "mobility", currentWeight: "", ...over });

  it("is never asked for a weight", () => {
    expect(programGaps(week([mob()]))).toEqual([]);
  });

  it("names its blanks rounds and hold, the way the row does", () => {
    const g = programGaps(week([mob({ sets: "", currentReps: "" })]));
    expect(g[0].missing).toEqual(["rounds", "hold"]);
  });
});

describe("where the gap is", () => {
  it("carries the week label and day name, for the days not on screen", () => {
    const weeks = [
      { label: "Week 1", days: [{ id: "d1", name: "Push", exercises: [ex()] }] },
      { label: "Week 2", days: [{ id: "d2", name: "Pull", exercises: [ex({ id: "e9", sets: "" })] }] },
    ];
    expect(programGaps(weeks)).toEqual([
      { where: "Week 2", day: "Pull", exId: "e9", name: "Back Squat", missing: ["sets"] },
    ]);
  });

  it("falls back to a week number when a week has no label", () => {
    const weeks = [{ days: [{ id: "d1", name: "Day 1", exercises: [ex({ sets: "" })] }] }];
    expect(programGaps(weeks)[0].where).toBe("Week 1");
  });

  it("checks one-off days too, so a clean save cannot hide one", () => {
    const oneOffs = [{ id: "o1", name: "Saturday session", exercises: [ex({ id: "e5", currentReps: "" })] }];
    const g = programGaps([], oneOffs);
    expect(g).toEqual([
      { where: "One-off", day: "Saturday session", exId: "e5", name: "Back Squat", missing: ["reps"] },
    ]);
  });

  it("survives an empty or malformed program without throwing", () => {
    expect(programGaps()).toEqual([]);
    expect(programGaps([], [])).toEqual([]);
    expect(programGaps([{ days: null }], [null])).toEqual([]);
    expect(programGaps([{ days: [{ id: "d", name: "D" }] }])).toEqual([]);
  });
});
