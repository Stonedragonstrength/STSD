// The row mappers, tested as pairs — written new when they moved out of
// cloud.js (tier 1: a real import of the shipped file; nothing covered them
// before beyond regex checks in the plumbing tests, which still run).
//
// Why pairs: athleteToRow/rowToAthlete and progressToRow/rowToProgress are
// each other's whole contract. A field one side writes and the other never
// reads does not error — it comes back as the default on the next pull and
// reads as "the athlete cleared this", which is this codebase's house
// failure. So each pair is pinned twice:
//   by VALUE — a lived-in record survives its round trip field by field, and
//   by SOURCE — the column list one side writes equals the list the other
//     reads (minus the known one-way fields), so adding a column to one side
//     only fails by name before it ships.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./rows.js";

const { athleteToRow, rowToAthlete, progressToRow, rowToProgress } = globalThis.STSD.sync;

const rowsSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "rows.js"), "utf8");

/** A lived-in coach-side athlete record — realistic, not minimal. */
const athlete = () => ({
  id: "ath1",
  name: "Rhea Stone",
  inviteCode: "ABCD-EFGH",
  age: "34",
  birthday: "1992-03-14",
  referralCode: "RHEA-22",
  referredBy: "ath9",
  heightIn: "70",
  weightLb: "185",
  units: "kg",
  goals: "500 lb deadlift",
  notes: "knee tracks in on volume days",
  trainingLevel: "intermediate",
  trainingPhase: "strength",
  equipment: ["barbell", "bands"],
  daysPerWeek: 4,
  painRelief: true,
  weeks: [{ id: "w1", days: [{ id: "d1", exercises: [] }] }],
  schedule: { mon: "w1" },
  coachPRs: [{ id: "pr1", lift: "Deadlift", weight: 405 }],
  sessionBank: { packages: [{ id: "p1", sessions: 10 }], redemptions: [{ id: "r1" }] },
  oneOffDays: [{ id: "o1", date: "2026-08-20" }],
  trials: [{ id: "t1", name: "Front squat" }],
  setmoreAliases: ["Rhea S"],
  nutrition: { current: { kcal: 2400, protein: 170 }, history: [] },
  hideOpenSlots: true,
  canBook: true,
  partnerId: "ath2",
});

/** A lived-in progress object, every synced field populated. */
const progress = () => ({
  exerciseLogs: { exdead: [{ date: "2026-08-10", sets: [{ w: 405, r: 3, locked: true }] }] },
  bodyweightLog: [{ date: "2026-08-01", weight: 185 }],
  dayCompletions: { d1: ["2026-08-04"] },
  personalRecords: [{ lift: "Deadlift", weight: 405 }],
  packageRequests: [{ id: "pk1", sessions: 10 }],
  cardioLogs: [{ date: "2026-08-10", type: "Run", minutes: 30 }],
  feedback: "Felt strong",
  dismissedBulletins: { b1: true },
  seenMessages: { m1: 1723500000000 },
  totalWorkoutMs: 3600000,
  workoutMoods: { "2026-08-10": 4 },
  readiness: { "2026-08-10": { v: 2, sleep: 3 } },
  addedExercises: { d1: [{ id: "exrow", name: "Row" }] },
  athleteDays: [{ id: "ad1", name: "Extra push" }],
  formChecks: { fc1: { url: "clip.mp4" } },
  swaps: { exrow: "exlatpull" },
  nutritionTargets: { calories: 3200 },
  foodLog: { "2026-08-10": [{ name: "Oats", grams: 100 }] },
  customFoods: [{ name: "Mass shake", kcal: 900 }],
  savedMeals: [{ name: "Breakfast", items: [] }],
  waterLog: { "2026-08-10": 96 },
  nutritionGame: { xp: 420, streak: 6 },
  hoard: { gems: 12 },
  avatarId: "dragon-3",
  dayNotes: { d1: "hip tight" },
  pendingDeloads: { exsquat: true },
  statField: { "2026-08-10": { STR: 2 } },
  overviewTiles: ["ring", "hoard", "toppr"],
});

/** Column names one of the module's functions writes (6-space object keys). */
function writes(decl) {
  const at = rowsSrc.indexOf(decl);
  const block = rowsSrc.slice(at, rowsSrc.indexOf("\n  }", at));
  return new Set([...block.matchAll(/^\s{6}([a-z0-9_]+):/gm)].map((m) => m[1]));
}
/** Column names one of the module's functions reads off its row `r`. */
function reads(decl) {
  const at = rowsSrc.indexOf(decl);
  const block = rowsSrc.slice(at, rowsSrc.indexOf("\n  }", at));
  return new Set([...block.matchAll(/\br\.([a-z0-9_]+)\b/g)].map((m) => m[1]));
}
const minus = (set, drop) => [...set].filter((k) => !drop.includes(k)).sort();

describe("athleteToRow / rowToAthlete", () => {
  it("refuses a record it cannot key", () => {
    // A row without its id, invite code or coach would upsert a half-athlete
    // over a whole one. Null means the caller skips the push entirely.
    expect(athleteToRow({ ...athlete(), id: "" }, "coach1")).toBe(null);
    expect(athleteToRow({ ...athlete(), inviteCode: "" }, "coach1")).toBe(null);
    expect(athleteToRow(athlete(), "")).toBe(null);
    expect(athleteToRow(null, "coach1")).toBe(null);
    expect(athleteToRow(athlete(), "coach1")).not.toBe(null);
  });

  it("a lived-in athlete survives the round trip field by field", () => {
    const src = athlete();
    const back = rowToAthlete(athleteToRow(src, "coach1"));
    for (const key of Object.keys(src)) {
      expect(back[key], key).toEqual(src[key]);
    }
    expect(back._coachId).toBe("coach1");
    expect(back.createdAt).toBeGreaterThan(0);
  });

  it("the athletes row never carries progress — importedProgress is synthesized null", () => {
    // The premise mergedRosterProgress exists for: a pulled athletes-table row
    // knows nothing about progress, and pretending otherwise is how the
    // roster wiped itself every resync.
    const src = { ...athlete(), importedProgress: { exerciseLogs: { a: [] } } };
    expect(rowToAthlete(athleteToRow(src, "coach1")).importedProgress).toBe(null);
  });

  it("carries the server revision one way only", () => {
    // rev is minted by a DB trigger; the client carries it to compare, never
    // to send back.
    expect(rowToAthlete({ id: "a", rev: "9" })._rev).toBe(9);
    expect(rowToAthlete({ id: "a" })._rev).toBe(0);
    const row = athleteToRow({ ...athlete(), _rev: 9 }, "coach1");
    expect(row.rev).toBeUndefined();
    expect(row._rev).toBeUndefined();
  });

  it("normalises units to exactly lb or kg in both directions", () => {
    expect(athleteToRow({ ...athlete(), units: "stone" }, "coach1").units).toBe("lb");
    expect(rowToAthlete({ id: "a", units: "stone" }).units).toBe("lb");
    expect(rowToAthlete({ id: "a", units: "kg" }).units).toBe("kg");
  });

  it("sends [] rather than null for equipment, and defaults the collections coming back", () => {
    const bare = { id: "a", inviteCode: "XXXX-YYYY", name: "" };
    expect(athleteToRow(bare, "coach1").equipment).toEqual([]);
    const back = rowToAthlete({ id: "a" });
    expect(back.weeks).toEqual([]);
    expect(back.equipment).toEqual([]);
    expect(back.schedule).toEqual({});
    expect(back.sessionBank).toEqual({ packages: [], redemptions: [] });
    expect(back.nutrition).toEqual({ current: null, history: [] });
    expect(rowToAthlete(null)).toBe(null);
  });

  it("stamps a parseable updated_at", () => {
    expect(Number.isNaN(Date.parse(athleteToRow(athlete(), "coach1").updated_at))).toBe(false);
  });

  it("source parity: every column pushed is read back, and vice versa", () => {
    // updated_at is write-only (the DB's copy is the record); rev and
    // created_at are read-only (minted server-side).
    expect(minus(writes("function athleteToRow("), ["updated_at"]))
      .toEqual(minus(reads("function rowToAthlete("), ["rev", "created_at"]));
  });
});

describe("progressToRow / rowToProgress", () => {
  it("a lived-in progress survives the round trip field by field", () => {
    const src = progress();
    const back = rowToProgress(progressToRow(src, "ath1"));
    for (const key of Object.keys(src)) {
      expect(back[key], key).toEqual(src[key]);
    }
    expect(back._rev).toBe(0);
  });

  it("keys the row by the athlete it was asked to, and stamps a parseable synced_at", () => {
    const row = progressToRow(progress(), "ath1");
    expect(row.athlete_id).toBe("ath1");
    expect(Number.isNaN(Date.parse(row.synced_at))).toBe(false);
  });

  it("rounds the workout clock to whole milliseconds and re-types it on the way back", () => {
    expect(progressToRow({ totalWorkoutMs: 3599999.6 }, "a").total_workout_ms).toBe(3600000);
    // A numeric column can still arrive as a string through PostgREST; the
    // reader owns the coercion.
    expect(rowToProgress({ total_workout_ms: "5000" }).totalWorkoutMs).toBe(5000);
    expect(rowToProgress({}).totalWorkoutMs).toBe(0);
  });

  it("an empty avatar round-trips clean through the null column", () => {
    expect(progressToRow({ avatarId: "" }, "a").avatar_id).toBe(null);
    expect(rowToProgress({ avatar_id: null }).avatarId).toBe("");
  });

  it("no row means null, not an empty progress", () => {
    // The caller distinguishes "never synced" from "synced nothing";
    // mergedRosterProgress keeps local on null.
    expect(rowToProgress(null)).toBe(null);
    expect(rowToProgress(undefined)).toBe(null);
  });

  it("source parity: every column pushed is read back, and vice versa", () => {
    // athlete_id is the key, not data; synced_at is read verbatim (it appears
    // on both sides); rev is read-only, minted server-side.
    expect(minus(writes("function progressToRow("), ["athlete_id"]))
      .toEqual(minus(reads("function rowToProgress("), ["rev"]));
  });
});
