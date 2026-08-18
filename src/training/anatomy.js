// Extracted from app.js — Phase 2 (Training) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/training/anatomy.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
//
// The anatomy tables, the exercise→muscle map, and the demo-photo matcher
// move as one module: the map's three sources are the curated anatomy
// lists, the demo database's tags, and the library category — so the map
// IS these tables plus the matcher that reads the demo data.
//
// Two things this module reads that it cannot own:
//  - window.EXERCISE_DEMOS / window.EXERCISE_MUSCLES — the vendored data
//    files, read through the global at CALL time (specs define `window`
//    and load the real files);
//  - app state (the coach's custom exercises, and the coach-tuned anatomy
//    edits) — read through the getters app.js publishes on
//    globalThis.STSD.app, at call time, never captured. Standalone both
//    read as absent, which is what a spec or a signed-out page has.
(function () {
  "use strict";

  // From src/training/tags.js and library.js, which index.html loads first
  // (the boot smoke executes the tags in that order). Checked at load so a
  // missing or misordered tag fails HERE, by name.
  const { exKey, EXERCISE_LIBRARY } = globalThis.STSD.training;
  if (typeof exKey !== "function" || !Array.isArray(EXERCISE_LIBRARY)) {
    throw new Error("src/training/tags.js and library.js must load before anatomy.js");
  }

  function customExerciseList() {
    return globalThis.STSD.app?.customExerciseList?.() || [];
  }
  // ============================================================
  // Anatomy Library — a browsable body map of the major muscle
  // groups, shown to both coach and athlete. Each group teaches
  // what the muscle does, coaching cues, common mistakes, and
  // example lifts pulled from the exercise library above. Purely
  // a reference: static content, no state, no saving.
  // ============================================================
  const ANATOMY_GROUPS = [
    { id: "chest", name: "Chest", region: "front", pattern: "Push",
      sub: "Pectoralis major & minor",
      does: "Pushes your arms forward and across your body. The engine behind every press and push-up.",
      cues: ["Pull your shoulder blades down and back before you press.", "Drive through the mid-chest, not the front of the shoulders."],
      mistakes: ["Flaring the elbows straight out to 90 degrees.", "Bouncing the bar off the chest to cheat the rep."],
      anchors: ["Bench Press", "Push-Up"],
      accessories: ["Incline Dumbbell Press", "Cable Fly", "Dips", "Machine Chest Press"],
      stretches: ["Doorway pec stretch: forearm on the frame, step through.", "Lying arm-across-chest opener on the floor."],
      injuries: ["Pec strain or tear from heavy benching without a warm-up.", "Front-of-shoulder pain when a tight chest gets overworked."],
      warmup: "Band pull-aparts and a few light press sets to prime the shoulders.",
      pairs: "Back and biceps (push and pull balance).",
      frequency: "2x per week, 48h between hard chest days.",
      why: "Pressing power for blocking, throwing, and shoving opponents off you." },
    { id: "delts-front", name: "Front Delts", region: "front", pattern: "Push",
      sub: "Anterior deltoid",
      does: "Raises your arm to the front and drives the first inches of every overhead and bench press.",
      cues: ["Press straight up with the ribs down, not arched.", "Let the front delt lead the press, then hand off to the chest."],
      mistakes: ["Turning every shoulder day into front-raise volume.", "Arching the low back to fake more press height."],
      anchors: ["Overhead Press", "Front Raise"],
      accessories: ["Arnold Press", "Incline Press", "Landmine Press", "Barbell Front Raise"],
      stretches: ["Clasp your hands behind your back and lift to open the front.", "Cross-body arm pull across the chest."],
      injuries: ["Front-shoulder impingement from too much pressing.", "Biceps-tendon irritation at the front of the shoulder."],
      warmup: "Light front and lateral raises to warm the shoulder.",
      pairs: "Rear delts and lats to keep the shoulder balanced.",
      frequency: "2x per week; also hit on every press.",
      why: "Drives overhead power for throwing, jamming, and pressing." },
    { id: "delts-side", name: "Side Delts", region: "both", pattern: "Push",
      sub: "Lateral deltoid",
      does: "Lifts your arm out to the side and builds the width that caps a strong-looking shoulder.",
      cues: ["Raise to shoulder height and lead with the elbow.", "Tip the pinky slightly up at the top, like pouring a bottle."],
      mistakes: ["Swinging heavy dumbbells up with momentum.", "Shrugging the traps into every raise."],
      anchors: ["Lateral Raise", "Overhead Press"],
      accessories: ["Cable Lateral Raise", "Upright Row", "Machine Lateral Raise", "Leaning Lateral Raise"],
      stretches: ["Cross-body arm pull to stretch the outer shoulder.", "Overhead reach with a gentle side lean."],
      injuries: ["Rotator-cuff impingement from heavy overhead volume.", "A pinch when the arm is raised past parallel."],
      warmup: "Banded lateral raises and slow shoulder circles.",
      pairs: "Rear delts for a balanced, healthy shoulder.",
      frequency: "2 to 3x per week; recovers fast at light loads.",
      why: "Shoulder width and stability for contact and overhead work." },
    { id: "biceps", name: "Biceps", region: "front", pattern: "Pull",
      sub: "Biceps brachii, brachialis",
      does: "Bends your elbow and turns your palm up. The showpiece on the front of the arm.",
      cues: ["Keep the elbows pinned to your sides.", "Lower slowly, fighting the weight down."],
      mistakes: ["Rocking the torso to fling the weight.", "Cutting the range short at the top and bottom."],
      anchors: ["Curl", "Chin-Up"],
      accessories: ["Hammer Curl", "Incline Curl", "Preacher Curl", "Cable Curl"],
      stretches: ["Arm straight, palm flat on a wall, slowly turn away.", "Doorway biceps stretch with a straight arm behind you."],
      injuries: ["Biceps tendinitis at the front of the shoulder or elbow.", "Biceps tear from heavy curls or a missed deadlift grip."],
      warmup: "A couple of light curl sets to warm the elbow.",
      pairs: "Triceps (the other half of the arm).",
      frequency: "2x per week; also work on every pull.",
      why: "Pulling and carrying strength for grappling and climbing." },
    { id: "forearms", name: "Forearms & Grip", region: "front", pattern: "Isolation",
      sub: "Wrist flexors, extensors, brachioradialis",
      does: "Controls your grip and wrist. Strong forearms let every other lift hold on longer.",
      cues: ["Squeeze the bar like you are crushing it.", "Train grip at the end so it never limits the big lifts."],
      mistakes: ["Reaching for straps on every set and never building grip.", "Rushing wrist curls with no control."],
      anchors: ["Farmer's Carry", "Hammer Curl"],
      accessories: ["Reverse Curl", "Wrist Curl", "Dead Hang", "Zottman Curl"],
      stretches: ["Arm out, pull the fingers back to stretch the flexors.", "Flex the wrist down and pull gently for the extensors."],
      injuries: ["Golfer's elbow on the inside from heavy gripping and curls.", "Tennis elbow on the outside from overusing the extensors."],
      warmup: "Wrist circles and a short, light dead hang.",
      pairs: "Biceps and back on pulling days.",
      frequency: "3 to 4x per week; grip recovers quickly.",
      why: "Grip that never quits, from the last rep to the final round." },
    { id: "core", name: "Core & Abs", region: "front", pattern: "Core",
      sub: "Rectus abdominis, transverse abdominis",
      does: "Braces your spine and passes force between the upper and lower body. The link in every heavy lift.",
      cues: ["Brace like someone is about to poke your stomach.", "Exhale hard at the top of a crunch."],
      mistakes: ["Pulling on the neck during sit-ups.", "Only ever crunching, never bracing under load."],
      anchors: ["Plank", "Hanging Leg Raise"],
      accessories: ["Cable Crunch", "Ab Wheel Rollout", "Dead Bug", "Hollow Hold"],
      stretches: ["Cobra or upward-dog stretch to open the abs.", "Standing backbend with the arms reaching overhead."],
      injuries: ["Ab strain from explosive twisting or over-crunching.", "Hernia risk when bracing poorly under heavy load."],
      warmup: "Dead bugs and a short plank to switch the brace on.",
      pairs: "Lower back (front and back of the trunk).",
      frequency: "3 to 4x per week; recovers fast.",
      why: "Transfers power between upper and lower body in every athletic move." },
    { id: "obliques", name: "Obliques", region: "front", pattern: "Core",
      sub: "Internal & external obliques",
      does: "Rotates and side-bends your torso and resists twist. Your natural weight belt on the sides.",
      cues: ["Move slow and feel the twist come from the waist.", "On anti-rotation moves, resist the pull, do not create it."],
      mistakes: ["Swinging on Russian twists with a rounded back.", "Chasing heavy side-bends with no control."],
      anchors: ["Side Plank", "Pallof Press"],
      accessories: ["Russian Twist", "Bicycle Crunch", "Windshield Wiper", "Woodchopper"],
      stretches: ["Standing side bend, reaching one arm overhead.", "Seated spinal twist, hand behind you."],
      injuries: ["Oblique strain from heavy rotation or side bends.", "A side-of-waist tweak from twisting under load."],
      warmup: "Slow side planks and gentle trunk twists.",
      pairs: "Abs and lower back for a full trunk.",
      frequency: "2 to 3x per week.",
      why: "Rotational power for swinging, throwing, and punching." },
    { id: "quads", name: "Quadriceps", region: "front", pattern: "Squat",
      sub: "Rectus femoris, vastus muscles",
      does: "Straightens your knee and drives you out of a squat. The biggest muscles on the front of the legs.",
      cues: ["Push the floor away and keep the knees tracking over the toes.", "Stay tall through the chest out of the hole."],
      mistakes: ["Letting the knees cave inward.", "Cutting depth and never reaching parallel."],
      anchors: ["Back Squat", "Leg Press"],
      accessories: ["Front Squat", "Bulgarian Split Squat", "Leg Extension", "Walking Lunge"],
      stretches: ["Standing quad stretch: pull the heel to your glute.", "Kneeling hip-flexor and quad stretch."],
      injuries: ["Quad strain from sprinting or squatting while cold.", "Jumper's knee: patellar-tendon pain below the kneecap."],
      warmup: "Bodyweight squats and leg swings.",
      pairs: "Hamstrings and glutes (front and back of the legs).",
      frequency: "2x per week, 48 to 72h between heavy leg days.",
      why: "Explosive first step, jumps, and driving out of a low stance." },
    { id: "adductors", name: "Adductors", region: "front", pattern: "Isolation",
      sub: "Adductor magnus, longus, brevis (inner thigh)",
      does: "Pulls your legs toward the midline and stabilizes wide stances. Key for squats and sideways power.",
      cues: ["Sit into wide stances and feel the stretch inside the thigh.", "Control the return, do not let the legs snap in."],
      mistakes: ["Bouncing out of a wide squat with no tension.", "Ignoring them until a groin strain shows up."],
      anchors: ["Cossack Squat", "Sumo Deadlift"],
      accessories: ["Hip Adduction", "Copenhagen Plank", "Lateral Lunge", "Sumo Squat"],
      stretches: ["Butterfly stretch with the soles of the feet together.", "Wide-stance side (Cossack) lunge stretch."],
      injuries: ["Groin strain from wide stances or quick lateral moves.", "Adductor tendinitis near the pelvis."],
      warmup: "Lateral lunges and gentle groin openers.",
      pairs: "Abductors (the outer hip).",
      frequency: "2x per week; ease in to avoid groin strains.",
      why: "Lateral power and stability for cutting and changing direction." },
    { id: "calves", name: "Calves", region: "both", pattern: "Isolation",
      sub: "Gastrocnemius, soleus, tibialis",
      does: "Points and flexes your foot and springs you off the ground. The often-skipped lower leg.",
      cues: ["Pause and squeeze hard at the top.", "Get a full stretch at the bottom of every rep."],
      mistakes: ["Bouncing reps with a tiny range of motion.", "Only training the standing calf, never the seated."],
      anchors: ["Standing Calf Raise", "Seated Calf Raise"],
      accessories: ["Leg Press Calf Raise", "Single-Leg Calf Raise", "Tibialis Raise", "Jump Rope"],
      stretches: ["Wall calf stretch with the back leg straight.", "Bend the back knee to reach the lower soleus."],
      injuries: ["A pulled calf from sprinting or jumping.", "Achilles tendinitis at the back of the heel."],
      warmup: "Slow bodyweight calf raises and ankle circles.",
      pairs: "Tibialis (front of the shin) for balanced ankles.",
      frequency: "2 to 4x per week; handles frequency well.",
      why: "Spring off the ground for sprinting, jumping, and quick cuts." },
    { id: "delts-rear", name: "Rear Delts", region: "back", pattern: "Pull",
      sub: "Posterior deltoid",
      does: "Pulls your arm back and out and balances all that pressing with healthy shoulders.",
      cues: ["Pull with the elbows, wide and back.", "Keep it light and feel the back of the shoulder work."],
      mistakes: ["Letting the mid-back take over the movement.", "Skipping them entirely and pressing all day."],
      anchors: ["Face Pull", "Rear Delt Fly"],
      accessories: ["Reverse Pec Deck", "Bent-Over Reverse Fly", "Cable Rear Delt", "Band Pull-Apart"],
      stretches: ["Cross-body arm pull with the elbow held high.", "Reach one arm across the body and hug it in."],
      injuries: ["Rear-shoulder strain from heavy reverse flies.", "Upper-back tightness from weak, neglected rear delts."],
      warmup: "Band pull-aparts and face-pull holds.",
      pairs: "Front delts and chest to balance all the pressing.",
      frequency: "2 to 3x per week; hard to overtrain when light.",
      why: "Keeps shoulders healthy so you can press and throw pain-free." },
    { id: "lats", name: "Lats", region: "back", pattern: "Pull",
      sub: "Latissimus dorsi",
      does: "Pulls your arms down and back and gives your back its width. The widest muscle you own.",
      cues: ["Think elbows to your back pockets, not hands to chest.", "Start each pull by driving the shoulder blades down."],
      mistakes: ["Yanking with the arms instead of the back.", "Cutting pull-ups short of a full hang and squeeze."],
      anchors: ["Pull-Up", "Lat Pulldown"],
      accessories: ["Straight-Arm Pulldown", "Single-Arm Row", "Pullover", "Seated Cable Row"],
      stretches: ["Hang from a bar and let the lats lengthen.", "Kneel, reach both arms forward, and sink the chest."],
      injuries: ["Lat strain from explosive pull-ups or rows.", "A shoulder or lower-rib tweak from over-yanking pulldowns."],
      warmup: "Straight-arm pulldowns and a bar hang.",
      pairs: "Chest and front delts (push and pull balance).",
      frequency: "2x per week, 48h between heavy pull days.",
      why: "Pulling power for climbing, rowing, and hauling an opponent in." },
    { id: "rhomboids", name: "Rhomboids & Mid-Back", region: "back", pattern: "Pull",
      sub: "Rhomboids, mid-trapezius",
      does: "Squeezes your shoulder blades together and sets a tall, proud upper back. The posture muscles.",
      cues: ["Pinch the shoulder blades together and hold a beat.", "Lead rows by retracting the blades, not bending the arms."],
      mistakes: ["Rushing rows and never fully squeezing.", "Rounding the upper back under the load."],
      anchors: ["Row", "Face Pull"],
      accessories: ["Seated Cable Row", "Chest-Supported Row", "Band Pull-Apart", "Reverse Fly"],
      stretches: ["Hug yourself and round the upper back forward.", "Reach both arms forward to spread the shoulder blades."],
      injuries: ["Mid-back knots from rounded posture and desk time.", "Rhomboid strain from heavy rowing with sloppy form."],
      warmup: "Band pull-aparts and scapular retractions.",
      pairs: "Chest (front of the upper body).",
      frequency: "2 to 3x per week.",
      why: "Tall posture and a stable base to press and pull from." },
    { id: "traps", name: "Upper Traps", region: "back", pattern: "Pull",
      sub: "Upper trapezius",
      does: "Shrugs, sets your shoulder blades, and supports your neck. Frames the whole upper back.",
      cues: ["Shrug straight up toward the ears, not forward.", "Hold the top squeeze for a beat."],
      mistakes: ["Rolling the shoulders in circles under load.", "Only training the upper traps, never the mid and lower."],
      anchors: ["Shrug", "Face Pull"],
      // Yoke Walk is here because the demo database says a yoke is a quad
      // movement — p:["quadriceps"] with seven lower-body secondaries and
      // nothing above the waist, for a bar that rests on your traps. That map
      // reaches only Squat and Hinge patterns, so the builder could not seat a
      // yoke anywhere but a leg day: 20 of 23 placements over 300 four-day
      // weeks landed on the squat. The curated lists union ON TOP of the demo
      // entry (which wins over exercise-muscles.js), so naming it here is the
      // one layer that can correct it. The leg credit is kept — a yoke does
      // load the legs; it just isn't only legs.
      accessories: ["Rack Pull", "Farmer's Carry", "Upright Row", "Rear Delt Fly", "Yoke Walk"],
      stretches: ["Ear toward shoulder for a gentle neck side stretch.", "Chin to chest to lengthen the upper traps."],
      injuries: ["Neck and trap tension from shrugging or daily stress.", "Strain from jerking heavy shrugs or upright rows."],
      warmup: "Light shrugs and gentle neck rolls.",
      pairs: "Front delts and chest to balance posture.",
      frequency: "2x per week; also hit on deadlifts and carries.",
      why: "A strong neck and traps help absorb contact and whiplash." },
    { id: "triceps", name: "Triceps", region: "back", pattern: "Push",
      sub: "Triceps brachii (three heads)",
      does: "Straightens your elbow and finishes every press. Two-thirds of your upper-arm size.",
      cues: ["Keep the elbows tucked and pointed forward.", "Lock out fully and squeeze at the bottom."],
      mistakes: ["Letting the elbows flare and drift.", "Going so heavy it turns into a shoulder move."],
      anchors: ["Close-Grip Bench Press", "Tricep Pushdown"],
      accessories: ["Skull Crusher", "Overhead Tricep Extension", "Tricep Dips", "Rope Pushdown"],
      stretches: ["Overhead triceps stretch with the elbow behind the head.", "Cross-body reach to lengthen the back of the arm."],
      injuries: ["Triceps tendinitis at the back of the elbow.", "Elbow strain from heavy lockouts and skull crushers."],
      warmup: "Light pushdowns to warm the elbow.",
      pairs: "Biceps (the other half of the arm).",
      frequency: "2x per week; also work on every press.",
      why: "Lockout power for pressing, throwing, and punching." },
    { id: "lowerback", name: "Lower Back", region: "back", pattern: "Hinge",
      sub: "Erector spinae (spinal erectors)",
      does: "Extends and protects your spine and keeps posture tall under load. The pillar of every hinge and squat.",
      cues: ["Keep a flat, neutral spine, never rounded under load.", "Brace hard before you lift, not after."],
      mistakes: ["Rounding the low back on deadlifts.", "Hyperextending violently at lockout."],
      anchors: ["Deadlift", "Back Extension"],
      accessories: ["Good Morning", "Romanian Deadlift", "Bird Dog", "Superman"],
      stretches: ["Child's pose to decompress the low back.", "Knees to chest on your back, with a gentle rock."],
      injuries: ["Lower-back strain from rounding on deadlifts.", "Disc irritation from lifting with a bent spine."],
      warmup: "Cat-cow and a few light hip hinges.",
      pairs: "Abs (front of the trunk).",
      frequency: "1 to 2x per week; give it 72h after heavy pulls.",
      why: "Protects the spine and holds posture under every heavy load." },
    { id: "glutes", name: "Glutes", region: "back", pattern: "Hinge",
      sub: "Gluteus maximus, medius, minimus",
      does: "Drives your hips forward and powers every jump, sprint, and lockout. The strongest muscle in the body.",
      cues: ["Finish by squeezing the glutes and standing tall.", "Push the hips back to load them, do not just bend the knees."],
      mistakes: ["Turning hip thrusts into a low-back arch.", "Quarter-repping and never fully locking the hips out."],
      anchors: ["Hip Thrust", "Sumo Deadlift"],
      accessories: ["Glute Bridge", "Bulgarian Split Squat", "Cable Kickback", "Curtsy Lunge"],
      stretches: ["Figure-four stretch: ankle over the opposite knee.", "Pigeon pose for a deeper glute stretch."],
      injuries: ["Glute strain from heavy hip thrusts or sprints.", "Piriformis pain that can mimic sciatica."],
      warmup: "Glute bridges and banded walks to switch them on.",
      pairs: "Quads (front of the legs).",
      frequency: "2 to 3x per week.",
      why: "The engine for sprint speed, jumps, and driving through contact." },
    { id: "hamstrings", name: "Hamstrings", region: "back", pattern: "Hinge",
      sub: "Biceps femoris, semitendinosus, semimembranosus",
      does: "Bends your knee and extends your hip. The back-of-thigh muscles behind speed and hinge strength.",
      cues: ["Feel the stretch down the back of the thigh on RDLs.", "Keep a soft knee and push the hips back."],
      mistakes: ["Turning RDLs into squats by bending the knees.", "Only ever training them with machine curls."],
      anchors: ["Romanian Deadlift", "Lying Leg Curl"],
      accessories: ["Stiff-Leg Deadlift", "Nordic Curl", "Glute-Ham Raise", "Good Morning"],
      stretches: ["Standing forward fold with soft knees.", "Seated single-leg reach toward the toes."],
      injuries: ["A pulled hamstring from sprinting at top speed.", "Tightness or a tear from heavy RDLs done cold."],
      warmup: "Leg swings and light Romanian deadlifts.",
      pairs: "Quads (front of the legs).",
      frequency: "2x per week; build up slowly, they strain easily.",
      why: "Sprint speed, and the brakes that prevent pulls and tears." },
    { id: "abductors", name: "Abductors", region: "back", pattern: "Isolation",
      sub: "Gluteus medius & minimus (outer hip)",
      does: "Lifts your leg out to the side and stabilizes your hips when you walk, run, and squat.",
      cues: ["Drive the knee out against tension on every rep.", "Keep the hips level, do not let one side drop."],
      mistakes: ["Rushing band walks with collapsing knees.", "Skipping them and letting the knees cave on squats."],
      anchors: ["Hip Abduction", "Lateral Walk"],
      accessories: ["Abductor", "Curtsy Lunge", "Clamshell", "Cable Kickback"],
      stretches: ["Cross one leg behind the other and lean into the hip.", "Lying figure-four to reach the outer hip."],
      injuries: ["Outer-hip strain from heavy side and band work.", "IT-band irritation on the outside of the knee."],
      warmup: "Banded side steps and clamshells.",
      pairs: "Adductors (the inner thigh).",
      frequency: "2 to 3x per week; light and frequent works well.",
      why: "Keeps knees tracking and hips stable when you cut and land." },
  ];
  const ANATOMY_BY_ID = Object.fromEntries(ANATOMY_GROUPS.map((g) => [g.id, g]));
  // The individual muscles that make up each group (the anatomical breakdown
  // behind each group's short `sub` line), rendered as a list in the detail card.
  const ANATOMY_MUSCLES = {
    chest: ["Pectoralis major", "Pectoralis minor", "Serratus anterior"],
    "delts-front": ["Anterior deltoid (front head)"],
    "delts-side": ["Lateral deltoid (side head)"],
    biceps: ["Biceps brachii (long head)", "Biceps brachii (short head)", "Brachialis", "Coracobrachialis"],
    forearms: ["Brachioradialis", "Flexor carpi radialis", "Flexor carpi ulnaris", "Extensor carpi radialis", "Extensor carpi ulnaris", "Flexor digitorum", "Extensor digitorum", "Pronator teres", "Supinator"],
    core: ["Rectus abdominis", "Transverse abdominis"],
    obliques: ["External oblique", "Internal oblique"],
    quads: ["Rectus femoris", "Vastus lateralis", "Vastus medialis", "Vastus intermedius"],
    adductors: ["Adductor magnus", "Adductor longus", "Adductor brevis", "Gracilis", "Pectineus"],
    calves: ["Gastrocnemius (medial head)", "Gastrocnemius (lateral head)", "Soleus", "Tibialis anterior", "Tibialis posterior", "Fibularis (peroneus)"],
    "delts-rear": ["Posterior deltoid (rear head)"],
    lats: ["Latissimus dorsi", "Teres major"],
    rhomboids: ["Rhomboid major", "Rhomboid minor", "Trapezius (middle fibers)", "Trapezius (lower fibers)"],
    traps: ["Trapezius (upper fibers)", "Levator scapulae"],
    triceps: ["Triceps brachii (long head)", "Triceps brachii (lateral head)", "Triceps brachii (medial head)", "Anconeus"],
    lowerback: ["Erector spinae (iliocostalis)", "Erector spinae (longissimus)", "Erector spinae (spinalis)", "Multifidus", "Quadratus lumborum"],
    glutes: ["Gluteus maximus", "Gluteus medius", "Gluteus minimus", "Tensor fasciae latae"],
    hamstrings: ["Biceps femoris (long head)", "Biceps femoris (short head)", "Semitendinosus", "Semimembranosus"],
    abductors: ["Gluteus medius", "Gluteus minimus", "Tensor fasciae latae"],
  };
  // Which groups list in each view's legend (region "both" shows in both).
  const ANATOMY_VIEW_GROUPS = {
    front: ANATOMY_GROUPS.filter((g) => g.region === "front" || g.region === "both").map((g) => g.id),
    back: ANATOMY_GROUPS.filter((g) => g.region === "back" || g.region === "both").map((g) => g.id),
  };

  // ============================================================
  // Coverage — what an athlete's current week actually asks of each muscle.
  // Three exercise→muscle maps already existed and none of them reached the
  // body map. They layer, best first:
  //   1. the curated anchors/accessories above — the only source that tells a
  //      lateral raise from a rear delt fly, because a human wrote it;
  //   2. the demo database's primary/secondary tags — far more names, but it
  //      files every shoulder movement under one "shoulders" bucket;
  //   3. the exercise library's own category — the floor, catching the rest.
  // ============================================================
  // Names are normalised with the existing exKey() so this index agrees with
  // every other name lookup in the app rather than inventing a second spelling.

  // A "shoulders" tag credits all three delts rather than inventing a head.
  const DEMO_MUSCLE_GROUPS = {
    abdominals: ["core"], quadriceps: ["quads"], hamstrings: ["hamstrings"],
    glutes: ["glutes"], calves: ["calves"], adductors: ["adductors"],
    abductors: ["abductors"], chest: ["chest"], lats: ["lats"],
    "middle back": ["rhomboids"], "lower back": ["lowerback"], traps: ["traps"],
    shoulders: ["delts-front", "delts-side", "delts-rear"],
    biceps: ["biceps"], triceps: ["triceps"], forearms: ["forearms"],
  };
  const LIB_CAT_GROUPS = {
    Chest: ["chest"], Back: ["lats", "rhomboids"], Quads: ["quads"],
    Hamstrings: ["hamstrings"], Glutes: ["glutes"], Adductors: ["adductors"],
    Abductors: ["abductors"], Shoulders: ["delts-front", "delts-side", "delts-rear"],
    Biceps: ["biceps"], Triceps: ["triceps"], Core: ["core", "obliques"],
    Calves: ["calves"], Carries: ["forearms", "traps"],
  };

  let _curatedExIdx = null;
  function curatedExIndex() {
    if (_curatedExIdx) return _curatedExIdx;
    _curatedExIdx = new Map();
    ANATOMY_GROUPS.forEach((g) => {
      [...(g.anchors || []), ...(g.accessories || [])].forEach((n) => {
        const k = exKey(n);
        if (!k) return;
        const arr = _curatedExIdx.get(k) || [];
        if (!arr.includes(g.id)) arr.push(g.id);
        _curatedExIdx.set(k, arr);
      });
    });
    return _curatedExIdx;
  }
  let _libCatIdx = null;
  function libCatIndex() {
    if (_libCatIdx) return _libCatIdx;
    _libCatIdx = new Map();
    EXERCISE_LIBRARY.forEach((c) => (c.ex || []).forEach((n) => _libCatIdx.set(exKey(n), c.cat)));
    return _libCatIdx;
  }

  // → [{ id, weight }]. Weight 1 where the muscle does the work, 0.5 where it
  // only assists, so a deadlift does not read as a full forearm session.
  //
  // The curated lists and the demo tags UNION rather than short-circuit. They
  // answer different questions: "Deadlift" appears in the curated list for
  // Lower Back because it is a good example of one, not because it is the only
  // thing a deadlift trains. Letting the curated hit win outright printed a
  // week of squats, deadlifts and RDLs as zero glute work. The library category
  // stays a true fallback — it is the coarsest source, so it only speaks when
  // nothing else recognised the name at all.
  // A coach-tuned credit list for one exercise, or null. Lives inside
  // anatomyEdits so it rides the existing coach→athlete sync (the whole blob
  // goes up one column and comes back through anatomy_edits_for_athlete).
  // Athlete-first read for the same reason getAnatomyEdits does it: on an
  // athlete device trainerData exists but is empty, and empty must not win.
  function exCreditOverride(k) {
    // THE ONE BODY CHANGE in this module: the athlete-first state read
    // (state.clientData?.coachAnatomyEdits || state.trainerData?.anatomyEdits)
    // moved behind the STSD.app.anatomyEdits getter app.js publishes beside
    // its pull block — read at call time, never captured, absent = no edits.
    const edits = globalThis.STSD.app?.anatomyEdits?.();
    const ov = edits?.exCredits?.[k];
    if (!Array.isArray(ov)) return null;
    return ov.filter((h) => ANATOMY_BY_ID[h.id])
      .map((h) => ({ id: h.id, weight: h.w === 0.5 ? 0.5 : 1 }));
  }

  function musclesForExercise(ex) {
    const name = typeof ex === "string" ? ex : ex?.name;
    const k = exKey(name);
    if (!k) return [];
    // The coach looked at THIS exercise and said what it counts — that answer
    // replaces the derived one outright, empty list included ("counts nothing").
    const ov = exCreditOverride(k);
    if (ov) return ov;
    const best = new Map();
    const add = (id, weight) => { if (!(best.get(id) >= weight)) best.set(id, weight); };
    const curated = curatedExIndex().get(k) || [];
    curated.forEach((id) => add(id, 1));
    // The demo database has one "shoulders" bucket for all three delt heads. If
    // the curated list already named the head — a lateral raise is side delts,
    // a face pull is rear — letting that bucket fan back out across all three
    // undoes the only source that knew the difference, and every delt reads the
    // same number. So the coarse bucket only speaks when nothing finer has.
    const curatedDelt = curated.some((id) => id.startsWith("delts-"));
    // The demo database first, and exercise-muscles.js where it has nothing.
    // Same shape, same vocabulary, same scoring — see that file's header for why
    // 47 of the movements a week is built around had no entry at all.
    const entry = (typeof ex === "string" ? demoEntryForName(name) : demoForExercise(ex))
      || (window.EXERCISE_MUSCLES || {})[k];
    if (entry) {
      // A SECONDARY tag naming a region is split across the muscles it names.
      //
      // "shoulders" is the only tag covering more than one muscle, and as a
      // secondary it was paying 0.5 to each of the three delt heads — 1.5 sets
      // of delt credit for a movement that merely involves the shoulders, which
      // is more than a Lateral Raise earns for the muscle it exists to train.
      // That is what froze the builder's isolation tier: Pallof Press scored 4.5
      // and took the slot on 79 of 100 push days, while a lateral raise appeared
      // zero times in 320 days. Nathan, reading the same numbers: "lower the
      // svend press credits if needed."
      //
      // PRIMARY tags are left whole on purpose. A movement whose primary muscle
      // is "shoulders" really does train all three heads, and splitting those
      // too re-baselines every athlete's coverage map — measured, it left 14
      // muscles under solid on a four-day week that had none.
      const fan = (m, weight, split) => {
        if (m === "shoulders" && curatedDelt) return;
        const ids = DEMO_MUSCLE_GROUPS[m] || [];
        const share = split && ids.length > 1 ? weight / ids.length : weight;
        ids.forEach((id) => add(id, share));
      };
      (entry.p || []).forEach((m) => fan(m, 1, false));
      (entry.s || []).forEach((m) => fan(m, 0.5, true));
    }
    if (!best.size) {
      const cat = libCatIndex().get(k)
        || (customExerciseList().find((c) => exKey(c.name) === k) || {}).cat;
      (LIB_CAT_GROUPS[cat] || []).forEach((id) => add(id, 1));
    }
    return [...best].map(([id, weight]) => ({ id, weight }));
  }

  // -------- Exercise demo photos --------
  // Stills come from the public-domain free-exercise-db (see ATTRIBUTIONS.md).
  // exercise-demos.js vendors just the lookup metadata; the photos themselves
  // stay on the CDN, so demos need a connection (everything else works offline).
  const DEMO_CDN = "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/";
  // Coach-typed shorthand → the words the dataset actually uses.
  const DEMO_ABBREV = {
    db: "dumbbell", bb: "barbell", kb: "kettlebell", ez: "e z curl bar",
    ohp: "overhead press", rdl: "romanian deadlift", sldl: "stiff leg deadlift",
    bor: "bent over row", bp: "bench press", ghr: "glute ham raise",
    pullup: "pull up", pushup: "push up", chinup: "chin up", situp: "sit up",
    stepup: "step up", legpress: "leg press", dip: "dips",
  };
  const DEMO_STOP = new Set(["the", "a", "an", "with", "and", "of", "for", "to", "on", "in",
    "each", "side", "per", "alternating", "alt", "sec", "second", "rep", "set", "x"]);
  // The staples, pinned by hand. Fuzzy matching does fine on the long tail but
  // picks odd variations for the bread-and-butter lifts (plain "Deadlift" scored
  // its way to "Axle Deadlift"), and those are the ones athletes see every week.
  // Keys are demoTokens(name).join(" ") — already singular and expanded.
  const DEMO_ALIAS = {
    "squat": "Barbell_Squat",
    "back squat": "Barbell_Squat",
    "barbell squat": "Barbell_Squat",
    "bench press": "Barbell_Bench_Press_-_Medium_Grip",
    "barbell bench press": "Barbell_Bench_Press_-_Medium_Grip",
    "flat bench press": "Barbell_Bench_Press_-_Medium_Grip",
    "incline bench press": "Barbell_Incline_Bench_Press_-_Medium_Grip",
    "deadlift": "Barbell_Deadlift",
    "barbell deadlift": "Barbell_Deadlift",
    "conventional deadlift": "Barbell_Deadlift",
    "overhead press": "Standing_Military_Press",
    "military press": "Standing_Military_Press",
    "strict press": "Standing_Military_Press",
    "shoulder press": "Barbell_Shoulder_Press",
    "push press": "Push_Press",
    "pull up": "Pullups",
    "chin up": "Chin-Up",
    "pulldown": "Wide-Grip_Lat_Pulldown",
    "lat pulldown": "Wide-Grip_Lat_Pulldown",
    "dumbbell row": "One-Arm_Dumbbell_Row",
    "barbell row": "Bent_Over_Barbell_Row",
    "bent over row": "Bent_Over_Barbell_Row",
    "pendlay row": "Bent_Over_Barbell_Row",
    "leg curl": "Lying_Leg_Curls",
    "hamstring curl": "Lying_Leg_Curls",
    "calf raise": "Standing_Calf_Raises",
    "cable fly": "Cable_Crossover",
    "chest fly": "Cable_Crossover",
    "reverse fly": "Cable_Rear_Delt_Fly",
    "rear delt fly": "Cable_Rear_Delt_Fly",
    "dips": "Dips_-_Chest_Version",
    "farmer carry": "Farmers_Walk",
    "farmer walk": "Farmers_Walk",
    "loaded carry": "Farmers_Walk",
    "walking lunge": "Bodyweight_Walking_Lunge",
    "lunge": "Barbell_Lunge",
    "split squat": "Split_Squats",
    "bulgarian split squat": "Split_Squats",
    "hip thrust": "Barbell_Hip_Thrust",
    "sit up": "Sit-Up",
    "crunch": "Crunches",
  };

  function demoImgUrl(id, n) { return DEMO_CDN + encodeURIComponent(id) + "/" + n + ".jpg"; }

  // Names are free text on both sides, so both the coach's name and the dataset
  // name get reduced to the same bag of words before they're compared.
  function demoTokens(name) {
    const raw = String(name || "").toLowerCase()
      .replace(/\([^)]*\)/g, " ")   // "(each side)" and friends aren't part of the movement
      .replace(/[^a-z0-9]+/g, " ");
    const out = [];
    for (const piece of raw.split(" ")) {
      if (!piece) continue;
      let t = piece;
      // Singularize before expanding, so "Pullups"/"pull-ups"/"Chin Ups" all
      // land on the same tokens. Short words count ("ups" → "up").
      if (t.length > 2 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
      const expanded = DEMO_ABBREV[t] || t;
      for (const word of expanded.split(" ")) {
        if (!word || DEMO_STOP.has(word)) continue;
        out.push(word);
      }
    }
    return out;
  }

  let _demoIndex = null;
  function demoIndex() {
    if (_demoIndex) return _demoIndex;
    const list = Array.isArray(window.EXERCISE_DEMOS) ? window.EXERCISE_DEMOS : [];
    const byId = new Map(), exact = new Map(), sorted = new Map(), all = [];
    for (const e of list) {
      if (!e.m) continue; // no photos, nothing to show
      byId.set(e.i, e);
      const toks = demoTokens(e.n);
      const key = toks.join(" ");
      if (!exact.has(key)) exact.set(key, e);
      const skey = toks.slice().sort().join(" ");
      if (!sorted.has(skey)) sorted.set(skey, e);
      all.push({ e, set: new Set(toks) });
    }
    _demoIndex = { byId, exact, sorted, all, cache: new Map() };
    return _demoIndex;
  }

  function findDemoByName(name) {
    const idx = demoIndex();
    if (!idx.all.length) return null;
    const toks = demoTokens(name);
    if (!toks.length) return null;
    const key = toks.join(" ");
    if (idx.cache.has(key)) return idx.cache.get(key);
    let hitEntry = (DEMO_ALIAS[key] && idx.byId.get(DEMO_ALIAS[key]))
      || idx.exact.get(key)
      || idx.sorted.get(toks.slice().sort().join(" "))
      || null;
    if (!hitEntry) {
      // Fuzzy: mostly reward covering the coach's words, a little for not
      // dragging in a pile of extra ones ("Dumbbell Row" → "Bent Over Two-Dumbbell Row").
      const qset = new Set(toks);
      let best = null, bestScore = 0;
      for (const c of idx.all) {
        let hit = 0;
        for (const t of qset) if (c.set.has(t)) hit++;
        if (!hit) continue;
        const score = (hit / qset.size) * 0.8 + (hit / c.set.size) * 0.2;
        if (score > bestScore) { bestScore = score; best = c.e; }
      }
      if (bestScore >= 0.7) hitEntry = best;
    }
    idx.cache.set(key, hitEntry);
    return hitEntry;
  }

  // Curated name -> demo id for every built-in library exercise. Generated once
  // by running findDemoByName over the whole library, then hand-audited: wrong
  // fuzzy picks were repointed and no-matches that exist under a different
  // dataset name were recovered. A `null` value means "checked, the dataset has
  // no good demo" — so we show nothing rather than let the fuzzy matcher guess a
  // wrong one. Names NOT in here (athlete customs, one-offs) still fall through
  // to findDemoByName. Keys are the exact library names; edit a line to fix a
  // match. Regenerate with tools/genmap (see scratchpad notes in the PR).
  const LIBRARY_DEMO_MAP = {
    // Chest
    "Bench Press": "Barbell_Bench_Press_-_Medium_Grip",
    "Incline Bench Press": "Barbell_Incline_Bench_Press_-_Medium_Grip",
    "Decline Bench Press": "Decline_Barbell_Bench_Press",
    "Fly": "Dumbbell_Flyes",
    "Cable Fly": "Cable_Crossover",
    "Push-Up": "Pushups",
    "Dips": "Dips_-_Chest_Version",
    "Pec Deck": "Butterfly",
    "Pullover": "Straight-Arm_Dumbbell_Pullover",
    "Machine Chest Press": null,
    "Incline Dumbbell Press": "Incline_Dumbbell_Press",
    "Floor Press": "Alternating_Floor_Press",
    "Svend Press": "Svend_Press",
    // Back
    "Pull-Up": "Pullups",
    "Chin-Up": "Chin-Up",
    "Row": "Bent_Over_Barbell_Row",
    "Pendlay Row": "Bent_Over_Barbell_Row",
    "Lat Pulldown": "Wide-Grip_Lat_Pulldown",
    "T-Bar Row": "Lying_T-Bar_Row",
    "Chest-Supported Row": null,
    "Straight-Arm Pulldown": "Straight-Arm_Pulldown",
    "Seated Cable Row": "Seated_Cable_Rows",
    "Single-Arm Row": "One-Arm_Dumbbell_Row",
    "Meadows Row": null,
    "Rack Pull": "Rack_Pulls",
    "Inverted Row": "Inverted_Row",
    "Wide-Grip Pulldown": "Wide-Grip_Lat_Pulldown",
    "Back Extension": "Hyperextensions_Back_Extensions",
    // Quads
    "Back Squat": "Barbell_Squat",
    "Front Squat": "Front_Squat_Clean_Grip",
    "Leg Press": "Leg_Press",
    "Hack Squat": "Hack_Squat",
    "Trap Bar Deadlift": "Trap_Bar_Deadlift",
    "Bulgarian Split Squat": "Split_Squats",
    "Split Squat": "Split_Squats",
    "Lunge": "Barbell_Lunge",
    "Walking Lunge": "Bodyweight_Walking_Lunge",
    "Leg Extension": "Leg_Extensions",
    "Step-Up": "Barbell_Step_Ups",
    "Goblet Squat": "Goblet_Squat",
    "Box Squat": "Box_Squat",
    "Reverse Lunge": "Crossover_Reverse_Lunge",
    "Sissy Squat": "Weighted_Sissy_Squat",
    "Pause Squat": "Barbell_Squat",
    "Pendulum Squat": null,
    "Zercher Squat": "Zercher_Squats",
    // Hamstrings
    "Deadlift": "Barbell_Deadlift",
    "Romanian Deadlift": "Romanian_Deadlift",
    "Stiff-Leg Deadlift": "Stiff-Legged_Barbell_Deadlift",
    "Lying Leg Curl": "Lying_Leg_Curls",
    "Seated Leg Curl": "Seated_Leg_Curl",
    "Leg Curl": "Lying_Leg_Curls",
    "Nordic Curl": null,
    "Good Morning": "Good_Morning",
    "Glute-Ham Raise": "Glute_Ham_Raise",
    "Single-Leg RDL": null,
    "Cable Pull-Through": "Pull_Through",
    "Kettlebell Swing": "One-Arm_Kettlebell_Swings",
    // Glutes
    "Hip Thrust": "Barbell_Hip_Thrust",
    "Glute Bridge": "Barbell_Glute_Bridge",
    "Kickback": "Glute_Kickback",
    "Sumo Deadlift": "Sumo_Deadlift",
    "Abductor": "Thigh_Abductor",
    "Lateral Walk": null,
    "Donkey Kick": null,
    "Pull-Through": "Pull_Through",
    "Frog Pump": null,
    "B-Stance Hip Thrust": "Barbell_Hip_Thrust",
    "Curtsy Lunge": null,
    "Cable Kickback": "One-Legged_Cable_Kickback",
    // Adductors
    "Hip Adduction": "Band_Hip_Adductions",
    "Copenhagen Plank": null,
    "Lateral Lunge": null,
    "Cossack Squat": null,
    "Sumo Squat": null,
    "Side-Lying Adduction": null,
    "Adductor Machine": "Thigh_Adductor",
    // Abductors
    "Hip Abduction": "Thigh_Abductor",
    // Shoulders
    "Overhead Press": "Standing_Military_Press",
    "Overhead Raise": null,
    "Lateral Raise": "Side_Lateral_Raise",
    "Front Raise": "Front_Cable_Raise",
    "Rear Delt Fly": "Cable_Rear_Delt_Fly",
    "Arnold Press": "Arnold_Dumbbell_Press",
    "Upright Row": "Upright_Barbell_Row",
    "Face Pull": "Face_Pull",
    "Shrug": "Barbell_Shrug",
    "Seated Dumbbell Press": "Seated_Dumbbell_Press",
    "Cable Lateral Raise": "Cable_Seated_Lateral_Raise",
    "Reverse Pec Deck": "Reverse_Machine_Flyes",
    "Push Press": "Push_Press",
    "Z Press": null,
    "Landmine Press": null,
    // Biceps
    "Curl": "Barbell_Curl",
    "Hammer Curl": "Hammer_Curls",
    "Preacher Curl": "Preacher_Curl",
    "Concentration Curl": "Concentration_Curls",
    "EZ-Bar Curl": "EZ-Bar_Curl",
    "Spider Curl": "Spider_Curl",
    "Incline Curl": "Incline_Dumbbell_Curl",
    "Cable Curl": "Cable_Preacher_Curl",
    "Bayesian Curl": null,
    "Reverse Curl": "Reverse_Barbell_Curl",
    "Zottman Curl": "Zottman_Curl",
    "Drag Curl": "Drag_Curl",
    // Triceps
    "Tricep Pushdown": "Triceps_Pushdown",
    "Skull Crusher": "Band_Skull_Crusher",
    "Close-Grip Bench Press": "Close-Grip_Barbell_Bench_Press",
    "Overhead Tricep Extension": "Standing_Dumbbell_Triceps_Extension",
    "Tricep Dips": "Dips_-_Triceps_Version",
    "Diamond Push-Up": "Push-Ups_-_Close_Triceps_Position",
    "Rope Pushdown": "Triceps_Pushdown_-_Rope_Attachment",
    "JM Press": "JM_Press",
    "Tate Press": "Tate_Press",
    "Cable Overhead Extension": "Cable_Rope_Overhead_Triceps_Extension",
    // Core
    "Plank": "Plank",
    "Side Plank": "Plank",
    "Crunch": "Crunches",
    "Cable Crunch": "Cable_Crunch",
    "Bicycle Crunch": "Air_Bike",
    "Russian Twist": "Russian_Twist",
    "Leg Raise": "Side_Leg_Raises",
    "Hanging Leg Raise": "Hanging_Leg_Raise",
    "Ab Wheel Rollout": "Ab_Roller",
    "Dead Bug": "Dead_Bug",
    "Pallof Press": "Pallof_Press",
    "Dragon Flag": null,
    "Hollow Hold": null,
    "V-Up": null,
    "Toes-to-Bar": null,
    "Reverse Crunch": "Reverse_Crunch",
    "Sit-Up": "Sit-Up",
    "Windshield Wiper": null,
    "Bear Crawl": null,
    "Crab Crawl": null,
    "Leopard Crawl": null,
    "Lizard Crawl": null,
    "Spiderman Crawl": "Spider_Crawl",
    "Inchworm": "Inchworm",
    // Calves
    "Calf Raise": "Standing_Calf_Raises",
    "Donkey Calf Raise": "Donkey_Calf_Raises",
    "Leg Press Calf Raise": "Calf_Press_On_The_Leg_Press_Machine",
    "Seated Calf Raise": "Seated_Calf_Raise",
    "Standing Calf Raise": "Standing_Calf_Raises",
    "Single-Leg Calf Raise": "Dumbbell_Seated_One-Leg_Calf_Raise",
    "Tibialis Raise": null,
    // Carries
    "Farmer's Carry": "Farmers_Walk",
    "Suitcase Carry": null,
    "Overhead Carry": null,
    "Rack Carry": null,
    "Zercher Carry": null,
    "Trap Bar Carry": null,
    "Bear Hug Carry": null,
    "Bottoms-Up Carry": null,
    "Waiter Walk": null,
    "Sandbag Carry": null,
    "Yoke Walk": "Yoke_Walk",
    "Front Rack Carry": null,
    // Cardio
    "Treadmill Run": "Running_Treadmill",
    "Stationary Bike": "Recumbent_Bike",
    "Rowing": "Rowing_Stationary",
    "Jump Rope": "Rope_Jumping",
    "Sled Push": "Sled_Push",
    "Battle Ropes": null,
    "Farmer's Walk": "Farmers_Walk",
    "Assault Bike": "Air_Bike",
    "Stair Climber": "Stairmaster",
    "Sprint Intervals": null,
    "Incline Walk": "Walking_Treadmill",
    "Ski Erg": null,
    "Box Jump": "Box_Jump_Multiple_Response",
    "Burpee": null,
    "High Knees": null,
    // Bodyweight
    "Superman": "Superman",
    // Speed/Agility
    "Ladder Two-Feet Run": null,
    "Ladder Icky Shuffle": null,
    "Ladder In-In-Out-Out": null,
    "Ladder Lateral Shuffle": null,
    "Ladder Ali Shuffle": null,
    "Ladder Crossover": null,
    "Ladder Hopscotch": null,
    "Ladder Single-Leg Hop": "Single-Leg_Hop_Progression",
    "Ladder Snake": null,
    "A-Skip": null,
    "B-Skip": null,
    "Carioca": "Carioca_Quick_Step",
    "5-10-5 Pro Agility": null,
    "T-Drill": null,
    "Box Drill": null,
    "L-Drill": null,
    "Cone Weave": null,
    "Shuttle Run": null,
    "Lateral Bound": "Lateral_Bound",
    "Skater Bound": null,
    "Broad Jump Series": null,
    "Dot Drill": null,
    "Mini-Hurdle Hops": "Hurdle_Hops",
    "Wall Drive": null,
    "Falling Start": null,
    "Acceleration Sprint": null,
    "Flying Sprint": null,
    "Backpedal Drill": null,
    "Resisted Sprint Drill": null,
    "Reaction Sprint": null,
    // Mobility & Stretching
    "Couch Stretch": null,
    "90/90 Hip Stretch": null,
    "World's Greatest Stretch": "Worlds_Greatest_Stretch",
    "Cat-Cow": "Cat_Stretch",
    "Hip Flexor Stretch": "Intermediate_Hip_Flexor_and_Quad_Stretch",
    "Hamstring Stretch": "Hamstring_Stretch",
    "Pigeon Stretch": null,
    "Thoracic Rotation": null,
    "Child's Pose": "Childs_Pose",
    "Downward Dog": null,
    "Ankle Dorsiflexion": null,
    "Shoulder Dislocates": null,
    "Doorway Pec Stretch": null,
    "Deep Squat Hold": null,
    "Cossack Stretch": null,
    "Seated Forward Fold": null,
    "Butterfly Stretch": null,
    "Standing Quad Stretch": "Standing_Elevated_Quad_Stretch",
    "Wrist Flexor Stretch": null,
    "Neck Stretch": "Side_Neck_Stretch",
  };

  // Curated lookup by exercise name: the map is authoritative for built-in
  // library lifts (including an explicit "no demo" as null); anything else
  // falls through to the fuzzy matcher.
  function demoEntryForName(name) {
    if (Object.prototype.hasOwnProperty.call(LIBRARY_DEMO_MAP, name)) {
      const id = LIBRARY_DEMO_MAP[name];
      return id ? (demoIndex().byId.get(id) || null) : null;
    }
    return findDemoByName(name);
  }

  // "none" = the coach explicitly turned the demo off for this exercise.
  function demoForExercise(ex) {
    if (!ex) return null;
    if (ex.demoId === "none") return null;
    if (ex.demoId) return demoIndex().byId.get(ex.demoId) || null;
    return demoEntryForName(ex.name);
  }

  function demoSearch(query, limit = 40) {
    const idx = demoIndex();
    const toks = demoTokens(query);
    if (!toks.length) return idx.all.slice(0, limit).map((c) => c.e);
    const scored = [];
    for (const c of idx.all) {
      let hit = 0;
      for (const t of toks) if (c.set.has(t)) hit++;
      // Partial words keep the list alive while the coach is still typing.
      if (!hit) {
        const joined = [...c.set].join(" ");
        if (!toks.every((t) => joined.includes(t))) continue;
        hit = toks.length * 0.6;
      }
      scored.push({ e: c.e, s: (hit / toks.length) * 0.8 + (hit / c.set.size) * 0.2 });
    }
    scored.sort((a, b) => b.s - a.s || a.e.n.length - b.e.n.length);
    return scored.slice(0, limit).map((r) => r.e);
  }
  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.training = Object.assign(NS.training || {}, {
    ANATOMY_GROUPS, ANATOMY_BY_ID, ANATOMY_MUSCLES, ANATOMY_VIEW_GROUPS,
    DEMO_MUSCLE_GROUPS, LIB_CAT_GROUPS, curatedExIndex, libCatIndex,
    exCreditOverride, musclesForExercise,
    DEMO_CDN, DEMO_ABBREV, DEMO_STOP, DEMO_ALIAS, LIBRARY_DEMO_MAP,
    demoTokens, demoIndex, findDemoByName, demoEntryForName,
    demoForExercise, demoSearch,
  });
})();
