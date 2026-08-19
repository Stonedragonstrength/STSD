// ⇢ Move: relocate exercises between days with everything attached.
//
// The commit is moveExercisesToDay(fromDay, toDay, ids) — extracted real from
// app.js via load-fn, not re-coded here. The rules it pins:
//
//   * A move keeps the SAME exercise object and id. Logs key on ex.id, so a
//     move must not orphan history the way Pull's fresh-id copy deliberately
//     does. Tags, modifiers, per-set weights ride along by construction.
//   * Supersets mirror Pull's rule: a run whose members move together gets a
//     freshly minted shared link id (never carried — it would collide with a
//     run already in the destination); a member moving alone arrives unlinked.
//   * The source day keeps its remaining order; movers append to the
//     destination in source order.
import { describe, it, expect } from "vitest";
import { loadFns } from "./helpers/load-fn.js";

function load() {
  let n = 0;
  return loadFns("function moveExercisesToDay(", { uid: () => `fresh-${++n}` });
}

const ex = (id, extra = {}) => ({
  id, name: `Lift ${id}`, sets: 3, currentWeight: 135, currentReps: 8,
  modifiers: ["tempo"], notes: `note ${id}`, ...extra,
});

describe("moveExercisesToDay", () => {
  it("relocates the same object — id, tags, numbers intact — and reports the count", () => {
    const { moveExercisesToDay } = load();
    const a = ex("a"), b = ex("b"), c = ex("c");
    const from = { id: "d1", exercises: [a, b, c] };
    const to = { id: "d2", exercises: [] };

    const n = moveExercisesToDay(from, to, ["b"]);

    expect(n).toBe(1);
    expect(from.exercises.map((e) => e.id)).toEqual(["a", "c"]);
    expect(to.exercises[0]).toBe(b); // same object, not a clone
    expect(to.exercises[0].modifiers).toEqual(["tempo"]);
    expect(to.exercises[0].notes).toBe("note b");
  });

  it("appends movers to the destination in source order", () => {
    const { moveExercisesToDay } = load();
    const from = { id: "d1", exercises: [ex("a"), ex("b"), ex("c")] };
    const to = { id: "d2", exercises: [ex("z")] };

    moveExercisesToDay(from, to, ["c", "a"]);

    expect(to.exercises.map((e) => e.id)).toEqual(["z", "a", "c"]);
  });

  it("a superset member moving alone arrives unlinked", () => {
    const { moveExercisesToDay } = load();
    const from = { id: "d1", exercises: [ex("a", { supersetId: "run1" }), ex("b", { supersetId: "run1" })] };
    const to = { id: "d2", exercises: [] };

    moveExercisesToDay(from, to, ["a"]);

    expect(to.exercises[0].supersetId).toBeUndefined();
    expect(from.exercises[0].supersetId).toBe("run1"); // leftover untouched
  });

  it("a run moving together keeps its link under a freshly minted id", () => {
    const { moveExercisesToDay } = load();
    const from = { id: "d1", exercises: [ex("a", { supersetId: "run1" }), ex("b", { supersetId: "run1" }), ex("c", { supersetId: "run2" })] };
    const to = { id: "d2", exercises: [] };

    moveExercisesToDay(from, to, ["a", "b", "c"]);

    const [ma, mb, mc] = to.exercises;
    expect(ma.supersetId).toBeDefined();
    expect(ma.supersetId).toBe(mb.supersetId); // still one run
    expect(ma.supersetId).not.toBe("run1");    // never the carried id
    expect(mc.supersetId).toBeUndefined();     // run2 came alone
  });

  it("tolerates a destination day with no exercises array yet", () => {
    const { moveExercisesToDay } = load();
    const from = { id: "d1", exercises: [ex("a")] };
    const to = { id: "d2" };

    moveExercisesToDay(from, to, ["a"]);

    expect(to.exercises.map((e) => e.id)).toEqual(["a"]);
  });

  it("unknown ids move nothing and touch nothing", () => {
    const { moveExercisesToDay } = load();
    const from = { id: "d1", exercises: [ex("a")] };
    const to = { id: "d2", exercises: [] };

    expect(moveExercisesToDay(from, to, ["nope"])).toBe(0);
    expect(from.exercises.length).toBe(1);
    expect(to.exercises.length).toBe(0);
  });
});
