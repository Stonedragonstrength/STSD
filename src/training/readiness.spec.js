// The readiness check-in's scoring — written new when it moved out of the
// IIFE (tier 1: a real import of the shipped file; nothing executed these
// before).
//
// The load-bearing fact: TWO SCALES LIVE IN THE DATA FOREVER. Records from
// before the four-step scale store 1-3 with 3 as the top answer; new records
// store 1-4 and stamp v:2, and cached builds keep writing the old shape for
// weeks. readinessAnswer is a permanent read-time remap, not a migration —
// get it wrong and years of saved check-ins silently reclassify, which
// moves whether an athlete's misses counted as stalls.
import { describe, it, expect } from "vitest";
import "./readiness.js";

const {
  READINESS_QS, READINESS_FACES, READINESS_FLAG,
  READY_LOW_MAX, READINESS_MAX, READY_LEVELS,
  readinessAnswer, readinessScore, readinessLevel,
  dayReadiness, readinessFlagAnswer,
} = globalThis.STSD.training;

const legacy = (sleep, sore, stress) => ({ sleep, sore, stress });
const v2 = (sleep, sore, stress) => ({ sleep, sore, stress, v: 2 });

describe("the tables", () => {
  it("three questions of four steps each, one shared face per step", () => {
    expect(READINESS_QS.map((q) => q.id)).toEqual(["sleep", "sore", "stress"]);
    for (const q of READINESS_QS) expect(q.opts.length, q.id).toBe(4);
    expect(READINESS_FACES.length).toBe(4);
    expect(READINESS_MAX).toBe(12);
  });

  it("the hungover flag is a three-step side axis, not a fourth scale", () => {
    expect(READINESS_FLAG.opts.length).toBe(3);
    expect(READINESS_FLAG.faces.length).toBe(3);
    // If its id ever joined READINESS_QS the sum would shift every threshold
    // and reclassify years of check-ins.
    expect(READINESS_QS.some((q) => q.id === READINESS_FLAG.id)).toBe(false);
  });
});

describe("readinessAnswer: the permanent two-scale remap", () => {
  it("a legacy top answer (3, no v) reads as the new top (4)", () => {
    expect(readinessAnswer(legacy(3, 3, 3), "sleep")).toBe(4);
  });

  it("a v2 record's 3 stays 3 — it means Good now, not the top", () => {
    expect(readinessAnswer(v2(3, 3, 3), "sleep")).toBe(3);
  });

  it("the bottom half never moved on either scale", () => {
    expect(readinessAnswer(legacy(1, 2, 1), "sleep")).toBe(1);
    expect(readinessAnswer(legacy(1, 2, 1), "sore")).toBe(2);
    expect(readinessAnswer(v2(1, 2, 1), "sleep")).toBe(1);
    expect(readinessAnswer(v2(1, 2, 1), "sore")).toBe(2);
  });

  it("unanswered reads as 0, never a guess", () => {
    expect(readinessAnswer({}, "sleep")).toBe(0);
    expect(readinessAnswer(null, "sleep")).toBe(0);
    expect(readinessAnswer({ sleep: "nope" }, "sleep")).toBe(0);
  });
});

describe("the score and its levels", () => {
  it("neutral is 6 on BOTH scales — all three answered Okay", () => {
    expect(readinessScore(legacy(2, 2, 2))).toBe(6);
    expect(readinessScore(v2(2, 2, 2))).toBe(6);
  });

  it("both scales' top answers score the same 12", () => {
    expect(readinessScore(legacy(3, 3, 3))).toBe(12);
    expect(readinessScore(v2(4, 4, 4))).toBe(12);
  });

  it("READY_LOW_MAX sits genuinely below par", () => {
    expect(READY_LOW_MAX).toBe(5);
    expect(READY_LOW_MAX).toBeLessThan(readinessScore(v2(2, 2, 2)));
  });

  it("classifies on the recorded boundaries: beat up / okay / ready", () => {
    expect(readinessLevel(v2(1, 1, 1)).id).toBe("low");    // 3
    expect(readinessLevel(v2(2, 2, 1)).id).toBe("low");    // 5
    expect(readinessLevel(v2(2, 2, 2)).id).toBe("mid");    // 6
    expect(readinessLevel(v2(3, 3, 2)).id).toBe("mid");    // 8
    expect(readinessLevel(v2(3, 3, 3)).id).toBe("high");   // 9
    expect(readinessLevel(v2(4, 4, 4)).id).toBe("high");   // 12
    // The legacy claim from the thresholds comment: a legacy record
    // classifies exactly as it used to once remapped.
    expect(readinessLevel(legacy(3, 3, 2)).id).toBe("high"); // old 8 → new 10
  });

  it("an unanswered or low-partial record has no level to read", () => {
    // The completeness guard is a SCORE floor (< 3), not a field count: the
    // real writer (setDayReadiness, app.js) refuses to save a partial record,
    // so anything stored is complete and the floor only has to catch empty
    // and malformed data. Pinned as shipped: a lone high answer — which no
    // writer produces — would read as a low score rather than null.
    expect(readinessLevel({ sleep: 1, v: 2 })).toBe(null);
    expect(readinessLevel(null)).toBe(null);
    expect(readinessLevel({ sleep: 4, v: 2 })?.id).toBe("low");
  });

  it("READY_LEVELS covers the whole scale in order", () => {
    expect(READY_LEVELS.map((l) => l.id)).toEqual(["low", "mid", "high"]);
    expect(READY_LEVELS[READY_LEVELS.length - 1].max).toBe(READINESS_MAX);
  });
});

describe("dayReadiness and the flag", () => {
  it("hands back a day's scoreable record and nothing else", () => {
    const rec = { ...v2(3, 2, 3), date: "2026-08-16" };
    expect(dayReadiness({ readiness: { d1: rec } }, "d1")).toBe(rec);
    expect(dayReadiness({ readiness: { d1: { sleep: 1, v: 2 } } }, "d1")).toBe(null);
    expect(dayReadiness({ readiness: {} }, "d1")).toBe(null);
    expect(dayReadiness(null, "d1")).toBe(null);
  });

  it("the flag normalizes: in-range passes, everything else is 0 — unknown is not No", () => {
    expect(readinessFlagAnswer({ hungover: 1 })).toBe(1);
    expect(readinessFlagAnswer({ hungover: 3 })).toBe(3);
    expect(readinessFlagAnswer({ hungover: 9 })).toBe(0);
    expect(readinessFlagAnswer({})).toBe(0);
    expect(readinessFlagAnswer(null)).toBe(0);
  });
});
