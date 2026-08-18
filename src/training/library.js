// Extracted from app.js — Phase 2 (Training) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/training/library.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
//
// The exercise library and the name classifiers move as one module: every
// classifier is a category lookup into the library (a mobility name IS
// membership in the Mobility & Stretching category), so separating them
// would split one fact across two files.
//
// The one thing the classifiers need that this module cannot see is the
// coach's CUSTOM exercises, which live in app state. app.js publishes its
// reader as globalThis.STSD.app.customExerciseList (in its pull block, so
// it exists before anything can call a classifier), and the shim below
// reads it at CALL time — never captured at load, per the extraction
// contract. Standalone (a spec, the athlete side before app.js publishes)
// it reads as "no custom exercises", which is exactly what those contexts
// have.
(function () {
  "use strict";

  function customExerciseList() {
    return globalThis.STSD.app?.customExerciseList?.() || [];
  }

  // Carry-type exercises are prescribed and logged as weight × TIME (seconds),
  // never reps. Library carries qualify by name; coach-made ones persist
  // ex.timed from makeExercise. (kind stays "strength" — weights still apply,
  // unlike mobility holds.)
  function exIsTimed(ex) {
    return !!ex && (ex.timed === true || isCarryName(ex.name));
  }

  const EXERCISE_LIBRARY = [
    { cat: "Chest",      ex: ["Bench Press","Incline Bench Press","Decline Bench Press","Fly","Cable Fly","Push-Up","Dips","Pec Deck","Pullover","Machine Chest Press","Incline Dumbbell Press","Floor Press","Svend Press"] },
    { cat: "Back",       ex: ["Pull-Up","Chin-Up","Row","Pendlay Row","Lat Pulldown","T-Bar Row","Chest-Supported Row","Straight-Arm Pulldown","Seated Cable Row","Single-Arm Row","Meadows Row","Rack Pull","Inverted Row","Wide-Grip Pulldown","Back Extension"] },
    { cat: "Quads",      ex: ["Back Squat","Front Squat","Leg Press","Hack Squat","Trap Bar Deadlift","Bulgarian Split Squat","Split Squat","Lunge","Walking Lunge","Leg Extension","Step-Up","Goblet Squat","Box Squat","Reverse Lunge","Sissy Squat","Pause Squat","Pendulum Squat","Zercher Squat"] },
    { cat: "Hamstrings", ex: ["Deadlift","Romanian Deadlift","Stiff-Leg Deadlift","Lying Leg Curl","Seated Leg Curl","Leg Curl","Nordic Curl","Good Morning","Glute-Ham Raise","Single-Leg RDL","Cable Pull-Through","Kettlebell Swing"] },
    { cat: "Glutes",     ex: ["Hip Thrust","Glute Bridge","Kickback","Sumo Deadlift","Abductor","Lateral Walk","Donkey Kick","Pull-Through","Frog Pump","B-Stance Hip Thrust","Curtsy Lunge","Cable Kickback"] },
    { cat: "Adductors",  ex: ["Hip Adduction","Copenhagen Plank","Lateral Lunge","Cossack Squat","Sumo Squat","Side-Lying Adduction","Adductor Machine"] },
    { cat: "Abductors",  ex: ["Hip Abduction"] },
    { cat: "Shoulders",  ex: ["Overhead Press","Overhead Raise","Lateral Raise","Front Raise","Rear Delt Fly","Arnold Press","Upright Row","Face Pull","Shrug","Seated Dumbbell Press","Cable Lateral Raise","Reverse Pec Deck","Push Press","Z Press","Landmine Press"] },
    { cat: "Biceps",     ex: ["Curl","Hammer Curl","Preacher Curl","Concentration Curl","EZ-Bar Curl","Spider Curl","Incline Curl","Cable Curl","Bayesian Curl","Reverse Curl","Zottman Curl","Drag Curl"] },
    { cat: "Triceps",    ex: ["Tricep Pushdown","Skull Crusher","Close-Grip Bench Press","Overhead Tricep Extension","Tricep Dips","Diamond Push-Up","Rope Pushdown","JM Press","Tate Press","Cable Overhead Extension"] },
    { cat: "Core",       ex: ["Plank","Side Plank","Crunch","Cable Crunch","Bicycle Crunch","Russian Twist","Leg Raise","Hanging Leg Raise","Ab Wheel Rollout","Dead Bug","Pallof Press","Dragon Flag","Hollow Hold","V-Up","Toes-to-Bar","Reverse Crunch","Sit-Up","Windshield Wiper","Bear Crawl","Crab Crawl","Leopard Crawl","Lizard Crawl","Spiderman Crawl","Inchworm"] },
    { cat: "Calves",     ex: ["Calf Raise","Donkey Calf Raise","Leg Press Calf Raise","Seated Calf Raise","Standing Calf Raise","Single-Leg Calf Raise","Tibialis Raise"] },
    { cat: "Carries",    ex: ["Farmer's Carry","Suitcase Carry","Overhead Carry","Rack Carry","Zercher Carry","Trap Bar Carry","Bear Hug Carry","Bottoms-Up Carry","Waiter Walk","Sandbag Carry","Yoke Walk","Front Rack Carry"] },
    { cat: "Cardio",     ex: ["Treadmill Run","Stationary Bike","Rowing","Jump Rope","Sled Push","Battle Ropes","Farmer's Walk","Assault Bike","Stair Climber","Sprint Intervals","Incline Walk","Ski Erg","Burpee","High Knees"] },
    { cat: "Bodyweight", ex: ["Superman"] },
    // Plyometrics is its OWN category, deliberately not folded into
    // Speed/Agility: SPEED_CATS makes everything in that category a
    // hold-for-time card (sets × seconds, no weight), and plyo work is
    // prescribed in REPS and is sometimes loaded. A separate category also
    // means "is this a stretch-shortening movement" is answerable from the
    // library instead of needing a per-exercise tag.
    //
    // Box Jump moved here from Cardio, and Broad Jump Series / Lateral Bound /
    // Skater Bound / Mini-Hurdle Hops moved here from Speed/Agility, where a
    // category lookup could never find them together. The Ladder* family stays
    // in Speed/Agility — those are footwork, not jumps.
    { cat: "Plyometrics", ex: ["Box Jump","Box Jump Over","Single-Leg Box Jump","Lateral Box Jump","Seated Box Jump","Depth Jump","Squat Jump","Countermovement Jump","Tuck Jump","Split Squat Jump","Jump Lunge","Kneeling Jump","Pogo Hop","Ankle Bounce","Broad Jump Series","Lateral Bound","Skater Bound","Mini-Hurdle Hops","Plyo Push-Up","Clap Push-Up","Depth Push-Up","Plyo Pull-Up","Med Ball Slam","Med Ball Chest Pass","Med Ball Rotational Throw","Med Ball Overhead Throw","Med Ball Scoop Toss"] },
    { cat: "Speed/Agility", ex: ["Ladder Two-Feet Run","Ladder Icky Shuffle","Ladder In-In-Out-Out","Ladder Lateral Shuffle","Ladder Ali Shuffle","Ladder Crossover","Ladder Hopscotch","Ladder Single-Leg Hop","Ladder Snake","A-Skip","B-Skip","Carioca","5-10-5 Pro Agility","T-Drill","Box Drill","L-Drill","Cone Weave","Shuttle Run","Dot Drill","Wall Drive","Falling Start","Acceleration Sprint","Flying Sprint","Backpedal Drill","Resisted Sprint Drill","Reaction Sprint"] },
    { cat: "Mobility & Stretching", ex: ["Couch Stretch","90/90 Hip Stretch","World's Greatest Stretch","Cat-Cow","Hip Flexor Stretch","Hamstring Stretch","Pigeon Stretch","Thoracic Rotation","Child's Pose","Downward Dog","Ankle Dorsiflexion","Shoulder Dislocates","Doorway Pec Stretch","Deep Squat Hold","Cossack Stretch","Seated Forward Fold","Butterfly Stretch","Standing Quad Stretch","Wrist Flexor Stretch","Neck Stretch"] },
  ];
  // Categories whose exercises are prescribed as holds-for-time (sets × seconds),
  // not weight × reps. Exercises added from these get kind:"mobility".
  const MOBILITY_CATS = ["Mobility & Stretching"];
  const MOBILITY_NAMES = new Set(
    EXERCISE_LIBRARY.filter((c) => MOBILITY_CATS.includes(c.cat)).flatMap((c) => c.ex)
  );
  function isMobilityName(name) {
    if (MOBILITY_NAMES.has(name)) return true;
    // Custom exercises filed under a mobility category are holds too.
    return customExerciseList().some((c) => c.name === name && MOBILITY_CATS.includes(c.cat));
  }
  // Speed/agility drills (ladder work, sprints, cone drills) are prescribed the
  // same way — rounds × seconds, no weight — so they reuse the kind:"mobility"
  // card machinery, but render in their own ⚡ section (not under Stretching).
  const SPEED_CATS = ["Speed/Agility"];
  const SPEED_NAMES = new Set(
    EXERCISE_LIBRARY.filter((c) => SPEED_CATS.includes(c.cat)).flatMap((c) => c.ex)
  );
  function isSpeedName(name) {
    if (SPEED_NAMES.has(name)) return true;
    return customExerciseList().some((c) => c.name === name && SPEED_CATS.includes(c.cat));
  }
  // Either flavour of hold-for-time card (stretch or drill): sets × seconds, no
  // weight. Both carry kind:"mobility" so all the no-weight/PR-exclusion
  // plumbing applies; use this wherever that card behaviour is what matters.
  function isHoldName(name) { return isMobilityName(name) || isSpeedName(name); }
  const HOLD_CATS = MOBILITY_CATS.concat(SPEED_CATS);
  const HOLD_NAMES = new Set([...MOBILITY_NAMES, ...SPEED_NAMES]);
  // Hold-duration options (seconds) for the coach's mobility prescription picker.
  const HOLD_SEC_VALUES = ["10", "15", "20", "30", "45", "60", "90", "120"];
  // Categories whose exercises are weight × time (seconds) — see exIsTimed().
  const TIMED_CATS = ["Carries"];
  const CARRY_NAMES = new Set(
    EXERCISE_LIBRARY.filter((c) => TIMED_CATS.includes(c.cat)).flatMap((c) => c.ex)
  );
  function isCarryName(name) {
    if (!name) return false;
    if (CARRY_NAMES.has(name)) return true;
    // Any name that says "carry" counts (covers coach-typed variants on both
    // the coach and athlete side, where the custom list isn't available).
    if (/\bcarr(y|ies)\b/i.test(name)) return true;
    return customExerciseList().some((c) => c.name === name && TIMED_CATS.includes(c.cat));
  }
  // Time options (seconds) for the coach's carry prescription picker.
  const CARRY_SEC_VALUES = ["10", "15", "20", "30", "40", "45", "60", "90", "120"];

  // Flat, de-duped, alphabetised list of every library exercise — feeds the
  // native <datalist> that powers the type-to-add field on each day.
  const ALL_EXERCISE_NAMES = [...new Set(EXERCISE_LIBRARY.flatMap((c) => c.ex))]
    .sort((a, b) => a.localeCompare(b));

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.training = Object.assign(NS.training || {}, {
    EXERCISE_LIBRARY,
    MOBILITY_CATS, MOBILITY_NAMES, isMobilityName,
    SPEED_CATS, SPEED_NAMES, isSpeedName,
    isHoldName, HOLD_CATS, HOLD_NAMES, HOLD_SEC_VALUES,
    TIMED_CATS, CARRY_NAMES, isCarryName, CARRY_SEC_VALUES,
    exIsTimed,
    ALL_EXERCISE_NAMES,
  });
})();
