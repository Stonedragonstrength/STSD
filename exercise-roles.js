// What JOB a movement does in a training day.
//
// The ⚡ builder used to open a day with whatever scored highest on
// coverageScore(), which is the sum of a movement's muscle-tag weights from the
// vendored demo database. That is a measure of how richly the database tagged a
// movement, not of how big the lift is: Back Squat is tagged with one muscle and
// scores 1.0, Goblet Squat is tagged with four and scores 4.0. So every squat day
// opened on a Leg Press and a Back Squat never appeared at all.
//
// Roles cannot be derived from that data, and they cannot be derived from the
// library category either — Quads holds Back Squat and Leg Extension side by
// side. So they are stated, the same way exercise-equipment.js states which gear
// a movement needs. Adding an exercise to the library means adding a line here.
//
//   compound   opens a day. Multi-joint, loads heavily, the lift the day is
//              built around.
//   accessory  supports the compound at moderate load. Still multi-joint or
//              still meaningfully loadable, but not what you open on.
//   isolation  single-joint, small-muscle, or core. The end of the day.
//   carry      loaded carries. Always last.
//   skip       real training the builder should not program. Crawls are
//              locomotion filed under Core, and the gap-filler kept seating them
//              on leg days because they pay a lot of small muscles at once.
//
// Keys are exKey(): lowercased, whitespace collapsed, trailing punctuation cut.
window.EXERCISE_ROLES = {
  // ---- Chest ----
  "bench press": "compound",
  "incline bench press": "compound",
  "decline bench press": "compound",
  "dips": "compound",
  "push-up": "accessory",
  "machine chest press": "accessory",
  "incline dumbbell press": "accessory",
  "incline press": "accessory",
  "floor press": "accessory",
  "fly": "isolation",
  "cable fly": "isolation",
  "pec deck": "isolation",
  "pullover": "isolation",
  "svend press": "isolation",

  // ---- Back ----
  "pull-up": "compound",
  "chin-up": "compound",
  "row": "compound",
  "pendlay row": "compound",
  "t-bar row": "compound",
  "rack pull": "compound",
  "lat pulldown": "accessory",
  "wide-grip pulldown": "accessory",
  "chest-supported row": "accessory",
  "seated cable row": "accessory",
  "single-arm row": "accessory",
  "meadows row": "accessory",
  "inverted row": "accessory",
  "straight-arm pulldown": "isolation",
  "back extension": "isolation",
  "dead hang": "isolation",

  // ---- Quads ----
  // Leg Press and Hack Squat are accessories, not openers. They are big
  // movements, but the machine carries the trunk — the free-weight squat is what
  // the day is built around and the press is what supports it.
  "back squat": "compound",
  "front squat": "compound",
  "box squat": "compound",
  "pause squat": "compound",
  "zercher squat": "compound",
  "trap bar deadlift": "compound",
  "leg press": "accessory",
  "hack squat": "accessory",
  "pendulum squat": "accessory",
  "bulgarian split squat": "accessory",
  "split squat": "accessory",
  "lunge": "accessory",
  "walking lunge": "accessory",
  "reverse lunge": "accessory",
  "step-up": "accessory",
  "goblet squat": "accessory",
  "leg extension": "isolation",
  "sissy squat": "isolation",

  // ---- Hamstrings ----
  "deadlift": "compound",
  "romanian deadlift": "compound",
  "stiff-leg deadlift": "compound",
  "good morning": "accessory",
  "nordic curl": "accessory",
  "glute-ham raise": "accessory",
  "single-leg rdl": "accessory",
  "kettlebell swing": "accessory",
  "lying leg curl": "isolation",
  "seated leg curl": "isolation",
  "leg curl": "isolation",
  "cable pull-through": "isolation",

  // ---- Glutes ----
  "hip thrust": "compound",
  "sumo deadlift": "compound",
  "glute bridge": "accessory",
  "b-stance hip thrust": "accessory",
  "curtsy lunge": "accessory",
  "kickback": "isolation",
  "cable kickback": "isolation",
  "donkey kick": "isolation",
  "pull-through": "isolation",
  "frog pump": "isolation",
  "abductor": "isolation",
  "lateral walk": "isolation",
  "clamshell": "isolation",

  // ---- Adductors / Abductors ----
  "lateral lunge": "accessory",
  "cossack squat": "accessory",
  "sumo squat": "accessory",
  "hip adduction": "isolation",
  "adductor machine": "isolation",
  "side-lying adduction": "isolation",
  "copenhagen plank": "isolation",
  "hip abduction": "isolation",

  // ---- Shoulders ----
  "overhead press": "compound",
  "push press": "compound",
  "arnold press": "accessory",
  "seated dumbbell press": "accessory",
  "z press": "accessory",
  "landmine press": "accessory",
  "upright row": "accessory",
  "lateral raise": "isolation",
  "cable lateral raise": "isolation",
  "machine lateral raise": "isolation",
  "leaning lateral raise": "isolation",
  "front raise": "isolation",
  "barbell front raise": "isolation",
  "overhead raise": "isolation",
  "rear delt fly": "isolation",
  "reverse pec deck": "isolation",
  "bent-over reverse fly": "isolation",
  "cable rear delt": "isolation",
  "reverse fly": "isolation",
  "band pull-apart": "isolation",
  "face pull": "isolation",
  "shrug": "isolation",

  // ---- Biceps ----
  "curl": "isolation",
  "hammer curl": "isolation",
  "preacher curl": "isolation",
  "concentration curl": "isolation",
  "ez-bar curl": "isolation",
  "spider curl": "isolation",
  "incline curl": "isolation",
  "cable curl": "isolation",
  "bayesian curl": "isolation",
  "reverse curl": "isolation",
  "zottman curl": "isolation",
  "drag curl": "isolation",
  "wrist curl": "isolation",

  // ---- Triceps ----
  "close-grip bench press": "compound",
  // Isolation, not accessory, and deliberately: "tricep dips" is the same
  // movement as "dips", which is the Push compound. As an accessory the builder
  // could seat both on one push day — a day opening on Dips and then supported
  // by Dips. As an isolation it can only ever arrive as a gap-filler.
  "tricep dips": "isolation",
  "diamond push-up": "accessory",
  "jm press": "accessory",
  "tricep pushdown": "isolation",
  "rope pushdown": "isolation",
  "skull crusher": "isolation",
  "overhead tricep extension": "isolation",
  "cable overhead extension": "isolation",
  "tate press": "isolation",

  // ---- Core ----
  "plank": "isolation",
  "side plank": "isolation",
  "crunch": "isolation",
  "cable crunch": "isolation",
  "bicycle crunch": "isolation",
  "russian twist": "isolation",
  "leg raise": "isolation",
  "hanging leg raise": "isolation",
  "ab wheel rollout": "isolation",
  "dead bug": "isolation",
  "pallof press": "isolation",
  "dragon flag": "isolation",
  "hollow hold": "isolation",
  "v-up": "isolation",
  "toes-to-bar": "isolation",
  "reverse crunch": "isolation",
  "sit-up": "isolation",
  "windshield wiper": "isolation",
  "woodchopper": "isolation",
  "bird dog": "isolation",
  // Locomotion, filed under Core. Real training, but not what the builder is
  // for — see the header.
  "bear crawl": "skip",
  "crab crawl": "skip",
  "leopard crawl": "skip",
  "lizard crawl": "skip",
  "spiderman crawl": "skip",
  "inchworm": "skip",

  // ---- Calves ----
  "calf raise": "isolation",
  "donkey calf raise": "isolation",
  "leg press calf raise": "isolation",
  "seated calf raise": "isolation",
  "standing calf raise": "isolation",
  "single-leg calf raise": "isolation",
  "tibialis raise": "isolation",

  // ---- Bodyweight ----
  "superman": "isolation",

  // ---- Carries ----
  "farmer's carry": "carry",
  "suitcase carry": "carry",
  "overhead carry": "carry",
  "rack carry": "carry",
  "front rack carry": "carry",
  "zercher carry": "carry",
  "trap bar carry": "carry",
  "bear hug carry": "carry",
  "bottoms-up carry": "carry",
  "waiter walk": "carry",
  "sandbag carry": "carry",
  "yoke walk": "carry",
};

// Which movement pattern a lift PRIMARILY belongs to.
//
// The builder used to work this out from the muscle map: a movement "served"
// Squat if any muscle it hit at full weight belonged to a Squat-pattern group.
// That is true of far too much. A Bulgarian Split Squat hits glutes at full
// weight, so it served Hinge, and a hinge day seated it as its accessory — a
// quad movement supporting a deadlift, which took a beginner's quads to 10 sets
// against a plenty of 6 with every exercise already at its trim floor. A Z Press
// hits traps, so it served Pull, and an overhead press turned up as the
// accessory on a pull day.
//
// Emphasis is not derivable from a list of muscles worked, so it is stated.
// Only compounds and accessories need an entry: those are the two tiers seated
// BY pattern. Isolation and carries are placed by the gap filler, which asks the
// looser question — does this movement touch anything this day trains — and that
// is the right question for a finisher.
//
// A compound or accessory with no entry here can never be seated as one. The
// coverage test at the bottom of tests/program-builder.test.js fails if that
// happens, so a new lift cannot go missing quietly.
window.EXERCISE_PATTERN = {
  // ---- Squat ----
  "back squat": "Squat",
  "front squat": "Squat",
  "box squat": "Squat",
  "pause squat": "Squat",
  "zercher squat": "Squat",
  "trap bar deadlift": "Squat",
  "leg press": "Squat",
  "hack squat": "Squat",
  "pendulum squat": "Squat",
  "bulgarian split squat": "Squat",
  "split squat": "Squat",
  "lunge": "Squat",
  "walking lunge": "Squat",
  "reverse lunge": "Squat",
  "step-up": "Squat",
  "goblet squat": "Squat",
  // Adductor-led, but they are squat-pattern movements and a squat day is where
  // a coach puts them.
  "lateral lunge": "Squat",
  "cossack squat": "Squat",
  "sumo squat": "Squat",
  "curtsy lunge": "Squat",

  // ---- Hinge ----
  "deadlift": "Hinge",
  "romanian deadlift": "Hinge",
  "stiff-leg deadlift": "Hinge",
  "sumo deadlift": "Hinge",
  "hip thrust": "Hinge",
  "good morning": "Hinge",
  "nordic curl": "Hinge",
  "glute-ham raise": "Hinge",
  "single-leg rdl": "Hinge",
  "kettlebell swing": "Hinge",
  "glute bridge": "Hinge",
  "b-stance hip thrust": "Hinge",

  // ---- Push ----
  "bench press": "Push",
  "incline bench press": "Push",
  "decline bench press": "Push",
  "dips": "Push",
  "overhead press": "Push",
  "push press": "Push",
  "close-grip bench press": "Push",
  "push-up": "Push",
  "machine chest press": "Push",
  "incline dumbbell press": "Push",
  "incline press": "Push",
  "floor press": "Push",
  "arnold press": "Push",
  "seated dumbbell press": "Push",
  "z press": "Push",
  "landmine press": "Push",
  "diamond push-up": "Push",
  "jm press": "Push",
  // "tricep dips" deliberately has NO pattern. It is the same movement as
  // "dips", which is the Push compound, and with a pattern the builder could
  // seat both on one push day — the day's main lift and its own accessory. With
  // none it can still arrive as a gap-filler, which is all it should ever be.

  // ---- Pull ----
  "pull-up": "Pull",
  "chin-up": "Pull",
  "row": "Pull",
  "pendlay row": "Pull",
  "t-bar row": "Pull",
  "rack pull": "Pull",
  "lat pulldown": "Pull",
  "wide-grip pulldown": "Pull",
  "chest-supported row": "Pull",
  "seated cable row": "Pull",
  "single-arm row": "Pull",
  "meadows row": "Pull",
  "inverted row": "Pull",
  "upright row": "Pull",
};
