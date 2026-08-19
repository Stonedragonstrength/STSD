// Quick-tool tweaks: per-exercise deltas to set / warm-up row counts, stored
// on progress.exTweaks keyed by exercise id, plus "apply shape to later weeks".
//
// Extracted real from app.js via load-fn — not re-coded here. The rules:
//
//   * exTweakOf never returns junk: missing progress, missing entry, or NaN
//     fields all read as {sets:0, warm:0}.
//   * setExTweak writes deltas and prunes zeroed entries, so exTweaks holds
//     only real adjustments (an all-zero tweak is the same as none).
//   * applyTweakToLaterWeeks copies the source exercise's tweak onto the SAME
//     lift on the SAME-named day in every later week — matching by
//     laterWeekMatches (day name + liftKey), never by position — and returns
//     how many weeks it touched. A zeroed source tweak clears later entries.
import { describe, it, expect } from "vitest";
import { loadFns } from "./helpers/load-fn.js";

function load() {
  return loadFns(
    ["function laterWeekMatches(", "function exTweakOf(", "function setExTweak(", "function applyTweakToLaterWeeks("],
    { liftKey: (ex) => (ex.name || "").toLowerCase() }
  );
}

const week = (id, dayName, exId) => ({
  id, days: [{ id: `d-${id}`, name: dayName, exercises: [{ id: exId, name: "Bench Press" }] }],
});

describe("exTweakOf / setExTweak", () => {
  it("reads {sets:0, warm:0} for anything missing or malformed", () => {
    const { exTweakOf } = load();
    expect(exTweakOf(null, "e1")).toEqual({ sets: 0, warm: 0 });
    expect(exTweakOf({}, "e1")).toEqual({ sets: 0, warm: 0 });
    expect(exTweakOf({ exTweaks: { e1: { sets: "x", warm: null } } }, "e1")).toEqual({ sets: 0, warm: 0 });
    expect(exTweakOf({ exTweaks: { e1: { sets: 2, warm: -1 } } }, "e1")).toEqual({ sets: 2, warm: -1 });
  });

  it("writes deltas and prunes zeroed entries", () => {
    const { setExTweak, exTweakOf } = load();
    const p = {};
    setExTweak(p, "e1", { sets: 1, warm: 0 });
    expect(exTweakOf(p, "e1")).toEqual({ sets: 1, warm: 0 });
    setExTweak(p, "e1", { sets: 0, warm: 0 });
    expect(p.exTweaks.e1).toBeUndefined();
  });
});

describe("applyTweakToLaterWeeks", () => {
  it("copies the tweak onto the same lift in later weeks only", () => {
    const { setExTweak, applyTweakToLaterWeeks, exTweakOf } = load();
    const client = { weeks: [week("w1", "Push Day", "e1"), week("w2", "Push Day", "e2"), week("w3", "Push Day", "e3")] };
    const p = {};
    setExTweak(p, "e2", { sets: 1, warm: -1 });

    const n = applyTweakToLaterWeeks(client, p, "w2", client.weeks[1].days[0], client.weeks[1].days[0].exercises[0]);

    expect(n).toBe(1); // only w3 is later
    expect(exTweakOf(p, "e3")).toEqual({ sets: 1, warm: -1 });
    expect(p.exTweaks.e1).toBeUndefined(); // w1 is earlier — untouched
  });

  it("matches by day name, not position, and clears later entries when zeroed", () => {
    const { setExTweak, applyTweakToLaterWeeks } = load();
    const client = { weeks: [week("w1", "Push Day", "e1"), week("w2", "Pull Day", "e2"), week("w3", "Push Day", "e3")] };
    const p = {};
    setExTweak(p, "e3", { sets: 2, warm: 0 });

    const n = applyTweakToLaterWeeks(client, p, "w1", client.weeks[0].days[0], client.weeks[0].days[0].exercises[0]);

    expect(n).toBe(1); // w2 is Pull Day — skipped; w3 matched
    expect(p.exTweaks.e3).toBeUndefined(); // source e1 has no tweak → later entry cleared
  });

  it("returns 0 with no later match and touches nothing", () => {
    const { applyTweakToLaterWeeks } = load();
    const client = { weeks: [week("w1", "Push Day", "e1")] };
    const p = {};
    expect(applyTweakToLaterWeeks(client, p, "w1", client.weeks[0].days[0], client.weeks[0].days[0].exercises[0])).toBe(0);
    expect(p.exTweaks).toBeUndefined();
  });
});
