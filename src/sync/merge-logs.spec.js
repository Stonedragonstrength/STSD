// mergeExerciseLogs — the Stage-1 client edition of the sync design's merge
// rule for the one catastrophic-loss family (see
// docs/superpowers/specs/2026-08-11-cloud-authoritative-sync-design.md).
//
// The invariant: a pull can never erase work. A cloud copy that hasn't seen a
// local entry must not delete it; a local copy that predates a cloud entry
// must not delete that either. Same entry id on both sides → higher `m`
// (entry-modified ms) wins, and a tie goes to LOCAL — the device in hand is
// the one being edited. Old entries carry no `m` (absent = 0), so any stamped
// rewrite beats an unstamped original.
//
// Ported verbatim from tests/merge-exercise-logs.test.js when the function
// moved out of the IIFE — tier 1 now: a real import of the shipped file.
import { describe, it } from "vitest";
import assert from "node:assert";
import "./merge-logs.js";

const { mergeExerciseLogs } = globalThis.STSD.sync;

const entry = (id, date, m, tag) => ({ id, date, m, sets: [{ weight: tag, reps: 5 }], locked: true });

describe("mergeExerciseLogs", () => {
  it("union: local-only and cloud-only entries both survive", () => {
    const local = { ex1: [entry("a", "2026-08-11", 100, "local-a")] };
    const cloud = { ex1: [entry("b", "2026-08-10", 90, "cloud-b")] };
    const out = mergeExerciseLogs(local, cloud);
    assert.strictEqual(out.ex1.length, 2);
    const ids = out.ex1.map((e) => e.id).sort();
    assert.deepStrictEqual(ids, ["a", "b"]);
  });

  it("a pull cannot erase local work the cloud hasn't seen", () => {
    // Cloud has NOTHING for ex1 (the stale-copy scenario that used to clobber).
    const local = { ex1: [entry("a", "2026-08-11", 100, "todays-fill")] };
    const out = mergeExerciseLogs(local, {});
    assert.strictEqual(out.ex1.length, 1);
    assert.strictEqual(out.ex1[0].sets[0].weight, "todays-fill");
  });

  it("a stale local copy cannot erase newer cloud work", () => {
    const cloud = { ex1: [entry("a", "2026-08-11", 100, "other-device")] };
    const out = mergeExerciseLogs({}, cloud);
    assert.strictEqual(out.ex1.length, 1);
    assert.strictEqual(out.ex1[0].sets[0].weight, "other-device");
  });

  it("same id: higher m wins regardless of which side holds it", () => {
    const newer = entry("a", "2026-08-11", 200, "newer");
    const older = entry("a", "2026-08-11", 100, "older");
    assert.strictEqual(mergeExerciseLogs({ ex1: [older] }, { ex1: [newer] }).ex1[0].sets[0].weight, "newer");
    assert.strictEqual(mergeExerciseLogs({ ex1: [newer] }, { ex1: [older] }).ex1[0].sets[0].weight, "newer");
  });

  it("tie (equal m, and the both-unstamped case) goes to local", () => {
    const l = entry("a", "2026-08-11", 100, "local");
    const c = entry("a", "2026-08-11", 100, "cloud");
    assert.strictEqual(mergeExerciseLogs({ ex1: [l] }, { ex1: [c] }).ex1[0].sets[0].weight, "local");
    const lu = { id: "a", date: "2026-08-11", sets: [{ weight: "local-unstamped", reps: 5 }] };
    const cu = { id: "a", date: "2026-08-11", sets: [{ weight: "cloud-unstamped", reps: 5 }] };
    assert.strictEqual(mergeExerciseLogs({ ex1: [lu] }, { ex1: [cu] }).ex1[0].sets[0].weight, "local-unstamped");
  });

  it("a stamped rewrite beats an unstamped original", () => {
    const stamped = entry("a", "2026-08-11", 1, "stamped");
    const unstamped = { id: "a", date: "2026-08-11", sets: [{ weight: "unstamped", reps: 5 }] };
    assert.strictEqual(mergeExerciseLogs({ ex1: [unstamped] }, { ex1: [stamped] }).ex1[0].sets[0].weight, "stamped");
  });

  it("entries without ids key by date and still merge", () => {
    const l = { date: "2026-08-11", m: 5, sets: [{ weight: "l", reps: 5 }] };
    const c = { date: "2026-08-10", m: 9, sets: [{ weight: "c", reps: 5 }] };
    const out = mergeExerciseLogs({ ex1: [l] }, { ex1: [c] });
    assert.strictEqual(out.ex1.length, 2, "different dates = different entries");
  });

  it("exercises present on only one side survive whole", () => {
    const out = mergeExerciseLogs({ ex1: [entry("a", "2026-08-11", 1, "l")] },
                                  { ex2: [entry("b", "2026-08-10", 1, "c")] });
    assert.ok(out.ex1 && out.ex2, "both exercise keys present");
  });

  it("null/undefined inputs are safe", () => {
    assert.deepStrictEqual(mergeExerciseLogs(null, null), {});
    assert.deepStrictEqual(mergeExerciseLogs(undefined, { ex1: [] }).ex1, []);
  });
});
