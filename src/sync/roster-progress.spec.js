// mergedRosterProgress — what the coach's roster knows about each athlete.
// Ported when it moved out of the IIFE (tier 1 now: a real import of the
// shipped file). Assertions carried verbatim from tests/roster-progress.test.js,
// whose header story is kept below.
//
// The bug this pins: the athletes-table row never carries progress
// (rowToAthlete stamps importedProgress: null), and populateCoachFromCloud
// adopted those rows wholesale for every clean athlete. So each boot or
// 20-second resync WIPED every athlete's locally-held progress, and the
// roster fell back to "No sync" — no percentages, no avatars, no mood chips —
// until each athlete was opened one by one (the only per-athlete pull).
// On the phone, where every open is a fresh boot, the roster read "No sync"
// essentially always, with 22 athletes' progress sitting right there in the
// cloud.
//
// The fix: the coach load bulk-fetches every athlete's progress row (66 kB
// across 22 athletes, measured in production 2026-08-13), and this helper
// decides what each card keeps. Cloud row present → adopt it, but union
// exercise logs through mergeExerciseLogs so a pull can never erase local
// work, and never while an unconfirmed coach write owns the local copy
// (_coachProgressDirtyAt). Cloud row absent (offline, RLS hiccup) → KEEP the
// local copy — identity-return, so callers can tell "unchanged" — instead of
// wiping it.
import { describe, it } from "vitest";
import assert from "node:assert";
import "./merge-logs.js";
import "./roster-progress.js";

const { mergedRosterProgress } = globalThis.STSD.sync;

const entry = (id, m, tag) => ({ id, date: "2026-08-13", m, sets: [{ weight: tag, reps: 5 }] });

describe("roster progress", () => {
  it("cloud row present: adopted, with completions visible and syncedAt stamped", () => {
    const cloud = { dayCompletions: { d1: ["2026-08-10"] }, exerciseLogs: {}, personalRecords: [] };
    const out = mergedRosterProgress(null, cloud, false);
    assert.deepStrictEqual(out.dayCompletions, { d1: ["2026-08-10"] });
    assert.ok(out.syncedAt > 0, "syncedAt stamped");
  });

  it("local-only exercise logs survive the adopt — a pull can never erase work", () => {
    const local = { dayCompletions: {}, exerciseLogs: { ex1: [entry("a", 100, "local")] } };
    const cloud = { dayCompletions: { d1: ["2026-08-10"] }, exerciseLogs: { ex1: [entry("b", 90, "cloud")] } };
    const out = mergedRosterProgress(local, cloud, false);
    const ids = out.exerciseLogs.ex1.map((e) => e.id).sort();
    assert.deepStrictEqual(ids, ["a", "b"], "both sides' entries present");
    assert.deepStrictEqual(out.dayCompletions, { d1: ["2026-08-10"] }, "rest adopts the cloud row");
  });

  it("unconfirmed coach write owns the local copy: dirty keeps local, identity-returned", () => {
    const local = { dayCompletions: { d9: ["2026-08-12"] }, exerciseLogs: {} };
    const cloud = { dayCompletions: {}, exerciseLogs: {} };
    const out = mergedRosterProgress(local, cloud, true);
    assert.strictEqual(out, local, "same object back — caller sees 'unchanged'");
  });

  it("no cloud row (offline / fetch failed): local kept, not wiped — the roster bug", () => {
    const local = { dayCompletions: { d1: ["2026-08-10"] }, exerciseLogs: {} };
    const out = mergedRosterProgress(local, undefined, false);
    assert.strictEqual(out, local, "identity — the local copy survives the refresh");
  });

  it("neither side has anything: null, which renders as the honest 'No sync'", () => {
    assert.strictEqual(mergedRosterProgress(null, undefined, false), null);
    assert.strictEqual(mergedRosterProgress(undefined, null, true), null);
  });
});
