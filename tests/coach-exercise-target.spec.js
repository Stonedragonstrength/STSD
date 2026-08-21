// @vitest-environment jsdom
//
// The ✎ pencil finds the lift even when the card's week/day no longer resolve.
//
// The bug this guards (2026-08-21, Nathan on Tim's week 4 day 1): the live
// session renders a CLONE of the program taken when the session opened, and
// the coach's own record moves under it — a pull landing mid-session, an edit
// made on another device. When that happens `week.id` or `day.id` stops
// resolving against `currentClient()`, and the pencil said "this exercise
// isn't in the program yet" about a card you are looking at. Waiting a minute
// fixed it, because the next pull put the record back.
//
// Ids are unique, so the lookup now falls back to finding the lift by id
// wherever it actually lives. Extracts the real coachExerciseTarget.
import { describe, it, expect } from "vitest";
import { loadFns } from "./helpers/load-fn.js";

const EX = { id: "x1", name: "Sit-Up" };
const CLIENT = {
  id: "a1",
  weeks: [
    { id: "w1", label: "Week 1", days: [{ id: "d1", name: "Day 1", exercises: [{ id: "other", name: "Row" }] }] },
    { id: "w4", label: "Week 4", days: [{ id: "d4", name: "Day 1", exercises: [EX] }] },
  ],
  oneOffDays: [{ id: "o1", name: "Coach session", exercises: [{ id: "x9", name: "Farmer Carry" }] }],
};

function build({ client = CLIENT, added = null } = {}) {
  return loadFns("function coachExerciseTarget(", {
    currentClient: () => client,
    addedExerciseHome: () => added,
  }).coachExerciseTarget;
}

describe("coachExerciseTarget", () => {
  it("resolves the lift through its own week and day", () => {
    const t = build()({ id: "w4" }, { id: "d4" }, { id: "x1" });
    expect(t).toMatchObject({ week: { id: "w4" }, day: { id: "d4" } });
    expect(t.ex).toBe(EX);
  });

  it("still finds it when the card's DAY no longer resolves", () => {
    const t = build()({ id: "w4" }, { id: "stale-day" }, { id: "x1" });
    expect(t?.ex).toBe(EX);
    expect(t.week.id).toBe("w4");   // the week it really lives in, for carry-forward
  });

  it("still finds it when the card's WEEK no longer resolves", () => {
    const t = build()({ id: "stale-week" }, { id: "d4" }, { id: "x1" });
    expect(t?.ex).toBe(EX);
    expect(t.week.id).toBe("w4");
  });

  it("falls through from a one-off that no longer resolves", () => {
    const t = build()({ id: "oneoff" }, { id: "stale" }, { id: "x9" });
    expect(t?.ex?.name).toBe("Farmer Carry");
    expect(t.week.id).toBe("oneoff");
  });

  it("finds a one-off lift the card filed under a program week", () => {
    const t = build()({ id: "w4" }, { id: "d4" }, { id: "x9" });
    expect(t?.week?.id).toBe("oneoff");
  });

  it("returns null for a lift the coach's record genuinely does not have", () => {
    expect(build()({ id: "w4" }, { id: "d4" }, { id: "ghost" })).toBeNull();
  });

  it("still reaches a lift added on the day, which lives in progress", () => {
    const own = { id: "added1", name: "Dumbbell Sit-Up" };
    const t = build({ added: { list: [own], day: { id: "d4" } } })({ id: "w4" }, { id: "d4" }, own);
    expect(t).toMatchObject({ added: true });
    expect(t.ex).toBe(own);
  });

  it("says no when there is no athlete open", () => {
    expect(build({ client: null })({ id: "w4" }, { id: "d4" }, EX)).toBeNull();
  });
});
