// Extracted from app.js — Phase 2 (Training) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/training/levels.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
//
// The grading tables: training age, training phase, the effort ladder, the
// gym gear vocabulary, and the band functions that turn a set count into a
// verdict. They move as one module because they are one decision - which
// numbers grade an athlete's week - and levelBands is the single place a
// phase outranks the age ladder.
(function () {
  "use strict";
  // ── Effort / intensity (coach-set) ──
  // A small "heat ramp" cue: how hard the coach wants this exercise pushed.
  // Light→yellow, Moderate→orange, Hard→red. Stored as ex.effort. Shown as a
  // left-anchored warm gradient on the card + a flame/label tag.
  // `rank` is what a training phase compares against when deciding whether a
  // set was intense enough to earn coverage credit — see TRAINING_PHASES.
  const EFFORT_LEVELS = {
    light:    { label: "Light",    rgb: "234,179,8",  flames: "🔥",       rank: 1 },
    moderate: { label: "Moderate", rgb: "249,115,22", flames: "🔥🔥",     rank: 2 },
    hard:     { label: "Hard",     rgb: "239,68,68",  flames: "🔥🔥🔥",   rank: 3 },
    max:      { label: "Max",      rgb: "185,28,28",  flames: "🔥🔥🔥🔥", rank: 4 },
  };
  function effortLevel(ex) { return ex && ex.effort ? EFFORT_LEVELS[ex.effort] : null; }

  // How much weekly volume per muscle counts as "solid" and "plenty" for a given
  // athlete. This shipped as one ladder for everyone — 6 and 12, a trained
  // lifter's numbers — and a correct beginner program (full body, three days,
  // four to six sets a muscle) came back as six separate warnings. A map that
  // cries wolf on its most common case teaches you to stop reading it.
  //
  // Intermediate is deliberately today's exact numbers. Every existing athlete
  // is unset, unset reads as intermediate, so nothing on the roster moves until
  // a level is deliberately assigned. Tunable by eye here and nowhere else — the
  // figure, the chips and the verdict all read these two numbers.
  // Surfaced to users as "training age" — the S&C term for years of real
  // lifting, which is what the ladder actually measures. Ids stay level-words
  // because they're stored on every athletes row; only labels changed.
  // Thresholds tightened 2026-08-13 on Nathan's call: the volume research
  // keeps landing on ~12 weekly sets as plenty even for advanced lifters, so
  // the old 16-set ceiling graded well-built weeks as gaps. Solid rises with
  // training age, plenty caps at 12.
  const TRAINING_LEVELS = [
    { id: "beginner",     name: "Beginner",     emoji: "🌱", years: "Under a year of consistent lifting",  solid: 4,  plenty: 6  },
    { id: "intermediate", name: "Intermediate", emoji: "🌿", years: "One to three years of lifting",       solid: 8,  plenty: 10 },
    { id: "advanced",     name: "Advanced",     emoji: "🌳", years: "Three or more years of hard training", solid: 10, plenty: 12 },
  ];
  const TRAINING_LEVEL_BY_ID = Object.fromEntries(TRAINING_LEVELS.map((l) => [l.id, l]));
  const DEFAULT_TRAINING_LEVEL = "intermediate";
  // ── Training phase (coach-set) ──
  // A cut doesn't need a growth block's volume, but the sets it does get have
  // to be taken hard enough to defend the muscle through a deficit. So a phase
  // does two things at once: it lowers the bands, and it stops counting sets
  // the coach didn't mark intense (ex.effort, the 🔥 picker in the editor).
  //
  // A phase REPLACES the training-age ladder rather than shifting it, so only
  // ever one thing is grading the map. Unset is the third state and means
  // building: today's exact behaviour, every set counted whatever its burn.
  //
  // Deliberately coach-only. Training age is a fact about the athlete and is
  // settable on both sides; which block they are in is programming.
  const TRAINING_PHASES = [
    // Emoji picked for how they RENDER on Windows: the bare ⏸ and 🔻 both come
    // through as flat text glyphs next to the colour ones around them.
    { id: "fatloss", name: "Fat loss", short: "Cut", emoji: "📉",
      solid: 3, plenty: 5, minEffort: "hard",
      blurb: "Eating in a deficit. Fewer sets, and only the hard ones defend muscle." },
    { id: "maintenance", name: "Maintenance", short: "Mnt", emoji: "⚖️",
      solid: 2, plenty: 4, minEffort: "moderate",
      blurb: "Holding what they have. The least work that still keeps it." },
    // Endurance is the one phase where LIGHT sets count. Everywhere else a
    // light set is a warm-up pretending to be work; here the high-rep,
    // sub-maximal work IS the training, so grading it out would report a
    // conditioning block as a week of gaps. Set counts stay low because the
    // priority is elsewhere: the resistance work is support, not the point.
    { id: "endurance", name: "Endurance", short: "End", emoji: "🫁",
      solid: 2, plenty: 4, minEffort: "light",
      blurb: "Conditioning leads. Light, high-rep work counts here, unlike every other goal." },
  ];
  // Hypertrophy is deliberately NOT in that list. It is the no-phase default,
  // and the default grades against training age (4/6 a beginner, 10/12 an
  // advanced lifter). A fixed hypertrophy band would flatten that and hand a
  // beginner an advanced lifter's volume target, so the goal picker names the
  // absence rather than adding a row that overwrites it.
  const NO_PHASE_GOAL = { id: "", name: "Hypertrophy", emoji: "🏗️",
    blurb: "Building. Graded against their training age." };
  const TRAINING_PHASE_BY_ID = Object.fromEntries(TRAINING_PHASES.map((p) => [p.id, p]));
  function phaseOf(client) { return TRAINING_PHASE_BY_ID[client?.trainingPhase] || null; }
  // 0 means the coach never picked one. Mobility rows can never carry a level
  // at all — the picker is withheld on them (the isMob guard on effortBtn) —
  // so they're skipped before this is ever asked.
  function effortRank(ex) {
    const m = effortLevel(ex);
    return m ? m.rank : 0;
  }
  function phaseMinRank(phase) {
    return phase ? (EFFORT_LEVELS[phase.minEffort] || {}).rank || 0 : 0;
  }

  // ── Gear ──
  // What a GYM has, as opposed to how a single exercise is performed (that is
  // an EXERCISE_MODIFIERS "Equipment" tag). Two different questions, and the
  // two vocabularies are bridged by EXERCISE_EQUIPMENT: a realization names the
  // gear it needs and the tag to stamp once that gear is present.
  // Ids match the eq: icon tokens, so the picker needs no new artwork.
  const GEAR = [
    { id: "barbell",    label: "Barbell",       icon: "eq:barbell" },
    { id: "plate",      label: "Plates",        icon: "eq:plate" },
    { id: "dumbbell",   label: "Dumbbells",     icon: "eq:dumbbell" },
    { id: "kettlebell", label: "Kettlebells",   icon: "eq:kettlebell" },
    { id: "trapbar",    label: "Trap bar",      icon: "eq:trapbar" },
    { id: "rack",       label: "Rack",          icon: "eq:rack" },
    { id: "bench",      label: "Bench",         icon: "eq:bench" },
    { id: "cable",      label: "Cable machine", icon: "eq:cable" },
    { id: "pullup",     label: "Pull-up bar",   icon: "eq:pullup" },
    { id: "dipbars",    label: "Dip bars",      icon: "eq:dipbars" },
    { id: "band",       label: "Bands",         icon: "eq:band" },
    { id: "medball",    label: "Med ball",      icon: "eq:medball" },
    { id: "box",        label: "Box",           icon: "eq:box" },
    { id: "sled",       label: "Sled",          icon: "eq:sled" },
    { id: "rower",      label: "Rower",         icon: "eq:rower" },
    { id: "treadmill",  label: "Treadmill",     icon: "eq:treadmill" },
    { id: "jumprope",   label: "Jump rope",     icon: "eq:jumprope" },
  ];
  const GEAR_BY_ID = Object.fromEntries(GEAR.map((g) => [g.id, g]));

  // Unset and unrecognised both resolve to the default. Unrecognised matters
  // because a cloud pull can hand back a value written by a newer build.
  function levelBands(client) {
    // A phase outranks the ladder. Phase rows carry the same { solid, plenty }
    // shape, so every caller of coverageBand() keeps working untouched.
    const ph = phaseOf(client);
    if (ph) return ph;
    return TRAINING_LEVEL_BY_ID[client?.trainingLevel]
      || TRAINING_LEVEL_BY_ID[DEFAULT_TRAINING_LEVEL];
  }

  // The bands come from the athlete, not from a constant. The default keeps
  // every caller that has no athlete in hand on today's ladder.
  function coverageBand(n, bands) {
    const b = bands || TRAINING_LEVEL_BY_ID[DEFAULT_TRAINING_LEVEL];
    if (n >= b.plenty) return 3;
    if (n >= b.solid) return 2;
    if (n >= 1) return 1;
    return 0;
  }

  // 7.5 → "7½". Secondary muscles earn half a set per set (see
  // musclesForExercise), so halves are the only fraction the engine produces —
  // and a vulgar half reads as a count where "7.5" reads as a measurement.
  function covSetsLabel(n) {
    const whole = Math.floor(n || 0);
    const half = (n || 0) - whole >= 0.5;
    if (!whole) return half ? "½" : "0";
    return `${whole}${half ? "½" : ""}`;
  }
  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.training = Object.assign(NS.training || {}, {
    EFFORT_LEVELS, effortLevel,
    TRAINING_LEVELS, TRAINING_LEVEL_BY_ID, DEFAULT_TRAINING_LEVEL,
    TRAINING_PHASES, NO_PHASE_GOAL, TRAINING_PHASE_BY_ID, phaseOf,
    effortRank, phaseMinRank,
    GEAR, GEAR_BY_ID,
    levelBands, coverageBand, covSetsLabel,
  });
})();
