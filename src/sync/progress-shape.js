// Extracted from app.js — Phase 1 of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/sync/progress-shape.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
//
// These two are one statement about what a progress object IS, made from
// opposite ends: emptyProgress is the canonical starting shape, and
// ensureProgressShape repairs an existing object toward it IN PLACE — every
// pull, import and boot path runs progress through it before anything reads
// a field. They move together so the shape has one home.
//
// Their field lists deliberately do not match, and the extraction keeps that
// verbatim. ensureProgressShape backfills cardioLogs, pendingDeloads and
// readiness, which emptyProgress omits — a fresh progress always flows
// through ensure before use, so late-added fields only need the repair half.
// And emptyProgress seeds addedExercises, which ensure never backfills —
// every reader is defensive (`?.` / `|| {}`) and the one writer self-heals.
(function () {
  "use strict";

  function emptyProgress() { return { exerciseLogs: {}, bodyweightLog: [], feedback: "", dayCompletions: {}, personalRecords: [], packageRequests: [], dayNotes: {}, dismissedBulletins: {}, seenMessages: {}, totalWorkoutMs: 0, workoutMoods: {}, addedExercises: {}, athleteDays: [], formChecks: {}, swaps: {}, nutritionTargets: {}, foodLog: {}, customFoods: [], savedMeals: [], waterLog: {}, nutritionGame: {}, statField: {}, avatarId: "" }; }
  function ensureProgressShape(p) {
    if (typeof p.avatarId !== "string") p.avatarId = "";
    if (!p.exerciseLogs) p.exerciseLogs = {};
    if (!p.bodyweightLog) p.bodyweightLog = [];
    if (p.feedback == null) p.feedback = "";
    if (!p.dayCompletions) p.dayCompletions = {};
    if (!p.personalRecords) p.personalRecords = [];
    if (!p.packageRequests) p.packageRequests = [];
    if (!p.dayNotes) p.dayNotes = {};
    if (!Array.isArray(p.cardioLogs)) p.cardioLogs = [];
    if (!p.dismissedBulletins) p.dismissedBulletins = {};
    if (!p.seenMessages) p.seenMessages = {};
    if (typeof p.totalWorkoutMs !== "number" || !isFinite(p.totalWorkoutMs)) p.totalWorkoutMs = 0;
    if (!p.workoutMoods || typeof p.workoutMoods !== "object") p.workoutMoods = {};
    if (!p.pendingDeloads || typeof p.pendingDeloads !== "object") p.pendingDeloads = {};
    // The stat field's per-date buckets, keyed YYYY-MM-DD. Backfilled empty on
    // old shapes; syncStatField rebuilds it from the logs on first read.
    if (!p.statField || typeof p.statField !== "object") p.statField = {};
    if (!p.readiness || typeof p.readiness !== "object") p.readiness = {};
    if (!Array.isArray(p.athleteDays)) p.athleteDays = [];
    if (!p.formChecks || typeof p.formChecks !== "object") p.formChecks = {};
    if (!p.swaps || typeof p.swaps !== "object") p.swaps = {};
    if (!p.nutritionTargets || typeof p.nutritionTargets !== "object") p.nutritionTargets = {};
    if (!p.foodLog || typeof p.foodLog !== "object") p.foodLog = {};
    if (!Array.isArray(p.customFoods)) p.customFoods = [];
    if (!Array.isArray(p.savedMeals)) p.savedMeals = [];
    if (!p.waterLog || typeof p.waterLog !== "object") p.waterLog = {};
    if (!p.nutritionGame || typeof p.nutritionGame !== "object") p.nutritionGame = {};
    return p;
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.sync = Object.assign(NS.sync || {}, {
    emptyProgress,
    ensureProgressShape,
  });
})();
