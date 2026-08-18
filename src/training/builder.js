// Extracted from app.js — Phase 2 (Training) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/training/builder.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
//
// The ⚡ program builder: seats compounds by structure, then fills every
// muscle to its band by coverage gain. Stochastic BY DESIGN — it draws from
// Math.random through several helpers, so tests seed Math.random for the
// duration of a check and restore it (see the spec, and the note in
// tests/program-builder.test.js about one-roll thresholds flaking).
//
// Reads the realization/role/pattern tables (EXERCISE_EQUIPMENT,
// EXERCISE_ROLES, EXERCISE_PATTERN) through the window global at CALL
// time — they are their own shipped files.
(function () {
  "use strict";

  // From the earlier training modules, which index.html loads first (the
  // boot smoke executes the tags in that order). Checked at load so a
  // missing or misordered tag fails HERE, by name.
  const {
    exKey, EXERCISE_LIBRARY, musclesForExercise, ANATOMY_GROUPS,
    levelBands, EFFORT_LEVELS, phaseMinRank, phaseOf, GEAR, GEAR_BY_ID,
  } = globalThis.STSD.training;
  if (typeof exKey !== "function" || typeof musclesForExercise !== "function" ||
      typeof levelBands !== "function" || !Array.isArray(GEAR)) {
    throw new Error("src/training/{tags,library,anatomy,levels}.js must load before builder.js");
  }

  // Three app-owned helpers buildWeek leans on to assemble week/day
  // objects: ids, the empty-week shape, and the day-name icon. They belong
  // to app.js (every editor path uses them), so the module reads them
  // through the getters app.js publishes on STSD.app - at call time, never
  // captured, same seam as customExerciseList.
  const uid = (...a) => globalThis.STSD.app.uid(...a);
  const makeWeek = (...a) => globalThis.STSD.app.makeWeek(...a);
  const workoutIconFor = (...a) => globalThis.STSD.app.workoutIconFor(...a);

  // Sets/reps are [min,max] ranges — a random value is picked per exercise, so
  // the same movement lands on different numbers each roll (big variety boost).
  const GEN_STYLES = [
    { name: "Strength",      primary: { sets: [4,6], reps: [3,6]   }, acc: { sets: [3,4], reps: [6,10]  }, core: { sets: [3,4], reps: [10,15] }, tags: ["Pause"] },
    { name: "Power",         primary: { sets: [4,6], reps: [2,4]   }, acc: { sets: [3,5], reps: [4,6]   }, core: { sets: [3,3], reps: [10,15] }, tags: ["Explosive"] },
    { name: "Hypertrophy",   primary: { sets: [3,5], reps: [8,12]  }, acc: { sets: [3,4], reps: [10,15] }, core: { sets: [3,4], reps: [12,20] }, tags: ["Tempo","Pause"] },
    { name: "Pump",          primary: { sets: [3,4], reps: [12,15] }, acc: { sets: [3,4], reps: [15,20] }, core: { sets: [3,3], reps: [15,25] }, tags: [] },
    { name: "Endurance",     primary: { sets: [2,3], reps: [15,20] }, acc: { sets: [2,3], reps: [18,25] }, core: { sets: [3,3], reps: [20,30] }, tags: [] },
    { name: "Powerbuilding", primary: { sets: [4,5], reps: [5,8]   }, acc: { sets: [3,4], reps: [8,12]  }, core: { sets: [3,3], reps: [12,15] }, tags: ["Pause","Tempo"] },
    { name: "Volume",        primary: { sets: [5,6], reps: [8,12]  }, acc: { sets: [4,5], reps: [10,15] }, core: { sets: [4,4], reps: [15,20] }, tags: ["Tempo"] },
    { name: "Explosive",     primary: { sets: [5,6], reps: [3,5]   }, acc: { sets: [3,4], reps: [5,8]   }, core: { sets: [3,3], reps: [10,12] }, tags: ["Explosive"] },
    { name: "Metcon",        primary: { sets: [3,5], reps: [10,15] }, acc: { sets: [3,4], reps: [12,20] }, core: { sets: [3,4], reps: [15,25] }, tags: [] },
  ];
  const GEN_FLAVORS = ["Iron","Apex","Prime","Savage","Peak","Forge","Titan","Blitz","Storm","Granite","Vault","Summit","Rogue","Atlas","Vertex","Fury","Onyx","Rampart","Nova","Bedrock","Phantom","Kodiak","Havoc","Crux","Ember","Valor","Grit","Maverick","Tempest","Anvil"];
  const GEN_SUFFIX  = ["Day","Session","Builder","Blitz","Burn","Grind","Blast","Surge","Protocol","Circuit"];
  const GEN_COMPOUND_KW = /squat|deadlift|bench|press|\brow\b|pull-up|pull up|chin|hip thrust|lunge|clean|overhead|dip|thrust|swing|good morning|rack pull/i;
  // Bodyweight moves that can later be loaded (weighted vests/belts/dumbbells).
  // The generator starts these at bodyweight with a graduating rep ladder so a
  // beginner earns their way onto added weight. See makeExercise / progressionRule.
  const GEN_BW_GRADUATE_KW = /pull-up|chin-up|\bdips?\b|push-up|inverted row|pike push/i;
  const GEN_BW_GRADUATE = { floor: "8", ceil: 15, inc: 5, reset: 8 };

  function _rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function _pickRange(r) { return String(r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1))); }
  // Starting rep counts a coach would actually write. A scheme range is a band,
  // not a menu, and picking any integer inside it produced 3x7, 4x9, 3x11, 5x13 —
  // numbers nobody programs on purpose, which made a generated week read as
  // machine output. Reps land on this ladder instead.
  //
  // Every one of the nine styles' twenty-seven ranges contains at least one
  // ladder value, so no scheme needed re-tuning; the fallback is only there so a
  // future range cannot silently produce nothing.
  const REP_LADDER = [3, 5, 6, 8, 10, 12, 14, 15, 18, 20];
  // What the MOVEMENT can be done for, where that is narrower than the style's
  // band. See exercise-roles.js for why this is stated rather than derived.
  function exRepWindow(name) {
    return (window.EXERCISE_REP_WINDOW || {})[exKey(name)] || null;
  }
  function _pickReps(r, name) {
    // The style says what the block is for; the movement says what is possible.
    // Where they disagree the movement wins, because no amount of programming
    // intent makes an eighteen-rep nordic curl a thing an athlete can do.
    const w = name ? exRepWindow(name) : null;
    const lo = w ? Math.max(r[0], w[0]) : r[0];
    const hi = w ? Math.min(r[1], w[1]) : w ? w[1] : r[1];
    const inside = REP_LADDER.filter((n) => n >= lo && n <= hi);
    if (inside.length) return String(_rand(inside));
    // The two bands do not overlap — a Strength block meeting a kettlebell
    // swing, say. The movement's window is the hard constraint, so land on the
    // rung of it nearest to what the style wanted.
    const target = w ? (r[1] < w[0] ? w[0] : w[1]) : (r[0] + r[1]) / 2;
    const pool = w ? REP_LADDER.filter((n) => n >= w[0] && n <= w[1]) : REP_LADDER;
    const from = pool.length ? pool : REP_LADDER;
    return String(from.reduce((a, b) =>
      Math.abs(b - target) < Math.abs(a - target) ? b : a));
  }
  function _shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function _exercisesForCats(cats) {
    const out = [];
    cats.forEach((cat) => {
      const entry = EXERCISE_LIBRARY.find((e) => e.cat === cat);
      if (entry) entry.ex.forEach((name) => out.push({ name, cat }));
    });
    return out;
  }
  // Keyword-gated tag assignment so combos stay sensible (never "Incline Deadlift").
  function _genTags(name, isPrimary, style) {
    const mods = [];
    const hasEquip = /barbell|dumbbell|\bdb\b|\bbb\b|cable|machine|kettlebell|\bkb\b|band|ez|smith|trap[- ]bar|hex|sled|assault|treadmill|\bbike\b|rowing|jump rope|battle|ski erg/i.test(name);
    const equipable = /(press|\brow\b|fly|curl|raise|extension|pushdown|pulldown|kickback|crossover|shrug|crunch|pull-through|adduction|abduction|pressdown|skull crusher|pec deck|thrust|bridge|swing|good morning)/i.test(name);
    if (equipable && !hasEquip && Math.random() < 0.55) mods.push(_rand(["DB","DB","Cable","Cable","Machine","KB","Band","BB","EZ Bar","Rope"]));
    // Position
    if (/(press|fly)/i.test(name) && Math.random() < 0.35) mods.push(_rand(["Incline","Decline"]));
    else if (/(\brow\b|curl|raise|extension|pushdown|pulldown)/i.test(name) && Math.random() < 0.3) mods.push(_rand(["Seated","Standing","Kneeling"]));
    // Unilateral: single-leg for leg moves, single-arm for the rest.
    const legUni = /(lunge|split squat|step-up|single-leg|calf raise)/i.test(name);
    const armUni = /(\brow\b|curl|press|extension|pushdown|pulldown|raise|carry|fly|kickback)/i.test(name);
    let unilateral = false;
    if ((legUni || armUni) && Math.random() < 0.25) { mods.push(legUni ? "1L" : "1A"); unilateral = true; }
    // Style intensity tag — usually on the primary, sometimes on accessories.
    const styleTags = style.tags || [];
    if (styleTags.length && Math.random() < (isPrimary ? 0.6 : 0.28)) mods.push(_rand(styleTags));
    return { mods, unilateral };
  }
  // Reps as time/distance where that reads better than a rep count.
  const GEN_HOLD_KW  = /plank|hollow hold|dead bug|l-sit|wall sit|\bhold\b/i;
  const GEN_CRAWL_KW = /crawl|inchworm/i;
  const GEN_ISO_KW   = /curl|extension|raise|fly|pushdown|pressdown|kickback|pec deck|crossover|shrug|adduction|abduction/i;
  function _repsFor(name, cat, scheme) {
    if (cat === "Carries")           return _rand(["40 ft","50 ft","60 ft","30 m","40 m"]);
    if (cat === "Cardio")            return _rand(["30s","45s","60s","3 min","5 min","200m","400m","500m","15 cal","20 cal","10","12","15"]);
    if (GEN_HOLD_KW.test(name))      return _rand(["20s","30s","40s","45s","60s"]);
    if (GEN_CRAWL_KW.test(name))     return _rand(["30s","40 ft","50 ft","20 yd"]);
    return _pickReps(scheme.reps, name);  // on the ladder, inside what the lift allows
  }
  // The gear an athlete can reach. Empty means everything, so an athlete nobody
  // filled in is unrestricted rather than unable to train.
  function gearSet(client) {
    const list = (client && client.equipment) || [];
    return new Set(list.length ? list : GEAR.map((g) => g.id));
  }
  // How this athlete would perform this movement, or null if they cannot.
  // Realizations are in preference order, so the first satisfiable one is the
  // one to program. Returns the tag to stamp as well as the gear it used.
  function resolveRealization(name, gear) {
    const rs = (window.EXERCISE_EQUIPMENT || {})[exKey(name)];
    if (!rs) return null;
    return rs.find((r) => r.gear.every((g) => gear.has(g))) || null;
  }
  // How much body a movement covers, as one number. This is what makes a
  // deadlift outrank a leg extension on merit rather than by a keyword list,
  // and it is the whole basis of anchor choice.
  function coverageScore(name) {
    return musclesForExercise(name).reduce((t, h) => t + h.weight, 0);
  }
  // Everything the builder may pick from: the curated anchors and accessories
  // first, so ties resolve toward the ones already vouched for, then the wider
  // library. Built once.
  // Categories the builder never programs. They are real training and they stay
  // in the editor's sidebar, but this builds RESISTANCE weeks against muscle
  // coverage, and a ladder drill or a cat-cow answers a different question.
  // Left in and they surface as gap-fillers: a push day came back holding
  // Spiderman Crawl and Cat-Cow.
  // Plyometrics joins the skip list for the same reason as the other three: the
  // ⚡ builder seats resistance work against a muscle-coverage map, and jumps
  // are a coach's deliberate choice about an athlete's readiness for them, not
  // a gap to be auto-filled. Remove it here to let the builder program plyo.
  const BUILDER_SKIP_CATS = new Set(["Speed/Agility", "Mobility & Stretching", "Cardio", "Plyometrics"]);

  // What job a movement does in a day: compound / accessory / isolation / carry,
  // or "skip" for work the builder should not program. Stated in
  // exercise-roles.js — see that file's header for why this cannot be derived
  // from either the muscle map or the library category.
  //
  // Anything unlisted is treated as an isolation, which is the safe default: it
  // can still be picked to close a gap, but it can never open a day.
  function exRole(name) {
    return (window.EXERCISE_ROLES || {})[exKey(name)] || "isolation";
  }
  // The pattern a compound or accessory PRIMARILY belongs to — see the second
  // map in exercise-roles.js for why this is stated rather than derived.
  function exPattern(name) {
    return (window.EXERCISE_PATTERN || {})[exKey(name)] || "";
  }
  // The order a day is written in, and the whole point of the tiers: heavy
  // compounds, then the accessories that support them at moderate load, then
  // isolation work heavier-first, then any carry. Nathan's formula, made
  // structural rather than left to whatever closed the biggest gap.
  const ROLE_RANK = { compound: 0, accessory: 1, isolation: 2, carry: 3 };
  let _builderPool = null;
  function builderPool() {
    if (_builderPool) return _builderPool;
    const out = new Map();
    ANATOMY_GROUPS.forEach((g) => [...(g.anchors || []), ...(g.accessories || [])]
      .forEach((nm) => { const k = exKey(nm); if (k && !out.has(k)) out.set(k, nm); }));
    EXERCISE_LIBRARY.forEach((c) => {
      if (BUILDER_SKIP_CATS.has(c.cat)) return;
      (c.ex || []).forEach((nm) => { const k = exKey(nm); if (k && !out.has(k)) out.set(k, nm); });
    });
    // A curated anchor can still belong to a skipped category, so filter the
    // assembled list rather than trusting the source it came from. Roles can
    // also veto a movement the categories let through: the crawls are filed
    // under Core, and the gap-filler kept seating them on leg days because they
    // pay several small muscles at once.
    _builderPool = [...out.values()].filter((nm) =>
      !BUILDER_SKIP_CATS.has(libCatFor(nm)) && exRole(nm) !== "skip");
    return _builderPool;
  }
  const MUSCLE_PATTERN = Object.fromEntries(ANATOMY_GROUPS.map((g) => [g.id, g.pattern]));

  // Which patterns each day owns, per day count. Stated in the same vocabulary
  // the muscles are (ANATOMY_GROUPS[].pattern), so a day's job is legible from
  // its own definition.
  const SPLITS = {
    1: [["Squat", "Push", "Pull", "Hinge", "Core"]],
    2: [["Squat", "Push"], ["Hinge", "Pull"]],
    3: [["Push"], ["Pull"], ["Squat", "Hinge"]],
    4: [["Push"], ["Squat"], ["Pull"], ["Hinge"]],
    5: [["Push"], ["Pull"], ["Squat", "Hinge"], ["Push", "Pull"], ["Squat", "Hinge"]],
    6: [["Push"], ["Pull"], ["Squat", "Hinge"], ["Push"], ["Pull"], ["Squat", "Hinge"]],
  };
  // Whether a movement genuinely SERVES a pattern, as opposed to brushing it.
  // Half-weight hits do not count: a single-arm row grazes the front delts at
  // 0.5 through the shoulders bucket, which was enough to win it the Push
  // anchor slot and open a push day with a row.
  function servesPattern(name, pattern) {
    return musclesForExercise(name).some((h) => h.weight >= 1 && MUSCLE_PATTERN[h.id] === pattern);
  }
  // A pattern is reachable when at least one movement that really serves it
  // can be performed with the gear on hand.
  function patternReachable(pattern, gear) {
    return builderPool().some((nm) => resolveRealization(nm, gear) && servesPattern(nm, pattern));
  }
  // The split for a day count, with unreachable patterns removed. A day left
  // with nothing takes the best reachable pattern instead, so a gym that cannot
  // pull still yields the full number of useful days rather than empty ones.
  // Dropped patterns are reported, never silently swallowed.
  function skeletonFor(dayCount, gear) {
    const base = SPLITS[dayCount] || SPLITS[3];
    const all = [...new Set(Object.values(MUSCLE_PATTERN))];
    const reachable = all.filter((p) => patternReachable(p, gear));
    const dropped = all.filter((p) => !reachable.includes(p));
    // Rank by the best movement each pattern can still offer, so a re-picked
    // day gets the most productive work available rather than whatever is first.
    const rank = (p) => Math.max(0, ...builderPool()
      .filter((nm) => resolveRealization(nm, gear) && servesPattern(nm, p))
      .map(coverageScore));
    const byRank = [...reachable].sort((a, b) => rank(b) - rank(a));
    const days = base.map((day) => {
      const kept = day.filter((p) => reachable.includes(p));
      return kept.length ? kept : (byRank.length ? [byRank[0]] : []);
    });
    return { days, dropped };
  }

  // Nathan's own sketch ran seven exercises a day. The athlete-added cap is 8,
  // so seven leaves them room to add one of their own.
  const DAY_CAP = 7;
  // Opener choice used to run through tiers assembled from ANATOMY_GROUPS
  // anchors and accessories. Those lists say "the best movements for THIS
  // MUSCLE" — Lateral Raise, Plank and Tricep Pushdown are all anchors — so they
  // were never a statement about which lift opens a day. exercise-roles.js says
  // that directly now, and the tiers are gone with the score ranking they served.
  //
  // "Roll again" has to change the WEEK, not just the numbers on it.
  //
  // Both pickers below used to take the first strict maximum, which is fully
  // deterministic given a fixed pool order — so every roll produced the same
  // movements with fresh sets and reps, and the button looked broken. (The old
  // test could not see it: its signature was name+sets+reps, so re-rolled
  // numbers alone made it pass.)
  //
  // Instead, gather everything within reach of the best and choose among those.
  // Ranked candidates rather than a flat shuffle, so a genuinely better movement
  // is still preferred.
  //
  // The reach was 0.9 and that was far too narrow, because gain is summed over
  // demo-database muscle tags: a movement paying three delt heads scores triple
  // one paying the side delt properly, and at 0.9 nothing else was ever within
  // reach. Measured over 320 days at 0.9 — Pallof Press took the isolation slot
  // on 79 of 100 push days and **Lateral Raise appeared zero times**, along with
  // one Leg Extension and two Leg Curls. The isolation tier owns three to five
  // of every day's seven slots, so that is most of what an athlete sees.
  //
  // 0.5 is measured, not guessed, and it is a strict improvement on BOTH axes:
  // distinct movements used rose 140 → 161 of 166 and Pallof's share of push
  // days fell 82 → 48, while average shortfall improved on three of five
  // level/day-count combinations. Widening further to 0.3 buys more variety but
  // starts costing real coverage (a three-day week went 2.0 → 3.6 short).
  const PICK_REACH = 0.5;
  function pickNearBest(scored) {
    if (!scored.length) return null;
    let top = -Infinity;
    for (const x of scored) if (x.s > top) top = x.s;
    if (top <= 0) return null;
    const near = scored.filter((x) => x.s >= top * PICK_REACH);
    return near[Math.floor(Math.random() * near.length)].nm;
  }

  // The movement that opens a pattern, or supports it, chosen by ROLE.
  //
  // This used to rank by coverageScore and take the near-best. That sounds right
  // and is not: coverageScore sums a movement's muscle-tag weights out of the
  // vendored demo database, so what it really measures is how thoroughly that
  // database tagged a lift. Back Squat is tagged with one muscle and scores 1.0;
  // Goblet Squat is tagged with four and scores 4.0. Measured over forty rolls,
  // every single squat day opened on a Leg Press and a Back Squat never appeared.
  //
  // Role fixes it at the source. Everything surviving the filter is a legitimate
  // opener for this pattern on this gear, so there is nothing left to rank and
  // the pick is even — which is also what makes rolling again produce a
  // different day rather than the same day with new numbers.
  // Matched on the movement's DECLARED pattern, not on whether it happens to
  // touch a muscle the pattern owns. servesPattern is still the right question
  // for the gap filler deciding which day a curl belongs on; it is the wrong one
  // for deciding what a day is built around.
  function candidatesFor(pattern, gear, used, role) {
    return builderPool().filter((nm) =>
      !used.has(exKey(nm))
      && exRole(nm) === role
      && exPattern(nm) === pattern
      && resolveRealization(nm, gear));
  }
  function bestForPattern(pattern, gear, used, role = "compound") {
    // A gym without a barbell has no compound at all for some patterns, so an
    // opener falls through to an accessory rather than leaving the day headless:
    // a dumbbell-only squat day opens on a Goblet Squat, not on nothing.
    const tiers = role === "compound" ? ["compound", "accessory"] : [role];
    for (const r of tiers) {
      const c = candidatesFor(pattern, gear, used, r);
      if (c.length) return c[Math.floor(Math.random() * c.length)];
    }
    // An ACCESSORY that cannot be found is simply not seated — the slot goes
    // back to the gap filler, which is a better use of it than forcing a curl
    // into a tier that means "supports the day's main lift".
    if (role !== "compound") return null;
    // An OPENER that cannot be found is a hole in the week, so the last resort
    // drops to the loose test: anything that trains this pattern at all. Core
    // reaches here by design — it has no compounds — as does a bands-only gym.
    const loose = builderPool().filter((nm) =>
      !used.has(exKey(nm))
      && exRole(nm) !== "carry"
      && resolveRealization(nm, gear)
      && servesPattern(nm, pattern));
    return loose.length ? loose[Math.floor(Math.random() * loose.length)] : null;
  }
  // Tier one: the heavy compound the day is built around, one per pattern the
  // day owns, in pattern order.
  function seatCompounds(skeletonDays, gear, used, slots) {
    return skeletonDays.map((patterns) => {
      const day = [];
      patterns.forEach((p) => {
        if (day.length >= DAY_CAP) return;
        const nm = bestForPattern(p, gear, used, "compound");
        if (!nm) return;
        used.add(exKey(nm));
        slots.set(exKey(nm), "compound");
        day.push(nm);
      });
      return day;
    });
  }
  // Tier two: accessories to the day's own compound, at moderate load.
  //
  // This is the tier that did not exist, and its absence is why a squat day
  // never held a lunge. Building ran straight from the compound to gap-closing,
  // and by then the compound had already carried quads and glutes past their
  // band — so every lunge and split squat priced as pure overshoot and scored
  // negative. The only movements still scoring were the small and the odd: calf
  // raises, clamshells, Copenhagen planks, crawls.
  //
  // Accessories are therefore seated BEFORE the deficit is consulted. "Supports
  // the day's main lift" is a structural claim about the day, not a shortfall to
  // be closed, and a filler that only knows about shortfall can never make it.
  // Chosen evenly, for the same reason the opener is: every accessory that
  // serves the day's pattern is a legitimate answer, so there is nothing to
  // rank. Ranking them by coverage was tried and it quietly reinstated the very
  // bias the roles were written to remove — coverage is computed off the demo
  // database's muscle tags, Goblet Squat carries four of them and a Lunge
  // carries one, so the lunge lost again. Measured: two squat days in
  // twenty-five held a lunge or a split squat. Even odds puts it at six in ten,
  // and the gap filler adds more on top.
  //
  // ONE per day, not one per pattern. A day that owns Squat and Hinge wants a
  // squat, an RDL and one leg accessory — not two accessories on top of two main
  // lifts, which is four structural slots out of seven and reads as a leg
  // marathon. Measured, per-day also covers better than per-pattern everywhere
  // it differs, and on a four-day split (where every day owns one pattern) the
  // two rules are identical. The pattern that gets the accessory is drawn at
  // random, so across a week both halves of a two-pattern day get served.
  // And only where the day's pattern still has ROOM.
  //
  // A compound and an accessory on the same pattern pay the same muscles, and
  // both sit on their trim floors afterwards, so nothing can be shaved back.
  // Against real muscle data that took a beginner's worst muscle to 1.92x its
  // plenty band where the old anchor-only builder reached 1.17x — the bands were
  // calibrated for a week with one big lift per pattern, not two. A beginner's
  // plenty is 6 sets; a squat and a lunge at their floors are already 5.
  //
  // So the tier asks first. Refusing costs almost nothing measurable (a squat
  // day still holds a lunge 67% of the time against 70%, and coverage is
  // unchanged or slightly better) and brings the worst case back to 1.60x.
  function seatAccessories(days, dayPatterns, client, gear, used, setsPerEx, slots) {
    const bands = levelBands(client);
    days.forEach((day, i) => {
      const patterns = dayPatterns[i] || [];
      if (!patterns.length || day.length >= DAY_CAP) return;
      const sets = proposalSets(days, setsPerEx);
      for (const p of _shuffle(patterns)) {
        const nm = bestForPattern(p, gear, used, "accessory");
        if (!nm) continue;   // this pattern has none left; try the day's other
        // Would it carry anything it pays past plenty? Then the day does not
        // need it, and the slot is better left to the gap filler.
        const over = musclesForExercise(nm).some((h) =>
          (sets[h.id] || 0) + setsPerEx * h.weight > bands.plenty);
        if (over) return;
        used.add(exKey(nm));
        slots.set(exKey(nm), "accessory");
        day.push(nm);
        return;
      }
    });
  }
  // Sets per muscle for a week that is still just lists of names.
  // Deliberately NOT anatomyCoverage(): that reads a real client through
  // coverageWeek(), and the proposal has no burn levels yet, so a phased
  // athlete would have every one of them filtered out as untagged and the
  // filler would chase a deficit it could never close.
  function proposalSets(dayNames, setsPerEx) {
    const sets = {};
    ANATOMY_GROUPS.forEach((g) => { sets[g.id] = 0; });
    dayNames.forEach((names) => names.forEach((nm) => {
      musclesForExercise(nm).forEach((h) => {
        if (sets[h.id] != null) sets[h.id] += setsPerEx * h.weight;
      });
    }));
    Object.keys(sets).forEach((k) => { sets[k] = Math.round(sets[k] * 10) / 10; });
    return sets;
  }
  // How dearly a set past plenty is priced against a set of real shortfall
  // closed. Below about 0.4 the filler still overloads the big compound
  // muscles; above about 0.8 it stops so early that ordinary weeks come back
  // full of gaps. 0.5 keeps a beginner's glutes near their band while still
  // filling the small groups.
  const OVERSHOOT_COST = 0.5;
  // What a movement is worth to coverage right now: the shortfall it closes,
  // minus what it dumps on muscles already at plenty. Shared by the accessory
  // tier and the gap filler so the two price a movement identically.
  function coverageGain(nm, sets, bands, setsPerEx) {
    return musclesForExercise(nm).reduce((t, h) => {
      const have = sets[h.id] || 0;
      const add = setsPerEx * h.weight;
      const closed = Math.min(Math.max(0, bands.solid - have), add);
      const over = Math.max(0, (have + add) - bands.plenty);
      return t + closed - over * OVERSHOOT_COST;
    }, 0);
  }
  // Add whichever reachable movement closes the most shortfall, until every
  // muscle reaches solid or every day is full. Mutates `days`.
  function fillDeficit(days, dayPatterns, client, gear, used, setsPerEx, slots) {
    const bands = levelBands(client);
    if (!slots) slots = new Map();
    const room = () => days.some((d) => d.length < DAY_CAP);
    for (let guard = 0; guard < 200 && room(); guard++) {
      const sets = proposalSets(days, setsPerEx);
      const total = ANATOMY_GROUPS.reduce((t, g) =>
        t + Math.max(0, bands.solid - (sets[g.id] || 0)), 0);
      if (!total) break;
      // Chase the NEEDIEST muscle, then choose evenly among the movements that
      // genuinely serve it — rather than globally maximising gain.
      //
      // Global maximisation is a degenerate pick for the same reason ranking the
      // openers was: gain is summed over demo-database muscle tags, so a
      // movement that pays two needy muscles always beats one that pays a single
      // muscle well, and PICK_REACH 0.9 is far too narrow to let the second one
      // through. Measured over 320 built days: Pallof Press took the isolation
      // slot on 79 of 100 push days, Svend Press on 48, and **Lateral Raise
      // appeared zero times**. Leg Extension once, Leg Curl twice. Those are
      // staples; a coach reading a week with no lateral raise in it does not
      // trust the tool. The isolation tier owns three to five of the seven slots
      // in every day, so this is most of what the athlete actually sees.
      //
      // Needing a weight-1 hit on the target muscle is what keeps it honest: a
      // movement that merely grazes the muscle cannot be picked to close it.
      // Neediest first, but every short muscle in turn: a muscle nothing in the
      // gym can reach must not halt the filler. Taking only the single neediest
      // and stopping when it had no candidate left fourteen muscles under solid
      // on a week that should finish with none.
      const wanted = ANATOMY_GROUPS
        .map((g) => ({ id: g.id, short: bands.solid - (sets[g.id] || 0) }))
        .filter((x) => x.short > 0)
        .sort((a, b) => b.short - a.short)
        .map((x) => x.id);
      // A final null pass keeps the old global behaviour as a backstop, so the
      // filler can still close overshoot-priced gaps nothing serves outright.
      let scored = [];
      for (const wantId of [...wanted, null]) {
        scored = candidateFills(wantId);
        if (scored.length) break;
      }
      function candidateFills(wantId) {
      const scored = [];
      builderPool().forEach((nm) => {
        if (used.has(exKey(nm))) return;
        // Compounds are seated by structure and by structure alone: left
        // eligible here, a hinge day reading short on hamstrings takes a second
        // deadlift, which is not a gap-filler, it is a second main lift.
        //
        // Accessories stay eligible, and that distinction is load-bearing.
        // Barring them too cost the filler 41 of its 166 movements — a Leg Press
        // closing a quad gap or a Curtsy Lunge closing a glute gap is exactly
        // the right answer — and measured over twenty rolls it took a
        // four-day intermediate week from zero muscles short to 1.9, and a
        // three-day week from 0.5 to 6.8. The ordering pass puts whatever the
        // filler adds into its proper band anyway, so admitting an accessory
        // here cannot disturb the shape of the day.
        if (exRole(nm) === "compound") return;
        if (!resolveRealization(nm, gear)) return;
        // Deficit closed, MINUS what the same movement dumps on muscles that
        // are already full. Counting only the gain is what let a beginner's
        // week reach 13 glute sets against a plenty of 6: almost every
        // lower-body movement pays the glutes, so chasing a needy muscle kept
        // buying glute volume nobody asked for. Overshoot is a cost, so a
        // movement that closes a little and overloads a lot loses, and once
        // nothing scores positive the filler stops rather than adding junk.
        // Serves the muscle we are actually chasing, at full weight. Requiring
        // a full-weight hit is what keeps it honest: a movement that merely
        // grazes the muscle cannot be bought to close it.
        if (wantId && !musclesForExercise(nm).some((h) => h.id === wantId && h.weight >= 1)) return;
        const gain = coverageGain(nm, sets, bands, setsPerEx);
        if (gain > 0) scored.push({ nm, s: gain });
      });
      return scored;
      }
      // Same near-best pick as the anchors: the filler still refuses anything
      // that scores nothing, so "closes a little and overloads a lot" still
      // loses and the week still stops rather than adding junk.
      const best = pickNearBest(scored);
      if (!best) break;
      // Into a day this movement actually belongs to, emptiest first, so the
      // week stays even without a deadlift landing on the push day. If no day's
      // patterns fit, the emptiest day takes it: better placed oddly than
      // dropped, and the coach can move it.
      // Two limits on what a day may hold twice.
      //
      // Carries: one. They close real forearm, trap and core shortfall, so
      // banning them costs coverage, but the filler used to seat several.
      //
      // Accessories of the SAME pattern: also one. The structural tier already
      // seated the day's accessory, and the filler would add another because the
      // demo database tags a Goblet Squat with four muscles and so it always
      // looks like a bargain. That produced a squat day reading Trap Bar
      // Deadlift, Split Squat, Goblet Squat — three squats, redundant to any
      // coach, and enough on its own to put a beginner's quads at 9.5 sets
      // against a plenty of 6 with everything already at its trim floor. An
      // accessory for a DIFFERENT pattern is still allowed: that is the filler
      // legitimately borrowing a day with room.
      const role = exRole(best);
      const isCarry = role === "carry";
      const pat = exPattern(best);
      const open = days.filter((d) => d.length < DAY_CAP
        && (!isCarry || d.every((nm) => exRole(nm) !== "carry"))
        && (role !== "accessory"
          || d.every((nm) => !(exRole(nm) === "accessory" && exPattern(nm) === pat))));
      // Spent either way, so a carry that fits nowhere cannot be re-picked
      // forever once every day already has one.
      used.add(exKey(best));
      if (!open.length) continue;
      // Routed by the DECLARED pattern where there is one, and only by the
      // muscle map where there is not.
      //
      // servesPattern alone put an overhead press on a pull day 180 times in
      // 2268 days — the demo tag "shoulders" reaches delts-rear, which is a Pull
      // group — which is the same leak EXERCISE_PATTERN was written to close,
      // one tier lower. Isolations and carries have no declared pattern and the
      // loose test is the right one for them: a curl belongs wherever there is
      // room for it.
      const fits = open.filter((d) => {
        const ps = dayPatterns[days.indexOf(d)] || [];
        return pat ? ps.includes(pat) : ps.some((p) => servesPattern(best, p));
      });
      // A movement with a DECLARED pattern goes on a day that owns that pattern
      // or it does not go at all. The old rule — "better placed oddly than
      // dropped, the coach can move it" — is right for a curl and wrong for a
      // press: a Floor Press on the hinge day and an Incline Press on the squat
      // day both read as bugs, and a coach who has to move things is being asked
      // to clean up after the tool. `report.short` is the honest way to say a
      // muscle went unserved; a bench press on leg day is a dishonest one.
      // The loop simply picks something else, so little coverage is lost.
      if (pat && !fits.length) continue;
      const target = (fits.length ? fits : open).reduce((a, b) => (b.length < a.length ? b : a));
      target.push(best);
      // A slot describes the movement's job ON THIS DAY, not its intrinsic role.
      //
      // An accessory only counts as one where it actually supports the day's main
      // lift — same pattern. The filler is also allowed to park a movement on any
      // day with room, and when it does, that movement is a fill however it is
      // classified elsewhere. Ranking those by their intrinsic role sorted them
      // to the third slot and made them read as part of the day's structure: a
      // real week came back with an Arnold Press directly under a Romanian
      // Deadlift on the hinge day, and a Lateral Lunge third on the push day.
      const onPattern = (dayPatterns[days.indexOf(target)] || []).includes(pat);
      slots.set(exKey(best), role === "accessory" && !onPattern ? "isolation" : role);
    }
    const finalSets = proposalSets(days, setsPerEx);
    return {
      short: ANATOMY_GROUPS.filter((g) => (finalSets[g.id] || 0) < bands.solid).map((g) => g.name),
    };
  }

  // Which burn level a slot earns. By slot rather than by style, so it is one
  // rule instead of nine. A phase then floors the lot: coverage in Fat loss
  // counts only Hard and up, so a generated week written below that minimum
  // would grade as completely empty the moment its map was opened. The builder
  // must never produce a program its own grader rejects.
  // Isolation splits in two because Nathan's formula asks for "both heavier and
  // lighter isolation work at the end": the first isolation of a day is the
  // heavier one, everything after it is lighter.
  const BUILDER_SLOT_EFFORT = {
    compound: "hard",
    accessory: "moderate",
    "isolation-heavy": "moderate",
    "isolation-light": "light",
    carry: "moderate",
  };
  function builderEffort(slot, phase) {
    const want = BUILDER_SLOT_EFFORT[slot] || "moderate";
    if (!phase) return want;
    const min = phaseMinRank(phase);
    if ((EFFORT_LEVELS[want] || {}).rank >= min) return want;
    return phase.minEffort;
  }

  // Bring a finished week back inside the plenty band by shaving sets, never by
  // dropping exercises.
  //
  // The filler's overshoot price is not enough on its own, because most of the
  // damage is done before the filler runs: a 5-day split owns the Squat and
  // Hinge patterns twice each, so four heavy leg movements are seated as
  // anchors and an advanced athlete's quads passed 22 sets against a plenty of
  // 12 before a single gap was filled. Pricing overshoot cannot fix that; the
  // sets are already on the page.
  //
  // So the promise is kept at the end instead. Repeatedly take the muscle
  // furthest past its band and shave one set off its biggest contributor, down
  // to a floor of 2 so a movement never dwindles into a token single. Shaving
  // rather than cutting keeps the shape of the week the coach is about to read.
  // A fill may be shaved to two sets; the movement that opens the day may not.
  // Trim took a bench press down to 2x6 as a day's anchor, which reads as an
  // afterthought rather than the lift the day is built around.
  const TRIM_FLOOR_SETS = 2;
  const TRIM_FLOOR_ANCHOR = 3;
  // Sets per muscle for a week that already has real set counts on it.
  function builtWeekSets(week) {
    const sets = {};
    ANATOMY_GROUPS.forEach((g) => { sets[g.id] = 0; });
    week.days.forEach((d) => d.exercises.forEach((ex) => {
      const n = Number(ex.sets) || 0;
      musclesForExercise(ex.name).forEach((h) => {
        if (sets[h.id] != null) sets[h.id] += n * h.weight;
      });
    }));
    Object.keys(sets).forEach((k) => { sets[k] = Math.round(sets[k] * 10) / 10; });
    return sets;
  }
  function trimToBands(week, bands, anchorIds) {
    const all = week.days.flatMap((d) => d.exercises);
    if (!all.length) return;
    const floorFor = (ex) => (anchorIds && anchorIds.has(ex.id) ? TRIM_FLOOR_ANCHOR : TRIM_FLOOR_SETS);
    for (let guard = 0; guard < 400; guard++) {
      const sets = builtWeekSets(week);
      let worstId = null, worstOver = 0;
      ANATOMY_GROUPS.forEach((g) => {
        const over = (sets[g.id] || 0) - bands.plenty;
        if (over > worstOver) { worstOver = over; worstId = g.id; }
      });
      if (!worstId) return;
      // The biggest contributor that can afford a set AND whose loss opens no
      // gap elsewhere. A compound feeds many muscles, so shaving it blindly
      // dragged a dozen of them under solid at once: the first version of this
      // took a week with nothing short and reported twelve gaps.
      const cand = all
        .filter((ex) => (Number(ex.sets) || 0) > floorFor(ex)
          && musclesForExercise(ex.name).some((h) => h.id === worstId))
        .sort((a, b) => Number(b.sets) - Number(a.sets))
        .find((ex) => musclesForExercise(ex.name).every((h) => {
          const cur = sets[h.id] || 0;
          // Never take a muscle below solid, and never touch one already there.
          return cur - h.weight >= Math.min(bands.solid, cur);
        }));
      if (!cand) return; // no surplus left that can be shaved without opening a gap
      cand.sets = String(Number(cand.sets) - 1);
    }
  }

  // Breadth ran out; buy depth instead.
  //
  // The structural tiers cost the week eight slots that used to belong to the
  // gap filler — one compound and one accessory for every pattern every day
  // owns — and they are spent on muscles the day is already built around. So a
  // finished week now runs to the seven-exercise cap with small groups still
  // under solid: measured over twenty rolls, a four-day intermediate week went
  // from nothing short to 2.3 muscles short, mostly abductors, adductors,
  // obliques and calves.
  //
  // Slots are the scarce thing, not sets. A fourth set of hip abduction closes
  // an abductor gap that no eighth exercise could be squeezed in for, and
  // "three sets became four" is what a coach would do here anyway.
  //
  // Priced on exactly the economics the gap filler uses — shortfall closed
  // against surplus spilled, at OVERSHOOT_COST — rather than on a flat refusal
  // to pass plenty. The flat rule was tried first and it barely moved: leg days
  // are glute-saturated, so every abductor and adductor movement in the week was
  // blocked by a muscle it only grazes, which is precisely the shortfall that
  // needed closing.
  //
  // A strict maximum is right here where it would be wrong in the pickers. This
  // is a deterministic repair pass over a week whose exercises are already
  // chosen; there is no variety to preserve, only the best next set to buy.
  const DEEPEN_MAX_SETS = 6;
  // What a beginner is written, whatever the style says.
  //
  // A triple is a near-maximal effort that has to be loaded against a known 1RM,
  // and the app has none — so "4x3 Bench Press" asks a sub-one-year lifter to
  // guess a weight for a rep range with no margin for guessing wrong. Six sets
  // of one lift is the other half: a beginner's plenty band is 6 sets for the
  // whole WEEK, so a single exercise was spending all of it.
  //
  // Clamped here rather than in GEN_STYLES, because Strength and Power are
  // correct for the athletes they suit; it is only this athlete who cannot use
  // them yet.
  const BEGINNER_MIN_REPS = 5;
  const BEGINNER_MAX_SETS = 5;
  function isBeginner(client) {
    return (client && client.trainingLevel) === "beginner";
  }
  function schemeForLevel(scheme, client) {
    if (!isBeginner(client)) return scheme;
    return {
      sets: scheme.sets.map((n) => Math.min(n, BEGINNER_MAX_SETS)),
      reps: scheme.reps.map((n) => Math.max(n, BEGINNER_MIN_REPS)),
    };
  }
  function deepenShort(week, bands, cap = DEEPEN_MAX_SETS) {
    const all = week.days.flatMap((d) => d.exercises);
    if (!all.length) return;
    for (let guard = 0; guard < 300; guard++) {
      const sets = builtWeekSets(week);
      // One more set is one more `h.weight` per muscle the movement pays, so
      // the gain is coverageGain at a setsPerEx of exactly 1. The most targeted
      // movement wins on its own merits: it spills the least.
      let best = null, bestGain = 0;
      all.forEach((ex) => {
        if ((Number(ex.sets) || 0) >= cap) return;
        const gain = coverageGain(ex.name, sets, bands, 1);
        if (gain > bestGain) { bestGain = gain; best = ex; }
      });
      if (!best) return;   // no set left that pays for itself
      best.sets = String(Number(best.sets) + 1);
    }
  }

  // The library category a name belongs to, so _repsFor() can hand a carry a
  // distance and a cardio piece a duration instead of a rep count.
  let _libCatByKey = null;
  function libCatFor(name) {
    if (!_libCatByKey) {
      _libCatByKey = new Map();
      EXERCISE_LIBRARY.forEach((c) => (c.ex || []).forEach((nm) => _libCatByKey.set(exKey(nm), c.cat)));
    }
    return _libCatByKey.get(exKey(name)) || "";
  }

  // The whole builder. Pure: it returns a week and a report and writes nothing,
  // so rolling again costs nothing and the preview can show the real thing.
  function buildWeek(client, { days = 4, styleName = "Powerbuilding" } = {}) {
    const gear = gearSet(client);
    const phase = phaseOf(client);
    const bands = levelBands(client);
    const style = GEN_STYLES.find((s) => s.name === styleName) || GEN_STYLES[0];
    // The FLOOR of the style's three schemes, not their average. The filler
    // plans with one number and buildWeek then assigns each slot its own from
    // the scheme; if planning assumed more than a slot actually gets, muscles
    // the filler had brought to solid land under it and the finished week
    // reports gaps the filler never saw. Planning low means reality can only
    // come in at or above plan, and the trim pass mops up any surplus.
    const setsPerEx = Math.min(style.primary.sets[0], style.acc.sets[0], style.core.sets[0]);

    // The most sets any one exercise may be written for. A beginner is held
    // lower than the deepen ceiling — see schemeForLevel.
    const setCap = isBeginner(client) ? BEGINNER_MAX_SETS : DEEPEN_MAX_SETS;

    const sk = skeletonFor(days, gear);
    const used = new Set();
    // Which job each movement was seated to do. Keyed by exKey, which is safe
    // because `used` already guarantees a name appears at most once in a week.
    // A map rather than the old positional anchor count: the day is assembled in
    // three passes now, so position no longer tells you what a slot is.
    const slots = new Map();
    const dayNames = seatCompounds(sk.days, gear, used, slots);
    seatAccessories(dayNames, sk.days, client, gear, used, setsPerEx, slots);
    const { short } = fillDeficit(dayNames, sk.days, client, gear, used, setsPerEx, slots);
    const slotOf = (nm) => slots.get(exKey(nm)) || "isolation";

    // Depth: leftover headroom adds SETS to the anchors, never new exercises,
    // and stops at plenty. Without that ceiling an unreachable pattern would
    // pour its freed capacity into extra sets that cannot fix the muscle
    // actually missing, and cost recovery for nothing.
    const extra = {};
    if (!short.length) {
      const sets = proposalSets(dayNames, setsPerEx);
      dayNames.forEach((names) => names.filter((nm) => slotOf(nm) === "compound").forEach((nm) => {
        const hits = musclesForExercise(nm);
        if (!hits.length) return;
        const headroom = Math.min(...hits.map((h) =>
          Math.floor((bands.plenty - (sets[h.id] || 0)) / Math.max(h.weight, 0.5))));
        if (headroom > 0) extra[exKey(nm)] = Math.min(headroom, 2);
      }));
    }

    const week = makeWeek((client.weeks || []).length);
    week.focus = `${style.name} · built from coverage`;
    const anchorIds = new Set();
    week.days = dayNames.map((names, i) => {
      const dayName = sk.days[i].join(" + ") || "Full Body";
      // The written order IS the formula: heavy compounds, then the accessories
      // that support them, then isolation, then any carry. Sorted rather than
      // relied upon, because the deficit filler appends in whatever order closed
      // the biggest gap and a carry could otherwise land in the second slot.
      // A stable sort, so movements inside a tier keep the order they were
      // seated in and a day's two compounds stay in pattern order.
      const ordered = [...names].sort((a, b) =>
        (ROLE_RANK[slotOf(a)] ?? 2) - (ROLE_RANK[slotOf(b)] ?? 2));
      let isoSeen = 0;
      return {
        id: uid(),
        name: dayName,
        icon: workoutIconFor(dayName),
        exercises: ordered.map((nm) => {
          const role = slotOf(nm);
          // The first isolation of the day is the heavier one, the rest are
          // lighter — "both heavier and lighter isolation work at the end".
          const slot = role === "isolation"
            ? (isoSeen++ === 0 ? "isolation-heavy" : "isolation-light")
            : role;
          // The scheme follows the EFFORT, not the tier.
          //
          // These agree exactly for an athlete with no phase — compound/hard
          // takes the primary band, accessory and the heavy isolation take the
          // accessory band, the light tail takes the core band — so nothing
          // changes for most athletes. It matters when a PHASE floors a slot.
          //
          // Fat loss counts only hard sets, so builderEffort lifts every slot to
          // hard, and the week was coming out as "3x15 Pallof Press 🔥🔥🔥" —
          // fifteen reps and hard effort are a contradiction, and measured over
          // 25 builds a Fat loss athlete got 397 hard sets and not one moderate
          // or light. Letting the reps move with the flame makes the whole
          // prescription true instead: on a cut the same week becomes 3x8 at
          // hard, which is what fewer-and-harder actually looks like.
          //
          // Flooring the flame is load-bearing and stays — see builderEffort.
          // Dropping it instead leaves ten of nineteen muscles ungraded, which
          // is the builder writing a week its own grader rejects.
          const eff = builderEffort(slot, phase);
          const scheme = schemeForLevel(
            eff === "hard" || eff === "max" ? style.primary
              : eff === "light" ? style.core
              : style.acc,
            client);
          const real = resolveRealization(nm, gear);
          const id = uid();
          if (role === "compound") anchorIds.add(id);
          return {
            id,
            name: nm,
            // Clamped. The depth bonus was meant to be the conservative path —
            // spend leftover headroom on the lifts already there rather than on
            // new exercises — but it was the only number in the builder with no
            // ceiling at all, and Volume's primary band of 5-6 plus a +2 bonus
            // wrote 8x12 Hip Thrust. deepenShort is bounded; so is this now.
            sets: String(Math.min(
              Number(_pickRange(scheme.sets)) + (extra[exKey(nm)] || 0),
              setCap)),
            reps: _repsFor(nm, libCatFor(nm), scheme),
            modifiers: real && real.tag ? [real.tag] : [],
            effort: eff,
            currentWeight: "", currentReps: "", goalWeight: "", goalReps: "",
            notes: "", videoUrl: "",
          };
        }),
      };
    });

    // Shave anything that ran past the band, then buy back what the structural
    // tiers cost in slots by deepening what is still short. Both have to happen
    // here, after the schemes have turned names into set counts.
    trimToBands(week, bands, anchorIds);
    deepenShort(week, bands, setCap);

    // What is short is read off the FINISHED week, not off the proposal.
    // fillDeficit's answer was true of a week where every exercise carried the
    // same nominal set count and nothing had been trimmed yet; reporting that
    // would describe a week the coach is not looking at.
    const finalSets = builtWeekSets(week);
    const shortFinal = ANATOMY_GROUPS
      .filter((g) => (finalSets[g.id] || 0) < bands.solid).map((g) => g.name);

    // Which single missing piece of gear would unlock the most, so the report
    // says what to buy rather than only what is absent.
    let gearHint = null;
    if (sk.dropped.length) {
      let bestId = null, bestN = 0;
      GEAR.forEach((g) => {
        if (gear.has(g.id)) return;
        const widened = new Set([...gear, g.id]);
        const n = sk.dropped.filter((p) => patternReachable(p, widened)).length;
        if (n > bestN) { bestN = n; bestId = g.id; }
      });
      if (bestId) gearHint = GEAR_BY_ID[bestId].label;
    }
    return {
      week,
      report: {
        short: shortFinal,
        dropped: sk.dropped,
        unreachable: ANATOMY_GROUPS.filter((g) => sk.dropped.includes(g.pattern)).map((g) => g.name),
        gearHint,
      },
    };
  }
  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.training = Object.assign(NS.training || {}, {
    gearSet, resolveRealization, coverageScore, builderPool,
    BUILDER_SKIP_CATS, exRole, exPattern, DAY_CAP, PICK_REACH,
    pickNearBest, bestForPattern, servesPattern, seatCompounds,
    proposalSets, OVERSHOOT_COST, coverageGain, fillDeficit,
    BUILDER_SLOT_EFFORT, builderEffort, TRIM_FLOOR_SETS, TRIM_FLOOR_ANCHOR,
    builtWeekSets, trimToBands, DEEPEN_MAX_SETS,
    BEGINNER_MIN_REPS, BEGINNER_MAX_SETS, isBeginner, schemeForLevel,
    deepenShort, libCatFor, buildWeek,
    GEN_STYLES, GEN_FLAVORS, GEN_SUFFIX, GEN_COMPOUND_KW,
    GEN_BW_GRADUATE_KW, GEN_BW_GRADUATE, GEN_HOLD_KW, GEN_CRAWL_KW,
    _rand, _pickRange, REP_LADDER, exRepWindow, _pickReps, _repsFor,
    _shuffle, _exercisesForCats, _genTags, GEN_ISO_KW,
  });
})();
