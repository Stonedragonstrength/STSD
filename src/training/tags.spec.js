// The tag system and lift identity — tier 1 now: a real import of the
// shipped file. The Pause/V-Bar assertions are carried verbatim from
// tests/tags/pause-and-equipment.spec.js (header story kept below); the
// lift-identity and band describes are NEW coverage added at the move —
// liftKey and its family had no executable tests before, only source pins.
//
// From the ported file: the dangerous half is not the tags, it is lift
// IDENTITY. A lift's identity is its name plus the tags that change what
// you can actually lift, and Pause is deliberately excluded — "a paused
// squat is still a squat, and splitting it off would fragment history for
// no gain". If either conditional group leaked into LIFT_ID_GROUPS, every
// athlete's paused work would split off into its own progression chain and
// its own PR ladder, silently, and only show up months later as a graph
// that goes nowhere.
import { describe, it, expect } from "vitest";
import "./tags.js";

const {
  exKey,
  EXERCISE_MODIFIERS, TRAILING_GROUPS, HOLD_TAGS, PAUSE_AT_TAGS,
  conditionalGroupOpen, TAG_LONG, tagLong,
  nameOrderedTags, groupForTag, orderedModifiers,
  exSwapFor, exResolvedName,
  LIFT_ID_GROUPS, liftTags, liftKey, liftKeyBare, liftLabel, prLiftKey,
  BAND_TAGS, bandOf, nextBandUp,
} = globalThis.STSD.training;

const groupNamed = (mods, name) => mods.find((g) => g.group === name);

describe("V-Bar", () => {
  it("is an equipment tag", () => {
    expect(groupNamed(EXERCISE_MODIFIERS, "Equipment").tags).toContain("V-Bar");
  });

  it("sits with the other cable attachments, not off the end", () => {
    // Order is what the picker row reads like. A V-bar belongs beside the rope.
    const tags = groupNamed(EXERCISE_MODIFIERS, "Equipment").tags;
    expect(tags[tags.indexOf("V-Bar") - 1]).toBe("Rope");
  });

  it("stacks with Cable, because Equipment is multi-select", () => {
    expect(groupNamed(EXERCISE_MODIFIERS, "Equipment").multi).toBe(true);
  });

  it("does change lift identity, like every other implement", () => {
    // A V-bar row and a rope row load differently, which is the whole point of
    // LIFT_ID_GROUPS. Equipment is already in it; this just states the intent.
    expect(LIFT_ID_GROUPS).toContain("Equipment");
  });
});

describe("Pause: where", () => {
  it("offers bottom, quarter, half, three-quarter, top, in that order", () => {
    // Bottom to top, so the row reads as the movement does.
    expect(PAUSE_AT_TAGS).toEqual(["Bottom", "¼", "½", "¾", "Top"]);
  });

  it("only appears alongside Pause", () => {
    const g = groupNamed(EXERCISE_MODIFIERS, "Pause At");
    expect(conditionalGroupOpen(g, ["Pause"])).toBe(true);
    expect(conditionalGroupOpen(g, ["Isometric"])).toBe(false);
    expect(conditionalGroupOpen(g, ["Explosive"])).toBe(false);
    expect(conditionalGroupOpen(g, [])).toBe(false);
  });

  it("is single-select: a rep pauses in one place", () => {
    expect(groupNamed(EXERCISE_MODIFIERS, "Pause At").multi).toBeFalsy();
  });
});

describe("Pause: how long", () => {
  it("goes up to ten seconds", () => {
    expect(HOLD_TAGS).toEqual(["1S", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "10S"]);
  });

  it("still serves Isometric holds, which is what it was for", () => {
    // Extending the row must not take the hold length away from Isometric.
    const g = groupNamed(EXERCISE_MODIFIERS, "Hold");
    expect(conditionalGroupOpen(g, ["Isometric"])).toBe(true);
    expect(conditionalGroupOpen(g, ["Pause"])).toBe(true);
    expect(conditionalGroupOpen(g, ["Tempo"])).toBe(false);
  });

  it("reads as a pause or a hold depending on the style set", () => {
    // One row of seconds serving two styles is only safe because Pause and
    // Isometric are both in the single-select Style group, so only one can be
    // on. The athlete still has to be told which one it is.
    expect(tagLong("3S", ["Pause", "½"])).toBe("3s Pause");
    expect(tagLong("10S", ["Pause"])).toBe("10s Pause");
    expect(tagLong("3S", ["Isometric"])).toBe("3s Hold");
    expect(tagLong("3S", [])).toBe("3s Hold");
    expect(tagLong("3S")).toBe("3s Hold");
  });
});

describe("none of this may fragment lift history", () => {
  it("keeps the conditional groups out of lift identity", () => {
    // The failure this prevents is silent and only visible months later: every
    // paused squat would become its own lift, with its own progression chain
    // and its own PR ladder, cut off from the unpaused ones.
    expect(LIFT_ID_GROUPS).not.toContain("Pause At");
    expect(LIFT_ID_GROUPS).not.toContain("Hold");
    expect(LIFT_ID_GROUPS).not.toContain("Style");
    expect(LIFT_ID_GROUPS).toEqual(["Equipment", "Unilateral", "Position", "Grip"]);
  });

  it("keeps the band ladder out of lift identity — a band is the load, not the implement", () => {
    // tests/band-tags.test.js pins this too, and its header says it best: if
    // that test fails, the change is the bug. Adding "Band" would shatter
    // every athlete's banded history into five unrelated chains.
    expect(LIFT_ID_GROUPS).not.toContain("Band");
  });

  it("does not reuse the name of a lift-identity group", () => {
    // "Position" is in LIFT_ID_GROUPS. Naming the new group Position would have
    // quietly made a paused squat a different lift.
    const g = groupNamed(EXERCISE_MODIFIERS, "Pause At");
    expect(g).toBeTruthy();
    expect(LIFT_ID_GROUPS).not.toContain(g.group);
  });

  it("does not collide a pause position with an existing tag", () => {
    // Tags are bare strings in ex.modifiers and groupForTag takes the first
    // match, so a duplicate would silently reassign an existing tag's group.
    const others = EXERCISE_MODIFIERS
      .filter((g) => g.group !== "Pause At")
      .flatMap((g) => g.tags);
    const clashes = PAUSE_AT_TAGS.filter((t) => others.includes(t));
    expect(clashes).toEqual([]);
  });
});

describe("where the new chips render", () => {
  it("puts pause position and seconds after the name, not before it", () => {
    // "½ Back Squat" is not what the tag means.
    expect(TRAILING_GROUPS).toContain("Pause At");
    expect(TRAILING_GROUPS).toContain("Hold");
    expect(TRAILING_GROUPS).toContain("Style");
  });

  it("phrases the position to follow the name", () => {
    expect(TAG_LONG["½"]).toBe("at ½");
    expect(TAG_LONG["Bottom"]).toBe("at Bottom");
    expect(TAG_LONG["Top"]).toBe("at Top");
  });
});

// ── New coverage from here down: the identity family had no executable
// tests before the move. ──────────────────────────────────────────────────

describe("exKey", () => {
  it("folds case, whitespace and trailing punctuation into one identity", () => {
    expect(exKey("Bench Press")).toBe("bench press");
    expect(exKey("bench  press")).toBe("bench press");
    expect(exKey("  Bench Press. ")).toBe("bench press");
    expect(exKey("Bench Press!!")).toBe("bench press");
  });

  it("is empty for nothing, never a crash", () => {
    expect(exKey("")).toBe("");
    expect(exKey(null)).toBe("");
    expect(exKey(undefined)).toBe("");
  });
});

describe("liftKey and its family", () => {
  const squat = (mods) => ({ id: "e1", name: "Squats", modifiers: mods || [] });

  it("a bare lift keys on its bare name", () => {
    expect(liftKey(squat())).toBe("squats");
  });

  it("identity tags fork the key; performance tags do not", () => {
    expect(liftKey(squat(["BB"]))).toBe("squats|bb");
    expect(liftKey(squat(["DB"]))).toBe("squats|db");
    // Pause, seconds, band, alternation: how the reps are performed or
    // loaded, not what the lift is. Same key as bare.
    expect(liftKey(squat(["Pause", "3S", "½"]))).toBe("squats");
    expect(liftKey(squat(["Green"]))).toBe("squats");
    expect(liftKey(squat(["Alternating"]))).toBe("squats");
  });

  it("the tag half is order-independent: click order cannot fork a lift", () => {
    expect(liftKey(squat(["BB", "Incline"]))).toBe(liftKey(squat(["Incline", "BB"])));
  });

  it("the tag half is ALPHABETICAL, not table-ordered — the key must outlive the table", () => {
    // orderedModifiers already normalises click order, but its order is the
    // EXERCISE_MODIFIERS table's, and inserting a group there would silently
    // re-spell every stored key. The final .sort() pins the key to the tags
    // themselves. KB (Equipment) precedes Incline (Position) in the table;
    // the key still spells them alphabetically.
    expect(liftKey(squat(["KB", "Incline"]))).toBe("squats|incline+kb");
  });

  it("DB and DBs are different lifts even though both read Dumbbell", () => {
    expect(liftKey(squat(["DB"]))).not.toBe(liftKey(squat(["DBs"])));
  });

  it("a swap changes the identity, because the athlete is doing a different lift", () => {
    const progress = { swaps: { e1: { name: "Leg Press" } } };
    expect(liftKey(squat(["BB"]), progress)).toBe("leg press|bb");
    expect(exResolvedName(squat(), progress)).toBe("Leg Press");
    expect(exSwapFor(squat(), { swaps: { e1: { name: "" } } })).toBe(null);
  });

  it("liftKeyBare recovers the name half, which is how legacy PRs match back", () => {
    expect(liftKeyBare("squats|bb+incline")).toBe("squats");
    expect(liftKeyBare("squats")).toBe("squats");
    expect(liftKeyBare(null)).toBe("");
  });

  it("liftLabel spells the shorthand out in gym-English order", () => {
    // Position before implement: "Incline Barbell Squats", never
    // "Barbell Incline Squats".
    expect(liftLabel(squat(["BB", "Incline"]))).toBe("Incline Barbell Squats");
    // Performance tags stay out of the lift's NAME.
    expect(liftLabel(squat(["Pause", "3S"]))).toBe("Squats");
  });

  it("prLiftKey prefers the stored identity and falls back to the bare name", () => {
    expect(prLiftKey({ lift: "squats|bb", name: "Squats" })).toBe("squats|bb");
    expect(prLiftKey({ name: "Squats." })).toBe("squats");
    expect(prLiftKey(null)).toBe("");
  });
});

describe("the band ladder", () => {
  it("runs yellow to grey, lightest to heaviest — the tag order IS the ladder", () => {
    expect(BAND_TAGS).toEqual(["Yellow", "Red", "Purple", "Green", "Grey"]);
  });

  it("bandOf finds the rung and ignores the old unspecified Equipment Band tag", () => {
    expect(bandOf({ modifiers: ["BB", "Red"] })).toBe("Red");
    expect(bandOf({ modifiers: ["Band"] })).toBe(null);
    expect(bandOf({ modifiers: [] })).toBe(null);
    expect(bandOf(null)).toBe(null);
  });

  it("nextBandUp steps one rung and stops at the top", () => {
    expect(nextBandUp("Yellow")).toBe("Red");
    expect(nextBandUp("Green")).toBe("Grey");
    expect(nextBandUp("Grey")).toBe(null);
    expect(nextBandUp("Cable")).toBe(null);
  });
});

describe("tag ordering", () => {
  it("orderedModifiers sorts by group order then tag order, whatever the click order", () => {
    const ex = { modifiers: ["Grey", "BB", "1A", "Pause"] };
    expect(orderedModifiers(ex)).toEqual(["1A", "BB", "Grey", "Pause"]);
    expect(orderedModifiers({ modifiers: [] })).toEqual([]);
  });

  it("nameOrderedTags puts position first and implement last, as the sentence wants", () => {
    expect(nameOrderedTags(["BB", "Incline"])).toEqual(["Incline", "BB"]);
    expect(nameOrderedTags(["DB", "Supinated", "Seated"])).toEqual(["Seated", "Supinated", "DB"]);
  });

  it("tags from unlisted groups go to the END of the name, never the front", () => {
    // A band tag has no NAME_GROUP_ORDER entry; the fallback rank puts it
    // after every listed group, so a sentence reads "Incline Grey Band …",
    // never "Grey Band Incline …".
    expect(nameOrderedTags(["Grey", "Incline"])).toEqual(["Incline", "Grey"]);
  });

  it("groupForTag finds the owning group, and null for a stranger", () => {
    expect(groupForTag("KB")?.group).toBe("Equipment");
    expect(groupForTag("Grey")?.group).toBe("Band");
    expect(groupForTag("Burpee")).toBe(null);
  });
});
