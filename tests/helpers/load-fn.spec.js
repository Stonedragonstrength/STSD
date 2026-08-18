// The helper that every future unit test leans on. If this is quietly wrong,
// a hundred green tests mean nothing — so it gets tested before anything
// depends on it, including its failure messages.
import { describe, it, expect } from "vitest";
import { loadFn, loadFns, declSource } from "./load-fn.js";

describe("declSource", () => {
  it("brace-matches a whole function body out of app.js", () => {
    const src = declSource("function deloadTargetWeight(");
    expect(src.startsWith("function deloadTargetWeight(target, grain, pct)")).toBe(true);
    expect(src.trimEnd().endsWith("}")).toBe(true);
    // Balanced: as many opens as closes, or the matcher stopped in the wrong place.
    const opens = (src.match(/\{/g) || []).length;
    const closes = (src.match(/\}/g) || []).length;
    expect(opens).toBe(closes);
  });

  it("names the declaration when it cannot find it", () => {
    expect(() => declSource("function thisWasRenamedOrDeleted(")).toThrow(
      /thisWasRenamedOrDeleted.*not found in app\.js/s
    );
  });

  it("reads other files too", () => {
    // The fixture was rowToAthlete until it moved to src/sync/rows.js
    // (Phase 1 extraction); upsertCoach stays in cloud.js.
    const src = declSource("function upsertCoach(", "cloud.js");
    expect(src).toContain("upsertCoach");
  });

  it("ends a statement declaration at its semicolon, not at some later brace", () => {
    // The trap: `const x = new Map();` has no brace of its own, so brace-matching
    // would run on to an unrelated block far below and swallow it whole —
    // silently, since the result still compiles.
    const map = declSource("const _debounceTimers = new Map()", "cloud.js");
    expect(map).toBe("const _debounceTimers = new Map();");

    const arr = declSource("const RETRY_MS = [", "cloud.js");
    expect(arr).toBe("const RETRY_MS = [5000, 15000, 45000, 120000];");
    expect(arr).not.toContain("function");

    const num = declSource("let _inflightPushes = 0", "cloud.js");
    expect(num).toBe("let _inflightPushes = 0;");
  });

  it("does not stop at a semicolon nested inside brackets or a string", () => {
    // `for (let i = 0; ...)` inside a value, or a ";" in a string literal, must
    // not terminate the statement early.
    // The fixture followed READINESS_FACES to src/training/readiness.js
    // (Phase 2 extraction) — which also exercises the other-file path.
    const src = declSource("const READINESS_FACES", "src/training/readiness.js");
    expect(src.trimEnd().endsWith(";")).toBe(true);
    const opens = (src.match(/\[/g) || []).length;
    const closes = (src.match(/\]/g) || []).length;
    expect(opens).toBe(closes);
  });
});

describe("loadFn", () => {
  it("returns a working function, not a copy of one", () => {
    const deloadTargetWeight = loadFn("function deloadTargetWeight(");
    // Intent (2026-08-11 skip-day design): a pullback drops the target by pct,
    // floored to the ladder's grain, and never goes below one grain.
    expect(deloadTargetWeight(200, 5, 15)).toBe(170);   // 170 exactly on a 5 grain
    expect(deloadTargetWeight(100, 10, 15)).toBe(80);   // 85 -> floors to 80
    expect(deloadTargetWeight(5, 5, 15)).toBe(5);       // floor: never below one grain
    expect(deloadTargetWeight(0, 5, 15)).toBe(5);       // and never zero
  });

  it("injects the closure variables a severed function still needs", () => {
    // dayOccurrences is self-contained; progressionAttempt is the real shape of
    // the problem — it reads three names that live elsewhere in the IIFE.
    const progressionAttempt = loadFn("function progressionAttempt(", {
      readinessScore: () => 0,
      READINESS_QS: [],
      READY_LOW_MAX: 0,
    });
    expect(typeof progressionAttempt).toBe("function");
  });

  it("says what was missing and what it had, when a dep is left out", () => {
    // A missing dep only surfaces when the function RUNS — the extracted body
    // compiles either way — so the message has to arrive at call time, naming
    // both the free variable and what was supplied. Without that the caller
    // gets a bare ReferenceError from inside a `new Function`, with no file and
    // no line.
    const progressionAttempt = loadFn("function progressionAttempt(", {
      readinessScore: () => 0, // READINESS_QS and READY_LOW_MAX deliberately absent
    });
    // The args have to get far enough in to touch the missing name: a locked
    // entry that meets the set count, plus a readiness record dated to that
    // same session, which is the only branch that reads READINESS_QS.
    const ex = { id: "a" };
    const logs = { a: [{ date: "2026-08-01", locked: true, sets: [{ weight: "100", reps: "10" }] }] };
    const ctx = { dayId: "d1", readyMap: { d1: { date: "2026-08-01" } } };
    expect(() => progressionAttempt(ex, 100, 1, logs, ctx)).toThrow(
      /referenced something it was not given[\s\S]*deps supplied: readinessScore/
    );
  });

  it("keeps the function's name and arity", () => {
    const deloadTargetWeight = loadFn("function deloadTargetWeight(");
    expect(deloadTargetWeight.name).toBe("deloadTargetWeight");
    expect(deloadTargetWeight.length).toBe(3);
  });
});

describe("loadFns", () => {
  it("loads several declarations that depend on each other", () => {
    const { dayOccurrences, isSkipOccurrence } = loadFns([
      "function dayOccurrences(",
      "function isSkipOccurrence(",
    ]);
    const day = { exercises: [{ id: "a" }, { id: "b" }] };
    const logs = {
      a: [{ date: "2026-08-01", locked: true, sets: [{ reps: "5" }] }],
      b: [{ date: "2026-08-01", locked: true, skipped: true }],
    };
    // Intent: an occurrence is any date the day was touched by a LOCKED entry,
    // skip or real, ascending and deduplicated across the day's exercises.
    expect(dayOccurrences(day, logs)).toEqual(["2026-08-01"]);
    // ...and that date is not an all-skip occurrence, because one lift was real.
    expect(isSkipOccurrence(day, logs, "2026-08-01")).toBe(false);
  });

  it("ignores unlocked entries when deciding a day was touched", () => {
    // The distinction that caused a real bug elsewhere in the app: a typed but
    // unaccepted set is not evidence the day happened.
    const { dayOccurrences } = loadFns(["function dayOccurrences("]);
    const day = { exercises: [{ id: "a" }] };
    const logs = { a: [{ date: "2026-08-01", locked: false, sets: [{ reps: "5" }] }] };
    expect(dayOccurrences(day, logs)).toEqual([]);
  });
});
