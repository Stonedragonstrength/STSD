// mergeById must not throw away filled-in programming on a timestamp's say-so.
//
// The incident (2026-08-17): a program template was built Day 2 first, then
// Day 1. A snapshot from between those two states — Day 1's lifts added but not
// yet given weights, Day 2 finished — won a merge and became the truth. Seven
// exercises' weights, reps and progression rules disappeared, silently, and the
// coach only found out by opening the program.
//
// The timestamps cannot arbitrate this. `updatedAt` is stamped in exactly ONE
// place (saveTrainer, and only while the program editor is open), so a template
// can be edited without its stamp moving and an older snapshot can out-rank a
// newer copy. Content can arbitrate it: adding the lifts is a minute's work,
// typing their numbers is an hour's, and it is the hour that keeps being lost.
import { describe, it, expect } from "vitest";
import { loadFns } from "../helpers/load-fn.js";

function merger() {
  return loadFns([
    "function filledPrescriptions(",
    "function mergeById(",
  ], {}, { expose: ["filledPrescriptions", "mergeById"] });
}

/** A template with `filled` of its `total` exercises carrying a prescription. */
const tpl = (id, { filled = 0, total = 2, updatedAt, name = id, deleted } = {}) => {
  const t = { id, name, weeks: [{ id: "w1", days: [{ id: "d1", exercises: [] }] }] };
  for (let i = 0; i < total; i++) {
    t.weeks[0].days[0].exercises.push(i < filled
      ? { id: `e${i}`, name: `Lift ${i}`, currentWeight: "225", currentReps: "5", progression: { inc: 5, ceil: 12 } }
      : { id: `e${i}`, name: `Lift ${i}`, currentWeight: "", currentReps: "" });
  }
  if (updatedAt !== undefined) t.updatedAt = updatedAt;
  if (deleted) { t.deleted = deleted; delete t.weeks; }
  return t;
};

describe("filledPrescriptions", () => {
  it("counts exercises that carry a weight, reps, or a progression rule", () => {
    const { filledPrescriptions } = merger();
    expect(filledPrescriptions(tpl("a", { filled: 0, total: 3 }))).toBe(0);
    expect(filledPrescriptions(tpl("a", { filled: 2, total: 3 }))).toBe(2);
    expect(filledPrescriptions(undefined)).toBe(0);
    expect(filledPrescriptions({ weeks: [] })).toBe(0);
  });

  it("counts a progression rule even with no weight typed yet", () => {
    const { filledPrescriptions } = merger();
    const t = { weeks: [{ days: [{ exercises: [{ currentWeight: "", currentReps: "", progression: { inc: 5 } }] }] }] };
    expect(filledPrescriptions(t)).toBe(1);
  });
});

describe("a merge keeps the fuller copy when the stamps disagree with the content", () => {
  it("keeps local work that a NEWER-stamped but emptier cloud copy would have erased", () => {
    // This is the incident, exactly: the cloud copy is stamped later, and holds
    // less. Before the guard, the stamp won and the work was gone.
    const { mergeById } = merger();
    const cloud = [tpl("p1", { filled: 0, total: 7, updatedAt: 2000 })];
    const local = [tpl("p1", { filled: 7, total: 7, updatedAt: 1000 })];
    const out = mergeById(cloud, local, { prefer: "cloud", keepLocalOnly: false });
    expect(out).toHaveLength(1);
    expect(out[0].weeks[0].days[0].exercises[0].currentWeight).toBe("225");
  });

  it("reports what it rescued, because a silent save is what made this hurt", () => {
    const { mergeById } = merger();
    const seen = [];
    mergeById(
      [tpl("p1", { filled: 1, total: 7, updatedAt: 2000, name: "Kristyn Judkins" })],
      [tpl("p1", { filled: 7, total: 7, updatedAt: 1000, name: "Kristyn Judkins" })],
      { prefer: "cloud", onRescue: (r) => seen.push(...r) },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: "p1", name: "Kristyn Judkins", kept: 7, wouldHave: 1 });
  });

  it("still takes the cloud's copy when it is genuinely fuller", () => {
    // The guard is about not LOSING work, not about local always winning.
    const { mergeById } = merger();
    const out = mergeById(
      [tpl("p1", { filled: 7, total: 7, updatedAt: 1000 })],
      [tpl("p1", { filled: 2, total: 7, updatedAt: 2000 })],
      { prefer: "local" },
    );
    expect(out[0].weeks[0].days[0].exercises[6].currentWeight).toBe("225");
  });

  it("leaves the normal timestamp rule alone when both hold the same amount", () => {
    const { mergeById } = merger();
    const newer = mergeById(
      [tpl("p1", { filled: 3, total: 7, updatedAt: 2000, name: "cloud" })],
      [tpl("p1", { filled: 3, total: 7, updatedAt: 1000, name: "local" })],
      { prefer: "local" },
    );
    expect(newer[0].name).toBe("cloud");
  });
});

describe("deletions still stick", () => {
  it("does not resurrect a tombstoned template just because it held work", () => {
    // A deleted template legitimately holds nothing. Preferring the fuller side
    // here would bring it back on every single pull — which is the entire
    // reason tombstones exist. See tests/template-tombstones.test.js.
    const { mergeById } = merger();
    const cloud = [tpl("p1", { deleted: 1700000000000, updatedAt: 2000 })];
    const local = [tpl("p1", { filled: 7, total: 7, updatedAt: 1000 })];
    const out = mergeById(cloud, local, { prefer: "cloud", keepLocalOnly: false });
    expect(out[0].deleted).toBeTruthy();
    expect(out[0].weeks).toBeUndefined();
  });

  it("does not rescue when the LOCAL side is the tombstone either", () => {
    const { mergeById } = merger();
    const out = mergeById(
      [tpl("p1", { filled: 7, total: 7, updatedAt: 1000 })],
      [tpl("p1", { deleted: 1700000000000, updatedAt: 2000 })],
      { prefer: "cloud" },
    );
    expect(out[0].deleted).toBeTruthy();
  });
});

describe("the parts that were already right stay right", () => {
  it("brings across templates that only exist in the cloud", () => {
    const { mergeById } = merger();
    const out = mergeById([tpl("p1"), tpl("p2")], [tpl("p1")], { prefer: "cloud" });
    expect(out.map((t) => t.id)).toEqual(["p1", "p2"]);
  });

  it("appends local-only templates when asked to, and not when not", () => {
    const { mergeById } = merger();
    expect(mergeById([tpl("p1")], [tpl("p1"), tpl("p9")]).map((t) => t.id)).toEqual(["p1", "p9"]);
    expect(mergeById([tpl("p1")], [tpl("p1"), tpl("p9")], { keepLocalOnly: false }).map((t) => t.id))
      .toEqual(["p1"]);
  });
});
