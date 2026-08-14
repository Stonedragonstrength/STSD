// Muscle data for the movements the app can find no demo entry for at all.
//
// `musclesForExercise` derives what a lift trains from the coach's own credit
// override, the curated anchor/accessory lists in ANATOMY_GROUPS, and the
// vendored exercise-demos.js. That last lookup is not a plain name match: it
// runs LIBRARY_DEMO_MAP, then DEMO_ALIAS, then exact and sorted token keys, and
// finally a fuzzy scorer — so "Back Squat" reaches Barbell Squat and "Pull-Up"
// reaches Pullups. Measured against the real chain, **127 of the 166 movements
// the builder can pick resolve to a demo entry**. Only 39 do not, and those
// fall through to a single muscle at full weight from their library category.
//
// This file covers those 39, and ONLY those. An entry for a movement the app
// can already resolve is dead weight that looks like coverage — the first draft
// of this file had 35 such entries, written against a test harness whose demo
// lookup was a naive exact match and therefore reported the gap as 128 rather
// than 39. There is a test that fails if a dead entry appears here again.
//
// What is left out, deliberately: the isolations whose one library-category
// muscle is already the right answer. A tibialis raise really is just the
// tibialis, and a bayesian curl really is just the biceps.
//
// The vocabulary is the demo database's own, not the app's muscle ids, so these
// entries flow through the exact same `fan()` path — including the rule that a
// secondary naming a region is split across the muscles it names, and the rule
// that a coarse "shoulders" tag stays quiet when the curated lists already named
// which delt head. `p` scores at full weight, `s` at half, same as a real entry.
//
// Valid muscle names: abdominals, quadriceps, hamstrings, glutes, calves,
// adductors, abductors, chest, lats, middle back, lower back, traps, shoulders,
// biceps, triceps, forearms.
window.EXERCISE_MUSCLES = {
  // ---- Accessories the database has nothing for ----
  // These are tier-two movements a day is built around, so crediting them one
  // muscle understates the week everywhere it is counted.
  "pendulum squat":      { p: ["quadriceps"], s: ["glutes", "hamstrings", "calves"] },
  "cossack squat":       { p: ["adductors"], s: ["quadriceps", "glutes", "hamstrings", "calves"] },
  "sumo squat":          { p: ["adductors"], s: ["quadriceps", "glutes", "hamstrings"] },
  "lateral lunge":       { p: ["adductors"], s: ["quadriceps", "glutes", "abductors"] },
  "curtsy lunge":        { p: ["glutes"], s: ["quadriceps", "adductors", "abductors", "hamstrings"] },
  "single-leg rdl":      { p: ["hamstrings"], s: ["glutes", "lower back", "abdominals", "calves"] },
  "nordic curl":         { p: ["hamstrings"], s: ["glutes", "calves", "abdominals"] },
  "machine chest press": { p: ["chest"], s: ["triceps", "shoulders"] },
  "landmine press":      { p: ["shoulders"], s: ["chest", "triceps", "abdominals"] },
  "z press":             { p: ["shoulders"], s: ["triceps", "abdominals", "lower back"] },
  "chest-supported row": { p: ["middle back"], s: ["lats", "biceps", "traps"] },
  "meadows row":         { p: ["lats"], s: ["middle back", "biceps", "forearms", "traps"] },

  // ---- Carries ----
  // Every one of the ten falls back to the Carries category, which is forearms
  // and traps and nothing else. A loaded carry is a trunk and leg movement that
  // happens to be limited by grip; crediting only the grip is why carries read
  // as trivial on the coverage map next to the work they actually are.
  "suitcase carry":      { p: ["forearms", "traps"], s: ["abdominals", "lower back", "glutes", "quadriceps"] },
  "trap bar carry":      { p: ["forearms", "traps"], s: ["quadriceps", "glutes", "abdominals", "lower back"] },
  "overhead carry":      { p: ["shoulders", "traps"], s: ["abdominals", "triceps", "forearms", "lower back"] },
  "waiter walk":         { p: ["shoulders"], s: ["traps", "abdominals", "triceps", "forearms"] },
  "bottoms-up carry":    { p: ["shoulders", "forearms"], s: ["abdominals", "traps"] },
  "rack carry":          { p: ["traps", "abdominals"], s: ["forearms", "shoulders", "lower back", "quadriceps"] },
  "front rack carry":    { p: ["traps", "abdominals"], s: ["forearms", "shoulders", "lower back", "quadriceps"] },
  "zercher carry":       { p: ["abdominals", "biceps"], s: ["traps", "lower back", "forearms", "quadriceps"] },
  "bear hug carry":      { p: ["chest", "abdominals"], s: ["biceps", "forearms", "quadriceps", "lower back"] },
  "sandbag carry":       { p: ["abdominals", "forearms"], s: ["traps", "lower back", "quadriceps", "glutes"] },

  // ---- Isolations that genuinely are not one muscle ----
  // The rest of the unresolved isolations are left alone on purpose; their one
  // category muscle is already the honest answer.
  "copenhagen plank":    { p: ["adductors"], s: ["abdominals"] },
  "toes-to-bar":         { p: ["abdominals"], s: ["lats", "forearms", "hamstrings"] },
  "dragon flag":         { p: ["abdominals"], s: ["lower back", "lats"] },
  "dead hang":           { p: ["forearms"], s: ["lats", "shoulders", "traps"] },
  "bird dog":            { p: ["abdominals"], s: ["lower back", "glutes"] },
  "woodchopper":         { p: ["abdominals"], s: ["shoulders", "lats"] },
};
