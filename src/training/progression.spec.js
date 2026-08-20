// The double-progression engine — tier 1 now: a real import of the shipped
// file, with its real dependencies (tags, library, readiness) rather than
// stubs. The skip/deload assertions are carried verbatim from
// tests/skip-day.test.js (header story kept below); the effectiveProgression
// describes are NEW coverage added at the move — the chain walker computed
// every athlete's targets with no executable test at all.
//
// From the ported file: the skip itself is sugar over entries the engine
// already rules on, so what needs pinning is the rulings — a deload-stamped
// entry is judged like a skip (chain frozen; judged as an attempt it would
// stall the ladder for taking the offer the app itself made), the pullback
// math floors to the ladder's grain and deliberately goes below the written
// weight, and two-in-a-row skip detection with partial logs breaking the run.
import { describe, it, expect } from "vitest";
import "./tags.js";
import "./library.js";
import "./readiness.js";
import "./progression.js";

const {
  progressionRule, progressionAttempt, deloadTargetWeight,
  consecutiveDaySkips, dayDeloadPending, effectiveProgression,
  PROG_NO_CAP,
} = globalThis.STSD.training;

describe("progressionAttempt rulings (ported from tests/skip-day.test.js)", () => {
  const ex = { id: "e1", sets: 3 };

  it("a deload entry with full real sets is judged logged:false (chain frozen)", () => {
    const logs = { e1: [{ date: "2026-08-18", locked: true, deload: true,
      sets: [{ weight: 85, reps: 8 }, { weight: 85, reps: 8 }, { weight: 85, reps: 8 }] }] };
    const att = progressionAttempt(ex, 100, 3, logs, {});
    expect(att.logged, `deload session must not be judged (got ${JSON.stringify(att)})`).toBe(false);
  });

  it("…and NOT as a stall-triggering miss (the under-weight branch must not run)", () => {
    // Same entry, weight 15% under target: if the deload branch is missing,
    // this returns {logged:true, min:null} — a real miss that stalls.
    const logs = { e1: [{ date: "2026-08-18", locked: true, deload: true,
      sets: [{ weight: 85, reps: 8 }, { weight: 85, reps: 8 }, { weight: 85, reps: 8 }] }] };
    const att = progressionAttempt(ex, 100, 3, logs, {});
    expect(att.min === null && att.logged === true).toBe(false);
  });

  it("a plain skip entry still rules logged:false (existing behaviour intact)", () => {
    const logs = { e1: [{ date: "2026-08-18", locked: true, skipped: true, sets: [] }] };
    expect(progressionAttempt(ex, 100, 3, logs, {}).logged).toBe(false);
  });

  it("a later REAL entry outranks an older deload one", () => {
    const logs = { e1: [
      { date: "2026-08-18", locked: true, deload: true, sets: [{ weight: 85, reps: 8 }, { weight: 85, reps: 8 }, { weight: 85, reps: 8 }] },
      { date: "2026-08-25", locked: true, sets: [{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }, { weight: 100, reps: 8 }] },
    ] };
    const att = progressionAttempt(ex, 100, 3, logs, {});
    expect(att.logged).toBe(true);
    expect(att.min).toBe(8);
  });

  it("a beat-up check-in dated to the session protects, one dated elsewhere does not", () => {
    // NEW at the port: the readiness wiring runs against the REAL scoring now
    // (v2 all-worst = 3, within the low band), not a stub.
    const logs = { e1: [{ date: "2026-08-18", locked: true,
      sets: [{ weight: 90, reps: 8 }, { weight: 90, reps: 8 }, { weight: 90, reps: 8 }] }] };
    const beat = { sleep: 1, sore: 1, stress: 1, v: 2, date: "2026-08-18" };
    const matched = progressionAttempt(ex, 100, 3, logs, { dayId: "d1", readyMap: { d1: beat } });
    expect(matched.protect).toBe(true);
    const elsewhere = progressionAttempt(ex, 100, 3, logs,
      { dayId: "d1", readyMap: { d1: { ...beat, date: "2026-08-25" } } });
    expect(elsewhere.protect).toBe(false);
    // The hungover flag's worst step protects on its own, outside the score.
    const hungover = { sleep: 4, sore: 4, stress: 4, hungover: 1, v: 2, date: "2026-08-18" };
    expect(progressionAttempt(ex, 100, 3, logs, { dayId: "d1", readyMap: { d1: hungover } }).protect).toBe(true);
  });
});

describe("pullback math (ported from tests/skip-day.test.js)", () => {
  it("15% off 200 at 5lb grain → 170", () => {
    expect(deloadTargetWeight(200, 5, 15)).toBe(170);
  });
  it("floors to the grain: 15% off 185 at 5lb grain → 155 (not 157.25)", () => {
    expect(deloadTargetWeight(185, 5, 15)).toBe(155);
  });
  it("goes below the written weight — the offer is sanctioned, and a floor there would deliver 0% to whoever is at the floor", () => {
    expect(deloadTargetWeight(105, 5, 15)).toBe(85);
  });
  it("never below one grain — a plate-able number, not zero", () => {
    expect(deloadTargetWeight(4, 5, 15)).toBe(5);
  });
  it("no grain given falls back to 5", () => {
    expect(deloadTargetWeight(200, 0, 15)).toBe(170);
  });
});

describe("skip-occurrence detection (ported from tests/skip-day.test.js)", () => {
  const day = { id: "d1", exercises: [{ id: "e1" }, { id: "e2" }] };
  const skipEntry = (date) => ({ date, locked: true, skipped: true, sets: [] });
  const realEntry = (date) => ({ date, locked: true, sets: [{ weight: 100, reps: 8 }] });

  it("two all-skip dates in a row → 2", () => {
    const logs = { e1: [skipEntry("2026-08-04"), skipEntry("2026-08-11")],
                   e2: [skipEntry("2026-08-04"), skipEntry("2026-08-11")] };
    expect(consecutiveDaySkips(day, logs)).toBe(2);
  });
  it("a real session between breaks the run → 1", () => {
    const logs = { e1: [skipEntry("2026-08-04"), realEntry("2026-08-07"), skipEntry("2026-08-11")],
                   e2: [skipEntry("2026-08-04"), skipEntry("2026-08-11")] };
    expect(consecutiveDaySkips(day, logs)).toBe(1);
  });
  it("a partially-logged date is a real occurrence, not a skip", () => {
    const logs = { e1: [skipEntry("2026-08-11")], e2: [realEntry("2026-08-11")] };
    expect(consecutiveDaySkips(day, logs)).toBe(0);
  });
  it("no logs at all → 0", () => {
    expect(consecutiveDaySkips(day, {})).toBe(0);
  });
  it("single skip → 1", () => {
    const logs = { e1: [skipEntry("2026-08-11")], e2: [skipEntry("2026-08-11")] };
    expect(consecutiveDaySkips(day, logs)).toBe(1);
  });

  it("a skip entry that retained typed sets is still a skip, not a session", () => {
    // ADDED at the port: the skip flag outranks the set list. An entry can
    // carry sets the athlete typed before choosing to skip; counting those as
    // a real occurrence would break the two-in-a-row detection.
    const typedThenSkipped = { date: "2026-08-11", locked: true, skipped: true,
      sets: [{ weight: 100, reps: 8 }] };
    const logs = { e1: [typedThenSkipped], e2: [skipEntry("2026-08-11")] };
    expect(consecutiveDaySkips(day, logs)).toBe(1);
  });

  it("a pending pullback governs its stamped date only, or the next session when unstamped", () => {
    const progress = { pendingDeloads: { d1: { pct: 15 } } };
    expect(dayDeloadPending(day, progress, "2026-08-18")).toEqual({ pct: 15 });
    const stamped = { pendingDeloads: { d1: { pct: 15, date: "2026-08-18" } } };
    expect(dayDeloadPending(day, stamped, "2026-08-18")).toEqual({ pct: 15, date: "2026-08-18" });
    expect(dayDeloadPending(day, stamped, "2026-08-25")).toBe(null);
    expect(dayDeloadPending(day, {}, "2026-08-18")).toBe(null);
  });
});

// ── New coverage from here down: the chain walker had no executable tests. ──

/** A program where the same lift appears once per week, ids w1e/w2e/w3e. */
function program(copies) {
  return copies.map((c, i) => ({
    id: `w${i + 1}`,
    days: [{ id: `d${i + 1}`, exercises: [c] }],
  }));
}
const bench = (id, weight, opts = {}) => ({
  id, name: "Bench Press", sets: "3", currentWeight: weight, currentReps: "8",
  modifiers: opts.modifiers || [],
  progression: { ceil: 10, inc: 5, ...opts.progression },
});
/** A full locked log at the given weight and reps, all three sets. */
const hit = (date, weight, reps, extra = {}) => ({
  date, locked: true,
  sets: [{ weight, reps }, { weight, reps }, { weight, reps }], ...extra,
});

describe("effectiveProgression: the weighted chain", () => {
  it("week one is simply the prescription", () => {
    const weeks = program([bench("a", "185"), bench("b", "185")]);
    const t = effectiveProgression(weeks, weeks[0].days[0].exercises[0], {});
    expect(t.weight).toBe(185);
    expect(t.reps).toBe(8);
    expect(t.sets).toBe(3);
  });

  it("reps climb off the WORST set, and the ceiling turns into a weight jump with reps reset", () => {
    const weeks = program([bench("a", "185"), bench("b", "185"), bench("c", "185")]);
    const logs = {
      a: [hit("2026-08-04", 185, 9)],   // worst set 9 → next target 10 (ceil)
      b: [hit("2026-08-11", 185, 10)],  // ceiling on every set → jump
    };
    const t2 = effectiveProgression(weeks, weeks[1].days[0].exercises[0], logs);
    expect(t2.weight).toBe(185);
    expect(t2.reps).toBe(10);
    const t3 = effectiveProgression(weeks, weeks[2].days[0].exercises[0], logs);
    expect(t3.weight).toBe(190);
    expect(t3.reps).toBe(8);
    expect(t3.earned).toBe(1);
    expect(t3.gained).toBe(5);
  });

  it("a miss holds everything and counts a stall; an unlogged week holds without one", () => {
    const weeks = program([bench("a", "185"), bench("b", "185"), bench("c", "185")]);
    const missed = { a: [{ date: "2026-08-04", locked: true,
      sets: [{ weight: 185, reps: 8 }, { weight: 185, reps: 5 }, { weight: 185, reps: 8 }] }] };
    const afterMiss = effectiveProgression(weeks, weeks[1].days[0].exercises[0], missed);
    expect(afterMiss.weight).toBe(185);
    expect(afterMiss.reps).toBe(8);
    expect(afterMiss.stall).toBe(1);
    const afterRest = effectiveProgression(weeks, weeks[1].days[0].exercises[0], {});
    expect(afterRest.stall).toBe(0);
  });

  it("a hand-edited written weight re-bases the whole chain", () => {
    const weeks = program([bench("a", "185"), bench("b", "185"), bench("c", "225")]);
    const logs = { a: [hit("2026-08-04", 185, 10)], b: [hit("2026-08-11", 190, 10)] };
    const t3 = effectiveProgression(weeks, weeks[2].days[0].exercises[0], logs);
    expect(t3.weight).toBe(225);
    expect(t3.reps).toBe(8);
    expect(t3.earned).toBe(0);
    expect(t3.gained).toBe(0);
  });

  it("a barbell week and a dumbbell week never chain into each other", () => {
    // Same name, different lift identity — the whole point of liftKey.
    const weeks = program([
      bench("a", "185", { modifiers: ["BB"] }),
      bench("b", "50", { modifiers: ["DB"] }),
      bench("c", "185", { modifiers: ["BB"] }),
    ]);
    const logs = { a: [hit("2026-08-04", 185, 10)] };
    const t3 = effectiveProgression(weeks, weeks[2].days[0].exercises[0], logs);
    // The BB chain sees only copies a and c: a's ceiling hit jumps to 190.
    expect(t3.weight).toBe(190);
    // And the DB copy's own chain starts fresh at its prescription.
    const tDb = effectiveProgression(weeks, weeks[1].days[0].exercises[0], logs);
    expect(tDb.weight).toBe(50);
  });

  it("the set leg spends before the weight leg", () => {
    const weeks = program([
      bench("a", "185", { progression: { sets: 1 } }),
      bench("b", "185", { progression: { sets: 1 } }),
      bench("c", "185", { progression: { sets: 1 } }),
    ]);
    const logs = {
      a: [hit("2026-08-04", 185, 10)], // ceiling → add a set, reps reset
      b: [{ date: "2026-08-11", locked: true,
        sets: [10, 10, 10, 10].map((r) => ({ weight: 185, reps: r })) }], // 4 sets at ceiling → now the weight moves
    };
    const t2 = effectiveProgression(weeks, weeks[1].days[0].exercises[0], logs);
    expect(t2.weight).toBe(185);
    expect(t2.extra).toBe(1);
    expect(t2.sets).toBe(4);
    expect(t2.reps).toBe(8);
    const t3 = effectiveProgression(weeks, weeks[2].days[0].exercises[0], logs);
    expect(t3.weight).toBe(190);
    expect(t3.extra).toBe(0);
    expect(t3.sets).toBe(3);
  });

  it("two stalls with a backoff hand weight back, floored to the grain, never below the written base", () => {
    const mk = (id) => bench(id, "185", { progression: { backoff: 10, stallAfter: 2 } });
    const weeks = program([mk("a"), mk("b"), mk("c"), mk("d")]);
    const logs = {
      a: [hit("2026-08-04", 185, 10)],  // → 190
      b: [hit("2026-08-11", 185, 3)],   // under-target reps at 190's chain… weight 185 < 190 → miss (stall 1)
      c: [hit("2026-08-18", 185, 3)],   // second miss → backoff fires
    };
    const t4 = effectiveProgression(weeks, weeks[3].days[0].exercises[0], logs);
    // 10% off 190 = 171, floored to the 5 lb grain = 170; base 185 is the floor → 185.
    expect(t4.weight).toBe(185);
    expect(t4.justDeloaded).toBe(true);
    expect(t4.deloads).toBe(1);
    expect(t4.stall).toBe(0);
    // `gained` is what actually stands above the written weight — zero after
    // the backoff handed the jump back — while `earned` still counts the jump.
    expect(t4.gained).toBe(0);
    expect(t4.earned).toBe(1);
  });

  // Pre-cutover dates: this pins the GRANDFATHERED behaviour. The rule for
  // sessions logged from PROG_RIR_V2_FROM on is two-easy-in-a-row — see the
  // "RIR: two in a row to accelerate" describe at the foot of this file.
  it("a hit with plenty in reserve climbs two rungs on a legacy log, still capped at the ceiling", () => {
    const weeks = program([bench("a", "185"), bench("b", "185")]);
    const logs = { a: [hit("2026-08-04", 185, 8, { rir: 4 })] };
    const t2 = effectiveProgression(weeks, weeks[1].days[0].exercises[0], logs);
    expect(t2.reps).toBe(10); // 8 + 2
    // Worst set 9 with the boost would be 11 — the ceiling clamps it.
    const capped = effectiveProgression(weeks, weeks[1].days[0].exercises[0],
      { a: [hit("2026-08-04", 185, 9, { rir: 4 })] });
    expect(capped.reps).toBe(10);
  });

  it("a miss on a beat-up day holds without a stall — readiness is a brake in the CHAIN, not just a flag", () => {
    const weeks = program([bench("a", "185"), bench("b", "185")]);
    const missAt = (date) => ({ a: [{ date, locked: true,
      sets: [{ weight: 185, reps: 8 }, { weight: 185, reps: 4 }, { weight: 185, reps: 8 }] }] });
    const beat = { sleep: 1, sore: 1, stress: 1, v: 2, date: "2026-08-04" };
    const readyMap = { d1: beat }; // a's day id is d1
    const protectedT = effectiveProgression(weeks, weeks[1].days[0].exercises[0], missAt("2026-08-04"), readyMap);
    expect(protectedT.stall).toBe(0);
    const unprotectedT = effectiveProgression(weeks, weeks[1].days[0].exercises[0], missAt("2026-08-05"), readyMap);
    expect(unprotectedT.stall).toBe(1);
  });

  it("fewer sets logged than prescribed is not an attempt — they didn't finish, they didn't fail", () => {
    const weeks = program([bench("a", "185"), bench("b", "185")]);
    const short = { a: [{ date: "2026-08-04", locked: true,
      sets: [{ weight: 185, reps: 10 }, { weight: 185, reps: 10 }] }] }; // 2 of 3
    const t2 = effectiveProgression(weeks, weeks[1].days[0].exercises[0], short);
    // Judged as an attempt, two ceiling sets would JUMP the weight — the
    // whole point of the guard is that an unfinished session moves nothing.
    expect(t2.weight).toBe(185);
    expect(t2.reps).toBe(8);
    expect(t2.stall).toBe(0);
  });
});

describe("effectiveProgression: the bodyweight ladder", () => {
  const pullup = (id, opts = {}) => ({
    id, name: "Pull-Up", sets: "3", currentWeight: "BW", currentReps: "8",
    modifiers: [], progression: { ceil: 10, ...opts },
  });

  it("reps climb and hold at the cap when there is nothing to graduate to", () => {
    const weeks = program([pullup("a"), pullup("b"), pullup("c")]);
    const logs = {
      a: [hit("2026-08-04", "", 9)],
      b: [hit("2026-08-11", "", 10)], // at the cap, no inc → holds
    };
    const t2 = effectiveProgression(weeks, weeks[1].days[0].exercises[0], logs);
    expect(t2.weight).toBe(null);
    expect(t2.reps).toBe(10);
    const t3 = effectiveProgression(weeks, weeks[2].days[0].exercises[0], logs);
    expect(t3.reps).toBe(10);
    expect(t3.atCap).toBe(true);
  });

  it("with an increment and a real cap it GRADUATES: load appears while the written weight stays BW", () => {
    const weeks = program([
      pullup("a", { inc: 5 }), pullup("b", { inc: 5 }), pullup("c", { inc: 5 }),
    ]);
    const logs = {
      a: [hit("2026-08-04", "", 10)], // cap on every set → +5 lb, reps reset
    };
    const t2 = effectiveProgression(weeks, weeks[1].days[0].exercises[0], logs);
    expect(t2.weight).toBe(5);
    expect(t2.reps).toBe(8);
    expect(t2.bw).toBe(false); // the card now shows a real weight
    // The program data itself was never touched.
    expect(weeks[1].days[0].exercises[0].currentWeight).toBe("BW");
  });
});

describe("progressionRule edges", () => {
  it("no rule without a ceiling above the floor, or a weighted base without an increment", () => {
    expect(progressionRule({ currentReps: "8", currentWeight: "185" })).toBe(null);
    expect(progressionRule({ currentReps: "8", currentWeight: "185", progression: { ceil: 8 } })).toBe(null);
    expect(progressionRule({ currentReps: "8", currentWeight: "185", progression: { ceil: 10 } })).toBe(null);
  });

  it("a band-only lift gets the reps-only ladder — the band is the load", () => {
    const r = progressionRule({ currentReps: "8", currentWeight: "", modifiers: ["Green"], progression: { ceil: 12 } });
    expect(r).not.toBe(null);
    expect(r.band).toBe(true);
    expect(r.repsOnly).toBe(true);
    // Without a band it stays what it always was: no progression at all.
    expect(progressionRule({ currentReps: "8", currentWeight: "", modifiers: [], progression: { ceil: 12 } })).toBe(null);
  });

  it("clamps the set leg to the engine's maximum", () => {
    const r = progressionRule({ currentReps: "8", currentWeight: "185",
      progression: { ceil: 10, inc: 5, sets: 5 } });
    expect(r.addSets).toBe(2);
  });

  it("the infinite bodyweight cap never graduates", () => {
    const r = progressionRule({ currentReps: "8", currentWeight: "BW", progression: { ceil: PROG_NO_CAP, inc: 5 } });
    expect(r.graduate).toBeUndefined();
    expect(r.inc).toBe(0);
  });
});

// ── RIR autoregulation, reworked 2026-08-19 (Nathan: "the rep target and the
//    weight shouldn't both climb just because of one good day of RIR", then
//    "we need a better system"). Three rules replace the single-session
//    doubling: acceleration needs TWO easy sessions in a row and pays out in
//    REPS only, the weight leg moves one increment forever, and a session
//    ground out at RIR 0 HOLDS the ladder instead of climbing it — the brake
//    the old system never had. Sessions logged before PROG_RIR_V2_FROM keep
//    the old behaviour so nobody's live numbers move overnight. ─────────────
describe("RIR: two in a row to accelerate, and a grind is a brake", () => {
  const wide = (id) => bench(id, "185", { progression: { ceil: 14 } });
  const OLD = "2026-08-04";  // before the cutover
  const D1 = "2026-08-20";   // on it
  const D2 = "2026-08-21";
  const D3 = "2026-08-22";
  const reps = (weeks, i, logs) => effectiveProgression(weeks, weeks[i].days[0].exercises[0], logs);

  it("ONE easy session no longer doubles the step — it takes a single rung", () => {
    const weeks = program([wide("a"), wide("b")]);
    const t = reps(weeks, 1, { a: [hit(D1, 185, 8, { rir: 4 })] });
    expect(t.reps, "one easy day must be worth one rung, not two").toBe(9);
  });

  it("TWO easy sessions in a row earn the extra rung, and spend the run doing it", () => {
    const weeks = program([wide("a"), wide("b"), wide("c"), wide("d")]);
    const logs = {
      a: [hit(D1, 185, 8, { rir: 4 })],   // easyRun 1 → 9
      b: [hit(D2, 185, 9, { rir: 4 })],   // easyRun 2 → extra rung → 11, run spent
      c: [hit(D3, 185, 11, { rir: 4 })],  // easyRun 1 again → 12
    };
    expect(reps(weeks, 2, logs).reps, "second easy session pays the extra rung").toBe(11);
    expect(reps(weeks, 3, logs).reps, "the run resets when it pays out").toBe(12);
  });

  it("a normal session between two easy ones breaks the run", () => {
    const weeks = program([wide("a"), wide("b"), wide("c")]);
    const logs = {
      a: [hit(D1, 185, 8, { rir: 4 })],   // easyRun 1 → 9
      b: [hit(D2, 185, 9, { rir: 2 })],   // at target → run cleared → 10
    };
    expect(reps(weeks, 2, logs).reps).toBe(10);
  });

  it("the WEIGHT leg never doubles, even standing on a banked easy run", () => {
    const tight = (id) => bench(id, "185", { progression: { ceil: 9 } });
    const weeks = program([tight("a"), tight("b"), tight("c")]);
    const logs = {
      a: [hit(D1, 185, 8, { rir: 4 })],  // easyRun 1 → reps 9 (the ceiling)
      b: [hit(D2, 185, 9, { rir: 4 })],  // at the ceiling with a run banked → jump
    };
    const t = reps(weeks, 2, logs);
    expect(t.weight, "one increment, not two").toBe(190);
    expect(t.earned).toBe(1);
    expect(t.gained).toBe(5);
  });

  it("a session ground out at RIR 0 HOLDS the ladder even though the reps were there", () => {
    const weeks = program([wide("a"), wide("b")]);
    const t = reps(weeks, 1, { a: [hit(D1, 185, 8, { rir: 0 })] });
    expect(t.reps, "they hit it, but not the way it was asked for").toBe(8);
    expect(t.stall, "a hold is not a stall — nothing failed").toBe(0);
  });

  it("…and a grind on a MISS counts one stall, not two", () => {
    const weeks = program([wide("a"), wide("b")]);
    const missed = { a: [{ date: D1, locked: true, rir: 0,
      sets: [{ weight: 185, reps: 8 }, { weight: 185, reps: 4 }, { weight: 185, reps: 8 }] }] };
    expect(reps(weeks, 1, missed).stall).toBe(1);
  });

  it("plenty left on a MISS still shields it from the stall count", () => {
    const weeks = program([wide("a"), wide("b")]);
    const missed = { a: [{ date: D1, locked: true, rir: 4,
      sets: [{ weight: 185, reps: 8 }, { weight: 185, reps: 4 }, { weight: 185, reps: 8 }] }] };
    const t = reps(weeks, 1, missed);
    expect(t.stall).toBe(0);
    expect(t.reps).toBe(8);
  });

  it("no RIR tagged at all is untouched: one rung, no brake", () => {
    const weeks = program([wide("a"), wide("b")]);
    expect(reps(weeks, 1, { a: [hit(D1, 185, 8)] }).reps).toBe(9);
  });

  it("the target is what RIR is measured against, not a fixed 4", () => {
    // targetRir 4 means 4-left IS the ask — so it earns nothing, and the
    // athlete has to leave 6 to read as easy.
    const t4 = (id) => bench(id, "185", { progression: { ceil: 14, targetRir: 4 } });
    const weeks = program([t4("a"), t4("b"), t4("c")]);
    const atTarget = { a: [hit(D1, 185, 8, { rir: 4 })], b: [hit(D2, 185, 9, { rir: 4 })] };
    expect(reps(weeks, 2, atTarget).reps, "two at-target sessions are two single rungs").toBe(10);
    // And RIR 2 against a target of 4 is a grind: two under.
    expect(reps(weeks, 1, { a: [hit(D1, 185, 8, { rir: 2 })] }).reps).toBe(8);
  });

  it("sessions logged BEFORE the cutover keep the old single-session double", () => {
    const weeks = program([wide("a"), wide("b")]);
    expect(reps(weeks, 1, { a: [hit(OLD, 185, 8, { rir: 4 })] }).reps,
      "grandfathered: nobody's live numbers move overnight").toBe(10);
    // …and the old rules have no brake, so a grind still climbs.
    expect(reps(weeks, 1, { a: [hit(OLD, 185, 8, { rir: 0 })] }).reps).toBe(9);
  });
});
