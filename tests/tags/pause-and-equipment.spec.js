// The Pause tag's two sub-options, and V-Bar in Equipment.
//
// Asked for as: "in the tag system i want V-Bar in the equipment tag and when i
// click the PAUSE tag i want 2 options to come up, where to pause (Bottom 1/4
// bottom, 1/2, 3/4th top) and how many seconds to pause up to 10 seconds."
//
// The dangerous half is not the tags, it is lift IDENTITY. A lift's identity is
// its name plus the tags that change what you can actually lift, and Pause is
// deliberately excluded — "a paused squat is still a squat, and splitting it
// off would fragment history for no gain". If either new group leaked into
// LIFT_ID_GROUPS, every athlete's paused work would split off into its own
// progression chain and its own PR ladder, silently, and only show up months
// later as a graph that goes nowhere. That is the same failure tests/band-tags
// exists to prevent, so it is pinned the same way here.
import { describe, it, expect } from "vitest";
import { loadFns } from "../helpers/load-fn.js";

function tagSystem() {
  return loadFns([
    "const EXERCISE_MODIFIERS",
    "const TRAILING_GROUPS",
    "const CONDITIONAL_GROUPS",
    "const groupTags",
    "const HOLD_TAGS",
    "const PAUSE_AT_TAGS",
    "const LIFT_ID_GROUPS",
    "const TAG_LONG",
    "function conditionalGroupOpen(",
    "function tagLong(",
  ], {}, {
    expose: ["EXERCISE_MODIFIERS", "TRAILING_GROUPS", "CONDITIONAL_GROUPS", "HOLD_TAGS",
      "PAUSE_AT_TAGS", "LIFT_ID_GROUPS", "TAG_LONG", "conditionalGroupOpen", "tagLong"],
  });
}

const groupNamed = (mods, name) => mods.find((g) => g.group === name);

describe("V-Bar", () => {
  it("is an equipment tag", () => {
    const { EXERCISE_MODIFIERS } = tagSystem();
    expect(groupNamed(EXERCISE_MODIFIERS, "Equipment").tags).toContain("V-Bar");
  });

  it("sits with the other cable attachments, not off the end", () => {
    // Order is what the picker row reads like. A V-bar belongs beside the rope.
    const { EXERCISE_MODIFIERS } = tagSystem();
    const tags = groupNamed(EXERCISE_MODIFIERS, "Equipment").tags;
    expect(tags[tags.indexOf("V-Bar") - 1]).toBe("Rope");
  });

  it("stacks with Cable, because Equipment is multi-select", () => {
    const { EXERCISE_MODIFIERS } = tagSystem();
    expect(groupNamed(EXERCISE_MODIFIERS, "Equipment").multi).toBe(true);
  });

  it("does change lift identity, like every other implement", () => {
    // A V-bar row and a rope row load differently, which is the whole point of
    // LIFT_ID_GROUPS. Equipment is already in it; this just states the intent.
    const { LIFT_ID_GROUPS } = tagSystem();
    expect(LIFT_ID_GROUPS).toContain("Equipment");
  });
});

describe("Pause: where", () => {
  it("offers bottom, quarter, half, three-quarter, top, in that order", () => {
    // Bottom to top, so the row reads as the movement does.
    const { PAUSE_AT_TAGS } = tagSystem();
    expect(PAUSE_AT_TAGS).toEqual(["Bottom", "¼", "½", "¾", "Top"]);
  });

  it("only appears alongside Pause", () => {
    const { EXERCISE_MODIFIERS, conditionalGroupOpen } = tagSystem();
    const g = groupNamed(EXERCISE_MODIFIERS, "Pause At");
    expect(conditionalGroupOpen(g, ["Pause"])).toBe(true);
    expect(conditionalGroupOpen(g, ["Isometric"])).toBe(false);
    expect(conditionalGroupOpen(g, ["Explosive"])).toBe(false);
    expect(conditionalGroupOpen(g, [])).toBe(false);
  });

  it("is single-select: a rep pauses in one place", () => {
    const { EXERCISE_MODIFIERS } = tagSystem();
    expect(groupNamed(EXERCISE_MODIFIERS, "Pause At").multi).toBeFalsy();
  });
});

describe("Pause: how long", () => {
  it("goes up to ten seconds", () => {
    const { HOLD_TAGS } = tagSystem();
    expect(HOLD_TAGS).toEqual(["1S", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "10S"]);
  });

  it("still serves Isometric holds, which is what it was for", () => {
    // Extending the row must not take the hold length away from Isometric.
    const { EXERCISE_MODIFIERS, conditionalGroupOpen } = tagSystem();
    const g = groupNamed(EXERCISE_MODIFIERS, "Hold");
    expect(conditionalGroupOpen(g, ["Isometric"])).toBe(true);
    expect(conditionalGroupOpen(g, ["Pause"])).toBe(true);
    expect(conditionalGroupOpen(g, ["Tempo"])).toBe(false);
  });

  it("reads as a pause or a hold depending on the style set", () => {
    // One row of seconds serving two styles is only safe because Pause and
    // Isometric are both in the single-select Style group, so only one can be
    // on. The athlete still has to be told which one it is.
    const { tagLong } = tagSystem();
    expect(tagLong("3S", ["Pause", "½"])).toBe("3s Pause");
    expect(tagLong("10S", ["Pause"])).toBe("10s Pause");
    expect(tagLong("3S", ["Isometric"])).toBe("3s Hold");
    expect(tagLong("3S", [])).toBe("3s Hold");
    expect(tagLong("3S")).toBe("3s Hold");
  });
});

describe("none of this may fragment lift history", () => {
  it("keeps the new groups out of lift identity", () => {
    // The failure this prevents is silent and only visible months later: every
    // paused squat would become its own lift, with its own progression chain
    // and its own PR ladder, cut off from the unpaused ones.
    const { LIFT_ID_GROUPS } = tagSystem();
    expect(LIFT_ID_GROUPS).not.toContain("Pause At");
    expect(LIFT_ID_GROUPS).not.toContain("Hold");
    expect(LIFT_ID_GROUPS).not.toContain("Style");
    expect(LIFT_ID_GROUPS).toEqual(["Equipment", "Unilateral", "Position", "Grip"]);
  });

  it("does not reuse the name of a lift-identity group", () => {
    // "Position" is in LIFT_ID_GROUPS. Naming the new group Position would have
    // quietly made a paused squat a different lift.
    const { EXERCISE_MODIFIERS, LIFT_ID_GROUPS } = tagSystem();
    const g = groupNamed(EXERCISE_MODIFIERS, "Pause At");
    expect(g).toBeTruthy();
    expect(LIFT_ID_GROUPS).not.toContain(g.group);
  });

  it("does not collide a pause position with an existing tag", () => {
    // Tags are bare strings in ex.modifiers and groupForTag takes the first
    // match, so a duplicate would silently reassign an existing tag's group.
    const { EXERCISE_MODIFIERS, PAUSE_AT_TAGS } = tagSystem();
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
    const { TRAILING_GROUPS } = tagSystem();
    expect(TRAILING_GROUPS).toContain("Pause At");
    expect(TRAILING_GROUPS).toContain("Hold");
    expect(TRAILING_GROUPS).toContain("Style");
  });

  it("phrases the position to follow the name", () => {
    const { TAG_LONG } = tagSystem();
    expect(TAG_LONG["½"]).toBe("at ½");
    expect(TAG_LONG["Bottom"]).toBe("at Bottom");
    expect(TAG_LONG["Top"]).toBe("at Top");
  });
});
