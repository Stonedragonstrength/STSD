// The stat pentagon's engine — tier 1: a real import of the shipped file,
// run against the REAL profile table (exercise-stats.js). The deep
// arithmetic checks stay in tests/stat-scoring.test.js and stat-decay.test.js
// (both still run, re-pointed); what this spec owns is the module boundary:
// the four documented silent-failure modes through the real pipeline, the
// decay's shape, and the signatures that decide what re-prices.
import { describe, it, expect, beforeAll } from "vitest";
import "./tags.js";
import "./library.js";
import "./anatomy.js";
import "./levels.js";
import "./builder.js";
import "./stat-field.js";

beforeAll(async () => {
  globalThis.window = globalThis;
  await import("../../exercise-demos.js");
  await import("../../exercise-muscles.js");
  await import("../../exercise-stats.js");
});

const {
  statBucketForDate, statVectorForEntry, statDaySignatures,
  statDecayFactor, statFloorFrac, statAxisFrac, statCapDay, statShare,
  STAT_KEYS, STAT_DAY_FULL,
} = globalThis.STSD.training;

const lift = { id: "e1", name: "Back Squat", sets: "3" };
const day = (exercises) => ({ weeks: [{ id: "w1", days: [{ id: "d1", exercises }] }], oneOffDays: [] });
const locked = (sets) => ({ date: "2026-08-10", locked: true, sets });
const heavySets = [{ weight: 225, reps: 5 }, { weight: 225, reps: 5 }, { weight: 225, reps: 5 }];

describe("the four silent-failure modes, through the real pipeline", () => {
  it("a rounds-based hold (no sets key at all) still scores — DEX must not die", () => {
    const stretch = { id: "e2", name: "Couch Stretch", kind: "mobility", sets: "2", currentReps: "30" };
    const progress = { exerciseLogs: { e2: [{ date: "2026-08-10", locked: true, rounds: [true, true] }] } };
    const b = statBucketForDate(day([stretch]), progress, "2026-08-10");
    expect(b.DEX || 0).toBeGreaterThan(0);
  });

  it("a timed carry is seconds, not reps — 45s must not read as a 45-rep endurance set", () => {
    const carry = { id: "e3", name: "Farmer's Carry", sets: "3", currentReps: "45" };
    const v = statVectorForEntry(carry, locked([{ weight: 100, reps: "45s" }, { weight: 100, reps: "45s" }, { weight: 100, reps: "45s" }]), {});
    // The carry profile is STR/CON-weighted; read as 45 reps it would land in
    // the very-high band and dump into END.
    expect(v.CON).toBeGreaterThan(v.END);
  });

  it("an unlocked draft moves nothing", () => {
    const progress = { exerciseLogs: { e1: [{ date: "2026-08-10", locked: false, sets: heavySets }] } };
    const b = statBucketForDate(day([lift]), progress, "2026-08-10");
    expect(STAT_KEYS.every((k) => !b[k])).toBe(true);
  });

  it("one session is one session, however many devices minted entries for it", () => {
    const one = { exerciseLogs: { e1: [locked(heavySets)] } };
    const two = { exerciseLogs: { e1: [locked(heavySets), locked(heavySets)] } };
    expect(statBucketForDate(day([lift]), two, "2026-08-10"))
      .toEqual(statBucketForDate(day([lift]), one, "2026-08-10"));
  });
});

describe("the day cap and the shares", () => {
  it("caps a monster day softly: under full passes through, over full compresses", () => {
    expect(statCapDay(5)).toBe(5);
    expect(statCapDay(STAT_DAY_FULL)).toBe(STAT_DAY_FULL);
    expect(statCapDay(14)).toBeLessThan(14);
    expect(statCapDay(14)).toBeGreaterThanOrEqual(STAT_DAY_FULL);
  });

  it("the cap is applied INSIDE the bucket, not just available beside it", () => {
    // Six heavy lifts on one date: the raw CON sum blows past the daily full,
    // and the stored bucket must be the capped number, not the raw one.
    const exercises = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, name: "Back Squat", sets: "5" }));
    const logs = {};
    const big = [1, 2, 3, 4, 5].map(() => ({ weight: 315, reps: 8 }));
    for (const ex of exercises) logs[ex.id] = [{ date: "2026-08-10", locked: true, sets: big }];
    const progress = { exerciseLogs: logs };
    const c = day(exercises);
    const raw = exercises.reduce((t, ex) =>
      t + statVectorForEntry(ex, logs[ex.id][0], progress).CON, 0);
    const b = statBucketForDate(c, progress, "2026-08-10");
    expect(raw).toBeGreaterThan(STAT_DAY_FULL);
    expect(b.CON).toBeLessThan(raw);
    expect(b.CON).toBeCloseTo(Math.round(statCapDay(raw) * 10) / 10, 5);
  });

  it("statShare normalises a vector to shares of its own total", () => {
    const shares = statShare({ STR: 60, AGI: 0, DEX: 0, END: 0, CON: 40 });
    expect(shares.STR).toBeCloseTo(0.6, 5);
    expect(shares.CON).toBeCloseTo(0.4, 5);
  });

  it("statAxisFrac clamps to the unit interval", () => {
    expect(statAxisFrac("STR", -5)).toBe(0);
    expect(statAxisFrac("STR", 1e9)).toBe(1);
  });
});

describe("decay", () => {
  it("today is whole, and every axis only ever loses value with age", () => {
    for (const k of STAT_KEYS) {
      expect(statDecayFactor(k, 0)).toBe(1);
      let prev = 1;
      for (const age of [7, 30, 90, 180, 365]) {
        const f = statDecayFactor(k, age);
        expect(f, `${k}@${age}`).toBeLessThanOrEqual(prev);
        expect(f).toBeGreaterThanOrEqual(0);
        prev = f;
      }
      // And it genuinely decays — a year out, nearly everything is gone.
      expect(statDecayFactor(k, 365), `${k}@365`).toBeLessThan(0.1);
    }
  });

  it("the floor rises with training age — an advanced athlete's base holds more", () => {
    expect(statFloorFrac({ trainingLevel: "advanced" }))
      .toBeGreaterThan(statFloorFrac({ trainingLevel: "beginner" }));
    expect(statFloorFrac({})).toBe(statFloorFrac({ trainingLevel: "intermediate" }));
  });
});

describe("signatures: what re-prices and what stays settled", () => {
  it("an edit re-stamps its day's signature and no other's", () => {
    // The signature deliberately hashes the entry's `m` edit stamp, not the
    // set contents: every real edit path re-stamps `m` (that is the sync
    // engine's tie-breaker), so `m` moving IS "the logs changed", and hashing
    // it keeps the signature cheap on a 400-day history.
    const entry = (date, m) => ({ id: "n1", date, m, locked: true, sets: heavySets });
    const before = statDaySignatures({ exerciseLogs: { e1: [entry("2026-08-10", 100), entry("2026-08-12", 200)] } });
    const after = statDaySignatures({ exerciseLogs: { e1: [entry("2026-08-10", 150), entry("2026-08-12", 200)] } });
    expect(after.get("2026-08-10")).not.toBe(before.get("2026-08-10"));
    expect(after.get("2026-08-12")).toBe(before.get("2026-08-12"));
    // Locking state is part of the fingerprint too — a draft becoming real
    // must re-price the day.
    const draft = statDaySignatures({ exerciseLogs: { e1: [{ ...entry("2026-08-10", 100), locked: false }] } });
    expect(draft.get("2026-08-10")).not.toBe(before.get("2026-08-10"));
  });
});
