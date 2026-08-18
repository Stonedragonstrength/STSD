// The template merge, its content-over-stamp rescue, and the tombstone
// family — ported when they moved out of the IIFE. Tier 1 now: a real import
// of the shipped file. Assertions carried verbatim from
// tests/sync/merge-keeps-the-fuller-copy.spec.js and
// tests/template-tombstones.test.js, whose header stories are kept below.
//
// The rescue incident (2026-08-17): a program template was built Day 2 first,
// then Day 1. A snapshot from between those two states — Day 1's lifts added
// but not yet given weights, Day 2 finished — won a merge and became the
// truth. Seven exercises' weights, reps and progression rules disappeared,
// silently. `updatedAt` cannot arbitrate (stamped in exactly one place);
// content can: adding the lifts is a minute's work, typing their numbers is
// an hour's, and it is the hour that keeps being lost.
//
// The tombstone bug: deleting a template used to filter it out of the local
// array and rely on a debounced push to tell the cloud. On the phone that
// push routinely dies, so the next pull read the cloud-only id as "created
// elsewhere" and resurrected it, and the dirty-flag re-push cemented it.
// Delete writes a STAMPED TOMBSTONE instead; newest-wins carries the deletion
// through every merge path.
import { describe, it, expect } from "vitest";
import assert from "node:assert";
import "./merge-by-id.js";

const { filledPrescriptions, mergeById, deleteTemplateById, liveTemplates, purgeTemplateTombstones } =
  globalThis.STSD.sync;

const DAY = 24 * 60 * 60 * 1000;

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

/** The tombstone tests' slimmer shape. */
const bare = (id, updatedAt, name) => ({ id, name: name || id, updatedAt, weeks: [] });

describe("filledPrescriptions", () => {
  it("counts exercises that carry a weight, reps, or a progression rule", () => {
    expect(filledPrescriptions(tpl("a", { filled: 0, total: 3 }))).toBe(0);
    expect(filledPrescriptions(tpl("a", { filled: 2, total: 3 }))).toBe(2);
    expect(filledPrescriptions(undefined)).toBe(0);
    expect(filledPrescriptions({ weeks: [] })).toBe(0);
  });

  it("counts a progression rule even with no weight typed yet", () => {
    const t = { weeks: [{ days: [{ exercises: [{ currentWeight: "", currentReps: "", progression: { inc: 5 } }] }] }] };
    expect(filledPrescriptions(t)).toBe(1);
  });
});

describe("a merge keeps the fuller copy when the stamps disagree with the content", () => {
  it("keeps local work that a NEWER-stamped but emptier cloud copy would have erased", () => {
    // This is the incident, exactly: the cloud copy is stamped later, and holds
    // less. Before the guard, the stamp won and the work was gone.
    const cloud = [tpl("p1", { filled: 0, total: 7, updatedAt: 2000 })];
    const local = [tpl("p1", { filled: 7, total: 7, updatedAt: 1000 })];
    const out = mergeById(cloud, local, { prefer: "cloud", keepLocalOnly: false });
    expect(out).toHaveLength(1);
    expect(out[0].weeks[0].days[0].exercises[0].currentWeight).toBe("225");
  });

  it("reports what it rescued, because a silent save is what made this hurt", () => {
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
    const out = mergeById(
      [tpl("p1", { filled: 7, total: 7, updatedAt: 1000 })],
      [tpl("p1", { filled: 2, total: 7, updatedAt: 2000 })],
      { prefer: "local" },
    );
    expect(out[0].weeks[0].days[0].exercises[6].currentWeight).toBe("225");
  });

  it("leaves the normal timestamp rule alone when both hold the same amount", () => {
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
    // reason tombstones exist.
    const cloud = [tpl("p1", { deleted: 1700000000000, updatedAt: 2000 })];
    const local = [tpl("p1", { filled: 7, total: 7, updatedAt: 1000 })];
    const out = mergeById(cloud, local, { prefer: "cloud", keepLocalOnly: false });
    expect(out[0].deleted).toBeTruthy();
    expect(out[0].weeks).toBeUndefined();
  });

  it("does not rescue when the LOCAL side is the tombstone either", () => {
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
    const out = mergeById([tpl("p1"), tpl("p2")], [tpl("p1")], { prefer: "cloud" });
    expect(out.map((t) => t.id)).toEqual(["p1", "p2"]);
  });

  it("appends local-only templates when asked to, and not when not", () => {
    expect(mergeById([tpl("p1")], [tpl("p1"), tpl("p9")]).map((t) => t.id)).toEqual(["p1", "p9"]);
    expect(mergeById([tpl("p1")], [tpl("p1"), tpl("p9")], { keepLocalOnly: false }).map((t) => t.id))
      .toEqual(["p1"]);
  });
});

describe("template tombstones", () => {
  it("the mechanism being fixed: a plain removal is resurrected by the dirty-pull merge", () => {
    // Old delete: filter the array. Local no longer holds the id at all, so the
    // merge cannot tell "deleted here" from "created elsewhere" — the cloud copy
    // comes back. This is mergeById working as designed; it is why delete must
    // tombstone instead.
    const cloud = [bare("a", 1000, "Untitled Program")];
    const localAfterFilterDelete = [];
    const merged = mergeById(cloud, localAfterFilterDelete);
    assert.strictEqual(merged.length, 1, "cloud copy resurrected");
    assert.strictEqual(merged[0].id, "a");
  });

  it("deleteTemplateById replaces the entry with a stamped tombstone, others untouched", () => {
    const list = [bare("a", 1000, "Untitled Program"), bare("b", 2000, "GPP Block")];
    const out = deleteTemplateById(list, "a");
    assert.strictEqual(out.length, 2, "tombstone stays in the array");
    const dead = out.find((t) => t.id === "a");
    assert.strictEqual(dead.deleted, true);
    assert.ok(Number(dead.updatedAt) > 1000, "tombstone is stamped now");
    assert.ok(!("weeks" in dead), "tombstone carries no program body");
    assert.deepStrictEqual(out.find((t) => t.id === "b"), list[1], "other entries untouched");
  });

  it("the phone repro: tombstone survives the dirty-pull merge, liveTemplates hides it", () => {
    // Delete on the phone, reload before the push lands. Cloud still has the
    // live copy; local holds the tombstone. Boot pulls with the dirty-flag
    // options (prefer local, keep local-only) — the tombstone's newer stamp
    // must win, and the re-push then carries the deletion up.
    const cloud = [bare("a", 1000, "Untitled Program")];
    const local = deleteTemplateById([bare("a", 1000, "Untitled Program")], "a");
    const merged = mergeById(cloud, local);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].deleted, true, "deletion survives the pull");
    assert.deepStrictEqual(liveTemplates(merged), [], "nothing renders");
  });

  it("tombstone also survives the clean-pull merge (prefer cloud, drop local-only)", () => {
    const cloud = [bare("a", 1000, "Untitled Program")];
    const local = deleteTemplateById([bare("a", 1000, "Untitled Program")], "a");
    const merged = mergeById(cloud, local, { prefer: "cloud", keepLocalOnly: false });
    assert.strictEqual(merged[0].deleted, true, "self-heal path sees the deletion and re-pushes it");
  });

  it("an edit stamped after the delete wins — latest action rules, both directions", () => {
    const t = Date.now();
    const localTombstone = { id: "a", name: "Block", deleted: true, updatedAt: t - 1000 };
    const cloudEditedLater = { ...bare("a", t, "Block"), weeks: [{ id: "w1" }] };
    const merged = mergeById([cloudEditedLater], [localTombstone]);
    assert.ok(!merged[0].deleted, "newer edit on another device undoes the older delete");
    const cloudTombstone = { id: "a", name: "Block", deleted: true, updatedAt: t };
    const localEditedEarlier = { ...bare("a", t - 1000, "Block") };
    const merged2 = mergeById([cloudTombstone], [localEditedEarlier]);
    assert.strictEqual(merged2[0].deleted, true, "newer delete beats the older edit");
  });

  it("deletion already in the cloud: a clean pull drops the stale local copy", () => {
    // Device B slept through the delete. Cloud carries the tombstone; B's live
    // copy is older, so the tombstone wins and B stops showing the program.
    const t = Date.now();
    const cloud = [{ id: "a", name: "Untitled Program", deleted: true, updatedAt: t }];
    const local = [bare("a", t - DAY, "Untitled Program")];
    const merged = mergeById(cloud, local, { prefer: "cloud", keepLocalOnly: false });
    assert.strictEqual(merged[0].deleted, true);
    assert.deepStrictEqual(liveTemplates(merged), []);
  });

  it("purge drops only expired tombstones — live entries and fresh tombstones stay", () => {
    const t = Date.now();
    const list = [
      bare("live", 500, "Keeper"),
      { id: "old", name: "Gone", deleted: true, updatedAt: t - 31 * DAY },
      { id: "fresh", name: "Just deleted", deleted: true, updatedAt: t - DAY },
    ];
    const out = purgeTemplateTombstones(list);
    assert.deepStrictEqual(out.map((x) => x.id), ["live", "fresh"]);
  });

  it("helpers tolerate a missing list", () => {
    assert.deepStrictEqual(liveTemplates(null), []);
    assert.deepStrictEqual(purgeTemplateTombstones(undefined), []);
    assert.deepStrictEqual(deleteTemplateById(null, "a"), []);
  });
});
