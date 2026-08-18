// Extracted from app.js — Phase 2 (Training) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/training/tags.spec.js imports THIS
// file and reads the namespace, so the shipped code is the tested code.
//
// The tag tables and lift identity move as ONE module because identity IS
// tags: LIFT_ID_GROUPS selects which EXERCISE_MODIFIERS groups fork a
// lift's history, and the band ladder is nothing but the Band group's tag
// order. Splitting them apart would hide the two facts this file exists to
// keep loud: reordering the Band tags re-prescribes every banded lift on
// the roster, and adding a group to LIFT_ID_GROUPS silently shatters every
// affected athlete's progression chains and PR ladders.
(function () {
  "use strict";

  // Stable-ish identity for matching a lift's history across program copies:
  // case-, whitespace-, and trailing-punctuation-insensitive so "Bench Press",
  // "bench  press" and "Bench Press." all count as the same lift.
  function exKey(name) { return String(name || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!]+$/, ""); }

  const EXERCISE_MODIFIERS = [
    { group: "Unilateral",  tags: ["1A", "1L"] },
    { group: "Alternation", tags: ["Alternating", "Non-Alternating"] },
    { group: "Equipment",   tags: ["BB", "DB", "DBs", "KB", "EZ Bar", "Cable", "Rope", "V-Bar", "Wide Bar", "Band", "Machine", "Landmine", "Slider", "Bench", "Bench Assisted"], multi: true },
    // Which resistance band, lightest to heaviest. THIS ORDER IS THE LADDER —
    // nothing else stores it, so reordering these re-prescribes every banded
    // lift on the roster.
    //
    // Single-select on purpose (no `multi`): one band at a time, and picking a
    // second replaces the first, which also makes the picker row a one-tap way
    // to move somebody up a rung.
    //
    // Deliberately NOT in LIFT_ID_GROUPS: a band is the load, not the implement.
    // See tests/band-tags.test.js, which exists to stop that from being changed
    // by accident.
    { group: "Band",        tags: ["Yellow", "Red", "Purple", "Green", "Grey"] },
    { group: "Position",    tags: ["Incline", "Decline", "Elevated", "Seated", "Standing", "Kneeling", "Raised", "Supported", "Wide", "Lying", "Staggered"] },
    { group: "Grip",        tags: ["Supinated", "Neutral", "Pronated"] },
    { group: "Style",       tags: ["Pause", "Tempo", "Explosive", "Isometric"] },
    // WHERE in the range of motion the pause happens, bottom to top. Only
    // offered alongside Pause (see showsWith), because on any other style it is
    // a question with no meaning. Single-select: a rep pauses in one place.
    //
    // Deliberately NOT the group name "Position" — that one is in
    // LIFT_ID_GROUPS, and a paused squat must stay the same lift as an
    // unpaused one or the whole history splits in two.
    { group: "Pause At",    tags: ["Bottom", "¼", "½", "¾", "Top"], showsWith: ["Pause"] },
    // Seconds, shared by Isometric (how long the hold is) and Pause (how long
    // the pause is). Those two live in the single-select Style group, so only
    // one can ever be set — which is what makes one row of seconds unambiguous
    // rather than two rows of nearly identical chips. tagLong() reads the
    // sibling Style tag to say which it is in the athlete's name.
    { group: "Hold",        tags: ["1S", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "10S"],
      showsWith: ["Isometric", "Pause"] },
    // What KIND of contraction this is, for the stat field's AGI axis.
    //
    // Deliberately not folded into Style, and deliberately not named
    // "Plyometric": Style says how fast to move the bar, this says what the
    // movement IS, and Ballistic is the necessary sibling class (a med ball
    // throw, a kettlebell swing, a jump squat) so a group named after one of
    // its own tags would read badly next to Style and Grip.
    //
    // Explosive and Plyometric are different statements and both can be set at
    // once: a barbell squat can be Explosive and is never plyometric, while
    // saying "Explosive" about a depth jump is redundant. Nothing reads the
    // Explosive tag for scoring, because _genTags stamps a random Style tag on
    // 60% of generated primaries — it is noise, not intent.
    //
    // The table already classifies every jump and bound in the library, so this
    // only ever has to handle exceptions: a coach-typed name, a custom
    // exercise, or an ordinary barbell lift programmed as a jump.
    { group: "Impulse",     tags: ["Plyometric", "Ballistic"] },
  ];
  // Groups that only make sense alongside another tag, and the tags that open
  // them. Derived from EXERCISE_MODIFIERS so a new conditional group is one
  // `showsWith` and nothing else — the picker, the clearing and the athlete's
  // name all follow from here.
  // Groups that describe how a rep is PERFORMED rather than what is being
  // lifted. They render as trailing chips and must not prepend to the name —
  // "Plyometric Box Jump" is not English, and neither is "½ Back Squat".
  // Shared by renderModChips and exerciseDisplayLabel, which have to agree:
  // when they did not, a chip sat after the name in the editor and before it on
  // the athlete's card.
  const TRAILING_GROUPS = ["Style", "Pause At", "Hold", "Impulse"];
  const CONDITIONAL_GROUPS = EXERCISE_MODIFIERS.filter((g) => g.showsWith);
  const groupTags = (name) => EXERCISE_MODIFIERS.find((g) => g.group === name)?.tags || [];
  // Seconds: Isometric holds and Pause pauses share this row.
  const HOLD_TAGS = groupTags("Hold");
  const PAUSE_AT_TAGS = groupTags("Pause At");
  /** Should a conditional group be open, given the tags currently set? */
  function conditionalGroupOpen(g, mods) {
    return (g.showsWith || []).some((t) => (mods || []).includes(t));
  }

  // The coach's tags are shorthand — they have to be, because they render as
  // chips in a crowded editor row. The athlete reads a sentence, not a chip,
  // and "BB Squats" is a note to yourself, not an instruction to someone else.
  // So the name they see spells the shorthand out. Tags not listed here are
  // already words ("Cable", "Incline") and pass through unchanged.
  //
  // "DBs" is a PAIR but still expands to the singular "Dumbbell": the plural
  // lives in the weight ("50s", see usesDumbbellPair), and "Dumbbells Bench
  // Press" is not English.
  const TAG_LONG = {
    "1A": "One-Arm",
    "1L": "One-Leg",
    "BB": "Barbell",
    "DB": "Dumbbell",
    "DBs": "Dumbbell",
    "KB": "Kettlebell",
    "EZ Bar": "EZ-Bar",
    // Seconds read as a hold by default; tagLong() rewrites them as a pause
    // when the exercise carries the Pause tag, because the same "3S" means two
    // different instructions and the athlete gets a sentence, not a chip.
    "1S": "1s Hold", "2S": "2s Hold", "3S": "3s Hold", "4S": "4s Hold", "5S": "5s Hold",
    "6S": "6s Hold", "7S": "7s Hold", "8S": "8s Hold", "9S": "9s Hold", "10S": "10s Hold",
    // Where the pause happens. Phrased to follow the name rather than lead it:
    // "Back Squat Pause at ½", never "½ Back Squat".
    "Bottom": "at Bottom", "¼": "at ¼", "½": "at ½", "¾": "at ¾", "Top": "at Top",
    // A chip that is literally green and reads "Green" needs no decoding, but
    // the athlete reads a sentence in several places, and "Green Bench Press"
    // is not one.
    "Yellow": "Yellow Band", "Red": "Red Band", "Purple": "Purple Band",
    "Green": "Green Band", "Grey": "Grey Band",
  };
  // `mods` is optional and only changes the seconds tags: "3S" on a Pause is a
  // three second pause, on an Isometric it is a three second hold. Callers with
  // no exercise in hand get the hold reading, which is what the tag has always
  // meant on its own.
  function tagLong(tag, mods) {
    if (HOLD_TAGS.includes(tag) && (mods || []).includes("Pause")) {
      return tag.replace(/S$/, "s") + " Pause";
    }
    return TAG_LONG[tag] || tag;
  }

  // Chips are ordered by EXERCISE_MODIFIERS so the coach's row reads the same
  // regardless of click order. A NAME is a sentence, and the sentence wants a
  // different order: gym English puts the position first and the implement
  // last — "Standing Kettlebell Swing", not "Kettlebell Standing Swing".
  // Groups missing from this list keep their EXERCISE_MODIFIERS position.
  const NAME_GROUP_ORDER = ["Position", "Alternation", "Grip", "Unilateral", "Equipment"];
  function nameOrderedTags(tags) {
    const rank = (t) => {
      const i = NAME_GROUP_ORDER.indexOf(groupForTag(t)?.group);
      return i < 0 ? NAME_GROUP_ORDER.length : i;
    };
    return tags.slice().sort((a, b) => rank(a) - rank(b));
  }

  function groupForTag(tag) {
    return EXERCISE_MODIFIERS.find((g) => g.tags.includes(tag)) || null;
  }

  // Modifier tags sorted by category order (then tag order within a category),
  // so chips + the exercise name read consistently regardless of click order.
  function orderedModifiers(ex) {
    return [...(ex.modifiers || [])].sort((a, b) => {
      const ga = EXERCISE_MODIFIERS.findIndex((g) => g.tags.includes(a));
      const gb = EXERCISE_MODIFIERS.findIndex((g) => g.tags.includes(b));
      if (ga !== gb) return ga - gb;
      const g = EXERCISE_MODIFIERS[ga];
      return g ? g.tags.indexOf(a) - g.tags.indexOf(b) : 0;
    });
  }

  // The machine's taken, or a joint says no. The athlete swaps the movement but
  // the exercise KEEPS ITS ID, so the prescribed sets/weight/reps, the
  // progression rule and everything already logged against it still apply —
  // only which lift it is changes. Stored on progress, never on weeks: a coach
  // upsert rewrites weeks wholesale and would wipe it. Swaps last until undone,
  // which covers both "taken today" and "this one hurts" without two features.
  function exSwapFor(ex, progress) {
    const s = progress?.swaps?.[ex?.id];
    return s && s.name ? s : null;
  }
  // The name everything downstream should use: display, charts, PR matching.
  function exResolvedName(ex, progress) {
    return exSwapFor(ex, progress)?.name || ex?.name || "";
  }

  // ── Lift identity ──────────────────────────────────────────────────────
  // "Squats" is not one lift. Barbell squats and dumbbell squats load on
  // completely different scales, and until now every matcher in the app keyed
  // on the bare name, so they shared one progression chain, one "Last:" line
  // and one PR ladder — a 315 barbell squat permanently buried every dumbbell
  // squat PR the athlete would ever set.
  //
  // A lift's identity is its name plus the tags that change what you can
  // actually lift: the implement, whether it's one limb, and how the body is
  // arranged. Alternation, Style and Hold are how you PERFORM the reps, not
  // what you're lifting — a paused squat is still a squat, and splitting it
  // off would fragment history for no gain.
  const LIFT_ID_GROUPS = ["Equipment", "Unilateral", "Position", "Grip"];
  function liftTags(ex) {
    return orderedModifiers(ex || {}).filter((t) =>
      LIFT_ID_GROUPS.includes(groupForTag(t)?.group));
  }
  // The matching key. Built from the RAW tags, never the long form, because
  // DB and DBs both read "Dumbbell" but one dumbbell and two are not the same
  // lift. Bare part and tag part stay separable so a legacy PR filed under the
  // bare name can still be matched back (see prLiftKey).
  function liftKey(ex, progress) {
    const bare = exKey(exResolvedName(ex, progress) || ex?.name || "");
    if (!bare) return "";
    const tags = liftTags(ex).map((t) => t.toLowerCase()).sort().join("+");
    return tags ? `${bare}|${tags}` : bare;
  }
  function liftKeyBare(key) { return String(key || "").split("|")[0]; }
  // What that identity is CALLED — the long-form name, minus the Style/Hold
  // tags, which describe the set rather than the lift.
  function liftLabel(ex, progress) {
    const nm = exResolvedName(ex, progress) || ex?.name || "";
    if (!nm) return "";
    return [...nameOrderedTags(liftTags(ex)).map(tagLong), nm].join(" ");
  }
  // A stored PR's lift. Records filed before identity existed have only a bare
  // name — those key on the name alone, exactly as they always did, and the
  // merge pass in groupPRs folds them into the tagged lift when there's only
  // one candidate. Nothing is lost by not migrating; migrating just resolves
  // the ambiguous cases.
  function prLiftKey(p) { return (p && p.lift) || exKey(p && p.name); }

  // ── Bands ──────────────────────────────────────────────────────────────
  // Read out of the group rather than written twice, so the ladder and the
  // picker row can never disagree about what comes next.
  const BAND_TAGS = (EXERCISE_MODIFIERS.find((g) => g.group === "Band") || {}).tags || [];
  // The exercise's band, if it has one. Note this deliberately does NOT match
  // the old "Band" Equipment tag: that means "a band, unspecified", predates the
  // colors, and is not a rung on anything.
  function bandOf(ex) {
    return (ex?.modifiers || []).find((t) => BAND_TAGS.includes(t)) || null;
  }
  // One rung heavier. Null at grey, and null for anything not on the ladder.
  function nextBandUp(tag) {
    const i = BAND_TAGS.indexOf(tag);
    return i < 0 || i === BAND_TAGS.length - 1 ? null : BAND_TAGS[i + 1];
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.training = Object.assign(NS.training || {}, {
    exKey,
    EXERCISE_MODIFIERS, TRAILING_GROUPS, CONDITIONAL_GROUPS, groupTags,
    HOLD_TAGS, PAUSE_AT_TAGS, conditionalGroupOpen,
    TAG_LONG, tagLong,
    NAME_GROUP_ORDER, nameOrderedTags,
    groupForTag, orderedModifiers,
    exSwapFor, exResolvedName,
    LIFT_ID_GROUPS, liftTags, liftKey, liftKeyBare, liftLabel, prLiftKey,
    BAND_TAGS, bandOf, nextBandUp,
  });
})();
