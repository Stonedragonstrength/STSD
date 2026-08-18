// Extracted from app.js — Phase 2 (Training) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/training/generator.spec.js
// imports THIS file and reads the namespace, so the shipped code is the
// tested code.
//
// The exercise factory and the Day Library's 🎲 generator: makeExercise is
// where `kind` is derived from the library name (a stretch becomes a
// rounds × seconds card, a carry a weight × time one), and
// generateWorkoutDay rolls a whole day from the archetype and style
// tables. Stochastic BY DESIGN — tests seed Math.random.
(function () {
  "use strict";

  // From the earlier training modules, which index.html loads first.
  const {
    isHoldName, isCarryName, EXERCISE_LIBRARY,
    GEN_STYLES, GEN_FLAVORS, GEN_SUFFIX, GEN_COMPOUND_KW,
    GEN_BW_GRADUATE_KW, GEN_BW_GRADUATE, GEN_ISO_KW,
    _rand, _pickRange, _repsFor, _genTags, _exercisesForCats, _shuffle,
  } = globalThis.STSD.training;
  if (typeof isHoldName !== "function" || typeof _rand !== "function") {
    throw new Error("the earlier src/training modules must load before generator.js");
  }

  // Ids are app.js's business — read through the STSD.app getter at call
  // time, never captured, same seam as the builder uses.
  const uid = (...a) => globalThis.STSD.app.uid(...a);
  function makeExercise(seed) {
    // Mobility/stretching items are prescribed as rounds × hold-seconds. We reuse
    // `sets` for rounds and `currentReps` for the hold duration (in seconds) so no
    // new persisted fields are needed. `kind` is derived from the library name.
    const kind = seed?.kind || (seed?.name && isHoldName(seed.name) ? "mobility" : "strength");
    const isMob = kind === "mobility";
    // Carries persist timed:true so athlete devices (which can't see the
    // coach's custom-exercise categories) still render them as weight × time.
    const timed = seed?.timed === true || (!isMob && !!seed?.name && isCarryName(seed.name));
    return {
      id: uid(),
      name: seed?.name || "",
      kind,
      timed,
      sets: seed?.sets || (isMob ? "1" : "3"),
      currentWeight: "",
      currentReps: seed?.reps || (isMob ? "30" : (timed ? "30" : "")),
      goalWeight: "",
      goalReps: "",
      notes: seed?.notes || "",
      videoUrl: seed?.videoUrl || "",
      modifiers: seed?.modifiers || [],
    };
  }

  // ── Finishers (burnout / dropset) ──
  // Burnout = 1 slot, Dropset = 2 slots. Each slot is a "drop-to" percentage of
  // the exercise's prescribed weight; the athlete logs the reps they hit.
  const FINISHER_PCTS = ["25", "50", "75"];

  function makeWorkoutTemplate(name, exercises) {
    return {
      id: uid(),
      name: name || "New Workout",
      focus: "",
      notes: "",
      exercises: Array.isArray(exercises) && exercises.length
        ? exercises.map((e) => ({ ...makeExercise(), ...e, id: uid() }))
        : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  const GEN_ARCHETYPES = [
    { name: "Push",            cats: ["Chest","Shoulders","Triceps"] },
    { name: "Pull",            cats: ["Back","Biceps"] },
    { name: "Leg",             cats: ["Quads","Hamstrings","Glutes","Calves"] },
    { name: "Upper Body",      cats: ["Chest","Back","Shoulders","Biceps","Triceps"] },
    { name: "Lower Body",      cats: ["Quads","Hamstrings","Glutes","Calves"] },
    { name: "Full Body",       cats: ["Quads","Chest","Back","Shoulders","Hamstrings"] },
    { name: "Chest & Tricep",  cats: ["Chest","Triceps"] },
    { name: "Back & Bicep",    cats: ["Back","Biceps"] },
    { name: "Shoulder & Arm",  cats: ["Shoulders","Biceps","Triceps"] },
    { name: "Arms",            cats: ["Biceps","Triceps"] },
    { name: "Posterior Chain", cats: ["Hamstrings","Glutes","Back"] },
    { name: "Glute & Ham",     cats: ["Glutes","Hamstrings","Adductors"] },
    { name: "Chest & Back",    cats: ["Chest","Back"] },
    { name: "Quad & Calf",     cats: ["Quads","Calves"] },
    { name: "Back & Shoulder", cats: ["Back","Shoulders"] },
    { name: "Chest & Shoulder",cats: ["Chest","Shoulders"] },
    { name: "Shoulder & Core", cats: ["Shoulders","Core"], noCore: true },
    { name: "Athletic",        cats: ["Quads","Hamstrings","Cardio","Core"], noCore: true },
    { name: "Full Body Power", cats: ["Quads","Back","Shoulders","Hamstrings","Core"], noCore: true },
    { name: "Conditioning",    cats: ["Cardio","Carries","Core"], noCore: true },
    { name: "Core & Carry",    cats: ["Core","Carries"], noCore: true },
    { name: "Grip & Carry",    cats: ["Carries","Back","Core"], noCore: true },
  ];

  function _maybeFinisher(ex, name) {
    if (!GEN_ISO_KW.test(name) || Math.random() >= 0.22) return;
    if (Math.random() < 0.5) ex.burnout = { pct: _rand(FINISHER_PCTS) };
    else ex.dropset = { pcts: _rand([["75","50"], ["75","50","25"], ["50","25"]]) };
  }
  function generateWorkoutDay() {
    const arch = _rand(GEN_ARCHETYPES);
    const style = _rand(GEN_STYLES);
    const pool = _exercisesForCats(arch.cats);
    if (!pool.length) return null;
    const wantMain = 4 + Math.floor(Math.random() * 4); // 4-7 main lifts
    const compounds = pool.filter((e) => GEN_COMPOUND_KW.test(e.name));
    const shuffled = _shuffle(pool);
    const chosen = [];
    const used = new Set();
    const primary = compounds.length ? _rand(compounds) : shuffled[0];
    chosen.push(primary); used.add(primary.name);
    for (const e of shuffled) {
      if (chosen.length >= wantMain) break;
      if (used.has(e.name)) continue;
      chosen.push(e); used.add(e.name);
    }
    if (!arch.noCore) {
      const coreEntry = EXERCISE_LIBRARY.find((e) => e.cat === "Core");
      const coreOpts = (coreEntry?.ex || []).filter((n) => !used.has(n));
      if (coreOpts.length) chosen.push({ name: _rand(coreOpts), cat: "Core" });
    }
    const exercises = chosen.map((e, i) => {
      const isPrimary = i === 0;
      const isCore = e.cat === "Core";
      const scheme = isPrimary ? style.primary : (isCore ? style.core : style.acc);
      const { mods, unilateral } = isCore ? { mods: [], unilateral: false } : _genTags(e.name, isPrimary, style);
      let reps = _repsFor(e.name, e.cat, scheme);
      if (unilateral && /^\d+$/.test(reps)) reps += " each"; // only on plain rep counts
      const out = { name: e.name, sets: _pickRange(scheme.sets), reps, modifiers: mods };
      // Weightable bodyweight moves start at BW with a graduating rep ladder
      // (BW → cap → add weight). Clear equipment/position tags that clash with
      // a plain bodyweight rep, and pin reps to the ladder floor.
      if (!isCore && GEN_BW_GRADUATE_KW.test(e.name)) {
        out.currentWeight = "BW";
        out.reps = GEN_BW_GRADUATE.floor;
        out.modifiers = [];
        out.progression = { ceil: GEN_BW_GRADUATE.ceil, inc: GEN_BW_GRADUATE.inc, reset: GEN_BW_GRADUATE.reset };
      } else if (!isPrimary && !isCore) {
        _maybeFinisher(out, e.name); // occasional burnout/dropset
      }
      return out;
    });
    // Occasionally superset two adjacent accessory lifts (not the primary or core).
    const accEnd = exercises.length - 1 - (arch.noCore ? 0 : 1);
    if (accEnd >= 2 && Math.random() < 0.33) {
      const k = 1 + Math.floor(Math.random() * (accEnd - 1)); // pair k & k+1, both accessories
      const id = uid();
      exercises[k].supersetId = id;
      exercises[k + 1].supersetId = id;
    }
    let name = `${_rand(GEN_FLAVORS)} ${arch.name}`;
    if (Math.random() < 0.4) name += ` ${_rand(GEN_SUFFIX)}`;
    return {
      name,
      focus: `${style.name} · ${arch.cats.map((c) => c.toLowerCase()).join(", ")}`,
      exercises,
    };
  }
  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.training = Object.assign(NS.training || {}, {
    makeExercise, makeWorkoutTemplate,
    FINISHER_PCTS, GEN_ARCHETYPES, _maybeFinisher, generateWorkoutDay,
  });
})();
