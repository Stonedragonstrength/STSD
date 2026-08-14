// What each exercise DEMANDS, so the stat field can tell a lifter from a sprinter.
//
// The pentagon asks a question the library cannot answer: what quality does this
// set train? Category does not know. `Speed/Agility` holds Skater Bound (elastic
// power) and Cone Weave (coordination) side by side, and `Cardio` held Box Jump
// until Plyometrics was split out. Muscle does not know either — that is the
// anatomy map's job, and musclesForExercise() returns nothing at all for most of
// the speed drills. So this is written by hand, name by name, exactly like
// exercise-equipment.js.
//
// It maps names to PROFILES, not to numbers. 246 library names share ~21
// profiles, so there are 21 things to tune instead of 246, and two exercises
// that train the same quality can never drift apart.
//
// Every profile vector sums to 10. That invariant is the whole discipline of
// this file: an exercise cannot be made "better" by adding points to it, only
// by being honest about where its points go. A unit test asserts the sum on
// every row.
//
// Profile fields:
//   w      — what one set of this is worth against the reference of one hard
//            working set. 1 for real work; 0.8 for single-joint accessories,
//            which are genuinely not a hard compound set; 0.4 for mobility,
//            which is Nathan's call that stretching counts but counts small.
//   timed  — the logged number is SECONDS, not reps. Load-bearing: hold and
//            carry seconds live in sets[].reps, so a 3x45s farmer's carry would
//            otherwise read as "45 reps" and score as endurance. Timed profiles
//            skip the rep bands entirely and scale by duration instead.
//   plyo   — how much of a stretch-shortening cycle this really has. 1 = a true
//            SSC with a flight or rebound phase; 0.5 = low-amplitude, partial or
//            countermovement-free (pogo hops, skips, sprints, burpees, a seated
//            box jump); 0 = none. Carried here rather than on a tag because
//            coach tagging leaks: nobody remembers to tag Box Jump.
//   lo/mid/hi/vhi — the split by rep band (1-5 / 6-12 / 13-25 / 26+). Same pot
//            of points in every band, only the split moves, so nothing pays more
//            for chasing a rep count. 26+ is Nathan's endurance threshold.
//   v      — the single split used by timed profiles, which have no bands.
//
// STR in these vectors is a CEILING, not a payout. The scorer gates it on the
// coach's flames (max = full, hard = partial, anything else = none) and hands
// the ungated remainder to CON, so untagged work still scores — it just is not
// strength. Sets of 1-5 reps are the exception and count as near-max regardless,
// because nobody does triples for endurance.
//
// Nothing here ever reads the `Explosive` Style tag. _genTags stamps it at
// random on 60% of primaries, so it is noise, not intent.
//
// The six custom-exercise presets (`ex.sp`) are profile keys from this table:
//   Strength -> "compound"      Muscle -> "isolation"   Conditioning -> "conditioning"
//   Power    -> "ballistic"     Skill  -> "speed-agility"       Mixed -> "neutral"
//
// Vendored like exercise-demos.js and exercise-equipment.js, with its OWN ?v=
// tag in index.html. Loaded immediately before app.js, on coach and athlete
// alike.
window.EXERCISE_STATS = {
  // ---- Profiles -------------------------------------------------------
  // Order within a vector is always STR, AGI, DEX, END, CON so the columns
  // line up and a wrong sum is visible by eye.
  profiles: {
    // Heavy bilateral multi-joint work: squat, bench, deadlift, row, press.
    // The spine of STR, and the reason a powerlifter's field is spiky.
    "compound": { w: 1, timed: false, plyo: 0,
      lo:  { STR: 7, AGI: 0, DEX: 0, END: 0, CON: 3 },
      mid: { STR: 5, AGI: 0, DEX: 0, END: 0, CON: 5 },
      hi:  { STR: 2, AGI: 0, DEX: 0, END: 1, CON: 7 },
      vhi: { STR: 0, AGI: 0, DEX: 0, END: 7, CON: 3 } },

    // Same movements on one leg or one arm. Standing on one leg under load is
    // a control problem before it is a force problem, so DEX is paid in every
    // band — that is what separates a lunge from a leg press.
    "compound-unilateral": { w: 1, timed: false, plyo: 0,
      lo:  { STR: 5, AGI: 0, DEX: 3, END: 0, CON: 2 },
      mid: { STR: 4, AGI: 0, DEX: 3, END: 0, CON: 3 },
      hi:  { STR: 1, AGI: 0, DEX: 3, END: 1, CON: 5 },
      vhi: { STR: 0, AGI: 0, DEX: 2, END: 5, CON: 3 } },

    // Single-joint accessories: curls, raises, extensions, calf work, flyes.
    // Worth 0.8 of a set because a lateral raise is not a hard working set of
    // squats, and the daily cap should not fill up on them.
    "isolation": { w: 0.8, timed: false, plyo: 0,
      lo:  { STR: 5, AGI: 0, DEX: 0, END: 0, CON: 5 },
      mid: { STR: 3, AGI: 0, DEX: 0, END: 0, CON: 7 },
      hi:  { STR: 0, AGI: 0, DEX: 0, END: 1, CON: 9 },
      vhi: { STR: 0, AGI: 0, DEX: 0, END: 6, CON: 4 } },

    // Trunk work done for reps: crunches, leg raises, rollouts, twists.
    "core-dynamic": { w: 1, timed: false, plyo: 0,
      lo:  { STR: 2, AGI: 0, DEX: 2, END: 0, CON: 6 },
      mid: { STR: 0, AGI: 0, DEX: 2, END: 1, CON: 7 },
      hi:  { STR: 0, AGI: 0, DEX: 1, END: 2, CON: 7 },
      vhi: { STR: 0, AGI: 0, DEX: 1, END: 4, CON: 5 } },

    // Quadrupedal crawling. Filed under Core in the library, but the demand is
    // contralateral coordination, so it pays DEX where a crunch pays none.
    "crawl": { w: 1, timed: false, plyo: 0,
      lo:  { STR: 0, AGI: 1, DEX: 4, END: 1, CON: 4 },
      mid: { STR: 0, AGI: 0, DEX: 4, END: 2, CON: 4 },
      hi:  { STR: 0, AGI: 0, DEX: 3, END: 3, CON: 4 },
      vhi: { STR: 0, AGI: 0, DEX: 2, END: 5, CON: 3 } },

    // Ballistic resistance work: the bar or bell is accelerated and released or
    // thrown, not grinded. Swings and push presses. plyo 0.5 because there is
    // real rate-of-force development here without a true flight phase — this is
    // the partial AGI credit the design wanted for ballistic lifting.
    "ballistic": { w: 1, timed: false, plyo: 0.5,
      lo:  { STR: 4, AGI: 4, DEX: 0, END: 0, CON: 2 },
      mid: { STR: 3, AGI: 4, DEX: 0, END: 0, CON: 3 },
      hi:  { STR: 1, AGI: 3, DEX: 0, END: 2, CON: 4 },
      vhi: { STR: 0, AGI: 2, DEX: 0, END: 5, CON: 3 } },

    // Two-footed jumps: box, squat, tuck, depth, countermovement.
    "plyo-jump": { w: 1, timed: false, plyo: 1,
      lo:  { STR: 2, AGI: 7, DEX: 0, END: 0, CON: 1 },
      mid: { STR: 1, AGI: 6, DEX: 1, END: 0, CON: 2 },
      hi:  { STR: 0, AGI: 5, DEX: 1, END: 2, CON: 2 },
      vhi: { STR: 0, AGI: 3, DEX: 0, END: 5, CON: 2 } },

    // Single-leg or lateral takeoffs and landings. Same elasticity as a jump
    // plus a landing you can miss, which is DEX.
    "plyo-bound": { w: 1, timed: false, plyo: 1,
      lo:  { STR: 0, AGI: 6, DEX: 3, END: 0, CON: 1 },
      mid: { STR: 0, AGI: 5, DEX: 3, END: 1, CON: 1 },
      hi:  { STR: 0, AGI: 4, DEX: 3, END: 2, CON: 1 },
      vhi: { STR: 0, AGI: 3, DEX: 2, END: 4, CON: 1 } },

    // Upper-body plyometrics: clap and depth push-ups, plyo pull-ups.
    "plyo-upper": { w: 1, timed: false, plyo: 1,
      lo:  { STR: 3, AGI: 5, DEX: 0, END: 0, CON: 2 },
      mid: { STR: 2, AGI: 4, DEX: 0, END: 0, CON: 4 },
      hi:  { STR: 1, AGI: 3, DEX: 0, END: 2, CON: 4 },
      vhi: { STR: 0, AGI: 2, DEX: 0, END: 4, CON: 4 } },

    // Med ball throws and slams. Elastic like a jump, aimed like a skill.
    "plyo-throw": { w: 1, timed: false, plyo: 1,
      lo:  { STR: 1, AGI: 6, DEX: 2, END: 0, CON: 1 },
      mid: { STR: 0, AGI: 5, DEX: 2, END: 0, CON: 3 },
      hi:  { STR: 0, AGI: 4, DEX: 2, END: 2, CON: 2 },
      vhi: { STR: 0, AGI: 2, DEX: 1, END: 4, CON: 3 } },

    // Low-amplitude bouncing done in reps: pogo hops, jump rope, burpees, high
    // knees. Real SSC, small dose, usually prescribed as conditioning — so the
    // high bands drain toward END the way they actually feel.
    "plyo-low": { w: 1, timed: false, plyo: 0.5,
      lo:  { STR: 0, AGI: 5, DEX: 0, END: 2, CON: 3 },
      mid: { STR: 0, AGI: 4, DEX: 0, END: 3, CON: 3 },
      hi:  { STR: 0, AGI: 3, DEX: 0, END: 5, CON: 2 },
      vhi: { STR: 0, AGI: 2, DEX: 0, END: 6, CON: 2 } },

    // Loaded carries. Timed, and the most literal expression of CON there is:
    // hold a structure together while walking. STR for the load, DEX for grip
    // and posture under it.
    "carry": { w: 1, timed: true, plyo: 0,
      v: { STR: 2, AGI: 0, DEX: 1, END: 1, CON: 6 } },

    // Static holds: planks, hollow holds, dead hangs, supermans. Prescribed in
    // reps by the editor, but the number is always seconds, which is why these
    // are timed even though they are not carries or stretches.
    "iso-hold": { w: 1, timed: true, plyo: 0,
      v: { STR: 1, AGI: 0, DEX: 2, END: 0, CON: 7 } },

    // Holds whose difficulty is stability rather than tension — Copenhagen
    // planks, bird dogs. Same clock as iso-hold, different quality.
    "balance": { w: 1, timed: true, plyo: 0,
      v: { STR: 0, AGI: 1, DEX: 6, END: 0, CON: 3 } },

    // Stretching and mobility. 0.4 of a set: it counts, because Nathan said it
    // counts, and it does not count like a working set, because it is not one.
    "mobility": { w: 0.4, timed: true, plyo: 0,
      v: { STR: 0, AGI: 0, DEX: 8, END: 0, CON: 2 } },

    // Footwork: ladders, cones, shuttles, backpedals. The DEX half of the
    // Speed/Agility category — precision of foot placement at speed.
    "speed-agility": { w: 1, timed: true, plyo: 0,
      v: { STR: 0, AGI: 2, DEX: 6, END: 2, CON: 0 } },

    // The two ladder drills that are genuinely jumps rather than steps.
    // Split out so the plyo flag can be honest about them.
    "speed-hop": { w: 1, timed: true, plyo: 1,
      v: { STR: 0, AGI: 5, DEX: 3, END: 2, CON: 0 } },

    // Sprints and sprint-technique drills: accelerations, flying runs, skips,
    // wall drives. The AGI half of Speed/Agility. plyo 0.5 — sprinting is a
    // stiff-ankle SSC, but a partial one.
    "speed-sprint": { w: 1, timed: true, plyo: 0.5,
      v: { STR: 1, AGI: 5, DEX: 2, END: 2, CON: 0 } },

    // Steady-state machines and running. Scored by duration, so the same
    // treadmill run is worth the same whether it was logged in the cardio block
    // or prescribed inside a program day.
    "cardio-steady": { w: 1, timed: true, plyo: 0,
      v: { STR: 0, AGI: 0, DEX: 0, END: 8, CON: 2 } },

    // Loaded conditioning: sleds, battle ropes. Timed, and structural enough
    // that it is not just an engine — pushing a sled is work capacity.
    "conditioning": { w: 1, timed: true, plyo: 0,
      v: { STR: 1, AGI: 0, DEX: 0, END: 5, CON: 4 } },

    // The last resort, for a name nothing recognises. An unknown exercise
    // logged with weight and reps is resistance work by overwhelming prior, so
    // it reads as a plain STR/CON split and nothing more interesting.
    "neutral": { w: 1, timed: false, plyo: 0,
      lo:  { STR: 6, AGI: 0, DEX: 0, END: 0, CON: 4 },
      mid: { STR: 4, AGI: 0, DEX: 0, END: 0, CON: 6 },
      hi:  { STR: 0, AGI: 0, DEX: 0, END: 2, CON: 8 },
      vhi: { STR: 0, AGI: 0, DEX: 0, END: 6, CON: 4 } },
  },

  // ---- Every library name -------------------------------------------------
  // Keyed by exKey(name): trimmed, lowercased, whitespace collapsed. Grouped by
  // library category in library order, so a new library row is obviously
  // missing here.
  byName: {
    // Chest
    "bench press": "compound",
    "incline bench press": "compound",
    "decline bench press": "compound",
    "fly": "isolation",
    "cable fly": "isolation",
    "push-up": "compound",
    "dips": "compound",
    "pec deck": "isolation",
    "pullover": "isolation",
    "machine chest press": "compound",
    "incline dumbbell press": "compound",
    "floor press": "compound",
    "svend press": "isolation",

    // Back
    "pull-up": "compound",
    "chin-up": "compound",
    "row": "compound",
    "pendlay row": "compound",
    "lat pulldown": "compound",
    "t-bar row": "compound",
    "chest-supported row": "compound",
    "straight-arm pulldown": "isolation",
    "seated cable row": "compound",
    "single-arm row": "compound-unilateral",
    "meadows row": "compound-unilateral",
    "rack pull": "compound",
    "inverted row": "compound",
    "wide-grip pulldown": "compound",
    "back extension": "isolation",

    // Quads
    "back squat": "compound",
    "front squat": "compound",
    "leg press": "compound",
    "hack squat": "compound",
    "trap bar deadlift": "compound",
    "bulgarian split squat": "compound-unilateral",
    "split squat": "compound-unilateral",
    "lunge": "compound-unilateral",
    "walking lunge": "compound-unilateral",
    "leg extension": "isolation",
    "step-up": "compound-unilateral",
    "goblet squat": "compound",
    "box squat": "compound",
    "reverse lunge": "compound-unilateral",
    "sissy squat": "isolation",
    "pause squat": "compound",
    "pendulum squat": "compound",
    "zercher squat": "compound",

    // Hamstrings
    "deadlift": "compound",
    "romanian deadlift": "compound",
    "stiff-leg deadlift": "compound",
    "lying leg curl": "isolation",
    "seated leg curl": "isolation",
    "leg curl": "isolation",
    "nordic curl": "isolation",
    "good morning": "compound",
    "glute-ham raise": "isolation",
    "single-leg rdl": "compound-unilateral",
    "cable pull-through": "isolation",
    // The one lift in the library that is ballistic by definition, not by tag.
    "kettlebell swing": "ballistic",

    // Glutes
    "hip thrust": "compound",
    "glute bridge": "isolation",
    "kickback": "isolation",
    "sumo deadlift": "compound",
    "abductor": "isolation",
    "lateral walk": "isolation",
    "donkey kick": "isolation",
    "pull-through": "isolation",
    "frog pump": "isolation",
    "b-stance hip thrust": "compound-unilateral",
    "curtsy lunge": "compound-unilateral",
    "cable kickback": "isolation",

    // Adductors
    "hip adduction": "isolation",
    "copenhagen plank": "balance",
    "lateral lunge": "compound-unilateral",
    "cossack squat": "compound-unilateral",
    "sumo squat": "compound",
    "side-lying adduction": "isolation",
    "adductor machine": "isolation",

    // Abductors
    "hip abduction": "isolation",

    // Shoulders
    "overhead press": "compound",
    "overhead raise": "isolation",
    "lateral raise": "isolation",
    "front raise": "isolation",
    "rear delt fly": "isolation",
    "arnold press": "compound",
    "upright row": "isolation",
    "face pull": "isolation",
    "shrug": "isolation",
    "seated dumbbell press": "compound",
    "cable lateral raise": "isolation",
    "reverse pec deck": "isolation",
    // Leg drive under an overhead bar: the press is thrown, not grinded.
    "push press": "ballistic",
    "z press": "compound",
    "landmine press": "compound",

    // Biceps
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

    // Triceps
    "tricep pushdown": "isolation",
    "skull crusher": "isolation",
    "close-grip bench press": "compound",
    "overhead tricep extension": "isolation",
    "tricep dips": "compound",
    "diamond push-up": "compound",
    "rope pushdown": "isolation",
    "jm press": "isolation",
    "tate press": "isolation",
    "cable overhead extension": "isolation",

    // Core. The holds are timed and the rest are not, which is the whole reason
    // this category cannot be answered by a category lookup either.
    "plank": "iso-hold",
    "side plank": "iso-hold",
    "crunch": "core-dynamic",
    "cable crunch": "core-dynamic",
    "bicycle crunch": "core-dynamic",
    "russian twist": "core-dynamic",
    "leg raise": "core-dynamic",
    "hanging leg raise": "core-dynamic",
    "ab wheel rollout": "core-dynamic",
    "dead bug": "core-dynamic",
    "pallof press": "core-dynamic",
    "dragon flag": "core-dynamic",
    "hollow hold": "iso-hold",
    "v-up": "core-dynamic",
    "toes-to-bar": "core-dynamic",
    "reverse crunch": "core-dynamic",
    "sit-up": "core-dynamic",
    "windshield wiper": "core-dynamic",
    "bear crawl": "crawl",
    "crab crawl": "crawl",
    "leopard crawl": "crawl",
    "lizard crawl": "crawl",
    "spiderman crawl": "crawl",
    "inchworm": "crawl",

    // Calves
    "calf raise": "isolation",
    "donkey calf raise": "isolation",
    "leg press calf raise": "isolation",
    "seated calf raise": "isolation",
    "standing calf raise": "isolation",
    "single-leg calf raise": "isolation",
    "tibialis raise": "isolation",

    // Carries
    "farmer's carry": "carry",
    "suitcase carry": "carry",
    "overhead carry": "carry",
    "rack carry": "carry",
    "zercher carry": "carry",
    "trap bar carry": "carry",
    "bear hug carry": "carry",
    "bottoms-up carry": "carry",
    "waiter walk": "carry",
    "sandbag carry": "carry",
    "yoke walk": "carry",
    "front rack carry": "carry",

    // Cardio. Machines are timed; the bouncy floor work is prescribed in reps
    // and lands in plyo-low, which is where AGI quietly comes from for an
    // athlete who never jumps on purpose.
    "treadmill run": "cardio-steady",
    "stationary bike": "cardio-steady",
    "rowing": "cardio-steady",
    "jump rope": "plyo-low",
    "sled push": "conditioning",
    "battle ropes": "conditioning",
    "farmer's walk": "carry",
    "assault bike": "cardio-steady",
    "stair climber": "cardio-steady",
    "sprint intervals": "speed-sprint",
    "incline walk": "cardio-steady",
    "ski erg": "cardio-steady",
    "burpee": "plyo-low",
    "high knees": "plyo-low",

    // Bodyweight
    "superman": "iso-hold",

    // Plyometrics. The whole category is stretch-shortening work; what varies
    // is the amplitude and whether the landing is on one foot. Seated Box Jump,
    // Pogo Hop and Ankle Bounce are the partial cases — the first has no
    // countermovement at all, the other two barely leave the floor.
    "box jump": "plyo-jump",
    "box jump over": "plyo-jump",
    "single-leg box jump": "plyo-bound",
    "lateral box jump": "plyo-bound",
    "seated box jump": "plyo-low",
    "depth jump": "plyo-jump",
    "squat jump": "plyo-jump",
    "countermovement jump": "plyo-jump",
    "tuck jump": "plyo-jump",
    "split squat jump": "plyo-bound",
    "jump lunge": "plyo-bound",
    "kneeling jump": "plyo-jump",
    "pogo hop": "plyo-low",
    "ankle bounce": "plyo-low",
    "broad jump series": "plyo-jump",
    "lateral bound": "plyo-bound",
    "skater bound": "plyo-bound",
    "mini-hurdle hops": "plyo-jump",
    "plyo push-up": "plyo-upper",
    "clap push-up": "plyo-upper",
    "depth push-up": "plyo-upper",
    "plyo pull-up": "plyo-upper",
    "med ball slam": "plyo-throw",
    "med ball chest pass": "plyo-throw",
    "med ball rotational throw": "plyo-throw",
    "med ball overhead throw": "plyo-throw",
    "med ball scoop toss": "plyo-throw",

    // Speed/Agility, split into the two qualities it has always contained:
    // ladders, cones and shuttles are footwork (DEX); skips, sprints and the
    // drills that build them are elastic speed (AGI). Ladder Hopscotch and
    // Ladder Single-Leg Hop are the two that are really jumps.
    "ladder two-feet run": "speed-agility",
    "ladder icky shuffle": "speed-agility",
    "ladder in-in-out-out": "speed-agility",
    "ladder lateral shuffle": "speed-agility",
    "ladder ali shuffle": "speed-agility",
    "ladder crossover": "speed-agility",
    "ladder hopscotch": "speed-hop",
    "ladder single-leg hop": "speed-hop",
    "ladder snake": "speed-agility",
    "a-skip": "speed-sprint",
    "b-skip": "speed-sprint",
    "carioca": "speed-agility",
    "5-10-5 pro agility": "speed-agility",
    "t-drill": "speed-agility",
    "box drill": "speed-agility",
    "l-drill": "speed-agility",
    "cone weave": "speed-agility",
    "shuttle run": "speed-agility",
    // Hops, but over inches. Scored as the footwork drill it is coached as.
    "dot drill": "speed-agility",
    "wall drive": "speed-sprint",
    "falling start": "speed-sprint",
    "acceleration sprint": "speed-sprint",
    "flying sprint": "speed-sprint",
    "backpedal drill": "speed-agility",
    "resisted sprint drill": "speed-sprint",
    "reaction sprint": "speed-sprint",

    // Mobility & Stretching. All one profile: the thing being trained is range
    // and control, and no stretch in the library is meaningfully different from
    // another on that axis.
    "couch stretch": "mobility",
    "90/90 hip stretch": "mobility",
    "world's greatest stretch": "mobility",
    "cat-cow": "mobility",
    "hip flexor stretch": "mobility",
    "hamstring stretch": "mobility",
    "pigeon stretch": "mobility",
    "thoracic rotation": "mobility",
    "child's pose": "mobility",
    "downward dog": "mobility",
    "ankle dorsiflexion": "mobility",
    "shoulder dislocates": "mobility",
    "doorway pec stretch": "mobility",
    "deep squat hold": "mobility",
    "cossack stretch": "mobility",
    "seated forward fold": "mobility",
    "butterfly stretch": "mobility",
    "standing quad stretch": "mobility",
    "wrist flexor stretch": "mobility",
    "neck stretch": "mobility",

    // Off-library names that exercise-equipment.js already carries. They come
    // from the anatomy pages' accessory lists, so a coach can end up with one
    // prescribed without it ever being a library row. Kept in step with that
    // file so the two vendored tables never disagree about what a name is.
    "incline press": "compound",
    "barbell front raise": "isolation",
    "machine lateral raise": "isolation",
    "leaning lateral raise": "isolation",
    "wrist curl": "isolation",
    "dead hang": "iso-hold",
    "woodchopper": "core-dynamic",
    "bent-over reverse fly": "isolation",
    "cable rear delt": "isolation",
    "band pull-apart": "isolation",
    "reverse fly": "isolation",
    "bird dog": "balance",
    "clamshell": "isolation",
  },

  // ---- Category fallback --------------------------------------------------
  // For a name the table has never seen but the library category does place —
  // a coach's custom exercise filed on a shelf, mostly. One row per category,
  // set to that shelf's centre of mass rather than its most famous lift: an
  // unrecognised Shoulders exercise is far likelier to be another raise than
  // another overhead press.
  //
  // "" is the true last resort, and it is also what every custom exercise
  // resolves to on the athlete's device, where the custom list does not exist.
  fallback: {
    "Chest": "compound",
    "Back": "compound",
    "Quads": "compound",
    "Hamstrings": "compound",
    "Glutes": "isolation",
    "Adductors": "isolation",
    "Abductors": "isolation",
    "Shoulders": "isolation",
    "Biceps": "isolation",
    "Triceps": "isolation",
    "Core": "core-dynamic",
    "Calves": "isolation",
    "Carries": "carry",
    "Cardio": "cardio-steady",
    "Bodyweight": "compound",
    "Plyometrics": "plyo-jump",
    "Speed/Agility": "speed-agility",
    "Mobility & Stretching": "mobility",
    "": "neutral",
  },
};
