// Duplicating a week used to spread instead of clone, so both weeks shared
// every nested object — the diet, an exercise's modifiers and per-set
// weights, the progression config. Editing one week edited the other,
// silently. These tests pin the deep copy and the id regeneration.
import { describe, it, expect } from "vitest";
import { loadFn } from "./helpers/load-fn.js";

let n = 0;
const uid = () => "t" + (++n);
const cloneWeekForDuplicate = loadFn("function cloneWeekForDuplicate(", { uid });

const week = () => ({
  id: "w1",
  label: "Week 1",
  focus: "Strength",
  diet: { calories: 3200, protein: 180, notes: "eat" },
  days: [
    {
      id: "d1",
      name: "Day 1",
      exercises: [
        {
          id: "e1",
          name: "Squat",
          sets: 5,
          currentWeight: 225,
          currentReps: 5,
          goalWeight: 315,
          goalReps: 5,
          modifiers: { tempo: "3-1-1" },
          perSetWeights: [225, 225, 225, 225, 225],
          progression: { kind: "dual", step: 5 },
        },
      ],
    },
  ],
});

describe("cloneWeekForDuplicate", () => {
  it("gives the copy its own nested objects — editing one week cannot edit the other", () => {
    const src = week();
    const dup = cloneWeekForDuplicate(src);
    dup.diet.calories = 1;
    dup.days[0].exercises[0].modifiers.tempo = "X";
    dup.days[0].exercises[0].perSetWeights[0] = 999;
    dup.days[0].exercises[0].progression.step = 99;
    expect(src.diet.calories).toBe(3200);
    expect(src.days[0].exercises[0].modifiers.tempo).toBe("3-1-1");
    expect(src.days[0].exercises[0].perSetWeights[0]).toBe(225);
    expect(src.days[0].exercises[0].progression.step).toBe(5);
  });

  it("regenerates week, day and exercise ids — logs and completions key on them", () => {
    const src = week();
    const dup = cloneWeekForDuplicate(src);
    expect(dup.id).not.toBe(src.id);
    expect(dup.days[0].id).not.toBe(src.days[0].id);
    expect(dup.days[0].exercises[0].id).not.toBe(src.days[0].exercises[0].id);
  });

  it("keeps the content itself untouched", () => {
    const src = week();
    const dup = cloneWeekForDuplicate(src);
    expect(dup.label).toBe("Week 1");
    expect(dup.diet).toEqual(src.diet);
    expect(dup.days[0].exercises[0].currentWeight).toBe(225);
    expect(dup.days[0].exercises[0].progression).toEqual({ kind: "dual", step: 5 });
  });

  it("survives a week with no days and a day with no exercises", () => {
    expect(() => cloneWeekForDuplicate({ id: "w", label: "W" })).not.toThrow();
    const dup = cloneWeekForDuplicate({ id: "w", days: [{ id: "d" }] });
    expect(dup.days[0].id).not.toBe("d");
  });
});
