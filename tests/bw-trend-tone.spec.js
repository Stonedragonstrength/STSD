// Which way is the right way, per metric.
//
// Body fat down and muscle up are not in question. WEIGHT is, and getting it
// wrong is worse than leaving it grey: painting a lean bulk's +6 lb red tells
// an athlete who is doing exactly what was asked that they are failing, on
// their own progress screen, in a colour that needs no explaining.
//
// So weight reads the goal the app already stores from the targets calculator
// (`progress.nutritionTargets.calc.goal`): cut, maintain or lean bulk. With no
// goal set there is no right direction, and the card stays neutral rather than
// guessing one.
import { describe, it, expect } from "vitest";
import { loadFns } from "./helpers/load-fn.js";

// BW_FLAT is app.js's own "this is rounding, not a direction" threshold; the
// card's arrow uses the same constant.
const { bwTrendTone } = loadFns(["function bwTrendTone("], { BW_FLAT: 0.05 });

const WEIGHT = { key: "weight", dir: "goal" };
const FAT = { key: "bodyfat", dir: "down" };
const MUSCLE = { key: "muscle", dir: "up" };

describe("metrics with only one right direction", () => {
  it("body fat down is good, up is bad", () => {
    expect(bwTrendTone(FAT, -3.6)).toBe("good");
    expect(bwTrendTone(FAT, 3.6)).toBe("bad");
  });

  it("muscle up is good, down is bad", () => {
    expect(bwTrendTone(MUSCLE, 3.2)).toBe("good");
    expect(bwTrendTone(MUSCLE, -3.2)).toBe("bad");
  });
});

describe("weight, which depends on what they are trying to do", () => {
  it("is neutral when no goal has been set", () => {
    expect(bwTrendTone(WEIGHT, -12.2)).toBe("");
    expect(bwTrendTone(WEIGHT, 12.2, null)).toBe("");
    expect(bwTrendTone(WEIGHT, 12.2, "")).toBe("");
  });

  it("cutting: down is good", () => {
    expect(bwTrendTone(WEIGHT, -12.2, "cut")).toBe("good");
    expect(bwTrendTone(WEIGHT, 12.2, "cut")).toBe("bad");
  });

  it("lean bulk: up is good", () => {
    expect(bwTrendTone(WEIGHT, 6.0, "lean")).toBe("good");
    expect(bwTrendTone(WEIGHT, -6.0, "lean")).toBe("bad");
  });

  it("maintaining: holding is the win, so drift either way is not praised", () => {
    // Neither direction earns green when the goal is to stay put, and neither
    // earns red either: a maintaining athlete moving 2 lb has done nothing
    // wrong. The card says the number and keeps its own colour.
    expect(bwTrendTone(WEIGHT, 2.0, "maintain")).toBe("");
    expect(bwTrendTone(WEIGHT, -2.0, "maintain")).toBe("");
  });

  it("does not colour a goal it has never heard of", () => {
    expect(bwTrendTone(WEIGHT, -12.2, "recomp")).toBe("");
  });
});

describe("standing still", () => {
  it("is neutral for every metric, whatever the goal", () => {
    // The card shows a flat bar rather than an arrow at this size, and a
    // colour on it would be reading meaning into rounding.
    expect(bwTrendTone(FAT, 0)).toBe("");
    expect(bwTrendTone(MUSCLE, 0.04)).toBe("");
    expect(bwTrendTone(WEIGHT, -0.04, "cut")).toBe("");
  });
});
