// The grading tables and band functions — written new when they moved out
// of the IIFE (tier 1: a real import of the shipped file).
//
// What earns the paranoia: these numbers decide whether an athlete's week
// reads as gaps or as done, and both failure directions have shipped
// before. One ladder for everyone graded a correct beginner program as six
// warnings; a 16-set ceiling graded well-built weeks as gaps. The current
// numbers are owner-tuned (2026-08-13) and the extraction freezes them.
import { describe, it, expect } from "vitest";
import "./levels.js";

const {
  EFFORT_LEVELS, effortLevel,
  TRAINING_LEVELS, DEFAULT_TRAINING_LEVEL,
  TRAINING_PHASES, NO_PHASE_GOAL, phaseOf,
  effortRank, phaseMinRank,
  GEAR, GEAR_BY_ID,
  levelBands, coverageBand, covSetsLabel,
} = globalThis.STSD.training;

describe("the training-age ladder", () => {
  it("carries the owner-tuned numbers: 4/6, 8/10, 10/12", () => {
    expect(TRAINING_LEVELS.map((l) => [l.id, l.solid, l.plenty])).toEqual([
      ["beginner", 4, 6],
      ["intermediate", 8, 10],
      ["advanced", 10, 12],
    ]);
  });

  it("unset and unrecognised both read as intermediate — nothing on the roster moves by default", () => {
    expect(DEFAULT_TRAINING_LEVEL).toBe("intermediate");
    expect(levelBands({}).solid).toBe(8);
    expect(levelBands(null).solid).toBe(8);
    expect(levelBands({ trainingLevel: "galactic" }).solid).toBe(8);
    expect(levelBands({ trainingLevel: "beginner" }).solid).toBe(4);
  });
});

describe("phases", () => {
  it("a phase REPLACES the ladder rather than shifting it", () => {
    const b = levelBands({ trainingLevel: "advanced", trainingPhase: "fatloss" });
    expect(b.solid).toBe(3);
    expect(b.plenty).toBe(5);
    expect(b.minEffort).toBe("hard");
  });

  it("hypertrophy is deliberately the ABSENCE of a phase", () => {
    expect(TRAINING_PHASES.some((p) => p.id === "hypertrophy")).toBe(false);
    expect(NO_PHASE_GOAL.id).toBe("");
    expect(phaseOf({ trainingPhase: "" })).toBe(null);
    expect(phaseOf({ trainingPhase: "hypertrophy" })).toBe(null);
    expect(phaseOf({ trainingPhase: "maintenance" })?.id).toBe("maintenance");
  });

  it("every phase names its minimum burn, and the gate ranks resolve through EFFORT_LEVELS", () => {
    for (const p of TRAINING_PHASES) expect(EFFORT_LEVELS[p.minEffort], p.id).toBeTruthy();
    expect(phaseMinRank(null)).toBe(0);
    expect(phaseMinRank(phaseOf({ trainingPhase: "fatloss" }))).toBe(EFFORT_LEVELS.hard.rank);
    expect(phaseMinRank(phaseOf({ trainingPhase: "endurance" }))).toBe(EFFORT_LEVELS.light.rank);
  });

  it("effortRank: unset reads 0, never a guess", () => {
    expect(effortRank({})).toBe(0);
    expect(effortRank(null)).toBe(0);
    expect(effortRank({ effort: "hard" })).toBe(3);
    expect(effortLevel({ effort: "max" })?.rank).toBe(4);
  });
});

describe("coverageBand", () => {
  const b = { solid: 8, plenty: 10 };
  it("grades on the recorded boundaries: nothing, some, solid, plenty", () => {
    expect(coverageBand(0, b)).toBe(0);
    expect(coverageBand(0.5, b)).toBe(0);
    expect(coverageBand(1, b)).toBe(1);
    expect(coverageBand(7.5, b)).toBe(1);
    expect(coverageBand(8, b)).toBe(2);
    expect(coverageBand(9.5, b)).toBe(2);
    expect(coverageBand(10, b)).toBe(3);
  });

  it("no bands given falls back to the default ladder, not zero thresholds", () => {
    expect(coverageBand(8)).toBe(2);
    expect(coverageBand(7)).toBe(1);
  });
});

describe("covSetsLabel", () => {
  it("halves are the only fraction the engine produces, and they read as ½", () => {
    expect(covSetsLabel(0)).toBe("0");
    expect(covSetsLabel(0.5)).toBe("½");
    expect(covSetsLabel(7)).toBe("7");
    expect(covSetsLabel(7.5)).toBe("7½");
    expect(covSetsLabel(undefined)).toBe("0");
  });
});

describe("the gear vocabulary", () => {
  it("seventeen unique ids, each with an eq: icon, indexed by id", () => {
    expect(GEAR.length).toBe(17);
    expect(new Set(GEAR.map((g) => g.id)).size).toBe(17);
    for (const g of GEAR) expect(g.icon.startsWith("eq:"), g.id).toBe(true);
    expect(GEAR_BY_ID.barbell.label).toBe("Barbell");
  });
});
