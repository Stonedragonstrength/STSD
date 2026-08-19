// Extracted from cloud.js — Phase 1 of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/sync/rows.spec.js imports THIS
// file and reads the namespace, so the shipped code is the tested code.
// index.html loads it BEFORE cloud.js, whose IIFE pulls all four names at
// its top — same loud-boot contract as app.js's pull block.
//
// The four mappers are the entire dialect between the in-memory shapes and
// the Supabase rows, and they move as one module because their real
// obligation is to each other: a field one side of a pair writes and the
// other never reads is silent data loss on the next round trip. The spec
// pins the pairs both ways — by value (a lived-in record survives the round
// trip) and by source (the column lists stay in step).
(function () {
  "use strict";

  function athleteToRow(c, coachId) {
    if (!c?.id || !c?.inviteCode || !coachId) return null;
    return {
      id: c.id,
      coach_id: coachId,
      display_name: c.name || "",
      invite_code: c.inviteCode,
      age: c.age || null,
      birthday: c.birthday || null,
      referral_code: c.referralCode || null,
      referred_by: c.referredBy || null,
      height_in: c.heightIn || null,
      weight_lb: c.weightLb || null,
      units: c.units === "kg" ? "kg" : "lb",
      goals: c.goals || null,
      notes: c.notes || null,
      training_level: c.trainingLevel || null,
      training_phase: c.trainingPhase || null,
      equipment: c.equipment || [],
      days_per_week: Number(c.daysPerWeek) || 0,
      pain_relief: !!c.painRelief,
      weeks: c.weeks || [],
      schedule: c.schedule || {},
      coach_prs: c.coachPRs || [],
      session_bank: c.sessionBank || { packages: [], redemptions: [] },
      one_off_days: c.oneOffDays || [],
      trials: c.trials || [],
      setmore_aliases: c.setmoreAliases || [],
      nutrition: c.nutrition || { current: null, history: [] },
      hide_open_slots: !!c.hideOpenSlots,
      can_book: !!c.canBook,
      partner_id: c.partnerId || null,
      updated_at: new Date().toISOString(),
    };
  }
  function rowToAthlete(r) {
    if (!r) return null;
    return {
      // Server-side revision, bumped by trigger on every update. Carried on
      // the client object (athleteToRow never sends it back) so guarded
      // writes can tell "this device's copy is current" from "it isn't".
      _rev: Number(r.rev) || 0,
      id: r.id,
      name: r.display_name,
      inviteCode: r.invite_code,
      age: r.age || "",
      birthday: r.birthday || "",
      referralCode: r.referral_code || "",
      referredBy: r.referred_by || "",
      heightIn: r.height_in || "",
      weightLb: r.weight_lb || "",
      units: r.units === "kg" ? "kg" : "lb",
      goals: r.goals || "",
      notes: r.notes || "",
      trainingLevel: r.training_level || "",
      trainingPhase: r.training_phase || "",
      equipment: r.equipment || [],
      daysPerWeek: Number(r.days_per_week) || 0,
      painRelief: !!r.pain_relief,
      weeks: r.weeks || [],
      schedule: r.schedule || {},
      coachPRs: r.coach_prs || [],
      sessionBank: r.session_bank || { packages: [], redemptions: [] },
      oneOffDays: r.one_off_days || [],
      trials: r.trials || [],
      setmoreAliases: r.setmore_aliases || [],
      nutrition: r.nutrition || { current: null, history: [] },
      hideOpenSlots: !!r.hide_open_slots,
      canBook: !!r.can_book,
      partnerId: r.partner_id || null,
      importedProgress: null,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
      _coachId: r.coach_id || null,
    };
  }
  function progressToRow(p, athleteId) {
    return {
      athlete_id: athleteId,
      exercise_logs: p.exerciseLogs || {},
      bodyweight_log: p.bodyweightLog || [],
      day_completions: p.dayCompletions || {},
      personal_records: p.personalRecords || [],
      package_requests: p.packageRequests || [],
      cardio_logs: p.cardioLogs || [],
      feedback: p.feedback || "",
      dismissed_bulletins: p.dismissedBulletins || {},
      seen_messages: p.seenMessages || {},
      total_workout_ms: Math.round(p.totalWorkoutMs || 0),
      workout_moods: p.workoutMoods || {},
      readiness: p.readiness || {},
      added_exercises: p.addedExercises || {},
      athlete_days: p.athleteDays || [],
      form_checks: p.formChecks || {},
      swaps: p.swaps || {},
      nutrition_targets: p.nutritionTargets || {},
      food_log: p.foodLog || {},
      custom_foods: p.customFoods || [],
      saved_meals: p.savedMeals || [],
      water_log: p.waterLog || {},
      nutrition_game: p.nutritionGame || {},
      hoard: p.hoard || {},
      avatar_id: p.avatarId || null,
      day_notes: p.dayNotes || {},
      pending_deloads: p.pendingDeloads || {},
      // The stat field's per-date buckets. Column added 20260814120000; that
      // migration is applied to the live project BEFORE this line ships,
      // because an upsert naming a column that does not exist fails and takes
      // every progress save with it, not just this feature.
      stat_field: p.statField || {},
      // The Overview board's tile picks. Column added 20260818120000, applied
      // to the live project before this line shipped — same contract as
      // stat_field above.
      overview_tiles: p.overviewTiles || [],
      synced_at: new Date().toISOString(),
    };
  }
  function rowToProgress(r) {
    if (!r) return null;
    return {
      exerciseLogs: r.exercise_logs || {},
      bodyweightLog: r.bodyweight_log || [],
      dayCompletions: r.day_completions || {},
      personalRecords: r.personal_records || [],
      packageRequests: r.package_requests || [],
      cardioLogs: r.cardio_logs || [],
      feedback: r.feedback || "",
      dismissedBulletins: r.dismissed_bulletins || {},
      seenMessages: r.seen_messages || {},
      totalWorkoutMs: Number(r.total_workout_ms) || 0,
      workoutMoods: r.workout_moods || {},
      readiness: r.readiness || {},
      addedExercises: r.added_exercises || {},
      athleteDays: r.athlete_days || [],
      formChecks: r.form_checks || {},
      swaps: r.swaps || {},
      nutritionTargets: r.nutrition_targets || {},
      foodLog: r.food_log || {},
      customFoods: r.custom_foods || [],
      savedMeals: r.saved_meals || [],
      waterLog: r.water_log || {},
      nutritionGame: r.nutrition_game || {},
      hoard: r.hoard || {},
      avatarId: r.avatar_id || "",
      dayNotes: r.day_notes || {},
      pendingDeloads: r.pending_deloads || {},
      statField: r.stat_field || {},
      overviewTiles: r.overview_tiles || [],
      syncedAt: r.synced_at,
      _rev: Number(r.rev) || 0,
    };
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.sync = Object.assign(NS.sync || {}, {
    athleteToRow,
    rowToAthlete,
    progressToRow,
    rowToProgress,
  });
})();
